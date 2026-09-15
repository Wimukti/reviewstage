---
name: pr-qa-guide
description: Build a shareable QA guide for a PR, branch, or feature — risk-tiered P0/P1/P2 manual test cases grounded in the real diff and review history, setup prerequisites, a surface matrix, and known non-defects QA should not file. The deliverable is a markdown guide. Use WHENEVER the user asks for a "QA guide", "QA test guide", "manual test plan for QA", or wants to hand testers something for a PR/branch/feature.
---

# PR QA Guide

Produce a QA guide a tester who has never seen the code can follow: what to set up, what to
look for, what to test first, where the feature must NOT appear, and what not to file as a bug.

**The deliverable is one markdown file.** GitHub-flavored markdown, with `- [ ]` checkboxes a
tester can tick as they go. That is what ReviewStage renders on the QA page, what pastes into a
ticket, and what a reviewer can diff when the branch moves. Do not produce HTML, and do not try
to publish anything, unless the person asking is sitting in an interactive session and explicitly
asks for a shareable page — see the appendix at the end.

Two properties define a good guide, and they pull in different directions — you need both:

1. **Every sentence is traceable to evidence** — the diff, the actual code, the PR review
   threads, the commit history, or the ticket. If you cannot point to where a claim comes from,
   do not write it. Never pad with generic advice ("test edge cases", "verify performance").
2. **A tester can act on every sentence without reading code.** You derived the tests from the
   source; you must then translate them out of it. See "Write for a tester" below — this is the
   step most likely to be skipped, and skipping it makes the guide unusable no matter how sound
   the analysis underneath.

## Write for a tester (apply to everything QA-facing)

- **No code identifiers** in titles, steps or verdicts: no method/class/field names, no commit
  SHAs, no "the round-2 review's High finding", no internal state names. Translate each one into
  what the tester can actually see or do. *"`previousExpiration` stays raw so the duplicate guard
  matches"* becomes *"the cut-off shown to the customer must not move — that's what stops the same
  delivery being ordered twice."*
- Internal names appear **only** where the tester must type or search them — a flag name to hand
  a developer, a controller name to type into an admin search box — and then in `code` style.
- **Every test is numbered and self-contained**: what data you need, ordered steps, and an
  explicit pass and fail. A tester must never have to infer the verdict.
- Reasons ("why this test exists") are worth keeping, but rewrite them as plain risk in the
  reader's world: *"the most damaging thing that could go wrong: the customer is charged twice
  for the same delivery."*
- If you would not say a sentence out loud to someone who has never opened the repo, rewrite it.

## Step 1 — Gather evidence (do this before writing anything)

Work from the real change, not the description of it:

1. **The diff.** `gh pr diff <n>` or `git diff <base>...<branch>`. If the feature was built in
   this very conversation, the conversation is primary evidence — still read the final diff.
2. **The PR conversation.** `gh pr view <n> --comments` and
   `gh api repos/{owner}/{repo}/pulls/<n>/comments` for inline review threads. Review history
   is your risk map (see Step 2). When a caller has already gathered this for you into a file
   (ReviewStage writes `.rs-pr-context.md` and gives you no network), that file replaces these
   commands — read it first and treat it as the whole conversation.
3. **Commit history of the branch.** `git log --oneline <base>..<branch>` — late-added commits
   and fix-after-review commits mark the least-exercised paths.
4. **The surrounding code.** Read the files the diff touches, enough to know: every flag /
   setting / permission gating the feature, every surface (page, viewport, portal, component)
   that renders it, and every adjacent surface that reuses the same component but should NOT
   change.
5. **How a tester triggers it, in the target environment.** Do not assume clicking through the
   UI is enough. If the change runs on a schedule, a queue, a cron, a webhook or a batch job,
   find: the admin tool or button that forces it to run on demand; what the test environment
   does differently from production (task whitelists, disabled runners, stubbed integrations);
   and any trap where the obvious approach silently ruins the test. A guide that says "let the
   job run" is not usable. This research is as load-bearing as the diff itself.
6. **The ticket** (from the PR title/branch/body) for intended scope and pilot audience.
7. **Record the branch head SHA** (`git rev-parse --short HEAD` or the PR head) — it goes in
   the footer so QA knows what the guide was checked against.

For a large diff, fan the reading out to Explore/general-purpose subagents and keep only the
findings.

## Step 2 — Derive the risk tiers (this is the core of the method)

Do not order tests by feature area. Order them by **where a defect hurts most × where the code
is least trustworthy**. Concretely:

- **P0 — Test first.** Failure modes that defeat the feature's purpose or silently corrupt what
  the user sees/does (a wrong *number* is worse than a missing widget). Plus anything the
  review history marks as fragile:
  - code reworked two or more times during review,
  - paths added in a later commit than the main implementation (e.g., "desktop was fixed
    first, mobile only in a later commit — mobile is the least-exercised path"),
  - newly added guards for edge data (restricted variants, empty states, timezone cutoffs),
  - anything with a plausible *silent* failure (nothing on screen would reveal it's wrong).
  You derive P0 from that history — but state the reason to the tester as plain consequence,
  not as review archaeology.
- **P1 — The feature.** The advertised behaviors: each interaction, each state, each rename or
  visual change, including the cases most likely to be *missed* by naive testing (e.g., an
  entity that qualifies for the new UI but has no history in the old one).
- **P2 — Scope & regression.** Gating and blast radius: **every flag/setting must
  independently hide the feature** (test each one off while the others stay on); un-gated
  users/tenants see zero change; shared components behave exactly as before on their other
  call sites.

Give the tiers plain names in the guide itself — "Test these first", "Does the feature work
properly", "Check nothing else broke" — with one sentence on what the tier means. "P0 · Scope &
regression" tells a tester nothing.

## Step 3 — Write the guide with this structure

Markdown. One `#` title, `##` per section, in this order. (A caller that hands you its own output
contract — ReviewStage does — wins on exact headings; the content below is what each must hold.)

1. **Header.** `#` with the feature name, then one line: PR number · ticket ID(s) · scope/pilot
   audience, and a 2–3 sentence standfirst in plain product language — the user's problem, what
   changes for them. No code identifiers.
2. **Domain primer** — *include whenever understanding the feature needs a concept the tester
   may not have* (lead times, rebate tiers, allocation, proration). Define the term in one
   sentence, give a two-row concrete example (real product names and numbers, drawn from the
   actual data), then walk the before/after in that same example. This is often the difference
   between a guide QA can use and one they cannot.
3. **What actually changes on screen** — state plainly what the tester will and won't see. If
   the feature is largely invisible (timing, background jobs, data shape, an extra row in a
   queue), say so explicitly and point at where the real evidence lives. Otherwise QA watches
   the wrong screen and passes a broken feature.
4. **Before you start** — a bullet list of prerequisites: exact flag names in `code`
   style, required settings, the shape of test data needed ("a customer with X whose Y is today
   or later"), viewports/portals to cover (call out when they are separate implementations),
   and upstream dependencies.
5. **How to run it** — *include whenever the thing under test is not triggered by ordinary
   clicking.* The admin tool and its URL, the exact button, what a developer must run and what
   its output should say, and — prominently — any environment trap. Lead with the trap if the
   natural approach destroys the test rather than merely delaying it.
6. **P0 / P1 / P2 sections.** Number the cases continuously across all three tiers (1…N) so
   testers and bug reports can reference "test 7". Each case is a `- [ ]` checkbox item:
   - the checkbox line: **number + plain-language outcome** — "- [ ] 7. The same delivery is
     never ordered twice", not "Duplicate-guard invariant holds across cycles".
   - one-sentence plain framing of why it matters (only when it earns its place),
   - **You need**: the test data to set up, with the load-bearing condition in bold,
   - **numbered steps**: ordered, concrete, one action each,
   - **✓ Pass** and **✗ Fail**: explicit, each on its own line. Say what to do about a
     failure when it warrants escalation ("report immediately — that means a duplicate
     delivery").
   Include keyboard/accessibility expectations where the feature adds an interactive element.
7. **Surface matrix** — a table of every surface the feature could plausibly appear on:
   Surface | Shows it? | (any per-surface detail). Include the deliberate "No" rows —
   deliberately-dropped and out-of-scope surfaces — so QA doesn't file them.
8. **Known — please don't file these.** Every intentional limitation and open product
   decision, framed as "flag as feedback, not a defect". Source these from the PR
   conversation and ticket; never invent them.
9. **Footer.** The single failure mode worth escalating immediately and exactly what to
   capture for it (ids, screenshots), plus "Guide last checked against branch head `<sha>`".

## Step 4 — Deliver

- Write the markdown to the file the caller named (ReviewStage: `./qa.md` in the checkout). With
  no file named, write `qa-guide-pr<n>.md` in the working directory.
- Then say, in chat: the P0 cases in one line each, and anything you could not source.
- Nothing goes to GitHub. The human decides what to share.

**Keeping it current.** A QA guide tracks a moving branch. When the PR gains review fixes or a
new head, rewrite the same file and update: the footer SHA, any case whose behaviour changed, and
any new failure mode a review round introduced. Say in chat what you changed.

## Quality bar before you hand it over

Evidence:
- [ ] Every flag, setting, label, and string is copied from the code, not paraphrased.
- [ ] Each gate is tested independently OFF in P2.
- [ ] The surface matrix includes the "must NOT appear" rows.
- [ ] Known non-defects are sourced, not guessed.
- [ ] Branch head SHA recorded in the footer.
- [ ] Nothing is a claim you could not defend by pointing at a file or thread.

Usability — read the guide once more as if you were the tester:
- [ ] No code identifier appears anywhere except where QA must type or search it.
- [ ] Every case has numbered steps and an explicit pass **and** fail.
- [ ] Cases are numbered continuously and the tiers have plain-language names.
- [ ] A domain primer exists if the feature needs one, with a concrete worked example.
- [ ] The guide says how to trigger the thing under test, including environment traps.
- [ ] If the feature is invisible on screen, the guide says so and points at the real evidence.

If evidence is missing (no ticket access, no PR threads), say so in the chat summary and scope
the guide to what the diff alone supports — never fill gaps with plausible-sounding detail.
Likewise, name in chat any setup QA still has to supply (which tenant, which account), rather
than inventing a plausible one.

## Appendix (optional) — a shareable HTML page

Only when a human in an interactive session asks for a page or a link, and never in a headless
run: after the markdown exists, you may also render it as a Claude Code Artifact using
`template.html` next to this file as the visual skeleton (responsive, theme-aware — keep its CSS
and section order). Load the `artifact-design` skill first, title it
`QA Guide — <short feature name> (<TICKET>)`, describe it as "Tiered manual test plan for
PR #<n>", favicon `🧪`, and keep that favicon stable on redeploys. The markdown remains the
source of truth: update it first, then re-render.
