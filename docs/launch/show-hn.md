# Show HN

Submit the repo URL (https://github.com/Wimukti/reviewstage) as the link. Post the text below
as your first comment within a minute of submitting. Stay in the thread for the next 4 to 6
hours. The HN account (`windysl`) has no history, so fast, specific replies are what carry it.

Best time: a weekday, Tuesday to Thursday, between 8:00 and 10:00 am US Eastern. Do not post
on a weekend. If the post gets no traction, HN allows one email to hn@ycombinator.com to ask
for a second chance, so do not resubmit by hand.

**Title** (78 chars, limit 80):

Show HN: ReviewStage, Claude drafts PR reviews privately, you post as yourself

**First comment** (about 420 words):

I maintain ReviewStage. It's an open-source tool for reviewing pull requests with Claude Code
where the draft stays private and you post as yourself.

How it works: `npx reviewstage` opens a desktop app. Sign in to GitHub, connect Claude Code,
pick repos. For a PR, Claude drafts findings from the diff on your own Claude plan. Each
finding says where to look and what to check, with the cited lines on the card. You read it,
keep or drop each one, edit what you want, then post what's left as a normal review from your
own account. Nothing reaches the PR until you click. Approve is a separate click.

The drafting agent has no GitHub credentials and its write tools are denied. The tool counts
the PR's reviews, comments and threads before and after the run. If the count changes, the
run fails.

Yesterday I ran it on four open PRs on public repos I have nothing to do with (pyvisa,
pytest-redis, python-roborock, coder/xum). Six draft findings. Three were real, and I posted
them under my own name: two should-fix, one question. Two I dropped. One of the dropped ones
was a confident "blocker" claiming an untrusted repo's git config could run during a fetch.
The tool's own disproof pass refuted it, and reading the code confirmed that. Posted as
written, it would have told a maintainer "do not merge" for nothing. The runs took 51 to 116
seconds each and the CLI reported $0.45 to $0.59 per PR at API rates. The write-up, with the
file and line for every check, is in the repo at docs/launch/real-reviews.md.

Running it on real PRs that morning also turned up three bugs in ReviewStage itself: fork PRs
couldn't be fetched, a Mac without coreutils has no `timeout`, and a refused model run looked
like a crash. All three are fixed in 1.2.3.

Free, MIT, private repos included. macOS and Linux desktop. Windows through Docker under WSL2.
Phone by QR code. Claude Code required.

What leaves your machine: the diff, to Anthropic through your own Claude Code. GitHub, for
sign-in, reads and the post you authorize. npm, for update checks. A Cloudflare tunnel only if
you turn phone access on. No telemetry endpoint ships.

Two things I'd like to hear: would you let this near your team's PRs, and which findings would
you always drop?

Demo (68 s): https://youtu.be/yYMtQK-sVyg
Security model: https://reviewstage.dev/security/
Real reviews: https://github.com/Wimukti/reviewstage/blob/main/docs/launch/real-reviews.md

## Replies to have ready

- **"Why not just paste the diff into Claude?"** You can. ReviewStage adds the keep or drop
  step per finding, the evidence check by code, the disproof pass, and the post from your own
  account with the agent kept away from GitHub write access.
- **"How is this different from CodeRabbit or Copilot review?"** Those post AI text onto the
  PR. ReviewStage keeps the draft private. You decide what is correct and worth your name.
  Use the one sentence from the runbook, no other comparison.
- **"What about false positives?"** The coder/xum case above. Say the rate you saw: one in
  six draft findings on that day, caught before a person acted on it. No wider claim.
- **"Does it need Claude Code?"** Yes, today. It runs on your own plan, and the CLI's default
  model needs credits on some plans, so the run form lets you pick Opus, Sonnet or Haiku.
- **"Telemetry?"** Opt-in usage counts only, with the exclusions on the consent card. No
  endpoint ships without consent.
