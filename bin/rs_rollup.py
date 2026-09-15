"""Insights rollup — aggregated from files ReviewStage already writes.

No new instrumentation: walks per-PR/per-user state (every run, live AND archived under
history/), the learnings tally (keep rate), usage.json (tokens + model) and the agreement
indices. Returns headline totals, a per-day series (for charts + a client-side range filter),
and structural breakdowns (by reviewer, severity, model, repository). `repo` narrows everything
to one repository. Pure fn.

What "all-time" does and does not mean here, since the module used to claim more than it had:

  * Runs, tokens, severity and models walk `history/` as well as the live run, and every run is
    bucketed by ITS OWN finish time. Before, only the current run per (PR, reviewer) was read,
    so the severity chart went down over time and switching model zeroed the old one.
  * A cached re-run is not re-billed: the replay copies usage.json with a fresh mtime, which
    used to bill the same tokens again on the replay day.
  * The keep numbers come from rs_learn's never-truncated tally, not from the capped detail
    log. `findingsCap` is the detail log's cap, published so the UI can say what the per-day
    keep series is drawn from.
  * Day buckets are UTC on both the writing and the reading side. A local-midnight bucket key
    walked back by a fixed 86400 misses every real bucket after a DST change: the chart emptied
    while the totals stayed.
"""
import json
import time
from pathlib import Path

import rs_learn
from rs_paths import is_slug, slug_repo

WEEK = 7 * 24 * 3600
DAY = 24 * 3600
SERIES_DAYS = 90


def _mtime(p):
    try:
        return int(p.stat().st_mtime)
    except OSError:
        return 0


def _load(p):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return None


def _tokens(u):
    if not isinstance(u, dict):
        return 0
    return int(u.get("input_tokens", 0)) + int(u.get("output_tokens", 0))


def _median(xs):
    if not xs:
        return None
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) // 2


def _daystart(ts):
    """Midnight UTC of `ts`.

    The series walks back from today in fixed 86400 steps, so the bucket keys have to be on a
    fixed 86400 grid too. A true local midnight is not: after a DST transition every generated
    key fell an hour off every stored one, the chart emptied and the totals beside it did not."""
    return int(ts) - (int(ts) % DAY)


def _prdirs(state, repo=None):
    """(repo, prdir) for every per-PR dir under state/<owner>__<name>/<pr>, optionally one repo.

    The repo key is lowercased: GitHub treats owner/name case-insensitively and org discovery
    can hand us both spellings, which put one repository in Insights twice and double-counted
    every total."""
    if not state.is_dir():
        return
    for rd in sorted(state.iterdir()):
        if not (rd.is_dir() and is_slug(rd.name)):
            continue
        r = slug_repo(rd.name).lower()
        if repo and r != repo.lower():
            continue
        for pd in sorted(rd.iterdir()):
            if pd.is_dir() and pd.name.isdigit():
                yield r, pd


def _runs_in(d):
    """(finish_ts, run_dir) for every run one reviewer recorded on one PR: the live run plus
    every archived one under history/<ts>/. A history dir is named for the time it finished."""
    out = []
    if (d / "review.json").exists():
        out.append((_mtime(d / "review.json"), d))
    hd = d / "history"
    if hd.is_dir():
        for h in sorted(hd.iterdir()):
            if h.is_dir() and h.name.isdigit():
                out.append((int(h.name), h))
    return out


def _run_usage(rd):
    """(usage dict or None, tokens) for one run — zero for a replayed cache hit.

    A cache hit copies the original run's usage.json, so its mtime says "today" and the tokens
    would be billed a second time on the replay day. The `cached` marker beside it is the only
    honest signal, and "cached re-runs count zero" is a claim the product makes out loud."""
    if (rd / "cached").exists():
        return None, 0
    u = _load(rd / "usage.json")
    if not isinstance(u, dict):
        return None, 0
    return u, _tokens(u)


def compute(state, root, now=None, repo=None):
    state, root = Path(state), Path(root)
    now = now or int(time.time())
    since = now - WEEK
    repos = {}                                   # repo -> {runs, prs, tokens, week}

    reviewers = {}
    prs = set()
    total_runs = week_runs = total_tokens = week_tokens = 0
    cycle = []
    severity = {"blocker": 0, "should-fix": 0, "nit": 0, "question": 0}
    models = {}                                  # model -> {runs, tokens}
    day = {}                                     # daystart_ts -> {reviews, tokens}

    def bump_day(ts, reviews=0, tokens=0):
        d = day.setdefault(_daystart(ts), {"reviews": 0, "tokens": 0})
        d["reviews"] += reviews
        d["tokens"] += tokens

    posts_total = posts_measured = 0
    if state.is_dir():
        for r_name, prd in _prdirs(state, repo):
            ud = prd / "users"
            if not ud.is_dir():
                continue
            rr = repos.setdefault(r_name, {"runs": 0, "week": 0, "prs": 0, "tokens": 0})
            pr_counted = False
            for d in ud.iterdir():
                if not d.is_dir():
                    continue
                runs = _runs_in(d)
                if not runs:
                    continue
                prs.add((r_name, prd.name))
                if not pr_counted:
                    rr["prs"] += 1
                    pr_counted = True
                r = reviewers.setdefault(d.name, {"runs": 0, "week": 0, "tokens": 0})
                for t, rd in runs:
                    total_runs += 1
                    r["runs"] += 1
                    rr["runs"] += 1
                    bump_day(t, reviews=1)
                    if t >= since:
                        week_runs += 1
                        r["week"] += 1
                        rr["week"] += 1
                    u, tok = _run_usage(rd)
                    total_tokens += tok
                    r["tokens"] += tok
                    rr["tokens"] += tok
                    bump_day(t, tokens=tok)
                    if t >= since:
                        week_tokens += tok
                    if u and u.get("model"):
                        m = models.setdefault(u["model"], {"runs": 0, "tokens": 0})
                        m["runs"] += 1
                        m["tokens"] += tok
                    rev = _load(rd / "review.json")
                    if isinstance(rev, dict):
                        for c in rev.get("comments", []) or []:
                            sev = c.get("severity", "nit")
                            if sev in severity:
                                severity[sev] += 1
                # Cycle time: from GitHub's review REQUEST to the post. A PR someone reviewed
                # without being asked has no requested_at and is outside the population — that
                # exclusion is reported rather than quietly shrinking n.
                req, posted = d / "requested_at", d / "posted.json"
                if posted.exists():
                    posts_total += 1
                if req.exists() and posted.exists():
                    try:
                        ra = int(req.read_text().strip())
                        pa = int((_load(posted) or {}).get("at", 0))
                        if ra and pa >= ra:
                            cycle.append(pa - ra)
                            posts_measured += 1
                    except (OSError, ValueError, TypeError):
                        pass

    # Keep numbers come from the never-truncated tally; the per-day buckets come from the
    # capped detail log, which is what `findingsCap` in the response is about.
    tally = rs_learn.load_totals(root)
    blank = {"kept": 0, "edited": 0, "dropped": 0}
    if repo:
        keep = dict(blank, **(tally.get("repos", {}).get(repo.lower()) or {}))
        keep_cp = dict(blank, **(tally.get("repoCriticalPath", {}).get(repo.lower()) or {}))
    else:
        keep = dict(blank, **(tally.get("outcomes") or {}))
        keep_cp = dict(blank, **(tally.get("criticalPath") or {}))
    keep_day = {}
    lf = root / "learnings.jsonl"
    if lf.exists():
        for line in lf.read_text().splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            o = row.get("outcome")
            if repo and (row.get("repo") or "").lower() != repo.lower():
                continue
            if o in blank:
                kd = keep_day.setdefault(_daystart(row.get("at", now)),
                                         {"kept": 0, "edited": 0, "dropped": 0})
                kd[o] += 1

    # rules the team promoted from repeated rejections (rs_learn's rule_promotions.json)
    promoted = 0
    for rec in (_load(root / "rule_promotions.json") or {}).values():
        if isinstance(rec, dict) and not (repo and rec.get("repo")
                                          and rec["repo"].lower() != repo.lower()):
            promoted += 1

    # Agreement, POOLED. An unweighted mean of per-PR rates let a PR with two findings count as
    # much as one with twenty; confirmed and total are summed across every head instead. Every
    # head is walked, not just the newest — a PR reviewed on three heads has three indices, and
    # reading only the last threw the other two away.
    multi, confirmed, agree_total, heads = 0, 0, 0, 0
    if state.is_dir():
        for _, prd in _prdirs(state, repo):
            ad = prd / "agreement"
            if not ad.is_dir():
                continue
            counted_pr = False
            for f in sorted(ad.glob("*.json")):
                a = _load(f)
                if not (a and len(a.get("runs", [])) >= 2):
                    continue
                heads += 1
                confirmed += int(a.get("confirmed", 0) or 0)
                agree_total += int(a.get("total", 0) or 0)
                if not counted_pr:
                    multi += 1
                    counted_pr = True

    # per-day series for the last SERIES_DAYS (zero-filled), newest last
    series = []
    d0 = _daystart(now)
    for i in range(SERIES_DAYS - 1, -1, -1):
        ts = d0 - i * DAY
        dd = day.get(ts, {})
        kk = keep_day.get(ts, {})
        series.append({"ts": ts, "date": time.strftime("%m/%d/%y", time.gmtime(ts)),
                       "reviews": dd.get("reviews", 0), "tokens": dd.get("tokens", 0),
                       "kept": kk.get("kept", 0), "edited": kk.get("edited", 0),
                       "dropped": kk.get("dropped", 0)})

    def keep_block(d):
        """One keep bucket with both rates named for what they measure, and the sample.

        `rate` stays the kept-verbatim number the Insights card has always rendered under the
        label "kept as-is"; `keepRate` is the product's single keep rate — kept or reworded,
        the same definition the Skills page uses. Both carry the sample and the floor so no
        surface has to invent its own minimum."""
        r = rs_learn.keep_rates(d)
        return {"kept": r["kept"], "edited": r["edited"], "dropped": r["dropped"],
                "decided": r["decided"], "keptOrEdited": r["keptOrEdited"],
                "rate": r["verbatimRate"], "verbatimRate": r["verbatimRate"],
                "keepRate": r["keepRate"], "ratable": r["ratable"],
                "minSample": r["minSample"]}

    return {
        "generatedAt": now,
        "repo": repo or "",
        "findingsCap": rs_learn.CAP,
        "keepFromTally": bool(tally.get("complete")),
        "repos": sorted(([{"repo": k, **v} for k, v in repos.items()]),
                        key=lambda r: (-r["runs"], r["repo"])),
        "reviews": {"total": total_runs, "week": week_runs},
        "prs": len(prs),
        "reviewers": sorted(([{"login": k, **v} for k, v in reviewers.items()]),
                            key=lambda r: -r["runs"]),
        "tokens": {"total": total_tokens, "week": week_tokens},
        "keep": {"allTime": keep_block(keep), "criticalPath": keep_block(keep_cp)},
        "severity": severity,
        "models": sorted(([{"model": k, **v} for k, v in models.items()]),
                         key=lambda m: -m["runs"]),
        "promotedRules": promoted,
        "agreement": {"multiReviewerPRs": multi, "confirmedFindings": confirmed,
                      "totalFindings": agree_total, "heads": heads, "pooled": True,
                      "avgRate": (round(100 * confirmed / agree_total, 1)
                                  if agree_total else None)},
        "cycle": {"medianReviewToPostSec": _median(cycle), "n": len(cycle),
                  "measures": "githubRequestToPost",
                  "label": "from GitHub's review request to the post",
                  "posts": posts_total, "measured": posts_measured,
                  "excluded": max(0, posts_total - posts_measured)},
        "series": series,
    }


# --- effort duration estimates ---------------------------------------------------------------
# The run form's "how long will this take" hint. Static ranges until an install has enough of
# its own runs; then the median wall-clock of those runs, which reflects this team's PRs, plan
# and model mix far better than any global number could.
MIN_SAMPLES = 3


def _usage_dirs(state):
    """Every per-run dir that may hold usage.json + effort: the live run and its history."""
    for _, prd in _prdirs(state):
        ud = prd / "users"
        if not ud.is_dir():
            continue
        for d in ud.iterdir():
            if not d.is_dir():
                continue
            yield d
            hd = d / "history"
            if hd.is_dir():
                for h in hd.iterdir():
                    if h.is_dir() and h.name.isdigit():
                        yield h


def duration_samples(state):
    """{effort: [duration_ms, ...]} from every usage.json with an effort marker beside it."""
    out = {}
    for d in _usage_dirs(Path(state)):
        u = _load(d / "usage.json")
        if not isinstance(u, dict):
            continue
        try:
            ms = int(u.get("duration_ms") or 0)
            eff = (d / "effort").read_text().strip()
        except (OSError, TypeError, ValueError):
            continue
        if ms > 0 and eff:
            out.setdefault(eff, []).append(ms)
    return out


def estimate_label(median_ms):
    mins = max(1, round(median_ms / 60000))
    return f"typically ~{mins} min here"


def duration_estimates(state, static, min_samples=MIN_SAMPLES):
    """{effort: {label, source, samples}} for every key in `static` ({effort: range text}).

    source is "measured" (label from this install's median) once ≥ min_samples runs exist for
    that effort, else "static" with the given range. Pure fn over the state dir.
    """
    samples = duration_samples(state)
    out = {}
    for eff, rng in static.items():
        xs = samples.get(eff, [])
        if len(xs) >= min_samples:
            out[eff] = {"label": estimate_label(_median(xs)), "source": "measured",
                        "samples": len(xs), "medianMs": _median(xs)}
        else:
            out[eff] = {"label": rng, "source": "static", "samples": len(xs)}
    return out
