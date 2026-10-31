# Tasks

## Server — `bin/server.py`, `bin/test_rs_teach.py`
- [x] `finding_row` / `finding_cluster`: one stored finding in the shape the clustering engine
      uses, so `suggestion_target`, `covered_by_rule` and `promote` work on it unchanged.
- [x] `stored_finding`: resolve the client's index against the stored review, sorted exactly as
      `_review_data` sorts it, so the index cannot address a finding that is not there.
- [x] `_teach_prompt` / `draft_teach`: one haiku turn on the acting user's account, prompt over
      stdin, different ask per direction, house style from the target skill's existing rules.
- [x] `teach_finding`: `draft` writes nothing; `add` goes through `add_skill_rule`, the 40k
      guard, `save_skill`, `commit_skill_change` and `rs_learn.promote`, under the same
      per-skill lock `accept_suggestion` uses.
- [x] Two duplicate guards: the exact signature (a nit's gist is too thin for the fuzzy one) and
      `covered_by_rule` (a reworded complaint the signature cannot see).
- [x] `teach_target_label`, named apart from the existing `skill_label(skill_id, viewer)`.
- [x] Route `/api/teach` behind a `teach` action token; `teach` token minted for the page;
      `taught` per finding and a page-level `teach` block in the payload.
- [x] 28 unit tests, including the route seam: a token for another action is refused and writes
      nothing, an unknown action is a 400, a missing index is a 400 not a 500.

## Client — `dashboard-ui/src/{api.ts,PrPage.tsx,styles.css}`, `e2e/teach.spec.ts`
- [x] `TeachDirection`, `TeachResult`, `Finding.taught`, `PrData.teach`, `api.teach`.
- [x] `TeachPanel`: direction, drafting, editable rule naming its target skill, Redraft, Add,
      the added state with a link to Skills, and the not-connected state.
- [x] The button in the finding actions row; disabled and reading **Already a rule** when the
      server says this complaint is already one.
- [x] Styles in the token system; `textarea.teach-in` matches the element because the base
      `textarea.in` rule outranks a bare class.
- [x] 9 browser tests: offered and labelled, not-connected, direction reaches the server, a
      draft is not a write, the reviewer's edit is what is sent, the added state, a server
      refusal is shown, a draft failure leaves the panel usable, already-taught from first render.

## Docs
- [x] `website/src/content/docs/guides/skills-and-learnings.md`: a section before the clustering
      one, covering the four steps, the targeting rule and the shared signature.

## Done when
- [x] `python3 -m unittest discover -s bin` green.
- [x] `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:browser` green.
- [x] `website pnpm build`, `pnpm check` green.
- [x] The panel reviewed as a screenshot in both themes, in its draft and added states.

## Deliberately not done
- No confidence or frequency weighting on a taught rule: a rule is a rule, and the skill has no
  notion of a weak one.
- No undo in the panel. A rule is a line in a skill file under version control; removing it is
  an edit on the Skills page, which is where every other rule is removed.
- No teaching from the Learnings table. The finding card is where the reviewer has the context
  to judge; the table is a log.
