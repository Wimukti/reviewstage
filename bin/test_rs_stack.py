#!/usr/bin/env python3
"""Unit tests for the stack walk (bin/rs_stack.py): a chain of open PRs where each base branch
is the previous head branch, walked from any member, plus the {isStack, size} summary the PR
page renders its "Stacked review" row from.
Run: python3 -m unittest bin/test_rs_stack.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rs_stack as S  # noqa: E402


def pr(num, base, head, title=""):
    return {"number": num, "baseRefName": base, "headRefName": head,
            "title": title or f"PR #{num}", "url": f"https://example.test/pull/{num}"}


# main <- feat-a (#1) <- feat-b (#2) <- feat-c (#3), plus an unrelated PR off main.
STACK = [pr(1, "main", "feat-a"), pr(2, "feat-a", "feat-b"), pr(3, "feat-b", "feat-c"),
         pr(9, "main", "unrelated")]


class Chain(unittest.TestCase):
    def nums(self, rows, num):
        return [r["number"] for r in S.chain(rows, num)]

    def test_from_the_bottom_walks_all_the_way_up(self):
        self.assertEqual(self.nums(STACK, 3), [1, 2, 3])

    def test_from_the_middle_walks_both_ways(self):
        self.assertEqual(self.nums(STACK, 2), [1, 2, 3])

    def test_from_the_top_walks_down(self):
        self.assertEqual(self.nums(STACK, 1), [1, 2, 3])

    def test_unstacked_pr_is_its_own_chain(self):
        self.assertEqual(self.nums(STACK, 9), [9])

    def test_pr_not_in_the_open_list(self):
        self.assertEqual(self.nums(STACK, 404), [])

    def test_string_pr_number(self):
        self.assertEqual(self.nums(STACK, "2"), [1, 2, 3])

    def test_no_rows(self):
        self.assertEqual(S.chain([], 1), [])
        self.assertEqual(S.chain(None, 1), [])

    def test_junk_rows_are_ignored(self):
        rows = ["nope", {"number": "x"}, {"headRefName": "no-number"}, *STACK]
        self.assertEqual(self.nums(rows, 3), [1, 2, 3])

    def test_a_cycle_terminates(self):
        rows = [pr(1, "b", "a"), pr(2, "a", "b")]
        self.assertEqual(sorted(self.nums(rows, 1)), [1, 2])

    def test_self_referential_pr_terminates(self):
        self.assertEqual(self.nums([pr(1, "a", "a")], 1), [1])

    def test_a_fork_follows_the_lowest_numbered_child(self):
        rows = [pr(1, "main", "feat-a"), pr(5, "feat-a", "feat-x"), pr(4, "feat-a", "feat-y")]
        self.assertEqual(self.nums(rows, 1), [1, 4])

    def test_deeper_than_max_depth_stops(self):
        rows = [pr(i, f"b{i - 1}", f"b{i}") for i in range(1, 40)]
        self.assertLessEqual(len(S.chain(rows, 20)), 2 * S.MAX_DEPTH + 1)


class Summary(unittest.TestCase):
    def test_stacked(self):
        self.assertEqual(S.summary(STACK, 2), {"isStack": True, "size": 3})

    def test_not_stacked(self):
        self.assertEqual(S.summary(STACK, 9), {"isStack": False, "size": 1})

    def test_unknown_pr(self):
        self.assertEqual(S.summary(STACK, 404), {"isStack": False, "size": 0})


if __name__ == "__main__":
    unittest.main()
