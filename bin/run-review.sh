#!/usr/bin/env bash
# run-review.sh <owner/name> <pr-number> — review one PR and park the result for the dashboard.
#
# Spawned detached by server.py when "Open review" / "Re-run" is clicked. Writes
# progress to $(udir <repo> <pr> <actor>)/status so the detail page can report it.
#
# This script NEVER writes to GitHub. It produces review.json; the human then selects and
# edits findings in the dashboard and posts from there. Approval is a separate click again.
set -uo pipefail
. "$(dirname "$0")/lib-common.sh"
require_env

# Backward compatibility: a single argument is a PR number in the one configured repo.
if [ $# -eq 1 ] && [ -n "$(single_repo)" ]; then set -- "$(single_repo)" "$1"; fi
REPO="${1:?usage: run-review.sh <owner/name> <pr-number>}"
PR="${2:?usage: run-review.sh <owner/name> <pr-number>}"
repo_allowed "$REPO" || die "$REPO is not a repository this install reviews (REPOS / REPO_ALLOW_ORG)"
BASE=$(base_dir "$REPO")
# Reviews are per reviewer: each person's run + review.json live under users/<actor>, so one
# reviewer running never touches (or blocks) another's. Only meta.json (PR title/author/size,
# identical for everyone) stays shared in PRDIR.
PRDIR=$(prdir "$REPO" "$PR")
ACTOR="${PRBOT_ACTOR:-}"
DIR="$PRDIR"
[ -n "$ACTOR" ] && DIR="$PRDIR/users/$ACTOR"
mkdir -p "$DIR"
exec 9>"$DIR/.lock"
flock -n 9 || { echo "review for $REPO#$PR already running"; exit 0; }

status() { echo "$1" > "$DIR/status"; echo "[$REPO#$PR] $1"; }
fail() { status "failed: $1"; notify_fail "$1"; exit 1; }

notify_fail() {
  notify_card review_stopped "$(jq -n --arg repo "$REPO" --arg p "$PR" --arg m "$1" --arg a "$ACTOR" \
      --arg u "https://github.com/$REPO/pull/$PR" \
      --arg sid "$(jq -r --arg l "$ACTOR" '.[$l].slack_id // ""' "$ROOT/users.json" 2>/dev/null)" \
      --arg did "$(jq -r --arg l "$ACTOR" '.[$l].discord_id // ""' "$ROOT/users.json" 2>/dev/null)" '
    {repo:$repo, pr:$p, url:$u, login:$a, slack_id:$sid, discord_id:$did,
     extra:{status:"failed", message:$m}}')"
}

have_free_mem || fail "not enough free memory to start a review"
# Reviews run on the clicker's OWN Claude account — never the shared box login. The dashboard
# gates on this, so this is defence in depth.
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || fail "connect your Claude account in the dashboard to review"

# Review effort — how deep the agent goes. The dashboard sets PRBOT_EFFORT (auto-sized from the
# diff, human-overridable). It changes only two things: the timeout, and a depth instruction
# appended to the prompt. Everything else about the run is identical.
EFFORT="${PRBOT_EFFORT:-standard}"
# The dashboard passes the depth instruction (PRBOT_DEPTH), editable per team on the Skills page.
# The built-in text here is only a fallback for a direct/older invocation. Only the timeout is
# decided by the level.
case "$EFFORT" in
  quick) TIMEOUT=12m; FALLBACK="Effort: QUICK — look only at the diff, report clear bugs, be fast.";;
  deep)  TIMEOUT=40m; FALLBACK="Effort: DEEP — search the whole repo for impact, trace data flow, cover perf/security.";;
  *)     EFFORT=standard; TIMEOUT=25m; FALLBACK="Effort: STANDARD — changed files + context, correctness and clear risks.";;
esac
DEPTH="${PRBOT_DEPTH:-$FALLBACK}"
# Optional model override chosen at trigger time (validated server-side). Empty = account default.
MODEL="${PRBOT_MODEL:-}"
MODEL_ARG=()
[ -n "$MODEL" ] && MODEL_ARG=(--model "$MODEL")
echo "$EFFORT" > "$DIR/effort"

status "fetching"
meta=$(gh pr view "$PR" --repo "$REPO" \
        --json headRefName,headRefOid,title,url,author,createdAt,updatedAt,additions,deletions,changedFiles,files \
        2>/dev/null) || fail "PR not found"
branch=$(echo "$meta" | jq -r .headRefName)
title=$(echo "$meta"  | jq -r .title)
url=$(echo "$meta"    | jq -r .url)
# Cache the PR's identity next to the review. queue.json only holds PRs currently awaiting
# review, so once you submit (or the request moves to someone else) the PR drops out of it —
# without this the dashboard would lose the title of a review you just ran.
echo "$meta" | jq --arg n "$PR" --arg r "$REPO" '{repo:$r, number:($n|tonumber), title, url,
     author:.author.login, createdAt, updatedAt, additions, deletions, changedFiles}' \
  > "$PRDIR/meta.json"
# Record the head SHA this review ran against, so the dashboard can flag the review as stale
# once the author pushes new commits (a new head SHA) — without auto-spending tokens to re-run.
echo "$meta" | jq -r .headRefOid > "$DIR/head"
# Risk-area labels for a context banner in the dashboard — a path-based heuristic that says
# "this touches an area the team has flagged, look harder". Never a gate, never routing.
# RISK_PATHS (in .env) is a comma-separated list of `label:pattern` rules; a rule matches when
# any changed path equals the glob or contains the substring. Empty (the default) = feature off.
# A per-repo RISK_PATHS__<OWNER>__<NAME> replaces the global list for that repo (risk_paths_for).
paths=$(echo "$meta" | jq -r '.files[]?.path // empty' 2>/dev/null)
risk=""
# Repository profile (bin/profile-repo.sh → $ROOT/profiles/<slug>/profile.json): its risk_paths
# merge into the banner rules (the operator's rule wins on a shared label), and for Standard and
# Deep runs the critical paths the PR touches become a prompt section below (PROFILE_BLOCK).
HERE="$(cd "$(dirname "$0")" && pwd)"
PROFILE_JSON="$ROOT/profiles/$(repo_slug "$REPO")/profile.json"
PROFILE_BLOCK=""
RULES="$(risk_paths_for "$REPO")"
if [ -s "$PROFILE_JSON" ]; then
  RULES=$(PYTHONPATH="$HERE" ROOT="$ROOT" python3 "$HERE/rs_profile.py" risk "$REPO" "$RULES" \
            2>/dev/null || printf '%s' "$RULES")
  PROFILE_BLOCK=$(printf '%s\n' "$paths" | PYTHONPATH="$HERE" ROOT="$ROOT" \
            python3 "$HERE/rs_profile.py" block "$REPO" "$EFFORT" 2>/dev/null || true)
  [ -n "$PROFILE_BLOCK" ] && echo "[$REPO#$PR] profile: critical-path section added ($EFFORT)"
fi
IFS=',' read -ra RISK_RULES <<< "$RULES"
for rule in "${RISK_RULES[@]+"${RISK_RULES[@]}"}"; do
  rule="${rule#"${rule%%[![:space:]]*}"}"; rule="${rule%"${rule##*[![:space:]]}"}"
  [ -n "$rule" ] || continue
  if [[ "$rule" == *:* ]]; then label="${rule%%:*}"; pat="${rule#*:}"; else label="$rule"; pat="$rule"; fi
  label=$(printf '%s' "$label" | tr -c 'A-Za-z0-9_-' '_')
  [ -n "$label" ] && [ -n "$pat" ] || continue
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    # shellcheck disable=SC2053  # $pat is a glob on purpose
    if [[ "$p" == $pat ]] || [[ "$p" == *"$pat"* ]]; then
      case " $risk " in *" $label "*) ;; *) risk+="$label ";; esac
      break
    fi
  done <<< "$paths"
done
echo "$risk" | xargs > "$DIR/risk" 2>/dev/null || true

# Base clones live under $ROOT/repos, in $HOME — deliberately outside any directory a deploy or
# sync job of yours might rsync over, which would otherwise wipe a worktree mid-review. A repo
# accepted via REPO_ALLOW_ORG (or added after bootstrap) is cloned here on first use.
status "checking out the branch"
[ -d "$BASE/.git" ] || ensure_base_clone "$REPO" >>"$ROOT/clone.log" 2>&1 \
  || fail "could not clone $REPO (see $ROOT/clone.log)"
git -C "$BASE" fetch -q origin "$branch" || fail "could not fetch $branch"
slug="${ACTOR:-shared}"
wt="$WT/$(repo_slug "$REPO")-$PR-$slug"   # per repo + reviewer — no cross-reviewer collisions
git -C "$BASE" worktree remove --force "$wt" 2>/dev/null || true
git -C "$BASE" worktree add -q --force -B "review-$PR-$slug" "$wt" "origin/$branch" \
  || fail "could not create worktree"

# One review at a time, box-wide. The per-PR lock above stops duplicates of the SAME review;
# this one stops two DIFFERENT reviews from sharing a box that OOMs with two agents on it.
# The dashboard shows "reviewing" (the per-PR lock is held) with this text as the status.
status "queued — waiting for another review to finish"
exec 8>"$ROOT/review.lock"
flock 8

status "reviewing the diff"
# Whose Claude account this runs on: the dashboard sets PRBOT_RUN_AS (and, for a connected
# user, CLAUDE_CODE_OAUTH_TOKEN) when it spawns us. Recorded so the page can say so.
echo "${PRBOT_RUN_AS:-shared}" > "$DIR/runner"
echo "[$REPO#$PR] running on: ${PRBOT_RUN_AS:-shared}"
rm -f "$DIR/cached"          # a fresh run replaces any reused (cached) result
rm -f "$wt/review.json"
# Learnings: findings reviewers have dropped as noise or reworded — same-repo rows first, then
# the team's general preferences — so the agent stops re-raising rejected ones. Empty on a fresh
# box. Rendered by rs_learn.py (beside us).
LEARN=$(PYTHONPATH="$HERE" ROOT="$ROOT" python3 -c \
  'import rs_learn,sys;sys.stdout.write(rs_learn.render(sys.argv[1]))' "$REPO" 2>/dev/null)

# Which review skill, in order: a per-repo override of the team default
# ($ROOT/skills/repos/<owner>__<name>/SKILL.md), else the clicker's own if they brought one, else
# the editable team default ($ROOT/skills/_global.md, maintained from the dashboard), else the
# installed pr-review skill. Record the id next to the review so learnings can score each skill by
# how many findings get kept. ACTOR is set at the top (it selects the per-user DIR).
REPO_SKILL="$ROOT/skills/repos/$(repo_slug "$REPO")/SKILL.md"
USER_SKILL="$ROOT/skills/$ACTOR.md"
GLOBAL_SKILL="$ROOT/skills/_global.md"
# The dashboard's active-skill choice: "own" uses the clicker's skill if present, "team" forces
# the shared default even when they have their own on file.
CHOICE="${PRBOT_SKILL_CHOICE:-own}"
FOCUS="${PRBOT_FOCUS:-}"
FOCUSBLOCK=""
[ -n "$FOCUS" ] && FOCUSBLOCK="

The reviewer specifically asked you to focus on the following — prioritise it alongside the skill,
and if it turns out not to apply, say so briefly in the analysis:
$FOCUS"

# Stack context (PRBOT_STACK): when this PR is part of a stack, the diff shows only its own
# changes, so tell the agent the sibling PRs exist to avoid false "undefined/missing" findings.
STACK="${PRBOT_STACK:-}"
STACKBLOCK=""
[ -n "$STACK" ] && STACKBLOCK="

$STACK"
# The output contract — spelled out here so ANY skill (custom or global) yields the exact
# review.json the dashboard needs, independent of whether the skill itself defines the format.
CONTRACT="Do NOT print a table and do NOT post anything to GitHub. Write your findings to
./review.json as a single JSON object: {\"event\":\"COMMENT\",
\"summary\":\"the bottom line in 1-2 SHORT sentences — the verdict and why, NOT a wall of text\",
\"keyPoints\":[\"3 to 5 very short scannable bullets: the most important things a reviewer should
know about this PR, each ONE plain sentence in everyday language, no jargon or symbol names\"],
\"explainer\":\"what this PR does, as 3 to 6 SHORT markdown bullet points (each a '- ' line, one
plain sentence) — NOT a paragraph\",
\"analysis\":\"what you verified and what you deliberately skipped, as terse markdown bullets — keep
it tight, no long prose\", \"comments\":[{
\"path\":\"file\", \"line\":123, \"severity\":\"blocker|should-fix|nit|question\", \"title\":
\"a short plain-language headline a JUNIOR engineer would understand at a glance — no jargon, no
symbol names, say what is wrong in everyday words\", \"impact\":\"ONE plain sentence: who is
affected and what actually breaks for them (an end user, an operator, a partner) — the real-world
consequence, not the code mechanism\", \"body\":
\"the detailed technical explanation and the concrete failing scenario, in markdown — this is the
comment posted to GitHub, so write it for the PR author\", \"reply_to\":null, \"suggestion\":null,
\"confidence\":\"high|medium|low\", \"critical_path\":null}]}. The title and impact are shown to a reviewer skimming the
dashboard so they can understand and sign off on each finding WITHOUT reading the whole PR — keep
them jargon-free and self-contained; the body stays the full technical comment.
Set \"confidence\" to how sure you are the finding is real and worth raising — low-confidence
findings are shown to the reviewer in a separate collapsed \"maybe\" tray, so use it honestly
rather than dropping a borderline point. \"critical_path\" is optional: set it to the exact glob
from the 'Critical paths for this repository' section when the finding concerns one of those
paths, else leave it null. When a finding has a concrete,
correct fix that replaces the SINGLE line you set in \"line\", put the exact replacement line
(matching its indentation) in \"suggestion\" — the reviewer can post it as a one-click GitHub
suggestion. Only when confident and single-line; otherwise leave \"suggestion\" null. A human skims summary/keyPoints/explainer/analysis in a dashboard — write them SHORT and
scannable (point form, plain language), not long prose — then selects, edits and posts individual
comments. Keep findings few and high-confidence.${LEARN}"

if [ -s "$REPO_SKILL" ]; then
  echo "repo:$(repo_slug "$REPO")" > "$DIR/skill"; APPROACH="$(cat "$REPO_SKILL")"
  echo "[$REPO#$PR] skill: team default for $REPO (repo override)"
elif [ "$CHOICE" != team ] && [ -n "$ACTOR" ] && [ -f "$USER_SKILL" ]; then
  echo "$ACTOR" > "$DIR/skill"; APPROACH="$(cat "$USER_SKILL")"
  echo "[$REPO#$PR] skill: $ACTOR's own"
elif [ -f "$GLOBAL_SKILL" ]; then
  echo "global" > "$DIR/skill"; APPROACH="$(cat "$GLOBAL_SKILL")"
  echo "[$REPO#$PR] skill: team default"
else
  echo "global" > "$DIR/skill"; APPROACH=""
  echo "[$REPO#$PR] skill: installed pr-review skill"
fi

if [ -n "$APPROACH" ]; then
  PROMPT="Review PR #$PR of $REPO. Follow this reviewing approach:

$APPROACH
$DEPTH
$FOCUSBLOCK$STACKBLOCK$PROFILE_BLOCK

$CONTRACT"
else
  PROMPT="Use the pr-review skill to review PR #$PR of $REPO. Follow its Step 7 automation mode.
$DEPTH
$FOCUSBLOCK$STACKBLOCK$PROFILE_BLOCK
${CONTRACT}"
fi

(cd "$wt" && timeout "$TIMEOUT" claude -p "$PROMPT" \
  ${MODEL_ARG[@]+"${MODEL_ARG[@]}"} \
  --output-format stream-json --verbose \
  --allowedTools "Bash Read Glob Grep Write" < /dev/null) >"$DIR/agent.log" 2>&1

[ -s "$wt/review.json" ] || fail "agent produced no review.json (see $DIR/agent.log)"
jq -e . "$wt/review.json" >/dev/null 2>&1 || fail "review.json is not valid JSON"
# Copy out before the worktree is removed — this is the artefact the dashboard renders.
cp "$wt/review.json" "$DIR/review.json"

# Token usage + model, parsed from the stream-json log. Best-effort: if anything is missing or
# unparseable we simply write no usage.json and the dashboard omits the usage line.
usage_line=$(grep -a '"type":"result"' "$DIR/agent.log" | tail -1 || true)
init_line=$(grep -a '"subtype":"init"' "$DIR/agent.log" | head -1 || true)
if [ -n "$usage_line" ]; then
  model=$(printf '%s' "$init_line" | jq -r '.model // empty' 2>/dev/null || true)
  [ -n "$model" ] || model=$(printf '%s' "$usage_line" \
      | jq -r '(.modelUsage // {}) | keys[0] // empty' 2>/dev/null || true)
  printf '%s' "$usage_line" | jq -c --arg model "${model:-unknown}" '{
      model: $model,
      input_tokens: (.usage.input_tokens // 0),
      output_tokens: (.usage.output_tokens // 0),
      cache_read_input_tokens: (.usage.cache_read_input_tokens // 0),
      cache_creation_input_tokens: (.usage.cache_creation_input_tokens // 0),
      cost_usd: (.total_cost_usd // 0),
      duration_ms: (.duration_ms // 0)
    }' > "$DIR/usage.json" 2>/dev/null || rm -f "$DIR/usage.json"
fi

# Phase 1 — write this result to the per-user content-addressed cache (if the server keyed it).
CACHE_KEY="${PRBOT_CACHE_KEY:-}"
if [ -n "$CACHE_KEY" ]; then
  mkdir -p "$DIR/cache"
  usage_json="null"; [ -s "$DIR/usage.json" ] && usage_json=$(cat "$DIR/usage.json")
  jq -n --slurpfile r "$DIR/review.json" --argjson u "$usage_json" \
        --arg risk "$(cat "$DIR/risk" 2>/dev/null || true)" \
        --arg skill "$(cat "$DIR/skill" 2>/dev/null || echo global)" \
        --arg head "$(cat "$DIR/head" 2>/dev/null || true)" \
        --arg eff "${EFFORT:-}" --arg foc "${FOCUS:-}" --arg mdl "${MODEL:-}" \
        --argjson created "$(date +%s)" '
        {review:$r[0], usage:$u, risk:$risk, skill:$skill, head:$head,
         effort:$eff, focus:$foc, model:$mdl, created_at:$created}' \
    > "$DIR/cache/$CACHE_KEY.json" 2>/dev/null || rm -f "$DIR/cache/$CACHE_KEY.json"
fi
git -C "$BASE" worktree remove --force "$wt" 2>/dev/null || true

# Ping ONLY the person who triggered this run — your run, your ping. The drafted review is
# shared (any requested reviewer can open it), but starting a run must not ping other reviewers
# as if their own review were done. Slack / Discord IDs come from users.json; no id => no ping.
sid=""; did=""
if [ -n "$ACTOR" ]; then
  sid=$(jq -r --arg l "$ACTOR" '.[$l].slack_id // ""' "$ROOT/users.json" 2>/dev/null)
  did=$(jq -r --arg l "$ACTOR" '.[$l].discord_id // ""' "$ROOT/users.json" 2>/dev/null)
fi

event=$(jq -r '.event // "COMMENT"' "$DIR/review.json")
n=$(jq '.comments | length' "$DIR/review.json")
blockers=$(jq '[.comments[]? | select(.severity == "blocker")] | length' "$DIR/review.json")
summary=$(jq -r '.summary // ""' "$DIR/review.json" | head -c 2500)
detail=$(signed_link pr "$REPO" "$PR" 604800)
author=$(echo "$meta" | jq -r '.author.login // ""')
status "done ($n findings)"

notify_card review_ready "$(jq -n --arg repo "$REPO" --arg t "$title" --arg u "$url" --arg p "$PR" \
      --arg s "$summary" --arg e "$event" --argjson n "$n" --argjson b "$blockers" --arg l "$detail" \
      --arg a "$author" --arg login "$ACTOR" --arg sid "$sid" --arg did "$did" '
  {repo:$repo, pr:$p, title:$t, author:$a, url:$u, login:$login, slack_id:$sid, discord_id:$did,
   extra:{event:$e, findings:$n, blockers:$b, summary:$s, detail:$l}}')"
