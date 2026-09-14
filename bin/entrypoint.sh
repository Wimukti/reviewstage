#!/usr/bin/env bash
# entrypoint.sh — container entrypoint for ReviewStage.
#
#   entrypoint.sh server   (default) write .env from the environment, install skills, start the
#                          dashboard in the foreground
#   entrypoint.sh poller   run pr-watch.sh on a loop (the "team" compose profile)
#   entrypoint.sh doctor   read-only diagnostics (bin/doctor.sh)
#   entrypoint.sh demo     start the dashboard against an offline fixture — no credentials
#   entrypoint.sh <cmd>    anything else is exec'd as-is
#
# ROOT (default ~/.reviewstage) is the one persistent directory; compose mounts it as a volume.
set -euo pipefail

ROOT="${ROOT:-$HOME/.reviewstage}"
BIN="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SKILLS_SRC="$(cd "$BIN/.." && pwd)/skills"
# Invoked through the `doctor` symlink (docker compose exec app doctor) => doctor mode.
if [ "$(basename "$0")" = doctor ]; then
  MODE=doctor
else
  MODE="${1:-server}"
  [ $# -gt 0 ] && shift
fi

log() { echo "==> $*"; }

# --- .env ---------------------------------------------------------------------------------
# The host's .env reaches us as environment variables (compose env_file). The server only
# reads $ROOT/.env, so mirror them there. A variable that is SET in the environment wins over
# what the volume holds — editing .env and `docker compose up -d` must take effect — while a
# variable that is unset keeps whatever is already on the volume, or its default.
write_env() {
  mkdir -p "$ROOT"
  chmod 700 "$ROOT" 2>/dev/null || true
  local f="$ROOT/.env"
  touch "$f"; chmod 600 "$f"
  # set_key KEY DEFAULT — env wins, then the existing value, then the default.
  set_key() {
    local key="$1" default="${2-}" val
    if [ -n "${!key:-}" ]; then
      val="${!key}"
    elif grep -q "^$key=" "$f"; then
      return 0
    else
      val="$default"
    fi
    local esc="${val//\\/\\\\}"; esc="${esc//&/\\&}"; esc="${esc//|/\\|}"
    if grep -q "^$key=" "$f"; then sed -i "s|^$key=.*|$key=$esc|" "$f"
    else printf '%s=%s\n' "$key" "$val" >> "$f"; fi
  }
  set_key REPOS ""
  set_key REPO ""
  set_key REPO_ALLOW_ORG ""
  set_key GITHUB_PAT ""
  set_key DRY_RUN 1
  set_key PUBLIC_URL "http://localhost:${RS_PORT:-8899}"
  set_key SLACK_WEBHOOK ""
  set_key SLACK_BOT_TOKEN ""
  set_key SLACK_CHANNEL ""
  set_key DISCORD_WEBHOOK ""
  set_key WEBHOOK_URL ""
  set_key WEBHOOK_SECRET ""
  set_key NOTIFY_BACKENDS ""
  set_key GH_CLIENT_ID ""
  set_key GH_CLIENT_SECRET ""
  set_key GH_OAUTH_SCOPES ""
  set_key GH_DEVICE_FLOW 1
  set_key GH_DEVICE_CLIENT_ID ""
  set_key SKIP_BOT_PRS 0
  set_key RS_MAX_PR_AGE_DAYS 45
  set_key MIN_FREE_MB 800
  set_key RS_SIGNATURE_GRACE_DAYS 7
  set_key REVIEWER ""
  # Signs every dashboard link and encrypts stored tokens. Generated once, kept on the volume.
  if [ -n "${RS_SECRET:-}" ]; then
    set_key RS_SECRET ""
  elif ! grep -q '^RS_SECRET=.\+' "$f"; then
    sed -i '/^RS_SECRET=/d' "$f"
    printf 'RS_SECRET=%s\n' "$(openssl rand -hex 32)" >> "$f"
    log "generated RS_SECRET"
  fi
  # REVIEWER is the "box owner" login the scripts fall back to. Derive it from the service
  # token when nobody set it, so run-review.sh's require_env is satisfied out of the box.
  if ! grep -q '^REVIEWER=.\+' "$f"; then
    local pat login
    pat=$(sed -n 's/^GITHUB_PAT=//p' "$f")
    if [ -n "$pat" ] && login=$(GH_TOKEN="$pat" timeout 20 gh api user -q .login 2>/dev/null) \
       && [ -n "$login" ]; then
      sed -i "s|^REVIEWER=.*|REVIEWER=$login|" "$f"
      log "REVIEWER derived from GITHUB_PAT: $login"
    else
      log "REVIEWER is empty and could not be derived from GITHUB_PAT (set REVIEWER in .env)"
    fi
  fi
  chmod 600 "$f"
}

# --- data dir --------------------------------------------------------------------------------
seed_root() {
  mkdir -p "$ROOT/wt" "$ROOT/state" "$ROOT/repos" "$ROOT/skills"
  touch "$ROOT/seen" "$ROOT/used-nonces"
  [ -f "$ROOT/users.json" ] || echo '{}' > "$ROOT/users.json"
  chmod 600 "$ROOT/users.json"
  # Editable team-default review skill. Seeded once; the dashboard edits it live afterwards.
  if [ ! -f "$ROOT/skills/_global.md" ] && [ -f "$SKILLS_SRC/global-review.md" ]; then
    install -m 0644 "$SKILLS_SRC/global-review.md" "$ROOT/skills/_global.md"
    log "seeded team-default skill"
  fi
}

# The agent runs with the PR worktree as cwd, so skills must be user-level. ~/.claude is not
# on the volume, so this runs on every start; it is cheap.
install_skills() {
  mkdir -p "$HOME/.claude/skills"
  local s
  for s in pr-review pr-qa-guide; do
    if [ -d "$SKILLS_SRC/$s" ] && [ ! -d "$HOME/.claude/skills/$s" ]; then
      cp -r "$SKILLS_SRC/$s" "$HOME/.claude/skills/"
      log "installed skill $s"
    fi
  done
}

# The base clones review worktrees branch off: one blobless clone per configured repo under
# $ROOT/repos/<owner>__<name>, cloned once, in the background so the dashboard is up immediately;
# run-review.sh clones lazily itself if one is still missing (and for REPO_ALLOW_ORG repos).
# Note: the server migrates a legacy $ROOT/repo clone into the new layout on start, so this
# waits for the marker when legacy state is present to avoid cloning what is about to be moved.
ensure_base_clones() {
  local repos pat repo slug base
  repos=$(sed -n 's/^REPOS=//p; s/^REPO=//p' "$ROOT/.env" | tr ',' ' ' | tr -s '[:space:]' '\n' | tr -d '"' | awk 'NF && !s[tolower($0)]++')
  pat=$(sed -n 's/^GITHUB_PAT=//p' "$ROOT/.env")
  [ -n "$repos" ] && [ -n "$pat" ] || { log "no REPOS/GITHUB_PAT — skipping base clones"; return 0; }
  if [ -d "$ROOT/repo/.git" ] && [ ! -f "$ROOT/MIGRATED" ]; then
    log "legacy base clone at $ROOT/repo — the server migrates it on start; skipping clones this run"
    return 0
  fi
  mkdir -p "$ROOT/repos"
  for repo in $repos; do
    slug="${repo/\//__}"; base="$ROOT/repos/$slug"
    [ -d "$base/.git" ] && continue
    log "cloning $repo (blobless) in the background -> $ROOT/clone.log"
    ( GH_TOKEN="$pat" gh repo clone "$repo" "$base" -- --filter=blob:none \
        && git -C "$base" config credential.helper \
             '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' \
        && echo "clone ok: $repo" || echo "clone FAILED: $repo (check REPOS and GITHUB_PAT)" ) \
      >> "$ROOT/clone.log" 2>&1 &
  done
}

# Plain http (the localhost quick start) cannot carry a Secure cookie; drop the flag there.
cookie_flag() {
  local url; url=$(sed -n 's/^PUBLIC_URL=//p' "$ROOT/.env")
  case "$url" in http://*) export RS_COOKIE_SECURE=0;; esac
}

mkdir -p "$ROOT"
case "$MODE" in
  server)
    ( flock 9; write_env; seed_root ) 9>"$ROOT/.env.lock" 2>/dev/null || { write_env; seed_root; }
    install_skills
    ensure_base_clones
    cookie_flag
    log "ReviewStage dashboard on ${RS_BIND:-127.0.0.1}:${RS_PORT:-8899}  (ROOT=$ROOT)"
    exec python3 "$BIN/server.py"
    ;;
  poller)
    ( flock 9; write_env; seed_root ) 9>"$ROOT/.env.lock" 2>/dev/null || { write_env; seed_root; }
    exec "$BIN/poller-loop.sh"
    ;;
  doctor)
    exec "$BIN/doctor.sh" "$@"
    ;;
  demo)
    export ROOT
    python3 "$BIN/demo-fixture.py" "$ROOT" "${RS_PORT:-8899}"
    install_skills
    export PATH="$ROOT/fakebin:$PATH" RS_COOKIE_SECURE=0
    exec python3 "$BIN/server.py"
    ;;
  *)
    exec "$MODE" "$@"
    ;;
esac
