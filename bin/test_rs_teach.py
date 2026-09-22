#!/usr/bin/env python3
"""Teaching the reviewing skill from ONE finding, in bin/server.py.

The clustering engine only learns from repetition, and only from rejection. This path lets a
reviewer turn the finding in front of them into a standing rule immediately. What matters is
that it goes through the SAME door as everything else: the rule has to end up in the text
read_skill() returns, because that is the text run-review.sh hands the agent — a rule written to
some other file, or to a section the agent never reads, teaches nothing. The audit already found
one promotion path that wrote a rule the prompt window never saw.

Run: python3 -m unittest bin.test_rs_teach
"""
import importlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

SECRET = "a" * 64
REPO = "acme/widgets"
PR = "42"
USER = "ann"


def load_server(root):
    os.environ["ROOT"] = root
    os.environ["RS_COOKIE_SECURE"] = "0"
    os.makedirs(os.path.join(root, "state"), exist_ok=True)
    with open(os.path.join(root, ".env"), "w") as f:
        f.write(f"RS_SECRET={SECRET}\nREPOS=acme/widgets,acme/api\nGITHUB_PAT=t\n")
    # rs_learn resolves ROOT and its three decision stores at IMPORT time, so reloading only
    # `server` leaves the promotions file pointing at the previous test's temp directory and
    # every signature taught in one test is still promoted in the next.
    if "rs_learn" in sys.modules:
        importlib.reload(sys.modules["rs_learn"])
    if "server" in sys.modules:
        return importlib.reload(sys.modules["server"])
    return importlib.import_module("server")


NIT = {"severity": "nit", "path": "src/javascripts/Badge.tsx", "line": 10,
       "title": "Use const instead of let",
       "impact": "Style only — no effect on behaviour.",
       "body": "This let is never reassigned; a const binding would be preferable."}
BLOCKER = {"severity": "blocker", "path": "app/models/Product.php", "line": 42,
           "title": "A product with no vendor can crash the lead-time badge",
           "impact": "A shopper would see the card fail instead of loading.",
           "body": "Guard a null vendor before reading its lead time."}


class TeachCase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.S = load_server(self.root)
        self.write_review([BLOCKER, NIT])

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write_review(self, comments):
        f = self.S.upath(REPO, PR, USER, "review.json")
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps({"event": "COMMENT", "comments": comments}))

    def add(self, idx, rule, direction="avoid"):
        return self.S.teach_finding(REPO, PR, USER, idx, direction, "add", rule)


class WhichFinding(TeachCase):
    def test_the_index_is_read_against_the_severity_sorted_review(self):
        """The client sends the index it rendered, which _review_data sorted by severity. If the
        server read the raw array instead, teaching the nit would write a rule about the
        blocker."""
        self.assertEqual(self.S.stored_finding(REPO, PR, USER, 0)["severity"], "blocker")
        self.assertEqual(self.S.stored_finding(REPO, PR, USER, 1)["title"],
                         "Use const instead of let")

    def test_an_index_past_the_end_is_refused_rather_than_wrapping(self):
        self.assertIsNone(self.S.stored_finding(REPO, PR, USER, 9))
        _out, err = self.add(9, "Never mind.")
        self.assertIn("no longer exists", err)

    def test_a_negative_index_cannot_reach_the_last_finding(self):
        self.assertIsNone(self.S.stored_finding(REPO, PR, USER, -1))


class WhereTheRuleLands(TeachCase):
    def test_the_rule_is_in_the_text_the_agent_is_given(self):
        out, err = self.add(1, "Do not comment on let versus const")
        self.assertIsNone(err)
        self.assertTrue(out["added"])
        self.assertIn("Do not comment on let versus const.", self.S.read_skill("global"))

    def test_it_lands_in_the_managed_team_rules_section(self):
        self.add(1, "Do not comment on let versus const")
        text = self.S.read_skill("global")
        self.assertIn(self.S.RULES_MARKER, text)
        after = text.split(self.S.RULES_MARKER, 1)[1]
        self.assertIn("Do not comment on let versus const.", after)

    def test_a_repo_with_its_own_skill_gets_the_rule_the_shared_default_does_not(self):
        self.S.save_skill("repo:acme/widgets", "THE WIDGETS OVERRIDE")
        out, err = self.add(1, "Do not comment on let versus const")
        self.assertIsNone(err)
        self.assertEqual(out["target"], "repo:acme/widgets")
        self.assertIn("let versus const", self.S.read_skill("repo:acme/widgets"))
        self.assertNotIn("let versus const", self.S.read_skill("global"))

    def test_a_repo_without_its_own_skill_never_has_one_created_for_it(self):
        """A single rule must not mint a per-repo skill: that file then overrides the team
        default for every review of the repository, silently dropping everything else in it."""
        out, err = self.add(1, "Do not comment on let versus const")
        self.assertIsNone(err)
        self.assertEqual(out["target"], "global")
        self.assertFalse(self.S.repo_skill_path(REPO).exists())

    def test_the_skill_size_guard_refuses_rather_than_truncates(self):
        self.S.save_skill("global", "x" * 39_990)
        _out, err = self.add(1, "Do not comment on let versus const")
        self.assertIn("very large", err)
        self.assertNotIn("let versus const", self.S.read_skill("global"))


class NotTwice(TeachCase):
    def test_the_same_finding_cannot_be_taught_twice(self):
        self.add(1, "Do not comment on let versus const")
        _out, err = self.add(1, "Do not comment on let versus const")
        self.assertIn("already taught", err)
        self.assertEqual(self.S.read_skill("global").count("let versus const"), 1)

    def test_a_taught_finding_is_recorded_as_promoted(self):
        self.add(1, "Do not comment on let versus const")
        c = self.S.stored_finding(REPO, PR, USER, 1)
        sig = self.S.finding_cluster(REPO, PR, c)["signature"]
        self.assertIn(sig, self.S.rs_learn.promoted_signatures())

    def test_the_signature_is_the_one_the_clustering_engine_would_mint(self):
        """The whole point of reusing rs_learn.signature: once taught, the same complaint must
        not come back later as a fresh cluster suggestion."""
        c = self.S.stored_finding(REPO, PR, USER, 1)
        row = self.S.finding_row(REPO, PR, c)
        self.assertEqual(self.S.finding_cluster(REPO, PR, c)["signature"],
                         self.S.rs_learn.signature([row]))

    def test_a_reworded_complaint_is_caught_by_the_rule_that_already_covers_it(self):
        """The fuzzy guard, which the exact signature cannot do: a different finding, a
        different signature, the same complaint in words rich enough to compare."""
        self.add(0, "Always guard a null vendor before reading its lead time", "always")
        self.write_review([{**BLOCKER, "title": "Null vendor crashes the lead time badge",
                            "body": "The lead time read assumes a vendor."}])
        _out, err = self.add(0, "Guard the vendor lead time read")
        self.assertIn("already covers", err)

    def test_a_different_complaint_in_the_same_file_can_still_be_taught(self):
        self.add(1, "Do not comment on let versus const")
        self.write_review([{**NIT, "title": "Memoise the badge list render",
                            "body": "The badge list re-renders on every keystroke."}])
        _out, err = self.add(0, "Flag list renders that are not memoised")
        self.assertIsNone(err)


class Direction(TeachCase):
    def prompt(self, direction):
        c = self.S.stored_finding(REPO, PR, USER, 1)
        return self.S._teach_prompt(direction, c, ["Keep nits to one line."])

    def test_avoid_asks_for_a_rule_that_stops_the_complaint(self):
        p = self.prompt("avoid")
        self.assertIn("NOT worth", p)
        self.assertIn("what not to raise", p)

    def test_always_asks_for_a_rule_that_keeps_it(self):
        p = self.prompt("always")
        self.assertIn("EVERY time", p)
        self.assertIn("what to check for", p)

    def test_both_prompts_carry_the_house_style_and_the_finding(self):
        for d in self.S.TEACH_DIRECTIONS:
            p = self.prompt(d)
            self.assertIn("Keep nits to one line.", p)
            self.assertIn("Use const instead of let", p)
            self.assertIn("src/javascripts/Badge.tsx", p)

    def test_an_unknown_direction_writes_nothing(self):
        _out, err = self.S.teach_finding(REPO, PR, USER, 1, "sideways", "add", "A rule")
        self.assertIn("Unknown direction", err)
        self.assertNotIn(self.S.RULES_MARKER, self.S.read_skill("global"))


class Drafting(TeachCase):
    def test_drafting_without_a_connected_claude_account_says_so_and_writes_nothing(self):
        out, err = self.S.teach_finding(REPO, PR, USER, 1, "avoid", "draft")
        self.assertIsNone(out)
        self.assertIn("Connect your Claude account", err)
        self.assertEqual(self.S.read_skill("global"), "")

    def test_a_draft_never_writes_to_the_skill(self):
        with mock.patch.object(self.S, "user_claude_token", return_value="tok"), \
             mock.patch.object(self.S.subprocess, "run") as run:
            run.return_value = mock.Mock(returncode=0, stdout="RULE: Skip style nits.\nWHY: noise",
                                         stderr="")
            out, err = self.S.teach_finding(REPO, PR, USER, 1, "avoid", "draft")
        self.assertIsNone(err)
        self.assertEqual(out["rule"], "Skip style nits.")
        self.assertEqual(out["rationale"], "noise")
        self.assertEqual(self.S.read_skill("global"), "")

    def test_the_prompt_goes_over_stdin_not_argv(self):
        """A finding body is reviewer-sized; the explain path already hit ARG_MAX passing one
        as an argument."""
        with mock.patch.object(self.S, "user_claude_token", return_value="tok"), \
             mock.patch.object(self.S.subprocess, "run") as run:
            run.return_value = mock.Mock(returncode=0, stdout="RULE: Skip nits.\nWHY: noise",
                                         stderr="")
            self.S.teach_finding(REPO, PR, USER, 1, "avoid", "draft")
        args, kwargs = run.call_args
        self.assertIn("Use const instead of let", kwargs["input"])
        self.assertNotIn("Use const instead of let", " ".join(args[0]))

    def test_a_reply_that_is_not_a_rule_is_reported_rather_than_stored(self):
        with mock.patch.object(self.S, "user_claude_token", return_value="tok"), \
             mock.patch.object(self.S.subprocess, "run") as run:
            run.return_value = mock.Mock(returncode=0, stdout="I'm afraid I can't", stderr="")
            out, err = self.S.teach_finding(REPO, PR, USER, 1, "avoid", "draft")
        self.assertIsNone(out)
        self.assertIn("not with a rule", err)

    def test_adding_with_an_empty_rule_is_refused(self):
        _out, err = self.add(1, "   ")
        self.assertIn("Write the rule first", err)


class Payload(TeachCase):
    def test_a_taught_finding_is_flagged_in_the_page_payload(self):
        h = object.__new__(self.S.Handler)
        rev = self.S.load_review(REPO, PR, USER)
        before = h._review_data(REPO, PR, USER, rev, {})
        self.assertEqual([f["taught"] for f in before["findings"]], [False, False])
        self.add(1, "Do not comment on let versus const")
        after = h._review_data(REPO, PR, USER, rev, {})
        self.assertEqual([f["taught"] for f in after["findings"]], [False, True])


if __name__ == "__main__":
    unittest.main()


class TheRouteItself(TeachCase):
    """The seam the unit tests above cannot reach: the signed token, the dispatch, the JSON.

    Every cross-lane defect in this repo's history has lived in a seam like this one — a
    function that works, wired to a route that never calls it with the arguments it expects.
    """

    def post(self, body, action="teach"):
        S, out = self.S, {}
        h = object.__new__(S.Handler)
        h.headers = {"Cookie": f"rs_session={S.sign_session(USER)}"} \
            if hasattr(S, "sign_session") else {}
        h.reply = lambda status, payload, *a, **k: out.update(
            status=status, body=json.loads(payload))
        h.client_address = ("127.0.0.1", 1)
        exp, sig = S.mint(action, S.pr_subject(REPO, PR), 300)
        with mock.patch.object(S, "session_user", return_value=USER):
            h.api_post("/api/teach", {"repo": REPO, "pr": PR, "exp": exp, "sig": sig, **body})
        return out

    def test_a_valid_token_reaches_the_skill(self):
        out = self.post({"idx": 1, "direction": "avoid", "action": "add",
                         "rule": "Do not comment on let versus const"})
        self.assertEqual(out["status"], 200)
        self.assertTrue(out["body"]["added"])
        self.assertIn("let versus const", self.S.read_skill("global"))

    def test_a_token_for_another_action_is_refused_and_writes_nothing(self):
        out = self.post({"idx": 1, "direction": "avoid", "action": "add", "rule": "A rule"},
                        action="post")
        self.assertEqual(out["status"], 403)
        self.assertEqual(self.S.read_skill("global"), "")

    def test_an_unknown_client_action_is_refused(self):
        out = self.post({"idx": 1, "direction": "avoid", "action": "delete", "rule": "A rule"})
        self.assertEqual(out["status"], 400)
        self.assertIn("Unknown action", out["body"]["error"])

    def test_a_missing_index_is_a_400_not_a_500(self):
        out = self.post({"direction": "avoid", "action": "add", "rule": "A rule"})
        self.assertEqual(out["status"], 400)

    def test_the_page_hands_out_a_teach_token(self):
        h = object.__new__(self.S.Handler)
        self.assertIn("sig", h._tok("teach", REPO, PR))
