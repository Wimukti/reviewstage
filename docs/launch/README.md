# Launch playbook

How ReviewStage goes from 0 stars to a project people find, try and tell others about. Every
post is a file in this folder, ready to paste. Dates are MM/DD/YY. Current release: 1.2.1.

## The one idea

**AI wrote the PR. You still have to review it.** ReviewStage is the human review layer for
AI-written pull requests. Claude drafts the review privately; you verify, edit and post it as
yourself.

Say it the same way everywhere, and always human-first: Claude drafts, the reviewer verifies,
edits and posts under their own name. Where a contrast with other tools is needed, use this
sentence and no other: "Most AI review products deliver AI-written feedback directly into the
pull request. ReviewStage keeps the draft private first. The reviewer decides what is correct,
worth saying, and worthy of their name." Never "AI reviews your code", never "a bot comments on
every PR" as a claim about the world.

The story, in this order, whenever there is room:

1. **The architecture.** The drafting agent has no GitHub credentials, its write tools are
   denied, and the PR's reviews, comments and threads are fingerprinted before and after the
   run. The draft is private. A person owns publication, and approval is a separate click.
2. **What 1.2 adds.** A reading guide at the top of each review; each finding shows where to
   look and what to check, with the cited lines on the card; an evidence check done by code; a
   second pass that tries to disprove serious findings; a Checked, Likely or Maybe label with
   the reason.
3. **The terms.** Free, MIT, private repos included, runs on your own Claude plan,
   `npx reviewstage`, phone by QR code. macOS and Linux desktop; Windows through Docker under
   WSL2. Claude Code required. GitHub sign-in by device flow.

No universal or unmeasured claims: no "every", "nothing else leaves", "anonymous", "10x",
"faster", "catches bugs humans miss". When data destinations come up, enumerate them (see the
"What leaves my machine?" answer below). No em dash, en dash or spaced hyphen as punctuation in
any post: `scripts/no-dashes.sh` from the repo root checks this folder and must pass.

## Assets (all in `~/Desktop/reviewstage-launch/`)

| Asset | File | Used by |
| --- | --- | --- |
| 68 s launch video, voiced, captions burned in | `reviewstage-launch-final.mp4` | YouTube (ID `yYMtQK-sVyg`), the r/ClaudeAI native upload |
| 90 s cut, captions, no voice | `reviewstage-launch-1080p.mp4` | spare; `captions.srt` matches this cut only |
| 90 s cut, no captions, no voice | `reviewstage-launch-1080p-clean.mp4` + `video/voiceover-script.md` | re-recording the voice |
| 35 s vertical cut | `reviewstage-launch-vertical.mp4` | X, LinkedIn, r/ClaudeCode, Shorts or Reels |
| 20 s review GIF | `docs/demos/review.gif` (in the repo) | README, Reddit image posts |
| YouTube thumbnail | `reviewstage-launch-thumbnail.png` | YouTube |
| GitHub social preview | `github-social-preview.png` | repo **Settings → General → Social preview → Upload**; GitHub has no API for this, and it is what every link to the repo shows on X, Slack, Discord and LinkedIn |

## Pre-flight checklist (do before the first post)

Maintainer-only items; none of these can be done from a clone.

- [ ] **Social preview uploaded.** Repo Settings → General → Social preview →
      `github-social-preview.png`. Check a repo link unfurls in a Slack DM to yourself.
- [ ] **Repo pinned** on the github.com/Wimukti profile, so it is the first thing a visitor
      sees. Also confirm the About text carries the category sentence and the site URL.
- [ ] **GitHub Release for v1.2.1 with notes.** Checked 10/11/26: a release named "ReviewStage
      1.2.1" already exists (created 14:13 UTC) and carries the 1.2.1 paragraph only; 1.2.0 and
      1.1.0 have their own releases. If it is ever missing, recreate it from the CHANGELOG:

      ```bash
      cat > /tmp/reviewstage-1.2.1-notes.md <<'NOTES'
      Words only. The run's second phase now reads "Drafting findings from the diff" (it was
      "Reviewing the diff"): Claude drafts, you review. Every dash used as punctuation in the
      app, the phone window, the skill prompts and the docs is gone, and a check in CI keeps it
      that way. The telemetry consent card now says "Share usage counts" with the exact
      exclusions, and the two duration labels say "2 to 5 min" as an estimate, not a measurement.

      ## From 1.2.0: findings you can check

      - A reading guide at the top of every review: what this PR does, why, how risky it looks,
        and which hunks to read in which order. On the phone it is the first card.
      - Every finding in the same six rows: title, where (the cited lines shown on the card),
        what to check, expected / actual, why it matters, how it was checked.
      - Evidence check, by code not by the model: do the cited lines exist in this diff and
        mention the thing the finding names? Two misses and the finding drops to the Maybe tray.
      - A second pass tries to disprove each serious finding (stands / weakened / refuted). It
        cannot write to GitHub.
      - Checked, Likely, Maybe, with a reason: earned from the evidence check, the disproof
        verdict and, once a team has 20 or more decisions on findings like this, the real
        keep-rate. The model's own confidence is never shown alone.
      NOTES
      gh release create v1.2.1 --repo Wimukti/reviewstage --title "ReviewStage 1.2.1" \
        --verify-tag --latest --notes-file /tmp/reviewstage-1.2.1-notes.md
      ```

      To add the 1.2.0 section to the existing release instead, write the same notes file and
      run `gh release edit v1.2.1 --repo Wimukti/reviewstage --notes-file /tmp/reviewstage-1.2.1-notes.md`.
- [ ] **reviewstage.dev/try works on a phone.** It answered 200 on 10/11/26; open it on your
      actual phone over mobile data, keep one finding, drop one, edit one.
- [ ] **YouTube description matches `youtube.md`.** The video exists (`yYMtQK-sVyg`). On
      10/11/26 the live title still had an em dash and the description had no category sentence
      and no chapters: paste the title and description from `youtube.md`, set the thumbnail,
      confirm it is Public.
- [ ] **Clean install works.** On a machine or user account that has never run it:
      `npx reviewstage@latest` (npm `latest` is 1.2.1 as of 10/11/26). Sign in by device flow,
      connect Claude, pick a repo, run one review, and post nothing. Then `reviewstage --doctor`.
- [ ] **Repo surface.** Discussions on; good-first-issues #19 to #30 open and labelled; the
      README's first screen still shows the one-liner, the recording and the command.
- [ ] **Reddit account warmed up.** The account was created around 10/08/26 and has no comment
      history; most subs filter such posts. Make 10 to 15 genuine comments in r/ClaudeAI and
      r/ClaudeCode before posting there (answer questions; nothing about ReviewStage).
- [ ] **HN account.** `windysl` has no history. That is fine for Show HN, but the first comment
      must land within a minute and replies must be fast for the first few hours.

## Schedules

All times US Eastern (EDT, UTC-4) with Colombo (UTC+5:30) in brackets. Sunday has the lowest
reach on both HN and Reddit; Tuesday to Thursday mornings US time have the most.

### (A) Recommended: launch Tuesday 10/13/26

| When | Channel | File | Notes |
| --- | --- | --- | --- |
| Sun 10/11 and Mon 10/12 | Pre-flight checklist above; 10 to 15 real comments on r/ClaudeAI and r/ClaudeCode | | Nothing about the product. |
| Tue 10/13, 08:30 ET (18:00 Colombo) | **Show HN** | `show-hn.md` | Submit the repo URL; first comment within a minute. Stay in the thread 4 to 6 hours. |
| Tue 10/13, 09:00 ET (18:30) | **r/ClaudeAI**, flair *Built with Claude* | `reddit-claudeai.md` | Native upload of the voiced final, not a YouTube link. |
| Tue 10/13, 12:00 ET (21:30) | **r/ClaudeCode** | `reddit-claudecode.md` | Different text from r/ClaudeAI; never cross-post the same body. |
| Tue 10/13, 13:00 ET (22:30) | **X thread** + **LinkedIn** | `x-thread.md`, `linkedin.md` | Vertical cut, native upload. Tag @AnthropicAI and @claudeai once, in the last X post. |
| Wed 10/14, 09:00 ET (18:30) | **r/selfhosted** | `reddit-selfhosted.md` | Leads with where the data goes. |
| Thu 10/15, 09:00 ET (18:30) | **r/opensource** | `reddit-opensource.md` | Leads with the design decision and the help wanted. |
| Thu 10/15 | **dev.to article** | `article.md` | The story and how the gate is enforced. Link it from replies, not as a new Reddit post. |
| Fri 10/16, 09:00 ET (18:30) | **r/ExperiencedDevs** | `reddit-experienceddevs.md` | A discussion. No link in the body. |
| 10/27/26 or later | **awesome-claude-code** | `awesome-lists.md` | Their rule: the resource is at least 14 days old with active development, or has 100+ stars; a human submits through the web form. |
| about 11/12/26 | "One month later" post (site + HN) | | Numbers, what changed from feedback, what is next. |
| later | Product Hunt | | Only once there are users who will show up for it. |
| 01/12/27 or later | **awesome-selfhosted** | `awesome-lists.md` | Requires the first release to be at least 4 months old (first release 09/12/26). |

### (B) If posting today, Sunday 10/11/26

| When | Channel | File | Notes |
| --- | --- | --- | --- |
| Any time today | **X thread** + **LinkedIn** | `x-thread.md`, `linkedin.md` | Your own accounts; no account-age filter applies. Expect a quieter day than Tuesday. |
| 19:00 to 21:00 ET (04:30 to 06:30 Mon, Colombo), optional | **r/ClaudeAI** | `reddit-claudeai.md` | Only if you have made the 10 to 15 real comments first; otherwise the post is filtered and the sub remembers the account. |
| Tue 10/13, 08:30 ET | **Show HN** | `show-hn.md` | Keep HN for Tuesday whatever you post today. The rest of schedule (A) follows unchanged. |

Why: Sunday has the lowest reach on HN and Reddit. A Reddit account created around 10/08/26 with
no comment history gets filtered on most subs, so today is for commenting, not posting. The HN
account `windysl` has no history, which is fine for Show HN as long as you reply fast.

## The README is the landing page

Most clicks from every channel land on the GitHub README, not the site. It opens with the
one-liner, the 20-second recording and the command. Keep it that way: nothing about Docker above
the fold, a star is one scroll away (the recording ends where the eye is), and the first link
after the command is the site.

## How to behave on launch day (this decides how far a post travels)

- **Reply to every comment in the first 6 hours**, within about 15 minutes when you can. Early
  replies are what the ranking sees.
- **Answer with what the thing does**, never argue taste. "It does not do X because Y; here is
  the issue if you want it" beats a defence.
- **Turn every bug report into an issue on the spot** and link it in your reply. People star
  projects that visibly respond.
- **Never ask for upvotes or stars**, and never have friends vote. Reddit and HN both detect it
  and bury the post. Asking for *feedback* is fine.
- **Ship something within 48 hours** from what people said, then reply to them that it is in.
- **Say "Claude drafts", never "the AI reviews".** If someone calls it a review bot, correct it
  once, kindly, with the approved sentence.

## What to watch

Count reviewers, not reviews. There is no telemetry endpoint, so every number below comes from
GitHub, npm or the posts themselves.

| Metric | Where | A good first week |
| --- | --- | --- |
| Reviewers who posted at least once | people who say so in replies, issues or the design-partner calls (`design-partners.md`) | 10+ |
| Stars | GitHub | 100+ (enough for awesome-claude-code without waiting) |
| npm installs | `npm view reviewstage` / npmjs.com weekly downloads | 300+ |
| Issues from strangers | GitHub | 5+ (people only file issues for things they use) |
| Comments → clicks | the posts | reply rate matters more than score |
| Site visits | GitHub Pages has none: add a privacy-friendly counter if you want this | |

## One sentence each, for the questions you will get

- **How is this different from Claude Code Review, CodeRabbit or Copilot review?** Most AI
  review products deliver AI-written feedback directly into the pull request. ReviewStage keeps
  the draft private first. The reviewer decides what is correct, worth saying, and worthy of
  their name.
- **What does it cost?** Your existing Claude plan. No API key, no per-review bill, and no
  server bill for the desktop app.
- **What leaves my machine?** The diff and the files it touches go to Anthropic through Claude
  Code on your account; what you post goes to GitHub with your token. Beyond that: GitHub for
  sign-in and reading the PR, npm for update checks, Apple's and Google's push services if you
  turn phone notifications on (never the finding text), and Cloudflare's tunnel while phone
  access is on. Usage counts stay on your machine unless you opt in and a reporting endpoint is
  configured. No endpoint is configured by default.
- **Can it approve on its own?** No, not as an option, not behind a flag. Approve is your click.
- **Does it work with my repositories?** GitHub only: any repository you can review, public or
  private, as many as you like.
- **Does it run on Windows?** The Docker install runs under WSL2 today; a native app is on the
  roadmap.
