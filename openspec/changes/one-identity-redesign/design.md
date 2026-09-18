# Design: one identity

This is the build contract. Every lane implements against these exact names.

## 1. Tokens

Declared once on `:root` (light, the default) and overridden under
`:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`.
The same file is used verbatim by the app (`dashboard-ui/src/tokens.css`) and the site
(`website/src/styles/tokens.css`). No other colour literal may appear in any stylesheet.

```css
:root {
  --paper:    #F6F6F9;  --panel:    #FFFFFF;  --raised:  #FFFFFF;
  --ink:      #171922;  --graphite: #5A5F73;  --hairline:#E1E3EA;
  --blue:     #3947FF;  --blue-ink: #FFFFFF;           /* text on a blue fill */
  --amber:    #8F5D0A;  --red:      #C93A52;  --green:  #187149;
  --amber-bg: rgba(143,93,10,.08); --red-bg: rgba(201,58,82,.08); --green-bg: rgba(24,113,73,.08);
  --blue-bg:  rgba(57,71,255,.08);
  --shadow-raised: 0 -1px 0 var(--hairline), 0 8px 24px -12px rgba(23,25,34,.25);
  --r-s: 4px; --r-m: 8px; --r-full: 999px;
  --font: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --dur: 120ms; --ease: cubic-bezier(.2,.7,.2,1);
  color-scheme: light;
}
/* dark: the mark's own light-ink variant */
[data-theme="dark"] { /* and the prefers-color-scheme block */
  --paper: #101117; --panel: #171922; --raised: #1C1F2B;
  --ink: #E8E9F0; --graphite: #9AA0B4; --hairline: #262A38;
  --blue: #7A83FF; --blue-ink: #101117;
  --amber: #E0A63A; --red: #F0718A; --green: #3DD98F;
  --amber-bg: rgba(224,166,58,.12); --red-bg: rgba(240,113,138,.12); --green-bg: rgba(61,217,143,.12);
  --blue-bg: rgba(122,131,255,.14);
  --shadow-raised: 0 -1px 0 var(--hairline), 0 8px 24px -12px rgba(0,0,0,.6);
  color-scheme: dark;
}
```

Measured at build time (`tokens.test.ts`, 09/18/26): every value above passes as written —
no hex changed. Lowest margins: light `--red` on `--paper` 4.6:1, light `--blue` on `--paper`
5.6:1, dark `--blue-ink` on `--blue` 6.1:1. The app's copy of the file also carries the type
scale (`--t-13` … `--t-34`, §2) on `:root`, since the app reaches them as tokens; the website
may add the same six lines or keep its own scale.

Contrast rule, enforced by `dashboard-ui/src/tokens.test.ts`: every text token (`ink`,
`graphite`, `blue`, `amber`, `red`, `green`) must reach **4.5:1** on both `paper` and
`panel` in its theme, and `blue-ink` must reach 4.5:1 on `blue`. The values above are the
starting point; the build may adjust a token by the smallest step that passes and must
record the final hex in this file. Measured at proposal time: light amber (`#B8780F`) and
light green (`#1F8A5B`) and dark blue (`#5C67FF`) fell short, hence the values shown.

## 2. Type

Self-hosted through fontsource, never fetched from a CDN: `@fontsource/ibm-plex-sans`
(400, 500, 600) and `@fontsource/ibm-plex-mono` (400, 500). The app bundles the woff2
files through esbuild (`--loader:.woff2=file`) into `bin/static/`; the server's shell
drops the Google Fonts `preconnect` and stylesheet links entirely.

Scale (rem, base 14px): `--t-13: .9286rem; --t-14: 1rem; --t-16: 1.143rem; --t-20: 1.429rem;
--t-26: 1.857rem; --t-34: 2.429rem`. Body 14/1.5. Page titles 26/1.2 weight 600. Section
titles 16/1.3 weight 600, sentence case, no letter-spacing, no uppercase anywhere in the
interface. Secondary text is `--graphite` at 14 or 13. Prose containers `max-width: 72ch`.
Mono is for content that is code-shaped only: paths, refs, SHAs, numbers in tables,
tokens, commands. Never for labels.

## 3. Surfaces

Three levels, and only three:

| Level | Background | Border | Shadow | Use |
|---|---|---|---|---|
| page | `--paper` | none | none | the canvas |
| panel | `--panel` | 1px `--hairline` | none | a real container: a finding, a settings group, a table |
| raised | `--raised` | none | `--shadow-raised` | exactly one per page: the commit bar |

A list of like items (queue rows, findings, skills) is a panel with hairline dividers
between items, not a stack of panels. Stat tiles, side cards, and section wrappers that
merely group headings are not panels; they become plain content on the page.

Radius: `--r-s` on inputs, buttons, pills, chips, code; `--r-m` on panels and the raised
bar; `--r-full` on avatars and the running dot only.

## 4. Controls

Buttons, one component, four intents:
- **primary** `--blue` fill, `--blue-ink` text; one per view.
- **secondary** `--panel` fill, hairline border, `--ink` text.
- **quiet** no fill, no border, `--graphite` text; `--ink` on hover.
- **destructive** `--red-bg` fill, `--red` text; confirms before acting.
Height 36px, padding 0 14px, radius `--r-s`, weight 500, no arrows or icons appended to
labels. Disabled: 50% opacity, `cursor: not-allowed`. Busy: label swaps to the progressive
verb (`Posting…`), the control disables; no spinner glyph unless the wait exceeds 1 s.

Inputs: `--panel` fill, hairline border, `--r-s`, 36px, focus ring `2px solid var(--blue)`
offset 2px. The same ring is the focus indicator for every focusable element in the app.

Status: `.status` = dot + word. `<span class="status is-amber"><i></i>Reviewing</span>`.
The dot is 8px, `--r-full`, coloured; the word is `--ink` at 13, weight 500. Mapping,
used everywhere without exception: blue = staged / primary; amber = needs you (reviewing,
should fix, pending approval, stale); red = blocker / failed / destructive; green = done /
posted / approved / LGTM; graphite = neutral / archived / draft. Severity words:
`Blocker`, `Should fix`, `Nit`, `Question`. No filled pills, no uppercase.

Staged finding: `.finding` is a panel row; `.finding.is-staged` gets
`box-shadow: inset 3px 0 0 var(--blue)`; the checkbox is the only control that toggles it.

## 5. Motion

Three animations, all answering an action, all under `@media (prefers-reduced-motion:
no-preference)`:
1. Running dot: `pulse` 1.6s ease-in-out infinite on opacity .4→1.
2. Staged edge: `box-shadow` transition `--dur --ease` when `.is-staged` toggles.
3. Commit bar: `transform: translateY(100%)→0` over 200ms `--ease` the first time a
   finding is staged in a session; instant thereafter.
Everything else transitions nothing. Remove every other `transition:` and `@keyframes`.

## 6. Layout

App shell: 240px sidebar on ≥ 900px; content column `max-width: 960px`, left-aligned,
`padding: 32px 40px`. Sidebar items 36px tall, icon 18px + label, no group eyebrows, a
24px gap and a hairline between the two groups. Account card at the foot carries the
theme control (System / Light / Dark, a three-way segmented control).

Phone (< 900px): no sidebar. A 56px header with the mark and the page title; a running job
is a 28px strip beneath it (`--amber-bg`, dot + phrase, links to the job). A labelled
bottom tab bar, 56px, four tabs: Queue, QA, Skills, More; More opens Learnings, Insights,
Integrations, Settings, How it works. Hit targets ≥ 44px. Nothing scrolls sideways.

PR page (see proposal wireframe): breadcrumb; title; one Actions menu (Open on GitHub,
QA guide, Stacked review when present); verdict line + key points; findings list;
four collapsed sections in a row (Full summary, What this PR does, Approve, Re-run);
the commit bar `position: sticky; bottom: 0` inside the content column on desktop and a
fixed bottom sheet above the tab bar on the phone.

## 7. Website

Same `tokens.css`, same fonts, same controls. Orange is removed; the hero's live run and
the section mocks are re-skinned to these tokens so every product shot is the product.
`website/public/` gains `favicon.ico` (32), `favicon-192.png`, `favicon-512.png`,
`apple-touch-icon.png` (180), `og.png` (1200×630, mark on `--paper`, wordmark, one-line
descriptor), all rendered from `assets/logo.svg`; `<head>` links all of them plus
`og:image`, `twitter:card`. Title is `ReviewStage`; the descriptor lives in
`<meta name="description">`. The docs theme inherits the tokens.

## 8. Proof

- `tokens.test.ts` (contrast) passes for both themes.
- Every page screenshotted at 1440 and 390, both themes, into
  `openspec/changes/one-identity-redesign/after/`, alongside the `before/` set copied from
  the audit's screenshots. Reviewed side by side.
- `document.documentElement.scrollWidth <= innerWidth` at 390 on every page, in a test.
- Every interactive element reachable by Tab with the ring visible, in a test that walks
  the PR page.
- `grep -c 'text-transform: *uppercase' styles.css` is 0; `grep -cE '[🟡✅🔴🧪✨]' src/**` is 0;
  `grep -c 'fonts.googleapis' bin/server.py` is 0; the number of distinct `border-radius`
  values in the stylesheet is 3.
- All 95 existing browser tests pass, because behaviour did not change.

## 9. Foundation build notes (dashboard-ui, 09/18/26)

Where the build settled something the contract left open, or had to deviate:

- **Theme persistence is per device, in `localStorage` (`rs-theme`), not a user preference on
  the server.** The shell has to apply the pin before first paint with a synchronous read, and
  a theme is a property of the screen in front of you (a dark laptop and a light desktop are
  both right), so the `tour_seen`-style server preference was the wrong layer. The account
  card's System / Light / Dark control writes the key; `bin/server.py`'s inline script reads
  it. Nothing else in `bin/` changed beyond the shell head and `serve_static` (font type,
  immutable cache for the hashed woff2).
- **Fonts are latin subsets only** (`@fontsource/*/latin-{400,500,600}.css`): five woff2 files,
  ~100 KB, instead of every script the family ships.
- **The mark is bundled twice**: the dark-ink `assets/logo.svg` for light paper, the server's
  light-ink `rs_assets.LOGO` for dark; CSS shows whichever matches the theme (`Logo.tsx`).
- **Status words** are sentence case everywhere (`Reviewed`, `Merged`, `Polling only`); the
  `done` review state reads `Reviewed`. Severity counts in the verdict and queue rows keep the
  server's label after the number (`1 should fix`) so no copy changed.
- **Running indicator**: on desktop a `.runlink` row under Review a PR (dot pulses, no pill);
  on the phone the 28px `.runstrip` under the header. Both carry `data-testid="running-pill"`
  for the existing tests; only one is ever in the DOM (`useIsPhone` picks the shell).
- **Phone shell**: the tab bar is Queue / QA / Skills / More; More is a sheet with the rest of
  the navigation, Take a tour, the account card (theme control) and Sign out. Sign out is
  therefore one tap away rather than in the header; `pwa.spec` opens More before asserting it.
- **Buttons**: `.btn.soft` → `.secondary`, `.ghost` → `.quiet`, `.warn` → `.destructive`; a
  bare `.btn` is secondary. Spinners are gone; `SlowBusy` shows the pulsing dot only after 1 s.
  The indeterminate progress bar under a running review is removed (it was a fourth animation).
- **Focus**: the old `a:focus, button:focus … { outline: none }` reset is deleted; the ring is
  `:focus-visible` on everything, with `.eff` cards and `.switch` taking the ring for their
  hidden inputs. A browser test Tab-walks the PR page.
- **Tour**: a real dialog — focus moves in, Tab cycles inside, Escape closes, focus returns to
  the trigger, and the last step ends in place ("Done"); "Go to Integrations" is offered as a
  secondary link rather than being the only exit.
- **PR page sections**: "Approve" and "Re-run" stay as 16/600 section titles for now; the
  "Findings (n)" heading and the Actions / Details / Review progress eyebrows are gone, the
  right rail is plain content with hairline dividers. The PR lane folds these into the four
  collapsed sections. `.finding.is-staged` and `.commit-bar` (with `.is-entering` for the
  first-stage slide) are in place for it.
- **Server-rendered banners** (`bannerHtml` from the API) still open with an emoji `<span>`;
  that markup lives in `bin/` and is out of this lane. The client hides nothing — the CSS
  simply gives that first span the same 16px slot the SVG icon uses.
- **Proof greps** on this branch: uppercase 0 · emoji 0 · googleapis 0 · distinct radii 3 ·
  `transition:|@keyframes` 3 · colour literals in `styles.css` 0. Screenshots: `after/foundation/`
  (42, both themes, 1440 and 390) beside `before/` (the audit set).

