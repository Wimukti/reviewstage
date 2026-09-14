#!/usr/bin/env bash
# profile-repo.sh <owner/name> [--signals-only] — build the repository profile one review reads.
#
# Spawned detached by server.py from the Skills page ("Profile this repo"), or by
# pr-watch.sh when auto-profiling notices the file tree changed. Writes progress to
# $ROOT/profiles/<owner>__<name>/status; the finished profile lands next to it as profile.json +
# profile.md (see rs_profile.py for the schema and the on-disk layout).
#
# Two stages. First, DETERMINISTIC signals with no model call: tree, languages, manifests,
# CODEOWNERS, CI config names, top files by churn and by in-degree, critical-looking directories.
# Then ONE `claude -p` call (Sonnet by default, RS_MODEL overrides) with skills/repo-profile.
# Every path_glob the model returns is validated against the tree; hallucinated ones are dropped
# and logged. `--signals-only` prints the gathered JSON and exits 0 without touching Claude —
# for tests and for seeing what the model would see.
#
# Runs on the clicking user's Claude account exactly like run-review.sh: the server sets
# CLAUDE_CODE_OAUTH_TOKEN; without it this refuses. Never writes to GitHub.
set -uo pipefail
. "$(dirname "$0")/lib-common.sh"
require_env

REPO="${1:?usage: profile-repo.sh <owner/name> [--signals-only]}"
SIGNALS_ONLY=0
[ "${2:-}" = "--signals-only" ] && SIGNALS_ONLY=1
repo_allowed "$REPO" || die "$REPO is not a repository this install reviews (REPOS / REPO_ALLOW_ORG)"
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE=$(base_dir "$REPO")
PDIR="$ROOT/profiles/$(repo_slug "$REPO")"
mkdir -p "$PDIR"
# Its own lock: a profile build must never block, or be blocked by, a review of the same repo.
exec 9>"$PDIR/.lock"
flock -n 9 || { echo "profile for $REPO already running"; exit 0; }

# In --signals-only mode stdout is the JSON, so progress goes to stderr there.
status() {
  echo "$1" > "$PDIR/status"
  if [ "$SIGNALS_ONLY" = 1 ]; then echo "[profile $REPO] $1" >&2; else echo "[profile $REPO] $1"; fi
}
fail() { status "failed: $1"; exit 1; }
py() { PYTHONPATH="$HERE" ROOT="$ROOT" python3 "$HERE/rs_profile.py" "$@"; }

if [ "$SIGNALS_ONLY" = 0 ]; then
  have_free_mem || fail "not enough free memory to start"
  [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] \
    || fail "connect your Claude account in the dashboard to profile a repository"
fi

status "fetching the repository"
if ! git -C "$BASE" rev-parse --git-dir >/dev/null 2>&1; then
  ensure_base_clone "$REPO" >>"$ROOT/clone.log" 2>&1 \
    || fail "could not clone $REPO (see $ROOT/clone.log)"
fi
# Churn needs history and the tree must be current; a blobless clone fetches file contents
# lazily, so the in-degree pass reads only what it needs. Best-effort: profile what we have.
git -C "$BASE" fetch -q origin 2>/dev/null || true
git -C "$BASE" pull -q --ff-only 2>/dev/null || true

status "gathering signals"
t0=$(date +%s)
if [ "$SIGNALS_ONLY" = 1 ]; then
  py signals "$BASE" "$REPO" || fail "could not gather signals"
  echo "[profile $REPO] signals gathered in $(( $(date +%s) - t0 ))s" >&2
  exit 0
fi
py signals "$BASE" "$REPO" > "$PDIR/signals.json" || fail "could not gather signals"
echo "[profile $REPO] signals gathered in $(( $(date +%s) - t0 ))s"

SKILL="$HERE/../skills/repo-profile/SKILL.md"
[ -s "$SKILL" ] || fail "skills/repo-profile/SKILL.md is missing next to $HERE"
# Front-matter off (skill_body) — the prompt must never begin with `---`.
skill_body "$SKILL" > "$PDIR/skill.md"
PROMPT=$(py prompt "$PDIR/signals.json" "$PDIR/skill.md") || fail "could not build the prompt"
MODEL="${RS_MODEL:-sonnet}"
echo "$MODEL" > "$PDIR/model"

# One heavy agent at a time on the box, shared with reviews and QA guides.
status "queued — waiting for another job to finish"
exec 8>"$ROOT/review.lock"
flock 8

status "asking the model (one call)"
echo "${RS_RUN_AS:-shared}" > "$PDIR/runner"
# Read-only tools only, cwd = the base clone, so the model can confirm a path before naming it
# but cannot write anywhere. One prompt, one reply; the JSON is the reply text. The prompt goes
# in on stdin (`claude -p` reads it when no positional prompt is given): it can never be taken
# for an option and there is no argv length limit.
(cd "$BASE" && printf '%s' "$PROMPT" | timeout 15m claude -p --model "$MODEL" \
  --output-format stream-json --verbose --max-turns 25 \
  --allowedTools "Read Glob Grep") >"$PDIR/agent.log" 2>&1

result_line=$(grep -a '"type":"result"' "$PDIR/agent.log" | tail -1 || true)
[ -n "$result_line" ] || fail "the model produced no result (see $PDIR/agent.log)"
printf '%s' "$result_line" | jq -r '.result // ""' > "$PDIR/reply.txt"
init_line=$(grep -a '"subtype":"init"' "$PDIR/agent.log" | head -1 || true)
model=$(printf '%s' "$init_line" | jq -r '.model // empty' 2>/dev/null || true)
[ -n "$model" ] || model=$(printf '%s' "$result_line" \
    | jq -r '(.modelUsage // {}) | keys[0] // empty' 2>/dev/null || true)
printf '%s' "$result_line" | jq -c --arg model "${model:-$MODEL}" '{
    model: $model,
    input_tokens: (.usage.input_tokens // 0),
    output_tokens: (.usage.output_tokens // 0),
    cache_read_input_tokens: (.usage.cache_read_input_tokens // 0),
    cache_creation_input_tokens: (.usage.cache_creation_input_tokens // 0),
    cost_usd: (.total_cost_usd // 0),
    duration_ms: (.duration_ms // 0)
  }' > "$PDIR/usage.json" 2>/dev/null || rm -f "$PDIR/usage.json"

status "validating paths against the tree"
py finish "$REPO" "$BASE" "$PDIR/reply.txt" "$PDIR/usage.json" 2>>"$PDIR/agent.log" \
  || fail "the model's reply was not a usable profile (see $PDIR/agent.log)"
# The tree fingerprint pr-watch.sh compares against for auto re-profiling — a fresh profile
# resets the baseline.
git -C "$BASE" ls-files | sort > "$PDIR/tree.paths" 2>/dev/null || true
status "done"
