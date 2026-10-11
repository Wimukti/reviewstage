"""rs_disproof: which findings the second pass checks, the brief it is handed, the reading of
its answer (including malformed answers), the merge into review.json, and the CLI
run-disproof.sh calls (trust-and-plain §2.1).

    python3 -m unittest discover -s bin -p 'test_*.py'
"""
import ast
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import rs_disproof as D
import rs_review_schema as S

HERE = Path(__file__).resolve().parent


def review():
    return {"event": "COMMENT", "summary": "s", "comments": [
        {"path": "src/retry.ts", "line": 44, "end_line": 51, "severity": "blocker",
         "confidence": "high", "title": "The `retry()` loop never resets `attempts`",
         "impact": "The 6th call after a success is never made.",
         "what_to_check": "Open retry.ts lines 44-51. Check that `attempts` resets.",
         "expected": "attempts goes back to 0 after a 2xx.",
         "actual": "attempts keeps counting.", "body": "long body"},
        {"path": "src/retry.ts", "line": 80, "severity": "should-fix", "confidence": "medium",
         "title": "The timeout is never read", "body": "b"},
        {"path": "src/other.ts", "line": 3, "severity": "nit", "title": "Style", "body": "c"},
        {"path": "src/other.ts", "line": 9, "severity": "question", "title": "Why?", "body": "d"},
    ]}


class Selection(unittest.TestCase):
    def test_default_checks_breaks_and_can_break_only(self):
        self.assertEqual(D.select(review(), "default"), [0, 1])
        self.assertEqual(D.select(review(), ""), [0, 1])
        self.assertEqual(D.select(review(), "bogus"), [0, 1])

    def test_all_and_off(self):
        self.assertEqual(D.select(review(), "all"), [0, 1, 2, 3])
        self.assertEqual(D.select(review(), "off"), [])
        self.assertEqual(D.select({"comments": []}, "all"), [])

    def test_mode_folding(self):
        self.assertEqual(D.mode_of(" ALL "), "all")
        self.assertEqual(D.mode_of(None), "default")
        self.assertEqual(D.mode_of("off"), "off")

    def test_the_time_estimate_and_timeout(self):
        self.assertEqual(D.estimate_seconds(0), 0)
        self.assertEqual(D.estimate_seconds(3), 3 * D.SEC_PER_FINDING)
        self.assertEqual(D.timeout_seconds(0), D.MIN_TIMEOUT_S)
        self.assertEqual(D.timeout_seconds(100), D.MAX_TIMEOUT_S)


class TheBrief(unittest.TestCase):
    def test_it_carries_the_plain_rows_and_never_the_body(self):
        rev, _ = S.normalize(review())
        text = D.brief(rev, [0, 1], "acme/widgets", "7")
        self.assertIn("PR #7 of acme/widgets", text)
        self.assertIn("id: 0", text)
        self.assertIn("severity: breaks", text)
        self.assertIn("where: src/retry.ts:44-51", text)
        self.assertIn("what to check: Open retry.ts lines 44-51.", text)
        self.assertIn("expected: attempts goes back to 0 after a 2xx.", text)
        self.assertIn("severity: can break", text)
        self.assertIn("where: src/retry.ts:80", text)
        self.assertNotIn("long body", text)
        self.assertNotIn("id: 2", text)
        # The files to read, once each, and the output contract.
        self.assertEqual(text.count("  - src/retry.ts"), 1)
        self.assertIn("./disproof.json", text)
        self.assertIn('"verdict":"stands|weakened|refuted"', text)
        self.assertIn("Do NOT post anything", text)


class Parsing(unittest.TestCase):
    def test_a_clean_answer(self):
        out = D.parse({"results": [{"id": 0, "verdict": "stands", "reason": "No reset found."},
                                   {"id": 1, "verdict": "refuted",
                                    "reason": "`timeout` is read at retry.ts:12."}]}, [0, 1])
        self.assertEqual(out, {0: {"verdict": "stands", "reason": "No reset found."},
                               1: {"verdict": "refuted",
                                   "reason": "`timeout` is read at retry.ts:12."}})

    def test_tolerance_string_ids_odd_case_bare_list_and_text(self):
        w = []
        out = D.parse('[{"id":"1","verdict":" Weakened.","reason":"x"}]', [0, 1], w)
        self.assertEqual(out, {1: {"verdict": "weakened", "reason": "x"}})
        self.assertEqual(w, [])
        out = D.parse(b'{"findings":[{"i":0,"verdict":"STANDS"}]}', [0])
        self.assertEqual(out, {0: {"verdict": "stands", "reason": ""}})

    def test_prose_around_the_object_is_tolerated(self):
        text = 'Here you go:\n```json\n{"results":[{"id":0,"verdict":"stands","reason":"r"}]}\n```'
        self.assertEqual(D.parse(text, [0]), {0: {"verdict": "stands", "reason": "r"}})

    def test_malformed_answers_are_skipped_never_raised(self):
        w = []
        self.assertEqual(D.parse("not json at all", [0], w), {})
        self.assertIn("disproof: output is not JSON", w)
        w = []
        self.assertEqual(D.parse({"results": "nope"}, [0], w), {})
        self.assertIn("disproof: no results array", w)
        w = []
        out = D.parse({"results": [
            "a string", {"id": "x", "verdict": "stands"}, {"id": 7, "verdict": "stands"},
            {"id": 0, "verdict": "maybe"}, {"id": 1, "verdict": "stands", "reason": "ok"}]},
            [0, 1], w)
        self.assertEqual(out, {1: {"verdict": "stands", "reason": "ok"}})
        self.assertEqual(len(w), 4)
        self.assertTrue(any("not an object" in x for x in w))
        self.assertTrue(any("is not a number" in x for x in w))
        self.assertTrue(any("was not asked for" in x for x in w))
        self.assertTrue(any("is not one of stands|weakened|refuted" in x for x in w))
        self.assertEqual(D.parse(None, [0]), {})
        self.assertEqual(D.parse(42, [0]), {})

    def test_the_reason_is_one_sentence_of_at_most_twenty_words(self):
        long = " ".join(f"w{i}" for i in range(40)) + ". Second sentence here."
        out = D.parse({"results": [{"id": 0, "verdict": "stands", "reason": long}]}, [0])
        r = out[0]["reason"]
        self.assertTrue(r.endswith("…"))
        self.assertEqual(len(r.rstrip("…").split()), D.REASON_WORDS)
        two = D.parse({"results": [{"id": 0, "verdict": "stands",
                                    "reason": "First one.  Second\none."}]}, [0])
        self.assertEqual(two[0]["reason"], "First one.")


class Merging(unittest.TestCase):
    def test_verdicts_land_on_the_findings_and_the_review_keeps_the_record(self):
        rev, _ = S.normalize(review())
        counts = D.merge(rev, {0: {"verdict": "stands", "reason": "r0"},
                               1: {"verdict": "weakened", "reason": "r1"}}, [0, 1],
                         mode="default", status="done", duration_ms=4321, at=1700000000)
        self.assertEqual(counts, {"stands": 1, "weakened": 1, "refuted": 0, "failed": 0})
        self.assertEqual(rev["comments"][0]["checked"],
                         {"verdict": "stands", "reason": "r0", "at": 1700000000})
        self.assertEqual(rev["comments"][1]["checked"]["verdict"], "weakened")
        self.assertIsNone(rev["comments"][2]["checked"])        # not asked about
        self.assertEqual(rev["disproof"], {"status": "done", "n": 2, "checked": 2,
                                           "duration_ms": 4321, "mode": "default"})
        # It survives the normaliser: what the server loads is what was written.
        again, w = S.normalize(json.loads(json.dumps(rev)))
        self.assertEqual(again["comments"][0]["checked"]["verdict"], "stands")
        self.assertEqual(again["disproof"]["n"], 2)
        self.assertEqual(w, [])

    def test_a_missing_answer_is_a_failed_finding_and_a_partial_pass(self):
        rev, _ = S.normalize(review())
        counts = D.merge(rev, {0: {"verdict": "refuted", "reason": "r"}}, [0, 1])
        self.assertEqual(counts["failed"], 1)
        self.assertEqual(counts["refuted"], 1)
        self.assertIsNone(rev["comments"][1]["checked"])
        self.assertEqual(rev["disproof"]["status"], "partial")
        rev2, _ = S.normalize(review())
        self.assertEqual(D.merge(rev2, {}, [0, 1])["failed"], 2)
        self.assertEqual(rev2["disproof"]["status"], "failed")

    def test_a_timeout_or_skip_is_recorded_as_such(self):
        rev, _ = S.normalize(review())
        D.merge(rev, {}, [0, 1], status="timeout", duration_ms=300000)
        self.assertEqual(rev["disproof"]["status"], "timeout")
        rev, _ = S.normalize(review())
        D.merge(rev, {}, [], status="skipped")
        self.assertEqual(rev["disproof"], {"status": "skipped", "n": 0, "checked": 0,
                                           "duration_ms": 0, "mode": "default"})

    def test_the_normaliser_drops_a_malformed_checked_object(self):
        rev, w = S.normalize({"comments": [
            {"path": "a", "line": 1, "severity": "nit", "body": "b",
             "checked": {"verdict": "maybe", "reason": "x"}},
            {"path": "a", "line": 2, "severity": "nit", "body": "b", "checked": "stands"},
            {"path": "a", "line": 3, "severity": "nit", "body": "b",
             "checked": {"verdict": "Refuted", "reason": "  two   spaces ", "at": "nope"}}],
            "disproof": {"status": "done", "n": "3", "checked": None, "duration_ms": -5}})
        self.assertIsNone(rev["comments"][0]["checked"])
        self.assertIsNone(rev["comments"][1]["checked"])
        self.assertEqual(rev["comments"][2]["checked"],
                         {"verdict": "refuted", "reason": "two spaces", "at": 0})
        self.assertEqual(rev["disproof"], {"status": "done", "n": 3, "checked": 0,
                                           "duration_ms": 0, "mode": "default"})
        self.assertEqual(len(w), 2)
        self.assertIsNone(S.normalize({"comments": []})[0]["disproof"])


class TheCli(unittest.TestCase):
    def run_cli(self, *args, env=None):
        import os
        return subprocess.run([sys.executable, str(HERE / "rs_disproof.py"), *args],
                              capture_output=True, text=True,
                              env={**os.environ, "PYTHONPATH": str(HERE), **(env or {})})

    def test_select_then_merge_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            rp = Path(tmp, "review.json")
            rp.write_text(json.dumps(review()))
            r = self.run_cli("select", str(rp), "default", env={"RS_REPO": "acme/widgets",
                                                                 "RS_PR": "7"})
            self.assertEqual(r.returncode, 0, r.stderr)
            sel = json.loads(r.stdout)
            self.assertEqual(sel["indices"], [0, 1])
            self.assertEqual(sel["n"], 2)
            self.assertIn("PR #7 of acme/widgets", sel["prompt"])
            self.assertEqual(sel["timeout_s"], D.timeout_seconds(2))
            raw = Path(tmp, "disproof.json")
            raw.write_text(json.dumps({"results": [
                {"id": 0, "verdict": "stands", "reason": "No reset."},
                {"id": 1, "verdict": "bogus"}]}))
            r = self.run_cli("merge", str(rp), str(raw), "default", "done", "1234", "0,1")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(r.stdout.strip(), "stands=1 weakened=0 refuted=0 failed=1")
            self.assertIn("is not one of", r.stderr)
            out = json.loads(rp.read_text())
            self.assertEqual(out["comments"][0]["checked"]["verdict"], "stands")
            self.assertIsNone(out["comments"][1]["checked"])
            self.assertEqual(out["disproof"]["status"], "partial")
            self.assertEqual(out["disproof"]["duration_ms"], 1234)

    def test_merge_with_a_failed_status_needs_no_answer_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            rp = Path(tmp, "review.json")
            rp.write_text(json.dumps(review()))
            r = self.run_cli("merge", str(rp), str(Path(tmp, "missing.json")), "all", "failed",
                             "0")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(r.stdout.strip(), "stands=0 weakened=0 refuted=0 failed=4")
            out = json.loads(rp.read_text())
            self.assertEqual(out["disproof"], {"status": "failed", "n": 4, "checked": 0,
                                               "duration_ms": 0, "mode": "all"})

    def test_an_empty_selection_prints_no_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            rp = Path(tmp, "review.json")
            rp.write_text(json.dumps({"comments": [{"path": "a", "line": 1, "severity": "nit",
                                                     "body": "b"}]}))
            sel = json.loads(self.run_cli("select", str(rp), "default").stdout)
            self.assertEqual(sel, {"indices": [], "n": 0, "timeout_s": D.MIN_TIMEOUT_S,
                                   "prompt": ""})


class ImportsStayLocal(unittest.TestCase):
    def test_the_module_imports_only_the_standard_library(self):
        tree = ast.parse((HERE / "rs_disproof.py").read_text())
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom):
                names.add((node.module or "").split(".")[0])
        self.assertEqual(names, {"json", "os", "re", "sys", "time", "rs_review_schema"})


if __name__ == "__main__":
    unittest.main()
