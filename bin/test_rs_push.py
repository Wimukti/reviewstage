"""Unit tests for rs_push.py — web push without a network.

The encryption proof is a real decrypt: the test plays the browser, holding its own P-256 pair
and auth secret, and unwraps the aes128gcm body with the RFC 8291 derivation written out
independently here. If the sender's derivation drifted from the spec, this test fails and no
phone would ever have shown a notification.
"""
import base64
import hashlib
import hmac
import io
import json
import os
import shutil
import struct
import sys
import tempfile
import time
import unittest
import urllib.error
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rs_push  # noqa: E402

from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402


def b64u_dec(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class Browser:
    """A fake user agent: its own key pair, auth secret and an endpoint."""

    def __init__(self, endpoint="https://push.example.net/send/abcdef123456"):
        self.priv = ec.generate_private_key(ec.SECP256R1())
        self.pub = self.priv.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.auth = os.urandom(16)
        self.endpoint = endpoint

    def subscription(self):
        return {"endpoint": self.endpoint,
                "keys": {"p256dh": rs_push.b64u(self.pub), "auth": rs_push.b64u(self.auth)}}

    def decrypt(self, body):
        """RFC 8291 §3.4 from the receiver's side, written out independently of rs_push."""
        salt, (rs,), idlen = body[:16], struct.unpack("!I", body[16:20]), body[20]
        as_pub = body[21:21 + idlen]
        sealed = body[21 + idlen:]
        self_test = len(sealed) <= rs
        assert self_test, "record larger than rs"
        shared = self.priv.exchange(
            ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))

        def hkdf(salt_, ikm, info, n):
            prk = hmac.new(salt_, ikm, hashlib.sha256).digest()
            return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:n]
        ikm = hkdf(self.auth, shared, b"WebPush: info\x00" + self.pub + as_pub, 32)
        cek = hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
        nonce = hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
        plain = AESGCM(cek).decrypt(nonce, sealed, None)
        # Strip the delimiter + padding: the last non-zero byte is the delimiter.
        i = len(plain) - 1
        while i >= 0 and plain[i] == 0:
            i -= 1
        assert plain[i] == 0x02, "last record must end in 0x02"
        return plain[:i]


class PushCase(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        for k in ("VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT", "PUBLIC_URL"):
            os.environ.pop(k, None)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)


class KeyPair(PushCase):
    def test_generated_once_mode_600_and_reused(self):
        a = rs_push.vapid_pair(self.root)
        f = self.root / "push_vapid.json"
        self.assertTrue(f.is_file())
        self.assertEqual(oct(f.stat().st_mode & 0o777), "0o600")
        b = rs_push.vapid_pair(self.root)
        self.assertEqual(a["private"], b["private"])
        self.assertEqual(a["public"], b["public"])
        self.assertEqual(len(b64u_dec(a["private"])), 32)
        self.assertEqual(len(b64u_dec(a["public"])), 65)
        self.assertEqual(b64u_dec(a["public"])[0], 0x04)        # uncompressed point

    def test_environment_pair_wins_and_writes_nothing(self):
        pair = rs_push.generate_pair()
        with mock.patch.dict(os.environ, {"VAPID_PRIVATE_KEY": pair["private"],
                                          "VAPID_PUBLIC_KEY": pair["public"]}):
            got = rs_push.vapid_pair(self.root)
            self.assertEqual(got["public"], pair["public"])
            self.assertEqual(got["source"], "env")
            self.assertTrue(rs_push.pair_configured(self.root))
        self.assertFalse((self.root / "push_vapid.json").exists())

    def test_pair_configured_is_read_only(self):
        self.assertFalse(rs_push.pair_configured(self.root))
        self.assertIsNone(rs_push.vapid_pair(self.root, create=False))
        self.assertFalse((self.root / "push_vapid.json").exists())
        rs_push.public_key(self.root)
        self.assertTrue(rs_push.pair_configured(self.root))


class Subscriptions(PushCase):
    def test_add_list_remove_per_user_isolation(self):
        a, b = Browser("https://p.example/a1"), Browser("https://p.example/b1")
        rs_push.add_sub("ann", a.subscription(), "Ann's phone", "Mozilla/5.0 iPhone", self.root)
        rs_push.add_sub("bob", b.subscription(), "Bob laptop", "", self.root)
        ann = rs_push.list_subs("ann", self.root)
        self.assertEqual([r["device"] for r in ann], ["Ann's phone"])
        self.assertNotIn("keys", ann[0])
        self.assertNotIn("a1", ann[0]["endpoint"].replace("…a1", ""))     # masked
        self.assertTrue(ann[0]["endpoint"].startswith("p.example/"))
        # bob cannot remove ann's row
        self.assertEqual(rs_push.remove_sub("bob", a.endpoint, self.root), 0)
        self.assertEqual(len(rs_push.list_subs("ann", self.root)), 1)
        self.assertEqual(rs_push.remove_sub("ann", a.endpoint, self.root), 1)
        self.assertEqual(rs_push.list_subs("ann", self.root), [])
        self.assertEqual(len(rs_push.list_subs("bob", self.root)), 1)
        self.assertEqual(oct((self.root / "push_subs.json").stat().st_mode & 0o777), "0o600")

    def test_resubscribing_the_same_endpoint_replaces_not_duplicates(self):
        a = Browser()
        rs_push.add_sub("ann", a.subscription(), "Phone", "", self.root, now=1)
        rs_push.add_sub("ann", a.subscription(), "Phone renamed", "", self.root, now=2)
        rows = rs_push.list_subs("ann", self.root)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["device"], "Phone renamed")

    def test_cap_evicts_the_oldest_of_that_user_only(self):
        for i in range(rs_push.MAX_SUBS + 2):
            rs_push.add_sub("ann", Browser(f"https://p.example/{i}").subscription(),
                            f"d{i}", "", self.root, now=100 + i)
        rs_push.add_sub("bob", Browser("https://p.example/bob").subscription(), "b", "",
                        self.root, now=1)
        ann = rs_push.list_subs("ann", self.root)
        self.assertEqual(len(ann), rs_push.MAX_SUBS)
        self.assertNotIn("d0", [r["device"] for r in ann])
        self.assertNotIn("d1", [r["device"] for r in ann])
        self.assertEqual(len(rs_push.list_subs("bob", self.root)), 1)

    def test_invalid_subscriptions_are_refused(self):
        for bad in (None, {}, {"endpoint": "http://insecure/x", "keys": {}},
                    {"endpoint": "https://p/x", "keys": {"p256dh": "AAAA", "auth": "AAAA"}}):
            self.assertFalse(rs_push.valid_subscription(bad))
            with self.assertRaises(ValueError):
                rs_push.add_sub("ann", bad, "", "", self.root)
        self.assertTrue(rs_push.valid_subscription(Browser().subscription()))


class Encryption(PushCase):
    def test_round_trip_decrypts_with_the_browsers_keys(self):
        ua = Browser()
        payload = json.dumps({"title": "Review requested: acme/widgets#42",
                              "body": "Add lead-time badge", "url": "/pr?pr=42",
                              "tag": "review:acme/widgets#42"}).encode()
        sub = ua.subscription()
        body = rs_push.encrypt(payload, sub["keys"]["p256dh"], sub["keys"]["auth"])
        self.assertEqual(ua.decrypt(body), payload)
        # RFC 8188 header: 16-byte salt, rs=4096, 65-byte key id.
        self.assertEqual(struct.unpack("!I", body[16:20])[0], 4096)
        self.assertEqual(body[20], 65)
        self.assertEqual(body[21], 0x04)

    def test_every_message_uses_a_fresh_salt_and_key(self):
        ua = Browser()
        sub = ua.subscription()
        a = rs_push.encrypt(b"x", sub["keys"]["p256dh"], sub["keys"]["auth"])
        b = rs_push.encrypt(b"x", sub["keys"]["p256dh"], sub["keys"]["auth"])
        self.assertNotEqual(a[:16], b[:16])
        self.assertNotEqual(a[21:86], b[21:86])
        self.assertEqual(ua.decrypt(a), ua.decrypt(b))

    def test_a_different_browser_cannot_read_it(self):
        ua, other = Browser(), Browser()
        sub = ua.subscription()
        body = rs_push.encrypt(b"secret", sub["keys"]["p256dh"], sub["keys"]["auth"])
        with self.assertRaises(Exception):
            other.decrypt(body)

    def test_oversized_payload_is_refused_before_encryption(self):
        sub = Browser().subscription()
        with self.assertRaises(ValueError):
            rs_push.encrypt(b"x" * (rs_push.MAX_PAYLOAD + 1), sub["keys"]["p256dh"],
                            sub["keys"]["auth"])

    def test_rfc8291_appendix_a_vector(self):
        """The worked example in RFC 8291 Appendix A, byte for byte."""
        ua_private = b64u_dec("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94")
        ua_public = b64u_dec("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx"
                             "aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
        auth = "BTBZMqHH6r4Tts7J_aSIgg"
        as_private = ec.derive_private_key(int.from_bytes(b64u_dec(
            "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"), ec.SECP256R1())
        salt = b64u_dec("DGv6ra1nlYgDCS1FRnbzlw")
        body = rs_push.encrypt(b"When I grow up, I want to be a watermelon",
                               rs_push.b64u(ua_public), auth, as_private, salt)
        self.assertEqual(rs_push.b64u(body),
                         "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
                         "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
                         "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
        self.assertEqual(ec.derive_private_key(int.from_bytes(ua_private, "big"),
                                               ec.SECP256R1()).public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint),
            ua_public)


class Vapid(PushCase):
    def test_jwt_claims_expiry_and_signature(self):
        pair = rs_push.vapid_pair(self.root)
        now = 1_800_000_000
        with mock.patch.dict(os.environ, {"PUBLIC_URL": "https://reviews.example.com"}):
            tok = rs_push.vapid_jwt("https://fcm.googleapis.com/fcm/send/xyz", pair, now=now)
        h, c, sig = tok.split(".")
        self.assertEqual(json.loads(b64u_dec(h)), {"typ": "JWT", "alg": "ES256"})
        claims = json.loads(b64u_dec(c))
        self.assertEqual(claims["aud"], "https://fcm.googleapis.com")
        self.assertEqual(claims["exp"], now + 12 * 3600)
        self.assertLessEqual(claims["exp"] - now, 24 * 3600)        # RFC 8292 §2 ceiling
        self.assertEqual(claims["sub"], "https://reviews.example.com")
        raw = b64u_dec(sig)
        self.assertEqual(len(raw), 64)                                # r || s, not DER
        pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(),
                                                           b64u_dec(pair["public"]))
        der = encode_dss_signature(int.from_bytes(raw[:32], "big"),
                                   int.from_bytes(raw[32:], "big"))
        pub.verify(der, f"{h}.{c}".encode(), ec.ECDSA(hashes.SHA256()))  # raises if wrong

    def test_authorization_header_shape_and_subject_fallbacks(self):
        pair = rs_push.vapid_pair(self.root)
        hdr = rs_push.vapid_headers("https://web.push.apple.com/abc", pair)["Authorization"]
        self.assertTrue(hdr.startswith("vapid t="))
        self.assertIn(f", k={pair['public']}", hdr)
        # Never a localhost contact: Apple rejects it with 403 BadJwtToken (seen live, 10/05/26).
        self.assertEqual(rs_push.vapid_subject(), "https://reviewstage.dev")
        with mock.patch.dict(os.environ, {"VAPID_SUBJECT": "mailto:ops@acme.test"}):
            self.assertEqual(rs_push.vapid_subject(), "mailto:ops@acme.test")
        with mock.patch.dict(os.environ, {"PUBLIC_URL": "http://localhost:8899"}):
            self.assertEqual(rs_push.vapid_subject(), "https://reviewstage.dev")
        with mock.patch.dict(os.environ, {"PUBLIC_URL": "https://reviews.acme.test"}):
            self.assertEqual(rs_push.vapid_subject(), "https://reviews.acme.test")
        with mock.patch.dict(os.environ, {"VAPID_SUBJECT": "mailto:me@localhost"}):
            self.assertEqual(rs_push.vapid_subject(), "https://reviewstage.dev")

    def test_topic_fits_the_rfc8030_alphabet(self):
        t = rs_push.topic_for("review:acme/widgets#42")
        self.assertLessEqual(len(t), 32)
        self.assertTrue(all(ch.isalnum() or ch in "-_" for ch in t))
        self.assertEqual(t, rs_push.topic_for("review:acme/widgets#42"))
        self.assertEqual(rs_push.topic_for(""), "")


class FakeResponse:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def opener_returning(codes, seen):
    """A urlopen stand-in: `codes` maps endpoint → status; non-2xx raised as HTTPError."""
    def opener(req, timeout=0):
        seen.append(req)
        code = codes.get(req.full_url, 201)
        if code >= 400:
            raise urllib.error.HTTPError(req.full_url, code, "x", {}, io.BytesIO(b""))
        return FakeResponse(code)
    return opener


class Delivery(PushCase):
    def setUp(self):
        super().setUp()
        self.phone, self.laptop = Browser("https://p.example/phone"), Browser("https://p.example/laptop")
        rs_push.add_sub("ann", self.phone.subscription(), "Phone", "", self.root)
        rs_push.add_sub("ann", self.laptop.subscription(), "Laptop", "", self.root)
        rs_push.add_sub("bob", Browser("https://p.example/bob").subscription(), "Bob", "",
                        self.root)

    def test_send_reaches_every_device_of_that_user_only(self):
        seen = []
        payload = rs_push.notify_payload("Review requested: #42", "Lead-time badge",
                                         "https://rs.example/pr?pr=42", "review:acme/w#42")
        with redirect_stderr(io.StringIO()) as err:
            res = rs_push.send("ann", payload, self.root, opener_returning({}, seen))
        self.assertEqual(res, {"sent": 2, "gone": 0, "failed": 0, "devices": 2})
        self.assertEqual(sorted(r.full_url for r in seen),
                         ["https://p.example/laptop", "https://p.example/phone"])
        self.assertEqual(err.getvalue(), "")
        req = next(r for r in seen if r.full_url.endswith("phone"))
        self.assertEqual(req.get_header("Content-encoding"), "aes128gcm")
        self.assertEqual(req.get_header("Ttl"), str(rs_push.PUSH_TTL))
        self.assertTrue(req.get_header("Authorization").startswith("vapid t="))
        self.assertEqual(req.get_header("Topic"), rs_push.topic_for("review:acme/w#42"))
        # and the body really is for that phone
        self.assertEqual(json.loads(self.phone.decrypt(req.data)), payload)

    def test_410_removes_the_subscription_and_the_rest_still_go(self):
        seen = []
        with redirect_stderr(io.StringIO()) as err:
            res = rs_push.send("ann", rs_push.notify_payload("t", "b", "/"), self.root,
                               opener_returning({"https://p.example/phone": 410}, seen))
        self.assertEqual((res["sent"], res["gone"], res["failed"]), (1, 1, 0))
        self.assertEqual([r["device"] for r in rs_push.list_subs("ann", self.root)], ["Laptop"])
        self.assertIn("WARN: push:", err.getvalue())
        self.assertIn("gone (410)", err.getvalue())
        # 404 is the same signal
        rs_push.add_sub("ann", self.phone.subscription(), "Phone", "", self.root)
        with redirect_stderr(io.StringIO()):
            rs_push.send("ann", rs_push.notify_payload("t", "b", "/"), self.root,
                         opener_returning({"https://p.example/phone": 404}, []))
        self.assertEqual([r["device"] for r in rs_push.list_subs("ann", self.root)], ["Laptop"])

    def test_other_failures_warn_keep_the_subscription_and_never_raise(self):
        def exploding(req, timeout=0):
            if req.full_url.endswith("phone"):
                raise OSError("connection reset")
            raise urllib.error.HTTPError(req.full_url, 429, "slow down", {}, io.BytesIO(b""))
        with redirect_stderr(io.StringIO()) as err:
            res = rs_push.send("ann", rs_push.notify_payload("t", "b", "/"), self.root, exploding)
        self.assertEqual((res["sent"], res["gone"], res["failed"]), (0, 0, 2))
        self.assertEqual(len(rs_push.list_subs("ann", self.root)), 2)
        self.assertIn("connection reset", err.getvalue())
        self.assertIn("answered 429", err.getvalue())

    def test_no_devices_is_a_quiet_no_op(self):
        with redirect_stderr(io.StringIO()) as err:
            res = rs_push.send("carol", rs_push.notify_payload("t", "b", "/"), self.root,
                               opener_returning({}, []))
        self.assertEqual(res["devices"], 0)
        self.assertEqual(err.getvalue(), "")

    def test_notify_never_raises_even_when_the_store_is_garbage(self):
        (self.root / "push_subs.json").write_text("{not json")
        with redirect_stderr(io.StringIO()):
            res = rs_push.send("ann", rs_push.notify_payload("t", "b", "/"), self.root)
        self.assertEqual(res["devices"], 0)
        with mock.patch.object(rs_push, "user_subs", side_effect=RuntimeError("boom")):
            with redirect_stderr(io.StringIO()) as err:
                res = rs_push.send("ann", rs_push.notify_payload("t", "b", "/"), self.root)
        self.assertIn("boom", err.getvalue())

    def test_cli_notify_exits_zero_whatever_happens(self):
        env = dict(os.environ, ROOT=str(self.root))
        import subprocess
        r = subprocess.run([sys.executable, os.path.join(HERE, "rs_push.py"), "notify",
                            "--login", "nobody", "--title", "t", "--body", "b", "--url", "/"],
                           env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("0 device(s)", r.stdout)
        r = subprocess.run([sys.executable, os.path.join(HERE, "rs_push.py"), "key"],
                           env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), rs_push.vapid_pair(self.root)["public"])


# --- the routes themselves (server.py dispatch), through the Handler shim ---------------------
SECRET = "a" * 64
USER = "ann"


def load_server(root):
    import importlib
    os.environ["ROOT"] = root
    os.environ["RS_COOKIE_SECURE"] = "0"
    os.makedirs(os.path.join(root, "state"), exist_ok=True)
    with open(os.path.join(root, ".env"), "w") as f:
        f.write(f"RS_SECRET={SECRET}\nREPOS=acme/widgets\nGITHUB_PAT=t\n"
                "PUBLIC_URL=https://reviews.example.com\n")
    with open(os.path.join(root, "users.json"), "w") as f:
        json.dump({USER: {"name": "Ann", "added": 1}, "bob": {"name": "Bob", "added": 1}}, f)
    if "rs_learn" in sys.modules:
        importlib.reload(sys.modules["rs_learn"])
    if "server" in sys.modules:
        return importlib.reload(sys.modules["server"])
    return importlib.import_module("server")


class TheRoutesThemselves(PushCase):
    def setUp(self):
        super().setUp()
        self.S = load_server(str(self.root))

    def handler(self, user=USER, bearer=False):
        S, out = self.S, {}
        h = object.__new__(S.Handler)
        h.headers = {"User-Agent": "Mozilla/5.0 (iPhone) Safari", "Host": "reviews.example.com"}
        h.client_address = ("127.0.0.1", 1)
        h.reply = lambda status, payload, *a, **k: out.update(status=status,
                                                              body=json.loads(payload))
        # rate_ok answers a 429 on the raw socket API, not through reply(); stub that path so
        # the shim records the status instead of dying on a missing request line.
        h.send_response = lambda code: out.update(status=code, body={})
        h.send_header = lambda *a: None
        h.end_headers = lambda: None
        h.wfile = io.BytesIO()
        patches = [mock.patch.object(S, "session_user", return_value=None if bearer else user),
                   mock.patch.object(S, "bearer_user", return_value=user if bearer else None)]
        return h, out, patches

    def get(self, route, user=USER, bearer=False):
        h, out, patches = self.handler(user, bearer)
        with patches[0], patches[1]:
            h.api_get(route, {})
        return out

    def post(self, route, body, user=USER, bearer=False):
        h, out, patches = self.handler(user, bearer)
        with patches[0], patches[1]:
            h.api_post(route, body)
        return out

    def test_key_subscribe_list_unsubscribe_round_trip(self):
        key = self.get("/api/push/key")
        self.assertEqual(key["status"], 200)
        self.assertEqual(key["body"]["publicKey"], rs_push.vapid_pair(self.root)["public"])
        self.assertTrue((self.root / "push_vapid.json").is_file())

        ua = Browser("https://web.push.apple.com/QWxs")
        r = self.post("/api/push/subscribe", {"subscription": ua.subscription(),
                                              "device": "Ann's iPhone"})
        self.assertEqual(r["status"], 200, r)
        self.assertEqual(r["body"]["device"]["device"], "Ann's iPhone")
        rows = self.get("/api/push/devices")["body"]
        self.assertEqual([d["device"] for d in rows["devices"]], ["Ann's iPhone"])
        self.assertEqual(rows["devices"][0]["endpoint"], "web.push.apple.com/…QWxs")
        self.assertNotIn("keys", rows["devices"][0])
        self.assertEqual(rows["devices"][0]["ua"], "Mozilla/5.0 (iPhone) Safari")
        # another user sees nothing, and cannot remove it by id
        self.assertEqual(self.get("/api/push/devices", user="bob")["body"]["devices"], [])
        rid = rows["devices"][0]["id"]
        self.assertEqual(self.post("/api/push/unsubscribe", {"id": rid}, user="bob")
                         ["body"]["removed"], 0)
        self.assertEqual(self.post("/api/push/unsubscribe", {"id": rid})["body"]["removed"], 1)
        self.assertEqual(self.get("/api/push/devices")["body"]["devices"], [])

    def test_bad_subscription_is_a_400_not_a_500(self):
        r = self.post("/api/push/subscribe", {"subscription": {"endpoint": "nope"}})
        self.assertEqual(r["status"], 400)
        r = self.post("/api/push/unsubscribe", {})
        self.assertEqual(r["status"], 400)

    def test_a_bearer_device_token_can_subscribe_too(self):
        ua = Browser()
        r = self.post("/api/push/subscribe", {"subscription": ua.subscription(), "device": "App"},
                      bearer=True)
        self.assertEqual(r["status"], 200)
        self.assertEqual(self.get("/api/push/devices", bearer=True)["body"]["devices"][0]
                         ["device"], "App")

    def test_signed_out_is_401(self):
        h, out, _ = self.handler()
        with mock.patch.object(self.S, "session_user", return_value=None), \
                mock.patch.object(self.S, "bearer_user", return_value=None):
            h.api_get("/api/push/devices", {})
        self.assertEqual(out["status"], 401)

    def test_test_route_sends_to_the_callers_devices_and_is_rate_limited(self):
        ua = Browser("https://p.example/ann-phone")
        self.post("/api/push/subscribe", {"subscription": ua.subscription(), "device": "Phone"})
        seen = []
        with mock.patch.object(rs_push.urllib.request, "urlopen", opener_returning({}, seen)):
            r = self.post("/api/push/test", {})
        self.assertEqual(r["status"], 200, r)
        self.assertTrue(r["body"]["ok"])
        self.assertEqual(r["body"]["sent"], 1)
        self.assertEqual(len(seen), 1)
        msg = json.loads(ua.decrypt(seen[0].data))
        self.assertEqual(msg["body"], "This is what a review request looks like.")
        self.assertEqual(msg["url"], "https://reviews.example.com/")
        # nobody else's device was touched
        self.assertEqual(self.post("/api/push/test", {}, user="bob")["status"], 400)
        # the sign-in-shaped limiter: burst of 5 per browser, then 429
        with mock.patch.object(rs_push.urllib.request, "urlopen", opener_returning({}, [])):
            codes = [self.post("/api/push/test", {})["status"] for _ in range(6)]
        self.assertIn(429, codes)

    def test_rs_push_0_turns_the_routes_off_without_touching_the_store(self):
        with mock.patch.object(self.S, "PUSH_ENABLED", False):
            self.assertEqual(self.get("/api/push/key")["status"], 503)
            r = self.post("/api/push/subscribe", {"subscription": Browser().subscription()})
            self.assertEqual(r["status"], 503)
            self.assertFalse(self.get("/api/push/devices")["body"]["enabled"])
        self.assertFalse((self.root / "push_vapid.json").exists())


if __name__ == "__main__":
    unittest.main()
