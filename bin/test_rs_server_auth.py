#!/usr/bin/env python3
"""Security regressions in the server's auth layer (bin/server.py).

Every test here fails on the code as it was before the fix it names. The three the audit asked
for specifically:

  * an empty RS_SECRET must stop the server, not sign sessions with a key anyone can reproduce
  * a device token must stop working when RS_SECRET is rotated
  * Content-Length must be bounded and validated before a byte of the body is read

Run: python3 -m unittest bin/test_rs_server_auth.py
"""
import hmac
import importlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from hashlib import sha256
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

GOOD_SECRET = "a" * 64


def write_env(root, secret=GOOD_SECRET, extra=""):
    os.makedirs(os.path.join(root, "state"), exist_ok=True)
    with open(os.path.join(root, ".env"), "w") as f:
        f.write(f"RS_SECRET={secret}\nREPOS=acme/widgets\nGITHUB_PAT=service-token\n{extra}")


def load_server(root):
    """Import (or re-import) server.py against a throwaway ROOT."""
    os.environ["ROOT"] = root
    os.environ["RS_COOKIE_SECURE"] = "0"
    if "server" in sys.modules:
        return importlib.reload(sys.modules["server"])
    return importlib.import_module("server")


class ServerCase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        write_env(self.root)
        self.srv = load_server(self.root)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)


# --- item 1: an empty RS_SECRET is fatal -------------------------------------------------------
class EmptySecretIsFatal(ServerCase):
    def test_secret_problem_flags_empty_and_short(self):
        self.assertIn("empty", self.srv.secret_problem(""))
        self.assertIn("empty", self.srv.secret_problem("   "))
        self.assertIsNotNone(self.srv.secret_problem("short"))
        self.assertIsNotNone(self.srv.secret_problem("x" * 31))
        self.assertIsNone(self.srv.secret_problem("x" * 32))

    def test_server_refuses_to_start_without_a_secret(self):
        """The forgery the auditor pulled off only worked because startup let this through."""
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        write_env(root, secret="")
        env = {**os.environ, "ROOT": root, "RS_PORT": "0"}
        r = subprocess.run([sys.executable, os.path.join(HERE, "server.py")],
                           capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("RS_SECRET", r.stdout + r.stderr)
        self.assertNotIn("listening on", r.stdout)

    def test_a_real_secret_still_starts(self):
        """Control: the same startup path with a good secret gets past the secret check."""
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        write_env(root, secret=GOOD_SECRET)
        env = {**os.environ, "ROOT": root, "RS_PORT": "0", "RS_BIND": "127.0.0.1"}
        proc = subprocess.Popen([sys.executable, os.path.join(HERE, "server.py")],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                env=env)
        self.addCleanup(proc.kill)
        seen = []
        for _ in range(10):
            line = proc.stdout.readline()
            seen.append(line)
            if "listening on" in line:
                return
            if not line:
                break
        self.fail("server did not start: " + "".join(seen))

    def test_a_forged_cookie_signed_with_the_empty_key_is_refused(self):
        """What the auditor sent. With a real secret configured it must not verify."""
        self.srv.save_users({"victim": {"name": "V"}})
        exp = int(time.time()) + 3600
        forged = hmac.new(b"", f"session:victim:{exp}:0".encode(), sha256).hexdigest()
        headers = {"Cookie": f"rs_session=victim:{exp}:{forged}"}
        self.assertIsNone(self.srv.session_user(headers))


# --- item 2: device tokens die with the secret, and with "sign out everywhere" -----------------
class DeviceTokensAreKeyedToTheSecret(ServerCase):
    def mint(self, login="alice"):
        users = {login: {"name": login}}
        tok, _, _ = self.srv.rs_dev.add_device(users[login], "Phone",
                                               key=self.srv.device_key(login, users[login]))
        self.srv.save_users(users)
        return tok

    def test_token_resolves_before_rotation(self):
        tok = self.mint()
        self.assertEqual(self.srv.bearer_user({"Authorization": f"Bearer {tok}"}), "alice")

    def test_rotating_rs_secret_revokes_every_device_token(self):
        """docs/SECURITY.md promises rotation invalidates stored credentials. Before the fix
        the device hash was a bare sha256 of the token, so it survived rotation and handed the
        attacker a persistent credential that regained full power under the new secret."""
        tok = self.mint()
        self.srv.SECRET = "b" * 64                       # what a restart after rotation sees
        self.assertIsNone(self.srv.bearer_user({"Authorization": f"Bearer {tok}"}))

    def test_the_stored_hash_is_not_a_bare_sha256_of_the_token(self):
        tok = self.mint()
        stored = set(self.srv.load_users()["alice"]["devices"])
        self.assertNotIn(sha256(tok.encode()).hexdigest(), stored)

    def test_bumping_the_epoch_revokes_only_that_users_tokens(self):
        a = self.mint("alice")
        users = self.srv.load_users()
        users["bob"] = {"name": "bob"}
        b, _, _ = self.srv.rs_dev.add_device(users["bob"], "Laptop",
                                             key=self.srv.device_key("bob", users["bob"]))
        self.srv.save_users(users)
        self.srv.bump_epoch("alice")
        self.assertIsNone(self.srv.bearer_user({"Authorization": f"Bearer {a}"}))
        self.assertEqual(self.srv.bearer_user({"Authorization": f"Bearer {b}"}), "bob")


# --- item 6: "sign out everywhere" reaches session cookies too ---------------------------------
class SignOutEverywhereRevokesCookies(ServerCase):
    def test_epoch_bump_invalidates_an_outstanding_session_cookie(self):
        self.srv.save_users({"alice": {"name": "alice"}})
        cookie = self.srv.session_cookie("alice").split(";")[0]
        self.assertEqual(self.srv.session_user({"Cookie": cookie}), "alice")
        self.srv.bump_epoch("alice")
        self.assertIsNone(self.srv.session_user({"Cookie": cookie}))

    def test_a_fresh_cookie_after_the_bump_works(self):
        self.srv.save_users({"alice": {"name": "alice"}})
        self.srv.bump_epoch("alice")
        cookie = self.srv.session_cookie("alice").split(";")[0]
        self.assertEqual(self.srv.session_user({"Cookie": cookie}), "alice")


# --- item 16: gh() must not fall back to the service token -------------------------------------
class GhNeverFallsBackToTheServiceToken(ServerCase):
    def test_empty_token_raises(self):
        for bad in ("", None):
            with self.assertRaises(ValueError):
                self.srv.gh(["api", "user"], token=bad)

    def test_service_reads_are_explicit_and_still_work(self):
        self.assertIs(self.srv.gh.__defaults__[1], self.srv.SERVICE_TOKEN)


# --- item 13: query strings never reach the log ------------------------------------------------
class LogRedaction(ServerCase):
    def test_signed_query_strings_are_redacted(self):
        import io
        import contextlib
        h = self.srv.Handler.__new__(self.srv.Handler)
        h.address_string = lambda: "10.0.0.1"
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            h.log_message('"%s" %s -', "GET /handoff?login=a&exp=1&sig=deadbeef HTTP/1.1", "303")
        out = buf.getvalue()
        self.assertNotIn("deadbeef", out)
        self.assertIn("/handoff?…", out)


# --- items 12, 14, 4, 11: live HTTP behaviour --------------------------------------------------
class LiveServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tempfile.mkdtemp()
        write_env(cls.root)
        cls.srv = load_server(cls.root)
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), cls.srv.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        shutil.rmtree(cls.root, ignore_errors=True)

    def setUp(self):
        # A fresh limiter per test: these share one process-wide RATE table.
        for name, lim in self.srv.RATE.items():
            lim._buckets.clear()

    def post(self, path, body=b"{}", ctype="application/json", length=None, extra=None):
        c = HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": ctype,
                   "Content-Length": str(len(body) if length is None else length)}
        headers.update(extra or {})
        c.putrequest("POST", path, skip_accept_encoding=True)
        for k, v in headers.items():
            c.putheader(k, v)
        c.endheaders()
        c.send(body)
        r = c.getresponse()
        out = (r.status, r.read())
        c.close()
        return out

    # -- item 12 ---------------------------------------------------------------------------
    def test_oversized_body_is_refused_before_it_is_read(self):
        """Content-Length went straight into rfile.read() with no cap, before any auth."""
        huge = self.srv.MAX_BODY + 1
        status, _ = self.post("/api/login", b"{}", length=huge)
        self.assertEqual(status, 413)

    def test_malformed_content_length_is_a_400_not_a_traceback(self):
        status, body = self.post("/api/login", b"{}", length="not-a-number")
        self.assertEqual(status, 400)
        self.assertIn(b"Content-Length", body)

    def test_malformed_content_length_on_put_too(self):
        status, _ = self.post("/api/settings", b"{}", length="12x")
        self.assertEqual(status, 400)

    def test_a_normal_body_still_gets_through(self):
        status, body = self.post("/api/login", json.dumps({"pat": ""}).encode())
        self.assertEqual(status, 400)
        self.assertIn(b"Paste a token", body)

    # -- item 14 ---------------------------------------------------------------------------
    def test_a_cross_site_text_plain_post_cannot_sign_anyone_in(self):
        status, _ = self.post("/api/login", json.dumps({"pat": "x"}).encode(),
                              ctype="text/plain")
        self.assertEqual(status, 415)

    def test_sec_fetch_site_cross_site_is_refused_even_as_json(self):
        status, _ = self.post("/api/login", b"{}", extra={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(status, 415)

    # -- items 4 and 11 ---------------------------------------------------------------------
    def test_login_is_rate_limited_per_source_ip(self):
        codes = [self.post("/api/login", json.dumps({"pat": ""}).encode())[0]
                 for _ in range(12)]
        self.assertIn(429, codes)

    def test_device_start_is_rate_limited(self):
        codes = [self.post("/api/auth/device/start")[0] for _ in range(10)]
        self.assertIn(429, codes)


# --- item 5: both writers of users.json take the same lock -------------------------------------
class UsersJsonLocking(ServerCase):
    def test_a_signin_landing_inside_a_prune_is_not_rolled_back(self):
        """pr-watch.sh runs rs_devices prune, which does its own read-modify-write. Without a
        shared lock the loser of the race silently lost the other's write."""
        import rs_devices
        users_path = str(self.srv.USERS)
        self.srv.save_users({"alice": {"name": "alice"}})
        held = threading.Event()
        release = threading.Event()

        def holder():
            with open(rs_devices.lock_path(users_path), "a+") as lf:
                import fcntl
                fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
                held.set()
                release.wait(5)

        t = threading.Thread(target=holder, daemon=True)
        t.start()
        held.wait(5)
        done = threading.Event()
        threading.Thread(
            target=lambda: (self.srv.modify_users(
                lambda u: u.__setitem__("bob", {"name": "bob"})), done.set()),
            daemon=True).start()
        self.assertFalse(done.wait(0.4), "modify_users ignored the file lock")
        release.set()
        self.assertTrue(done.wait(5))
        self.assertIn("bob", self.srv.load_users())


# --- item 9: `next` is consumed, `welcome` only on a real first sign-in ------------------------
class Landing(ServerCase):
    def test_a_returning_user_lands_where_they_were_going(self):
        self.assertEqual(self.srv.landing("/pr?repo=acme/widgets&pr=7", False),
                         "/pr?repo=acme/widgets&pr=7")

    def test_first_sign_in_goes_to_the_setup_page(self):
        self.assertEqual(self.srv.landing("/pr?pr=7", True), self.srv.FIRST_RUN_PATH)

    def test_device_pairing_always_wins(self):
        self.assertEqual(self.srv.landing("/device?name=iPhone", True), "/device?name=iPhone")

    def test_offsite_next_is_refused(self):
        self.assertEqual(self.srv.landing("//evil.example/x", False), "/")
        self.assertEqual(self.srv.landing("https://evil.example", False), "/")


# --- item 15: one person's access problem is not the whole team's ------------------------------
class OauthBlockIsPerLogin(ServerCase):
    def test_a_single_users_access_problem_does_not_demote_the_login_page(self):
        self.srv.record_oauth_block("alice", "no-access")
        self.assertFalse(self.srv.oauth_blocked())

    def test_an_org_refusal_does(self):
        self.srv.record_oauth_block("alice", "org-approval")
        self.assertTrue(self.srv.oauth_blocked())

    def test_clearing_is_per_login(self):
        self.srv.record_oauth_block("alice", "org-approval")
        self.srv.record_oauth_block("bob", "org-approval")
        self.srv.clear_oauth_block("alice")
        self.assertTrue(self.srv.oauth_blocked())
        self.srv.clear_oauth_block("bob")
        self.assertFalse(self.srv.oauth_blocked())


# --- item 8: the Secure flag is not dropped for a real hostname --------------------------------
class CookieSecurity(unittest.TestCase):
    def test_secure_is_kept_when_public_url_is_a_real_host(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        write_env(root, extra="PUBLIC_URL=http://reviews.example.com\n")
        os.environ["RS_COOKIE_SECURE"] = "0"             # what the entrypoint exports
        srv = load_server(root)
        self.assertIn("Secure", srv.session_cookie("alice"))

    def test_secure_is_dropped_only_for_a_genuine_localhost(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        write_env(root, extra="PUBLIC_URL=http://localhost:8899\n")
        os.environ["RS_COOKIE_SECURE"] = "0"
        srv = load_server(root)
        self.assertNotIn("Secure", srv.session_cookie("alice"))

    def test_a_phone_is_not_paired_to_localhost(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        write_env(root, extra="PUBLIC_URL=http://localhost:8899\n")
        srv = load_server(root)
        self.assertEqual(srv.server_url({"Host": "reviews.example.com",
                                         "X-Forwarded-Proto": "https"}),
                         "https://reviews.example.com")


# --- item 17: at-rest encryption --------------------------------------------------------------
class AtRestEncryption(ServerCase):
    def test_round_trip(self):
        self.assertEqual(self.srv.dec(self.srv.enc("ghp_secret")), "ghp_secret")

    def test_iterations_were_raised_and_legacy_ciphertext_still_reads(self):
        self.assertGreaterEqual(self.srv.PBKDF2_ITERS, 600_000)
        legacy = self.srv._openssl("-e", "ghp_old", self.srv.PBKDF2_ITERS_LEGACY)
        self.assertEqual(self.srv.dec(legacy), "ghp_old")

    def test_the_key_is_not_in_the_child_environment(self):
        import inspect
        src = inspect.getsource(self.srv._openssl)
        self.assertIn("fd:3", src)
        self.assertNotIn("env:RS_KEY", src)


if __name__ == "__main__":
    unittest.main()
