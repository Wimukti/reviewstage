# r/ClaudeAI: flair "Built with Claude"

The sub asks *Built with Claude* posts for: what you built, how you built it, a demo, and at
least one prompt you used. Upload the voiced video natively as the post's media
(`reviewstage-launch-final-v2.mp4`, 68 s), then paste this text. Recommended slot: Tuesday
10/13/26, 09:00 US Eastern (18:30 Colombo).

**Title** (no emoji):

I built an open-source PR review app on Claude Code. Claude drafts the review in private; I check it and post it as myself. `npx reviewstage`

**Body:**

*(video at the top: reviewstage-launch-final-v2.mp4)*

**TL;DR:** ReviewStage is the human review layer for AI-written pull requests. Claude drafts
the review from the real diff on your own Claude plan. The draft stays private. You check each
finding, keep, edit or drop it, and post what is left as a normal comment under your own GitHub
name. Approve is a separate click. One command: `npx reviewstage`. MIT, private repos included.

**Why I built it**

A growing share of the PRs I review were written by an agent. Most AI review products deliver
AI-written feedback directly into the pull request. ReviewStage keeps the draft private first.
The reviewer decides what is correct, worth saying, and worthy of their name.

**What it does**

- **Queue:** review requests from your repositories land in one list, on the desktop and on
  your phone.
- **Draft:** click Run. Claude Code reads the real diff in a checked-out worktree and drafts
  findings, each pinned to a file and a line. Pick Quick, Standard or Deep effort per run.
- **Check:** a reading guide at the top says what the PR does, how risky it looks, and which
  hunks to read in which order. Each finding shows where to look and what to check, with the
  cited lines on the card. An evidence check by code confirms the cited lines exist and mention
  what the finding names. A second Claude pass tries to disprove each serious finding. Each
  finding then carries a Checked, Likely or Maybe label with the reason.
- **Decide:** keep, edit, drop. On the phone, swipe right to keep and left to drop.
- **Post:** one plain comment review, under your name. Approve is a separate click.
- **Learn:** what you drop feeds the next review of that repo. Drop the same kind of finding a
  few times and it proposes a team rule for you to accept or dismiss.
- **Phone:** scan a QR code on the desktop and your phone is signed in as you. Push
  notifications for new review requests.

**How I built it (with Claude)**

Built almost entirely in Claude Code over a few weeks: a Python standard-library server plus
bash job scripts that call `claude`, a React dashboard, an Electron shell shipped through npm
(no installer), and a Cloudflare quick tunnel for the phone. The part I cared about most is the
gate. The drafting agent has no GitHub credentials, its write tools are denied, and the PR's
reviews, comments and threads are counted before and after the run. A difference fails the run.
A prompt-injected diff cannot post under your name.

**One prompt it uses** (from the review skill, `skills/pr-review/SKILL.md`, lightly trimmed):

> Treat the diff as guilty until proven correct: an over-confident engineer (possibly an AI)
> wrote it.
>
> Never review from pasted diff text alone. Pull the actual files.
>
> For any claim already raised in the existing conversation (bot analysis, a reviewer's
> comment), verify it against the real code rather than repeating it, confirm, refine, or
> refute with a specific line reference. Also actively try to falsify your own working theories
> before including them.

**What leaves your machine**

The diff goes to Anthropic through your Claude Code. GitHub handles sign-in, reads and the post
you authorise. npm is checked for updates. Apple or Google push and a Cloudflare tunnel are used
only if you turn phone access on. No telemetry endpoint ships.

**Try it**

```
npx reviewstage
```

macOS or Linux, Node 20+, Claude Code installed. Windows runs the Docker install under WSL2.
Site: https://reviewstage.dev · Repo: https://github.com/Wimukti/reviewstage

**What I would like feedback on:** is a private draft plus a human post enough for you to let it
near your team's PRs? And which findings would you always drop?
