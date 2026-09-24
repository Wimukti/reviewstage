# Stage light — build contract

Binding for every lane. `proposal.md` says why; this says exactly what. Where the two differ,
this wins. Where this is silent, the one-identity contract
(`../one-identity-redesign/design.md`) still applies: focus ring, 4.5:1, labels, 44px targets,
three radii, severity words, `.status` dot-and-word.

## 1. Tokens — dark is the default

`dashboard-ui/src/tokens.css` and `website/src/styles/tokens.css` stay byte-identical (`cmp`).
No colour literal anywhere else. `:root` is the dark theme now. Light is opt-in.

```css
:root {
  --paper:    #0B0C10;  --panel:    #12141A;  --raised:  #181B23;
  --ink:      #ECEEF3;  --graphite: #9AA0B4;  --hairline:#22262F;
  --blue:     #7A83FF;  --blue-ink: #0B0C10;
  --amber:    #E0A63A;  --red:      #F0718A;  --green:   #3DD98F;
  --amber-bg: rgba(224,166,58,.12); --red-bg: rgba(240,113,138,.12); --green-bg: rgba(61,217,143,.12);
  --blue-bg:  rgba(122,131,255,.14);
  --light:    rgba(255,225,176,.18);             /* the stage light — see §4 */
  --light-strong: rgba(255,225,176,.38);
  --shadow-raised: 0 -1px 0 var(--hairline), 0 12px 32px -12px rgba(0,0,0,.7);
  --r-s: 4px; --r-m: 8px; --r-full: 999px;
  --display: 'Bricolage Grotesque Variable', 'IBM Plex Sans', system-ui, sans-serif;
  --font: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --dur: 120ms; --dur-slow: 320ms; --ease: cubic-bezier(.2,.7,.2,1);
  --t-12: .8571rem; --t-13: .9286rem; --t-14: 1rem; --t-16: 1.143rem; --t-20: 1.429rem;
  --t-24: 1.714rem; --t-32: 2.286rem;
  --t-display: clamp(2.75rem, 7vw, 5.5rem);      /* site headline only */
  --row: 44px; --pad: 16px; --ctl: 32px; --side: 216px;
  color-scheme: dark;
}
:root[data-theme="light"] {
  --paper: #F6F6F9; --panel: #FFFFFF; --raised: #FFFFFF;
  --ink: #171922; --graphite: #5A5F73; --hairline: #E1E3EA;
  --blue: #3947FF; --blue-ink: #FFFFFF;
  --amber: #8F5D0A; --red: #C93A52; --green: #187149;
  --amber-bg: rgba(143,93,10,.08); --red-bg: rgba(201,58,82,.08); --green-bg: rgba(24,113,73,.08);
  --blue-bg: rgba(57,71,255,.08);
  --light: rgba(255,190,90,.16); --light-strong: rgba(255,190,90,.34);
  --shadow-raised: 0 -1px 0 var(--hairline), 0 8px 24px -12px rgba(23,25,34,.25);
  color-scheme: light;
}
@media (prefers-color-scheme: light) {
  :root[data-theme="system"] { /* same block as light */ }
}
```

**Theme choice semantics change.** Three options stay: System, Light, Dark. With nothing
stored, the choice is **Dark**, and the bootstrap stamps `data-theme="dark"`. System is stamped
as `data-theme="system"` (it was the absence of the attribute) so the media query can target it.
`theme.ts`, `index_html()` in `bin/server.py`, and the site's `theme.ts` all change together.
The base font size stays 14px; `--t-13` is the interface default (§3).

## 2. Type

- **Display**: Bricolage Grotesque, variable, self-hosted from
  `@fontsource-variable/bricolage-grotesque` (latin subset). Weight 600 for page titles, 700 for
  the site headline. Letter-spacing `-0.02em` at 32px and above, `-0.01em` below. Used for: the
  site headline and section titles, every app page `h1`, the login product name, the commit
  bar's staged count, empty-state titles. Nowhere in body text or controls.
- **Interface and body**: IBM Plex Sans, unchanged.
- **Code**: IBM Plex Mono, unchanged.
- Scale: site headline `--t-display`; site section title `--t-32`; app `h1` `--t-24`; card
  title `--t-14` 600; interface default `--t-13`; body prose `--t-14`; meta `--t-12`.
- F0 also renders the fold headline in Schibsted Grotesk and Instrument Sans from Google Fonts
  for a comparison sheet only (`after/fonts/*.png`); neither ships.

## 3. Density

`--row 44px` for list rows, `--ctl 32px` for buttons, inputs and tabs (36px on the phone),
`--pad 16px` for panel padding, `--side 216px` for the sidebar, sidebar items 36px. Table cells
8px 12px. Section gaps 24px, page gutter 24px (16px phone). Cards keep 8px radius; controls
4px.

## 4. The stage light

One visual, three placements, proven by grep: `--light` and `--light-strong` may appear only in
these selectors.

1. **Site hero frame** `.stage-hero::before`: `radial-gradient(60% 55% at 50% 0%, var(--light), transparent 70%)`
   positioned behind the frame, breathing: `@keyframes breathe { from { opacity: .7 } to { opacity: 1 } }`
   8s alternate infinite. Also behind the login card in the app, same selector family
   (`.stage-login::before`).
2. **Staged finding** `.finding.is-staged`: the existing blue inset edge stays; add
   `background: linear-gradient(180deg, var(--light) 0%, transparent 28%)` on the card head only.
3. **Post button when armed** `.commit-bar.has-staged .btn.primary`: `box-shadow: 0 0 0 1px var(--blue), 0 0 28px var(--light-strong)`,
   transitioning in over `--dur-slow`. Off when the count is zero.

It is light, not a colour: never a text colour, never a solid fill, never on a hover.

## 5. Motion

Allowed, and nothing else:

| Where | What | Duration |
|---|---|---|
| Stage light (§4.1) | opacity breathe | 8s, infinite |
| Site hero | plays the staging sequence once on load; replay button | ~6s |
| Site strip | cross-fade between the five states | `--dur-slow` |
| Site frames (hero, strip, install) | hover lift `translateY(-2px)` + raised shadow | `--dur` |
| App: finding ticked | edge and head light in | `--dur-slow` |
| App: commit bar count | number rolls (old up, new in) | `--dur-slow` |
| App: post button armed | glow in | `--dur-slow` |
| App: More sheet, menus, palette | existing slide/fade | `--dur` |
| App: running bar | indeterminate sweep | 1.6s, infinite while running |

`@media (prefers-reduced-motion: reduce)` disables all of them except a plain opacity change
on state. No scroll-triggered entrance animation anywhere. No parallax. No animated gradients
on text.

## 6. Words

The interface says what things are and what buttons do. The explanatory sentence under a page
title is removed on every page. Where a page genuinely needs orientation, it goes behind one
`?` icon button (`aria-label="About this page"`) that opens a `.explainbox`. Empty states get a
display-type title and one line. The guarantee sentence lives on the login screen only.

## 7. The site renders the app's components

No pnpm workspace; the Docker and CI install paths stay as they are.

- `website/astro.config.mjs`: `@astrojs/react`; Vite `resolve.alias['@app'] = '../dashboard-ui/src'`.
- `website/package.json`: `react` and `react-dom` pinned to exactly the app's versions
  (19.3.0), `@astrojs/react`, `@fontsource-variable/bricolage-grotesque`.
- `website/tsconfig.json`: `paths` for `@app/*`, `include` the app's `src/assets.d.ts`.
- **Isolation**: every island renders inside a shadow root. `website/src/components/stage/StageFrame.tsx`
  creates the host, attaches `{ mode: "open" }`, injects `tokens.css` and `styles.css` from the
  app as `?inline` strings into a `<style>` in the shadow, then renders children with
  `createRoot` into a container inside it. Custom properties inherit into the shadow, so the
  theme applies; `@font-face` does not, so the site declares the faces in the light DOM.
- **Presentational only**: `dashboard-ui/src/stage/` holds components that take props and call
  no API: `StageScene.tsx` (the PR page's findings and commit bar, with a `state` of
  `requested | drafting | staged | posted | approved` and a `play` flag that runs the scripted
  sequence), `StageQueueCard.tsx`, `StageProgress.tsx`. They compose the app's real pieces
  (`Status`, `FindingCard` with no-op handlers, the commit bar markup). When A2 restyles those
  pieces the scene inherits the change; that is the whole point.
- **Fixture data** for the scene comes from `dashboard-ui/e2e/fixture.ts`'s PR #38849 review,
  exported as a JSON module `dashboard-ui/src/stage/fixture.json` written by a small script so
  it cannot drift from the e2e fixture.

## 8. Lane ownership

| Lane | Owns (may edit) | Creates | Must not touch |
|---|---|---|---|
| **F0** | both `tokens.css`, `styles.css` base rewrite, `theme.ts`, `main.tsx`, `index_html()` in `server.py`, `tokens.test.ts`, `website/astro.config.mjs`, `website/package.json`, `website/tsconfig.json`, site `theme.ts` and `base.css` | `src/stage/*`, `website/src/components/stage/*`, `src/shell.css` `src/review.css` `src/pages.css` (empty, imported from `styles.css`), `after/fonts/*` | any page component |
| **W** | everything under `website/` except the files F0 owns | new sections, strip, deletes `mocks/*.astro` | `dashboard-ui/` |
| **A1** | `Login.tsx`, `Sidebar.tsx`, `App.tsx`, `Tour.tsx`, `CommandPalette.tsx`, `src/shell.css`, `public/manifest.webmanifest` | `e2e/shell.spec.ts` | other pages, `styles.css` |
| **A2** | `PrPage.tsx`, `StackPage.tsx`, `Queue.tsx`, `src/review.css`, `bin/rs_review_body.py` if needed | `e2e/review.spec.ts` | `Sidebar`, `App`, `styles.css` |
| **A3** | `Skills.tsx`, `Rollup.tsx`, `Learnings.tsx`, `Qa.tsx`, `Integrations.tsx`, `Settings.tsx`, `src/pages.css`; deletes `HowItWorks.tsx`, `bin/rs_howimg.py` and its routes/tests | `e2e/pages.spec.ts` | `Sidebar`, `App` (A1 removes the `/how` route and Help link), `styles.css` |

**No lane appends to `styles.css`.** Each writes its own file, which F0 has already imported.
This removes the brace-context merge trap that bit the last redesign twice. Existing spec
files may have selectors updated by the lane that owns the page they test.

## 9. Proof

- `tokens.test.ts`: every text/background pair in both themes ≥ 4.5:1, including `--ink` and
  `--graphite` over `--panel` blended with `--light` at its maximum alpha.
- `grep -nE -- '--light(-strong)?' src/*.css website/src/**/*.css website/src/**/*.astro`
  matches only the three §4 selector families.
- `grep -c 'mocks/' website/src` is 0; the `mocks/` directory is gone.
- Home page word count < 400, asserted in `website/scripts/verify-site.mjs`.
- Site verify: the hero island hydrates and its shadow root contains a `.finding.is-staged`.
- All existing browser tests pass; phone width has no horizontal scroll at 390.
- Lighthouse performance ≥ 90 on the home page (site verify runs it headless).
- `after/` screenshots for every app page and site page, both themes, both widths; `review.md`.
- The Docker image builds and boots (CI), and the full python suite passes inside it.
