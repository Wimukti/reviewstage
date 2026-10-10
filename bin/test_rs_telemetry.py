#!/usr/bin/env python3
"""Zero-by-default telemetry (bin/rs_telemetry.py, openspec/changes/p0-proof/lane1-telemetry.md).

What these prove:
  1. Nothing leaves the box unless every gate agrees. With urlopen replaced by a function that
     raises, a flush under RS_TELEMETRY=0, under the admin switch, without consent and without an
     endpoint never calls it. Only with all four satisfied does exactly one POST happen.
  2. The allowlist is executable. A payload with a repo name, a path, a login or a free-text
     error is refused by assert_allowed(); a counter outside SCHEMA is never written.
  3. Counters persist and accumulate across process-shaped boundaries (re-read from disk).
  4. The server's hooks count the right thing: a post counts kept/edited/dropped, install_completed
     fires once, the settings PUT learns telemetry_enabled.

Run: python3 -m unittest bin/test_rs_telemetry.py
"""
import importlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def load(root):
    os.environ["ROOT"] = root
    for name in ("rs_paths", "rs_telemetry"):
        if name in sys.modules:
            importlib.reload(sys.modules[name])
        else:
            importlib.import_module(name)
    return sys.modules["rs_telemetry"]


def no_network(*_a, **_k):
    raise AssertionError("urlopen was called — telemetry left the box")


class Base(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.T = load(self.root)
        self.env = {}                                  # no kill switch, no endpoint

    def settings(self, **kv):
        Path(self.root, "settings.json").write_text(json.dumps(kv))

    def fill(self, days=("2026-10-01", "2026-10-02")):
        """Counters on two complete days, at noon UTC of each."""
        import calendar
        import time as _t
        for d in days:
            now = calendar.timegm(_t.strptime(d + " 12:00", "%Y-%m-%d %H:%M"))
            self.T.bump("review_started", now=now, effort="standard")
            self.T.bump("findings_shown", n=3, now=now)
        # "today" for flush is well after both days
        return calendar.timegm(_t.strptime("2026-10-10 12:00", "%Y-%m-%d %H:%M"))


# --- 1. the gates ------------------------------------------------------------------------------
class NothingLeavesUnlessEveryGateAgrees(Base):
    def test_killed_by_env(self):
        self.T.set_consent(True)
        now = self.fill()
        env = {"RS_TELEMETRY": "0", "RS_TELEMETRY_ENDPOINT": "https://t.example/v1"}
        self.assertEqual(self.T.decision(env)[0], "killed")
        r = self.T.flush(env=env, now=now, opener=no_network)
        self.assertEqual(r["sent"], 0)

    def test_killed_by_the_rename_alias_too(self):
        self.T.set_consent(True)
        env = {"KEEPDROP_TELEMETRY": "0", "RS_TELEMETRY_ENDPOINT": "https://t.example/v1"}
        self.assertEqual(self.T.decision(env)[0], "killed")

    def test_disabled_by_admin(self):
        self.T.set_consent(True)
        self.settings(telemetry_enabled=False)
        now = self.fill()
        env = {"RS_TELEMETRY_ENDPOINT": "https://t.example/v1"}
        self.assertEqual(self.T.decision(env)[0], "disabled_by_admin")
        self.assertEqual(self.T.flush(env=env, now=now, opener=no_network)["sent"], 0)

    def test_no_consent_is_the_default(self):
        now = self.fill()
        env = {"RS_TELEMETRY_ENDPOINT": "https://t.example/v1"}
        self.assertEqual(self.T.decision(env)[0], "no_consent")
        self.assertEqual(self.T.flush(env=env, now=now, opener=no_network)["sent"], 0)
        self.assertEqual(self.T.outbox(), [], "nothing is even queued without consent")

    def test_no_endpoint_even_with_consent(self):
        self.T.set_consent(True)
        now = self.fill()
        self.assertEqual(self.T.decision({})[0], "no_endpoint")
        r = self.T.flush(env={}, now=now, opener=no_network)
        self.assertEqual(r["sent"], 0)
        self.assertEqual(r["queued"], 2, "queued so View queued can show it, never sent")
        # http:// is not an endpoint either
        self.assertEqual(self.T.decision({"RS_TELEMETRY_ENDPOINT": "http://t.example"})[0],
                         "no_endpoint")

    def test_active_sends_exactly_one_post_per_complete_day(self):
        self.T.set_consent(True)
        now = self.fill()
        seen = []

        class Resp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def opener(req, timeout=0):
            seen.append((req.full_url, req.get_method(), json.loads(req.data.decode()),
                         dict(req.header_items())))
            return Resp()

        env = {"RS_TELEMETRY_ENDPOINT": "https://t.example/v1"}
        self.assertEqual(self.T.decision(env)[0], "active")
        r = self.T.flush(env=env, now=now, opener=opener)
        self.assertEqual(r["sent"], 2)
        self.assertEqual(len(seen), 2)
        for url, method, body, headers in seen:
            self.assertEqual((url, method), ("https://t.example/v1", "POST"))
            self.T.assert_allowed(body)
            self.assertEqual(body["counters"],
                             {"review_started|effort=standard": 1, "findings_shown": 3})
            self.assertNotIn("Cookie", headers)
        # Today is incomplete and not sent; a second flush sends nothing new.
        self.assertEqual(self.T.flush(env=env, now=now, opener=opener)["sent"], 0)
        self.assertEqual(len(seen), 2)

    def test_a_non_2xx_keeps_the_day_queued(self):
        self.T.set_consent(True)
        now = self.fill()

        def opener(req, timeout=0):
            raise OSError("connection refused")

        env = {"RS_TELEMETRY_ENDPOINT": "https://t.example/v1"}
        r = self.T.flush(env=env, now=now, opener=opener)
        self.assertEqual((r["sent"], r["queued"]), (0, 2))
        self.assertTrue(all(not x.get("sent_at") for x in self.T.outbox()))


# --- 2. the allowlist -------------------------------------------------------------------------
class TheAllowlistIsExecutable(Base):
    def good(self):
        return {"schema": 1, "install_id": "a" * 32, "day": "2026-10-01", "app_version": "",
                "platform": "darwin", "mode": "personal", "return_7d": False,
                "return_28d": True, "counters": {"findings_kept": 2,
                                                 "post_attempted|dry=1": 1}}

    def test_a_clean_payload_passes(self):
        self.assertTrue(self.T.assert_allowed(self.good()))

    def test_forbidden_top_level_keys_are_refused(self):
        for k, v in {"repo": "acme/widgets", "login": "alice", "path": "app/pay.py",
                     "pr": 7, "title": "Fix", "token": "ghp_x", "error": "boom",
                     "hostname": "box", "ip": "1.2.3.4", "ts": 1760000000}.items():
            p = self.good()
            p[k] = v
            with self.assertRaises(ValueError, msg=k):
                self.T.assert_allowed(p)

    def test_counter_keys_outside_the_schema_are_refused(self):
        for key in ("repo=acme/widgets", "review_started|effort=insane",
                    "connect_result|service=github", "findings_kept|user=alice",
                    "dismissal_reason|reason=This finding is wrong because",
                    "dismissal_reason|reason=/etc/passwd", "free text"):
            p = self.good()
            p["counters"] = {key: 1}
            with self.assertRaises(ValueError, msg=key):
                self.T.assert_allowed(p)

    def test_bump_refuses_anything_outside_the_schema_and_writes_nothing(self):
        self.assertFalse(self.T.bump("repo_opened", repo="acme/widgets"))
        self.assertFalse(self.T.bump("review_started", effort="maximal"))
        self.assertFalse(self.T.bump("review_started"))                # missing dimension
        self.assertFalse(self.T.bump("findings_kept", n=0))
        self.assertFalse(self.T.bump("dismissal_reason", reason="the finding was wrong"))
        self.assertFalse(self.T.counters_path().exists())

    def test_install_id_is_random_and_a_minted_payload_passes(self):
        self.T.set_consent(True)
        iid = self.T.consent()["install_id"]
        self.assertRegex(iid, r"^[0-9a-f]{32}$")
        now = self.fill()
        rows = self.T.enqueue(now=now, mode="personal")
        self.assertEqual(len(rows), 2)
        for r in rows:
            self.T.assert_allowed(r["payload"])
            self.assertEqual(r["payload"]["install_id"], iid)
        self.assertTrue(rows[1]["payload"]["return_7d"], "two active days a day apart")
        self.assertFalse(rows[0]["payload"]["return_7d"], "the first day has nothing before it")

    def test_dismissal_reason_counts_is_tolerant(self):
        rows = [{"outcome": "dropped"}, {"outcome": "dropped", "reason": "not_an_issue"},
                {"outcome": "kept", "reason": "not_an_issue"},
                {"outcome": "dropped", "reason": "Free text with spaces"}, "junk", None]
        self.assertEqual(self.T.dismissal_reason_counts(rows), {"not_an_issue": 1})
        self.assertEqual(self.T.dismissal_reason_counts([]), {})
        self.assertEqual(self.T.dismissal_reason_counts(None), {})


# --- 3. counters persist -------------------------------------------------------------------------
class CountersPersist(Base):
    def test_bump_accumulates_and_survives_a_reload(self):
        self.assertTrue(self.T.bump("findings_kept", n=2, now=1_760_000_000))
        self.assertTrue(self.T.bump("findings_kept", now=1_760_000_000))
        self.assertTrue(self.T.bump("post_attempted", now=1_760_000_000, dry="1"))
        T2 = load(self.root)
        day = T2.today(1_760_000_000)
        self.assertEqual(T2.counters(), {day: {"findings_kept": 3, "post_attempted|dry=1": 1}})
        self.assertEqual(oct(T2.counters_path().stat().st_mode)[-3:], "600")

    def test_a_corrupt_file_is_not_fatal(self):
        self.T.counters_path().parent.mkdir(parents=True)
        self.T.counters_path().write_text("{not json")
        self.assertEqual(self.T.counters(), {})
        self.assertTrue(self.T.bump("findings_kept"))

    def test_clear_deletes_and_remints(self):
        self.T.set_consent(True)
        before = self.T.consent()["install_id"]
        now = self.fill()
        self.T.enqueue(now=now)
        st = self.T.clear()
        self.assertEqual(st["counters"], {})
        self.assertEqual(st["outbox"], [])
        self.assertNotEqual(self.T.consent()["install_id"], before)

    def test_revoking_consent_drops_the_id_and_the_queue(self):
        self.T.set_consent(True)
        now = self.fill()
        self.T.enqueue(now=now)
        self.T.set_consent(False)
        c = self.T.consent()
        self.assertTrue(c["decided"])
        self.assertFalse(c["consented"])
        self.assertIsNone(c["install_id"])
        self.assertEqual(self.T.outbox(), [])
        self.assertEqual(self.T.decision({})[0], "no_consent")

    def test_duration_buckets_and_error_categories(self):
        T = self.T
        self.assertEqual([T.duration_bucket(x) for x in (0, 59_999, 60_000, 179_999, 180_000,
                                                          599_999, 600_000, "x")],
                         ["lt1m", "lt1m", "1to3m", "1to3m", "3to10m", "3to10m", "gt10m", "lt1m"])
        self.assertEqual(T.connect_error_category(""), "ok")
        self.assertEqual(T.connect_error_category("That sign-in attempt expired — start again."),
                         "expired_code")
        self.assertEqual(T.connect_error_category("no token endpoint answered"), "network")
        self.assertEqual(T.connect_error_category("Got a token but it did not work here"),
                         "bad_token")
        self.assertEqual(T.connect_error_category("something else entirely"), "other")

    def test_the_cli_bumps_like_the_shell_script_does(self):
        import subprocess
        r = subprocess.run([sys.executable, os.path.join(HERE, "rs_telemetry.py"), "bump",
                            "review_completed", "outcome=done"],
                           env={**os.environ, "ROOT": self.root, "PYTHONPATH": HERE},
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        r = subprocess.run([sys.executable, os.path.join(HERE, "rs_telemetry.py"), "bump",
                            "findings_shown", "--n", "4"],
                           env={**os.environ, "ROOT": self.root, "PYTHONPATH": HERE},
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        bad = subprocess.run([sys.executable, os.path.join(HERE, "rs_telemetry.py"), "bump",
                              "repo_opened", "repo=acme/widgets"],
                             env={**os.environ, "ROOT": self.root, "PYTHONPATH": HERE},
                             capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1)
        days = load(self.root).counters()
        self.assertEqual(list(days.values()),
                         [{"review_completed|outcome=done": 1, "findings_shown": 4}])


# --- 4. the server's hooks -------------------------------------------------------------------------
SECRET = "p" * 64
REPO = "acme/widgets"
PR = "7"
USER = "alice"
HEAD = "a" * 40


def load_server(root, extra=""):
    os.makedirs(os.path.join(root, "state"), exist_ok=True)
    with open(os.path.join(root, ".env"), "w") as f:
        f.write(f"RS_SECRET={SECRET}\nREPOS={REPO}\nGITHUB_PAT=service\nDRY_RUN=1\n{extra}")
    os.environ["ROOT"] = root
    os.environ["RS_COOKIE_SECURE"] = "0"
    for name in ("rs_paths", "rs_learn", "rs_profile", "rs_queue", "rs_telemetry", "server"):
        if name in sys.modules:
            importlib.reload(sys.modules[name])
        else:
            importlib.import_module(name)
    return sys.modules["server"]


REVIEW = {"event": "COMMENT", "summary": "Looks reasonable.",
          "comments": [{"severity": "blocker", "path": "app/pay.py", "line": 12,
                        "body": "This double-charges."},
                       {"severity": "should-fix", "path": "app/pay.py", "line": 20,
                        "body": "Name this."},
                       {"severity": "nit", "path": "app/pay.py", "line": 30,
                        "body": "Trailing space."}]}


class ServerHooks(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.srv = load_server(self.root)
        self.T = sys.modules["rs_telemetry"]
        self.srv.save_users({USER: {"name": "Alice"}})
        self.d = self.srv.udir(REPO, PR, USER)
        self.d.mkdir(parents=True, exist_ok=True)
        (self.d / "review.json").write_text(json.dumps(REVIEW))
        (self.d / "head").write_text(HEAD)
        f = self.srv.P.prdir(REPO, PR) / "meta.json"
        f.write_text(json.dumps({"number": int(PR), "title": "Pay twice", "head": HEAD,
                                 "author": "bob", "url": "https://example.invalid"}))
        self.srv.user_pat = lambda login: "user-token"

        class R:
            def __init__(self, rc=0, out="", err=""):
                self.returncode, self.stdout, self.stderr = rc, out, err
        files = [{"filename": "app/pay.py", "status": "modified",
                  "patch": "@@ -1,0 +12,20 @@\n" + "+x\n" * 20}]
        pr_obj = {"state": "open", "draft": False, "merged": False,
                  "head": {"sha": HEAD}, "user": {"login": "bob"}}

        def gh(args, timeout=45, token=None):
            a = list(args)
            if a[0] == "api" and a[1].endswith("/files"):
                return R(0, json.dumps([files]))
            if a[0] == "api" and "/pulls/" in a[1]:
                return R(0, json.dumps(pr_obj))
            return R(0, "{}")
        self.srv.gh = gh

    def form(self, selected, bodies=None, reasons=None):
        originals = sorted(REVIEW["comments"],
                           key=lambda c: self.srv.SEV_ORDER.get(c.get("severity"), 9))
        form = {"pr": [PR], "count": [str(len(originals))]}
        for i, c in enumerate(originals):
            if i in selected:
                form[f"sel_{i}"] = ["on"]
            form[f"body_{i}"] = [(bodies or {}).get(i, c["body"])]
            form[f"sugg_{i}"] = [""]
            form[f"path_{i}"] = [c["path"]]
            form[f"line_{i}"] = [str(c["line"])]
            form[f"sev_{i}"] = [c["severity"]]
            if reasons and i in reasons:
                form[f"reason_{i}"] = [reasons[i]]
        return form

    def today_counters(self):
        days = self.T.counters()
        return days[max(days)] if days else {}

    def test_a_dry_run_post_counts_kept_edited_dropped_and_reasons(self):
        h = self.srv.Handler.__new__(self.srv.Handler)
        banner = h._post_result(REPO, PR, USER,
                                self.form({0, 1}, bodies={1: "Please name this."},
                                          reasons={2: "style_only",
                                                   1: "ignored-because-selected"}))
        self.assertIn("DRY RUN", banner)
        c = self.today_counters()
        self.assertEqual(c.get("post_attempted|dry=1"), 1)
        self.assertEqual(c.get("post_succeeded|dry=1"), 1)
        self.assertEqual(c.get("findings_kept"), 1)
        self.assertEqual(c.get("findings_edited"), 1)
        self.assertEqual(c.get("findings_dropped"), 1)
        self.assertEqual(c.get("dismissal_reason|reason=style_only"), 1)
        self.assertNotIn("dismissal_reason|reason=ignored-because-selected", c)
        # And nothing in the store names the repo, the PR, the user or a path.
        raw = self.T.counters_path().read_text()
        for secret in (REPO, "acme", "alice", "app/pay.py", "double-charges", PR + '"'):
            self.assertNotIn(secret, raw)

    def test_the_server_never_imports_a_third_party_sender(self):
        src = Path(HERE, "rs_telemetry.py").read_text()
        for bad in ("import requests", "segment", "posthog", "mixpanel", "sentry", "amplitude"):
            self.assertNotIn(bad, src.lower())

    def test_api_me_reports_whether_the_question_was_answered(self):
        h = self.srv.Handler.__new__(self.srv.Handler)
        self.assertFalse(h.api_me(USER)["telemetry_decided"])
        self.T.set_consent(False)
        self.assertTrue(h.api_me(USER)["telemetry_decided"])

    def test_settings_validate_learns_telemetry_enabled(self):
        rs_settings = sys.modules["rs_settings"]
        clean, err = rs_settings.validate({"telemetry_enabled": False})
        self.assertIsNone(err)
        self.assertEqual(clean, {"telemetry_enabled": False})
        _, err = rs_settings.validate({"telemetry_enabled": "no"})
        self.assertIn("telemetry_enabled", err)
        vals, src = rs_settings.effective(Path(self.root, "settings.json"), {})
        self.assertEqual((vals["telemetry_enabled"], src["telemetry_enabled"]),
                         (True, "default"))
        rs_settings.save(Path(self.root, "settings.json"), clean)
        self.assertEqual(self.T.decision({})[0], "disabled_by_admin")

    def test_status_names_the_decision_and_the_reason(self):
        st = self.T.status({"RS_TELEMETRY": "0"})
        self.assertEqual(st["state"], "killed")
        self.assertIn("RS_TELEMETRY=0", st["reason"])
        self.assertTrue(st["killSwitch"])
        self.assertFalse(st["endpointSet"])
        self.assertIn("review_started", st["schema"])


class InstallCompletedFiresOnce(unittest.TestCase):
    def test_personal_first_sign_in_only(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        srv = load_server(root, extra="RS_PERSONAL=1\n")
        T = sys.modules["rs_telemetry"]
        srv.save_users({})
        srv.tally_install(True)                 # first sign-in, but users.json still empty
        self.assertEqual(T.counters(), {})
        srv.save_users({USER: {"name": "Alice"}})
        srv.tally_install(True)
        srv.tally_install(False)                # the same person signing in again
        srv.save_users({USER: {"name": "Alice"}, "bob": {"name": "Bob"}})
        srv.tally_install(True)                 # a second person is not an install
        days = T.counters()
        self.assertEqual(list(days.values()), [{"install_completed": 1}])

    def test_team_mode_never_counts_an_install(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        srv = load_server(root)
        srv.save_users({USER: {"name": "Alice"}})
        srv.tally_install(True)
        self.assertEqual(sys.modules["rs_telemetry"].counters(), {})


if __name__ == "__main__":
    unittest.main()
