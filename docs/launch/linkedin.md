# LinkedIn — D0, 13:00 US Eastern

Native upload of the vertical cut. LinkedIn rewards a first line that stands alone and
penalises links in the body — put the links in the first comment.

**Post:**

AI wrote the PR. Someone still has to review it.

Half the pull requests I review now were written by an agent, and the AI review bots I tried
made it worse: a bot leaving ten comments on every PR gets muted, and when it approves the
wrong thing, nobody owns the mistake.

So I built ReviewStage, and today it's 1.0 and open source.

It drafts the review from the real diff using Claude, on your own Claude plan. Every finding
stays private until you decide. You keep what's worth saying, edit it, and post it as a normal
review comment under your own name. Nothing reaches GitHub until you click — and approving is
always a separate click.

It runs as a desktop app (one command), your phone joins by scanning a QR code, and it learns
what your team drops so the next review is quieter.

If your team is reviewing more AI-written code than ever, I'd like to hear how you're handling
it. Links in the first comment.

**First comment:**

Site: https://reviewstage.dev
Code (MIT): https://github.com/Wimukti/reviewstage
Try it: `npx reviewstage`
