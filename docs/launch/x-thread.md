# X / Twitter thread — D0, 13:00 US Eastern

Attach the vertical cut to post 1 (native upload). Keep each post under 280 characters.

1/
AI wrote the PR. You still have to review it.

I built ReviewStage: Claude drafts your review from the real diff, you keep what's worth
saying, and it posts as you. Nothing posts until you click.

One command: npx reviewstage
[video]

2/
Why not a review bot? Bots comment on everything, get muted, and when one approves the wrong
thing nobody owns it.

ReviewStage is a staging area. Findings stay private until you pick them.

3/
It runs on your own Claude plan through Claude Code — no API key.

Quick / Standard / Deep effort, pick the model, every run kept.

4/
Your phone joins by scanning a QR code on the Mac. Push notification when someone requests your
review. Swipe right to keep a finding, left to drop it, Post.

5/
The gate is enforced, not promised: the review step has no GitHub write path, and a
before/after check fails the run if anything landed on the PR.

6/
It learns your team: drop the same nit three times and it drafts a rule for you to accept.

7/
Open source (MIT). Mac + Linux desktop app, or Docker for a team.

https://reviewstage.dev
https://github.com/Wimukti/reviewstage

Built on Claude Code — @AnthropicAI @claudeai
