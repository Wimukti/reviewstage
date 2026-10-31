# Copy audit: "not another review bot"

Audited 10/11/26 against the eight rules in the maintainer's brief. Source of truth was the
built site (`website/dist`, 28 pages: title, meta description, h1 to h3, paragraphs, list items,
table cells, button labels, alt text), `README.md`, `desktop/README.md` (the npm README),
`docs/INSTALL-DESKTOP.md`, `desktop/package.json` and the GitHub About text (read-only).

Line numbers are in the source file that renders the text, before the fix. Items 1 to 22 are
the first pass; the two sections after the tally record the external review of the same day.

## Fix items and their rules

| # | File:line | Offending text | Rule | Replacement |
|---|---|---|---|---|
| 1 | website/src/components/home/Compare.astro:16 | "The speed of a bot, the judgement of a reviewer." | 6 | "A private draft. Your decision to publish." (revised, see below) |
| 2 | website/src/components/home/Compare.astro:31 | "…and the review you post goes to GitHub. Nothing else leaves." | 4 | "…goes to GitHub. Full list: *What leaves my machine?* below." |
| 3 | website/src/components/home/Faq.astro:8 | "No analytics, no telemetry, nothing to us." | 4 | "Usage counts stay on your machine unless you opt in and a reporting endpoint is configured. No endpoint is configured by default." (revised) |
| 4 | website/src/components/home/Faq.astro:12 | "They deliver AI-written feedback straight into the pull request, under the tool's identity, on whatever trigger you configure. This keeps the draft private first: you decide…" | 3 | The preferred comparison wording, verbatim. |
| 5 | website/src/components/home/Features.astro:60-61 | "Effort and model per run" / "…Tokens and model shown on every run." (no 1.2.0 features anywhere on the landing page) | 7 | "Findings you can check." / "…Each finding shows where to look, what to check, and a Checked, Likely, or Maybe label to guide your verification." (revised) |
| 6 | website/src/components/home/Steps.astro:61 | "Findings wait privately. Keep what's worth your name…" (reading guide absent) | 7 | "Start with a reading guide, then check each finding against the code. Keep what's worth your name, edit it, drop the rest." (revised) |
| 7 | website/src/components/examples/Disclosure.astro:9 (renders on /examples/, 3 example pages and /try/) | "…and nothing leaves this page." | 4 | "Nothing on this page talks to GitHub or Claude: no review runs, and nothing posts." |
| 8 | website/src/pages/examples/index.astro:20 | Lede lacks the category sentence (entry page) | 1 | Lede opens with the category sentence, then "Claude drafts privately. You decide what to edit, keep, and publish under your name." (revised) |
| 9 | website/src/pages/try/index.astro:13 | meta: "Nothing is sent anywhere;" | 4 | "This demo does not run Claude or post to GitHub." (revised) |
| 10 | website/src/pages/try/index.astro:21 | Lede lacks the category sentence (entry page) | 1 | Lede now opens with the category sentence. |
| 11 | website/src/content/docs/start/index.mdx:3 | meta: "ReviewStage drafts your PR review from the real diff and stages it. You post it as yourself." | 1 | The full category sentence (categorySentence from brand.ts). |
| 12 | website/src/content/docs/start/index.mdx:10 | Lede lacks the category sentence; "ReviewStage drafts" | 1 | Opens with the category sentence; "Claude drafts the review from the real diff and stages it for you." |
| 13 | website/src/content/docs/start/index.mdx:36 | Five properties only implied; "never requests changes" contradicts the Security page (a reviewer may tick Request changes on the post form) | 5, 7 | Explicit five-fact list; "never requests changes or approves on its own". One line on the 1.2.0 reading guide, where/what to check and the badge added to "What you get". |
| 14 | website/src/content/docs/start/install.mdx:11 | Entry page without the category sentence | 1 | One intro sentence above "Desktop app (one person)" carrying it. |
| 15 | website/src/content/docs/start/install.mdx:27 and docs/INSTALL-DESKTOP.md:45 | "share anonymous usage counters" | 4 | "optional usage counts: no names, repositories, paths, or text" (revised) |
| 16 | website/src/content/docs/operations/faq.md:54 | "so today nothing leaves the box whatever you answer" | 4 | "so today no counter is sent, whatever you answer" |
| 17 | website/src/content/docs/security/telemetry.md:3, :107, :112 | "nothing leaves the box"; "the body is anonymous"; the test "proves 'nothing leaves'" | 4 | "no counter is sent"; "the body carries no name, repository, path or text; the connection is not anonymous"; "proves no request goes to any other origin" |
| 18 | website/src/content/docs/guides/team-workflow.mdx:52, README.md:93 | "never approves, never requests changes, and never blocks a merge" (see #13) | 5 | "never approves or requests changes on its own, and never blocks a merge" |
| 19 | README.md:37-39 | Category sentence present, five properties scattered through prose; no 1.2.0 features in Highlights | 5, 7 | Five-fact list after the category paragraph; a "Findings you can check" Highlights bullet. |
| 20 | README.md:91 | Competitor section ("Why not an auto-review bot?") without the preferred comparison wording | 3 | Preferred wording added as the section's first paragraph. |
| 21 | desktop/README.md:3 | npm README (an entry page) lacks the category sentence | 1 | Added under the tagline. |
| 22 | desktop/README.md:20 | "Everything stays on your machine." | 4 | "The server and its state stay on your machine; the diff goes to Anthropic through Claude Code on your account, and what you post goes to GitHub with your token." |

We recorded 22 fix items. Some cover multiple locations or address more than one rule, so
rule-level totals are not additive.

Rules per item: #1 rule 6; #2 rule 4; #3 rule 4; #4 rule 3; #5 rule 7; #6 rule 7; #7 rule 4;
#8 rule 1; #9 rule 4; #10 rule 1; #11 rule 1; #12 rule 1; #13 rules 5 and 7; #14 rule 1;
#15 rule 4 (two locations); #16 rule 4; #17 rule 4 (three locations); #18 rule 5 (two
locations); #19 rules 5 and 7; #20 rule 3; #21 rule 1; #22 rule 4.

Items touching each rule: rule 1: #8, 10, 11, 12, 14, 21 (six items). Rule 3: #4, 20. Rule 4:
#2, 3, 7, 9, 15, 16, 17, 22. Rule 5: #13, 18, 19. Rule 6: #1. Rule 7: #5, 6, 13, 19. Rules 2
and 8: no item.

## Passes (what was already fine)

- Rule 1: home `<title>`, meta description, JSON-LD and the single `<h1>` carry the category; `desktop/package.json` description and the GitHub About text carry the full sentence. The campaign line "AI wrote the PR. You still have to review it." opens the hero and closes the page.
- Rule 2: no page, section or meta leads with the AI as the reviewing subject. Every verb on Claude/the agent is "drafts", "reads", "proposes", "produces a file". The one exception recorded in the first pass, the Steps mock's phase label "Reviewing the diff", is resolved (revision 5 below).
- Rule 3: the home Contrast section and the Compare table name no competitor and already frame the difference as where the draft goes first.
- Rule 4: the home FAQ "What leaves my machine?" already enumerated Anthropic, GitHub, npm, Apple/Google push and Cloudflare with their conditions; only its last sentence was universal. Security, Telemetry and FAQ pages enumerate destinations and the four telemetry gates.
- Rule 5: the Gate section states the no-credentials / tool-deny / fingerprint mechanism with the real script lines; Contrast lists private draft, your post, your approval; Steps 3 and 4 say who chooses and under whose name. The five properties are now also stated verbatim in Gate (revision 3).
- Rule 6: no "faster", "10x" or "saves hours" claims anywhere. The first pass called the quoted durations "measured medians"; that was wrong (see the evidence trail: the labels are static estimates until an install has three runs at a level), and the two pages that quoted them are reworded.
- Rule 7: `guides/reviewing` already documents the reading guide, the six finding rows, the evidence check, the second (disproof) pass and the Checked / Likely / Maybe rule in human-first terms.
- Alt text and video aria-labels: all describe the reviewer keeping, editing and posting; none frame the AI as the poster.
- Docs titles are each page's h1 plus the site suffix (verify-site asserts it; unchanged).

## Deliberately not changed

- `CHANGELOG.md` 1.1.0 entry says "anonymous usage counters": a dated release note, not current copy; out of the brief's scope.
- The Features mock strings: product UI reproduced in `aria-hidden` visuals.
- `website/src/components/home/Faq.astro` question "How is this different from Claude Code Review, CodeRabbit or Copilot review?": the question names competitors; the answer uses the preferred wording.
- Security page wording "a reviewer can tick Request changes on the post form": this is the accurate statement (bin/server.py `request_changes`); the "never requests changes" lines elsewhere were corrected to match it.
- `security/telemetry.md` keeps the connection-level qualification ("the connection is not anonymous"); the short label elsewhere does not repeat it.
- `website/scripts/verify-site.mjs`: no expectation on changed text needed changing; the category check, nine section ids, six tiles, six FAQ rows and the 900-word ceiling still hold. It gained one new check (see No dashes).

## Revisions after external review (10/11/26)

1. Compare heading. Before: "Where the draft goes before anyone sees it." After: "A private draft. Your decision to publish." (`website/src/components/home/Compare.astro`). The approval line in Gate makes clear that publishing a review is not approving the PR.
2. Telemetry wording. Verified first that the shipped default has no endpoint: `bin/rs_telemetry.py` reads the endpoint only from `RS_TELEMETRY_ENDPOINT` / `KEEPDROP_TELEMETRY_ENDPOINT` (`ENDPOINT_VARS`, line 50; `endpoint()`, line 392, returns "" unless the value starts with `https://`); nothing under `desktop/`, `bin/rs_settings.py` or any shipped config sets it, and the module docstring names `no_endpoint` as the shipped default. Short label, before: "share usage counters (counts only; no names, repositories, paths or text)" and the dashboard's "share anonymous product counters?" / "Share anonymous product events". After: "Optional usage counts: no names, repositories, paths, or text." (install.mdx, INSTALL-DESKTOP.md) and "share optional usage counts?" / "Share usage counts" (`dashboard-ui/src/Privacy.tsx`; Welcome.tsx carried no such wording). FAQ clause, before: "Usage counters stay on your disk unless you consent and an endpoint is configured; none ships." After: "Usage counts stay on your machine unless you opt in and a reporting endpoint is configured. No endpoint is configured by default."
3. Gate section (`Gate.astro`). Before: heading "Enforced, not promised." over the three barrier cards. After: heading "You decide what becomes a review", the five properties verbatim as a list ("The AI draft stays private until you choose to publish." / "You decide which findings are correct and worth saying." / "The review you publish appears under your GitHub identity." / "Approving a pull request requires a separate human action." / "The drafting agent cannot write to GitHub."), then "Enforced, not promised." as the sub-heading over the unchanged barrier cards.
4. Phrase replacements. "every review Claude drafts goes through a person before it posts" became "Claude drafts privately. You decide what to edit, keep, and publish under your name." (examples/index.astro; the only occurrence in site, README and desktop README). Steps 3, before: "Findings wait privately under a reading guide. Keep what's worth your name, edit it, drop the rest." After: "Start with a reading guide, then check each finding against the code. Keep what's worth your name, edit it, drop the rest." Features tile, before: "Effort per run, evidence per finding" / "…evidence and disproof checks earn its Checked, Likely or Maybe badge." After: "Findings you can check." / "Each finding shows where to look, what to check, and a Checked, Likely, or Maybe label to guide your verification." /try meta, before: "The page makes no network request;" After: "This demo does not run Claude or post to GitHub." (the CSP fact stays in the lane doc).
5. Mock copy. The landing mock (`Steps.astro:9`) and the product shared the phase label "Reviewing the diff". Both now read "Drafting findings from the diff": `bin/server.py` phases list (line 4559; order unchanged, and the `cur` match accepts "drafting" as well as the old "reviewing" for a status file written before the upgrade), `bin/run-review.sh` status line (198, "drafting findings from the diff"), `dashboard-ui/src/stage/fixture.json`, and the assertions in `dashboard-ui/src/stage.test.ts`, `bin/test_rs_state.py`, `dashboard-ui/e2e/running.spec.ts`, `audit.spec.ts`, `fixture.ts`, `demos.ts`, `launch-video.ts`; `guides/reviewing.mdx:169` quotes the new phrase. The mock also gained the product's fifth phase, "Checking the findings", so it matches the UI.

## Evidence trail for consequential claims

- **"The drafting agent cannot write to GitHub."** `bin/lib-common.sh:198` `AGENT_DENY_TOOLS` (gh, git push, git remote, git config, curl, …) is passed as `--disallowedTools` at `bin/run-review.sh:363`; `agent_env()` (`lib-common.sh:205`) unsets every GitHub, Slack, webhook and HMAC credential and points `GH_CONFIG_DIR` at an empty directory (line 210); `pr_write_fingerprint()` (`run-review.sh:340`) counts reviews, comments and threads before (349) and after (368) the run, and a difference writes `security-violation` and fails the job (371; the second pass does the same at 409 to 412). `openspec/config.yaml` lists it as a non-negotiable property ("The review step has no GitHub write path at all. It only produces JSON on disk."). Tests: `bin/test_rs_job_scripts.py::test_the_agent_cannot_approve_the_pr_and_holds_no_github_credential`, `::test_the_verdict_lands_in_review_json_and_the_pass_has_no_github_credential`, `::test_a_write_during_the_second_pass_is_a_security_failure`.
- **"Approving a pull request requires a separate human action."** Posting and approving are two routes: `/api/post` (`bin/server.py:5639`) builds the review with `event = "REQUEST_CHANGES" if form.get("request_changes") else "COMMENT"` (6433), never `APPROVE`; `/api/approve` (5659) is gated separately and only `_approve_result` (6517) submits `event=APPROVE` (6550). In the dashboard the post sheet (`dashboard-ui/src/PhoneReview.tsx:567` `PostSheet`, used by `PrPage.tsx:1244`) posts only; approval is its own control calling `api.approve` (`PrPage.tsx:982`, `ApprovedBody` at 1347). Tests: `bin/test_rs_post.py::test_an_open_pr_can_be_approved`, `::test_approve_takes_the_same_lock_as_post`, `::test_approving_a_head_you_did_not_read_is_refused`, `::test_a_second_click_does_not_post_a_second_approval`; `bin/test_rs_job_scripts.py::test_the_agent_cannot_approve_the_pr_and_holds_no_github_credential`. Playwright: `dashboard-ui/e2e/audit.spec.ts` "Enter on the approve-anyway checkbox does not approve the PR"; `wiring.spec.ts` "an unmoved branch approves without an extra confirmation" and "reads as merged, and does not offer an approval GitHub would refuse"; `system-review.spec.ts` "the sections are a tab list with exactly one panel; Approve and Re-run are shadcn controls".
- **"No endpoint is configured by default."** `bin/rs_telemetry.py:50` `ENDPOINT_VARS`, `endpoint()` at 392 (environment only, https only), `decision()` state `no_endpoint`; no default value exists in `bin/rs_settings.py` (which holds only the admin's `telemetry_enabled` switch) or under `desktop/`. Tests: `bin/test_rs_telemetry.py::test_no_endpoint_even_with_consent` (consent on, `flush(env={}, opener=no_network)` sends 0 and queues; an `http://` value is also `no_endpoint`), `::test_no_consent_is_the_default`; `dashboard-ui/e2e/privacy.spec.ts` "consent on: the state becomes no_endpoint, still nothing leaves; Clear and revoke work".
- **Timing claims.** The site quoted "typically 2 to 5, 3 to 10 or 8 to 25 minutes" (`start/first-review.mdx:16`, `guides/reviewing.mdx:25`), "a 25-file PR takes 10 to 15 minutes" (first-review.mdx:16) and "about 40 seconds more per finding" (reviewing.mdx:28). Basis found in the repo: the ranges are the static labels `EFFORT_TIME` in `bin/server.py:1644`, served with `source: "static"` by `bin/rs_rollup.py:381` until an install has three runs at a level, after which line 378 serves that install's own median as `measured`; the 40 seconds is the fixed constant `SEC_PER_FINDING = 40` in `bin/rs_disproof.py:40`. No run records or e2e timing logs exist in the repository for the 10 to 15 minute figure. Reworded: first-review.mdx now says the form shows an estimate, not a measurement, until the install has three runs at that level, and "a review takes a few minutes, depending on the PR and the effort you pick"; reviewing.mdx:25 says the same about the estimate and :28 calls the 40 seconds "a fixed estimate, not a measurement". The static labels themselves now read "2 to 5 min" and so on (`server.py:1644`, `bin/test_rs_rollup.py`). Remaining durations on the site are configuration constants, not performance claims: poller every 3 minutes, action tokens 30 minutes, QA budgets 25/40/60 minutes, review timeouts 12/25/40 minutes (`bin/run-review.sh:88-90`), the repo-profile 15 minute timeout, and "a few minutes" hedges in README, troubleshooting and architecture.
- **"Reviewing the diff"**: recorded in the first pass as an exception left in place; resolved by revision 5.

## No dashes (10/11/26)

The maintainer asked for every em dash, en dash and spaced hyphen used as punctuation to go
from human-readable text, rewritten as a full stop, comma, colon or two sentences, never
deleted. Scope: `website/src/**`, `README.md`, `desktop/README.md`, `docs/INSTALL-DESKTOP.md`,
`docs/launch/**`, `dashboard-ui/src/**` user-facing strings and JSX text, `desktop/pages/*`,
the two skills' `SKILL.md`, `bin/rs_review_schema.py` (linter) and this file. Not touched:
`CHANGELOG.md`, `LICENSE`, code comments, test names, other openspec documents.

Counts before, raw occurrences per scope (em / en / spaced hyphen): website/src 349 / 13 / 7;
README.md 25 / 0 / 0; desktop/README.md 11 / 0 / 0; docs/INSTALL-DESKTOP.md 23 / 0 / 0;
docs/launch 60 / 16 / 1; dashboard-ui/src 344 / 8 / 84 (the 84 were arithmetic, not copy);
desktop/pages 3 / 0 / 2 (the 2 were CSS `calc()`); skills 46 / 3 / 3. `scripts/no-dashes.sh`
reported 618 lines before the sweep and 0 after.

Method: a heuristic rewrite (paired dashes to commas; a single dash to a comma before a
conjunction, a colon before a lower-case continuation or a clause subject, a full stop before a
new sentence; numeric ranges to "to"), then a hand pass over the diff for the cases the
heuristic read wrongly (broken pairs across string concatenations, double colons, "Dry run, …").
Hyphens inside compounds stay. Numeric ranges became "to" ("2 to 5 min", "Lines 120 to 124").

What else changed under this rule:

- `bin/rs_review_schema.py`: `lint_text` now warns `plain: dash used as punctuation` and
  replaces every em or en dash with ", " (`undash()`), and warns on a spaced hyphen; two new
  tests in `bin/test_rs_review_schema.py`.
- `skills/pr-review/SKILL.md` and `skills/pr-disproof/SKILL.md` writing rules gained "Do not use
  dashes as punctuation. Use a full stop, comma or colon."
- `dashboard-ui/fixtures/replay/*.json`: the three stored reviews rendered on /examples/ and
  /try/ carried 28 dashes in finding text; rewritten the same way, since the linter would now do
  it to a new review. `dashboard-ui/src/stage/fixture.json` and the e2e mirror in
  `dashboard-ui/e2e/fixture.ts` were kept identical (`replay.test.ts` asserts it).
- The rendered check caught what the source grep had let through: a "—" standing for "none"
  in table cells (`security/telemetry.md`, `operations/configuration.md`, now "none") and a dash
  between two backticked spans (`guides/repo-profile.mdx`, `developers/mobile.md`). The source
  checker no longer treats a dash between backticks as a lone glyph.
- Three docs `description:` frontmatter values gained a colon from the rewrite and had to be
  quoted (`team-mode.md`, `repo-profile.mdx`, `notifications.mdx`).
- The home page has a 900-word ceiling (`verify-site.mjs`). The five Gate facts added about 50
  words, so existing prose was tightened to pay for them: the Gate lede and the three barrier
  descriptions, the Compare footnote, the Install footnotes, the Features tile lines (the effort
  sentence left the "Findings you can check." tile; effort is still in Steps 2) and Steps 2.
- A lone "—" standing in for an empty value (`Settings.tsx` `if (!ts) return "—"`) is a glyph,
  not punctuation, and stays; the checker ignores a dash with no word on either side.
- `scripts/no-dashes.sh` (bash 3.2) greps the scopes above, skips comments, test files,
  Markdown list markers, SRT arrows, CSS `calc()` and arithmetic outside strings, prints
  file:line and exits 1 on any hit. Wired into the CI "Scripts" job after shellcheck
  (`.github/workflows/ci.yml`) and, for the rendered site, `website/scripts/verify-site.mjs`
  scans every built page's text nodes for an em or en dash.
