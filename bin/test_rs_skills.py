#!/usr/bin/env python3
"""The skills tier in bin/server.py: which file an edit actually writes.

The headline regression: the Skills page renders a full editor for a per-repo override of the
team default and posts target="repo:<owner/name>", but the server resolved every non-"global"
target to the acting user's LOGIN. Saving a repo override therefore overwrote that person's own
tuned personal skill — under a green "Saved your skill" banner — the repo file was never
created (so run-review.sh never saw an override and suggestion_target could never return one),
and "Clear override" deleted the personal skill instead.

Run: python3 -m unittest bin.test_rs_skills
"""
import importlib
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

SECRET = "a" * 64


def load_server(root):
    os.environ["ROOT"] = root
    os.environ["RS_COOKIE_SECURE"] = "0"
    os.makedirs(os.path.join(root, "state"), exist_ok=True)
    with open(os.path.join(root, ".env"), "w") as f:
        f.write(f"RS_SECRET={SECRET}\nREPOS=acme/widgets,acme/api\nGITHUB_PAT=t\n")
    if "server" in sys.modules:
        return importlib.reload(sys.modules["server"])
    return importlib.import_module("server")


class SkillCase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.S = load_server(self.root)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)


class RepoSkillTier(SkillCase):
    def test_a_repo_target_resolves_to_the_repo_file(self):
        target, who, err = self.S.skill_edit_target("ann", "repo:acme/widgets")
        self.assertEqual(err, "")
        self.assertEqual(target, "repo:acme/widgets")
        self.assertIn("acme/widgets", who)
        self.assertEqual(self.S.skill_path(target), self.S.repo_skill_path("acme/widgets"))

    def test_an_unconfigured_repo_is_refused_not_rewritten_to_the_user(self):
        target, _who, err = self.S.skill_edit_target("ann", "repo:evil/elsewhere")
        self.assertEqual(target, "")
        self.assertIn("Unknown repository", err)

    def test_saving_a_repo_override_does_not_touch_the_personal_skill(self):
        self.S.save_skill("ann", "ANN'S OWN TUNED SKILL")
        self.S.save_skill("repo:acme/widgets", "THE WIDGETS OVERRIDE")
        self.assertEqual(self.S.read_skill("ann"), "ANN'S OWN TUNED SKILL")
        self.assertEqual(self.S.read_skill("repo:acme/widgets"), "THE WIDGETS OVERRIDE")
        self.assertTrue(self.S.repo_skill_path("acme/widgets").exists())

    def test_clearing_a_repo_override_unlinks_the_repo_file_only(self):
        self.S.save_skill("ann", "ANN'S OWN")
        self.S.save_skill("repo:acme/widgets", "OVERRIDE")
        self.S.save_skill("repo:acme/widgets", "")
        self.assertFalse(self.S.repo_skill_path("acme/widgets").exists())
        self.assertEqual(self.S.read_skill("ann"), "ANN'S OWN")

    def test_an_existing_repo_override_wins_for_that_repo(self):
        self.S.save_skill("ann", "ANN'S OWN")
        self.S.set_active_skill("ann", "own")
        self.assertEqual(self.S.effective_skill("ann", "acme/widgets")[0], "own")
        self.S.save_skill("repo:acme/widgets", "OVERRIDE")
        self.assertEqual(self.S.effective_skill("ann", "acme/widgets")[0], "repo")
        self.assertEqual(self.S.effective_skill("ann", "acme/api")[0], "own")

    def test_a_single_repo_cluster_can_now_target_the_repo_skill(self):
        cluster = {"repos": ["acme/widgets"], "signature": "x"}
        self.assertEqual(self.S.suggestion_target(cluster), "global")
        self.S.save_skill("repo:acme/widgets", "OVERRIDE")
        self.assertEqual(self.S.suggestion_target(cluster), "repo:acme/widgets")

    def test_a_personal_skill_is_not_world_readable(self):
        self.S.save_skill("ann", "PRIVATE")
        mode = self.S.skill_path("ann").stat().st_mode & 0o777
        self.assertEqual(mode, 0o600)


class RestoreBuiltIn(SkillCase):
    def test_restore_writes_the_builtin_back_rather_than_deleting_the_file(self):
        self.S.save_skill("global", "TEAM EDITS")
        done, why = self.S.restore_global_skill()
        self.assertTrue(done, why)
        self.assertTrue(self.S.GLOBAL_SKILL_PATH.exists())
        self.assertEqual(self.S.read_skill("global").strip(),
                         self.S.builtin_global_skill().strip())

    def test_the_team_skill_is_only_edited_when_it_differs_from_the_shipped_one(self):
        self.S.save_skill("global", self.S.builtin_global_skill())
        self.assertFalse(self.S.global_skill_edited())      # bootstrap seeds it: not "edited"
        self.S.save_skill("global", self.S.builtin_global_skill() + "\n- one more rule\n")
        self.assertTrue(self.S.global_skill_edited())


class QuickAddRule(SkillCase):
    def test_a_rule_lands_inside_the_team_rules_section(self):
        skill = ("Intro.\n\n## Team rules\n\n- First rule.\n\n"
                 "## Examples\n\n- An example, not a rule.\n")
        out = self.S.add_skill_rule(skill, "never ask for a jira link in code comments")
        rules = self.S.rs_learn.parse_rules(out, self.S.RULES_MARKER)
        self.assertEqual(rules, ["First rule.",
                                 "Never ask for a jira link in code comments."])
        self.assertTrue(out.rstrip().endswith("- An example, not a rule."))

    def test_the_section_is_created_when_absent(self):
        out = self.S.add_skill_rule("Just prose.", "money is integer cents")
        self.assertIn(self.S.RULES_MARKER, out)
        self.assertEqual(self.S.rs_learn.parse_rules(out, self.S.RULES_MARKER),
                         ["Money is integer cents."])


class GitAuditTrail(SkillCase):
    def test_a_failing_commit_is_reported_not_swallowed(self):
        self.S.save_skill("global", "TEAM")
        err = self.S.commit_skill_change("ann", "Edited the team default", ["_global.md"])
        self.assertEqual(err, "")
        self.assertTrue(self.S.skill_history(5))
        self.assertEqual(self.S.history_warning(""), "")
        self.assertIn("not recorded", self.S.history_warning("gpg failed"))

    def test_only_the_named_path_is_committed(self):
        self.S.save_skill("global", "TEAM")
        self.S.commit_skill_change("ann", "team", ["_global.md"])
        self.S.save_skill("bob", "BOB")
        self.S.save_skill("cat", "CAT")
        self.S.commit_skill_change("bob", "bob's skill", ["bob.md"])
        log = self.S._skills_git("log", "--format=%an", "--", "cat.md").stdout
        self.assertEqual(log.strip(), "")          # cat's save is not in bob's commit


if __name__ == "__main__":
    unittest.main()
