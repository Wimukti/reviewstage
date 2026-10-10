#!/usr/bin/env python3
"""rs_users.py — the users.json + token-encryption helpers extracted from server.py so the
doctor can read who signed in without the server's import-time side effects.

Run: python3 -m unittest bin/test_rs_users.py
"""
import importlib
import inspect
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import rs_users  # noqa: E402

SECRET = "u" * 48


class RoundTrip(unittest.TestCase):
    def test_enc_dec_round_trip_and_wrong_secret_fails(self):
        c = rs_users.enc("ghp_secret", SECRET)
        self.assertNotIn("ghp_secret", c)
        self.assertEqual(rs_users.dec(c, SECRET), "ghp_secret")
        with self.assertRaises(RuntimeError):
            rs_users.dec(c, "v" * 48)

    def test_legacy_iteration_count_still_decrypts(self):
        legacy = rs_users.openssl("-e", "ghp_old", rs_users.PBKDF2_ITERS_LEGACY,
                                  rs_users.users_key(SECRET))
        self.assertEqual(rs_users.dec(legacy, SECRET), "ghp_old")

    def test_the_key_never_travels_in_the_child_environment(self):
        src = inspect.getsource(rs_users.openssl)
        self.assertIn("pass_fds", src)
        self.assertNotIn("env:", src)

    def test_importing_rs_users_has_no_side_effects(self):
        """No ROOT read, no .env parse, no migration: the module is safe to import from a
        diagnostic that must write nothing."""
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        saved = os.environ.get("ROOT")
        os.environ["ROOT"] = root
        try:
            importlib.reload(rs_users)
        finally:
            if saved is None:
                del os.environ["ROOT"]
            else:
                os.environ["ROOT"] = saved
        self.assertEqual(os.listdir(root), [])


class UsersFile(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        self.path = self.root / "users.json"

    def test_missing_or_broken_file_reads_as_empty(self):
        self.assertEqual(rs_users.load_users(self.path), {})
        self.path.write_text("{not json")
        self.assertEqual(rs_users.load_users(self.path), {})

    def test_save_is_atomic_and_mode_600(self):
        rs_users.save_users({"ann": {"name": "Ann"}}, self.path)
        self.assertEqual(oct(self.path.stat().st_mode & 0o777), "0o600")
        self.assertEqual(json.loads(self.path.read_text()), {"ann": {"name": "Ann"}})
        self.assertFalse((self.root / "users.tmp").exists())

    def test_modify_users_serialises_writers(self):
        lock = threading.Lock()

        def bump(users):
            users["n"] = {"count": users.get("n", {}).get("count", 0) + 1}
        threads = [threading.Thread(target=rs_users.modify_users, args=(bump, self.path, lock))
                   for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(rs_users.load_users(self.path)["n"]["count"], 8)
        self.assertTrue(Path(str(self.path) + ".lock").exists())


if __name__ == "__main__":
    unittest.main()
