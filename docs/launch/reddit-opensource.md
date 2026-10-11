# r/opensource

Recommended slot: Thursday 10/15/26, 09:00 US Eastern (18:30 Colombo). Lead with the design
decision and the help wanted.

**Title:** ReviewStage (MIT): the drafting agent cannot write to GitHub. Claude drafts a PR review in private; a person decides what to post under their own name. Help wanted on Windows and a GitHub App flow.

**Body:**

The design decision I would defend above any feature: the drafting agent cannot write to
GitHub. It produces a file. A signed-in person reads that file, checks each finding against the
code, and decides what becomes a review comment. It goes out under their own account. Approve is
a separate click.

That is enforced, not promised. The agent runs with no GitHub credentials, its write tools are
denied, and the PR's reviews, comments and threads are counted before and after the run. A
difference fails the run. Everything else in the project (the reading guide, the evidence check
by code, the second pass that tries to disprove serious findings, the Checked, Likely or Maybe
label, rules learned from what reviewers drop) sits behind that gate.

`npx reviewstage` for one person on macOS or Linux; Docker Compose for a team, which is also the
Windows path under WSL2. Claude Code only, on purpose: it runs on the reviewer's own Claude
plan, not a shared key. Python standard library, bash and React; no database. MIT, private
repos included.

What leaves your machine: the diff to Anthropic through your Claude Code; GitHub for sign-in,
reads and the post you authorise; npm for update checks; push and a Cloudflare tunnel only if
phone access is on. No telemetry endpoint ships.

Where I would love help:

- Windows support. The job scripts are bash; a native path needs someone who lives there.
- A GitHub App install flow, so a team does not need a service token.
- Reviewers telling me which findings they keep dropping, so the skill gets quieter.

Good first issues (#19 to #30), each with the file, the expected behaviour and the test that
proves it: https://github.com/Wimukti/reviewstage/issues?q=label%3A%22good+first+issue%22

Repo: https://github.com/Wimukti/reviewstage · Docs: https://reviewstage.dev/
