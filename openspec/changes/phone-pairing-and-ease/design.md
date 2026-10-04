# phone-pairing-and-ease — design (binding for lanes A, B, C)

Asked by the maintainer on 10/04/26 after the first real `npx reviewstage` run:

1. The phone should sign in by scanning the QR code — not a second GitHub login.
2. What happens to the tunnel when the laptop's connection drops.
3. Changing repositories, adding repositories and switching accounts must be effortless.
4. Fit ReviewStage into a team's existing review process (documented, concrete).
5. Documentation simple and clear.
6. Demos (short recordings) where a reader needs to see it, not read it.

The five properties in `openspec/config.yaml` hold throughout. Pairing issues a *session* for the
person who is already signed in on the Mac; it never introduces a shared or service identity.

## Lane A — code (server, SPA, desktop)

### A1. QR pairing (`bin/server.py`, `desktop/main.js`, `desktop/pages/phone.html`)

- `POST /api/pair` — needs a session **and** a loopback peer (`127.0.0.1`/`::1`, same gate as
  `POST /api/public-url`); personal mode only (`403` otherwise). Mints a 32-byte urlsafe nonce
  into the in-memory `PAIR_PENDING[nonce] = {login, epoch, exp}` with **TTL 30 minutes**,
  single-use. Response `{ "url": "<PUBLIC_URL>/pair/<nonce>", "exp": <unix> }`. Minting again
  invalidates that user's earlier nonce (one live code per person).
- `GET /pair/<nonce>` — valid and unexpired → pop it, `Set-Cookie: rs_session=…` via
  `session_cookie(login, host)` (Secure when the request came over https — the tunnel does),
  `302 /`. Unknown or expired → `302 /login?paired=expired`; the login page shows one line:
  "That phone code has expired. On your Mac, open **Show phone access code…** for a new one."
  No body reveals whether a nonce ever existed.
- Audit line in the server log on success: `pair: <login> signed in from <ip> via QR`.
- Tests in `bin/test_rs_personal.py`: mint needs loopback + session + personal; nonce single-use;
  expired nonce → redirect with `paired=expired`; the cookie it sets is accepted by `/api/me`;
  a second mint invalidates the first; team mode → 403.
- Desktop: when the phone window opens (enable, or Show code…), mint via `POST /api/pair` with
  `sessionCookieHeader()`. The QR encodes the **pair URL**; the text field under it shows the
  **plain** tunnel address (what the home-screen app will live at). A line under the QR:
  "Scanning signs you in as <login>. Code valid until HH:MM — reopen this window for a new one."
  Not signed in on the Mac → QR encodes the plain URL and the line says "Sign in on the Mac
  first and the code will sign your phone in too."
- `pages/phone.html` steps become: 1 Scan with the camera → you're signed in. 2 Share → Add to
  Home Screen. 3 Open it from the home screen; Settings → Push → this device.

### A2. Tunnel lifetime (`desktop/tunnel.js`, `desktop/main.js`, docs via lane B)

- Fact to document (lane B): cloudflared reconnects by itself when the connection drops or the
  laptop wakes; the **address stays the same for as long as the app runs**. Quitting the app
  ends it; the next enable gets a new address and the phone must rescan (a quick tunnel cannot
  keep a name; a named tunnel needs a Cloudflare account — roadmap).
- Code: if the cloudflared child exits while phone access is enabled (crash, killed), restart it
  once automatically (new URL), `setPublicUrl`, mint a new pair code, update the phone window
  if open, and show a system `Notification` "Phone address changed — rescan the code". A second
  exit within 5 minutes → stop, menu shows disabled, phone window says why.
- Test (unit, no network): a fake child that exits triggers one restart and then gives up.

### A3. Repositories and accounts (SPA + a Sidebar entry)

- Extract the repository picker from `Welcome.tsx`'s `ReposStep` into `src/RepoPicker.tsx`
  (`{ me, onSaved }`), same behaviour, same tests.
- New route **`/repos`** (personal mode only; team mode → the Settings page) rendering
  `PageHeader "Repositories"` + `RepoPicker` inside the shell. Save → toast-less: the header's
  count updates and the Queue filter gains the repo; `onSaved` → `navigate("/")`.
- Sidebar (desktop) `SETUP` gains **Repositories** (`FolderGit2`) when `me.personal`; the phone
  More sheet gains it too. Queue's setup-needed state links to `/repos` (was `/welcome/repos`;
  keep `/welcome/repos` working for the wizard).
- Settings page, personal mode: a first card "Repositories — n watched · Manage" linking to
  `/repos`.
- Account row ⋯ menu: **Switch GitHub account** (sign out, then `/welcome` in personal mode,
  `/login` otherwise) above **Sign out**. Integrations keeps Connect/Disconnect for Claude.
- e2e: `welcome.spec.ts` (personal fixture) covers `/repos` save → `/api/me.repos`, sidebar
  item present only in personal mode (team fixture asserts absence), Switch account lands on
  `/welcome` signed out.

### A4. Gates for lane A

`python3 -m unittest discover -s bin -p 'test_*.py'`; `pnpm typecheck && pnpm test && pnpm build`;
`RS_E2E_PORT=89xx pnpm test:browser` full; `desktop`: `node scripts/prepack.mjs && node --test
test/*.test.mjs` (smoke included). Screenshots of the phone window with a pair code and of
`/repos` into `openspec/changes/phone-pairing-and-ease/after/a/`.

## Lane B — documentation (website + docs/ + READMEs)

Principle: one idea per page, every page starts with what you get and the one command or click
that gets it, ≤ 500 words unless it is reference. No prose about internals on start pages.

- `start/index.md` → "What you get" in five lines, then the two installs (one person: `npx
  reviewstage`; a team: Docker) as two cards, then "Your first review" link. ≤ 250 words.
- `start/install.mdx` → Desktop section first (one command, three steps, phone paragraph
  rewritten for QR pairing, "what if my Wi-Fi drops" answered in two sentences), then Team
  (Docker), then From source collapsed. Each section ≤ 300 words; details move to
  `operations/configuration.md`.
- `start/first-review.md` → a numbered walk with one demo recording (lane C) at the top.
- **New** `guides/team-workflow.mdx` — "Fit ReviewStage into your team's review process":
  review requests → your queue (poller or webhook, 3 min / 1 s); CODEOWNERS and required
  reviewers unchanged; you post as a plain `COMMENT` review and approve with a separate click,
  so branch protection sees a human; Slack/Discord/webhook cards; one install, many repos;
  what to tell the team (three sentences); what it deliberately does not do (auto-approve,
  block merges, run on every push).
- **New** `operations/faq.md` — tunnel lifetime, "my phone shows an old address", switching
  accounts, adding repos, dry run on the team install, Windows.
- `docs/INSTALL-DESKTOP.md`, `desktop/README.md`, root `README.md` quick start: pairing (scan =
  signed in), tunnel lifetime, `/repos`, Switch account. Keep `docs/` and the site in step.
- Sidebar order in `website/astro.config.mjs`: Start (What you get, Install, First review,
  Team workflow), Guides, Operations (Configuration, FAQ, Troubleshooting), Security, Developers.
- Gates: `pnpm build && pnpm check && pnpm verify` in `website/`; the verify harness's claim
  checks must still pass (update `website/scripts/verify-site.mjs` where pages moved).

## Lane C — demos

- Recordings from the offline e2e fixture with Playwright video (`recordVideo`, 2x, dark theme,
  motion on), cut with ffmpeg to **MP4 (h264, ≤ 2.5 MB)** and **GIF (≤ 4 MB, 12 fps)** in
  `website/src/assets/demos/` and copied to `docs/demos/` for GitHub:
  1. `review.{mp4,gif}` — paste a PR URL → run → findings appear → tick two → Post → posted (≈ 20 s).
  2. `wizard.{mp4,gif}` — the three wizard steps from the personal fixture (≈ 12 s).
  3. `phone.{mp4,gif}` — 390-wide: queue → PR → tick → Post (≈ 12 s).
  4. `phone-access.{mp4,gif}` — the desktop phone window with a QR (static frame is fine; from
     `desktop/pages/phone.html` driven with fake data, 6 s).
- Script `dashboard-ui/e2e/demos.ts` (reproducible; `pnpm demos`), ffmpeg commands inside.
- Placement: root `README.md` directly under the hero image (GIF, linked to the MP4); site
  landing Install section (MP4 `autoplay muted loop playsinline`, poster), `start/first-review`
  (review), `start/install` desktop section (wizard + phone-access), `guides/team-workflow`
  (phone), `docs/INSTALL-DESKTOP.md` (wizard, phone-access), `desktop/README.md` (one GIF via
  absolute `raw.githubusercontent.com` URL so npm renders it).
- Gates: files within size budgets; `pnpm build` on the site; Lighthouse performance on the
  landing page ≥ 95 with the video (poster + `preload="none"`).

## Lane rules (all)

Work in your own worktree and branch; commit; do not push or merge. Verify every claim you make
in your report with a command you ran. No new identity, token or write path beyond A1. Screens
go to `openspec/changes/phone-pairing-and-ease/after/<lane>/`. Report: tip sha, gate numbers,
exact API shapes (lane A), files added/moved (lanes B, C), anything you could not do.
