# Lane 2 — dismissal reasons

Proposal, design and what shipped, in one file. `recon.md` §"Lane 2" is the reconnaissance this
was built from; where the two differ, this file says what is actually in the tree. Shipped
10/11/26 on branch `p0-reasons`, on top of lane 3 (`lane3-verify.md`: finding cards carry
confidence and how-to-verify; this lane adds nothing to the card's contract and one row under it).

## Why

Every drop is a labelled example the product already stores (`rs_learn.record`, outcome
`dropped`), and every one of them is the same label: *not posted*. That is enough to steer the
next prompt and to cluster repeats into a proposed rule, but it cannot tell apart the four very
different things a reviewer means by an untick — the finding was wrong; it was right but about
nothing that matters here; it was right and the author had already fixed it; the run said it
twice. Two of those are evidence for a standing rule. Two are evidence about one pull request
and nothing else, and today they are clustered and proposed exactly like the others. A rule
drafted from "already handled" drops is a rule that tells the reviewer to stop checking
something the team does check.

The reason also makes the Learnings page honest about *what kind* of noise the run produces,
which is what a later telemetry lane wants to count (`dismissal_reason`), and what the prompt
block can hand back to the agent in one word.

## Non-negotiable properties touched

None. The reason rides the existing `/api/post` body and is written only where
`rs_learn.record` already writes — after the POST, or in the dry-run branch — so the ordering
`_learn`'s docstring warns about is unchanged. Nothing new posts to GitHub; the reason is never
part of the comment. It is one more field on a per-reviewer record (property 5 holds: rows carry
`user` as before).

## Design

### 1. Taxonomy — one list, two copies, one parity test

`rs_learn.REASONS = ("incorrect", "irrelevant", "already_handled", "style_nit",
"lacks_context", "duplicate", "not_worth_raising")`; `REASON_LABELS` for the prompt block;
`UNSPECIFIED = "unspecified"` for drops without one; `SITUATIONAL_REASONS = {already_handled,
duplicate}`. `dashboard-ui/src/api.ts` mirrors the ids as `REASONS` (`Reason` type,
`REASON_LABELS` UI copy, `isReason`, `reasonLabel`). `src/api.test.ts` reads `bin/rs_learn.py`
and asserts the two tuples are identical, id for id, in order.

### 2. The drop stays instant

Nothing about a tick, an untick or a swipe changed. The question comes *after* the decision:

- **Desk** (`FindingCard`, `ReviewParts.tsx`): when the card goes from checked to unchecked,
  a `ReasonChips` row renders under the head — muted "Why?", seven chips, a ✕ — for
  `REASON_ROW_MS = 6000` or until the next decision on any card. The row is a `role="group"`
  of real buttons; Escape (or ✕) closes it. One tap collapses it to `Dropped · <reason> ✕`,
  which stays while the card stays unchecked; re-ticking clears the reason. The row sits under
  the head, not in it: the head's badge count is a thing the existing specs assert.
- **Phone** (`PhoneReview.tsx`): the dropped one-liner stays one line (the existing ≤ 52 px
  assertion). The chips are a `PhoneReasonBar` fixed above the Post pill, which is above the
  tab bar, all offset by `--ios-gap` exactly as the pill is; horizontally scrollable, 44 px
  chips. The dropped line carries the answer as a chip, or a **Why?** chip that opens the bar
  again. Recon put this in the ⋯ menu; the ⋯ menu is on the live card and the dropped line has
  none, so the affordance lives on the line itself. Restore forgets the reason and closes the bar.
- **State** lives in `PrPage.tsx`: `reasons: Record<number, Reason>` and `askReason: number |
  null`, driven by `ReasonPrompt` (`src/reasonPrompt.ts`) — a tiny class with injected timers
  so the 6 s / next-decision behaviour is unit-tested on fake timers. `toggle` asks only on an
  explicit untick; `drop` asks; `keep`, `restore` and a re-tick call `decided()`.

### 3. Wire and storage

`api.post` gains `reasons?: Record<number, Reason>`. In `server.py`, `post_reasons(body)`
coerces the map (anything but a dict is `{}`), `unknown_reason(body)` names the first id outside
`rs_learn.REASONS` and the route answers **400** `Unknown dismissal reason: …` before anything
else happens. `_post_form` forwards `form["reason_i"]` **only for indices not in `selected`**.
`rs_learn.record` writes `row["reason"]` when the outcome is `dropped` and the id is known.
Nothing else in the row changes; old rows, old clients and old servers all read as before.

### 4. Counting and clustering

- `_apply_row` adds `slot["reasons"][reason or "unspecified"] += sign` on every tally slot a
  dropped row touches (global, repo, skill, day). The key is additive: `TOTALS_VERSION` stays 1,
  `rebuild_totals` and `load_totals` need no change, old tallies simply lack the key until the
  next drop. A retry under the same `key` undoes its reasons with its rows.
- **`rs_learn.reason_counts(skill=None)`** — the readout: every id in `REASONS` (zero when
  never chosen) plus `unspecified`, all-time from the tally, globally or per skill. This is the
  function a telemetry counter named `dismissal_reason` reads from. `api_learnings` exposes it
  as `reasons`.
- `_cluster_info` adds `reasons: {id: n}` and `topReason` (commonest *stated* reason, `""` when
  nobody said); each `findings[]` entry carries its `reason`. **`_same_group` is unchanged** —
  the reason is not part of a cluster's identity, so a complaint half the team marks
  *incorrect* and half *irrelevant* is still one cluster with the signature the reason-less
  rows minted (pinned by a test).
- `rs_learn.proposable(cluster)` is false when `topReason ∈ SITUATIONAL_REASONS`;
  `rule_suggestions` skips those. `_house_prompt` tells the drafter the top reason, and for
  `lacks_context` steers the rule towards "read the surrounding code before raising this".
- `render()` appends the label to a dropped gist: `- [nit] src/Badge.tsx:10 — Prefer const
  over let (style nit)`.

### 5. Readouts

Learnings page: a reason mark beside the outcome on dropped rows; a **Why findings are
dropped** card (bar per reason, count and share to one decimal, "No reason given" last) from
`reasons`; a top-reason mark on cluster cards. Skills page: a top-reason mark on each suggested
rule. Insights/rollup was left alone — the Learnings card is the one place that answers the
question, and the rollup's keep-rate series does not change.

## How this is proven

The real-GitHub scenario this would have caught: a reviewer on a live repo unticks the same
"missing null guard" finding on three PRs because the author had already pushed the fix each
time, and the Skills page proposes "Do not raise missing null guards" — a rule that silences a
real check. With reasons, those three drops carry `already_handled`, the cluster's `topReason`
is situational, and no rule is offered; the same three drops marked `incorrect` are offered.

Tests, all in the tree and green:

- `bin/test_rs_learn.py` `DismissalReasons` (15): row with/without reason, unknown id not
  stored, reason on a kept finding ignored, tally per reason and per skill, retry replaces,
  `rebuild_totals` on mixed old/new rows, a tally written before reasons existed still loads,
  cluster `reasons`/`topReason`, old-row cluster has none, reason not part of identity,
  situational vs. proposable, `cluster_status` top reason, `render()` suffix.
- `bin/test_rs_post.py`: `_post_form` forwards a reason for dropped indices only, malformed
  maps are ignored, unknown id named, reason reaches the learning row and the counts; the route
  end to end 400s `meh` and accepts `not_worth_raising`; `rule_suggestions` skips
  `already_handled`/`duplicate` and offers every other reason and no reason;
  `_house_prompt` carries the `lacks_context` hint.
- `dashboard-ui/src/reasonPrompt.test.ts` (fake timers): asks, closes at 6000 ms and not at
  5999, next decision closes at once and the stale timer never fires, a second drop restarts.
- `src/findingCard.test.ts`: the desk card is unticked and asking in one render; no row when
  not asked, ticked, or for a caller without `onReason`; the picked chip; the phone line's
  Why?/answer chips; `ReasonChips` button counts. `src/api.test.ts`: taxonomy parity, helpers,
  `api.post` carries `reasons`.
- `e2e/pr-page.spec.ts` "dismissal reasons" (3): untick → instant drop → row under the head →
  pick → chip → posted body `reasons == {"1": "style_nit"}`; `page.clock` expiry at 6 s,
  next-decision close, re-tick clears; Tab reaches the chips, Escape and ✕ close.
  `e2e/mobile-screens.spec.ts` (2): swipe-drop → bar above pill and tab bar, 44 px chips,
  line still ≤ 52 px → pick → line marked → change/clear/reopen → posted `reasons`; expiry,
  Restore, keep never asks. `e2e/mobile-shell.spec.ts` (1): in the iOS cold-launch state
  (`--ios-gap: 62px`) the bar is above the pill and the tab bar.

## What shipped

`bin/rs_learn.py`, `bin/server.py`, `bin/test_rs_learn.py`, `bin/test_rs_post.py`,
`dashboard-ui/src/{api.ts,reasonPrompt.ts,ReviewParts.tsx,PhoneReview.tsx,PrPage.tsx,Learnings.tsx,Skills.tsx}`,
`dashboard-ui/src/{reasonPrompt,findingCard,api}.test.ts`,
`dashboard-ui/e2e/{pr-page,mobile-screens,mobile-shell}.spec.ts`,
`website/src/content/docs/guides/skills-and-learnings.mdx`, this file. No fixture change was
needed: the shipped PR fixture's two findings are the two cards the specs drop.

## Out of scope, left open

- Insights/rollup has no reason chart; `reason_counts()` is there when it wants one.
- The telemetry lane's `dismissal_reason` counter should read `rs_learn.reason_counts()`
  (per install, no user), not the detail log.
- A dismissed-then-promoted cluster's recorded `topReason` is not stored on the promotion
  record; `promote()` was not changed.
