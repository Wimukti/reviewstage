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
