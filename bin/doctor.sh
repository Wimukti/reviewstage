#!/usr/bin/env bash
# doctor.sh — read-only diagnostics for a ReviewStage install. Prints one PASS / WARN / FAIL
# line per check and exits non-zero if anything FAILed. Writes nothing (the one "writable?"
# probe creates and removes a temp file in STATE).
#
#   bin/doctor.sh                         on a box
#   docker compose exec app doctor        inside the running container
#   docker compose run --rm app doctor    a throwaway container sharing the data volume
set -uo pipefail

ROOT="${ROOT:-$HOME/.claude-pr-bot}"
ENV_FILE="$ROOT/.env"
STATE="$ROOT/state"
PORT="${PRBOT_PORT:-8899}"
MIN_FREE_DISK_MB="${MIN_FREE_DISK_MB:-1024}"

if [ -t 1 ]; then G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; D=$'\e[2m'; N=$'\e[0m'; else G=; Y=; R=; D=; N=; fi
fails=0; warns=0
pass() { printf '%sPASS%s  %s\n' "$G" "$N" "$*"; }
warn() { printf '%sWARN%s  %s\n' "$Y" "$N" "$*"; warns=$((warns + 1)); }
fail() { printf '%sFAIL%s  %s\n' "$R" "$N" "$*"; fails=$((fails + 1)); }
note() { printf '      %s%s%s\n' "$D" "$*" "$N"; }

echo "ReviewStage doctor  ${D}(ROOT=$ROOT)${N}"

# --- config --------------------------------------------------------------------------------
if [ -r "$ENV_FILE" ]; then
  pass ".env present and readable ($ENV_FILE)"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  mode=$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE" 2>/dev/null)
  [ "${mode:-600}" = 600 ] || warn ".env mode is $mode (expected 600)"
else
  fail ".env missing or unreadable at $ENV_FILE"
fi

# Repositories: REPOS (list) ∪ REPO (single alias); each must be owner/name.
repos=$(printf '%s %s' "${REPOS:-}" "${REPO:-}" | tr ',' ' ' | tr -s '[:space:]' '\n' | awk 'NF && !s[tolower($0)]++')
if [ -n "$repos" ]; then
  pass "repositories: $(echo "$repos" | tr '\n' ' ')"
  for r in $repos; do
    printf '%s' "$r" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?/[A-Za-z0-9_.-]+$' \
      || fail "'$r' in REPOS/REPO is not owner/name shaped"
  done
else
  fail "no repository configured (set REPOS=owner/name[,…] or REPO=owner/name)"
fi
[ -n "${REPO_ALLOW_ORG:-}" ] && note "REPO_ALLOW_ORG=$REPO_ALLOW_ORG — repos under that org are accepted on demand (the service token must see the org)"
case "${DRY_RUN:-1}" in
  1) note "DRY_RUN=1 — nothing is written to GitHub";;
  0) note "DRY_RUN=0 — posting and approving are LIVE";;
esac

# --- tools ---------------------------------------------------------------------------------
if command -v git >/dev/null; then pass "git $(git --version | awk '{print $3}')"; else fail "git not on PATH"; fi
if command -v gh >/dev/null; then pass "gh $(gh --version | head -1 | awk '{print $3}')"; else fail "gh not on PATH"; fi
if command -v claude >/dev/null; then
  v=$(timeout 20 claude --version 2>/dev/null | head -1)
  [ -n "$v" ] && pass "claude $v" || warn "claude is on PATH but --version printed nothing"
else
  fail "claude (Claude Code CLI) not on PATH — reviews cannot run"
fi
for t in jq flock openssl curl; do
  command -v "$t" >/dev/null || fail "$t not on PATH"
done

# --- github ----------------------------------------------------------------------------------
if [ -n "${GITHUB_PAT:-}" ] && command -v gh >/dev/null; then
  if out=$(GH_TOKEN="$GITHUB_PAT" timeout 20 gh auth status 2>&1); then
    pass "gh auth status: $(echo "$out" | grep -o 'Logged in to [^ ]* account [^ ]*' | head -1)"
  else
    fail "gh auth status failed with the service token"
    note "$(echo "$out" | head -2 | tr '\n' ' ')"
  fi
  for r in $repos; do
    if GH_TOKEN="$GITHUB_PAT" timeout 20 gh repo view "$r" --json nameWithOwner -q .nameWithOwner >/dev/null 2>&1; then
      pass "gh repo view $r works with the service token"
    else
      fail "the service token cannot see $r (repository access or Metadata: Read missing?)"
    fi
  done
  if [ -n "${REPO_ALLOW_ORG:-}" ]; then
    if GH_TOKEN="$GITHUB_PAT" timeout 20 gh api "orgs/$REPO_ALLOW_ORG" -q .login >/dev/null 2>&1 \
       || GH_TOKEN="$GITHUB_PAT" timeout 20 gh api "users/$REPO_ALLOW_ORG" -q .login >/dev/null 2>&1; then
      pass "the service token can see the REPO_ALLOW_ORG owner $REPO_ALLOW_ORG"
    else
      warn "the service token cannot see $REPO_ALLOW_ORG — org discovery will find nothing"
    fi
  fi
else
  [ -n "${GITHUB_PAT:-}" ] || fail "GITHUB_PAT not set — nothing can read GitHub"
fi
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
if [ -d "$STATE" ]; then
  probe="$STATE/.doctor.$$"
  if (: > "$probe") 2>/dev/null; then rm -f "$probe"; pass "STATE dir writable ($STATE)"
  else fail "STATE dir not writable ($STATE)"; fi
else
  fail "STATE dir missing ($STATE)"
fi
if [ -f "$ROOT/skills/_global.md" ]; then pass "team-default skill seeded"; else warn "team-default skill not seeded ($ROOT/skills/_global.md)"; fi

# --- server ----------------------------------------------------------------------------------
health=""
for u in "http://127.0.0.1:$PORT/health" "http://app:$PORT/health"; do
  if [ "$(curl -s -m 5 "$u" 2>/dev/null)" = "ok" ]; then health="$u"; break; fi
done
if [ -n "$health" ]; then pass "server /health -> ok ($health)"; else fail "server not answering on port $PORT (tried 127.0.0.1 and app)"; fi

if [ -n "${PUBLIC_URL:-}" ]; then
  code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' "${PUBLIC_URL%/}/health" 2>/dev/null)
  if [ "$code" = 200 ]; then pass "PUBLIC_URL reachable ($PUBLIC_URL)"
  else warn "PUBLIC_URL ${PUBLIC_URL%/}/health returned '${code:-no response}' from here (fine if it only resolves from outside)"; fi
  case "$PUBLIC_URL" in
    http://localhost*|http://127.0.0.1*) ;;
    http://*) warn "PUBLIC_URL is plain http on a non-local host — session cookies and tokens travel unencrypted";;
  esac
else
  warn "PUBLIC_URL not set — Slack links will point at a derived hostname"
fi

# --- slack -----------------------------------------------------------------------------------
if [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_CHANNEL:-}" ]; then pass "Slack: bot token + channel (threaded)"
elif [ -n "${SLACK_WEBHOOK:-}" ]; then pass "Slack: incoming webhook set"
else warn "Slack not configured — no review-request cards; open the dashboard yourself"; fi

# --- skills ------------------------------------------------------------------------------------
for s in pr-review pr-qa-guide; do
  if [ -f "$HOME/.claude/skills/$s/SKILL.md" ]; then pass "skill installed: ~/.claude/skills/$s"
  else warn "skill missing: ~/.claude/skills/$s"; fi
done
[ -f "$HOME/.claude/skills/pr-review/SKILL.md" ] \
  || note "in Docker, ~/.claude lives inside the app container: run 'docker compose exec app doctor' for this check"

# --- users -------------------------------------------------------------------------------------
if [ -r "$ROOT/users.json" ] && command -v jq >/dev/null; then
  n=$(jq 'length' "$ROOT/users.json" 2>/dev/null || echo 0)
  c=$(jq '[.[] | select(.claude_token_enc != null and .claude_token_enc != "")] | length' "$ROOT/users.json" 2>/dev/null || echo 0)
  if [ "${n:-0}" -eq 0 ]; then warn "no users signed in yet (users.json is empty)"
  else pass "$n user(s) signed in"; fi
  if [ "${c:-0}" -gt 0 ]; then pass "$c user(s) have connected a Claude account"
  else warn "nobody has connected a Claude account — reviews cannot start until someone does (Settings -> Connect Claude)"; fi
else
  warn "users.json not readable at $ROOT/users.json"
fi

echo
if [ "$fails" -gt 0 ]; then
  printf '%s%d check(s) failed%s, %d warning(s)\n' "$R" "$fails" "$N" "$warns"; exit 1
fi
printf '%sall checks passed%s, %d warning(s)\n' "$G" "$N" "$warns"
