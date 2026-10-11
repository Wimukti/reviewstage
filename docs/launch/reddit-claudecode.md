# r/ClaudeCode

A different text from r/ClaudeAI (same-body cross-posts read as spam). This crowd runs Claude
Code all day, so lead with the mechanics. Upload the vertical cut
(`reviewstage-launch-vertical-v2.mp4`, 35 s) or `docs/demos/review.gif` natively. Recommended
slot: Tuesday 10/13/26, 12:00 US Eastern (21:30 Colombo).

**Title:**

Claude Code as a PR review drafter that cannot write to GitHub: private staging area, evidence checks, a second pass that tries to disprove findings, posts under your own name (open source, MIT)

**Body:**

*(media: reviewstage-launch-vertical-v2.mp4, or docs/demos/review.gif)*

I wanted Claude Code doing the first pass of my reviews without it ever touching GitHub on its
own. ReviewStage is what came out of that. `npx reviewstage` opens a desktop app; review
requests land in a queue; Run starts a `claude` run over a checked-out worktree of the PR, on
your own Claude plan. The draft is private. You check it and post what you stand behind, as
yourself.

The bits you might care about as Claude Code users:

- **No write path in the drafting step.** `GH_TOKEN`, `GITHUB_TOKEN` and the rest are unset
  in the agent's environment and `GH_CONFIG_DIR` points at an empty directory.
  `--disallowedTools` denies `gh`, `git push`, `curl` and friends. The PR's reviews, comments
  and threads are counted before and after the run; a difference writes a security violation
  and fails the job.
- **Effort per run.** Quick, Standard or Deep. The duration shown is an estimate until your
  install has three runs at that level, then it is your own median.
- **Findings you can check.** A reading guide at the top. Each finding shows where to look and
  what to check, with the cited lines on the card. A code check confirms the cited lines exist
  in this diff and mention the thing the finding names; two misses and the finding drops to a
  Maybe tray whatever the model claimed.
- **A second pass with the opposite brief.** A separate `claude` run tries to disprove each
  serious finding and answers stands, weakened or refuted in one sentence. It has the same
  no-write environment.
- **Checked, Likely, Maybe.** The label comes from the evidence check, the disproof verdict and,
  once your team has 20 or more decisions on findings like this, your real keep-rate. The
  model's own confidence is never shown alone.
- **Skills, versioned.** A team default skill in a git repo on your box, per-repo overrides, and
  rules proposed from what you drop. You accept or dismiss each one.
- **Phone.** Pair by QR code over a Cloudflare quick tunnel, push notifications, swipe findings
  to keep or drop, then post.

What leaves your machine: the diff to Anthropic through your Claude Code; GitHub for sign-in,
reads and the post you authorise; npm for update checks; push and the tunnel only if phone
access is on. No telemetry endpoint ships.

Repo (MIT): https://github.com/Wimukti/reviewstage · Docs: https://reviewstage.dev

Happy to answer anything about the gate or the skill setup. If you try it and it raises
something you would never post, tell me what. That is what the learnings loop is for.
