#!/usr/bin/env python3
"""GitHub OAuth Device Flow (RFC 8628) for "Sign in with GitHub" without an admin registering
anything: a shared public client ID, no client secret, no callback URL.

The browser never sees GitHub's device_code. `start()` asks GitHub for a code pair, keeps the
device_code here under an opaque session id and hands the browser only the user_code it must
type at github.com/login/device. `poll(session)` exchanges the device_code for a token once the
person has approved, enforcing GitHub's minimum polling interval so a misbehaving client cannot
get this server rate-limited. Sessions are in-memory: a restart just makes people start over.

Two things bind and bound the flow:

  * **A nonce.** `start(nonce=…)` remembers an opaque value the server also drops on the
    browser as a cookie; `poll()` refuses a session whose nonce does not match. Without it the
    start and poll endpoints are unauthenticated and unlinked, so an attacker could start a
    flow here, get a teammate to type the code at github.com, poll, and be handed a session
    cookie as that teammate (see docs/SECURITY.md, "Device-code phishing").
  * **Headroom.** The pending table is capped. A flood of unauthenticated `start` calls used to
    evict the OLDEST entry, which is exactly the sign-in a real person is part-way through, so
    a trivial flood locked the whole team out. Eviction is now most-recent-first and only ever
    takes sessions nobody has polled, and `RESERVED_FOR_ACTIVE` slots are kept back from
    never-polled sessions altogether — a flood gets an error, not everyone else's slot.

The HTTP layer is a plain function (`http_post_form`) so the unit tests can point the flow at a
fake GitHub on localhost. server.py owns everything after a token arrives (verify, encrypt,
session cookie)."""
import json
import secrets
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

GITHUB_BASE = "https://github.com"
DEFAULT_CLIENT_ID = "Ov23liHjtjxcPNwXC6Y5"   # public by design — device flow has no secret
GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
MAX_PENDING = 50          # sessions held at once
RESERVED_FOR_ACTIVE = 15  # of those, kept back from sign-ins nobody has polled yet
DEFAULT_INTERVAL = 5      # GitHub's documented minimum, used when the response omits one
DEFAULT_EXPIRES_IN = 900  # GitHub's user codes last 15 minutes
POLL_GRACE = 1.0          # seconds a poll may arrive early (browser timer jitter)


def http_post_form(url, fields, timeout=20):
    """POST url-encoded fields, Accept JSON. Returns the decoded dict ({} when the body is not
    JSON). GitHub answers 200 for both success and the `error` cases; an HTTP error status is
    still read (its body carries the `error` too)."""
    req = Request(url, data=urlencode(fields).encode(),
                  headers={"Accept": "application/json",
                           "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except HTTPError as e:
        with e:
            raw = e.read()
    try:
        d = json.loads(raw.decode() or "{}")
    except (ValueError, UnicodeDecodeError):
        return {}
    return d if isinstance(d, dict) else {}


class DeviceFlow:
    def __init__(self, client_id, scopes="repo", base=GITHUB_BASE, post=http_post_form,
                 now=time.time, max_pending=MAX_PENDING, reserved=RESERVED_FOR_ACTIVE):
        self.client_id = client_id
        self.scopes = scopes
        self.base = base.rstrip("/")
        self.post = post
        self.now = now
        self.max_pending = max_pending
        self.reserved = min(reserved, max(max_pending - 1, 0))
        # session -> {device_code, interval, expires_at, next_poll, started, nonce, polled}
        self._pending = {}
        self._lock = threading.Lock()

    @property
    def enabled(self):
        return bool(self.client_id)

    # -- housekeeping -----------------------------------------------------------------------
    def _purge(self):
        """Drop expired sessions. Caller holds the lock."""
        t = self.now()
        for k, v in list(self._pending.items()):
            if v["expires_at"] <= t:
                self._pending.pop(k, None)

    def _make_room(self):
        """True when one more never-polled session fits. Caller holds the lock and has purged.

        Sign-ins someone is actually part-way through (polled at least once) are untouchable;
        the cap is enforced against the never-polled ones, keeping `reserved` slots free for
        the active ones. When the room has to be made, the NEWEST never-polled session goes
        first — a flood evicts itself instead of the person who started a minute ago."""
        budget = max(self.max_pending - self.reserved, 1)
        idle = [k for k, v in self._pending.items() if not v.get("polled")]
        while len(idle) >= budget:
            newest = max(idle, key=lambda k: self._pending[k]["started"])
            # Only evict something that has had a fair chance to be typed in; otherwise refuse,
            # so two people starting at once cannot cancel each other.
            if self.now() - self._pending[newest]["started"] < 30:
                return False
            self._pending.pop(newest, None)
            idle.remove(newest)
        return len(self._pending) < self.max_pending

    def pending_count(self):
        with self._lock:
            self._purge()
            return len(self._pending)

    # -- step 1: get a user code ------------------------------------------------------------
    def start(self, nonce=""):
        """→ (browser_payload, error). The payload never includes the device_code.

        `nonce` is remembered with the session and demanded back by poll(); the caller sets it
        on the browser as a cookie so only the browser that started a sign-in can finish it."""
        if not self.enabled:
            return None, "Device flow is not enabled on this server."
        with self._lock:
            self._purge()
            if not self._make_room():
                return None, ("Too many sign-ins are already in progress on this server — "
                              "wait a moment and try again.")
        fields = {"client_id": self.client_id}
        if self.scopes:
            fields["scope"] = self.scopes
        d = self.post(f"{self.base}/login/device/code", fields)
        if not d.get("device_code") or not d.get("user_code"):
            why = d.get("error_description") or d.get("error") or "no code returned"
            return None, f"GitHub did not start the sign-in: {why}"
        interval = max(int(d.get("interval") or DEFAULT_INTERVAL), 1)
        expires_in = int(d.get("expires_in") or DEFAULT_EXPIRES_IN)
        t = self.now()
        session = secrets.token_urlsafe(24)
        with self._lock:
            self._purge()
            if not self._make_room():
                return None, ("Too many sign-ins are already in progress on this server — "
                              "wait a moment and try again.")
            self._pending[session] = {
                "device_code": d["device_code"], "interval": interval,
                "expires_at": t + expires_in, "next_poll": t + interval, "started": t,
                "nonce": nonce or "", "polled": False,
            }
        return {"session": session, "user_code": d["user_code"],
                "verification_uri": d.get("verification_uri")
                or f"{self.base}/login/device",
                "expires_in": expires_in, "interval": interval}, None

    # -- step 2: poll for the token ---------------------------------------------------------
    def poll(self, session, nonce=""):
        """→ (result, tokens). result is a dict with `status` in pending | expired | denied |
        unknown | too_fast | error; tokens is GitHub's token response only when status == ok.
        `too_fast` carries retry_after (seconds) — the caller answers 429.

        A session started with a nonce may only be polled with that same nonce; a mismatch is
        reported as `unknown`, exactly like a session id that was never issued."""
        with self._lock:
            self._purge()
            s = self._pending.get(session or "")
            if not s:
                return {"status": "unknown"}, None
            if not secrets.compare_digest(s.get("nonce") or "", nonce or ""):
                return {"status": "unknown"}, None
            s["polled"] = True
            t = self.now()
            if t + POLL_GRACE < s["next_poll"]:
                return {"status": "too_fast",
                        "retry_after": max(1, int(s["next_poll"] - t + 0.999))}, None
            s["next_poll"] = t + s["interval"]
            device_code, interval = s["device_code"], s["interval"]
        d = self.post(f"{self.base}/login/oauth/access_token",
                      {"client_id": self.client_id, "device_code": device_code,
                       "grant_type": GRANT_TYPE})
        if d.get("access_token"):
            with self._lock:
                self._pending.pop(session, None)
            return {"status": "ok"}, d
        err = d.get("error", "")
        if err == "authorization_pending":
            return {"status": "pending", "interval": interval}, None
        if err == "slow_down":
            new = int(d.get("interval") or interval + 5)
            new = max(new, interval + 5)
            with self._lock:
                if session in self._pending:
                    self._pending[session]["interval"] = new
                    self._pending[session]["next_poll"] = self.now() + new
            return {"status": "pending", "interval": new}, None
        with self._lock:
            self._pending.pop(session, None)
        if err == "expired_token":
            return {"status": "expired"}, None
        if err == "access_denied":
            return {"status": "denied"}, None
        return {"status": "error",
                "error": d.get("error_description") or err or "GitHub returned no token"}, None

    def forget(self, session, nonce=""):
        """Hand a slot back early (the browser's Cancel). Nonce-checked like poll(), so a
        session id cannot be cancelled by anyone but the browser that started it."""
        with self._lock:
            s = self._pending.get(session or "")
            if s and secrets.compare_digest(s.get("nonce") or "", nonce or ""):
                self._pending.pop(session, None)
