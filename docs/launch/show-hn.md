# Show HN

Submit the repo URL (https://github.com/Wimukti/reviewstage) as the link. Post the text below
as your first comment within a minute of submitting. Stay in the thread for the next 4 to 6
hours; the HN account (`windysl`) has no history, so fast, specific replies are what carry it.

**Title** (78 chars, limit 80):

Show HN: ReviewStage, Claude drafts PR reviews privately, you post as yourself

**First comment** (about 250 words):

I review a lot of pull requests that an agent wrote. Most AI review products deliver AI-written
feedback directly into the pull request. ReviewStage keeps the draft private first. The reviewer
decides what is correct, worth saying, and worthy of their name.

`npx reviewstage` opens a desktop app: GitHub sign-in by device flow, connect Claude Code, pick
repositories. Claude drafts findings from the real diff on your own Claude plan. You check each finding against the code, keep, edit or drop it, and post what
is left as a plain comment review from your own account. Approve is a separate click.

The drafting agent has no GitHub credentials and its write tools are denied. The PR's reviews,
comments and threads are counted before and after the run; a difference fails the run.

1.2 makes the draft easier to check: a reading guide, where to look and what to check per
finding with the cited lines on the card, an evidence check done by code, a second pass that
tries to disprove serious findings, and a Checked, Likely or Maybe label with the reason.

Free, MIT, private repos included. macOS and Linux desktop; Windows through Docker under WSL2.
Phone by QR code. Claude Code required.

What leaves your machine: the diff, to Anthropic through your Claude Code; GitHub for sign-in,
reads and the post you authorise; npm for update checks; push and a Cloudflare tunnel only if
phone access is on. No telemetry endpoint ships.

Is this enough for you to let it near your team's PRs? Which findings would you always drop?

Demo (68 s): https://youtu.be/yYMtQK-sVyg
Security model: https://reviewstage.dev/security/
