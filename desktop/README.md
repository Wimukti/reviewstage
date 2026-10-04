# ReviewStage

**Stage your PR review. Post it as yourself.**

```bash
npx reviewstage
```

A window opens and walks you through three steps — sign in with GitHub, connect your Claude
account, pick the repositories you review — then shows your queue. Add or remove repositories
any time from **Repositories** in the sidebar; **Switch GitHub account** is in the account ⋯
menu. When someone requests your
review, the dock badge ticks up; click the PR, run a review on your own Claude plan, tick the
findings worth posting, and post them under your own GitHub name. Nothing posts until you click.

![The three first-run steps: a GitHub token is pasted and verified, Claude is connected with a pasted code, two repositories are ticked and Start reviewing lands on the queue.](https://raw.githubusercontent.com/Wimukti/reviewstage/main/docs/demos/wizard.gif)

This package is the desktop app. It carries the ReviewStage server with it, runs it on a free
local port, and fetches the two command-line tools the server needs (`gh`, `jq`) once, pinned by
version and SHA-256, into `~/.reviewstage/bin`. Everything stays on your machine.

## You need

- **Node 20 or newer** (you have it if you installed Claude Code with npm).
- **Claude Code** on your PATH — `npm install -g @anthropic-ai/claude-code`. Reviews run on
  *your* Claude account; the app never fetches Claude Code for you.
- **Git, Python 3, Bash, OpenSSL and curl** — present on every macOS (after
  `xcode-select --install`) and on any Linux desktop.
- macOS 12+ (Apple Silicon or Intel) or Linux x64/arm64. Windows is on the roadmap.

No Apple notarisation dialog: the app is Electron installed by npm, the same way
`npx @nervekit/desktop` and other npm-distributed desktop apps work.

## Your phone

**Settings → Your phone → Enable phone access** starts a Cloudflare quick tunnel to your laptop
and shows a QR code on the card (the **ReviewStage** menu and the Dock menu have the same, in a
window of its own). Scan it with the camera and the phone is signed in as you — no second GitHub
login (the code is single-use and valid for 30 minutes; **New code** mints a new one). **Add to
Home Screen**, open it from there, and turn on push from Settings: a review
request on a watched repository notifies the phone, and the queue, the findings and the Post
button are the same app at phone width.

The tunnel lasts as long as the app runs: it reconnects by itself after a dropped connection or
sleep and keeps its address. Quitting the app ends it; the next enable gets a new address, so
scan again. The address is public while the tunnel is up (anyone with it reaches your sign-in
page, nothing more); **Turn off** on the card, **Disable phone access** in the menu, or quitting
the app ends it.

## Where things live

Everything is under `~/.reviewstage`: `.env` (the app writes it: a random `RS_SECRET`,
`RS_PERSONAL=1`), `settings.json` (your repositories), `bin/` (the fetched tools),
`state/` (every run, staged findings, posted-review records), `repos/` (one blobless clone per
repository). Delete the directory to start over. Posting is live from the first run: the Post
button is the gate, and nothing reaches GitHub until you press it. To rehearse without posting,
add `DRY_RUN=1` to `.env` and relaunch.

## Problems

- *"Claude Code is not installed"* — install it with the command above and relaunch.
- *"This machine is missing …"* — on macOS run `xcode-select --install`; on Linux install the
  named packages.
- *A tool's checksum did not match* — the download is discarded and the app stops. Try again
  later; if it persists, open an issue with the message.
- `npx reviewstage --doctor` prints one PASS / WARN / FAIL line per check without opening a
  window; the server's output from the last launch is in `~/.reviewstage/server.log`.

Full documentation, the security model and the team install (one server, every reviewer as
themselves) are at <https://wimukti.github.io/reviewstage/>. Source and issues:
<https://github.com/Wimukti/reviewstage>. MIT.
