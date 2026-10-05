#!/usr/bin/env python3
"""Web Push — the `push` notifier backend (RFC 8030 delivery, RFC 8291 encryption, RFC 8292
VAPID), plus the per-device subscription store the dashboard's "Notifications on this device"
panel talks to.

Push only NOTIFIES. A notification carries a title, one line of body and the URL of the page
to open; it never runs a review and never posts anything. A push that fails is a WARN line on
stderr and nothing more — the poller's card, the review and the dashboard are unaffected.

Files under $ROOT:
    push_vapid.json   {"private": <b64url 32 bytes>, "public": <b64url 65 bytes>, "created"}
                      Generated once, mode 0600. VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY in the
                      environment take precedence (same base64url raw format every web-push
                      library prints) so a pair can be pinned across rebuilds.
    push_subs.json    [{login, endpoint, keys: {p256dh, auth}, device, added, ua}, ...]
                      One record per browser/device per user. Written under an fcntl lock on a
                      sibling .lock file and replaced atomically, like users.json.

Crypto: ECDH on P-256, ECDSA for the VAPID JWT and AES-128-GCM come from `cryptography`
(installed in the image); HKDF is stdlib hmac/hashlib.

CLI:
    rs_push.py notify --login <login> --title <t> --body <b> --url <u> [--tag <tag>]
    rs_push.py key            print the public key (generating the pair if there is none)
"""
import argparse
import base64
import fcntl
import hashlib
import hmac
import json
import os
import secrets
import struct
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    HAVE_CRYPTO = True
except ImportError:                        # pragma: no cover — the image installs it
    HAVE_CRYPTO = False

MAX_SUBS = 10                              # per user; the oldest is evicted past this
JWT_TTL = 12 * 3600                        # RFC 8292 caps exp at 24h; half of that is plenty
PUSH_TTL = 24 * 3600                       # how long the push service keeps an undelivered one
RECORD_SIZE = 4096
TIMEOUT = 8
VAPID_FILE = "push_vapid.json"
SUBS_FILE = "push_subs.json"
MAX_PAYLOAD = 3800                         # push services refuse ~4 KiB; keep clear of it


def _root():
    return Path(os.environ.get("ROOT", Path.home() / ".reviewstage"))


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def b64u_dec(s):
    s = str(s or "").strip()
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# --- VAPID key pair -------------------------------------------------------------------------------
def _private_from_raw(raw):
    return ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256R1())


def _public_raw(private):
    return private.public_key().public_bytes(serialization.Encoding.X962,
                                             serialization.PublicFormat.UncompressedPoint)


def generate_pair():
    """A fresh P-256 pair as the {private, public} base64url strings the store and env use."""
    priv = ec.generate_private_key(ec.SECP256R1())
    raw = priv.private_numbers().private_value.to_bytes(32, "big")
    return {"private": b64u(raw), "public": b64u(_public_raw(priv)), "created": int(time.time())}


def pair_configured(root=None):
    """True when a pair exists (env or file) — what notify.sh and the doctor ask, read-only."""
    if os.environ.get("VAPID_PRIVATE_KEY") and os.environ.get("VAPID_PUBLIC_KEY"):
        return True
    return ((root or _root()) / VAPID_FILE).is_file()


def vapid_pair(root=None, create=True):
    """The pair from the environment, else the file, else (when `create`) a new one written
    0600. Returns the {private, public} dict or None when nothing exists and create is off."""
    env_priv, env_pub = os.environ.get("VAPID_PRIVATE_KEY"), os.environ.get("VAPID_PUBLIC_KEY")
    if env_priv and env_pub:
        return {"private": env_priv.strip(), "public": env_pub.strip(), "source": "env"}
    root = root or _root()
    f = root / VAPID_FILE
    if f.is_file():
        try:
            d = json.loads(f.read_text())
            if d.get("private") and d.get("public"):
                d["source"] = "file"
                return d
        except (OSError, ValueError):
            pass
    if not create:
        return None
    root.mkdir(parents=True, exist_ok=True)
    pair = generate_pair()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(pair, indent=1))
    os.chmod(tmp, 0o600)
    tmp.replace(f)
    pair["source"] = "file"
    return pair


def public_key(root=None):
    return vapid_pair(root)["public"]


# Apple's push service answers 403 BadJwtToken to a `localhost` contact (Chrome and Firefox
# accept it), and a desktop or plain-http install has no https address of its own.
DEFAULT_SUBJECT = "https://reviewstage.dev"


def vapid_subject():
    """`sub` for the JWT: VAPID_SUBJECT, else the install's https PUBLIC_URL, else the project's."""
    sub = os.environ.get("VAPID_SUBJECT", "").strip()
    if sub and "localhost" not in sub:
        return sub
    pub = os.environ.get("PUBLIC_URL", "").strip().rstrip("/")
    if pub.startswith("https://") and "localhost" not in pub:
        return pub
    return DEFAULT_SUBJECT


def vapid_jwt(endpoint, pair, now=None, subject=None):
    """The signed ES256 token for one push-service origin. Claims: aud (the endpoint's
    origin), exp (now + 12h), sub."""
    now = int(time.time() if now is None else now)
    u = urlparse(endpoint)
    claims = {"aud": f"{u.scheme}://{u.netloc}", "exp": now + JWT_TTL,
              "sub": subject or vapid_subject()}
    header = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    body = b64u(json.dumps(claims, separators=(",", ":")).encode())
    signing = f"{header}.{body}".encode()
    priv = _private_from_raw(b64u_dec(pair["private"]))
    der = priv.sign(signing, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return f"{header}.{body}." + b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def vapid_headers(endpoint, pair, now=None):
    return {"Authorization": f"vapid t={vapid_jwt(endpoint, pair, now)}, k={pair['public']}"}


# --- RFC 8291 / 8188 content encryption ----------------------------------------------------------
def hkdf(salt, ikm, info, length):
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:length]


def encrypt(plaintext, p256dh, auth, as_private=None, salt=None):
    """`plaintext` bytes → one aes128gcm record with its RFC 8188 header, for the subscription
    whose public key is `p256dh` and auth secret `auth` (both base64url). `as_private` / `salt`
    are injectable so a test can decrypt with known values; production draws fresh ones."""
    ua_public = b64u_dec(p256dh)
    auth_secret = b64u_dec(auth)
    if len(ua_public) != 65 or len(auth_secret) != 16:
        raise ValueError("subscription keys are not a 65-byte P-256 point and a 16-byte auth")
    if len(plaintext) > MAX_PAYLOAD:
        raise ValueError(f"payload over {MAX_PAYLOAD} bytes")
    as_private = as_private or ec.generate_private_key(ec.SECP256R1())
    salt = salt or secrets.token_bytes(16)
    as_public = _public_raw(as_private)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    shared = as_private.exchange(ec.ECDH(), ua_key)
    ikm = hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    # One record: the payload, the 0x02 "last record" delimiter, no padding.
    sealed = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + struct.pack("!I", RECORD_SIZE) + bytes([len(as_public)]) + as_public
    return header + sealed


# --- subscription store ---------------------------------------------------------------------------
def _subs_path(root=None):
    return (root or _root()) / SUBS_FILE


def _lock(path):
    lf = open(str(path) + ".lock", "a+")
    fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
    try:
        os.chmod(str(path) + ".lock", 0o600)
    except OSError:
        pass
    return lf


def load_subs(root=None):
    p = _subs_path(root)
    if not p.is_file():
        return []
    try:
        d = json.loads(p.read_text())
    except (OSError, ValueError):
        return []
    return [s for s in d if isinstance(s, dict) and s.get("endpoint")] if isinstance(d, list) \
        else []


def save_subs(subs, root=None):
    p = _subs_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(subs, indent=1))
    os.chmod(tmp, 0o600)
    tmp.replace(p)


def modify_subs(fn, root=None):
    """Serialized read-modify-write; fn(list) mutates in place and may return a value."""
    p = _subs_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    with _lock(p):
        subs = load_subs(root)
        out = fn(subs)
        save_subs(subs, root)
    return out


def valid_subscription(sub):
    """The browser's PushSubscription.toJSON(): an https endpoint and both keys."""
    if not isinstance(sub, dict):
        return False
    ep = sub.get("endpoint")
    keys = sub.get("keys") or {}
    if not isinstance(ep, str) or not ep.startswith("https://") or len(ep) > 2048:
        return False
    try:
        return len(b64u_dec(keys.get("p256dh"))) == 65 and len(b64u_dec(keys.get("auth"))) == 16
    except (ValueError, TypeError):
        return False


def clean_device(name):
    name = " ".join(str(name or "").split())[:60]
    return name or "Unnamed device"


def add_sub(login, sub, device="", ua="", root=None, now=None):
    """Store (or refresh) one subscription for `login`. Same endpoint = same device
    re-subscribing: the record is replaced, not duplicated. Returns the public row."""
    if not valid_subscription(sub):
        raise ValueError("not a web push subscription")
    now = int(time.time() if now is None else now)
    rec = {"login": login, "endpoint": sub["endpoint"],
           "keys": {"p256dh": sub["keys"]["p256dh"], "auth": sub["keys"]["auth"]},
           "device": clean_device(device), "added": now, "ua": str(ua or "")[:200]}

    def apply(subs):
        subs[:] = [s for s in subs if s.get("endpoint") != rec["endpoint"]]
        subs.append(rec)
        mine = [s for s in subs if s.get("login") == login]
        while len(mine) > MAX_SUBS:
            oldest = min(mine, key=lambda s: int(s.get("added") or 0))
            subs.remove(oldest)
            mine.remove(oldest)
    modify_subs(apply, root)
    return public_row(rec)


def remove_sub(login, endpoint, root=None):
    """Drop `login`'s subscription at `endpoint` (one user cannot remove another's). Returns
    how many were removed (0 or 1)."""
    def apply(subs):
        before = len(subs)
        subs[:] = [s for s in subs if not (s.get("login") == login and s.get("endpoint") == endpoint)]
        return before - len(subs)
    return modify_subs(apply, root)


def remove_endpoint(endpoint, root=None):
    """Drop a dead endpoint whoever owns it — a 404/410 from the push service is final."""
    def apply(subs):
        before = len(subs)
        subs[:] = [s for s in subs if s.get("endpoint") != endpoint]
        return before - len(subs)
    return modify_subs(apply, root)


def endpoint_id(endpoint):
    return hashlib.sha256(endpoint.encode()).hexdigest()[:16]


def mask_endpoint(endpoint):
    u = urlparse(endpoint)
    tail = u.path.rstrip("/").rsplit("/", 1)[-1]
    return f"{u.netloc}/…{tail[-6:]}" if tail else u.netloc


def public_row(rec):
    """What the UI sees: never the keys, never the whole endpoint."""
    return {"id": endpoint_id(rec["endpoint"]), "device": rec.get("device", ""),
            "added": int(rec.get("added") or 0), "ua": rec.get("ua", ""),
            "endpoint": mask_endpoint(rec["endpoint"])}


def list_subs(login, root=None):
    rows = [public_row(s) for s in load_subs(root) if s.get("login") == login]
    rows.sort(key=lambda r: -r["added"])
    return rows


def user_subs(login, root=None):
    return [s for s in load_subs(root) if s.get("login") == login]


# --- delivery -------------------------------------------------------------------------------------
def topic_for(tag):
    """RFC 8030 Topic: ≤32 chars of the base64url alphabet. The tag itself has ':' '/' '#'."""
    return b64u(hashlib.sha256(str(tag).encode()).digest())[:32] if tag else ""


def _warn(msg):
    print(f"WARN: push: {msg}", file=sys.stderr, flush=True)


def send_one(sub, payload, pair=None, opener=None, root=None):
    """POST one encrypted message to one subscription. Returns one of
    "sent" | "gone" | "failed". "gone" (404/410) has already removed the subscription."""
    endpoint = sub["endpoint"]
    try:
        pair = pair or vapid_pair(root)
        body = encrypt(json.dumps(payload, separators=(",", ":")).encode(),
                       sub["keys"]["p256dh"], sub["keys"]["auth"])
        headers = {"Content-Type": "application/octet-stream",
                   "Content-Encoding": "aes128gcm", "TTL": str(PUSH_TTL),
                   "Urgency": "normal", **vapid_headers(endpoint, pair)}
        topic = topic_for(payload.get("tag"))
        if topic:
            headers["Topic"] = topic
        req = urllib.request.Request(endpoint, data=body, method="POST", headers=headers)
        with (opener or urllib.request.urlopen)(req, timeout=TIMEOUT) as r:
            code = getattr(r, "status", 200)
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:                  # noqa: BLE001 — a push must never raise
        _warn(f"{mask_endpoint(endpoint)}: {type(e).__name__}: {e}")
        return "failed"
    if 200 <= code < 300:
        return "sent"
    if code in (404, 410):
        remove_endpoint(endpoint, root)
        _warn(f"{mask_endpoint(endpoint)} is gone ({code}) — subscription removed")
        return "gone"
    _warn(f"{mask_endpoint(endpoint)} answered {code}")
    return "failed"


def send(login, payload, root=None, opener=None):
    """Push `payload` ({title, body, url, tag}) to every device `login` subscribed. Never
    raises; returns {"sent", "gone", "failed", "devices"} counts."""
    out = {"sent": 0, "gone": 0, "failed": 0, "devices": 0}
    try:
        subs = user_subs(login, root)
        out["devices"] = len(subs)
        if not subs:
            return out
        if not HAVE_CRYPTO:
            _warn("python `cryptography` is not installed — cannot encrypt; nothing sent")
            out["failed"] = len(subs)
            return out
        pair = vapid_pair(root)
        for s in subs:
            out[send_one(s, payload, pair, opener, root)] += 1
    except Exception as e:                  # noqa: BLE001
        _warn(f"notify {login}: {type(e).__name__}: {e}")
    return out


def notify_payload(title, body, url, tag=""):
    return {"title": str(title or "")[:120], "body": str(body or "")[:240],
            "url": str(url or "/"), "tag": str(tag or "")[:120]}


def _cli(argv):
    ap = argparse.ArgumentParser(prog="rs_push.py")
    sp = ap.add_subparsers(dest="cmd", required=True)
    n = sp.add_parser("notify", help="push one notification to a user's devices")
    n.add_argument("--login", required=True)
    n.add_argument("--title", required=True)
    n.add_argument("--body", default="")
    n.add_argument("--url", default="/")
    n.add_argument("--tag", default="")
    sp.add_parser("key", help="print the VAPID public key, generating the pair if needed")
    a = ap.parse_args(argv)
    if a.cmd == "key":
        if not HAVE_CRYPTO:
            print("python `cryptography` is not installed", file=sys.stderr)
            return 1
        print(public_key())
        return 0
    res = send(a.login, notify_payload(a.title, a.body, a.url, a.tag))
    print(f"push: {a.login}: {res['sent']} sent, {res['failed']} failed, {res['gone']} gone "
          f"of {res['devices']} device(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli(sys.argv[1:]))
