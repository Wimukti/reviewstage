---
title: "The AI wrote the PR. I still had to review it."
published: false
tags: ai, codereview, github, opensource
cover_image: TODO upload ~/Desktop/reviewstage-launch/reviewstage-launch-thumbnail.png and paste the dev.to URL here
canonical_url: https://reviewstage.dev/
---

I review pull requests for a large part of my week. Over the last year the author of more and more
of them has been an agent, with a colleague's name on the commit. The diffs got longer. The time I
had for each one did not.

## The moment that started it

One afternoon I was asked to review a 23-file PR that an agent had written from a ticket. I opened
it, read the description, scrolled twice, and noticed I had not actually read the diff. I had read
around it. Under the description sat a comment from a review bot we had installed a few months
earlier. Nobody had replied to one in weeks. We skimmed them, then ignored them. When the bot
approved something it should not have, nobody felt that decision was theirs.

That was the problem. Not "AI should review the code". A person was being asked to sign off on a
change they could not read in the time they had, and the help on offer was another voice in the
thread that nobody owned.

## The one design decision

So I built ReviewStage around one decision: the draft is private, and a human publishes.

Claude drafts a review of the PR from the real diff, on the reviewer's own Claude plan. The draft
lands in a desktop app, not in the pull request. The reviewer reads it against the code, keeps
what is right, edits what is close, drops the rest, and posts it under their own GitHub account.
Approve is a separate click.

Most AI review products deliver AI-written feedback directly into the pull request. ReviewStage
keeps the draft private first. The reviewer decides what is correct, worth saying, and worthy of
their name.

A comment with a colleague's name on it gets read, because the colleague is answerable for it.

## How the gate is enforced

A design decision is only worth something if the code holds it. What the code does:

**The drafting agent has no GitHub credentials.** Before the agent starts, the job script fetches
the PR metadata and checks out the branch itself. Then it launches the `claude` CLI through a
wrapper that unsets the GitHub token, the service PAT, the webhook secrets, the Slack tokens, the
install's HMAC secret and the SSH agent socket, and points the `gh` config directory at an empty
folder. A `gh` call inside the agent finds no token in the environment and no stored login. The
one credential that stays is the Claude OAuth token. It authorises Claude, not GitHub.

**Write-capable tools are denied.** The agent is started with a disallowed-tools list: `gh`, `git
push`, `git remote`, `git config`, `curl`, `wget`, `nc`, `ssh`, `scp`, `env`, `printenv`, and
WebFetch and WebSearch. The environment scrub is the real barrier; the deny list is the second
one.

**GitHub state is fingerprinted before and after.** The job script, running with the service token
outside the agent's environment, makes one GraphQL call and records the PR's review count, comment
count and review-thread count. It runs the agent. It makes the same call again. If the two
fingerprints differ, the script writes a `security-violation` file into the run directory and
fails the run. The second pass (below) is fingerprinted the same way.

**Approve is a separate click.** The post route builds a review with the event `COMMENT`, or
`REQUEST_CHANGES` if you ticked that box. It does not know how to send `APPROVE`. Approval is a
different route with its own control in the app.

**The server posts only what you ticked, under your token.** When you press Post, the app sends
the indices of the findings you selected and any text you edited. The server loads the stored
review from disk, so paths, lines and severities come from the draft, not the browser. It builds
the payload from the selected findings only and posts it with your GitHub token. If nothing is
ticked, nothing is sent.

## What 1.2 added, and why

The first versions proved the gate. 1.2 is about the other half: a reviewer who cannot read the
whole diff needs a draft they can check in minutes.

**A reading guide at the top.** What this PR does, why (from the PR body or its ticket), how risky
it looks, and which hunks to read in which order. Click a row and you are at the hunk.

**Where to check, what to check.** Each finding shows the file and lines, with the cited lines on
the card, then one instruction, then expected and actual, then why it matters.

**An evidence check, done by code.** Before a finding is shown, a small Python module holds it
against the PR's own patch text. Is the cited file in the diff? Do the cited lines fall inside a
hunk? Does a backticked identifier from the title appear in those lines? Does a blocker carry both
an expected and an actual? Two misses and the finding is not pre-selected; it drops to the Maybe
tray, whatever confidence the model reported. No model, no network.

**A disproof pass.** A second Claude run, same account, opposite brief: find the strongest reason
this finding is wrong, already handled, or harmless. It answers stands, weakened or refuted, with
one sentence. It runs for the serious findings by default, for all of them if you ask, under the
same credential scrub and deny list.

**Checked, Likely or Maybe, with a reason.** The badge is earned from the evidence check, the
disproof verdict and, once a team has 20 or more decisions on findings like this, the real
keep-rate. The model's own confidence is not shown alone. The reason line says why.

**Plain language rules.** The skill prompt asks for one idea per sentence, 20 words for an
instruction, 25 for a description, active voice, and named things. A linter counts the words and
flags hedges. Before: "It should be noted that the retry logic implementation might possibly fail
to reset the attempt counter under certain conditions." After: "Open `retry.ts` lines 44 to 51.
Check that `attempts` resets after a success."

## What it is not

It is not a bot. It posts nothing on its own, and there is no setting that changes that.

It is not auto-approve. Approve is your click, in a different place from Post.

It is not a replacement for reading. The guide tells you where to look. The card shows the lines.
You still look.

What leaves your machine: the diff and the files it touches go to Anthropic through Claude Code on
your account. What you post goes to GitHub with your token. GitHub is also used for sign-in and
reading the PR. npm is contacted for update checks. If you turn phone notifications on, Apple's
and Google's push services carry the notification, not the finding text, and a Cloudflare tunnel
carries the phone connection while phone access is on. Usage counts stay on your machine unless
you opt in and a reporting endpoint is configured. No endpoint is configured by default.

## Try it, and the ask

```
npx reviewstage
```

That opens the desktop app on macOS or Linux: GitHub sign-in by device flow, connect Claude Code,
pick repositories. Claude Code is required. Windows runs through Docker under WSL2. Free, MIT,
private repositories included, on your own Claude plan. If you want to see the review page without
installing anything, [reviewstage.dev/try](https://reviewstage.dev/try/) runs it on a stored
example.

The ask is small. Try it on three real PRs. Then tell me what you dropped and why. The drop
reasons decide what the skill stops raising. If you would be willing to let me watch the first one
over a call, [here is how I run those
sessions](https://github.com/Wimukti/reviewstage/blob/main/docs/launch/design-partners.md).

Repo: [github.com/Wimukti/reviewstage](https://github.com/Wimukti/reviewstage). Docs and the
security model: [reviewstage.dev](https://reviewstage.dev/).
