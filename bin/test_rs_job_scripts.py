"""The job scripts run end to end against fakes: bin/run-review.sh and bin/run-qa.sh with a
`claude` and a `gh` shim on PATH, a real local git "origin", and a scratch ROOT.

What these prove, in order of importance:

  1. The review agent has NO GitHub write path. The fake agent does exactly what a malicious PR
     description would talk a real one into — `gh pr review <n> --approve` — and the shim, which
     refuses unauthenticated the way real gh does, records that it could not. The agent's own
     environment is captured and asserted to hold no GitHub credential (and no Slack token, and
     no HMAC secret), while still holding the reviewer's Claude token, which the CLI can only
     take from the environment.
  2. The tripwire fires. If something DOES post to the PR during a run, the before/after
     fingerprint the script takes with the service token turns the run into a loud failure.
  3. A truncated QA guide is a failure, not a deliverable — a `timeout`-killed agent and a
     half-written qa.md both fail, and neither is copied out.

    python3 -m unittest discover -s bin -p 'test_*.py'
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
REPO = "acme/widgets"
SLUG = "acme__widgets"
PR = "7"

# A gh that behaves like the real one about credentials: with no token in the environment and no
# hosts.yml under GH_CONFIG_DIR it refuses everything, and logs the refusal. Every call is logged
# either way, so a test can assert what the agent tried.
FAKE_GH = r'''#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SHIM_DIR/gh.log"
if [ -z "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ] && [ ! -f "${GH_CONFIG_DIR:-$HOME/.config/gh}/hosts.yml" ]; then
  printf 'REFUSED %s\n' "$*" >> "$SHIM_DIR/gh-refused.log"
  echo "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable." >&2
  exit 4
fi
case "$*" in
  *"api graphql"*)   cat "$SHIM_DIR/ghcounts" ;;
  *"--json comments,reviews"*) echo '{"comments":[],"reviews":[]}' ;;
  *"api repos/"*)    echo '[]' ;;
  *"pr view"*)       cat "$SHIM_DIR/prmeta.json" ;;
  *"pr review"*)     # a real post: bump the fingerprint the script compares
                     echo "1:0:0" > "$SHIM_DIR/ghcounts"; echo "approved" ;;
  *)                 echo "{}" ;;
esac
'''

# The agent: records its argv, its stdin and its whole environment, tries to approve the PR the
# way a prompt-injected agent would, then produces whatever the test asked for.
FAKE_CLAUDE = r'''#!/usr/bin/env bash
printf '%s\n' "$@" > "$SHIM_DIR/argv"
cat > "$SHIM_DIR/stdin"
env > "$SHIM_DIR/agent-env"
if gh pr review 7 --repo acme/widgets --approve >"$SHIM_DIR/approve.out" 2>&1; then
  echo "APPROVED" > "$SHIM_DIR/approve.result"
else
  echo "refused rc=$?" > "$SHIM_DIR/approve.result"
fi
. "$SHIM_DIR/behaviour.sh"
'''

GOOD_REVIEW = {"event": "COMMENT", "summary": "Looks fine.", "keyPoints": [], "explainer": "",
               "analysis": "", "comments": [{"path": "a.py", "line": 1, "severity": "nit",
                                             "title": "t", "impact": "i", "body": "b"}]}

QA_GUIDE = """# Thing — QA guide
PR link.
## Before you start
- a flag
## Surface matrix
| Surface | Shows it? | Detail |
| --- | --- | --- |
| Web | Yes | - |
## P0 — Test these first
- [ ] 1. It does not double charge
## P1 — Does the feature work
- [ ] 2. It works
## P2 — Check nothing else broke
- [ ] 3. Nothing else moved
## Known — please don't file these
- nothing
## Escalate immediately
Guide last checked against branch head abc1234
<!-- rs:end -->
"""


def _exe(path, body):
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _git(cwd, *args, env=None):
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t", **(env or {})})


@unittest.skipUnless(shutil.which("jq") and shutil.which("git"), "needs jq and git")
class JobScriptCase(unittest.TestCase):
    """A scratch install: ROOT with .env, an origin repo, a base clone, and shims on PATH."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tmp = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.root = tmp / "root"
        self.shim = tmp / "shim"
        self.shim.mkdir(parents=True)
        (self.root).mkdir(parents=True)

        origin = tmp / "origin"
        origin.mkdir()
        _git(origin, "init", "-q", "-b", "main")
        (origin / "a.py").write_text("print(1)\n")
        _git(origin, "add", "-A")
        _git(origin, "commit", "-q", "-m", "base")
        _git(origin, "checkout", "-q", "-b", "feature")
        (origin / "a.py").write_text("print(2)\n")
        _git(origin, "commit", "-qam", "change")
        self.head = subprocess.run(["git", "-C", str(origin), "rev-parse", "HEAD"],
                                   capture_output=True, text=True, check=True).stdout.strip()

        self.base = self.root / "repos" / SLUG
        self.base.parent.mkdir(parents=True)
        subprocess.run(["git", "clone", "-q", str(origin), str(self.base)],
                       check=True, capture_output=True)

        (self.shim / "prmeta.json").write_text(json.dumps({
            "headRefName": "feature", "headRefOid": self.head, "baseRefName": "main",
            "title": "A change", "url": f"https://github.com/{REPO}/pull/{PR}",
            "author": {"login": "someone"}, "body": "the description",
            "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-02T00:00:00Z",
            "additions": 10, "deletions": 2, "changedFiles": 1,
            "files": [{"path": "a.py"}], "isDraft": False, "state": "OPEN"}))
        (self.shim / "ghcounts").write_text("0:0:0")
        _exe(self.shim / "gh", FAKE_GH)
        _exe(self.shim / "claude", FAKE_CLAUDE)
        if not shutil.which("flock"):
            _exe(self.shim / "flock", "#!/bin/sh\nexit 0\n")
        if not shutil.which("timeout"):
            _exe(self.shim / "timeout", '#!/bin/sh\nshift\nexec "$@"\n')

        (self.root / ".env").write_text(
            "RS_SECRET=test-secret\nREVIEWER=acme-dev\nREPOS=acme/widgets\n"
            "GITHUB_PAT=ghp_service_token\nPUBLIC_URL=https://rs.example.com\n"
            "SLACK_BOT_TOKEN=xoxb-should-never-reach-the-agent\nNOTIFY_BACKENDS=none\n")
        (self.root / "users.json").write_text('{"acme-dev": {"name": "Acme Dev"}}')

    def behave(self, script):
        """What the fake agent does after its approval attempt."""
        (self.shim / "behaviour.sh").write_text(script)

    def write_review(self, obj):
        self.behave('cat > review.json <<\'EOF\'\n%s\nEOF\n'
                    'printf \'{"type":"system","subtype":"init","model":"fake"}\\n\'\n'
                    'printf \'{"type":"result","usage":{"input_tokens":1,"output_tokens":1},'
                    '"total_cost_usd":0.01,"duration_ms":5}\\n\'\n' % json.dumps(obj))

    def run_job(self, script, *args, env=None):
        e = {**os.environ, "ROOT": str(self.root), "SHIM_DIR": str(self.shim),
             "PATH": f"{self.shim}:{os.environ.get('PATH', '')}",
             "HOME": str(self.root),
             "CLAUDE_CODE_OAUTH_TOKEN": "claude-oauth-of-the-clicker",
             "RS_ACTOR": "acme-dev", "MIN_FREE_MB": "0", "MIN_FREE_DISK_MB": "0",
             **(env or {})}
        return subprocess.run([str(HERE / script), REPO, PR, *args],
                              capture_output=True, text=True, env=e, timeout=300)

    # --- helpers -------------------------------------------------------------------------
    @property
    def udir(self):
        return self.root / "state" / SLUG / PR / "users" / "acme-dev"

    @property
    def prdir(self):
        return self.root / "state" / SLUG / PR

    def agent_env(self):
        out = {}
        for line in (self.shim / "agent-env").read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                out.setdefault(k, v)
        return out

    def worktrees(self):
        r = subprocess.run(["git", "-C", str(self.base), "worktree", "list"],
                           capture_output=True, text=True)
        return [ln for ln in r.stdout.splitlines() if "/wt/" in ln]

    def branches(self):
        r = subprocess.run(["git", "-C", str(self.base), "branch", "--list"],
                           capture_output=True, text=True)
        return [ln.strip("* ").strip() for ln in r.stdout.splitlines()]


class ReviewAgentHasNoGitHubWritePath(JobScriptCase):
    def test_the_agent_cannot_approve_the_pr_and_holds_no_github_credential(self):
        self.write_review(GOOD_REVIEW)
        r = self.run_job("run-review.sh")
        status = (self.udir / "status").read_text().strip()
        self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}\nstatus={status}")
        self.assertEqual(status, "done (1 findings)")

        # 1. The approval attempt happened and was refused.
        self.assertEqual((self.shim / "approve.result").read_text().strip(), "refused rc=4")
        refused = (self.shim / "gh-refused.log").read_text()
        self.assertIn("pr review 7 --repo acme/widgets --approve", refused)

        # 2. Nothing GitHub-shaped, and no other secret, survived into the agent's environment.
        env = self.agent_env()
        for gone in ("GH_TOKEN", "GITHUB_TOKEN", "GITHUB_PAT", "RS_SECRET", "SLACK_BOT_TOKEN",
                     "GH_CLIENT_SECRET", "WEBHOOK_SECRET"):
            self.assertNotIn(gone, env, f"{gone} reached the agent")
        # GH_CONFIG_DIR points somewhere with no stored login.
        self.assertFalse(Path(env["GH_CONFIG_DIR"], "hosts.yml").exists())
        # …but the Claude token does survive: the CLI takes it only from the environment.
        self.assertEqual(env.get("CLAUDE_CODE_OAUTH_TOKEN"), "claude-oauth-of-the-clicker")

        # 3. The tool list is constrained.
        argv = (self.shim / "argv").read_text()
        self.assertIn("--disallowedTools", argv)
        self.assertIn("Bash(gh:*)", argv)
        self.assertIn("WebFetch", argv)

        # 4. No review landed: the script's own before/after fingerprint is unchanged.
        self.assertFalse((self.udir / "security-violation").exists())

    def test_a_review_created_during_the_run_fails_the_job_loudly(self):
        # The fake agent reaches gh with a token (simulating any bypass of the scrub) and posts.
        self.behave(
            'GH_TOKEN=ghp_leaked gh pr review 7 --repo acme/widgets --approve >/dev/null 2>&1\n'
            'cat > review.json <<\'EOF\'\n%s\nEOF\n' % json.dumps(GOOD_REVIEW))
        r = self.run_job("run-review.sh")
        status = (self.udir / "status").read_text().strip()
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertTrue(status.startswith("failed: SECURITY:"), status)
        self.assertIn("0:0:0 -> 1:0:0", status)
        self.assertTrue((self.udir / "security-violation").exists())
        self.assertFalse((self.udir / "review.json").exists())


class ReviewResultHandling(JobScriptCase):
    def test_meta_json_keeps_the_head_sha(self):
        self.write_review(GOOD_REVIEW)
        self.assertEqual(self.run_job("run-review.sh").returncode, 0)
        meta = json.loads((self.prdir / "meta.json").read_text())
        self.assertEqual(meta["head"], self.head)
        self.assertIs(meta["isDraft"], False)
        self.assertEqual(meta["state"], "OPEN")
        self.assertIs(meta["merged"], False)
        self.assertEqual((self.udir / "head").read_text().strip(), self.head)

    def test_a_json_array_is_not_accepted_as_a_review(self):
        self.write_review([{"path": "a.py"}])
        r = self.run_job("run-review.sh")
        self.assertEqual(r.returncode, 1)
        self.assertIn("comments array", (self.udir / "status").read_text())
        self.assertFalse((self.udir / "review.json").exists())

    def test_findings_are_normalised_after_the_shape_check_and_warnings_reach_the_log(self):
        self.write_review({**GOOD_REVIEW, "comments": [
            {"path": "a.py", "line": 1, "severity": "major", "body": "x",
             "why_it_matters": "Users wait.", "how_to_verify": "Run it.\nThen look."},
            {"path": "a.py", "line": 1, "severity": "nit", "body": "y",
             "how_to_verify": "Run pytest -k a.", "confidence": "high"}]})
        r = self.run_job("run-review.sh")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        got = json.loads((self.udir / "review.json").read_text())["comments"]
        self.assertEqual(got[0]["severity"], "nit")
        self.assertEqual(got[0]["impact"], "Users wait.")
        self.assertIsNone(got[0]["how_to_verify"])
        self.assertIsNone(got[0]["confidence"])
        self.assertEqual(got[1]["how_to_verify"], "Run pytest -k a.")
        self.assertEqual(got[1]["confidence"], "high")
        log = (self.udir / "agent.log").read_text()
        self.assertIn("[review-schema] finding 0: severity 'major'", log)
        self.assertIn("[review-schema] finding 0: how_to_verify is not a single line", log)
        self.assertNotIn("finding 1", log)

    def test_plain_language_warnings_reach_the_log_with_their_marker(self):
        # trust-and-plain §1.1: a hedge is a `plain:` warning in agent.log (what the
        # plain_warnings counter is grepped from); the finding itself is kept.
        self.write_review({**GOOD_REVIEW, "comments": [
            {"path": "a.py", "line": 1, "severity": "nit", "body": "x",
             "title": "The loop might possibly never stop"}]})
        r = self.run_job("run-review.sh")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        got = json.loads((self.udir / "review.json").read_text())["comments"]
        self.assertEqual(got[0]["title"], "The loop might possibly never stop")
        self.assertEqual(got[0]["where"], {"path": "a.py", "start": 1, "end": 1})
        log = (self.udir / "agent.log").read_text()
        self.assertIn("[review-schema] finding 0: title: plain: hedge 'might possibly'", log)

    def test_invalid_utf8_from_the_agent_is_re_encoded(self):
        self.behave("printf '{\"summary\":\"bad \\xe2\\x28 byte\",\"comments\":[]}' > review.json\n")
        r = self.run_job("run-review.sh")
        self.assertEqual(r.returncode, 0, r.stdout)
        raw = (self.udir / "review.json").read_bytes()
        raw.decode("utf-8")                       # would raise before the re-encode
        self.assertIn("�", raw.decode("utf-8"))

    def test_a_failed_run_leaves_no_worktree_and_no_branch(self):
        self.behave("true\n")                     # no review.json at all
        r = self.run_job("run-review.sh")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no review.json", (self.udir / "status").read_text())
        self.assertEqual(self.worktrees(), [])
        self.assertNotIn(f"review-{PR}-acme-dev", self.branches())

    def test_a_repo_this_install_does_not_review_is_reported_on_the_page(self):
        e = {**os.environ, "ROOT": str(self.root), "SHIM_DIR": str(self.shim),
             "PATH": f"{self.shim}:{os.environ.get('PATH', '')}", "HOME": str(self.root),
             "CLAUDE_CODE_OAUTH_TOKEN": "x", "RS_ACTOR": "acme-dev"}
        r = subprocess.run([str(HERE / "run-review.sh"), "evil/corp", PR],
                           capture_output=True, text=True, env=e, timeout=120)
        self.assertEqual(r.returncode, 1)
        status = (self.root / "state" / "evil__corp" / PR / "users" / "acme-dev" / "status")
        self.assertTrue(status.exists(), r.stderr)
        self.assertIn("not a repository this install reviews", status.read_text())


class QaGuide(JobScriptCase):
    def write_guide(self, text):
        self.behave("cat > qa.md <<'EOF'\n%s\nEOF\n" % text)

    def test_the_skill_body_and_the_evidence_reach_the_agent(self):
        self.write_guide(QA_GUIDE)
        r = self.run_job("run-qa.sh")
        self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}")
        self.assertEqual((self.prdir / "qa.status").read_text().strip(), "done")
        self.assertIn("<!-- rs:end -->", (self.prdir / "qa.md").read_text())

        prompt = (self.shim / "stdin").read_text()
        skill = (HERE.parent / "skills" / "pr-qa-guide" / "SKILL.md").read_text()
        # A distinctive sentence from the skill body is present verbatim — the skill is inlined,
        # not merely named. And its front matter is not.
        marker = "Order them by **where a defect hurts most"
        self.assertIn(marker, skill)
        self.assertIn(marker, prompt)
        self.assertNotIn("name: pr-qa-guide", prompt)
        self.assertIn(".rs-pr-context.md", prompt)
        self.assertNotIn("Use the pr-qa-guide skill", prompt)

        # The agent's log is its own file; server.py owns qa.log.
        self.assertTrue((self.prdir / "qa_agent.log").exists())
        argv = (self.shim / "argv").read_text()
        self.assertNotIn("Skill", argv)
        self.assertIn("--disallowedTools", argv)

    def test_the_evidence_file_carries_the_history_the_agent_cannot_fetch(self):
        self.write_guide(QA_GUIDE)
        self.behave((self.shim / "behaviour.sh").read_text()
                    + "cp .rs-pr-context.md \"$SHIM_DIR/ctx.md\"\n")
        self.assertEqual(self.run_job("run-qa.sh").returncode, 0)
        ctx = (self.shim / "ctx.md").read_text()
        self.assertIn("the description", ctx)              # the PR body
        self.assertIn("## Review conversation", ctx)
        self.assertIn("## Inline review threads", ctx)
        self.assertIn("change", ctx)                       # the branch's commit subject

    def test_a_timed_out_guide_is_a_distinct_failure_and_is_not_published(self):
        self.behave("printf '# Half a guide\\n## P0 — Test these first\\n- [ ] 1. thing' > qa.md\n"
                    "exit 124\n")
        r = self.run_job("run-qa.sh")
        self.assertEqual(r.returncode, 1)
        status = (self.prdir / "qa.status").read_text().strip()
        self.assertIn("timed out", status)
        self.assertFalse((self.prdir / "qa.md").exists())

    def test_a_truncated_guide_is_rejected(self):
        self.write_guide("# Guide\n## P0 — Test these first\n- [ ] 1. thing\n\nand then it stop")
        r = self.run_job("run-qa.sh")
        self.assertEqual(r.returncode, 1)
        status = (self.prdir / "qa.status").read_text().strip()
        self.assertIn("incomplete", status)
        self.assertIn("end-of-guide marker", status)
        self.assertFalse((self.prdir / "qa.md").exists())
        self.assertEqual(self.worktrees(), [])
        self.assertNotIn(f"qa-{PR}", self.branches())

    def test_the_timeout_is_sized_from_the_diff_not_hardcoded(self):
        def budget(changed, adds):
            meta = json.loads((self.shim / "prmeta.json").read_text())
            meta["changedFiles"], meta["additions"] = changed, adds
            (self.shim / "prmeta.json").write_text(json.dumps(meta))
            self.write_guide(QA_GUIDE)
            r = self.run_job("run-qa.sh")
            self.assertEqual(r.returncode, 0, r.stdout)
            return r.stdout.strip().splitlines()[-1]
        self.assertIn("25m budget", budget(2, 40))
        self.assertIn("40m budget", budget(20, 900))
        self.assertIn("60m budget", budget(300, 9000))



BLOCKER_REVIEW = {"event": "COMMENT", "summary": "One blocker.", "keyPoints": [],
                  "explainer": "", "analysis": "", "comments": [
                      {"path": "a.py", "line": 1, "severity": "blocker", "confidence": "high",
                       "title": "`print` runs twice", "impact": "i",
                       "what_to_check": "Open a.py line 1. Check `print`.",
                       "expected": "once", "actual": "twice", "body": "b"},
                      {"path": "a.py", "line": 1, "severity": "nit", "title": "t",
                       "impact": "i", "body": "n"}]}


class DisproofPass(JobScriptCase):
    """run-review.sh runs bin/run-disproof.sh after the main pass (trust-and-plain §2.1): a
    second agent call on the same account through the same stripped environment, whose
    verdicts land in review.json and whose GitHub write path is fingerprinted like the first."""

    def behave_twice(self, disproof):
        """The fake agent: the main pass writes the review; the disproof pass (its stdin carries
        the FILES THEY CITE block) writes the answer and records its own environment."""
        script = (
            'if grep -q "FILES THEY CITE" "$SHIM_DIR/stdin"; then\n'
            '  cp "$SHIM_DIR/stdin" "$SHIM_DIR/disproof-stdin"\n'
            '  env > "$SHIM_DIR/disproof-env"\n'
            '  printf \'%s\\n\' "$@" > "$SHIM_DIR/disproof-argv"\n'
            '  cp "$SHIM_DIR/approve.result" "$SHIM_DIR/disproof-approve"\n'
            '  cat > disproof.json <<\'EOF\'\n@DISPROOF@\nEOF\n'
            'else\n'
            '  cat > review.json <<\'EOF\'\n@REVIEW@\nEOF\n'
            '  printf \'{"type":"system","subtype":"init","model":"fake"}\\n\'\n'
            '  printf \'{"type":"result","usage":{"input_tokens":1,"output_tokens":1},'
            '"total_cost_usd":0.01,"duration_ms":5}\\n\'\n'
            'fi\n')
        self.behave(script.replace("@DISPROOF@", json.dumps(disproof))
                    .replace("@REVIEW@", json.dumps(BLOCKER_REVIEW)))

    def test_the_verdict_lands_in_review_json_and_the_pass_has_no_github_credential(self):
        self.behave_twice({"results": [{"id": 0, "verdict": "weakened",
                                        "reason": "Only the first call prints twice."}]})
        r = self.run_job("run-review.sh")
        self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}")
        self.assertEqual((self.udir / "status").read_text().strip(), "done (2 findings)")
        self.assertIn("disproof: checking 1 finding(s) (default mode", r.stdout)
        self.assertIn("stands=0 weakened=1 refuted=0 failed=0", r.stdout)
        rev = json.loads((self.udir / "review.json").read_text())
        self.assertEqual(rev["comments"][0]["checked"]["verdict"], "weakened")
        self.assertEqual(rev["comments"][0]["checked"]["reason"],
                         "Only the first call prints twice.")
        self.assertIsNone(rev["comments"][1]["checked"])      # a nit: not in the default pass
        self.assertEqual((rev["disproof"]["status"], rev["disproof"]["n"],
                          rev["disproof"]["checked"], rev["disproof"]["mode"]),
                         ("done", 1, 1, "default"))
        # The brief carried the plain rows, the skill, and never the GitHub body.
        stdin = (self.shim / "disproof-stdin").read_text()
        self.assertIn("You are the second reviewer", stdin)
        self.assertIn("what to check: Open a.py line 1. Check `print`.", stdin)
        self.assertIn("severity: breaks", stdin)
        self.assertNotIn('"b"', stdin)
        # The same stripped environment, the same deny list, the same refused approval.
        env = {}
        for line in (self.shim / "disproof-env").read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k, v)
        for gone in ("GH_TOKEN", "GITHUB_TOKEN", "GITHUB_PAT", "RS_SECRET", "SLACK_BOT_TOKEN"):
            self.assertNotIn(gone, env, f"{gone} reached the disproof agent")
        self.assertEqual(env.get("CLAUDE_CODE_OAUTH_TOKEN"), "claude-oauth-of-the-clicker")
        argv = (self.shim / "disproof-argv").read_text()
        self.assertIn("Bash(gh:*)", argv)
        self.assertEqual((self.shim / "disproof-approve").read_text().strip(), "refused rc=4")
        self.assertFalse((self.udir / "security-violation").exists())
        # The counter: one weakened verdict, nothing else about it.
        counters = json.loads((self.root / "telemetry" / "counters.json").read_text())
        day = next(iter(counters["days"].values()))
        self.assertEqual(day.get("disproof_run|verdict=weakened"), 1)
        self.assertNotIn("disproof_run|verdict=stands", day)
        # The cached artefact carries the verdict too, so a reuse shows it.
        self.assertTrue((self.udir / "disproof.log").exists())

    def test_check_all_findings_covers_the_nit_too(self):
        self.behave_twice({"results": [{"id": 0, "verdict": "stands", "reason": "r0"},
                                       {"id": 1, "verdict": "refuted", "reason": "r1"}]})
        r = self.run_job("run-review.sh", env={"RS_DISPROOF": "all"})
        self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}")
        rev = json.loads((self.udir / "review.json").read_text())
        self.assertEqual([c["checked"]["verdict"] for c in rev["comments"]],
                         ["stands", "refuted"])
        self.assertEqual(rev["disproof"]["mode"], "all")
        self.assertIn("id: 1", (self.shim / "disproof-stdin").read_text())

    def test_off_skips_the_pass_and_the_review_is_unchanged(self):
        self.behave_twice({"results": []})
        r = self.run_job("run-review.sh", env={"RS_DISPROOF": "off"})
        self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}")
        self.assertFalse((self.shim / "disproof-stdin").exists())
        rev = json.loads((self.udir / "review.json").read_text())
        self.assertIsNone(rev["comments"][0]["checked"])       # the normaliser's null, no verdict
        self.assertIsNone(rev.get("disproof"))

    def test_a_plan_limit_is_said_in_the_status_not_a_generic_failure(self):
        self.behave('echo \'{"type":"rate_limit_event","rate_limit_info":{"status":"rejected",'
                    '"errorCode":"credits_required","resetsAt":1793491200}}\'; exit 1')
        r = self.run_job("run-review.sh", "acme/widgets", "7")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        status = (self.udir / "status").read_text()
        self.assertIn("your Claude plan has reached its usage limit (credits_required)", status)
        self.assertIn("It resets at", status)
        self.assertNotIn("produced no review.json", status)

    def test_a_bad_answer_never_fails_the_review(self):
        self.behave(
            'if grep -q "FILES THEY CITE" "$SHIM_DIR/stdin"; then\n'
            '  echo "I refuse" > disproof.json\n'
            'else\n'
            '  cat > review.json <<\'EOF\'\n%s\nEOF\n'
            'fi\n' % json.dumps(BLOCKER_REVIEW))
        r = self.run_job("run-review.sh")
        self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}")
        self.assertEqual((self.udir / "status").read_text().strip(), "done (2 findings)")
        rev = json.loads((self.udir / "review.json").read_text())
        self.assertIsNone(rev["comments"][0]["checked"])
        self.assertEqual(rev["disproof"]["status"], "failed")
        self.assertIn("stands=0 weakened=0 refuted=0 failed=1", r.stdout)

    def test_a_write_during_the_second_pass_is_a_security_failure(self):
        # The disproof agent somehow posts (the fake gh bumps the fingerprint on `pr review`
        # when it is authenticated — here we hand it a token through the answer step).
        self.behave(
            'if grep -q "FILES THEY CITE" "$SHIM_DIR/stdin"; then\n'
            '  echo "1:0:0" > "$SHIM_DIR/ghcounts"\n'
            '  echo \'{"results":[{"id":0,"verdict":"stands","reason":"r"}]}\' > disproof.json\n'
            'else\n'
            '  cat > review.json <<\'EOF\'\n%s\nEOF\n'
            'fi\n' % json.dumps(BLOCKER_REVIEW))
        r = self.run_job("run-review.sh")
        self.assertEqual(r.returncode, 1)
        status = (self.udir / "status").read_text()
        self.assertIn("SECURITY: the disproof pass created a review or comment", status)
        self.assertIn("(disproof pass)", (self.udir / "security-violation").read_text())

if __name__ == "__main__":
    unittest.main()
