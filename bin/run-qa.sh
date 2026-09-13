#!/usr/bin/env bash
# run-qa.sh <owner/name> <pr-number> — build a QA test guide for one PR with the pr-qa-guide skill.
#
# Spawned detached by server.py from the QA guide page. Writes progress to
# $(prdir <repo> <pr>)/qa.status and the finished guide (GitHub-flavored markdown) to qa.md there.
# Never writes to GitHub — it only reads the PR (diff, review threads, history) and produces a
# guide the human hands to QA, then pings the requester (notify_card qa_ready).
set -uo pipefail
. "$(dirname "$0")/lib-common.sh"
require_env

if [ $# -eq 1 ] && [ -n "$(single_repo)" ]; then set -- "$(single_repo)" "$1"; fi
REPO="${1:?usage: run-qa.sh <owner/name> <pr-number>}"
PR="${2:?usage: run-qa.sh <owner/name> <pr-number>}"
repo_allowed "$REPO" || die "$REPO is not a repository this install reviews (REPOS / REPO_ALLOW_ORG)"
BASE=$(base_dir "$REPO")
DIR=$(prdir "$REPO" "$PR")
mkdir -p "$DIR"
# A QA guide lock separate from the review lock, so a QA build and a review can't collide but a
# review being open never blocks generating a guide.
exec 9>"$DIR/.qa.lock"
flock -n 9 || { echo "QA guide for $REPO#$PR already running"; exit 0; }

status() { echo "$1" > "$DIR/qa.status"; echo "[QA $REPO#$PR] $1"; }
fail() { status "failed: $1"; exit 1; }

have_free_mem || fail "not enough free memory to start"
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || fail "connect your Claude account in the dashboard to generate a QA guide"

status "fetching the PR"
meta=$(gh pr view "$PR" --repo "$REPO" \
        --json headRefName,headRefOid,title,url,author 2>/dev/null) || fail "PR not found"
branch=$(echo "$meta" | jq -r .headRefName)
# Cache identity so the QA page keeps the title after the PR leaves the review queue.
echo "$meta" | jq --arg n "$PR" --arg r "$REPO" \
  '{repo:$r, number:($n|tonumber), title, url, author:.author.login}' > "$DIR/qa_meta.json"

status "checking out the branch"
[ -d "$BASE/.git" ] || ensure_base_clone "$REPO" >>"$ROOT/clone.log" 2>&1 \
  || fail "could not clone $REPO (see $ROOT/clone.log)"
git -C "$BASE" fetch -q origin "$branch" || fail "could not fetch $branch"
wt="$WT/qa-$(repo_slug "$REPO")-$PR"
git -C "$BASE" worktree remove --force "$wt" 2>/dev/null || true
git -C "$BASE" worktree add -q --force -B "qa-$PR" "$wt" "origin/$branch" \
  || fail "could not create worktree"

# One heavy agent at a time, box-wide — share the review lock so a guide + a review don't OOM.
status "queued — waiting for another job to finish"
exec 8>"$ROOT/review.lock"
flock 8

status "building the QA guide"
rm -f "$wt/qa.md"
PROMPT="Use the pr-qa-guide skill to build a QA test guide for PR #$PR of $REPO.

IMPORTANT — you are running headless: there is NO Artifact tool and no publishing here. Do NOT try
to publish an artifact or load artifact-design. Instead do the skill's evidence-gathering and
analysis exactly as written, then write the finished guide to ./qa.md as GitHub-flavored markdown,
following the skill's structure and its 'write for a tester' rules:
- a one-line what-this-is and the ticket/PR link;
- Setup / prerequisites (environment, flags, how a tester triggers it, and any environment trap
  called out prominently);
- a Surface matrix as a markdown table (where the feature must and must NOT appear);
- risk-tiered manual test cases grouped P0 / P1 / P2, each numbered and self-contained as a
  '- [ ]' checkbox item with the data needed, ordered steps, and an explicit Pass and Fail;
- a 'Known — please don't file these' section of intentional limitations / out-of-scope surfaces.
Keep every line traceable to the diff, review threads or code, and usable by a tester who has
never opened the repo. Do not post anything to GitHub."

(cd "$wt" && timeout 25m claude -p "$PROMPT" \
  --allowedTools "Bash Read Glob Grep Write" < /dev/null) >"$DIR/qa.log" 2>&1

[ -s "$wt/qa.md" ] || fail "the agent produced no qa.md (see qa.log)"
cp "$wt/qa.md" "$DIR/qa.md"
git -C "$BASE" worktree remove --force "$wt" 2>/dev/null || true
status "done"
echo "[QA $REPO#$PR] done ($(wc -l < "$DIR/qa.md") lines)"

# Tell whoever asked for it (RS_ACTOR, set by the dashboard) that the guide is ready.
ACTOR="${RS_ACTOR:-}"
notify_card qa_ready "$(jq -n --arg repo "$REPO" --arg p "$PR" --arg a "$ACTOR" \
    --arg l "$(signed_link qa "$REPO" "$PR" 604800)" \
    --argjson m "$(cat "$DIR/qa_meta.json")" \
    --arg sid "$(jq -r --arg l "$ACTOR" '.[$l].slack_id // ""' "$ROOT/users.json" 2>/dev/null)" \
    --arg did "$(jq -r --arg l "$ACTOR" '.[$l].discord_id // ""' "$ROOT/users.json" 2>/dev/null)" '
  {repo:$repo, pr:$p, title:$m.title, author:$m.author, url:$m.url, login:$a, slack_id:$sid, discord_id:$did,
   extra:{detail:$l}}')"
