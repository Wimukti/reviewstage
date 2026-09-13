"""Unit tests for rs_profile.py — glob validation, risk merging, prompt assembly, the
markdown round-trip and the signals stage on a throwaway git repo.

    python3 -m unittest discover -s bin -p 'test_*.py'
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rs_profile as PF  # noqa: E402

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
        matched = PF.match_critical(many, changed)
        self.assertEqual(len(matched), PF.MAX_MATCHED)
        block = PF.render_block(many, changed)
        line = next(l for l in block.splitlines() if l.startswith("- `d0/f.py`"))
        self.assertLessEqual(len(line), len("- `d0/f.py` — ") + PF.WHY_LIMIT)
        self.assertTrue(line.endswith("…"))
        self.assertNotIn("`d12/f.py`", block)

    def test_prompt_wraps_skill_signals_and_contract(self):
        sig = {"repo": "o/r", "file_count": 3, "tree": ["a/"], "gathered_at": 1, "duration_ms": 5}
        prompt = PF.build_prompt(sig, "---\nname: repo-profile\n---\nBODY")
        self.assertTrue(prompt.startswith("---\nname: repo-profile"))
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


if __name__ == "__main__":
    unittest.main()
