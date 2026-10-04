# `npx reviewstage` — build contract

## 1. Package

`desktop/` in the repo, published as **`reviewstage`** (free on npm, verified 10/04/26).

```
desktop/
  package.json        name reviewstage, bin { reviewstage: bin/reviewstage.js }, main main.js
  bin/reviewstage.js  node launcher: resolves electron, spawns it on main.js
  main.js             Electron main: root, tools, server, window, badge, notifications, tunnel
  preload.js          contextBridge: badge/tunnel IPC for the renderer-side button
  tools.json          { gh, jq, cloudflared }: version, per-platform url, sha256, path-in-archive
  tools.js            ensureTools(): system PATH first, else download+verify into ROOT/bin
  flock.py            the macOS shim (flock -n FD · flock -w N FD · flock -n FILE cmd…)
  server.js           spawnServer(): env, free port, /health wait, restart(publicUrl)
  tunnel.js           cloudflared quick tunnel: spawn, parse https URL, stop
  pages/              preparing.html (progress), phone.html (QR + link)
  scripts/prepack.mjs copies ../bin/*.py ../bin/*.sh ../bin/static ../skills → desktop/server/
  test/               electron smoke (Playwright _electron), tools.test, flock.test
```

`files`: `bin/ main.js preload.js tools.json tools.js flock.py server.js tunnel.js pages/ server/`.
`dependencies`: `electron` (exact), `qrcode`. Nothing else. `prepack` runs the copy; `server/`
is gitignored.

## 2. Launch sequence (main.js)

1. `ROOT = process.env.ROOT || ~/.reviewstage`. Create. If `ROOT/.env` is absent write:
   `RS_SECRET=<48 hex>`, `RS_PERSONAL=1`, `GH_DEVICE_FLOW=1`, `DRY_RUN=1`,
   `PUBLIC_URL=http://127.0.0.1:<port>` (rewritten on every launch to the port chosen), 0600.
2. `ensureTools()`: for `gh`, `jq`: `which` on the system PATH; else download per `tools.json`
   for `process.platform/arch`, verify SHA-256, extract the single binary to `ROOT/bin/`, 0755.
   `flock`: present on Linux; on darwin write `flock.py` to `ROOT/bin/flock` 0755. Progress is
   shown in `pages/preparing.html` in the window. Failure shows the error and a Retry.
3. `claude`: `which claude`; if absent the preparing page shows "Install Claude Code first"
   with `npm install -g @anthropic-ai/claude-code` and a Re-check button. Never downloaded.
4. `spawnServer()`: `python3 server/bin/server.py` with `ROOT`, `RS_PORT=<free loopback port>`,
   `RS_SPA=1`, `PATH=ROOT/bin:$PATH`, cwd `server/bin`. Wait for `GET /health` = `ok` up to
   30 s; on failure show the last 40 log lines in the window.
5. `BrowserWindow` 1280×860 min 390×600, `titleBarStyle: hiddenInset` on darwin, loads
   `http://127.0.0.1:<port>/`. External links open in the default browser.
6. Badge: every 60 s `GET /api/queue?tab=todo` with the window's cookies → count → macOS
   `app.dock.setBadge(count || "")`, Linux/Windows `win.setOverlayIcon`/title suffix. When the
   count rises, a `Notification` "Review requested" whose click focuses the window and loads
   the PR. Stops when no user is signed in.
7. Quit: SIGTERM the server and the tunnel; wait 3 s; SIGKILL.

## 3. Server: personal mode (`RS_PERSONAL=1`) — lane D1

- Boot with zero `REPOS`: the FATAL becomes a WARN; `REPOS` is the union of `.env` and
  `settings.json["repos"]`. `all_repos()`, `repo_ok()`, the poller and the queue read the
  union. `rs_settings` gains `repos: [owner/name]` with the same validation as `.env`.
- New routes (session required): `GET /api/github/repos?q=` — the signed-in user's
  repositories via their own token (`gh api --paginate user/repos?affiliation=owner,collaborator,organization_member&sort=pushed`),
  shape `{repos: [{full_name, private, pushed_at, owner_avatar}]}` capped at 200, cached 5 min
  per user; `POST /api/repos` body `{repos: [...]}` replaces `settings.repos` after validation
  and returns the new union; `GET /api/me` gains `personal: bool` and `repos: [...]`.
- Poller in personal mode: `pr-watch.sh` currently needs `GITHUB_PAT`. Add `RS_POLL_TOKEN_FROM=user`
  handling in the server: when personal and a user is signed in, the server itself runs the
  poll loop (threading, same interval setting) using `oauth_fresh_token()` of the first admin
  user, calling the existing queue-update code path. No token is written to disk or env.
- `PUBLIC_URL` becomes runtime-overridable: `POST /api/public-url` (admin, loopback-only
  caller) sets it for notifications and links until restart, so the tunnel does not require a
  server restart.

## 4. First-run wizard — lane D1 (SPA)

Route `/welcome`, shown when `me.personal && me.repos.length === 0` (and after sign-in when
Claude is not connected). Three steps on `Card`/`Button`/`StatusBadge`, a progress stepper:
1. **Continue with GitHub** — the existing Login device flow embedded.
2. **Connect Claude** — the existing Integrations connect embedded; skippable with "later".
3. **Pick repositories** — `Input` search over `GET /api/github/repos`, rows with `RepoPill`,
   `Checkbox`, private glyph, "pushed 3d ago"; `POST /api/repos`; then `→ Queue`.
Each step is its own route so the device-flow redirect lands back on it. Tests in
`e2e/welcome.spec.ts` against the fixture with `RS_PERSONAL=1`.

## 5. Phone access — lane D2

- `tools.json` gains `cloudflared`. "Enable phone access" lives in the app's account menu
  (desktop only; the renderer calls `window.reviewstage.phone.enable()` via preload).
- `tunnel.js`: spawn `cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate`, parse
  the `https://[a-z-]+\.trycloudflare\.com` line from stderr within 30 s, `POST /api/public-url`,
  open `pages/phone.html` as a 420×560 child window: QR (`qrcode` to a data URL), the URL as
  text with Copy, "Open it on your phone, sign in, then Share → Add to Home Screen", and a
  Disable button. Disabling kills the tunnel and resets `PUBLIC_URL` to loopback.
- The tunnel is public. The page says so in one sentence and links the security doc. Sessions
  and signed links already assume a public URL.

## 6. Publish and docs — lane D3

- `.github/workflows/release-npm.yml`: on `v*` tag → `npm ci` in `desktop/`, `npm pack`,
  Electron smoke on `ubuntu-latest` under `xvfb-run`, `npm publish --provenance --access public`
  with `NPM_TOKEN`. Version comes from the tag.
- `desktop/README.md`, root `README.md` leads with `npx reviewstage` then Docker, website
  Install section the same, `docs/INSTALL-DESKTOP.md`, the Windows follow-up documented.
- `bin/doctor.sh` knows `RS_PERSONAL` (no FATAL on missing REPOS; reports `ROOT/bin` tools).

## 7. Proof (every lane runs what applies)

- `desktop`: `npm test` = tools.test (checksum verify, download mocked), flock.test (the three
  shapes, real `fcntl`), electron smoke (`_electron.launch` with `ROOT` = temp dir seeded with
  the e2e fixture env, `RS_PERSONAL=1`; asserts window title, `/health`, badge call).
- `python3 -m unittest discover -s bin` — personal-mode tests: boot with zero repos, union of
  env+settings, `/api/github/repos` shape with a fake `gh`, `/api/repos` validation, the
  in-process poller using the user token and writing no token to disk.
- `pnpm test:browser` — `welcome.spec.ts`.
- `npm pack` size < 10 MB; `tar tzf` contains no `node_modules/`, `e2e/`, `test_*.py`.
- Manual, by the maintainer, on this Mac: `npx ./desktop/reviewstage-*.tgz` from a clean ROOT.
