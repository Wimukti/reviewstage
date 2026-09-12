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

1. **Header** — PR, ticket, scope, and a plain-language standfirst.
2. **Domain primer** when the feature needs a concept explained, with a worked example.
3. **What changes on screen**, stated plainly, including when the change is invisible and where the real evidence is.
4. **Before you start** — flags, settings, test data, viewports.
5. **How to run it** when the change is not triggered by ordinary clicking.
6. **P0 · Test these first** — failures that defeat the purpose or silently corrupt what the user sees, plus anything the review history marked fragile.
7. **P1 · Does the feature work** — the advertised behaviours.
8. **P2 · Check nothing else broke** — every gate independently off, un-gated users see no change, shared components unchanged elsewhere.
9. **Surface matrix** with the deliberate "must not appear" rows.
10. **Known — please don't file these**, sourced from the PR conversation.
11. **Footer** — the one failure to escalate immediately, and the branch head the guide was checked against.

Cases are numbered continuously so bug reports can say "test 7". Every case has the data you need, ordered steps, and an explicit pass and fail.

## Output

GitHub-flavoured markdown, rendered on the page and copyable. Recent guides are listed with their PR titles, which are cached so they survive the PR leaving the queue.
