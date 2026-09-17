#!/usr/bin/env bash
# bootstrap.sh — install ReviewStage on a Linux server you control. Idempotent; safe to re-run.
#
#   git clone <this repo> ~/reviewstage
#   ~/reviewstage/bin/bootstrap.sh
#
# On first run it writes ~/.reviewstage/.env, prompting for the per-install values (the repo
# to review, your GitHub login, the public URL of the dashboard), and tells you to paste your
# secrets. Then you re-run it and it finishes. See docs/SETUP.md.
#
# Everything lives under ~/.reviewstage, in $HOME — deliberately outside any directory a
# deploy tool or sync job of yours might rsync over or delete. The only files written outside
# $HOME are the systemd unit and, when you opt in with SETUP_APACHE=1, an Apache vhost that is
# config-tested before it is enabled.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HOME/.reviewstage"
BIN="$ROOT/bin"

# The account that owns the install. It must be the same account Claude Code is signed in as,
# because `claude` reads its credentials from $HOME. Defaults to whoever is running this; set
# RS_USER to guard against running it from the wrong shell by accident.
RS_USER="${RS_USER:-$(id -un)}"
[ "$(id -un)" = "$RS_USER" ] \
  || { echo "Run as $RS_USER (sudo su - $RS_USER), not $(id -un)."; exit 1; }

echo "==> directories"
mkdir -p "$BIN" "$ROOT/wt" "$ROOT/state" "$ROOT/repos"
chmod 700 "$ROOT"
touch "$ROOT/seen" "$ROOT/used-nonces"
# Teammates' encrypted tokens + Slack IDs, written by the dashboard on sign-in.
[ -f "$ROOT/users.json" ] || echo '{}' > "$ROOT/users.json"
chmod 600 "$ROOT/users.json"

echo "==> .env"
# Ensure every documented key EXISTS rather than only writing the file when it is absent.
# A hand-made .env (secrets pasted in before the first bootstrap) previously ended up with no
# DRY_RUN line at all, so the code fell back to its "1" default and the dashboard stayed in
# dry run with no visible reason — sed found nothing to flip. Existing values are never
# overwritten, so flipping DRY_RUN to 0 survives a re-run.
touch "$ROOT/.env"; chmod 600 "$ROOT/.env"
ensure_key() { grep -q "^$1=" "$ROOT/.env" || printf '%s=%s\n' "$1" "$2" >> "$ROOT/.env"; }
# The per-install values. Prompt when we have a terminal; otherwise write them empty and let
# the checks below (and require_env later) fail loudly, which beats guessing.
ask() {
  local key="$1" prompt="$2" default="${3:-}" val=""
  grep -q "^$key=.\+" "$ROOT/.env" && return 0
  if [ -t 0 ]; then read -rp "   $prompt${default:+ [$default]}: " val; fi
  printf '%s=%s\n' "$key" "${val:-$default}" >> "$ROOT/.env"
}
ensure_key GITHUB_PAT ""
ensure_key SLACK_WEBHOOK ""
# Optional: a Slack bot token + channel enable threaded replies (review-ready threads under the
# review-request card). Without them, Slack falls back to the webhook (a fresh message each time).
ensure_key SLACK_BOT_TOKEN ""
ensure_key SLACK_CHANNEL ""
# The repositories to review. No default — every install names its own. REPO (single) is still
# honoured as an alias, so an existing .env is not re-prompted.
grep -q '^REPO=.\+' "$ROOT/.env" || ask REPOS "GitHub repositories to review (owner/name, comma-separated)"
grep -Eq '^REPOS?=.+' "$ROOT/.env" \
  || { echo "   !! REPOS is empty in $ROOT/.env — set it to owner/name[,owner/name…], then re-run"; exit 1; }
# Optional: accept any repo under this org where a signed-in user gets a review request.
ensure_key REPO_ALLOW_ORG ""
ensure_key RS_SIGNATURE_GRACE_DAYS 7
# Your GitHub login. The PAT must belong to this account — everything the dashboard posts is
# attributed to it, which is the whole point of the design.
ask REVIEWER "Your GitHub login"
# Where browsers reach the dashboard: the hostname your reverse proxy forwards to the server.
# Older installs may have RS_ENV + RS_DOMAIN instead; lib-common.sh still derives the
# URL from that pair, so only prompt when neither form is present.
if ! grep -q '^RS_ENV=.\+' "$ROOT/.env" || ! grep -q '^RS_DOMAIN=.\+' "$ROOT/.env"; then
  ask PUBLIC_URL "Public URL of this dashboard (e.g. https://reviews.example.com)"
  grep -q '^PUBLIC_URL=.\+' "$ROOT/.env" \
    || { echo "   !! PUBLIC_URL is empty in $ROOT/.env — set it, then re-run"; exit 1; }
fi
# GitHub login. Empty = token sign-in only. See docs/SETUP.md "GitHub login".
ensure_key GH_CLIENT_ID ""
ensure_key GH_CLIENT_SECRET ""
ensure_key GH_OAUTH_SCOPES ""
# Device flow: "Sign in with GitHub" with no app registration (shared public client ID).
ensure_key GH_DEVICE_FLOW 1
ensure_key GH_DEVICE_CLIENT_ID ""
ensure_key DRY_RUN 1
ensure_key SKIP_BOT_PRS 0
ensure_key RS_MAX_PR_AGE_DAYS 45
ensure_key RISK_PATHS ""
ensure_key RS_SECRET "$(openssl rand -hex 32)"
grep -q '^GITHUB_PAT=.\+' "$ROOT/.env" \
  || echo "   !! GITHUB_PAT is empty in $ROOT/.env — add it, then re-run"
chmod 600 "$ROOT/.env"

# Everything below reads the values just written. PUBLIC_URL may be derived from the legacy
# pair, so let lib-common.sh do that rather than repeating the logic here.
# shellcheck disable=SC1091
. "$SRC/lib-common.sh"
PORT="${RS_PORT:-8899}"
PUBLIC_HOST="${PUBLIC_URL#*://}"; PUBLIC_HOST="${PUBLIC_HOST%%[/:]*}"

echo "==> gh"
if ! command -v gh >/dev/null; then
  case "$(uname -m)" in aarch64|arm64) arch=arm64;; *) arch=amd64;; esac
  v=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | jq -r .tag_name)
  curl -fsSL "https://github.com/cli/cli/releases/download/$v/gh_${v#v}_linux_${arch}.tar.gz" \
    | tar -xz -C /tmp
  sudo install -m 0755 "/tmp/gh_${v#v}_linux_${arch}/bin/gh" /usr/local/bin/gh
  echo "   installed gh $v ($arch)"
fi

echo "==> claude"
if ! command -v claude >/dev/null; then
  curl -fsSL https://claude.ai/install.sh | bash \
    || sudo npm install -g @anthropic-ai/claude-code
  echo "   installed claude — sign in AS $RS_USER before the first review"
fi

echo "==> scripts"
# Bootstrap copies itself into $BIN, so it can also be re-run FROM $BIN. Installing a file
# onto itself makes `install` fail, and with `set -e` that aborted the run before the systemd
# and proxy steps ever executed — silently skipping the parts you were re-running it for.
if [ "$SRC" != "$BIN" ]; then
  install -m 0755 "$SRC"/{pr-watch.sh,run-review.sh,run-qa.sh,bootstrap.sh} "$BIN/"
  install -m 0755 "$SRC/server.py" "$BIN/"
  install -m 0644 "$SRC"/rs_diff.py "$BIN/"   # imported by the server, must sit beside it
  install -m 0644 "$SRC"/rs_md.py "$BIN/"
  install -m 0644 "$SRC"/rs_assets.py "$BIN/"   # inlined brand logo + favicon
  install -m 0644 "$SRC"/rs_learn.py "$BIN/"    # learnings loop (imported + run by shell)
  install -m 0644 "$SRC"/rs_agree.py "$BIN/"    # convergence scoring, imported by the server
  install -m 0644 "$SRC"/rs_rollup.py "$BIN/"   # insights rollup, imported by the server
  install -m 0644 "$SRC"/rs_howimg.py "$BIN/"   # how-it-works step mockups
  install -m 0644 "$SRC/lib-common.sh" "$BIN/"
else
  echo "   (running from $BIN — nothing to copy)"
fi

echo "==> node + pnpm"
# The dashboard UI is a React + TypeScript app bundled by esbuild. The server builds it from
# source at install time (no build artifacts are committed). esbuild is low-memory, so a small
# VM handles it fine. pnpm is installed via npm since the repo pins no packageManager field.
if ! command -v node >/dev/null 2>&1    || [ "$(node -v 2>/dev/null | sed 's/^v//;s/\..*//')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "   installed node $(node -v)"
fi
if ! command -v pnpm >/dev/null 2>&1; then
  sudo npm install -g pnpm
  echo "   installed pnpm $(pnpm -v)"
fi

echo "==> dashboard-ui build"
# The build writes the fingerprinted bundle (app-<hash>.js/.css plus assets.json naming them)
# to ../bin/static, i.e. $SRC/static. The server reads its bundle from $BIN/static, so copy the
# freshly built files across after the build — and clear the old fingerprinted pair first, or
# every upgrade leaves another dead copy of the bundle behind.
UI="$SRC/../dashboard-ui"
if [ -d "$UI" ]; then
  ( cd "$UI" && pnpm install --frozen-lockfile && pnpm build )
  # Replace the directory rather than copying into it: the bundle is fingerprinted, so an
  # in-place copy leaves every previous release's app-<hash>.* behind for ever. This also
  # unbreaks the copy itself — it used `install "$SRC/static/"*`, which under `set -e` aborted
  # bootstrap the moment the PWA build started emitting a static/icons/ subdirectory.
  rm -rf "$BIN/static"
  mkdir -p "$BIN/static"
  cp -R "$SRC/static/." "$BIN/static/"
  chmod -R a+rX "$BIN/static"
  echo "   built SPA bundle -> $BIN/static ($(ls -1 "$BIN/static" | tr '\n' ' '))"
else
  echo "   !! dashboard-ui not found at $UI — the SPA will not load (set RS_SPA=0 to fall"
  echo "      back to the legacy HTML UI); build it and re-run bootstrap"
fi

echo "==> base clones (one per repo, under $ROOT/repos)"
if [ -z "${GITHUB_PAT:-}" ]; then
  # The documented flow is: bootstrap (writes .env) -> you paste the secrets -> re-run.
  # Aborting here on the first run would strand that flow before systemd/proxy/cron ever
  # got configured, so skip the clone and let the re-run pick it up.
  echo "   skipped — GITHUB_PAT is empty; re-run bootstrap once it is set"
elif [ -d "$ROOT/repo/.git" ] && [ ! -f "$ROOT/MIGRATED" ]; then
  echo "   legacy clone at $ROOT/repo — the server moves it into $ROOT/repos on its next start"
else
  for repo in $(printf '%s %s' "${REPOS:-}" "${REPO:-}" | tr ',' ' ' | tr -s '[:space:]' '\n' | awk 'NF && !s[tolower($0)]++'); do
    base="$ROOT/repos/${repo/\//__}"
    [ -d "$base/.git" ] || GH_TOKEN="$GITHUB_PAT" gh repo clone "$repo" "$base" -- --filter=blob:none
    [ -d "$base/.git" ] && git -C "$base" config credential.helper \
      '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'
  done
fi

echo "==> pr-review skill"
mkdir -p "$HOME/.claude/skills"
# The skill ships in this repo. The agent runs with the PR worktree as its cwd, so a
# project-level copy would not be found — it has to be installed at the user level.
cp -r "$SRC/../skills/pr-review" "$HOME/.claude/skills/" 2>/dev/null \
  || echo "   !! skills/pr-review not found next to $SRC — reviews will run without it"
cp -r "$SRC/../skills/pr-qa-guide" "$HOME/.claude/skills/" 2>/dev/null \
  || echo "   !! skills/pr-qa-guide not found next to $SRC — QA guides will run without it"

# Editable team-default review skill. Seed $ROOT/skills/_global.md on first install so it shows
# real content and is editable from the dashboard; never overwrite once it exists (it's edited live).
mkdir -p "$ROOT/skills"
if [ ! -f "$ROOT/skills/_global.md" ] && [ -f "$SRC/../skills/global-review.md" ]; then
  install -m 0644 "$SRC/../skills/global-review.md" "$ROOT/skills/_global.md"
  echo "   seeded team-default skill (_global.md)"
fi

echo "==> systemd unit"
sudo tee /etc/systemd/system/reviewstage.service >/dev/null <<EOF
[Unit]
Description=ReviewStage dashboard
After=network.target

[Service]
User=$RS_USER
Environment=RS_PORT=$PORT
# run-review.sh is spawned from this service and shells out to \`claude\`, which the native
# installer puts in ~/.local/bin — not on systemd's default PATH. Without this the agent
# step fails as "command not found" and surfaces only as an empty review.json.
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/python3 $BIN/server.py
# Only kill the server itself on stop. The default (control-group) reaps every process in
# the cgroup — including the detached run-review.sh a click spawned — so redeploying while a
# review was running silently killed it and left the PR stuck reading "reviewing".
KillMode=process
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable reviewstage.service
# restart, not `enable --now`: the server reads .env once at startup, so an already-running
# instance would keep serving stale secrets and a stale DRY_RUN after you edit them.
sudo systemctl restart reviewstage.service

echo "==> reverse proxy"
# The server binds 127.0.0.1:$PORT only. Something you run must terminate TLS on $PUBLIC_HOST
# and forward to it — any reverse proxy will do. This step is OPTIONAL and only runs when you
# opt in with SETUP_APACHE=1: it writes a name-based Apache vhost for $PUBLIC_HOST that proxies
# to the server, config-tests it, and disables it again if anything is off, so an existing
# Apache on the box is never left broken. Without SETUP_APACHE it prints what to configure.
if [ "${SETUP_APACHE:-0}" = 1 ]; then
  [ -n "$PUBLIC_HOST" ] || { echo "   !! PUBLIC_URL has no hostname — fix .env, then re-run"; exit 1; }
  # Extra hostnames that should also reach this instance (comma-separated in .env), e.g. an
  # old name kept alive so already-sent links keep resolving.
  aliases=$(printf '%s' "${RS_HOST_ALIASES:-}" | tr ',' ' ' | xargs || true)
  alias_line=""
  for a in $aliases; do [ "$a" = "$PUBLIC_HOST" ] || alias_line+="    ServerAlias $a"$'\n'; done
  sudo a2enmod proxy proxy_http >/dev/null
  sudo tee /etc/apache2/sites-available/reviewstage.conf >/dev/null <<EOF
<VirtualHost *:80>
    ServerName $PUBLIC_HOST
${alias_line}    ProxyPreserveHost On
    # The app is served at the site root.
    ProxyPass        / http://127.0.0.1:$PORT/
    ProxyPassReverse / http://127.0.0.1:$PORT/
    ErrorLog \${APACHE_LOG_DIR}/reviewstage-error.log
    CustomLog \${APACHE_LOG_DIR}/reviewstage-access.log combined
</VirtualHost>
EOF
  sudo a2ensite reviewstage >/dev/null
  if ! sudo apache2ctl configtest 2>&1 | grep -q "Syntax OK"; then
    sudo a2dissite reviewstage >/dev/null
    echo "   !! apache configtest FAILED — vhost disabled, nothing else touched"; exit 1
  fi
  # Verify functionally, by asking the endpoint through the vhost. A graceful reload is enough
  # to pick up new LoadModule lines in practice; the restart stays only as a genuine fallback.
  reviewstage_reachable() {
    [ "$(curl -s -m 5 -H "Host: $PUBLIC_HOST" http://127.0.0.1/health 2>/dev/null)" = "ok" ]
  }
  sudo systemctl reload apache2
  sleep 1
  if ! reviewstage_reachable; then
    echo "   endpoint not reachable after reload — restarting apache"
    sudo systemctl restart apache2
    sleep 2
  fi
  if reviewstage_reachable; then
    echo "   apache ok (answers on $PUBLIC_HOST)"
  else
    sudo a2dissite reviewstage >/dev/null && sudo systemctl reload apache2
    echo "   !! endpoint unreachable — vhost disabled, nothing else touched"; exit 1
  fi
else
  echo "   skipped (set SETUP_APACHE=1 to write an Apache vhost). Point your reverse proxy at"
  echo "   http://127.0.0.1:$PORT for $PUBLIC_HOST with TLS in front. nginx example:"
  echo "     location / { proxy_pass http://127.0.0.1:$PORT; proxy_set_header Host \$host; }"
fi

echo "==> cron"
# Strip BOTH of our lines before re-adding, or each bootstrap run leaves another PATH=
# line behind. The PATH line cannot carry a trailing marker comment — cron would read the
# comment as part of the value — so it is matched literally instead.
cron_path="PATH=/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
tmp=$(mktemp)
crontab -l 2>/dev/null | grep -vF "$cron_path" | grep -v 'pr-watch.sh' > "$tmp" || true
{
  echo "$cron_path"
  echo "*/3 * * * * flock -n /tmp/pr-watch.lock $BIN/pr-watch.sh >> $ROOT/watch.log 2>&1"
} >> "$tmp"
crontab "$tmp"; rm -f "$tmp"

echo
echo "Done. Checks:"
echo "  curl -s localhost:$PORT/health                # -> ok"
echo "  curl -s $PUBLIC_URL/health                     # -> ok (through your reverse proxy)"
echo "  $BIN/pr-watch.sh                              # -> Slack card per open request"
echo
echo "Sign in (you and every teammate):  $PUBLIC_URL/login"
echo "  Each person signs in with GitHub (or pastes their own PAT) + Slack member ID once."
echo "  Each reviewer runs their own review; posting and approving happen as each signed-in user."
echo
# Report the ACTUAL value, never a hardcoded assumption — a stale "nothing is written"
# reassurance is worse than none once someone has flipped it.
if grep -q '^DRY_RUN=0' "$ROOT/.env"; then
  echo "DRY_RUN=0 — the dashboard POSTS AND APPROVES ON GITHUB for real, as $(grep '^REVIEWER=' "$ROOT/.env" | cut -d= -f2)."
else
  echo "DRY_RUN=1 — reviews run and Slack reports them, but GitHub is never written."
fi
