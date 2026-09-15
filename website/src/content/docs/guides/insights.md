---
title: Insights
description: Reviews, tokens, keep rate, agreement and cycle time across the server.
sidebar:
  order: 5
---

**Insights** rolls up every run on the server.

## Headline numbers

Pick 7, 30 or 90 days at the top. The first three tiles are computed from a per-day series, so
they respect that range; **PRs · reviewers** does not, and neither does the *all-time* figure
printed under the keep rate.

| Tile | What it counts |
| --- | --- |
| **Reviews · last Nd** | Agent runs whose result landed in the range — the current `review.json` plus every kept run in `history/`, one per reviewer per PR. |
| **Tokens · last Nd** | Input + output tokens from each run's `usage.json`. Cache reads and cache writes are recorded but **not** added in, so the figure understates what the model actually processed. A cached re-run adds nothing. |
| **Kept as-is · last Nd** | Findings posted unchanged ÷ all findings that reached a post decision, in the range. The small *all-time* figure beneath it is the same ratio over the whole log — see the cap below. |
| **PRs · reviewers** | Distinct PRs that have at least one run on disk, and distinct logins that have run one. Always all-time, never filtered by the range or narrowed by the repository picker's date logic. |

## How each number is defined

Read this before quoting any of them at anybody.

### Keep rate

`kept ÷ (kept + edited + dropped)`, over `learnings.jsonl`.

- **A reworded finding counts as a miss.** The Skills page's per-skill score uses a *different*
  formula — `(kept + edited) ÷ total`, on the grounds that a finding worth rewording was worth
  raising. The two numbers are both called a keep rate, they are both correct for their purpose,
  and they will not match. When they are quoted side by side, say which is which.
- **"All-time" is capped.** `learnings.jsonl` keeps only the **most recent 300 rows** across
  every repository and every reviewer. On a busy install the all-time keep rate is the keep rate
  of the last 300 findings, and older history is gone rather than averaged in.
- **Population.** Only findings that reached a *post* are scored; a review you read and never
  posted contributes nothing, in either direction.
- **Minimum sample.** Under about 20 scored findings the number moves several points per
  decision. Treat it as unreadable below that, and do not compare two skills until each has 50.

### Kept on critical paths

The same ratio restricted to findings the agent tagged with a `critical_path` — so it needs a
[repository profile](/reviewstage/guides/repo-profile/) and a Standard or Deep review that
touched a profiled path. It is usually a small subset of an already-capped log; expect it to be
the noisiest number on the page.

### Agreement

The **unweighted mean of per-PR agreement rates** — not a rate over findings.

- One PR's rate is *clusters confirmed by two or more independent configurations ÷ all clusters
  on that PR*, taken from the most recent agreement file written for it.
- Independence is by configuration, not by person: two runs with the same skill, model and
  effort are one unit however many people started them.
- Because the per-PR rates are averaged unweighted, a PR with three findings counts exactly as
  much as one with forty.
- **Population.** Only PRs where two or more runs exist. On most installs that is a small
  handful; the tile prints the count next to it, and that count is the number to look at first.
- **Minimum sample.** Below roughly ten multi-reviewer PRs the mean is anecdote. Matching is
  deliberately coarse (same file, severity bucket, within six lines, a little body-token
  overlap), so a "confirmed" finding is a strong candidate, not proof.

### Cycle time

The **median** of `posted.json` timestamp − `requested_at`, in seconds, over every
reviewer-and-PR pair that has both.

- The clock starts when **GitHub recorded the review request** and ReviewStage first saw it —
  the poller or the webhook writes `requested_at`. It does **not** start when the reviewer
  opened the PR or clicked Start. So it measures request-to-posted latency, most of which is
  usually a human not having got to it yet, and it is not a measure of how fast the agent is.
- If ReviewStage was not running when the request was made, the marker is written on first
  sight, and that PR's cycle time is short by however long the gap was.
- **Population.** Only pairs that reached a post. Reviews read and not posted, and posts on PRs
  nobody formally requested, are both absent — which biases the median towards work that went
  smoothly.
- **Minimum sample.** The tile prints `n`. Below about 20 the median swings on one slow PR.

### Reviews per day

Bucketed by the run's completion time in the **server's local timezone**, and the series is 90
days long — the 90-day range is the maximum, and there is no way to see further back on this
page.

## Panels

- **Review activity — per day** — reviews and tokens for the chosen range.
- **What happened to findings** — kept / edited / dropped for the range. This is the learnings
  loop's raw material, and the same 300-row cap applies.
- **Findings by severity** — blocker, should-fix, nit, question, counted from each reviewer's
  *current* `review.json` only; earlier runs in `history/` are not re-counted. All-time.
- **By reviewer** — runs per login, all-time.
- **By model** — runs and tokens per model, from `usage.json`.
- **By repository** — runs, PRs and tokens per repository, all-time.
- **Agreement across reviewers** and **Cycle time** — defined above.

## What it is for

Deciding where to spend tokens (which effort and model actually change the keep rate), and which
skill deserves to become the team default. It is not a performance review of people; the
per-reviewer panel exists so you can see who is carrying the queue, not to rank them.

None of these numbers is an outcome measure. A high keep rate means reviewers agreed with the
draft, not that the code got better; agreement means two configurations converged, not that they
were right. Use them to steer the tool, not to make a claim about defects.
