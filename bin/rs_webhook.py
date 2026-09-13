"""rs_webhook.py — GitHub webhook receiver logic for POST /webhooks/github.

The poller (pr-watch.sh) discovers review requests every few minutes; a webhook delivers the
same facts within a second. Both feed the same files through rs_queue.py, dedup on the same
`<repo>:<pr>:<login>` key in $ROOT/seen, and never run a review — a webhook only ever updates
the queue and posts the review_requested card. The poller stays on as the safety net for
missed deliveries (GitHub retries are best-effort) and for firewalled installs.

Events handled (X-GitHub-Event → action):
    ping                                → 200, records webhooks.last_ping
    pull_request  review_requested      → queue row + card for the requested reviewer, if
                                          they are signed in; a requested TEAM is expanded
                                          via the GitHub API and only signed-in members count
    pull_request  review_request_removed→ drop that login from the row
    pull_request  synchronize           → refresh head → the dashboard flags reviews stale
    pull_request  closed                → row leaves the queue; unposted reviews are archived
    pull_request_review submitted       → that reviewer's row moves to Posted / Approved
Anything else is acknowledged (202) and ignored. Repositories outside REPOS / REPO_ALLOW_ORG
are acknowledged and ignored with a log line, so an org-wide hook is safe to install.

$ROOT/webhooks.json = {last_event_at, last_event, last_ping, count, last_error} feeds the
Settings card and the poller's "webhooks active" log line.
"""
import hmac
import json
import os
import time
from hashlib import sha256
from pathlib import Path

import rs_queue as Q

STATE_FILE = "webhooks.json"
HANDLED = {
    "pull_request": ("review_requested", "review_request_removed", "synchronize", "closed"),
    "pull_request_review": ("submitted",),
}
REVIEW_EVENT = {"approved": "APPROVED", "changes_requested": "REQUEST_CHANGES"}


# --- signature ------------------------------------------------------------------------------------
def signature_for(secret, body):
    return "sha256=" + hmac.new(secret.encode(), body, sha256).hexdigest()


def verify_signature(secret, body, header):
    """X-Hub-Signature-256 check, constant-time. False on a missing or malformed header."""
    if not secret or not header or not header.startswith("sha256="):
        return False
    return hmac.compare_digest(signature_for(secret, body or b""), header.strip())


def secret_from(env):
    """GITHUB_WEBHOOK_SECRET from .env, else the process environment (Docker passes it as a
    variable and mirrors it into .env on start; a plain `export` also works)."""
    return (env.get("GITHUB_WEBHOOK_SECRET") or os.environ.get("GITHUB_WEBHOOK_SECRET") or "").strip()


# --- health / state -------------------------------------------------------------------------------
def status(root):
    p = Path(root, STATE_FILE)
    d = {"last_event_at": None, "last_event": "", "last_ping": None, "count": 0,
         "last_error": ""}
    try:
        cur = json.loads(p.read_text() or "{}")
        if isinstance(cur, dict):
            d.update({k: cur.get(k, d[k]) for k in d})
    except (OSError, ValueError):
        pass
    return d


def active(root, poll_interval, now=None):
    """Did a verified event arrive within 2 × the poll interval? That is the "webhooks active"
    light on the Settings page and the poller's safety-net log line."""
    last = status(root).get("last_event_at") or 0
    return bool(last) and ((now or time.time()) - last) <= 2 * max(int(poll_interval or 0), 1)


def record(root, event="", error="", ping=False):
    p = Path(root, STATE_FILE)
    with Q._locked():
        d = status(root)
        now = int(time.time())
        if ping:
            d["last_ping"] = now
        else:
            d["last_event_at"] = now
            d["last_event"] = event
            d["count"] = int(d.get("count") or 0) + 1
        d["last_error"] = error or ""
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(d) + "\n")
        os.replace(tmp, p)
        return d


# --- context -------------------------------------------------------------------------------------
class Context:
    """What the handler needs from the server, passed explicitly so tests can fake it."""

    def __init__(self, root, bin_dir, repo_allowed, users, public_url, secret, settings=None,
                 env=None, single_repo="", reviewer="", team_members=None, notify=None,
                 log=print):
        self.root = Path(root)
        self.bin_dir = Path(bin_dir)
        self.repo_allowed = repo_allowed
        self.users = users or {}
        self.public_url = public_url
        self.secret = secret
        self.settings = settings or {}
        self.env = env or {}
        self.single_repo = single_repo
        self.reviewer = reviewer
        self.team_members = team_members or (lambda org, slug: [])
        self.notify = notify or (lambda row, login: Q.notify_requested(
            self.bin_dir, row, login, self.public_url, self.secret, self.env, self.users))
        self.log = log


# --- handler -------------------------------------------------------------------------------------
def _logins_for(payload, ctx):
    """Signed-in logins a review_requested / review_request_removed payload addresses. A direct
    request names `requested_reviewer`; a team request names `requested_team`, which we expand
    through the GitHub API with the service token and intersect with users.json. Unknown or
    unresolvable → [] with a reason."""
    rv = payload.get("requested_reviewer")
    if isinstance(rv, dict) and rv.get("login"):
        login = rv["login"]
        if login in ctx.users:
            return [login], ""
        return [], f"{login} is not signed in here"
    team = payload.get("requested_team")
    if isinstance(team, dict) and team.get("slug"):
        org = ((payload.get("organization") or {}).get("login")
               or (payload.get("repository") or {}).get("owner", {}).get("login") or "")
        try:
            members = ctx.team_members(org, team["slug"]) or []
        except Exception as e:  # noqa: BLE001 — gh may be missing/failing; poller covers it
            return [], f"team {org}/{team['slug']}: members lookup failed ({e})"
        hits = [m for m in members if m in ctx.users]
        return hits, "" if hits else f"team {org}/{team['slug']}: no signed-in member"
    return [], "no requested_reviewer / requested_team in payload"


def _requested(repo, pr, row, logins, ctx):
    vals = ctx.settings
    notified, skipped = [], []
    Q.upsert(repo, pr, row, logins)
    for login in logins:
        if Q.is_seen(repo, pr, login, ctx.single_repo, ctx.reviewer):
            skipped.append(f"{login} (already seen)")
            continue
        why = Q.suppress_reason(row, vals.get("max_pr_age_days", 45),
                                vals.get("skip_bot_prs", False))
        Q.mark_seen(repo, pr, login)
        if why:
            skipped.append(f"{login} ({why})")
            continue
        Q.touch_requested_at(repo, pr, login)
        ctx.notify(Q.find(repo, pr) or row, login)
        notified.append(login)
    return notified, skipped


def handle(event, payload, ctx):
    """Process one verified delivery. Returns (outcome, detail) — outcome is one of
    handled | ignored | error. Runs in a background thread on the server; synchronously in
    tests."""
    if not isinstance(payload, dict):
        return "error", "payload is not a JSON object"
    action = payload.get("action") or ""
    if event not in HANDLED or action not in HANDLED[event]:
        return "ignored", f"{event}.{action or '-'} not handled"
    repo = ((payload.get("repository") or {}).get("full_name") or "").strip()
    pr_obj = payload.get("pull_request") or {}
    pr = pr_obj.get("number")
    if not repo or not pr:
        return "error", "payload lacks repository.full_name / pull_request.number"
    if not ctx.repo_allowed(repo):
        return "ignored", f"{repo} is not in REPOS / REPO_ALLOW_ORG"
    row = Q.row_from_api(repo, pr_obj)

    if event == "pull_request" and action == "review_requested":
        logins, why = _logins_for(payload, ctx)
        if not logins:
            return "ignored", f"{repo}#{pr} review_requested: {why}"
        notified, skipped = _requested(repo, pr, row, logins, ctx)
        return "handled", (f"{repo}#{pr} review_requested → notified {notified or 'nobody'}"
                           + (f"; skipped {skipped}" if skipped else ""))
    if event == "pull_request" and action == "review_request_removed":
        logins, why = _logins_for(payload, ctx)
        for login in logins:
            Q.remove_login(repo, pr, login)
        return "handled", f"{repo}#{pr} review_request_removed → dropped {logins or why}"
    if event == "pull_request" and action == "synchronize":
        updated = Q.stale(repo, pr, row)
        return "handled", (f"{repo}#{pr} synchronize → head {row['head'][:12]}"
                           + ("" if updated else " (not queued; nothing to refresh)"))
    if event == "pull_request" and action == "closed":
        archived = Q.done(repo, pr)
        return "handled", f"{repo}#{pr} closed → left the queue; archived for {archived}"
    if event == "pull_request_review":
        review = payload.get("review") or {}
        login = ((review.get("user") or {}).get("login")) or ""
        if login not in ctx.users:
            return "ignored", f"{repo}#{pr} review by {login or '?'}: not signed in here"
        ev = REVIEW_EVENT.get((review.get("state") or "").lower(), "COMMENT")
        Q.mark_posted(repo, pr, login, ev)
        return "handled", f"{repo}#{pr} review submitted by {login} → posted ({ev})"
    return "ignored", f"{event}.{action} fell through"


def process(event, payload, ctx, delivery=""):
    """handle() + record() + one log line. Never raises: a bad payload is a recorded error."""
    tag = f"[webhook {delivery[:8] or '-'}]"
    try:
        outcome, detail = handle(event, payload, ctx)
    except Exception as e:  # noqa: BLE001 — log and keep serving
        outcome, detail = "error", f"{type(e).__name__}: {e}"
    record(ctx.root, f"{event}.{(payload or {}).get('action', '') if isinstance(payload, dict) else ''}",
           error=detail if outcome == "error" else "")
    ctx.log(f"{tag} {outcome}: {detail}", flush=True)
    return outcome, detail
