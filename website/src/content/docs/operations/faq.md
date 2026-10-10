---
title: ReviewStage FAQ
description: Short answers on the phone tunnel, why its address changes, the app in the menu bar, updates, switching accounts, adding repositories, the dry run, telemetry and Windows.
sidebar:
  order: 2
---

You get the answer to the questions the first week raises, in a paragraph each. For a problem that is not here, see [Troubleshooting](/operations/troubleshooting/).

## How long does the phone tunnel last?

As long as the desktop app runs — and closing the terminal or the window no longer quits it; it lives in the menu bar until you choose **Quit ReviewStage**. **Settings → Your phone → Enable phone access** (or **Enable phone access…** in the app menu) starts a Cloudflare quick tunnel to your laptop; if your Wi-Fi drops or the laptop sleeps, `cloudflared` reconnects by itself and the address stays the same. Phone access is remembered: if it was on when the app quit, it comes back on at the next launch. If `cloudflared` itself crashes, the app restarts it once with a new address and shows a notification, "Phone address changed — rescan the code". A second crash within 5 minutes stops it; the card and the menu show phone access as off and say why.

## Why does the phone address change when I restart?

Because a Cloudflare quick tunnel gets a new random name every time it starts, and there is no way to keep one without a Cloudflare account (a named tunnel; on the roadmap). So a permanent public address with no account is not possible. What the app does instead: once the new address answers, every phone that turned on notifications gets **"Your Mac has a new address"** — tap it and the new address opens in the browser, already signed in (a single-use link for that phone's own account, valid 12 hours); add it to the Home Screen again from there. If you want an address that never changes, install [Tailscale](https://tailscale.com/download) on the Mac and the phone and turn on **Use Tailscale** in Settings → Your phone: the app is then served at `https://<machine>.<tailnet>.ts.net`, reachable only by your own devices.

## My phone says "Your Mac isn't reachable"

The Mac is asleep, offline, or ReviewStage is not running on it. Wake the Mac or open the app there and press **Try again** (the home-screen app also retries every 15 seconds by itself). If ReviewStage was restarted, the address changed: open the newest "Your Mac has a new address" notification, or scan a new code.

## My phone shows an old address

The tunnel changed since the phone last opened the app — you quit and relaunched, or the tunnel was restarted. Open the newest "Your Mac has a new address" notification if you have one. Otherwise, on the Mac, open **Settings → Your phone** (or **Show phone access code…** in the app menu) and scan the new code. Scanning signs the phone in as you; then **Add to Home Screen** again so the home-screen icon points at the new address, and turn **Settings → Push → This device** back on, since push is bound to the address.

## The login page says the phone code expired

A code is single-use and valid for 30 minutes from the moment it is shown. On the Mac, press **New code** in **Settings → Your phone** (or open **Show phone access code…** in the app menu) and scan again. The phone does not need a second GitHub sign-in: scanning a valid code signs it in as the person signed in on the Mac.

## How do I switch GitHub account?

Open the account ⋯ menu at the foot of the sidebar and choose **Switch GitHub account**. It signs you out and opens the sign-in step (the welcome wizard on the desktop app, the login page on a team server). Everything you posted stays under the account that posted it.

## How do I add or remove repositories?

On the desktop app, **Repositories** in the sidebar (also Settings → Repositories) lists the repositories you own, collaborate on or belong to through an organisation. Tick or untick and save; the queue filter and the badge follow at once. On a team install, repositories are `REPOS` in `.env` (restart after editing) or `REPO_ALLOW_ORG` for a whole org; see [Team mode → Many repositories](/guides/team-mode/#many-repositories).

## Is the dry run on?

**Desktop app:** no. Posting is live from the first run, and the Post button is the gate — nothing reaches GitHub until you press it. To rehearse without posting, add `DRY_RUN=1` to `~/.reviewstage/.env` and relaunch. **Team install (Docker or from source):** yes, `DRY_RUN=1` ships on. Every button works, the payload it would have sent is saved for you to inspect, and nothing is written to GitHub until you set `DRY_RUN=0` and restart. It is deliberately not a runtime setting.

## How do I update the desktop app?

The app checks for a new version at launch and every 6 hours. When one is out, a banner at the top of the window says `ReviewStage <version> is available · Restart to update`; the menu-bar icon and **Settings → Desktop app** offer the same. Restarting installs it with `npx` and opens on the same data, phone access included. **Check now** in Settings → Desktop app asks at once. By hand: `npx reviewstage@latest`.

## How do I quit it, or start it at login?

After the first `npx reviewstage`, open it like any app: the first run adds `~/Applications/ReviewStage.app` (macOS) or a launcher entry (Linux), so Spotlight and Launchpad find it. **Settings → Desktop app → Show in Applications** removes it.

Closing the window keeps ReviewStage in the menu bar. Quit from the menu-bar icon (**Quit ReviewStage**) or ⌘Q while its window is in front; the tunnel and the server stop with it. **Settings → Desktop app → Open at login** starts it in the menu bar when you log in (a LaunchAgent at `~/Library/LaunchAgents/dev.reviewstage.desktop.plist` on macOS, `~/.config/autostart/reviewstage.desktop` on Linux); turning it off removes the file.

## Does it phone home?

Not in 1.0.x. ReviewStage keeps a few counters about itself on your machine — reviews started, findings kept or dropped, posts attempted — from a fixed list with no names, repositories, paths or text in it; **Settings → Privacy** shows them, exports them and clears them. They can only be sent if `RS_TELEMETRY=0` is not set, the admin has not switched telemetry off, you said yes (the wizard asks once; the default is **Keep it local**), *and* an endpoint is configured — and no release configures one, so today nothing leaves the box whatever you answer. The only unprompted network call the desktop app makes is the update check against the npm registry every 6 hours. The full schema and the commitments for a future endpoint are in [Telemetry](/security/telemetry/).

## Does it run on Windows?

Not yet. The server's job scripts are bash; a WSL-hosted server with the Electron shell on Windows is the planned shape. Until then, use the Docker install under WSL2, or a Linux or macOS machine. Linux x64/arm64 and macOS 12+ (Apple Silicon and Intel) are supported.

## Where does the desktop app keep things?

Under `~/.reviewstage`: `.env` (written by the app), `settings.json` (your repositories, poller interval), `bin/` (the fetched `gh`, `jq`, `cloudflared` and a `flock` shim), `state/` (every run), `repos/` (one clone per repository), `users.json` (who signed in; tokens encrypted), `server.log` and `desktop.log` (the server's and the app's output), `desktop.json` (phone access on or off, and the port the last launch chose). Delete the directory to start over. `npx reviewstage --doctor` prints one PASS / WARN / FAIL line per check (`--json`, `--live` and `--strict` are described in [Troubleshooting](/operations/troubleshooting/#the-doctor)).
