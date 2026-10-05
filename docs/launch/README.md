# Launch playbook

How ReviewStage goes from 0 stars to a project people find, try and tell others about. Every
post is a file in this folder, ready to paste. Dates are MM/DD/YY.

## The one idea

**AI wrote the PR. You still have to review it.** ReviewStage drafts the review on your own
Claude plan; you keep what's worth saying and post it as yourself. Nothing posts until you click.

Say it the same way everywhere. The foil is the review *bot* — the thing that comments on every
PR under a bot account and gets muted in two weeks. We are the opposite: a colleague-shaped
review, signed by a human. Three proof points, in this order, whenever there is room:

1. **One command, a real app:** `npx reviewstage` → desktop app, then your phone by a QR code.
2. **You stay the reviewer:** findings are staged privately; you keep, edit, drop, then post as you.
3. **It learns your team:** what you drop three times becomes a proposed rule.

## Assets (all ready before the first post)

| Asset | Where | Used by |
| --- | --- | --- |
| 90 s launch video, captions burned in | `~/Desktop/reviewstage-launch/reviewstage-launch-1080p.mp4` → upload to YouTube (unlisted is fine) | every post's first line |
| Same cut without captions | `…-1080p-clean.mp4` + `voiceover-script.md` | your voiced version |
| 40 s vertical cut | `…-vertical.mp4` | X, LinkedIn, Shorts/Reels |
| 20 s review GIF | `docs/demos/review.gif` | README, Reddit image posts |
| YouTube thumbnail | `…-thumbnail.png` | YouTube |
| GitHub social preview | `…/github-social-preview.png` → repo **Settings → General → Social preview → Upload** (GitHub has no API for this; it is what every link to the repo shows on X, Slack, Discord, LinkedIn) | all shares |

## The README is the landing page

Most clicks from every channel land on the GitHub README, not the site. It already opens with
the one-liner, the 20-second recording and the command. Keep it that way: nothing about Docker
above the fold, a star is one scroll away (the recording ends where the eye is), and the first
link after the command is the site.

## Order (one week, US Eastern; Tuesday–Thursday mornings get the most eyes)

| Day | Time | Channel | File | Notes |
| --- | --- | --- | --- | --- |
| D-7 → D-1 | — | Be a person on the subs you'll post in | — | Answer 5–10 questions in r/ClaudeAI / r/ClaudeCode. Reddit's rule of thumb: ~90% of your activity is not about your product. Accounts with no history get filtered. |
| D-1 | evening | Repo ready | — | Social preview uploaded, Discussions on, 8–12 good-first-issues open (`good-first-issues.md`), release v1.0.0 visible. |
| D0 | 08:30 | **Show HN** | `show-hn.md` | Post the repo URL; your first comment within a minute. Stay in the thread 4–6 hours. |
| D0 | 09:00 | **r/ClaudeAI** (flair *Built with Claude*) | `reddit-claudeai.md` | Native video upload, not a YouTube link — native video autoplays. |
| D0 | 12:00 | **r/ClaudeCode** | `reddit-claudecode.md` | Different text from r/ClaudeAI; never cross-post the same body. |
| D0 | 13:00 | **X / Twitter** thread + **LinkedIn** | `x-thread.md`, `linkedin.md` | Vertical cut on X; tag @AnthropicAI and @claudeai once, in the last post. |
| D1 | 09:00 | **r/selfhosted** | `reddit-selfhosted.md` | Lead with "your data stays on your box". |
| D2 | 09:00 | **r/opensource** | `reddit-opensource.md` | Lead with the design decision and the help wanted. |
| D3 | — | **dev.to / Hashnode** article | `article.md` | The story + how the gate is enforced. Link it from replies, not as a new Reddit post. |
| D4 | 09:00 | **r/ExperiencedDevs** | `reddit-experienceddevs.md` | A discussion, not an ad. No link unless asked. |
| D14+ | — | **awesome-claude-code** | `awesome-lists.md` | Their rule: the resource is ≥ 14 days old with active development, or ≥ 100 stars; submitted by a human through the web form. |
| D30 | — | "One month later" post (site + HN) | — | Numbers, what changed from feedback, what's next. |
| later | — | Product Hunt | — | Only once there are users who'll show up for it. |
| 01/12/27+ | — | awesome-selfhosted | `awesome-lists.md` | Requires the first release to be ≥ 4 months old (first release 09/12/26). |

## How to behave on launch day (this decides how far a post travels)

- **Reply to every comment in the first 6 hours**, within ~15 minutes when you can. Early replies
  are what the ranking sees.
- **Answer with what the thing does**, never argue taste. "It doesn't do X because Y; here's the
  issue if you want it" beats a defence.
- **Turn every bug report into an issue on the spot** and link it in your reply. People star
  projects that visibly respond.
- **Never ask for upvotes or stars**, and never have friends vote — Reddit and HN both detect it
  and bury the post. Asking for *feedback* is fine.
- **Ship something within 48 hours** from what people said, then reply to them that it's in.

## What to watch

| Metric | Where | A good first week |
| --- | --- | --- |
| Stars | GitHub | 100+ (enough for awesome-claude-code without waiting) |
| npm installs | `npm view reviewstage` / npmjs.com weekly downloads | 300+ |
| Site visits | GitHub Pages has none — add a privacy-friendly counter if you want this | — |
| Issues from strangers | GitHub | 5+ (people only file issues for things they use) |
| Comments → clicks | the posts | reply rate matters more than score |

## One sentence each, for the questions you will get

- **Why not Claude Code Review / CodeRabbit / Copilot review?** They post as a bot on every PR;
  this drafts privately and you post as yourself, only when you choose.
- **What does it cost?** Your existing Claude plan. Nothing else; no API key, no server bill
  for the desktop app.
- **What leaves my machine?** The diff, to Anthropic, through Claude Code on your account, and
  the review you choose to post, to GitHub. Nothing else.
- **Can it auto-approve?** No — not as an option, not behind a flag. Approve is your click.
- **Windows?** Docker install under WSL2 today; native is on the roadmap.
