# `npx reviewstage` — a desktop app that carries its own server

## Why

The install story is the adoption story, and today's is seven steps: install Docker Desktop,
install Git, clone, copy an env file, start Compose, open a browser, paste a token. Then for a
phone: set up Tailscale. People trying a tool do one step, or none.

Nerve (`npx @nervekit/desktop@latest`) shows the shape that works for this audience: an
Electron app distributed through npm. Nothing arrives as a downloaded app bundle, so macOS
never shows the Gatekeeper warning and no Apple account is needed. And **everyone who can use
ReviewStage already has Node and npm, because Claude Code is itself an npm package.** For our
exact audience `npx` adds zero new dependencies; Docker adds one large one.

## What the user does

```
npx reviewstage
```

A window opens. Three steps: **Continue with GitHub** (the device flow that exists), **Connect
Claude** (the PKCE connect that exists), **Pick repositories** (new). Then the queue. The dock
icon carries the number of reviews waiting; a native notification arrives when one does.

For the phone: **Enable phone access** in the app shows a QR code. Scan it, Add to Home Screen,
and notifications work there too. No account, no configuration: the button runs a bundled
Cloudflare quick tunnel, which gives a real HTTPS address and dies when the app quits.

## What the app does underneath

The npm package carries the server: `bin/*.py`, `bin/*.sh`, `bin/static/`, `skills/`. On
launch the Electron main process:

1. Creates `~/.reviewstage` and a `.env` with a generated `RS_SECRET`, `RS_PERSONAL=1`,
   `GH_DEVICE_FLOW=1`, `DRY_RUN=1` and a loopback `PUBLIC_URL`, if none exists.
2. Checks for `gh`, `jq` and `flock`. Whatever the system lacks is downloaded once from the
   tools' own GitHub releases, pinned by version and SHA-256, into `~/.reviewstage/bin`, which
   is prepended to the server's PATH. `flock` on macOS is a small Python shim with the three
   call shapes the scripts use. Claude Code is the one thing never downloaded: if `claude` is
   missing the app says so and links the install line, because reviews run on your account.
3. Starts `python3 bin/server.py` on a free loopback port and waits for `/health`.
4. Opens the window on it. Polls the queue for the badge; notifies on new requests.
5. In personal mode the server runs the poller itself, with the signed-in user's token, so
   review requests arrive without a service token.

Docker Compose stays as the team install. This is the personal one, and the README leads
with it.

## Design properties touched

None. The review step still has no GitHub write path, every post uses the acting user's token,
reviews are click-to-run on the user's Claude account, and reviewers are independent. The
launcher is a different way to start the same server.

## Platforms

macOS first and fully proven. Linux works with the same code (the system has `flock`; `gh`
and `jq` download). Windows needs a bundled Python and a Bash, and is a follow-up documented
as such rather than half-shipped.

## How this is proven

- From a clean `ROOT`, `npx reviewstage` on this Mac reaches the queue with real repositories
  after the maintainer completes the GitHub and Claude steps; the dock badge shows a count; a
  review request produces a native notification.
- A Playwright Electron test launches the packed app against the offline fixture: window
  opens, `/health` answers, the title is ReviewStage, the badge API is called.
- Tool provisioning is tested with an empty PATH: `gh`, `jq` and the `flock` shim land in
  `~/.reviewstage/bin` with verified checksums, and the server boots using them.
- Phone access: the QR encodes an `https://*.trycloudflare.com` URL that answers `/health`,
  and the maintainer installs the app on a phone from it.
- `npm pack` produces a package under 10 MB with no `node_modules`, no fixtures, no tests;
  `npm publish --dry-run` passes.
