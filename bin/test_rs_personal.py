#!/usr/bin/env python3
"""Personal mode (RS_PERSONAL=1) — openspec/changes/npx-desktop, lane D1.

The desktop app starts the server with a .env that names no repository and holds no service
token. Everything that assumed one has to bend: the boot guard, the repo list (now .env ∪
settings.json, re-read on every call), the poller (now a thread in this process, using each
signed-in user's own token), and PUBLIC_URL (now settable at runtime by the tunnel). Team mode
must not move an inch: no repository is still FATAL and settings writes are still admin-only.

Run: python3 -m unittest bin.test_rs_personal
"""
import contextlib
import importlib
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import rs_queue as Q  # noqa: E402  (reloaded per test by load_server)

SECRET = "b" * 64
USER = "ann"
TOKEN = "ghp_personal_test_token_000000000000"
PAGE1 = [{"full_name": "ann/widgets", "private": False, "pushed_at": "2026-10-01T10:00:00Z",
          "owner": {"avatar_url": "https://avatars.example/ann"}},
         {"full_name": "acme/api", "private": True, "pushed_at": "2026-09-30T10:00:00Z",
          "owner": {"avatar_url": "https://avatars.example/acme"}}]
PAGE2 = [{"full_name": "acme/billing", "private": True, "pushed_at": "2026-09-01T10:00:00Z",
          "owner": {"avatar_url": "https://avatars.example/acme"}}]
PR = {"number": 7, "title": "Add a lead-time badge", "author": {"login": "carol", "is_bot": False},
      "headRefOid": "abc123", "url": "https://github.com/acme/api/pull/7", "additions": 3,
      "deletions": 1, "changedFiles": 2, "isDraft": False,
      "createdAt": "2026-10-01T10:00:00Z", "updatedAt": "2026-10-02T10:00:00Z"}

# The fake gh lives OUTSIDE ROOT (the no-token-on-disk assertion walks ROOT) and records the
# token it was handed there, which is how the tests prove the USER's token was used.
FAKE_GH = textwrap.dedent(f"""\
    #!/bin/sh
    printf '%s\\n' "${{GH_TOKEN:-}}" >> "$(dirname "$0")/tokens-seen"
    echo "$*" >> "$(dirname "$0")/calls"
    case "$*" in
      *"user/repos"*)
        cat <<'RS1'
    {json.dumps(PAGE1)}
    RS1
        cat <<'RS2'
    {json.dumps(PAGE2)}
    RS2
        exit 0;;
      *"pr list"*"acme/api"*)
        cat <<'RS3'
    [{json.dumps(PR)}]
    RS3
        exit 0;;
      *"pr list"*)
        echo "[]"; exit 0;;
    esac
    echo "fake gh: unexpected $*" >&2
    exit 1
    """)


def load_server(root, env_text):
    os.environ["ROOT"] = root
    os.environ["RS_COOKIE_SECURE"] = "0"
    os.environ.pop("RS_PERSONAL", None)
    os.makedirs(os.path.join(root, "state"), exist_ok=True)
    with open(os.path.join(root, ".env"), "w") as f:
        f.write(env_text)
    # Every module that resolves ROOT at import time is reloaded so the whole stack points at
    # THIS test's directory, not the previous test module's.
    for name in ("rs_paths", "rs_queue", "rs_webhook", "rs_settings", "rs_learn", "rs_personal"):
        if name in sys.modules:
            importlib.reload(sys.modules[name])
        else:
            importlib.import_module(name)
    if "server" in sys.modules:
        return importlib.reload(sys.modules["server"])
    return importlib.import_module("server")


class Base(unittest.TestCase):
    personal = True
    env_repos = ""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="rs-personal-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.fake = Path(tempfile.mkdtemp(prefix="rs-fakebin-"))
        self.addCleanup(shutil.rmtree, str(self.fake), ignore_errors=True)
        (self.fake / "gh").write_text(FAKE_GH)
        (self.fake / "gh").chmod(stat.S_IRWXU)
        self._path = os.environ.get("PATH", "")
        os.environ["PATH"] = f"{self.fake}:{self._path}"
        self.addCleanup(os.environ.__setitem__, "PATH", self._path)
        env = f"RS_SECRET={SECRET}\nPUBLIC_URL=http://127.0.0.1:8899\nNOTIFY_BACKENDS=none\n"
        if self.personal:
            env += "RS_PERSONAL=1\n"
        if self.env_repos:
            env += f"REPOS={self.env_repos}\n"
        self.S = load_server(self.root, env)
        S = self.S
        S.save_users({USER: {"name": "Ann", "pat_enc": S.enc(TOKEN), "added": 1,
                             "updated": 1}})

    # -- the Handler shim (test_rs_teach.TheRouteItself) -----------------------------------------
    def handler(self, peer="127.0.0.1"):
        S, out = self.S, {}
        h = object.__new__(S.Handler)
        h.headers = {}
        h.reply = lambda status, payload, *a, **k: out.update(status=status,
                                                              body=json.loads(payload))
        h.client_address = (peer, 1)
        return h, out

    def get(self, route, q=None, user=USER, peer="127.0.0.1"):
        h, out = self.handler(peer)
        with mock.patch.object(self.S, "session_user", return_value=user), \
                mock.patch.object(self.S, "bearer_user", return_value=None):
            h.api_get(route, q or {})
        return out

    def post(self, route, body, user=USER, peer="127.0.0.1"):
        h, out = self.handler(peer)
        with mock.patch.object(self.S, "session_user", return_value=user), \
                mock.patch.object(self.S, "bearer_user", return_value=None):
            h.api_post(route, body)
        return out

    def tokens_seen(self):
        f = self.fake / "tokens-seen"
        return f.read_text().split() if f.exists() else []

    def established(self):
        """An install that has polled before: the login is known, so pr-watch.sh's clean-slate
        seeding (first sight of a login = whole backlog seen, no card) does not apply."""
        (Path(self.root) / "known_logins").write_text(f"{USER}\n")


class BootsWithoutRepos(Base):
    def test_personal_mode_warns_instead_of_dying(self):
        fatal, warns = self.S.startup_problems()
        self.assertIsNone(fatal)
        self.assertTrue(any("no repository configured" in w for w in warns))
        self.assertTrue(self.S.PERSONAL)

    def test_a_bad_secret_is_still_fatal_in_personal_mode(self):
        with mock.patch.object(self.S, "SECRET", "short"):
            fatal, _ = self.S.startup_problems()
        self.assertIn("RS_SECRET", fatal or "")

    def test_a_malformed_settings_repo_is_fatal(self):
        self.S.rs_settings.save(self.S.SETTINGS, {"repos": ["not a repo"]})
        fatal, _ = self.S.startup_problems()
        self.assertIn("not owner/name shaped", fatal or "")


class TeamModeIsUntouched(Base):
    personal = False

    def test_no_repository_is_fatal(self):
        fatal, warns = self.S.startup_problems()
        self.assertIn("no repository configured", fatal or "")
        self.assertEqual(warns, [])
        self.assertFalse(self.S.PERSONAL)

    def test_api_repos_is_admin_only(self):
        self.S.save_users({"root": {"admin": True, "added": 0}, USER: {"added": 1}})
        out = self.post("/api/repos", {"repos": ["acme/api"]})
        self.assertEqual(out["status"], 403)
        self.assertNotIn("repos", self.S.rs_settings.read_file(self.S.SETTINGS))
        out = self.post("/api/repos", {"repos": ["acme/api"]}, user="root")
        self.assertEqual(out["status"], 200)
        self.assertEqual(out["body"]["repos"], ["acme/api"])

    def test_me_says_not_personal(self):
        self.assertFalse(self.get("/api/me")["body"]["personal"])


class TheRepoUnion(Base):
    env_repos = "acme/widgets"

    def test_env_and_settings_are_unioned_and_re_read(self):
        S = self.S
        self.assertEqual(S.configured_repos(), ["acme/widgets"])
        S.rs_settings.save(S.SETTINGS, {"repos": ["ann/tools", "ACME/widgets"]})
        # No restart, no cached constant: the next read sees the saved list, deduped
        # case-insensitively against .env's spelling.
        self.assertEqual(S.configured_repos(), ["acme/widgets", "ann/tools"])
        self.assertEqual(S.all_repos(), ["acme/widgets", "ann/tools"])
        self.assertTrue(S.repo_ok("ann/tools"))
        self.assertTrue(S.repo_ok("Ann/Tools"))
        self.assertFalse(S.repo_ok("someone/else"))
        self.assertEqual(S.single_repo(), "")
        self.assertEqual(S.resolve_repo("ann/tools"), ("ann/tools", None))

    def test_the_settings_view_reports_the_union_with_its_source(self):
        S = self.S
        vals, src = S.runtime_settings()
        self.assertEqual((vals["repos"], src["repos"]), (["acme/widgets"], "env"))
        S.rs_settings.save(S.SETTINGS, {"repos": ["ann/tools"]})
        vals, src = S.runtime_settings()
        self.assertEqual((vals["repos"], src["repos"]), (["acme/widgets", "ann/tools"],
                                                         "settings"))


class GithubReposRoute(Base):
    def test_shape_filter_already_and_the_users_own_token(self):
        self.S.rs_settings.save(self.S.SETTINGS, {"repos": ["acme/api"]})
        out = self.get("/api/github/repos")
        self.assertEqual(out["status"], 200)
        rows = out["body"]["repos"]
        self.assertEqual([r["full_name"] for r in rows], ["ann/widgets", "acme/api",
                                                           "acme/billing"])
        self.assertEqual(sorted(rows[0]), ["already", "full_name", "owner_avatar", "private",
                                           "pushed_at"])
        self.assertEqual([r["already"] for r in rows], [False, True, False])
        self.assertEqual(rows[1]["owner_avatar"], "https://avatars.example/acme")
        self.assertTrue(rows[1]["private"])
        # The token gh saw is the USER's, and it reached gh through the environment only.
        self.assertEqual(self.tokens_seen(), [TOKEN])
        calls = (self.fake / "calls").read_text()
        self.assertIn("--paginate", calls)
        self.assertIn("affiliation=owner,collaborator,organization_member", calls)
        # Server-side filter on full_name.
        out = self.get("/api/github/repos", {"q": ["bill"]})
        self.assertEqual([r["full_name"] for r in out["body"]["repos"]], ["acme/billing"])

    def test_the_list_is_cached_for_five_minutes_per_user(self):
        self.get("/api/github/repos")
        self.get("/api/github/repos", {"q": ["acme"]})
        self.assertEqual(len(self.tokens_seen()), 1, "the second call was answered from cache")
        self.S._GITHUB_REPOS_CACHE[USER] = (0, self.S._GITHUB_REPOS_CACHE[USER][1])  # expire
        self.get("/api/github/repos")
        self.assertEqual(len(self.tokens_seen()), 2)

    def test_no_token_is_a_plain_400(self):
        self.S.save_users({USER: {"name": "Ann", "added": 1}})
        out = self.get("/api/github/repos")
        self.assertEqual(out["status"], 400)
        self.assertIn("Sign in with GitHub first", out["body"]["error"])

    def test_a_failing_gh_is_a_plain_400(self):
        (self.fake / "gh").write_text("#!/bin/sh\necho 'HTTP 401: Bad credentials' >&2\nexit 1\n")
        out = self.get("/api/github/repos")
        self.assertEqual(out["status"], 400)
        self.assertIn("Bad credentials", out["body"]["error"])

    def test_it_needs_a_session(self):
        out = self.get("/api/github/repos", user=None)
        self.assertEqual(out["status"], 401)


class ReposRoute(Base):
    env_repos = "acme/widgets"

    def test_saves_the_list_and_answers_the_union(self):
        out = self.post("/api/repos", {"repos": ["ann/tools", "acme/api", "ANN/tools"]})
        self.assertEqual(out["status"], 200)
        self.assertEqual(out["body"]["repos"], ["acme/widgets", "ann/tools", "acme/api"])
        self.assertEqual(self.S.rs_settings.read_file(self.S.SETTINGS)["repos"],
                         ["ann/tools", "acme/api"])

    def test_a_bad_name_is_refused(self):
        out = self.post("/api/repos", {"repos": ["ann/tools", "nonsense"]})
        self.assertEqual(out["status"], 400)
        self.assertIn("nonsense", out["body"]["error"])
        self.assertNotIn("repos", self.S.rs_settings.read_file(self.S.SETTINGS))

    def test_more_than_fifty_is_refused(self):
        out = self.post("/api/repos", {"repos": [f"ann/r{i}" for i in range(51)]})
        self.assertEqual(out["status"], 400)
        self.assertIn("at most 50", out["body"]["error"])

    def test_not_a_list_is_refused(self):
        self.assertEqual(self.post("/api/repos", {"repos": "ann/tools"})["status"], 400)
        self.assertEqual(self.post("/api/repos", {})["status"], 400)

    def test_an_empty_list_clears_the_wizards_repos_but_keeps_env(self):
        self.post("/api/repos", {"repos": ["ann/tools"]})
        out = self.post("/api/repos", {"repos": []})
        self.assertEqual(out["body"]["repos"], ["acme/widgets"])


class MeRoute(Base):
    def test_fields_the_wizard_decides_on(self):
        self.S.rs_settings.save(self.S.SETTINGS, {"repos": ["acme/api"]})
        body = self.get("/api/me")["body"]
        self.assertTrue(body["authed"])
        self.assertTrue(body["personal"])
        self.assertEqual(body["repos"], ["acme/api"])
        self.assertFalse(body["claude_connected"])
        self.assertEqual(body["login"], USER)

    def test_signed_out_still_says_personal_and_lists_repos(self):
        body = self.get("/api/me", user=None)["body"]
        self.assertFalse(body["authed"])
        self.assertTrue(body["personal"])
        self.assertEqual(body["repos"], [])


class PublicUrlRoute(Base):
    def test_loopback_caller_sets_it_until_restart(self):
        S = self.S
        self.assertEqual(self.get("/api/public-url")["body"],
                         {"url": "http://127.0.0.1:8899", "runtime": False})
        out = self.post("/api/public-url", {"url": "https://quiet-fox.trycloudflare.com/"})
        self.assertEqual(out["status"], 200)
        self.assertEqual(out["body"], {"url": "https://quiet-fox.trycloudflare.com",
                                       "runtime": True})
        self.assertEqual(S.PUBLIC_URL, "https://quiet-fox.trycloudflare.com")
        # Link signing and cards read the module global, so they follow it.
        self.assertTrue(Q.dashboard_link(S.PUBLIC_URL, S.SECRET)
                        .startswith("https://quiet-fox.trycloudflare.com/"))
        self.assertEqual(self.get("/api/public-url")["body"]["runtime"], True)

    def test_a_remote_caller_is_refused(self):
        out = self.post("/api/public-url", {"url": "https://evil.example"}, peer="10.0.0.9")
        self.assertEqual(out["status"], 403)
        self.assertEqual(self.S.PUBLIC_URL, "http://127.0.0.1:8899")

    def test_the_url_is_validated(self):
        for bad in ("", "ftp://x", "https://", "javascript:alert(1)", "https://a.b/path"):
            self.assertEqual(self.post("/api/public-url", {"url": bad})["status"], 400, bad)
        self.assertEqual(self.S.PUBLIC_URL, "http://127.0.0.1:8899")

    def test_it_needs_a_session(self):
        out = self.post("/api/public-url", {"url": "https://a.b"}, user=None)
        self.assertEqual(out["status"], 401)


class ThePoller(Base):
    def test_one_cycle_queues_notifies_and_writes_no_token(self):
        S = self.S
        self.established()
        S.rs_settings.save(S.SETTINGS, {"repos": ["acme/api", "acme/widgets"]})
        fired = []
        ctx = S.personal_poller_context()
        ctx.notify = lambda row, login: fired.append((row["repo"], row["number"], login)) or True
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            summary = S.rs_personal.cycle(ctx)
        # The row went through rs_queue.merge_poll — same shape and origin as pr-watch.sh.
        row = Q.find("acme/api", 7)
        self.assertIsNotNone(row)
        self.assertEqual(row["requested"], [USER])
        self.assertEqual(row["origins"], {USER: "poll"})
        self.assertEqual(row["author"], "carol")
        self.assertEqual(summary["added"], 1)
        self.assertEqual(summary["searches"], 2)
        # The notifier fired once for the new request, and `seen` was written AFTER it.
        self.assertEqual(fired, [("acme/api", 7, USER)])
        self.assertTrue(Q.is_seen("acme/api", "7", USER))
        self.assertTrue((Path(self.root) / "poller.last").exists())
        self.assertTrue((Path(self.root) / "state" / "acme__api" / "7" / "users" / USER
                         / "requested_at").exists())
        # gh ran with the USER's token, once per (repo, login) search…
        self.assertEqual(self.tokens_seen(), [TOKEN, TOKEN])
        # …and that token is nowhere on disk under ROOT, nor in anything the server printed.
        for f in Path(self.root).rglob("*"):
            if f.is_file():
                self.assertNotIn(TOKEN, f.read_text(errors="replace"), str(f))
        self.assertNotIn(TOKEN, buf.getvalue())
        self.assertIn("notifying acme/api#7", buf.getvalue())

    def test_the_very_first_cycle_seeds_the_backlog_without_a_card(self):
        """pr-watch.sh's rule, kept: a fresh install's first poll finds the whole backlog of
        open requests; they land in the queue, are marked seen, and nobody is pinged for them.
        Only requests that arrive from now on produce a card."""
        S = self.S
        S.rs_settings.save(S.SETTINGS, {"repos": ["acme/api"]})
        fired = []
        ctx = S.personal_poller_context()
        ctx.notify = lambda row, login: fired.append(login) or True
        with contextlib.redirect_stdout(io.StringIO()):
            S.rs_personal.cycle(ctx)
        self.assertIsNotNone(Q.find("acme/api", 7))
        self.assertEqual(fired, [])
        self.assertTrue(Q.is_seen("acme/api", "7", USER))
        self.assertEqual((Path(self.root) / "known_logins").read_text().split(), [USER])

    def test_a_second_cycle_does_not_ping_again(self):
        S = self.S
        self.established()
        S.rs_settings.save(S.SETTINGS, {"repos": ["acme/api"]})
        fired = []
        ctx = S.personal_poller_context()
        ctx.notify = lambda row, login: fired.append(login) or True
        with contextlib.redirect_stdout(io.StringIO()):
            S.rs_personal.cycle(ctx)
            S.rs_personal.cycle(ctx)
        self.assertEqual(fired, [USER])

    def test_a_failed_send_is_retried_and_not_marked_seen(self):
        S = self.S
        self.established()
        S.rs_settings.save(S.SETTINGS, {"repos": ["acme/api"]})
        ctx = S.personal_poller_context()
        ctx.notify = lambda row, login: False
        with contextlib.redirect_stdout(io.StringIO()):
            S.rs_personal.cycle(ctx)
        self.assertFalse(Q.is_seen("acme/api", "7", USER))
        self.assertEqual(Q.notify_attempts("acme/api", "7", USER), 1)

    def test_suppressed_prs_are_recorded_not_seen(self):
        S = self.S
        self.established()
        S.rs_settings.save(S.SETTINGS, {"repos": ["acme/api"], "max_pr_age_days": 1})
        fired = []
        ctx = S.personal_poller_context()
        ctx.notify = lambda row, login: fired.append(login) or True
        ctx.now = lambda: 1_800_000_000          # far after the PR's createdAt
        with contextlib.redirect_stdout(io.StringIO()):
            S.rs_personal.cycle(ctx)
        self.assertEqual(fired, [])
        self.assertIn("created", Q.is_suppressed("acme/api", "7", USER))
        self.assertFalse(Q.is_seen("acme/api", "7", USER))

    def test_zero_repos_does_nothing_and_touches_no_token(self):
        S = self.S
        with contextlib.redirect_stdout(io.StringIO()):
            summary = S.rs_personal.cycle(S.personal_poller_context())
        self.assertEqual(summary, {"repos": 0})
        self.assertEqual(self.tokens_seen(), [])

    def test_poller_enabled_false_is_honoured(self):
        S = self.S
        S.rs_settings.save(S.SETTINGS, {"repos": ["acme/api"], "poller_enabled": False})
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertIsNone(S.rs_personal.cycle(S.personal_poller_context()))
        self.assertEqual(self.tokens_seen(), [])

    def test_all_searches_failing_leaves_the_queue_alone(self):
        S = self.S
        Q.upsert("acme/api", 9, {"title": "old", "url": "u"}, [USER])
        S.rs_settings.save(S.SETTINGS, {"repos": ["acme/api"]})
        (self.fake / "gh").write_text("#!/bin/sh\necho 'rate limited' >&2\nexit 1\n")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            S.rs_personal.cycle(S.personal_poller_context())
        self.assertIsNotNone(Q.find("acme/api", 9))
        self.assertIn("all 1 gh search(es) failed", buf.getvalue())

    def test_the_review_env_hands_the_job_scripts_the_users_token_in_memory_only(self):
        S = self.S
        S.rs_settings.save(S.SETTINGS, {"repos": ["acme/api"]})
        env = S.review_env(USER)
        self.assertEqual(env["GITHUB_PAT"], TOKEN)
        self.assertEqual(env["REVIEWER"], USER)
        self.assertEqual(env["REPOS"], "acme/api")
        self.assertNotIn("GITHUB_PAT", (Path(self.root) / ".env").read_text())


if __name__ == "__main__":
    unittest.main()
