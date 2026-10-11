# YouTube upload

**File:** `~/Desktop/reviewstage-launch/reviewstage-launch-final-v2.mp4` (H.264, 67.7 s, voiced;
the 1.2.2 UI on every screen, same voice track as `reviewstage-launch-final-v2.mp4`). Captions are
not burned into this file, so upload `video/captions.srt` (timed to this edit) as the subtitle track.

**Visibility:** Public (Unlisted works too, but Public lets YouTube search find it).
**Thumbnail:** `~/Desktop/reviewstage-launch/reviewstage-launch-thumbnail-v2.png`
**Category:** Science & Technology · **Language:** English

**Title** (66 chars; 70 or fewer shows in full):

ReviewStage: Claude drafts your PR review, you post it as yourself

**Description:**

ReviewStage is the human review layer for AI-written pull requests. Claude drafts the review
privately; you verify, edit and post it as yourself.

AI wrote the PR. You still have to review it. ReviewStage drafts your pull-request review from
the real diff, on your own Claude plan, and keeps the draft private. You check each finding,
keep what is worth saying, edit it, and post it as a normal review comment under your own GitHub
name. Approve is a separate click.

Try it: npx reviewstage (macOS and Linux; Claude Code required; Windows runs the Docker install
under WSL2)
Website: https://reviewstage.dev
Code (MIT, private repos included): https://github.com/Wimukti/reviewstage
Security model: https://reviewstage.dev/security/

Chapters
0:00 AI wrote the PR. You still have to review it.
0:06 One command: npx reviewstage
0:09 Sign in with GitHub, connect Claude, pick repositories
0:18 Review requests land in your queue
0:21 Claude drafts findings from the real diff
0:33 You pick what is worth saying and post as yourself
0:45 Scan a QR code and your phone is signed in
0:48 Swipe to keep or drop, then post from your phone
1:00 It proposes rules from what your team drops
1:03 Open source, MIT, runs on your Claude plan

The drafting agent cannot write to GitHub: it runs with no GitHub credentials, its write tools
are denied, and the PR's reviews, comments and threads are counted before and after the run.

What leaves your machine: the diff, to Anthropic through your Claude Code; GitHub for sign-in,
reads and the post you authorise; npm for update checks; Apple or Google push and a Cloudflare
tunnel only if phone access is on. No telemetry endpoint ships.

**Tags:** code review, pull request, Claude, Claude Code, GitHub, developer tools, open source,
self-hosted

**Uploaded 10/06/26:** https://youtu.be/yYMtQK-sVyg. Linked from `show-hn.md`,
`reddit-selfhosted.md`, `linkedin.md`, the README and `DEMO_YOUTUBE_ID` in
`website/src/content/site-links.ts`. On 10/11/26 the live title and description still carried
the old wording (an em dash in the title, no category sentence, no chapters): replace both with
the text above before the first post. Chapter times were read from a frame scan of the final cut
at 3-second steps; nudge them by a second if YouTube's preview shows a cut mid-scene.
