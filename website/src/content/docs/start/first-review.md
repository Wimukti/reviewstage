---
title: Your first review
description: From a PR URL to a posted comment, with the dry run in between.
sidebar:
  order: 3
---

Keep `DRY_RUN=1` for this. Everything works except the final write to GitHub, which is exactly what you want while you decide whether the output is good enough to carry your name.

## 1. Open a PR

Paste a PR URL or number into **Review a PR** in the sidebar. If the poller is running (team profile) the PR may already be in your **To review** tab.

## 2. Start the review

The run form asks three things:

- **Effort** — *Quick*, *Standard* or *Deep*. One is pre-selected from the diff size. It changes how far the agent reads (typically 2–5, 3–10 or 8–25 minutes; the form shows your install's own median once it has enough runs); *Deep* searches the whole repository for impact before judging.
- **Model** — your plan's default, or Opus, Sonnet or Haiku for this run.
- **Focus** (optional) — a sentence like *"pay attention to the cut-off maths"*, folded into the prompt on top of the skill.

If someone else already reviewed this exact commit, the form says so and shows their effort, model and skill, so you can choose to run independently or read theirs.

Click **Start review**. The page shows `fetching`, then `reviewing`. A 25-file PR takes 10 to 15 minutes. You can **Stop** it from the progress panel. Reviews run one at a time per server; a second one shows `queued`.

## 3. Read the result

The PR page opens with a timeline (`Reviewed · Comments posted · Approved`), then:

- **Assessment** — the agent's verdict in two to four sentences. It is shown as an *assessment*; it never becomes a review state on GitHub.
- **What this PR does** — a plain-language explainer, collapsed.
- **Analysis** — what was checked, what was dropped after being falsified, and a file-by-file change list.
- **Findings** — one card each: checkbox, severity (`blocker`, `should-fix`, `nit`, `question`), `file:line`, a *reply-vs-new* badge when an existing thread already covers it, and an editable body.

Useful buttons on a card:

- **Explain simply** rewrites the finding in plain words and adds how to verify it (a small call on your own account, cached per finding).
- A **suggestion** shows the exact one-line replacement that will be attached as a GitHub `suggestion` block.

Above the findings you may see banners: a **stale** flag if the author has pushed since, the **focus** you set, and a **risk** note when the PR touches paths your team has marked sensitive.

## 4. Stage it

Tick the findings worth posting. Edit any wording; the original is kept so the [learnings loop](/reviewstage/guides/skills-and-learnings/) can record what changed. A sticky bar counts the selection.

## 5. Post

**Post to GitHub** sends the selected comments as inline review comments in a single `COMMENT` review, under your name. With `DRY_RUN=1` it tells you what it *would* have posted, and the exact payload is saved so you can inspect it.

Compare that payload with a review you have done by hand on the same PR. Do this for several PRs. This is where you decide the output is good enough.

## 6. Approve, separately

**Approve** is its own panel. It is enabled only when the PR is open, not a draft, not authored by you, and has a review on this server. The body is pre-filled with `LGTM` plus a checklist of the blocker and should-fix findings (nits omitted) and is editable. It posts the comment and then the approval, as you.

## 7. Go live

When you trust the output:

```bash
# .env
DRY_RUN=0
```

```bash
docker compose up -d    # or, from source: sudo systemctl restart reviewstage
```

Start with a PR you authored so the stakes are low. Read [Security](/reviewstage/security/) first if the server is reachable from outside your machine.
