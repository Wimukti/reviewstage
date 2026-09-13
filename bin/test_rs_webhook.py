"""Unit tests for the GitHub webhook receiver and the shared queue module.

    python3 -m unittest bin/test_rs_webhook.py

Runs against a scratch ROOT (no server, no network). The parity test extracts the jq program
pr-watch.sh uses to write queue.json and checks that rs_queue produces the identical row
from the REST-shaped payload a webhook carries — skipped when jq is not installed.
"""
import importlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_TMP = tempfile.mkdtemp(prefix="rs-webhook-test-")
os.environ["ROOT"] = _TMP                       # before rs_paths reads it
sys.path.insert(0, str(HERE))

import rs_paths as P  # noqa: E402
import rs_queue as Q  # noqa: E402
import rs_webhook as W  # noqa: E402

# `unittest discover` imports every test module first; another module may already have bound
# rs_paths to the default ROOT. Rebind the chain to _TMP so nothing here touches real state.
for _m in (P, Q, W):
    importlib.reload(_m)
assert P.ROOT == Path(_TMP) and Q.QUEUE.parent == Path(_TMP), "test ROOT did not take"

REPO = "acme/widgets"
SECRET = "unit-test-secret"
USERS = {"alice": {"slack_id": "U1", "discord_id": "D1"}, "bob": {"slack_id": ""}}


def pr_obj(number=42, head="abc123", draft=False, bot=False, created="2026-09-01T10:00:00Z"):
    return {
        "number": number, "title": "Add lead-time badge", "html_url": f"https://github.com/{REPO}/pull/{number}",
        "additions": 42, "deletions": 8, "changed_files": 5, "draft": draft,
        "user": {"login": "carol", "type": "Bot" if bot else "User"},
        "head": {"sha": head}, "created_at": created, "updated_at": "2026-09-02T10:00:00Z",
    }


def payload(action, reviewer="alice", team=None, **pr):
    d = {"action": action, "repository": {"full_name": REPO, "owner": {"login": "acme"}},
         "pull_request": pr_obj(**pr)}
    if team:
        d["requested_team"] = {"slug": team}
        d["organization"] = {"login": "acme"}
    elif reviewer:
        d["requested_reviewer"] = {"login": reviewer}
    return d


class Base(unittest.TestCase):
    def setUp(self):
        Path(_TMP).mkdir(exist_ok=True)  # a previous class's tearDownClass removed it
        for f in (Q.QUEUE, Q.SEEN, Path(_TMP, W.STATE_FILE)):
            f.unlink(missing_ok=True)
        shutil.rmtree(P.STATE, ignore_errors=True)
        self.notified = []
        self.ctx = W.Context(_TMP, HERE, lambda r: r.lower() == REPO, USERS,
                             "https://rs.example.com", SECRET,
                             settings={"max_pr_age_days": 45, "skip_bot_prs": False},
                             single_repo=REPO, reviewer="alice",
                             team_members=lambda org, slug: ["alice", "zed"] if slug == "web" else [],
                             notify=lambda row, login: self.notified.append((row["number"], login)),
                             log=lambda *a, **k: None)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_TMP, ignore_errors=True)

    def seen(self):
        return Q.SEEN.read_text().splitlines() if Q.SEEN.exists() else []


class Signature(unittest.TestCase):
    def test_good_bad_missing(self):
        body = b'{"zen":"x"}'
        good = W.signature_for(SECRET, body)
        self.assertTrue(W.verify_signature(SECRET, body, good))
        self.assertFalse(W.verify_signature(SECRET, body + b" ", good))
        self.assertFalse(W.verify_signature("other", body, good))
        self.assertFalse(W.verify_signature(SECRET, body, ""))
        self.assertFalse(W.verify_signature(SECRET, body, good.replace("sha256=", "sha1=")))
        self.assertFalse(W.verify_signature("", body, good))   # no secret → never verifies


class ReviewRequested(Base):
    def test_enqueues_notifies_and_dedups(self):
        out, msg = W.handle("pull_request", payload("review_requested"), self.ctx)
        self.assertEqual(out, "handled", msg)
        rows = Q.load()
        self.assertEqual(len(rows), 1)
        self.assertEqual(list(rows[0].keys()), list(Q.ROW_KEYS))
        self.assertEqual(rows[0]["requested"], ["alice"])
        self.assertEqual(rows[0]["author"], "carol")
        self.assertEqual(self.notified, [(42, "alice")])
        self.assertEqual(self.seen(), [f"{REPO}:42:alice"])
        self.assertTrue((P.udir(REPO, 42, "alice") / "requested_at").exists())
        # Identical delivery again (GitHub redelivery, or the poller racing): no second card,
        # no duplicate row, no duplicate seen line.
        out, msg = W.handle("pull_request", payload("review_requested"), self.ctx)
        self.assertEqual(out, "handled")
        self.assertIn("already seen", msg)
        self.assertEqual(len(Q.load()), 1)
        self.assertEqual(self.notified, [(42, "alice")])
        self.assertEqual(self.seen(), [f"{REPO}:42:alice"])

    def test_poller_seen_line_blocks_webhook_card(self):
        Q.SEEN.write_text(f"{REPO}:42:alice\n")
        W.handle("pull_request", payload("review_requested"), self.ctx)
        self.assertEqual(self.notified, [])
        self.assertEqual(Q.load()[0]["requested"], ["alice"])   # still queued, just no ping

    def test_legacy_seen_forms_count_for_single_repo(self):
        Q.SEEN.write_text("42:alice\n")
        self.assertTrue(Q.is_seen(REPO, 42, "alice", REPO, "alice"))
        Q.SEEN.write_text("42\n")
        self.assertTrue(Q.is_seen(REPO, 42, "alice", REPO, "alice"))
        self.assertFalse(Q.is_seen(REPO, 42, "bob", REPO, "alice"))
        self.assertFalse(Q.is_seen(REPO, 42, "alice", "", "alice"))

    def test_not_signed_in_is_ignored(self):
        out, msg = W.handle("pull_request", payload("review_requested", reviewer="mallory"), self.ctx)
        self.assertEqual(out, "ignored")
        self.assertIn("not signed in", msg)
        self.assertEqual(Q.load(), [])
        self.assertEqual(self.notified, [])

    def test_team_request_expands_to_signed_in_members(self):
        out, _ = W.handle("pull_request", payload("review_requested", team="web"), self.ctx)
        self.assertEqual(out, "handled")
        self.assertEqual(Q.load()[0]["requested"], ["alice"])    # zed is not signed in
        self.assertEqual(self.notified, [(42, "alice")])
        out, msg = W.handle("pull_request", payload("review_requested", team="ops", number=43), self.ctx)
        self.assertEqual(out, "ignored")
        self.assertIn("no signed-in member", msg)

    def test_second_reviewer_merges_into_same_row(self):
        W.handle("pull_request", payload("review_requested"), self.ctx)
        W.handle("pull_request", payload("review_requested", reviewer="bob"), self.ctx)
        rows = Q.load()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["requested"], ["alice", "bob"])
        self.assertEqual(sorted(self.notified), [(42, "alice"), (42, "bob")])

    def test_repo_not_allowed(self):
        p = payload("review_requested")
        p["repository"]["full_name"] = "evil/corp"
        out, msg = W.handle("pull_request", p, self.ctx)
        self.assertEqual(out, "ignored")
        self.assertIn("REPOS", msg)
        self.assertEqual(Q.load(), [])

    def test_old_and_draft_are_marked_seen_without_a_card(self):
        W.handle("pull_request", payload("review_requested", created="2020-01-01T00:00:00Z"), self.ctx)
        self.assertEqual(self.notified, [])
        self.assertEqual(self.seen(), [f"{REPO}:42:alice"])
        W.handle("pull_request", payload("review_requested", number=7, draft=True), self.ctx)
        self.assertEqual(self.notified, [])
        self.assertIn(f"{REPO}:7:alice", self.seen())
        self.assertEqual(len(Q.load()), 2)      # both still in the dashboard queue

    def test_bot_prs_skipped_only_when_setting_on(self):
        W.handle("pull_request", payload("review_requested", bot=True), self.ctx)
        self.assertEqual(self.notified, [(42, "alice")])
        self.ctx.settings["skip_bot_prs"] = True
        W.handle("pull_request", payload("review_requested", bot=True, number=43), self.ctx)
        self.assertEqual(self.notified, [(42, "alice")])
        self.assertIn(f"{REPO}:43:alice", self.seen())

    def test_unhandled_actions_are_ignored(self):
        self.assertEqual(W.handle("pull_request", payload("labeled"), self.ctx)[0], "ignored")
        self.assertEqual(W.handle("issues", {"action": "opened"}, self.ctx)[0], "ignored")
        self.assertEqual(W.handle("pull_request", "nope", self.ctx)[0], "error")


class Lifecycle(Base):
    def test_removed_drops_login_then_row(self):
        W.handle("pull_request", payload("review_requested"), self.ctx)
        W.handle("pull_request", payload("review_requested", reviewer="bob"), self.ctx)
        W.handle("pull_request", payload("review_request_removed"), self.ctx)
        self.assertEqual(Q.load()[0]["requested"], ["bob"])
        W.handle("pull_request", payload("review_request_removed", reviewer="bob"), self.ctx)
        self.assertEqual(Q.load(), [])

    def test_synchronize_flips_head(self):
        W.handle("pull_request", payload("review_requested"), self.ctx)
        (P.udir(REPO, 42, "alice")).mkdir(parents=True, exist_ok=True)
        (P.udir(REPO, 42, "alice") / "head").write_text("abc123")
        out, msg = W.handle("pull_request", payload("synchronize", head="def456"), self.ctx)
        self.assertEqual(out, "handled", msg)
        row = Q.find(REPO, 42)
        self.assertEqual(row["head"], "def456")
        self.assertEqual(row["requested"], ["alice"])            # untouched
        self.assertEqual(self.notified, [(42, "alice")])         # no re-ping on push
        # stale = the reviewed head no longer matches the row's head (what the PR page checks)
        self.assertNotEqual((P.udir(REPO, 42, "alice") / "head").read_text(), row["head"])

    def test_synchronize_for_unqueued_pr_is_a_noop(self):
        out, msg = W.handle("pull_request", payload("synchronize", number=99), self.ctx)
        self.assertEqual(out, "handled")
        self.assertIn("not queued", msg)
        self.assertEqual(Q.load(), [])

    def test_closed_leaves_queue_and_archives_unposted(self):
        W.handle("pull_request", payload("review_requested"), self.ctx)
        W.handle("pull_request", payload("review_requested", reviewer="bob"), self.ctx)
        (P.udir(REPO, 42, "alice") / "status").write_text("done")
        (P.udir(REPO, 42, "bob") / "posted.json").write_text('{"at": 1}')
        out, _ = W.handle("pull_request", payload("closed"), self.ctx)
        self.assertEqual(out, "handled")
        self.assertEqual(Q.load(), [])
        self.assertTrue((P.udir(REPO, 42, "alice") / "archived").exists())
        self.assertFalse((P.udir(REPO, 42, "bob") / "archived").exists())

    def test_review_submitted_marks_posted_and_approved(self):
        W.handle("pull_request", payload("review_requested"), self.ctx)
        p = {"action": "submitted", "repository": {"full_name": REPO},
             "pull_request": pr_obj(), "review": {"state": "approved", "user": {"login": "alice"}}}
        out, msg = W.handle("pull_request_review", p, self.ctx)
        self.assertEqual(out, "handled", msg)
        ud = P.udir(REPO, 42, "alice")
        self.assertEqual(json.loads((ud / "posted.json").read_text())["event"], "APPROVED")
        self.assertTrue((ud / "approved").exists())
        # A dashboard post already recorded is never overwritten.
        p["review"] = {"state": "commented", "user": {"login": "alice"}}
        W.handle("pull_request_review", p, self.ctx)
        self.assertEqual(json.loads((ud / "posted.json").read_text())["event"], "APPROVED")
        # Someone not signed in here leaves no trace.
        p["review"] = {"state": "commented", "user": {"login": "mallory"}}
        self.assertEqual(W.handle("pull_request_review", p, self.ctx)[0], "ignored")
        self.assertFalse(P.udir(REPO, 42, "mallory").exists())


class StateFile(Base):
    def test_record_status_active(self):
        s = W.status(_TMP)
        self.assertEqual(s["count"], 0)
        self.assertIsNone(s["last_event_at"])
        W.record(_TMP, ping=True)
        s = W.status(_TMP)
        self.assertIsNotNone(s["last_ping"])
        self.assertEqual(s["count"], 0)                    # pings are not events
        W.record(_TMP, "pull_request.review_requested")
        W.record(_TMP, "pull_request.closed", error="boom")
        s = W.status(_TMP)
        self.assertEqual(s["count"], 2)
        self.assertEqual(s["last_event"], "pull_request.closed")
        self.assertEqual(s["last_error"], "boom")
        self.assertTrue(W.active(_TMP, 180))
        self.assertFalse(W.active(_TMP, 180, now=time.time() + 361))

    def test_process_records_and_logs(self):
        lines = []
        self.ctx.log = lambda m, **k: lines.append(m)
        W.process("pull_request", payload("review_requested"), self.ctx, delivery="deadbeef-1")
        self.assertEqual(W.status(_TMP)["last_event"], "pull_request.review_requested")
        self.assertIn("[webhook deadbeef]", lines[0])
        self.assertIn("handled", lines[0])


class Payload(Base):
    def test_requested_payload_matches_pr_watch_shape(self):
        row = Q.normalize({**Q.row_from_api(REPO, pr_obj()), "requested": ["alice"]})
        p = Q.requested_payload(row, "alice", "https://rs.example.com", SECRET, USERS)
        self.assertEqual(list(p), ["repo", "pr", "title", "author", "url", "login", "slack_id",
                                   "discord_id", "extra"])
        self.assertEqual(p["pr"], "42")                    # a string, as the jq --arg makes it
        self.assertEqual(p["slack_id"], "U1")
        self.assertEqual(p["extra"]["files"], 5)
        self.assertTrue(p["extra"]["detail"].startswith(
            "https://rs.example.com/pr?repo=acme%2Fwidgets&pr=42&exp="))
        self.assertTrue(p["extra"]["board"].startswith("https://rs.example.com/?exp="))

    @unittest.skipUnless(shutil.which("jq") and shutil.which("openssl"), "jq/openssl not installed")
    def test_signed_link_matches_lib_common(self):
        """The Python signature must equal lib-common.sh's `sign` (openssl HMAC) byte for byte,
        or the card's Open-review button would be rejected by the server."""
        exp = 1_900_000_000
        msg = f"pr:{REPO}#42:{exp}"
        want = subprocess.run(["bash", "-c", f'printf %s "$1" | openssl dgst -sha256 -hmac "$2" -r | cut -d" " -f1',
                               "_", msg, SECRET], capture_output=True, text=True).stdout.strip()
        self.assertEqual(Q._sign(SECRET, msg), want)


@unittest.skipUnless(shutil.which("jq"), "jq not installed")
class PollerParity(Base):
    """Feed pr-watch.sh's own jq program a `gh pr list --json` row and compare to the row the
    webhook path writes from the REST payload for the same PR."""

    def jq_program(self):
        src = (HERE / "pr-watch.sh").read_text()
        m = re.search(r"echo \"\$tagged\" \| jq -s '(.*?)' \\\n\s*> ", src, re.S)
        self.assertIsNotNone(m, "could not find the queue.json jq program in pr-watch.sh")
        return m.group(1)

    def test_rows_identical(self):
        gh_row = {  # what `gh pr list --json <fields>` returns, tagged as pr-watch does
            "number": 42, "title": "Add lead-time badge", "author": {"login": "carol", "is_bot": False},
            "headRefOid": "abc123", "url": f"https://github.com/{REPO}/pull/42", "additions": 42,
            "deletions": 8, "changedFiles": 5, "isDraft": False, "createdAt": "2026-09-01T10:00:00Z",
            "updatedAt": "2026-09-02T10:00:00Z", "requested": ["alice"], "repo": REPO,
        }
        # Two tagged lines (alice, bob) for the same PR, as two `gh` searches would produce.
        tagged = json.dumps(gh_row) + "\n" + json.dumps({**gh_row, "requested": ["bob"]}) + "\n"
        r = subprocess.run(["jq", "-s", self.jq_program()], input=tagged, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        poller_rows = json.loads(r.stdout)

        W.handle("pull_request", payload("review_requested"), self.ctx)
        W.handle("pull_request", payload("review_requested", reviewer="bob"), self.ctx)
        webhook_rows = Q.load()
        self.assertEqual(webhook_rows, poller_rows)
        self.assertEqual([list(r) for r in webhook_rows], [list(r) for r in poller_rows])  # key order too


if __name__ == "__main__":
    unittest.main()
