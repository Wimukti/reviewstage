#!/usr/bin/env python3
"""Device sign-in over real HTTP (bin/server.py), and who a rate limit is actually about.

Two failures found on a live install, both in this path:

  * **Every device sign-in failed with "That code expired before GitHub saw it."** The browser
    binding is one cookie at `Path=/`, and `start` minted a fresh nonce every time, overwriting
    it. A second `start` — the browser was observed issuing two 0.4s apart — therefore orphaned
    the first: poll() saw a nonce that no longer matched, answered `unknown`, and the page
    rendered that as expired. Proven below as start A, start B, poll A.
  * **One rate-limit bucket for everybody.** `client_key()` fell back to the peer address,
    which behind Docker's published port is the bridge gateway for every client on earth. Five
    people signing in together shared one bucket, and about 55 requests refused the next
    genuine sign-in. It also trusted `X-Forwarded-For` from anyone, so the bucket was pickable.

Run: python3 -m unittest bin/test_rs_device_signin.py
"""
import importlib
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rs_device_flow as df  # noqa: E402


class FakeGitHub(BaseHTTPRequestHandler):
    """Hands out a code pair, and answers every token poll with authorization_pending — until a
    test flips `approved`, after which every poll hands over a token, the way GitHub does once
    the person has typed the code in."""

    approved = False

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        parse_qs(self.rfile.read(n).decode())
        if self.path == "/login/device/code":
            body = {"device_code": "dc-" + os.urandom(4).hex(), "user_code": "ABCD-1234",
                    "verification_uri": "https://github.com/login/device",
                    "expires_in": 900, "interval": 1}
        elif FakeGitHub.approved:
            body = {"access_token": "gho_fake_from_device_flow", "token_type": "bearer",
                    "scope": "repo"}
        else:
            body = {"error": "authorization_pending"}
        raw = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class Browser:
    """A cookie jar. Two Browsers are two people, which is the whole point of these tests."""

    def __init__(self, case, extra=None):
        self.case = case
        self.jar = {}
        self.extra = extra or {}

    def post(self, path, body=None):
        raw = json.dumps(body or {}).encode()
        headers = {"Content-Type": "application/json", "Content-Length": str(len(raw))}
        if self.jar:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.jar.items())
        headers.update(self.extra)
        c = HTTPConnection("127.0.0.1", self.case.port, timeout=10)
        c.request("POST", path, raw, headers)
        r = c.getresponse()
        out, status = r.read(), r.status
        for _, v in r.getheaders():
            pass
        for value in [v for k, v in r.getheaders() if k.lower() == "set-cookie"]:
            jar = SimpleCookie(value)
            for k, m in jar.items():
                if m.value:
                    self.jar[k] = m.value
                else:
                    self.jar.pop(k, None)
        c.close()
        try:
            return status, json.loads(out.decode() or "{}")
        except ValueError:
            return status, {}

    def get(self, path):
        headers = {"Cookie": "; ".join(f"{k}={v}" for k, v in self.jar.items())} if self.jar else {}
        headers.update(self.extra)
        c = HTTPConnection("127.0.0.1", self.case.port, timeout=10)
        c.request("GET", path, headers=headers)
        r = c.getresponse()
        r.read()
        for value in [v for k, v in r.getheaders() if k.lower() == "set-cookie"]:
            for k, m in SimpleCookie(value).items():
                if m.value:
                    self.jar[k] = m.value
        c.close()
        return r.status


class DeviceSignIn(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tempfile.mkdtemp()
        os.makedirs(os.path.join(cls.root, "state"), exist_ok=True)
        with open(os.path.join(cls.root, ".env"), "w") as f:
            f.write("RS_SECRET=" + "a" * 64 + "\nREPOS=acme/widgets\nGITHUB_PAT=service-token\n")
        os.environ["ROOT"] = cls.root
        os.environ["RS_COOKIE_SECURE"] = "0"
        cls.srv = (importlib.reload(sys.modules["server"]) if "server" in sys.modules
                   else importlib.import_module("server"))

        cls.gh = ThreadingHTTPServer(("127.0.0.1", 0), FakeGitHub)
        threading.Thread(target=cls.gh.serve_forever, daemon=True).start()
        cls.srv.DEVICE_FLOW = df.DeviceFlow(
            "cid-test", "repo", base=f"http://127.0.0.1:{cls.gh.server_address[1]}")
        cls.srv.DEVICE_FLOW_ENABLED = True

        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), cls.srv.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close()
        cls.gh.shutdown(); cls.gh.server_close()
        shutil.rmtree(cls.root, ignore_errors=True)

    def setUp(self):
        for lim in list(self.srv.RATE.values()) + list(self.srv.RATE_ADDR.values()):
            lim._buckets.clear()
        self.srv.TRUSTED_PROXIES = set()

    # -- the reported failure ----------------------------------------------------------------
    def test_a_second_start_does_not_orphan_the_first(self):
        """start A, start B from one browser, poll A — the exact sequence off the live box."""
        b = Browser(self)
        _, a = b.post("/api/auth/device/start")
        nonce_a = b.jar.get(self.srv.DEVICE_NONCE_COOKIE)
        _, second = b.post("/api/auth/device/start")
        nonce_b = b.jar.get(self.srv.DEVICE_NONCE_COOKIE)

        self.assertNotEqual(a["session"], second["session"])
        self.assertEqual(nonce_a, nonce_b, "the browser binding must survive a second start")

        # Before the fix this answered {"status": "expired"} — the HTTP layer reports an
        # unrecognised or mis-bound session as expired, which is the message off the live box.
        status, ra = b.post("/api/auth/device/poll", {"session": a["session"]})
        self.assertEqual((status, ra.get("status")), (200, "pending"), ra)
        _, rb = b.post("/api/auth/device/poll", {"session": second["session"]})
        self.assertEqual(rb.get("status"), "pending", rb)

    def test_another_browser_still_cannot_poll_it(self):
        """The security property the nonce exists for, unchanged by the reuse."""
        mine = Browser(self)
        _, a = mine.post("/api/auth/device/start")
        mine.post("/api/auth/device/start")

        # `unknown` reaches the browser as "expired" on purpose: a wrong session id and a
        # session bound to someone else must be indistinguishable.
        theirs = Browser(self)
        _, r = theirs.post("/api/auth/device/poll", {"session": a["session"]})
        self.assertEqual(r.get("status"), "expired")

        theirs.post("/api/auth/device/start")   # gives them a nonce of their own
        _, r = theirs.post("/api/auth/device/poll", {"session": a["session"]})
        self.assertEqual(r.get("status"), "expired")

    def test_a_stale_nonce_is_not_reused(self):
        """Nothing live behind the cookie: mint a fresh binding rather than keep an old one."""
        b = Browser(self)
        _, a = b.post("/api/auth/device/start")
        first = b.jar[self.srv.DEVICE_NONCE_COOKIE]
        b.post("/api/auth/device/cancel", {"session": a["session"]})
        b.post("/api/auth/device/start")
        self.assertNotEqual(b.jar[self.srv.DEVICE_NONCE_COOKIE], first)

    # -- rate limiting is about a browser, not an address -------------------------------------
    def test_one_persons_retries_do_not_lock_out_the_next_person(self):
        """Every request here arrives from 127.0.0.1, as they all do behind Docker's bridge."""
        flooder = Browser(self)
        flooder.get("/")                       # picks up its rate-limit cookie
        refused = 0
        for _ in range(30):
            status, _ = flooder.post("/api/auth/device/start")
            refused += status == 429
        self.assertGreater(refused, 0, "one browser must still be limited")

        newcomer = Browser(self)
        newcomer.get("/")
        status, body = newcomer.post("/api/auth/device/start")
        self.assertEqual(status, 200, body)

    def test_an_address_still_has_a_ceiling(self):
        """Rotating the cookie must not buy unlimited sign-ins from one place."""
        seen = set()
        for _ in range(200):
            status, _ = Browser(self).post("/api/auth/device/start")
            seen.add(status)
            if 429 in seen:
                break
        self.assertIn(429, seen)

    def test_a_429_says_how_long_to_wait(self):
        b = Browser(self)
        b.get("/")
        for _ in range(30):
            status, body = b.post("/api/auth/device/start")
            if status == 429:
                self.assertGreaterEqual(int(body["retry_after"]), 1)
                return
        self.fail("never refused")

    def test_the_shell_hands_out_the_rate_limit_cookie_once(self):
        b = Browser(self)
        b.get("/")
        first = b.jar.get(self.srv.CLIENT_COOKIE)
        self.assertTrue(first)
        b.get("/")
        self.assertEqual(b.jar.get(self.srv.CLIENT_COOKIE), first)


    def test_a_completed_sign_in_stores_the_token_and_the_session_works(self):
        """End to end over HTTP, through the part no test reached before: GitHub hands over a
        token, the server verifies it, encrypts it, writes users.json and sets the cookie.

        Descriptor 3 is held for the duration. The at-rest cipher forks openssl with the key on
        a pipe and used to tell it to read from fd:3 no matter where the pipe landed; inside a
        server the listening socket sits there, so every stored token failed to encrypt and a
        completed sign-in crashed. Every existing test here stopped at authorization_pending,
        which is how that shipped."""
        from unittest import mock
        held = []
        while True:
            fd = os.open(os.devnull, os.O_RDONLY)
            held.append(fd)
            if fd >= 3:
                break
        for fd in held:
            self.addCleanup(os.close, fd)
        FakeGitHub.approved = True
        self.addCleanup(setattr, FakeGitHub, "approved", False)
        b = Browser(self)
        st, r = b.post("/api/auth/device/start")
        self.assertEqual(st, 200)
        session = r["session"]
        # verify_pat talks to the real GitHub API; the token is fake, so answer for it.
        with mock.patch.object(self.srv, "verify_pat", return_value=("ann", "Ann Example", "")):
            st, r = b.post("/api/auth/device/poll", {"session": session})
        self.assertEqual(st, 200, r)
        self.assertEqual(r.get("status"), "ok", r)
        self.assertEqual(r.get("login"), "ann")
        self.assertIn("rs_session", b.jar, "no session cookie was set")
        # The cookie is a real session: an authenticated route answers.
        self.assertEqual(b.get("/api/me"), 200)
        # And the token on disk is the one GitHub handed over, decryptable by the server.
        u = self.srv.load_users()["ann"]
        self.assertEqual(self.srv.dec(u["gh_token_enc"]), "gho_fake_from_device_flow")

    def test_a_device_token_is_refreshed_through_the_device_client(self):
        """Device-flow tokens last eight hours. The refresh used the OAuth App's id and secret —
        both empty on a desktop install — so GitHub refused it, the server returned no token,
        and eight hours after sign-in the repository list and the poller both stopped
        (seen live, 10/05/26). The issuer is recorded at sign-in and the refresh goes through
        that client: the public device id, and never a secret."""
        import time
        from unittest import mock
        sent = []

        class Resp:
            def __init__(self, body): self.body = body
            def read(self): return self.body
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_urlopen(req, timeout=20):
            sent.append(dict(__import__("urllib.parse", fromlist=["parse_qsl"]).parse_qsl(
                req.data.decode())))
            return Resp(json.dumps({"access_token": "ghu_new", "expires_in": 28800,
                                    "refresh_token": "ghr_new",
                                    "refresh_token_expires_in": 15724800}).encode())

        prev = {"name": "Ann"}
        self.srv.oauth_store("ann2", {"access_token": "ghu_old", "expires_in": 28800,
                                      "refresh_token": "ghr_old",
                                      "refresh_token_expires_in": 15724800}, "Ann", prev,
                             client="device")
        u = self.srv.load_users()["ann2"]
        self.assertEqual(u["gh_client"], "device")
        # Expire it, as eight hours would.
        u["gh_exp"] = int(time.time()) - 3600
        self.srv.modify_users(lambda users: users.__setitem__("ann2", u))
        with mock.patch.object(self.srv, "urlopen", fake_urlopen), \
             mock.patch.object(self.srv, "GH_CLIENT_ID", ""), \
             mock.patch.object(self.srv, "GH_CLIENT_SECRET", ""):
            tok = self.srv.user_pat("ann2")
        self.assertEqual(tok, "ghu_new")
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["client_id"], self.srv.REFRESH_DEVICE_CLIENT_ID)
        self.assertNotIn("client_secret", sent[0])
        self.assertEqual(sent[0]["grant_type"], "refresh_token")
        self.assertEqual(sent[0]["refresh_token"], "ghr_old")
        u = self.srv.load_users()["ann2"]
        self.assertEqual(self.srv.dec(u["gh_token_enc"]), "ghu_new")
        self.assertEqual(u["gh_client"], "device", "a refresh keeps the issuer")

    def test_a_token_stored_before_the_issuer_was_recorded_refreshes_via_device(self):
        """Installs signed in before rc.39 have no gh_client. With no OAuth App configured only
        the device flow can have issued the token, so that is the client the refresh uses."""
        import time
        from unittest import mock
        sent = []

        class Resp:
            def read(self): return json.dumps({"access_token": "ghu_x", "expires_in": 28800}).encode()
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_urlopen(req, timeout=20):
            sent.append(req.data.decode())
            return Resp()

        u = {"name": "Old", "gh_token_enc": self.srv.enc("ghu_old"),
             "gh_refresh_enc": self.srv.enc("ghr_old"), "gh_exp": int(time.time()) - 60}
        self.srv.modify_users(lambda users: users.__setitem__("old", u))
        with mock.patch.object(self.srv, "urlopen", fake_urlopen), \
             mock.patch.object(self.srv, "GH_CLIENT_ID", ""):
            self.assertEqual(self.srv.user_pat("old"), "ghu_x")
        self.assertIn(f"client_id={self.srv.REFRESH_DEVICE_CLIENT_ID}", sent[0])
        self.assertNotIn("client_secret", sent[0])

    def test_a_storage_failure_is_reported_not_disguised_as_expired(self):
        """If storing the token fails after GitHub has issued it, the code is spent. The old
        handler crashed, the browser re-polled and was told the code had expired — a GitHub
        fault in the reviewer's eyes for a bug that was this box's."""
        from unittest import mock
        FakeGitHub.approved = True
        self.addCleanup(setattr, FakeGitHub, "approved", False)
        b = Browser(self)
        _st, r = b.post("/api/auth/device/start")
        with mock.patch.object(self.srv, "verify_pat", return_value=("bob", "Bob", "")), \
             mock.patch.object(self.srv, "oauth_store",
                               side_effect=RuntimeError("Error getting password")):
            st, r = b.post("/api/auth/device/poll", {"session": r["session"]})
        self.assertEqual(st, 200)
        self.assertEqual(r.get("status"), "error")
        self.assertIn("could not store the token", r.get("error", ""))
        self.assertIn("Error getting password", r.get("error", ""))
        self.assertNotIn("rs_session", b.jar)


class ForwardedFor(unittest.TestCase):
    """X-Forwarded-For is a request header: believing it from anyone let a client pick its own
    rate-limit bucket, or somebody else's."""

    def handler(self, peer, xff=None):
        srv = sys.modules["server"]
        h = srv.Handler.__new__(srv.Handler)
        h.client_address = (peer, 12345)
        h.headers = {"X-Forwarded-For": xff} if xff else {}
        return h

    def setUp(self):
        self.srv = sys.modules["server"]
        self.saved = self.srv.TRUSTED_PROXIES

    def tearDown(self):
        self.srv.TRUSTED_PROXIES = self.saved

    def test_an_untrusted_peer_cannot_name_itself(self):
        self.srv.TRUSTED_PROXIES = set()
        self.assertEqual(self.handler("172.20.0.1", "9.9.9.9").client_addr(), "172.20.0.1")

    def test_a_trusted_proxy_is_believed(self):
        self.srv.TRUSTED_PROXIES = {"10.0.0.5"}
        self.assertEqual(self.handler("10.0.0.5", "203.0.113.7").client_addr(), "203.0.113.7")

    def test_only_the_hop_the_proxy_added_is_believed(self):
        """Everything left of the proxy's own entry is whatever the client chose to send."""
        self.srv.TRUSTED_PROXIES = {"10.0.0.5"}
        h = self.handler("10.0.0.5", "1.2.3.4, 203.0.113.7")
        self.assertEqual(h.client_addr(), "203.0.113.7")

    def test_a_chain_of_trusted_proxies_resolves_to_the_client(self):
        self.srv.TRUSTED_PROXIES = {"10.0.0.5", "10.0.0.6"}
        h = self.handler("10.0.0.5", "203.0.113.7, 10.0.0.6")
        self.assertEqual(h.client_addr(), "203.0.113.7")


if __name__ == "__main__":
    unittest.main()
