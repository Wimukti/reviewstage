#!/usr/bin/env bash
# lib-common.sh — shared config, HMAC link signing, and Slack posting for the review bot.
# Sourced by pr-watch.sh and run-review.sh. Never executed directly.

ROOT="${ROOT:-$HOME/.claude-pr-bot}"
ENV_FILE="$ROOT/.env"

# Secrets live in .env (chmod 600), never in this repo. bootstrap.sh creates it.
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

# --- per-install config ----------------------------------------------------------------------
# All of these come from ~/.claude-pr-bot/.env, which bootstrap.sh writes. None of the
# identity values has a default: the repositories, REVIEWER and PUBLIC_URL are yours alone, so
# require_env fails loudly rather than letting the bot poll someone else's repo or mint dead links.
#
# Repositories: REPOS is a comma / space / newline separated list of owner/name; REPO is still
# accepted as a single-entry alias (both set = union). REPO_ALLOW_ORG additionally accepts any
# repo under that org where a signed-in user gets a review request (discovered by the poller,
# cloned lazily on first review).
REPOS="${REPOS:-}"
REPO="${REPO:-}"
REPO_ALLOW_ORG="${REPO_ALLOW_ORG:-}"
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
REPOS_DIR="$ROOT/repos"           # base clones, one per repo: repos/<owner>__<name>
WT="$ROOT/wt"
STATE="$ROOT/state"               # per-PR job state: state/<owner>__<name>/<pr>
SEEN="$ROOT/seen"                 # notified review requests, keyed <repo>:<pr>:<login>
USED="$ROOT/used-nonces"          # burned approve links (single-use enforcement)

# --- repo dimension --------------------------------------------------------------------------
# Mirrors prbot_paths.py exactly — the two must agree on every path.
# repos_list: one configured owner/name per line (REPOS ∪ REPO), de-duplicated, order kept.
repos_list() {
  printf '%s %s' "$REPOS" "$REPO" | tr ',' ' ' | tr -s '[:space:]' '\n' | sed 's#^https://github.com/##; s#^/##; s#/$##' \
    | awk 'NF && !seen[tolower($0)]++'
}
repo_count() { repos_list | wc -l | tr -d ' '; }
# single_repo: the one configured repo, or empty when zero or several are configured.
single_repo() { [ "$(repo_count)" = 1 ] && repos_list || true; }
valid_repo() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?/[A-Za-z0-9_.-]+$'
}
# repo_allowed <repo>: configured, or under REPO_ALLOW_ORG.
repo_allowed() {
  local r; r=$(printf '%s' "$1" | tr 'A-Z' 'a-z')
  valid_repo "$1" || return 1
  repos_list | tr 'A-Z' 'a-z' | grep -qxF "$r" && return 0
  [ -n "$REPO_ALLOW_ORG" ] && [ "${r%%/*}" = "$(printf '%s' "$REPO_ALLOW_ORG" | tr 'A-Z' 'a-z')" ]
}
repo_slug() { printf '%s' "$1" | sed 's#/#__#'; }
base_dir()  { echo "$REPOS_DIR/$(repo_slug "$1")"; }
prdir()     { echo "$STATE/$(repo_slug "$1")/$2"; }          # prdir <repo> <pr>
udir()      { echo "$(prdir "$1" "$2")/users/$3"; }          # udir <repo> <pr> <login>
# risk_paths_for <repo>: the per-repo RISK_PATHS__<OWNER>__<NAME> override if set, else RISK_PATHS.
# The key is the repo upper-cased with `/` -> `__` and any other non [A-Z0-9_] char -> `_`.
risk_paths_for() {
  local key; key="RISK_PATHS__$(printf '%s' "$1" | tr 'a-z' 'A-Z' | sed 's#/#__#; s/[^A-Z0-9_]/_/g')"
  if [ -n "${!key+x}" ]; then printf '%s' "${!key}"; else printf '%s' "${RISK_PATHS:-}"; fi
}
# ensure_base_clone <repo>: blobless clone into base_dir if missing (lazy, for org-discovered
# repos and for installs that added a repo after bootstrap). Needs GH_TOKEN.
ensure_base_clone() {
  local repo="$1" base; base=$(base_dir "$repo")
  [ -d "$base/.git" ] && return 0
  mkdir -p "$REPOS_DIR"
  echo "cloning $repo (blobless) -> $base"
  gh repo clone "$repo" "$base" -- --filter=blob:none || return 1
  git -C "$base" config credential.helper \
    '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'
}

# Skip bot-authored PRs when 1. Default 0: AI-written PRs are where a skeptical
# review pays off most, and they're the bulk of the queue.
SKIP_BOT_PRS="${SKIP_BOT_PRS:-0}"
# When 1, review but never touch GitHub — Slack only. Phase 3 starts here.
DRY_RUN="${DRY_RUN:-1}"
# Refuse to start a review below this much available RAM (MB). An agent run needs headroom,
# and a small server usually shares the box with whatever else you run on it.
MIN_FREE_MB="${MIN_FREE_MB:-800}"

mkdir -p "$WT" "$STATE" "$REPOS_DIR"; touch "$SEEN" "$USED"

# gh + git both authenticate as $REVIEWER via the PAT, so every comment, review,
# and approval on GitHub is attributed to the human, not a bot account.
export GH_TOKEN="${GITHUB_PAT:-}"

die() { echo "FATAL: $*" >&2; exit 1; }

require_env() {
  [ -n "${GITHUB_PAT:-}" ]   || die "GITHUB_PAT not set in $ENV_FILE"
  [ -n "${PRBOT_SECRET:-}" ] || die "PRBOT_SECRET not set in $ENV_FILE"
  [ -n "${REVIEWER:-}" ]     || die "REVIEWER not set in $ENV_FILE (your GitHub login)"
  [ "$(repo_count)" -ge 1 ]  || die "no repository configured in $ENV_FILE (set REPOS=owner/name[,owner/name…] or REPO=owner/name)"
  local r
  while IFS= read -r r; do
    valid_repo "$r" || die "'$r' in REPOS/REPO is not owner/name shaped"
  done < <(repos_list)
  # Without this every Slack button would point nowhere and fail only later, as a dead link.
  # Catch it at the source instead.
  [ -n "${PUBLIC_URL:-}" ] || [ -n "${PUBLIC_URL_EXPLICIT:-}" ] \
    || die "PUBLIC_URL not set in $ENV_FILE (where browsers reach the dashboard, e.g. https://reviews.example.com)"
}

# --- signed links ----------------------------------------------------------------------------
# Assume ReviewStage is served over the PUBLIC internet with nothing in front of it, so every
# link carries an HMAC over action + repo#pr + expiry. Unsigned or expired links are rejected
# server-side. (Links minted before the repo dimension existed signed action:pr:exp; the server
# keeps accepting those for PRBOT_SIGNATURE_GRACE_DAYS.)
sign() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$PRBOT_SECRET" -r | cut -d' ' -f1; }

# signed_link <action> <repo> <pr> <ttl-seconds>
signed_link() {
  local action="$1" repo="$2" pr="$3" ttl="$4" exp sig
  exp=$(( $(date +%s) + ttl ))
  sig=$(sign "$action:$repo#$pr:$exp")
  echo "$PUBLIC_URL/$action?repo=$(printf '%s' "$repo" | sed 's#/#%2F#')&pr=$pr&exp=$exp&sig=$sig"
}

# dashboard_link [ttl-seconds] — the index page; signed with empty action and pr.
dashboard_link() {
  local ttl="${1:-604800}" exp sig
  exp=$(( $(date +%s) + ttl ))
  sig=$(sign "::$exp")
  echo "$PUBLIC_URL/?exp=$exp&sig=$sig"
}

# --- slack -----------------------------------------------------------------------------------
# slack_post <repo> <pr> [root|reply] [login]   (blocks JSON on stdin; repo+pr may be empty)
#
# With SLACK_BOT_TOKEN + SLACK_CHANNEL set, posts via chat.postMessage — which DOES return a
# message ts, so the review-ready update threads under the review-request card: a "root" post
# stores its ts; a "reply" post sends thread_ts from that file. Reviews are per reviewer, so a
# login keys the ts per user (udir/<login>/slack_ts) — each reviewer gets their own request card
# and their review-ready reply threads under it, never under someone else's. Without a login it
# uses the shared prdir/slack_ts. Without a bot token it falls back to the incoming webhook
# (send-only — a fresh message, no threading).
slack_post() {
  local repo="${1:-}" pr="${2:-}" mode="${3:-}" login="${4:-}" payload; payload=$(cat)
  if [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_CHANNEL:-}" ]; then
    local ts_file="" thread="" body resp
    if [ -n "$pr" ]; then
      [ -n "$login" ] && ts_file="$(udir "$repo" "$pr" "$login")/slack_ts" || ts_file="$(prdir "$repo" "$pr")/slack_ts"
    fi
    [ "$mode" = reply ] && [ -f "$ts_file" ] && thread=$(cat "$ts_file")
    body=$(echo "$payload" | jq --arg ch "$SLACK_CHANNEL" --arg th "$thread" \
      '. + {channel:$ch, text:"ReviewStage PR review"} + (if $th=="" then {} else {thread_ts:$th} end)')
    resp=$(curl -fsS -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
      -H 'Content-type: application/json; charset=utf-8' --data "$body" \
      https://slack.com/api/chat.postMessage 2>/dev/null)
    if [ "$(echo "$resp" | jq -r '.ok' 2>/dev/null)" = true ]; then
      if [ "$mode" = root ] && [ -n "$ts_file" ]; then
        mkdir -p "$(dirname "$ts_file")"; echo "$resp" | jq -r '.ts' > "$ts_file"
      fi
    else
      echo "WARN: slack chat.postMessage failed: $(echo "$resp" | jq -r '.error // "?"')" >&2
    fi
    return 0
  fi
  [ -n "${SLACK_WEBHOOK:-}" ] || { echo "(no SLACK_WEBHOOK; skipping notify)"; return 0; }
  echo "$payload" | curl -fsS -X POST -H 'Content-type: application/json' \
    --data @- "$SLACK_WEBHOOK" >/dev/null 2>&1 || echo "WARN: slack post failed" >&2
}

have_free_mem() {
  local free_mb
  free_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  [ "${free_mb:-0}" -ge "$MIN_FREE_MB" ]
}
