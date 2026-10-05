# Show HN

**Title** (≤ 80 chars):

Show HN: ReviewStage – Claude drafts your PR review, you post it as yourself

**Text** (first comment, posted immediately after submitting the link to https://github.com/Wimukti/reviewstage):

I review a lot of PRs that an agent wrote. I did not want another bot leaving comments; I wanted
the drafting done and the posting left to me, under my own name, so the author gets a review
from a colleague and I stay accountable for it.

ReviewStage is that. `npx reviewstage` opens a window: sign in with GitHub, connect your Claude
account, pick repositories. Review requests show up in a queue. Click one, it runs a real
Claude Code review over the real diff on your own Claude plan, and stages the findings
privately: tick the ones worth posting, edit any, drop the rest. Post goes out as a plain
COMMENT review from your account. Approve is a separate button. The agent has no GitHub write
path at all — every credential is stripped from its environment and a before/after check of
the PR fails the run if anything landed.

What it learns: what you drop or reword feeds the next review of that repo, and a complaint you
drop three times becomes a proposed team rule you accept or dismiss.

Phone: enable phone access, scan a QR code, you're signed in on the phone (same session, your
own screen), add it to the home screen, turn on push. Review from the train.

Self-hosted, MIT, Python stdlib + bash on the server, React on the front. Team install is Docker
Compose on one box, every reviewer as themselves. It is Claude Code only, on purpose — it runs
on your subscription, not an API key.

Things I would like to hear about: whether the gate (nothing posts until a signed-in person
clicks) is enough for you to let it near your team's PRs, and what you drop that it keeps
raising.

Demo (70 s): https://youtu.be/yYMtQK-sVyg · Site: https://reviewstage.dev
Security model: https://reviewstage.dev/security/
