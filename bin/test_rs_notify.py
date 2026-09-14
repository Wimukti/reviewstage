"""Unit tests for notify.sh — the review_ready card reflects the VERDICT, not the review event.

    python3 -m unittest bin/test_rs_notify.py

Runs `notify.sh review_ready <json>` for real (bash + jq + curl) against a local Python HTTP
server standing in for Slack, Discord and a generic webhook at once — the three backends are
pointed at distinct paths on the same catcher so each POST can be told apart. Asserts the Slack
attachment colour, the Discord embed colour and the header line for each of the four verdicts,
and that the generic payload carries extra.verdict / blockers / should_fix. No network.
Skipped when bash, jq or curl is not installed.
"""
import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
NOTIFY = HERE / "notify.sh"
TOOLS = all(shutil.which(t) for t in ("bash", "jq", "curl"))

RED, AMBER, BLUE, GREEN = 15548997, 15774258, 3447003, 5763719
BRAND, GREY = 5793266, 9807270
HEX = {RED: "#ed4245", AMBER: "#f0b232", BLUE: "#3498db", GREEN: "#57f287",
       BRAND: "#5865f2", GREY: "#95a5a6"}


class _Catcher(BaseHTTPRequestHandler):
    """Records every POST as (path, headers, parsed body)."""
    hits = []
    lock = threading.Lock()

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        try:
            body = json.loads(raw.decode("utf-8"))
        except ValueError:
            body = raw.decode("utf-8", "replace")
        with self.lock:
            self.hits.append((self.path, dict(self.headers), body))
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a):  # keep the test output quiet
        pass


@unittest.skipUnless(TOOLS, "bash, jq and curl are required")
class NotifyCardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), _Catcher)
        cls.port = cls.srv.server_address[1]
        cls.thread = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.thread.start()
        cls.root = tempfile.mkdtemp(prefix="rs-notify-test-")
        base = f"http://127.0.0.1:{cls.port}"
        Path(cls.root, ".env").write_text(
            "REPOS=acme/widgets\nREVIEWER=acme-dev\nPUBLIC_URL=https://reviews.example.com\n"
            f"SLACK_WEBHOOK={base}/slack\nDISCORD_WEBHOOK={base}/discord\n"
            f"WEBHOOK_URL={base}/generic\nWEBHOOK_SECRET=unit-secret\n")

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        shutil.rmtree(cls.root, ignore_errors=True)

    def setUp(self):
        with _Catcher.lock:
            _Catcher.hits.clear()

    # --- helpers --------------------------------------------------------------------------------
    def notify(self, kind, extra, **top):
        payload = {"repo": "acme/widgets", "pr": "42", "title": "Add a badge", "author": "teammate",
                   "url": "https://github.com/acme/widgets/pull/42", "login": "acme-dev",
                   "slack_id": "", "discord_id": "", "extra": extra}
        payload.update(top)
        env = {k: v for k, v in os.environ.items()
               if k not in ("SLACK_BOT_TOKEN", "SLACK_CHANNEL", "NOTIFY_BACKENDS")}
        env["ROOT"] = self.root
        env["HOME"] = self.root
        r = subprocess.run(["bash", str(NOTIFY), kind, json.dumps(payload)], env=env,
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("WARN", r.stderr, r.stderr)
        with _Catcher.lock:
            hits = list(_Catcher.hits)
        by = {}
        for path, headers, body in hits:
            by[path.strip("/")] = (headers, body)
        self.assertEqual(set(by), {"slack", "discord", "generic"}, f"backends hit: {sorted(by)}")
        return by

    @staticmethod
    def slack_text(body):
        att = body["attachments"][0]
        return att["color"], "\n".join(
            b["text"]["text"] for b in att["blocks"] if b.get("type") == "section")

    @staticmethod
    def discord(body):
        emb = body["embeds"][0]
        return emb["color"], emb["description"]

    def assert_verdict(self, extra, colour, label, header, verdict):
        by = self.notify("review_ready", extra)
        s_colour, s_text = self.slack_text(by["slack"][1])
        d_colour, d_text = self.discord(by["discord"][1])
        self.assertEqual(s_colour, HEX[colour])
        self.assertEqual(d_colour, colour)
        for text in (s_text, d_text):
            self.assertIn(header, text)
            self.assertIn(label, text)
            self.assertNotIn("COMMENT", text)
            self.assertNotIn("REQUEST_CHANGES", text)
            self.assertNotIn("finding(s)", text)
            self.assertNotIn("blocker(s)", text)
        g_headers, g_body = by["generic"]
        self.assertEqual(g_headers.get("X-ReviewStage-Event"), "review_ready")
        self.assertTrue(g_headers.get("X-ReviewStage-Signature", "").startswith("sha256="))
        self.assertEqual(g_body["kind"], "review_ready")
        self.assertEqual(g_body["extra"]["verdict"], verdict)
        self.assertEqual(g_body["extra"]["blockers"], extra.get("blockers", 0))
        self.assertEqual(g_body["extra"]["should_fix"], extra.get("should_fix", 0))
        self.assertEqual(g_body["extra"]["findings"], extra.get("findings", 0))
        # The event stays in the machine payload even though no card shows it.
        self.assertEqual(g_body["extra"].get("event"), extra.get("event"))
        return g_body

    # --- the live bug: 3 findings, 1 blocker, event COMMENT rendered green -----------------------
    def test_blocked_is_red_regardless_of_comment_event(self):
        self.assert_verdict({"event": "COMMENT", "findings": 3, "blockers": 1, "should_fix": 1,
                             "summary": "Two nits and one real problem."},
                            RED, "Not LGTM — 1 blocker", "🔴 Not LGTM — 1 blocker · 3 findings",
                            "blocked")

    def test_blocked_plural(self):
        self.assert_verdict({"event": "COMMENT", "findings": 2, "blockers": 2},
                            RED, "Not LGTM — 2 blockers", "🔴 Not LGTM — 2 blockers · 2 findings",
                            "blocked")

    def test_request_changes_without_blockers_is_still_blocked(self):
        self.assert_verdict({"event": "REQUEST_CHANGES", "findings": 1, "blockers": 0},
                            RED, "Not LGTM — changes requested",
                            "🔴 Not LGTM — changes requested · 1 finding", "blocked")

    def test_attention_is_amber(self):
        self.assert_verdict({"event": "COMMENT", "findings": 2, "blockers": 0, "should_fix": 2},
                            AMBER, "Needs attention — 2 to fix",
                            "🟡 Needs attention — 2 to fix · 2 findings", "attention")

    def test_minor_is_blue_and_singular(self):
        self.assert_verdict({"event": "COMMENT", "findings": 1, "blockers": 0, "should_fix": 0},
                            BLUE, "Minor notes — 1", "🔵 Minor notes — 1 · 1 finding", "minor")

    def test_lgtm_is_green(self):
        self.assert_verdict({"event": "COMMENT", "findings": 0, "blockers": 0, "should_fix": 0},
                            GREEN, "LGTM — nothing to fix", "🟢 LGTM — nothing to fix · 0 findings",
                            "lgtm")

    def test_older_caller_without_should_fix_still_gets_a_verdict(self):
        # run-review.sh before this change sent only event/findings/blockers.
        body = self.assert_verdict({"event": "COMMENT", "findings": 2, "blockers": 0},
                                   BLUE, "Minor notes — 2", "🔵 Minor notes — 2 · 2 findings",
                                   "minor")
        self.assertEqual(body["extra"]["should_fix"], 0)

    # --- the other kinds keep their neutral / status colours -------------------------------------
    def test_review_requested_is_brand_coloured(self):
        by = self.notify("review_requested", {"additions": 10, "deletions": 2, "files": 3})
        self.assertEqual(self.slack_text(by["slack"][1])[0], HEX[BRAND])
        self.assertEqual(self.discord(by["discord"][1])[0], BRAND)
        self.assertNotIn("verdict", by["generic"][1]["extra"])

    def test_qa_ready_is_brand_coloured(self):
        by = self.notify("qa_ready", {"detail": "https://reviews.example.com/qa"})
        self.assertEqual(self.slack_text(by["slack"][1])[0], HEX[BRAND])
        self.assertEqual(self.discord(by["discord"][1])[0], BRAND)

    def test_review_stopped_failed_is_red(self):
        by = self.notify("review_stopped", {"status": "failed", "message": "agent died"})
        self.assertEqual(self.slack_text(by["slack"][1])[0], HEX[RED])
        self.assertEqual(self.discord(by["discord"][1])[0], RED)

    def test_review_stopped_by_hand_is_grey(self):
        by = self.notify("review_stopped", {"status": "stopped", "job": "Review", "confirmed": True,
                                            "runner": "shared", "text": "🛑 stopped"})
        self.assertEqual(self.slack_text(by["slack"][1])[0], HEX[GREY])
        self.assertEqual(self.discord(by["discord"][1])[0], GREY)


if __name__ == "__main__":
    unittest.main()
