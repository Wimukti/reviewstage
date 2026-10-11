# LinkedIn

Native upload of the vertical cut (`reviewstage-launch-vertical-v2.mp4`, 35 s). LinkedIn rewards a
first line that stands alone and tends to show link posts to fewer people: put the links in the
first comment. The post body is under 1,300 characters, so nothing sits behind "see more".
Recommended slot: Tuesday 10/13/26, 13:00 US Eastern (22:30 Colombo); safe to post today
(Sunday 10/11/26) from your own account.

**Post:**

AI wrote the PR. Someone still has to review it.

A growing share of the pull requests I review were written by an agent. Most AI review products
deliver AI-written feedback directly into the pull request. ReviewStage keeps the draft private
first. The reviewer decides what is correct, worth saying, and worthy of their name.

So I built it, and it is open source (MIT) and on version 1.2.

Claude drafts the review from the real diff, on your own Claude plan. The draft stays private.
Each finding shows where to look and what to check, a code check confirms the cited lines, a
second pass tries to disprove the serious ones, and each carries a Checked, Likely or Maybe
label with the reason. You keep what is worth saying, edit it, and post it as a normal review
comment under your own name. Approve is always a separate click.

The drafting agent cannot write to GitHub: no credentials, write tools denied, and the PR is
checked before and after the run.

One command opens the desktop app (macOS and Linux). Your phone joins by scanning a QR code.

If your team is reviewing more AI-written code than ever, I would like to hear how you handle
it. Links in the first comment.

**First comment:**

Site: https://reviewstage.dev
Code (MIT): https://github.com/Wimukti/reviewstage
Try it: `npx reviewstage` (Claude Code required; Windows runs the Docker install under WSL2)
Demo (68 s): https://youtu.be/yYMtQK-sVyg
