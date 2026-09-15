---
title: QA guides
description: Turn a PR into a tester-ready P0/P1/P2 test plan.
sidebar:
  order: 3
---

The **QA guides** page builds a manual test guide for a PR: what to set up, what to test first, where the change must not appear, and what not to file as a bug. It is for a tester who has never seen the code.

## Generate one

Enter a PR number on the QA page and click **Generate**. It needs your Claude account connected: the guide runs on your subscription, in its own worktree, and never writes to GitHub. Guides share the server's one-heavy-job-at-a-time lock with reviews, so it may show *waiting for another job to finish first*. You can **Stop** it.

## What it reads

The guide is derived from evidence, not the PR description:

- the diff and the surrounding code (flags, settings, every surface that renders the change, adjacent surfaces that must *not* change);
- the PR conversation and inline review threads, which become the risk map;
- the branch's commit history, since late fix-after-review commits mark the least-exercised paths;
- how a tester actually triggers the change in the target environment, including scheduled jobs and environment traps.

## Structure

A guide is assembled from these parts, in this order. Two of them appear only when the change
calls for them:

1. **Header** — the PR number, any ticket IDs, the scope or pilot audience, and a
   plain-language line saying what the change is.
2. **Domain primer** — *only when understanding the feature needs a concept the tester does not
   have* (a cut-off rule, a billing cycle, an inventory state machine), with a worked example.
   Most PRs do not get one.
3. **What changes on screen** — stated plainly, including the case where nothing visibly
   changes and the real evidence is a log line, an export or a database row.
4. **Before you start** — flags, settings, test data, accounts, viewports; exact names, in
   `code`.
5. **How to run it** — *only when the change is not triggered by ordinary clicking*: a scheduled
   job, a queue worker, a webhook, an import.
6. **P0 · Test these first** — failures that defeat the purpose of the change or silently
   corrupt what the user sees, plus anything the PR's review history marked fragile.
7. **P1 · Does the feature work** — the advertised behaviours.
8. **P2 · Check nothing else broke** — each gate independently off, un-gated users see no
   change, shared components unchanged elsewhere.
9. **Surface matrix** — a table of every surface the change could plausibly appear on, including
   the deliberate *must not appear* rows.
10. **Known — please don't file these** — intentional limitations and out-of-scope surfaces,
    sourced from the PR conversation.
11. **Footer** — the one failure worth escalating immediately, and the branch head SHA the guide
    was checked against.

Cases are numbered continuously across P0, P1 and P2 (1…N) so a bug report can say "test 7".
Every case is a `- [ ]` checkbox item carrying the data it needs, ordered steps, and an explicit
pass and fail.

:::caution[What is actually guaranteed today]
The eleven parts above are what the `pr-qa-guide` skill specifies. The prompt `bin/run-qa.sh`
sends asks for five of them by name — the what-this-is line, *Before you start*, the surface
matrix, the numbered P0/P1/P2 cases, and *Known — please don't file these* — and leaves the rest
to the skill. In practice that means the domain primer, *What changes on screen*, continuous
numbering across tiers and the branch-head footer are **not reliably produced**, because nothing
in the prompt asks for them.

A parallel change is aligning the skill and the prompt so the prompt defers to the skill's
structure. Until that lands, treat items 2, 3, 11 and the continuous numbering as
best-effort — and if a guide you generate is missing one, that is why, not a bug in your PR.
:::

Headless note: the skill's own publishing step does not apply here. `run-qa.sh` runs the agent
with no Artifact tool and tells it to write GitHub-flavoured markdown to `qa.md` instead, which
is what the QA page renders.

## Output

GitHub-flavoured markdown, rendered on the page and copyable. Recent guides are listed with their PR titles, which are cached so they survive the PR leaving the queue.
