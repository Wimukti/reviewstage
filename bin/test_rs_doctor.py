#!/usr/bin/env python3
"""rs_doctor.py and the doctor.sh that merges it (openspec/changes/p0-proof lane 5).

The two false results the lane fixes, pinned: a personal install must not FAIL for a missing
GITHUB_PAT (it has none by design), and the port probe must use the port the desktop recorded
in desktop.json, not RS_PORT|8899. Plus the token-expiry statuses, the permission check, the
runtime checks, the exit-code policy and the --json shape. No test here touches the network:
every probe is injected, and the default run never decrypts a token.

Run: python3 -m unittest bin/test_rs_doctor.py
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import rs_doctor as D  # noqa: E402
import rs_users  # noqa: E402

NOW = 1_760_000_000
SECRET = "s" * 48


def closed(_port, **_):
    return "closed"


def healthy(_port, **_):
    return "ok"


def by_id(rep, id_):
    return [c for c in rep.checks if c["id"] == id_]


def statuses(rep, id_):
    return [c["status"] for c in by_id(rep, id_)]


class Fixture(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="rs-doctor-"))
        os.chmod(self.root, 0o700)
        (self.root / "state").mkdir()
        self.addCleanup(shutil.rmtree, self.root, True)

    def write(self, name, obj, mode=0o600):
        p = self.root / name
        p.write_text(json.dumps(obj) if not isinstance(obj, str) else obj)
        os.chmod(p, mode)
        return p

    def env(self, **kw):
        base = {"PATH": os.environ.get("PATH", ""), "HOME": str(self.root)}
        base.update(kw)
        return base

    def run_doctor(self, users=None, env=None, now=NOW, live=False, platform="darwin", **probes):
        probes.setdefault("health", closed)
        probes.setdefault("which", lambda name: None)
        probes.setdefault("node", "22.1.0")
        return D.run(self.root, env=env if env is not None else self.env(), now=now, live=live,
                     platform=platform, users=users if users is not None else {}, **probes)


class PersonalMode(Fixture):
    def test_personal_install_without_github_pat_has_no_failure(self):
        """The bug: a desktop install has no service token, and the doctor demanded one."""
        self.write(".env", f"RS_SECRET={SECRET}\nRS_PERSONAL=1\nPUBLIC_URL=http://127.0.0.1:51000\n")
        self.write("desktop.json", {"phone": False, "port": 51000})
        self.write("users.json", {"ann": {"gh_token_enc": "x", "gh_exp": 0, "gh_client": "device",
                                          "claude_token_enc": "y", "claude_exp": 0}})
        rep = self.run_doctor(users=None)
        self.assertEqual(rep.fails, 0, rep.checks)
        self.assertNotIn("FAIL", statuses(rep, "github.auth"))
        texts = " ".join(c["text"] for c in rep.checks)
        self.assertNotIn("GITHUB_PAT not set", texts)
        self.assertIn("personal mode", by_id(rep, "mode")[0]["text"])

    def test_personal_is_detected_from_desktop_json_alone(self):
        """Running bin/doctor.sh by hand, without the launcher's RS_PERSONAL=1, must still
        recognise a desktop install."""
        self.write("desktop.json", {"phone": False})
        self.assertTrue(D.is_personal({}, self.root))
        self.assertTrue(D.is_personal({"RS_PERSONAL": "1"}, "/nonexistent"))
        self.assertTrue(D.is_personal({"RS_DOCTOR_DESKTOP": "1"}, "/nonexistent"))
        self.assertFalse(D.is_personal({}, "/nonexistent"))

    def test_personal_with_nobody_signed_in_warns_not_fails(self):
        self.write("desktop.json", {})
        rep = self.run_doctor(users={})
        self.assertEqual(statuses(rep, "github.auth"), ["WARN"])
        self.assertEqual(statuses(rep, "claude.auth"), ["WARN"])
        self.assertEqual(rep.fails, 0)

    def test_team_mode_with_no_users_is_only_a_note(self):
        rep = self.run_doctor(users={}, env=self.env(GITHUB_PAT="ghp_service"))
        self.assertEqual(statuses(rep, "github.auth"), ["NOTE", "NOTE"])
        self.assertIn("team mode", by_id(rep, "mode")[0]["text"])


class TokenExpiry(Fixture):
    def user(self, **kw):
        base = {"gh_token_enc": "enc", "gh_client": "device"}
        base.update(kw)
        return {"ann": base}

    def test_valid_token_passes_and_names_the_client(self):
        rep = self.run_doctor(users=self.user(gh_exp=NOW + 30 * 86400))
        rows = by_id(rep, "github.auth")
        self.assertEqual([r["status"] for r in rows], ["PASS", "PASS"])
        self.assertEqual(rows[1]["gh_client"], "device")
        self.assertIn("expires in 30 d", rows[1]["text"])

    def test_never_expiring_token_passes(self):
        rep = self.run_doctor(users=self.user(gh_exp=0, gh_client="oauth"))
        self.assertIn("expires never", by_id(rep, "github.auth")[1]["text"])

    def test_expired_token_with_a_live_refresh_token_warns(self):
        rep = self.run_doctor(users=self.user(gh_exp=NOW - 3600, gh_refresh_enc="r",
                                              gh_refresh_exp=NOW + 86400 * 100))
        self.assertEqual(statuses(rep, "github.auth"), ["PASS", "WARN"])
        self.assertIn("refreshes on the next request", by_id(rep, "github.auth")[1]["text"])

    def test_expired_token_without_refresh_fails(self):
        rep = self.run_doctor(users=self.user(gh_exp=NOW - 3600))
        self.assertEqual(statuses(rep, "github.auth"), ["PASS", "FAIL"])
        self.assertIn("sign in again", by_id(rep, "github.auth")[1]["text"])
        self.assertEqual(rep.exit_code(), 1)

    def test_expired_refresh_token_counts_as_no_refresh(self):
        rep = self.run_doctor(users=self.user(gh_exp=NOW - 10, gh_refresh_enc="r",
                                              gh_refresh_exp=NOW - 5))
        self.assertEqual(statuses(rep, "github.auth"), ["PASS", "FAIL", "WARN"])

    def test_token_expiring_within_a_day_warns(self):
        rep = self.run_doctor(users=self.user(gh_exp=NOW + 3600))
        self.assertEqual(statuses(rep, "github.auth"), ["PASS", "WARN"])
        self.assertIn("expires in 1 h", by_id(rep, "github.auth")[1]["text"])

    def test_pat_user_is_reported_as_pat_client(self):
        rep = self.run_doctor(users={"bob": {"pat_enc": "p"}})
        self.assertEqual(by_id(rep, "github.auth")[1]["gh_client"], "pat")

    def test_claude_expired_without_refresh_fails_with_refresh_warns(self):
        users = {"ann": {"claude_token_enc": "c", "claude_exp": NOW - 60},
                 "bob": {"claude_token_enc": "c", "claude_exp": NOW - 60, "claude_refresh_enc": "r"},
                 "cat": {"claude_token_enc": "c", "claude_exp": NOW + 86400 * 7}}
        rep = self.run_doctor(users=users)
        rows = {r.get("user"): r["status"] for r in by_id(rep, "claude.auth") if r.get("user")}
        self.assertEqual(rows, {"ann": "FAIL", "bob": "WARN", "cat": "PASS"})

    def test_default_run_never_decrypts_and_prints_no_token(self):
        """Property 2/4: without --live the report is booleans and expiries only."""
        cipher = rs_users.enc("ghp_very_secret_token", SECRET)
        users = {"ann": {"gh_token_enc": cipher, "gh_exp": 0, "claude_token_enc": cipher,
                         "claude_exp": 0}}
        rep = self.run_doctor(users=users, env=self.env(RS_SECRET=SECRET),
                              gh_probe=lambda tok: self.fail("probe ran without --live"),
                              claude_probe=lambda tok: self.fail("probe ran without --live"))
        dump = json.dumps(rep.to_json()) + D.render(rep)
        self.assertNotIn("ghp_very_secret_token", dump)
        self.assertNotIn(cipher, dump)


class LiveProbes(Fixture):
    def test_live_decrypts_with_rs_secret_and_hands_the_token_to_the_probe_only(self):
        cipher = rs_users.enc("ghp_live_token", SECRET)
        seen = []
        users = {"ann": {"gh_token_enc": cipher, "gh_exp": 0, "claude_token_enc": cipher,
                         "claude_exp": 0}}
        rep = self.run_doctor(users=users, env=self.env(RS_SECRET=SECRET), live=True,
                              gh_probe=lambda tok: (seen.append(tok) or (True, "ann")),
                              claude_probe=lambda tok: (seen.append(tok) or (False, "401")),
                              head=lambda url: (True, "HTTP 200"))
        self.assertEqual(seen, ["ghp_live_token", "ghp_live_token"])
        self.assertIn("PASS", statuses(rep, "github.auth"))
        self.assertEqual(statuses(rep, "claude.auth")[-1], "FAIL")
        self.assertNotIn("ghp_live_token", json.dumps(rep.to_json()))
        self.assertEqual(statuses(rep, "callback.device"), ["PASS"])
        self.assertEqual(statuses(rep, "callback.claude"), ["PASS"])

    def test_live_without_rs_secret_warns_instead_of_guessing(self):
        users = {"ann": {"gh_token_enc": "x", "gh_exp": 0}}
        rep = self.run_doctor(users=users, env=self.env(), live=True,
                              gh_probe=lambda tok: self.fail("no secret, no probe"),
                              head=lambda url: (False, "timed out"))
        self.assertEqual(statuses(rep, "github.auth")[-1], "WARN")
        self.assertEqual(statuses(rep, "callback.device"), ["FAIL"])

    def test_wrong_secret_is_a_failure_not_a_crash(self):
        cipher = rs_users.enc("tok", SECRET)
        users = {"ann": {"gh_token_enc": cipher, "gh_exp": 0}}
        rep = self.run_doctor(users=users, env=self.env(RS_SECRET="t" * 48), live=True,
                              gh_probe=lambda tok: (True, ""), head=lambda url: (True, "HTTP 200"))
        self.assertEqual(statuses(rep, "github.auth")[-1], "FAIL")
        self.assertIn("cannot be decrypted", by_id(rep, "github.auth")[-1]["text"])

    def test_offline_run_only_notes_that_callbacks_were_skipped(self):
        rep = self.run_doctor(head=lambda url: self.fail("network call without --live"))
        self.assertEqual(statuses(rep, "callback.device"), ["NOTE"])


class PortFromDesktopJson(Fixture):
    def test_port_comes_from_desktop_json_before_rs_port_and_public_url(self):
        self.assertEqual(D.chosen_port({"RS_PORT": "8899", "PUBLIC_URL": "http://127.0.0.1:1"},
                                       {"port": 51234}), (51234, "desktop.json"))
        self.assertEqual(D.chosen_port({"RS_PORT": "9000"}, {}), (9000, "RS_PORT"))
        self.assertEqual(D.chosen_port({"PUBLIC_URL": "http://localhost:4321/"}, {}),
                         (4321, "PUBLIC_URL"))
        self.assertEqual(D.chosen_port({"PUBLIC_URL": "https://rs.example.com"}, {}),
                         (8899, "default"))
        self.assertEqual(D.chosen_port({}, {"port": "junk"}), (8899, "default"))

    def test_health_is_asked_on_the_desktop_port(self):
        self.write("desktop.json", {"port": 51234})
        asked = []

        def health(port, **_):
            asked.append(port)
            return "ok"
        rep = self.run_doctor(env=self.env(RS_PORT="8899"), health=health)
        self.assertEqual(asked, [51234])
        self.assertEqual(statuses(rep, "port.free"), ["PASS"])
        self.assertIn("port from desktop.json", by_id(rep, "port.free")[0]["text"])

    def test_personal_app_not_running_is_a_warning_team_is_a_failure(self):
        self.write("desktop.json", {"port": 51234})
        self.assertEqual(statuses(self.run_doctor(), "port.free"), ["WARN"])
        (self.root / "desktop.json").unlink()
        self.assertEqual(statuses(self.run_doctor(env=self.env(GITHUB_PAT="x")), "port.free"),
                         ["FAIL"])

    def test_a_stranger_on_the_port_fails_everywhere(self):
        self.write("desktop.json", {"port": 51234})
        rep = self.run_doctor(health=lambda port, **_: "other")
        self.assertEqual(statuses(rep, "port.free"), ["FAIL"])

    def test_phone_on_with_loopback_public_url_warns_only_while_the_app_runs(self):
        self.write("desktop.json", {"port": 5, "phone": True})
        env = self.env(PUBLIC_URL="http://127.0.0.1:5")
        self.assertEqual(statuses(self.run_doctor(env=env), "callback.public_url"), [])
        self.assertEqual(statuses(self.run_doctor(env=env, health=healthy,
                                                  which=lambda n: "/usr/bin/" + n),
                                  "callback.public_url"), ["WARN"])


class Permissions(Fixture):
    def test_tight_root_and_files_pass(self):
        self.write("users.json", {})
        self.write("settings.json", {})
        rep = self.run_doctor()
        self.assertEqual(statuses(rep, "perms.root"), ["PASS"])
        self.assertEqual(statuses(rep, "perms.file"), ["PASS"])

    def test_loose_root_and_file_modes_warn_and_name_the_file(self):
        os.chmod(self.root, 0o755)
        self.write("users.json", {}, mode=0o644)
        self.write("settings.json", {}, mode=0o600)
        rep = self.run_doctor()
        self.assertEqual(statuses(rep, "perms.root"), ["WARN"])
        self.assertEqual(statuses(rep, "perms.file"), ["WARN"])
        self.assertIn("users.json (644)", by_id(rep, "perms.file")[0]["text"])
        self.assertNotIn("settings.json", by_id(rep, "perms.file")[0]["text"])


class Environment(Fixture):
    def test_node_floor_electron_and_os(self):
        rep = self.run_doctor(node="18.20.0", platform="linux",
                              env=self.env(RS_DOCTOR_DESKTOP="1", RS_DOCTOR_ELECTRON="/x/electron"),
                              exists=lambda p: False, stat_fn=lambda p: (_ for _ in ()).throw(OSError()))
        self.assertEqual(statuses(rep, "env.node"), ["FAIL"])
        self.assertEqual(statuses(rep, "env.electron"), ["FAIL"])
        self.assertEqual(statuses(rep, "env.os"), ["PASS"])
        self.assertEqual(statuses(rep, "env.chromium_sandbox"), ["WARN"])

    def test_good_desktop_runtime_passes(self):
        st = os.stat_result((stat.S_IFREG | stat.S_ISUID | 0o755, 0, 0, 1, 0, 0, 0, 0, 0, 0))
        rep = self.run_doctor(node="22.0.0", platform="linux",
                              env=self.env(RS_DOCTOR_ELECTRON="/x/electron"),
                              exists=lambda p: True, stat_fn=lambda p: st)
        self.assertEqual(statuses(rep, "env.node"), ["PASS"])
        self.assertEqual(statuses(rep, "env.electron"), ["PASS"])
        self.assertEqual(statuses(rep, "env.chromium_sandbox"), ["PASS"])

    def test_windows_is_a_warning_and_a_missing_node_is_only_a_note_for_team(self):
        rep = self.run_doctor(node=None, platform="win32")
        self.assertEqual(statuses(rep, "env.os"), ["WARN"])
        self.assertEqual(statuses(rep, "env.node"), ["NOTE"])
        rep = self.run_doctor(node=None, env=self.env(RS_DOCTOR_DESKTOP="1"))
        self.assertEqual(statuses(rep, "env.node"), ["FAIL"])

    def test_phone_tunnel_binary_only_when_phone_is_on(self):
        self.write("desktop.json", {"phone": True})
        rep = self.run_doctor(which=lambda n: None, exists=lambda p: p.endswith("/bin/cloudflared"))
        self.assertEqual(statuses(rep, "tools.cloudflared"), ["PASS"])
        rep = self.run_doctor(which=lambda n: None, exists=lambda p: False)
        self.assertEqual(statuses(rep, "tools.cloudflared"), ["FAIL"])
        self.write("desktop.json", {"phone": True, "phoneVia": "tailscale"})
        rep = self.run_doctor(which=lambda n: "/usr/bin/tailscale" if n == "tailscale" else None)
        self.assertEqual(statuses(rep, "tools.tailscale"), ["PASS"])
        self.write("desktop.json", {"phone": False})
        rep = self.run_doctor(which=lambda n: None, exists=lambda p: False)
        self.assertEqual(statuses(rep, "tools.cloudflared"), ["NOTE"])

    def test_node_version_reads_the_launcher_report_first(self):
        self.assertEqual(D.node_version({"RS_DOCTOR_NODE": "v22.3.0"}), "22.3.0")
        self.assertIsNone(D.node_version({}, which=lambda n: None))
        self.assertEqual(D._major("25.9.0"), 25)
        self.assertEqual(D._major(""), 0)

    def test_claude_authorize_host_matches_the_server_constant(self):
        src = (HERE / "server.py").read_text()
        self.assertIn(f'CLAUDE_OAUTH_AUTHORIZE = "{D.CLAUDE_AUTHORIZE_URL}"', src)


class ExitCodesAndJson(Fixture):
    def test_exit_code_policy(self):
        rep = D.Report()
        rep.ok("a", "x")
        self.assertEqual((rep.exit_code(), rep.exit_code(strict=True)), (0, 0))
        rep.warn("b", "y")
        self.assertEqual((rep.exit_code(), rep.exit_code(strict=True)), (0, 2))
        rep.fail("c", "z")
        self.assertEqual((rep.exit_code(), rep.exit_code(strict=True)), (1, 1))
        rep.note("d", "n")
        self.assertEqual(rep.to_json()["fails"], 1)
        self.assertEqual(rep.to_json()["warns"], 1)

    def test_cli_json_shape_and_exit_codes(self):
        self.write("desktop.json", {"port": 1})
        self.write("users.json", {"ann": {"gh_token_enc": "x", "gh_exp": NOW - 10}})
        env = {**os.environ, "ROOT": str(self.root), "HOME": str(self.root)}
        r = subprocess.run([sys.executable, str(HERE / "rs_doctor.py"), "--json"],
                           capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(r.returncode, 1, r.stderr)
        doc = json.loads(r.stdout)
        self.assertEqual(set(doc), {"checks", "fails", "warns"})
        self.assertTrue(all({"id", "status", "text"} <= set(c) for c in doc["checks"]))
        self.assertEqual(doc["fails"], 1)
        self.write("users.json", {})
        r = subprocess.run([sys.executable, str(HERE / "rs_doctor.py"), "--strict"],
                           capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(r.returncode, 2, r.stdout)
        self.assertIn("WARN", r.stdout)
        self.assertNotIn("\033[", r.stdout, "no colour when stdout is not a terminal")


@unittest.skipUnless(shutil.which("jq") and shutil.which("bash"), "needs jq and bash")
class DoctorShell(Fixture):
    """bin/doctor.sh --json against a personal fixture ROOT, with shims so nothing reaches out."""

    def setUp(self):
        super().setUp()
        self.shim = self.root / "shim"
        self.shim.mkdir()
        for name, body in (("gh", "#!/bin/sh\necho 'gh version 2.0.0 (shim)'\n"),
                           ("claude", "#!/bin/sh\necho '2.0.0 (Claude Code)'\n"),
                           ("git", "#!/bin/sh\necho 'git version 2.0.0'\n"),
                           ("flock", "#!/bin/sh\nexit 0\n"),
                           ("curl", "#!/bin/sh\nexit 7\n")):
            p = self.shim / name
            p.write_text(body)
            p.chmod(0o755)
        self.write(".env", f"RS_SECRET={SECRET}\nRS_PERSONAL=1\nPUBLIC_URL=http://127.0.0.1:51777\n"
                           "DRY_RUN=0\n")

    def sh(self, *flags, env=None):
        real = os.environ.get("PATH", "")
        e = {"PATH": f"{self.shim}:{real}", "HOME": str(self.root), "ROOT": str(self.root),
             "MIN_FREE_DISK_MB": "0", **(env or {})}
        return subprocess.run(["bash", str(HERE / "doctor.sh"), *flags], capture_output=True,
                              text=True, env=e, timeout=120, cwd=str(self.root))

    def test_personal_fixture_no_github_pat_failure_and_port_from_desktop_json(self):
        self.write("desktop.json", {"phone": False, "port": 51777})
        self.write("users.json", {"ann": {"gh_token_enc": "x", "gh_exp": 0, "gh_client": "device",
                                          "claude_token_enc": "y", "claude_exp": 0}})
        r = self.sh("--json")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        doc = json.loads(r.stdout)
        texts = [c["text"] for c in doc["checks"]]
        self.assertFalse(any("GITHUB_PAT not set" in t for t in texts), texts)
        self.assertEqual(doc["fails"], 0, texts)
        port = [c for c in doc["checks"] if c["id"] == "port.free"]
        self.assertEqual(len(port), 1)
        self.assertEqual(port[0]["status"], "WARN", "app not running is a WARN in personal mode")
        self.assertIn("51777", port[0]["text"])
        self.assertIn("port from desktop.json", port[0]["text"])
        ids = {c["id"] for c in doc["checks"]}
        self.assertTrue({"config.env", "config.secret", "claude.cli", "github.auth", "claude.auth",
                         "perms.root", "env.os"} <= ids, ids)

    def test_expired_token_fails_the_shell_doctor_too(self):
        self.write("desktop.json", {"port": 51777})
        self.write("users.json", {"ann": {"gh_token_enc": "x", "gh_exp": 1}})
        r = self.sh("--json")
        self.assertEqual(r.returncode, 1, r.stdout)
        doc = json.loads(r.stdout)
        failing = [c for c in doc["checks"] if c["status"] == "FAIL"]
        self.assertEqual([c["id"] for c in failing], ["github.auth"])
        self.assertIn("sign in again", failing[0]["text"])

    def test_text_mode_header_and_strict_exit(self):
        self.write("desktop.json", {"port": 51777})
        self.write("users.json", {})
        r = self.sh()
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertTrue(r.stdout.startswith("ReviewStage doctor — desktop install at"), r.stdout[:80])
        self.assertIn("exit 0", r.stdout.strip().splitlines()[-1])
        r = self.sh("--strict")
        self.assertEqual(r.returncode, 2, r.stdout)
        self.assertIn("exit 2 (--strict)", r.stdout.strip().splitlines()[-1])

    def test_team_mode_still_fails_without_a_service_token(self):
        """The team install keeps its guard: no desktop.json, no RS_PERSONAL, no GITHUB_PAT."""
        self.write(".env", f"RS_SECRET={SECRET}\nREPOS=acme/widgets\n")
        r = self.sh("--json")
        self.assertEqual(r.returncode, 1)
        doc = json.loads(r.stdout)
        self.assertTrue(any("GITHUB_PAT not set" in c["text"] for c in doc["checks"]))
        self.assertIn("team mode", " ".join(c["text"] for c in doc["checks"]))


if __name__ == "__main__":
    unittest.main()
