# X / Twitter thread

Attach the vertical cut (`reviewstage-launch-vertical-v2.mp4`, 35 s) to post 1 as a native upload.
Each post is under 280 characters (counts below). Recommended slot: Tuesday 10/13/26, 13:00 US
Eastern (22:30 Colombo). If posting today (Sunday 10/11/26), this thread and LinkedIn are the
two channels that are safe to post from an account with no history.

1/ (242 chars)
AI wrote the PR. You still have to review it.

I built ReviewStage. Claude drafts your review from the real diff, in private. You check it, keep what is worth saying, and post it under your own name. Approve stays your click.

npx reviewstage
[video]

2/ (204 chars)
Most AI review products deliver AI-written feedback directly into the pull request. ReviewStage keeps the draft private first. The reviewer decides what is correct, worth saying, and worthy of their name.

3/ (209 chars)
The drafting agent cannot write to GitHub. It has no GitHub credentials, its write tools are denied, and the PR's reviews, comments and threads are counted before and after the run. A difference fails the run.

4/ (240 chars)
1.2 is about checking the draft, not trusting it. A reading guide at the top. Each finding shows where to look and what to check, with the cited lines on the card. An evidence check by code. A second pass tries to disprove serious findings.

5/ (130 chars)
Each finding gets a Checked, Likely or Maybe label, with the reason it earned it. The model's own confidence is never shown alone.

6/ (152 chars)
Your phone joins by scanning a QR code. A push when someone requests your review. Swipe right to keep a finding, left to drop it, then post as yourself.

7/ (236 chars)
What leaves your machine: the diff to Anthropic through your Claude Code; GitHub for sign-in, reads and the post you authorise; npm for update checks; push and a Cloudflare tunnel only if phone access is on. No telemetry endpoint ships.

8/ (251 chars)
Free, MIT, private repos included. Runs on your own Claude plan with Claude Code. macOS and Linux desktop, Windows via Docker under WSL2.

https://reviewstage.dev
https://github.com/Wimukti/reviewstage

Built on Claude Code from @AnthropicAI @claudeai
