# r/selfhosted

Recommended slot: Wednesday 10/14/26, 09:00 US Eastern (18:30 Colombo). Lead with where data
goes; this sub reads that paragraph first.

**Title:** ReviewStage: self-hosted PR review drafting with Claude Code, where the draft stays private and a signed-in person posts it under their own name (MIT)

**Body:**

Where the data goes, first. The server and its state live on a machine you control. The diff
and the files it touches go to Anthropic through Claude Code on each reviewer's own account.
GitHub gets sign-in, reads of the PR, and the review a person chooses to post, with their own
token. npm is checked for updates. If you turn phone access on, Apple's or Google's push service
carries a notification (never the finding text) and a Cloudflare quick tunnel carries the
connection. No telemetry endpoint ships: usage counts stay on the box unless you opt in and
configure one yourself.

What it is: a queue of PRs waiting for your review. Open one and Claude Code drafts findings
from the real diff. The draft is private. You check each finding against the code, keep, edit
or drop it, and post the result as a plain comment review under your own GitHub name. Approve
is a separate click. The drafting agent has no GitHub credentials, its write tools are denied,
and the PR's reviews, comments and threads are counted before and after the run. A difference
fails the run.

Since 1.2 each finding comes with a reading guide, a where-to-look and what-to-check line with
the cited lines on the card, an evidence check done by code, a second pass that tries to
disprove serious findings, and a Checked, Likely or Maybe label with the reason.

Install:

- One person: `npx reviewstage` (Electron through npm, macOS or Linux; the server is bundled).
  Phone access over a Cloudflare quick tunnel with a QR code that signs the phone in as you.
- A team: `docker compose up -d` on one host. Everyone signs in with their own GitHub account
  (device flow). One install watches many repositories. Slack, Discord or webhook cards.
  Windows runs this install under WSL2.

Stack: Python standard library, bash and `gh` on the server; state is files, no database;
React in front. MIT, free for private repos too.

Docs: https://reviewstage.dev/ · Security model, worth reading before pointing it at anyone
else's PR: https://reviewstage.dev/security/

Demo (68 s): https://youtu.be/yYMtQK-sVyg
