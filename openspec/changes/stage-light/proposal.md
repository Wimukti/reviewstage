# Stage light — the second design pass, for the site and the tool together

## Why

The "one identity" redesign made the product consistent, accessible and honest. It did not make
it attractive. The maintainer's verdict after using it for a day: the home page is a wall of
text nobody will read, and the tool, from the login screen onward, looks old.

Both are right, and the evidence is in `openspec/changes/one-identity-redesign/after/`:

- **The home page is a document.** Seven feature sections, each a mock beside four to six
  paragraphs, then tiers, then steps, then a CTA. About 2,400 words. Above the fold alone:
  headline, sub-headline, two paragraphs, two buttons, an install command, a trust bar. Nothing
  moves except the simulated run.
- **The tool is an admin panel.** A light grey page, a sidebar, white panels with hairlines,
  and a sentence of documentation under every heading ("The agent has finished — read the
  findings and post the ones you agree with. Nothing is on GitHub yet."). The login screen has
  three paragraphs and four environment-variable names on it. IBM Plex Sans at 40px reads as an
  enterprise intranet.
- **The site and the tool are different things.** The site's "how it works" is hand-built Astro
  mocks that only resemble the app. They drifted within a week of being written.

## What "modern" actually is right now

Eight reference sites, captured live on 09/24/26 at 1440×900 (third-party captures kept out of the repo): Linear, Graphite,
Railway, Raycast, Resend, CodeRabbit, Cursor, Warp. Graphite and CodeRabbit are code-review
products, the direct comparison.

| Pattern | Who does it | Borrow? |
|---|---|---|
| Dark canvas by default, near-black, not grey | all eight | **Yes.** It is the register the audience expects from a developer tool. Keep a light theme, but stop defaulting to it. |
| Above the fold is a two-line headline, one sentence, one or two buttons. Nothing else. | all eight | **Yes.** Our fold has about 90 words. Theirs have 15 to 25. |
| Headline at 64–90px, heavy weight, tight leading | all eight | **Yes.** |
| Immediately below: one huge frame of the real product | Linear, Graphite, Cursor, Railway | **Yes**, and ours will be the actual app, not a picture of it. |
| One atmospheric visual as the memorable thing: a glowing form, light streaks, a rendered object | Graphite, Raycast, Resend, Railway | **Yes, one.** Ours is the stage light; see below. |
| Feature sections as a numbered horizontal strip, each tab a live UI panel | CodeRabbit | **Yes** for "how it works". Five states of the PR page, one strip. |
| Feature copy: a heading and one line, then the visual | all eight | **Yes.** Paragraphs go to the docs. |
| Serif display face for contrast | Railway, Resend | No. It is the current default for this look and we have code and UI to set. |
| A single acid accent on black | common elsewhere | No. Keep our blue; add warmth from light, not from a second hue. |
| Customer logos, "trusted by" rows | Graphite, CodeRabbit | Not yet. We have none, and a fake row is the one thing worse than an empty one. |
| Cookie banners, announcement bars | Railway, Graphite | No. |

## The identity: a lit stage in a dark house

The product is named for what it does: findings wait in the wings, you bring the ones you want
onto the stage, and nothing reaches the audience until you say so. The visual takes that
literally and it is the one idea nobody else in the comparison set has.

- **The house is dark.** Canvas `#0B0C10`, panels `#12141A`, raised `#181B23`. Text `#ECEEF3`.
  This is the default; the light theme stays as a choice.
- **The stage light is warm.** A soft directional glow, white-amber (`#FFE1B0` at low alpha
  falling to nothing), used in exactly three places: behind the hero product frame on the site,
  on a staged finding card in the app, and behind the post button when there is something to
  post. It is light, not a colour: it never tints text and never appears as a fill.
- **Blue stays the action colour.** `#7A83FF` on dark, `#3947FF` on light. Staged, primary,
  links. Severity words keep their semantic reds, ambers and greens. Nothing else is coloured.
- **Type.** Display: **Bricolage Grotesque** (variable, self-hosted via fontsource, exists at
  5.3.0). It has a voice at 80px and disappears politely at 14px. Body and UI: IBM Plex Sans
  stays, it is a good interface face and already self-hosted. Code: IBM Plex Mono stays. Two
  visible families, clearly distinct. Alternatives if Bricolage reads too playful in the build:
  Schibsted Grotesk, Instrument Sans, both also on fontsource.
- **Motion budget.** Larger than last time, still a budget. Site: the stage light breathes
  (slow, 8s, opacity only); the hero frame plays the real staging sequence once on load and on
  demand; the how-it-works strip cross-fades between states; hover lifts on the three big frames
  only. App: the staged edge lights up when a finding is ticked; the commit bar counter counts;
  the post button gains its glow when the count is above zero; the More sheet slides. Everything
  respects `prefers-reduced-motion`. No scroll-triggered fade-ups on every section. No parallax.
- **Density.** Interface type drops to a 13px base with a 14px body, panels tighten from 20px
  to 16px padding, row heights from 56px to 44px. Linear is the reference for how much a
  reviewer can see without scrolling.
- **Words.** Interface copy is cut to labels and actions. Every sentence of explanation under a
  heading moves to a `?` disclosure or to the docs. The guarantee sentence ("Nothing posts until
  you click") appears once, on the login screen, and nowhere else in the shell.

## The website

### Home, rebuilt around one live component

The new home is about 350 words. Seven sections become four.

1. **Fold.** Headline in two lines: "AI wrote the PR. / You still have to review it." One
   sentence: "Stage every finding privately. Post the ones you mean, as yourself." Two
   buttons: Install (copies the one-line command) and GitHub. That is all the text. Below it,
   full width, the **real PR page** running against the fixture, framed and lit, playing the
   staging sequence: findings appear, two get ticked, the bar counts to 2, the post button
   lights. Six seconds, once, then a replay control.
2. **How it works.** A numbered strip, five stops, CodeRabbit's pattern with our states:
   Requested (queue card arrives), Drafting (progress), Staged (findings with ticks), Posted
   (commit bar in its posted state), Approved. Each stop is the real component in that state, one
   line of copy under the number. Arrow keys and tabs move between them.
3. **The guarantees.** Five short lines with graphite dots, no paragraphs: your name on every
   comment; nothing automatic; comments not blocks; your Claude account; your box, your data.
   Each links to its docs page.
4. **Install.** The command, the three-step list, and the tiers as three quiet columns with one
   line each. The closing CTA merges into this.

Cut entirely from home: the six feature essays, the "Commonly, by construction" copy, the FAQ
tone. Their content survives in the docs, where a reader who wants it will look.

### Docs

Starlight stays. It inherits the dark canvas, the type, and the tokens. The sidebar and
"On this page" rail are restyled to match the app's sidebar so a reader moving between the docs
and the tool feels one product. Every doc page gets a real screenshot from the same capture
pipeline that feeds the README.

### The site is the tool

The hero and the strip do not imitate the app. They **are** the app. `dashboard-ui/src` becomes
importable by the site: the PR page's `FindingCard`, `CommitBar`, the status line, the queue row,
and the run progress render as React islands inside Astro (`@astrojs/react`, React deduped by
making the repo a pnpm workspace with `website` and `dashboard-ui` as members). They are fed
static fixture JSON, the same fixture the browser tests use. The tokens file is already shared
byte for byte; now the components are too. When the app changes, the site changes with it, and
the browser suite's screenshots and the site's frames come from the same code by construction.
The `demo` Compose profile stays as the "try it live" link for people who want to click.

## The tool

### Login

One card, five things: the mark, the name, one line ("Stage your review. Post it as
yourself."), a single large **Continue with GitHub**, and one quiet link, "Use a token instead".
The token form and the server-setup paragraph move behind that link. The environment variable
names leave the screen entirely and live in the install docs. The stage light sits behind the
card, breathing. This screen is the first thing every new user sees and it is currently the
least modern thing in the product.

### Shell

Dark by default. Sidebar narrows from 240px to 216px, items to 36px, section labels removed
(the two groups are separated by space alone). The brand mark is smaller. The "1 review running"
pill becomes a thin amber progress line at the very top of the viewport, like a download bar,
instead of a text row. The account card at the bottom becomes a single row: avatar, name, a dot
for Live, and the theme switch moves into the More menu. On the phone the tab bar stays; the
header loses its title text and keeps the mark and the search.

### Page by page

- **Queue.** Rows to 44px, two lines stay. The page title shrinks and the paste-a-PR field
  becomes the search field: one input, it does both. The explanatory sentence under the tabs
  goes. The empty state gets the stage light and a single line.
- **PR page.** Findings gain the lit edge when staged. The commit bar becomes the stage: a raised
  dark bar with the count in display type, the post button glowing only when the count is above
  zero. The assessment bullets get a tighter measure. The sections row (Full summary, What this
  PR does, Approve, Re-run) becomes a single segmented control. Everything else the last redesign
  fixed stays: the status line, the one Actions menu, the progress steps.
- **Skills.** Six tabs stay. The score cards become a compact table. The skill editor becomes a
  proper code surface with line numbers and the Team rules section highlighted.
- **Insights.** Tiles to a single dense row; charts lose their panel borders and sit on the
  canvas.
- **Learnings, QA, Integrations, Settings.** Density pass and prose removal only.
- **How it works.** Deleted from the app. It duplicates the site's strip, and with shared
  components the site's version is always current. The Help menu links to the site.

### What does not change

The five non-negotiable design properties in `openspec/config.yaml`. The focus ring, the 4.5:1
contrast test, every `aria-label`, the 44px phone targets, the labelled tab bar: the last
redesign's accessibility wins are the floor, not the ceiling. Dark canvas and glow will be
re-checked against contrast in `tokens.test.ts`, extended to the new values.

## How this is proven

- `tokens.test.ts` passes for both themes with the new values, including text over the glow's
  maximum alpha.
- The site's hero and strip render from `dashboard-ui/src` components; a grep for the old
  `mocks/*.astro` files returns nothing.
- Word count of the home page under 400, measured in the site verify script.
- Every existing browser test passes; the phone-width tests at 390 still hold with the denser
  shell.
- Lighthouse performance on the home page stays above 90 with the React islands hydrated; the
  hero is one island, everything else is static.
- Before and after screenshots in both themes at 1440 and 390 for every app page and the three
  site pages, reviewed side by side against the reference captures in `review.md`.
- The maintainer looks at the login screen and does not call it old.

## Phasing

Lanes as before, worktrees, append-only shared files, merged by the main session.

- **F0 — foundation** (one lane, first): tokens for the dark default and the stage light,
  Bricolage self-hosted, density scale, the workspace so the site can import the app. Gates and
  contrast test updated. Everything else builds on this.
- **W — website** (one lane): the four-section home with the live hero and the strip, docs
  restyle, mocks deleted, verify script updated.
- **A1 — login and shell** (one lane): login, sidebar, running bar, account row, phone header.
- **A2 — PR page and queue** (one lane): the lit stage, the segmented sections, row density.
- **A3 — the rest** (one lane): Skills, Insights, Learnings, QA, Integrations, Settings, and the
  removal of How it works.
- **P — proof**: screenshots, review, memory.

## Decisions for the maintainer

1. **Dark by default.** The plan assumes yes for both site and tool, light kept as a switch.
2. **Display face.** Bricolage Grotesque proposed; Schibsted Grotesk or Instrument Sans if it
   reads too playful in the first build. I will build the fold in all three and show them.
3. **How much motion.** The budget above is my recommendation. "More" is possible; "every
   section fades up on scroll" is the one thing I will push back on, because it is the tell.
4. **Remove How it works from the app.** Proposed yes, since the site's strip is the same
   components and always current.
