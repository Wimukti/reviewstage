# Tasks

Lanes run in worktrees off `main`, never merge or push; the main session merges. Every task
names its files (`openspec/config.yaml`). Tick with the commit sha.

## F0 — foundation (first, alone)
- [x] `tokens.css` (both copies, byte-identical): dark `:root`, light `[data-theme="light"]`,
      `[data-theme="system"]` media block, `--light*`, `--display`, `--t-12/24/32/display`,
      `--row/--pad/--ctl/--side`, `--dur-slow`. — 22b10d1, 52c23ee (`--light` .17 not .18 and
      `--t-12` .8572rem, both recorded in the file)
- [x] Theme semantics: default Dark when nothing stored; `system` stamped as an attribute.
      `dashboard-ui/src/theme.ts`, `index_html()` in `bin/server.py`, `website/src/scripts/theme.ts`. — eb6708a
      (also `components/starlight/ThemeProvider.astro` and the layout's inline bootstrap)
- [x] Bricolage Grotesque self-hosted in both (`main.tsx`, `website/src/styles/app.css`);
      `--display` applied to app `h1`, login name, empty-state titles. — baf1080
- [x] `styles.css` base pass: density scale from §3, prose removal hooks (`.pagehead p` gone,
      `.about` icon button + explainbox), page `h1` at `--t-24`; `@import` of the three empty lane
      files at the end. — baf1080 (imports sit at the top in cascade layers — a trailing
      `@import` is invalid CSS; see the commit)
- [x] `tokens.test.ts` extended for the new values and the light-blended pairs. — 22b10d1
- [x] Site can render app components: `@astrojs/react`, alias, pinned React, `StageFrame.tsx`
      with shadow root and inlined app CSS, `dashboard-ui/src/stage/{StageScene,StageQueueCard,StageProgress}.tsx`
      + `fixture.json` + the script that writes it; one scratch page proving a `.finding.is-staged`
      renders inside the shadow root. — 144a8d9, d35d06b
- [x] Font comparison sheet: the fold headline in Bricolage, Schibsted, Instrument →
      `after/fonts/{bricolage,schibsted,instrument}.png`. — d35d06b
- [x] Gates: typecheck, unit, build, browser, python, website build/check/verify, Docker build.
      — run on 52c23ee (09/24/26): tsc clean · 70 unit · bundle builds · browser 157/158 then the
      one failure fixed and re-run green · python 489 · site 21 pages, check 0/0, verify 51 ok ·
      `docker build` exit 0

## W — website
- [ ] Home rebuilt to the four sections in proposal §"Home": fold (≤ 25 words), strip (five
      states, keyboard-navigable, `role=tablist`), guarantees (five lines), install + tiers.
- [ ] Hero = `StageScene state="staged" play` inside `StageFrame`, lit by §4.1, replay control.
- [ ] Strip = `StageScene` / `StageQueueCard` / `StageProgress` per stop.
- [ ] Delete `website/src/components/marketing/mocks/` and every `Feature` essay; move their
      substance into the relevant docs pages where it is not already there.
- [ ] Docs restyle: Starlight on the dark tokens, sidebar and rail matching the app shell, real
      screenshots on every guide page from `e2e/site-shots.ts` (extend the script).
- [ ] `verify-site.mjs`: word count < 400, hero hydration check, `--light` grep, Lighthouse ≥ 90.
- [ ] `after/site/*` screenshots.

## A1 — login and shell
- [x] `Login.tsx`: mark, name in display type, one line, **Continue with GitHub**, "Use a token
      instead" disclosure holding the token form; server-setup paragraph removed (docs link only);
      `.stage-login::before` light. — 00d234b (shell.css lifts the light's geometry so its top
      edge fades behind a free-standing card; the token stays in styles.css)
- [x] `Sidebar.tsx`: `--side`, 36px items, no group labels, smaller mark, account row (avatar ·
      name · Live dot), theme switch moved into More; phone header = mark + search only. — 8e204e4
      (desktop "More" is a `⋯` button at the end of the account row, `data-testid="account-more"`;
      Help stays its own menu)
- [x] Running indicator: thin amber sweep bar at the top of the viewport replaces the pill
      (`RunningLink` rendering), phone `runstrip` becomes the same bar. — 8e204e4 (`.runbar`,
      `data-testid="running-bar"`, rendered once by `App`)
- [x] `App.tsx`: remove the `/how` route; Help menu links to the site's strip. — 8e204e4
- [x] `CommandPalette.tsx`, `Tour.tsx`: density and type only. — 00d234b (rules in shell.css;
      `Tour.tsx` needed no source change), 8e204e4 (palette drops the dead How entry for Settings)
- [x] `e2e/shell.spec.ts`: login states, theme default dark, sidebar geometry, running bar,
      phone header, More sheet holds the theme switch. — 9b8788b (+ `after/a1/*` screenshots and
      `e2e/shots-shell.ts`). Gates on 9b8788b (09/24/26): tsc clean · 70 unit · bundle builds ·
      browser 163/166 then the three stale selectors fixed and re-run green · python 489 ·
      `--light` grep on shell.css empty

## A2 — PR page and queue
- [ ] `PrPage.tsx`: `.finding.is-staged` head light (§4.2); commit bar as the stage: raised,
      count in `--display`, rolling number, `.has-staged` glow on the post button (§4.3); sections
      row → one `.seg` control; assessment measure 64ch; prose under the title removed.
- [ ] Extract the presentational pieces `StageScene` composes so the site and the app share them
      (no visual change from the extraction itself).
- [ ] `Queue.tsx`: `--row`, single search-or-paste field, explanatory sentence removed, empty
      state with light + one line.
- [ ] `StackPage.tsx`: density pass.
- [ ] `e2e/review.spec.ts`: light appears on tick and leaves on untick, glow only when count > 0,
      count rolls, segmented sections, reduced-motion path.

## A3 — the rest
- [ ] `Skills.tsx`: score cards → compact table; editor with line numbers and a highlighted Team
      rules section; density.
- [ ] `Rollup.tsx`: single dense tile row; charts on the canvas without panel borders.
- [ ] `Learnings.tsx`, `Qa.tsx`, `Integrations.tsx`, `Settings.tsx`: density and prose removal.
- [ ] Delete `HowItWorks.tsx`, `bin/rs_howimg.py`, its routes and tests; docs link where the
      page was referenced.
- [ ] `e2e/pages.spec.ts`: each page has no `.pagehead p`, `/how` is a 404 in the SPA, Skills
      table renders, Insights tiles in one row at 1440.

## P — proof (main session)
- [ ] Merge F0 → launch W, A1, A2, A3 → merge in order A1, A2, A3, W.
- [ ] All gates from design §9; `after/` complete; `review.md` side by side with
      `../one-identity-redesign/after/` and the reference captures.
- [ ] Tag, push, rebuild the maintainer's box, run the python suite inside the image.
