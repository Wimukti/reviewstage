"""Unit tests for rs_profile.py — glob validation, risk merging, prompt assembly, the
markdown round-trip and the signals stage on a throwaway git repo.

    python3 -m unittest discover -s bin -p 'test_*.py'
"""
import fcntl
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rs_profile as PF  # noqa: E402
import rs_state as S  # noqa: E402

TREE = ["app/auth/login.py", "app/auth/session.py", "app/payments/charge.py",
        "app/payments/refund.py", "app/models/product.py", "api/routes.py", "README.md",
        "migrations/0001_init.sql", "web/src/App.tsx", "web/src/api.ts"]

CANNED = {
    "summary": "  A web shop.  Payments and auth are the sharp edges. ",
    "critical_paths": [
        {"path_glob": "app/payments/**", "why": "Charges cards.",
         "checks": ["amounts in cents", "refund mirrors charge"]},
        {"path_glob": "app/auth/", "why": "x" * 800, "checks": "single string check"},
        {"path_glob": "app/billing/**", "why": "hallucinated", "checks": []},
        {"path_glob": "lib/does_not_exist.py", "why": "also hallucinated"},
        {"path_glob": "api/routes.py", "why": "public contract"},
        {"path_glob": "api/routes.py", "why": "duplicate, dropped"},
        "not a dict",
    ],
    "risk_paths": [
        {"label": "payments", "pattern": "app/payments/"},
        {"label": "bad label!", "pattern": "x"},
        {"label": "auth", "pattern": "app/auth/"},
        {"label": "colon", "pattern": "a:b"},
    ],
    "review_rules": ["Money is integer cents.", "  Money is integer cents.  "],
    "do_not_flag": ["Committed lockfile."],
}


class GlobValidation(unittest.TestCase):
    def test_hallucinated_globs_are_dropped_and_reported(self):
        clean, dropped, err = PF.validate_profile(CANNED, TREE)
        self.assertIsNone(err)
        self.assertEqual(dropped, ["app/billing/**", "lib/does_not_exist.py"])
        globs = [c["path_glob"] for c in clean["critical_paths"]]
        self.assertEqual(globs, ["app/payments/**", "app/auth/", "api/routes.py"])

    def test_directory_and_double_star_globs_match_files_beneath(self):
        self.assertTrue(PF._glob_matches("app/payments/**", TREE))
        self.assertTrue(PF._glob_matches("app/payments/", TREE))
        self.assertTrue(PF._glob_matches("app/payments", TREE))
        self.assertTrue(PF._glob_matches("web/src/*.tsx", TREE))
        self.assertTrue(PF._glob_matches("./api/routes.py", TREE))
        self.assertFalse(PF._glob_matches("app/billing/**", TREE))
        self.assertFalse(PF._glob_matches("", TREE))

    def test_fields_are_coerced_and_bounded(self):
        clean, _, _ = PF.validate_profile(CANNED, TREE)
        self.assertEqual(clean["summary"], "A web shop. Payments and auth are the sharp edges.")
        auth = clean["critical_paths"][1]
        self.assertEqual(len(auth["why"]), 600)
        self.assertEqual(auth["checks"], ["single string check"])
        # an odd label is sanitised the way run-review.sh does, not dropped; a ':' pattern is
        self.assertEqual([r["label"] for r in clean["risk_paths"]],
                         ["payments", "bad_label_", "auth"])
        self.assertEqual(clean["review_rules"], ["Money is integer cents."])
        self.assertEqual(clean["do_not_flag"], ["Committed lockfile."])

    def test_no_tree_skips_the_check(self):
        clean, dropped, err = PF.validate_profile(CANNED, None)
        self.assertIsNone(err)
        self.assertEqual(dropped, [])
        self.assertEqual(len(clean["critical_paths"]), 5)

    def test_empty_profile_is_an_error(self):
        clean, _, err = PF.validate_profile({"critical_paths": [{"path_glob": "nope/**"}]}, TREE)
        self.assertIsNone(clean)
        self.assertTrue(err)
        self.assertEqual(PF.validate_profile("nope", TREE)[2], "profile must be a JSON object")


class RiskMerging(unittest.TestCase):
    PROFILE = {"risk_paths": [{"label": "payments", "pattern": "app/payments/"},
                              {"label": "auth", "pattern": "app/auth/"}]}

    def test_operator_rule_wins_on_a_shared_label(self):
        merged = PF.merge_risk_rules("payments:billing/, infra:deploy/", self.PROFILE)
        self.assertEqual(merged, "payments:billing/,infra:deploy/,auth:app/auth/")

    def test_empty_env_rules_yield_only_the_profile(self):
        self.assertEqual(PF.merge_risk_rules("", self.PROFILE), "payments:app/payments/,auth:app/auth/")
        self.assertEqual(PF.merge_risk_rules("", None), "")
        self.assertEqual(PF.risk_rules(self.PROFILE), "payments:app/payments/,auth:app/auth/")

    def test_bare_label_rule_is_kept_verbatim(self):
        self.assertEqual(PF.merge_risk_rules("auth", self.PROFILE), "auth,payments:app/payments/")


class PromptAssembly(unittest.TestCase):
    def setUp(self):
        self.profile, _, _ = PF.validate_profile(CANNED, TREE)

    def test_block_lists_only_touched_paths_with_checks_rules_and_do_not_flag(self):
        block = PF.render_block(self.profile, ["app/payments/refund.py", "README.md"])
        self.assertIn("## Critical paths for this repository", block)
        self.assertIn("`app/payments/**`", block)
        self.assertIn("check: amounts in cents", block)
        self.assertNotIn("`app/auth/`", block)
        self.assertNotIn("`api/routes.py`", block)
        self.assertIn('set "critical_path" on that finding', block)
        self.assertIn("- Money is integer cents.", block)
        self.assertIn("do NOT flag:\n- Committed lockfile.", block)

    def test_quick_effort_gets_no_block(self):
        self.assertEqual(PF.render_block(self.profile, ["app/payments/charge.py"], "quick"), "")

    def test_no_touched_paths_still_carries_the_rules(self):
        block = PF.render_block(self.profile, ["docs/x.md"])
        self.assertIn("None of this repository's critical paths are touched", block)
        self.assertIn("Money is integer cents.", block)
        bare = {"summary": "", "critical_paths": [], "risk_paths": [], "review_rules": [],
                "do_not_flag": []}
        self.assertEqual(PF.render_block(bare, ["a.py"]), "")

    def test_why_is_truncated_to_200_chars_and_paths_capped_at_12(self):
        many = {"critical_paths": [{"path_glob": f"d{i}/f.py", "why": "y" * 500, "checks": []}
                                   for i in range(20)]}
        changed = [f"d{i}/f.py" for i in range(20)]
        matched, not_listed = PF.match_critical(many, changed)
        self.assertEqual(len(matched), PF.MAX_MATCHED)
        self.assertEqual(not_listed, 20 - PF.MAX_MATCHED)
        block = PF.render_block(many, changed)
        self.assertIn(f"{not_listed} further critical path(s)", block)
        line = next(l for l in block.splitlines() if l.startswith("- `d0/f.py`"))
        self.assertLessEqual(len(line), len("- `d0/f.py` — ") + PF.WHY_LIMIT)
        self.assertTrue(line.endswith("…"))
        self.assertNotIn("`d12/f.py`", block)

    def test_prompt_wraps_skill_signals_and_contract(self):
        sig = {"repo": "o/r", "file_count": 3, "tree": ["a/"], "gathered_at": 1, "duration_ms": 5}
        prompt = PF.build_prompt(sig, "---\nname: repo-profile\n---\nBODY")
        # Front-matter is dropped: a prompt starting with `---` was parsed as a CLI option.
        self.assertTrue(prompt.startswith("BODY\n\n## Signals"), prompt[:40])
        self.assertNotIn("name: repo-profile", prompt)
        self.assertIn('"file_count": 3', prompt)
        self.assertNotIn("gathered_at", prompt)
        self.assertIn("Reply with ONLY one JSON object", prompt)

    def test_model_output_is_parsed_from_fence_or_prose(self):
        d = {"summary": "s", "critical_paths": []}
        self.assertEqual(PF.parse_model_output(json.dumps(d)), d)
        self.assertEqual(PF.parse_model_output("Here you go:\n```json\n" + json.dumps(d) + "\n```"), d)
        self.assertEqual(PF.parse_model_output("prose " + json.dumps(d) + " more"), d)
        self.assertIsNone(PF.parse_model_output("no json here"))
        self.assertIsNone(PF.parse_model_output("[1, 2]"))
        self.assertIsNone(PF.parse_model_output(""))


class MarkdownRoundTrip(unittest.TestCase):
    def test_to_and_from_markdown_preserve_the_profile(self):
        clean, _, _ = PF.validate_profile(CANNED, TREE)
        back = PF.from_markdown(PF.to_markdown(clean))
        for k in ("summary", "critical_paths", "risk_paths", "review_rules", "do_not_flag"):
            self.assertEqual(back[k], clean[k], k)

    def test_edited_markdown_is_lenient(self):
        md = ("# Repository profile\n\n## Summary\n\nLine one.\nLine two.\n\n## Critical paths\n\n"
              "### app/auth/\nWhy: identity.\n- verify sessions\n* check: csrf\n\n"
              "## Risk paths\n\n- `auth`: `app/auth/`\n- not a rule\n\n## Review rules\n\n_none_\n\n"
              "## Do not flag\n\n- lockfile\n")
        p = PF.from_markdown(md)
        self.assertEqual(p["summary"], "Line one. Line two.")
        self.assertEqual(p["critical_paths"], [{"path_glob": "app/auth/", "why": "identity.",
                                                "checks": ["verify sessions", "csrf"]}])
        self.assertEqual(p["risk_paths"], [{"label": "auth", "pattern": "app/auth/"}])
        self.assertEqual(p["review_rules"], [])
        self.assertEqual(p["do_not_flag"], ["lockfile"])


class JobState(unittest.TestCase):
    def test_every_state_is_one_of_the_five(self):
        cases = {
            (True, "asking the model (one call)", False): ("running", ""),
            (True, "failed: x", True): ("running", ""),
            (False, "", False): ("none", ""),
            (False, "done", True): ("done", ""),
            (False, "stopped", False): ("stopped", ""),
            (False, "stopped", True): ("done", ""),
        }
        for (running, status, has), want in cases.items():
            self.assertEqual(PF.job_state(running, status, has), want, (running, status, has))

    def test_a_failed_run_is_failed_not_none(self):
        st, why = PF.job_state(False, "failed: the model produced no result (see x)", False)
        self.assertEqual(st, "failed")
        self.assertEqual(why, "failed: the model produced no result (see x)")

    def test_a_failed_rerun_keeps_the_old_profile_and_reports_the_failure(self):
        st, why = PF.job_state(False, "failed: boom", True)
        self.assertEqual(st, "done")
        self.assertEqual(why, "failed: boom")

    def test_a_dead_run_still_showing_progress_is_a_failure(self):
        for status in ("queued", "gathering signals", "asking the model (one call)"):
            st, why = PF.job_state(False, status, False)
            self.assertEqual(st, "failed", status)
            self.assertIn(status, why)

    def test_log_tail_keeps_the_last_non_empty_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp, "agent.log")
            f.write_text("\n".join(f"line {i}" if i % 7 else "" for i in range(60)) + "\n\n")
            tail = PF.log_tail(f)
            self.assertEqual(len(tail), 20)
            self.assertEqual(tail[-1], "line 59")
            self.assertNotIn("", tail)
            self.assertEqual(PF.log_tail(Path(tmp, "missing.log")), [])


class Liveness(unittest.TestCase):
    """job_alive / start_job — the three liveness signals a profile build has, mirrored on
    rs_state: the flock, the pid file and the status file's age."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.pdir = Path(self._tmp.name, "profiles", "acme__shop")
        self.pdir.mkdir(parents=True)
        self.addCleanup(self._tmp.cleanup)

    def _status(self, text, age):
        f = self.pdir / "status"
        f.write_text(text)
        then = time.time() - age
        os.utime(f, (then, then))

    def _dead_pid(self):
        p = subprocess.Popen(["true"])
        p.wait()
        (self.pdir / "pid").write_text(str(p.pid))
        return p.pid

    def _hold_lock(self):
        fd = os.open(self.pdir / ".lock", os.O_RDWR | os.O_CREAT)
        fcntl.flock(fd, fcntl.LOCK_EX)
        self.addCleanup(os.close, fd)
        self.addCleanup(fcntl.flock, fd, fcntl.LOCK_UN)
        return fd

    def test_lock_held_is_running_even_with_a_dead_pid_and_an_old_status(self):
        self._dead_pid()
        self._status("queued — waiting for another job to finish", 10_000)
        self._hold_lock()
        self.assertTrue(PF.job_alive(self.pdir))
        self.assertEqual(PF.job_state(PF.job_alive(self.pdir), PF.read_status(self.pdir), False),
                         ("running", ""))

    def test_fresh_queued_status_with_a_free_lock_is_running_not_failed(self):
        # The server writes "queued" and spawns; bash needs a moment to reach `flock`.
        self._dead_pid()
        self._status("queued", 2)
        self.assertTrue(PF.job_alive(self.pdir))
        st, why = PF.job_state(PF.job_alive(self.pdir), "queued", False)
        self.assertEqual(st, "running")
        self.assertEqual(why, "")

    def test_live_pid_with_a_free_lock_is_running(self):
        p = subprocess.Popen(["sleep", "30"])
        self.addCleanup(p.wait)
        self.addCleanup(p.kill)
        (self.pdir / "pid").write_text(str(p.pid))
        self._status("queued", 10_000)
        self.assertTrue(PF.job_alive(self.pdir))

    def test_failed_only_when_everything_is_dead_and_the_status_is_stale(self):
        self._dead_pid()
        self._status("queued", S.STARTUP_GRACE + 30)
        self.assertFalse(PF.job_alive(self.pdir))
        st, why = PF.job_state(PF.job_alive(self.pdir), PF.read_status(self.pdir), False)
        self.assertEqual(st, "failed")
        self.assertIn("exited without reporting why (last status: queued)", why)

    def test_failed_status_is_failed_however_fresh(self):
        self._dead_pid()
        self._status("failed: the model produced no result", 0)
        self.assertFalse(PF.job_alive(self.pdir))
        st, why = PF.job_state(PF.job_alive(self.pdir), PF.read_status(self.pdir), False)
        self.assertEqual((st, why), ("failed", "failed: the model produced no result"))

    def test_terminal_status_is_not_alive_by_grace(self):
        self._dead_pid()
        for status, want in (("done", "done"), ("stopped", "stopped")):
            self._status(status, 0)
            self.assertFalse(PF.job_alive(self.pdir), status)
            self.assertEqual(PF.job_state(False, status, status == "done")[0], want)

    def test_no_markers_at_all_is_not_alive(self):
        self.assertFalse(PF.job_alive(self.pdir))
        self.assertEqual(PF.job_state(False, "", False), ("none", ""))

    def test_duplicate_start_while_alive_does_not_spawn_or_touch_pid(self):
        (self.pdir / "pid").write_text("4242")
        self._status("queued — waiting for another job to finish", 10_000)
        self._hold_lock()
        calls = []
        started, reason = PF.start_job(self.pdir, lambda: calls.append(1) or 99)
        self.assertEqual((started, reason), (False, "already running"))
        self.assertEqual(calls, [])
        self.assertEqual((self.pdir / "pid").read_text(), "4242")
        self.assertEqual(PF.read_status(self.pdir), "queued — waiting for another job to finish")

    def test_duplicate_start_during_startup_grace_does_not_spawn(self):
        self._dead_pid()
        self._status("queued", 1)
        started, reason = PF.start_job(self.pdir, lambda: self.fail("spawned a duplicate"))
        self.assertEqual((started, reason), (False, "already running"))

    def test_start_after_a_dead_run_spawns_and_writes_the_markers(self):
        self._dead_pid()
        self._status("gathering signals", S.STARTUP_GRACE + 30)
        started, reason = PF.start_job(self.pdir, lambda: 777)
        self.assertEqual((started, reason), (True, ""))
        self.assertEqual((self.pdir / "pid").read_text(), "777")
        self.assertEqual(PF.read_status(self.pdir), "queued")

    def test_the_script_takes_the_lock_before_writing_any_marker(self):
        """profile-repo.sh: the flock is the first action after PDIR; pid/runner/model/status
        writes all come after it, and the losing duplicate speaks to stderr only."""
        src = Path(__file__).with_name("profile-repo.sh").read_text().splitlines()
        lock_at = next(i for i, ln in enumerate(src) if ln.startswith("flock -n 9"))
        pdir_at = next(i for i, ln in enumerate(src) if ln.startswith("PDIR="))
        between = [ln for ln in src[pdir_at + 1:lock_at]
                   if ln.strip() and not ln.lstrip().startswith("#")]
        self.assertEqual(between, ['mkdir -p "$PDIR"', 'exec 9>"$PDIR/.lock"'])
        self.assertIn(">&2; exit 0; }", src[lock_at])
        for marker in ('> "$PDIR/pid"', '> "$PDIR/runner"', '> "$PDIR/model"', '> "$PDIR/status"'):
            first = next(i for i, ln in enumerate(src) if marker in ln)
            self.assertGreater(first, lock_at, marker)


class Storage(unittest.TestCase):
    def test_save_versions_the_previous_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            PF.ROOT = Path(tmp)
            PF.PROFILES = PF.ROOT / "profiles"
            clean, _, _ = PF.validate_profile(CANNED, TREE)
            PF.save_profile("o/r", clean, {"generated_at": 1000, "model": "m"})
            self.assertEqual(PF.load_profile("o/r")["meta"]["generated_at"], 1000)
            self.assertTrue((PF.profile_dir("o/r") / "profile.md").exists())
            self.assertEqual(PF.versions("o/r"), [])
            clean2 = dict(clean, summary="edited")
            PF.save_profile("o/r", clean2, {"edited_at": 2000, "edited_by": "me"})
            self.assertEqual(PF.versions("o/r"), [1000])
            cur = PF.load_profile("o/r")
            self.assertEqual(cur["summary"], "edited")
            self.assertEqual(cur["meta"]["edited_by"], "me")
            self.assertEqual(PF.counts(cur), {"critical": 3, "risk": 3, "rules": 1, "doNotFlag": 1})


class Signals(unittest.TestCase):
    def test_signals_on_a_throwaway_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            def git(*a):
                subprocess.run(["git", "-C", tmp, *a], check=True, capture_output=True,
                               env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                                    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})
            git("init", "-q")
            files = {"app/auth/login.py": "from app.models import product\n",
                     "app/models/product.py": "X = 1\n",
                     "app/payments/charge.py": "from app.models import product\nimport app.auth.login\n",
                     "api/routes.py": "from app.models import product\n",
                     ".github/workflows/ci.yml": "on: push\n", "CODEOWNERS": "* @team\n",
                     "package.json": "{}\n", "README.md": "# r\n"}
            for rel, body in files.items():
                p = Path(tmp, rel)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(body)
            git("add", "-A")
            git("commit", "-q", "-m", "one")
            Path(tmp, "app/models/product.py").write_text("X = 2\n")
            git("commit", "-q", "-am", "two")
            sig = PF.gather_signals(tmp, "o/r")
        self.assertEqual(sig["repo"], "o/r")
        self.assertEqual(sig["file_count"], 8)
        self.assertEqual(sig["languages"][0], {"language": "python", "files": 4})
        self.assertEqual(sig["manifests"], ["package.json"])
        self.assertEqual(sig["ci_configs"], [".github/workflows/ci.yml"])
        self.assertEqual(sig["codeowners_path"], "CODEOWNERS")
        self.assertEqual(sig["churn_top"][0], {"path": "app/models/product.py", "commits": 2})
        self.assertEqual(sig["indegree_top"]["language"], "python")
        self.assertEqual(sig["indegree_top"]["rows"][0], {"path": "app/models/product.py",
                                                          "imported_by": 3})
        dirs = {d["dir"] for d in sig["critical_dirs"]}
        self.assertEqual(dirs, {"app/auth/", "app/payments/", "api/"})
        self.assertTrue(any(t.startswith("app/ (") for t in sig["tree"]))
        self.assertEqual(sig["commits_last_12mo"], 2)
        self.assertGreaterEqual(sig["duration_ms"], 0)


FULL = {
    "summary": "A web shop.",
    "critical_paths": [{"path_glob": "app/payments/**", "why": "Charges cards.",
                        "checks": ["amounts in cents"]}],
    "risk_paths": [{"label": "payments", "pattern": "app/payments"},
                   {"label": "auth", "pattern": "app/auth"}],
    "review_rules": ["Money is integer cents."],
    "do_not_flag": ["The generated client is checked in on purpose."],
}


class MarkdownRoundTrip(unittest.TestCase):
    """Regression: a retitled or deleted section used to parse as an empty list and save
    cleanly, because validation only objected when critical paths AND rules AND summary were
    all empty at once. Deleting the risk-paths heading took every risk rule out of every
    future review, with a green "Saved" banner."""

    def test_a_faithful_round_trip_keeps_every_section(self):
        back = PF.from_markdown(PF.to_markdown(FULL))
        for key in PF.SECTIONS:
            self.assertEqual(len(back[key]), len(FULL[key]), key)

    def test_a_retitled_heading_is_reported_not_swallowed(self):
        md = PF.to_markdown(FULL).replace("## Risk paths", "## Risky areas")
        prof, notes = PF.from_markdown(md, report=True)
        self.assertEqual(prof["risk_paths"], [])
        self.assertEqual(notes["unknownHeadings"], ["Risky areas"])

    def test_emptying_a_section_is_refused_unless_confirmed(self):
        md = PF.to_markdown(FULL).replace("## Risk paths", "## Risky areas")
        raw = PF.from_markdown(md)
        clean, _dropped, err = PF.validate_profile(raw, TREE, prev=FULL, allow_emptying=False)
        self.assertIsNone(clean)
        self.assertIn("risk paths", err)
        ok, _d, err2 = PF.validate_profile(raw, TREE, prev=FULL, allow_emptying=True)
        self.assertIsNone(err2)
        self.assertEqual(ok["risk_paths"], [])

    def test_deleting_the_do_not_flag_section_is_caught_too(self):
        gone = dict(FULL, do_not_flag=[])
        self.assertEqual(PF.emptied_sections(FULL, gone), ["do_not_flag"])
        self.assertEqual(PF.emptied_sections(FULL, FULL), [])

    def test_section_counts_are_reported_back(self):
        self.assertEqual(PF.section_counts(FULL),
                         {"critical_paths": 1, "risk_paths": 2, "review_rules": 1,
                          "do_not_flag": 1, "summary": 1})

    def test_shrinking_a_section_is_allowed(self):
        fewer = dict(FULL, risk_paths=FULL["risk_paths"][:1])
        self.assertEqual(PF.emptied_sections(FULL, fewer), [])


class GlobSemantics(unittest.TestCase):
    """Regression: fnmatch's `*` crosses `/`, so `src/*.ts` matched the whole tree and every
    review was told the critical path was touched."""

    TREE = ["src/a.ts", "src/deep/b.ts", "src/deep/deeper/c.ts", "docs/x.md"]

    def test_a_single_star_does_not_cross_a_slash(self):
        self.assertEqual(PF.glob_hits("src/*.ts", self.TREE), ["src/a.ts"])

    def test_a_double_star_does(self):
        self.assertEqual(len(PF.glob_hits("src/**", self.TREE)), 3)
        self.assertEqual(len(PF.glob_hits("src/**/*.ts", self.TREE)), 3)

    def test_a_bare_directory_still_matches_everything_under_it(self):
        self.assertEqual(len(PF.glob_hits("src/", self.TREE)), 3)

    def test_a_glob_matching_most_of_the_tree_is_rejected(self):
        raw = {"summary": "s",
               "critical_paths": [{"path_glob": "**", "why": "everything", "checks": []},
                                  {"path_glob": "src/*.ts", "why": "ok", "checks": []}]}
        clean, dropped, err = PF.validate_profile(raw, self.TREE)
        self.assertIsNone(err)
        self.assertEqual(dropped, ["**"])
        self.assertEqual([c["path_glob"] for c in clean["critical_paths"]], ["src/*.ts"])

    def test_matched_paths_are_ordered_by_how_much_of_the_pr_they_cover(self):
        prof = {"critical_paths": [{"path_glob": "docs/**", "why": "", "checks": []},
                                   {"path_glob": "src/**", "why": "", "checks": []}]}
        changed = ["src/a.ts", "src/deep/b.ts", "src/deep/deeper/c.ts", "docs/x.md"]
        listed, _ = PF.match_critical(prof, changed, cap=1)
        self.assertEqual(listed[0]["path_glob"], "src/**")


class StoredCap(unittest.TestCase):
    def test_validation_caps_what_is_stored(self):
        files = [f"d{i}/f.py" for i in range(60)]
        raw = {"summary": "s", "critical_paths": [
            {"path_glob": f"d{i}/f.py", "why": "", "checks": []} for i in range(50)]}
        clean, _dropped, err = PF.validate_profile(raw, files)
        self.assertIsNone(err)
        self.assertEqual(len(clean["critical_paths"]), PF.MAX_CRITICAL)
        self.assertEqual(clean["meta"]["capped_critical_paths"], 50 - PF.MAX_CRITICAL)


class SchemaGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        PF.PROFILES = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, text):
        d = PF.profile_dir("o/r")
        d.mkdir(parents=True, exist_ok=True)
        (d / "profile.json").write_text(text)

    def test_a_valid_profile_reads_back(self):
        PF.save_profile("o/r", dict(FULL))
        prof, err = PF.read_profile("o/r")
        self.assertEqual(err, "")
        self.assertEqual(prof["version"], PF.SCHEMA_VERSION)

    def test_a_hand_broken_file_is_an_error_not_an_empty_profile(self):
        self.write(json.dumps({"critical_paths": "app/**"}))
        prof, err = PF.read_profile("o/r")
        self.assertIsNone(prof)
        self.assertIn("must be a list", err)

    def test_a_future_schema_version_is_refused(self):
        self.write(json.dumps({"version": PF.SCHEMA_VERSION + 1, "critical_paths": []}))
        _prof, err = PF.read_profile("o/r")
        self.assertIn("newer than this build", err)

    def test_an_earlier_version_can_be_read_back(self):
        PF.save_profile("o/r", dict(FULL), {"generated_at": 1700000000})
        PF.save_profile("o/r", dict(FULL, summary="second"), {"generated_at": 1700000900})
        vs = PF.versions("o/r")
        self.assertEqual(vs, [1700000000])
        prof, err = PF.load_version("o/r", vs[0])
        self.assertEqual(err, "")
        self.assertEqual(prof["summary"], "A web shop.")
        self.assertEqual(PF.load_version("o/r", 1)[1], "no such version")


class DegradedSignals(unittest.TestCase):
    def test_a_git_timeout_is_a_note_not_an_exception(self):
        notes = []
        out = PF._git(Path("/"), "log", timeout=0.000001, degraded=notes)
        self.assertEqual(out, "")
        self.assertTrue(notes)

    def test_churn_on_a_non_repo_degrades_instead_of_raising(self):
        with tempfile.TemporaryDirectory() as tmp:
            notes = []
            self.assertEqual(PF._churn(Path(tmp), ["a.py"], degraded=notes), [])

    def test_the_prompt_says_which_signals_are_missing(self):
        sig = {"repo": "o/r", "tree": [], "degraded": ["churn skipped: git log exceeded 300s"]}
        self.assertIn("churn skipped", PF.build_prompt(sig, "BODY"))


class Staleness(unittest.TestCase):
    """Regression: meta.head was stored, returned and typed, and never compared to anything."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        run = lambda *a: subprocess.run(["git", "-C", str(self.base), *a],  # noqa: E731
                                        capture_output=True, text=True)
        run("init", "-q", "-b", "main")
        run("config", "user.email", "t@t.t")
        run("config", "user.name", "t")
        (self.base / "app").mkdir()
        (self.base / "app" / "pay.py").write_text("x\n")
        run("add", "-A")
        run("commit", "-qm", "one")
        self.first = PF.head_of(self.base)
        self.run = run

    def tearDown(self):
        self.tmp.cleanup()

    def prof(self, head):
        return {"critical_paths": [{"path_glob": "app/**", "why": "", "checks": []}],
                "meta": {"head": head}}

    def test_a_profile_at_head_is_not_stale(self):
        s = PF.staleness(self.prof(self.first), self.base)
        self.assertFalse(s["stale"])
        self.assertEqual(s["unmatchedPaths"], 0)

    def test_commits_behind_are_counted(self):
        (self.base / "b.py").write_text("y\n")
        self.run("add", "-A")
        self.run("commit", "-qm", "two")
        s = PF.staleness(self.prof(self.first), self.base)
        self.assertTrue(s["stale"])
        self.assertEqual(s["commitsBehind"], 1)

    def test_a_critical_path_that_no_longer_matches_is_reported(self):
        self.run("rm", "-q", "-r", "app")
        self.run("commit", "-qm", "drop app")
        s = PF.staleness(self.prof(self.first), self.base)
        self.assertEqual((s["criticalPaths"], s["unmatchedPaths"]), (1, 1))
        self.assertTrue(s["stale"])

    def test_no_clone_means_no_verdict(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(PF.staleness(self.prof(self.first), Path(tmp)))


if __name__ == "__main__":
    unittest.main()
