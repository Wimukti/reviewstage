# r/selfhosted

**Title:** ReviewStage — self-hosted PR review assistant (Claude Code) where nothing reaches GitHub until a human clicks

**Body:**

The pitch for this sub: your tokens, your team's review data and the model's output stay on a
box you control. The only thing that leaves is the diff to Anthropic (through Claude Code, on
each reviewer's own account) and the review a person chooses to post to GitHub.

What it is: a queue of PRs waiting for your review; click one, Claude Code reviews the real
diff; findings are staged privately; you tick, edit, post — as yourself, as a plain review
comment. No bot account, no auto-approve, no "request changes" from a machine. The review step
has no GitHub write path; a fingerprint check fails the run if anything landed on the PR.

Install:

- One person: `npx reviewstage` (Electron via npm, Mac/Linux; the server is bundled). Phone
  access over a Cloudflare quick tunnel with a QR that signs the phone in.
- A team: `docker compose up -d` on one host (2 GB RAM, 3 GB disk). Everyone signs in with their
  own GitHub account; one install watches many repos; Slack/Discord/webhook cards; GitHub
  webhook receiver optional (polling works without it).

Stack: Python standard library + bash + `gh` on the server, no database (state is files), React
on the front. MIT.

Docs: https://reviewstage.dev/ · Security model, worth reading before pointing it
at anyone else's PR: https://reviewstage.dev/security/

Demo (70 s): https://youtu.be/yYMtQK-sVyg
