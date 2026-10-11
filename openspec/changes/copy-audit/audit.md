# Copy audit — "not another review bot"

Audited 10/11/26 against the eight rules in the maintainer's brief. Source of truth was the
built site (`website/dist`, 28 pages: title, meta description, h1–h3, paragraphs, list items,
table cells, button labels, alt text), `README.md`, `desktop/README.md` (the npm README),
`docs/INSTALL-DESKTOP.md`, `desktop/package.json` and the GitHub About text (read-only).

Line numbers are in the source file that renders the text, before the fix.

## Violations (18) and fixes

| # | File:line | Offending text | Rule | Replacement |
|---|---|---|---|---|
| 1 | website/src/components/home/Compare.astro:16 | "The speed of a bot, the judgement of a reviewer." | 6 | "Where the draft goes before anyone sees it." |
| 2 | website/src/components/home/Compare.astro:31 | "…and the review you post goes to GitHub. Nothing else leaves." | 4 | "…goes to GitHub. Full list: *What leaves my machine?* below." |
| 3 | website/src/components/home/Faq.astro:8 | "No analytics, no telemetry, nothing to us." | 4 | "Usage counters stay on your disk unless you consent and an endpoint is configured; none ships." |
| 4 | website/src/components/home/Faq.astro:12 | "They deliver AI-written feedback straight into the pull request, under the tool's identity, on whatever trigger you configure. This keeps the draft private first: you decide…" | 3 | The preferred comparison wording, verbatim. |
| 5 | website/src/components/home/Features.astro:60-61 | "Effort and model per run" / "…Tokens and model shown on every run." (no 1.2.0 features anywhere on the landing page) | 7 | "Effort per run, evidence per finding" / "…Each finding says where to look and what to check; evidence and disproof checks earn its Checked, Likely or Maybe badge." |
| 6 | website/src/components/home/Steps.astro:61 | "Findings wait privately. Keep what's worth your name…" (reading guide absent) | 7 | "Findings wait privately under a reading guide. Keep what's worth your name…" |
| 7 | website/src/components/examples/Disclosure.astro:9 (renders on /examples/, 3 example pages and /try/) | "…and nothing leaves this page." | 4 | "Nothing on this page talks to GitHub or Claude: no review runs, and nothing posts." |
| 8 | website/src/pages/examples/index.astro:20 | Lede lacks the category sentence (entry page) | 1 | Lede now opens "ReviewStage is the human review layer for AI-written pull requests: every review Claude drafts goes through a person before it posts." |
| 9 | website/src/pages/try/index.astro:13 | meta: "Nothing is sent anywhere;" | 4 | "The page makes no network request;" |
| 10 | website/src/pages/try/index.astro:21 | Lede lacks the category sentence (entry page) | 1 | Lede now opens with the category sentence. |
| 11 | website/src/content/docs/start/index.mdx:3 | meta: "ReviewStage drafts your PR review from the real diff and stages it. You post it as yourself." | 1 | The full category sentence (categorySentence from brand.ts). |
| 12 | website/src/content/docs/start/index.mdx:10 | Lede lacks the category sentence; "ReviewStage drafts" | 1 | Opens with the category sentence; "Claude drafts the review from the real diff and stages it for you." |
| 13 | website/src/content/docs/start/index.mdx:36 | Five properties only implied; "never requests changes" contradicts the Security page (a reviewer may tick Request changes on the post form) | 5 | Explicit five-fact list; "never requests changes or approves on its own". Also added one line on the 1.2.0 reading guide, where/what to check and the badge to "What you get" (rule 7). |
| 14 | website/src/content/docs/start/install.mdx:11 | Entry page without the category sentence | 1 | One intro sentence above "Desktop app (one person)" carrying it. |
| 15 | website/src/content/docs/start/install.mdx:27 and docs/INSTALL-DESKTOP.md:45 | "share anonymous usage counters" | 4 | "share usage counters (counts only; no names, repositories, paths or text)" |
| 16 | website/src/content/docs/operations/faq.md:54 | "so today nothing leaves the box whatever you answer" | 4 | "so today no counter is sent, whatever you answer" |
| 17 | website/src/content/docs/security/telemetry.md:3, :107, :112 | "nothing leaves the box"; "the body is anonymous"; the test "proves 'nothing leaves'" | 4 | "no counter is sent"; "the body carries no name, repository, path or text; the connection is not anonymous"; "proves no request goes to any other origin" |
| 18 | website/src/content/docs/guides/team-workflow.mdx:52, README.md:93 | "never approves, never requests changes, and never blocks a merge" (see #13) | 5 | "never approves or requests changes on its own, and never blocks a merge" |
| 19 | README.md:37-39 | Category sentence present, five properties scattered through prose; no 1.2.0 features in Highlights | 5, 7 | Five-fact list after the category paragraph; a "Findings you can check" Highlights bullet. |
| 20 | README.md:91 | Competitor section ("Why not an auto-review bot?") without the preferred comparison wording | 3 | Preferred wording added as the section's first paragraph. |
| 21 | desktop/README.md:3 | npm README (an entry page) lacks the category sentence | 1 | Added under the tagline. |
| 22 | desktop/README.md:20 | "Everything stays on your machine." | 4 | "The server and its state stay on your machine; the diff goes to Anthropic through Claude Code on your account, and what you post goes to GitHub with your token." |

Count by rule: rule 1 — 7 (#8, 10, 11, 12, 14, 21 + install meta covered by #14); rule 3 — 2 (#4, 20); rule 4 — 9 (#2, 3, 7, 9, 15×2, 16, 17, 22); rule 5 — 3 (#13, 18, 19); rule 6 — 1 (#1); rule 7 — 3 (#5, 6, 19); rule 2 — 0; rule 8 — 0.

## Passes (what was already fine)

- Rule 1: home `<title>`, meta description, JSON-LD and the single `<h1>` carry the category; `desktop/package.json` description and the GitHub About text carry the full sentence. The campaign line "AI wrote the PR. You still have to review it." opens the hero and closes the page.
- Rule 2: no page, section or meta leads with the AI as the reviewing subject. Every verb on Claude/the agent is "drafts", "reads", "proposes", "produces a file". The Steps mock's phase label "Reviewing the diff" is the product's own progress string and is `aria-hidden`; left as is.
- Rule 3: the home Contrast section and the Compare table name no competitor and already frame the difference as where the draft goes first.
- Rule 4: the home FAQ "What leaves my machine?" already enumerated Anthropic, GitHub, npm, Apple/Google push and Cloudflare with their conditions; only its last sentence was universal. Security, Telemetry and FAQ pages enumerate destinations and the four telemetry gates.
- Rule 5: the Gate section states the no-credentials / tool-deny / fingerprint mechanism with the real script lines; Contrast lists private draft, your post, your approval; Steps 3 and 4 say who chooses and under whose name.
- Rule 6: no "faster", "10x" or "saves hours" claims anywhere. Durations quoted (2–5, 3–10, 8–25 minutes) are measured medians the form itself shows.
- Rule 7: `guides/reviewing` already documents the reading guide, the six finding rows, the evidence check, the second (disproof) pass and the Checked / Likely / Maybe rule in human-first terms.
- Alt text and video aria-labels: all describe the reviewer keeping, editing and posting; none frame the AI as the poster.
- Docs titles are each page's h1 plus the site suffix (verify-site asserts it; unchanged).

## Deliberately not changed

- `CHANGELOG.md` 1.1.0 entry says "anonymous usage counters": a dated release note, not current copy; out of the brief's scope.
- The Steps mock phase label "Reviewing the diff" and the Features mock strings: product UI reproduced in `aria-hidden` visuals.
- `website/src/components/home/Faq.astro` question "How is this different from Claude Code Review, CodeRabbit or Copilot review?": the question names competitors; the answer now uses the preferred wording.
- Security page wording "a reviewer can tick Request changes on the post form" — this is the accurate statement (bin/server.py `request_changes`); the "never requests changes" lines elsewhere were corrected to match it.
- `website/scripts/verify-site.mjs`: no expectation needed changing; the category check, nine section ids, six tiles, six FAQ rows and the 900-word ceiling still hold.
