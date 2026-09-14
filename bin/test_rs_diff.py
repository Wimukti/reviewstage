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
        self.assertIn("2 finding(s) that could not be anchored", D.orphan_block(orphans))


if __name__ == "__main__":
    unittest.main()
