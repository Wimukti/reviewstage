# r/ExperiencedDevs

A discussion, not an announcement. No link in the title or the body; name the tool only if
someone asks, and then in a reply. Recommended slot: Friday 10/16/26, 09:00 US Eastern
(18:30 Colombo).

**Title:** How is your team reviewing PRs now that a growing share of them were written by an agent?

**Body:**

Genuine question, with what we landed on at the end.

Our PR volume grew a lot over the last year, and the author of a growing share of them is an
agent with a human's name on the commit. Review became the bottleneck. The two obvious fixes
both felt wrong to us: (a) rubber-stamp more, or (b) add an AI reviewer that posts its comments
straight into the PR. We tried (b). On our team the comments were skimmed and then ignored
within a few weeks, and when the tool approved something it should not have, nobody felt they
owned that decision.

What we do now: the AI drafts the review for the reviewer, in private. The reviewer reads the
draft against the diff, checks the two or three findings that matter, rewords one, drops the
rest, and posts under their own name. Approve stays a human click. Over time the tool learns
what this team drops and stops raising it. The comments get read because a colleague signed
them and is answerable for them.

I built the tool we use for this and open-sourced it, but the question is the interesting part.
Has anyone made the "AI posts directly into the PR" model work on a team? If so, what did you
do about ownership of its mistakes, and what did you do when people stopped reading it?
