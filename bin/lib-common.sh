#!/usr/bin/env bash
# lib-common.sh — shared config, HMAC link signing, and notifications for the review bot.
# Sourced by pr-watch.sh and run-review.sh. Never executed directly.

ROOT="${ROOT:-$HOME/.reviewstage}"
ENV_FILE="$ROOT/.env"

# Secrets live in .env (chmod 600), never in this repo. bootstrap.sh creates it.
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

# --- per-install config ----------------------------------------------------------------------
# All of these come from ~/.reviewstage/.env, which bootstrap.sh writes. None of the
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
# reverse proxy forwards to 127.0.0.1:$RS_PORT. Every Slack button is built from it.
# Older installs set RS_ENV + RS_DOMAIN instead (host reviewstage-<env>.<domain>); that pair
# is still honoured so an existing .env keeps working. Record whether PUBLIC_URL was set
# explicitly BEFORE the derived value fills it in, so the guard below can still fire.
RS_ENV="${RS_ENV:-}"
RS_DOMAIN="${RS_DOMAIN:-}"
PUBLIC_URL_EXPLICIT="${PUBLIC_URL:+1}"
if [ -z "${PUBLIC_URL:-}" ] && [ -n "$RS_ENV" ] && [ -n "$RS_DOMAIN" ]; then
  RS_HOST="${RS_HOST:-reviewstage-${RS_ENV}.${RS_DOMAIN}}"
  PUBLIC_URL="https://$RS_HOST"
fi
PUBLIC_URL="${PUBLIC_URL%/}"
# shellcheck disable=SC2034  # consumed by scripts that source this file
REPOS_DIR="$ROOT/repos"           # base clones, one per repo: repos/<owner>__<name>
WT="$ROOT/wt"
STATE="$ROOT/state"               # per-PR job state: state/<owner>__<name>/<pr>
SEEN="$ROOT/seen"                 # notified review requests, keyed <repo>:<pr>:<login>
USED="$ROOT/used-nonces"          # burned approve links (single-use enforcement)

# --- repo dimension --------------------------------------------------------------------------
# Mirrors rs_paths.py exactly — the two must agree on every path.
# repos_list: one configured owner/name per line (REPOS ∪ REPO), de-duplicated, order kept.
#
# The list is SNAPSHOT at load time, before any caller can touch REPO. run-review.sh, run-qa.sh
# and profile-repo.sh all assign `REPO="$1"` — the repo they were asked to work on — and that fed
# straight back into this function: the repo under test was therefore always in its own
# allowlist, so repo_allowed could never fail inside a job script, and on a multi-repo install an
# org-discovered repo also flipped repo_count and mislabelled every notification card.
_repos_list_from() {
  printf '%s %s' "$1" "$2" | tr ',' ' ' | tr -s '[:space:]' '\n' \
    | sed 's#^https://github.com/##; s#^/##; s#/$##' | awk 'NF && !seen[tolower($0)]++'
}
RS_REPOS_CONFIGURED="$(_repos_list_from "$REPOS" "$REPO")"
repos_list() { [ -n "$RS_REPOS_CONFIGURED" ] && printf '%s\n' "$RS_REPOS_CONFIGURED" || true; }
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
# …and below this much free disk on $ROOT (MB). A full volume used to be a SILENT success: the
# agent wrote nothing, every `>` redirection failed unnoticed and the dashboard announced a
# ready review with no findings. Guard at the front, and check every write that matters.
MIN_FREE_DISK_MB="${MIN_FREE_DISK_MB:-500}"

# free_mem_mb — memory available to THIS container/host, in MB, or "" when unknowable.
#
# Docker is the primary install, and inside a container /proc/meminfo is the HOST's memory: on
# any box bigger than the container limit the guard could never fire and the agent was
# OOM-killed instead of being told to wait. The cgroup v2 files are the container's own budget,
# so they come first; v1 next; only then the host view, for a bare-metal install.
free_mem_mb() {
  local max cur
  if [ -r /sys/fs/cgroup/memory.max ] && [ -r /sys/fs/cgroup/memory.current ]; then
    max=$(cat /sys/fs/cgroup/memory.max 2>/dev/null)
    cur=$(cat /sys/fs/cgroup/memory.current 2>/dev/null)
    case "$max$cur" in ''|*[!0-9]*) max="" ;; esac   # "max" (unlimited) or unreadable
    if [ -n "$max" ] && [ "$max" -gt 0 ] 2>/dev/null; then
      echo $(( (max - cur) / 1048576 )); return 0
    fi
  fi
  if [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ] \
     && [ -r /sys/fs/cgroup/memory/memory.usage_in_bytes ]; then
    max=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)
    cur=$(cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null)
    case "$max$cur" in ''|*[!0-9]*) max="" ;; esac
    # v1 reports a sentinel near 2^63 when there is no limit; under 1 TB is a real cap.
    if [ -n "$max" ] && [ "$max" -gt 0 ] 2>/dev/null && [ "$max" -lt 1099511627776 ]; then
      echo $(( (max - cur) / 1048576 )); return 0
    fi
  fi
  if [ -r /proc/meminfo ]; then
    awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo
  elif command -v free >/dev/null 2>&1; then
    free -m 2>/dev/null | awk '/^Mem:/ {print ($7 != "" ? $7 : $4)}'
  fi
}

# have_free_mem — 0 when at least MIN_FREE_MB of RAM is available, 1 otherwise. On a platform
# with no readable source (macOS) it returns 0 rather than blocking every review.
have_free_mem() {
  local free_mb; free_mb=$(free_mem_mb)
  case "$free_mb" in
    ''|*[!0-9]*) return 0 ;;   # unknown platform: skip rather than block
  esac
  if [ "$free_mb" -lt "$MIN_FREE_MB" ]; then
    echo "==> low memory: ${free_mb} MB available, MIN_FREE_MB=${MIN_FREE_MB}" >&2
    return 1
  fi
  return 0
}

# have_free_disk [dir] — 0 when at least MIN_FREE_DISK_MB is free where we write, 1 otherwise.
have_free_disk() {
  local dir="${1:-$ROOT}" free_mb=""
  [ -d "$dir" ] || dir="$(dirname "$dir")"
  free_mb=$(df -Pm "$dir" 2>/dev/null | awk 'NR==2 {print $4}')
  case "$free_mb" in
    ''|*[!0-9]*) return 0 ;;
  esac
  if [ "$free_mb" -lt "$MIN_FREE_DISK_MB" ]; then
    echo "==> low disk: ${free_mb} MB free on $dir, MIN_FREE_DISK_MB=${MIN_FREE_DISK_MB}" >&2
    return 1
  fi
  return 0
}

# --- the agent's environment -------------------------------------------------------------------
# WHY THIS EXISTS. "The review step has no GitHub write path at all" is a design property, and it
# used to be enforced only by a sentence in the prompt. The agent got unrestricted Bash and
# inherited GH_TOKEN — a write-scoped PAT belonging to the human reviewer — so anything the agent
# READ (the PR description, a CLAUDE.md, a test fixture) could talk it into
# `gh pr review N --approve`, and the approval would land under the reviewer's own identity. The
# same environment also held the reviewer's Claude OAuth token and the install's HMAC secret,
# both exfiltratable with one curl.
#
# So the agent runs with every credential-shaped variable removed. The job scripts fetch the PR
# metadata and check out the branch themselves BEFORE the agent starts; the agent never needs gh.
#
# CLAUDE_CODE_OAUTH_TOKEN is the one secret that stays. The `claude` CLI takes that credential
# only from the environment — there is no --token flag and no per-run credentials path — so
# dropping it would make every review run on the box account, breaking "reviews run on the
# clicking user's connected Claude account". It authorises Claude, not GitHub: it cannot post.
AGENT_SCRUB_VARS=(
  GH_TOKEN GITHUB_TOKEN GITHUB_PAT GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN
  GH_HOST GH_REPO GH_PATH GH_CLIENT_ID GH_CLIENT_SECRET GITHUB_WEBHOOK_SECRET
  GIT_ASKPASS SSH_ASKPASS GIT_CONFIG_PARAMETERS SSH_AUTH_SOCK
  RS_SECRET SLACK_BOT_TOKEN SLACK_WEBHOOK SLACK_CHANNEL DISCORD_WEBHOOK
  WEBHOOK_URL WEBHOOK_SECRET
)

# Tools the agent may never reach, whatever the prompt or a file it reads says. The env scrub
# above is the real barrier; this is the second one, and it also keeps an honest agent from
# wasting a turn discovering that gh is dead.
# shellcheck disable=SC2034  # consumed by the job scripts that source this file
AGENT_DENY_TOOLS="Bash(gh:*) Bash(git push:*) Bash(git remote:*) Bash(git config:*) \
Bash(curl:*) Bash(wget:*) Bash(nc:*) Bash(ssh:*) Bash(scp:*) Bash(env:*) Bash(printenv:*) \
WebFetch WebSearch"

# agent_env — the NUL-separated `env …` prefix to launch an agent with. Unsets every credential
# above and points GH_CONFIG_DIR at an empty directory, so a gh call inside the agent finds
# neither a token in the environment nor the box owner's stored login: it fails unauthenticated.
agent_env() {
  local empty="$ROOT/agent-gh-config" v
  mkdir -p "$empty" 2>/dev/null || true
  printf '%s\0' env
  for v in "${AGENT_SCRUB_VARS[@]}"; do printf '%s\0%s\0' -u "$v"; done
  printf '%s\0%s\0' "GH_CONFIG_DIR=$empty" "GIT_TERMINAL_PROMPT=0"
}

# agent_env_args — fill the global array AGENT_ENV with that prefix. A fixed array name rather
# than a nameref: `local -n` needs bash 4.3 and the test suite runs on macOS bash 3.2.
AGENT_ENV=()
agent_env_args() {
  AGENT_ENV=()
  local x
  while IFS= read -r -d '' x; do AGENT_ENV+=("$x"); done < <(agent_env)
}

# --- write guards ------------------------------------------------------------------------------
# A failed write is a real failure, not a quiet one. The job scripts deliberately do not run
# under `set -e` (they handle their own errors), so every write the dashboard later reads goes
# through one of these and is followed by `|| fail …`.
write_file() { printf '%s\n' "$2" > "$1" 2>/dev/null; }
copy_file()  { cp "$1" "$2" 2>/dev/null && [ -s "$2" ]; }

# --- skill files -----------------------------------------------------------------------------
# skill_body <file>: the file with a leading YAML front-matter block (a `---` … `---` header)
# removed. Every SKILL.md starts with one; embedded verbatim in a prompt it would put `---` on the
# first line, and if that prompt ever reaches a CLI as an argument it is parsed as an option
# (`error: unknown option '---'`). An unterminated header is printed as-is rather than eaten.
skill_body() {
  awk '
    NR == 1 && /^---[[:space:]]*$/ { fm = 1; next }
    fm == 1 { if (/^---[[:space:]]*$/) { fm = 2 } else { buf[++n] = $0 }; next }
    { print }
    END { if (fm == 1) { print "---"; for (i = 1; i <= n; i++) print buf[i] } }
  ' "$1"
}

mkdir -p "$WT" "$STATE" "$REPOS_DIR"; touch "$SEEN" "$USED"

# gh + git both authenticate as $REVIEWER via the PAT, so every comment, review,
# and approval on GitHub is attributed to the human, not a bot account.
export GH_TOKEN="${GITHUB_PAT:-}"

# RS_STATUS_FILE — the status file of the job currently running, set by each job script as soon
# as it knows its own directory. Without it a run that died BEFORE its first status() (a bad
# .env, a repo_allowed failure) left the status file empty: the dashboard spun for 90 seconds
# and then showed a "stalled" card with an empty log tail, the same as a hang. Now every exit
# path — die, and each script's fail — records the reason where the page will read it.
RS_STATUS_FILE="${RS_STATUS_FILE:-}"

# set_status_file <path> — route die()'s message to this job's status file from here on.
set_status_file() { RS_STATUS_FILE="$1"; }

die() {
  echo "FATAL: $*" >&2
  [ -n "$RS_STATUS_FILE" ] && printf 'failed: %s\n' "$*" > "$RS_STATUS_FILE" 2>/dev/null
  exit 1
}

require_env() {
  [ -n "${GITHUB_PAT:-}" ]   || die "GITHUB_PAT not set in $ENV_FILE"
  [ -n "${RS_SECRET:-}" ] || die "RS_SECRET not set in $ENV_FILE"
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
# keeps accepting those for RS_SIGNATURE_GRACE_DAYS.)
sign() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$RS_SECRET" -r | cut -d' ' -f1; }

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

# --- notifications ---------------------------------------------------------------------------
# slack_post and the multi-backend notify_card live in notify.sh (Slack, Discord, generic
# webhook). It also applies the runtime overrides from $ROOT/settings.json (lib-settings.sh) —
# the dashboard's Settings page — so those win over the .env values loaded above.
# shellcheck source=notify.sh
. "$(dirname "${BASH_SOURCE[0]}")/notify.sh"
