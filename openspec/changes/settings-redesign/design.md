# settings-redesign — design (binding for lane E)

Maintainer, 10/05/26: "there is a phone tab on left and it's the same settings screen — remove
it. Also the settings screen is too messy; make it readable, attractive, modern."

## E1. Sidebar

- Remove the **Phone** item and its status dot from the desktop sidebar and the phone More
  sheet. Phone access is reached through Settings only. Delete the `phone-dot` plumbing that
  existed only for the item; keep the shared phone-status store if PhoneAccess still uses it.
- Update every e2e that asserted the item or the dot (`phone-access.spec.ts` "Phone nav item"
  test → replaced by a test that `/settings#phone` opens the Phone section).

## E2. Settings: one section at a time

Pattern: the settings surfaces people know today (GitHub, Linear, Vercel) — a secondary
navigation of sections on the left, one section on the right, the URL hash naming the section.
Nothing scrolls past six cards any more.

- Route stays `/settings`; the section is the hash: `#phone`, `#appearance`, `#repositories`,
  `#poller`, `#notifications`, `#filters`, `#devices`, `#webhooks`. No hash → the first
  section that exists for this install (desktop app: `#phone`; browser personal: `#appearance`;
  team: `#appearance` too — repositories is team-mode `.env`). Existing deep links
  (`/settings#devices`, `/settings#phone`) keep working.
- Layout ≥ 1100px: `grid-cols-[200px_minmax(0,720px)]` with `gap-10`; the section nav is
  sticky (`top-6`), a vertical list of ghost buttons grouped under three small group labels:
  **This device** (Your phone · Appearance) · **Reviewing** (Repositories · Poller · PR
  filters) · **Notifications** (Notifications · Webhooks · Devices). Active item: `bg-accent
  text-foreground font-medium`. Below 1100px the nav is a horizontally scrolling row of
  pill-shaped buttons above the content (`overflow-x-auto`, `scrollbar-width:none`), active
  pill `bg-accent`; the row never wraps and never makes the page scroll sideways (measure with
  `visualViewport.width`).
- Each section: a header block — `h2` (text-lg font-semibold) and one sentence of
  `text-muted-foreground` under it — then **one** Card whose rows are the existing
  `Row` (label + hint left, control right, `divide-y`). No nested cards, no card titles
  repeating the section title. Controls right-aligned at a fixed column (`grid-cols-[1fr_auto]`
  as today) so switches, selects and inputs line up down the page.
- **Save**: the `Save settings` button at the page end goes. A sticky **bottom bar** appears
  only when a runtime setting is dirty: left "Unsaved changes" with the count of changed
  fields, right **Discard** (ghost) and **Save** (primary); it sits above the phone tab bar at
  phone width. Saved → bar slides away, a 2-second "Saved" check in its place. Devices,
  Repositories and Your phone act immediately and never make the page dirty.
- **Your phone** keeps PhoneAccess's content but drops its own card chrome (the section header
  carries the title and description); when off, the section shows a short explanatory
  paragraph + the Enable button; when on, the QR block as today.
- **Repositories** section (personal): the count, the first few repo pills, and a **Manage**
  button → `/repos`. Team mode: the configured list read-only with the note that `.env` sets it.
- Typography and spacing from the design system only (`tokens.css`, shadcn). No new colours.
  Density: section header `mb-5`, card rows `py-4`, hints `text-xs leading-relaxed`.
- Screenshot script `dashboard-ui/e2e/shots-settings.ts` → every section at 1440 dark, and
  `#phone`, `#poller`, `#notifications` at 390, into `openspec/changes/settings-redesign/after/`.
  Look at each. Before/after pair for `#poller` and the page top.

## Gates

`pnpm typecheck && pnpm test && pnpm build`; `RS_E2E_PORT=8993 pnpm test:browser` full, twice
(the Settings specs will move: `audit.spec.ts`, `pages.spec.ts`, `system-shell.spec.ts`,
`auth.spec.ts` Devices, `phone-access.spec.ts`, `welcome.spec.ts` repos card, `foundation.spec.ts`
theme — assert the new truth; keep every behaviour assertion, change only how it is reached);
desktop `RS_SKIP_UI_BUILD=1 node scripts/prepack.mjs && node --test test/*.test.mjs`; the
screenshots.
