#!/usr/bin/env python3
"""Unit tests for the diff-anchor helpers (bin/rs_diff.py): which RIGHT-side lines a review
comment may point at, including files-API entries that arrive without a `patch`.
Run: python3 -m unittest bin/test_rs_diff.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rs_diff as D  # noqa: E402

PATCH = ("@@ -1,3 +1,4 @@\n a\n-b\n+B\n+B2\n c\n"
         "@@ -10,2 +11,2 @@\n x\n-y\n+Y\n")


class CommentableLines(unittest.TestCase):
    def test_patch_path_unchanged(self):
        # context + added lines on the new side; removed lines consume nothing
        self.assertEqual(D.commentable_lines(PATCH), {1, 2, 3, 4, 11, 12})

    def test_empty_patch(self):
        self.assertEqual(D.commentable_lines(""), set())
        self.assertEqual(D.commentable_lines(None), set())


class FileLines(unittest.TestCase):
    def test_patch_is_authoritative(self):
        e = {"filename": "a.py", "status": "added", "additions": 99, "patch": PATCH}
        self.assertEqual(D.file_lines(e), {1, 2, 3, 4, 11, 12})

    def test_added_without_patch_is_whole_file(self):
        e = {"filename": "public/biology-2026.html", "status": "added", "additions": 344}
        self.assertEqual(D.file_lines(e), set(range(1, 345)))

    def test_added_without_patch_zero_additions(self):
        self.assertEqual(D.file_lines({"filename": "x", "status": "added", "additions": 0}), set())

    def test_removed_without_patch_is_nothing(self):
        e = {"filename": "gone.py", "status": "removed", "deletions": 40}
        self.assertEqual(D.file_lines(e), set())

    def test_modified_without_patch_is_unknown(self):
        for st in ("modified", "renamed", "copied", "changed", ""):
            self.assertIs(D.file_lines({"filename": "x", "status": st, "additions": 5}),
                          D.UNKNOWN, st)


FULL_DIFF = """diff --git a/big.js b/big.js
index 111..222 100644
--- a/big.js
+++ b/big.js
@@ -1,2 +1,3 @@
 one
+two
 three
diff --git a/img.png b/img.png
index 333..444 100644
Binary files a/img.png and b/img.png differ
diff --git a/old.txt b/new.txt
similarity index 90%
rename from old.txt
rename to new.txt
index 555..666 100644
--- a/old.txt
+++ b/new.txt
@@ -5,2 +5,2 @@
 keep
-drop
+add
"""


class ParseFullDiff(unittest.TestCase):
    def test_per_file_hunks(self):
        m = D.parse_full_diff(FULL_DIFF)
        self.assertEqual(m["big.js"], {1, 2, 3})
        self.assertEqual(m["img.png"], set())          # binary: seen, nothing commentable
        self.assertEqual(m["new.txt"], {5, 6})         # rename keyed by the new-side name
        self.assertNotIn("old.txt", m)

    def test_empty(self):
        self.assertEqual(D.parse_full_diff(""), {})
        self.assertEqual(D.parse_full_diff(None), {})


class AnchorMap(unittest.TestCase):
    FILES = [
        {"filename": "a.py", "status": "modified", "patch": PATCH},
        {"filename": "public/biology-2026.html", "status": "added", "additions": 344},
        {"filename": "gone.py", "status": "removed", "deletions": 3},
    ]

    def test_no_fetch_when_status_settles_everything(self):
        calls = []

        def fetch():
            calls.append(1)
            return FULL_DIFF

        m = D.anchor_map(self.FILES, fetch_diff=fetch)
        self.assertEqual(calls, [])
        self.assertEqual(m["a.py"], {1, 2, 3, 4, 11, 12})
        self.assertEqual(m["public/biology-2026.html"], set(range(1, 345)))
        self.assertEqual(m["gone.py"], set())

    def test_modified_without_patch_falls_back_to_full_diff_once(self):
        calls = []

        def fetch():
            calls.append(1)
            return FULL_DIFF

        files = self.FILES + [{"filename": "big.js", "status": "modified", "additions": 1},
                              {"filename": "new.txt", "status": "renamed", "additions": 1}]
        m = D.anchor_map(files, fetch_diff=fetch)
        self.assertEqual(calls, [1])                    # fetched exactly once for two files
        self.assertEqual(m["big.js"], {1, 2, 3})
        self.assertEqual(m["new.txt"], {5, 6})

    def test_full_diff_fetch_failure_leaves_file_unanchorable(self):
        files = [{"filename": "big.js", "status": "modified", "additions": 1}]
        self.assertEqual(D.anchor_map(files, fetch_diff=lambda: None), {"big.js": set()})
        self.assertEqual(D.anchor_map(files), {"big.js": set()})

    def test_split_anchorable_end_to_end(self):
        anchors = D.anchor_map(self.FILES)
        comments = [{"path": "public/biology-2026.html", "line": 3, "body": "x"},
                    {"path": "public/biology-2026.html", "line": 345, "body": "past the end"},
                    {"path": "gone.py", "line": 1, "body": "removed file"},
                    {"path": "a.py", "line": 2, "body": "ok"}]
        inline, orphans = D.split_anchorable(comments, anchors)
        self.assertEqual([(c["path"], c["line"]) for c in inline],
                         [("public/biology-2026.html", 3), ("a.py", 2)])
        self.assertEqual([c["body"] for c in orphans], ["past the end", "removed file"])


class NotInThePrAtAll(unittest.TestCase):
    """A finding on a file the PR never touches is off-diff by definition — and answering that
    must not cost a full `gh pr diff` fetch."""

    FILES = [{"filename": "a.py", "status": "modified", "patch": PATCH},
             {"filename": "big.js", "status": "modified", "additions": 1}]  # patchless: pending

    def _anchors(self, calls):
        return D.Anchors(self.FILES, fetch_diff=lambda: (calls.append(1), FULL_DIFF)[1])

    def test_unknown_path_never_fetches_the_full_diff(self):
        calls = []
        a = self._anchors(calls)
        self.assertFalse(a.can_anchor("src/features/EditProfileScreen.tsx", 268))
        self.assertFalse(a.can_anchor("src/validation/schemas.test.ts", 67))
        self.assertEqual(calls, [])                      # not in the PR: settled for free

    def test_known_patched_file_never_fetches_either(self):
        calls = []
        a = self._anchors(calls)
        self.assertTrue(a.can_anchor("a.py", 2))
        self.assertFalse(a.can_anchor("a.py", 999))      # in the PR, but not a changed line
        self.assertEqual(calls, [])

    def test_patchless_file_in_the_pr_is_worth_the_fetch(self):
        calls = []
        a = self._anchors(calls)
        self.assertTrue(a.can_anchor("big.js", 2))
        self.assertEqual(calls, [1])
        self.assertTrue(a.can_anchor("big.js", 3))
        self.assertEqual(calls, [1])                     # fetched at most once

    def test_split_leaves_unknown_paths_as_orphans_without_fetching(self):
        calls = []
        a = self._anchors(calls)
        comments = [{"path": "nowhere/near.ts", "line": 4, "body": "off-diff"},
                    {"path": "a.py", "line": 1, "body": "inline"}]
        inline, orphans = D.split_anchorable(comments, a)
        self.assertEqual([c["path"] for c in inline], ["a.py"])
        self.assertEqual([c["path"] for c in orphans], ["nowhere/near.ts"])
        self.assertEqual(calls, [])

    def test_bad_line_shapes(self):
        a = D.Anchors(self.FILES)
        self.assertFalse(a.can_anchor("a.py", None))
        self.assertFalse(a.can_anchor("", 2))
        self.assertFalse(a.can_anchor("a.py", "not a line"))
        self.assertFalse(a.can_anchor("a.py", 0))
        # `isinstance(True, int)` is True, so a boolean used to read as line 1.
        self.assertFalse(a.can_anchor("a.py", True))

    def test_a_digit_string_is_the_same_line_everywhere(self):
        """The render path asked isinstance(line, int) and the post path asked line.isdigit(),
        so a string "1" was shown as "in summary" and posted as an inline comment."""
        a = D.Anchors(self.FILES)
        self.assertTrue(a.can_anchor("a.py", "1"))
        self.assertEqual(a.can_anchor("a.py", "1"), a.can_anchor("a.py", 1))


class SuggestionRouting(unittest.TestCase):
    """A suggestion only becomes a ```suggestion fence when it lands inside the diff."""

    ANCHORS = {"a.py": {2}}

    def test_inline_gets_the_fence(self):
        inline, orphans = D.split_anchorable(
            [{"path": "a.py", "line": 2, "body": "fix", "suggestion": "x = 1"}], self.ANCHORS)
        self.assertEqual(orphans, [])
        self.assertIn("```suggestion\nx = 1\n```", inline[0]["body"])

    def test_offdiff_keeps_it_in_its_own_field(self):
        c = {"path": "other.py", "line": 9, "body": "fix", "suggestion": "x = 1"}
        inline, orphans = D.split_anchorable([c], self.ANCHORS)
        self.assertEqual(inline, [])
        self.assertEqual(orphans[0]["suggestion"], "x = 1")
        self.assertNotIn("suggestion", orphans[0]["body"])

    def test_suggestion_only_finding_is_not_dropped(self):
        inline, _ = D.split_anchorable(
            [{"path": "a.py", "line": 2, "body": "", "suggestion": "x = 1"}], self.ANCHORS)
        self.assertEqual(inline[0]["body"], "```suggestion\nx = 1\n```")

    def test_empty_finding_is_dropped(self):
        self.assertEqual(D.split_anchorable([{"path": "a.py", "line": 2, "body": "  "}],
                                            self.ANCHORS), ([], []))


if __name__ == "__main__":
    unittest.main()


class FailedFullDiffFetch(unittest.TestCase):
    """`gh pr diff` failing must not be reported as "this PR does not change that line".

    Before the fix resolve_all() cleared `pending` regardless, so every patchless modified file
    resolved to an empty set of commentable lines and the banner told the reviewer their
    findings point outside the diff — which was false, and un-retryable for the server's life.
    """

    FILES = [{"filename": "big.html", "status": "modified", "additions": 300}]

    def test_a_failed_fetch_leaves_the_file_unresolved(self):
        a = D.Anchors(self.FILES, fetch_diff=lambda: None)
        a.resolve_all()
        self.assertEqual(a.unresolved(), {"big.html"})
        self.assertTrue(a.error)

    def test_unknown_is_not_false(self):
        a = D.Anchors(self.FILES, fetch_diff=lambda: None)
        self.assertIsNone(a.anchor_state("big.html", 12))
        self.assertFalse(a.can_anchor("big.html", 12))      # the post path stays conservative

    def test_a_retry_after_a_transient_failure_resolves(self):
        answers = [None, "diff --git a/big.html b/big.html\n"
                         "+++ b/big.html\n@@ -1,0 +1,2 @@\n+one\n+two\n"]
        a = D.Anchors(self.FILES, fetch_diff=lambda: answers.pop(0))
        self.assertIsNone(a.anchor_state("big.html", 2))
        self.assertTrue(a.anchor_state("big.html", 2))
        self.assertIsNone(a.error)

    def test_a_raising_fetcher_is_data_not_a_crash(self):
        def boom():
            raise RuntimeError("gh exploded")
        a = D.Anchors(self.FILES, fetch_diff=boom)
        self.assertIsNone(a.anchor_state("big.html", 1))
        self.assertIn("gh exploded", a.error)

    def test_a_file_genuinely_outside_the_diff_is_still_a_firm_no(self):
        a = D.Anchors(self.FILES, fetch_diff=lambda: None)
        self.assertFalse(a.anchor_state("elsewhere.py", 3))


class SubmoduleBumps(unittest.TestCase):
    def test_subproject_commit_lines_are_not_commentable(self):
        text = ("diff --git a/vendor/lib b/vendor/lib\n"
                "index 1111111..2222222 160000\n"
                "--- a/vendor/lib\n+++ b/vendor/lib\n"
                "@@ -1 +1 @@\n"
                "-Subproject commit 1111111111111111111111111111111111111111\n"
                "+Subproject commit 2222222222222222222222222222222222222222\n")
        self.assertEqual(D.parse_full_diff(text), {"vendor/lib": set()})


class NormaliseLine(unittest.TestCase):
    def test_norm_line(self):
        self.assertEqual(D.norm_line(7), 7)
        self.assertEqual(D.norm_line(" 7 "), 7)
        self.assertIsNone(D.norm_line(True))
        self.assertIsNone(D.norm_line(False))
        self.assertIsNone(D.norm_line(0))
        self.assertIsNone(D.norm_line(-3))
        self.assertIsNone(D.norm_line("?"))
        self.assertIsNone(D.norm_line(None))

    def test_split_anchorable_emits_an_int_line(self):
        inline, _ = D.split_anchorable([{"path": "a.py", "line": "2", "body": "x"}],
                                       {"a.py": {2}})
        self.assertEqual(inline[0]["line"], 2)


class DeletedFilePermalinks(unittest.TestCase):
    def test_anchors_records_deleted_paths(self):
        a = D.Anchors([{"filename": "gone.py", "status": "removed"}])
        self.assertEqual(a.deleted, {"gone.py"})
