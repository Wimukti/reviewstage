#!/usr/bin/env python3
"""The post and approve path (bin/server.py): the audit's blockers, each as a test that fails
on the code as it was.

  1. posted.json was a permanent per-(repo, pr, user) lock nothing ever cleared, so a second
     post on the same PR was impossible and the post bar disappeared for good.
  2. the webhook wrote that same terminal marker for a review submitted on github.com, which
     stranded the reviewer's entire staged draft.
  3. meta.json lost headRefOid, so the re-run cache key, the stale banner and the anchor cache
     all ran on an empty head.
  5. findings were matched to the client's edits by array index, so a re-run from another
     device could post old text against a new finding's file and line.
  6. nothing serialised check-then-act around posting, so two tabs landed two full reviews.
  9. approve had no staleness check and no idempotency.

Run: python3 -m unittest bin/test_rs_post.py
"""
import importlib
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

SECRET = "p" * 64
REPO = "acme/widgets"
PR = "7"
USER = "alice"
HEAD_A = "a" * 40
HEAD_B = "b" * 40


def load_server(root, extra=""):
    os.makedirs(os.path.join(root, "state"), exist_ok=True)
    with open(os.path.join(root, ".env"), "w") as f:
        f.write(f"RS_SECRET={SECRET}\nREPOS={REPO}\nGITHUB_PAT=service\nDRY_RUN=0\n{extra}")
    os.environ["ROOT"] = root
    os.environ["RS_COOKIE_SECURE"] = "0"
    # The helper modules bind $ROOT at import, so reloading server.py alone would leave every
    # test writing into the first test's state dir.
    for name in ("rs_paths", "rs_learn", "rs_profile", "rs_queue", "server"):
        if name in sys.modules:
            importlib.reload(sys.modules[name])
        else:
            importlib.import_module(name)
    return sys.modules["server"]


REVIEW = {
    "event": "COMMENT",
    "summary": "Looks reasonable overall.",
    "comments": [
        {"severity": "blocker", "path": "app/pay.py", "line": 12, "body": "This double-charges."},
        {"severity": "nit", "path": "app/pay.py", "line": 30, "body": "Name this."},
    ],
}


class PostCase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.srv = load_server(self.root)
        self.srv.save_users({USER: {"name": "Alice"}})
        self.d = self.srv.udir(REPO, PR, USER)
        self.d.mkdir(parents=True, exist_ok=True)
        self.write_review(REVIEW)
        (self.d / "head").write_text(HEAD_A)
        self.set_meta(HEAD_A)

    # -- fixtures ---------------------------------------------------------------------------
    def write_review(self, rev):
        (self.d / "review.json").write_text(json.dumps(rev))

    def set_meta(self, head):
        f = self.srv.P.prdir(REPO, PR) / "meta.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps({"number": int(PR), "title": "Pay twice", "head": head,
                                 "author": "bob", "url": "https://example.invalid"}))

    def key(self, head=HEAD_A):
        return self.srv.review_key(json.loads((self.d / "review.json").read_text()), head)

    def form(self, selected=(0,)):
        rev = json.loads((self.d / "review.json").read_text())
        originals = sorted(rev["comments"],
                           key=lambda c: self.srv.SEV_ORDER.get(c.get("severity"), 9))
        form = {"pr": [PR], "count": [str(len(originals))]}
        for i, c in enumerate(originals):
            if i in selected:
                form[f"sel_{i}"] = ["on"]
            form[f"body_{i}"] = [c["body"]]
            form[f"sugg_{i}"] = [""]
            form[f"path_{i}"] = [c["path"]]
            form[f"line_{i}"] = [str(c["line"])]
            form[f"sev_{i}"] = [c["severity"]]
        return form

    def fake_github(self, post_returncode=0, on_post=None):
        """Stub gh() so the post path runs end to end without touching GitHub. Returns the list
        of write calls it saw."""
        calls = []

        class R:
            def __init__(self, rc=0, out="", err=""):
                self.returncode, self.stdout, self.stderr = rc, out, err

        files = [{"filename": "app/pay.py", "status": "modified",
                  "patch": "@@ -1,0 +12,2 @@\n+one\n+two\n"}]
        pr_obj = {"state": "open", "draft": False, "merged": False,
                  "head": {"sha": HEAD_A}, "user": {"login": "bob"}}

        def gh(args, timeout=45, token=self.srv.SERVICE_TOKEN):
            a = list(args)
            if "--method" in a and "POST" in a:
                calls.append(a)
                if on_post:
                    on_post()
                return R(post_returncode, "{}", "gh: Unprocessable Entity (HTTP 422)"
                         if post_returncode else "")
            if a[:2] == ["api", "user"]:
                return R(0, json.dumps({"login": USER}))
            if a[0] == "api" and a[1].endswith("/files"):
                return R(0, json.dumps([files]))
            if a[0] == "api" and "/pulls/" in a[1]:
                return R(0, json.dumps(pr_obj))
            return R(0, "{}")

        self.srv.gh = gh
        self.srv.user_pat = lambda login: "user-token"
        self.srv.rs_learn.record = lambda *a, **k: None
        return calls

    def handler(self):
        return self.srv.Handler.__new__(self.srv.Handler)


# --- blocker 1: the post marker is scoped to the RUN, not the PR -------------------------------
class PostingTwiceOnOnePr(PostCase):
    def test_a_rerun_clears_the_post_marker_so_the_next_review_can_be_posted(self):
        """review → post → the author pushes → review again → post again. The second post used
        to be refused forever, because nothing cleared posted.json: not archive_review (which
        omitted it from RUN_FILES), not _spawn_review, not a re-run."""
        calls = self.fake_github()
        h = self.handler()
        self.assertIn("Posted your review", h._post_result(REPO, PR, USER, self.form()))
        self.assertEqual(len(calls), 1)

        # the author pushes and the reviewer re-runs: the marker goes to history with its run
        self.srv.archive_review(REPO, PR, USER)
        self.assertFalse((self.d / "posted.json").exists())
        self.assertFalse((self.d / self.srv.POSTED_RUNS).exists())
        hist = sorted((self.d / "history").iterdir())
        self.assertTrue((hist[-1] / "posted.json").exists(), "the fact must survive in history")

        self.write_review({**REVIEW, "summary": "Second pass."})
        (self.d / "head").write_text(HEAD_B)
        self.set_meta(HEAD_B)
        self.assertIn("Posted your review", h._post_result(REPO, PR, USER, self.form()))
        self.assertEqual(len(calls), 2, "the second post must reach GitHub")

    def test_the_same_review_is_still_refused_twice(self):
        """Idempotency is the point of the marker — it just has to be per run."""
        calls = self.fake_github()
        h = self.handler()
        h._post_result(REPO, PR, USER, self.form())
        again = h._post_result(REPO, PR, USER, self.form())
        self.assertIn("already posted this review", again)
        self.assertEqual(len(calls), 1)

    def test_the_post_bar_comes_back_after_a_rerun(self):
        """review.posted drives whether the UI offers the post bar at all."""
        self.fake_github()
        self.handler()._post_result(REPO, PR, USER, self.form())
        data = self.handler()._review_data(REPO, PR, USER,
                                           self.srv.load_review(REPO, PR, USER), {})
        self.assertTrue(data["posted"])
        self.srv.archive_review(REPO, PR, USER)
        self.write_review({**REVIEW, "summary": "Second pass."})
        data = self.handler()._review_data(REPO, PR, USER,
                                           self.srv.load_review(REPO, PR, USER), {})
        self.assertFalse(data["posted"])

    def test_run_files_carry_the_post_markers(self):
        self.assertIn("posted.json", self.srv.RUN_FILES)
        self.assertIn(self.srv.POSTED_RUNS, self.srv.RUN_FILES)


# --- a dry run is a real decision, but never a metric ------------------------------------------
class DryRunIsRecordedButNotRated(PostCase):
    """The original audit's concern: a two-week pilot on the default DRY_RUN=1 posts nothing to
    GitHub, yet Insights reported a keep rate computed from those entirely hypothetical posts.
    The decision is still worth learning from — it just has to be flagged."""

    def setUp(self):
        super().setUp()
        self.srv = load_server(self.root, extra="DRY_RUN=1\n")   # last line wins in .env
        self.srv.save_users({USER: {"name": "Alice"}})

    def test_nothing_is_sent_and_the_decision_is_flagged_dry(self):
        calls = self.fake_github()
        importlib.reload(self.srv.rs_learn)   # fake_github stubs record(); these tests want it
        out = self.handler()._post_result(REPO, PR, USER, self.form())
        self.assertIn("DRY RUN", out)
        self.assertEqual(calls, [], "a dry run must not reach GitHub")
        rows = self.srv.rs_learn._read()
        self.assertTrue(rows, "the decision is still recorded")
        self.assertTrue(all(r.get("dry") for r in rows))

    def test_the_hypothetical_post_is_in_no_rate_and_counted_on_its_own(self):
        self.fake_github()
        importlib.reload(self.srv.rs_learn)   # fake_github stubs record(); these tests want it
        self.handler()._post_result(REPO, PR, USER, self.form())
        c = self.srv.rs_learn.counts()
        self.assertEqual((c["kept"], c["edited"], c["dropped"]), (0, 0, 0))
        self.assertEqual(c["dry"], len(REVIEW["comments"]))
        self.assertIsNone(self.srv.rs_learn.keep_rates(c)["keepRate"])

    def test_a_dry_run_still_does_not_close_the_posting_gate(self):
        self.fake_github()
        self.assertIn("DRY RUN", self.handler()._post_result(REPO, PR, USER, self.form()))
        self.assertIn("DRY RUN", self.handler()._post_result(REPO, PR, USER, self.form()))


# --- blocker 2: a review left on github.com must not strand the staged draft -------------------
class AGithubCommentDoesNotLockTheDraft(PostCase):
    def github_marker(self):
        """Byte-for-byte what rs_queue.mark_posted writes from the webhook."""
        (self.d / "posted.json").write_text(json.dumps(
            {"at": int(time.time()), "inline": 0, "event": "COMMENT", "source": "github"}))

    def test_posting_still_works_after_a_review_submitted_on_github(self):
        self.github_marker()
        calls = self.fake_github()
        out = self.handler()._post_result(REPO, PR, USER, self.form())
        self.assertIn("Posted your review", out)
        self.assertEqual(len(calls), 1)

    def test_the_post_bar_is_not_hidden_by_a_github_review(self):
        self.github_marker()
        data = self.handler()._review_data(REPO, PR, USER,
                                           self.srv.load_review(REPO, PR, USER), {})
        self.assertFalse(data["posted"], "a comment on the Files tab is not this draft")

    def test_the_gate_only_sees_markers_this_dashboard_wrote(self):
        self.github_marker()
        self.assertIsNone(self.srv.posted_this_run(REPO, PR, USER, self.key()))

    def test_the_github_fact_is_still_readable_for_the_queue_and_timeline(self):
        self.github_marker()
        self.assertEqual(self.srv.marker(REPO, PR, "posted.json", USER)["source"], "github")
        self.assertEqual(self.srv.pr_state(REPO, PR, USER), "posted")


# --- blocker 3: a head SHA, or no cache and no anchor key --------------------------------------
class TheHeadIsNeverSilentlyEmpty(PostCase):
    def test_pr_head_refreshes_a_meta_json_that_lost_its_head(self):
        self.set_meta("")
        self.srv.fetch_pr_meta = lambda repo, pr: {"repo": repo, "number": pr, "head": HEAD_B}
        self.assertEqual(self.srv.pr_head(REPO, PR), HEAD_B)

    def test_the_rerun_cache_is_not_served_without_a_head(self):
        """The key hashes the head, so with an empty one it was identical before and after a
        force-push — and a cached "this exact commit" review was served for a commit that no
        longer exists."""
        self.set_meta("")
        self.srv.fetch_pr_meta = lambda repo, pr: None       # GitHub cannot tell us either
        self.srv.claude_connected = lambda u: True
        self.srv.review_env = lambda u: dict(os.environ)
        key = self.srv.review_cache_key(USER, REPO, "", "standard", "", "")
        cache = self.d / "cache"
        cache.mkdir(parents=True, exist_ok=True)
        (cache / f"{key}.json").write_text(json.dumps(
            {"review": {"summary": "stale", "comments": []}, "skill": "global"}))
        spawned = []
        class FakePopen:
            pid = 424242

            def __init__(self, *a, **k):
                pass
        self.srv.subprocess = type("S", (), {"Popen": FakePopen,
                                             "STDOUT": self.srv.subprocess.STDOUT})
        h = self.handler()
        self.assertTrue(h._spawn_review(REPO, PR, USER, effort="standard"))
        self.assertFalse((self.d / "cached").exists(),
                         "a cache hit on an empty head is a review of an unknown commit")
        self.assertEqual((self.d / "status").read_text(), "queued",
                         "it must actually run rather than serve the stale cache")
        self.assertEqual((self.d / "pid").read_text(), "424242")
        del spawned

    def test_anchors_are_not_cached_under_an_empty_head(self):
        self.fake_github()
        a1, _ = self.srv.pr_anchors(REPO, PR, "")
        a2, _ = self.srv.pr_anchors(REPO, PR, "")
        self.assertIsNot(a1, a2, "an empty head pinned one answer for the server's lifetime")
        b1, _ = self.srv.pr_anchors(REPO, PR, HEAD_A)
        b2, _ = self.srv.pr_anchors(REPO, PR, HEAD_A)
        self.assertIs(b1, b2, "a real head still caches")

    def test_the_stale_banner_can_fire(self):
        self.set_meta(HEAD_B)                      # the author pushed
        data = self.handler().api_pr(REPO, PR, USER, "")
        self.assertTrue(data["stale"])


# --- blocker 5: the client's indices belong to ONE run -----------------------------------------
class TheReviewKeyPinsTheRun(PostCase):
    def test_review_data_exposes_a_key(self):
        data = self.handler()._review_data(REPO, PR, USER,
                                           self.srv.load_review(REPO, PR, USER), {})
        self.assertTrue(data["reviewKey"])

    def test_the_key_changes_when_the_findings_do(self):
        first = self.key()
        self.write_review({**REVIEW, "comments": list(reversed(REVIEW["comments"]))})
        self.assertNotEqual(first, self.key())

    def test_the_key_is_the_same_on_two_devices_looking_at_one_run(self):
        self.assertEqual(self.key(), self.key())


class MismatchedReviewKeyIs409(unittest.TestCase):
    """The route, end to end: an open tab whose run has been replaced must get a 409 and must
    not post a comment about the wrong code under the reviewer's name."""

    @classmethod
    def setUpClass(cls):
        cls.root = tempfile.mkdtemp()
        cls.srv = load_server(cls.root)
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), cls.srv.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        shutil.rmtree(cls.root, ignore_errors=True)

    def setUp(self):
        self.srv.save_users({USER: {"name": "Alice"}})
        self.d = self.srv.udir(REPO, PR, USER)
        self.d.mkdir(parents=True, exist_ok=True)
        (self.d / "review.json").write_text(json.dumps(REVIEW))
        f = self.srv.P.prdir(REPO, PR) / "meta.json"
        f.write_text(json.dumps({"number": int(PR), "head": HEAD_A}))
        self.cookie = self.srv.session_cookie(USER).split(";")[0]
        self.posts = []
        self.srv.user_pat = lambda login: "user-token"
        self.srv.gh = lambda *a, **k: self.posts.append(a) or type(
            "R", (), {"returncode": 1, "stdout": "", "stderr": "should not be called"})()

    def post(self, body):
        c = HTTPConnection("127.0.0.1", self.port, timeout=10)
        raw = json.dumps(body).encode()
        c.request("POST", "/api/post", raw,
                  {"Content-Type": "application/json", "Cookie": self.cookie,
                   "Content-Length": str(len(raw))})
        r = c.getresponse()
        out = (r.status, json.loads(r.read() or b"{}"))
        c.close()
        return out

    def body(self, key):
        exp, sig = self.srv.mint("post", self.srv.pr_subject(REPO, PR), 600)
        return {"repo": REPO, "pr": PR, "exp": exp, "sig": sig, "selected": [0],
                "bodies": {}, "suggs": {}, "request_changes": False, "review_key": key}

    def test_a_stale_review_key_is_refused_with_409(self):
        status, data = self.post(self.body("rk1:from-an-older-run"))
        self.assertEqual(status, 409)
        self.assertIn("re-run", data["error"])
        self.assertTrue(data["reviewKey"])
        self.assertEqual(self.posts, [], "nothing may reach GitHub on a mismatch")

    def test_the_matching_key_is_accepted(self):
        good = self.srv.review_key(REVIEW, HEAD_A)
        status, data = self.post(self.body(good))
        self.assertEqual(status, 200)
        self.assertIn("bannerHtml", data)


# --- blocker 6: two tabs, one review -----------------------------------------------------------
class PostingIsSerialised(PostCase):
    def test_two_simultaneous_posts_land_exactly_one_review(self):
        """Both threads used to pass the marker check before either wrote it, and GitHub got two
        full reviews from the same person on the same PR."""
        barrier = threading.Barrier(2, timeout=10)
        calls = self.fake_github(on_post=lambda: time.sleep(0.15))
        outs = []

        def run():
            h = self.handler()
            barrier.wait()
            outs.append(h._post_result(REPO, PR, USER, self.form()))

        ts = [threading.Thread(target=run) for _ in range(2)]
        for t in ts:
            t.start()
        for t in ts:
            t.join(timeout=20)
        self.assertEqual(len(calls), 1, "exactly one review may reach GitHub")
        self.assertEqual(sum("already posted this review" in o for o in outs), 1)

    def test_approve_takes_the_same_lock_as_post(self):
        self.assertIs(self.srv.act_lock("post", REPO, PR, USER),
                      self.srv.act_lock("post", REPO, PR, USER))
        self.assertIsNot(self.srv.act_lock("post", REPO, PR, USER),
                         self.srv.act_lock("post", REPO, PR, "bob"))


# --- blocker 9: approving what you actually read, once -----------------------------------------
class ApproveStalenessAndIdempotency(PostCase):
    def setUp(self):
        super().setUp()
        # An LGTM review, so the "not LGTM — tick to approve anyway" gate is not what is
        # being measured here.
        self.write_review({"event": "COMMENT", "summary": "Fine.",
                           "comments": [{"severity": "nit", "path": "a.py", "line": 1,
                                         "body": "name this"}]})
        self.fake_github()
        self.approvals = []

        class R:
            def __init__(self, rc=0, out="", err=""):
                self.returncode, self.stdout, self.stderr = rc, out, err

        self.pr_obj = {"state": "open", "draft": False, "merged": False,
                       "head": {"sha": HEAD_A}, "user": {"login": "bob"}}

        def gh(args, timeout=45, token=self.srv.SERVICE_TOKEN):
            a = list(args)
            if "event=APPROVE" in a:
                self.approvals.append(a)
                return R(0, "{}")
            if a[0] == "api" and "/pulls/" in a[1]:
                return R(0, json.dumps(self.pr_obj))
            return R(0, "{}")
        self.srv.gh = gh

    def approve(self, ack=False, reviewed_head=HEAD_A):
        form = {"pr": [PR], "ack": ["1"] if ack else [], "approve_body": ["LGTM."],
                "reviewed_head": [reviewed_head]}
        return self.handler()._approve_result(REPO, PR, USER, form)

    def test_approving_a_head_you_did_not_read_is_refused(self):
        """The reviewer is reading head A's "LGTM, no blockers"; GitHub is at head B."""
        self.pr_obj["head"]["sha"] = HEAD_B
        out = self.approve()
        self.assertIn("New commits have landed", out)
        self.assertEqual(self.approvals, [])

    def test_the_typed_confirmation_lets_it_through(self):
        self.pr_obj["head"]["sha"] = HEAD_B
        out = self.approve(ack=True)
        self.assertIn("Approved", out)
        self.assertEqual(len(self.approvals), 1)

    def test_a_second_click_does_not_post_a_second_approval(self):
        self.assertIn("Approved", self.approve(ack=True))
        out = self.approve(ack=True)
        self.assertIn("already approved this commit", out)
        self.assertEqual(len(self.approvals), 1)

    def test_a_new_commit_makes_approving_possible_again(self):
        self.approve(ack=True)
        self.pr_obj["head"]["sha"] = HEAD_B
        self.assertIn("Approved", self.approve(ack=True, reviewed_head=HEAD_B))
        self.assertEqual(len(self.approvals), 2)

    def test_the_stored_approval_records_the_commit(self):
        self.approve(ack=True)
        self.assertEqual(json.loads((self.d / "approved").read_text())["head"], HEAD_A)

    def test_same_head_still_approves_normally(self):
        out = self.approve()
        self.assertIn("Approved", out)
        self.assertEqual(len(self.approvals), 1)


if __name__ == "__main__":
    unittest.main()
