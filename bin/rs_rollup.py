"""Insights rollup — aggregated from files ReviewStage already writes, ALL-TIME, from day one.

No new instrumentation: walks per-PR/per-user state (run history), learnings.jsonl (keep-rate),
usage.json (tokens + model), and the agreement indices. Returns headline totals, a per-day series
(for charts + a client-side range filter), and structural breakdowns (by reviewer, severity,
model, repository). `repo` narrows everything to one repository. Some metrics only have data
from when their feature shipped; the UI labels those. Pure fn.
"""
import json
import time
from pathlib import Path

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
    lt = time.localtime(ts)
    return int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))


def _prdirs(state, repo=None):
    """(repo, prdir) for every per-PR dir under state/<owner>__<name>/<pr>, optionally one repo."""
    if not state.is_dir():
        return
    for rd in sorted(state.iterdir()):
        if not (rd.is_dir() and is_slug(rd.name)):
            continue
        r = slug_repo(rd.name)
        if repo and r.lower() != repo.lower():
            continue
        for pd in sorted(rd.iterdir()):
            if pd.is_dir() and pd.name.isdigit():
                yield r, pd


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
                rv = d / "review.json"
                runs = [_mtime(rv)] if rv.exists() else []
                hd = d / "history"
                if hd.is_dir():
                    runs += [int(h.name) for h in hd.iterdir()
                             if h.is_dir() and h.name.isdigit()]
                if not runs:
                    continue
                prs.add((r_name, prd.name))
                if not pr_counted:
                    rr["prs"] += 1
                    pr_counted = True
                r = reviewers.setdefault(d.name, {"runs": 0, "week": 0, "tokens": 0})
                for t in runs:
                    total_runs += 1
                    r["runs"] += 1
                    rr["runs"] += 1
                    bump_day(t, reviews=1)
                    if t >= since:
                        week_runs += 1
                        r["week"] += 1
                        rr["week"] += 1
                tok = _tokens(_load(d / "usage.json"))
                total_tokens += tok
                r["tokens"] += tok
                rr["tokens"] += tok
                bump_day(_mtime(rv), tokens=tok)
                if _mtime(rv) >= since:
                    week_tokens += tok
                # model + severity from the current review
                u = _load(d / "usage.json")
                if isinstance(u, dict) and u.get("model"):
                    m = models.setdefault(u["model"], {"runs": 0, "tokens": 0})
                    m["runs"] += 1
                    m["tokens"] += _tokens(u)
                rev = _load(rv)
                if isinstance(rev, dict):
                    for c in rev.get("comments", []) or []:
                        sev = c.get("severity", "nit")
                        if sev in severity:
                            severity[sev] += 1
                req, posted = d / "requested_at", d / "posted.json"
                if req.exists() and posted.exists():
                    try:
                        ra = int(req.read_text().strip())
                        pa = int((_load(posted) or {}).get("at", 0))
                        if ra and pa >= ra:
                            cycle.append(pa - ra)
                    except (OSError, ValueError, TypeError):
                        pass

    # keep-rate (all-time) + per-day keep buckets, from learnings.jsonl
    keep = {"kept": 0, "edited": 0, "dropped": 0}
    keep_cp = {"kept": 0, "edited": 0, "dropped": 0}      # findings on a profiled critical path
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
            if o in keep:
                keep[o] += 1
                if row.get("critical_path"):
                    keep_cp[o] += 1
                kd = keep_day.setdefault(_daystart(row.get("at", now)),
                                         {"kept": 0, "edited": 0, "dropped": 0})
                kd[o] += 1

    # rules the team promoted from repeated rejections (rs_learn's rule_promotions.json)
    promoted = 0
    for rec in (_load(root / "rule_promotions.json") or {}).values():
        if isinstance(rec, dict) and not (repo and rec.get("repo")
                                          and rec["repo"].lower() != repo.lower()):
            promoted += 1

    # agreement (forward-looking)
    multi, confirmed, rates = 0, 0, []
    if state.is_dir():
        for _, prd in _prdirs(state, repo):
            ad = prd / "agreement"
            if not ad.is_dir():
                continue
            files = sorted(ad.glob("*.json"), key=_mtime)
            a = _load(files[-1]) if files else None
            if a and len(a.get("runs", [])) >= 2:
                multi += 1
                confirmed += a.get("confirmed", 0)
                if a.get("rate") is not None:
                    rates.append(a["rate"])

    # per-day series for the last SERIES_DAYS (zero-filled), newest last
    series = []
    d0 = _daystart(now)
    for i in range(SERIES_DAYS - 1, -1, -1):
        ts = d0 - i * DAY
        dd = day.get(ts, {})
        kk = keep_day.get(ts, {})
        series.append({"ts": ts, "date": time.strftime("%m/%d/%y", time.localtime(ts)),
                       "reviews": dd.get("reviews", 0), "tokens": dd.get("tokens", 0),
                       "kept": kk.get("kept", 0), "edited": kk.get("edited", 0),
                       "dropped": kk.get("dropped", 0)})

    def krate(d):
        t = sum(d.values())
        return round(100 * d["kept"] / t, 1) if t else None

    return {
        "generatedAt": now,
        "repo": repo or "",
        "repos": sorted(([{"repo": k, **v} for k, v in repos.items()]),
                        key=lambda r: (-r["runs"], r["repo"])),
        "reviews": {"total": total_runs, "week": week_runs},
        "prs": len(prs),
        "reviewers": sorted(([{"login": k, **v} for k, v in reviewers.items()]),
                            key=lambda r: -r["runs"]),
        "tokens": {"total": total_tokens, "week": week_tokens},
        "keep": {"allTime": {**keep, "rate": krate(keep)},
                 "criticalPath": {**keep_cp, "rate": krate(keep_cp)}},
        "severity": severity,
        "models": sorted(([{"model": k, **v} for k, v in models.items()]),
                         key=lambda m: -m["runs"]),
        "promotedRules": promoted,
        "agreement": {"multiReviewerPRs": multi, "confirmedFindings": confirmed,
                      "avgRate": (round(sum(rates) / len(rates), 1) if rates else None)},
        "cycle": {"medianReviewToPostSec": _median(cycle), "n": len(cycle)},
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
