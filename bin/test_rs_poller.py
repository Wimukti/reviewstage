"""Tests for the poller's queue write path — the four bugs that made discovery lossy.

    python3 -m unittest bin/test_rs_poller.py

1. The poller rebuilt queue.json wholesale from `review-requested:<login>`, which never
   returns a TEAM request, so every row the webhook created for one was erased within minutes.
2. Every `gh` failure was swallowed and the partial (often empty) result was published, so an
   expired token showed everyone an empty queue.
3. The poller wrote queue.json outside the fcntl lock every other writer takes, losing any
   webhook delivery that landed mid-poll.
10. The webhook marked `seen` BEFORE notifying and the poller AFTER, so whether a failed send
   was retried depended on which path won the race.

The shell cases run bin/pr-watch.sh for real against a scratch ROOT with a fake `gh` on PATH.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_TMP = tempfile.mkdtemp(prefix="rs-poller-test-")
os.environ["ROOT"] = _TMP
sys.path.insert(0, str(HERE))

import importlib  # noqa: E402

import rs_paths as P  # noqa: E402
import rs_queue as Q  # noqa: E402
import rs_webhook as W  # noqa: E402

for _m in (P, Q, W):
    importlib.reload(_m)
assert Q.QUEUE.parent == Path(_TMP), "test ROOT did not take"

REPO = "acme/widgets"


def row(num=42, logins=("alice",), title="Add lead-time badge"):
    return Q.normalize({"repo": REPO, "number": num, "title": title,
                        "url": f"https://github.com/{REPO}/pull/{num}",
                        "additions": 1, "deletions": 0, "changedFiles": 1,
                        "requested": list(logins), "author": "carol", "isBot": False,
                        "isDraft": False, "head": "abc", "createdAt": "2026-09-01T10:00:00Z",
                        "updatedAt": "2026-09-02T10:00:00Z"})


class Base(unittest.TestCase):
    def setUp(self):
        Path(_TMP).mkdir(exist_ok=True)
        for f in (Q.QUEUE, Q.SEEN, Q.SUPPRESSED, Q.DELIVERIES, Q.NOTIFY_FAILS):
            f.unlink(missing_ok=True)
        shutil.rmtree(P.STATE, ignore_errors=True)

    def seen(self):
        return Q.SEEN.read_text() if Q.SEEN.exists() else ""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_TMP, ignore_errors=True)


class MergingWriter(Base):
    """Blocker 1 — a team review request only the webhook can see must survive a poll."""

    def test_team_row_survives_a_poll_that_cannot_see_it(self):
        # The webhook expanded a requested_team and queued bob.
        Q.upsert(REPO, 7, row(7, []), ["bob"], origin=Q.ORIGIN_WEBHOOK)
        self.assertEqual(Q.find(REPO, 7)["requested"], ["bob"])
        # A poll runs. `review-requested:bob` returns nothing — GitHub never reports team
        # requests through it — and the old wholesale rewrite deleted the row outright.
        Q.merge_poll([], [(REPO, "bob")])
        self.assertIsNotNone(Q.find(REPO, 7), "the webhook's team row was destroyed by the poll")
        self.assertEqual(Q.find(REPO, 7)["requested"], ["bob"])
        self.assertEqual(Q.find(REPO, 7)["origins"], {"bob": Q.ORIGIN_WEBHOOK})

    def test_a_withdrawn_direct_request_is_still_dropped(self):
        Q.merge_poll([row(8, ["alice"])], [(REPO, "alice")])
        self.assertEqual(Q.find(REPO, 8)["requested"], ["alice"])
        Q.merge_poll([], [(REPO, "alice")])
        self.assertIsNone(Q.find(REPO, 8))

    def test_poll_and_webhook_logins_coexist_on_one_row(self):
        Q.upsert(REPO, 9, row(9, []), ["bob"], origin=Q.ORIGIN_WEBHOOK)
        Q.merge_poll([row(9, ["alice"])], [(REPO, "alice"), (REPO, "bob")])
        self.assertEqual(Q.find(REPO, 9)["requested"], ["alice", "bob"])

    def test_meta_is_cached_the_first_time_a_pr_is_seen(self):
        Q.merge_poll([row(11, ["alice"])], [(REPO, "alice")])
        meta = json.loads((P.prdir(REPO, 11) / "meta.json").read_text())
        self.assertEqual(meta["title"], "Add lead-time badge")


class FailuresNeverPublish(Base):
    """Blocker 2 — a partial result must never become the whole queue."""

    def test_unsearched_repo_is_left_alone(self):
        Q.merge_poll([row(1, ["alice"])], [(REPO, "alice")])
        Q.merge_poll([], [("other/repo", "alice")])          # only the other repo was searched
        self.assertIsNotNone(Q.find(REPO, 1))

    def test_failed_login_search_keeps_that_logins_rows(self):
        Q.merge_poll([row(2, ["alice", "bob"])], [(REPO, "alice"), (REPO, "bob")])
        Q.merge_poll([row(2, ["alice"])], [(REPO, "alice")])  # bob's search failed this cycle
        self.assertEqual(Q.find(REPO, 2)["requested"], ["alice", "bob"])

    def test_total_failure_is_a_no_op(self):
        Q.merge_poll([row(3, ["alice"])], [(REPO, "alice")])
        before = Q.load()
        Q.merge_poll([], [])                                  # nothing succeeded at all
        self.assertEqual(Q.load(), before)


class Locking(Base):
    """Blocker 3 — the poller's write takes the same lock every other writer takes."""

    def test_merge_poll_waits_for_the_queue_lock(self):
        held = threading.Event()
        done = threading.Event()

        def holder():
            with Q._locked():
                held.set()
                time.sleep(0.6)
        t = threading.Thread(target=holder, daemon=True)
        t.start()
        held.wait(2)

        def writer():
            Q.merge_poll([row(5, ["alice"])], [(REPO, "alice")])
            done.set()
        w = threading.Thread(target=writer, daemon=True)
        w.start()
        self.assertFalse(done.wait(0.3), "merge_poll wrote queue.json while the lock was held")
        t.join()
        w.join(5)
        self.assertTrue(done.is_set())
        self.assertIsNotNone(Q.find(REPO, 5))


class SeenAfterSend(Base):
    """Should-fix 10 — both paths write `seen` only after a confirmed send."""

    def ctx(self, ok=True, sent=None):
        return W.Context(_TMP, HERE, lambda r: True, {"alice": {}}, "https://x", "s",
                         settings={"max_pr_age_days": 45, "skip_bot_prs": False},
                         single_repo=REPO, reviewer="alice",
                         notify=lambda r, l: (sent.append(l) if sent is not None else None) or ok,
                         log=lambda *a, **k: None)

    def payload(self, num=42, draft=False):
        return {"action": "review_requested",
                "repository": {"full_name": REPO, "owner": {"login": "acme"}},
                "requested_reviewer": {"login": "alice"},
                "pull_request": {"number": num, "title": "t", "draft": draft,
                                 "user": {"login": "carol", "type": "User"},
                                 "head": {"sha": "abc"}, "created_at": "2026-09-01T10:00:00Z",
                                 "updated_at": "2026-09-02T10:00:00Z"}}

    def test_a_failed_send_is_not_marked_seen(self):
        W.handle("pull_request", self.payload(), self.ctx(ok=False))
        self.assertEqual(self.seen().strip(), "",
                         "a card that never went out was recorded as delivered")
        self.assertEqual(Q.notify_attempts(REPO, 42, "alice"), 1)
        # Next cycle the backend is healthy again: the reviewer is finally told.
        sent = []
        W.handle("pull_request", self.payload(), self.ctx(ok=True, sent=sent))
        self.assertEqual(sent, ["alice"])
        self.assertIn(f"{REPO}:42:alice", self.seen())
        self.assertEqual(Q.notify_attempts(REPO, 42, "alice"), 0)

    def test_a_send_that_keeps_failing_is_given_up_on(self):
        for _ in range(Q.MAX_NOTIFY_ATTEMPTS):
            W.handle("pull_request", self.payload(), self.ctx(ok=False))
        self.assertIn(f"{REPO}:42:alice", self.seen())

    def test_a_draft_is_suppressed_not_seen_and_pings_when_ready(self):
        W.handle("pull_request", self.payload(draft=True), self.ctx())
        self.assertEqual(self.seen().strip(), "")
        self.assertEqual(Q.is_suppressed(REPO, 42, "alice"), "draft")
        sent = []
        W.handle("pull_request", self.payload(draft=False), self.ctx(sent=sent))
        self.assertEqual(sent, ["alice"])
        self.assertEqual(Q.is_suppressed(REPO, 42, "alice"), "")

    def test_a_replayed_delivery_is_dropped(self):
        W.process("pull_request", self.payload(), self.ctx(), delivery="d-1")
        self.assertEqual(Q.find(REPO, 42)["requested"], ["alice"])
        removed = {**self.payload(), "action": "review_request_removed"}
        W.process("pull_request", removed, self.ctx(), delivery="d-2")
        self.assertIsNone(Q.find(REPO, 42))
        # The same removal replayed later must not un-queue a fresh request.
        W.process("pull_request", self.payload(), self.ctx(), delivery="d-3")
        out, _ = W.process("pull_request", removed, self.ctx(), delivery="d-2")
        self.assertEqual(out, "ignored")
        self.assertIsNotNone(Q.find(REPO, 42))


class AutoArchive(Base):
    """Should-fix 17 — a re-added request clears OUR archive, never the user's own."""

    def test_auto_archive_is_cleared_but_a_manual_one_is_not(self):
        Q.upsert(REPO, 21, row(21, []), ["alice"], origin=Q.ORIGIN_WEBHOOK)
        Q.mark_seen(REPO, 21, "alice")
        Q.touch_requested_at(REPO, 21, "alice")
        Q.done(REPO, 21, state="closed", merged=False)
        ud = P.udir(REPO, 21, "alice")
        self.assertTrue((ud / "archived").exists() and (ud / "archived.auto").exists())
        self.assertTrue(Q.clear_auto_archive(REPO, 21, "alice"))
        self.assertFalse((ud / "archived").exists())
        self.assertNotIn(f"{REPO}:21:alice", self.seen())
        # A user's own archive has no .auto sibling and survives.
        (ud / "archived").write_text("1")
        self.assertFalse(Q.clear_auto_archive(REPO, 21, "alice"))
        self.assertTrue((ud / "archived").exists())

    def test_closed_state_is_persisted(self):
        Q.upsert(REPO, 22, row(22, []), ["alice"], origin=Q.ORIGIN_WEBHOOK)
        Q.done(REPO, 22, state="merged", merged=True)
        meta = json.loads((P.prdir(REPO, 22) / "meta.json").read_text())
        self.assertEqual((meta["state"], meta["merged"]), ("merged", True))


class SeenPrune(Base):
    def test_closed_prs_lose_their_seen_lines(self):
        Q.merge_poll([row(30, ["alice"])], [(REPO, "alice")])
        Q.mark_seen(REPO, 30, "alice")
        Q.mark_seen(REPO, 31, "alice")
        Q.mark_closed(REPO, 31, state="closed")
        live = {f"{REPO}:30"}
        self.assertEqual(Q.prune_seen(live, Q._closed_lookup), 1)
        self.assertIn(f"{REPO}:30:alice", self.seen())
        self.assertNotIn(f"{REPO}:31:alice", self.seen())


FAKE_GH = """#!/usr/bin/env bash
# Fake gh. MODE=ok returns one PR; MODE=fail exits 1 like an expired token would.
if [ "${MODE:-ok}" = fail ]; then echo "gh: HTTP 401: Bad credentials" >&2; exit 1; fi
echo '[{"number":77,"title":"live","author":{"login":"carol","is_bot":false},
  "headRefOid":"abc","url":"https://github.com/acme/widgets/pull/77","additions":1,
  "deletions":0,"changedFiles":1,"isDraft":false,"createdAt":"2026-09-01T10:00:00Z",
  "updatedAt":"2026-09-02T10:00:00Z"}]'
"""


@unittest.skipUnless(shutil.which("jq") and shutil.which("bash"), "jq/bash not installed")
class PollerScript(Base):
    """bin/pr-watch.sh end to end against a fake gh — blockers 2 and 3, for real."""

    def run_poll(self, root, mode="ok"):
        binp = root / "fakebin"
        binp.mkdir(exist_ok=True)
        (binp / "gh").write_text(FAKE_GH)
        (binp / "gh").chmod(0o755)
        env = {**os.environ, "ROOT": str(root), "MODE": mode,
               "PATH": f"{binp}:{os.environ['PATH']}", "NOTIFY_BACKENDS": "none"}
        return subprocess.run(["bash", str(HERE / "pr-watch.sh")], env=env,
                              capture_output=True, text=True, timeout=120)

    def setup_root(self):
        root = Path(tempfile.mkdtemp(prefix="rs-poll-sh-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        (root / ".env").write_text(textwrap.dedent(f"""\
            REPOS={REPO}
            REVIEWER=alice
            GITHUB_PAT=x
            RS_SECRET=deadbeef
            PUBLIC_URL=http://localhost:8899
            NOTIFY_BACKENDS=none
            """))
        (root / "users.json").write_text('{"alice": {}}')
        return root

    def test_a_failing_gh_never_blanks_the_queue(self):
        root = self.setup_root()
        r = self.run_poll(root, "ok")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rows = json.loads((root / "queue.json").read_text())
        self.assertEqual([x["number"] for x in rows], [77])
        r = self.run_poll(root, "fail")
        self.assertNotEqual(r.returncode, 0, "a total gh failure must not exit clean")
        self.assertIn("all 1 gh search(es) failed", r.stderr)
        self.assertEqual(json.loads((root / "queue.json").read_text()), rows,
                         "a failed poll published an empty queue over the real one")

    def test_the_poll_writes_through_the_shared_lock(self):
        """A row only the webhook knows about (a team request) is still there afterwards."""
        root = self.setup_root()
        self.run_poll(root, "ok")
        env = {**os.environ, "ROOT": str(root)}
        code = ("import rs_queue as Q;"
                "Q.upsert('acme/widgets', 500, {'title': 'team'}, ['bob'],"
                " origin=Q.ORIGIN_WEBHOOK)")
        subprocess.run([sys.executable, "-c", code], cwd=HERE, env=env, check=True)
        self.run_poll(root, "ok")
        rows = json.loads((root / "queue.json").read_text())
        self.assertIn(500, [x["number"] for x in rows],
                      "the poll destroyed a row the webhook had created")


if __name__ == "__main__":
    unittest.main()
