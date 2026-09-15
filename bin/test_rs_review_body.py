#!/usr/bin/env python3
"""Unit tests for the review-body renderer (bin/rs_review_body.py): how findings that GitHub
cannot take as inline comments are written into the review body, and the result messages.
Run: python3 -m unittest bin/test_rs_review_body.py"""
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rs_review_body as RB  # noqa: E402

REPO = "Wimukti/setwemu"
HEAD = "abc1234def5678"


def f(sev, path, line, body="because.", **kw):
    return dict(severity=sev, path=path, line=line, body=body, **kw)


class Permalink(unittest.TestCase):
    def test_shape(self):
        self.assertEqual(RB.permalink(REPO, HEAD, "src/a.ts", 67),
                         f"https://github.com/{REPO}/blob/{HEAD}/src/a.ts#L67")

    def test_no_line_no_fragment(self):
        self.assertEqual(RB.permalink(REPO, HEAD, "src/a.ts", None),
                         f"https://github.com/{REPO}/blob/{HEAD}/src/a.ts")

    def test_missing_head_or_repo_is_no_link(self):
        self.assertEqual(RB.permalink(REPO, "", "src/a.ts", 1), "")
        self.assertEqual(RB.permalink("", HEAD, "src/a.ts", 1), "")


class Block(unittest.TestCase):
    LIVE = [f("should-fix", "src/features/profile/screens/EditProfileScreen.tsx", 268),
            f("blocker", "src/validation/schemas.test.ts", 67, "The test still asserts the old "
              "message."),
            f("should-fix", "src/features/profile/screens/EditProfileScreen.tsx", 149)]

    def md(self, items=None, repo=REPO, head=HEAD):
        return RB.offdiff_block(self.LIVE if items is None else items, repo=repo, head=head)

    def test_empty_is_empty(self):
        self.assertEqual(RB.offdiff_block([], repo=REPO, head=HEAD), "")
        self.assertEqual(RB.offdiff_block(None), "")
        self.assertEqual(RB.offdiff_block([f("nit", "a.ts", 1, body="  ")]), "")

    def test_heading_and_lede(self):
        md = self.md()
        self.assertIn("## Findings outside the diff", md)
        self.assertIn("this PR does not change", md)

    def test_nothing_is_collapsed_for_the_live_case(self):
        self.assertNotIn("<details>", self.md())

    def test_a_lone_blocker_is_never_hidden(self):
        md = self.md([f("blocker", "a.ts", 3)])
        self.assertNotIn("<details", md)
        self.assertIn("### 🚫 Blocker", md)

    def test_blocker_first_ordering(self):
        heads = re.findall(r"^### (.+?) —", self.md(), re.M)
        self.assertEqual(heads, ["🚫 Blocker", "⚠️ Should fix", "⚠️ Should fix"])

    def test_severity_ordering_covers_all_four(self):
        items = [f("question", "q.ts", 1), f("nit", "n.ts", 1),
                 f("should-fix", "s.ts", 1), f("blocker", "b.ts", 1)]
        self.assertEqual(re.findall(r"^### (\S+)", self.md(items), re.M),
                         ["🚫", "⚠️", "💬", "❓"])

    def test_each_finding_links_at_the_line_on_the_head_sha(self):
        md = self.md()
        self.assertIn("### 🚫 Blocker — [`src/validation/schemas.test.ts:67`]"
                      f"(https://github.com/{REPO}/blob/{HEAD}/src/validation/schemas.test.ts"
                      "#L67)", md)
        self.assertIn("The test still asserts the old message.", md)

    def test_unknown_head_degrades_to_plain_code_location(self):
        md = self.md(head="")
        self.assertIn("### 🚫 Blocker — `src/validation/schemas.test.ts:67`", md)
        self.assertNotIn("https://github.com", md)

    def test_unknown_severity_still_renders(self):
        md = self.md([f("", "a.ts", 5)])
        self.assertIn("### Finding — [`a.ts:5`]", md)

    def test_no_line_renders_the_path_alone(self):
        self.assertIn("[`a.ts`]", self.md([f("nit", "a.ts", None)]))


class QuietTail(unittest.TestCase):
    def q(self, n):
        return [f("nit", f"n{i}.ts", i) for i in range(n)]

    def test_three_or_fewer_stay_expanded(self):
        md = RB.offdiff_block(self.q(3), repo=REPO, head=HEAD)
        self.assertNotIn("<details", md)
        self.assertEqual(md.count("### 💬 Nit"), 3)

    def test_more_than_three_fold_away(self):
        md = RB.offdiff_block(self.q(4), repo=REPO, head=HEAD)
        self.assertIn("<details><summary>4 more nit(s) / question(s) outside the diff", md)
        self.assertIn("</details>", md)
        self.assertEqual(md.count("### 💬 Nit"), 4)      # folded, not dropped

    def test_a_blocker_stays_above_a_folded_tail(self):
        md = RB.offdiff_block([f("blocker", "b.ts", 1)] + self.q(5), repo=REPO, head=HEAD)
        self.assertLess(md.index("🚫 Blocker"), md.index("<details"))


class Suggestions(unittest.TestCase):
    ITEM = [f("should-fix", "a.ts", 12, "Rename it.", suggestion="const x = 1;")]

    def test_rendered_as_a_plain_block_not_an_apply_fence(self):
        md = RB.offdiff_block(self.ITEM, repo=REPO, head=HEAD)
        self.assertIn("Suggested change:", md)
        self.assertIn("```\nconst x = 1;\n```", md)
        self.assertNotIn("```suggestion", md)

    def test_a_suggestion_alone_still_renders(self):
        md = RB.offdiff_block([f("nit", "a.ts", 1, body="", suggestion="y = 2")],
                              repo=REPO, head=HEAD)
        self.assertIn("### 💬 Nit", md)
        self.assertIn("y = 2", md)


class Messages(unittest.TestCase):
    def test_never_leads_with_zero(self):
        for i, o in ((0, 3), (2, 3), (5, 0), (1, 1), (0, 1)):
            self.assertTrue(RB.posted_message("Wimukti", i, o).startswith("Posted your review"))
            self.assertNotIn("Posted 0", RB.posted_message("Wimukti", i, o))

    def test_mixed(self):
        self.assertEqual(RB.posted_message("Wimukti", 2, 3),
                         "Posted your review as Wimukti — 2 inline, 3 in the summary.")

    def test_all_inline(self):
        self.assertEqual(RB.posted_message("Wimukti", 2, 0),
                         "Posted your review as Wimukti — 2 inline comments.")
        self.assertEqual(RB.posted_message("Wimukti", 1, 0),
                         "Posted your review as Wimukti — 1 inline comment.")

    def test_all_in_the_summary_explains_why(self):
        self.assertEqual(
            RB.posted_message("Wimukti", 0, 3),
            "Posted your review as Wimukti — all 3 findings are in the summary, because they "
            "point at lines this PR does not change (GitHub only allows inline comments on "
            "changed lines).")

    def test_one_in_the_summary_reads_singular(self):
        self.assertIn("all 1 finding is in the summary, because it points at",
                      RB.posted_message("Wimukti", 0, 1))

    def test_nothing_anywhere(self):
        self.assertEqual(RB.outcome(0, 0), "summary only.")


class Permalinks(unittest.TestCase):
    def test_a_deleted_file_gets_no_blob_link(self):
        """The head commit has no blob for a file the PR deleted, so the link 404s."""
        self.assertEqual(RB.permalink(REPO, HEAD, "gone.py", 3, deleted={"gone.py"}), "")
        md = RB.offdiff_block([f("nit", "gone.py", 3)], repo=REPO, head=HEAD,
                              deleted={"gone.py"})
        self.assertIn("`gone.py:3`", md)
        self.assertNotIn("](https://github.com", md)

    def test_paths_are_percent_encoded(self):
        url = RB.permalink(REPO, HEAD, "src/my file#1.ts", 2)
        self.assertEqual(url, f"https://github.com/{REPO}/blob/{HEAD}/"
                              "src/my%20file%231.ts#L2")

    def test_traversal_and_absolute_paths_are_not_linked(self):
        for bad in ("../../etc/passwd", "/etc/passwd", "a/../../b", "https://evil/x",
                    "\\\\server\\share"):
            self.assertEqual(RB.permalink(REPO, HEAD, bad, 1), "", bad)

    def test_a_dot_segment_is_normalised_away(self):
        self.assertEqual(RB.permalink(REPO, HEAD, "./src/a.ts", 1),
                         f"https://github.com/{REPO}/blob/{HEAD}/src/a.ts#L1")

    def test_a_string_line_still_anchors_the_link(self):
        self.assertTrue(RB.permalink(REPO, HEAD, "a.ts", "9").endswith("#L9"))

    def test_a_boolean_line_is_not_line_one(self):
        self.assertFalse(RB.permalink(REPO, HEAD, "a.ts", True).endswith("#L1"))


if __name__ == "__main__":
    unittest.main()
