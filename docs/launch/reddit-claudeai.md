# r/ClaudeAI — flair "Built with Claude"

The sub asks *Built with Claude* posts for: what you built, how you built it, a demo, and at
least one prompt you used. Upload the captioned video natively (the post's media), then this
text. Post D0, 09:00 US Eastern.

**Title** (≤ 120 chars, no emoji):

I built an open-source PR review app on Claude Code: Claude drafts the review, I post it as myself — `npx reviewstage`

**Body:**

*(video at the top: reviewstage-launch-1080p.mp4)*

**TL;DR:** ReviewStage turns Claude Code into a review *assistant* instead of a review *bot*.
It drafts the review from the real diff on your own Claude plan, stages every finding
privately, and you post the ones you mean as a normal comment under your GitHub name. Nothing
posts until you click. One command: `npx reviewstage`. MIT.

**Why I built it**

Half the PRs I review now were written by an agent. AI review bots didn't help: a bot account
leaving ten comments gets muted in two weeks, and when it approves something it shouldn't,
nobody owns that. I wanted the drafting done for me and the posting left to me.

**What it does**

- **Queue:** review requests from your repos land in one list (desktop, and your phone).
- **Review:** click Run — a real Claude Code run over the real diff, Quick / Standard / Deep,
  your model choice. Findings come back with file and line.
- **Stage:** keep, edit, drop. On the phone, swipe right to keep, left to drop.
- **Post:** one plain COMMENT review, as you. Approve is a separate click.
- **Learn:** drop the same nit three times and it drafts a team rule for you to accept.
- **Phone:** scan a QR code on the Mac and your phone is signed in; push notifications for new
  review requests.

**How I built it (with Claude)**

Built almost entirely in Claude Code over a few weeks: Python stdlib server + bash job scripts
that call `claude`, a React/Tailwind dashboard, an Electron shell distributed through npm (so
no installer and no Gatekeeper prompt), and a Cloudflare quick tunnel for the phone. The part I
cared about most is the gate: the review step has **no GitHub write path** — every credential
is stripped from the agent's environment, there's a tool deny list, and a before/after check of
the PR fails the run if anything landed. A prompt-injected diff can't post under your name.

**One prompt it uses** (the opening of the review skill, `skills/pr-review/SKILL.md`, verbatim):

> Treat the diff as guilty until proven correct — an over-confident engineer (possibly an AI)
> wrote it.
>
> Never review from pasted diff text alone. Pull the actual files.
>
> For any claim already raised in the existing conversation (bot analysis, a reviewer's
> comment), verify it against the real code rather than repeating it — confirm, refine, or
> refute with a specific line reference. Also actively try to falsify your own working theories
> before including them.

**Try it**

```
npx reviewstage
```

Mac or Linux, Node 20+, Claude Code installed. Site: https://reviewstage.dev · Repo:
https://github.com/Wimukti/reviewstage

**What I'd love feedback on:** is "nothing posts until a human clicks" enough for you to let it
near your team's PRs? And which findings does it raise that you'd always drop?
