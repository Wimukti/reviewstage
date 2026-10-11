#!/usr/bin/env bash
# run-disproof.sh <owner/name> <pr-number> <worktree> <run-dir> <mode> — the disproof pass
# (trust-and-plain §2.1): a second Claude run, on the SAME account and through the SAME
# agent_env / deny list as the main pass, with the opposite brief. It reads
# <run-dir>/review.json, asks the agent to disprove the selected findings against the
# checked-out code in <worktree>, and writes the verdicts back into review.json as
# `checked = {verdict, reason, at}` per finding plus a review-level `disproof` record.
#
# Called by run-review.sh after the main pass, while the worktree still exists. It NEVER fails
# the review: every error path records `disproof.status = failed` and exits 0. It NEVER writes
# to GitHub — run-review.sh fingerprints the PR after this script returns, exactly as it does
# after the main pass. Mode: default (blockers and should-fixes), all, off.
set -uo pipefail
. "$(dirname "$0")/lib-common.sh"

REPO="${1:?usage: run-disproof.sh <owner/name> <pr-number> <worktree> <run-dir> <mode>}"
PR="${2:?usage: run-disproof.sh <owner/name> <pr-number> <worktree> <run-dir> <mode>}"
WTREE="${3:?worktree}"
DIR="${4:?run-dir}"
MODE="${5:-default}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/disproof.log"
REVIEW="$DIR/review.json"

say() { echo "[$REPO#$PR] disproof: $1"; }
# The merge step is the only writer of review.json here; `merge` with a status other than
# `done` records the failure and leaves every finding unchecked.
record() {  # record <status> <duration_ms> [indices]
  PYTHONPATH="$HERE" python3 "$HERE/rs_disproof.py" merge "$REVIEW" "$WTREE/disproof.json" \
    "$MODE" "$1" "$2" ${3:+"$3"} 2>>"$LOG"
}

case "$MODE" in default|all) ;; *) say "off"; exit 0;; esac
[ -s "$REVIEW" ] || { say "no review.json"; exit 0; }
[ -d "$WTREE" ] || { say "no worktree at $WTREE"; record failed 0 >/dev/null; exit 0; }
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { say "no Claude account"; record failed 0 >/dev/null; exit 0; }

# What to check and the brief, from the normalised review (rs_disproof.select).
sel=$(RS_REPO="$REPO" RS_PR="$PR" PYTHONPATH="$HERE" \
      python3 "$HERE/rs_disproof.py" select "$REVIEW" "$MODE" 2>>"$LOG") \
  || { say "could not select findings (see $LOG)"; record failed 0 >/dev/null; exit 0; }
n=$(printf '%s' "$sel" | jq -r '.n // 0')
if [ "${n:-0}" -eq 0 ]; then
  say "nothing to check ($MODE)"
  record skipped 0 "" >/dev/null
  exit 0
fi
indices=$(printf '%s' "$sel" | jq -r '.indices | map(tostring) | join(",")')
timeout_s=$(printf '%s' "$sel" | jq -r '.timeout_s // 300')
BRIEF=$(printf '%s' "$sel" | jq -r '.prompt')
SKILL_FILE="$HERE/../skills/pr-disproof/SKILL.md"
APPROACH=""
[ -f "$SKILL_FILE" ] && APPROACH="$(skill_body "$SKILL_FILE")"
PROMPT="Second pass on PR #$PR of $REPO. Follow this brief:

$APPROACH

$BRIEF"

MODEL="${RS_MODEL:-}"
MODEL_ARG=()
[ -n "$MODEL" ] && MODEL_ARG=(--model "$MODEL")

say "checking $n finding(s) ($MODE mode, up to ${timeout_s}s)"
rm -f "$WTREE/disproof.json"
start_ms=$(python3 -c 'import time;print(int(time.time()*1000))')
# Same launch as the main pass: the prompt on stdin, every GitHub credential stripped by
# agent_env, the deny list as the second barrier (lib-common.sh).
agent_env_args
(cd "$WTREE" && printf '%s' "$PROMPT" | "${AGENT_ENV[@]}" timeout "${timeout_s}s" claude -p \
  ${MODEL_ARG[@]+"${MODEL_ARG[@]}"} \
  --output-format stream-json --verbose \
  --allowedTools "Bash Read Glob Grep Write" \
  --disallowedTools "$AGENT_DENY_TOOLS") >"$LOG" 2>&1
rc=$?
end_ms=$(python3 -c 'import time;print(int(time.time()*1000))')
dur=$((end_ms - start_ms))

if [ "$rc" = 124 ]; then
  say "timed out after ${timeout_s}s"
  record timeout "$dur" "$indices" >/dev/null
  exit 0
fi
if [ ! -s "$WTREE/disproof.json" ]; then
  say "the agent wrote no disproof.json (exit $rc, see $LOG)"
  record failed "$dur" "$indices" >/dev/null
  exit 0
fi
counts=$(record done "$dur" "$indices") || { say "could not merge the verdicts (see $LOG)"; exit 0; }
say "$counts (${dur}ms)"
# Local counters, from the closed vocabulary: how many stood, weakened, were refuted, or got no
# usable answer. Never the finding. Best effort — a counter must never fail a run.
for kv in $counts; do
  k="${kv%%=*}"; v="${kv#*=}"
  [ "${v:-0}" -gt 0 ] 2>/dev/null \
    && PYTHONPATH="$HERE" ROOT="$ROOT" python3 "$HERE/rs_telemetry.py" bump disproof_run \
         verdict="$k" --n "$v" >/dev/null 2>&1 || true
done
exit 0
