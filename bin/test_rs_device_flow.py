#!/usr/bin/env python3
"""Unit tests for the GitHub device flow (bin/rs_device_flow.py) against a fake GitHub on
localhost: start, every poll outcome GitHub documents (authorization_pending, slow_down,
expired_token, access_denied, success), the per-session minimum polling interval, the pending
cap and purge, and that the device_code never leaks to the browser payload.
Run: python3 -m unittest bin/test_rs_device_flow.py"""
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rs_device_flow as df  # noqa: E402


class FakeGitHub(BaseHTTPRequestHandler):
    """Scripted GitHub: /login/device/code answers from `codes`, /login/oauth/access_token pops
    the next scripted answer from `script` (a list of dicts). Every request is recorded."""
    codes = {}
    script = []
    requests = []
    lock = threading.Lock()

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        form = {k: v[0] for k, v in parse_qs(self.rfile.read(n).decode()).items()}
        with FakeGitHub.lock:
            FakeGitHub.requests.append((self.path, form))
            if self.path == "/login/device/code":
                body, status = dict(FakeGitHub.codes), 200
            elif self.path == "/login/oauth/access_token":
                nxt = FakeGitHub.script.pop(0) if FakeGitHub.script else {"error": "no_script"}
                status = nxt.pop("_status", 200)
                body = nxt
            else:
                body, status = {"error": "not_found"}, 404
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


class DeviceFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeGitHub)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        FakeGitHub.codes = {"device_code": "dc-secret", "user_code": "ABCD-1234",
                            "verification_uri": "https://github.com/login/device",
                            "expires_in": 900, "interval": 5}
        FakeGitHub.script = []
        FakeGitHub.requests = []
        self.clock = Clock()
        self.flow = df.DeviceFlow("cid-test", "repo", base=self.base, now=self.clock,
                                  max_pending=3)

    def start(self):
        payload, err = self.flow.start()
        self.assertIsNone(err)
        return payload

    # -- start ------------------------------------------------------------------------------
    def test_start_returns_user_code_and_hides_device_code(self):
        p = self.start()
        self.assertEqual(p["user_code"], "ABCD-1234")
        self.assertEqual(p["verification_uri"], "https://github.com/login/device")
        self.assertEqual(p["interval"], 5)
        self.assertEqual(p["expires_in"], 900)
        self.assertTrue(len(p["session"]) >= 24)
        self.assertNotIn("dc-secret", json.dumps(p))
        path, form = FakeGitHub.requests[0]
        self.assertEqual(path, "/login/device/code")
        self.assertEqual(form, {"client_id": "cid-test", "scope": "repo"})

    def test_start_reports_github_errors(self):
        FakeGitHub.codes = {"error": "unauthorized_client",
                            "error_description": "device flow is not enabled"}
        p, err = self.flow.start()
        self.assertIsNone(p)
        self.assertIn("device flow is not enabled", err)

    def test_disabled_when_client_id_empty(self):
        f = df.DeviceFlow("", base=self.base)
        self.assertFalse(f.enabled)
        p, err = f.start()
        self.assertIsNone(p)
        self.assertTrue(err)

    # -- poll outcomes ----------------------------------------------------------------------
    def poll_after(self, session, secs):
        self.clock.t += secs
        return self.flow.poll(session)

    def test_pending(self):
        s = self.start()["session"]
        FakeGitHub.script = [{"error": "authorization_pending"}]
        res, tok = self.poll_after(s, 5)
        self.assertEqual(res, {"status": "pending", "interval": 5})
        self.assertIsNone(tok)
        path, form = FakeGitHub.requests[-1]
        self.assertEqual(path, "/login/oauth/access_token")
        self.assertEqual(form, {"client_id": "cid-test", "device_code": "dc-secret",
                                "grant_type": df.GRANT_TYPE})

    def test_slow_down_widens_the_interval(self):
        s = self.start()["session"]
        FakeGitHub.script = [{"error": "slow_down"}, {"error": "authorization_pending"}]
        res, _ = self.poll_after(s, 5)
        self.assertEqual(res, {"status": "pending", "interval": 10})
        # The old interval is now too fast; the new one is honoured.
        res, _ = self.poll_after(s, 5)
        self.assertEqual(res["status"], "too_fast")
        res, _ = self.poll_after(s, 5)
        self.assertEqual(res, {"status": "pending", "interval": 10})

    def test_expired(self):
        s = self.start()["session"]
        FakeGitHub.script = [{"error": "expired_token"}]
        res, _ = self.poll_after(s, 5)
        self.assertEqual(res, {"status": "expired"})
        # The session is gone; a further poll is "unknown".
        res, _ = self.poll_after(s, 5)
        self.assertEqual(res, {"status": "unknown"})

    def test_denied(self):
        s = self.start()["session"]
        FakeGitHub.script = [{"error": "access_denied"}]
        res, _ = self.poll_after(s, 5)
        self.assertEqual(res, {"status": "denied"})
        self.assertEqual(self.flow.pending_count(), 0)

    def test_ok_returns_tokens_once(self):
        s = self.start()["session"]
        FakeGitHub.script = [{"error": "authorization_pending"},
                             {"access_token": "gho_x", "token_type": "bearer", "scope": "repo",
                              "expires_in": 28800, "refresh_token": "ghr_y"}]
        res, _ = self.poll_after(s, 5)
        self.assertEqual(res["status"], "pending")
        res, tok = self.poll_after(s, 5)
        self.assertEqual(res, {"status": "ok"})
        self.assertEqual(tok["access_token"], "gho_x")
        self.assertEqual(tok["refresh_token"], "ghr_y")
        self.assertEqual(tok["expires_in"], 28800)
        # Single use: the session is consumed with the token.
        res, tok = self.poll_after(s, 5)
        self.assertEqual(res, {"status": "unknown"})
        self.assertIsNone(tok)

    def test_error_body_on_http_error_status_is_still_read(self):
        s = self.start()["session"]
        FakeGitHub.script = [{"_status": 400, "error": "incorrect_device_code",
                              "error_description": "The device code is incorrect."}]
        res, _ = self.poll_after(s, 5)
        self.assertEqual(res["status"], "error")
        self.assertIn("incorrect", res["error"])

    def test_unknown_session(self):
        res, tok = self.flow.poll("nope")
        self.assertEqual(res, {"status": "unknown"})
        self.assertIsNone(tok)

    # -- interval enforcement ---------------------------------------------------------------
    def test_polling_faster_than_interval_is_refused_without_calling_github(self):
        s = self.start()["session"]
        FakeGitHub.script = [{"error": "authorization_pending"}] * 3
        before = len(FakeGitHub.requests)
        res, _ = self.flow.poll(s)                       # immediately after start
        self.assertEqual(res["status"], "too_fast")
        self.assertEqual(res["retry_after"], 5)
        self.assertEqual(len(FakeGitHub.requests), before)   # GitHub was not called
        res, _ = self.poll_after(s, 2)
        self.assertEqual(res["status"], "too_fast")
        self.assertEqual(res["retry_after"], 3)
        res, _ = self.poll_after(s, 3)                   # now 5 s since start
        self.assertEqual(res["status"], "pending")
        res, _ = self.poll_after(s, 1)                   # 1 s after the last poll
        self.assertEqual(res["status"], "too_fast")
        self.assertEqual(len(FakeGitHub.requests), before + 1)

    def test_grace_absorbs_timer_jitter(self):
        s = self.start()["session"]
        FakeGitHub.script = [{"error": "authorization_pending"}]
        res, _ = self.poll_after(s, 5 - df.POLL_GRACE / 2)
        self.assertEqual(res["status"], "pending")

    # -- cap and purge ----------------------------------------------------------------------
    def test_expired_sessions_are_purged(self):
        s = self.start()["session"]
        self.assertEqual(self.flow.pending_count(), 1)
        self.clock.t += 901
        self.assertEqual(self.flow.pending_count(), 0)
        res, _ = self.flow.poll(s)
        self.assertEqual(res, {"status": "unknown"})

    def test_pending_cap_evicts_the_oldest(self):
        first = self.start()["session"]
        self.clock.t += 1
        self.start()
        self.clock.t += 1
        self.start()
        self.assertEqual(self.flow.pending_count(), 3)
        self.clock.t += 1
        self.start()                                     # fourth: the first is evicted
        self.assertEqual(self.flow.pending_count(), 3)
        res, _ = self.poll_after(first, 5)
        self.assertEqual(res, {"status": "unknown"})

    def test_forget(self):
        s = self.start()["session"]
        self.flow.forget(s)
        self.assertEqual(self.flow.pending_count(), 0)


if __name__ == "__main__":
    unittest.main()
