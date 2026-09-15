#!/usr/bin/env python3
"""Unit tests for the learnings→rules loop (bin/rs_learn.py): clustering paraphrases of one
complaint, the evidence threshold, coverage by an existing rule, the dismissal store, and the
promoted rows leaving the rolling prompt block. No model call is ever made here — the proposal
text is written straight into the cache the drafter would have filled.
Run: python3 -m unittest bin/test_rs_learn.py"""
import importlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def row(gist, pr="1", outcome="dropped", path="app/models/Product.php", sev="nit",
        repo="acme/widgets"):
    return {"at": int(time.time()), "repo": repo, "pr": str(pr), "user": "acme-dev",
            "skill": "global", "path": path, "line": 42, "severity": sev,
            "gist": gist, "outcome": outcome}


# Four ways of saying "stop telling me to prefer const over let".
CONST = [
    row("Prefer const over let for this binding", pr="1"),
    row("Use const rather than let here — the binding is never reassigned", pr="2"),
    row("This let is never reassigned; const would be preferable", pr="3"),
    row("Prefer a const binding over let in the badge component", pr="4"),
]
# A genuinely different complaint, same file and severity.
OTHER = [
    row("Extract this magic timeout number into a named constant", pr="5"),
    row("The magic number 30 should be a named constant", pr="6"),
]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["ROOT"] = self.tmp.name
        import rs_learn
        self.L = importlib.reload(rs_learn)

    def tearDown(self):
        os.environ.pop("ROOT", None)
        self.tmp.cleanup()

    def write(self, rows):
        Path(self.tmp.name).mkdir(parents=True, exist_ok=True)
        self.L.FILE.write_text("".join(json.dumps(r) + "\n" for r in rows))

    def post(self, n, pr, outcome="dropped", key="", skill="global", repo="acme/widgets",
             dry=False):
        originals = [{"path": "app/models/Product.php", "line": 3, "severity": "nit",
                      "body": f"finding {i} on pr {pr}"} for i in range(n)]
        form = {}
        if outcome != "dropped":
            for i in range(n):
                form[f"sel_{i}"] = ["1"]
                form[f"body_{i}"] = [originals[i]["body"] if outcome == "kept" else "reworded"]
        self.L.record(repo, pr, "acme-dev", originals, form, skill=skill, key=key, dry=dry)


class Clustering(Base):
    def test_paraphrases_of_one_complaint_group_together(self):
        cl = self.L.cluster_rows(CONST)
        self.assertEqual(len(cl), 1)
        self.assertEqual(len(cl[0]), 4)

    def test_different_complaints_stay_apart(self):
        cl = self.L.cluster_rows(CONST + OTHER)
        self.assertEqual(sorted(len(c) for c in cl), [2, 4])

    def test_a_different_severity_is_a_different_cluster(self):
        rows = CONST + [row(CONST[0]["gist"], pr="9", sev="blocker")]
        self.assertEqual(sorted(len(c) for c in self.L.cluster_rows(rows)), [1, 4])

    def test_a_different_top_level_directory_is_a_different_cluster(self):
        rows = CONST + [row(CONST[0]["gist"], pr="9", path="web/ui/Badge.tsx")]
        self.assertEqual(sorted(len(c) for c in self.L.cluster_rows(rows)), [1, 4])

    def test_a_pathless_row_still_joins_its_complaint(self):
        rows = CONST + [row(CONST[0]["gist"], pr="9", path="")]
        self.assertEqual([len(c) for c in self.L.cluster_rows(rows)], [5])

    def test_signature_is_stable_as_the_cluster_grows(self):
        a = self.L.signature(CONST[:3])
        self.assertEqual(a, self.L.signature(CONST))
        self.assertNotEqual(a, self.L.signature(OTHER))

    def test_similarity_threshold_is_the_line_between_them(self):
        same = self.L._sim(self.L._toks(CONST[0]["gist"]), self.L._toks(CONST[1]["gist"]))
        diff = self.L._sim(self.L._toks(CONST[0]["gist"]), self.L._toks(OTHER[0]["gist"]))
        self.assertGreaterEqual(same, self.L.SIM_THRESHOLD)
        self.assertLess(diff, self.L.SIM_THRESHOLD)


class Qualifying(Base):
    def test_below_the_minimum_is_not_evidence(self):
        self.write(CONST[:2])
        self.assertEqual(self.L.clusters("dropped"), [])       # 2 rows, min is 3

    def test_at_the_minimum_it_qualifies(self):
        self.write(CONST[:3])
        c = self.L.clusters("dropped")
        self.assertEqual(len(c), 1)
        self.assertEqual((c[0]["count"], c[0]["prs"]), (3, 3))

    def test_an_env_raised_minimum_holds_it_back(self):
        self.write(CONST)
        self.assertEqual(self.L.clusters("dropped", min_rows=5), [])

    def test_three_drops_on_one_pr_are_one_bad_day_not_a_pattern(self):
        self.write([row(r["gist"], pr="1") for r in CONST])
        self.assertEqual(self.L.clusters("dropped"), [])

    def test_edited_rows_cluster_separately_from_dropped_ones(self):
        self.write(CONST + [row(r["gist"], pr=r["pr"], outcome="edited") for r in CONST])
        self.assertEqual(len(self.L.clusters("dropped")), 1)
        self.assertEqual(len(self.L.clusters("edited")), 1)


class Coverage(Base):
    SKILL = ("Some guidance.\n\n## Team rules\n\nIntro line:\n\n"
             "- Never raise a nit about preferring const over let.\n")

    def test_a_cluster_an_existing_rule_covers_is_not_suggested(self):
        self.write(CONST)
        c = self.L.clusters("dropped")[0]
        rules = self.L.parse_rules(self.SKILL)
        self.assertEqual(rules, ["Never raise a nit about preferring const over let."])
        self.assertTrue(self.L.covered_by_rule(c, rules))

    def test_an_unrelated_rule_does_not_cover_it(self):
        self.write(CONST)
        c = self.L.clusters("dropped")[0]
        self.assertFalse(self.L.covered_by_rule(c, ["Money is always integer cents."]))

    def test_no_team_rules_section_means_no_rules(self):
        self.assertEqual(self.L.parse_rules("Just a skill with no rules."), [])


class Dismissal(Base):
    def test_dismissal_persists_and_undismiss_restores(self):
        self.write(CONST)
        c = self.L.clusters("dropped")[0]
        self.assertIsNone(self.L.dismissed_match(c))
        self.L.dismiss(c["signature"], c, "acme-dev")
        self.L = importlib.reload(self.L)                      # survives a restart
        c2 = self.L.clusters("dropped")[0]
        self.assertEqual(self.L.dismissed_match(c2)["by"], "acme-dev")
        self.assertTrue(self.L.undismiss(c2["signature"]))
        self.assertIsNone(self.L.dismissed_match(self.L.clusters("dropped")[0]))

    def test_a_grown_cluster_stays_dismissed_even_if_its_signature_drifts(self):
        self.write(CONST)
        c = self.L.clusters("dropped")[0]
        self.L.dismiss(c["signature"], c, "acme-dev")
        grown = dict(c, signature="0000deadbeef")
        self.assertIsNotNone(self.L.dismissed_match(grown))

    def test_undismissing_something_never_dismissed_is_a_no_op(self):
        self.assertFalse(self.L.undismiss("nope"))


class Promotion(Base):
    def test_promoted_rows_leave_the_rolling_prompt_block(self):
        self.write(CONST + OTHER)
        block = self.L.render("acme/widgets")
        self.assertIn("Prefer const over let", block)
        c = self.L.clusters("dropped")[0]
        self.L.promote(c["signature"], c, "acme-dev",
                       "Never raise a nit about preferring const over let.", "global")
        after = self.L.render("acme/widgets")
        self.assertNotIn("Prefer const over let", after)
        self.assertIn("magic", after)                          # the other complaint survives
        self.assertIn("now Team rules", after)                 # the preamble says why

    def test_promotion_counts_are_the_insights_number(self):
        self.write(CONST)
        c = self.L.clusters("dropped")[0]
        self.L.promote(c["signature"], c, "acme-dev", "A rule.", "global")
        self.assertEqual(self.L.promoted_count(), 1)
        self.assertEqual(self.L.promoted_count("acme/widgets"), 1)
        self.assertEqual(self.L.promoted_count("acme/api"), 0)

    def test_a_promoted_cluster_is_not_offered_again(self):
        self.write(CONST)
        c = self.L.clusters("dropped")[0]
        self.L.promote(c["signature"], c, "acme-dev", "A rule.", "global")
        self.assertIn(c["signature"], self.L.promoted_signatures())

    def test_cluster_status_labels_each_line(self):
        self.write(CONST + OTHER)
        c = self.L.clusters("dropped")[0]
        self.L.promote(c["signature"], c, "acme-dev", "A rule.", "global")
        st = {s["signature"]: s["status"] for s in self.L.cluster_status()}
        self.assertEqual(st[c["signature"]], "promoted")
        self.assertIn("rolling", st.values())


class PromotedLeavesTheWindowWithMixedOutcomes(Base):
    """Regression: render() hands dropped AND edited rows to the promoted-row filter together.

    The filter used to re-cluster that mixed list in one pass, and _same_group ignored the
    outcome, so the merged cluster's signature never equalled the dropped-only signature the
    rule was promoted from — nothing was skipped and the promoted complaint stayed in the
    rolling window for ever. The old test passed only because its fixture was dropped-only."""

    # The same complaint, dropped on four PRs and reworded on three others. The reworded gists
    # carry enough of their own vocabulary that a cluster merging both outcomes hashes to a
    # different signature than the dropped-only one the rule was promoted from.
    EDITED = [
        row("Prefer const over let: the immutable threshold configuration binding",
            pr="10", outcome="edited"),
        row("Prefer const over let for the immutable threshold configuration value",
            pr="11", outcome="edited"),
        row("Prefer const over let, immutable threshold configuration everywhere",
            pr="12", outcome="edited"),
    ]

    def fixture(self):
        return CONST + self.EDITED + OTHER

    def test_a_promoted_dropped_cluster_leaves_the_window_even_when_edited_rows_exist(self):
        self.write(self.fixture())
        c = next(c for c in self.L.clusters("dropped") if "const" in c["gist"].lower())
        self.L.promote(c["signature"], c, "acme-dev", "Never raise const-over-let nits.",
                       "global")
        after = self.L.render("acme/widgets")
        dropped_block = after.split("kept but reworded")[0]
        self.assertNotIn("Prefer const over let", dropped_block)
        self.assertIn("magic", dropped_block)       # the unrelated complaint still rolls

    def test_the_edited_cluster_is_its_own_complaint(self):
        self.write(self.fixture())
        drop = {c["signature"] for c in self.L.clusters("dropped", min_rows=2)}
        edit = {c["signature"] for c in self.L.clusters("edited", min_rows=2)}
        self.assertFalse(drop & edit)

    def test_promoting_the_edited_cluster_does_not_silence_the_dropped_one(self):
        self.write(self.fixture())
        c = next(c for c in self.L.clusters("edited", min_rows=2) if "const" in c["gist"].lower())
        self.L.promote(c["signature"], c, "acme-dev", "A rule.", "global")
        self.assertIn("Prefer const over let", self.L.render("acme/widgets"))


class AllTimeTotals(Base):
    """Regression: every "all-time" number was really "the last CAP findings" and could fall."""

    def test_counts_survive_the_detail_log_rolling_over(self):
        per = self.L.CAP // 2 + 10
        self.post(per, "1")
        self.post(per, "2")
        self.assertEqual(len(self.L._read()), self.L.CAP)        # the log really did truncate
        self.assertEqual(self.L.counts()["dropped"], 2 * per)    # the tally did not

    def test_counts_never_go_down(self):
        self.post(self.L.CAP, "1", outcome="kept")
        first = self.L.counts()["kept"]
        self.post(20, "2", outcome="kept")
        self.assertEqual(self.L.counts()["kept"], first + 20)

    def test_a_retry_of_the_same_post_replaces_its_rows(self):
        k = self.L.post_key("acme/widgets", 7, "acme-dev", "abc123def456")
        self.post(3, "7", key=k)
        self.post(3, "7", key=k)                                 # the reviewer clicked again
        self.assertEqual(self.L.counts()["dropped"], 3)
        self.assertEqual(len(self.L._read()), 3)

    def test_the_tally_survives_a_restart(self):
        self.post(5, "1")
        self.L = importlib.reload(self.L)
        self.assertEqual(self.L.counts()["dropped"], 5)

    def test_a_rate_under_the_floor_is_not_ratable(self):
        self.post(3, "1", outcome="kept")
        st = self.L.skill_stats()[0]
        self.assertFalse(st["ratable"])
        self.post(self.L.MIN_RATE_SAMPLE, "2", outcome="kept")
        self.assertTrue(self.L.skill_stats()[0]["ratable"])


class DryRunDecisions(Base):
    """A DRY_RUN post never reaches GitHub. Its decisions are still the reviewer's real
    judgement, so they feed the prompt block and the rule clusters — but a keep rate computed
    from them describes a review that did not happen, so no rate may count them."""

    def test_a_dry_row_is_flagged_on_disk(self):
        self.post(2, "1", dry=True)
        rows = self.L._read()
        self.assertEqual([r.get("dry") for r in rows], [True, True])

    def test_dry_decisions_are_left_out_of_every_rate_and_total(self):
        self.post(4, "1", outcome="kept", dry=True)
        c = self.L.counts()
        self.assertEqual((c["kept"], c["edited"], c["dropped"]), (0, 0, 0))
        self.assertEqual(c["dry"], 4)
        self.assertEqual(self.L.keep_rates(c)["keepRate"], None)
        self.assertEqual(self.L.skill_stats(), [])

    def test_a_live_post_beside_dry_ones_rates_only_itself(self):
        self.post(6, "1", outcome="kept", dry=True)
        self.post(2, "2", outcome="kept")
        self.post(2, "3")                                        # dropped, live
        c = self.L.counts()
        self.assertEqual((c["kept"], c["dropped"], c["dry"]), (2, 2, 6))
        self.assertEqual(self.L.keep_rates(c)["keepRate"], 50.0)

    def test_dry_rows_still_reach_the_prompt_block(self):
        self.post(1, "1", dry=True)
        self.assertIn("finding 0 on pr 1", self.L.render("acme/widgets"))

    def test_dry_rows_still_cluster_into_a_rule_suggestion(self):
        self.write([dict(r, dry=True) for r in CONST])
        self.assertEqual(len(self.L.clusters("dropped")), 1)

    def test_a_retried_dry_post_does_not_double_count(self):
        k = self.L.post_key("acme/widgets", 7, "acme-dev", "abc123def456")
        self.post(3, "7", key=k, dry=True)
        self.post(3, "7", key=k, dry=True)
        self.assertEqual(self.L.counts()["dry"], 3)

    def test_a_tally_written_before_dry_rows_existed_still_loads(self):
        self.post(2, "1")
        t = json.loads(self.L.TOTALS.read_text())
        t.pop("dryDecisions", None)
        self.L.TOTALS.write_text(json.dumps(t))
        self.assertEqual(self.L.counts()["dry"], 0)


class RuleSectionParsing(Base):
    def test_parsing_stops_at_the_next_heading(self):
        skill = ("## Team rules\n\n- Never raise const-over-let nits.\n\n"
                 "## Examples\n\n- This bullet is prose, not a rule.\n")
        self.assertEqual(self.L.parse_rules(skill), ["Never raise const-over-let nits."])


class Config(Base):
    def test_a_non_numeric_minimum_does_not_crash_the_import(self):
        os.environ["RULE_SUGGEST_MIN"] = "three"
        try:
            L = importlib.reload(self.L)
            self.assertEqual(L.RULE_SUGGEST_MIN, 3)
        finally:
            os.environ.pop("RULE_SUGGEST_MIN", None)
            self.L = importlib.reload(self.L)


class ProposalCache(Base):
    """The model itself is never called here: the drafter's only side effect is this cache."""

    def test_a_cached_proposal_is_keyed_by_signature(self):
        self.write(CONST)
        c = self.L.clusters("dropped")[0]
        self.L.save_proposal(c["signature"], "Don't raise const-over-let nits.",
                             "Dropped 4 times across 4 PRs.", "haiku")
        self.L = importlib.reload(self.L)
        p = self.L.proposals()[c["signature"]]
        self.assertEqual(p["rule"], "Don't raise const-over-let nits.")
        self.assertEqual(p["model"], "haiku")


if __name__ == "__main__":
    unittest.main()
