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
| **Effort** | *Quick* / *Standard* / *Deep*. Pre-selected from the diff size. Sets a depth instruction and a timeout ceiling. Typical durations are about 2–5, 3–10 and 8–25 minutes; once your install has three or more runs at a level the form shows that install's own median instead ("typically ~N min here"). *Deep* tells the agent to search the whole repository for impact before judging. |
| **Model** | Your plan's default, or *Opus* (deepest), *Sonnet* (balanced), *Haiku* (light PRs). Validated server-side. |
| **Focus** | Free text appended to the prompt on top of the skill. Use it to steer at *this* PR: "the retry path", "anything touching money". |

The form also shows **who already reviewed this commit** and with what skill, model and effort, so you can decide whether an independent run is worth the tokens.

An identical run (same commit, effort, focus, model, skill) is served from cache with zero new tokens and says so.

## While it runs

Status moves through `fetching` → `reviewing` → `done (N findings)` or `failed: …`. Runs serialise one at a time per server; a waiting run shows `queued`. **Stop** kills the run's whole process group and records `stopped`.

A run whose process has died no longer sits on `reviewing` for ever: the state is resolved from the lock, a live pid, or a short startup grace, and a progress status with nothing behind it reads `failed` with the log tail attached. Starting a run takes the same lock across the check and the spawn, so two quick clicks cannot both start an agent and leave **Stop** killing the wrong one.

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
| **Stale** | The PR's head moved since this review. Nothing re-runs automatically. It fires reliably now: the reviewed head SHA is written into the run's metadata, which it was not before — which also meant the re-run cache served the *previous* commit's findings under a banner claiming they were current. |
| **Focus** | The focus note this run used. |
| **Risk** | The PR touches paths configured as sensitive. Context only; it never gates or routes. |

## Findings

Each finding is a card:

- **Checkbox** — selected for posting.
- **Severity** — `blocker`, `should-fix`, `nit`, `question`. Rendered from a field, so the body never repeats it.
- **`file:line`** — in the new version of the file. Only lines the PR changed can carry an inline comment; a finding anywhere else is chipped **in summary** and goes into the review body instead (see [Findings outside the diff](#findings-outside-the-diff)). Anchorability is a tri-state: when the check genuinely could not run — a failed `gh pr diff`, a binary file, a file past GitHub's size cutoff — the page says so and retries, rather than reporting every finding as pointing at lines the PR does not change.
- **Reply vs New** — when an existing thread on the PR already covers this, the finding is marked as a reply and opens with an acknowledgement, so it reads as a continuation rather than a re-raise.
- **Agreement** — `✓ N independent` when other reviewers' runs with a different configuration raised it too; `only your run` otherwise.
- **Body** — editable, with a markdown preview. GitHub-flavoured: backticked symbols, fenced code, and optionally a **suggestion** (an exact one-line replacement that becomes a ```` ```suggestion ```` block the author can apply in one click).
- **Explain simply** — rewrites the finding in plain words with how to verify it. One short call on your own account, cached per finding content.

Editing a finding keeps the original alongside it. On post, each original is scored *kept*, *edited* or *dropped* for the [learnings loop](/reviewstage/guides/skills-and-learnings/).

## Findings outside the diff

A review is not confined to the diff. The [repository profile](/reviewstage/guides/skills-and-learnings/) tells it to trace the callers, the consumers and the tests of whatever changed, so the most valuable finding on a two-line PR is frequently a test that now asserts the wrong thing, or a screen that still passes the old shape. Those lines are not in the diff, and **GitHub only accepts an inline review comment on a line the PR changed** — there is nowhere to hang it.

So they go into the review body, in a `## Findings outside the diff` section: expanded, blocker first, each heading a link to the exact line on the commit the review ran against. Nothing is lost and nothing is hidden — a long tail of more than three nits or questions is the only thing that collapses.

A **suggestion** on such a finding renders as a plain `Suggested change:` code block rather than a ```` ```suggestion ```` block, because GitHub's one-click Apply cannot work off the diff and an Apply button that does nothing is worse than none.

On the PR page each affected card carries a small **in summary** chip before you post, and the post bar splits the count — `3 selected · 1 inline · 2 in the summary` — so where everything will land is never a surprise. A review whose findings are all in the summary posted correctly; it is the common shape on a small PR, not a failure.

## Posting

**Post to GitHub** sends the selected findings as one review with event `COMMENT`. Before the call:

1. Every anchor is re-validated against the diff as it stands now — the PR may have gained commits while the review sat here — so GitHub cannot reject the whole review because one `path:line` is outside it. Anything that no longer anchors moves into the body section above.
2. The GitHub reads it depends on are checked for shape and retried once; on anything odd it refuses rather than posting a degraded review. A file GitHub would not resolve is reported to you rather than silently demoted.
3. The PR is confirmed still open, on the same trip that already fetches the files.
4. The exact payload is saved with the PR so you can see what went out.

Posting is per person. Someone else posting on the same PR is their post, in their tab.

With `DRY_RUN=1` the button reports what it would have done and saves the payload, and nothing reaches GitHub.

### Posting is scoped to the run, not the pull request

The product's ordinary rhythm — review, post, the author pushes, review again, post again — now works. It did not before: a single per-(PR, reviewer) marker was set by the first post and cleared by nothing, so the second post was refused with *"Already posted to GitHub as your review"* and the post bar disappeared entirely. Worse, a review the reviewer left on GitHub's own Files tab wrote that same marker and stranded their whole staged draft.

The gate is now one entry per post this dashboard actually made, each naming the head SHA and a content hash of the run it posted. So:

- **A second round posts.** A new run on a new commit is a different run, and is never blocked.
- **The same run does not post twice.** A double-click, a replayed action link, or two tabs racing each other get one review on GitHub and a clear message for the loser. The check, the POST and the write are held under one lock.
- **A stale tab cannot post the wrong text.** The page echoes back the hash of the run it rendered. If a re-run from another device reordered the findings underneath it, the post is refused with a `409` instead of sending your edit against a different finding's file and line.
- **Nothing GitHub tells us closes the gate.** The shared "this reviewer has reviewed this PR" fact the queue and timeline read is still written, including by the webhook; it just no longer blocks you.

Two ceilings worth knowing: a review is refused above **50** comments in one all-or-nothing call, at most **25** are pre-ticked for you, and the page stops rendering beyond **250** findings.

## Approving

A separate panel. Enabled only when the PR is **open**, **not a draft**, **not yours**, and has a review on this server. Deliberately *not* gated on "still a requested reviewer": GitHub clears the request the moment any review is submitted, which would make post-then-approve impossible.

**Approval knows which commit you read.** The run records the head it reviewed. If the branch has moved since, approving is refused with the two short SHAs named — *"New commits have landed since this review ran"* — and goes through only when you tick the confirmation to approve the current commit anyway. Approving the same head twice is refused outright, because a second click would post a second approval; a new commit makes approving possible again.

The body is pre-filled with `LGTM` plus a checklist of blocker and should-fix findings (nits omitted). Edit it, then **Approve**: it posts the comment and the approval, as you. Once approved, the panel is replaced by a card showing when and with what text.

## Stacked PRs

If the PR is part of a chain where each base branch is the previous head (Graphite or ghstack style), the PR page offers **Stacked review (N PRs)** in its Actions card: it lists the whole chain top to bottom and lets you run them at one effort from one page. On a PR that is not in a chain the action is not shown at all.

## While a review is running

A review takes minutes, and you do not have to sit on the PR page waiting for it. Wherever you go, the sidebar shows a **1 review running** pill under *Review a PR* — click it to jump back (with several in flight it shows the count and opens the queue filtered to them). In your queue the PR's row shows a pulsing dot and the live progress phrase ("reviewing the diff") in place of its usual meta line, and clicking it returns you to the progress panel.

## Other actions

- **Mark done** — take a PR out of your working set without posting.
- **Archive** — hide it from your tabs.
- **Re-run** — a new run with new settings; the old one goes to history.
