# r/opensource

**Title:** ReviewStage (MIT): a human-gated AI code review assistant — it drafts, you post under your own name

**Body:**

Open-sourced this a few weeks ago after running it internally. The design decision I would
defend above any feature: the agent can never write to GitHub. It produces a file. A signed-in
person decides what in that file becomes a review comment, and it goes out under their account.
Approve is a separate click. That gate is the whole product; everything else (learning from
what you drop, QA guides from the same diff, Insights) sits behind it.

`npx reviewstage` for one person; Docker Compose for a team. Claude Code only (on purpose — it
runs on the reviewer's own subscription, not a shared key). Python stdlib + bash + React,
no database.

Where I would love help: Windows support (the job scripts are bash), a GitHub App install flow,
and reviewers telling me which findings they keep dropping. Good first issues are tagged:
<ISSUE_LINK>

Repo: https://github.com/Wimukti/reviewstage · Docs: https://reviewstage.dev/
