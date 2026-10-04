# r/ExperiencedDevs — discussion framing, no link in the title, link only if asked

**Title:** How are you handling review when half the PRs on your team were written by an agent?

**Body:**

Genuine question, with what we landed on at the end.

Our PR volume roughly doubled over the last year and the author of a growing share of them is
an agent with a human's name on the commit. Review became the bottleneck, and the two obvious
fixes both felt wrong: (a) rubber-stamp more, (b) add an AI reviewer bot that comments on
everything. We tried (b). The bot's comments were ignored within two weeks — nobody reads a bot
— and the one time it approved something it should not have, nobody owned it.

What we do now: the AI drafts the review *for the reviewer*, privately. The reviewer reads the
draft against the diff, keeps the two findings that matter, rewords one, drops the rest, and
posts under their own name. Approve stays a human click. Over time the tool learns what this
team drops and stops raising it. Review time went down; the comments are read because a
colleague wrote them (or at least signed them).

I built the tool we use for this and open-sourced it, but the question is the interesting
part: has anyone made the "bot comments on every PR" model actually work on a team, and if so
what did you do about ownership of its mistakes?
