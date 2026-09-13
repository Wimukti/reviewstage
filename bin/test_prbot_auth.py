#!/usr/bin/env python3
"""Unit tests for the device-token layer (bin/prbot_devices.py): bearer parsing, hashing and
lookup, sliding expiry, the per-user cap with oldest-first eviction, revoke and prune.
Run: python3 -m unittest bin/test_prbot_auth.py"""
import json
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prbot_devices as dev  # noqa: E402

NOW = 1_800_000_000


class BearerParsing(unittest.TestCase):
    def test_extracts_token(self):
        self.assertEqual(dev.parse_bearer({"Authorization": "Bearer abc-DEF_123"}), "abc-DEF_123")

    def test_scheme_is_case_insensitive(self):
        self.assertEqual(dev.parse_bearer({"Authorization": "bearer tok"}), "tok")

    def test_rejects_other_schemes_and_garbage(self):
        for h in ("Basic dXNlcjpwYXNz", "Bearer", "Bearer ", "Bearer a b", 'Bearer "quoted"',
                  "Bearer " + "x" * 129, ""):
            self.assertEqual(dev.parse_bearer({"Authorization": h}), "", h)

    def test_missing_header(self):
        self.assertEqual(dev.parse_bearer({}), "")


class HashingAndLookup(unittest.TestCase):
    def test_only_the_hash_is_stored(self):
        u = {}
        tok, rec, evicted = dev.add_device(u, "Phone", now=NOW)
        self.assertEqual(evicted, [])
        self.assertNotIn(tok, json.dumps(u))
        self.assertIn(dev.hash_token(tok), u["devices"])
        self.assertEqual(rec["name"], "Phone")
        self.assertEqual(rec["created"], NOW)
        self.assertEqual(len(rec["id"]), 16)

    def test_token_shape(self):
        tok = dev.new_token()
        self.assertEqual(len(tok), 43)
        self.assertEqual(dev.parse_bearer({"Authorization": f"Bearer {tok}"}), tok)

    def test_lookup_finds_the_owner(self):
        users = {"alice": {}, "bob": {}}
        tok, _, _ = dev.add_device(users["bob"], "Laptop", now=NOW)
        login, h, rec = dev.lookup(users, tok, now=NOW)
        self.assertEqual(login, "bob")
        self.assertEqual(h, dev.hash_token(tok))
        self.assertEqual(rec["name"], "Laptop")

    def test_lookup_refuses_unknown_and_removed_user(self):
        users = {"bob": {}}
        tok, _, _ = dev.add_device(users["bob"], "Laptop", now=NOW)
        self.assertEqual(dev.lookup(users, "not-a-token", now=NOW), (None, None, None))
        del users["bob"]
        self.assertEqual(dev.lookup(users, tok, now=NOW), (None, None, None))

    def test_lookup_ignores_malformed_devices_field(self):
        users = {"bob": {"devices": "oops"}}
        self.assertEqual(dev.lookup(users, "x", now=NOW), (None, None, None))

    def test_name_is_cleaned_and_capped(self):
        self.assertEqual(dev.clean_name("  my   phone \n"), "my phone")
        self.assertEqual(dev.clean_name(""), "Unnamed device")
        self.assertEqual(len(dev.clean_name("x" * 200)), dev.NAME_MAX)


class Expiry(unittest.TestCase):
    def test_sliding_window(self):
        users = {"bob": {}}
        tok, rec, _ = dev.add_device(users["bob"], "Phone", now=NOW)
        almost = NOW + dev.TTL_SECONDS
        self.assertEqual(dev.lookup(users, tok, now=almost)[0], "bob")
        self.assertIsNone(dev.lookup(users, tok, now=almost + 1)[0])
        # Using it slides the window.
        rec["last_seen"] = almost
        self.assertEqual(dev.lookup(users, tok, now=almost + dev.TTL_SECONDS)[0], "bob")

    def test_created_counts_when_last_seen_missing(self):
        rec = {"created": NOW}
        self.assertFalse(dev.expired(rec, now=NOW + 10))
        self.assertTrue(dev.expired(rec, now=NOW + dev.TTL_SECONDS + 1))
        self.assertTrue(dev.expired({}, now=NOW))

    def test_bump_is_rate_limited(self):
        rec = {"last_seen": NOW}
        self.assertFalse(dev.needs_bump(rec, now=NOW + dev.LAST_SEEN_BUMP - 1))
        self.assertTrue(dev.needs_bump(rec, now=NOW + dev.LAST_SEEN_BUMP))

    def test_prune_drops_only_expired(self):
        users = {"a": {}, "b": {"devices": "bad"}, "c": {}}
        t_old, rec_old, _ = dev.add_device(users["a"], "old", now=NOW)
        t_new, _, _ = dev.add_device(users["a"], "new", now=NOW + 1000)
        dev.add_device(users["c"], "c1", now=NOW)
        later = NOW + dev.TTL_SECONDS + 500
        self.assertEqual(dev.prune(users, now=later), 2)
        self.assertIsNone(dev.lookup(users, t_old, now=later)[0])
        self.assertEqual(dev.lookup(users, t_new, now=later)[0], "a")
        self.assertEqual(users["c"]["devices"], {})

    def test_cli_prune_rewrites_only_when_needed(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "users.json")
            users = {"a": {}}
            real = int(time.time())                        # the CLI uses the wall clock
            dev.add_device(users["a"], "fresh", now=real - 10)
            dev.add_device(users["a"], "stale", now=real - dev.TTL_SECONDS - 10)
            with open(path, "w") as f:
                json.dump(users, f)
            self.assertEqual(dev._cli_prune(path), 0)
            with open(path) as f:
                after = json.load(f)
            self.assertEqual([r["name"] for r in after["a"]["devices"].values()], ["fresh"])
            self.assertEqual(oct(os.stat(path).st_mode & 0o777), "0o600")
            before = os.stat(path).st_mtime_ns
            self.assertEqual(dev._cli_prune(path), 0)          # nothing to do: no write
            self.assertEqual(os.stat(path).st_mtime_ns, before)
            self.assertEqual(dev._cli_prune(os.path.join(d, "missing.json")), 1)


class CapAndEviction(unittest.TestCase):
    def test_cap_evicts_least_recently_used(self):
        u = {}
        toks = [dev.add_device(u, f"d{i}", now=NOW + i)[0] for i in range(dev.MAX_DEVICES)]
        self.assertEqual(len(u["devices"]), dev.MAX_DEVICES)
        # d0 is the oldest by last use → the 11th device evicts it.
        tok11, _, evicted = dev.add_device(u, "d10", now=NOW + 100)
        self.assertEqual(evicted, ["d0"])
        self.assertEqual(len(u["devices"]), dev.MAX_DEVICES)
        users = {"x": u}
        self.assertIsNone(dev.lookup(users, toks[0], now=NOW + 100)[0])
        self.assertEqual(dev.lookup(users, toks[1], now=NOW + 100)[0], "x")
        self.assertEqual(dev.lookup(users, tok11, now=NOW + 100)[0], "x")

    def test_recently_used_old_device_survives(self):
        u = {}
        toks = [dev.add_device(u, f"d{i}", now=NOW + i)[0] for i in range(dev.MAX_DEVICES)]
        u["devices"][dev.hash_token(toks[0])]["last_seen"] = NOW + 999   # d0 just used
        _, _, evicted = dev.add_device(u, "new", now=NOW + 1000)
        self.assertEqual(evicted, ["d1"])

    def test_never_evicts_the_device_just_minted(self):
        u = {}
        for i in range(dev.MAX_DEVICES):
            dev.add_device(u, f"d{i}", now=NOW + 1000 + i)
        tok, rec, evicted = dev.add_device(u, "older-clock", now=NOW)   # earlier timestamp
        self.assertEqual(len(evicted), 1)
        self.assertNotEqual(evicted[0], "older-clock")
        self.assertEqual(dev.lookup({"x": u}, tok, now=NOW + 2000)[0], "x")


class RevokeAndList(unittest.TestCase):
    def test_list_hides_secrets_and_marks_current(self):
        u = {}
        t1, r1, _ = dev.add_device(u, "one", now=NOW)
        t2, r2, _ = dev.add_device(u, "two", now=NOW + 5)
        rows = dev.list_devices(u, current_hash=dev.hash_token(t2))
        self.assertEqual([r["name"] for r in rows], ["two", "one"])     # newest first
        self.assertEqual([r["current"] for r in rows], [True, False])
        dumped = json.dumps(rows)
        self.assertNotIn(t1, dumped)
        self.assertNotIn(dev.hash_token(t1), dumped)
        self.assertEqual(set(rows[0]), {"id", "name", "created", "last_seen", "current"})

    def test_revoke_one_and_all(self):
        u = {}
        t1, r1, _ = dev.add_device(u, "one", now=NOW)
        t2, _, _ = dev.add_device(u, "two", now=NOW)
        self.assertEqual(dev.revoke(u, device_id="nope"), 0)
        self.assertEqual(dev.revoke(u, device_id=r1["id"]), 1)
        users = {"x": u}
        self.assertIsNone(dev.lookup(users, t1, now=NOW)[0])
        self.assertEqual(dev.lookup(users, t2, now=NOW)[0], "x")
        self.assertEqual(dev.revoke(u, all_devices=True), 1)
        self.assertEqual(u["devices"], {})
        self.assertEqual(dev.revoke({}, all_devices=True), 0)


if __name__ == "__main__":
    unittest.main()
