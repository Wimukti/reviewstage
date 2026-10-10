#!/usr/bin/env bash
# doctor.sh — read-only diagnostics for a ReviewStage install. Prints one PASS / WARN / FAIL
# line per check and exits non-zero if anything FAILed. Writes nothing (the one "writable?"
# probe creates and removes a temp file in STATE).
#
#   bin/doctor.sh                         from a checkout, a box, or a Compose project dir
#   docker compose exec app doctor        inside the running container
#   docker compose run --rm app doctor    a throwaway container sharing the data volume
#   npx reviewstage --doctor              the desktop install (RS_DOCTOR_DESKTOP=1, tools on PATH)
#
# Flags: --json   {"checks":[{id,status,text,note?}],"fails":n,"warns":n} instead of lines
#        --live   also probe GitHub and Claude with the stored tokens, and the sign-in hosts
#                 (the default run makes no network call beyond loopback and never decrypts)
#        --strict exit 2 when anything WARNed (0 all pass, 1 any FAIL, otherwise)
#
# Personal mode (npx reviewstage, RS_PERSONAL=1 or a desktop.json in ROOT) has no service token
# by design — each user's own GitHub token polls and posts — so GITHUB_PAT is never required
# there, and the app picks a free port each launch and records it in desktop.json, which is
# where the /health probe looks. The per-user token checks live in rs_doctor.py.
#
# On a Docker install the install IS the container: the .env, the state volume, `claude`, `gh`
# and ~/.claude/skills all live inside it, and none of them are on the host. Run from the host
# this used to read the host's (usually absent) environment file and probe the host's tooling,
# so it reported failures against a perfectly healthy install — and on macOS, where there is no
# /proc/meminfo and no host ~/.reviewstage, it could never pass. So: when the working directory
# is a ReviewStage Compose project whose `app` service is up, re-exec inside it.
set -uo pipefail

JSON=0; LIVE=0; STRICT=0
for a in "$@"; do
  case "$a" in
    --json) JSON=1;; --live) LIVE=1;; --strict) STRICT=1;;
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0;;
  esac
done

ROOT="${ROOT:-$HOME/.reviewstage}"
ENV_FILE="$ROOT/.env"
STATE="$ROOT/state"
BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The free-memory / free-disk floors, from the same file the job scripts read. Sourced rather
# than restated: the doctor used to default MIN_FREE_DISK_MB to 1024 while the jobs defaulted it
# to 500, and FAILed at a level no job script objects to. lib-common.sh is deliberately NOT
# sourced here — it creates directories and pulls in notify.sh, and the doctor writes nothing.
# shellcheck source=bin/lib-limits.sh
. "$BIN_DIR/lib-limits.sh"

if [ -t 1 ] && [ "$JSON" = 0 ]; then G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; D=$'\e[2m'; N=$'\e[0m'; else G=; Y=; R=; D=; N=; fi
fails=0; warns=0
# Every line is also a row for --json. `check <id>` names the next row; without one the id is
# derived from the section the row was printed in.
CHECK_ID=""; SECTION="doctor"; rows=""
check() { CHECK_ID="$1"; }
section() { SECTION="$1"; }
json_str() { local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"; s="${s//$'\t'/\\t}"; printf '"%s"' "$s"; }
row() { # status text
  local id="${CHECK_ID:-$SECTION}"; CHECK_ID=""
  rows="$rows${rows:+,}{\"id\":$(json_str "$id"),\"status\":$(json_str "$1"),\"text\":$(json_str "$2")}"
}
pass() { row PASS "$*"; [ "$JSON" = 1 ] || printf '%sPASS%s  %s\n' "$G" "$N" "$*"; }
warn() { row WARN "$*"; warns=$((warns + 1)); [ "$JSON" = 1 ] || printf '%sWARN%s  %s\n' "$Y" "$N" "$*"; }
fail() { row FAIL "$*"; fails=$((fails + 1)); [ "$JSON" = 1 ] || printf '%sFAIL%s  %s\n' "$R" "$N" "$*"; }
note() { row NOTE "$*"; [ "$JSON" = 1 ] || printf '      %s%s%s\n' "$D" "$*" "$N"; }
say()  { [ "$JSON" = 1 ] || printf '%s\n' "$*"; }
# with_timeout SECS cmd… — coreutils `timeout` where it exists; macOS ships without it, and a
# probe that cannot be bounded is still better than one reported as "printed nothing".
if command -v timeout >/dev/null 2>&1; then with_timeout() { timeout "$@"; }
elif command -v gtimeout >/dev/null 2>&1; then with_timeout() { gtimeout "$@"; }
else with_timeout() { shift; "$@"; }; fi

# --- Docker: diagnose the install, not the laptop it is driven from --------------------------
# in_container — true inside the ReviewStage image (or any container), so the re-exec below can
# never recurse, and `docker compose exec app doctor` keeps running the checks directly.
in_container() {
  [ -n "${RS_DOCTOR_IN_CONTAINER:-}" ] && return 0
  [ -f /.dockerenv ] && return 0
  [ -d /app/bin ] && [ "${HOME:-}" = /home/reviewstage ] && return 0
  return 1
}

# compose_cmd — how to drive Compose here: the v2 plugin, else the standalone v1 binary.
compose_cmd() {
  if docker compose version >/dev/null 2>&1; then echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then echo "docker-compose"
  fi
}

# is_rs_project — a compose file in the working directory that builds/uses THIS image. Guards
# against re-execing into some unrelated project's `app` service that happens to share the name.
is_rs_project() {
  local f
  for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
    [ -r "$f" ] && grep -Eq '^[[:space:]]*image:[[:space:]]*reviewstage(:|$)' "$f" && return 0
  done
  return 1
}

# app_running — the `app` service of that project is up. Both spellings, because --status
# landed in a later Compose than some installs have.
app_running() {
  local dc="$1"
  $dc ps --status running --services 2>/dev/null | grep -qx app && return 0
  $dc ps --services --filter status=running 2>/dev/null | grep -qx app && return 0
  return 1
}

compose_fallback=""
if [ "${RS_DOCTOR_DESKTOP:-0}" != 1 ] && ! in_container && is_rs_project; then
  dc=$(compose_cmd)
  if [ -z "$dc" ]; then
    compose_fallback="this is a ReviewStage Compose project but docker is not on PATH — checking the host instead, which is not where a Docker install lives"
  elif app_running "$dc"; then
    say "${D}Compose project detected — running the checks inside the app container ($dc exec app doctor).${N}"
    # -T when there is no terminal: without it Compose fails outright in a pipe or from cron.
    if [ -t 1 ]; then exec $dc exec app doctor "$@"; else exec $dc exec -T app doctor "$@"; fi
  else
    compose_fallback="this is a ReviewStage Compose project but its 'app' service is not running, so the checks below are about THIS HOST, not the install. Start it ($dc up -d) and re-run, or use '$dc run --rm app doctor'"
  fi
fi

# --- config --------------------------------------------------------------------------------
section config
if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
# Personal mode: RS_PERSONAL=1 from the launcher or .env, or the desktop app has been here.
PERSONAL=0
if [ "${RS_PERSONAL:-0}" = 1 ] || [ "${RS_DOCTOR_DESKTOP:-0}" = 1 ] || [ -f "$ROOT/desktop.json" ]; then PERSONAL=1; fi
if [ "$PERSONAL" = 1 ]; then say "ReviewStage doctor — desktop install at $ROOT"
else say "ReviewStage doctor  ${D}(ROOT=$ROOT)${N}"; fi
[ -n "$compose_fallback" ] && warn "$compose_fallback"
if [ -r "$ENV_FILE" ]; then
  check config.env; pass ".env present and readable ($ENV_FILE)"
  # The desktop's fetched tools (gh, jq, cloudflared, flock) live in ROOT/bin, not on PATH.
  [ -d "$ROOT/bin" ] && PATH="$ROOT/bin:$PATH" && note "tools in $ROOT/bin are on PATH for this check (desktop install)"
else
  check config.env; fail ".env missing or unreadable at $ENV_FILE"
fi

# Repositories: REPOS (list) ∪ REPO (single alias) ∪ settings.json "repos" (added from the
# dashboard — the first-run wizard in personal mode); each must be owner/name.
check config.repos
settings_repos=$(jq -r '.repos // [] | .[]' "$ROOT/settings.json" 2>/dev/null)
repos=$(printf '%s %s %s' "${REPOS:-}" "${REPO:-}" "$settings_repos" | tr ',' ' ' | tr -s '[:space:]' '\n' | awk 'NF && !s[tolower($0)]++')
if [ -n "$repos" ]; then
  pass "repositories: $(echo "$repos" | tr '\n' ' ')"
  [ -n "$settings_repos" ] && note "$(printf '%s\n' "$settings_repos" | grep -c .) of them come from $ROOT/settings.json (the dashboard)"
  for r in $repos; do
    printf '%s' "$r" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?/[A-Za-z0-9_.-]+$' \
      || fail "'$r' in REPOS/REPO/settings.json is not owner/name shaped"
  done
elif [ "$PERSONAL" = 1 ]; then
  warn "no repository configured yet — personal mode boots without one; the first-run wizard (/welcome) adds them"
else
  fail "no repository configured (set REPOS=owner/name[,…] or REPO=owner/name)"
fi
[ "$PERSONAL" = 1 ] && note "personal mode — the server polls GitHub itself with each signed-in user's token; GITHUB_PAT is not needed"
# RS_SECRET: sessions, every signed link and the at-rest encryption key all derive from it.
# Empty means HMAC with a key anyone can reproduce — a forged rs_session cookie is accepted as
# any user, including an admin. The server refuses to start without one; say so here too.
check config.secret
if [ -z "${RS_SECRET:-}" ]; then
  fail "RS_SECRET is empty — session cookies and signed links would be forgeable by anyone (the server refuses to start)"
  note "fix: RS_SECRET=\$(openssl rand -hex 32) in $ENV_FILE, then restart"
elif [ "${#RS_SECRET}" -lt 32 ]; then
  fail "RS_SECRET is ${#RS_SECRET} characters — it must be at least 32 (the server refuses to start)"
  note "fix: RS_SECRET=\$(openssl rand -hex 32) in $ENV_FILE, then restart"
else
  pass "RS_SECRET set (${#RS_SECRET} characters)"
fi

[ -n "${REPO_ALLOW_ORG:-}" ] && note "REPO_ALLOW_ORG=$REPO_ALLOW_ORG — repos under that org are accepted on demand (the service token must see the org)"
case "${DRY_RUN:-1}" in
  1) note "DRY_RUN=1 — nothing is written to GitHub";;
  0) note "DRY_RUN=0 — posting and approving are LIVE";;
esac

# --- tools ---------------------------------------------------------------------------------
section tools
check tools.git; if command -v git >/dev/null; then pass "git $(git --version | awk '{print $3}')"; else fail "git not on PATH"; fi
check tools.gh;  if command -v gh >/dev/null; then pass "gh $(gh --version | head -1 | awk '{print $3}')"; else fail "gh not on PATH"; fi
check claude.cli
if command -v claude >/dev/null; then
  v=$(with_timeout 20 claude --version 2>/dev/null | head -1)
  [ -n "$v" ] && pass "claude $v" || warn "claude is on PATH but --version printed nothing"
  # The CLI keeps its own login and settings under ~/.claude and refuses to run when it
  # cannot write there — a review would die on its first line.
  if [ -d "$HOME/.claude" ] && [ ! -w "$HOME/.claude" ]; then
    check claude.cli; fail "$HOME/.claude is not writable — the claude CLI cannot run"
  elif [ ! -d "$HOME/.claude" ] && [ ! -w "$HOME" ]; then
    check claude.cli; fail "$HOME is not writable — the claude CLI cannot create ~/.claude"
  fi
else
  fail "claude (Claude Code CLI) not on PATH — reviews cannot run"
fi
for t in jq flock openssl curl python3; do
  check "tools.$t"; command -v "$t" >/dev/null || fail "$t not on PATH"
done

# --- github ----------------------------------------------------------------------------------
# The service token is a team-install thing. Personal mode has none by design; its per-user
# tokens (presence, expiry, client) are rs_doctor.py's job further down.
section github.auth
if [ -n "${GITHUB_PAT:-}" ] && command -v gh >/dev/null; then
  if out=$(GH_TOKEN="$GITHUB_PAT" with_timeout 20 gh auth status 2>&1); then
    pass "gh auth status: $(echo "$out" | grep -o 'Logged in to [^ ]* account [^ ]*' | head -1)"
  else
    fail "gh auth status failed with the service token"
    note "$(echo "$out" | head -2 | tr '\n' ' ')"
  fi
  for r in $repos; do
    if GH_TOKEN="$GITHUB_PAT" with_timeout 20 gh repo view "$r" --json nameWithOwner -q .nameWithOwner >/dev/null 2>&1; then
      pass "gh repo view $r works with the service token"
    else
      fail "the service token cannot see $r (repository access or Metadata: Read missing?)"
    fi
  done
  if [ -n "${REPO_ALLOW_ORG:-}" ]; then
    if GH_TOKEN="$GITHUB_PAT" with_timeout 20 gh api "orgs/$REPO_ALLOW_ORG" -q .login >/dev/null 2>&1 \
       || GH_TOKEN="$GITHUB_PAT" with_timeout 20 gh api "users/$REPO_ALLOW_ORG" -q .login >/dev/null 2>&1; then
      pass "the service token can see the REPO_ALLOW_ORG owner $REPO_ALLOW_ORG"
    else
      warn "the service token cannot see $REPO_ALLOW_ORG — org discovery will find nothing"
    fi
  fi
elif [ "$PERSONAL" = 1 ]; then
  note "no service token — personal mode reads GitHub with each signed-in user's own token"
else
  fail "GITHUB_PAT not set — nothing can read GitHub"
fi
section repos
for r in $repos; do
  slug="${r/\//__}"
  if [ -d "$ROOT/repos/$slug/.git" ]; then
    pass "base clone present ($ROOT/repos/$slug)"
  else
    warn "base clone not yet at $ROOT/repos/$slug — cloned on first review, or see clone.log"
    [ -f "$ROOT/clone.log" ] && note "clone.log: $(tail -1 "$ROOT/clone.log")"
  fi
done
if [ -d "$ROOT/repo/.git" ] || ls -d "$STATE"/[0-9]* >/dev/null 2>&1; then
  if [ -f "$ROOT/MIGRATED" ]; then note "legacy single-repo leftovers exist beside a MIGRATED marker (harmless)"
  else warn "legacy single-repo layout ($ROOT/repo, $STATE/<pr>) not yet migrated — the server does it on its next start"; fi
fi

# --- resources -------------------------------------------------------------------------------
section resources
free_disk_mb=$(df -Pm "$ROOT" 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "$free_disk_mb" ]; then
  if [ "$free_disk_mb" -ge "$MIN_FREE_DISK_MB" ]; then
    pass "disk free: $(printf "%'d" "$free_disk_mb") MB on $ROOT (min $(printf "%'d" "$MIN_FREE_DISK_MB"))"
  else
    fail "disk free: $(printf "%'d" "$free_disk_mb") MB on $ROOT — below $(printf "%'d" "$MIN_FREE_DISK_MB") MB"
  fi
fi
min_mem="${MIN_FREE_MB:-800}"
if [ -r /proc/meminfo ]; then
  free_mem_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  if [ "${free_mem_mb:-0}" -ge "$min_mem" ]; then
    pass "memory available: $(printf "%'d" "$free_mem_mb") MB (reviews need MIN_FREE_MB=$min_mem)"
  else
    fail "memory available: $(printf "%'d" "${free_mem_mb:-0}") MB — reviews refuse to start below $min_mem"
  fi
else
  warn "cannot read /proc/meminfo — memory check skipped"
fi

# --- state -----------------------------------------------------------------------------------
section state
if [ -d "$STATE" ]; then
  probe="$STATE/.doctor.$$"
  if (: > "$probe") 2>/dev/null; then rm -f "$probe"; pass "STATE dir writable ($STATE)"
  else fail "STATE dir not writable ($STATE)"; fi
else
  fail "STATE dir missing ($STATE)"
fi
if [ -f "$ROOT/skills/_global.md" ]; then pass "team-default skill seeded"; else warn "team-default skill not seeded ($ROOT/skills/_global.md)"; fi

# --- server ----------------------------------------------------------------------------------
# /health on the right port (desktop.json's, else RS_PORT, else PUBLIC_URL's) is rs_doctor.py's
# port.free check below. PUBLIC_URL is checked here because it is a plain curl.
section callback.public_url
if [ "$PERSONAL" = 1 ] && [[ "${PUBLIC_URL:-}" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/?$ ]]; then
  note "PUBLIC_URL is the app's own loopback address ($PUBLIC_URL) — whether it answers is the port check below"
elif [ -n "${PUBLIC_URL:-}" ]; then
  code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' "${PUBLIC_URL%/}/health" 2>/dev/null)
  if [ "$code" = 200 ]; then pass "PUBLIC_URL reachable ($PUBLIC_URL)"
  else warn "PUBLIC_URL ${PUBLIC_URL%/}/health returned '${code:-no response}' from here (fine if it only resolves from outside)"; fi
  case "$PUBLIC_URL" in
    http://localhost*|http://127.0.0.1*)
      # The container entrypoint writes http://localhost:PORT when nobody set PUBLIC_URL. That
      # is fine on a laptop and wrong everywhere else: it drops the Secure cookie flag, and
      # /device hands a phone an address that resolves to the phone.
      remote_addr=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | head -1)
      if [ "${RS_BIND:-127.0.0.1}" != "127.0.0.1" ] && [ -n "$remote_addr" ]; then
        warn "PUBLIC_URL is the localhost default ($PUBLIC_URL) on a box reachable from outside (RS_BIND=$RS_BIND, address $remote_addr)"
        note "set PUBLIC_URL to the https:// URL people actually use — otherwise cookies are issued without Secure and /device pairs phones to localhost"
      else
        note "PUBLIC_URL is the localhost default — correct for a local install only"
      fi
      ;;
    http://*) warn "PUBLIC_URL is plain http on a non-local host — session cookies and tokens travel unencrypted";;
  esac
else
  warn "PUBLIC_URL not set — Slack links will point at a derived hostname"
fi

# --- notifications -----------------------------------------------------------------------------
section notifications
if [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_CHANNEL:-}" ]; then pass "Slack: bot token + channel (threaded)"
elif [ -n "${SLACK_WEBHOOK:-}" ]; then pass "Slack: incoming webhook set"; fi
[ -n "${DISCORD_WEBHOOK:-}" ] && pass "Discord: webhook set"
if [ -n "${WEBHOOK_URL:-}" ]; then
  [ -n "${WEBHOOK_SECRET:-}" ] && pass "Generic webhook: URL set, requests signed" \
    || warn "Generic webhook: URL set but WEBHOOK_SECRET empty — requests are unsigned"
fi
if [ -z "${SLACK_WEBHOOK:-}${SLACK_BOT_TOKEN:-}${DISCORD_WEBHOOK:-}${WEBHOOK_URL:-}" ]; then
  warn "no notification backend configured — no review-request cards; the dashboard is the inbox"
fi
[ -s "$ROOT/settings.json" ] && note "runtime settings in $ROOT/settings.json override .env (Settings page)"
section push
# Web push (bin/rs_push.py). Never a FAIL: the pair is generated the first time someone turns
# notifications on in the dashboard, so its absence just means nobody has yet.
if [ "${RS_PUSH:-1}" = "0" ]; then
  warn "push: RS_PUSH=0 — phone/browser notifications off"
elif { [ -n "${VAPID_PRIVATE_KEY:-}" ] && [ -n "${VAPID_PUBLIC_KEY:-}" ]; }; then
  pass "push: VAPID pair present (from VAPID_PRIVATE_KEY/VAPID_PUBLIC_KEY)"
elif [ -s "$ROOT/push_vapid.json" ]; then
  pass "push: VAPID pair present ($ROOT/push_vapid.json)"
  mode=$(stat -c %a "$ROOT/push_vapid.json" 2>/dev/null || stat -f %Lp "$ROOT/push_vapid.json" 2>/dev/null)
  [ "${mode:-600}" = 600 ] || warn "push: $ROOT/push_vapid.json is mode $mode — should be 600 (it holds the private key)"
else
  warn "push: no VAPID pair — notifications off until someone enables them on a device"
fi
python3 -c 'import cryptography' 2>/dev/null \
  || warn "push: python3 cannot import \`cryptography\` — subscriptions will be accepted but nothing can be sent"

# --- skills ------------------------------------------------------------------------------------
section skills
for s in pr-review pr-qa-guide; do
  if [ -f "$HOME/.claude/skills/$s/SKILL.md" ]; then pass "skill installed: ~/.claude/skills/$s"
  else warn "skill missing: ~/.claude/skills/$s"; fi
done
[ -f "$HOME/.claude/skills/pr-review/SKILL.md" ] \
  || note "in Docker, ~/.claude lives inside the app container: run 'docker compose exec app doctor' for this check"

# --- users, tokens, permissions, port, runtime (rs_doctor.py) ---------------------------------
# The checks that read users.json need to know the record shape, so they live in Python. Its
# rows are merged into this report: same statuses, same counting, same --json list.
section users
py_json=""
if command -v python3 >/dev/null; then
  live_flag=""; [ "$LIVE" = 1 ] && live_flag="--live"
  py_json=$(cd "$BIN_DIR" && ROOT="$ROOT" python3 rs_doctor.py --root "$ROOT" --json $live_flag 2>/tmp/rs_doctor.$$.err)
  py_rc=$?
  if [ -z "$py_json" ] || [ "$py_rc" -gt 2 ]; then
    fail "rs_doctor.py did not run: $(head -1 /tmp/rs_doctor.$$.err 2>/dev/null)"
    py_json=""
  fi
  rm -f /tmp/rs_doctor.$$.err
fi
if [ -n "$py_json" ] && command -v jq >/dev/null; then
  while IFS=$'\t' read -r id status text; do
    check "$id"
    case "$status" in PASS) pass "$text";; WARN) warn "$text";; FAIL) fail "$text";; NOTE) note "$text";; esac
  done < <(printf '%s' "$py_json" | jq -r '.checks[] | [.id, .status, .text] | @tsv')
elif [ -n "$py_json" ]; then
  # No jq to merge with: show the Python report as is and count its outcome.
  (cd "$BIN_DIR" && ROOT="$ROOT" python3 rs_doctor.py --root "$ROOT" $live_flag) || fails=$((fails + 1))
fi

rc=0
if [ "$fails" -gt 0 ]; then rc=1; elif [ "$STRICT" = 1 ] && [ "$warns" -gt 0 ]; then rc=2; fi
if [ "$JSON" = 1 ]; then
  printf '{"checks":[%s],"fails":%d,"warns":%d}\n' "$rows" "$fails" "$warns"
  exit "$rc"
fi
echo
if [ "$fails" -gt 0 ]; then
  printf '%s%d check(s) failed%s, %d warning(s) — exit 1\n' "$R" "$fails" "$N" "$warns"
elif [ "$rc" = 2 ]; then
  printf '%sall checks passed%s, %d warning(s) — exit 2 (--strict)\n' "$Y" "$N" "$warns"
else
  printf '%sall checks passed%s, %d warning(s) — exit 0\n' "$G" "$N" "$warns"
fi
exit "$rc"
