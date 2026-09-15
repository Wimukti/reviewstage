#!/usr/bin/env bash
# run-qa.sh <owner/name> <pr-number> — build a QA test guide for one PR with the pr-qa-guide skill.
#
# Spawned detached by server.py from the QA guide page. Writes progress to
# $(prdir <repo> <pr>)/qa.status and the finished guide (GitHub-flavored markdown) to qa.md there.
# Never writes to GitHub — it only reads the PR (diff, review threads, history) and produces a
# guide the human hands to QA, then pings the requester (notify_card qa_ready).
#
# Two things this script owns that the agent cannot do for itself:
#   1. It gathers the evidence. The agent runs with every GitHub credential stripped from its
#      environment (lib-common.sh, agent_env), so `gh` is dead inside it. The PR body, the review
#      threads and the commit history are fetched HERE and written into the worktree as
#      .rs-pr-context.md, which the prompt tells the agent to read first. Without this the UI's
#      promise — a guide built "from this PR's diff, review threads and history" — was false.
#   2. It inlines the skill. Naming a skill in a prompt does nothing when the Skill tool is not
#      allowed; the body goes into the prompt verbatim, exactly as run-review.sh does.
set -uo pipefail
. "$(dirname "$0")/lib-common.sh"

if [ $# -eq 1 ] && [ -n "$(single_repo)" ]; then set -- "$(single_repo)" "$1"; fi
REPO="${1:?usage: run-qa.sh <owner/name> <pr-number>}"
PR="${2:?usage: run-qa.sh <owner/name> <pr-number>}"
valid_repo "$REPO" || die "'$REPO' is not owner/name shaped"
case "$PR" in ''|*[!0-9]*) die "'$PR' is not a PR number";; esac
DIR=$(prdir "$REPO" "$PR")
mkdir -p "$DIR" || die "cannot create $DIR"
# Every die() below this line also lands in qa.status, so a run that dies before its first
# status() (a broken .env, a repo this install does not review) shows the reason on the page
# instead of an empty spinner.
set_status_file "$DIR/qa.status"
require_env
repo_allowed "$REPO" || die "$REPO is not a repository this install reviews (REPOS / REPO_ALLOW_ORG)"
BASE=$(base_dir "$REPO")
ACTOR="${RS_ACTOR:-}"
# A QA guide lock separate from the review lock, so a QA build and a review can't collide but a
# review being open never blocks generating a guide.
exec 9>"$DIR/.qa.lock"
flock -n 9 || { echo "QA guide for $REPO#$PR already running"; exit 0; }

status() {
  printf '%s\n' "$1" > "$DIR/qa.status" 2>/dev/null \
    || echo "[QA $REPO#$PR] WARN: cannot write $DIR/qa.status (disk full?)" >&2
  echo "[QA $REPO#$PR] $1"
}

# A failed QA run used to notify nobody — unlike a failed review — so the requester waited for a
# Slack card that was never coming. Same card as run-review.sh, labelled as the QA job.
notify_fail() {
  notify_card review_stopped "$(jq -n --arg repo "$REPO" --arg p "$PR" --arg m "QA guide: $1" \
      --arg a "$ACTOR" --arg u "https://github.com/$REPO/pull/$PR" \
      --arg sid "$(jq -r --arg l "$ACTOR" '.[$l].slack_id // ""' "$ROOT/users.json" 2>/dev/null)" \
      --arg did "$(jq -r --arg l "$ACTOR" '.[$l].discord_id // ""' "$ROOT/users.json" 2>/dev/null)" '
    {repo:$repo, pr:$p, url:$u, login:$a, slack_id:$sid, discord_id:$did,
     extra:{status:"failed", job:"QA guide", message:$m}}')"
}
fail() { status "failed: $1"; notify_fail "$1"; exit 1; }

# The worktree and its qa-<pr> branch go away on every exit path, failures included.
WT_PATH=""; WT_BRANCH=""
cleanup() {
  [ -n "$WT_PATH" ] && { git -C "$BASE" worktree remove --force "$WT_PATH" >/dev/null 2>&1 \
                           || rm -rf "$WT_PATH"; }
  [ -n "$WT_BRANCH" ] && git -C "$BASE" branch -D "$WT_BRANCH" >/dev/null 2>&1
  [ -n "$WT_PATH" ] && git -C "$BASE" worktree prune >/dev/null 2>&1
  return 0
}
trap cleanup EXIT

have_free_mem || fail "not enough free memory to start"
have_free_disk "$ROOT" || fail "not enough free disk to start (MIN_FREE_DISK_MB=$MIN_FREE_DISK_MB)"
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || fail "connect your Claude account in the dashboard to generate a QA guide"

status "fetching the PR"
meta=$(gh pr view "$PR" --repo "$REPO" \
        --json headRefName,headRefOid,baseRefName,title,url,author,body,additions,deletions,changedFiles,files \
        2>/dev/null) || fail "PR not found"
branch=$(echo "$meta" | jq -r .headRefName)
base_branch=$(echo "$meta" | jq -r '.baseRefName // ""')
[ -n "$branch" ] && [ "$branch" != null ] || fail "the PR has no head branch"
case "$branch" in -*) fail "refusing a head branch name that starts with '-'";; esac
case "$base_branch" in -*) base_branch="";; null) base_branch="";; esac
# Cache identity so the QA page keeps the title after the PR leaves the review queue.
echo "$meta" | jq --arg n "$PR" --arg r "$REPO" \
  '{repo:$r, number:($n|tonumber), title, url, author:.author.login,
    head:(.headRefOid // ""), additions, deletions, changedFiles}' \
  > "$DIR/qa_meta.json.tmp" && mv "$DIR/qa_meta.json.tmp" "$DIR/qa_meta.json" \
  || fail "cannot write $DIR/qa_meta.json (disk full?)"

# A QA guide is heavier than a Deep review: it reads the diff, the review history AND the
# surrounding code, then writes a long document. 25m was a hardcoded guess that truncated large
# PRs. Size it from the change, the way the dashboard sizes review effort. RS_QA_TIMEOUT wins.
changed=$(echo "$meta" | jq -r '.changedFiles // 0')
adds=$(echo "$meta" | jq -r '.additions // 0')
case "$changed$adds" in ''|*[!0-9]*) changed=0; adds=0;; esac
if [ "$changed" -le 5 ] && [ "$adds" -le 200 ]; then QA_TIMEOUT=25m
elif [ "$changed" -le 40 ] && [ "$adds" -le 2000 ]; then QA_TIMEOUT=40m
else QA_TIMEOUT=60m; fi
QA_TIMEOUT="${RS_QA_TIMEOUT:-$QA_TIMEOUT}"

# One heavy job at a time, box-wide — taken BEFORE the fetch below, or two jobs collide on the
# shared base clone's .git/index.lock.
status "queued — waiting for another job to finish"
exec 8>"$ROOT/review.lock"
flock -w 3600 8 || fail "another job held the box lock for over an hour"
have_free_mem || fail "not enough free memory to start"
have_free_disk "$ROOT" || fail "not enough free disk to start (MIN_FREE_DISK_MB=$MIN_FREE_DISK_MB)"

status "checking out the branch"
[ -d "$BASE/.git" ] || ensure_base_clone "$REPO" >>"$ROOT/clone.log" 2>&1 \
  || fail "could not clone $REPO (see $ROOT/clone.log)"
# `--` before the branch: it comes from the GitHub API and must never be read as an option.
git -C "$BASE" fetch -q origin -- "$branch" || fail "could not fetch $branch"
[ -n "$base_branch" ] && git -C "$BASE" fetch -q origin -- "$base_branch" 2>/dev/null
wt="$WT/qa-$(repo_slug "$REPO")-$PR"
git -C "$BASE" worktree remove --force "$wt" 2>/dev/null || true
git -C "$BASE" worktree prune >/dev/null 2>&1 || true
git -C "$BASE" worktree add -q --force -B "qa-$PR" "$wt" "origin/$branch" \
  || fail "could not create worktree"
WT_PATH="$wt"; WT_BRANCH="qa-$PR"

# --- evidence the agent cannot fetch for itself -------------------------------------------------
status "gathering review threads and history"
CTX="$wt/.rs-pr-context.md"
{
  echo "# Evidence for $REPO#$PR"
  echo
  echo "Gathered by ReviewStage before the agent started. This is the PR conversation and"
  echo "history: the agent has no network and no \`gh\`, so this file is the only source for them."
  echo
  echo "$meta" | jq -r '
    "## PR\n\n- title: " + .title + "\n- author: @" + (.author.login // "") +
    "\n- url: " + .url + "\n- base branch: " + (.baseRefName // "") +
    "\n- head: " + (.headRefOid // "") +
    "\n- size: " + ((.changedFiles // 0)|tostring) + " files, +" +
      ((.additions // 0)|tostring) + " -" + ((.deletions // 0)|tostring) +
    "\n\n### Description\n\n" + ((.body // "") | if . == "" then "_(empty)_" else . end) +
    "\n\n### Changed files\n\n" + ([.files[]?.path] | map("- " + .) | join("\n"))'
  echo
  echo "## Review conversation"
  echo
  gh pr view "$PR" --repo "$REPO" --json comments,reviews 2>/dev/null | jq -r '
    (([.reviews[]? | select((.body // "") != "")
       | "### Review by @" + (.author.login // "?") + " (" + (.state // "") + ")\n\n" + .body]
      + [.comments[]? | "### Comment by @" + (.author.login // "?") + "\n\n" + (.body // "")])
     | if length == 0 then ["_No review comments._"] else . end | join("\n\n"))' \
    || echo "_Could not fetch the review conversation._"
  echo
  echo "## Inline review threads"
  echo
  gh api "repos/$REPO/pulls/$PR/comments?per_page=100" 2>/dev/null | jq -r '
    (map("### " + (.path // "?") + ":" + ((.line // .original_line // 0)|tostring) +
         " - @" + (.user.login // "?") + "\n\n" + (.body // ""))
     | if length == 0 then ["_No inline review threads._"] else . end | join("\n\n"))' \
    || echo "_Could not fetch inline review threads._"
  echo
  echo "## Commit history of the branch"
  echo
  if [ -n "$base_branch" ]; then
    git -C "$wt" log --no-merges --date=short \
      --pretty='- %h %ad %an: %s' "origin/$base_branch..HEAD" 2>/dev/null \
      || git -C "$wt" log -30 --pretty='- %h %an: %s' 2>/dev/null
  else
    git -C "$wt" log -30 --pretty='- %h %an: %s' 2>/dev/null
  fi
} > "$CTX" 2>/dev/null || fail "cannot write the evidence file (disk full?)"
[ -s "$CTX" ] || fail "the evidence file came out empty (disk full?)"

status "building the QA guide"
rm -f "$wt/qa.md"
HERE="$(cd "$(dirname "$0")" && pwd)"
# The skill body is INLINED. Before this it was only named in the prompt while --allowedTools
# did not include Skill, so the agent never saw a word of it and improvised a guide.
SKILL_FILE="${RS_QA_SKILL:-$HERE/../skills/pr-qa-guide/SKILL.md}"
[ -s "$SKILL_FILE" ] || fail "skills/pr-qa-guide/SKILL.md is missing next to $HERE"
APPROACH="$(skill_body "$SKILL_FILE")"
[ -n "$APPROACH" ] || fail "the pr-qa-guide skill is empty"

DIFF_HINT="git diff origin/${base_branch:-HEAD}...HEAD"
PROMPT="Build a QA test guide for PR #$PR of $REPO. You are in a checkout of the PR's head
branch. Follow this method:

$APPROACH

--- HOW THIS RUN DIFFERS FROM THE METHOD ABOVE ---

You are running headless. There is no Artifact tool and no publishing step: ignore every
instruction about HTML, artifacts or artifact-design. The deliverable is ONE markdown file.

You also have no network and no \`gh\`. Everything the method tells you to fetch from GitHub —
the PR description, the review conversation, the inline review threads, the commit history — has
already been gathered for you in ./.rs-pr-context.md. READ THAT FILE FIRST; it is your review
history and your risk map. For the diff itself run \`$DIFF_HINT\` in this checkout, and read the
surrounding code with Read/Glob/Grep as the method requires.

OUTPUT CONTRACT — write the guide to ./qa.md as GitHub-flavored markdown, with exactly these
sections, in this order:

  # <feature name> — QA guide
  one line saying what this is, plus the PR link.
  ## Before you start
  prerequisites: exact flag/setting names in \`code\` style, the test data needed, the
  viewports/portals to cover, and any environment trap — lead with the trap if the obvious
  approach ruins the test.
  ## How to run it
  only when the thing under test is not triggered by ordinary clicking: the admin tool, the
  exact button, what a developer must run.
  ## Surface matrix
  a markdown table: Surface | Shows it? | Detail — including the deliberate 'No' rows.
  ## P0 — Test these first
  ## P1 — Does the feature work
  ## P2 — Check nothing else broke
  each tier a section of '- [ ] N. <plain-language outcome>' checkbox items, numbered
  continuously across all three tiers, each self-contained with the data needed, ordered steps,
  and an explicit Pass and Fail.
  ## Known — please don't file these
  intentional limitations and out-of-scope surfaces, sourced from the PR conversation.
  ## Escalate immediately
  the one failure worth escalating on the spot and what to capture for it, then
  'Guide last checked against branch head <sha>'.

The last line of the file must be exactly:
<!-- rs:end -->
That marker is how ReviewStage knows the guide is complete rather than cut off mid-write, so
write it only once the whole guide above is on disk.

Keep every line traceable to the diff, the evidence file or the code, and usable by a tester who
has never opened the repo. Do not post anything to GitHub."

# Prompt on stdin, not argv — see run-review.sh. agent_env strips every GitHub credential
# (lib-common.sh): this job reads a checkout and a file, and must not be able to write to the PR.
# The agent's own output goes to qa_agent.log: server.py holds qa.log open in append mode for
# this script's own stdout, and the old `> "$DIR/qa.log"` truncated it out from under the server
# — which is why a failed guide's log was both unreachable and half missing.
agent_env_args
# stream-json, exactly as run-review.sh runs it: it is the only way to learn what the run cost.
# A QA build is a full agent run on the clicker's own Claude account and it reported NOTHING —
# no model, no tokens, no duration — so a guide that quietly burned an hour of someone's usage
# left no trace on the page or in the rollup.
(cd "$wt" && printf '%s' "$PROMPT" | "${AGENT_ENV[@]}" timeout "$QA_TIMEOUT" claude -p \
  --output-format stream-json --verbose \
  --allowedTools "Bash Read Glob Grep Write" \
  --disallowedTools "$AGENT_DENY_TOOLS") >"$DIR/qa_agent.log" 2>&1
rc=$?

# Token usage + model. Best-effort: no qa_usage.json simply means the page omits the usage line.
# Written BEFORE the completeness gates below, so a timed-out or truncated guide still accounts
# for what it spent.
qa_usage_line=$(grep -a '"type":"result"' "$DIR/qa_agent.log" | tail -1 || true)
qa_init_line=$(grep -a '"subtype":"init"' "$DIR/qa_agent.log" | head -1 || true)
if [ -n "$qa_usage_line" ]; then
  qa_model=$(printf '%s' "$qa_init_line" | jq -r '.model // empty' 2>/dev/null || true)
  [ -n "$qa_model" ] || qa_model=$(printf '%s' "$qa_usage_line" \
      | jq -r '(.modelUsage // {}) | keys[0] // empty' 2>/dev/null || true)
  printf '%s' "$qa_usage_line" | jq -c --arg model "${qa_model:-unknown}" '{
      model: $model,
      input_tokens: (.usage.input_tokens // 0),
      output_tokens: (.usage.output_tokens // 0),
      cache_read_input_tokens: (.usage.cache_read_input_tokens // 0),
      cache_creation_input_tokens: (.usage.cache_creation_input_tokens // 0),
      cost_usd: (.total_cost_usd // 0),
      duration_ms: (.duration_ms // 0)
    }' > "$DIR/qa_usage.json" 2>/dev/null || rm -f "$DIR/qa_usage.json"
fi

# The exit code used to be thrown away, and `[ -s qa.md ]` was the only gate — so a run killed by
# `timeout` at 60% handed QA a guide that stopped mid-sentence, announced as "Guide ready".
[ "$rc" = 124 ] && fail "the guide timed out after $QA_TIMEOUT — try again, or split the PR (see qa_agent.log)"
[ -s "$wt/qa.md" ] || fail "the agent produced no qa.md (exit $rc, see qa_agent.log)"
[ "$rc" = 0 ] || fail "the agent exited $rc before finishing the guide (see qa_agent.log)"

# Completeness, not just non-emptiness: the mandated end marker plus the three tiers and at
# least one checkbox. A truncated guide fails at least one of these.
qa_missing=""
add_missing() { qa_missing="${qa_missing:+$qa_missing, }$1"; }
tail -3 "$wt/qa.md" | grep -qF '<!-- rs:end -->' || add_missing "the end-of-guide marker"
grep -q '^## P0' "$wt/qa.md" || add_missing "the P0 section"
grep -q '^## P1' "$wt/qa.md" || add_missing "the P1 section"
grep -q '^## P2' "$wt/qa.md" || add_missing "the P2 section"
grep -q -- '- \[ \]' "$wt/qa.md" || add_missing "any test case"
grep -qi '^## Known' "$wt/qa.md" || add_missing "the known-non-defects section"
[ -z "$qa_missing" ] || fail "the guide is incomplete — missing $qa_missing (see qa_agent.log)"

copy_file "$wt/qa.md" "$DIR/qa.md" || fail "cannot write $DIR/qa.md (disk full?)"
cleanup; WT_PATH=""; WT_BRANCH=""
status "done"
echo "[QA $REPO#$PR] done ($(wc -l < "$DIR/qa.md") lines, $QA_TIMEOUT budget)"

# Tell whoever asked for it (RS_ACTOR, set by the dashboard) that the guide is ready.
notify_card qa_ready "$(jq -n --arg repo "$REPO" --arg p "$PR" --arg a "$ACTOR" \
    --arg l "$(signed_link qa "$REPO" "$PR" 604800)" \
    --argjson m "$(cat "$DIR/qa_meta.json")" \
    --arg sid "$(jq -r --arg l "$ACTOR" '.[$l].slack_id // ""' "$ROOT/users.json" 2>/dev/null)" \
    --arg did "$(jq -r --arg l "$ACTOR" '.[$l].discord_id // ""' "$ROOT/users.json" 2>/dev/null)" '
  {repo:$repo, pr:$p, title:$m.title, author:$m.author, url:$m.url, login:$a, slack_id:$sid, discord_id:$did,
   extra:{detail:$l}}')"
