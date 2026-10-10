#!/usr/bin/env python3
"""rs_doctor.py — the Python half of the doctor: the checks that need to read users.json,
desktop.json or the process environment with more care than a shell one-liner.

    python3 rs_doctor.py [--root DIR] [--json] [--live] [--strict]

Prints one PASS / WARN / FAIL line per check (or, with --json, {"checks": [...], "fails": n,
"warns": n}) and exits 0 when nothing failed, 1 on any FAIL, 2 when --strict and something
WARNed. doctor.sh runs it and merges the lines into its own report; `npx reviewstage --doctor`
reaches it through doctor.sh.

What it checks: who has connected Claude and whether those tokens are still good; who has
signed in to GitHub, with which client, and when that expires; the mode of ROOT and of the
files that hold secrets; whether the running app answers on the port the desktop recorded in
desktop.json; the runtime the desktop launcher reported (node, Electron, OS, the Chromium
sandbox helper); and, when phone access is on, that the chosen tunnel binary is present.

Two rules, both from openspec/config.yaml properties 2 and 4: the default run never decrypts a
token — it reads booleans and expiries off users.json and prints nothing else — and the --live
probes that do decrypt one pass it to `gh` / `claude` through the subprocess environment only,
never argv, never a file, never stdout. It is a diagnostic, so it never starts a review.
"""
import argparse
import json
import os
import platform as _platform
import re
import shutil
import socket
import stat
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import rs_users

# The addresses the two sign-in flows send a browser to. GitHub's device flow is the page the
# user types a code into; the Claude one is the authorize host server.py's PKCE connect uses
# (CLAUDE_OAUTH_AUTHORIZE). Only the hosts are probed, with a HEAD, without any token.
DEVICE_FLOW_URL = "https://github.com/login/device"
CLAUDE_AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize"
DEFAULT_PORT = 8899
NODE_FLOOR = 20
EXPIRY_SOON = 24 * 3600
SECRET_FILES = (".env", "users.json", "settings.json", "desktop.json", "push_vapid.json")


class Report:
    """The ordered list of checks. `note` rows are context lines and count as nothing."""

    def __init__(self):
        self.checks = []

    def add(self, id_, status, text, note=None, **extra):
        row = {"id": id_, "status": status, "text": text}
        if note:
            row["note"] = note
        row.update({k: v for k, v in extra.items() if v is not None})
        self.checks.append(row)
        return row

    def ok(self, id_, text, **kw):
        return self.add(id_, "PASS", text, **kw)

    def warn(self, id_, text, **kw):
        return self.add(id_, "WARN", text, **kw)

    def fail(self, id_, text, **kw):
        return self.add(id_, "FAIL", text, **kw)

    def note(self, id_, text, **kw):
        return self.add(id_, "NOTE", text, **kw)

    @property
    def fails(self):
        return sum(1 for c in self.checks if c["status"] == "FAIL")

    @property
    def warns(self):
        return sum(1 for c in self.checks if c["status"] == "WARN")

    def to_json(self):
        return {"checks": self.checks, "fails": self.fails, "warns": self.warns}

    def exit_code(self, strict=False):
        if self.fails:
            return 1
        if strict and self.warns:
            return 2
        return 0


# --- inputs -----------------------------------------------------------------------------------

def read_env_file(root):
    """ROOT/.env as a dict. KEY=value lines, quotes not interpreted (the server reads it the
    same way); comments and blank lines skipped."""
    out = {}
    try:
        text = (Path(root) / ".env").read_text()
    except OSError:
        return out
    for line in text.splitlines():
        m = re.match(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
        if m and not line.lstrip().startswith("#"):
            out[m.group(1)] = m.group(2)
    return out


def read_desktop_state(root):
    try:
        d = json.loads((Path(root) / "desktop.json").read_text())
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def is_personal(env, root):
    """Personal mode: one person, no service token, the server polls with each user's own
    GitHub token. Decided by RS_PERSONAL (process env or .env), or by the desktop app having
    been here (desktop.json), so running the doctor outside the launcher cannot mistake a
    desktop install for a team one and demand a GITHUB_PAT it is not meant to have."""
    if env.get("RS_PERSONAL") == "1" or env.get("RS_DOCTOR_DESKTOP") == "1":
        return True
    return (Path(root) / "desktop.json").exists()


def chosen_port(env, desktop):
    """Where the running app listens: the port the desktop launcher recorded (it picks a free
    one every launch), else RS_PORT, else a loopback PUBLIC_URL's port, else the Docker
    default. Returns (port, source)."""
    p = desktop.get("port")
    if isinstance(p, int) and 0 < p < 65536:
        return p, "desktop.json"
    if str(env.get("RS_PORT", "")).isdigit():
        return int(env["RS_PORT"]), "RS_PORT"
    m = re.match(r"^http://(?:127\.0\.0\.1|localhost):(\d+)/?$", env.get("PUBLIC_URL", ""))
    if m:
        return int(m.group(1)), "PUBLIC_URL"
    return DEFAULT_PORT, "default"


def _when(ts, now):
    secs = int(ts) - int(now)
    if secs <= 0:
        return f"{_span(-secs)} ago"
    return f"in {_span(secs)}"


def _span(secs):
    if secs < 3600:
        return f"{max(secs // 60, 1)} min"
    if secs < 2 * 86400:
        return f"{secs // 3600} h"
    return f"{secs // 86400} d"


# --- probes (all injectable, so the tests run without a network, a node or an app) -----------

def probe_hosts():
    """Loopback, plus the Compose service name when this runs in a throwaway container beside
    the real one (`docker compose run --rm app doctor`)."""
    return ["127.0.0.1", "app"] if os.path.exists("/.dockerenv") else ["127.0.0.1"]


def probe_health(port, timeout=3.0, hosts=None):
    """'ok' when ReviewStage answers /health; 'other' when something else listens on the
    port; 'closed' when nothing does on any host."""
    state = "closed"
    for host in hosts or probe_hosts():
        try:
            with urlopen(f"http://{host}:{port}/health", timeout=timeout) as r:
                if r.read(16).decode("utf-8", "replace").strip() == "ok":
                    return "ok"
                state = "other"
                continue
        except HTTPError:
            state = "other"
            continue
        except (URLError, OSError, ValueError):
            pass
        try:
            with socket.create_connection((host, port), timeout=1.0):
                state = "other"
        except OSError:
            pass
    return state


def probe_head(url, timeout=8.0):
    """(reachable, detail) for a HEAD on `url`. A 2xx/3xx/4xx means the host answered — the
    device page 404s a HEAD and still proves the proxy lets us through; a 5xx or no answer
    does not."""
    try:
        with urlopen(Request(url, method="HEAD"), timeout=timeout) as r:
            return r.status < 500, f"HTTP {r.status}"
    except HTTPError as e:
        return e.code < 500, f"HTTP {e.code}"
    except (URLError, OSError, ValueError) as e:
        return False, str(getattr(e, "reason", e))[:120]


def probe_gh_user(token, timeout=20):
    """Whether `token` is accepted by GitHub. The token travels in the child's environment only."""
    try:
        r = subprocess.run(["gh", "api", "user", "-q", ".login"], capture_output=True, text=True,
                           timeout=timeout, stdin=subprocess.DEVNULL,
                           env={**os.environ, "GH_TOKEN": token, "GITHUB_TOKEN": token})
    except FileNotFoundError:
        return False, "gh is not on PATH"
    except subprocess.TimeoutExpired:
        return False, "gh did not answer within 20 s"
    if r.returncode != 0:
        tail = ((r.stderr or r.stdout or "").strip().splitlines() or ["rejected"])[-1]
        return False, tail[:160]
    return True, (r.stdout or "").strip()[:60]


def probe_claude(token, timeout=75):
    """verify_claude_token's probe: one tiny haiku call. Not a review — a fixed prompt."""
    try:
        r = subprocess.run(["claude", "-p", "Reply with exactly: OK", "--max-turns", "1",
                            "--model", "haiku"], capture_output=True, text=True, timeout=timeout,
                           stdin=subprocess.DEVNULL,
                           env={**os.environ, "CLAUDE_CODE_OAUTH_TOKEN": token})
    except FileNotFoundError:
        return False, "claude is not on PATH"
    except subprocess.TimeoutExpired:
        return False, f"claude did not answer within {timeout} s"
    if r.returncode != 0:
        tail = ((r.stderr or r.stdout or "").strip().splitlines() or ["rejected"])[-1]
        return False, tail[:160]
    return True, ""


def node_version(env, which=shutil.which, run=subprocess.run):
    """The node the launcher ran on (RS_DOCTOR_NODE), else the first `node` on PATH, else None."""
    v = env.get("RS_DOCTOR_NODE", "").lstrip("v")
    if v:
        return v
    if not which("node"):
        return None
    try:
        r = run(["node", "--version"], capture_output=True, text=True, timeout=10)
        return (r.stdout or "").strip().lstrip("v") or None
    except (OSError, subprocess.SubprocessError):
        return None


def _major(version):
    m = re.match(r"^(\d+)", version or "")
    return int(m.group(1)) if m else 0


# --- checks -----------------------------------------------------------------------------------

def check_claude_auth(rep, users, now, env, live=False, probe=probe_claude):
    connected = {k: u for k, u in users.items() if u.get("claude_token_enc")}
    if not connected:
        rep.warn("claude.auth", "nobody has connected a Claude account — reviews cannot start "
                 "until someone does (Settings -> Connect Claude)")
        return
    rep.ok("claude.auth", f"{len(connected)} user(s) have connected a Claude account")
    for login, u in connected.items():
        exp = int(u.get("claude_exp") or 0)
        has_refresh = bool(u.get("claude_refresh_enc"))
        if exp and exp <= now and not has_refresh:
            rep.fail("claude.auth", f"{login}: Claude token expired {_when(exp, now)} and has no "
                     "refresh token — reconnect Claude in Settings", user=login)
        elif exp and exp <= now:
            rep.warn("claude.auth", f"{login}: Claude token expired {_when(exp, now)} — it "
                     "refreshes on the next review", user=login)
        elif exp and exp - now < EXPIRY_SOON and not has_refresh:
            rep.warn("claude.auth", f"{login}: Claude token expires {_when(exp, now)} and has no "
                     "refresh token", user=login)
        else:
            when = _when(exp, now) if exp else "never"
            rep.ok("claude.auth", f"{login}: Claude token expires {when}"
                   + (", refresh token present" if has_refresh else ""), user=login)
        if live:
            secret = env.get("RS_SECRET", "")
            if not secret:
                rep.warn("claude.auth", f"{login}: --live needs RS_SECRET to decrypt the token",
                         user=login)
                continue
            try:
                tok = rs_users.dec(u["claude_token_enc"], secret)
            except RuntimeError as e:
                rep.fail("claude.auth", f"{login}: stored Claude token cannot be decrypted with "
                         f"this RS_SECRET ({str(e)[:80]})", user=login)
                continue
            ok, msg = probe(tok)
            if ok:
                rep.ok("claude.auth", f"{login}: claude -p answered with the stored token (live)",
                       user=login)
            else:
                rep.fail("claude.auth", f"{login}: claude -p rejected the stored token (live): {msg}",
                         user=login)


def check_github_auth(rep, users, now, env, personal, live=False, probe=probe_gh_user):
    signed = {k: u for k, u in users.items() if u.get("gh_token_enc") or u.get("pat_enc")}
    if env.get("GITHUB_PAT") and not personal:
        rep.note("github.auth", "service token (GITHUB_PAT) set — doctor.sh checks what it can see")
    if not signed:
        if personal:
            rep.warn("github.auth", "nobody has signed in to GitHub yet — the app's first screen "
                     "does that (device flow); no GITHUB_PAT is needed in personal mode")
        else:
            rep.note("github.auth", "no users have signed in to GitHub yet")
        return
    rep.ok("github.auth", f"{len(signed)} user(s) signed in to GitHub")
    for login, u in signed.items():
        client = u.get("gh_client") or ("pat" if u.get("pat_enc") and not u.get("gh_token_enc")
                                        else "unknown")
        exp = int(u.get("gh_exp") or 0)
        rexp = int(u.get("gh_refresh_exp") or 0)
        refresh_ok = bool(u.get("gh_refresh_enc")) and (not rexp or rexp > now)
        if exp and exp <= now and not refresh_ok:
            rep.fail("github.auth", f"{login}: GitHub token expired {_when(exp, now)} and cannot "
                     "be refreshed — sign in again", user=login, gh_client=client)
        elif exp and exp <= now:
            rep.warn("github.auth", f"{login}: GitHub token expired {_when(exp, now)} — it "
                     "refreshes on the next request", user=login, gh_client=client)
        elif exp and exp - now < EXPIRY_SOON:
            rep.warn("github.auth", f"{login}: GitHub token expires {_when(exp, now)}"
                     + ("" if refresh_ok else " and cannot be refreshed — sign in again soon"),
                     user=login, gh_client=client)
        else:
            when = _when(exp, now) if exp else "never"
            rep.ok("github.auth", f"{login}: GitHub token expires {when} (client: {client})",
                   user=login, gh_client=client)
        if u.get("gh_refresh_enc") and rexp and rexp <= now:
            rep.warn("github.auth", f"{login}: GitHub refresh token expired {_when(rexp, now)}",
                     user=login)
        if live:
            secret = env.get("RS_SECRET", "")
            if not secret:
                rep.warn("github.auth", f"{login}: --live needs RS_SECRET to decrypt the token",
                         user=login)
                continue
            try:
                tok = rs_users.dec(u.get("gh_token_enc") or u.get("pat_enc"), secret)
            except RuntimeError as e:
                rep.fail("github.auth", f"{login}: stored GitHub token cannot be decrypted with "
                         f"this RS_SECRET ({str(e)[:80]})", user=login)
                continue
            ok, msg = probe(tok)
            if ok:
                rep.ok("github.auth", f"{login}: gh api user accepted the stored token (live)",
                       user=login)
            else:
                rep.fail("github.auth", f"{login}: gh api user rejected the stored token (live): "
                         f"{msg}", user=login)


def check_perms(rep, root):
    root = Path(root)
    try:
        mode = stat.S_IMODE(root.stat().st_mode)
    except OSError:
        rep.fail("perms.root", f"ROOT missing or unreadable ({root})")
        return
    if mode & 0o077:
        rep.warn("perms.root", f"ROOT is mode {mode:o} — group/world can list it; "
                 f"chmod 700 {root}")
    else:
        rep.ok("perms.root", f"ROOT is mode {mode:o} ({root})")
    loose = []
    for name in SECRET_FILES:
        f = root / name
        try:
            m = stat.S_IMODE(f.stat().st_mode)
        except OSError:
            continue
        if m & 0o077:
            loose.append(f"{name} ({m:o})")
    if loose:
        rep.warn("perms.file", "readable by others, should be 600: " + ", ".join(loose))
    else:
        rep.ok("perms.file", "secret-bearing files under ROOT are mode 600")


def check_port(rep, env, desktop, personal, health=probe_health):
    port, source = chosen_port(env, desktop)
    state = health(port)
    if state == "ok":
        rep.ok("port.free", f"server /health -> ok on port {port} (port from {source})")
    elif state == "other":
        rep.fail("port.free", f"something answers on port {port} but it is not ReviewStage "
                 f"(port from {source})")
    elif personal:
        rep.warn("port.free", f"app not running — nothing listens on port {port} "
                 f"(port from {source}); start it with `npx reviewstage`")
    else:
        rep.fail("port.free", f"server not answering on port {port} (port from {source})")
    return state == "ok"


def check_callbacks(rep, env, desktop, live=False, app_up=False, head=probe_head):
    public = env.get("PUBLIC_URL", "")
    loopback = re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?/?$", public)
    # Only meaningful while the app runs: the launcher resets PUBLIC_URL to loopback on quit
    # and publishes the tunnel address again once it is up.
    if desktop.get("phone") and loopback and app_up:
        rep.warn("callback.public_url", "phone access is on but PUBLIC_URL is still loopback "
                 f"({public}) — the phone address is not published; toggle phone access")
    if not live:
        rep.note("callback.device", "sign-in reachability not probed — run with --live")
        return
    for id_, url, what in (("callback.device", DEVICE_FLOW_URL, "GitHub device flow"),
                           ("callback.claude", CLAUDE_AUTHORIZE_URL, "Claude authorize page")):
        ok, detail = head(url)
        if ok:
            rep.ok(id_, f"{what} reachable ({detail})")
        else:
            rep.fail(id_, f"{what} unreachable from here ({detail}) — proxy or firewall?")


def check_environment(rep, env, desktop, root, platform=None, which=shutil.which,
                      exists=os.path.exists, stat_fn=os.stat, node=None):
    platform = platform or sys.platform
    desktop_run = env.get("RS_DOCTOR_DESKTOP") == "1" or bool(env.get("RS_DOCTOR_ELECTRON"))
    v = node if node is not None else node_version(env, which=which)
    if v:
        if _major(v) >= NODE_FLOOR:
            rep.ok("env.node", f"node {v}")
        else:
            rep.fail("env.node", f"node {v} — the desktop app needs node >= {NODE_FLOOR}")
    elif desktop_run:
        rep.fail("env.node", "node not on PATH — `npx reviewstage` needs it")
    else:
        rep.note("env.node", "node not on PATH (not needed for a team/Docker install)")

    electron = env.get("RS_DOCTOR_ELECTRON", "")
    if electron:
        if exists(electron):
            rep.ok("env.electron", f"Electron binary present ({electron})")
        else:
            rep.fail("env.electron", "the Electron binary is missing — reinstall with "
                     "`npx reviewstage@latest`")
    elif desktop_run:
        rep.fail("env.electron", "the Electron package did not resolve — reinstall with "
                 "`npx reviewstage@latest`")

    os_name = {"darwin": "macOS", "linux": "Linux", "win32": "Windows"}.get(platform, platform)
    if platform in ("darwin", "linux"):
        rep.ok("env.os", f"{os_name} ({_platform.machine() or 'unknown arch'})")
    else:
        rep.warn("env.os", f"{os_name} is unsupported — best effort only")

    if platform == "linux" and electron:
        helper = os.path.join(os.path.dirname(electron), "chrome-sandbox")
        try:
            st = stat_fn(helper)
            if st.st_uid == 0 and st.st_mode & stat.S_ISUID:
                rep.ok("env.chromium_sandbox", "Chromium sandbox helper is root-owned setuid")
            else:
                rep.warn("env.chromium_sandbox", "Chromium sandbox helper is not root-owned "
                         "4755 — the app runs with --no-sandbox (documented Linux trade)")
        except OSError:
            rep.warn("env.chromium_sandbox", "Chromium sandbox helper missing — the app runs "
                     "with --no-sandbox (documented Linux trade)")

    if desktop.get("phone"):
        via = desktop.get("phoneVia") or "tunnel"
        tool = "tailscale" if via == "tailscale" else "cloudflared"
        local = os.path.join(str(root), "bin", tool)
        mac_app = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
        found = which(tool) or (local if exists(local) else None) \
            or (mac_app if tool == "tailscale" and exists(mac_app) else None)
        if found:
            rep.ok(f"tools.{tool}", f"phone access via {via}: {tool} present ({found})")
        else:
            rep.fail(f"tools.{tool}", f"phone access is on via {via} but {tool} is neither on PATH "
                     f"nor in {os.path.join(str(root), 'bin')} — the app fetches it on launch; "
                     "turn phone access off and on again")
    else:
        rep.note("tools.cloudflared", "phone access is off — no tunnel binary required")


def run(root, env=None, now=None, live=False, platform=None, users=None, **probes):
    """Every check, in report order. `probes` override the network/subprocess probes."""
    root = Path(root)
    env = dict(env if env is not None else os.environ)
    file_env = read_env_file(root)
    for k, v in file_env.items():
        env.setdefault(k, v)
    now = int(now if now is not None else time.time())
    desktop = read_desktop_state(root)
    personal = is_personal(env, root)
    if users is None:
        users = rs_users.load_users(root / "users.json")
    rep = Report()
    rep.note("mode", "personal mode (desktop install): no service token, each user's own GitHub "
             "token polls and posts" if personal else "team mode: GITHUB_PAT is the service token")
    check_environment(rep, env, desktop, root, platform=platform,
                      **{k: probes[k] for k in ("which", "exists", "stat_fn", "node") if k in probes})
    check_perms(rep, root)
    check_github_auth(rep, users, now, env, personal, live=live,
                      **({"probe": probes["gh_probe"]} if "gh_probe" in probes else {}))
    check_claude_auth(rep, users, now, env, live=live,
                      **({"probe": probes["claude_probe"]} if "claude_probe" in probes else {}))
    app_up = check_port(rep, env, desktop, personal,
                        **({"health": probes["health"]} if "health" in probes else {}))
    check_callbacks(rep, env, desktop, live=live, app_up=app_up,
                    **({"head": probes["head"]} if "head" in probes else {}))
    return rep


def render(rep, color=False):
    g, y, r, d, n = ("\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[0m") if color else ("",) * 5
    lines = []
    for c in rep.checks:
        if c["status"] == "NOTE":
            lines.append(f"      {d}{c['text']}{n}")
            continue
        col = {"PASS": g, "WARN": y, "FAIL": r}[c["status"]]
        lines.append(f"{col}{c['status']}{n}  {c['text']}")
        if c.get("note"):
            lines.append(f"      {d}{c['note']}{n}")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="ReviewStage doctor (python checks)")
    ap.add_argument("--root", default=os.environ.get("ROOT") or str(Path.home() / ".reviewstage"))
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--live", action="store_true",
                    help="also probe GitHub/Claude with the stored tokens and the sign-in hosts")
    ap.add_argument("--strict", action="store_true", help="exit 2 when anything WARNs")
    a = ap.parse_args(argv)
    rep = run(a.root, live=a.live)
    if a.json:
        print(json.dumps(rep.to_json(), indent=1))
    else:
        print(render(rep, color=sys.stdout.isatty()))
    return rep.exit_code(strict=a.strict)


if __name__ == "__main__":
    sys.exit(main())
