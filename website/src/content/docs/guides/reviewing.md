---
title: Reviewing a PR
description: The run form, effort, focus, findings, posting and approving in detail.
sidebar:
  order: 1
---

This is the reference for the PR page. For the guided walk-through, see [Your first review](/reviewstage/start/first-review/).

## Addressing a PR

A PR page is `/pr?repo=owner/name&pr=123`; the header reads `owner/name #123` and the breadcrumb's repository link filters the queue to that repository. The shorter `/pr?pr=123` still works when the server reviews one repository, or when that number exists under exactly one of them; otherwise the page offers a repository picker. In the paste box and the command palette (⌘K) you can paste a GitHub PR URL (the repository is derived from it), `owner/name#123`, or a bare number — with several repositories configured a bare number shows a picker.

## The run form

Starting a review is a small form, not a link, because a review is a real agent run on your subscription.

| Field | What it does |
| --- | --- |
| **Effort** | *Quick* / *Standard* / *Deep*. Pre-selected from the diff size. Sets the time budget (about 12, 25 or 40 minutes) and a depth instruction. *Deep* tells the agent to search the whole repository for impact before judging. |
| **Model** | Your plan's default, or *Opus* (deepest), *Sonnet* (balanced), *Haiku* (light PRs). Validated server-side. |
| **Focus** | Free text appended to the prompt on top of the skill. Use it to steer at *this* PR: "the retry path", "anything touching money". |

The form also shows **who already reviewed this commit** and with what skill, model and effort, so you can decide whether an independent run is worth the tokens.

An identical run (same commit, effort, focus, model, skill) is served from cache with zero new tokens and says so.

## While it runs

Status moves through `fetching` → `reviewing` → `done (N findings)` or `failed: …`. Runs serialise one at a time per server; a waiting run shows `queued`. **Stop** kills the run's whole process group and records `stopped`.

## The result

- **Assessment.** Two to four sentences: is it safe to merge, and the minimum change set. Shown to you only; never becomes a GitHub state.
- **What this PR does.** A junior-engineer-level explainer.
- **Analysis.** What was checked, what was dropped after being falsified, the file-by-file change list.
- **Findings.** See below.
- **Skill, model and tokens** for this run, and which Claude account it ran on.
- **History.** Earlier runs of the same PR, each openable read-only. Re-running never overwrites.

### Banners

| Banner | Meaning |
| --- | --- |
| **Stale** | The PR's head moved since this review. Nothing re-runs automatically. |
| **Focus** | The focus note this run used. |
| **Risk** | The PR touches paths configured as sensitive. Context only; it never gates or routes. |

## Findings

Each finding is a card:

- **Checkbox** — selected for posting.
- **Severity** — `blocker`, `should-fix`, `nit`, `question`. Rendered from a field, so the body never repeats it.
- **`file:line`** — in the new version of the file. Only lines the PR changed can carry an inline comment; anything else is demoted into the summary body at post time.
- **Reply vs New** — when an existing thread on the PR already covers this, the finding is marked as a reply and opens with an acknowledgement, so it reads as a continuation rather than a re-raise.
- **Agreement** — `✓ N independent` when other reviewers' runs with a different configuration raised it too; `only your run` otherwise.
- **Body** — editable, with a markdown preview. GitHub-flavoured: backticked symbols, fenced code, and optionally a **suggestion** (an exact one-line replacement that becomes a ```` ```suggestion ```` block the author can apply in one click).
- **Explain simply** — rewrites the finding in plain words with how to verify it. One short call on your own account, cached per finding content.

Editing a finding keeps the original alongside it. On post, each original is scored *kept*, *edited* or *dropped* for the [learnings loop](/reviewstage/guides/skills-and-learnings/).

## Posting

**Post to GitHub** sends the selected findings as one review with event `COMMENT`. Before the call:

1. Every anchor is validated against the actual diff, so GitHub cannot reject the whole review because one `path:line` is outside it.
2. The GitHub reads it depends on are checked for shape and retried once; on anything odd it refuses rather than posting a degraded review.
3. The exact payload is saved with the PR so you can see what went out.

Posting is per person. Someone else posting on the same PR is their post, in their tab.

With `DRY_RUN=1` the button reports what it would have done and saves the payload, and nothing reaches GitHub.

## Approving

A separate panel. Enabled only when the PR is **open**, **not a draft**, **not yours**, and has a review on this server. Deliberately *not* gated on "still a requested reviewer": GitHub clears the request the moment any review is submitted, which would make post-then-approve impossible.

The body is pre-filled with `LGTM` plus a checklist of blocker and should-fix findings (nits omitted). Edit it, then **Approve**: it posts the comment and the approval, as you. Once approved, the panel is replaced by a card showing when and with what text.

## Stacked PRs

If the PR is part of a chain where each base branch is the previous head (Graphite or ghstack style), **Stacked review** lists the whole chain top to bottom and lets you run them at one effort from one page.

## Other actions

- **Mark done** — take a PR out of your working set without posting.
- **Archive** — hide it from your tabs.
- **Re-run** — a new run with new settings; the old one goes to history.
