"""rs_review_schema: every finding gets one reading, and no review is ever rejected.

    python3 -m unittest discover -s bin -p 'test_*.py'
"""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import rs_review_schema as S

HERE = Path(__file__).resolve().parent

NEW = {"event": "COMMENT", "summary": "Two things.", "comments": [
    {"path": "app/models/Product.php", "line": 42, "severity": "should-fix",
     "title": " A product with no vendor can crash the badge ",
     "impact": "A shopper sees the card fail.",
     "how_to_verify": "Open a product whose vendor is null; the badge throws.",
     "body": "Guard the null.", "reply_to": None, "suggestion": None, "confidence": "high"}]}

OLD = {"event": "COMMENT", "summary": "One nit.", "comments": [
    {"path": "a.py", "line": "7", "severity": "nit", "body": "Prefer const.",
     "reply_to": None, "suggestion": ""}]}


class NewShape(unittest.TestCase):
    def test_a_contract_finding_passes_through_trimmed_with_no_warnings(self):
        rev, warnings = S.normalize(copy.deepcopy(NEW))
        self.assertEqual(warnings, [])
        c = rev["comments"][0]
        self.assertEqual(c["title"], "A product with no vendor can crash the badge")
        self.assertEqual(c["impact"], "A shopper sees the card fail.")
        self.assertEqual(c["how_to_verify"], "Open a product whose vendor is null; the badge throws.")
        self.assertEqual(c["confidence"], "high")
        self.assertEqual(c["severity"], "should-fix")
        # Untouched fields are untouched.
        self.assertEqual(c["body"], "Guard the null.")
        self.assertEqual(c["line"], 42)

    def test_normalising_twice_is_the_same_as_once(self):
        once, _ = S.normalize(copy.deepcopy(NEW))
        twice, w = S.normalize(copy.deepcopy(once))
        self.assertEqual(once, twice)
        self.assertEqual(w, [])


class OldShape(unittest.TestCase):
    def test_an_old_run_gets_nulls_for_the_fields_it_never_had_and_no_warning(self):
        rev, warnings = S.normalize(copy.deepcopy(OLD))
        self.assertEqual(warnings, [])
        c = rev["comments"][0]
        self.assertIsNone(c["title"])
        self.assertIsNone(c["impact"])
        self.assertIsNone(c["how_to_verify"])
        self.assertIsNone(c["confidence"])          # never stated → not invented
        self.assertEqual(c["severity"], "nit")
        self.assertEqual(c["body"], "Prefer const.")

    def test_a_review_without_comments_gains_an_empty_array(self):
        rev, warnings = S.normalize({"summary": "LGTM"})
        self.assertEqual(rev["comments"], [])
        self.assertEqual(warnings, [])


class Synonyms(unittest.TestCase):
    def test_why_it_matters_fills_impact(self):
        rev, w = S.normalize({"comments": [{"severity": "nit", "why_it_matters": "Users wait."}]})
        self.assertEqual(rev["comments"][0]["impact"], "Users wait.")
        self.assertEqual(w, [])

    def test_impact_wins_when_both_are_present(self):
        rev, _ = S.normalize({"comments": [{"impact": "A.", "why_it_matters": "B."}]})
        self.assertEqual(rev["comments"][0]["impact"], "A.")

    def test_camel_case_how_to_verify_is_accepted(self):
        rev, _ = S.normalize({"comments": [{"howToVerify": "Run pytest -k badge."}]})
        self.assertEqual(rev["comments"][0]["how_to_verify"], "Run pytest -k badge.")


class Vocabularies(unittest.TestCase):
    def test_unknown_severity_becomes_nit_with_a_warning(self):
        rev, w = S.normalize({"comments": [{"severity": "critical"}]})
        self.assertEqual(rev["comments"][0]["severity"], "nit")
        self.assertEqual(len(w), 1)
        self.assertIn("severity 'critical'", w[0])

    def test_missing_severity_is_nit_without_a_warning(self):
        rev, w = S.normalize({"comments": [{"body": "x"}]})
        self.assertEqual(rev["comments"][0]["severity"], "nit")
        self.assertEqual(w, [])

    def test_case_and_spelling_variants_of_the_vocabulary_are_folded(self):
        rev, w = S.normalize({"comments": [{"severity": "Should_Fix", "confidence": "HIGH"}]})
        self.assertEqual(rev["comments"][0]["severity"], "should-fix")
        self.assertEqual(rev["comments"][0]["confidence"], "high")
        self.assertEqual(w, [])

    def test_unknown_confidence_becomes_medium_with_a_warning(self):
        rev, w = S.normalize({"comments": [{"confidence": "certain"}]})
        self.assertEqual(rev["comments"][0]["confidence"], "medium")
        self.assertIn("confidence 'certain'", w[0])


class HowToVerify(unittest.TestCase):
    def test_a_multi_line_value_is_dropped_with_a_warning(self):
        rev, w = S.normalize({"comments": [{"how_to_verify": "Run it.\nThen look."}]})
        self.assertIsNone(rev["comments"][0]["how_to_verify"])
        self.assertIn("not a single line", w[0])

    def test_a_value_over_the_cap_is_dropped_with_a_warning(self):
        rev, w = S.normalize({"comments": [{"how_to_verify": "x" * (S.VERIFY_CAP + 1)}]})
        self.assertIsNone(rev["comments"][0]["how_to_verify"])
        self.assertIn(f"cap {S.VERIFY_CAP}", w[0])

    def test_exactly_the_cap_is_kept(self):
        rev, w = S.normalize({"comments": [{"how_to_verify": "y" * S.VERIFY_CAP}]})
        self.assertEqual(len(rev["comments"][0]["how_to_verify"]), S.VERIFY_CAP)
        self.assertEqual(w, [])

    def test_whitespace_only_is_null(self):
        rev, _ = S.normalize({"comments": [{"how_to_verify": "   "}]})
        self.assertIsNone(rev["comments"][0]["how_to_verify"])


class Garbage(unittest.TestCase):
    """Nothing here may raise; the review step and the page both call this on untrusted output."""

    def test_none_and_scalars_come_back_untouched(self):
        for junk in (None, 3, "a string", True, [1, 2]):
            out, w = S.normalize(junk)
            self.assertEqual(out, junk)
            self.assertEqual(len(w), 1)

    def test_comments_that_are_not_an_array_become_an_empty_array(self):
        rev, w = S.normalize({"comments": {"path": "a"}})
        self.assertEqual(rev["comments"], [])
        self.assertIn("comments is not an array", w[0])

    def test_a_comment_that_is_not_an_object_becomes_a_bare_finding(self):
        rev, w = S.normalize({"comments": ["just a sentence", 7, None]})
        self.assertEqual(len(rev["comments"]), 3)
        self.assertEqual(rev["comments"][0]["body"], "just a sentence")
        self.assertEqual(rev["comments"][0]["severity"], "nit")
        self.assertEqual(len(w), 3)

    def test_wrong_types_in_text_fields_are_null_not_errors(self):
        rev, _ = S.normalize({"comments": [{"title": ["a"], "impact": {"x": 1},
                                            "how_to_verify": False, "confidence": 1,
                                            "severity": {"k": "v"}}]})
        c = rev["comments"][0]
        self.assertIsNone(c["title"])
        self.assertIsNone(c["impact"])
        self.assertIsNone(c["how_to_verify"])
        self.assertEqual(c["severity"], "nit")


class TheCli(unittest.TestCase):
    """What run-review.sh calls: rewrite the file in place, warnings on stderr, exit 0."""

    def run_cli(self, path):
        return subprocess.run([sys.executable, str(HERE / "rs_review_schema.py"), str(path)],
                              capture_output=True, text=True)

    def test_rewrites_in_place_and_reports_on_stderr(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "review.json"
            p.write_text(json.dumps({"comments": [{"severity": "major",
                                                   "how_to_verify": "a\nb"}]}))
            r = self.run_cli(p)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("[review-schema] finding 0: severity 'major'", r.stderr)
            self.assertIn("[review-schema] finding 0: how_to_verify is not a single line", r.stderr)
            out = json.loads(p.read_text())
            self.assertEqual(out["comments"][0]["severity"], "nit")
            self.assertIsNone(out["comments"][0]["how_to_verify"])
            self.assertFalse(os.path.exists(str(p) + ".norm"))

    def test_a_file_that_is_not_json_is_left_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "review.json"
            p.write_text("not json")
            r = self.run_cli(p)
            self.assertEqual(r.returncode, 0)
            self.assertIn("could not read", r.stderr)
            self.assertEqual(p.read_text(), "not json")

    def test_imports_nothing_that_could_reach_github(self):
        # Property 1: the review step has no GitHub write path, and this module runs inside it.
        imports = [ln.strip() for ln in (HERE / "rs_review_schema.py").read_text().splitlines()
                   if ln.startswith(("import ", "from "))]
        self.assertEqual(sorted(imports), ["import json", "import os", "import sys"])

if __name__ == "__main__":
    unittest.main()
