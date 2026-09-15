#!/usr/bin/env python3
"""Unit tests for cross-review convergence (bin/rs_agree.py).

The "confirmed by an independent run" badge is shown to a reviewer as evidence, so the tests
that matter are the two error directions: confirming things that are not the same concern, and
refusing to confirm things that plainly are. Both were real, and both are covered here with the
worked examples from the audit.
Run: python3 -m unittest bin.test_rs_agree"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rs_agree as A  # noqa: E402

NULLCHECK = ("This dereferences `order` without checking it is non-null; a cancelled order "
             "reaches this branch with order == null and the request 500s.")
NULLCHECK2 = ("`order` is dereferenced with no null check here — a cancelled order arrives "
              "null and the handler throws a 500 instead of a 404.")
TYPO = "Typo: recieve."


def c(path="app/Order.php", line=40, severity="blocker", body=NULLCHECK):
    return {"path": path, "line": line, "severity": severity, "body": body}


def run(login, comments, skill="global", model="opus", effort="standard"):
    return {"login": login, "skill": skill, "model": model, "effort": effort,
            "comments": comments}


class OverConfirmation(unittest.TestCase):
    def test_a_typo_does_not_confirm_a_null_check_six_lines_away(self):
        # A one-word body has no significant vocabulary, so the old matcher fell through to a
        # purely structural match: same file, severities collapsed to one bucket, within six
        # lines — "confirmed".
        self.assertFalse(A._match(c(), c(line=46, severity="should-fix", body="Typo.")))

    def test_a_body_too_thin_to_judge_is_never_a_match(self):
        self.assertFalse(A._match(c(body="Fix."), c(body="Fix.")))
        self.assertFalse(A._match(c(), c(body="?")))

    def test_a_blocker_and_a_should_fix_need_the_same_line_not_just_the_same_bucket(self):
        near = c(line=44, severity="should-fix", body=NULLCHECK2)
        self.assertFalse(A._match(c(line=40, severity="blocker"), near))
        same = c(line=40, severity="should-fix", body=NULLCHECK2)
        self.assertTrue(A._match(c(line=40, severity="blocker"), same))

    def test_the_same_severity_still_tolerates_a_small_line_drift(self):
        self.assertTrue(A._match(c(line=40), c(line=44, body=NULLCHECK2)))
        self.assertFalse(A._match(c(line=40), c(line=60, body=NULLCHECK2)))

    def test_a_different_file_is_never_the_same_concern(self):
        self.assertFalse(A._match(c(), c(path="app/Invoice.php")))

    def test_two_thin_findings_do_not_inflate_the_pr_agreement_rate(self):
        runs = [run("ana", [c(body="Fix.")]), run("bo", [c(body="Fix.")], model="sonnet")]
        self.assertEqual(A.rate(A.cluster(runs))["confirmed"], 0)


class UnderConfirmation(unittest.TestCase):
    def test_two_identical_file_level_findings_confirm_each_other(self):
        a, b = c(line=None), c(line=None)
        self.assertTrue(A._match(a, b))

    def test_file_level_findings_still_need_token_overlap(self):
        self.assertFalse(A._match(c(line=None), c(line=None, body=TYPO)))

    def test_a_file_level_finding_does_not_match_an_anchored_one(self):
        self.assertFalse(A._match(c(line=None), c(line=40)))

    def test_file_level_agreement_is_counted_as_independent_confirmation(self):
        runs = [run("ana", [c(line=None)]),
                run("bo", [c(line=None, body=NULLCHECK2)], model="sonnet")]
        clusters = A.cluster(runs)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]["n_independent"], 2)
        self.assertEqual(A.rate(clusters), {"rate": 100.0, "confirmed": 1, "total": 1})


class Independence(unittest.TestCase):
    def test_two_runs_with_the_same_config_are_one_unit(self):
        runs = [run("ana", [c()]), run("bo", [c(body=NULLCHECK2)])]
        clusters = A.cluster(runs)
        self.assertEqual(clusters[0]["n_independent"], 1)
        self.assertEqual(A.rate(clusters)["confirmed"], 0)

    def test_a_different_model_makes_the_confirmation_independent(self):
        runs = [run("ana", [c()]), run("bo", [c(body=NULLCHECK2)], model="sonnet")]
        clusters = A.cluster(runs)
        tags = A.tags_for(0, runs, clusters)
        tag = next(iter(tags.values()))
        self.assertTrue(tag["confirmed"])
        self.assertEqual(tag["differ"], "different models")
        self.assertEqual(tag["by"], ["bo"])

    def test_an_unconfirmed_finding_is_tagged_as_such(self):
        runs = [run("ana", [c(), c(path="app/Invoice.php", body=TYPO + " Another sentence "
                                                                   "about spelling mistakes.")]),
                run("bo", [c(body=NULLCHECK2)], model="sonnet")]
        tags = A.tags_for(0, runs, A.cluster(runs))
        self.assertEqual(sorted(t["confirmed"] for t in tags.values()), [False, True])

    def test_no_runs_means_no_rate(self):
        self.assertEqual(A.rate([]), {"rate": None, "confirmed": 0, "total": 0})


if __name__ == "__main__":
    unittest.main()
