"""rs_evidence: the deterministic evidence check and the inline snippet (trust-and-plain §1.4).

    python3 -m unittest discover -s bin -p 'test_*.py'
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import rs_evidence as E
import rs_review_schema as S

HERE = Path(__file__).resolve().parent

PATCH = ("@@ -14,9 +14,24 @@ import { backoffMs, MAX_ATTEMPTS } from \"./backoff\";\n"
         " import { DeliveryError } from \"./errors\";\n"
         " \n"
         " export async function deliver(hook: Webhook, payload: Payload): Promise<void> {\n"
         "-  const res = await fetch(hook.url, { method: \"POST\" });\n"
         "-  if (!res.ok) throw new DeliveryError(res.status);\n"
         "+  let attempt = 0;\n"
         "+  while (true) {\n"
         "+    const res = await fetch(hook.url, {\n"
         "+      method: \"POST\",\n"
         "+      body: JSON.stringify(payload),\n"
         "+    });\n"
         "+    if (res.ok) return;\n"
         "+    attempt += 1;\n"
         "+    if (attempt >= MAX_ATTEMPTS) throw new DeliveryError(res.status, attempt);\n"
         "+    await sleep(backoffMs(attempt));\n"
         "+  }\n"
         " }\n"
         "+\n"
         "+const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));\n")
# New-file numbering: 14 import, 15 blank, 16 export, 17 let attempt, 18 while, 19 const res,
# 20 method, 21 body, 22 }), 23 if ok, 24 attempt += 1, 25 if attempt >=, 26 await sleep, 27 },
# 28 }, 29 blank, 30 const sleep.
FILES = [{"filename": "src/webhooks/deliver.ts", "status": "modified", "patch": PATCH},
         {"filename": "src/webhooks/big.bin", "status": "modified"}]        # patch withheld
PATCHES = E.patches_of(FILES)


def finding(**kw):
    base = {"path": "src/webhooks/deliver.ts", "line": 23, "severity": "should-fix",
            "title": "Every non-2xx is retried, even when `res.ok` can never become true",
            "what_to_check": "Open deliver.ts line 23. Check which statuses return early.",
            "expected": "A 404 stops after one request.", "actual": "A 404 costs five requests."}
    base.update(kw)
    c, _ = S.normalize({"comments": [base]})
    return c["comments"][0]


class TheHunks(unittest.TestCase):
    def test_lines_are_numbered_on_the_new_side_and_tagged(self):
        lines = E.new_lines(PATCH)
        self.assertEqual(lines[17], "  let attempt = 0;")
        self.assertEqual(lines[23], "    if (res.ok) return;")
        self.assertEqual(lines[30], "const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));")
        self.assertNotIn(31, lines)
        kinds = [r["kind"] for r in E.hunks(PATCH)[0]]
        self.assertEqual(kinds.count("del"), 2)
        self.assertEqual(kinds[0], "ctx")
        self.assertEqual(kinds[5], "add")

    def test_patches_of_keeps_a_withheld_patch_as_none(self):
        self.assertEqual(set(PATCHES), {"src/webhooks/deliver.ts", "src/webhooks/big.bin"})
        self.assertIsNone(PATCHES["src/webhooks/big.bin"])
        self.assertEqual(E.patches_of(None), {})
        self.assertEqual(E.patches_of([{"no": "filename"}, "junk"]), {})


class TheSnippet(unittest.TestCase):
    def test_eight_to_twelve_lines_around_the_cited_range_with_the_cited_rows_marked(self):
        snip = E.snippet(PATCH, 23, 23)
        self.assertGreaterEqual(len(snip["lines"]), E.SNIPPET_MIN)
        self.assertLessEqual(len(snip["lines"]), E.SNIPPET_MAX)
        cited = [r for r in snip["lines"] if r["cited"]]
        self.assertEqual([r["n"] for r in cited], [23])
        self.assertTrue(snip["start"] <= 23 <= snip["end"])
        # Removed lines ride along as context, numbered None.
        self.assertTrue(all("kind" in r for r in snip["lines"]))

    def test_a_wide_range_is_shown_whole_up_to_the_cap(self):
        snip = E.snippet(PATCH, 17, 26)
        self.assertEqual([r["n"] for r in snip["lines"] if r["cited"]], list(range(17, 27)))
        self.assertLessEqual(len(snip["lines"]), E.SNIPPET_MAX)

    def test_the_window_never_leaves_the_hunk(self):
        two = "@@ -1,2 +1,2 @@\n a\n+b\n@@ -40,2 +40,3 @@\n c\n+d\n e\n"
        snip = E.snippet(two, 41, 41)
        self.assertEqual([r["text"] for r in snip["lines"]], ["c", "d", "e"])
        self.assertEqual(snip["start"], 40)
        self.assertEqual(snip["end"], 42)

    def test_no_hunk_covers_the_line_means_no_snippet(self):
        self.assertIsNone(E.snippet(PATCH, 200, 201))
        self.assertIsNone(E.snippet(PATCH, None, None))
        self.assertIsNone(E.snippet("", 1, 1))
        self.assertIsNone(E.snippet(None, 1, 1))


class Symbols(unittest.TestCase):
    def test_backticked_identifiers_are_extracted_in_order_without_repeats(self):
        self.assertEqual(E.symbols("The `retry()` loop never resets `attempts`",
                                   "Check that `attempts` goes to 0 in `$vendor->leadTime()`"),
                         ["retry", "attempts", "vendor", "leadTime"])
        self.assertEqual(E.symbols(None, "", "no ticks here"), [])
        self.assertEqual(E.symbols("`42`"), [])


class TheMatrix(unittest.TestCase):
    """Every flag on its own, the pass case, and what demotes."""

    def test_pass_the_lines_exist_and_mention_the_symbol(self):
        ev = E.check(finding(), PATCHES)
        self.assertEqual(ev["status"], "pass")
        self.assertEqual(ev["flags"], [])
        self.assertEqual(ev["symbols"], ["res", "ok"])     # `res.ok` names two identifiers
        self.assertEqual(ev["line"], "The cited lines are in this diff and mention `res`, `ok`.")
        self.assertFalse(E.demoted(ev))

    def test_pass_with_nothing_quoted_is_a_plain_pass(self):
        ev = E.check(finding(title="Every error is retried", what_to_check="Open line 23."), PATCHES)
        self.assertEqual(ev, {"status": "pass", "flags": [], "symbols": [],
                              "line": "The cited lines are in this diff."})

    def test_path_not_in_diff_is_one_flag_and_does_not_demote_alone(self):
        ev = E.check(finding(path="src/other.ts"), PATCHES)
        self.assertEqual(ev["flags"], ["path_not_in_diff"])
        self.assertEqual(ev["status"], "warn")
        self.assertEqual(ev["line"], "`src/other.ts` is not a file this PR changes.")
        self.assertFalse(E.demoted(ev))      # an off-diff finding is un-checkable, not wrong

    def test_lines_not_in_diff(self):
        ev = E.check(finding(line=120, end_line=124), PATCHES)
        self.assertEqual(ev["flags"], ["lines_not_in_diff"])
        self.assertEqual(ev["line"], "Lines 120–124 are not in this PR's changes to `deliver.ts`.")
        ev = E.check(finding(line=120), PATCHES)
        self.assertIn("Lines 120 are", ev["line"].replace("Lines 120 are", "Lines 120 are"))

    def test_symbol_not_found(self):
        ev = E.check(finding(title="The `jitter` is missing", what_to_check="Check `MAX_JITTER`."),
                     PATCHES)
        self.assertEqual(ev["flags"], ["symbol_not_found"])
        self.assertEqual(ev["line"], "`jitter`, `MAX_JITTER` do not appear in the cited lines.")
        # Word-boundary match: `attempts` must not match `attempt`.
        ev = E.check(finding(title="`attempts` never resets"), PATCHES)
        self.assertEqual(ev["flags"], ["symbol_not_found"])
        ev = E.check(finding(title="`attempt` never resets"), PATCHES)
        self.assertEqual(ev["flags"], [])

    def test_no_contrast_only_for_a_blocker(self):
        ev = E.check(finding(severity="blocker", expected=None), PATCHES)
        self.assertEqual(ev["flags"], ["no_contrast"])
        self.assertEqual(ev["line"], "A blocker needs both Expected and Actual.")
        ev = E.check(finding(severity="blocker", actual=""), PATCHES)
        self.assertEqual(ev["flags"], ["no_contrast"])
        ev = E.check(finding(severity="should-fix", expected=None, actual=None), PATCHES)
        self.assertEqual(ev["flags"], [])
        ev = E.check(finding(severity="blocker"), PATCHES)
        self.assertEqual(ev["flags"], [])
        # A pre-contract blocker (no what_to_check, expected or actual at all) is not flagged:
        # an older review renders exactly as it did.
        ev = E.check(finding(severity="blocker", what_to_check=None, expected=None, actual=None),
                     PATCHES)
        self.assertEqual(ev["flags"], [])
        ev = E.check(finding(severity="blocker", expected=None, actual=None), PATCHES)
        self.assertEqual(ev["flags"], ["no_contrast"])     # what_to_check alone makes it new-shape

    def test_two_flags_demote_whatever_the_confidence_says(self):
        ev = E.check(finding(path="src/other.ts", severity="blocker", expected=None,
                             confidence="high"), PATCHES)
        self.assertEqual(ev["flags"], ["path_not_in_diff", "no_contrast"])
        self.assertTrue(E.demoted(ev))
        self.assertEqual(ev["line"], "`src/other.ts` is not a file this PR changes. "
                                     "A blocker needs both Expected and Actual.")
        ev = E.check(finding(line=120, title="`jitter` is missing"), PATCHES)
        # Lines not in the diff: the symbol check has nothing to read and is not a second flag.
        self.assertEqual(ev["flags"], ["lines_not_in_diff"])

    def test_a_file_whose_patch_was_withheld_gets_no_line_or_symbol_verdict(self):
        ev = E.check(finding(path="src/webhooks/big.bin", title="`x` is wrong"), PATCHES)
        self.assertEqual(ev["flags"], [])
        self.assertEqual(ev["line"], "The file is in this diff; its lines could not be checked.")

    def test_missing_fields_never_raise(self):
        bare, _ = S.normalize({"comments": [{"body": "just a body"}]})
        ev = E.check(bare["comments"][0], PATCHES)
        self.assertEqual(ev["flags"], ["path_not_in_diff"])
        self.assertEqual(ev["line"], "The file is not a file this PR changes.")
        noline, _ = S.normalize({"comments": [{"path": "src/webhooks/deliver.ts", "line": "?"}]})
        ev = E.check(noline["comments"][0], PATCHES)
        self.assertEqual(ev["flags"], [])
        self.assertEqual(ev["line"], "The file is in this diff; its lines could not be checked.")

    def test_no_diff_at_all_means_no_verdict(self):
        self.assertIsNone(E.check(finding(), None))
        self.assertFalse(E.demoted(None))
        ev, snip = E.annotate(finding(), None)
        self.assertIsNone(ev)
        self.assertIsNone(snip)

    def test_annotate_cuts_the_snippet_only_for_a_known_patch(self):
        ev, snip = E.annotate(finding(), PATCHES)
        self.assertEqual(ev["status"], "pass")
        self.assertTrue(any(r["cited"] and r["n"] == 23 for r in snip["lines"]))
        _, snip = E.annotate(finding(path="src/other.ts"), PATCHES)
        self.assertIsNone(snip)
        _, snip = E.annotate(finding(path="src/webhooks/big.bin"), PATCHES)
        self.assertIsNone(snip)


class TheCli(unittest.TestCase):
    """What scripts/stage-fixture.mjs runs: the server's own reading of a review against a files
    payload, so the stage fixture and the replay's TypeScript port can be held to it."""

    def test_prints_guide_where_evidence_and_snippet_per_finding(self):
        with tempfile.TemporaryDirectory() as tmp:
            rev = Path(tmp) / "review.json"
            files = Path(tmp) / "files.json"
            rev.write_text(json.dumps({"summary": "s", "guide": {"does": "Adds a retry loop."},
                                       "comments": [{"path": "src/webhooks/deliver.ts", "line": 23,
                                                     "severity": "nit", "title": "`res` again"},
                                                    {"path": "nope.ts", "line": 1, "severity": "nit"}]}))
            files.write_text(json.dumps([FILES]))          # --slurp pages
            r = subprocess.run([sys.executable, str(HERE / "rs_evidence.py"), str(rev), str(files)],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            out = json.loads(r.stdout)
            self.assertEqual(out["guide"]["does"], "Adds a retry loop.")
            self.assertEqual(out["findings"][0]["where"], {"path": "src/webhooks/deliver.ts",
                                                            "start": 23, "end": 23})
            self.assertEqual(out["findings"][0]["evidence"]["status"], "pass")
            self.assertEqual(out["findings"][0]["evidence"]["symbols"], ["res"])
            self.assertIsNotNone(out["findings"][0]["snippet"])
            self.assertEqual(out["findings"][1]["evidence"]["flags"], ["path_not_in_diff"])
            self.assertIsNone(out["findings"][1]["snippet"])

    def test_imports_nothing_that_could_reach_github(self):
        imports = [ln.strip() for ln in (HERE / "rs_evidence.py").read_text().splitlines()
                   if ln.startswith(("import ", "from "))]
        self.assertEqual(sorted(imports), ["import json", "import re", "import sys"])


if __name__ == "__main__":
    unittest.main()
