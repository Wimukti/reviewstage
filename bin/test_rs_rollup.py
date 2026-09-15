#!/usr/bin/env python3
"""Unit tests for bin/rs_rollup.py.

Two halves: the run-form duration estimates (static ranges until an install has enough of its
own runs, then that install's median), and compute() — everything the Insights page renders,
which had no coverage at all. The compute() tests are written around the claims the page makes
out loud: all-time really means all-time, a cached replay is not re-billed, agreement is pooled
rather than averaged per PR, cycle time says what it measures, and the day buckets survive a
DST transition.
Run: python3 -m unittest bin.test_rs_rollup"""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rs_learn  # noqa: E402
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


def review(state, repo_slug, pr, login, comments, at, hist=None, model="claude-opus-5",
           tokens=1000, cached=False):
    """One completed run on disk: the live one, or an archived one under history/<ts>/."""
    d = Path(state) / repo_slug / str(pr) / "users" / login
    if hist is not None:
        d = d / "history" / str(hist)
    d.mkdir(parents=True, exist_ok=True)
    rv = d / "review.json"
    rv.write_text(json.dumps({"comments": comments}))
    os.utime(rv, (at, at))
    (d / "usage.json").write_text(json.dumps(
        {"model": model, "input_tokens": tokens, "output_tokens": 0}))
    if cached:
        (d / "cached").write_text("1")
    return d


def learning(root, outcome, at, repo="acme/widgets", critical=False, dry=False):
    row = {"at": at, "repo": repo, "pr": "1", "user": "ann", "skill": "global",
           "path": "app/x.php", "line": 1, "severity": "nit", "gist": "g", "outcome": outcome}
    if critical:
        row["critical_path"] = "app/**"
    if dry:
        row["dry"] = True
    with open(Path(root) / "learnings.jsonl", "a") as fh:
        fh.write(json.dumps(row) + "\n")


class ComputeBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.state = self.root / "state"
        self.state.mkdir()
        self.now = 1_700_000_000

    def tearDown(self):
        self.tmp.cleanup()

    def out(self, **kw):
        return R.compute(self.state, self.root, now=self.now, **kw)


class Compute(ComputeBase):
    """compute() had no test coverage at all, and it is what the whole Insights page renders."""

    def test_history_runs_are_counted_and_bucketed_by_their_own_finish_time(self):
        blocker = [{"severity": "blocker"}, {"severity": "nit"}]
        review(self.state, "acme__widgets", 1, "ann", blocker, self.now - 200)
        review(self.state, "acme__widgets", 1, "ann", [{"severity": "nit"}],
               self.now - 3 * R.DAY, hist=self.now - 3 * R.DAY)
        d = self.out()
        self.assertEqual(d["reviews"]["total"], 2)
        self.assertEqual(d["severity"]["nit"], 2)          # the archived run still counts
        self.assertEqual(d["severity"]["blocker"], 1)
        by_day = {p["ts"]: p["reviews"] for p in d["series"]}
        self.assertEqual(by_day[R._daystart(self.now - 3 * R.DAY)], 1)

    def test_an_all_time_severity_chart_does_not_shrink_when_a_run_is_re_run(self):
        review(self.state, "acme__widgets", 1, "ann", [{"severity": "blocker"}],
               self.now - R.DAY, hist=self.now - R.DAY)
        review(self.state, "acme__widgets", 1, "ann", [{"severity": "nit"}], self.now)
        self.assertEqual(self.out()["severity"]["blocker"], 1)

    def test_a_model_switch_keeps_the_old_model_visible(self):
        review(self.state, "acme__widgets", 1, "ann", [], self.now - R.DAY,
               hist=self.now - R.DAY, model="claude-sonnet-4")
        review(self.state, "acme__widgets", 1, "ann", [], self.now, model="claude-opus-5")
        models = {m["model"]: m["runs"] for m in self.out()["models"]}
        self.assertEqual(models, {"claude-sonnet-4": 1, "claude-opus-5": 1})

    def test_a_cached_replay_is_not_billed_again(self):
        review(self.state, "acme__widgets", 1, "ann", [], self.now, tokens=5000, cached=True)
        d = self.out()
        self.assertEqual(d["tokens"]["total"], 0)
        self.assertEqual(d["reviews"]["total"], 1)         # the run still happened

    def test_one_repository_spelled_two_ways_is_one_row(self):
        review(self.state, "acme__widgets", 1, "ann", [], self.now)
        review(self.state, "Acme__Widgets", 2, "ann", [], self.now)
        d = self.out()
        self.assertEqual([r["repo"] for r in d["repos"]], ["acme/widgets"])
        self.assertEqual(d["repos"][0]["runs"], 2)

    def test_agreement_is_pooled_across_prs_and_heads(self):
        for pr, head, conf, total in ((1, "aaa", 1, 2), (2, "bbb", 1, 20), (2, "ccc", 4, 8)):
            ad = self.state / "acme__widgets" / str(pr) / "agreement"
            ad.mkdir(parents=True, exist_ok=True)
            (ad / f"{head}.json").write_text(json.dumps(
                {"head": head, "confirmed": conf, "total": total,
                 "rate": round(100 * conf / total, 1),
                 "runs": [{"login": "ann"}, {"login": "bo"}]}))
        a = self.out()["agreement"]
        self.assertEqual((a["confirmedFindings"], a["totalFindings"]), (6, 30))
        self.assertEqual(a["avgRate"], 20.0)               # pooled, not the mean of 50/5/50
        self.assertEqual((a["multiReviewerPRs"], a["heads"]), (2, 3))

    def test_cycle_time_says_what_it_measures_and_who_is_excluded(self):
        d = self.state / "acme__widgets" / "1" / "users" / "ann"
        d.mkdir(parents=True)
        (d / "review.json").write_text('{"comments": []}')
        (d / "requested_at").write_text(str(self.now - 3600))
        (d / "posted.json").write_text(json.dumps({"at": self.now}))
        d2 = self.state / "acme__widgets" / "2" / "users" / "ann"
        d2.mkdir(parents=True)
        (d2 / "review.json").write_text('{"comments": []}')
        (d2 / "posted.json").write_text(json.dumps({"at": self.now}))   # run by hand, no request
        c = self.out()["cycle"]
        self.assertEqual((c["n"], c["posts"], c["excluded"]), (1, 2, 1))
        self.assertEqual(c["measures"], "githubRequestToPost")
        self.assertEqual(c["medianReviewToPostSec"], 3600)

    def test_the_findings_cap_is_published(self):
        self.assertEqual(self.out()["findingsCap"], rs_learn.CAP)

    def test_keep_numbers_come_from_the_tally_not_the_capped_log(self):
        totals = {"version": rs_learn.TOTALS_VERSION, "cap": rs_learn.CAP, "complete": True,
                  "outcomes": {"kept": 900, "edited": 60, "dropped": 40},
                  "criticalPath": {"kept": 10, "edited": 0, "dropped": 0},
                  "repos": {"acme/widgets": {"kept": 900, "edited": 60, "dropped": 40}},
                  "repoCriticalPath": {}, "skills": {}, "days": {}}
        (self.root / "learnings_totals.json").write_text(json.dumps(totals))
        k = self.out()["keep"]["allTime"]
        self.assertEqual(k["decided"], 1000)               # far more than the 300-row log cap
        self.assertEqual(k["rate"], 90.0)                  # kept verbatim
        self.assertEqual(k["keepRate"], 96.0)              # kept or reworded — the keep rate
        self.assertTrue(k["ratable"])

    def test_a_rate_over_too_few_decisions_is_not_ratable(self):
        learning(self.root, "kept", self.now)
        k = self.out()["keep"]["allTime"]
        self.assertEqual(k["decided"], 1)
        self.assertFalse(k["ratable"])
        self.assertEqual(k["minSample"], rs_learn.MIN_RATE_SAMPLE)


class DryRunIsNotAMetric(ComputeBase):
    """Regression: a pilot on the default DRY_RUN=1 posts nothing to GitHub, and Insights
    reported a keep rate computed entirely from those hypothetical posts."""

    def test_dry_decisions_are_out_of_the_keep_totals_and_reported_separately(self):
        totals = {"version": rs_learn.TOTALS_VERSION, "cap": rs_learn.CAP, "complete": True,
                  "outcomes": {"kept": 8, "edited": 1, "dropped": 1}, "dryDecisions": 120,
                  "criticalPath": {}, "repos": {}, "repoCriticalPath": {}, "skills": {},
                  "days": {}}
        (self.root / "learnings_totals.json").write_text(json.dumps(totals))
        out = self.out()
        self.assertEqual(out["keep"]["allTime"]["decided"], 10)
        self.assertEqual(out["dryDecisions"], 120)

    def test_a_dry_row_is_not_in_the_per_day_keep_series(self):
        learning(self.root, "kept", self.now)
        learning(self.root, "kept", self.now, dry=True)
        today = next(d for d in self.out()["series"] if d["ts"] == R._daystart(self.now))
        self.assertEqual(today["kept"], 1)

    def test_an_install_with_no_dry_posts_reports_zero(self):
        self.assertEqual(self.out()["dryDecisions"], 0)


class DayBuckets(unittest.TestCase):
    """Regression: local-midnight keys read back off a fixed 86400 grid empty the chart after
    every clock change, while the totals beside it stay put."""

    def setUp(self):
        self.tz = os.environ.get("TZ")
        os.environ["TZ"] = "America/New_York"
        time.tzset()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.state = self.root / "state"
        self.state.mkdir()
        # 03/10/25 12:00 EDT — two days after the spring-forward transition.
        self.now = 1_741_622_400

    def tearDown(self):
        self.tmp.cleanup()
        if self.tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = self.tz
        time.tzset()

    def test_a_review_before_a_dst_change_still_lands_in_the_chart(self):
        at = self.now - 3 * R.DAY                          # before the transition
        review(self.state, "acme__widgets", 1, "ann", [], at)
        d = R.compute(self.state, self.root, now=self.now)
        self.assertEqual(d["reviews"]["total"], 1)
        self.assertEqual(sum(p["reviews"] for p in d["series"]), 1)

    def test_keep_decisions_before_a_dst_change_still_land_in_the_chart(self):
        learning(self.root, "dropped", self.now - 3 * R.DAY)
        d = R.compute(self.state, self.root, now=self.now)
        self.assertEqual(sum(p["dropped"] for p in d["series"]), 1)

    def test_every_generated_bucket_is_on_the_same_grid(self):
        ts = [p["ts"] for p in R.compute(self.state, self.root, now=self.now)["series"]]
        self.assertTrue(all(t % R.DAY == 0 for t in ts))
        self.assertEqual(R._daystart(self.now - 3 * R.DAY), ts[-4])


if __name__ == "__main__":
    unittest.main()
