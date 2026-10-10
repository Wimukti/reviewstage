# Becoming the go-to tool — assessment of the strategy document (10/10/26)

Source: "ReviewStage: Product, SEO, and Go-to-Market Strategy" (4,644 words, 34 references).
Every claim about our site, package and repository was checked against the live artefacts;
every market claim that carries a number was checked against its source. This file records what
held, what did not, what we adopt, what we change, and what we reject — with reasons.

## 1. What was verified

| Claim in the document | Checked how | Result |
| --- | --- | --- |
| `/robots.txt` returns 404 | `curl` | **True.** Sitemap index serves 200 but nothing advertises it. |
| Homepage title lacks the category | live `<title>` | **True.** "ReviewStage — AI drafts your PR review, you post it as yourself". |
| H1 is the campaign line only | live `<h1>` | **True.** |
| SoftwareApplication JSON-LD lacks `offers.price` | live JSON-LD | **True.** Also `operatingSystem` still says "Linux, macOS (Docker)" — stale since the desktop app. No `downloadUrl`, no `author`/`sameAs`. |
| npm package has no keywords | `npm view reviewstage keywords` | **True** (empty). |
| Repository has 19 topics; keep ~10 focused | `gh repo view` | **True** (19). |
| Documentation titles are generic | live `<title>`s | **True**: "Install", "What you get", "Team mode", "FAQ". |
| Sitemap has no `lastmod` | `sitemap-0.xml` | **True** (0 entries). |
| Community profile strong; issue *forms* missing | GitHub community API | Health 100%; templates are Markdown, not YAML forms. |
| **Brand collision with "Stage"** | GitHub org, npm, site, YC page | **True and worse than stated.** Org `ReviewStage` = company Stage (YC launch 05/01/25). `stage-cli` **274 ★** vs our 0. Site stagereview.app. **Their npm package is `stagereview`; ours is `reviewstage`.** Same buyer (engineers reviewing AI-written PRs); different wedge (they re-order a diff into chapters; we draft the review privately). |
| Claude Code Review posts as a bot, Team/Enterprise only, $15–25 per review, never approves | code.claude.com docs | **True.** Also learned: it reads a `REVIEW.md` from the repo (so a portable `REVIEW.md` export from us is real interoperability), and `/code-review ultra` can **post findings to a PR from the user's own GitHub account** — Anthropic is one step from our wedge. |
| CodeRabbit from $24/dev/mo; Greptile $30, free 50 credits | pricing pages | **True.** |
| c-CRAB: agents together solve ~41.5% | arXiv 2603.23448 abstract | **Substantively true** ("around 40%" in the abstract; per-tool range not in the abstract). |
| AI-only-reviewed PRs merge 23 points less; 60.2% low-signal | arXiv 2604.03196 | **Verbatim true** (45.20% vs 68.37%; 60.2%). |
| 22,000+ AI comments: concise, specific, manually triggered ones get acted on | arXiv 2508.18771 | **True**, though the abstract does not itself compare AI with human comments as the document implies. |
| Stack Overflow 2025: 46% distrust, 66% "almost right" | not re-checked | Plausible; cite the survey directly if used. |
| GitHub search for the category finds us | `gh search repos` | We do **not** appear for "human-in-the-loop code review claude" or "ai code review assistant claude code". |

## 2. What the product already has (so the roadmap starts from the right place)

- **Confidence per finding** exists: the skill asks for it and low-confidence findings are not pre-selected. The "evidence panel" is partly built; what is missing is the *verification step* per finding and a consistent card layout.
- **Branch-moved / stale run detection** exists on the PR page. What is missing is the **incremental diff of findings** between runs (new · changed · resolved · still open).
- **Learnings** record keep / reword / drop and cluster repeated drops into proposed rules. What is missing is a **reason** on each drop.
- **Independent reviewers** (two runs, "confirmed by 2") exist — the document's P2 "challenger review" is largely shipped.
- **No telemetry of any kind.** The funnel in §"Measurement" cannot be measured today.
- **No public-PR trial**: a review needs GitHub sign-in and a connected Claude account first.

## 3. Decisions

### Adopt as written

1. **Category sentence everywhere**: *the human review layer for AI-written pull requests. Claude drafts privately; you verify, edit and post as yourself.* Title tag, meta description, README first sentence, npm description, GitHub About, social image caption.
2. **Technical SEO P0**: robots.txt advertising the sitemap; complete SoftwareApplication schema (`offers {price:0, priceCurrency:USD}`, real `operatingSystem`, `downloadUrl`, `softwareVersion`, `author` Person with `sameAs`); category in `<title>`; `lastmod` in the sitemap; rewritten documentation titles; alt text audit.
3. **npm keywords**, **topics trimmed to ten**, **YAML issue forms** (bug, feature, docs, security-redirect), **good first issues** opened, **Discussions** on.
4. **North star = weekly human-posted reviews**, with activation, keep-rate and 4-week retention as the proof metrics. Stars are tracked but not optimised.
5. **Dismissal taxonomy** on drop (incorrect · irrelevant · already handled · style/nit · lacks context · duplicate · not worth raising) — it makes the learnings loop legible and feeds the benchmark.
6. **Incremental re-review** (new / changed / resolved / still open after a push).
7. **Portable `REVIEW.md` export** of accepted rules — Anthropic's Code Review reads the same file, so our learned rules become usable even by people who leave.
8. **Six intent pages, not dozens**, and the **"100 AI-written PRs reviewed by humans" benchmark** as the central credibility asset.
9. **Design partners before broad launch**: ten reviewers, three real PRs each, interview after the third.
10. **What not to build**: no auto-post, no auto-approve, no one-click fixes before precision is proven, no "Posted with ReviewStage" signature, no SSO/GitLab before retention.

### Adapt

- **Hero.** Keep "AI wrote the PR. You still have to review it." as the display line (it is the one memorable asset and the launch posts use it), but make the semantic `<h1>` the category statement directly under it, and put the category in `<title>`. Do not ship a hidden H1. The document's proposed H1 "Human-in-the-loop AI code review for GitHub" is a search phrase, not a sentence a person would say; ours: **"The human review layer for AI-written pull requests."**
- **Primary CTA.** The command *is* the primary action and already copies; keep it. "Run your first review" as a button that scrolls to the command adds a step.
- **Telemetry.** Adopt, but **off by default in the desktop app and opt-in at first run with the exact field list shown**; team installs get a server setting. Never diff or source content; events only (install completed, first review, run duration bucket, findings shown/kept/edited/dropped counts, post success, 7/28-day return). Publish the schema in the docs.
- **Public-PR trial.** Adopt in spirit — the obstacle is cost, not permissions: a review runs on *someone's* Claude account. Build it as **"Try on a public PR" on the website with pre-rendered real reviews of 5–10 well-known open-source PRs** (static, re-generated by a script), plus in-app "Review any public PR" once Claude is connected. No shared Claude key.
- **Reviewer evidence panel.** Add the missing piece only: a **"How to verify"** line per finding and a consistent card (claim · severity · confidence · path:line · why it matters · verify). The rest exists.
- **Review-queue triage.** Adopt the *signals* (age, size, CI state, ownership, agent-authored) as sortable columns and a visible explanation — not an opaque risk score.
- **Shareable image / badge loops.** Adopt the opt-in repository badge ("Human-reviewed with ReviewStage" → security page). Skip the per-review share image for now: it is a vanity loop and adds a surface to maintain.

### Reject

- **Renaming before launch — rejected as framed, with a condition.** See §4. The collision is real, but the document's one-week rename sprint ignores what is already sunk and what a rename costs: a registered domain, a published npm name, a GitHub repo with history and a release train, a YouTube video, a social image, launch texts, and a brand line that only works with "Stage" in it. The decision is the maintainer's; my recommendation is below.
- **Browser extension / GitHub side panel (P1.5).** Not now. It is a second client to keep in step with GitHub's DOM; the phone app and desktop already remove the context switch for the people we are targeting.
- **Multi-model backend (P2.4) and GitLab (P2.5).** Agreed with the document — not before retention.

## 4. The name

**Facts.** Stage (YC, launched 05/01/25): GitHub org `ReviewStage` (two repos, `stage-cli` 274 ★, active this week), site `stagereview.app`, **npm `stagereview`**. Their wedge: reorder a PR's diff into readable "chapters" with AI notes, read-only by default, "works with any agent". Ours: Claude drafts the review privately; the human posts as themselves. Adjacent category, same buyer, overlapping vocabulary ("stage", "review").

**What the collision costs us.** Branded search for "reviewstage" will show their org and package; `npm i stagereview` vs `npx reviewstage` is a typo-distance away; any mention or backlink that says "ReviewStage" is ambiguous; and if Stage grows, we look like the imitator even though our name predates knowing of them.

**What a rename costs us.** New domain, new npm package (and a deprecation of `reviewstage` pointing at it), repo rename (GitHub redirects old URLs), rebuilt social image and video end card, every doc and launch text, the in-app brand string, and — the real one — the launch line "AI wrote the PR. You still have to review it." survives, but "Stage your review" does not.

**Candidates checked (10/10/26):**

| Name | .dev | .app | GitHub | npm | Note |
| --- | --- | --- | --- | --- | --- |
| **vouchreview** | free | free | free | free | "vouch" = a human standing behind a review. Says the thesis. |
| **reviewverdict** | free | free | free | free | "verdict" = judgment; slightly legal. |
| **judgecall** | free | free | free | free | Playful; the human's call. Less "review". |
| **greenlightreview** | free | free | free | free | Long; "greenlight" leans approve. |
| **keepdrop** | free | free | free | free | Names the interaction (keep / drop). Odd as a brand. |
| **staged-review** | free | free | free | free | Keeps "stage" — same collision. |
| draftreview | free | taken | free | free | Generic. |
| reviewdesk | free | taken | free | free | Generic. |
| humanreview | taken | taken | free | free | — |
| ownreview, signoffhq, reviewkeep, verdictly, countersign, redlinehq, keepwise | — | — | taken | — | — |

**Recommendation.** Do **not** rename before the first launch. Launch as ReviewStage with the descriptor welded on everywhere ("ReviewStage — the human review layer for AI-written PRs"), measure for 30 days, and decide at the 30-day review with data: branded-search confusion (Search Console queries), misdirected issues or mentions, and whether Stage's growth continues. If we rename then, **Vouch** (`vouchreview.dev`, npm `vouchreview`, GitHub `vouchreview`) is the strongest available candidate: one word, says "a human stands behind this", clean everywhere, no "stage" in it. Reserve the domain and the npm/GitHub names now so the option stays open (cost: one domain). A trademark search is the maintainer's to commission; this is not legal advice.

## 5. The 90-day plan, adjusted

| Days | Product | Site / discovery | People |
| --- | --- | --- | --- |
| 1–7 | Opt-in telemetry (schema published) · drop reasons · "How to verify" on finding cards · Try-on-a-public-PR page | **P0 SEO lane (shipping now)**: robots, schema, title/H1, doc titles, lastmod, npm keywords, topics, issue forms, good-first-issues, Discussions · reserve `vouchreview.*` | Recruit 10 design partners (3 real PRs each) |
| 8–30 | Incremental re-review · `REVIEW.md` export · queue signals as columns | Six intent pages (one per week) · Search Console + Bing submitted (maintainer) | Weekly partner interviews; fix every install failure and top-3 drop reasons |
| 31–45 | Precision work from drop reasons; run-time work | Benchmark v1: human keep/drop across the first 100 real runs, method published | GitHub release 1.1 · Show HN · 3 permissioned testimonials |
| 46–60 | Team invite loop (single-use link) · opt-in badge | Fair comparison page (dated, sourced) · self-host deep dive | Reddit (r/ClaudeAI, r/ClaudeCode, r/selfhosted, r/opensource), each native |
| 61–90 | Historical replay harness (replay human comments against skills, no posting) | Two case studies · open dataset of anonymised finding decisions | 30-day review: **name decision with data**; newsletters, podcasts, awesome lists |

Exit conditions as in the document: 20 real reviews with no unknown install failures by day 14; 100 runs with top rejection causes known by day 30; activation > 50% and 4-week retention near 30% for the partner cohort by day 90.

## 6. Shipping now (lane `seo-discovery`)

robots.txt · complete JSON-LD · category title and H1 · documentation titles · sitemap lastmod · npm keywords and description · ten topics · YAML issue forms · good-first-issues opened · Discussions on · README first sentence · alt-text audit · verify harness extended. Everything else above is a lane each, in the order of the table.

## 7. Correction after the second document (10/10/26)

A reassessment of this assessment arrived the same day. Checked the same way; three of its four
corrections stand, and two of mine were wrong.

| Its claim | Verified | Verdict |
| --- | --- | --- |
| **Rename before the launch, not after 30 days** | We have 0 stars, one user (the maintainer), a 5-day-old domain and package. Search Console will show nothing useful in 30 days at that traffic. Migration cost only grows from here. | **Conceded.** My "measure for 30 days" was a sunk-cost argument dressed as a data argument. Rename before the public launch. |
| **Vouch is not clean** | `mitchellh/vouch`: 5,119 ★, created 02/05/26, "a community trust management system based on explicit vouches", GitHub integration, built against low-quality AI contributions. | **Conceded.** I checked namespaces, not meaning. Withdrawn. |
| **Plannotator is a direct adjacency** | `backnotprop/plannotator`: 9,306 ★, "annotate and review coding agent plans and code diffs … send feedback to agents", supports Claude Code, Codex, Copilot, Gemini, Kiro, OpenCode. | **True.** It is the "why not just…" answer we must beat, together with `/code-review --comment`. Add it to the compare table and the FAQ. |
| **A 404 robots.txt does not block crawling** | Google treats a 404 as allow-all. | True, and never claimed otherwise here; robots is housekeeping that advertises the sitemap. |
| **"Bot on every PR" and "nothing else leaves" are overstatements** | Our Compare, Contrast and FAQ said exactly that. Claude Code Review has a manual mode; `/code-review` posts only when invoked; and update checks, push services and the tunnel do leave the machine. | **True. Fixed in this commit** — precise wording in all three places and the launch kit. |
| **North star = weekly reviewers who post ≥ 1 curated review**, not review count | One person posting ten reviews should not look like ten retained users. | **Adopted.** |
| **P0 order: telemetry + drop reasons + verification contract + first-run value + diagnostics before incremental re-review** | Same list as §3, reordered toward proof. | **Adopted.** `--doctor` exists; it gains the Claude-auth and GitHub-auth checks. |
| JetBrains Research (10/06/26): reviewing AI-generated multi-file changes "is not a diffing problem, but a trust-calibration problem" | Article verified. | Adopt the framing for the finding card: risk and confidence at the segment where attention is spent. |

### The name, second pass

Single thesis words are gone: finalsay, lastword, byline, winnow, gavel, yourcall, ratify, redpen,
secondlook — every one taken on .dev/.app and GitHub. Clean on `.dev`, `.app`, GitHub and npm
as of 10/10/26 (semantic collisions still to be checked for the top picks):

| Candidate | Says | Reservation |
| --- | --- | --- |
| **KeepDrop** | the interaction itself: keep what's worth saying, drop the rest — also the phone gesture and the learnings loop ("learns what you drop") | unusual as a brand; two verbs |
| **DiffKeeper** | a human keeps only the findings worth raising | "keeper" reads a little like a vault/backup tool |
| **PeerLayer** | human judgment layered over AI output (the category sentence) | abstract; "HumanLayer" (11.7k ★) exists, so the "-layer" pattern is crowded |
| PR Attest (`prattest`) | a human attests the review is worth posting | formal; hard to say aloud |
| ReviewVerdict / JudgeCall / SignedReview / HumanSign | judgment / signature | generic or legal in tone |

Recommendation: **KeepDrop**, pending the semantic-collision check and a trademark search by the
maintainer. Keep "AI wrote the PR. You still have to review it." and the category sentence as is;
"Stage your review" retires. Migration order: domain → npm `keepdrop` with `reviewstage` left as a
one-line shim that prints the new command and forwards → GitHub rename (redirects follow) → site
redirects for a year → "ReviewStage is now KeepDrop" in README, package output and metadata for six
months → re-record the launch video end card (`pnpm launch-video`) and the voice-over's one word.
