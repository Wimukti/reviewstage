"""prbot_queue.py — the queue + notify logic pr-watch.sh and the GitHub webhook share.

pr-watch.sh rewrites $ROOT/queue.json from `gh pr list` every cycle and appends
`<repo>:<pr>:<login>` to $ROOT/seen when it has told a reviewer about a PR. The webhook
receiver (prbot_webhook.py) does the same things one event at a time, so both paths must
produce byte-identical queue rows and agree on the dedup key — that is what this module
pins down. The poller keeps its jq implementation; test_prbot_webhook.py compares the two.

Queue row shape (pr-watch.sh's jq map, in this key order):
    repo, number, title, url, additions, deletions, changedFiles, requested,
    author, isBot, isDraft, head, createdAt, updatedAt

Everything here is file-based and process-safe enough for one server + one poller: writes are
tmp + os.replace, guarded by an fcntl lock so two webhook threads never interleave.
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

import prbot_paths as P

ROOT = P.ROOT
QUEUE = ROOT / "queue.json"
SEEN = ROOT / "seen"
LOCK = ROOT / ".queue.lock"
USERS = ROOT / "users.json"

ROW_KEYS = ("repo", "number", "title", "url", "additions", "deletions", "changedFiles",
            "requested", "author", "isBot", "isDraft", "head", "createdAt", "updatedAt")


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


def upsert(repo, pr, meta, logins):
    """Add or refresh the row for repo#pr and add `logins` to its `requested` set. `meta` is a
    normalised row (row_from_api) or any dict with row fields; existing fields not in `meta`
    are kept. Returns the stored row."""
    with _locked():
        rows = load()
        cur = None
        for r in rows:
            if _same(r, repo, pr):
                cur = r
                break
        merged = dict(cur or {})
        merged.update({k: v for k, v in (meta or {}).items() if k != "requested"})
        merged["repo"] = (cur or {}).get("repo") or repo
        merged["number"] = int(pr)
        merged["requested"] = sorted(set((cur or {}).get("requested") or []) | set(logins))
        row = normalize(merged)
        if cur is None:
            rows.append(row)
        else:
            rows[rows.index(cur)] = row
        save(rows)
        return row


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


def done(repo, pr):
    """The PR closed or merged: leave the queue (as it would on the next poll) and archive it
    for every reviewer who has state here but never posted or approved — nothing is left for
    them to do. Posted / approved markers are kept: they are history."""
    with _locked():
        save([r for r in load() if not _same(r, repo, pr)])
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
            archived.append(ud.name)
    return archived


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


def notify_requested(bin_dir, row, login, public_url, secret, env=None, users=None):
    """Post the review_requested card through bin/notify.sh (detached, best-effort) — the same
    notifier every script uses, so backends and Settings overrides apply identically."""
    payload = requested_payload(row, login, public_url, secret, users)
    e = dict(os.environ)
    e["ROOT"] = str(ROOT)
    if env:
        e.update({k: v for k, v in env.items() if v})
    try:
        subprocess.Popen(["bash", str(Path(bin_dir, "notify.sh")), "review_requested",
                          json.dumps(payload)], env=e, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    except OSError:
        pass
    return payload
