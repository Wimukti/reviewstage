"""rs_queue.py — the queue + notify logic pr-watch.sh and the GitHub webhook share.

pr-watch.sh rewrites $ROOT/queue.json from `gh pr list` every cycle and appends
`<repo>:<pr>:<login>` to $ROOT/seen when it has told a reviewer about a PR. The webhook
receiver (rs_webhook.py) does the same things one event at a time, so both paths must
produce byte-identical queue rows and agree on the dedup key — that is what this module
pins down. The poller keeps its jq implementation; test_rs_webhook.py compares the two.

Queue row shape (pr-watch.sh's jq map, in this key order):
    repo, number, title, url, additions, deletions, changedFiles, requested,
    author, isBot, isDraft, head, createdAt, updatedAt

Everything here is file-based and process-safe enough for one server + one poller: writes are
tmp + os.replace, guarded by an fcntl lock so two webhook threads never interleave. The poller
writes through merge_poll() for exactly that reason: it used to rebuild queue.json wholesale
with `jq > tmp && mv`, outside the lock, which both lost concurrent webhook deliveries and
erased every row only a webhook could know about (a team review request).
"""
import calendar
import fcntl
import hmac
import json
import os
import subprocess
import time
from hashlib import sha256
from pathlib import Path
from urllib.parse import quote

import rs_paths as P

ROOT = P.ROOT
QUEUE = ROOT / "queue.json"
SEEN = ROOT / "seen"
LOCK = ROOT / ".queue.lock"
USERS = ROOT / "users.json"

ROW_KEYS = ("repo", "number", "title", "url", "additions", "deletions", "changedFiles",
            "requested", "author", "isBot", "isDraft", "head", "createdAt", "updatedAt",
            "origins")

# Where each requested login came from. `gh pr list --search "review-requested:<login>"` only
# ever returns DIRECT requests, so a login the webhook learned from a `requested_team` expansion
# is invisible to the poller: it must never be dropped just because a poll did not re-derive it.
ORIGIN_POLL = "poll"
ORIGIN_WEBHOOK = "webhook"

SUPPRESSED = ROOT / "suppressed"        # notify-suppressed (draft/bot/old), re-evaluated each cycle
DELIVERIES = ROOT / "deliveries"        # bounded LRU of X-GitHub-Delivery ids
NOTIFY_FAILS = ROOT / "notify-fails.json"
MAX_DELIVERIES = 500
MAX_NOTIFY_ATTEMPTS = 5                 # then give up and mark seen, rather than ping forever


class _locked:
    """Serialise queue.json / seen writers within and across processes."""

    def __enter__(self):
        ROOT.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(LOCK, os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(self.fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        fcntl.flock(self.fd, fcntl.LOCK_UN)
        os.close(self.fd)
        return False


# --- rows ------------------------------------------------------------------------------------
def row_from_api(repo, pr):
    """Normalise a GitHub REST `pull_request` object (what a webhook carries) into the exact
    row pr-watch.sh writes from `gh pr list --json`. `gh` exposes camelCase names for the same
    fields; `isBot` is `author.is_bot`, which REST spells `user.type == "Bot"`."""
    user = pr.get("user") or {}
    return {
        "repo": repo,
        "number": int(pr.get("number") or 0),
        "title": pr.get("title") or "",
        "url": pr.get("html_url") or f"https://github.com/{repo}/pull/{pr.get('number')}",
        "additions": int(pr.get("additions") or 0),
        "deletions": int(pr.get("deletions") or 0),
        "changedFiles": int(pr.get("changed_files") or 0),
        "requested": [],
        "author": user.get("login") or "",
        "isBot": (user.get("type") or "") == "Bot",
        "isDraft": bool(pr.get("draft")),
        "head": ((pr.get("head") or {}).get("sha")) or "",
        "createdAt": pr.get("created_at"),
        "updatedAt": pr.get("updated_at"),
    }


def normalize(row):
    """A row with exactly ROW_KEYS, in order, defaults filled — so rows from either writer
    compare equal."""
    out = {}
    for k in ROW_KEYS:
        v = row.get(k)
        if k == "requested":
            v = sorted(set(v or []))
        elif k in ("additions", "deletions", "changedFiles", "number"):
            v = int(v or 0)
        elif k in ("isBot", "isDraft"):
            v = bool(v)
        elif k in ("title", "url", "author", "head", "repo"):
            v = v or ""
        elif k == "origins":
            # One entry per requested login; anything unlabelled predates the field and is
            # treated as a poll row (the poller can re-derive it, so dropping it is safe).
            known = v if isinstance(v, dict) else {}
            v = {u: (known.get(u) if known.get(u) in (ORIGIN_POLL, ORIGIN_WEBHOOK)
                     else ORIGIN_POLL) for u in out.get("requested") or []}
        out[k] = v
    return out


def load():
    if not QUEUE.exists():
        return []
    try:
        rows = json.loads(QUEUE.read_text() or "[]")
    except (OSError, ValueError):
        return []
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def save(rows):
    tmp = QUEUE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rows))
    os.replace(tmp, QUEUE)


def _same(r, repo, pr):
    return str(r.get("number")) == str(pr) and (r.get("repo") or "").lower() == repo.lower()


def find(repo, pr):
    for r in load():
        if _same(r, repo, pr):
            return r
    return None


def upsert(repo, pr, meta, logins, origin=ORIGIN_WEBHOOK):
    """Add or refresh the row for repo#pr and add `logins` to its `requested` set. `meta` is a
    normalised row (row_from_api) or any dict with row fields; existing fields not in `meta`
    are kept. `origin` records how each new login was learned, so merge_poll() knows which
    ones a `review-requested:` search could not have re-derived. Returns the stored row."""
    with _locked():
        rows = load()
        cur = None
        for r in rows:
            if _same(r, repo, pr):
                cur = r
                break
        merged = dict(cur or {})
        merged.update({k: v for k, v in (meta or {}).items()
                       if k not in ("requested", "origins")})
        merged["repo"] = (cur or {}).get("repo") or repo
        merged["number"] = int(pr)
        merged["requested"] = sorted(set((cur or {}).get("requested") or []) | set(logins))
        merged["origins"] = {**((cur or {}).get("origins") or {}),
                             **{u: origin for u in logins}}
        row = normalize(merged)
        if cur is None:
            rows.append(row)
        else:
            rows[rows.index(cur)] = row
        save(rows)
    write_min_meta(repo, pr, row)
    return row


def merge_poll(fresh, pairs, now=None):
    """Merge one poll cycle's result into queue.json instead of replacing the file.

    `fresh` is the rows the poll derived (each carrying the logins its search returned);
    `pairs` is every (repo, login) search that ACTUALLY SUCCEEDED this cycle, lowercased repo.
    Nothing outside `pairs` is authoritative, so:

      * a repo nobody searched, or a login whose search failed, keeps its rows untouched —
        a 5xx or an expired token can no longer blank the dashboard;
      * a login the poller cannot see at all (a team review request the webhook expanded,
        origin=webhook) is preserved even when the search for that repo succeeded.

    Returns a summary dict for the poller's log line.
    """
    fresh = [normalize({**r, "origins": {u: ORIGIN_POLL for u in (r.get("requested") or [])}})
             for r in (fresh or [])]
    pairs = {(str(r).lower(), str(u)) for r, u in (pairs or [])}
    searched_repos = {r for r, _ in pairs}
    by_key = {((r["repo"] or "").lower(), str(r["number"])): r for r in fresh}
    out, summary = [], {"kept": 0, "added": 0, "dropped": 0, "preserved": 0, "refreshed": 0}
    with _locked():
        for cur in load():
            key = ((cur.get("repo") or "").lower(), str(cur.get("number")))
            hit = by_key.pop(key, None)
            if key[0] not in searched_repos and hit is None:
                out.append(normalize(cur))          # not looked at this cycle — leave it alone
                summary["kept"] += 1
                continue
            cur_origins = normalize(cur).get("origins") or {}
            keep = set()
            for login in normalize(cur).get("requested") or []:
                if cur_origins.get(login) == ORIGIN_WEBHOOK:
                    keep.add(login)                 # the search cannot re-derive this one
                    summary["preserved"] += 1
                elif (key[0], login) not in pairs:
                    keep.add(login)                 # this login's search failed — no verdict
                    summary["preserved"] += 1
            origins = {u: cur_origins.get(u, ORIGIN_POLL) for u in keep}
            if hit:
                keep |= set(hit["requested"])
                origins.update({u: ORIGIN_POLL for u in hit["requested"]})
                merged = {**cur, **{k: v for k, v in hit.items()
                                    if k not in ("requested", "origins")}}
                summary["refreshed"] += 1
            else:
                merged = dict(cur)
            if not keep:
                summary["dropped"] += 1
                continue
            out.append(normalize({**merged, "requested": sorted(keep), "origins": origins}))
        for row in by_key.values():
            out.append(row)
            summary["added"] += 1
        save(out)
    for row in out:
        write_min_meta(row["repo"], row["number"], row)
    summary["rows"] = len(out)
    return summary


def remove_login(repo, pr, login):
    """A review request was withdrawn: drop the login; drop the row when nobody is left (the
    poller would not list it either)."""
    with _locked():
        rows = load()
        out = []
        for r in rows:
            if _same(r, repo, pr):
                req = [u for u in (r.get("requested") or []) if u != login]
                if not req:
                    continue
                r = normalize({**r, "requested": req})
            out.append(r)
        save(out)


def stale(repo, pr, meta):
    """New commits: refresh head / sizes / updatedAt on the existing row. The dashboard flags a
    review stale when the row's `head` differs from the head the review ran against — the same
    thing the poller does by rewriting the row. No-op when the PR is not queued."""
    with _locked():
        rows = load()
        for i, r in enumerate(rows):
            if _same(r, repo, pr):
                keep = {k: v for k, v in (meta or {}).items()
                        if k in ("head", "additions", "deletions", "changedFiles",
                                 "updatedAt", "title", "isDraft")}
                rows[i] = normalize({**r, **keep})
                save(rows)
                return rows[i]
    return None


def done(repo, pr, state="", merged=None):
    """The PR closed or merged: leave the queue (as it would on the next poll) and archive it
    for every reviewer who has state here but never posted or approved — nothing is left for
    them to do. Posted / approved markers are kept: they are history.

    The archive marker is paired with `archived.auto`, so a later re-request can tell OUR
    archive from one the user chose (see clear_auto_archive). `state`/`merged` are persisted
    into meta.json: without them a merged PR is indistinguishable from a live one and the
    dashboard still offers Approve on it.
    """
    with _locked():
        save([r for r in load() if not _same(r, repo, pr)])
    if state or merged is not None:
        mark_closed(repo, pr, state=state, merged=merged)
    archived = []
    users = P.prdir(repo, pr) / "users"
    if users.is_dir():
        for ud in users.iterdir():
            if not ud.is_dir():
                continue
            if (ud / "posted.json").exists() or (ud / "approved").exists():
                continue
            if not (ud / "archived").exists():
                (ud / "archived").write_text(str(int(time.time())))
                (ud / "archived.auto").write_text(str(int(time.time())))
            archived.append(ud.name)
    return archived


def clear_auto_archive(repo, pr, login):
    """A review request came back for someone we auto-archived when the PR closed (or when they
    first signed in). Their row would otherwise return to the queue reading `archived`, and
    `seen` would suppress the card, so it came back invisible and silent. Drop both markers —
    but only ours: an archive the user clicked has no `.auto` sibling and is left alone."""
    ud = P.udir(repo, pr, login)
    auto = ud / "archived.auto"
    if not auto.exists():
        return False
    auto.unlink(missing_ok=True)
    (ud / "archived").unlink(missing_ok=True)
    unmark_seen(repo, pr, login)
    return True


# --- meta.json ---------------------------------------------------------------------------------
META_KEYS = ("number", "title", "url", "additions", "deletions", "changedFiles", "author",
             "isDraft", "head", "createdAt", "updatedAt")


def write_min_meta(repo, pr, row):
    """Cache a PR's identity the moment the poller or the webhook first sees it.

    Without this, meta.json only ever appeared when a review was run, so the queue page fired
    one synchronous `gh pr view` per row for every PR that had ever left the queue. Existing
    keys (state/merged from a close) survive; nothing is rewritten when it has not changed.
    """
    m = {k: (row or {}).get(k) for k in META_KEYS if (row or {}).get(k) is not None}
    if not m:
        return None
    m["repo"] = repo
    f = P.prdir(repo, pr) / "meta.json"
    try:
        cur = json.loads(f.read_text()) if f.exists() else {}
        if not isinstance(cur, dict):
            cur = {}
    except (OSError, ValueError):
        cur = {}
    out = {**cur, **m}
    if out == cur:
        return cur
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(out))
        os.replace(tmp, f)
    except OSError:
        return cur
    return out


def mark_closed(repo, pr, state="", merged=None):
    """Persist merged/closed into meta.json so the UI can stop offering Approve on a dead PR."""
    f = P.prdir(repo, pr) / "meta.json"
    try:
        cur = json.loads(f.read_text()) if f.exists() else {}
        if not isinstance(cur, dict):
            cur = {}
    except (OSError, ValueError):
        cur = {}
    cur["repo"] = repo
    cur.setdefault("number", int(pr))
    cur["state"] = (state or ("merged" if merged else "closed")).lower()
    cur["merged"] = bool(merged)
    cur["closedAt"] = int(time.time())
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(cur))
        os.replace(tmp, f)
    except OSError:
        pass
    return cur


def mark_posted(repo, pr, login, event="COMMENT"):
    """A review was submitted on GitHub by `login` (possibly outside the dashboard): record it
    so their row moves to Posted / Approved. Idempotent — the dashboard's own post wrote the
    marker first and we never overwrite it."""
    ud = P.udir(repo, pr, login)
    ud.mkdir(parents=True, exist_ok=True)
    now = int(time.time())
    if not (ud / "posted.json").exists():
        (ud / "posted.json").write_text(json.dumps({"at": now, "inline": 0, "event": event,
                                                   "source": "github"}))
    if event == "APPROVED" and not (ud / "approved").exists():
        (ud / "approved").write_text(json.dumps({"at": now, "body": "", "source": "github"}))


# --- seen (dedup) -----------------------------------------------------------------------------
def seen_key(repo, pr, login):
    return f"{repo}:{pr}:{login}"


def _seen_lines():
    try:
        return set(line.strip() for line in SEEN.read_text().splitlines() if line.strip())
    except OSError:
        return set()


def is_seen(repo, pr, login, single_repo="", reviewer=""):
    """Was this reviewer already told about repo#pr? Mirrors pr-watch.sh's seen_for(): lines
    written before the repo dimension were `<pr>:<login>` (and before multi-user, a bare `<pr>`
    for the owner) and still count when this is the only configured repo."""
    lines = _seen_lines()
    if seen_key(repo, pr, login) in lines:
        return True
    if single_repo.lower() != repo.lower():
        return False
    if f"{pr}:{login}" in lines:
        return True
    return bool(reviewer) and login == reviewer and str(pr) in lines


def mark_seen(repo, pr, login):
    with _locked():
        key = seen_key(repo, pr, login)
        if key in _seen_lines():
            return False
        with SEEN.open("a") as f:
            f.write(key + "\n")
        return True


def unmark_seen(repo, pr, login):
    """Forget that we told this reviewer — used when a withdrawn review request comes back."""
    key = seen_key(repo, pr, login)
    with _locked():
        lines = [ln for ln in _seen_lines() if ln != key]
        if len(lines) == len(_seen_lines()):
            return False
        tmp = SEEN.with_suffix(".tmp")
        tmp.write_text("".join(ln + "\n" for ln in sorted(lines)))
        os.replace(tmp, SEEN)
        return True


def prune_seen(live_keys, closed=None):
    """`seen` is append-only and is grepped once per PR per login every poll. Drop lines for
    PRs that are neither in the live queue nor still open — a closed PR can never re-ping, so
    its line buys nothing. `live_keys` is {"repo:pr"}; `closed(repo, pr)` says whether a PR we
    no longer see is known-closed (meta.json state). Returns how many lines went."""
    closed = closed or (lambda repo, pr: False)
    with _locked():
        lines = sorted(_seen_lines())
        keep = []
        for ln in lines:
            parts = ln.rsplit(":", 1)
            key = parts[0] if len(parts) == 2 else ln
            if key in live_keys or ":" not in key:
                keep.append(ln)
                continue
            repo, _, pr = key.rpartition(":")
            if not closed(repo, pr):
                keep.append(ln)
        if len(keep) == len(lines):
            return 0
        tmp = SEEN.with_suffix(".tmp")
        tmp.write_text("".join(ln + "\n" for ln in keep))
        os.replace(tmp, SEEN)
        return len(lines) - len(keep)


# --- notify suppression (draft / bot / too old) -------------------------------------------------
# These used to be written to `seen`, permanently: a PR that was a draft the first time anyone
# looked at it could never ping again once it became reviewable. Record them separately and
# re-evaluate every cycle instead.
def _suppressed_map():
    try:
        d = json.loads(SUPPRESSED.read_text() or "{}")
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def mark_suppressed(repo, pr, login, reason):
    with _locked():
        d = _suppressed_map()
        d[seen_key(repo, pr, login)] = {"reason": reason, "at": int(time.time())}
        tmp = SUPPRESSED.with_suffix(".tmp")
        tmp.write_text(json.dumps(d))
        os.replace(tmp, SUPPRESSED)


def is_suppressed(repo, pr, login):
    return (_suppressed_map().get(seen_key(repo, pr, login)) or {}).get("reason", "")


def clear_suppressed(repo, pr, login):
    key = seen_key(repo, pr, login)
    with _locked():
        d = _suppressed_map()
        if key not in d:
            return False
        d.pop(key)
        tmp = SUPPRESSED.with_suffix(".tmp")
        tmp.write_text(json.dumps(d))
        os.replace(tmp, SUPPRESSED)
        return True


# --- delivery dedup -----------------------------------------------------------------------------
def seen_delivery(delivery, limit=MAX_DELIVERIES):
    """True when this X-GitHub-Delivery id has already been processed. Without it a replayed
    `review_request_removed` can un-queue a PR at any later time. Bounded LRU on disk."""
    delivery = (delivery or "").strip()
    if not delivery:
        return False
    with _locked():
        try:
            ids = [x for x in DELIVERIES.read_text().split() if x]
        except OSError:
            ids = []
        if delivery in ids:
            return True
        ids.append(delivery)
        tmp = DELIVERIES.with_suffix(".tmp")
        tmp.write_text("\n".join(ids[-limit:]) + "\n")
        os.replace(tmp, DELIVERIES)
        return False


# --- notify attempts ----------------------------------------------------------------------------
# `seen` is written only after a send we believe succeeded — the poller and the webhook now
# behave identically. A send that keeps failing would otherwise retry forever, so count the
# attempts and give up (marking seen) after MAX_NOTIFY_ATTEMPTS.
def _fails():
    try:
        d = json.loads(NOTIFY_FAILS.read_text() or "{}")
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def note_notify_failure(repo, pr, login):
    """Record one failed send; returns the attempt count so far."""
    key = seen_key(repo, pr, login)
    with _locked():
        d = _fails()
        n = int(d.get(key) or 0) + 1
        d[key] = n
        tmp = NOTIFY_FAILS.with_suffix(".tmp")
        tmp.write_text(json.dumps(d))
        os.replace(tmp, NOTIFY_FAILS)
        return n


def clear_notify_failures(repo, pr, login):
    key = seen_key(repo, pr, login)
    with _locked():
        d = _fails()
        if key not in d:
            return
        d.pop(key)
        tmp = NOTIFY_FAILS.with_suffix(".tmp")
        tmp.write_text(json.dumps(d))
        os.replace(tmp, NOTIFY_FAILS)


def notify_attempts(repo, pr, login):
    return int(_fails().get(seen_key(repo, pr, login)) or 0)


def touch_requested_at(repo, pr, login):
    ud = P.udir(repo, pr, login)
    ud.mkdir(parents=True, exist_ok=True)
    f = ud / "requested_at"
    if not f.exists():
        f.write_text(str(int(time.time())))


# --- notify -------------------------------------------------------------------------------------
def load_users():
    """login → {slack_id, discord_id, ...}. Only these two fields are ever read here; tokens
    stay encrypted for the server."""
    try:
        d = json.loads(USERS.read_text() or "{}")
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _sign(secret, msg):
    return hmac.new(secret.encode(), msg.encode(), sha256).hexdigest()


def signed_link(public_url, secret, action, repo, pr, ttl=604800):
    """Same bytes as lib-common.sh signed_link: HMAC over action:owner/name#pr:exp."""
    exp = int(time.time()) + ttl
    sig = _sign(secret, f"{action}:{repo}#{pr}:{exp}")
    return f"{public_url}/{action}?repo={quote(repo, safe='')}&pr={pr}&exp={exp}&sig={sig}"


def dashboard_link(public_url, secret, ttl=604800):
    exp = int(time.time()) + ttl
    return f"{public_url}/?exp={exp}&sig={_sign(secret, f'::{exp}')}"


def requested_payload(row, login, public_url, secret, users=None):
    """The review_requested card body, field for field what pr-watch.sh builds with jq."""
    u = (users if users is not None else load_users()).get(login) or {}
    repo, num = row["repo"], str(row["number"])
    return {
        "repo": repo, "pr": num, "title": row.get("title", ""), "author": row.get("author", ""),
        "url": row.get("url", ""), "login": login,
        "slack_id": u.get("slack_id") or "", "discord_id": u.get("discord_id") or "",
        "extra": {"additions": int(row.get("additions") or 0),
                  "deletions": int(row.get("deletions") or 0),
                  "files": int(row.get("changedFiles") or 0),
                  "detail": signed_link(public_url, secret, "pr", repo, num),
                  "board": dashboard_link(public_url, secret)},
    }


def suppress_reason(row, max_age_days=45, skip_bot_prs=False, now=None):
    """Why pr-watch.sh would mark this PR seen WITHOUT a card, or '' to notify: too old, a
    draft, or (when enabled) bot-authored."""
    created = row.get("createdAt") or ""
    if max_age_days and created:
        try:
            cs = calendar.timegm(time.strptime(created[:19], "%Y-%m-%dT%H:%M:%S"))
            age_days = int(((now or time.time()) - cs) // 86400)
            if age_days > max_age_days:
                return f"created {age_days}d ago (> {max_age_days}d)"
        except ValueError:
            pass
    if row.get("isDraft"):
        return "draft"
    if skip_bot_prs and row.get("isBot"):
        return "bot author (SKIP_BOT_PRS)"
    return ""


NOTIFY_TIMEOUT = 20      # a blackholed endpoint must never wedge the caller


def notify_requested(bin_dir, row, login, public_url, secret, env=None, users=None):
    """Post the review_requested card through bin/notify.sh — the same notifier every script
    uses, so backends and Settings overrides apply identically.

    Returns True when the card was handed off successfully. The caller writes `seen` only on a
    True, so the poller and the webhook now agree on the order (notify, then dedup) instead of
    the webhook marking seen first and losing the card on any failure.
    """
    payload = requested_payload(row, login, public_url, secret, users)
    e = dict(os.environ)
    e["ROOT"] = str(ROOT)
    if env:
        e.update({k: v for k, v in env.items() if v})
    try:
        r = subprocess.run(["bash", str(Path(bin_dir, "notify.sh")), "review_requested",
                            json.dumps(payload)], env=e, stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=NOTIFY_TIMEOUT)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


# --- retention ----------------------------------------------------------------------------------
# Nothing under ROOT was ever cleaned up: watch.log and clone.log grow without bound, and every
# run leaves an agent log plus a history/ entry behind. The poller calls this from its
# once-a-day block.
SWEEP_LOGS = ("watch.log", "clone.log")
LOG_MAX_BYTES = 8 * 1024 * 1024


def retention_sweep(root=None, days=30, now=None, log=print):
    """Truncate the big append-only logs and delete per-run artefacts older than `days`.
    Returns {"truncated": [...], "removed": n}. Never touches review.json / posted.json /
    approved — a reviewer's own decisions are not disposable."""
    root = Path(root or ROOT)
    now = now or time.time()
    cutoff = now - max(int(days or 0), 1) * 86400
    out = {"truncated": [], "removed": 0}
    for name in SWEEP_LOGS:
        f = root / name
        try:
            if f.exists() and f.stat().st_size > LOG_MAX_BYTES:
                tail = f.read_bytes()[-LOG_MAX_BYTES // 2:]
                f.write_bytes(b"... truncated by the retention sweep ...\n" + tail)
                out["truncated"].append(name)
        except OSError:
            pass
    for pat in ("state/*/*/users/*/history/*", "state/*/*/*.log", "state/*/*/users/*/*.log"):
        for f in root.glob(pat):
            try:
                if f.is_file() and f.stat().st_mtime < cutoff:
                    f.unlink()
                    out["removed"] += 1
                elif f.is_dir() and f.stat().st_mtime < cutoff and not any(f.iterdir()):
                    f.rmdir()
                    out["removed"] += 1
            except OSError:
                pass
    if out["truncated"] or out["removed"]:
        log(f"==> retention: truncated {out['truncated'] or 'nothing'}, "
            f"removed {out['removed']} file(s) older than {days}d")
    return out


# --- CLI (pr-watch.sh drives the queue through this, so it takes the same lock) ------------------
def _closed_lookup(repo, pr):
    try:
        d = json.loads((P.prdir(repo, pr) / "meta.json").read_text())
    except (OSError, ValueError):
        return False
    return isinstance(d, dict) and (d.get("merged") or
                                    (d.get("state") or "").lower() in ("closed", "merged"))


def _main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "merge-poll":
        rows = json.loads(Path(argv[1]).read_text() or "[]")
        pairs = [ln.split(None, 1) for ln in Path(argv[2]).read_text().split("\n") if ln.strip()]
        print(json.dumps(merge_poll(rows, [(p[0], p[1]) for p in pairs if len(p) == 2])))
        return 0
    if cmd == "prune-seen":
        live = {f"{r.get('repo')}:{r.get('number')}" for r in load()}
        print(prune_seen(live, _closed_lookup))
        return 0
    if cmd == "retention":
        retention_sweep(days=int(argv[1]) if len(argv) > 1 else 30)
        return 0
    if cmd == "suppressed":
        print(is_suppressed(argv[1], argv[2], argv[3]))
        return 0
    if cmd == "suppress":
        mark_suppressed(argv[1], argv[2], argv[3], argv[4] if len(argv) > 4 else "")
        return 0
    if cmd == "clear-suppressed":
        clear_suppressed(argv[1], argv[2], argv[3])
        return 0
    if cmd == "unarchive-auto":
        print("1" if clear_auto_archive(argv[1], argv[2], argv[3]) else "0")
        return 0
    if cmd == "notify-failed":
        print(note_notify_failure(argv[1], argv[2], argv[3]))
        return 0
    if cmd == "mark-seen":
        print("1" if mark_seen(argv[1], argv[2], argv[3]) else "0")
        return 0
    if cmd == "notify-ok":
        clear_notify_failures(argv[1], argv[2], argv[3])
        return 0
    print(f"rs_queue.py: unknown command {cmd!r}", file=__import__("sys").stderr)
    return 2


if __name__ == "__main__":
    import sys
    raise SystemExit(_main(sys.argv[1:]))
