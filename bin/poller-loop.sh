#!/usr/bin/env bash
# poller-loop.sh — run pr-watch.sh every POLL_INTERVAL seconds (default 180). The in-container
# replacement for the cron entry bootstrap.sh installs on a box: no cron, no systemd.
#
# flock guards against an overlapping run if one poll outlives the interval. The loop never
# exits on a failed poll — a bad token or a GitHub blip is logged and retried next round.
set -uo pipefail

BIN="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ROOT:-$HOME/.claude-pr-bot}"
INTERVAL="${POLL_INTERVAL:-180}"
LOCK="$ROOT/.pr-watch.lock"

trap 'echo "==> poller stopping"; exit 0' TERM INT

echo "==> ReviewStage poller: pr-watch.sh every ${INTERVAL}s (ROOT=$ROOT)"
while :; do
  ts=$(date -u '+%m/%d/%y %H:%M:%S')
  if [ -s "$ROOT/.env" ] && grep -q '^GITHUB_PAT=.\+' "$ROOT/.env"; then
    flock -n "$LOCK" "$BIN/pr-watch.sh" 2>&1 | sed "s#^#[$ts] #" | tee -a "$ROOT/watch.log"
  else
    echo "[$ts] GITHUB_PAT not set — nothing to poll"
  fi
  sleep "$INTERVAL" &
  wait $!
done
