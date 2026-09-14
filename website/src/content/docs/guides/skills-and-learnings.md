---
title: Skills and learnings
description: Which skill runs your reviews, how the team default evolves, and what the learnings loop actually does.
sidebar:
  order: 2
---

## Two ideas

A **skill** is the review procedure: a Claude Code skill file that tells the agent how to read the PR, what to check, and how to decide reply-vs-new. **Learnings** are your team's recent accept/reject decisions, folded into the next prompt so the agent stops raising what you drop.

## Skills

### Which skill runs your reviews

The **Skills** page has one selector:

- **Team default** — a shared, editable skill seeded from the built-in `pr-review` skill. Everyone's reviews use it unless they opt out.
- **Your own skill** — a skill you pasted in *Integrations*. Only your reviews use it.

ReviewStage runs the chosen skill's logic and **always appends its own output contract**, so any Claude Code review skill works: the agent must end by writing a `review.json` with the assessment, explainer, analysis and a `comments` array of `path`, `line`, `severity`, `body`, `reply_to`, and an optional `suggestion`.

### Editing the team default

The team default is a file, edited in the browser. Guard rails:

- It **cannot be blanked**. Saving an empty skill is refused.
- **Restore built-in** replaces it with the installed skill and requires a typed confirmation.
- Every save is a **commit** in a small git repository on the server, with the editor's login and a summary. The **Revision history** panel shows how the team standard evolved.

### Quick-add a rule

Type a preference in plain words — *"don't ask for a ticket link in code comments"* — and it is tidied into a managed **Team rules** section at the end of the skill. You do not edit the whole file to add one rule.

### Scoring

Each review records which skill ran it. On post, each finding is scored kept / edited / dropped, tagged with that skill. **How each skill scores** shows the keep rate per skill. It is a signal for improving the team default, not a leaderboard; a skill that produces many findings with a low keep rate is a skill that costs reviewers time.

### Repository profile

Alongside the per-repository skill, the Skills page holds a **repository profile**: the paths where a mistake hurts most, the checks a reviewer must perform when a PR touches one, the repository's risk paths and its rules. It is built once from deterministic signals plus one Sonnet call, validated against the tree, and editable in the same markdown editor. Standard and Deep reviews that touch a profiled path are told to walk it explicitly. See [Repository profile](/reviewstage/guides/repo-profile/).

## Learnings

On every post, each original finding is recorded as one of:

| Outcome | Meaning |
| --- | --- |
| **Kept as-is** | Selected and posted unchanged. |
| **Reworded** | Selected, but the body was edited first. |
| **Dropped as noise** | Not selected. |

A short gist of each is appended to a per-repository learnings log (capped). When the next review of that repository starts, the recent *dropped* and *reworded* rows are rendered into the prompt: "the team has recently rejected findings like these; do not raise them again unless the code makes them unavoidable."

This is **not machine learning**. It is in-context steering with your own recent decisions, shared per repository and attributed per user. The **Learnings** page shows the counts and the recent decisions so you can see what the agent is being told.

### From a repeated rejection to a proposed rule

A rolling window forgets. A finding you dropped six times still arrives on review seven, because the last forty decisions are a preference, not a standard. So repetition is promoted deliberately.

1. **Clustering.** Dropped rows — and separately reworded ones — are grouped into complaints. Two findings are the same complaint when they carry the same severity, sit under the same top-two directory segments, and their gists share vocabulary: stopwords dropped, words stemmed crudely, and at least half of the shorter gist's significant words present in the other, with a floor of two shared words. It is cheap, dependency-free string work, in the same spirit as the agreement matching — coarse on purpose.
2. **Qualifying.** A cluster becomes evidence at `RULE_SUGGEST_MIN` findings (default 3) from **at least two different PRs**. Three drops on one pull request is one bad day; three across three is a pattern. A cluster an existing Team rule already covers — checked with the same similarity function — is never offered again.
3. **Drafting.** One Claude call, on the account of whoever opened the page, turns the cluster's gists into a single imperative sentence in the house style of the rules already in the skill, plus a one-line rationale. It is cached against the cluster's signature, so reopening the page costs nothing. With no Claude account connected, the cluster still appears with its evidence and simply has no drafted sentence.
4. **Deciding.** The **Suggested rules** section at the top of the Skills page shows each proposal: the sentence, the rationale, the count in words (*"from 4 findings you dropped across 3 PRs"*), and an expandable list of the actual findings, each linking to its PR.
   - **Accept** appends it through the same quick-add path a hand-typed rule uses: a bullet in `## Team rules`, committed to the skills repository with you as the author and the evidence count in the message. Cross-repository evidence goes to the team default; evidence from a single repository goes to that repository's own team default, but only when one already exists — accepting a rule must never create an override that silently displaces the shared skill.
   - **Dismiss** records the cluster so it is not offered again. Dismissed suggestions stay behind a **Show dismissed** toggle with an **Undo**.

**Nothing is ever written to a skill without a click.** The model drafts; a person decides.

Once a cluster is promoted, its rows leave the rolling prompt block — the rule carries them now, and the forty-row window is spent on newer signal. The block says so in its preamble. The **Learnings** page lists each cluster as a *rolling preference* or *promoted to a rule*, and [Insights](/reviewstage/guides/insights/) counts the rules promoted from evidence, so you can watch the memory harden instead of guessing.

## Agreement across reviewers

When more than one reviewer runs the same commit, findings are matched across runs. A finding is **confirmed** when it was raised by runs with a *different* skill, model or effort; two runs of the same configuration do not confirm each other. The PR page shows `✓ N independent` on such findings and an overall convergence rate. It is a signal to build on, not a score.
