# shell-polish — design (binding for lane D)

Two things the maintainer flagged on 10/04/26 after using rc.31:

1. Phone access lives only in the macOS menu bar and the Dock menu. It belongs **on screen, in
   the app**, where every other setting is.
2. The ⋯ button on the account row is the generic answer. Use the pattern current tools use.

## D1. Phone access inside the app

- The desktop window's preload already exposes `window.reviewstage.phone.{enable, disable,
  status, onData}` to the dashboard (the preload is set on the BrowserWindow, so it applies to
  the SPA too; fix the stale comment in `desktop/preload.cjs`). The SPA treats
  `typeof window.reviewstage?.phone !== "undefined"` as "running in the desktop app".
- **Settings → first card "Your phone"** (desktop app only; hidden in a browser and in team
  mode): state line (Off / Opening… / On with the address) · primary button **Enable phone
  access** → the card expands to the QR (from `onData.dataUrl`), the caption "Scanning signs
  you in as <login>. Code valid until HH:MM", the plain address with Copy, the reachability
  line (checking / reachable / couldn't confirm, same wording as the window), the three steps,
  and **Turn off**. **New code** re-mints (calls `enable()` again; main.js already re-presents).
  Same data, same words as `desktop/pages/phone.html`; no second source of truth — move the
  shared strings into one place the page and the SPA both read, or accept duplication only for
  the three step lines.
- **Sidebar**: in the desktop app a **Phone** item (lucide `Smartphone`) in the SETUP group
  linking to `/settings#phone`; shows a small green dot when phone access is on (poll
  `status()` every 30 s and on the `onData` events). Phone More sheet: unchanged (it is the
  phone).
- The macOS menu items stay; the separate phone window stays for the menu path. The Settings
  card is the primary path and the one the docs describe (update `docs/INSTALL-DESKTOP.md`,
  `website/src/content/docs/start/install.mdx`, `operations/faq.md`, `desktop/README.md`:
  "Settings → Your phone → Enable phone access", with the menu as the alternative).
- e2e: a spec that installs a fake `window.reviewstage.phone` with `addInitScript` (as a
  string — tsx's function init scripts inject `__name`) and asserts the card renders, Enable
  shows the QR from `onData`, Turn off hides it, the sidebar dot follows status; and that
  without the bridge the card and the item are absent.

## D2. Account menu, the current pattern

- The account row (avatar · login · Live/Dry run) **is the trigger**: the whole row is a
  button with a `ChevronsUpDown` at its right edge (shadcn "NavUser"); the ⋯ button goes.
- Menu content: header with avatar, login and the GitHub profile link; **Switch GitHub
  account**; **Sign out**. Nothing else.
- **Theme** moves to **Settings → Appearance**: a three-way segmented control System / Light /
  Dark (`useTheme`), with the same `data-testid="theme-control"` and `data-theme-choice`
  attributes so the existing theme tests pass after pointing them at Settings.
- **Help** moves to the page header's existing "?" affordance: the Queue header's `?` opens a
  small popover with **How it works** (external) and **Take a tour**. Keep the tour's focus
  handoff behaviour (it currently hands focus back to ⋯; hand it back to the `?` button).
- Phone More sheet keeps the theme radios and Sign out (it has no header "?"); add Switch
  GitHub account there too.
- Update every e2e that reaches the theme control or the Help items through the ⋯ menu
  (`shell.spec.ts`, `system-shell.spec.ts`, `foundation.spec.ts`, `pwa.spec.ts`, the tour
  tests, screenshot scripts); counts of nav items may change — assert the new truth.

## Gates

`pnpm typecheck && pnpm test && pnpm build`; `RS_E2E_PORT=8993 pnpm test:browser` full, run
twice; desktop `RS_SKIP_UI_BUILD=1 node scripts/prepack.mjs && node --test test/*.test.mjs`;
website `pnpm build && pnpm check && pnpm verify` (docs changed). Screenshots to
`openspec/changes/shell-polish/after/`: Settings with the phone card off and on (QR via the fake
bridge), the account menu open, Settings → Appearance, the Queue "?" popover; 1440 and 390,
dark. Look at each.
