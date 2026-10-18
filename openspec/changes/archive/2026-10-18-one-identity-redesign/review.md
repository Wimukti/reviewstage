# One identity — side-by-side review

Reviewed 09/18/26 against `before/app` (13 shots), `before/site` (12) and the regenerated
`after/` set (76 page shots from one build of main, 12 site shots from `pnpm verify`, plus the
foundation set). Every after-shot was taken at 1440 and 390 in both themes from the offline
fixture, so before and after show the same data.

## What changed, page by page

**Shell.** Before: dark-only, Inter from Google Fonts, an orange brand accent, five green/amber
dots in the sidebar, a bare ✨ as the phone's primary action, no focus ring anywhere. After: light
default with a System / Light / Dark switch in the account card, IBM Plex self-hosted, one blue,
a 2 px ring on every focusable element, and on the phone a 56 px header, a 28 px running strip and
a labelled four-item tab bar (Queue, QA, Skills, More). The "1 review running" pill kept its
amber because it is the one thing that needs you.

**PR page** (`pr-*`, `pr3-*`, `stack-*`). Before: three stacked banners (dry run, Claude not
connected, review state), a right rail of cards duplicating the header, six action buttons of
equal weight, findings with emoji severity, and a floating post bar that covered the last card.
After: one status line carries all three facts as dot-and-word, one Actions menu, a three-step
progress line (Reviewed → Comments posted → Approved), the sections as a row of disclosures,
findings with word severities and a blue staged edge, and a sticky commit bar that reads
"2 staged · 1 inline · 1 in the summary" with the single primary button. Posting keeps you on
the page and turns the bar into the posted state. The unknown-PR case keeps breadcrumbs and
the typed reference instead of a bare red banner. The stack page is only linked when there is a
stack.

**Queue** (`queue-*`). Before: four stat tiles above tabs that carried the same numbers, a
three-line row with a chevron, an "Archive" text link on every row. After: tabs carry the counts,
the paste-a-PR field sits in the page header as a quiet input, rows are two lines with a
dot-and-word state, archive is an icon button that appears on hover and is always visible on the
phone, sort is a segmented control, and the list is one panel with hairlines. Empty, filtered and
new-install copy was kept word for word.

**Command palette.** Now a real combobox: `aria-activedescendant`, one "Review PR #n" offer
only when nothing matches, expanding to per-repository rows when there are several.

**QA guides** (`qa-*`). The `#7 — PR #7` double number is gone; the form lives in the header or
in the empty state, and rows use Guide ready / Building.

**Learnings** (`learnings-*`). A table with a header row replaces the card list; Dropped is
graphite rather than red, dry-run decisions carry a graphite mark, and the retention paragraph
sits behind "About this log".

**Skills** (`skills-*`). Six hash-addressed tabs replace the one long scroll. Each tab has one
primary action; Re-profile drops to secondary once a profile exists.

**Insights** (`insights-*`). Tiles are number plus a short label under two row headings, the
methodology is one disclosure at the foot, the axis labels are HTML below the chart, and the
volume bars are all blue (the repository bars were amber, fixed in 26f2678).

**Settings** (`settings-*`). Poller, Notifications and PR filters are one form with a footer Save
that names what it saves and an "Unsaved changes" status. Webhooks moved below as read-only.
Devices is reachable from More on the phone.

**Integrations** (`integrations-*`). One list panel; Connect with Claude is the only primary.

**How it works** (`how-*`). The five server-rendered JPEGs are replaced by inert mocks built from
the app's own finding card, commit bar and status components, so the explainer always matches
the product.

**Website** (`after/site`). Favicon, apple-touch icon and og image are served and referenced;
the tab reads "ReviewStage"; the orange accent and Google Fonts are gone; the closing CTA install
command renders at both widths; the trust bar's dots are graphite; the type scale lives in the
shared `tokens.css`, which is byte-identical to the app's copy.

## Deliberately kept

- Every piece of copy the audit did not flag: empty states, filter explanations, the guarantees.
- Amber for the running pill, dry-run mark and "Reworded"; red for blocker, failed and the
  unknown-PR reason; green only for reviewed / approved / done.
- The Slack, Discord and webhook notification texts still use emoji. They are chat messages,
  not the interface, and emoji is the convention there.
- Behaviour. No API changed; the 114 pre-existing browser tests pass with selector updates only.

## Known gaps left open

- `after/pages/*-phone.png` from `pages-shot.ts` stamp the fixed tab bar and commit bar at the
  first viewport height because they capture full-page without growing the viewport; the
  `shots-pr.ts` shots do grow it. A capture artifact, not a layout bug (the suite asserts
  `scrollWidth <= 390` on every page).
- `/api/learnings` rows carry no timestamp, so the Learnings table has a Finding column instead
  of the "when" column the design named.
- The per-finding "teach the skill" control promised during the audit is still deferred.

## Proof on main

| Check | Result |
|---|---|
| `python3 -m unittest discover -s bin` | 456 OK |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | clean / 54 / 0 warnings |
| `pnpm test:browser` | 148 passed |
| `website pnpm build` / `pnpm check` / `pnpm verify` | 20 pages / 0 hints / all checks passed |
| `docker compose config -q` | ok |
| `text-transform: uppercase` in app CSS | 0 |
| emoji in `dashboard-ui/src`, `bin/server.py` UI paths | 0 |
| `fonts.googleapis` in `bin/server.py` | 0 |
| distinct `border-radius` values | 3 (`--r-s`, `--r-m`, `--r-full`) |
| colour literals outside `tokens.css` | 0 |
| `tokens.css` app vs site | identical (`cmp`) |
