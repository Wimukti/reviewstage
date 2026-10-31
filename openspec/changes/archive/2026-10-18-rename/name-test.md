# Blind name test — KeepDrop · DiffKeeper · PeerLayer

Purpose: pick the product's new name from comprehension, trust, recall, spelling and collision
risk measured on developers who have never seen the product. Not from preference. 10–15
participants; 12 minutes each; async (a form) or live (a call). Dates MM/DD/YY.

## Who to recruit

Developers who review pull requests on GitHub at work and have used at least one coding agent
(Claude Code, Codex, Copilot, Cursor). Exclude anyone who has seen reviewstage.dev, the repo,
the video or the launch drafts. Mix: ≥ 4 senior/staff, ≥ 3 who are not native English speakers,
≥ 2 on Linux. Where to find them without leaking the product: former colleagues, the Cut+Dry
engineering team members who have not seen the project, university cohort, r/ExperiencedDevs
and r/ClaudeCode members via DM ("12-minute naming study for a developer tool, no pitch").

## Protocol (run in this order; do not explain any name before Part C)

**Part A — cold comprehension (one name at a time, randomised order per participant).**
Show the name alone, as it would appear in a terminal and on a GitHub repo card:

```
npx keepdrop            github.com/<you>/keepdrop
npx diffkeeper          github.com/<you>/diffkeeper
npx peerlayer           github.com/<you>/peerlayer
```

For each: Q1 "What do you think this product does? One sentence." Q2 "What kind of product is
it — pick one: backup/storage · diff viewer · code review · deleting/cleaning code · peer
review of people · networking · don't know."

**Part B — distraction.** Two unrelated questions (3 minutes): "What's the last PR you reviewed
that was mostly agent-written?" and "What made you trust or distrust the review bot comments
you've seen?" (Their answers are also design-partner recruiting signal — note the strong ones.)

**Part C — recall and spelling.** Without showing the names again: Q3 "Which of the three names
do you remember? Type them." Q4 "Type the install command for the one you remember best."
Score exact spelling (`npx keepdrop` etc.).

**Part D — with the descriptor.** Now show each name with the category line:

> **KeepDrop** — the human review layer for AI-written pull requests.
> **DiffKeeper** — the human review layer for AI-written pull requests.
> **PeerLayer** — the human review layer for AI-written pull requests.

Q5 "Which would you trust most in a professional GitHub workflow — as the name a review you
post to your teammates is associated with? Rank 1–3." Q6 "Does any of these sound like a
product that already exists, or like a different kind of product? Which, and what?" Q7 (free)
"Anything you'd never want to type in a terminal here?"

## Scoring (fill one row per participant; then total)

| Metric | Source | Points |
| --- | --- | --- |
| Comprehension | Q1/Q2: category = "code review" | 2 per name |
| Wrong-category penalty | Q2: backup/storage, deleting code, diff viewer, peer review of people | −2 per name |
| Recall | Q3: name recalled unprompted | 2 |
| Spelling | Q4: command exactly right | 1 |
| Trust | Q5 rank: 1st = 2, 2nd = 1, 3rd = 0 | 0–2 |
| Collision | Q6 names an existing product | −3 |

Decision rule: highest total wins **if** its wrong-category rate is ≤ 30% and no participant
named a real existing developer product for it. If no name passes both, drop the worst and test
two new candidates from the clean list (`prattest`, `reviewverdict`) the same way.

## Response form (paste into Google Forms / Tally; one section per part)

```
Section A1  [name shown alone, randomised]
  What do you think this product does? (short answer)
  What kind of product is it? (single choice) backup/storage · diff viewer · code review ·
    deleting/cleaning code · peer review of people · networking · don't know
Section A2, A3  [same two questions for the other two names]
Section B
  What's the last PR you reviewed that was mostly written by a coding agent? (paragraph)
  What made you trust or distrust review-bot comments you've seen? (paragraph)
Section C
  Which of the three names do you remember? Type them. (short answer)
  Type the install command (npx …) for the one you remember best. (short answer)
Section D  [three names shown with the descriptor]
  Rank by how much you'd trust it in a professional GitHub workflow. (ranking)
  Does any sound like an existing product or a different kind of product? Which, what? (paragraph)
  Anything you'd never want to type in a terminal here? (short answer)
Section E
  Years reviewing PRs professionally · coding agents you use · OS · native English? (y/n)
  May we contact you about trying the product for three real PRs? (y/n + handle)
```

## Diligence to run on the winner before purchase (maintainer)

Web search exact and near-exact (`keep drop`, `keep-drop`); GitHub users/orgs/repos/topics;
npm (`npm view <name>`), PyPI, crates.io; `.dev` `.app` `.com` `.io`; X, LinkedIn, YouTube,
Reddit, Product Hunt handles; Apple App Store and Google Play; WIPO Global Brand Database;
USPTO TESS, EUIPO, UKIPO, Sri Lanka NIPO; company registries for planned markets; adjacent
developer products using the word. Product diligence, not legal advice — get a trademark
professional's view before relying on the name commercially.

Known as of 10/10/26: KeepDrop → only a defunct Android file-transfer app (removed from Play,
last updated 10/16/21); R/pandas "keep/drop columns" is generic terminology, not a product.
DiffKeeper → no product; Diffchecker is a different word. PeerLayer → no product; HumanLayer
(11.7k ★) makes the "-layer" pattern crowded.
