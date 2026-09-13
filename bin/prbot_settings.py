"""Runtime settings ($ROOT/settings.json) and the notifier bridge for prbot-server.py.

Operators change these from the dashboard's Settings page, without editing .env or restarting
anything. Precedence everywhere (server, poller, pr-watch): settings.json > .env > default. Only
keys PRESENT in the file override, so an install that never opened Settings behaves exactly as
its .env says. DRY_RUN is deliberately NOT here — it stays in .env as a restart-gated safety.

Schema (all keys optional):
  poller_enabled         bool        default true
  poll_interval_seconds  int 60..3600  default 180  (.env: POLL_INTERVAL)
  notify_backends        [str]       subset of slack|discord|generic|none; default derived from
                                     which URLs are set in .env (.env: NOTIFY_BACKENDS)
  max_pr_age_days        int 0..3650  default 45   (.env: PRBOT_MAX_PR_AGE_DAYS; 0 = no cutoff)
  skip_bot_prs           bool        default false (.env: SKIP_BOT_PRS)
  auto_profile           {slug: bool} default {}  re-profile a repo when its file tree changes
                                     materially (pr-watch.sh, at most once a day per repo)
"""
import json
import os
import subprocess
import threading
import time
from pathlib import Path

BACKENDS = ("slack", "discord", "generic", "none")
INTERVAL_MIN, INTERVAL_MAX = 60, 3600

_lock = threading.Lock()


def _truthy(v):
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def env_backends(env):
    """The backends .env implies when NOTIFY_BACKENDS is unset: whichever URLs are configured."""
    out = []
    if env.get("SLACK_WEBHOOK") or (env.get("SLACK_BOT_TOKEN") and env.get("SLACK_CHANNEL")):
        out.append("slack")
    if env.get("DISCORD_WEBHOOK"):
        out.append("discord")
    if env.get("WEBHOOK_URL"):
        out.append("generic")
    return out


def env_defaults(env):
    """Layer 2: the .env value for each key, or the built-in default. Returns (values, sources)."""
    vals, src = {}, {}

    def put(key, envkey, conv, default):
        raw = env.get(envkey, "") if envkey else ""
        if raw != "":
            try:
                vals[key], src[key] = conv(raw), "env"
                return
            except (ValueError, TypeError):
                pass
        vals[key], src[key] = default, "default"

    put("poller_enabled", None, None, True)
    put("poll_interval_seconds", "POLL_INTERVAL", int, 180)
    nb = env.get("NOTIFY_BACKENDS", "")
    if nb.strip():
        vals["notify_backends"] = [b.strip() for b in nb.split(",") if b.strip()]
        src["notify_backends"] = "env"
    else:
        vals["notify_backends"], src["notify_backends"] = env_backends(env), "default"
    put("max_pr_age_days", "PRBOT_MAX_PR_AGE_DAYS", int, 45)
    put("skip_bot_prs", "SKIP_BOT_PRS", _truthy, False)
    return vals, src


def read_file(path):
    """The raw settings.json contents (only what an operator saved), or {} when absent/broken."""
    p = Path(path)
    if not p.exists():
        return {}
    try:
        d = json.loads(p.read_text() or "{}")
        return d if isinstance(d, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def effective(path, env):
    """Every setting with its winning value and where it came from."""
    vals, src = env_defaults(env)
    for k, v in read_file(path).items():
        if k in vals:
            vals[k], src[k] = v, "settings"
    return vals, src


def validate(body):
    """Check a PUT body. Returns (clean_dict, error_message). Unknown keys are ignored so an
    older UI can still save; the file only ever holds keys the operator actually set."""
    out = {}
    if not isinstance(body, dict):
        return None, "Send a JSON object."
    if "poller_enabled" in body:
        if not isinstance(body["poller_enabled"], bool):
            return None, "poller_enabled must be true or false."
        out["poller_enabled"] = body["poller_enabled"]
    if "poll_interval_seconds" in body:
        v = body["poll_interval_seconds"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v:
            return None, "poll_interval_seconds must be a whole number of seconds."
        v = int(v)
        if not INTERVAL_MIN <= v <= INTERVAL_MAX:
            return None, (f"poll_interval_seconds must be between {INTERVAL_MIN} and "
                          f"{INTERVAL_MAX:,} (1 to 60 minutes).")
        out["poll_interval_seconds"] = v
    if "notify_backends" in body:
        v = body["notify_backends"]
        if not isinstance(v, list) or not all(isinstance(b, str) for b in v):
            return None, "notify_backends must be a list of backend names."
        bad = [b for b in v if b not in BACKENDS]
        if bad:
            return None, f"Unknown notification backend: {', '.join(bad)}."
        seen = []
        for b in v:
            if b not in seen:
                seen.append(b)
        if "none" in seen and len(seen) > 1:
            return None, "'none' cannot be combined with other backends."
        out["notify_backends"] = seen or ["none"]
    if "max_pr_age_days" in body:
        v = body["max_pr_age_days"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v:
            return None, "max_pr_age_days must be a whole number of days."
        if not 0 <= int(v) <= 3650:
            return None, "max_pr_age_days must be between 0 (no cutoff) and 3,650."
        out["max_pr_age_days"] = int(v)
    if "skip_bot_prs" in body:
        if not isinstance(body["skip_bot_prs"], bool):
            return None, "skip_bot_prs must be true or false."
        out["skip_bot_prs"] = body["skip_bot_prs"]
    if "auto_profile" in body:
        v = body["auto_profile"]
        if not isinstance(v, dict) or not all(isinstance(b, bool) for b in v.values()):
            return None, "auto_profile must map repository slugs to true/false."
        bad = [k for k in v if not isinstance(k, str) or "__" not in k or "/" in k]
        if bad:
            return None, f"auto_profile keys must be repo slugs (owner__name): {', '.join(bad)}."
        out["auto_profile"] = dict(v)
    return out, None


def save(path, clean):
    """Merge validated keys into settings.json, writing atomically (tmp + rename) so the poller
    never reads a half-written file."""
    p = Path(path)
    with _lock:
        cur = read_file(p)
        cur.update(clean)
        cur["updated_at"] = int(time.time())
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(cur, indent=1) + "\n")
        os.replace(tmp, p)
        return cur


def last_poll(root):
    """Epoch seconds of the last completed poll (poller-loop.sh stamps poller.last), or None."""
    try:
        return int(Path(root, "poller.last").read_text().strip())
    except (OSError, ValueError):
        return None


def resolve_admin(users, reviewer, load_and_modify=None):
    """Who administers this install: the REVIEWER login from .env, else the user flagged
    `admin` in users.json, else the first user who ever signed in — flagged then and there so
    the choice is sticky. Returns the admin login or ''."""
    if reviewer and reviewer in users:
        return reviewer
    flagged = [u for u, d in users.items() if isinstance(d, dict) and d.get("admin")]
    if flagged:
        return sorted(flagged)[0]
    if reviewer:
        return reviewer          # not signed in yet, but still the configured owner
    if not users:
        return ""
    first = sorted(users, key=lambda u: ((users[u] or {}).get("added") or 0, u))[0]
    if load_and_modify:
        def flag(us):
            if first in us and isinstance(us[first], dict):
                us[first]["admin"] = True
        load_and_modify(flag)
    return first


def notify_card(bin_dir, root, kind, payload, env=None):
    """Post a card through bin/notify.sh (the single notifier every script uses), detached and
    best-effort: a dead webhook must never break the action that triggered it."""
    e = dict(os.environ)
    e["ROOT"] = str(root)
    if env:
        e.update({k: v for k, v in env.items() if v})
    try:
        subprocess.Popen(["bash", str(Path(bin_dir, "notify.sh")), kind, json.dumps(payload)],
                         env=e, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError:
        pass


# The generic webhook body, documented once here and shown on the Integrations page.
PAYLOAD_SCHEMA = {
    "kind": "review_requested | review_ready | review_stopped | qa_ready",
    "ts": "unix seconds",
    "repo": "owner/name",
    "pr": "\"123\" (string)",
    "title": "PR title",
    "author": "PR author login",
    "url": "https://github.com/owner/name/pull/123",
    "login": "the reviewer this card is for",
    "slack_id": "their Slack member ID, or \"\"",
    "discord_id": "their Discord user ID, or \"\"",
    "extra": {
        "review_requested": {"additions": 0, "deletions": 0, "files": 0,
                             "detail": "dashboard link", "board": "dashboard index"},
        "review_ready": {"event": "COMMENT | REQUEST_CHANGES", "findings": 0, "blockers": 0,
                         "summary": "agent summary", "detail": "dashboard link"},
        "review_stopped": {"status": "stopped | failed", "message": "(failed only)",
                           "job": "Review | QA guide", "confirmed": True,
                           "runner": "login whose Claude account ran it"},
        "qa_ready": {"detail": "dashboard link"},
    },
}
