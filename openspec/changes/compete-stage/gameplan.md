# Gameplan: ReviewStage vs Stage (stagereview.app) — 10/11/26

Everything below about Stage was read from their site, their YC launch page, their `stage-cli`
README and both of their Show HN threads on 10/11/26. Everything about Jev was read from
typesafe.ai's announcement, docs index, an independent analysis (TrueFoundry) and the one
independent paper that used it (arXiv 2609.24052). Dates MM/DD/YY.

## 1. Who Stage is

| | Stage |
| --- | --- |
| Company | YC Spring 2026; founders Charles Pan and Dean Stratakos; launched 05/01/25 (Show HN: 130 points, 111 comments); CLI Show HN later |
| One line | "Code review for modern teams" · "AI writes code faster than teams can review it" · "review changes 5× faster" |
| Core idea | Reorder a PR's diff into small logical **chapters**, ordered for reading, each with "what changed" and "things to double-check" |
| Product | Hosted web app over GitHub: dashboard of all PRs across repos, chapters, **Stagent** chat (risk assessment, summaries, file/line citations, review priority), **two-way sync of comments and approvals to GitHub** |
| CLI | `stagereview` (MIT, 274 ★): chapters for *local* changes, browser UI, `/stage-resolve` lets an agent act on review comments, comment threads list/reply/resolve; "works with any coding agent" (Claude Code, Cursor, Codex, Gemini, opencode) |
| Price | Free for public repos; **$30/user/month** for private repos (Team); Enterprise: SSO, RBAC, audit logs |
| Data | "sends code to model providers for analysis only at review time… nothing stored beyond the lifetime of a chapter generation" — hosted, their keys, their providers |

### What HN told them (their soft spots, verbatim from the threads)

- "exclusively surfaces *what* changes" — not **why** (requirements, ticket, intent).
- "AI guiding human attention means humans aren't guiding human attention" — summaries become a checklist; **rubber-stamping risk**.
- "you cannot solve this problem by adding more AI on top."
- Well-structured commits already do this; "decreasing people's motivation to make well-mannered commits."
- Moat: "GitHub/GitLab would replicate features quickly"; SaaS friction vs doing it locally.
- CLI: slow on big diffs (needs virtualisation); "CLI" that opens a browser; solo devs without PRs find it "unusable"; wanted a TUI and comments fed back into the agent loop.
- Requests: manual chapter adjustment, `CHAPTERS.md`, Linear/issue context, **local-first with sync**, security-focused review.

## 2. Side by side

| Dimension | Stage | ReviewStage today (1.1.0) |
| --- | --- | --- |
| Job | Help a human **read** a big diff faster | Help a requested reviewer **decide and publish** a review they'll sign |
| AI's role | Narrator and guide (chapters, prologue, risk notes, chat) | Drafts candidate findings privately; human keeps / edits / drops |
| Where it runs | Hosted (web app); CLI local for local diffs | Local desktop app (`npx reviewstage`) + phone over your own tunnel; or self-hosted Docker |
| Whose model | Theirs, their providers | **Your own Claude plan**, your account; nothing to us |
| Writes to GitHub | Yes: comments and approvals synced two-way | Only what you click Post on, as you; **the drafting agent has no GitHub credentials; approve is a separate human click; it can never auto-approve** |
| Learns your team | No | Keep/edit/drop + reasons → proposed rules; independent reviewer agreement ("confirmed by 2") |
| Phone | No | Yes: queue, swipe keep/drop, post sheet, push |
| Evidence per finding | Risk notes per chapter | Claim · severity · confidence · path:line · why it matters · **how to verify** |
| Reading big diffs | **Their strength**: chapters, ordering, prologue | Plain diff; findings link to lines. **Our gap.** |
| Multi-agent | Any agent (skills) | Claude Code only |
| Price | $30/user/mo private | Free, MIT |
| Try without signup | Public-PR demo tool | `/try` replay (no network) + `/examples` |
| Enterprise | SSO, RBAC, audit logs | None |

Stage's wedge and ours overlap on the buyer and on one word ("stage"). They do not overlap on
the job: Stage makes the diff legible; ReviewStage makes the human's verdict cheap to produce,
defensible, and owned. Stage posts *through* the tool; we post *as you*, and only what you chose.

## 3. Where we win (and must say so)

1. **Accountability, not acceleration.** Their HN thread is full of people afraid of
   rubber-stamping. We are the product built against rubber-stamping: private draft, you choose
   what is correct and worth saying, posted under your name, approve is always you. Lead with it.
2. **Your Claude, your machine.** They send your code to their providers from their servers.
   We never see it. r/selfhosted, security teams and anyone with a procurement form care.
3. **Free for private repos.** Their paywall is private repos at $30/seat. Ours is MIT.
4. **Learns the team.** Nothing in Stage remembers what your reviewers accept or reject.
5. **Phone.** Nobody else has a review-from-the-sofa path that ends in a post under your name.
6. **Verification contract + measured precision.** A finding you can check in one line, with a
   confidence that we can *prove* is calibrated from our own keep/drop data (see §5).

## 4. Where they win (and what to do about it)

| Their strength | Our move | Cost |
| --- | --- | --- |
| Chapters: reading order for a 2,000-line diff | **Reading plan**: the review run already understands the PR. Emit an ordered list of "read these hunks in this order, here's why" as a side output and render it as a collapsible guide above the findings. Not a product pivot; one more field in the contract. Addresses their #1 criticism too: include **why** (link the issue/ticket and the PR body's intent) at the top. | M |
| Hosted, zero install | Keep `/try`; add "Review a public PR" in-app once Claude is connected (memo Stage 3). | S |
| Any agent | Not now (memo P2). Claude-only is also our privacy and cost story. Revisit on evidence. | — |
| Enterprise (SSO, audit) | Not now. Team mode already has an admin setting and audit of posts; write that down on a "Teams" page. | S |
| 274 ★ and a YC badge | Launch well, and publish the benchmark (§6). | — |

## 5. Confidence you can trust — the Jev question

### What Jev is (verified)

- typesafe.ai's "System One model", early access since 09/15/26. Not an LLM: you send a
  **state** (text/JSON) plus typed **questions** and get back typed answers with probabilities.
- Three primitives: **Choice** (pick one of ≤ 255 options → `choice`, `probabilities`,
  `confidence`), **Score** (rate on a rubric → `score`, `probabilities`, `confidence`),
  **Noul** ("is this statement true?" → a 0–1 probability). Questions in one call run in parallel.
- Claims: 70–500 ms latency, $0.042 per million input tokens, output free, "0% type errors",
  "calibrated: higher confidence means higher accuracy". Python and JS SDKs; a Claude Code skill.
- **Caveats, including their own:** "a confidence of 0.9 is not a promise that this answer is
  90% likely correct"; thresholds must be set from labelled examples of *your* workload. A model
  constrained to three options "can still confidently pick the wrong one" (TrueFoundry). The one
  independent paper (crash narratives, F1 0.908) found calibration "varies by model" and that
  **recalibration cut calibration error 3.3×** — i.e. raw confidence needed fixing even there.
- **Privacy:** it is a hosted API. Sending a diff hunk to typesafe.ai is a new destination that
  our FAQ, launch copy and the five properties do not currently allow. Their docs index has a
  Legal section but no retention statement we could quote.

### What "perfect reviews people can rely on" actually requires

No model makes a review perfect. What makes a review *reliable* is: (1) each finding is checkable,
(2) the stated confidence matches reality, measured, (3) the reviewer sees the measurement. We
already have (1) (how to verify) and the raw material for (2) (keep / edit / drop with reasons,
"confirmed by 2"). So:

**Step 1 — measure what we have (no new vendor).** Today `confidence` is the model's self-report
(high / medium / low). Compute, from the learnings store, the **keep-rate per confidence
bucket** per skill and per repo. If "high" is kept 85% and "low" 30%, the badge is honest;
show the number on the badge ("high · kept 85% here"). If the buckets don't separate, the
self-report is noise and we say so. This is the calibration benchmark in §6, and it is the one
thing Stage cannot copy: it needs human decisions on real findings, which only a tool that gates
posting collects.

**Step 2 — an adversarial verification pass, same provider.** The memo's "dedicated disproof
pass for high-severity findings": a second Claude run with the opposite brief ("find the reason
this finding is wrong") against the diff and the files the finding cites. Output per finding:
*stands / weakened / refuted* + one line. Costs the user one more run on their plan, no new
destination, fits the five properties. Shows on the card as "Checked: stands". This is the
largest precision gain available and it is already in our plan behind partner evidence.

**Step 3 — Jev as an optional, opt-in calibrated judge (later, with data).** Where Jev fits is
exactly its documented use case ("score, judge, verify LLM outputs"): for each finding, ask
Nouls like *"the cited lines contain the behaviour the finding describes"*, *"the finding's
severity is justified by its impact statement"*, *"this duplicates another finding in the set"*,
and a Score for "actionability". Cheap (sub-second, cents per PR) and type-safe. **But:**
- it is a new destination for diff hunks → must be an explicit per-user opt-in with its own line
  in "What leaves my machine", off by default, team-disable-able, like telemetry;
- its confidence must be **recalibrated on our own keep/drop labels** before it is shown as a
  probability (the paper's 3.3× result says this is not optional);
- it should sharpen the badge, not replace Step 2: Jev cannot read the repository; the disproof
  pass can.
Decision gate: build Step 3 only when Steps 1–2 exist and ≥ 200 labelled findings are available
to recalibrate against. Until then, the honest claim is "measured, not predicted".

**What not to do:** put a 0–100 "AI confidence" number on every card from any model, today.
Unmeasured numbers are the exact thing the JetBrains "trust-calibration" article and HN's
rubber-stamping objection are about; they would make the tool *less* reliable while looking
more precise.

## 6. The public proof: a calibration benchmark nobody else can run

"100 AI-written PRs reviewed by humans" (memo) becomes concrete: per confidence bucket and per
severity, what fraction of findings did real reviewers keep, edit, drop — and why. Published as
a dated page with method and limits ("early field dataset, convenience cohort"). This answers
both Stage's "5× faster" (unverifiable) and the HN crowd's "more AI on top" (we show the humans'
verdicts) with numbers only a posting gate can produce.

## 7. Positioning sentence for the comparison page

> Stage helps you read a big diff faster. ReviewStage helps you decide what is true and worth
> saying about it, then post it under your own name. Use Stage to read; use ReviewStage to be
> the reviewer. (And yes: it runs on your Claude plan, on your machine, free for private repos.)

State where they are stronger (reading order, hosted zero-install, any-agent, enterprise).

## 8. Order of work

| # | Item | Why first | Size |
| --- | --- | --- | --- |
| 1 | **Calibration readout** from learnings: keep-rate per confidence bucket, per skill/repo; badge shows it when n ≥ 20 | Turns the existing badge honest; zero new risk; is the benchmark's engine | S–M |
| 2 | **Reading plan + intent header** in the review output and card list | Neutralises Stage's one real advantage and HN's "why" objection | M |
| 3 | **Disproof pass** (opt-in per run, high/critical first) → "Checked: stands / weakened / refuted" | Biggest precision gain; same provider; already planned | M |
| 4 | **Compare page: Stage** (dated, sourced, fair) + "Teams" page | Launch needs it; §7 | S |
| 5 | **Calibration benchmark page** once partners produce ≥ 100 runs | Public proof | S after 1 |
| 6 | **Jev judge, opt-in** behind the gate in §5 Step 3 | Cheap calibrated second opinion, only once we can recalibrate it | M |

Items 1, 2 and 4 do not depend on partner evidence and respect the memo's "build from observed
behaviour" rule (1 and 2 are instrumentation and copy of what the run already knows). Item 3 is
P1 in the memo; promote it when drop reasons show "incorrect" dominating.
