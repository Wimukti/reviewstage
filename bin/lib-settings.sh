#!/usr/bin/env bash
# lib-settings.sh — runtime settings the dashboard's Settings page writes to $ROOT/settings.json.
# Sourced by lib-common.sh (after .env). Never executed directly.
#
# Precedence everywhere: settings.json > .env > built-in default. Only keys PRESENT in the file
# override, so an install that never opened Settings behaves exactly as its .env says.
#
#   setting <key> [default]   → the raw jq value (strings unquoted, arrays as JSON) or default
#   setting_list <key>        → an array setting as a comma-separated list ("" when unset)

SETTINGS_FILE="${SETTINGS_FILE:-$ROOT/settings.json}"

setting() {
  local key="$1" default="${2:-}" v
  [ -s "$SETTINGS_FILE" ] || { echo "$default"; return 0; }
  # `has` rather than `//`: a saved false must win over the default, and jq's // would drop it.
  v=$(jq -r --arg k "$key" 'if has($k) and .[$k] != null then .[$k] else empty end
        | if type=="array" or type=="object" then tojson else . end' "$SETTINGS_FILE" 2>/dev/null)
  [ -n "$v" ] && echo "$v" || echo "$default"
}

setting_list() {
  [ -s "$SETTINGS_FILE" ] || return 0
  jq -r --arg k "$1" 'if has($k) and .[$k] != null then .[$k] else empty end
    | if type=="array" then join(",") else . end' "$SETTINGS_FILE" 2>/dev/null
}

# Apply the overrides the shell side honours. The .env names are kept so pr-watch.sh and
# lib-common.sh read them unchanged (PRBOT_MAX_PR_AGE_DAYS → MAX_AGE_DAYS, SKIP_BOT_PRS).
# shellcheck disable=SC2034  # consumed by the scripts that source lib-common.sh
_v=$(setting max_pr_age_days)
[ -n "$_v" ] && PRBOT_MAX_PR_AGE_DAYS="$_v"
_v=$(setting skip_bot_prs)
# shellcheck disable=SC2034
case "$_v" in true) SKIP_BOT_PRS=1;; false) SKIP_BOT_PRS=0;; esac
_v=$(setting_list notify_backends)
# shellcheck disable=SC2034
[ -n "$_v" ] && NOTIFY_BACKENDS="$_v"
unset _v
