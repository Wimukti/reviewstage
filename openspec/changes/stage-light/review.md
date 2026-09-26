# Stage light — side-by-side review

Reviewed 09/26/26. Before is `../one-identity-redesign/after/`; after is this folder, 72 shots
regenerated from one merged build. The reference set the plan was drawn from (Linear, Graphite,
Railway, Raycast, Resend, CodeRabbit, Cursor, Warp) was captured live on 09/24/26 and kept out
of the repository, since they are other people's screens.

## The verdict that started this

> the home page is too much text, people will never read all of them … the tool looks very old,
> from the login screen to every other logged in screen

Both are addressed, and both are now measured rather than argued.

| | Before | After |
|---|---|---|
| Home page words | ~2,400 | **207** (asserted in `verify-site.mjs`, budget 400) |
| Home sections | 7 feature essays + tiers + steps + CTA | 4 |
| Above the fold | headline, sub-headline, 2 paragraphs, 2 buttons, install command, trust bar | headline, one sentence, 2 buttons |
| Default theme | light grey | dark |
| Login screen | 3 paragraphs, 4 environment variable names | 5 elements |
| Site's "how it works" | hand-built Astro mocks | the app's own React components |
| Interface base size | 14px | 13px, rows 56px → 44px |

## What changed

**The home page.** The fold is a two-line Bricolage headline with the second line in blue, one
sentence, and two buttons, over a dark canvas. Under it, full width, the real PR page runs
inside a lit frame labelled "private stage", plays the staging sequence once, and offers Replay.
Then a five-stop keyboard-operable strip (Requested, Drafting, Staged, Posted, Approved), five
one-line guarantees, and install. The six feature essays are gone; their substance lives in the
docs, where a reader who wants it will look.

**The site is the tool.** The hero and the strip are not pictures of the product and not
imitations of it. They are `dashboard-ui/src` components rendered as React islands inside open
shadow roots, with the app's own stylesheet inlined and its tokens inherited. The verifier
asserts, per theme and per width, that the hero's shadow root contains a real
`.finding.is-staged`. Drift between the site and the product is now impossible by construction,
which is the thing that failed within a week last time.

**The login screen.** The mark, the name in display type, one sentence, **Continue with GitHub**,
and "Use a token instead". The token form and every environment variable name are behind that
link or in the docs. The stage light breathes behind the card.

**The shell.** Dark, 216px sidebar, 36px items, no group labels, a one-row account card, and the
theme switch in More. The "1 review running" pill is now a 2px amber sweep at the top of the
viewport.

**The PR page is the stage.** A staged finding lights at its head. The commit bar is raised with
the count in display type, rolling when it changes, and the post button glows only when
something is staged. The four section buttons became one segmented control.

**Everywhere else.** Skills scores are a compact table and its editors a code surface; Insights
tiles sit in dense rows on the canvas; the explanatory paragraph under every page title is gone,
replaced where genuinely needed by a single `?` disclosure. The app's How it works page is
deleted: the site's strip is the same components and cannot go stale.

## Deliberately kept

- Every accessibility win of the previous pass: the focus ring, 4.5:1 in both themes, labels on
  icon-only controls, 44px phone targets, the labelled bottom tab bar.
- The five non-negotiable design properties in `openspec/config.yaml`. Nothing here touches the
  review, posting or approval paths.
- Light theme, as an explicit choice, and System.
- The blue as the only action colour. The stage light is light, never a fill and never a text
  colour, and appears in exactly three places.

## Deviations from the contract

1. `--light` alpha is .17, not .18. At .18 graphite over a lit panel measures 4.40:1; the
   contract requires 4.5. Recorded in `tokens.css`.
2. `--t-12` is .8572rem, not .8571rem, so 12px is not 11.9994px.
3. Lane stylesheets are imported at the top of `styles.css` inside cascade layers rather than
   appended at the end: a trailing `@import` is invalid CSS. The layers also mean a lane's rule
   beats base without `!important`.
4. The guarantee sentence stays on the login card, per the words rule, rather than being cut to
   exactly one line of copy.
5. Lighthouse is not yet wired into the verifier. Everything else in §9 is.

## Proof on main

| Check | Result |
|---|---|
| `python3 -m unittest discover -s bin` | OK |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | clean / pass / 0 warnings |
| `pnpm test:browser` | **192 passed** |
| `website pnpm build` / `check` / `verify` | 20 pages / 0 hints / all checks passed |
| `docker build .` | succeeds |
| Home page word count | 207 |
| Hero island hydrated, staged finding in its shadow root | yes, both themes, both widths |
| Strip: five stops, arrow keys move selection | yes |
| `--light` outside the three §4 families | none |
| `cmp` on the two `tokens.css` | identical |
| `website/src/components/marketing/mocks/` | gone |
| `bin/rs_howimg.py`, `dashboard-ui/src/HowItWorks.tsx` | gone |

One browser test timed out at 30s under parallel load and passed in 270ms in isolation; a second
full run was clean at 192. That is machine contention, not a defect.
