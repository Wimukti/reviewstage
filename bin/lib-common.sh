#!/usr/bin/env bash
# lib-common.sh — shared config, HMAC link signing, and notifications for the review bot.
# Sourced by pr-watch.sh and run-review.sh. Never executed directly.

ROOT="${ROOT:-$HOME/.claude-pr-bot}"
ENV_FILE="$ROOT/.env"

# Secrets live in .env (chmod 600), never in this repo. bootstrap.sh creates it.
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

# --- per-install config ----------------------------------------------------------------------
# All of these come from ~/.claude-pr-bot/.env, which bootstrap.sh writes. None of the
# identity values has a default: REPO, REVIEWER and PUBLIC_URL are yours alone, so require_env
# fails loudly rather than letting the bot poll someone else's repo or mint dead links.
REPO="${REPO:-}"                         # the GitHub repository to review, as owner/name
REVIEWER="${REVIEWER:-}"                 # your GitHub login; the PAT must belong to it
# Where browsers reach the dashboard, e.g. https://reviews.example.com — the one hostname your
# reverse proxy forwards to 127.0.0.1:$PRBOT_PORT. Every Slack button is built from it.
# Older installs set PRBOT_ENV + PRBOT_DOMAIN instead (host prbot-<env>.<domain>); that pair
# is still honoured so an existing .env keeps working. Record whether PUBLIC_URL was set
# explicitly BEFORE the derived value fills it in, so the guard below can still fire.
PRBOT_ENV="${PRBOT_ENV:-}"
PRBOT_DOMAIN="${PRBOT_DOMAIN:-}"
PUBLIC_URL_EXPLICIT="${PUBLIC_URL:+1}"
if [ -z "${PUBLIC_URL:-}" ] && [ -n "$PRBOT_ENV" ] && [ -n "$PRBOT_DOMAIN" ]; then
  PRBOT_HOST="${PRBOT_HOST:-prbot-${PRBOT_ENV}.${PRBOT_DOMAIN}}"
  PUBLIC_URL="https://$PRBOT_HOST"
fi
PUBLIC_URL="${PUBLIC_URL%/}"
# shellcheck disable=SC2034  # consumed by scripts that source this file
BASE="$ROOT/repo"                 # base clone; review worktrees branch off it
WT="$ROOT/wt"
STATE="$ROOT/state"               # per-PR job state, one dir per PR
SEEN="$ROOT/seen"                 # notified review requests, keyed <pr>:<head-sha>
USED="$ROOT/used-nonces"          # burned approve links (single-use enforcement)

# Skip bot-authored PRs when 1. Default 0: AI-written PRs are where a skeptical
# review pays off most, and they're the bulk of the queue.
SKIP_BOT_PRS="${SKIP_BOT_PRS:-0}"
# When 1, review but never touch GitHub — Slack only. Phase 3 starts here.
DRY_RUN="${DRY_RUN:-1}"
# Refuse to start a review below this much available RAM (MB). An agent run needs headroom,
# and a small server usually shares the box with whatever else you run on it.
MIN_FREE_MB="${MIN_FREE_MB:-800}"

mkdir -p "$WT" "$STATE"; touch "$SEEN" "$USED"

# gh + git both authenticate as $REVIEWER via the PAT, so every comment, review,
# and approval on GitHub is attributed to the human, not a bot account.
export GH_TOKEN="${GITHUB_PAT:-}"

die() { echo "FATAL: $*" >&2; exit 1; }

require_env() {
  [ -n "${GITHUB_PAT:-}" ]   || die "GITHUB_PAT not set in $ENV_FILE"
  [ -n "${PRBOT_SECRET:-}" ] || die "PRBOT_SECRET not set in $ENV_FILE"
  [ -n "${REVIEWER:-}" ]     || die "REVIEWER not set in $ENV_FILE (your GitHub login)"
  [ -n "${REPO:-}" ]         || die "REPO not set in $ENV_FILE (the repository to review, owner/name)"
  # Without this every Slack button would point nowhere and fail only later, as a dead link.
  # Catch it at the source instead.
  [ -n "${PUBLIC_URL:-}" ] || [ -n "${PUBLIC_URL_EXPLICIT:-}" ] \
    || die "PUBLIC_URL not set in $ENV_FILE (where browsers reach the dashboard, e.g. https://reviews.example.com)"
}

# --- signed links ----------------------------------------------------------------------------
# Assume ReviewStage is served over the PUBLIC internet with nothing in front of it, so every
# link carries an HMAC over action+pr+expiry. Unsigned or expired links are rejected server-side.
sign() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$PRBOT_SECRET" -r | cut -d' ' -f1; }

# signed_link <action> <pr> <ttl-seconds>
signed_link() {
  local action="$1" pr="$2" ttl="$3" exp sig
  exp=$(( $(date +%s) + ttl ))
  sig=$(sign "$action:$pr:$exp")
  echo "$PUBLIC_URL/$action?pr=$pr&exp=$exp&sig=$sig"
}

# dashboard_link [ttl-seconds] — the index page; signed with empty action and pr.
dashboard_link() {
  local ttl="${1:-604800}" exp sig
  exp=$(( $(date +%s) + ttl ))
  sig=$(sign "::$exp")
  echo "$PUBLIC_URL/?exp=$exp&sig=$sig"
}

# --- notifications ---------------------------------------------------------------------------
# slack_post and the multi-backend notify_card live in notify.sh (Slack, Discord, generic
# webhook). It also applies the runtime overrides from $ROOT/settings.json (lib-settings.sh) —
# the dashboard's Settings page — so those win over the .env values loaded above.
# shellcheck source=notify.sh
. "$(dirname "${BASH_SOURCE[0]}")/notify.sh"

have_free_mem() {
  local free_mb
  free_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  [ "${free_mb:-0}" -ge "$MIN_FREE_MB" ]
}
