# Launch kit

Everything needed to take ReviewStage public, in the order agreed: a short polish window, ten
design partners, then one morning of posts. Each post is a file here; copy it as is, fill the
two blanks (`<DEMO_LINK>`, `<ISSUE_LINK>`) and post from your own account. Dates are MM/DD/YY.

## Go-live checklist

Before the first public post, every box ticked:

- [ ] `npx reviewstage@latest` on a clean Mac (not your dev machine): wizard → queue → one
      review posted on a real PR → phone paired by QR → push notification received. Record what
      broke; fix; retag. This is the only gate that matters.
- [ ] The same on Linux (Ubuntu 24.04 VM is enough): the sandbox fallback and the tool downloads.
- [ ] A second GitHub account requests your review on a repo you watch; the Dock badge and the
      phone notification arrive without you touching anything.
- [ ] One team install from the Docker instructions by someone who has never seen the repo
      (a design partner counts), timed. Under 15 minutes to a posted review or the docs change.
- [ ] `v1.0.0` tagged — the first non-prerelease. Until then npm's `latest` is an rc, which the
      README calls out; the posts should not go out while the version string says "rc".
- [ ] README's top: the one command, the 20-second recording, the gate in one sentence. Nothing
      about Docker above the fold.
- [ ] 8–12 **good first issues** open, each with a file path, the expected behaviour, and the
      test that proves it (see `good-first-issues.md`).
- [ ] Discussions enabled on the repo; a pinned "Ask anything" thread.
- [ ] Security policy (`SECURITY.md`) reachable from the repo's Security tab; a contact that
      you read.
- [ ] A 60–90 s screen recording with voice (phone in hand for the QR scan) uploaded as an
      unlisted YouTube video → `<DEMO_LINK>`. The GIFs carry the README; the video carries the
      posts.
- [ ] You can answer, in one sentence each: *why not Claude Code Review / CodeRabbit / Copilot
      review?* (they post; this stages and you post), *what does it cost?* (your Claude plan;
      nothing else), *what leaves my machine?* (the diff to Anthropic through Claude Code, the
      review you post to GitHub; nothing else).

## Order of posting (one morning, US Eastern, Tuesday–Thursday)

| When | Where | File |
| --- | --- | --- |
| 08:30 | Hacker News — Show HN | `show-hn.md` |
| 08:40 | r/ClaudeAI and r/ClaudeCode | `reddit-claude.md` |
| day 2, 09:00 | r/selfhosted | `reddit-selfhosted.md` |
| day 3 | r/opensource | `reddit-opensource.md` |
| day 4 | r/ExperiencedDevs (discussion framing, no link in the title) | `reddit-experienceddevs.md` |
| week after | "One month later" post on the site + HN | — |

Rules for the day: reply to every comment within the hour for the first six hours; never argue
a judgement call, answer with what the thing does; if someone finds a bug, link the issue you
opened for it in your reply. Product Hunt last, if at all.
