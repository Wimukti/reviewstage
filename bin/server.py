#!/usr/bin/env python3
"""server.py — the ReviewStage dashboard, served on 127.0.0.1 behind your reverse proxy.

Assume it is reachable over the PUBLIC internet with nothing in front of it. Pages need a
signed session cookie, obtained by signing in with your own GitHub PAT. The mutating actions embedded in a page — posting comments, approving — carry
their own 30-minute HMAC tokens minted at render time, so a forwarded or bookmarked page
cannot approve anything later, and a cross-site form post has no token to present.

Multi-user model: the REVIEW is per PR and shared (one agent run serves every reviewer);
SELECTION, POSTING and APPROVAL are per user, done with that user's own PAT so GitHub
attributes them to the human. Per-user markers live in state/<pr>/users/<login>/.

Routes
  GET  /health
  GET  /login  POST /login  sign in with a GitHub PAT (+ optional Slack member ID)
  GET  /logout
  GET  /settings  POST /settings
  GET  /?tab&sort                      index — PRs awaiting YOUR review, with your state
  GET  /pr?pr=N                        detail — shared review, your editable findings, actions
  GET  /review?pr=N&exp&sig            start a review, then redirect to the detail page
  POST /post                           post the selected (possibly edited) comments as you
  POST /approve                        approve as you
"""
import base64
import calendar
import fcntl
import hmac
import html
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import threading
import time
from hashlib import sha256
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import rs_agree
import rs_assets
import rs_devices as rs_dev
import rs_diff
import rs_howimg
import rs_learn
import rs_md
import rs_paths as P
import rs_profile
import rs_rollup
import rs_settings
import rs_state
import rs_webhook

BRAND = "ReviewStage"                    # product name shown beside the logo (see rs_assets)
CLAUDE_ICON = ("<svg viewBox='0 0 24 24' width=18 height=18 fill=currentColor aria-hidden=true>"
               "<path d='M12 2c.3 3.1 1 4.9 2.2 6 1.1 1.2 2.9 1.9 6 2.2-3.1.3-4.9 1-6 2.2"
               "-1.2 1.1-1.9 2.9-2.2 6-.3-3.1-1-4.9-2.2-6C8.6 11.2 6.8 10.5 3.7 10.2"
               "c3.1-.3 4.9-1 6-2.2C10.9 6.9 11.6 5.1 12 2z'/></svg>")
GH_ICON = ("<svg viewBox='0 0 16 16' width=23 height=23 fill=currentColor><path d='M8 0C3.58 0 0 "
           "3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01."
           "37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 "
           "1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.8"
           "7.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 "
           "0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 "
           "0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55."
           "38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z'/></svg>")
SLACK_ICON = ("<svg viewBox='0 0 122.8 122.8' width=22 height=22>"
              "<path fill='#E01E5A' d='M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9zM32.3 77.6a12.9 "
              "12.9 0 0 1 25.8 0v32.3a12.9 12.9 0 0 1-25.8 0z'/>"
              "<path fill='#36C5F0' d='M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9zM45.2 32.3a12.9 "
              "12.9 0 0 1 0 25.8H12.9a12.9 12.9 0 0 1 0-25.8z'/>"
              "<path fill='#2EB67D' d='M97 45.2a12.9 12.9 0 1 1 12.9 12.9H97zM90.5 45.2a12.9 12.9 "
              "0 0 1-25.8 0V12.9a12.9 12.9 0 0 1 25.8 0z'/>"
              "<path fill='#ECB22E' d='M77.6 97a12.9 12.9 0 1 1-12.9 12.9V97zM77.6 90.5a12.9 12.9 "
              "0 0 1 0-25.8h32.3a12.9 12.9 0 0 1 0 25.8z'/></svg>")

ROOT = Path(os.environ.get("ROOT", Path.home() / ".reviewstage"))
BIN = Path(__file__).resolve().parent
STATE = P.STATE
QUEUE = ROOT / "queue.json"

PAGE_TTL = 7 * 24 * 3600
ACTION_TTL = 30 * 60

SEV_ORDER = {"blocker": 0, "should-fix": 1, "nit": 2, "question": 3}
SEV_LABEL = {"blocker": "blocker", "should-fix": "should fix", "nit": "nit",
             "question": "question"}


def load_env():
    env, f = {}, ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()
SECRET = ENV.get("RS_SECRET", "")
# The SERVICE token: reads (diffs, PR metadata, the poller's searches) and the base clone.
# Never used to post or approve — those use the signed-in user's own PAT, see user_pat().
PAT = ENV.get("GITHUB_PAT", "")
# The repositories this install reviews (REPOS, plus the single-entry alias REPO). No default.
# REPO_ALLOW_ORG additionally accepts any repo under that org on demand (see repo_ok).
REPOS = P.parse_repos(ENV)
ALLOW_ORG = P.allow_org(ENV)
SINGLE_REPO = REPOS[0] if len(REPOS) == 1 else ""
# Signed links minted before the repo dimension existed (action:pr:exp) stay valid this long
# after the upgrade, so Slack links already sent keep working through the transition.
SIG_GRACE_DAYS = int(ENV.get("RS_SIGNATURE_GRACE_DAYS", "7") or 0)
SIG_V2_SINCE = ROOT / "sig-v2-since"


def repo_ok(repo):
    """May this install act on `repo`? Configured, or under REPO_ALLOW_ORG."""
    return P.repo_allowed(repo, REPOS, ALLOW_ORG)


def all_repos():
    """Configured repos plus org-discovered ones that already have state or a clone."""
    return P.known_repos(REPOS)


def resolve_repo(q_repo, pr=""):
    """(repo, error) for a request naming a PR. An explicit repo must be allowed. Without one:
    the single configured repo; else the one repo holding state for that PR number (legacy
    single-repo links); else an error naming the candidates so the UI can show a picker."""
    q_repo = (q_repo or "").strip().strip("/")
    if q_repo:
        if not repo_ok(q_repo):
            return None, f"{q_repo} is not a repository this ReviewStage reviews"
        return P.canonical_repo(q_repo, all_repos()), None
    if SINGLE_REPO:
        return SINGLE_REPO, None
    if pr:
        hits = P.repos_with_pr(pr)
        if len(hits) == 1:
            return hits[0], None
    return None, "ambiguous repo"
# The box owner. Their legacy per-PR markers (state/<pr>/posted.json etc., from before the
# multi-user layout) are read as theirs, so history survives the upgrade.
REVIEWER = ENV.get("REVIEWER", "")
DRY_RUN = ENV.get("DRY_RUN", "1") == "1"
# Notification URLs are only inspected here (is it set?) for the Settings/Integrations pages;
# posting goes through bin/notify.sh (see notify_card below).
SLACK_WEBHOOK = ENV.get("SLACK_WEBHOOK", "")
SLACK_BOT_TOKEN = ENV.get("SLACK_BOT_TOKEN", "")
SLACK_CHANNEL = ENV.get("SLACK_CHANNEL", "")


USERS = ROOT / "users.json"
SESSION_TTL = 30 * 24 * 3600

# --- runtime settings + notifier bridge (rs_settings.py) ---------------------------------
# $ROOT/settings.json is written from the Settings page and read live by the poller and the
# scripts; settings.json > .env > default. Admin-only to change; everyone may read.
SETTINGS = ROOT / "settings.json"


def runtime_settings():
    """(values, sources) for every runtime setting, layered settings.json > .env > default."""
    return rs_settings.effective(SETTINGS, ENV)


def is_admin(login):
    """REVIEWER from .env, else the user flagged admin in users.json, else the first user who
    signed in (flagged on first resolution so it sticks)."""
    if not login:
        return False
    if REVIEWER and login == REVIEWER:
        return True
    return rs_settings.resolve_admin(load_users(), REVIEWER, modify_users) == login


def notify_card(kind, payload):
    """Post a card through bin/notify.sh — the same notifier the shell scripts use, so Slack,
    Discord and generic webhooks all fire per the operator's settings. Best-effort, detached."""
    rs_settings.notify_card(BIN, ROOT, kind, payload)


def notify_env_status():
    """Which notification URLs .env provides (booleans only — never the values)."""
    return {"slack_webhook": bool(SLACK_WEBHOOK),
            "slack_bot": bool(SLACK_BOT_TOKEN and SLACK_CHANNEL),
            "discord_webhook": bool(ENV.get("DISCORD_WEBHOOK")),
            "webhook_url": bool(ENV.get("WEBHOOK_URL")),
            "webhook_secret": bool(ENV.get("WEBHOOK_SECRET"))}


# --- GitHub webhooks (rs_webhook.py) ------------------------------------------------------
# POST /webhooks/github turns a review request into a queue row + card within a second; the
# poller stays on as the safety net. GITHUB_WEBHOOK_SECRET gates the endpoint (503 unset, 401
# on a bad X-Hub-Signature-256). Never runs a review — same notify-only rule as pr-watch.sh.
GITHUB_WEBHOOK_SECRET = rs_webhook.secret_from(ENV)


def webhook_team_members(org, slug):
    """Logins of a requested team, via the service token. Only signed-in members are then
    queued/pinged (Context intersects with users.json)."""
    if not (org and slug and PAT):
        return []
    rows = gh_json(["api", f"orgs/{org}/teams/{slug}/members?per_page=100"], default=[])
    if not isinstance(rows, list):
        return []
    return [m.get("login") for m in rows if isinstance(m, dict) and m.get("login")]


def webhook_ctx():
    vals, _ = runtime_settings()
    return rs_webhook.Context(
        ROOT, BIN, repo_ok, load_users(), PUBLIC_URL, SECRET, settings=vals, env=ENV,
        single_repo=SINGLE_REPO, reviewer=REVIEWER, team_members=webhook_team_members,
        log=lambda m, **kw: print(m, flush=True))


def webhooks_status():
    """webhooks.json plus derived fields for the Settings card (never the secret itself)."""
    vals, _ = runtime_settings()
    d = rs_webhook.status(ROOT)
    d["configured"] = bool(GITHUB_WEBHOOK_SECRET)
    d["active"] = rs_webhook.active(ROOT, vals.get("poll_interval_seconds", 180))
    d["url"] = f"{PUBLIC_URL}/webhooks/github" if PUBLIC_URL else "/webhooks/github"
    return d


# --- users ---------------------------------------------------------------------------------
# users.json: {login: {pat_enc | gh_token_enc(+gh_exp, gh_refresh_enc), slack_id, discord_id,
# admin, name, added, devices: {sha256: {id, name, created, last_seen}}}. Tokens are
# AES-encrypted with a key
# derived from RS_SECRET — derived, not stored, so rotating the secret also invalidates
# every stored PAT, which is the right outcome if it was rotated because it leaked. The
# shell scripts only ever read login + slack_id; they never see a PAT.
def _users_key():
    return sha256(f"{SECRET}:users".encode()).hexdigest()


def _openssl(mode, data):
    r = subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-a", "-A",
                        mode, "-pass", "env:RS_KEY"], input=data, capture_output=True,
                       text=True, env={**os.environ, "RS_KEY": _users_key()})
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "openssl failed").strip()[:200])
    return r.stdout.strip()


def enc(plain):
    return _openssl("-e", plain)


def dec(cipher):
    return _openssl("-d", cipher)


def load_users():
    if not USERS.exists():
        return {}
    try:
        return json.loads(USERS.read_text()) or {}
    except json.JSONDecodeError:
        return {}


def save_users(users):
    tmp = USERS.with_suffix(".tmp")
    tmp.write_text(json.dumps(users, indent=1))
    os.chmod(tmp, 0o600)
    tmp.replace(USERS)


# All writers to users.json live in this one server process (pr-watch only reads it), so a
# process-wide lock is enough to make the load → modify → save sequence atomic and keep two
# simultaneous sign-ins / settings saves from losing each other's update.
_users_lock = threading.Lock()


def modify_users(fn):
    """Serialized read-modify-write of users.json. fn(users) mutates the dict in place."""
    with _users_lock:
        users = load_users()
        fn(users)
        save_users(users)


def user_pat(login):
    """The token to act as `login`: their GitHub-login OAuth token if they signed in that way
    (refreshed here if it has expired), else the PAT they pasted."""
    u = load_users().get(login) or {}
    if u.get("gh_token_enc"):
        tok = oauth_fresh_token(login, u)
        if tok:
            return tok
    if u.get("pat_enc"):
        try:
            return dec(u["pat_enc"])
        except RuntimeError:
            return ""
    return ""


# --- github login (OAuth) --------------------------------------------------------------------
# Works with a GitHub App (recommended: 8-hour user tokens + refresh, permissions scoped to
# the app, comments show the user's avatar with the app's badge) or a classic OAuth App (set
# GH_OAUTH_SCOPES=repo; tokens then have no expiry and no refresh). Either way the token acts
# AS THE USER — the whole point — and nobody pastes anything.
GH_CLIENT_ID = ENV.get("GH_CLIENT_ID", "")
GH_CLIENT_SECRET = ENV.get("GH_CLIENT_SECRET", "")
GH_OAUTH_SCOPES = ENV.get("GH_OAUTH_SCOPES", "")


def public_url(env):
    """Where browsers reach this dashboard, without a trailing slash. PUBLIC_URL is the knob;
    the older RS_ENV + RS_DOMAIN pair (host reviewstage-<env>.<domain>) is still honoured so an
    existing .env keeps working. Empty when neither is set — see the startup warning."""
    u = env.get("PUBLIC_URL", "")
    if not u and env.get("RS_ENV") and env.get("RS_DOMAIN"):
        host = env.get("RS_HOST") or f"reviewstage-{env['RS_ENV']}.{env['RS_DOMAIN']}"
        u = f"https://{host}"
    return u.rstrip("/")


PUBLIC_URL = public_url(ENV)
OAUTH_ENABLED = bool(GH_CLIENT_ID and GH_CLIENT_SECRET)


def oauth_state(nxt):
    """Signed, 10-minute state carrying where to land afterwards. Rejects forged callbacks."""
    exp = int(time.time()) + 600
    payload = f"{exp}:{nxt}"
    sig = hmac.new(SECRET.encode(), f"oauth:{payload}".encode(), sha256).hexdigest()
    # Raw, not percent-encoded: urlencode() in oauth_authorize_url does that once. Encoding
    # here too made GitHub echo back a double-encoded state that never verified.
    return f"{sig}:{payload}"


def oauth_check_state(state):
    sig, _, payload = (state or "").partition(":")
    if not (sig and payload):
        return None
    if not hmac.compare_digest(
            hmac.new(SECRET.encode(), f"oauth:{payload}".encode(), sha256).hexdigest(), sig):
        return None
    exp, _, nxt = payload.partition(":")
    try:
        if int(exp) < time.time():
            return None
    except ValueError:
        return None
    return nxt if nxt.startswith("/") and not nxt.startswith("//") else "/"


OAUTH_BLOCKED = ROOT / "oauth-blocked"


def oauth_blocked():
    """True after a GitHub sign-in that succeeded at GitHub but could not see the repo — the
    org has not approved the app yet. Cleared by the first sign-in that can. Lets the login
    page demote the GitHub button instead of walking every newcomer into the same error."""
    return OAUTH_BLOCKED.exists()


def oauth_authorize_url(nxt):
    q = {"client_id": GH_CLIENT_ID, "redirect_uri": f"{PUBLIC_URL}/oauth/callback",
         "state": oauth_state(nxt)}
    if GH_OAUTH_SCOPES:
        q["scope"] = GH_OAUTH_SCOPES
    return "https://github.com/login/oauth/authorize?" + urlencode(q)


def oauth_token_request(params):
    """POST to GitHub's token endpoint. Returns the JSON dict, or {} on any failure."""
    body = urlencode({"client_id": GH_CLIENT_ID, "client_secret": GH_CLIENT_SECRET,
                      **params}).encode()
    req = Request("https://github.com/login/oauth/access_token", data=body,
                  headers={"Accept": "application/json",
                           "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urlopen(req, timeout=20) as r:
            d = json.loads(r.read().decode() or "{}")
    except (OSError, ValueError):
        return {}
    return d if isinstance(d, dict) and d.get("access_token") else {}


def oauth_store(login, d, name, prev):
    """Persist a token response. Expiry is absolute; 0 means the token never expires."""
    now = int(time.time())
    u = dict(prev)
    u.update({
        "gh_token_enc": enc(d["access_token"]),
        "gh_exp": now + int(d["expires_in"]) if d.get("expires_in") else 0,
        "name": name or u.get("name", ""),
        "added": u.get("added") or now, "updated": now,
    })
    if d.get("refresh_token"):
        u["gh_refresh_enc"] = enc(d["refresh_token"])
        u["gh_refresh_exp"] = now + int(d.get("refresh_token_expires_in") or 0)
    modify_users(lambda users: users.__setitem__(login, u))


def oauth_fresh_token(login, u):
    """Decrypt the user's token; if it expires within a minute, refresh it first."""
    try:
        exp = int(u.get("gh_exp") or 0)
        if not exp or exp - 60 > time.time():
            return dec(u["gh_token_enc"])
        if not u.get("gh_refresh_enc"):
            return ""
        d = oauth_token_request({"grant_type": "refresh_token",
                                 "refresh_token": dec(u["gh_refresh_enc"])})
        if not d:
            return ""
        oauth_store(login, d, u.get("name", ""), u)
        return d["access_token"]
    except RuntimeError:
        return ""


# --- per-user Claude account ---------------------------------------------------------------------
# There is no third-party "sign in with Anthropic"; what exists is `claude setup-token`, which
# hands a subscription token to automation (Anthropic documents it for GitHub Actions). A user
# pastes theirs once; reviews THEY trigger then run with CLAUDE_CODE_OAUTH_TOKEN set to it,
# billed to their own plan. Verified on the box: the env var wins over the stored login (a bogus
# token 401s instead of silently falling back). No token = the shared runner, as before.
def user_claude_token(login):
    """The user's Claude access token, refreshed if it is within a minute of expiring."""
    u = load_users().get(login) or {}
    if not u.get("claude_token_enc"):
        return ""
    try:
        exp = int(u.get("claude_exp") or 0)
        if exp and exp - 60 <= time.time():
            return claude_refresh(login, u)          # expired: refresh (returns "" if it can't)
        return dec(u["claude_token_enc"])
    except RuntimeError:
        return ""


def verify_claude_token(tok):
    """(ok, message). One tiny haiku call — a bad token fails fast with a 401."""
    try:
        r = subprocess.run(["claude", "-p", "Reply with exactly: OK", "--max-turns", "1",
                            "--model", "haiku"], capture_output=True, text=True, timeout=75,
                           stdin=subprocess.DEVNULL,
                           env={**os.environ, "CLAUDE_CODE_OAUTH_TOKEN": tok})
    except FileNotFoundError:
        return False, "claude is not installed on this box."
    except subprocess.TimeoutExpired:
        return False, "Claude did not answer within 75 seconds — try again."
    if r.returncode != 0:
        tail = ((r.stderr or r.stdout or "").strip().splitlines() or ["unknown error"])[-1]
        return False, tail[:200]
    return True, ""


# --- "Connect Claude": direct OAuth (PKCE), the way nerve and Claude Code itself do it ---------
# The earlier approach drove `claude setup-token` in a pty and scraped its terminal; that fails
# because the CLI renders the token masked, so it never appears as plaintext to read. So we run
# the same OAuth 2.0 + PKCE exchange Claude Code performs: send the user to Claude's authorize
# page, they paste back the code Claude shows, we exchange it for an access+refresh token and
# store it encrypted. The OAuth client is Claude Code's own (this is the credential
# CLAUDE_CODE_OAUTH_TOKEN is meant to hold) and the token is only ever used to run `claude -p`;
# verify_claude_token makes one real call before we keep it, so a token the CLI would reject is
# caught at connect time. Authorize/redirect/scope captured from the live `claude setup-token`
# on this box; token endpoint per public Claude Code OAuth notes (api.anthropic.com mirrors
# console.anthropic.com without its Cloudflare challenge, which a server cannot clear).
CLAUDE_OAUTH_CLIENT = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
CLAUDE_OAUTH_AUTHORIZE = "https://claude.com/cai/oauth/authorize"
CLAUDE_OAUTH_REDIRECT = "https://platform.claude.com/oauth/code/callback"
CLAUDE_OAUTH_SCOPE = "org:create_api_key user:profile user:inference"
CLAUDE_TOKEN_ENDPOINTS = ["https://api.anthropic.com/v1/oauth/token",
                          "https://console.anthropic.com/v1/oauth/token",
                          "https://platform.claude.com/v1/oauth/token"]
CLAUDE_PENDING = {}                # login -> {verifier, state, started}
CLAUDE_LOCK = threading.Lock()
CLAUDE_PENDING_TTL = 15 * 60


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def claude_connect_cancel(login):
    with CLAUDE_LOCK:
        CLAUDE_PENDING.pop(login, None)


def claude_connect_pending(login):
    """The in-flight connect for this user, or None. Reaps anything older than the TTL."""
    with CLAUDE_LOCK:
        for k, v in list(CLAUDE_PENDING.items()):
            if time.time() - v["started"] > CLAUDE_PENDING_TTL:
                CLAUDE_PENDING.pop(k)
        return CLAUDE_PENDING.get(login)


def claude_connect_start(login):
    """(url, error). Generates PKCE + state and returns Claude's authorize URL."""
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(sha256(verifier.encode()).digest())
    state = _b64url(secrets.token_bytes(32))
    url = CLAUDE_OAUTH_AUTHORIZE + "?" + urlencode({
        "code": "true", "response_type": "code", "client_id": CLAUDE_OAUTH_CLIENT,
        "redirect_uri": CLAUDE_OAUTH_REDIRECT, "scope": CLAUDE_OAUTH_SCOPE,
        "code_challenge": challenge, "code_challenge_method": "S256", "state": state})
    with CLAUDE_LOCK:
        CLAUDE_PENDING[login] = {"verifier": verifier, "state": state, "url": url,
                                 "started": time.time()}
    return url, None


def _token_exchange(payload):
    """(data, error). POST to the token endpoint, trying each host until one answers JSON.

    A JSON error body (bad/expired code) means the endpoint worked and the grant is the
    problem — return it, don't try the next host. An HTML/challenge body means the wrong or a
    blocked host — move on."""
    body = json.dumps(payload).encode()
    last = "no token endpoint answered"
    for host in CLAUDE_TOKEN_ENDPOINTS:
        req = Request(host, data=body, method="POST",
                      headers={"Content-Type": "application/json", "User-Agent": "anthropic",
                               "Accept": "application/json"})
        try:
            with urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode() or "{}"), None
        except HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            if raw.strip().startswith("{"):
                try:
                    j = json.loads(raw)
                    return None, (j.get("error_description") or j.get("error") or raw[:200])
                except ValueError:
                    return None, raw[:200]
            last = f"{e.code} from {host.split('/')[2]}"
        except (OSError, ValueError) as e:
            last = str(e)[:150]
    return None, last


def claude_connect_code(login, pasted):
    """(data, error). Exchanges the pasted code for a token response.

    Claude concatenates the code and state with '#'; accept "code#state", a bare code, or the
    whole redirect URL pasted from the address bar."""
    p = claude_connect_pending(login)
    if not p:
        return None, "That sign-in attempt expired — start again."
    val = pasted.strip()
    if val.startswith("http"):
        q = parse_qs(urlparse(val).query)
        val = (q.get("code") or [""])[0] + ("#" + q["state"][0] if q.get("state") else "")
    code, _, state = val.partition("#")
    if not code:
        return None, "That does not look like a code — copy the code Claude showed you."
    if state and state != p["state"]:
        return None, "That code is from a different sign-in — start over and use the newest link."
    data, err = _token_exchange({
        "grant_type": "authorization_code", "code": code, "code_verifier": p["verifier"],
        "client_id": CLAUDE_OAUTH_CLIENT, "redirect_uri": CLAUDE_OAUTH_REDIRECT,
        "state": state or p["state"]})
    if err:
        return None, err
    if not data.get("access_token"):
        return None, "Claude returned no access token — start over."
    claude_connect_cancel(login)
    return data, None


def claude_refresh(login, u):
    """Refresh a stored Claude token in place. Returns the fresh access token, or ''."""
    if not u.get("claude_refresh_enc"):
        return ""
    try:
        rt = dec(u["claude_refresh_enc"])
    except RuntimeError:
        return ""
    data, err = _token_exchange({"grant_type": "refresh_token",
                                 "client_id": CLAUDE_OAUTH_CLIENT, "refresh_token": rt})
    if err or not data.get("access_token"):
        return ""
    store_claude_token(login, data)
    return data["access_token"]


def store_claude_token(login, data):
    """Persist an access(+refresh) token response, encrypted, with an absolute expiry."""
    now = int(time.time())

    def apply(users):
        u = users.get(login) or {}
        u["claude_token_enc"] = enc(data["access_token"])
        u["claude_exp"] = now + int(data["expires_in"]) if data.get("expires_in") else 0
        u["claude_added"] = u.get("claude_added") or now
        u["updated"] = now
        if data.get("refresh_token"):
            u["claude_refresh_enc"] = enc(data["refresh_token"])
        users[login] = u
    modify_users(apply)


def claude_connected(login):
    """True if this user has connected their own Claude account. Reviews require this — nobody
    runs on the shared box account, so nobody burns someone else's subscription."""
    return bool((load_users().get(login) or {}).get("claude_token_enc"))


def review_env(login):
    """Environment for a review spawned by `login`: it runs on THEIR Claude account (required —
    see claude_connected). RS_ACTOR is the clicker (drives skill choice)."""
    env = {**os.environ, "RS_RUN_AS": "shared", "RS_ACTOR": login or ""}
    tok = user_claude_token(login) if login else ""
    if tok:
        env["CLAUDE_CODE_OAUTH_TOKEN"] = tok
        env["RS_RUN_AS"] = login
    return env


# --- per-user review skill -------------------------------------------------------------------
# A user can bring their own pr-review skill; reviews they start use it (its logic runs, but
# run-review.sh always appends our own output contract, so any skill still yields the review.json
# the dashboard needs). No skill => the global default on the box. run-review picks the file by
# RS_ACTOR and records the skill id next to the review so learnings can score it.
SKILLS_DIR = ROOT / "skills"
GLOBAL_SKILL_PATH = SKILLS_DIR / "_global.md"   # the editable team default (maintained here)


REPO_SKILL_PREFIX = "repo:"


def repo_skill_path(repo):
    """The optional per-repo override of the team default: skills/repos/<owner>__<name>/SKILL.md.
    run-review.sh prefers it over a personal skill and the team default."""
    return SKILLS_DIR / "repos" / P.repo_slug(repo) / "SKILL.md"


def skill_path(target):
    """The file backing a skill target: a login for a personal skill, "global" for the team
    default, "repo:<owner/name>" for a per-repo override. Personal skills are `<login>.md`;
    the team default is `_global.md`."""
    if target == "global":
        return GLOBAL_SKILL_PATH
    if target.startswith(REPO_SKILL_PREFIX):
        return repo_skill_path(target[len(REPO_SKILL_PREFIX):])
    return SKILLS_DIR / f"{target}.md"


def skill_label(skill_id, viewer=""):
    """Human label for a recorded skill id: "global", a login, or "repo:<owner/name>" (also the
    slug form run-review.sh records: "repo:<owner>__<name>")."""
    if skill_id in ("", "global"):
        return "team default"
    if skill_id.startswith(REPO_SKILL_PREFIX):
        rest = skill_id[len(REPO_SKILL_PREFIX):]
        return f"team default for {P.slug_repo(rest) if '__' in rest else rest}"
    return "your own skill" if skill_id == viewer else f"{skill_id}'s skill"


def user_skill_path(login):
    return skill_path(login)


def read_skill(login):
    p = skill_path(login)
    try:
        return p.read_text() if p.exists() else ""
    except OSError:
        return ""


def user_skill(login):
    return read_skill(login)


def save_skill(login, text):
    """Returns True if saved. An empty team default is refused (one person must not be able to
    blank the skill everyone shares); an empty personal skill clears it back to the team default."""
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    p = skill_path(login)
    if text.strip():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        return True
    if login == "global":
        return False                        # never blank the shared skill from an ordinary save
    p.unlink(missing_ok=True)               # empty personal skill => fall back to the team default
    return True


def restore_global_skill():
    """Revert the team default to the installed pr-review skill. Guarded behind a typed confirm
    in the UI because it discards the team's edits for everyone."""
    GLOBAL_SKILL_PATH.unlink(missing_ok=True)


# --- Phase 5: skill audit trail (GitOps-on-save) ---------------------------------------------
# Dashboard edits to the review skills also commit to a local git repo in $ROOT/skills, so the
# team's review standard has a real who/when/why history. Local history only (no remote push
# needed); the human editor is the commit AUTHOR, ReviewStage is the committer. Best-effort — a save
# must never fail because git did.
def _skills_git(*args):
    return subprocess.run(["git", "-C", str(SKILLS_DIR), *args],
                          capture_output=True, text=True)


def ensure_skills_repo():
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    if not (SKILLS_DIR / ".git").is_dir():
        _skills_git("init", "-q")
        _skills_git("config", "user.email", "reviewstage@reviewstage.local")
        _skills_git("config", "user.name", "ReviewStage")


def commit_skill_change(editor, summary):
    """Commit whatever skill files just changed, attributing the edit to `editor`. No-op when
    nothing changed. Never raises."""
    try:
        ensure_skills_repo()
        _skills_git("add", "-A")
        if not _skills_git("status", "--porcelain").stdout.strip():
            return
        _skills_git("commit", "-q", "-m", summary,
                    "--author", f"{editor} <{editor}@reviewstage.local>")
    except Exception:
        pass


def skill_history(n=5):
    """Recent revisions of the team default skill (_global.md): who/when/why, from git."""
    try:
        ensure_skills_repo()
        r = _skills_git("log", f"-n{n}", "--format=%h%x00%an%x00%ct%x00%s", "--", "_global.md")
        out = []
        for line in r.stdout.splitlines():
            parts = line.split("\x00")
            if len(parts) == 4 and parts[2].isdigit():
                out.append({"hash": parts[0], "author": parts[1],
                            "at": int(parts[2]), "msg": parts[3]})
        return out
    except Exception:
        return []


def save_user_skill(login, text):
    save_skill(login, text)


# Quick-add house rules: a reviewer types a plain-English preference ("don't ask for a Jira link
# in code comments") and it's tidied into a bullet under a managed "## Team rules" section, kept
# last in the doc so appends are trivial. ReviewStage reads the whole skill, so the rule just applies.
RULES_MARKER = "## Team rules"
RULES_INTRO = ("Rules added from the dashboard — apply these on every review "
               "(they override the general guidance above when they conflict):")


def tidy_rule(rule):
    r = re.sub(r"\s+", " ", (rule or "").strip())
    if not r:
        return ""
    r = r[0].upper() + r[1:]
    if r[-1] not in ".!?":
        r += "."
    return r


def add_skill_rule(text, rule):
    """Append one tidied rule to a skill's managed Team-rules section (created if absent)."""
    r = tidy_rule(rule)
    if not r:
        return text
    bullet = f"- {r}"
    if RULES_MARKER in text:
        return text.rstrip() + f"\n{bullet}\n"      # the section is kept last, so append at end
    base = text.rstrip()
    head = (base + "\n\n") if base else ""
    return f"{head}{RULES_MARKER}\n\n{RULES_INTRO}\n\n{bullet}\n"


# Which skill a user's reviews run with: their own, or the shared team default. A saved choice
# wins; with none, we default to "own" when they have a personal skill, else "team". The team
# default is never destructively resettable through this — see save_skill / do_skill.
def active_skill(login):
    p = SKILLS_DIR / f"{login}.use"
    try:
        v = p.read_text().strip()
        if v in ("own", "team"):
            return v
    except OSError:
        pass
    return "own" if read_skill(login) else "team"


def set_active_skill(login, choice):
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    (SKILLS_DIR / f"{login}.use").write_text("own" if choice == "own" else "team")


def effective_skill(login, repo=""):
    """(choice, label) — which skill actually runs, resolving 'own' with no personal skill. A
    per-repo override (skills/repos/<slug>/SKILL.md) wins for reviews of that repo, matching
    run-review.sh's order: repo override → personal → team default."""
    if repo and read_skill(REPO_SKILL_PREFIX + repo):
        return "repo", f"the team default for {repo}"
    if active_skill(login) == "own" and read_skill(login):
        return "own", "your own skill"
    return "team", "the team default"


# --- Phase 1: per-user re-run cache (content addressing) --------------------------------------
# Bump when the review prompt/output format changes, so old cached reviews are never served under
# a new schema (a changed constant simply changes every key, so nothing has to be invalidated).
REVIEW_SCHEMA_VERSION = "rv1"


def review_cache_key(login, repo, head, effort, focus, model):
    """Hash of everything that determines a review's output, PLUS the reviewer — the cache is
    per-user, so it only ever reuses YOUR own identical re-run on the same commit, never serves
    one reviewer's generation to another. Resolves the *skill text* (not its name), so editing a
    skill changes the key automatically."""
    choice, _ = effective_skill(login, repo)
    skill_text = (read_skill(REPO_SKILL_PREFIX + repo) if choice == "repo"
                  else read_skill(login) if choice == "own" else read_skill("global"))
    blob = "\x00".join([REVIEW_SCHEMA_VERSION, login or "", repo or "", (head or "").strip(),
                         effort or "", (focus or "").strip(), model or "",
                         sha256(skill_text.encode()).hexdigest(),
                         sha256(effort_depth(effort).encode()).hexdigest(),
                         sha256(json.dumps(rs_profile.load_profile(repo) or {},
                                           sort_keys=True).encode()).hexdigest()])
    return sha256(blob.encode()).hexdigest()


# --- review effort ---------------------------------------------------------------------------
# How deep a review goes. The dashboard auto-sizes from the diff and lets the reviewer override;
# run-review.sh maps the key to a timeout + a depth instruction. Order is low → high.
EFFORT = {
    "quick":    ("Quick",    "diff only · ~10 min", "fast pass over just the changed lines"),
    "standard": ("Standard", "changed files · ~25 min", "the changed files and their context"),
    "deep":     ("Deep",     "whole-repo trace · ~40 min",
                 "traces impact across the repo — best for risky or large PRs"),
}
EFFORT_ORDER = ["quick", "standard", "deep"]

# Model the reviewer can pick at trigger time. "" = the account's default (no --model passed).
# Keys are the aliases Claude Code's --model accepts; validated server-side so nothing arbitrary
# ever reaches the CLI.
MODELS = [("", "Default", "your Claude plan's default"),
          ("opus", "Opus", "most capable \u00b7 deepest review"),
          ("sonnet", "Sonnet", "balanced \u00b7 faster"),
          ("haiku", "Haiku", "fastest \u00b7 light PRs")]
MODEL_KEYS = {k for k, _, _ in MODELS}

# The depth instruction appended to the active skill's prompt for each level. All three run the
# SAME skill — only this text and the timeout differ. These are the defaults; a team can edit them
# on the Skills page (stored as _effort_<level>.md) and run-review.sh receives the chosen text.
EFFORT_DEPTH = {
    "quick": (
        "Effort level: QUICK. Look only at the diff and the files it directly changes. Report "
        "only clear correctness bugs, broken logic and obvious runtime failures. Skip style, "
        "speculative concerns and minor edge cases. Keep findings very few — this is a fast pass."),
    "standard": (
        "Effort level: STANDARD. Review the changed files and their immediate callers and "
        "context. Cover correctness, error handling, obvious edge cases and clear risks. For any "
        "value the change computes, stores or displays, ask whether a wrong, stale or missing "
        "value could now reach an end user, and trace that path. Keep findings focused and "
        "high-confidence; each names its user-facing impact and a concrete failing scenario."),
    "deep": (
        "Effort level: DEEP — do a thorough deep analysis. Work through this method before "
        "writing any finding, and report only what you can tie to concrete evidence (the diff, "
        "the code, review threads, commit history):\n"
        "1. Intent. Read the PR description and review threads; identify what the change is trying "
        "to do and which behaviours it touches (data flow/state, query/API logic, UI, business "
        "rules, error handling).\n"
        "2. Comprehensive impact search FIRST. Before judging any line, search the whole "
        "repository for every component the change affects — callers and dependents of changed "
        "functions/fields, shared models and types, API contracts, configuration and feature flags, "
        "and any per-tenant or per-integration branching. Build the full blast radius up front; "
        "never discover impacts reactively.\n"
        "3. Trace data flow end to end for each meaningful change: where a value enters (request, "
        "job, webhook, file), every transformation, where it is persisted, and every place it is "
        "displayed or acted on. At each hop ask whether a WRONG, STALE, MISSING or DEFAULTED value "
        "could now reach an end user — a flipped flag, a reordered parameter, changed retry or "
        "caching behaviour, a loop that updates some records and not others. Name the hop and the "
        "concrete user-visible failure.\n"
        "4. Auth boundaries. For every new or changed route, mutation, field, job or admin action: "
        "who may call it, what identifies the caller, and whether the check happens before any "
        "side effect. Trust placed in client-supplied ids, tenant/role scoping that a new path "
        "skips, and secrets that could reach logs or responses.\n"
        "5. Migrations & backward compatibility. Schema or persisted-shape changes without a "
        "migration, migrations that are not idempotent or that run against live traffic, old data "
        "under new code and new data under old code (rolling deploys, rollbacks), changed defaults, "
        "renamed or removed fields still read by another consumer, API responses a client still "
        "depends on.\n"
        "6. Concurrency. Non-atomic read-modify-write, state shared across requests or workers, "
        "jobs that can run twice or overlap, ordering assumptions between async steps, retries "
        "that can storm or duplicate side effects.\n"
        "7. Then examine, reporting only genuine issues: correctness & logic (conditionals, "
        "short-circuits, off-by-one/boundaries, skip-conditions that exclude valid states, "
        "null/undefined and defaults for new fields); error handling (failure modes covered, "
        "errors surfaced not swallowed, loading/empty states, missing try/catch on critical "
        "paths); edge cases ONLY where the PR changes their handling (empty collections, "
        "single-vs-many, first-time/no-data, network failure); performance (N+1 queries, unbounded "
        "loops/allocations, hot-path cost).\n"
        "8. Tests. Name the key functions, branches or hooks the PR adds or changes that have no "
        "coverage, and any assertion that now holds only by coincidence or fallback.\n"
        "9. Finding quality. Give each finding an honest confidence and keep only high-signal "
        "ones. Every finding must state the concrete user-facing impact and a specific failing "
        "scenario (the exact inputs/state that produce the wrong output or crash) — no vague or "
        "speculative findings. Cover the ground exhaustively in your analysis prose, but do not "
        "pad the findings list.\n"
        "Take the time the 40-minute budget allows. This is analysis depth only — you still write "
        "findings for a human to review and post, and you never post to GitHub yourself."),
}


def effort_depth_path(level):
    return SKILLS_DIR / f"_effort_{level}.md"


def effort_depth(level):
    """The depth instruction for a level: the team-edited text if present, else the default."""
    try:
        t = effort_depth_path(level).read_text()
        if t.strip():
            return t
    except OSError:
        pass
    return EFFORT_DEPTH.get(level, EFFORT_DEPTH["standard"])


def effort_edited(level):
    return effort_depth_path(level).exists()


def autosize_effort(meta):
    """Suggest an effort level from PR size (files + lines changed)."""
    files = meta.get("changedFiles") or 0
    lines = (meta.get("additions") or 0) + (meta.get("deletions") or 0)
    if files <= 3 and lines <= 40:
        return "quick"
    if files > 15 or lines > 500:
        return "deep"
    return "standard"


def review_effort(repo, pr, login):
    """The effort a review actually ran at, or "" if unknown/never run."""
    try:
        v = upath(repo, pr, login, "effort").read_text().strip()
        return v if v in EFFORT else ""
    except OSError:
        return ""


def review_usage(repo, pr, login):
    """Token usage + model recorded for the last review, or None. Written by run-review.sh from
    Claude's stream-json output; best-effort, so a missing/garbled file just means no usage line."""
    f = upath(repo, pr, login, "usage.json")
    if not f.exists():
        return None
    try:
        u = json.loads(f.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    fresh_in = int(u.get("input_tokens") or 0)
    out = int(u.get("output_tokens") or 0)
    cache_read = int(u.get("cache_read_input_tokens") or 0)
    cache_create = int(u.get("cache_creation_input_tokens") or 0)
    # "real" = fresh input + output. Cache reads (the same context re-sent each agent turn) are
    # reported separately — they dominate the raw total but aren't fresh work, so we don't headline
    # them. costUsd is Claude's pay-per-token API-list-price estimate, NOT what a subscription is
    # billed; the UI shows it only in the tooltip, clearly labelled.
    return {"model": u.get("model") or "unknown",
            "inputTokens": fresh_in,
            "outputTokens": out,
            "cacheReadTokens": cache_read,
            "cacheCreationTokens": cache_create,
            "realTokens": fresh_in + out,
            "costUsd": float(u.get("cost_usd") or 0)}


RISK_LABEL = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def review_risk(repo, pr, login):
    """Risk-area labels recorded by run-review.sh from the RISK_PATHS rules, as a list."""
    try:
        return [f for f in upath(repo, pr, login, "risk").read_text().split() if RISK_LABEL.match(f)]
    except OSError:
        return []


def risk_banner(label):
    """The context banner for one risk label. Informational only — never a gate."""
    return {"icon": "\u26a0\ufe0f", "title": f"Touches {label} paths",
            "note": ("this area is listed in RISK_PATHS as one to look harder at — trace the "
                     "change end to end and consider looping in its owner.")}


# Files that describe one review run — copied into history/<ts>/ when a re-run replaces it.
RUN_FILES = ("review.json", "effort", "focus", "skill", "runner", "head", "status")


def review_focus(repo, pr, login):
    try:
        return upath(repo, pr, login, "focus").read_text().strip()
    except OSError:
        return ""


def archive_review(repo, pr, login):
    """Move the current review into history/<ts>/ so a re-run doesn't lose it. No-op if none."""
    d = udir(repo, pr, login)
    if not (d / "review.json").exists():
        return
    h = d / "history" / str(int(time.time()))
    h.mkdir(parents=True, exist_ok=True)
    for name in RUN_FILES:
        f = d / name
        if f.exists():
            try:
                shutil.copy2(f, h / name)
            except OSError:
                pass
    # Clear the live review so the re-run starts clean; the archived copy is the history entry.
    (d / "review.json").unlink(missing_ok=True)


def others_on_head(repo, pr, exclude_login):
    """Other reviewers who already have a COMPLETED run on this PR's CURRENT head SHA — the data
    behind the 'someone already reviewed this; look at something different' nudge (Phase 2).
    Empty until the PR has a cached head. Only counts genuinely finished runs."""
    meta, _ = pr_meta(repo, pr)
    head = (meta.get("head") or "").strip()
    base = P.prdir(repo, pr) / "users"
    if not head or not base.is_dir():
        return []
    out = []
    for d in sorted(base.iterdir()):
        login = d.name
        if login == exclude_login or not d.is_dir():
            continue
        hf = d / "head"
        if not (hf.exists() and hf.read_text().strip() == head):
            continue
        if not (d / "review.json").exists():
            continue
        if pr_state(repo, str(pr), login) in ("reviewing", "queued", "failed", "stopped"):
            continue
        rd = lambda name: ((d / name).read_text().strip() if (d / name).exists() else "")
        eff = rd("effort"); skl = rd("skill") or "global"
        try:
            when = int((d / "review.json").stat().st_mtime)
        except OSError:
            when = 0
        out.append({"login": login,
                    "effort": EFFORT.get(eff, (eff or "?",))[0],
                    "effortKey": eff, "focus": rd("focus"), "model": rd("model"),
                    "skill": skill_label(skl),
                    "skillKey": skl, "when": ago(when) if when else ""})
    return out


def agreement_runs(repo, pr, head):
    """Completed reviews on this exact head across all reviewers — the input to convergence
    scoring (Phase 3). Excludes in-flight/failed runs."""
    base = P.prdir(repo, pr) / "users"
    runs = []
    if not head or not base.is_dir():
        return runs
    for d in sorted(base.iterdir()):
        if not d.is_dir():
            continue
        hf, rf = d / "head", d / "review.json"
        if not (hf.exists() and rf.exists() and hf.read_text().strip() == head):
            continue
        if pr_state(repo, str(pr), d.name) in ("reviewing", "queued", "failed", "stopped"):
            continue
        try:
            rev = json.loads(rf.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        rd = lambda n: ((d / n).read_text().strip() if (d / n).exists() else "")
        runs.append({"login": d.name, "effort": rd("effort"), "model": rd("model"),
                     "skill": rd("skill") or "global", "focus": rd("focus"),
                     "comments": rev.get("comments", []) or []})
    return runs


def convergence(repo, pr, head, viewer):
    """(per_finding_tags_by_cid, rate_summary, n_runs) for `viewer` on this head. Writes a small
    per-head index for the Phase 4 dashboard. Returns ({}, None, n) when fewer than 2 runs exist."""
    runs = agreement_runs(repo, pr, head)
    n = len(runs)
    if n < 2:
        return {}, None, n
    idx = next((i for i, r in enumerate(runs) if r["login"] == viewer), None)
    clusters = rs_agree.cluster(runs)
    ar = rs_agree.rate(clusters)
    try:                                            # persist an index for the rollup dashboard
        ad = P.prdir(repo, pr) / "agreement"
        ad.mkdir(parents=True, exist_ok=True)
        (ad / f"{head}.json").write_text(json.dumps({
            "head": head, "at": int(time.time()), **ar,
            "runs": [{"login": r["login"], "skill": r["skill"], "model": r["model"],
                      "effort": r["effort"]} for r in runs]}))
    except OSError:
        pass
    tags = rs_agree.tags_for(idx, runs, clusters) if idx is not None else {}
    return tags, ar, n


def explain_finding(repo, pr, user, idx):
    """(markdown, error) — an on-demand plain-language explanation + how-to-verify for ONE finding,
    run on the user's own Claude account (haiku, one turn). Cached per finding-content so a repeat
    click is instant and free. Dashboard-only: never touches GitHub or the posted comment."""
    rev = load_review(repo, pr, user) or {}
    comments = sorted(rev.get("comments", []), key=lambda c: SEV_ORDER.get(c.get("severity"), 9))
    if idx < 0 or idx >= len(comments):
        return None, "That finding no longer exists — re-open the review."
    c = comments[idx]
    h = sha256((str(idx) + "\x00" + (c.get("body") or "")).encode()).hexdigest()[:16]
    cf = udir(repo, pr, user) / "explain" / f"{h}.md"
    if cf.exists():
        try:
            return cf.read_text(), None
        except OSError:
            pass
    tok = user_claude_token(user)
    if not tok:
        return None, "Connect your Claude account to use this."
    meta, _ = pr_meta(repo, pr)
    ctx = (f"PR title: {meta.get('title', '')}\n"
           f"What the PR does: {(rev.get('explainer') or rev.get('summary') or '').strip()}\n\n"
           f"Finding location: {c.get('path')}:{c.get('line')} (severity {c.get('severity')})\n"
           f"Finding title: {c.get('title', '')}\n"
           f"Finding detail:\n{c.get('body', '')}")
    prompt = (
        "A reviewer who has NOT read this whole PR needs to decide whether to accept the "
        "code-review finding below. Explain it so a JUNIOR engineer fully understands, using the "
        "PR context given. Reply in GitHub markdown with EXACTLY these two sections and nothing "
        "else:\n\n"
        "**In plain words**\n- 2 to 4 short bullets: what the problem is and why it matters, in "
        "everyday language, no jargon or symbol names.\n\n"
        "**How to check it yourself**\n- 1 to 3 concrete steps to confirm in ~30 seconds whether "
        "the finding is real: which file/function to open, what to look for, and what a broken vs. "
        "a fine case looks like.\n\n"
        "Be specific to THIS finding; do not restate it verbatim.\n\n---\n" + ctx)
    try:
        r = subprocess.run(["claude", "-p", prompt, "--max-turns", "1", "--model", "haiku"],
                           capture_output=True, text=True, timeout=90,
                           stdin=subprocess.DEVNULL,
                           env={**os.environ, "CLAUDE_CODE_OAUTH_TOKEN": tok})
    except FileNotFoundError:
        return None, "claude is not installed on this box."
    except subprocess.TimeoutExpired:
        return None, "Claude did not answer in time — try again."
    if r.returncode != 0:
        tail = ((r.stderr or r.stdout or "error").strip().splitlines() or ["error"])[-1]
        return None, tail[:200]
    md = (r.stdout or "").strip()
    if not md:
        return None, "No explanation was produced — try again."
    try:
        cf.parent.mkdir(parents=True, exist_ok=True)
        cf.write_text(md)
    except OSError:
        pass
    return md, None


def review_history(repo, pr, login):
    """Past runs, newest first: list of (ts, effort, focus, findings, event)."""
    hd = udir(repo, pr, login) / "history"
    if not hd.is_dir() and login == REVIEWER:
        hd = P.prdir(repo, pr) / "history"      # legacy shared history for the box owner
    if not hd.is_dir():
        return []
    out = []
    for sub in sorted(hd.iterdir(), reverse=True):
        if not sub.is_dir() or not sub.name.isdigit():
            continue
        rev = {}
        try:
            rev = json.loads((sub / "review.json").read_text())
        except (OSError, json.JSONDecodeError):
            pass
        read = lambda n: (sub / n).read_text().strip() if (sub / n).exists() else ""  # noqa: E731
        out.append({"ts": int(sub.name), "effort": read("effort"), "focus": read("focus"),
                    "findings": len(rev.get("comments", [])),
                    "event": rev.get("event", "COMMENT")})
    return out


def load_history_review(repo, pr, login, ts):
    f = udir(repo, pr, login) / "history" / str(ts) / "review.json"
    if not f.exists() and login == REVIEWER:
        f = P.prdir(repo, pr) / "history" / str(ts) / "review.json"
    try:
        return json.loads(f.read_text()) if f.exists() else None
    except json.JSONDecodeError:
        return None


def _kill_group(pidfile):
    """Force-stop a spawned job by its process group. SIGTERM then SIGKILL, because `claude -p`
    traps SIGTERM and keeps running (and keeps the per-PR flock held) — which is exactly why a
    stopped review used to be un-rerunnable: the lock never released, so is_running() stayed True.
    SIGKILL guarantees the group dies and the lock frees. Returns True if the group is confirmed
    gone, False if something is somehow still alive, None if there was no pid to kill."""
    try:
        pid = int(pidfile.read_text().strip())
    except (OSError, ValueError):
        pidfile.unlink(missing_ok=True)
        return None
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pid, sig)
        except OSError:
            break                                   # group already gone
        time.sleep(0.3)
    try:
        os.killpg(pid, 0)                            # signal 0 = liveness probe
        alive = True
    except OSError:
        alive = False
    pidfile.unlink(missing_ok=True)
    return not alive


def _notify_stopped(repo, pr, user, confirmed, runner, kind="review"):
    """Confirmation that a force-stop actually halted the agent (so no Claude tokens keep
    burning unnoticed) — or a warning if it may not have. Slack keeps its original wording
    (extra.text); Discord and the generic webhook render the structured fields."""
    meta = pr_meta(repo, pr)[0]
    title, url = meta.get("title", f"PR #{pr}"), meta.get("url", ghurl_of(repo, pr))
    ref = f"{repo}#{pr}"
    u = (load_users().get(user) or {}) if user else {}
    sid = u.get("slack_id", "")
    by = f"<@{sid}>" if sid else (f"`@{user}`" if user else "someone")
    acct = (f" It was running on `{runner}`'s Claude account." if runner and runner != "shared"
            else " It was running on the shared box account." if runner else "")
    if confirmed:
        text = (f"🛑 {kind.capitalize()} of *<{url}|{ref} — {title}>* was stopped by {by}. "
                f"✅ Confirmed the agent is gone and the lock is released — Claude usage has "
                f"halted.{acct}")
    else:
        text = (f"⚠️ Stop requested for the {kind} of *<{url}|{ref} — {title}>* by {by}, but a "
                f"process may still be running on the box — please check that Claude usage "
                f"stopped.{acct}")
    notify_card("review_stopped", {
        "repo": repo, "pr": str(pr), "title": title, "author": meta.get("author", ""), "url": url,
        "login": user or "", "slack_id": sid, "discord_id": u.get("discord_id", ""),
        "extra": {"status": "stopped", "job": kind.capitalize(), "confirmed": bool(confirmed),
                  "runner": runner or "", "text": text}})


def stop_review(repo, pr, user=""):
    """Force-stop a running review, verify it actually died, alert Slack, leave a re-runnable
    'stopped' status."""
    d = udir(repo, pr, user)
    runner = (d / "runner").read_text().strip() if (d / "runner").exists() else ""
    dead = _kill_group(d / "pid")
    time.sleep(0.2)
    d.mkdir(parents=True, exist_ok=True)
    (d / "status").write_text("stopped")
    confirmed = (dead is not False) and not is_running(repo, pr, user)
    _notify_stopped(repo, pr, user, confirmed, runner, "review")
    return confirmed


# --- QA guides -------------------------------------------------------------------------------
# A QA guide is a separate, lighter job than a review: run the pr-qa-guide skill against a PR and
# park the resulting markdown so it can be rendered and handed to QA. Its state keys are all
# `qa.*` so a guide and a review can coexist for the same PR without colliding.
def qa_running(repo, pr):
    f = P.prdir(repo, pr) / ".qa.lock"
    if not f.exists():
        return False
    try:
        fd = os.open(f, os.O_RDWR)
    except OSError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    except OSError:
        return True
    finally:
        os.close(fd)


def qa_status_text(repo, pr):
    try:
        return (P.prdir(repo, pr) / "qa.status").read_text().strip()
    except OSError:
        return ""


def load_qa(repo, pr):
    try:
        return (P.prdir(repo, pr) / "qa.md").read_text()
    except OSError:
        return ""


def qa_meta(repo, pr):
    for name in ("qa_meta.json", "meta.json"):
        f = P.prdir(repo, pr) / name
        if f.exists():
            try:
                return json.loads(f.read_text())
            except (OSError, json.JSONDecodeError):
                pass
    return {}


def qa_state(repo, pr):
    """'running' | 'failed' | 'stopped' | 'done' | 'none'."""
    if qa_running(repo, pr):
        return "running"
    s = qa_status_text(repo, pr)
    if s.startswith("failed"):
        return "failed"
    if s == "stopped" and not load_qa(repo, pr):
        return "stopped"
    return "done" if load_qa(repo, pr) else "none"


def qa_list():
    out = []
    for repo, num, d in P.iter_prdirs():
        if (d / "qa.md").exists():
            m = qa_meta(repo, num)
            out.append({"repo": repo, "num": num, "title": m.get("title", f"PR #{num}"),
                        "at": int((d / "qa.md").stat().st_mtime)})
    return sorted(out, key=lambda x: -x["at"])


def stop_qa(repo, pr, user=""):
    d = P.prdir(repo, pr)
    dead = _kill_group(d / "qa.pid")
    time.sleep(0.2)
    (d / "qa.status").write_text("stopped")
    confirmed = (dead is not False) and not qa_running(repo, pr)
    _notify_stopped(repo, pr, user, confirmed, "", "QA guide")
    return confirmed


def render_qa(md):
    """Render the QA guide markdown, turning '- [ ]' / '- [x]' items into real checkboxes."""
    h = rs_md.render(md)
    h = re.sub(r"<li>\s*\[[ ]\]\s*", "<li class=task>", h)
    h = re.sub(r"<li>\s*\[[xX]\]\s*", "<li class='task done'>", h)
    return h

# --- repository profile ----------------------------------------------------------------------
# One profile per repository (bin/profile-repo.sh → $ROOT/profiles/<owner>__<name>/): the critical
# paths every Standard/Deep review of that repo is told to walk, plus its risk paths and rules.
# The job's state keys mirror the QA job (.lock, status, pid, usage.json); the artefacts are
# profile.json + the editable profile.md (rs_profile.py owns the schema and the files).
PROFILE_PHASES = ["Fetching the repository", "Gathering signals", "Asking the model",
                  "Validating paths"]


def _flock_held(f):
    """True while some process holds an exclusive flock on `f` (the job is running)."""
    if not f.exists():
        return False
    try:
        fd = os.open(f, os.O_RDWR)
    except OSError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    except OSError:
        return True
    finally:
        os.close(fd)


def profile_running(repo):
    return _flock_held(rs_profile.profile_dir(repo) / ".lock")


def profile_status_text(repo):
    try:
        return (rs_profile.profile_dir(repo) / "status").read_text().strip()
    except OSError:
        return ""


def profile_state(repo):
    """'running' | 'failed' | 'stopped' | 'done' | 'none'."""
    if profile_running(repo):
        return "running"
    s = profile_status_text(repo)
    has = rs_profile.load_profile(repo) is not None
    if s.startswith("failed") and not has:
        return "failed"
    if s == "stopped" and not has:
        return "stopped"
    return "done" if has else "none"


def stop_profile(repo):
    d = rs_profile.profile_dir(repo)
    dead = _kill_group(d / "pid")
    time.sleep(0.2)
    d.mkdir(parents=True, exist_ok=True)
    (d / "status").write_text("stopped")
    return (dead is not False) and not profile_running(repo)


def profile_usage(repo):
    """Model + token totals of the last profile run, or None (usage.json is best-effort)."""
    try:
        u = json.loads((rs_profile.profile_dir(repo) / "usage.json").read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return {"model": u.get("model") or "unknown",
            "tokens": int(u.get("input_tokens") or 0) + int(u.get("output_tokens") or 0),
            "cacheReadTokens": int(u.get("cache_read_input_tokens") or 0),
            "costUsd": float(u.get("cost_usd") or 0),
            "durationMs": int(u.get("duration_ms") or 0)}


def auto_profile_map():
    """settings.json `auto_profile`: {slug: bool} — re-profile when the file tree changes."""
    v = rs_settings.read_file(SETTINGS).get("auto_profile")
    return {k: bool(x) for k, x in v.items()} if isinstance(v, dict) else {}


def set_auto_profile(repo, on):
    cur = auto_profile_map()
    cur[P.repo_slug(repo)] = bool(on)
    rs_settings.save(SETTINGS, {"auto_profile": cur})


def profile_tree_files(repo):
    """Tracked files of the base clone (for validating an edited profile), or None without one."""
    base = P.base_dir(repo)
    if not (base / ".git").exists():
        return None
    try:
        r = subprocess.run(["git", "-C", str(base), "ls-files"], capture_output=True,
                           text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return [f for f in r.stdout.splitlines() if f] if r.returncode == 0 else None


def profile_view(repo, user):
    """Everything the Skills page shows for one repository's profile."""
    exp, sig = mint("profile", user, ACTION_TTL)
    d = rs_profile.profile_dir(repo)
    prof = rs_profile.load_profile(repo)
    st = profile_state(repo)
    out = {"repo": repo, "state": st, "token": {"exp": exp, "sig": sig},
           "connected": claude_connected(user), "isAdmin": is_admin(user),
           "autoProfile": auto_profile_map().get(P.repo_slug(repo), False),
           "counts": rs_profile.counts(prof) if prof else None,
           "versions": rs_profile.versions(repo), "md": "", "json": prof, "last": None}
    if prof:
        try:
            out["md"] = (d / "profile.md").read_text()
        except OSError:
            out["md"] = rs_profile.to_markdown(prof)
        m = prof.get("meta") or {}
        at = int(m.get("generated_at") or 0)
        runner = ""
        try:
            runner = (d / "runner").read_text().strip()
        except OSError:
            pass
        out["last"] = {"at": at, "when": f"{fmt_date(at)} ({ago(at)})" if at else "",
                       "model": m.get("model") or "", "usage": profile_usage(repo),
                       "dropped": list(m.get("dropped_globs") or []), "runner": runner,
                       "editedAt": m.get("edited_at") or None, "editedBy": m.get("edited_by") or "",
                       "head": (m.get("head") or "")[:12]}
    if st == "running":
        s = profile_status_text(repo).lower()
        cur = (0 if "fetch" in s else 1 if "signal" in s else
               2 if ("model" in s or "queued" in s) else 3)
        out["running"] = {"phases": PROFILE_PHASES, "cur": cur, "queued": "queued" in s,
                          "text": profile_status_text(repo)}
    elif st == "failed":
        out["failed"] = profile_status_text(repo)
    elif st == "stopped":
        out["stopped"] = True
    return out


def save_profile_edit(repo, user, body):
    """Apply a dashboard edit: markdown (parsed back) or a JSON profile. Validates every path
    against the base clone's tree when one is on disk, versions the previous file. Returns an
    error string or ""."""
    if isinstance(body.get("json"), dict):
        raw = body["json"]
    elif isinstance(body.get("md"), str):
        raw = rs_profile.from_markdown(body["md"])
    else:
        return "Send `md` or `json`."
    prev = rs_profile.load_profile(repo) or {}
    clean, dropped, err = rs_profile.validate_profile(raw, profile_tree_files(repo))
    if err:
        return f"Not saved: {err}."
    meta = dict(prev.get("meta") or {})
    meta.update({"edited_at": int(time.time()), "edited_by": user,
                 "dropped_globs": dropped})
    rs_profile.save_profile(repo, clean, meta)
    print(f"profile edited by {user} for {repo}: {rs_profile.counts(clean)}"
          + (f", dropped {dropped}" if dropped else ""), flush=True)
    return ""


def verify_pat(pat):
    """(login, name, error). Proves the token is real and can see the repo before storing it."""
    r = gh(["api", "user"], token=pat, timeout=20)
    if r.returncode != 0:
        return None, None, "GitHub did not accept that token."
    try:
        me = json.loads(r.stdout or "{}")
    except json.JSONDecodeError:
        return None, None, "Could not parse GitHub's response."
    login = me.get("login")
    if not login:
        return None, None, "GitHub returned no login for that token."
    visible = [r for r in REPOS if gh(["api", f"repos/{r}"], token=pat, timeout=20).returncode == 0]
    if REPOS and not visible:
        return None, None, (f"That token cannot see {', '.join(REPOS)} — it needs the `repo` "
                            "scope (or access to at least one of them).")
    return login, me.get("name") or "", None


# --- sessions ------------------------------------------------------------------------------
def session_sig(login, exp):
    return hmac.new(SECRET.encode(), f"session:{login}:{exp}".encode(), sha256).hexdigest()


# Optional: a parent domain to scope the session cookie to, so one login works across several
# hostnames that all point at this instance. Empty (the default) = host-only cookies.
RS_DOMAIN = ENV.get("RS_DOMAIN", "")
# Optional: the hostnames that are all THIS instance (comma-separated). When two or more are
# listed, an unauthenticated visit on one bounces through another to pick up an existing
# session (cross-host SSO). Empty (the default) = feature off.
HOST_ALIASES = [h.strip().lower() for h in ENV.get("RS_HOST_ALIASES", "").split(",")
                if h.strip()]


def _cookie_domain(host):
    """Scope the session cookie to RS_DOMAIN when the request host sits under it. Host-only
    otherwise (localhost, tests, a single hostname) — a Domain that doesn't match the host is
    dropped by the browser."""
    h = (host or "").split(":")[0]
    if RS_DOMAIN and (h == RS_DOMAIN or h.endswith("." + RS_DOMAIN)):
        return f"Domain=.{RS_DOMAIN}; "
    return ""


# RS_COOKIE_SECURE=0 drops the Secure flag, for a plain-http local install (Docker on
# localhost). Anything reachable from outside must stay behind TLS with the default.
COOKIE_SECURE = " Secure;" if os.environ.get("RS_COOKIE_SECURE", "1") != "0" else ""


def session_cookie(login, host=""):
    exp = int(time.time()) + SESSION_TTL
    return (f"rs_session={login}:{exp}:{session_sig(login, exp)}; {_cookie_domain(host)}Path=/; "
            f"Max-Age={SESSION_TTL}; HttpOnly;{COOKIE_SECURE} SameSite=Lax")


def clear_session_cookie(host=""):
    return (f"rs_session=; {_cookie_domain(host)}Path=/; Max-Age=0; HttpOnly;{COOKIE_SECURE} "
            "SameSite=Lax")


def _is_alias_host(host):
    """One of the RS_HOST_ALIASES hostnames — only meaningful when at least two are listed."""
    h = (host or "").split(":")[0].lower()
    return len(HOST_ALIASES) >= 2 and h in HOST_ALIASES


def _sibling_host(host):
    """Another alias of this instance to ask for a session, or "" when not on an alias host."""
    h = (host or "").split(":")[0].lower()
    if not _is_alias_host(h):
        return ""
    return next((a for a in HOST_ALIASES if a != h), "")


def _accept_url_ok(url):
    """A handoff token may only be handed to our own alias hosts' accept endpoint — never an
    arbitrary URL (that would leak the token)."""
    try:
        u = urlparse(url)
    except ValueError:
        return False
    return (u.scheme == "https" and _is_alias_host(u.netloc)
            and u.path.rstrip("/") == "/handoff/accept")


def session_user(headers):
    """The signed-in login, or None. A user removed from users.json is signed out at once."""
    jar = SimpleCookie(headers.get("Cookie", ""))
    m = jar.get("rs_session")
    if not m:
        return None
    parts = m.value.split(":")
    if len(parts) != 3:
        return None
    login, exp, sig = parts
    try:
        if int(exp) < time.time():
            return None
    except ValueError:
        return None
    if not hmac.compare_digest(session_sig(login, exp), sig):
        return None
    return login if login in load_users() else None


# --- device tokens (bearer) -----------------------------------------------------------------
# A mobile app, a CLI or a second browser holds an opaque token instead of the cookie; only its
# hash is stored (rs_devices). Same powers as the cookie — post and approve as the user —
# and no more: it can never read the GitHub or Claude token. Revocable per device.
def bearer_lookup(headers):
    """(login, device_hash) for a live device token in `Authorization: Bearer`, else
    (None, None). A user removed from users.json, or a token idle for 180 days, is refused.
    Bumps last_seen at most once a minute so users.json writes stay rare."""
    tok = rs_dev.parse_bearer(headers)
    if not tok:
        return None, None
    login, h, rec = rs_dev.lookup(load_users(), tok)
    if not login:
        return None, None
    if rs_dev.needs_bump(rec):
        def bump(users):
            r = ((users.get(login) or {}).get("devices") or {}).get(h)
            if isinstance(r, dict):
                r["last_seen"] = int(time.time())
        modify_users(bump)
    return login, h


def bearer_user(headers):
    return bearer_lookup(headers)[0]


def request_user(headers):
    """Who is calling an /api/* endpoint: the session cookie, else a device token."""
    return session_user(headers) or bearer_user(headers)


def server_url(headers):
    """The URL a device should talk to afterwards: PUBLIC_URL, else what the browser used."""
    if PUBLIC_URL:
        return PUBLIC_URL
    host = headers.get("Host", "") or "localhost"
    proto = headers.get("X-Forwarded-Proto") or ("https" if COOKIE_SECURE else "http")
    return f"{proto}://{host}"


def guess_device_name(headers):
    ua = headers.get("User-Agent", "")
    for needle, name in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android phone"),
                         ("Macintosh", "Mac"), ("Windows", "Windows PC"), ("Linux", "Linux")):
        if needle in ua:
            return name
    return "This device"


def device_page(login, headers, name):
    """The /device interstitial: the last page before a token is handed to the app. Shows the
    server and the GitHub login being bound so a phished user sees the mismatch, and mints
    only on a click — a browser must never silently pass a credential to a custom scheme."""
    srv = server_url(headers)
    e = html.escape
    return (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{e(BRAND)} — connect this device</title>"
        f"<link rel=icon href='{rs_assets.FAVICON}'>"
        "<link rel=stylesheet href='/static/app.css'></head><body>"
        "<div class=auth><div class=authcard>"
        f"<h1>{e(BRAND)}</h1>"
        "<p class=authsub>Connect this device</p>"
        "<p class=authlead>The app will get a token that lets it act as you on this server. "
        "Check both values before you continue.</p>"
        "<div class=devbind>"
        f"<div><span class=muted>Server</span><br><code>{e(srv)}</code></div>"
        f"<div><span class=muted>GitHub login</span><br><code>{e(login)}</code></div>"
        "</div>"
        "<form id=devform><label class='muted sm' for=devname>Device name</label>"
        f"<input class=in id=devname maxlength=60 value='{e(name)}' autocomplete=off>"
        "<button class='btn primary block' type=submit id=devgo>Open the app</button></form>"
        "<div id=devout hidden></div>"
        "<p class=authfine>Not you? <a href='/logout'>Sign out</a> and sign in again. "
        "Devices can be revoked any time in Settings → Devices.</p>"
        "</div></div>"
        "<script>"
        "(function(){var f=document.getElementById('devform'),o=document.getElementById('devout'),"
        "b=document.getElementById('devgo');"
        f"var srv={json.dumps(srv)};"
        "f.addEventListener('submit',async function(ev){ev.preventDefault();b.disabled=true;"
        "b.textContent='Creating token…';"
        "try{var r=await fetch('/api/device-token',{method:'POST',credentials:'same-origin',"
        "headers:{'Content-Type':'application/json'},"
        "body:JSON.stringify({name:document.getElementById('devname').value})});"
        "var d=await r.json();if(!r.ok||!d.token)throw new Error(d.error||('HTTP '+r.status));"
        "var link='reviewstage://auth?token='+encodeURIComponent(d.token)+'&server='+"
        "encodeURIComponent(srv);o.hidden=false;"
        "o.innerHTML=\"<p class='muted sm'>Opening the app… If nothing happens, \"+"
        "\"<a id=devlink>tap here</a>, or paste the token into the CLI. It is shown once.</p>\"+"
        "\"<pre class=devtok id=devtok></pre>\";"
        "document.getElementById('devlink').href=link;"
        "document.getElementById('devtok').textContent=d.token;"
        "f.hidden=true;window.location.href=link;}"
        "catch(e){b.disabled=false;b.textContent='Open the app';o.hidden=false;"
        "o.innerHTML=\"<div class='banner err'><span>🚫</span><div></div></div>\";"
        "o.querySelector('div div').textContent=String(e.message||e);}});})();"
        "</script></body></html>")


# --- signing ------------------------------------------------------------------------------
# HMAC over action:subject:exp. For PR actions the subject is `owner/name#123` (pr_subject);
# for settings/handoff tokens it is the login. Links signed before the repo dimension existed
# used the bare PR number as the subject; verify() still accepts those during SIG_GRACE_DAYS.
def sign(action, subject, exp):
    return hmac.new(SECRET.encode(), f"{action}:{subject}:{exp}".encode(), sha256).hexdigest()


def pr_subject(repo, pr):
    return f"{repo}#{pr}"


def mint(action, subject, ttl):
    exp = int(time.time()) + ttl
    return exp, sign(action, subject, exp)


def legacy_sig_ok(action, pr, exp, sig):
    """A pre-multi-repo signature (action:pr:exp), accepted only within the grace window that
    started when this server first ran with repo-aware signing."""
    if not pr or SIG_GRACE_DAYS <= 0:
        return False
    try:
        since = int(SIG_V2_SINCE.read_text().strip())
    except (OSError, ValueError):
        return False
    if time.time() > since + SIG_GRACE_DAYS * 86400:
        return False
    return hmac.compare_digest(sign(action, str(pr), exp), sig)


def link(action, repo, pr, ttl=PAGE_TTL):
    # Pages are gated by the session cookie, so they get plain, bookmarkable URLs. Only the
    # actions that change something carry a signed, expiring token.
    if not action:
        return "/"
    rq = f"repo={quote(repo, safe='')}&" if repo else ""
    if action == "pr":
        return f"/pr?{rq}pr={pr}"
    exp, sig = mint(action, pr_subject(repo, pr) if pr else "", ttl)
    q = f"?{rq}pr={pr}&exp={exp}&sig={sig}" if pr else f"?exp={exp}&sig={sig}"
    return f"/{action}{q}"


def verify(action, subject, exp, sig, legacy_pr=""):
    if not (SECRET and sig and exp):
        return "Missing or unsigned link."
    try:
        if int(exp) < time.time():
            return "This link has expired — reload the page for a fresh one."
    except ValueError:
        return "Malformed link."
    if not hmac.compare_digest(sign(action, subject, exp), sig) \
            and not legacy_sig_ok(action, legacy_pr, exp, sig):
        # Overwhelmingly this is a link minted under a previous RS_SECRET — the box was
        # rebuilt, or .env was regenerated. Say so, rather than implying tampering.
        return ("This link was signed with a different key — it is almost certainly from "
                "before this box was rebuilt. Open the newest dashboard link in Slack.")
    return None


# --- github -------------------------------------------------------------------------------
def gh(args, timeout=45, token=None):
    """Runs gh with the service token, or with a specific user's PAT for writes-as-them."""
    return subprocess.run(["gh", *args], capture_output=True, text=True, timeout=timeout,
                          env={**os.environ, "GH_TOKEN": token or PAT})


def gh_json(args, default=None):
    r = gh(args)
    if r.returncode != 0:
        return default
    try:
        return json.loads(r.stdout or "null")
    except json.JSONDecodeError:
        return default


def fetch_pr_files(repo, pr):
    """(files, error). Never conflate a failed API call with an empty diff.

    `--slurp` wraps whatever came back in an array, so a GitHub error object arrives looking
    like a page of results — flattening it yields no filenames and every comment then looks
    un-anchorable. Left unchecked that posts a review with all findings dumped into the
    summary instead of anchored inline. So: validate the shape and refuse on anything odd.
    """
    last = "unknown error"
    for attempt in range(2):   # GitHub's files endpoint 404s intermittently under degradation
        r = gh(["api", f"repos/{repo}/pulls/{pr}/files", "--paginate", "--slurp"])
        if r.returncode == 0:
            try:
                pages = json.loads(r.stdout or "null") or []
            except json.JSONDecodeError:
                last = "could not parse the GitHub response"
                continue
            files, bad = [], False
            for page in pages:
                if isinstance(page, list):
                    files.extend(page)
                elif isinstance(page, dict) and "filename" in page:
                    files.append(page)
                else:
                    bad, last = True, f"unexpected response: {str(page)[:200]}"
                    break
            if not bad:
                return files, None
        else:
            last = (r.stderr or "gh failed").strip().splitlines()[-1][:300]
        if attempt == 0:
            time.sleep(1.5)
    return None, last


def gist(body, limit=120):
    """One-line plain-text gist of a finding, for the approval checklist."""
    t = re.sub(r"```.*?```", "", body or "", flags=re.S)
    t = re.sub(r"[`*_>#]", "", t).replace("\n", " ")
    t = re.sub(r"\s+", " ", t).strip()
    cut = t.split(". ")[0].strip(" .")
    return (cut[:limit].rstrip() + "…") if len(cut) > limit else cut


def default_approve_msg(rev):
    """LGTM plus the outstanding items, so approving still leaves a clear ask."""
    items = [c for c in rev.get("comments", [])
             if c.get("severity") in ("blocker", "should-fix")]
    if not items:
        return "LGTM 🚀"
    lines = ["LGTM — just handle these before merge:", ""]
    for c in items:
        loc = c.get("path", "")
        line = c.get("line")
        where = f"`{loc}:{line}`" if line else f"`{loc}`"
        lines.append(f"- {where} — {gist(c.get('body', ''))}")
    return "\n".join(lines)


def can_approve(repo, pr, login):
    """(ok, why) — may `login` approve this PR?

    Deliberately NOT "is `login` a requested reviewer": GitHub clears the review request the
    moment any review is submitted, including a plain comment one. Gating on that made
    post-then-approve structurally impossible. What actually matters is that the PR is open,
    it is not the user's own PR (GitHub forbids self-approval), and this box genuinely
    reviewed it — which, combined with the signed session and action token, is the control.
    """
    r = gh(["api", f"repos/{repo}/pulls/{pr}"], token=user_pat(login))
    if r.returncode != 0:
        err = (r.stderr or "unknown error").strip().splitlines()[-1][:250]
        return False, f"GitHub rejected the check: {err}"
    try:
        d = json.loads(r.stdout or "null") or {}
    except json.JSONDecodeError:
        return False, "Could not parse GitHub's response."
    if (d.get("state") or "").lower() != "open":
        return False, "That PR is no longer open."
    if d.get("draft"):
        return False, "That PR is still a draft."
    if ((d.get("user") or {}).get("login")) == login:
        return False, "GitHub does not allow approving your own PR."
    if not upath(repo, pr, login, "review.json").exists():
        return False, "No review has been run for this PR on this box."
    return True, ""
STATIC_DIR = BIN / "static"
PWA_ROOT_FILES = ("/sw.js", "/manifest.webmanifest", "/offline.html")


def index_html():
    """The minimal HTML shell the React SPA mounts into (bundle built to bin/static/app.*)."""
    return (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{html.escape(BRAND)}</title>"
        f"<link rel=icon href='{rs_assets.FAVICON}'>"
        "<link rel=manifest href='/manifest.webmanifest'>"
        "<meta name=theme-color content='#0a0b12'>"
        "<meta name=color-scheme content='dark'>"
        "<meta name=mobile-web-app-capable content='yes'>"
        "<meta name=apple-mobile-web-app-capable content='yes'>"
        "<meta name=apple-mobile-web-app-status-bar-style content='black-translucent'>"
        f"<meta name=apple-mobile-web-app-title content='{html.escape(BRAND)}'>"
        "<link rel=apple-touch-icon href='/icons/apple-touch-icon.png'>"
        "<link rel=preconnect href='https://fonts.googleapis.com'>"
        "<link rel=preconnect href='https://fonts.gstatic.com' crossorigin>"
        "<link rel=stylesheet href='https://fonts.googleapis.com/css2?"
        "family=Inter:wght@400;500;600;700&display=swap'>"
        "<link rel=stylesheet href='/static/app.css'>"
        "</head><body><div id=root></div>"
        "<script src='/static/app.js'></script></body></html>")


# --- state --------------------------------------------------------------------------------
def is_running(repo, pr, login):
    """True while run-review.sh holds this user's per-PR flock.

    Exact once the script is past its first lines — but NOT a proof of absence: the server
    writes `status` before the child exists, and bash needs a moment to reach `flock`. Callers
    deciding "is anything alive?" should use run_probe(), which also checks the pid and the
    status file's age.
    """
    return rs_state.flock_held(udir(repo, pr, login) / ".lock")


def run_probe(repo, pr, login):
    """Every liveness signal for one user's run (lock, pid, status age) and the verdict."""
    return rs_state.probe(udir(repo, pr, login))


def run_alive(repo, pr, login):
    """Is a review for this user genuinely in flight (lock held OR its pid alive)? Used where
    a false negative would spawn a duplicate that clobbers the live run's markers."""
    p = udir(repo, pr, login)
    if rs_state.flock_held(p / ".lock"):
        return True
    return rs_state.pid_alive(rs_state.read_pid(p / "pid"))


def udir(repo, pr, login):
    """Where one user's markers for one PR live: state/<owner>__<name>/<pr>/users/<login>."""
    return P.udir(repo, pr, login)


def upath(repo, pr, login, name):
    """Read path for a per-user marker.

    Falls back to the legacy per-PR marker for the box owner: before the multi-user layout
    every marker sat directly in the PR dir, and all of it was REVIEWER's. Writers always
    target udir(); only reads consult the legacy spot, so nothing new lands there.
    """
    p = udir(repo, pr, login) / name
    if p.exists():
        return p
    legacy = P.prdir(repo, pr) / name
    if login == REVIEWER and legacy.exists():
        return legacy
    return p


def touch_user(repo, pr, login, name="opened"):
    d = udir(repo, pr, login)
    d.mkdir(parents=True, exist_ok=True)
    f = d / name
    if not f.exists():
        f.write_text(str(int(time.time())))


def pr_state(repo, pr, login):
    if upath(repo, pr, login, "archived").exists():
        return "archived"
    if upath(repo, pr, login, "approved").exists():
        return "approved"
    if upath(repo, pr, login, "posted.json").exists():
        return "posted"
    sp = upath(repo, pr, login, "status")
    s = sp.read_text().strip() if sp.exists() else ""
    if not s:
        return "new"
    if s.startswith("failed"):
        return "failed"
    if s == "stopped":
        return "stopped"
    if s.startswith(("done", "posted", "dry-run")):
        return "done"
    probe = run_probe(repo, pr, login)
    if probe["state"] == "stalled":
        _log_stalled(repo, pr, login, s, probe)
    return probe["state"]


_STALLED_LOGGED = {}
_STALLED_LOG_EVERY = 60          # the queue re-asks every few seconds; one line a minute is plenty


def _log_stalled(repo, pr, login, status, probe):
    """One diagnosable line per stalled verdict (rate-limited per run) — `docker compose logs
    app` then shows which signal was missing when the dashboard called a run dead."""
    key = (repo, str(pr), login)
    now = time.time()
    if now - _STALLED_LOGGED.get(key, 0) < _STALLED_LOG_EVERY:
        return
    _STALLED_LOGGED[key] = now
    print(f"stalled: {repo}#{pr} login={login} status={status!r} lock_free=True "
          f"pid={probe['pid'] or 'none'} pid_alive={probe['pid_alive']} "
          f"status_age={probe['status_age']}s grace={rs_state.STARTUP_GRACE}s", flush=True)


def load_review(repo, pr, login):
    f = upath(repo, pr, login, "review.json")
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text())
    except json.JSONDecodeError:
        return None


def queue():
    """queue.json rows, each guaranteed a `repo`. Rows written before the repo dimension carry
    none and are the single configured repo's; with several repos configured they cannot be
    placed and are skipped until the poller rewrites the file (every few minutes)."""
    rows = []
    if QUEUE.exists():
        try:
            rows = json.loads(QUEUE.read_text()) or []
        except json.JSONDecodeError:
            rows = []
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        if not r.get("repo"):
            if not SINGLE_REPO:
                continue
            r = {**r, "repo": SINGLE_REPO}
        out.append(r)
    return out


def fetch_pr_meta(repo, pr):
    """Fetch a PR's identity from GitHub for one that isn't in the local queue (e.g. opened by
    number/URL from the command palette). Normalized to the queue.json shape and cached to
    meta.json so the detail header shows the real title/author/size, not just the number."""
    d = gh_json(["pr", "view", str(pr), "--repo", repo, "--json",
                 "number,title,url,additions,deletions,changedFiles,author,isDraft,"
                 "headRefOid,createdAt,updatedAt"], default=None)
    if not isinstance(d, dict) or not d.get("number"):
        return None
    m = {"repo": repo, "number": d["number"], "title": d.get("title", ""),
         "url": d.get("url", ""),
         "additions": d.get("additions", 0), "deletions": d.get("deletions", 0),
         "changedFiles": d.get("changedFiles", 0),
         "author": (d.get("author") or {}).get("login", ""),
         "isDraft": d.get("isDraft", False), "head": d.get("headRefOid", ""),
         "createdAt": d.get("createdAt"), "updatedAt": d.get("updatedAt")}
    try:
        f = P.prdir(repo, pr) / "meta.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(m))
    except OSError:
        pass
    return m


def pr_meta(repo, pr):
    """Identity for a PR, from the live queue if still there, else the cached copy, else fetched
    live from GitHub for a PR opened by number that was never in this user's queue.
    """
    for item in queue():
        if str(item.get("number")) == str(pr) and item.get("repo", "").lower() == repo.lower():
            return item, True
    f = P.prdir(repo, pr) / "meta.json"
    if f.exists():
        try:
            return {"repo": repo, **json.loads(f.read_text())}, False
        except json.JSONDecodeError:
            pass
    fetched = fetch_pr_meta(repo, pr)
    if fetched:
        return fetched, False
    return {"repo": repo, "number": pr, "title": f"PR #{pr}"}, False


def requested_of(item):
    """Logins a queue row is awaiting. Rows written before multi-user carry no `requested`
    and were, by construction, the owner's."""
    r = item.get("requested")
    return list(r) if isinstance(r, list) else [REVIEWER]


def mine(repo, pr, login):
    """Has this user touched this PR here — opened, posted, approved or archived it?"""
    if udir(repo, pr, login).exists():
        return True
    if login != REVIEWER:
        return False
    d = P.prdir(repo, pr)
    return any((d / n).exists() for n in ("posted.json", "approved", "archived", "status"))


def all_prs(login):
    """The user's queue first, then anything they touched here that has since left it."""
    live = [i for i in queue() if login in requested_of(i)]
    seen = {(i.get("repo", "").lower(), str(i.get("number"))) for i in live}
    extra = []
    for repo, num, _ in P.iter_prdirs():
        if (repo.lower(), num) not in seen and mine(repo, num, login):
            extra.append((pr_meta(repo, num)[0], False))
    extra.sort(key=lambda m: -int(m[0].get("number", 0)))
    return [(i, True) for i in live] + extra


def ghurl_of(repo, pr):
    return (pr_meta(repo, pr)[0].get("url") or f"https://github.com/{repo}/pull/{pr}")


# --- stacked PRs -----------------------------------------------------------------------------
# A "stack" is a chain of open PRs where each one's base branch is the previous one's head branch
# (Graphite/ghstack style). We walk that chain from a given PR so a reviewer can review the whole
# stack from one click instead of hunting down each PR.
_SFIELDS = "number,title,baseRefName,headRefName,url"


def _pr_bh(repo, pr):
    d = gh_json(["pr", "view", str(pr), "--repo", repo, "--json", _SFIELDS], default=None)
    return d if isinstance(d, dict) and d.get("number") else None


def _pr_first(repo, flag, branch):
    rows = gh_json(["pr", "list", "--repo", repo, "--state", "open", flag, branch,
                    "--json", _SFIELDS, "--limit", "5"], default=[])
    return rows[0] if isinstance(rows, list) and rows else None


def pr_stack(repo, pr):
    """Open PRs forming the stack that contains `pr`, ordered top (nearest mainline) → bottom.
    Just [pr] if it isn't stacked. A few gh calls, so call it on demand, not on every page."""
    info = _pr_bh(repo, pr)
    if not info:
        return []
    chain, seen, cur = [info], {info["number"]}, info
    for _ in range(15):                          # up: a PR whose head == cur's base is the parent
        p = _pr_first(repo, "--head", cur["baseRefName"])
        if not p or p["number"] in seen:
            break
        chain.insert(0, p); seen.add(p["number"]); cur = p
    cur = info
    for _ in range(15):                          # down: a PR whose base == cur's head is the child
        c = _pr_first(repo, "--base", cur["headRefName"])
        if not c or c["number"] in seen:
            break
        chain.append(c); seen.add(c["number"]); cur = c
    return chain


def pr_reviewers(repo, pr):
    """GitHub's reviewer list + each one's status + overall decision — like GitHub's Reviewers
    sidebar. Uses the REST API (works with a plain `repo` token; the GraphQL reviewRequests query
    needs `read:org`, which our service token doesn't have)."""
    reqs = gh_json(["api", f"repos/{repo}/pulls/{pr}/requested_reviewers"], default={})
    # --slurp wraps each page in an array so --paginate stays valid JSON; flatten it.
    pages = gh_json(["api", f"repos/{repo}/pulls/{pr}/reviews", "--paginate", "--slurp"], default=[])
    reviews = []
    for pg in pages if isinstance(pages, list) else []:
        reviews.extend(pg if isinstance(pg, list) else [pg])
    requested = []
    if isinstance(reqs, dict):
        for u in reqs.get("users") or []:
            if u.get("login"):
                requested.append(u["login"])
        for t in reqs.get("teams") or []:
            if t.get("slug") or t.get("name"):
                requested.append(t.get("slug") or t.get("name"))
    disp, eff = {}, {}                                # latest state per user (display) + effective
    if isinstance(reviews, list):
        for rv in reviews:                            # chronological
            login = (rv.get("user") or {}).get("login")
            st = rv.get("state")
            if not login or not st or st == "PENDING":
                continue
            disp[login] = st
            if st in ("APPROVED", "CHANGES_REQUESTED"):
                eff[login] = st
            elif st == "DISMISSED":
                eff.pop(login, None)
    out, seen = [], set()
    for who in requested:                             # a (re-)requested reviewer reads as pending
        out.append({"login": who, "state": "AWAITING"})
        seen.add(who)
    for login, st in disp.items():
        if login not in seen:
            out.append({"login": login, "state": st})
            seen.add(login)
    if any(s == "CHANGES_REQUESTED" for s in eff.values()):
        decision = "CHANGES_REQUESTED"
    elif any(s == "APPROVED" for s in eff.values()) and not requested:
        decision = "APPROVED"
    elif requested:
        decision = "REVIEW_REQUIRED"
    else:
        decision = None
    return {"reviewers": out, "decision": decision}


def sev_counts(comments):
    c = {}
    for x in comments:
        s = x.get("severity", "nit")
        c[s] = c.get(s, 0) + 1
    return c


# --- time ----------------------------------------------------------------------------------
def iso_ts(v):
    try:
        return calendar.timegm(time.strptime(v, "%Y-%m-%dT%H:%M:%SZ"))
    except (TypeError, ValueError):
        return 0


def ago(ts):
    if not ts:
        return ""
    d = int(time.time()) - int(ts)
    if d < 90:
        return "just now"
    for n, unit in ((86400, "d"), (3600, "h"), (60, "m")):
        if d >= n:
            return f"{d // n}{unit} ago"
    return "just now"


def fmt_date(ts):
    return time.strftime("%m/%d/%y", time.localtime(int(ts))) if ts else ""


def marker(repo, pr, name, login):
    """Read one user's state marker; plain-text (legacy) or JSON. Returns a dict."""
    f = upath(repo, pr, login, name)
    if not f.exists():
        return {}
    raw = f.read_text().strip()
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else {"at": int(raw or 0)}
    except (json.JSONDecodeError, ValueError):
        try:
            return {"at": int(raw)}
        except ValueError:
            return {"at": 0}


def pr_times(repo, pr, login):
    """Every timestamp we know about a PR for this user, for sorting and display."""
    rev_f = upath(repo, pr, login, "review.json")
    return {
        "reviewed": int(rev_f.stat().st_mtime) if rev_f.exists() else 0,
        "posted": marker(repo, pr, "posted.json", login).get("at", 0),
        "approved": marker(repo, pr, "approved", login).get("at", 0),
    }


TABS = [("todo", "To review"), ("reviewed", "Reviewed"), ("posted", "Posted"),
        ("approved", "Approved"), ("archived", "Archived"), ("all", "All")]
TAB_DESC = {
    "todo": "PRs awaiting your review. Open one to run the agent, then post the findings "
            "worth keeping.",
    "reviewed": "The agent has finished — read the findings and post the ones you agree with. "
                "Nothing is on GitHub yet.",
    "posted": "You've posted comments on these. Approve when you're satisfied, or leave them "
              "for the author.",
    "approved": "Done — you approved these on GitHub.",
    "archived": "Hidden from your working set. Restore any of them anytime.",
    "all": "Everything you've touched, except archived.",
}


def tab_of(st):
    if st == "archived":
        return "archived"
    if st == "approved":
        return "approved"
    if st == "posted":
        return "posted"
    if st in ("done", "failed", "stalled", "stopped"):
        return "reviewed"
    return "todo"


# --- handler ------------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "reviewstage"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}", flush=True)

    def reply(self, code, body, ctype="text/html; charset=utf-8", cookie=None):
        raw = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(raw)

    def redirect(self, to, cookie=None):
        self.send_response(303)
        self.send_header("Location", to)
        self.send_header("Content-Length", "0")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def to_login(self):
        # Only ever bounce back to a local path — an open redirect otherwise.
        nxt = self.path if self.path.startswith("/") and not self.path.startswith("//") else "/"
        return self.redirect(f"/login?next={quote(nxt, safe='')}")

    # -- GET ---------------------------------------------------------------------------------
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        route = u.path.rstrip("/") or "/"

        if route == "/health":
            return self.reply(200, "ok", "text/plain; charset=utf-8")
        if route.startswith("/static/"):
            return self.serve_static(route)
        if route in PWA_ROOT_FILES or route.startswith("/icons/"):
            # PWA files must live at the origin root: a service worker's scope is its own
            # directory, so /static/sw.js could never control /pr or /api.
            return self.serve_static("/static" + route)
        if route.startswith("/api/"):
            return self.api_get(route, q)
        if route == "/logout":
            return self.redirect("/login",
                                 cookie=clear_session_cookie(self.headers.get("Host", "")))
        if route == "/device" or (route == "/login" and q.get("device")):
            # Mobile / CLI pairing (docs/MOBILE.md): sign in as usual, then hand a device token
            # to the app from the interstitial — never straight from the login redirect.
            name = (q.get("name") or [""])[0][:60]
            nq = "&name=" + quote(name, safe="") if name else ""
            user = session_user(self.headers)
            if user and route == "/login":
                return self.redirect("/device" + ("?" + nq[1:] if nq else ""))
            if user:
                return self.reply(200, device_page(user, self.headers,
                                                   name or guess_device_name(self.headers)))
            if route == "/device":
                return self.redirect(f"/login?device=1{nq}")
            # Signed out on /login?device=1: fall through to the SPA, whose login page keeps
            # the device flag and lands on /device after sign-in.
        if route == "/oauth/start":
            if not OAUTH_ENABLED:
                return self.redirect("/login?err=" + quote(
                    "GitHub login isn't configured on this box \u2014 sign in with a token."))
            nxt = (q.get("next") or ["/"])[0]
            return self.redirect(oauth_authorize_url(
                nxt if nxt.startswith("/") and not nxt.startswith("//") else "/"))
        if route == "/oauth/callback":
            return self.oauth_callback((q.get("code") or [""])[0],
                                       (q.get("state") or [""])[0],
                                       (q.get("error_description") or
                                        q.get("error") or [""])[0])
        # Everything else is a client-routed SPA page \u2192 serve the shell. React calls
        # /api/me and shows the login screen when there is no session.
        # --- cross-host SSO: carry an existing session between RS_HOST_ALIASES hosts --------
        if route == "/handoff":
            # This host may already hold a session. If authed, mint a short handoff
            # token and bounce to the sibling's accept endpoint; else bounce back so it shows login.
            nxt = (q.get("next") or [""])[0]
            if not _accept_url_ok(nxt):
                return self.redirect("/login")
            user = session_user(self.headers)
            if user:
                exp = int(time.time()) + 120
                sig = sign("handoff", user, exp)
                sep = "&" if "?" in nxt else "?"
                return self.redirect(f"{nxt}{sep}login={quote(user)}&exp={exp}&sig={sig}")
            return self.redirect(nxt)
        if route == "/handoff/accept":
            hlogin = (q.get("login") or [""])[0]
            hexp = (q.get("exp") or [""])[0]
            hsig = (q.get("sig") or [""])[0]
            ok = (hlogin and hexp.isdigit() and hlogin in load_users() and int(hexp) > time.time()
                  and hmac.compare_digest(sign("handoff", hlogin, int(hexp)), hsig))
            if ok:
                return self.redirect("/",
                                     cookie=session_cookie(hlogin, self.headers.get("Host", "")))
            return self.redirect("/?sso=1")
        host = self.headers.get("Host", "")
        sib = _sibling_host(host)
        if sib and not q.get("sso") and route != "/login" and not session_user(self.headers):
            accept = f"https://{host}/handoff/accept"
            return self.redirect(f"https://{sib}/handoff?next=" + quote(accept, safe=""))
        user = session_user(self.headers)
        ck = session_cookie(user, host) if user else None
        return self.reply(200, index_html(), cookie=ck)

    # -- POST --------------------------------------------------------------------------------
    # --- JSON API + static (React frontend) -------------------------------------------------
    def api_json(self, obj, status=200, cookie=None):
        return self.reply(status, json.dumps(obj), "application/json; charset=utf-8", cookie)

    def serve_static(self, route):
        name = route[len("/static/"):]
        ctype = ("application/javascript; charset=utf-8" if name.endswith(".js")
                 else "text/css; charset=utf-8" if name.endswith(".css")
                 else "application/manifest+json; charset=utf-8"
                 if name.endswith(".webmanifest")
                 else "text/html; charset=utf-8" if name.endswith(".html")
                 else "image/png" if name.endswith(".png")
                 else "application/octet-stream")
        f = STATIC_DIR / name
        # basic traversal guard + must sit under STATIC_DIR
        if ".." in name or not f.is_file() or STATIC_DIR not in f.resolve().parents:
            return self.reply(404, "not found", "text/plain; charset=utf-8")
        try:
            raw = f.read_bytes()
        except OSError:
            return self.reply(404, "not found", "text/plain; charset=utf-8")
        # Bytes, not text: icons are binary. Hashed bundles could be cached longer, but app.js
        # is rebuilt in place per release, so keep every static short-lived and let sw.js
        # (which browsers re-check on every register) decide what to keep.
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control",
                         "no-cache" if name == "sw.js" else "public, max-age=3600")
        self.end_headers()
        self.wfile.write(raw)

    def api_get(self, route, q):
        user = session_user(self.headers)
        auth = "cookie" if user else ""
        if not user:
            user = bearer_user(self.headers)
            auth = "bearer" if user else ""
        if route == "/api/me":
            return self.api_json(self.api_me(user, auth))
        if not user:
            return self.api_json({"error": "unauthorized"}, 401)
        if route == "/api/devices":
            return self.api_json(self.api_devices(user))
        if route == "/api/queue":
            return self.api_json(self.api_queue(user, (q.get("tab") or ["todo"])[0],
                                                (q.get("sort") or ["newest"])[0]))
        if route in ("/api/pr", "/api/qa", "/api/stack"):
            pr = (q.get("pr") or [""])[0]
            if route == "/api/qa" and not pr:
                return self.api_json(self.api_qa_index(user))
            if not pr.isdigit():
                return self.api_json({"error": "missing pr"}, 400)
            repo, err = resolve_repo((q.get("repo") or [""])[0], pr)
            if err:
                return self.api_json({"error": err, "repos": all_repos(), "pr": pr}, 400)
            if route == "/api/pr":
                return self.api_json(self.api_pr(repo, pr, user, (q.get("v") or [""])[0]))
            if route == "/api/qa":
                return self.api_json(self.api_qa_detail(repo, pr, user))
            return self.api_json(self.api_stack(repo, pr, user))
        if route == "/api/skills":
            return self.api_json(self.api_skills(user))
        if route == "/api/profile":
            return self.api_profile_get(q, user)
        if route == "/api/integrations":
            return self.api_json(self.api_integrations(user))
        if route == "/api/settings":
            return self.api_json(self.api_settings(user))
        if route == "/api/learnings":
            return self.api_json(self.api_learnings(user))
        if route == "/api/rollup":
            rf = (q.get("repo") or [""])[0].strip()
            return self.api_json(rs_rollup.compute(STATE, ROOT, repo=rf or None))
        if route == "/api/how":
            return self.api_json({"images": rs_howimg.IMG, "brand": BRAND,
                                  "reviewer": REVIEWER, "tabs": [{"key": k, "label": lbl,
                                                                  "desc": TAB_DESC.get(k, "")}
                                                                 for k, lbl in TABS if k != "all"]})
        return self.api_json({"error": "not found"}, 404)

    def _run_form_data(self, user, meta, repo="", pr=None):
        _, skill_label = effective_skill(user, repo)
        return {"suggested": autosize_effort(meta),
                "levels": [{"key": k, "name": EFFORT[k][0], "sub": EFFORT[k][1]}
                           for k in EFFORT_ORDER],
                "models": [{"key": k, "name": n, "sub": sub} for k, n, sub in MODELS],
                "skillLabel": skill_label,
                "othersOnHead": (others_on_head(repo, pr, user) if pr else [])}

    def _tok(self, action, repo, pr, ttl=ACTION_TTL):
        exp, sig = mint(action, pr_subject(repo, pr), ttl)
        return {"exp": exp, "sig": sig}

    def api_pr(self, repo, pr, user, version):
        touch_user(repo, pr, user)
        if version.isdigit():
            rev = load_history_review(repo, pr, user, int(version)) or {}
            comments = sorted(rev.get("comments", []),
                              key=lambda c: SEV_ORDER.get(c.get("severity"), 9))
            return {"historyView": True, "repo": repo, "pr": pr, "ts": int(version),
                    "title": qa_meta(repo, pr).get("title") or pr_meta(repo, pr)[0].get("title", f"PR #{pr}"),
                    "when": f"{fmt_date(int(version))} ({ago(int(version))})",
                    "summary": rev.get("summary", ""),
                    "findings": [{"severity": c.get("severity", "nit"),
                                  "sevLabel": SEV_LABEL.get(c.get("severity", "nit"),
                                                            c.get("severity", "nit")),
                                  "path": c.get("path", "?"), "line": c.get("line", "?"),
                                  "body": c.get("body", "")} for c in comments]}
        st = pr_state(repo, pr, user)
        meta, active = pr_meta(repo, pr)
        up = lambda name: upath(repo, pr, user, name)  # noqa: E731  per-user review artifacts
        eff = review_effort(repo, pr, user)
        foc = review_focus(repo, pr, user)
        runner = up("runner").read_text().strip() if up("runner").exists() else ""
        head_f = up("head")
        cur_head = meta.get("head", "")
        stale = bool(head_f.exists() and cur_head and head_f.read_text().strip() != cur_head)
        out = {
            "repo": repo, "pr": pr, "title": meta.get("title", f"PR #{pr}"), "state": st,
            "ghUrl": meta.get("url", f"https://github.com/{repo}/pull/{pr}"),
            "author": meta.get("author", ""),
            "size": (f"+{meta.get('additions', 0):,} −{meta.get('deletions', 0):,} · "
                     f"{meta['changedFiles']} files") if meta.get("changedFiles") else "",
            "dryRun": DRY_RUN,
            "awaiting": bool(active and user in requested_of(meta)),
            "runner": runner,
            "effortBadge": ({"label": EFFORT[eff][0], "hint": EFFORT[eff][2]}
                            if eff and st not in ("reviewing", "queued") else None),
            "usage": (review_usage(repo, pr, user) if st not in ("reviewing", "queued") else None),
            "focus": foc,
            "stale": stale,
            "risk": [risk_banner(f) for f in review_risk(repo, pr, user)],
            "timeline": self._timeline_data(repo, pr, user),
            "reviewers": (pr_reviewers(repo, pr) if st not in ("reviewing", "queued") else None),
            "claudeConnected": claude_connected(user),
            "runForm": self._run_form_data(user, meta, repo, pr),
            "tokens": {"review": self._tok("review", repo, pr, PAGE_TTL),
                       "stop": self._tok("stop", repo, pr), "post": self._tok("post", repo, pr),
                       "approve": self._tok("approve", repo, pr), "markdone": self._tok("markdone", repo, pr),
                       "archive": self._tok("archive", repo, pr),
                       "unarchive": self._tok("unarchive", repo, pr),
                       "explain": self._tok("explain", repo, pr, PAGE_TTL)},
            "history": review_history(repo, pr, user),
        }
        if st == "reviewing":
            s = up("status").read_text().strip().lower() if up("status").exists() else ""
            reff = eff or "standard"
            out["reviewing"] = {
                "phases": ["Fetching the PR", "Checking out the branch", "Reviewing the diff",
                           "Writing the findings"],
                "cur": (0 if "fetch" in s else 1 if ("checking out" in s or "queued" in s)
                        else 2 if "reviewing" in s else 3),
                "queued": "queued" in s, "effortLabel": EFFORT[reff][0],
                "effortHint": EFFORT[reff][2], "focus": foc}
            return out
        if st == "stopped":
            out["stopped"] = {"halted": not is_running(repo, pr, user)}
            return out
        if st == "stalled":
            log = up("agent.log")
            # bash is gone and the lock is free, but the agent it started may still be burning
            # tokens in the same process group — offer Stop only then (the server decides).
            pid = rs_state.read_pid(udir(repo, pr, user) / "pid")
            out["stalled"] = {"was": (up("status").read_text().strip() if up("status").exists() else ""),
                              "tail": (log.read_text()[-400:].strip() if log.exists() else ""),
                              "pidAlive": bool(pid and rs_state.group_alive(pid))}
            return out
        rev = load_review(repo, pr, user)
        appr = marker(repo, pr, "approved", user)
        if not rev:
            out["notReviewed"] = True
            if st == "failed":
                out["failed"] = up("status").read_text().strip() if up("status").exists() else ""
            if appr.get("at"):
                out["approved"] = self._approved_data(appr, user)
            return out
        out["review"] = self._review_data(repo, pr, user, rev, appr)
        out["showMarkDone"] = st != "approved"
        return out

    def _timeline_data(self, repo, pr, user):
        t = pr_times(repo, pr, user)
        posted = marker(repo, pr, "posted.json", user)
        return [
            {"label": "Reviewed", "done": bool(t["reviewed"]),
             "note": ago(t["reviewed"]) if t["reviewed"] else ""},
            {"label": "Comments posted", "done": bool(t["posted"]),
             "note": (f"{posted.get('inline', 0)} inline · {fmt_date(t['posted'])}"
                      if t["posted"] else "")},
            {"label": "Approved", "done": bool(t["approved"]),
             "note": fmt_date(t["approved"]) if t["approved"] else ""}]

    def _approved_data(self, appr, user):
        return {"at": fmt_date(appr["at"]), "ago": ago(appr["at"]), "manual": bool(appr.get("manual")),
                "body": appr.get("body", ""), "user": user}

    @staticmethod
    def _as_markdown(v):
        """Coerce a field that may be a markdown string OR a list of bullet strings (the agent
        sometimes returns bullets as a JSON array) into a single markdown string."""
        if isinstance(v, list):
            out = []
            for x in v:
                t = str(x).strip()
                if t:
                    out.append(t if t[:1] in "-*#>" else f"- {t}")
            return "\n".join(out)
        return str(v or "")

    @staticmethod
    def _fallback_title(c):
        """A plain title for reviews written before title/impact existed: first line of the body,
        stripped of markdown, or the location."""
        body = (c.get("body") or "").strip()
        if body:
            line = body.splitlines()[0]
            line = re.sub(r"[`*_#>]", "", line).strip()
            if line:
                return line[:90] + ("…" if len(line) > 90 else "")
        loc = c.get("path", "?")
        return f"{loc}:{c.get('line')}" if c.get("line") not in (None, "?") else loc

    def _review_data(self, repo, pr, user, rev, appr):
        ev = rev.get("event", "COMMENT")
        comments = sorted(rev.get("comments", []),
                          key=lambda c: SEV_ORDER.get(c.get("severity"), 9))
        cs = sev_counts(comments)
        head = pr_meta(repo, pr)[0].get("head", "")
        conv_tags, conv_rate, conv_n = convergence(repo, pr, head, user)   # Phase 3
        findings = []
        for i, c in enumerate(comments):
            findings.append({"i": i, "severity": c.get("severity", "nit"),
                             "sevLabel": SEV_LABEL.get(c.get("severity", "nit"),
                                                       c.get("severity", "nit")),
                             "path": c.get("path", "?"), "line": c.get("line", "?"),
                             "thread": (c["reply_to"] if c.get("reply_to") else None),
                             "body": c.get("body", ""), "suggestion": c.get("suggestion", "") or "",
                             "low": c.get("confidence") == "low",
                             "title": c.get("title") or self._fallback_title(c),
                             "impact": (c.get("impact") or "").strip(),
                             "criticalPath": (c.get("critical_path") or "").strip(),
                             "structured": bool((c.get("title") or "").strip()
                                                and (c.get("impact") or "").strip()),
                             "agreement": conv_tags.get(rs_agree._cid(c))})
        data = {
            "event": ev, "summary": self._as_markdown(rev.get("summary")),
            "keyPoints": [str(x).strip() for x in (rev.get("keyPoints") or []) if str(x).strip()][:6],
            "explainer": self._as_markdown(rev.get("explainer")),
            "analysis": self._as_markdown(rev.get("analysis")),
            "chips": [{"kind": k, "n": n, "label": SEV_LABEL.get(k, k)}
                      for k, n in sorted(cs.items(), key=lambda kv: SEV_ORDER.get(kv[0], 9))],
            "findings": findings, "count": len(comments),
            "posted": upath(repo, pr, user, "posted.json").exists(),
            "postLabel": "Post selected" + (" (dry run)" if DRY_RUN else " to GitHub"),
            "reused": upath(repo, pr, user, "cached").exists(),
            "convergence": ({"rate": conv_rate["rate"], "confirmed": conv_rate["confirmed"],
                             "total": conv_rate["total"], "nRuns": conv_n}
                            if conv_rate else None),
        }
        if appr.get("at"):
            data["approved"] = self._approved_data(appr, user)
        else:
            blockers = cs.get("blocker", 0)
            data["approve"] = {"lgtm": blockers == 0 and ev != "REQUEST_CHANGES",
                               "blockers": blockers, "defaultMsg": default_approve_msg(rev)}
        return data

    def api_qa_index(self, user):
        return {"repos": all_repos(),
                "guides": [{"repo": g["repo"], "num": g["num"], "title": g["title"],
                            "when": f"{fmt_date(g['at'])} ({ago(g['at'])})"} for g in qa_list()]}

    def api_qa_detail(self, repo, pr, user):
        st = qa_state(repo, pr)
        meta = qa_meta(repo, pr)
        out = {"repo": repo, "pr": pr, "title": meta.get("title", f"PR #{pr}"),
               "ghUrl": meta.get("url", f"https://github.com/{repo}/pull/{pr}"),
               "state": st, "connected": claude_connected(user),
               "genToken": self._tok("qa", repo, pr, PAGE_TTL)}
        if st == "running":
            s = qa_status_text(repo, pr).lower()
            out["running"] = {"phases": ["Fetching the PR", "Checking out the branch",
                                         "Building the QA guide"],
                              "cur": (0 if "fetch" in s else
                                      1 if ("checking out" in s or "queued" in s) else 2),
                              "queued": "queued" in s}
            out["stopToken"] = self._tok("qastop", repo, pr)
        elif st == "failed":
            out["failed"] = qa_status_text(repo, pr)
        elif st == "stopped":
            out["stopped"] = True
        elif st == "done":
            out["md"] = load_qa(repo, pr)
        return out

    def api_skills(self, user):
        exp, sig = mint("settings", user, ACTION_TTL)
        choice, eff_lbl = effective_skill(user)
        return {
            "token": {"exp": exp, "sig": sig},
            "user": user, "choice": choice, "effLabel": eff_lbl,
            "hasMySkill": bool(read_skill(user)), "hasGlobal": bool(read_skill("global")),
            "teamSkill": read_skill("global"), "mySkill": read_skill(user),
            "depths": {lv: {"name": EFFORT[lv][0], "meta": EFFORT[lv][1],
                            "content": effort_depth(lv), "edited": effort_edited(lv)}
                       for lv in EFFORT_ORDER},
            "repoSkills": [{"repo": r, "content": read_skill(REPO_SKILL_PREFIX + r),
                            "has": bool(read_skill(REPO_SKILL_PREFIX + r))} for r in all_repos()],
            "stats": [{**st, "label": skill_label(st["skill"], user)}
                      for st in rs_learn.skill_stats()],
            "teamHistory": skill_history(5),
        }

    def api_settings(self, user):
        """Runtime settings for the Settings page: effective values + where each came from,
        which notification URLs .env provides, the poller's last stamp, and a signed token the
        admin sends back with PUT. Non-admins get the same view, read-only."""
        vals, src = runtime_settings()
        exp, sig = mint("runtime-settings", user, ACTION_TTL)
        return {"token": {"exp": exp, "sig": sig}, "settings": vals, "sources": src,
                "saved": rs_settings.read_file(SETTINGS),
                "env": notify_env_status(), "is_admin": is_admin(user),
                "admin": rs_settings.resolve_admin(load_users(), REVIEWER, modify_users),
                "poller": {"lastPoll": rs_settings.last_poll(ROOT),
                           "envInterval": ENV.get("POLL_INTERVAL", "")},
                "limits": {"intervalMin": rs_settings.INTERVAL_MIN,
                           "intervalMax": rs_settings.INTERVAL_MAX},
                "backends": list(rs_settings.BACKENDS), "dry_run": DRY_RUN,
                "webhooks": webhooks_status()}

    def do_PUT(self):
        """PUT /api/settings — the admin saves runtime settings. Session cookie + the signed
        token from GET (same CSRF model as every POST) + admin check; validated ranges only;
        written atomically. Everything else is 404."""
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        route = urlparse(self.path).path.rstrip("/")
        if route not in ("/api/settings", "/api/profile"):
            return self.reply(404, "not found", "text/plain; charset=utf-8")
        user = session_user(self.headers)
        if not user:
            return self.api_json({"error": "unauthorized"}, 401)
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            body = None
        if not isinstance(body, dict):
            return self.api_json({"error": "Send a JSON object."}, 400)
        if route == "/api/profile":
            return self.api_profile_put(body, user)
        if err := verify("runtime-settings", user, str(body.get("exp") or ""),
                         str(body.get("sig") or "")):
            return self.api_json({"error": err}, 403)
        if not is_admin(user):
            return self.api_json({"error": "Only the admin can change these settings."}, 403)
        clean, err = rs_settings.validate(body.get("settings") or {})
        if err:
            return self.api_json({"error": err}, 400)
        rs_settings.save(SETTINGS, clean)
        print(f"settings saved by {user}: {json.dumps(clean)}", flush=True)
        out = self.api_settings(user)
        out["bannerHtml"] = ("<div class='banner ok'><span>✓</span><div>Saved — the poller and "
                             "the scripts pick this up on their next cycle.</div></div>")
        return self.api_json(out)

    def api_integrations(self, user):
        u = load_users().get(user) or {}
        exp, sig = mint("settings", user, ACTION_TTL)
        connected = bool(u.get("claude_token_enc"))
        claude_url = ""
        if not connected:
            claude_url, _ = claude_connect_start(user)
        vals, _src = runtime_settings()
        return {"token": {"exp": exp, "sig": sig},
                "github": {"login": user,
                           "via": "oauth" if u.get("gh_token_enc") else "pat"},
                "slack": {"id": u.get("slack_id", "")},
                "discord": {"id": u.get("discord_id", "")},
                "claude": {"connected": connected, "authUrl": claude_url or ""},
                "notify": {"env": notify_env_status(), "backends": vals["notify_backends"],
                           "payloadSchema": rs_settings.PAYLOAD_SCHEMA},
                "oauth": OAUTH_ENABLED, "brand": BRAND}

    def api_learnings(self, user):
        pk = {"dropped": "blocker", "edited": "should-fix", "kept": "posted"}
        pl = {"dropped": "dropped", "edited": "reworded", "kept": "kept"}

        def item(r):
            o = r.get("outcome")
            return {"kind": pk.get(o, "archived"), "label": pl.get(o, o or ""),
                    "loc": r.get("path", "") + (f":{r['line']}" if r.get("line") else ""),
                    "severity": r.get("severity", "nit"), "gist": r.get("gist", ""),
                    "repo": r.get("repo", ""),
                    "editedGist": r.get("edited_gist", "") if o == "edited" else ""}
        return {"counts": rs_learn.counts(), "repos": all_repos(),
                "rows": [item(r) for r in rs_learn.recent(80)]}

    def api_stack(self, repo, pr, user):
        stack = pr_stack(repo, pr)
        exp, sig = mint("stackrun", pr_subject(repo, pr), PAGE_TTL)
        return {"repo": repo, "pr": pr, "isStack": len(stack) > 1,
                "connected": claude_connected(user),
                "runToken": {"exp": exp, "sig": sig},
                "levels": [{"key": k, "name": EFFORT[k][0], "sub": EFFORT[k][1]}
                           for k in EFFORT_ORDER],
                "stack": [{"num": str(it["number"]), "title": it.get("title", ""),
                           "base": it.get("baseRefName", ""), "head": it.get("headRefName", ""),
                           "state": pr_state(repo, str(it["number"]), user)} for it in stack]}

    def api_me(self, user, auth="cookie"):
        if not user:
            return {"authed": False, "brand": BRAND, "repo": SINGLE_REPO, "repos": REPOS,
                    "allowOrg": ALLOW_ORG, "dry_run": DRY_RUN,
                    "oauth": OAUTH_ENABLED, "oauth_blocked": oauth_blocked(),
                    "public_url": PUBLIC_URL, "logo": rs_assets.LOGO}
        u = load_users().get(user) or {}
        choice, skill_label = effective_skill(user)
        return {"authed": True, "login": user, "name": u.get("name") or user,
                "slack_id": u.get("slack_id", ""), "claude_connected": claude_connected(user),
                "active_skill": choice, "skill_label": skill_label, "dry_run": DRY_RUN,
                "is_admin": is_admin(user),
                # How this request was authenticated and how the GitHub token was obtained.
                "auth": auth or "cookie",
                "login_via": "oauth" if u.get("gh_token_enc") else "pat",
                "repo": SINGLE_REPO, "repos": all_repos(), "allowOrg": ALLOW_ORG,
                "brand": BRAND, "oauth": OAUTH_ENABLED, "public_url": PUBLIC_URL,
                "logo": rs_assets.LOGO,
                "webhooks_configured": bool(GITHUB_WEBHOOK_SECRET)}

    # -- devices (docs/MOBILE.md) -----------------------------------------------------------
    def api_devices(self, user):
        _, cur = bearer_lookup(self.headers)
        u = load_users().get(user) or {}
        return {"devices": rs_dev.list_devices(u, cur), "max": rs_dev.MAX_DEVICES,
                "ttl_days": rs_dev.TTL_SECONDS // 86400}

    def api_device_token(self, user, body):
        """Mint a device token. Cookie session only — a bearer may not mint another bearer."""
        name = rs_dev.clean_name(body.get("name"))
        out = {}

        def apply(users):
            u = users.get(user)
            if u is None:
                return
            tok, rec, evicted = rs_dev.add_device(u, name)
            out.update({"token": tok, "id": rec["id"], "created": rec["created"],
                        "name": rec["name"]})
            if evicted:
                out["warning"] = (f"You had {rs_dev.MAX_DEVICES} devices; the least recently "
                                  f"used ({', '.join(evicted)}) was signed out.")
        modify_users(apply)
        if not out:
            return {"error": "unauthorized"}, 401
        print(f"device token minted: {user} ({name})", flush=True)
        return out, 200

    def api_devices_revoke(self, user, body):
        n = {"n": 0}
        everything = bool(body.get("all"))
        did = str(body.get("id") or "")
        if not everything and not did:
            return {"error": "Pass a device id, or all: true."}, 400

        def apply(users):
            u = users.get(user)
            if u is not None:
                n["n"] = rs_dev.revoke(u, device_id=did, all_devices=everything)
        modify_users(apply)
        print(f"device token(s) revoked: {user} ({n['n']})", flush=True)
        return {"ok": True, "revoked": n["n"]}, 200

    def api_queue(self, user, tab, sort):
        if tab not in dict(TABS):
            tab = "todo"
        entries = []
        for item, active in all_prs(user):
            num = str(item.get("number"))
            repo = item.get("repo", "")
            st = pr_state(repo, num, user)
            rev = load_review(repo, num, user)
            cs = sev_counts(rev.get("comments", [])) if rev else {}
            t = pr_times(repo, num, user)
            upd = iso_ts(item.get("updatedAt")) or iso_ts(item.get("createdAt"))
            entries.append({"repo": repo, "num": num, "item": item, "active": active,
                            "st": st, "t": t,
                            "cs": cs, "updated": upd,
                            "touched": max(t["approved"], t["posted"], t["reviewed"], upd),
                            "blockers": cs.get("blocker", 0), "total": sum(cs.values())})
        # A PR you're not currently requested on (you just opened it, or were removed as a
        # reviewer — "no longer requested") that you haven't reviewed yet does NOT belong in
        # "To review". It stays visible under "All". Reviewed/Posted/Approved still show your
        # work on PRs that have left your live queue.
        def entry_tab(e):
            tb = tab_of(e["st"])
            if tb == "todo" and not e["active"]:
                return None
            return tb
        counts = {k: 0 for k, _ in TABS}
        for e in entries:
            tb = entry_tab(e)
            if tb:
                counts[tb] += 1
            if e["st"] != "archived":
                counts["all"] += 1
        shown = [e for e in entries
                 if entry_tab(e) == tab or (tab == "all" and e["st"] != "archived")]
        keys = {"newest": lambda e: -(e["updated"] or int(e["num"])),
                "oldest": lambda e: (e["updated"] or int(e["num"])),
                "activity": lambda e: -e["touched"],
                "findings": lambda e: (-e["blockers"], -e["total"])}
        shown.sort(key=keys.get(sort, keys["newest"]))
        rows = []
        for e in shown:
            item, t, num, repo = e["item"], e["t"], e["num"], e["repo"]
            when = []
            if t["approved"]:
                when.append(f"approved {fmt_date(t['approved'])}")
            elif t["posted"]:
                when.append(f"posted {fmt_date(t['posted'])}")
            elif t["reviewed"]:
                when.append(f"reviewed {ago(t['reviewed'])}")
            if e["updated"]:
                when.append(f"PR updated {fmt_date(e['updated'])}")
            if not e["active"]:
                when.append("no longer requested")
            size = (f"+{item.get('additions', 0):,} −{item.get('deletions', 0):,} · "
                    f"{item['changedFiles']} files") if item.get("changedFiles") else ""
            sev = [{"kind": k, "n": n, "label": SEV_LABEL.get(k, k)}
                   for k, n in sorted(e["cs"].items(), key=lambda kv: SEV_ORDER.get(kv[0], 9))]
            archived = e["st"] == "archived"
            aexp, asig = mint("unarchive" if archived else "archive", pr_subject(repo, num),
                              ACTION_TTL)
            rows.append({"repo": repo, "num": num, "title": item.get("title", ""),
                         "author": item.get("author", ""), "state": e["st"], "size": size,
                         "when": when, "sev": sev, "archived": archived,
                         "archiveToken": {"exp": aexp, "sig": asig}})
        return {"tab": tab, "sort": sort,
                "tabs": [{"key": k, "label": lbl, "count": counts[k]} for k, lbl in TABS],
                "stats": {k: counts[k] for k in ("todo", "reviewed", "posted", "approved")},
                "tabDesc": TAB_DESC.get(tab, ""),
                "rows": rows, "repos": all_repos(),
                "slackOk": bool((load_users().get(user) or {}).get("slack_id"))}

    def api_post(self, route, body):
        if route == "/api/login":
            pat = (body.get("pat") or "").strip()
            if not pat:
                return self.api_json({"error": "Paste a token."}, 400)
            login, name, err = verify_pat(pat)
            if err:
                return self.api_json({"error": err}, 400)

            def apply(users):
                prev = users.get(login) or {}
                u = dict(prev)
                u.update({"pat_enc": enc(pat), "name": name,
                          "added": prev.get("added") or int(time.time()),
                          "updated": int(time.time())})
                users[login] = u
            modify_users(apply)
            print(f"login (api): {login}", flush=True)
            return self.api_json({"ok": True, "login": login},
                                 cookie=session_cookie(login, self.headers.get("Host", "")))
        cookie_user = session_user(self.headers)
        user = cookie_user or bearer_user(self.headers)
        # Pre-session: the profile module answers /api/profile/auto itself.
        if route.startswith("/api/profile/"):
            return self.api_profile_post(route, body, user)
        if not user:
            return self.api_json({"error": "unauthorized"}, 401)
        if route == "/api/logout":
            return self.api_json({"ok": True}, cookie=clear_session_cookie(self.headers.get("Host", "")))
        if route == "/api/device-token":
            if not cookie_user:
                return self.api_json({"error": "Sign in on the web to create a device token."},
                                     403)
            return self.api_json(*self.api_device_token(user, body))
        if route == "/api/devices/revoke":
            return self.api_json(*self.api_devices_revoke(user, body))

        # Settings-token actions with no PR: skills, integrations settings, Claude connect.
        def settings_gate():
            return verify("settings", user, str(body.get("exp") or ""), str(body.get("sig") or ""))

        if route.startswith("/api/skill/"):
            step = route.rsplit("/", 1)[1]
            if err := settings_gate():
                return self.api_json({"error": err}, 403)
            form = {k: [str(v)] for k, v in body.items()}
            return self.api_json({"bannerHtml": self._skill_result(user, step, form)})
        if route == "/api/settings":
            if err := settings_gate():
                return self.api_json({"error": err}, 403)
            form = {k: [str(v)] for k, v in body.items()}
            return self.api_json({"bannerHtml": self._settings_result(user, form)})
        if route.startswith("/api/claude/"):
            step = route.rsplit("/", 1)[1]
            if err := settings_gate():
                return self.api_json({"error": err}, 403)
            form = {k: [str(v)] for k, v in body.items()}
            banner = self._claude_result(user, step, form)
            return self.api_json({"bannerHtml": banner, "connected": claude_connected(user)})

        # PR-scoped actions — all gated by the signed token in the body (same model as the forms).
        pr = str(body.get("pr") or "")
        exp, sig = str(body.get("exp") or ""), str(body.get("sig") or "")
        if not pr.isdigit():
            return self.api_json({"error": "missing pr"}, 400)
        repo, rerr = resolve_repo(str(body.get("repo") or ""), pr)
        if rerr:
            return self.api_json({"error": rerr, "repos": all_repos(), "pr": pr}, 400)

        def gate(action):
            return verify(action, pr_subject(repo, pr), exp, sig, legacy_pr=pr)

        if route == "/api/review":
            if err := gate("review"):
                return self.api_json({"error": err}, 403)
            started = self._spawn_review(repo, pr, user, str(body.get("effort") or ""),
                                         str(body.get("focus") or ""),
                                         str(body.get("model") or ""))
            # started is False when a previous run still holds the per-PR lock (e.g. a stop that
            # could not be confirmed). Surface it so the UI doesn't look like a silent no-op.
            return self.api_json({"ok": True, "started": started})
        if route == "/api/stop":
            if err := gate("stop"):
                return self.api_json({"error": err}, 403)
            return self.api_json({"ok": True, "confirmed": stop_review(repo, pr, user)})
        if route == "/api/qa/gen":
            if err := gate("qa"):
                return self.api_json({"error": err}, 403)
            self._spawn_qa(repo, pr, user)
            return self.api_json({"ok": True})
        if route == "/api/qa/stop":
            if err := gate("qastop"):
                return self.api_json({"error": err}, 403)
            return self.api_json({"ok": True, "confirmed": stop_qa(repo, pr, user)})
        if route == "/api/stack/run":
            if err := gate("stackrun"):
                return self.api_json({"error": err}, 403)
            stack_nums = [str(it["number"]) for it in pr_stack(repo, pr)]
            want = [n for n in (str(x) for x in (body.get("nums") or [])) if n in stack_nums]
            if not want:                              # no selection sent → review the whole stack
                want = stack_nums
            started = 0
            for n in want:
                if self._spawn_review(repo, n, user, str(body.get("effort") or ""),
                                      model=str(body.get("model") or "")):
                    started += 1
            return self.api_json({"ok": True, "started": started})
        if route == "/api/markdone":
            if err := gate("markdone"):
                return self.api_json({"error": err}, 403)
            d = udir(repo, pr, user)
            d.mkdir(parents=True, exist_ok=True)
            (d / "approved").write_text(json.dumps(
                {"at": int(time.time()), "manual": True,
                 "body": "Handled outside the bot — approved on GitHub directly."}))
            return self.api_json({"ok": True})
        if route == "/api/archive":
            act = "unarchive" if body.get("action") == "unarchive" else "archive"
            if err := gate(act):
                return self.api_json({"error": err}, 403)
            f = udir(repo, pr, user) / "archived"
            f.parent.mkdir(parents=True, exist_ok=True)
            if act == "archive":
                f.write_text(str(int(time.time())))
            else:
                f.unlink(missing_ok=True)
            return self.api_json({"ok": True})
        if route == "/api/explain":
            if err := gate("explain"):
                return self.api_json({"error": err}, 403)
            try:
                idx = int(body.get("idx"))
            except (TypeError, ValueError):
                return self.api_json({"error": "missing finding"}, 400)
            md, err = explain_finding(repo, pr, user, idx)
            if err:
                return self.api_json({"error": err}, 400)
            return self.api_json({"md": md})
        if route == "/api/post":
            if err := gate("post"):
                return self.api_json({"error": err}, 403)
            return self.api_json({"bannerHtml": self._post_result(repo, pr, user, self._post_form(repo, pr, user, body))})
        if route == "/api/approve":
            if err := gate("approve"):
                return self.api_json({"error": err}, 403)
            form = {"pr": [pr], "ack": ["1"] if body.get("ack") else [],
                    "approve_body": [str(body.get("body") or "")]}
            return self.api_json({"bannerHtml": self._approve_result(repo, pr, user, form)})
        return self.api_json({"error": "not found"}, 404)

    def _post_form(self, repo, pr, user, body):
        """Rebuild the form dict _post_result expects from the JSON post body. path/line/severity
        come from the stored review (not the client) — only selection, body and suggestion are
        the reviewer's to change."""
        rev = load_review(repo, pr, user) or {}
        originals = sorted(rev.get("comments", []),
                           key=lambda c: SEV_ORDER.get(c.get("severity"), 9))
        sel = set(body.get("selected") or [])
        bodies = body.get("bodies") or {}
        suggs = body.get("suggs") or {}
        form = {"pr": [pr], "count": [str(len(originals))]}
        if body.get("request_changes"):
            form["request_changes"] = ["on"]
        for i, c in enumerate(originals):
            if i in sel:
                form[f"sel_{i}"] = ["on"]
            form[f"body_{i}"] = [str(bodies.get(str(i), c.get("body", "")))]
            form[f"sugg_{i}"] = [str(suggs.get(str(i), c.get("suggestion", "") or ""))]
            form[f"path_{i}"] = [c.get("path", "")]
            form[f"line_{i}"] = [str(c.get("line", "") or "")]
            form[f"sev_{i}"] = [c.get("severity", "nit")]
        return form

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        route = urlparse(self.path).path.rstrip("/")
        if route == "/webhooks/github":
            return self.webhook_github(raw)
        if route.startswith("/api/"):
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                body = {}
            return self.api_post(route, body if isinstance(body, dict) else {})
        return self.reply(404, "not found", "text/plain; charset=utf-8")

    # -- GitHub webhook --------------------------------------------------------------------------
    def webhook_github(self, raw):
        """POST /webhooks/github. Verify, acknowledge fast, do the work on a thread. No session:
        GitHub is the caller, and the HMAC over the body is the whole authentication."""
        if not GITHUB_WEBHOOK_SECRET:
            return self.api_json({"error": "GITHUB_WEBHOOK_SECRET is not configured"}, 503)
        sig = self.headers.get("X-Hub-Signature-256", "")
        if not rs_webhook.verify_signature(GITHUB_WEBHOOK_SECRET, raw, sig):
            print("[webhook] 401: bad or missing X-Hub-Signature-256", flush=True)
            return self.api_json({"error": "signature mismatch"}, 401)
        event = self.headers.get("X-GitHub-Event", "")
        delivery = self.headers.get("X-GitHub-Delivery", "")
        if event == "ping":
            rs_webhook.record(ROOT, ping=True)
            print(f"[webhook {delivery[:8]}] ping from GitHub", flush=True)
            return self.api_json({"ok": True, "pong": True}, 200)
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self.api_json({"error": "body is not JSON"}, 400)
        if not isinstance(payload, dict):
            return self.api_json({"error": "body is not a JSON object"}, 400)
        threading.Thread(target=rs_webhook.process,
                         args=(event, payload, webhook_ctx(), delivery), daemon=True).start()
        return self.api_json({"accepted": True, "event": event, "delivery": delivery}, 202)

    # -- auth pages ----------------------------------------------------------------------------
    def oauth_callback(self, code, state, error):
        def to_login_err(msg):
            return self.redirect("/login?err=" + quote(msg))
        nxt = oauth_check_state(state)
        if nxt is None:
            return to_login_err("That sign-in link was stale or altered \u2014 try again.")
        if error or not code:
            return to_login_err("GitHub did not complete the sign-in: "
                                + (error or "no code returned"))
        d = oauth_token_request({"code": code,
                                 "redirect_uri": f"{PUBLIC_URL}/oauth/callback"})
        if not d:
            return to_login_err("GitHub rejected the sign-in code. Try again.")
        login, name, err = verify_pat(d["access_token"])
        if err:
            # Usually an org-side block, not a bad token: a GitHub App not installed on the org,
            # or an OAuth App not approved under the org's third-party access settings.
            OAUTH_BLOCKED.write_text(str(int(time.time())))
            return to_login_err(
                f"GitHub signed you in, but the token cannot see {', '.join(REPOS)}. An org owner needs to "
                "allow this app once (OAuth App: approve under Third-party access; GitHub App: "
                "install it on the org). Until then, sign in with a token.")
        OAUTH_BLOCKED.unlink(missing_ok=True)
        prev = load_users().get(login) or {}
        oauth_store(login, d, name, prev)
        print(f"login (github): {login}", flush=True)
        if not prev.get("slack_id") and not nxt.startswith("/device"):
            nxt = "/integrations?welcome=1&next=" + quote(nxt, safe="")
        return self.redirect(nxt, cookie=session_cookie(login, self.headers.get("Host", "")))

    def _claude_result(self, user, step, form):
        """Claude connect steps (cancel/disconnect/code) → banner HTML. Settings token assumed
        verified. `start` is handled in the HTML wrapper / api_integrations (it mints the URL)."""
        one = lambda k: (form.get(k) or [""])[0]  # noqa: E731
        if step == "cancel":
            claude_connect_cancel(user)
            return ""
        if step == "disconnect":
            def apply(users):
                uu = users.get(user) or {}
                for k in ("claude_token_enc", "claude_refresh_enc", "claude_exp", "claude_added"):
                    uu.pop(k, None)
                users[user] = uu
            modify_users(apply)
            claude_connect_cancel(user)
            return ("<div class='banner ok'><span>✓</span><div>Claude disconnected — you'll need "
                    "to reconnect to run reviews.</div></div>")
        code = one("code").strip()
        if not code:
            return ("<div class='banner warn'><span>⚠️</span><div>Paste the code Claude showed "
                    "you.</div></div>")
        result, err = claude_connect_code(user, code)
        if err:
            return f"<div class='banner err'><span>🚫</span><div>{html.escape(err)}</div></div>"
        ok, why = verify_claude_token(result["access_token"])
        if not ok:
            return (f"<div class='banner err'><span>🚫</span><div>Got a token from Claude but it "
                    f"did not work here: <code>{html.escape(why)}</code></div></div>")
        store_claude_token(user, result)
        print(f"claude connected: {user}", flush=True)
        return ("<div class='banner ok'><span>✓</span><div>Claude connected — reviews you start "
                "now run on your own account.</div></div>")

    def _skill_result(self, user, step, form):
        """Apply a skill/effort-depth edit and return a banner HTML string (reused by the HTML
        page and the JSON API). Assumes the settings token is already verified."""
        one = lambda k: (form.get(k) or [""])[0]  # noqa: E731
        # Which skill this edits: the team default (shared) or the user's own.
        target = "global" if one("target") == "global" else user
        who = ("the team default skill" if target == "global" else "your skill")
        err_b = lambda m: f"<div class='banner err'><span>🚫</span><div>{m}</div></div>"  # noqa
        ok = lambda m: f"<div class='banner ok'><span>✓</span><div>{m}</div></div>"  # noqa

        # Review-depth instructions (Quick/Standard/Deep) — shared, editable, with reset-to-default.
        tgt = one("target")
        if tgt.startswith("effort_"):
            level = tgt[len("effort_"):]
            if level not in EFFORT:
                return err_b("Unknown depth level.")
            name = EFFORT[level][0]
            if step == "reset":
                effort_depth_path(level).unlink(missing_ok=True)
                commit_skill_change(user, f"Reset {name} review depth to the built-in default")
                return ok(f"Reset the <b>{name}</b> depth to the built-in default.")
            text = one("skill")
            if not text.strip():
                return err_b("The depth instruction can't be empty. Use Reset to restore the "
                             "default.")
            if len(text) > 20000:
                return err_b("That's very large (>20k chars). Trim it.")
            SKILLS_DIR.mkdir(parents=True, exist_ok=True)
            effort_depth_path(level).write_text(text)
            commit_skill_change(user, f"Edited the {name} review depth")
            print(f"effort depth saved: {level} ({len(text)} chars)", flush=True)
            return ok(f"Saved the <b>{name}</b> review depth — it applies to every {name} review.")

        # Which skill runs my reviews — my own, or the shared team default.
        if step == "use":
            set_active_skill(user, one("choice"))
            _, lbl = effective_skill(user)
            return ok(f"Your reviews now run with <b>{lbl}</b>.")

        if step == "rule":
            rule = one("rule")
            if not rule.strip():
                return err_b("Type a rule to add.")
            new_text = add_skill_rule(read_skill(target), rule)
            if len(new_text) > 40000:
                return err_b("That skill is already very large (>40k chars). Trim it first.")
            save_skill(target, new_text)
            commit_skill_change(user, f"Added a rule to {who}: {tidy_rule(rule)}")
            print(f"skill rule added to {target}: {tidy_rule(rule)!r}", flush=True)
            return ok(f"Added to {who} — ReviewStage will apply it on every review: "
                      f"<b>{html.escape(tidy_rule(rule))}</b>")

        # The team default is shared — restoring the built-in wipes everyone's edits, so it takes
        # a typed confirmation and lives on its own step. A plain "reset" only clears a personal skill.
        if step == "restore":
            if target != "global":
                return err_b("Nothing to restore.")
            if one("confirm").strip().upper() != "RESTORE":
                return err_b("Type RESTORE to confirm — this discards the team's edits for "
                             "everyone.")
            restore_global_skill()
            commit_skill_change(user, "Restored the team default to the built-in review skill")
            print("team default skill restored to installed default", flush=True)
            return ok("Team default restored to the built-in review skill.")

        if step == "reset":
            if target == "global":
                return err_b("The team default can't be reset here — use “Restore built-in” "
                             "with confirmation.")
            save_skill(user, "")
            commit_skill_change(user, "Cleared a personal skill")
            return ok("Cleared your skill — your reviews use the team default now.")

        text = one("skill")
        if target == "global" and not text.strip():
            return err_b("The team default can't be emptied — everyone relies on it. To go back "
                         "to the built-in skill, use “Restore built-in”.")
        if len(text) > 40000:
            return err_b("That skill is very large (>40k chars). Trim it and try again.")
        save_skill(target, text)
        commit_skill_change(user, f"Edited {who}")
        print(f"skill saved: {target} ({len(text)} chars)", flush=True)
        return ok(f"Saved {who} — reviews now use it (with ReviewStage's output format appended).")

    def _settings_result(self, user, form):
        """Save the Slack ID, Discord ID and/or replace the GitHub PAT → banner HTML. Settings
        token assumed verified. Only touches a field the form actually sent."""
        one = lambda k: (form.get(k) or [""])[0]  # noqa: E731
        err_b = lambda m: f"<div class='banner err'><span>🚫</span><div>{m}</div></div>"  # noqa
        slack_val = one("slack_id").strip() if "slack_id" in form else None
        discord_val = one("discord_id").strip() if "discord_id" in form else None
        if discord_val and not discord_val.isdigit():
            return err_b("A Discord user ID is all digits (User Settings → Advanced → "
                         "Developer Mode, then right-click your name → Copy User ID).")
        pat = one("pat").strip()
        new_pat_enc = new_name = None
        if pat:
            login, name, err = verify_pat(pat)
            if err:
                return err_b(html.escape(err))
            if login != user:
                return err_b(f"That token belongs to <code>{html.escape(login)}</code>, not you.")
            new_pat_enc, new_name = enc(pat), name

        def apply(users):
            u = users.get(user) or {}
            if slack_val is not None:
                u["slack_id"] = slack_val
            if discord_val is not None:
                u["discord_id"] = discord_val
            if new_pat_enc is not None:
                u["pat_enc"], u["name"] = new_pat_enc, new_name
            u["updated"] = int(time.time())
            users[user] = u
        modify_users(apply)
        return "<div class='banner ok'><span>✓</span><div>Saved.</div></div>"

    def _spawn_review(self, repo, pr, user, effort="", focus="", model=""):
        """Queue one review (no redirect). Returns True if it actually spawned, False if a review
        was already running for that PR. Shared by start_review and the stack runner."""
        pr = str(pr)
        if not claude_connected(user):
            return False                            # reviews require the user's own Claude account
        d = udir(repo, pr, user)                          # each reviewer's run + review live under here
        d.mkdir(parents=True, exist_ok=True)
        touch_user(repo, pr, user)
        # run-review.sh takes a per-PR flock, so a genuine duplicate is impossible — only skip
        # when a review is ACTUALLY running. This lets a finished review be re-run and, crucially,
        # a stalled one (status stuck at "reviewing" but the process is gone) be recovered.
        # The pid counts too: a child that is still booting has not taken the lock yet, and a
        # second spawn now would overwrite its status/effort/pid markers.
        if run_alive(repo, pr, user):
            return False
        meta, _ = pr_meta(repo, pr)
        eff = effort if effort in EFFORT else autosize_effort(meta)
        focus = (focus or "").strip()[:2000]
        archive_review(repo, pr, user)                    # keep the prior run in history/
        mdl = model if model in MODEL_KEYS else ""
        head = (meta.get("head") or "").strip()
        # Phase 1 — reuse YOUR own identical re-run on this commit: 0 tokens, no LLM call.
        key = review_cache_key(user, repo, head, eff, focus, mdl)
        cf = d / "cache" / f"{key}.json"
        cached = None
        if cf.exists():
            try:
                cached = json.loads(cf.read_text())
            except (OSError, json.JSONDecodeError):
                cached = None
        if cached and cached.get("review"):
            # (the current review was already archived to history/ just above)
            (d / "review.json").write_text(json.dumps(cached["review"]))
            (d / "effort").write_text(eff)
            (d / "focus").write_text(focus)
            (d / "model").write_text(mdl)
            (d / "head").write_text(head)
            (d / "skill").write_text(cached.get("skill", "global"))
            if cached.get("risk"):
                (d / "risk").write_text(cached["risk"])
            if cached.get("usage") is not None:
                (d / "usage.json").write_text(json.dumps(cached["usage"]))
            (d / "status").write_text("done")
            (d / "cached").write_text(json.dumps(
                {"at": int(time.time()), "source_at": cached.get("created_at", 0)}))
            return True
        (d / "cached").unlink(missing_ok=True)       # a fresh run is not a reuse
        (d / "effort").write_text(eff)
        (d / "focus").write_text(focus)
        (d / "model").write_text(mdl)
        # From here until the child holds its flock the only proof of life is ours: a fresh
        # `started_at` and a just-written `status` keep pr_state() inside its startup grace, and
        # `pid` (below) names the process. Nothing observable ever says "queued" without a signal.
        (d / "pid").unlink(missing_ok=True)
        (d / "started_at").write_text(str(int(time.time())))
        (d / "status").write_text("queued")
        choice, _ = effective_skill(user, repo)
        env = review_env(user)
        env["RS_CACHE_KEY"] = key
        env["RS_EFFORT"] = eff
        env["RS_DEPTH"] = effort_depth(eff)
        env["RS_FOCUS"] = focus
        env["RS_MODEL"] = mdl
        env["RS_SKILL_CHOICE"] = choice
        # Stack context: if this PR is stacked on other open PRs, its diff is only its own changes.
        # Tell the agent the siblings exist so it doesn't flag setup a lower PR provides.
        try:
            stack = pr_stack(repo, pr)
        except Exception:
            stack = []
        if len(stack) > 1:
            rows = "\n".join(
                f"  #{it.get('number')} \u2014 {it.get('title', '')}"
                + ("  \u2190 this PR" if str(it.get("number")) == pr else "")
                for it in stack)
            env["RS_STACK"] = (
                f"This PR is part of a stack of {len(stack)} open PRs (each based on the one "
                "above). The diff you see is ONLY this PR's own changes \u2014 assume the changes "
                "from the other PRs in the stack are already present. Do not flag missing "
                "definitions, imports, migrations or setup that another PR in the stack provides; "
                "do consider cross-PR dependencies and whether this PR is coherent on top of the "
                "ones below it.\nStack (top \u2192 bottom):\n" + rows)
        with open(d / "run.log", "ab") as log:
            proc = subprocess.Popen([str(BIN / "run-review.sh"), repo, pr], stdout=log,
                                    stderr=subprocess.STDOUT, start_new_session=True, env=env)
        (d / "pid").write_text(str(proc.pid))
        return True

    # --- repository profile ------------------------------------------------------------------
    def _spawn_profile(self, repo, user):
        """Start bin/profile-repo.sh for `repo` on `user`'s Claude account. False when they have
        no connected account or a build is already running."""
        if not claude_connected(user):
            return False
        d = rs_profile.profile_dir(repo)
        d.mkdir(parents=True, exist_ok=True)
        if profile_running(repo):
            return False
        (d / "status").write_text("queued")
        env = review_env(user)
        with open(d / "run.log", "ab") as log:
            proc = subprocess.Popen([str(BIN / "profile-repo.sh"), repo], stdout=log,
                                    stderr=subprocess.STDOUT, start_new_session=True, env=env)
        (d / "pid").write_text(str(proc.pid))
        print(f"profile started for {repo} by {user}", flush=True)
        return True

    def api_profile_get(self, q, user):
        repo, err = resolve_repo((q.get("repo") or [""])[0])
        if err:
            return self.api_json({"error": err, "repos": all_repos()}, 400)
        return self.api_json(profile_view(repo, user))

    def api_profile_post(self, route, body, user):
        """POST /api/profile/run|stop (signed profile token, session) and /api/profile/auto
        (no session — signed with the server secret by pr-watch.sh, runs as the admin)."""
        repo, rerr = resolve_repo(str(body.get("repo") or ""))
        if rerr:
            return self.api_json({"error": rerr, "repos": all_repos()}, 400)
        exp, sig = str(body.get("exp") or ""), str(body.get("sig") or "")
        if route == "/api/profile/auto":
            if err := verify("profile-auto", repo, exp, sig):
                return self.api_json({"error": err}, 403)
            admin = rs_settings.resolve_admin(load_users(), REVIEWER, modify_users)
            if not (admin and claude_connected(admin)):
                print(f"auto-profile skipped for {repo}: admin has no connected Claude account",
                      flush=True)
                return self.api_json({"ok": False, "skipped": "admin has no connected Claude "
                                                              "account"})
            return self.api_json({"ok": True, "started": self._spawn_profile(repo, admin)})
        if not user:
            return self.api_json({"error": "unauthorized"}, 401)
        if err := verify("profile", user, exp, sig):
            return self.api_json({"error": err}, 403)
        if route == "/api/profile/run":
            if not claude_connected(user):
                return self.api_json({"error": "Connect your Claude account in Integrations "
                                               "to profile a repository."}, 400)
            return self.api_json({"ok": True, "started": self._spawn_profile(repo, user),
                                  **profile_view(repo, user)})
        if route == "/api/profile/stop":
            return self.api_json({"ok": True, "confirmed": stop_profile(repo),
                                  **profile_view(repo, user)})
        return self.api_json({"error": "not found"}, 404)

    def api_profile_put(self, body, user):
        """PUT /api/profile — save an edited profile (md or json), or flip auto_profile (admin)."""
        if err := verify("profile", user, str(body.get("exp") or ""),
                         str(body.get("sig") or "")):
            return self.api_json({"error": err}, 403)
        repo, rerr = resolve_repo(str(body.get("repo") or ""))
        if rerr:
            return self.api_json({"error": rerr, "repos": all_repos()}, 400)
        ok = lambda m: f"<div class='banner ok'><span>✓</span><div>{m}</div></div>"  # noqa
        if "auto_profile" in body:
            if not is_admin(user):
                return self.api_json({"error": "Only the admin can change auto-profiling."}, 403)
            set_auto_profile(repo, bool(body["auto_profile"]))
            out = profile_view(repo, user)
            out["bannerHtml"] = ok("Auto re-profiling " + ("on" if body["auto_profile"] else "off")
                                   + f" for <code>{html.escape(repo)}</code>.")
            return self.api_json(out)
        if err := save_profile_edit(repo, user, body):
            return self.api_json({"error": err}, 400)
        out = profile_view(repo, user)
        c = out.get("counts") or {}
        out["bannerHtml"] = ok(f"Saved the profile for <code>{html.escape(repo)}</code> — "
                               f"{c.get('critical', 0)} critical paths. Reviews pick it up on "
                               "their next run.")
        return self.api_json(out)

    # --- QA guides ---------------------------------------------------------------------------
    def _spawn_qa(self, repo, pr, user):
        if not claude_connected(user):              # QA runs Claude too — needs their own account
            return False
        d = P.prdir(repo, pr)
        d.mkdir(parents=True, exist_ok=True)
        if qa_running(repo, pr):
            return False
        (d / "qa.status").write_text("queued")
        env = review_env(user)                  # runs on the clicker's Claude account
        with open(d / "qa.log", "ab") as log:
            proc = subprocess.Popen([str(BIN / "run-qa.sh"), repo, pr], stdout=log,
                                    stderr=subprocess.STDOUT, start_new_session=True, env=env)
        (d / "qa.pid").write_text(str(proc.pid))
        return True

    def _post_result(self, repo, pr, user, form):
        """Post the selected comments; returns a banner HTML string (reused by the HTML page and
        the JSON API)."""
        one = lambda k: (form.get(k) or [""])[0]  # noqa: E731
        # Don't post a review that is still being (re)generated — the review.json on disk may be
        # the previous run's, and posting it produces a half-built comment on the real PR.
        if is_running(repo, pr, user):
            return ("<div class='banner warn'><span>⏳</span><div>A review is still running "
                    "for this PR — wait for it to finish, then post.</div></div>")
        # Idempotency: a successful real post writes posted.json. Refuse a second one — a
        # double-click, or a replayed 30-min action token — so a reviewer never lands two
        # reviews on the same PR. (Dry runs never write it, so they stay repeatable.)
        if upath(repo, pr, user, "posted.json").exists():
            return ("<div class='banner ok'><span>✓</span><div>Already posted to GitHub as your "
                    "review — not posting again.</div></div>")
        rev = load_review(repo, pr, user) or {}
        chosen = []
        blank = []
        for i in range(int(one("count") or 0)):
            if not form.get(f"sel_{i}"):
                continue
            line = one(f"line_{i}")
            body = one(f"body_{i}").strip()
            # A suggested change becomes a GitHub ```suggestion block appended to the comment,
            # which GitHub renders with a one-click "Apply" for the author on the anchored line.
            sugg = one(f"sugg_{i}").rstrip("\n")
            if sugg.strip():
                body = f"{body}\n\n```suggestion\n{sugg}\n```"
            # A selected finding whose text was cleared would be silently dropped downstream
            # (empty-body comments are skipped), so it never reaches GitHub and never folds into
            # the summary — the reviewer thinks they posted it. Catch it and refuse instead.
            if not body.strip():
                loc = one(f"path_{i}") + (f":{line}" if line.isdigit() else "")
                blank.append(loc or f"finding {i + 1}")
            chosen.append({"path": one(f"path_{i}"),
                           "line": int(line) if line.isdigit() else None,
                           "severity": one(f"sev_{i}"),
                           "body": body})
        if blank:
            items = ", ".join(f"<code>{html.escape(b)}</code>" for b in blank)
            return ("<div class='banner warn'><span>⚠️</span><div>These selected "
                    f"finding(s) have no text: {items}. Add a comment or unselect them before "
                    "posting.</div></div>")
        # Learnings: capture what was dropped/edited/kept before posting — the same signal the
        # dashboard used to discard. Sorted like review_body so form index i lines up. Done
        # even when nothing is chosen (dropping every finding is the strongest signal), and
        # before the dry-run branch so it learns during the pilot too.
        originals = sorted(rev.get("comments", []),
                           key=lambda c: SEV_ORDER.get(c.get("severity"), 9))
        skill_f = upath(repo, pr, user, "skill")
        skill = skill_f.read_text().strip() if skill_f.exists() else "global"
        rs_learn.record(repo, pr, user, originals, form, skill=skill)
        if not chosen:
            return ("<div class='banner warn'><span>⚠️</span><div>"
                    "Nothing selected — nothing sent.</div></div>")

        # Re-validate anchors against the CURRENT diff: the PR may have gained commits while
        # this review sat in the dashboard, and one stale line 422s the whole review.
        files, err = fetch_pr_files(repo, pr)
        if err is not None:
            return (
                f"<div class='banner err'><span>🔴</span><div><b>Could not fetch the PR diff "
                f"from GitHub — nothing was posted.</b><br>Without it every comment would be "
                f"demoted out of the diff and posted as a plain summary, so this refuses "
                f"rather than posting a degraded review. Check "
                f"<a href='https://www.githubstatus.com' target=_blank rel=noopener>"
                f"githubstatus.com</a> and retry.<br>"
                f"<code>{html.escape(err)}</code></div></div>")
        inline, orphans = rs_diff.split_anchorable(chosen, rs_diff.anchor_map(files))
        # No bot signature: this posts under the reviewer's own account, so GitHub already
        # attributes it. A trailing "Reviewed by @x" only restates the byline.
        body = (rev.get("summary") or "").strip() + rs_diff.orphan_block(orphans)
        # A COMMENT review with an empty body and no inline comments is a half-built post — refuse
        # it. (Can happen if the review has no summary and every selected finding failed to anchor.)
        if not body.strip() and not inline:
            return ("<div class='banner warn'><span>⚠️</span><div>Nothing to post — the "
                    "review has no summary and none of the selected findings could be anchored to "
                    "the current diff.</div></div>")
        # Default is a plain COMMENT review. The reviewer can deliberately choose REQUEST_CHANGES
        # from the post bar (never the agent's call) — a human-only, blocking action.
        event = "REQUEST_CHANGES" if form.get("request_changes") else "COMMENT"
        payload = {"body": body, "event": event, "comments": inline}
        ud = udir(repo, pr, user)
        ud.mkdir(parents=True, exist_ok=True)
        (ud / "payload.json").write_text(json.dumps(payload))

        if DRY_RUN:
            return (
                f"<div class='banner warn'><span>🧪</span><div><b>DRY RUN — nothing was sent "
                f"to GitHub.</b><br>Would post {len(inline)} inline comment(s)"
                + (f", {len(orphans)} folded into the summary" if orphans else "")
                + f", as <code>{event}</code>. Set <code>DRY_RUN=0</code> and restart "
                  f"the <code>reviewstage</code> service to post for real.</div></div>")

        tok = user_pat(user)
        if not tok:
            return ("<div class='banner err'><span>🚫</span><div>"
                    "Your stored GitHub token could not be read — "
                    "paste it again in <a href='/integrations'>settings</a>.</div></div>")
        r = gh(["api", "--method", "POST", f"repos/{repo}/pulls/{pr}/reviews",
                "--input", str(ud / "payload.json")], token=tok)
        if r.returncode != 0:
            return (f"<div class='banner err'><span>🔴</span><div>GitHub rejected it: <code>"
                    f"{html.escape(r.stderr[:400])}</code></div></div>")
        (ud / "posted.json").write_text(
            json.dumps({"at": int(time.time()), "inline": len(inline), "event": event}))
        return (
            f"<div class='banner ok'><span>✓</span><div>Posted {len(inline)} comment(s) as "
            f"<code>{event}</code> under <code>{html.escape(user)}</code>."
            + (f" {len(orphans)} could not be anchored and went into the summary."
               if orphans else "") + "</div></div>")

    def _approve_result(self, repo, pr, user, form):
        one = lambda k: (form.get(k) or [""])[0]  # noqa: E731
        rev = load_review(repo, pr, user) or {}
        blockers = sev_counts(rev.get("comments", [])).get("blocker", 0)
        lgtm = blockers == 0 and rev.get("event") != "REQUEST_CHANGES"
        if not lgtm and not one("ack"):
            return ("<div class='banner warn'><span>⚠️</span><div>This review is not LGTM — tick "
                    "the confirmation to approve anyway.</div></div>")
        msg = one("approve_body").strip() or "LGTM."
        tok = user_pat(user)
        if not tok:
            return ("<div class='banner err'><span>🚫</span><div>Your stored GitHub token could "
                    "not be read — paste it again in <a href='/integrations'>settings</a>."
                    "</div></div>")
        ok, why = can_approve(repo, pr, user)
        if not ok:
            return f"<div class='banner err'><span>🚫</span><div>{html.escape(why)}</div></div>"
        if DRY_RUN:
            return (
                f"<div class='banner warn'><span>🧪</span><div><b>DRY RUN — not approved.</b>"
                f"<br>Would submit an APPROVE review as <code>{html.escape(user)}</code> with "
                f"body: <em>{html.escape(msg[:200])}</em></div></div>")
        r = gh(["api", "--method", "POST", f"repos/{repo}/pulls/{pr}/reviews",
                "-f", "event=APPROVE", "-f", f"body={msg}"], token=tok)
        if r.returncode != 0:
            return (f"<div class='banner err'><span>🔴</span><div>GitHub rejected it: <code>"
                    f"{html.escape(r.stderr[:400])}</code></div></div>")
        ud = udir(repo, pr, user)
        ud.mkdir(parents=True, exist_ok=True)
        (ud / "approved").write_text(json.dumps({"at": int(time.time()), "body": msg}))
        return (f"<div class='banner ok'><span>✅</span><div>Approved {repo}#{pr} as "
                f"<code>{html.escape(user)}</code>.</div></div>")


if __name__ == "__main__":
    port = int(os.environ.get("RS_PORT", "8899"))
    if USERS.exists():
        os.chmod(USERS, 0o600)
    if not REPOS:
        print("FATAL: no repository configured in .env — set REPOS=owner/name[,owner/name…] "
              "(or the single-entry alias REPO=owner/name)", flush=True)
        raise SystemExit(1)
    bad = [r for r in REPOS if not P.valid_repo(r)]
    if bad:
        print(f"FATAL: not owner/name shaped in REPOS/REPO: {', '.join(bad)}", flush=True)
        raise SystemExit(1)
    if ALLOW_ORG and not re.match(r"^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$", ALLOW_ORG):
        print(f"FATAL: REPO_ALLOW_ORG={ALLOW_ORG!r} is not a GitHub org/user name", flush=True)
        raise SystemExit(1)
    # Legacy single-repo layout ($ROOT/repo, $ROOT/state/<pr>) → per-repo layout, once. Exits
    # with an operator-facing message when the state cannot be attributed to one repo.
    P.migrate_legacy(REPOS, log=lambda m: print(m, flush=True))
    if not SIG_V2_SINCE.exists():                  # starts the legacy-signature grace window
        SIG_V2_SINCE.write_text(str(int(time.time())))
    if not PUBLIC_URL:
        print("WARN: PUBLIC_URL is not set in .env — OAuth sign-in and Slack links will not "
              "work until it is", flush=True)
    # Loopback by default (a reverse proxy sits in front). RS_BIND=0.0.0.0 for a container,
    # where the published port is the only way in.
    bind = os.environ.get("RS_BIND", "127.0.0.1")
    print(f"reviewstage listening on {bind}:{port} (repos={','.join(REPOS)}"
          f"{' +org:' + ALLOW_ORG if ALLOW_ORG else ''}, dry_run={DRY_RUN}, "
          f"users={len(load_users())})", flush=True)
    ThreadingHTTPServer((bind, port), Handler).serve_forever()
