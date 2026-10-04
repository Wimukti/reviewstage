# phone-pairing-and-ease — review and proof (10/04/26)

Three lanes merged into `main` with `--no-ff`: `ease-a` (server + SPA + desktop), `ease-b`
(documentation), `ease-c` (demo recordings). Tag: `v1.0.0-rc.31`.

## What a person gets

- **Scan = signed in.** The phone-access QR encodes a single-use pairing link minted on the Mac
  for the signed-in account (`POST /api/pair`, loopback + session + personal mode; 30-minute
  TTL; one live code per person; killed by "Sign out everywhere"). `GET /pair/<nonce>` sets the
  session cookie (Secure when the request came over https, which the tunnel does) and lands on
  the queue. Unknown, used or expired → `/login?paired=expired` with one line of guidance. The
  text field still shows the plain address; the home-screen app lives there.
- **Tunnel lifetime, stated and enforced.** cloudflared reconnects after a drop or sleep and the
  address stays for as long as the app runs. If the process dies, the app restarts it once (new
  address, new code, system notification "Phone address changed — rescan the code"); a second
  death within 5 minutes stops with the reason on screen.
- **Repositories** page (`/repos`) in the sidebar and under Settings; **Switch GitHub account**
  in the account ⋯ menu above Sign out.
- **Docs**: What you get (200 words), Install desktop-first (292 / 299 / 263 words per section),
  First review as a numbered walk, new **Team workflow** guide ("fit it into the review process
  you already have"), new **FAQ**; `docs/` and the site say the same things.
- **Demos**: review (22.5 s), wizard (14.8 s), phone (10.8 s), phone-access (5.8 s) as MP4 ≤ 1.5
  MB + GIF ≤ 3.6 MB + JPEG poster, reproducible with `pnpm demos`; embedded in the README, the
  landing Install card, First review, Install, Team workflow, INSTALL-DESKTOP and the npm page.

## The five properties

Pairing hands the Mac's own session to the Mac's own phone over the Mac's own screen; no new
identity, no service token, no write path. The review step, the post path, click-to-run, the
Claude account and reviewer independence are untouched (`test_rs_personal.py::PairRoute`,
`TeamModeIsUntouched::test_pairing_is_personal_only`).

## Gates (merged tree)

- `python3 -m unittest discover -s bin -p 'test_*.py'` → **556 OK** (+7)
- dashboard: typecheck clean · unit **79/79** · build `app-5945209ac7e1` · browser **243 passed**
  (+3: `/repos` save round-trip, Switch account, full QR pairing — mint on the Mac, cookie-less
  390-wide context opens the link, 302, signed in, cookie HttpOnly/not Secure on http, audit
  line, second use → expired banner, bogus nonce → no cookie)
- desktop: **15 pass, 1 live-skipped** (smoke ×2 real Electron, tools ×4, tunnel ×10 incl. 3
  supervisor tests with fake children and an injected clock)
- website: 22 pages · `pnpm check` 0 · `pnpm verify` **100 ok / 0 FAIL** · Lighthouse
  performance on `/` **98** (it fell to 77 with the demo's 996 KB PNG poster; JPEG posters of
  ~60 KB restored it — `pnpm demos` now emits JPEG)
- Link check (lane B): 1,112 built hrefs + 101 Markdown links, 0 broken; 6 pre-existing broken
  anchors fixed on the way.

## Screens looked at

`after/a/`: phone window with a pair code, signed-out variant, stopped variant, `/repos` at 1440
and 390, account menu with Switch account, phone More sheet, Settings repos card, login with
the expired-code line. `after/b/`: Team workflow and FAQ ×4, docs sidebar, Install. Demo frames
at 2.5 / 7.5 / 12 / 16 / 21.5 s (review), 3 s (phone-access, re-recorded against the pairing
window), 6 s (phone).

## Deviations recorded

1. A pair code dies when its login's credential epoch moves ("Sign out everywhere") — the
   design stored the epoch without saying why; this is why.
2. The desktop reads the login for the QR caption from `GET /api/me` rather than widening the
   `/api/pair` response.
3. "Switch GitHub account" is in the desktop ⋯ menu only; the phone More sheet keeps Sign out.
4. Team workflow is 747 words against a 500-word guideline; every design bullet is in it.
5. `start/team-mode` moved to `guides/team-mode` with an Astro redirect; `Login.tsx` still links
   the old path and works through it.
6. The npm README carries one recording (wizard), not two.

## Left for the maintainer

- Scan a real code: `npx reviewstage@latest` → Enable phone access… → scan → the phone should
  land on the queue signed in, no GitHub step. Then Add to Home Screen, Settings → Push.
- Watch the tunnel supervisor once in anger (kill `cloudflared` while phone access is on; the
  Dock notification and the new code should follow).
- The maintainer's "integrate with existing factories review phase" was read as "fit into a
  team's existing review process" and answered with the Team workflow guide; redirect if meant
  otherwise.
