# landing-v2 — the homepage that sells (binding for lane L)

Maintainer, 10/05/26: "the first page is boring; it doesn't convey why this is better or what
the features are. Make it perfect — better plan, better UI."

## Diagnosis of the current page (https://reviewstage.dev, 4,409px tall, 208 words)

- The same PR mock appears three times (hero, How it works, Install). The page shows one thing.
- No "why": nothing contrasts ReviewStage with the review bots people already know and mute.
- None of the shipped features are visible: the desktop app in one command, the phone with QR
  pairing, push and swipe-to-keep, the learning loop, effort and model per run, independent
  reviewers, the team install, the enforced gate.
- "What holds, always" is a list of icons with short lines — the strongest argument on the
  page is the weakest-looking section.
- The footer still says "Beta software" (1.0 shipped).

## The page, top to bottom

Audience: engineers who review a lot of PRs (increasingly agent-written) and team leads who
have tried an AI review bot. The page must answer in this order: what is it → why is it
different → what does it do → can I trust it → how do I start.

1. **Hero.** Keep the two-line headline ("AI wrote the PR. / You still have to review it.").
   One-sentence subhead: what it does and the promise ("Claude drafts the review from the real
   diff on your own plan. You keep what's worth saying and post it as yourself — nothing posts
   until you click."). Primary action: the `npx reviewstage` command as a copyable pill (the
   command IS the button). Secondary: **Watch the 70-second demo** (opens a lightbox player of
   `public/videos/reviewstage-demo.mp4`, `preload="none"`; a `DEMO_YOUTUBE_ID` constant in
   `src/content/site-links.ts` switches it to a YouTube embed once the maintainer uploads), and
   **GitHub**. Under the actions, three quiet facts in one row: Open source · MIT · Runs on your
   Claude plan · Mac & Linux + your phone. Below: the product, playing — `review.mp4` autoplay,
   muted, loop, playsinline, in the window frame the site already uses (poster = review.jpg),
   replacing the static HeroStage mock on the fold. Reserve its height (no CLS).
2. **The contrast — "A reviewer's assistant, not a review bot."** Two columns, same height:
   left **Review bots** (comments on every PR under a bot account · gets muted in weeks · can
   approve, and nobody owns it · bills per review), right **ReviewStage** (drafts privately ·
   you post one review, as you · approve is always your click · runs on the Claude plan you
   already pay for). Each side has a small visual: left a noisy GitHub thread of 6 bot comments
   (greyed), right a single clean review comment with a human avatar and "Wimukti reviewed".
   Built as static HTML/CSS mocks in the site's design language (not screenshots).
3. **How it works — four steps, four different visuals.** Requested (a queue row + a lock-screen
   notification), Drafted (the run's phase list ticking), Staged (two findings, one kept one
   dropped), Posted (the GitHub review under your name). Numbered (it is a real sequence).
   Horizontal scroll-snap on phones. Reuse `HowItWorks`/`StageScene` only if it renders a
   different moment per step; otherwise replace with static mocks — never the same mock again.
4. **Features — a bento grid (6 tiles, two sizes), each with a real visual:**
   - *One command, a real app* — terminal typing `npx reviewstage` → "ReviewStage is running";
     menu-bar, Applications, updates itself.
   - *Your phone, signed in by a QR code* — `phone.mp4` in a phone frame (swipe to keep, Post),
     push notifications. Large tile.
   - *It learns your team* — a "Suggested rule" card ("Dropped 3 times: 'prefer const' → Don't
     raise again") with Accept / Dismiss.
   - *Effort and model per run* — Quick / Standard / Deep chips + model, tokens per run.
   - *Two reviewers, independent runs* — two finding cards with a "confirmed by 2" badge.
   - *For a team* — one server, everyone as themselves, Slack / Discord / webhook cards, many
     repositories, Insights keep-rate sparkline.
5. **The gate — "Enforced, not promised."** Dark band. Three mechanisms side by side, each with
   a mono snippet: credentials stripped from the agent's environment (`GH_TOKEN` → unset), a
   tool deny list (`--disallowedTools …`), a before/after fingerprint of the PR's reviews and
   comments that fails the run if anything landed. One line: "A prompt-injected diff cannot post
   under your name." Link: Read the security model.
6. **Compare** — a compact table, three columns: ReviewStage · Auto-posting review bots ·
   Reviewing alone. Rows: who posts · whose name · approves on its own · learns what you drop ·
   cost · where your code and review data live. Category names only; name no competitor.
7. **Start** — two tabs or two cards: *Just me* (`npx reviewstage`, three steps, then scan the QR
   for your phone; `wizard.mp4` small) and *My team* (`docker compose up -d`, one server,
   everyone signs in as themselves). Link to Install guide.
8. **FAQ** — 6 questions as an accessible disclosure list (details/summary): What does it cost?
   What leaves my machine? Can it approve on its own? Does it work with my repos (GitHub)?
   Windows? How is this different from Claude Code Review / CodeRabbit / Copilot review? Answers
   ≤ 2 sentences, from `docs/launch/README.md` "One sentence each".
9. **Final call** — the headline's second line as a closing statement, the command pill, and
   GitHub (with "Star on GitHub"). Then the footer, with "Beta software" removed.

## Design rules

- The site's existing system only: Tailwind 4 + tokens shared with the app (`tokens.css`),
  Geist / Geist Mono, dark default with light opt-in, the stage-light glow used in at most two
  places (hero, gate band). No new colours; the blue is the only accent; severity colours only
  inside product mocks.
- Typography carries it: section titles are statements, not labels ("A reviewer's assistant,
  not a review bot", not "Comparison"). No eyebrow labels above headings, no all-caps, no
  emoji, no "→" appended to link text.
- Real product, real words: mocks use the fixture's real findings (acme/widgets #38849 etc.).
  Never invent users, stars, logos, testimonials or numbers.
- Motion: one orchestrated moment (the hero video). Other sections are still unless the reader
  acts (tabs, lightbox, disclosure). `prefers-reduced-motion`: videos show their poster.
- Phone: everything single-column at 390, tap targets ≥ 44px, no sideways scroll (measure with
  `visualViewport.width`), hero video above the fold on a 390×844 screen after the actions.
- Performance: Lighthouse performance on `/` ≥ 95 on the verify harness; videos `preload` none
  except the hero (metadata + poster), JPEG posters, no CLS (reserve heights).
- SEO/share: title "ReviewStage — AI drafts your PR review, you post it as yourself",
  meta description ≤ 155 chars, OG/Twitter image = the new social preview
  (`~/Desktop/reviewstage-launch/github-social-preview.png` copied to `public/og.png`, 1280×640).
- ≤ 900 words on the page, every section starting with its point.

## Gates

`pnpm build && pnpm check && pnpm verify` in website/ (update verify-site.mjs for the new
sections: assert the contrast, features, gate, compare, FAQ headings exist; no sideways scroll at
390 in both themes; Lighthouse ≥ 95). Screenshots at 1440 and 390, dark and light, of the whole
page and of each section into `openspec/changes/landing-v2/after/`; look at every one, compare
with `before-*.png` (capture the live page first), fix what looks off.
