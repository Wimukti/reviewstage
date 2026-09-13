#!/usr/bin/env python3
"""Device tokens — the revocable bearer credential a mobile app, a CLI or a second browser
holds instead of the session cookie. Spec: docs/MOBILE.md ("Auth for a mobile client").

Only the SHA-256 of a token is ever stored:

    users[login]["devices"] = {sha256_hex: {"id", "name", "created", "last_seen"}}

This module is pure (dict in, dict out) so the server, the poller's nightly prune and the unit
tests share one implementation. `python3 rs_devices.py prune <users.json>` is the CLI the
poller calls.
"""
import base64
import json
import os
import secrets
import sys
import time
from hashlib import sha256

MAX_DEVICES = 10                     # per user; the oldest is evicted past this
TTL_SECONDS = 180 * 24 * 3600        # sliding: 180 days since last use
LAST_SEEN_BUMP = 60                  # write last_seen at most once a minute
NAME_MAX = 60


def hash_token(token):
    return sha256(token.encode()).hexdigest()


def new_token():
    """32 random bytes, base64url without padding (43 chars)."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")


def parse_bearer(headers):
    """The token from `Authorization: Bearer <tok>`, or "" when absent or malformed."""
    h = (headers.get("Authorization") or "").strip()
    scheme, _, tok = h.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    tok = tok.strip()
    # Tokens are base64url; anything else (spaces, quotes, absurd length) is not ours.
    if not tok or len(tok) > 128 or not all(c.isalnum() or c in "-_" for c in tok):
        return ""
    return tok


def clean_name(name):
    name = " ".join(str(name or "").split())[:NAME_MAX]
    return name or "Unnamed device"


def expired(rec, now=None):
    """True when the device has not been used for TTL_SECONDS (created counts as first use)."""
    now = time.time() if now is None else now
    try:
        last = int(rec.get("last_seen") or rec.get("created") or 0)
    except (TypeError, ValueError):
        return True
    return now - last > TTL_SECONDS


def add_device(u, name, now=None):
    """Mint a token for user record `u` (mutated in place). Returns (token, record, evicted)
    where `evicted` is the list of device names dropped to stay under MAX_DEVICES."""
    now = int(time.time() if now is None else now)
    devices = u.setdefault("devices", {})
    if not isinstance(devices, dict):
        devices = u["devices"] = {}
    tok = new_token()
    rec = {"id": secrets.token_hex(8), "name": clean_name(name), "created": now,
           "last_seen": now}
    devices[hash_token(tok)] = rec
    evicted = []
    while len(devices) > MAX_DEVICES:
        # Oldest by last use — an idle device goes before a busy one of the same age.
        oldest = min((h for h in devices if h != hash_token(tok)),
                     key=lambda h: (int(devices[h].get("last_seen") or 0),
                                    int(devices[h].get("created") or 0)))
        evicted.append(devices[oldest].get("name", ""))
        del devices[oldest]
    return tok, rec, evicted


def lookup(users, token, now=None):
    """(login, hash, record) for a live token, else (None, None, None). A token whose user
    was removed from users.json, or that has aged out, is refused."""
    if not token:
        return None, None, None
    h = hash_token(token)
    for login, u in users.items():
        devices = (u or {}).get("devices") or {}
        rec = devices.get(h) if isinstance(devices, dict) else None
        if rec is not None:
            if expired(rec, now):
                return None, None, None
            return login, h, rec
    return None, None, None


def needs_bump(rec, now=None):
    now = time.time() if now is None else now
    try:
        return now - int(rec.get("last_seen") or 0) >= LAST_SEEN_BUMP
    except (TypeError, ValueError):
        return True


def list_devices(u, current_hash=None):
    """What the UI sees: never the hash, never the token."""
    devices = (u or {}).get("devices") or {}
    rows = [{"id": r.get("id", ""), "name": r.get("name", ""),
             "created": int(r.get("created") or 0), "last_seen": int(r.get("last_seen") or 0),
             "current": h == current_hash}
            for h, r in devices.items() if isinstance(r, dict)]
    rows.sort(key=lambda r: -r["created"])
    return rows


def revoke(u, device_id=None, all_devices=False):
    """Drop one device (by id) or every device. Returns how many were removed."""
    devices = (u or {}).get("devices") or {}
    if not isinstance(devices, dict):
        return 0
    if all_devices:
        n = len(devices)
        devices.clear()
        return n
    doomed = [h for h, r in devices.items() if isinstance(r, dict) and r.get("id") == device_id]
    for h in doomed:
        del devices[h]
    return len(doomed)


def prune(users, now=None):
    """Remove expired devices from every user, in place. Returns how many were dropped."""
    n = 0
    for u in users.values():
        devices = (u or {}).get("devices")
        if not isinstance(devices, dict):
            continue
        dead = [h for h, r in devices.items() if not isinstance(r, dict) or expired(r, now)]
        for h in dead:
            del devices[h]
        n += len(dead)
    return n


def _cli_prune(path):
    """Nightly prune of users.json. Writes only when something changed (atomic replace, mode
    600) so the poller almost never races the server, which is the file's real owner."""
    try:
        with open(path) as f:
            users = json.load(f) or {}
    except (OSError, ValueError):
        print(f"prune: cannot read {path}", file=sys.stderr)
        return 1
    n = prune(users)
    if not n:
        print("prune: no expired device tokens")
        return 0
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(users, f, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    print(f"prune: dropped {n} expired device token(s)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "prune":
        raise SystemExit(_cli_prune(sys.argv[2]))
    print("usage: rs_devices.py prune <users.json>", file=sys.stderr)
    raise SystemExit(2)
