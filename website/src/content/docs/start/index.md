---
title: What ReviewStage is
description: A one-minute mental model of the human-gated review assistant.
sidebar:
  order: 1
---

ReviewStage is a self-hosted web dashboard that drafts pull-request reviews for you and lets you post them, one click at a time, under your own GitHub name. It is built on [Claude Code](https://docs.anthropic.com/en/docs/claude-code), runs on your own Claude subscription, and never posts anything you did not select.

It is a **reviewer's assistant, not a review bot**. The distinction is the whole product.

## The one-minute model

```
a PR needs your review
  └─ you open it in ReviewStage (or a Slack card brings you there)
       └─ click Start review: effort, optional focus note, model
            └─ the agent checks out the branch in a worktree and reads the real diff
                 └─ review.json — findings with file:line, severity, body   (10–15 min for ~25 files)
                      └─ you tick the findings worth posting, edit any wording
                           └─ Post to GitHub — a plain COMMENT review, as you
                                └─ Approve — a separate click, also as you
```

Three properties hold at every step:

1. **The review step cannot write to GitHub.** The script that runs the agent has no write path at all; it produces a file the dashboard renders.
2. **Every write is a signed-in human's click, with that human's own token.** There is no bot account. If a comment carries your name, you chose it.
3. **Posting defaults to a `COMMENT` review.** The agent never requests changes; a reviewer can tick *Request changes* on the post form. Approval is a second, deliberate click.

## What you get

- A **queue** of PRs awaiting your review, with tabs for *To review*, *Reviewed*, *Posted* and *Approved*, so finished work leaves the working set.
- A **PR page** with the agent's assessment, a plain-language explainer of what the PR does, its analysis, and the findings as editable cards.
- A **learnings loop**: what you drop or reword is remembered and fed into the next review of that repository.
- **Skills**: run reviews with a shared team skill or your own, score each by how often its findings are kept, and version the team standard.
- **QA guides**: a tester-ready P0/P1/P2 test plan built from the same diff and review threads.
- **Insights**: reviews, tokens, keep rate, agreement across reviewers, cycle time.

## What it deliberately does not do

- It never posts automatically, on a schedule, or on push.
- It never posts as a bot or a shared identity.
- It never requests changes.
- It does not run on every PR. A review is a full agent run and costs real tokens; you choose which PRs earn one.

## Next

- [Install](/reviewstage/start/install/) — Docker Compose in a few minutes, or from source on a Linux server.
- [Your first review](/reviewstage/start/first-review/) — from a PR URL to a posted comment.
- [Team mode](/reviewstage/start/team-mode/) — one server, every reviewer, their own name.
