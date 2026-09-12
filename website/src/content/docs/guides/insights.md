---
title: Insights
description: Reviews, tokens, keep rate, agreement and cycle time across the server.
sidebar:
  order: 5
---

**Insights** rolls up every run on the server. Pick a range (7, 30 or 90 days) at the top.

## Headline numbers

| Tile | What it counts |
| --- | --- |
| **Reviews** | Agent runs started in the range. |
| **Tokens** | Real tokens those runs used, parsed from the Claude Code stream log. Cached re-runs count zero. |
| **Kept as-is** | Share of findings posted unchanged out of all findings that reached a post decision. |
| **PRs · reviewers** | Distinct PRs and distinct people who have run reviews, all-time. |

## Panels

- **Reviews per day** — a small bar chart for the range.
- **What happened to findings** — kept / edited / dropped for the range. This is the learnings loop's raw material.
- **Findings by severity** — blocker, should-fix, nit, question, all-time.
- **By reviewer** — runs per login, all-time.
- **By model** — runs per model, with tokens.
- **Agreement across reviewers** — of the PRs where more than one person ran an independent review, how often the same finding was raised. **Independence-weighted**: it counts only when the runs used a different skill, model or effort. A high number is a signal about the findings; a low one is a signal about the skills.
- **Cycle time** — how long between a review being requested and the comments being posted, for PRs that reached a post. Lagging by nature.

## What it is for

Deciding where to spend tokens (which effort and model actually change the keep rate), and which skill deserves to become the team default. It is not a performance review of people; the per-reviewer panel exists so you can see who is carrying the queue, not to rank them.
