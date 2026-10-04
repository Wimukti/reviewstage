# r/ClaudeAI and r/ClaudeCode

Post the same text in both; flair "Project" / "Show and tell" where the sub has it.

**Title:** I built a PR review tool on Claude Code where Claude drafts and *you* post, as yourself — `npx reviewstage`

**Body:**

Claude Code is very good at reading a diff and finding the two things that matter. What I did
not want was a bot account posting those two things plus eight it should have kept to itself.

So: ReviewStage. One command, `npx reviewstage`. It opens a small desktop app (Electron through
npm, no installer), you sign in with GitHub, connect the Claude account you already have, and
pick the repos you review. When someone requests your review it shows up in a queue; click, and
a real Claude Code run happens on your own plan over the real diff. The findings land in a
private staging area with file and line, each editable. You tick what is worth saying, hit
Post, and it goes out as a normal review comment from *your* GitHub account. Approve is a
separate click. The agent cannot write to GitHub — the run has every credential stripped and
fails if anything reached the PR.

Things people here might care about:

- It uses your Claude subscription through Claude Code's own setup-token flow; no API key.
- Effort levels (Quick / Standard / Deep), model choice per run, tokens shown per run.
- It learns from what you drop. Drop the same nit three times → it drafts a team rule for you to
  accept. "Teach the skill" on any finding.
- Phone: scan a QR and you are signed in on your phone; push notifications for review requests.
- Everything stays on your machine (or your team's server). MIT.

Repo: https://github.com/Wimukti/reviewstage · 90-second demo: <DEMO_LINK>

Honest limits: Mac and Linux today (Windows via the Docker install), GitHub only, and it is
beta — the install and UI moved a lot this week. If something breaks I would rather hear it
here than not.
