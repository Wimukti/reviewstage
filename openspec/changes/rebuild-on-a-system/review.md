# Rebuild on a system — review

Reviewed 10/04/26. Before is `../stage-light/after/`; after is `after/s1..s4/` plus the
regenerated `website/src/assets/screenshots/`. Every after-shot was looked at by the lane that
made it and again by the main session before merging.

## The verdict that started this

> both site and app is not look good. Like its too old and the fonts are also not good.

Two bespoke CSS passes had produced the same dated language twice. The diagnosis in
`proposal.md` was that the font was a minor lever and the layout was the problem: borders as
structure, no icons or avatars, monospace in twenty places, outlined text-only buttons. This
pass replaced the component layer rather than restyling it.

## What changed

| | Before | After |
|---|---|---|
| Component layer | hand-written CSS, 1,103 lines across four sheets | shadcn/ui + Radix + Tailwind; **147** legacy lines, all document basics and server-rendered banner HTML |
| Interface face | IBM Plex Sans 13px, Bricolage display | **Geist** 14px, Geist Mono only inside code |
| Structure | 1px hairline on every card, button, input, tab, chip | surfaces by tone, `rounded-lg`, one soft shadow tier; borders only as row dividers and the severity accent |
| Status, severity | a dot and a word | **StatusBadge**: icon + label on a tint, one component everywhere |
| Authors, repositories | a word, a monospace string | **UserAvatar** and **RepoPill** with GitHub avatars |
| Buttons | outlined text | filled default / secondary / ghost / destructive, with lucide glyphs |
| Menus, dialogs, tabs, sheets, palette, tooltips | hand-rolled roles | Radix, zero hand-rolled `role="menu|dialog|tablist|listbox"` |
| Loading | "Loading…" | Skeletons |
| Login | three paragraphs, four env var names | five elements under the stage light |
| Site hero and strip | Astro mocks | the app's own rebuilt components in shadow roots |
| Site docs | Starlight defaults | the same tokens, sidebar and rail matching the app |
| Phone notifications | none | **Web Push**: VAPID per install, subscriptions per device, a notifier backend, a Notifications panel |
| Lighthouse performance, home | not measured | **99**, gated at 90 |

## Page by page

- **Login** (`s0`, in `Login.tsx`): the proof page. Card with soft depth, filled Continue with
  GitHub carrying the GitHub mark, token form behind a link, device code in a mono block.
- **Shell and queue** (`s1`): 216px sidebar on ghost buttons with glyphs, account row as
  name-over-state with the theme switch in a dropdown, 2px running bar, queue rows in one card
  with dividers, filters as Tabs and Select, palette on `cmdk` inside a Dialog, tour on Radix.
- **PR page** (`s2`): repository out of the title into a pill, status as iconed badges, a compact
  stepper, finding cards with a 3px severity accent and iconed footer actions, the commit bar
  raised with the count in display type and the glow on the post button, sections as Tabs.
- **Skills, Insights, Learnings, QA, Integrations, Settings** (`s3`): scores as a table, the
  skill editor as a code surface with a gutter and a highlighted Team rules marker, tiles as
  cards in one row, decisions as a table with pills and badges, Integrations as one card of
  rows with brand glyphs, Settings as grouped cards with one Save and the Web Push panel.
- **Website** (`s4`): the four-section home kept at 207 words with the surface rebuilt, the
  strip's Requested stop as the queue's real row, guarantees as glyph rows, install as a card,
  docs on the system, all twenty docs screenshots regenerated from the rebuilt app.

## Deliberately kept

- The five non-negotiable properties. Nothing here touches review, posting or approval paths.
- Dark default, light and system as choices; one blue; the stage light in exactly three places.
- Every test id, role, label and keyboard path. Specs changed only where a class they targeted
  was deliberately removed, and then to roles or test ids.
- The 14px document root, with Tailwind's scale restated so a utility means the pixel size it
  says.

## Defects found by looking or by the gates, and fixed before merging

- A white card border: shadcn's base border rule was not applied (system phase).
- Every Tailwind size rendered at 7/8: the 14px root against a 16px scale (lane 1 found it).
- Radix's highlight invisible: accent was the raised surface (lane 1).
- Tour card overlapped the phone tab bar: the tab bar had been given the tour hook (main).
- Login truncated to "ac…": one-line account row (lane 2 flagged, main fixed).
- The site build broken on main since lane 1: the site did not resolve the `@/` alias (lane 2
  found, main fixed).
- Lighthouse 76 with CLS 0.47 from client-only islands: heights reserved server-side (lane 4).
- `text-xs` at 11.998px tripping the legibility gate (lane 3 found, main fixed).

## Deviations from the contract

1. `shell.css`, `review.css` are not empty: the running-bar sweep and the count roll need
   `@keyframes`, which no utility expresses. 44 lines between them.
2. Finding-card actions are always visible at 70% opacity rather than hover-revealed; hover-only
   left a blank band on every card.
3. Sections open with the first tab selected; Radix Tabs cannot represent "none open".
4. QA index rows carry a flask glyph, not an author avatar; the API does not return the author.
5. Website deps now include the component layer's packages directly, because CI's website job
   never installs `dashboard-ui/node_modules`.

## Proof on main

| Check | Result |
|---|---|
| `python3 -m unittest discover -s bin` | 516 OK |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | clean / 79 / 0 warnings |
| `pnpm test:browser` | **232 passed** |
| `website pnpm build` / `check` / `verify` | 20 pages / 0 hints / all checks passed, Lighthouse 99 |
| `docker build .` | succeeds, `cryptography` present |
| `.btn` in TSX, `className="status`, hand-rolled dialog/menu/tablist roles | 0, 0, 0 |
| `font-mono` outside code surfaces | 0 |
| legacy CSS, four sheets | 147 lines |
| `tokens.css` app vs site | identical |
| `--light` outside the three §4 families | none |

## Not provable here

Delivery of a push notification to the maintainer's phone. `docs/push-proof.md` has the steps.
