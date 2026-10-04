"""rs_personal.py — the in-process poller for personal mode (RS_PERSONAL=1).

`npx reviewstage` runs one server for one person with no service token and no cron, so the
poll cycle pr-watch.sh performs from cron runs HERE instead, on a daemon thread, with each
signed-in user's OWN GitHub token. The cycle is pr-watch.sh's, step for step, through the same
rs_queue functions the webhook uses, so the three writers (poller script, webhook, this) keep
producing identical queue rows and agreeing on the dedup key:

    for each repo in the union (.env REPOS ∪ settings.repos), for each signed-in login:
        gh pr list -R repo --state open --search "review-requested:<login>" --json …
    rs_queue.merge_poll(fresh rows, pairs that succeeded)        # merge, never replace
    new-user clean slate (known_logins), then for every row and requested login:
        auto-unarchive → seen? → suppressed (draft / bot / too old)? → notify → mark seen

Notify only — nothing here ever runs a review (openspec/config.yaml). Tokens reach `gh` through
the subprocess environment and nowhere else: never a file, never .env, never a log line.
"""
import json
import os
import subprocess
import threading
import time
from pathlib import Path

import rs_queue as Q

FIELDS = ("number,title,author,headRefOid,url,additions,deletions,changedFiles,isDraft,"
          "createdAt,updatedAt")
SEARCH_LIMIT = 200
FIRST_DELAY = 3          # seconds before the first cycle after boot
GH_TIMEOUT = 60


class Context:
    """Everything a cycle needs from the server, passed explicitly so tests can fake it.
    `repos`, `users` and `token_for` are callables: a repository the wizard just saved and a
    token a sign-in just refreshed must be seen by the very next cycle."""

    def __init__(self, root, bin_dir, repos, users, token_for, settings=None, public_url="",
                 secret="", env=None, single_repo="", reviewer="", notify=None, gh=None,
                 log=print, now=None):
        self.root = Path(root)
        self.bin_dir = Path(bin_dir)
        self.repos = repos
        self.users = users
        self.token_for = token_for
        self.settings = settings or {}
        self.public_url = public_url
        self.secret = secret
        self.env = env or {}
        self.single_repo = single_repo
        self.reviewer = reviewer
        self.notify = notify or (lambda row, login: Q.notify_requested(
            self.bin_dir, row, login, self.public_url, self.secret, self.env, self.users()))
        self.gh = gh or run_gh
        self.log = log
        self.now = now or time.time


def run_gh(args, token, timeout=GH_TIMEOUT):
    """gh with the token in the child's environment only. (returncode, stdout, stderr)."""
    try:
        r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=timeout,
                           env={**os.environ, "GH_TOKEN": token})
    except FileNotFoundError:
        return 127, "", "gh is not installed"
    except subprocess.TimeoutExpired:
        return 124, "", f"gh timed out after {timeout}s"
    return r.returncode, r.stdout or "", r.stderr or ""


def _row(repo, pr, login):
    """One `gh pr list --json` item as the queue row pr-watch.sh's jq builds."""
    author = pr.get("author") or {}
    return {"repo": repo, "number": int(pr.get("number") or 0), "title": pr.get("title") or "",
            "url": pr.get("url") or "", "additions": int(pr.get("additions") or 0),
            "deletions": int(pr.get("deletions") or 0),
            "changedFiles": int(pr.get("changedFiles") or 0), "requested": [login],
            "author": author.get("login") or "", "isBot": bool(author.get("is_bot")),
            "isDraft": bool(pr.get("isDraft")), "head": pr.get("headRefOid") or "",
            "createdAt": pr.get("createdAt"), "updatedAt": pr.get("updatedAt")}


def search(ctx):
    """Run every (repo, login) search. Returns (fresh_rows, pairs, searches, failures) — a pair
    is listed only when its search SUCCEEDED, which is what lets merge_poll leave the rows of
    a failed search alone instead of blanking the queue."""
    fresh, pairs, searches, failures = {}, [], 0, 0
    logins = [u for u in (ctx.users() or {}) if u]
    if not logins and ctx.reviewer:
        logins = [ctx.reviewer]
    for repo in ctx.repos() or []:
        for login in logins:
            token = ctx.token_for(login)
            if not token:
                ctx.log(f"[poll] {repo} for {login}: no GitHub token stored — skipped")
                continue
            searches += 1
            code, out, err = ctx.gh(["pr", "list", "-R", repo, "--state", "open", "--search",
                                     f"review-requested:{login}", "--limit", str(SEARCH_LIMIT),
                                     "--json", FIELDS], token)
            if code != 0:
                failures += 1
                tail = (err or out).strip().replace("\n", " ")[:200]
                ctx.log(f"ERROR: gh pr list failed for {login} in {repo}: {tail}")
                continue
            try:
                items = json.loads(out or "[]")
            except json.JSONDecodeError:
                failures += 1
                ctx.log(f"ERROR: gh pr list for {login} in {repo} returned non-JSON")
                continue
            if not isinstance(items, list):
                items = []
            if len(items) >= SEARCH_LIMIT:
                ctx.log(f"WARN: {repo} review-requested:{login} returned {len(items)} rows "
                        "(the --limit) — results are probably truncated")
            pairs.append((repo.lower(), login))
            for it in items:
                if not isinstance(it, dict) or not it.get("number"):
                    continue
                key = (repo.lower(), str(it["number"]))
                if key in fresh:
                    fresh[key]["requested"] = sorted(set(fresh[key]["requested"]) | {login})
                else:
                    fresh[key] = _row(repo, it, login)
    return list(fresh.values()), pairs, searches, failures


def clean_slate(ctx, logins):
    """pr-watch.sh's new-user rule: the first time a login is seen, its whole backlog is marked
    seen (no card) and auto-archived, so only requests from now on ping and land in To review.
    The first run of this logic on an install with existing users seeds without archiving."""
    known = ctx.root / "known_logins"
    rows = Q.load()

    def backlog(login):
        return [(r["repo"], str(r["number"])) for r in rows if login in (r.get("requested") or [])]

    if not known.exists():
        for login in logins:
            for repo, num in backlog(login):
                if not Q.is_seen(repo, num, login, ctx.single_repo, ctx.reviewer):
                    Q.mark_seen(repo, num, login)
        known.write_text("".join(f"{u}\n" for u in logins))
        if logins:
            ctx.log("==> first run: seeded existing users' backlogs as seen (no card, no archive)")
        return
    have = set(known.read_text().split())
    for login in logins:
        if login in have:
            continue
        n = 0
        for repo, num in backlog(login):
            if not Q.is_seen(repo, num, login, ctx.single_repo, ctx.reviewer):
                Q.mark_seen(repo, num, login)
            ud = Q.P.udir(repo, num, login)
            ud.mkdir(parents=True, exist_ok=True)
            if not (ud / "archived").exists():
                stamp = str(int(ctx.now()))
                (ud / "archived").write_text(stamp)
                (ud / "archived.auto").write_text(stamp)
            n += 1
        with known.open("a") as f:
            f.write(login + "\n")
        ctx.log(f"==> new user {login}: seeded {n} backlog PR(s) as seen + archived (clean slate)")


def announce(ctx):
    """Card whoever has not been told, in pr-watch.sh's order (and rs_webhook._requested's):
    auto-unarchive, seen?, suppress (recorded separately, re-checked next cycle), notify,
    THEN mark seen. Returns (notified, suppressed) counts."""
    vals = ctx.settings
    notified = suppressed = 0
    for row in Q.load():
        repo, num = row.get("repo") or "", str(row.get("number"))
        if not repo:
            continue
        for login in row.get("requested") or []:
            Q.clear_auto_archive(repo, num, login)
            if Q.is_seen(repo, num, login, ctx.single_repo, ctx.reviewer):
                continue
            why = Q.suppress_reason(row, vals.get("max_pr_age_days", 45),
                                    vals.get("skip_bot_prs", False), now=ctx.now())
            if why:
                Q.mark_suppressed(repo, num, login, why)
                suppressed += 1
                ctx.log(f"==> {repo}#{num} {why} — no ping (re-checked every cycle)")
                continue
            Q.clear_suppressed(repo, num, login)
            Q.touch_requested_at(repo, num, login)
            ctx.log(f"==> notifying {repo}#{num} ({row.get('author', '')}) "
                    f"{row.get('title', '')} → {login}")
            if ctx.notify(Q.find(repo, num) or row, login) is False:
                n = Q.note_notify_failure(repo, num, login)
                if n >= Q.MAX_NOTIFY_ATTEMPTS:
                    Q.mark_seen(repo, num, login)
                    ctx.log(f"ERROR: card for {repo}#{num} → {login} failed {n} times — giving up")
                else:
                    ctx.log(f"ERROR: card for {repo}#{num} → {login} failed (attempt {n}) — "
                            "will retry next cycle")
                continue
            Q.clear_notify_failures(repo, num, login)
            Q.mark_seen(repo, num, login)
            notified += 1
    return notified, suppressed


def housekeeping(ctx):
    """pr-watch.sh's once-a-day block: drop `seen` lines for closed PRs, sweep old artefacts."""
    marker = ctx.root / "daily-done"
    today = time.strftime("%Y-%m-%d", time.gmtime(ctx.now()))
    try:
        if marker.read_text().strip() == today:
            return
    except OSError:
        pass
    try:
        live = {f"{r.get('repo')}:{r.get('number')}" for r in Q.load()}
        pruned = Q.prune_seen(live, Q._closed_lookup)
        if pruned:
            ctx.log(f"==> pruned {pruned} seen line(s) for closed PRs")
        Q.retention_sweep(root=ctx.root, days=int(ctx.env.get("RS_RETENTION_DAYS", "30") or 30),
                          log=ctx.log)
    except Exception as e:  # noqa: BLE001 — housekeeping must never stop discovery
        ctx.log(f"WARN: housekeeping failed: {e}")
    marker.write_text(today + "\n")


def cycle(ctx):
    """One poll. Returns a summary dict (what the log line says), or None when nothing ran."""
    if ctx.settings.get("poller_enabled", True) is False:
        ctx.log("==> poller disabled in Settings (poller_enabled=false) — nothing to do")
        return None
    repos = ctx.repos() or []
    if not repos:
        return {"repos": 0}
    housekeeping(ctx)
    fresh, pairs, searches, failures = search(ctx)
    if searches and not pairs:
        ctx.log(f"ERROR: all {searches} gh search(es) failed — queue.json left untouched. "
                "Check the token and your rate limit.")
        return {"repos": len(repos), "searches": searches, "failures": failures}
    if failures:
        ctx.log(f"WARN: {failures} of {searches} searches failed; their rows are kept as-is")
    summary = Q.merge_poll(fresh, pairs, now=ctx.now())
    ctx.log(f"==> queue: {json.dumps(summary)}")
    logins = [u for u in (ctx.users() or {}) if u]
    clean_slate(ctx, logins)
    notified, suppressed = announce(ctx)
    (ctx.root / "poller.last").write_text(str(int(ctx.now())) + "\n")
    return {**summary, "repos": len(repos), "searches": searches, "failures": failures,
            "notified": notified, "suppressed": suppressed}


def start(ctx_factory, first_delay=FIRST_DELAY):
    """Run cycles on a daemon thread for the life of the server. `ctx_factory()` is called
    before every cycle so settings, repositories and tokens are always current."""
    def loop():
        time.sleep(first_delay)
        while True:
            ctx = None
            try:
                ctx = ctx_factory()
                cycle(ctx)
            except Exception as e:  # noqa: BLE001 — a bad cycle must not end polling
                (ctx.log if ctx else print)(f"ERROR: poll cycle failed: {e}")
            interval = 180
            try:
                interval = int((ctx.settings if ctx else {}).get("poll_interval_seconds", 180))
            except (TypeError, ValueError):
                pass
            time.sleep(max(60, min(3600, interval)))
    t = threading.Thread(target=loop, name="rs-personal-poller", daemon=True)
    t.start()
    return t
