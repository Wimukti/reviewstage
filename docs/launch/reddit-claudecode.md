# r/ClaudeCode — D0, 12:00 US Eastern

A different text from r/ClaudeAI (same-body cross-posts read as spam). This crowd runs Claude
Code all day, so lead with the mechanics. Upload the vertical cut or the GIF natively.

**Title:**

Claude Code as a PR review assistant that can't post on its own — staging area, swipe-to-keep on your phone, posts as you (open source)

**Body:**

*(media: reviewstage-launch-vertical.mp4, or docs/demos/review.gif)*

I wanted Claude Code doing my first-pass reviews without it ever touching GitHub on its own.
ReviewStage is what came out of that. `npx reviewstage` opens a desktop app; review requests
land in a queue; Run starts a `claude` run over a checked-out worktree of the PR, on **your**
Claude subscription (the `setup-token` flow, no API key).

The bits you might care about as Claude Code users:

- **No write path in the review step.** `GH_TOKEN` and friends are scrubbed from the agent's env,
  `--disallowedTools` blocks the obvious, and the run fingerprints the PR's reviews/comments
  before and after — anything new fails the run.
- **Effort + model per run.** Quick / Standard / Deep, plan default or Opus/Sonnet/Haiku; tokens
  shown per run; identical runs are cached.
- **Skills, versioned.** A team default skill in a git repo on your box, per-repo overrides, and
  rules learned from what you drop — you approve each one.
- **Independent reviewers.** Two people on one PR get two runs in two worktrees; findings both
  runs raised get marked "confirmed".
- **Phone.** QR-pair your phone over a Cloudflare tunnel, push notifications, swipe findings to
  keep/drop, Post.

Repo (MIT): https://github.com/Wimukti/reviewstage · Docs: https://reviewstage.dev

Happy to answer anything about the gate or the skill setup. If you try it and it raises
something dumb, tell me what — that's exactly what the learnings loop is for.
