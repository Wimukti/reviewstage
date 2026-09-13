#!/usr/bin/env bash
# poller-loop.sh — run pr-watch.sh on an interval. The in-container replacement for the cron
# entry bootstrap.sh installs on a box: no cron, no systemd.
#
# The interval and an on/off switch come from $ROOT/settings.json (the dashboard's Settings
# page), re-read every cycle so a change applies without a restart: poll_interval_seconds
# (60..3600; falls back to $POLL_INTERVAL, then 180) and poller_enabled (false = sleep and skip).
# Each completed poll stamps $ROOT/poller.last (epoch seconds) for the "last poll at" readout.
#
# flock guards against an overlapping run if one poll outlives the interval. The loop never
# exits on a failed poll — a bad token or a GitHub blip is logged and retried next round.
set -uo pipefail

BIN="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ROOT:-$HOME/.claude-pr-bot}"
SETTINGS_FILE="$ROOT/settings.json"
DEFAULT_INTERVAL="${POLL_INTERVAL:-180}"
LOCK="$ROOT/.pr-watch.lock"
TICK=15   # how often the sleep re-checks settings, so a new interval or a pause applies fast

trap 'echo "==> poller stopping"; exit 0' TERM INT

setting() {   # <key> <default> — settings.json wins; anything unreadable falls back
  local v=""
  [ -s "$SETTINGS_FILE" ] && v=$(jq -r --arg k "$1" '.[$k] // empty' "$SETTINGS_FILE" 2>/dev/null)
  [ -n "$v" ] && echo "$v" || echo "$2"
}
interval() {
  local v; v=$(setting poll_interval_seconds "$DEFAULT_INTERVAL")
  case "$v" in ''|*[!0-9]*) v="$DEFAULT_INTERVAL";; esac
  [ "$v" -lt 60 ] && v=60; [ "$v" -gt 3600 ] && v=3600
  echo "$v"
}

echo "==> ReviewStage poller: pr-watch.sh every $(interval)s (ROOT=$ROOT; Settings can change it)"
paused=0
while :; do
  ts=$(date -u '+%m/%d/%y %H:%M:%S')
  if [ "$(setting poller_enabled true)" = false ]; then
    [ "$paused" = 1 ] || echo "[$ts] poller paused from Settings (poller_enabled=false)"
    paused=1
  elif [ -s "$ROOT/.env" ] && grep -q '^GITHUB_PAT=.\+' "$ROOT/.env"; then
    [ "$paused" = 0 ] || echo "[$ts] poller resumed from Settings"
    paused=0
    flock -n "$LOCK" "$BIN/pr-watch.sh" 2>&1 | sed "s#^#[$ts] #" | tee -a "$ROOT/watch.log"
    date +%s > "$ROOT/poller.last.tmp" && mv "$ROOT/poller.last.tmp" "$ROOT/poller.last"
  else
    echo "[$ts] GITHUB_PAT not set — nothing to poll"
  fi
  # Sleep in short ticks so a shorter interval (or a pause) set in Settings takes effect
  # within TICK seconds instead of after the old, longer interval.
  started=$(date +%s)
  while [ $(( $(date +%s) - started )) -lt "$(interval)" ]; do
    sleep "$TICK" &
    wait $!
  done
done
