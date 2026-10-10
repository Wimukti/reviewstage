"""rs_telemetry.py — zero-by-default product telemetry: local counters always, sending never
unless four gates agree (openspec/changes/p0-proof/lane1-telemetry.md).

What is counted is a closed list of EVENT CLASSES with fixed vocabularies (SCHEMA below). A
counter key is built only from that allowlist, so no diff, finding text, repository name, user
name, path, branch, PR title or token can ever reach the store — there is no field for one.
Counts are per UTC day; no per-event rows are kept.

Storage, all under ROOT/telemetry/ (never under state/, so PR cleanup leaves it alone and one
`rm -rf` deletes it):
  counters.json  { "schema": 1, "days": { "YYYY-MM-DD": { "<key>": n } } }
  consent.json   { "schema": 1, "decided": bool, "consented": bool, "at": epoch,
                   "install_id": "…" }     install_id exists ONLY while consented
  outbox.json    [ { "day", "queued_at", "sent_at"?, "payload" } ]   what "View queued" shows

Decision order for SENDING, first match wins (decision()):
  1. RS_TELEMETRY=0 in the environment or .env            -> killed
  2. settings.json telemetry_enabled == false (the admin)  -> disabled_by_admin
  3. consent.json consented != true (every install's default) -> no_consent
  4. RS_TELEMETRY_ENDPOINT unset or not https://            -> no_endpoint  (shipped default)
  5. otherwise                                              -> active
Even with consent, nothing leaves while the endpoint is unset; 1.0.x ships with it unset.

bump() is the only write entry point and swallows OSError: a counter that fails to write must
never break a review or a post (the rule rs_learn.record follows). Paths are read from rs_paths
at call time so a test that reloads rs_paths moves this module with it.

Sender: urllib.request only, one POST per complete day, batched from the outbox. No SDK.
"""
import contextlib
import fcntl
import json
import os
import platform
import re
import secrets
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import rs_paths as P

SCHEMA_VERSION = 1
OUTBOX_MAX_DAYS = 30
KILL_VARS = ("RS_TELEMETRY", "KEEPDROP_TELEMETRY")       # the second is the post-rename alias
ENDPOINT_VARS = ("RS_TELEMETRY_ENDPOINT", "KEEPDROP_TELEMETRY_ENDPOINT")

# The allowlist. An event maps to its dimensions; each dimension maps to its closed vocabulary.
# A dimension valued `SLUG` accepts a short machine slug (the lane 2 dismissal taxonomy is
# being defined concurrently), never free text — see _slug_ok.
SLUG = "slug"
SCHEMA = {
    "install_completed": {},
    "connect_result": {"service": ("github", "claude"),
                       "error_category": ("ok", "denied", "expired_code", "network",
                                          "bad_token", "other")},
    "review_started": {"effort": ("quick", "standard", "deep")},
    "review_completed": {"outcome": ("done", "failed", "stopped", "timeout")},
    "run_duration_bucket": {"bucket": ("lt1m", "1to3m", "3to10m", "gt10m")},
    "findings_shown": {},
    "findings_kept": {},
    "findings_edited": {},
    "findings_dropped": {},
    "dismissal_reason": {"reason": SLUG},
    "post_attempted": {"dry": ("0", "1")},
    "post_succeeded": {"dry": ("0", "1")},
}
# Derived at flush time from the set of active days, never stored as counters.
DERIVED = ("return_7d", "return_28d")
# Every key a payload may carry. The walker in assert_allowed() refuses anything else.
PAYLOAD_KEYS = ("schema", "install_id", "day", "app_version", "platform", "mode",
                "counters", "return_7d", "return_28d")
PLATFORMS = ("darwin", "linux", "windows", "other")
MODES = ("personal", "team")
STATES = ("killed", "disabled_by_admin", "no_consent", "no_endpoint", "active")
REASONS = {
    "killed": "Off: RS_TELEMETRY=0 is set on this server.",
    "disabled_by_admin": "Off: the admin disabled telemetry for this server in Settings.",
    "no_consent": "Off: you have not opted in. Counters stay on this machine.",
    "no_endpoint": "Opted in, but no endpoint is configured — nothing is sent.",
    "active": "On: one anonymous summary per day goes to the configured endpoint.",
}

_SLUG_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_lock = threading.Lock()


# --- paths (read at call time, see module docstring) ----------------------------------------------
def tdir():
    return P.ROOT / "telemetry"


def counters_path():
    return tdir() / "counters.json"


def consent_path():
    return tdir() / "consent.json"


def outbox_path():
    return tdir() / "outbox.json"


def settings_path():
    return P.ROOT / "settings.json"


# --- file primitives (same shape as rs_learn) ------------------------------------------------------
@contextlib.contextmanager
def _file_lock():
    tdir().mkdir(parents=True, exist_ok=True)
    fd = os.open(str(tdir() / ".lock"), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        with contextlib.suppress(OSError):
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _atomic_write(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(path.parent, 0o700)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(json.dumps(obj, indent=1, sort_keys=True) + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except OSError:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def _read_json(path, default):
    try:
        d = json.loads(Path(path).read_text() or "null")
    except (OSError, ValueError):
        return default
    return d if isinstance(d, type(default)) else default


def today(now=None):
    return datetime.fromtimestamp(now if now is not None else time.time(),
                                  tz=timezone.utc).strftime("%Y-%m-%d")


# --- the allowlist -------------------------------------------------------------------------------
def _slug_ok(v):
    return isinstance(v, str) and bool(_SLUG_RE.match(v))


def key_for(event, dims):
    """The counter key for an event + dimensions, or None when anything is outside SCHEMA.
    Keys look like `connect_result|error_category=ok|service=github` (dimensions sorted)."""
    spec = SCHEMA.get(event)
    if spec is None or set(dims) != set(spec):
        return None
    parts = []
    for name in sorted(spec):
        vocab, val = spec[name], dims[name]
        if vocab == SLUG:
            if not _slug_ok(val):
                return None
        else:
            val = str(val)
            if val not in vocab:
                return None
        parts.append(f"{name}={val}")
    return "|".join([event, *parts])


def parse_key(key):
    """(event, dims) for a stored key, or None when it does not fit SCHEMA."""
    if not isinstance(key, str):
        return None
    event, *rest = key.split("|")
    dims = {}
    for part in rest:
        name, sep, val = part.partition("=")
        if not sep:
            return None
        dims[name] = val
    return (event, dims) if key_for(event, dims) == key else None


def assert_allowed(payload):
    """Walk a payload and raise ValueError on anything the allowlist does not name. This is the
    NEVER-fields guarantee in executable form: the sender refuses a body that fails it."""
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    extra = set(payload) - set(PAYLOAD_KEYS)
    if extra:
        raise ValueError(f"forbidden payload keys: {sorted(extra)}")
    if payload.get("schema") != SCHEMA_VERSION:
        raise ValueError("schema version")
    iid = payload.get("install_id")
    if not isinstance(iid, str) or not re.match(r"^[0-9a-f]{32}$", iid):
        raise ValueError("install_id must be a 32-hex random id")
    if not isinstance(payload.get("day"), str) or not _DAY_RE.match(payload["day"]):
        raise ValueError("day must be YYYY-MM-DD")
    if not isinstance(payload.get("app_version"), str) or len(payload["app_version"]) > 32 \
            or not re.match(r"^[0-9A-Za-z.+-]*$", payload["app_version"]):
        raise ValueError("app_version must be a short version string")
    if payload.get("platform") not in PLATFORMS:
        raise ValueError("platform")
    if payload.get("mode") not in MODES:
        raise ValueError("mode")
    for k in DERIVED:
        if not isinstance(payload.get(k), bool):
            raise ValueError(f"{k} must be a boolean")
    counters = payload.get("counters")
    if not isinstance(counters, dict):
        raise ValueError("counters must be an object")
    for k, v in counters.items():
        if parse_key(k) is None:
            raise ValueError(f"counter key outside the schema: {k!r}")
        if isinstance(v, bool) or not isinstance(v, int) or v < 0:
            raise ValueError(f"counter {k!r} must be a non-negative integer")
    return True


# --- counters -------------------------------------------------------------------------------------
def bump(event, n=1, now=None, **dims):
    """Add `n` to one counter for today. Returns True when counted, False when the event or a
    dimension is outside SCHEMA (nothing is written) or the write failed (swallowed)."""
    key = key_for(event, dims)
    if key is None:
        return False
    try:
        n = int(n)
    except (TypeError, ValueError):
        return False
    if n <= 0:
        return False
    try:
        with _lock, _file_lock():
            data = _read_json(counters_path(), {})
            days = data.get("days") if isinstance(data.get("days"), dict) else {}
            day = days.setdefault(today(now), {})
            day[key] = int(day.get(key, 0) or 0) + n
            _atomic_write(counters_path(), {"schema": SCHEMA_VERSION, "days": days})
        return True
    except OSError:
        return False


def counters():
    """{day: {key: n}} with anything outside the schema dropped on read."""
    data = _read_json(counters_path(), {})
    days = data.get("days") if isinstance(data.get("days"), dict) else {}
    out = {}
    for day, keys in sorted(days.items()):
        if not (_DAY_RE.match(str(day)) and isinstance(keys, dict)):
            continue
        clean = {k: int(v) for k, v in keys.items()
                 if parse_key(k) is not None and isinstance(v, int) and not isinstance(v, bool)
                 and v > 0}
        if clean:
            out[day] = clean
    return out


def duration_bucket(ms):
    try:
        s = float(ms) / 1000.0
    except (TypeError, ValueError):
        return "lt1m"
    if s < 60:
        return "lt1m"
    if s < 180:
        return "1to3m"
    if s < 600:
        return "3to10m"
    return "gt10m"


def connect_error_category(message):
    """Fold a human error message from a sign-in or Claude connect into the fixed vocabulary.
    The message itself is never stored."""
    m = (message or "").lower()
    if not m:
        return "ok"
    if "denied" in m or "access_denied" in m:
        return "denied"
    if "expired" in m or "stale" in m or "different sign-in" in m or "start over" in m:
        return "expired_code"
    if any(w in m for w in ("network", "timed out", "answered", "unreachable", "connection",
                            "githubstatus", "from ")):
        return "network"
    if any(w in m for w in ("token", "401", "unauthorized", "did not work", "bad credentials",
                            "cannot see", "no access")):
        return "bad_token"
    return "other"


def dismissal_reason_counts(rows):
    """{reason_slug: n} over learning rows that carry a `reason` (lane 2 adds it); {} when none
    do. Tolerant by design: rows without the field, or with a value that is not a slug, are
    skipped rather than raising."""
    out = {}
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        reason = r.get("reason")
        if r.get("outcome") == "dropped" and _slug_ok(reason):
            out[reason] = out.get(reason, 0) + 1
    return out


def record_decisions(outcomes, reasons=None, now=None):
    """Bump the kept/edited/dropped counters for one post decision, plus any dismissal reasons.
    `outcomes` is a list of 'kept' | 'edited' | 'dropped'; `reasons` a list of slugs (or None)."""
    tally = {}
    for o in outcomes or []:
        if o in ("kept", "edited", "dropped"):
            tally[o] = tally.get(o, 0) + 1
    for o, n in tally.items():
        bump(f"findings_{o}", n=n, now=now)
    for reason in reasons or []:
        if _slug_ok(reason):
            bump("dismissal_reason", now=now, reason=reason)


# --- consent -------------------------------------------------------------------------------------
def consent():
    d = _read_json(consent_path(), {})
    return {"schema": SCHEMA_VERSION, "decided": bool(d.get("decided")),
            "consented": d.get("consented") is True, "at": int(d.get("at") or 0),
            "install_id": d.get("install_id") if d.get("consented") is True else None}


def set_consent(on, now=None):
    """Record the person's choice. Consenting mints the install id; revoking deletes it, so a
    later consent is a fresh, unlinkable install to the receiver."""
    at = int(now if now is not None else time.time())
    with _lock, _file_lock():
        cur = _read_json(consent_path(), {})
        d = {"schema": SCHEMA_VERSION, "decided": True, "consented": bool(on), "at": at}
        if on:
            d["install_id"] = cur.get("install_id") if cur.get("consented") is True \
                and isinstance(cur.get("install_id"), str) else secrets.token_hex(16)
        _atomic_write(consent_path(), d)
        if not on:
            # Revoking also empties the queue: nothing built under the old id may leave later.
            with contextlib.suppress(OSError):
                outbox_path().unlink()
    return consent()


def clear(now=None):
    """Delete every counter and the queue; re-mint the install id when consented so the history
    before Clear cannot be joined to the history after it."""
    with _lock, _file_lock():
        for p in (counters_path(), outbox_path()):
            with contextlib.suppress(OSError):
                p.unlink()
        cur = _read_json(consent_path(), {})
        if cur.get("consented") is True:
            cur["install_id"] = secrets.token_hex(16)
            cur["at"] = int(now if now is not None else time.time())
            _atomic_write(consent_path(), cur)
    return status()


# --- the decision --------------------------------------------------------------------------------
def _truthy_zero(v):
    return str(v).strip().lower() in ("0", "false", "no", "off")


def kill_switch(env):
    env = env or {}
    return any(k in env and _truthy_zero(env.get(k)) for k in KILL_VARS)


def endpoint(env):
    env = env or {}
    for k in ENDPOINT_VARS:
        v = (env.get(k) or "").strip()
        if v:
            return v if v.startswith("https://") else ""
    return ""


def admin_allows():
    """settings.json telemetry_enabled (default true = "allowed to ask", never "send")."""
    d = _read_json(settings_path(), {})
    return d.get("telemetry_enabled") is not False


def decision(env=None):
    """(state, reason sentence). `env` is the merged .env + process environment."""
    env = env if env is not None else dict(os.environ)
    if kill_switch(env):
        state = "killed"
    elif not admin_allows():
        state = "disabled_by_admin"
    elif not consent()["consented"]:
        state = "no_consent"
    elif not endpoint(env):
        state = "no_endpoint"
    else:
        state = "active"
    return state, REASONS[state]


# --- payloads and the outbox ---------------------------------------------------------------------
def platform_name():
    s = sys.platform
    if s.startswith("darwin"):
        return "darwin"
    if s.startswith("linux"):
        return "linux"
    if s.startswith("win"):
        return "windows"
    return "other"


def _returned(days, day, window):
    """Did this install have activity on another day within `window` days before `day`?"""
    try:
        d0 = datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        return False
    for other in days:
        if other == day:
            continue
        try:
            dt = datetime.strptime(other, "%Y-%m-%d")
        except ValueError:
            continue
        if timedelta(0) < d0 - dt <= timedelta(days=window):
            return True
    return False


def payload_for(day, all_days, install_id, app_version="", mode="team"):
    return {"schema": SCHEMA_VERSION, "install_id": install_id, "day": day,
            "app_version": app_version or "", "platform": platform_name(),
            "mode": mode if mode in MODES else "team",
            "counters": dict(all_days.get(day) or {}),
            "return_7d": _returned(all_days, day, 7),
            "return_28d": _returned(all_days, day, 28)}


def outbox():
    rows = _read_json(outbox_path(), [])
    return [r for r in rows if isinstance(r, dict) and isinstance(r.get("payload"), dict)]


def _write_outbox(rows):
    _atomic_write(outbox_path(), rows)


def enqueue(now=None, app_version="", mode="team"):
    """Build a payload for every COMPLETE day (before today) that is not queued yet, when the
    person has consented. Returns the outbox. Never sends."""
    c = consent()
    if not c["consented"] or not c["install_id"]:
        return outbox()
    with _lock, _file_lock():
        rows = outbox()
        queued = {r.get("day") for r in rows}
        days = counters()
        cutoff = today((now if now is not None else time.time()) - OUTBOX_MAX_DAYS * 86400)
        changed = False
        for day in sorted(days):
            if day >= today(now) or day in queued or day < cutoff:
                continue
            rows.append({"day": day, "queued_at": int(now if now is not None else time.time()),
                         "payload": payload_for(day, days, c["install_id"], app_version, mode)})
            changed = True
        kept = [r for r in rows if str(r.get("day", "")) >= cutoff]
        if changed or len(kept) != len(rows):
            _write_outbox(kept)
        return kept


def flush(env=None, now=None, opener=None, app_version="", mode="team", log=None,
          timeout=10):
    """Enqueue complete days, then — only in the `active` state — POST each unsent payload to
    the endpoint with urllib. A non-2xx (or any exception) keeps the entry queued. Returns
    {state, sent, queued}. One log line per flush, with the byte count and never the body."""
    env = env if env is not None else dict(os.environ)
    state, _ = decision(env)
    rows = enqueue(now=now, app_version=app_version, mode=mode)
    pending = [r for r in rows if not r.get("sent_at")]
    if state != "active" or not pending:
        return {"state": state, "sent": 0, "queued": len(pending)}
    url = endpoint(env)
    send = opener or urlopen
    sent, nbytes = 0, 0
    for r in pending:
        body = r["payload"]
        try:
            assert_allowed(body)                      # refuse rather than send something odd
        except ValueError as e:
            if log:
                log(f"telemetry: refused payload for {r.get('day')}: {e}")
            continue
        raw = json.dumps(body, sort_keys=True).encode()
        req = Request(url, data=raw, method="POST",
                      headers={"Content-Type": "application/json",
                               "User-Agent": "reviewstage-telemetry/1"})
        try:
            with send(req, timeout=timeout) as resp:
                code = getattr(resp, "status", None) or resp.getcode()
        except Exception:  # noqa: BLE001 — a dead endpoint keeps the day queued, that is all
            continue
        if 200 <= int(code) < 300:
            r["sent_at"] = int(now if now is not None else time.time())
            sent += 1
            nbytes += len(raw)
    if sent:
        with _lock, _file_lock():
            # Re-read: another writer may have appended while we were sending.
            cur = outbox()
            done = {r["day"]: r["sent_at"] for r in pending if r.get("sent_at")}
            for row in cur:
                if row.get("day") in done and not row.get("sent_at"):
                    row["sent_at"] = done[row["day"]]
            _write_outbox(cur)
    if log:
        log(f"telemetry: flushed {sent} day(s), {nbytes:,} bytes, state={state}")
    return {"state": state, "sent": sent, "queued": len(pending) - sent}


# --- what the API hands the UI --------------------------------------------------------------------
def status(env=None):
    env = env if env is not None else dict(os.environ)
    state, reason = decision(env)
    c = consent()
    return {"state": state, "reason": reason, "consented": c["consented"],
            "decided": c["decided"], "counters": counters(), "outbox": outbox(),
            "endpointSet": bool(endpoint(env)), "adminDisabled": not admin_allows(),
            "killSwitch": kill_switch(env),
            "schema": {e: {k: (list(v) if v != SLUG else "slug") for k, v in dims.items()}
                       for e, dims in SCHEMA.items()},
            "derived": list(DERIVED)}


def export_bundle(env=None):
    """The three files as one JSON document, for the Export button."""
    return {"exported_at": int(time.time()), "state": decision(env)[0],
            "consent": consent(), "counters": {"schema": SCHEMA_VERSION, "days": counters()},
            "outbox": outbox()}


def start_daemon(env_fn, app_version="", mode_fn=None, interval=86400, log=None):
    """Flush once a day from a daemon thread. Never holds any server lock."""
    def loop():
        while True:
            time.sleep(interval)
            with contextlib.suppress(Exception):
                flush(env=env_fn(), app_version=app_version,
                      mode=mode_fn() if mode_fn else "team", log=log)
    t = threading.Thread(target=loop, name="telemetry-flush", daemon=True)
    t.start()
    return t


# --- CLI, for the shell job scripts ----------------------------------------------------------------
# bin/run-review.sh:  python3 rs_telemetry.py bump review_completed outcome=done
#                     python3 rs_telemetry.py bump findings_shown --n 4
def _main(argv):
    if len(argv) < 2 or argv[0] != "bump":
        return 2
    event, n, dims = argv[1], 1, {}
    it = iter(argv[2:])
    for a in it:
        if a == "--n":
            n = next(it, "1")
        elif "=" in a:
            k, v = a.split("=", 1)
            dims[k] = v
    return 0 if bump(event, n=n, **dims) else 1


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
