# Teach the skill from one finding

## Why

Today a finding only changes the reviewing approach by accident of repetition. You drop the same
complaint `RULE_SUGGEST_MIN` times across several pull requests, the clustering engine notices,
and a suggestion appears on the Skills page days later. Until then every review repeats the
mistake you already corrected, and the moment you actually knew the answer — reading the finding,
deciding it was wrong — is thrown away.

The reviewer asked for the opposite: the finding in front of you should be able to teach the
skill, on purpose, with a click. Not automatically. A button on the card, a rule you read and
edit, and nothing written until you say so.

This also closes the other half. The clustering engine only ever learns from rejection, so a
finding that was *right* and worth repeating — a real bug on a critical path — teaches nothing.
A reviewer who sees that should be able to say "always check this".

## Design properties touched

None of the five are affected. Teaching writes to a skill file on disk and commits it to the
skill history; it makes no GitHub call, posts nothing, and changes no posting or approval path.
It spends the acting user's own Claude account to draft wording, exactly as Explain simply and
the existing rule drafting already do, and only on an explicit click.

## What changes

A **Teach the skill** button joins Edit comment in each finding card's action row. It opens a
panel in place, never a modal:

1. **Direction.** Two choices, because the system cannot infer intent from the card: *Don't raise
   this again* and *Always check this*. Nothing is pre-selected on a finding that carries no
   decision; a finding the reviewer has already unticked defaults to *Don't raise this again*.
2. **Draft.** One Claude call on the user's account, haiku, one turn, producing a rule of under
   twenty words in the house style of the rules already in the target skill, plus a one-line
   rationale. The prompt differs by direction.
3. **Read and edit.** The rule lands in a textarea. The panel names the exact skill it will be
   added to, and offers Redraft.
4. **Add.** The same quick-add path a hand-typed rule takes: `add_skill_rule`, the 40k size
   guard, `save_skill`, and a commit to the skill history attributed to the user.

Which skill receives the rule follows the rule already used for clusters: the repository's own
team default when that repository has one, otherwise the shared team default. Creating a
per-repository skill from a single rule would silently override the team default for every
review of that repository, so it never happens here either.

The promotion is recorded against `rs_learn.signature([row])`, the same vocabulary-keyed
signature the clustering engine uses. That is the point of reusing it: once you have taught a
complaint, the engine will not later offer you the same complaint as a fresh suggestion, and the
Skills page counts it among promoted rules like any other.

## What does not change

- The clustering suggestions on the Skills page stay exactly as they are. This is a second door
  into the same room, not a replacement.
- No finding is taught implicitly. Staging, posting, dropping and approving all behave as before,
  and none of them writes a rule.
- The review agent is untouched. It reads whatever the skill says on its next run.

## How this is proven

The real-GitHub scenario that motivates it: a reviewer opens a pull request on their own
repository, reads a nit the assistant keeps raising about `const` versus `let`, clicks Teach the
skill, chooses *Don't raise this again*, edits the drafted sentence, and adds it. The rule appears
in the team default skill on the Skills page with their name in the history, and the next review
of that repository does not raise it. The failure this guards against is the one the clustering
engine already hit in the audit: a rule that is written to a file but never reaches the prompt
window the agent actually reads. The test asserts the rule is present in the text
`read_skill(target)` returns, which is the text the run script passes to the agent, not merely
that a file changed.

Unit tests cover the single-row signature matching a later cluster of the same complaint, the
target choice for a repository with and without its own skill, the size guard, a second teach of
an already-taught finding, and both direction prompts. Browser tests cover the panel's states:
not connected, drafting, draft error, edited then added, and the added state surviving a reload.
