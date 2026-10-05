# desktop-always-on — design (binding for lane F)

Maintainer, 10/05/26, after the first real phone session: quitting the terminal that ran
`npx reviewstage` killed the app, and the phone's home-screen app then showed a raw error code.
Asks: the app should keep running after the terminal closes, tell you about updates and apply
them, never leave the phone on an error page, and keep the phone's address as long as it can.

## F1. Detach from the terminal

- `desktop/bin/reviewstage.js` spawns Electron **detached** (`detached: true`, stdio to
  `ROOT/desktop.log`, `child.unref()`), prints one line — `ReviewStage is running. You can
  close this terminal.` — and exits 0. Closing the terminal no longer touches the app.
- Stays in the foreground (stdio inherited, waits for exit) when `RS_SMOKE=1`, `--foreground`,
  or `--doctor` — the smoke test and CI need stdout.
- `main.js`: `app.requestSingleInstanceLock()`. A second `npx reviewstage` while one is running
  focuses the existing window and exits. With `--wait-for-lock` (used by updates, F4) the new
  process retries the lock for up to 20 s before giving up.

## F2. A real resident app

- Closing the window keeps the app running (macOS default today; make Linux the same while a
  tray icon exists). **Menu-bar / tray icon** (template image from the app mark, 16/32 px) with:
  Open ReviewStage · Phone access: On/Off · Check for updates · Quit ReviewStage. The Dock
  icon stays while a window is open; with the window closed the app lives in the menu bar
  (`app.dock.hide()` when no window, `show()` when one opens).
- **Open at login** (Settings → Desktop app section, default off): macOS writes
  `~/Library/LaunchAgents/dev.reviewstage.desktop.plist` whose ProgramArguments are the absolute
  `node` that ran the launcher and its sibling `npx` with `-y reviewstage@latest`, plus PATH
  captured at enable time (launchd's PATH lacks nvm/Homebrew); Linux writes
  `~/.config/autostart/reviewstage.desktop`. Toggle off removes the file.

## F3. Phone access survives

- Phone access on/off is remembered in `ROOT/desktop.json`; on the next launch it comes back
  on by itself. The quick-tunnel address changes when the app restarts (Cloudflare gives each
  run a new name), so on a restart with a new address the server sends a push to every
  subscribed device: "Your Mac has a new address — tap to sign in", whose URL is a fresh
  `/pair/<nonce>` on the new address (mint server-side for each subscribed login; the device
  opens it in the browser and the home-screen app can be re-added from there).
- While the app runs, the address never changes (sleep and network drops reconnect, F-existing).

## F4. Updates

- Main checks `https://registry.npmjs.org/reviewstage` (dist-tag `latest`) at launch and every
  6 h; prerelease-aware semver comparison against the running package version.
- When newer: the dashboard (desktop app only, via the preload bridge
  `window.reviewstage.update.{status, install, onAvailable}`) shows a slim banner at the top
  of the shell — `ReviewStage <v> is available · Restart to update` — dismissible for this
  version. The tray menu gains "Update to <v>". Settings → Desktop app shows the running
  version, "Check now", and the last check time.
- Install: spawn detached `npx -y reviewstage@<v> --wait-for-lock` with the launcher's env,
  then `app.quit()` (tunnel stopped, server stopped). The new instance comes up on the same
  ROOT, phone access restored by F3. If the spawn fails, the banner says so and nothing quits.

## F5. The phone never shows a raw error

- `dashboard-ui/public/sw.js`: for **navigations**, a response with status 502, 503, 504 or
  530 (Cloudflare's dead-tunnel answer, error 1033) is treated like a network failure → the
  cached shell if present, else `offline.html`. API requests are untouched by the worker.
- `offline.html` rewritten: the app mark, "Your Mac isn't reachable", one sentence ("The phone
  reaches ReviewStage on your Mac. Open it there — or wake the Mac — and try again."), a
  **Try again** button, and a smaller line for when the address changed ("If ReviewStage was
  restarted, open the newest link from your notifications or scan a new code").
- SPA: when `/api/me` or the queue fetch fails with 502/503/504/530 or a network error, show a
  full-screen "Your Mac isn't reachable" state with Try again (auto-retry every 15 s while
  visible) instead of an error banner. Same words as offline.html.

## F6. A stable address (optional path, documented)

- If the `tailscale` CLI is on PATH and logged in, Settings → Your phone offers **Use
  Tailscale** (stable, private to your own devices): `tailscale serve --bg --https=443
  http://127.0.0.1:<port>` and the address `https://<machine>.<tailnet>.ts.net` is used for the
  QR and PUBLIC_URL instead of the quick tunnel. It never changes. Off → `tailscale serve
  --https=443 off`. Without Tailscale the option is a one-line explanation with a link.
- A permanent public address without an account is not possible with Cloudflare quick tunnels;
  say so in the FAQ ("Why does the phone address change when I restart?").

## Gates

desktop `node --test test/*.test.mjs` (smoke stays green with RS_SMOKE foreground; new unit
tests: version comparison, LaunchAgent plist contents, the detach decision, single-instance
retry); dashboard-ui typecheck/test/build + full browser suite twice (new: update banner via a
fake bridge, unreachable state via routed 530s, sw navigation fallback on 530 in `pwa.spec.ts`);
python suite (the new-address push); docs: INSTALL-DESKTOP, desktop/README, install.mdx, FAQ.
Screenshots into `openspec/changes/desktop-always-on/after/`: update banner, Settings → Desktop
app, phone offline page at 390, unreachable state at 390. Prove F1 for real on this Mac: run
the launcher, kill its parent shell, confirm the Electron process and `/health` survive.
