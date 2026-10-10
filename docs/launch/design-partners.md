# Design partners — recruit 10, observe 3 real reviews each

The next proof point is not a feature. It is a real reviewer who installs, receives a private
draft, verifies a useful finding, posts under their own name, and comes back on their own.
Dates MM/DD/YY. Nothing here is posted publicly; it is DMs and calls.

## Who qualifies (all five)

1. Reviews PRs on GitHub on a real repository (work or serious OSS), and **receives review requests**.
2. Already uses Claude Code or another coding agent.
3. Reviews AI-assisted or agent-authored changes at least weekly.
4. Can run it on private or realistic work under whatever agreement their employer needs
   (the diff goes to Anthropic on *their* Claude account; nothing comes to us).
5. Will give three real PRs and one 30-minute interview over ~3 weeks.

Prefer: senior/staff; at least two on Linux; at least two whose team has muted a review bot.

## Where to find them (no public posts)

- Blind-name-test participants who answered "yes" to "may we contact you".
- Former colleagues who now run teams that ship agent-written code.
- Authors of recent r/ClaudeCode / r/ExperiencedDevs threads about reviewing AI PRs (DM, don't reply publicly).
- People who starred Plannotator or `mitchellh/vouch` in the last 30 days and show GitHub review activity.

## The ask (DM template)

> I'm building a small open-source tool for people who get asked to review PRs that an agent
> wrote. Claude drafts the review privately; you keep/edit/drop and post it as yourself.
> Nothing posts until you click. Would you try it on three real PRs over the next few weeks and
> let me watch the first one over a call? ~45 min first time, then I stay out of your way.
> It runs on your own Claude plan; the diff never comes to me.

## Session 1 — observed first use (45 min, screen share, record with permission)

Observe. Take control **only** if they are blocked for more than 3 minutes.

| Timestamp | What to capture |
| --- | --- |
| t0 | `npx reviewstage` typed → app window visible. Time it. |
| | GitHub sign-in: did the device-flow page open? Did they read the code? Hesitation? |
| | Claude connect: did they understand it uses their plan? Any "is this safe?" question — quote it. |
| | Repository selection: did they find their repo first try? |
| | First draft arrives: time from "Review" click to findings shown. |
| | **Before they read findings:** did they open the diff on GitHub themselves? |
| | Per finding: keep / edit / drop, **ask "why?" after the decision, never before.** Write the reason verbatim. |
| | Did they check "How to verify" / confidence / path:line? Which of the three did they look at? |
| | Post: did they open the sheet, read the preview, change anything? Did they notice it posts as them? |
| | Approve: did they look for an approve button? Did they expect it to approve for them? |
| | Any pause > 10 s: timestamp + what was on screen. |
| | Any error: exact text, what they did next. |

Close with three questions, not more: "What made a finding trustworthy or not?" "What would
have made you drop the whole draft?" "Will you run it on your next requested review without
me?" — record the answer to the third as yes / maybe / no, no persuasion.

## Sessions 2 and 3 — unobserved

They review two more real PRs on their own. After each, one message: "Anything that stopped
you, confused you or was wrong?" Read their learnings file with them only if they offer.

## Interview after the third review (30 min)

1. Walk me through the last one. Where did you spend time?
2. Which findings did you drop, and why? (Compare with the dismissal reasons recorded.)
3. Did a finding ever make you look at code you'd have skipped?
4. What did you edit before posting, and what was wrong with the draft wording?
5. Did anyone on your team react to a posted review? Did they know it was drafted?
6. What would make you stop using it? What would make you tell a colleague?
7. What were you using before — `/code-review`, Plannotator, a bot, nothing?
8. Ask for a return commitment **only if they volunteered value in 5 or 6.**

## What to record per partner (one row in `docs/launch/partners.csv`, kept private — add to .gitignore)

`partner_id, os, agent_used, install_seconds, first_draft_seconds, rescued (y/n), findings_shown,
kept, edited, dropped, drop_reasons, opened_diff_independently (y/n), posted (y/n),
nothing_worth_posting (y/n), returned_week2 (y/n), returned_week4 (y/n), would_tell_colleague
(y/maybe/n), top_quote`

## Gates (internal thresholds, not benchmarks)

- 10 partners, 3 real PRs each.
- ≥ 7 of 10 complete the first review without synchronous rescue.
- ≥ 5 of 10 return voluntarily the following week.
- Every install and post failure has a known category.
- ≥ half of completed runs end in a posted review **or** an explicit "nothing worth posting".
- Dominant dismissal reasons known before any precision work begins.

Do not optimise for praise. Optimise for observed repeated use.
