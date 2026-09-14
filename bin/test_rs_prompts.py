"""How a skill file becomes a `claude -p` prompt — front-matter stripping (Python and the
shell helper), the assembled profile prompt, and a fake `claude` on PATH that records what
bin/profile-repo.sh actually hands the CLI: the prompt must arrive whole on stdin and never
as an argv element (`error: unknown option '---'` was a real failure).

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
sys.path.insert(0, str(HERE))
import rs_profile as PF  # noqa: E402

REPO_SKILL = HERE.parent / "skills" / "repo-profile" / "SKILL.md"
FM = "---\nname: demo\ndescription: a skill with front-matter\n---\n"
BODY = "You are reviewing.\n\n- keep it short\n---\nnot a delimiter mid-file\n"


def skill_body(path, root):
    """Run lib-common.sh's skill_body on `path` under a scratch ROOT."""
    r = subprocess.run(
        ["bash", "-c", f'. "{HERE}/lib-common.sh"; skill_body "$1"', "_", str(path)],
        capture_output=True, text=True, env={**os.environ, "ROOT": root}, check=True)
    return r.stdout


class FrontMatter(unittest.TestCase):
    def test_python_strips_a_leading_block(self):
        self.assertEqual(PF.strip_front_matter(FM + BODY), BODY)

    def test_python_leaves_a_skill_without_front_matter_alone(self):
        self.assertEqual(PF.strip_front_matter(BODY), BODY)
        self.assertEqual(PF.strip_front_matter(""), "")

    def test_python_keeps_an_unterminated_header(self):
        s = "---\nname: x\nno closing line\n"
        self.assertEqual(PF.strip_front_matter(s), s)

    def test_shell_helper_agrees_with_python(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name, text in (("fm.md", FM + BODY), ("plain.md", BODY),
                               ("open.md", "---\nname: x\nno closing line\n")):
                f = Path(tmp, name)
                f.write_text(text)
                self.assertEqual(skill_body(f, tmp), PF.strip_front_matter(text), name)
            real = skill_body(REPO_SKILL, tmp)
        self.assertEqual(real, PF.strip_front_matter(REPO_SKILL.read_text()))
        self.assertFalse(real.lstrip().startswith("-"))
        self.assertIn("You are profiling a code repository", real.strip().splitlines()[0])


class ProfilePrompt(unittest.TestCase):
    def test_assembled_prompt_does_not_start_with_a_dash(self):
        prompt = PF.build_prompt({"repo": "o/r", "tree": ["a/"]}, REPO_SKILL.read_text())
        self.assertFalse(prompt.startswith("-"), prompt[:60])
        self.assertTrue(prompt.startswith("You are profiling"), prompt[:60])
        self.assertNotIn("name: repo-profile", prompt)
        self.assertIn("## Signals gathered from o/r", prompt)
        self.assertIn('"critical_paths"', prompt)

    def test_a_skill_without_front_matter_is_embedded_verbatim(self):
        prompt = PF.build_prompt({"repo": "o/r"}, BODY)
        self.assertTrue(prompt.startswith(BODY.strip()))


# The real profile-repo.sh, from `status` to `done`, with the CLI replaced by a shim that writes
# its argv and stdin to disk and answers with one stream-json result line the finish stage
# accepts. Needs git, jq, and (on Linux) flock + timeout; on a Mac without coreutils the two
# are stubbed since they are not what is under test here.
FAKE_CLAUDE = r'''#!/usr/bin/env bash
printf '%s\n' "$@" > "$SHIM_DIR/argv"
cat > "$SHIM_DIR/stdin"
printf '{"type":"system","subtype":"init","model":"fake-sonnet"}\n'
printf '%s\n' "$(jq -cn --arg r "$(cat "$SHIM_DIR/reply.json")" \
  '{type:"result",result:$r,usage:{input_tokens:10,output_tokens:5},total_cost_usd:0.01,duration_ms:7}')"
'''
REPLY = {"summary": "A tiny repo.",
         "critical_paths": [{"path_glob": "app/**", "why": "everything lives here",
                             "checks": ["tests still pass"]}],
         "risk_paths": [{"label": "app", "pattern": "app/"}],
         "review_rules": ["Keep it small."], "do_not_flag": []}


def _exe(path, body):
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


@unittest.skipUnless(shutil.which("jq") and shutil.which("git"), "needs jq and git")
class ProfileRepoHandsThePromptOverStdin(unittest.TestCase):
    def test_prompt_arrives_on_stdin_and_never_in_argv(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp, "root")
            shim = Path(tmp, "shim")
            shim.mkdir()
            base = root / "repos" / "acme__widgets"
            base.mkdir(parents=True)
            genv = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
            for rel, body in {"app/main.py": "print(1)\n", "README.md": "# r\n"}.items():
                Path(base, rel).parent.mkdir(parents=True, exist_ok=True)
                Path(base, rel).write_text(body)
            for a in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "one"]):
                subprocess.run(["git", "-C", str(base), *a], check=True, env=genv,
                               capture_output=True)

            _exe(shim / "claude", FAKE_CLAUDE)
            (shim / "reply.json").write_text(json.dumps(REPLY))
            if not shutil.which("flock"):
                _exe(shim / "flock", "#!/bin/sh\nexit 0\n")
            if not shutil.which("timeout"):
                _exe(shim / "timeout", '#!/bin/sh\nshift\nexec "$@"\n')

            env = {**os.environ, "ROOT": str(root), "SHIM_DIR": str(shim),
                   "PATH": f"{shim}:{os.environ.get('PATH', '')}",
                   "REPOS": "acme/widgets", "REVIEWER": "acme-dev", "GITHUB_PAT": "ghp_x",
                   "RS_SECRET": "s", "PUBLIC_URL": "https://rs.example.com",
                   "CLAUDE_CODE_OAUTH_TOKEN": "fake-token", "MIN_FREE_MB": "0"}
            r = subprocess.run([str(HERE / "profile-repo.sh"), "acme/widgets"],
                               capture_output=True, text=True, env=env, timeout=120)
            pdir = root / "profiles" / "acme__widgets"
            status = (pdir / "status").read_text().strip() if (pdir / "status").exists() else ""
            self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}\nstatus={status}")
            self.assertEqual(status, "done")

            argv = (shim / "argv").read_text().splitlines()
            stdin = (shim / "stdin").read_text()
            expected = PF.build_prompt(json.loads((pdir / "signals.json").read_text()),
                                       REPO_SKILL.read_text())
            prof = json.loads((pdir / "profile.json").read_text())
        self.assertEqual(stdin, expected)                      # whole prompt, byte for byte
        self.assertTrue(stdin.startswith("You are profiling"), stdin[:60])
        self.assertEqual(argv[0], "-p")
        for a in argv:
            self.assertFalse(a.startswith("---"), a)
            self.assertNotIn("You are profiling", a)           # the prompt is not in argv
        self.assertIn("--model", argv)
        self.assertNotIn("", argv[1:])                          # no stray empty positional
        self.assertEqual(prof["critical_paths"][0]["path_glob"], "app/**")
        self.assertEqual(prof["meta"]["model"], "fake-sonnet")


if __name__ == "__main__":
    unittest.main()
