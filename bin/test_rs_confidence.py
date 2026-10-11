"""rs_confidence: the three-level badge (trust-and-plain/design.md Part 2), every row of the
rule table, the evidence states, and the reason-line wording.

    python3 -m unittest discover -s bin -p 'test_*.py'
"""
import ast
import unittest
from pathlib import Path

import rs_confidence as C

HERE = Path(__file__).resolve().parent

PASS = {"status": "pass", "flags": [], "line": "The cited lines are in this diff and mention "
        "`attempts`.", "symbols": ["attempts"]}
PASS_PLAIN = {"status": "pass", "flags": [], "line": "The cited lines are in this diff.",
              "symbols": []}
WARN_LINES = {"status": "warn", "flags": ["lines_not_in_diff"],
              "line": "Lines 80 are not in this PR's changes to `Retry.php`.", "symbols": []}
WARN_SYMBOL = {"status": "warn", "flags": ["symbol_not_found"],
               "line": "`maxAttempts` does not appear in the cited lines.", "symbols": []}
WARN_TWO = {"status": "warn", "flags": ["path_not_in_diff", "no_contrast"],
            "line": "`Nope.php` is not a file this PR changes. A blocker needs both Expected "
                    "and Actual.", "symbols": []}
OFF_DIFF = {"status": "warn", "flags": ["path_not_in_diff"],
            "line": "`src/javascripts/Badge.tsx` is not a file this PR changes.", "symbols": []}
STANDS = {"verdict": "stands", "reason": "No reset of `attempts` after a 2xx anywhere.", "at": 1}
WEAK = {"verdict": "weakened", "reason": "Only the 6th call is lost, not every retry.", "at": 1}
REFUTED = {"verdict": "refuted", "reason": "`resetAttempts()` at retry.ts:71 runs after a 2xx.",
           "at": 1}
GOOD = {"keepRate": 85.0, "n": 30, "usable": True}
MID = {"keepRate": 55.0, "n": 30, "usable": True}
BAD = {"keepRate": 30.0, "n": 30, "usable": True}
SMALL = {"keepRate": 100.0, "n": 5, "usable": False}
DONE = {"status": "done", "n": 2, "checked": 2, "duration_ms": 1000, "mode": "default"}


class EvidenceState(unittest.TestCase):
    def test_pass_warn_and_not_checked(self):
        self.assertEqual(C.evidence_state(PASS), "pass")
        self.assertEqual(C.evidence_state(WARN_LINES), "warn")
        self.assertEqual(C.evidence_state(WARN_TWO), "warn")
        self.assertEqual(C.evidence_state(None), "none")           # GitHub gave no diff
        self.assertEqual(C.evidence_state({"status": "bogus"}), "none")

    def test_a_lone_off_diff_flag_is_not_checked_rather_than_a_warning(self):
        # lane1-plain.md: a finding on a file outside the diff is legitimate and only
        # un-checkable; it cannot earn Checked and it does not fall to Maybe.
        self.assertEqual(C.evidence_state(OFF_DIFF), "none")
        self.assertEqual(C.badge(OFF_DIFF)["level"], "likely")
        self.assertEqual(C.badge(OFF_DIFF, STANDS)["level"], "likely")


class RuleTable(unittest.TestCase):
    """Every row of the design's table, plus the gaps between rows."""

    def level(self, *a, **k):
        return C.badge(*a, **k)["level"]

    # --- Checked -----------------------------------------------------------------------------
    def test_checked_needs_pass_and_stands(self):
        self.assertEqual(self.level(PASS, STANDS), "checked")
        self.assertEqual(self.level(PASS, STANDS, None), "checked")       # no calibration yet

    def test_checked_with_a_calibrated_bucket_at_or_over_70(self):
        self.assertEqual(self.level(PASS, STANDS, GOOD), "checked")
        self.assertEqual(self.level(PASS, STANDS, {"keepRate": 70.0, "n": 20, "usable": True}),
                         "checked")

    def test_a_small_or_unusable_bucket_does_not_count(self):
        self.assertEqual(self.level(PASS, STANDS, SMALL), "checked")
        self.assertEqual(self.level(PASS, STANDS, {"keepRate": 10.0, "n": 50, "usable": False}),
                         "checked")
        self.assertEqual(self.level(PASS, None, {"keepRate": 10.0, "n": 50, "usable": False}),
                         "likely")

    # --- Likely ------------------------------------------------------------------------------
    def test_likely_pass_and_no_verdict(self):
        self.assertEqual(self.level(PASS), "likely")
        self.assertEqual(self.level(PASS, None, None, DONE), "likely")

    def test_likely_pass_and_weakened(self):
        self.assertEqual(self.level(PASS, WEAK), "likely")
        self.assertEqual(self.level(PASS, WEAK, GOOD), "likely")          # weakened never Checked

    def test_likely_when_stands_but_the_keep_rate_is_between_40_and_70(self):
        self.assertEqual(self.level(PASS, STANDS, MID), "likely")
        self.assertEqual(self.level(PASS, STANDS, {"keepRate": 69.9, "n": 20, "usable": True}),
                         "likely")

    def test_likely_when_the_evidence_could_not_be_checked(self):
        self.assertEqual(self.level(None), "likely")
        self.assertEqual(self.level(None, STANDS), "likely")               # None is not PASS
        self.assertEqual(self.level(None, STANDS, GOOD), "likely")

    # --- Maybe -------------------------------------------------------------------------------
    def test_maybe_on_any_evidence_warning(self):
        for ev in (WARN_LINES, WARN_SYMBOL, WARN_TWO):
            self.assertEqual(self.level(ev), "maybe", ev["flags"])
            self.assertEqual(self.level(ev, STANDS, GOOD), "maybe", ev["flags"])

    def test_maybe_on_refuted(self):
        self.assertEqual(self.level(PASS, REFUTED), "maybe")
        self.assertEqual(self.level(PASS, REFUTED, GOOD), "maybe")
        self.assertEqual(self.level(None, REFUTED), "maybe")

    def test_maybe_on_a_keep_rate_under_40(self):
        self.assertEqual(self.level(PASS, STANDS, BAD), "maybe")
        self.assertEqual(self.level(PASS, None, {"keepRate": 39.9, "n": 20, "usable": True}),
                         "maybe")
        self.assertEqual(self.level(PASS, None, {"keepRate": 40.0, "n": 20, "usable": True}),
                         "likely")

    def test_is_maybe_is_the_tray_signal(self):
        self.assertTrue(C.is_maybe(C.badge(WARN_LINES)))
        self.assertFalse(C.is_maybe(C.badge(PASS)))
        self.assertFalse(C.is_maybe(None))


class ReasonLine(unittest.TestCase):
    """The reason is the card's one verdict row: the badge word, the verdict, the second pass's
    sentence, the calibration clause. It never restates the Evidence row above it."""

    def test_checked_is_the_verdict_then_the_second_pass_then_calibration(self):
        b = C.badge(PASS, STANDS, GOOD)
        self.assertEqual(b["label"], "Checked")
        self.assertEqual(b["reason"], "Checked: Stands. No reset of `attempts` after a 2xx "
                                      "anywhere. Reviewers kept 85.0% of findings like this here.")
        self.assertEqual(b["inputs"], {"evidence": "pass", "disproof": "stands",
                                       "keepRate": 85.0, "n": 30})
        self.assertEqual(C.badge(PASS, STANDS)["reason"],
                         "Checked: Stands. No reset of `attempts` after a 2xx anywhere.")

    def test_the_reason_never_repeats_the_evidence_row(self):
        for ev in (PASS, PASS_PLAIN, OFF_DIFF):
            for chk in (STANDS, WEAK, None):
                self.assertNotIn("cited lines", C.badge(ev, chk, None, DONE)["reason"])
                self.assertNotIn("outside this diff", C.badge(ev, chk, None, DONE)["reason"])

    def test_maybe_quotes_the_evidence_note(self):
        self.assertEqual(C.badge(WARN_LINES)["reason"],
                         "Maybe: Lines 80 are not in this PR's changes to `Retry.php`.")
        self.assertEqual(C.badge(WARN_SYMBOL)["reason"],
                         "Maybe: `maxAttempts` does not appear in the cited lines.")
        self.assertEqual(C.badge(WARN_TWO, None, None, DONE)["reason"],
                         "Maybe: `Nope.php` is not a file this PR changes. A blocker needs both "
                         "Expected and Actual.")

    def test_refuted_and_weakened_carry_the_second_pass_sentence(self):
        self.assertEqual(C.badge(PASS, REFUTED)["reason"],
                         "Maybe: Refuted. `resetAttempts()` at retry.ts:71 runs after a 2xx.")
        self.assertEqual(C.badge(PASS_PLAIN, WEAK)["reason"],
                         "Likely: Weakened. Only the 6th call is lost, not every retry.")
        self.assertEqual(C.badge(PASS_PLAIN, {**WEAK, "reason": ""})["reason"], "Likely: Weakened.")

    def test_no_verdict_says_why(self):
        self.assertEqual(C.badge(PASS_PLAIN)["reason"], "Likely: No second pass ran.")
        self.assertEqual(C.badge(PASS_PLAIN, None, None, DONE)["reason"],
                         "Likely: No second pass for this severity.")
        self.assertEqual(C.badge(PASS_PLAIN, None, None, {**DONE, "status": "failed"})["reason"],
                         "Likely: The second pass failed.")
        self.assertEqual(C.badge(None)["reason"],
                         "Likely: The diff could not be checked. No second pass ran.")
        self.assertEqual(C.badge(OFF_DIFF, None, None, DONE)["reason"],
                         "Likely: No second pass for this severity.")
        self.assertEqual(C.badge(PASS_PLAIN, None, MID, DONE)["reason"],
                         "Likely: No second pass for this severity. Reviewers kept 55.0% of "
                         "findings like this here.")

    def test_the_self_report_is_not_an_input(self):
        # design §2.3: the model's confidence steers the tray before other signals exist, but
        # the badge never reads it — the function has no parameter for it.
        import inspect
        self.assertNotIn("confidence", inspect.signature(C.badge).parameters)


class ImportsStayLocal(unittest.TestCase):
    def test_the_module_imports_only_the_standard_library(self):
        tree = ast.parse((HERE / "rs_confidence.py").read_text())
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom):
                names.add((node.module or "").split(".")[0])
        self.assertEqual(names, {"json", "sys", "rs_review_schema"})


if __name__ == "__main__":
    unittest.main()
