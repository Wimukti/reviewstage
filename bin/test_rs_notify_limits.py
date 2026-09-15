"""notify.sh against a fake `curl`: what reaches the process table, what reaches the wire, and
the platform limits a card used to be silently rejected for.

  - the Slack bot token is passed on stdin (`-H @-`), never in argv, where `ps` would show it;
  - every curl in the file has a connect and a total timeout, because pr-watch.sh calls
    notify_card synchronously inside the poller's flock — one blackholed endpoint used to wedge
    PR discovery permanently;
  - a long PR title is truncated to Discord's 256-character embed-title limit instead of the
    whole card coming back 400;
  - a review with no summary emits no empty Slack mrkdwn section, which Slack rejects outright.

    python3 -m unittest discover -s bin -p 'test_*.py'
"""
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
NOTIFY = HERE / "notify.sh"

# Records argv and stdin, answers both call shapes used in the file: the Slack API reply, and the
# bare HTTP status the Discord/generic backends read from -w '%{http_code}'.
FAKE_CURL = r'''#!/usr/bin/env bash
n=$(ls "$SHIM_DIR"/call.* 2>/dev/null | wc -l | tr -d ' ')
printf '%s\n' "$@" > "$SHIM_DIR/call.$n.argv"
cat > "$SHIM_DIR/call.$n.stdin"
case "$*" in
  *chat.postMessage*) echo '{"ok":true,"ts":"1700000000.1"}' ;;
  *) echo "200" ;;
esac
'''


def _exe(path, body):
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


@unittest.skipUnless(shutil.which("jq"), "needs jq")
class NotifyCurl(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        tmp = Path(self.tmp.name)
        self.root = tmp / "root"
        self.shim = tmp / "shim"
        self.root.mkdir()
        self.shim.mkdir()
        _exe(self.shim / "curl", FAKE_CURL)
        (self.root / ".env").write_text(
            "RS_SECRET=s\nREVIEWER=acme-dev\nREPOS=acme/widgets\n"
            "GITHUB_PAT=ghp_x\nPUBLIC_URL=https://rs.example.com\n")

    def notify(self, kind, payload, **env):
        e = {**os.environ, "ROOT": str(self.root), "SHIM_DIR": str(self.shim),
             "PATH": f"{self.shim}:{os.environ.get('PATH', '')}", "HOME": str(self.root), **env}
        r = subprocess.run([str(NOTIFY), kind, json.dumps(payload)],
                           capture_output=True, text=True, env=e, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def calls(self):
        out = []
        for argv in sorted(self.shim.glob("call.*.argv")):
            out.append((argv.read_text().splitlines(),
                        Path(str(argv).replace(".argv", ".stdin")).read_text()))
        return out

    # --- the process table -----------------------------------------------------------------
    def test_the_slack_bot_token_never_appears_in_argv(self):
        self.notify("qa_ready", {"repo": "acme/widgets", "pr": "7", "title": "T",
                                 "url": "https://u", "extra": {"detail": "https://d"}},
                    NOTIFY_BACKENDS="slack", SLACK_BOT_TOKEN="xoxb-secret-token",
                    SLACK_CHANNEL="C1")
        argv, stdin = self.calls()[0]
        self.assertNotIn("xoxb-secret-token", " ".join(argv))
        self.assertIn("xoxb-secret-token", stdin)
        self.assertIn("Authorization: Bearer", stdin)
        self.assertIn("-H", argv)
        self.assertIn("@-", argv)

    def test_every_curl_in_the_file_is_time_bounded(self):
        src = NOTIFY.read_text()
        # Each `curl` invocation, up to the end of its (possibly continued) command.
        for m in re.finditer(r"\bcurl\b.*?(?=\n\s*(?:[a-zA-Z_}]|$))", src, re.S):
            call = m.group(0)
            self.assertIn("--max-time", call, call)
            self.assertIn("--connect-timeout", call, call)

    # --- platform limits -------------------------------------------------------------------
    def test_a_long_title_is_truncated_for_discord(self):
        self.notify("review_ready",
                    {"repo": "acme/widgets", "pr": "7", "title": "T" * 400, "url": "https://u",
                     "extra": {"findings": 1, "summary": "S" * 5000, "detail": "https://d"}},
                    NOTIFY_BACKENDS="discord", DISCORD_WEBHOOK="https://discord.example/hook")
        _, body = self.calls()[0]
        embed = json.loads(body)["embeds"][0]
        self.assertLessEqual(len(embed["title"]), 256)
        self.assertLessEqual(len(embed["description"]), 4096)
        self.assertTrue(embed["title"].endswith("…"))

    def test_slack_omits_the_summary_block_when_there_is_no_summary(self):
        common = {"repo": "acme/widgets", "pr": "7", "title": "T", "url": "https://u"}
        self.notify("review_ready", {**common, "extra": {"findings": 0, "summary": ""}},
                    NOTIFY_BACKENDS="slack", SLACK_WEBHOOK="https://hooks.example/x")
        _, body = self.calls()[0]
        blocks = json.loads(body)["attachments"][0]["blocks"]
        for b in blocks:
            self.assertNotEqual((b.get("text") or {}).get("text", "x"), "",
                                "an empty mrkdwn section is rejected by Slack")
        self.assertEqual(sum(1 for b in blocks if b["type"] == "section"), 1)

        for f in self.shim.glob("call.*"):
            f.unlink()
        self.notify("review_ready", {**common, "extra": {"findings": 1, "summary": "the verdict"}},
                    NOTIFY_BACKENDS="slack", SLACK_WEBHOOK="https://hooks.example/x")
        _, body = self.calls()[0]
        blocks = json.loads(body)["attachments"][0]["blocks"]
        self.assertEqual(sum(1 for b in blocks if b["type"] == "section"), 2)
        self.assertIn("the verdict", json.dumps(blocks))


if __name__ == "__main__":
    unittest.main()
