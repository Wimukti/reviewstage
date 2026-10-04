---
title: FAQ
description: Short answers on the phone tunnel, old addresses, switching accounts, adding repositories, the dry run and Windows.
sidebar:
  order: 2
---

You get the answer to the questions the first week raises, in a paragraph each. For a problem that is not here, see [Troubleshooting](/reviewstage/operations/troubleshooting/).

## How long does the phone tunnel last?

As long as the desktop app runs. **Enable phone access…** starts a Cloudflare quick tunnel to your laptop; if your Wi-Fi drops or the laptop sleeps, `cloudflared` reconnects by itself and the address stays the same. Quitting the app ends the tunnel; the next **Enable phone access…** gets a new address, so scan the code again. (A quick tunnel cannot keep a name; a named tunnel needs a Cloudflare account and is on the roadmap.) If `cloudflared` itself crashes, the app restarts it once with a new address and shows a notification, "Phone address changed — rescan the code". A second crash within 5 minutes stops it; the menu shows phone access as disabled and the phone window says why.

## My phone shows an old address

The tunnel changed since the phone last opened the app — you quit and relaunched, or the tunnel was restarted. On the Mac, open **Show phone access code…** and scan the new code. Scanning signs the phone in as you; then **Add to Home Screen** again so the home-screen icon points at the new address, and turn **Settings → Push → This device** back on, since push is bound to the address.

## The login page says the phone code expired

A code is single-use and valid for 30 minutes from the moment the phone window shows it. On the Mac, open **Show phone access code…** for a new one and scan again. The phone does not need a second GitHub sign-in: scanning a valid code signs it in as the person signed in on the Mac.

## How do I switch GitHub account?

Open the account ⋯ menu at the foot of the sidebar and choose **Switch GitHub account**. It signs you out and opens the sign-in step (the welcome wizard on the desktop app, the login page on a team server). Everything you posted stays under the account that posted it.

## How do I add or remove repositories?

On the desktop app, **Repositories** in the sidebar (also the first card on Settings) lists the repositories you own, collaborate on or belong to through an organisation. Tick or untick and save; the queue filter and the badge follow at once. On a team install, repositories are `REPOS` in `.env` (restart after editing) or `REPO_ALLOW_ORG` for a whole org; see [Team mode → Many repositories](/reviewstage/guides/team-mode/#many-repositories).

## Is the dry run on?

**Desktop app:** no. Posting is live from the first run, and the Post button is the gate — nothing reaches GitHub until you press it. To rehearse without posting, add `DRY_RUN=1` to `~/.reviewstage/.env` and relaunch. **Team install (Docker or from source):** yes, `DRY_RUN=1` ships on. Every button works, the payload it would have sent is saved for you to inspect, and nothing is written to GitHub until you set `DRY_RUN=0` and restart. It is deliberately not a runtime setting.

## Does it run on Windows?

Not yet. The server's job scripts are bash; a WSL-hosted server with the Electron shell on Windows is the planned shape. Until then, use the Docker install under WSL2, or a Linux or macOS machine. Linux x64/arm64 and macOS 12+ (Apple Silicon and Intel) are supported.

## Where does the desktop app keep things?

Under `~/.reviewstage`: `.env` (written by the app), `settings.json` (your repositories, poller interval), `bin/` (the fetched `gh`, `jq`, `cloudflared` and a `flock` shim), `state/` (every run), `repos/` (one clone per repository), `users.json` (who signed in; tokens encrypted), `server.log`. Delete the directory to start over. `npx reviewstage --doctor` prints one PASS / WARN / FAIL line per check.
