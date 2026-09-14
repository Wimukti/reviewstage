#!/usr/bin/env python3
"""Unit tests for the run-form duration estimates (bin/rs_rollup.py): static ranges until an
install has enough of its own runs, then that install's median.
Run: python3 -m unittest bin/test_rs_rollup.py"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rs_rollup as R  # noqa: E402

STATIC = {"quick": "2–5 min", "standard": "3–10 min", "deep": "8–25 min"}


def run_dir(state, pr, login, effort, ms, hist=None):
    d = Path(state) / "acme__widgets" / str(pr) / "users" / login
    if hist is not None:
        d = d / "history" / str(hist)
    d.mkdir(parents=True, exist_ok=True)
    (d / "effort").write_text(effort)
    (d / "usage.json").write_text(json.dumps({"model": "claude-opus-5", "duration_ms": ms}))
    return d


class Estimates(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_empty_state_is_all_static(self):
        est = R.duration_estimates(self.state, STATIC)
        self.assertEqual(est, {k: {"label": v, "source": "static", "samples": 0}
                               for k, v in STATIC.items()})

    def test_missing_state_dir(self):
        est = R.duration_estimates(self.state / "nope", STATIC)
        self.assertTrue(all(e["source"] == "static" for e in est.values()))

    def test_below_threshold_stays_static_but_counts(self):
        run_dir(self.state, 1, "ann", "standard", 204_264)
        run_dir(self.state, 2, "ann", "standard", 180_000)
        est = R.duration_estimates(self.state, STATIC)
        self.assertEqual(est["standard"], {"label": "3–10 min", "source": "static", "samples": 2})

    def test_median_once_three_samples(self):
        run_dir(self.state, 1, "ann", "standard", 204_264)      # 3m24s
        run_dir(self.state, 2, "bob", "standard", 600_000)      # 10m
        run_dir(self.state, 3, "ann", "standard", 150_000)      # 2m30s
        est = R.duration_estimates(self.state, STATIC)
        self.assertEqual(est["standard"]["source"], "measured")
        self.assertEqual(est["standard"]["samples"], 3)
        self.assertEqual(est["standard"]["medianMs"], 204_264)
        self.assertEqual(est["standard"]["label"], "typically ~3 min here")
        self.assertEqual(est["quick"]["source"], "static")

    def test_history_runs_count_as_samples(self):
        run_dir(self.state, 1, "ann", "deep", 900_000)
        run_dir(self.state, 1, "ann", "deep", 1_000_000, hist=1700000000)
        run_dir(self.state, 1, "ann", "deep", 1_100_000, hist=1700000100)
        est = R.duration_estimates(self.state, STATIC)
        self.assertEqual(est["deep"]["samples"], 3)
        self.assertEqual(est["deep"]["label"], "typically ~17 min here")

    def test_garbage_is_skipped(self):
        d = run_dir(self.state, 1, "ann", "quick", 60_000)
        (d / "usage.json").write_text("not json")
        run_dir(self.state, 2, "ann", "quick", 0)               # no duration recorded
        d3 = run_dir(self.state, 3, "ann", "quick", 60_000)
        (d3 / "effort").unlink()                                # no effort marker
        self.assertEqual(R.duration_samples(self.state), {})

    def test_label_rounds_and_floors_at_one_minute(self):
        self.assertEqual(R.estimate_label(20_000), "typically ~1 min here")
        self.assertEqual(R.estimate_label(204_264), "typically ~3 min here")
        self.assertEqual(R.estimate_label(210_000), "typically ~4 min here")


if __name__ == "__main__":
    unittest.main()
