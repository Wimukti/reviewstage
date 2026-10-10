"""rs_users.py — users.json and the at-rest encryption of the tokens it holds.

Extracted from server.py so a tool that only needs to READ who has signed in (the doctor,
`rs_devices.py prune`) can import it without the server's import-time work: environment
parsing, the RS_SECRET fatal check and the legacy-layout migration all stay in server.py. This
module has no module-level state beyond constants; every function takes the secret and the path
explicitly, and server.py wraps them with its own SECRET and USERS.

users.json: {login: {pat_enc | gh_token_enc(+gh_exp, gh_refresh_enc, gh_refresh_exp,
gh_client), claude_token_enc(+claude_exp, claude_refresh_enc), slack_id, discord_id, admin,
name, added, devices: {sha256: {id, name, created, last_seen}}}}. Tokens are AES-encrypted with
a key derived from RS_SECRET — derived, not stored, so rotating the secret also invalidates
every stored token, which is the right outcome if it was rotated because it leaked. The shell
scripts only ever read login + slack_id; they never see a token.
"""
import contextlib
import fcntl
import json
import os
import subprocess
import threading
from hashlib import sha256
from pathlib import Path

import rs_devices as rs_dev

# PBKDF2 rounds for the at-rest encryption below. OpenSSL's built-in default is 10,000, which
# is two orders of magnitude short of anything current; 600,000 matches OWASP's PBKDF2-SHA256
# guidance. Ciphertext written before this change was derived at the old default, so dec()
# falls back to it once — nobody has to re-paste a token to read this release.
PBKDF2_ITERS = 600_000
PBKDF2_ITERS_LEGACY = 10_000


def users_key(secret):
    return sha256(f"{secret}:users".encode()).hexdigest()


def openssl(mode, data, iters, key):
    """Fork openssl for one AES-256-CBC operation. The key goes down a pipe on fd 3, not
    through the child's environment, so it never appears in /proc/<pid>/environ."""
    r_fd, w_fd = os.pipe()
    try:
        os.write(w_fd, (key + "\n").encode())
    finally:
        os.close(w_fd)
    try:
        # pass_fds keeps the pipe at the SAME descriptor number in the child, so that is the
        # number openssl must read from. This used to say fd:3, which only holds while 3 happens
        # to be free — inside the running server fd 3 is the listening socket, so openssl read
        # its password from the server's own port, every encrypt and decrypt failed, and a
        # completed GitHub sign-in crashed while storing its token.
        # Bytes in, bytes out. With text=True, subprocess decoded stdout BEFORE this code saw
        # the exit status, and a decrypt at the wrong iteration count can leave partial
        # garbage on stdout — so the UnicodeDecodeError fired instead of the RuntimeError that
        # dec() catches, and the legacy-iterations fallback never ran. That is how tokens
        # written before PBKDF2_ITERS was raised became unreadable on OpenSSL 3.5.
        r = subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2",
                            "-iter", str(iters), "-salt", "-a", "-A",
                            mode, "-pass", f"fd:{r_fd}"], input=data.encode(),
                           capture_output=True, pass_fds=(r_fd,))
    finally:
        os.close(r_fd)
    if r.returncode != 0:
        err = r.stderr.decode("utf-8", "replace") if r.stderr else "openssl failed"
        raise RuntimeError(err.strip()[:200])
    try:
        return r.stdout.decode("utf-8").strip()
    except UnicodeDecodeError as e:
        raise RuntimeError("openssl produced undecodable output") from e


def enc(plain, secret):
    return openssl("-e", plain, PBKDF2_ITERS, users_key(secret))


def dec(cipher, secret):
    try:
        return openssl("-d", cipher, PBKDF2_ITERS, users_key(secret))
    except RuntimeError:
        # Written before PBKDF2_ITERS was raised. Wrong key and wrong iteration count are
        # indistinguishable here, so a genuinely undecryptable value costs one extra fork.
        return openssl("-d", cipher, PBKDF2_ITERS_LEGACY, users_key(secret))


def load_users(path):
    path = Path(path)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text()) or {}
    except json.JSONDecodeError:
        return {}


def save_users(users, path):
    path = Path(path)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(users, indent=1))
    os.chmod(tmp, 0o600)
    tmp.replace(path)


# users.json has TWO writers: the server process, and `rs_devices.py prune`, which pr-watch.sh
# runs nightly and which does its own full read-modify-write. The in-process lock keeps two
# requests from losing each other's update; the fcntl lock on the sibling .lock file keeps the
# prune from rolling back a sign-in that landed inside its window (the prune takes the same
# lock). The lock is on a sibling file, not users.json, because both writers replace users.json
# by rename — a lock held on its inode would be orphaned by the first swap.
@contextlib.contextmanager
def file_lock(path):
    lock = Path(rs_dev.lock_path(Path(path)))
    lock.parent.mkdir(parents=True, exist_ok=True)
    with open(lock, "a+") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
        try:
            os.chmod(lock, 0o600)
        except OSError:
            pass
        yield


def modify_users(fn, path, lock=None):
    """Serialized read-modify-write of users.json. fn(users) mutates the dict in place.
    `lock` is the caller's in-process threading.Lock; the file lock is always taken."""
    with (lock or threading.Lock()), file_lock(path):
        users = load_users(path)
        fn(users)
        save_users(users, path)
