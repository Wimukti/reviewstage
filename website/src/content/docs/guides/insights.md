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
| **Reviews · last Nd** | Agent runs whose result landed in the range — the current `review.json` **and** every earlier run in `history/`, each bucketed by its own finish time. |
| **Tokens · last Nd** | Input + output tokens from each run's `usage.json`, live and archived. Cache reads and cache writes are recorded but **not** added in, so the figure understates what the model actually processed. A cache hit carries a `cached` marker that zeroes it, so a replayed run is not billed twice. |
| **Kept · last Nd** | Findings the reviewer kept, verbatim or reworded, ÷ all findings that reached a post decision. |
| **PRs · reviewers** | Distinct PRs that have at least one run on disk, and distinct logins that have run one. Always all-time, never filtered by the range or narrowed by the repository picker's date logic. |

## How each number is defined

Read this before quoting any of them at anybody.

### Keep rate

**There is one definition, and both pages use it:**

`keepRate = (kept + edited) ÷ (kept + edited + dropped)`

A finding was worth posting when the reviewer kept it, verbatim or reworded. The stricter
measure — kept *unchanged* — still exists, under its own name, `verbatimRate`, so the two are
never confused. The Skills page's per-skill score and the Insights tile are the same formula on
different populations.

- **All-time is genuinely all-time.** Every outcome is added to a never-truncated tally in
  `learnings_totals.json` as it happens. The detail log `learnings.jsonl` is still capped at
  the most recent 300 rows — that is what the per-day keep series and the *What happened to
  findings* panel are drawn from, and the page says so — but the headline counts no longer
  shrink as old rows fall off. An install that predates the tally seeds it from whatever
  survives in the log and is flagged as incomplete.
- **Population.** Only findings that reached a *post* are scored, and the outcome is recorded
  after the post actually reached GitHub. A review you read and never posted contributes
  nothing, in either direction; a post retried through an outage is recorded once, not four
  times.
- **A dry run is not a post.** On the default `DRY_RUN=1` nothing is written to GitHub, so
  clicking Post decides nothing on the pull request. Those decisions *are* recorded — they are
  a real human judgement, and the learnings loop and the rule suggestions use them — but they
  are flagged `dry` and excluded from the keep rate, the verbatim rate, the per-skill scores,
  every outcome total and the per-day series. They are reported separately as `dryDecisions`, and
  the page says so: when there are any, a note above the tiles names `DRY_RUN=1`, says the
  decisions are in none of the rates below, and links to where they are listed. A two-week
  pilot on the shipped default therefore shows no keep rate rather than a keep rate about
  reviews that never happened.
- **Minimum sample.** Below **20** scored decisions no rate is shown at all — one kept finding
  is not "100%". The same floor governs the Insights tile and the per-skill table, and the API
  publishes it, so no surface invents its own.

### Kept on critical paths

The same ratio restricted to findings the agent tagged with a `critical_path` — so it needs a
[repository profile](/reviewstage/guides/repo-profile/) and a Standard or Deep review that
touched a profiled path. It comes from the same tally and obeys the same 20-decision floor;
expect it to be the sparsest number on the page.

### Agreement

**Pooled, not averaged.** Confirmed clusters and total clusters are summed across every head of
every PR, and the rate is the one division at the end:

`avgRate = confirmed ÷ total`, over all heads

- A PR with forty findings therefore carries forty findings' worth of weight, and a PR reviewed
  on three heads contributes all three rather than only its newest. The tile reports `heads`
  and `totalFindings` beside the rate, and marks itself pooled.
- Independence is by configuration, not by person: two runs with the same skill, model and
  effort are one unit however many people started them.
- **Population.** Only PRs where two or more runs exist. On most installs that is a small
  handful, and the count next to the tile is the number to look at first.
- Matching is deliberately coarse — same file, same severity bucket, within six lines, with
  real token overlap required. A finding too thin to judge is not confirmed rather than
  confirmed by default, and two file-level findings on the same path can now confirm each
  other. A "confirmed" finding is a strong candidate, not proof.

### Cycle time

The **median** of `posted.json` timestamp − `requested_at`, in seconds. The page labels it for
what it measures: *from GitHub's review request to the post*.

- The clock starts when **GitHub recorded the review request** and ReviewStage first saw it —
  the poller or the webhook writes `requested_at`. It does **not** start when the reviewer
  opened the PR or clicked Start. Most of the interval is usually a human not having got to it
  yet; it is not a measure of how fast the agent is.
- If ReviewStage was not running when the request was made, the marker is written on first
  sight, and that PR's cycle time is short by however long the gap was.
- **Population.** Only posts on PRs that carried a review request. A PR you reviewed because
  you felt like it has no `requested_at` and is excluded — and the tile reports how many posts
  were excluded rather than quietly shrinking `n`.
- **Minimum sample.** The tile prints `n`. Below about 20 the median swings on one slow PR.

### Reviews per day

Bucketed in **UTC**, on a fixed 86,400-second grid, with the labels formatted in UTC to match.
Both sides of the comparison agree, which they did not when the buckets were local midnights
walked back in fixed day steps — every daylight-saving change used to knock the generated keys
an hour off the stored ones and empty the chart. The series is 90 days long, which is also the
maximum range.

The last bar is **today**, and today is always a part-day, so it is drawn hatched with a caption
saying so — otherwise every chart ends on a dip that reads as a slowdown. The page decides that
on each point's `ts`, the bucket key the server sends, not on the formatted label beside it: a
rollup whose series stops short of today still draws a solid last bar.

## Panels

- **Review activity — per day** — reviews and tokens for the chosen range.
- **What happened to findings** — kept / reworded / dropped for the range, drawn from the
  capped 300-row detail log. The page marks it as such; the headline rate above it is not.
- **Findings by severity** — blocker, should-fix, nit, question, counted across **every** run,
  live and archived. It used to read only the current run per PR and reviewer, so the "all-time"
  chart went down over time as re-runs pushed earlier ones into `history/`.
- **By reviewer** — runs per login, all-time.
- **By model** — runs and tokens per model, over every run including archived ones, so
  switching model no longer zeroes the old one.
- **By repository** — runs, PRs and tokens per repository, all-time. Repository keys are
  lowercased, so one repository discovered under two spellings is one row.
- **Agreement across reviewers** and **Cycle time** — defined above.

## What it is for

Deciding where to spend tokens (which effort and model actually change the keep rate), and which
skill deserves to become the team default. It is not a performance review of people; the
per-reviewer panel exists so you can see who is carrying the queue, not to rank them.

None of these numbers is an outcome measure. A high keep rate means reviewers agreed with the
draft, not that the code got better; agreement means two configurations converged, not that they
were right. Use them to steer the tool, not to make a claim about defects.
