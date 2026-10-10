# Lane 3 — a verification contract on every finding card

Proposal, build contract and what shipped, in one file. `recon.md` §"Lane 3" is the
reconnaissance this was built from; where the two differ, this file says what is actually in the
tree. Shipped 10/10/26 on branch `p0-verify`.

## Why

A finding card today tells the reviewer *what* is wrong (the title) and *who it hurts* (the line
labelled **Why it matters**, stored as `impact`). It does not tell them how to find out whether
the claim is true. So the human gate — the one thing this product promises — degrades into a
judgement of the prose: a confident sentence is posted, a hesitant one is dropped, and the
reviewer has not checked either. The eleven live-testing bugs in `config.yaml` include two of
this kind: findings that read well and were wrong.

The card also hides the one number the run already gives us. `confidence` is asked for in the
contract and used server-side to sort findings into the "maybe" tray, but the client sees only
`low: boolean`. A reviewer cannot tell a `high` from a `medium`.

The contract this lane adds: **every card says how sure the run is, and every finding the run
can stand behind carries one line a reviewer can execute in under two minutes.** A finding
without that line is still rendered — older runs, custom skills — but a finding with it can be
*checked* rather than *believed*.

## Non-negotiable properties touched

**Property 1** (the review step has no GitHub write path) is the only one in reach: the
normaliser runs inside `run-review.sh`, after the agent, before the file is copied out. It is
therefore written dependency-free — `json`, `os`, `sys` and nothing else — and a unit test pins
that import list. Properties 2–5 are untouched: nothing new posts, nothing runs unasked, the
run still uses the clicker's Claude account, and every reviewer's `review.json` is still their
own. The verify line is **not** posted to GitHub in this lane; it exists for the human gate only.

## Design

### 1. Schema — two optional strings per finding

| Field | In the prompt | On disk | On the wire (`Finding`) |
| --- | --- | --- | --- |
| `how_to_verify` | required of the model: ONE imperative line, < 160 chars, starts with a verb, "never 'review the code'" | string or `null` | `howToVerify: string` (`""` when absent) |
| `confidence` | already asked; now "shown on every card" | `high`/`medium`/`low` or `null` | `confidence: "high"\|"medium"\|"low"\|null`; `low: boolean` stays for older clients |
| `impact` | unchanged — the field stays `impact`; the prompt names `why_it_matters` as an accepted synonym | string or `null` | `impact: string` (unchanged) |

`impact` was not renamed because every custom skill already on disk emits it. The card's label
stays **Why it matters**; the server reads `why_it_matters` (and `whyItMatters`) into `impact`
when `impact` is missing, so a skill written from the label alone still renders.

### 2. Normalisation — `bin/rs_review_schema.py`

`normalize(review) -> (review, warnings)`. Never raises, never rejects:

- `severity` folded to `blocker|should-fix|nit|question` (case, `_`, spaces); an unknown word
  becomes `nit` with a warning; missing stays `nit` silently (the server already defaulted it).
- `confidence` folded to `high|medium|low`; unknown → `medium` with a warning; **missing → `None`**,
  not invented — a run that never stated one shows no badge.
- `title`, `impact`, `how_to_verify` trimmed; empty, whitespace or a wrong type → `None`.
- `how_to_verify` that is multi-line or over `VERIFY_CAP = 160` is dropped to `None` with a
  warning. A paragraph here is the sign the model did not have a two-minute check; rendering it
  would turn the row into a second body.
- A non-object review, a non-array `comments`, a non-object comment: each is coerced to the
  nearest renderable thing with a warning. Normalising twice equals normalising once.

Two call sites, so old and new reviews read the same:

1. `run-review.sh`, right after the `jq` shape check, as `python3 rs_review_schema.py
   review.json.tmp` (in place, atomic tmp+rename). Warnings append to `agent.log` as
   `[review-schema] finding N: …`; a failure of the step is logged and ignored, never a failed run.
2. `server.py: normalize_review`, the one load point every reader goes through (`load_review`).
   The recon placed this in `_review_data`; it moved to the load point because `review_key`,
   the post path and `explain_finding` all sort and index the comment list — folding a severity
   in the render path alone would have reordered the list the page shows against the list the
   post path indexes, exactly the class of bug the `409` guard exists for.

### 3. Card layout

Both cards, same order; nothing else moves.

```
[✓] Should fix · high confidence · In summary          app/models/Product.php:42  ⧉
A product with no vendor can crash the lead-time badge                   ← claim (title)
WHY IT MATTERS  A shopper viewing such a product sees the card fail.      ← impact
⌸ HOW TO VERIFY  Open a product whose vendor is null; the badge throws.  ← new, mono label
[Explain simply] [Edit comment] [Teach the skill]
```

- **Confidence** is a `StatusBadge tone="graphite"` reading `high|medium|low confidence`, at
  11px so it reads as a qualifier of the severity badge beside it. `high` is shown too — the
  contract is "every card states it". `data-testid="confidence"`, so the existing
  one-`status-badge`-in-the-head assertion still holds. Absent → no badge.
- **How to verify** is a `ListChecks` glyph, a mono uppercase label, and the line. Absent → the
  row is omitted; the card is then exactly the card before this lane. `data-testid="how-to-verify"`.
- **Why it matters** gains `data-testid="why-it-matters"`; otherwise unchanged.
- **Phone card** (`PhoneFindingCard`): confidence in the head row; impact and the verify line
  move *under the claim in the closed card* at 14px, so the swipe decision can be made without
  expanding. The expanded detail no longer repeats the impact.
- The shared pieces are exported from `ReviewParts.tsx` (`ConfidenceBadge`, `HowToVerify`) so
  the phone card and the site's stage scene render the same markup by construction.

### 4. Prompt

`CONTRACT` in `bin/run-review.sh` gains `how_to_verify` after `confidence`, says `why_it_matters`
is accepted for `impact`, and says confidence is shown on every card. The bundled skill's
`review.json` block (`skills/pr-review/SKILL.md` Step 7) was missing `title`, `impact` and
`confidence` entirely; it now lists all four with the same one-line rule. The desktop copy is
generated by `desktop/scripts/prepack.mjs` at pack time and is not in the tree. The repo-profile
skill emits no findings and is untouched.

## How this is proven

The real-GitHub scenario that would have caught the class: a reviewer opens a PR whose run was
made **before** this change (or by a custom skill that never heard of `how_to_verify`), and a PR
whose run emitted `severity: "major"` and a three-paragraph `how_to_verify`. The first must
render exactly as yesterday; the second must render a `nit` with no verify row, and its post
must not `409`. Both shapes are in the fixtures and the tests below; the browser suite boots the
real `bin/server.py` against them.

- `bin/test_rs_review_schema.py` (22): new shape, old shape, synonyms, vocabularies, the
  single-line and 160-char rules, garbage (None, scalars, wrong types), the CLI rewriting in
  place with warnings on stderr, and the import list.
- `bin/test_rs_job_scripts.py` (+1): the review script's post-`jq` step folds `major` → `nit`,
  reads `why_it_matters`, drops a multi-line `how_to_verify`, keeps a good one, and the warnings
  are in `agent.log` for finding 0 only.
- `bin/test_rs_prompts.py` (+3): `CONTRACT` and `SKILL.md` both name `how_to_verify` as one
  imperative line, keep `impact` and name the synonym, and ask for `confidence`.
- `bin/test_rs_post.py` (+3): `_review_data` sends `confidence` and `howToVerify`, reads the
  synonym as `impact`, gives an older review nulls, and `review_key` is the same for the loaded
  review and a re-load — folding a severity cannot 409 a post.
- `dashboard-ui/src/findingCard.test.ts` (6): desk and phone cards with every field (order
  asserted: severity · confidence · path · claim · why · verify), with none (no badge, no
  labels), with confidence only, and the two pieces render `""` for an absent value.
- `e2e/pr-page.spec.ts` and `e2e/mobile-screens.spec.ts`: the first fixture card shows `high
  confidence`, the why and verify rows in order; the second (no `how_to_verify`) shows `medium
  confidence` and no verify row.

Fixtures: `dashboard-ui/e2e/fixture.ts` (PR #38849: `confidence` on both findings,
`how_to_verify` on the should-fix only; #3 on the second repo uses `why_it_matters` and carries a
verify line), `src/stage/fixture.json` regenerated by `scripts/stage-fixture.mjs` (now maps the
two fields), `bin/demo-fixture.py` mirrored.

## What shipped

| File | Change |
| --- | --- |
| `bin/rs_review_schema.py` | new — the normaliser and its CLI |
| `bin/run-review.sh` | `CONTRACT` text; the normalisation step after the `jq` shape check |
| `bin/server.py` | `import rs_review_schema`; `normalize_review` calls it; `_review_data` sends `confidence` and `howToVerify` |
| `skills/pr-review/SKILL.md` | Step 7 block lists `title`, `impact`, `how_to_verify`, `confidence` with the rule |
| `dashboard-ui/src/api.ts` | `Finding.confidence`, `Finding.howToVerify` |
| `dashboard-ui/src/ReviewParts.tsx` | `FindingView` fields; `ConfidenceBadge`, `HowToVerify`; the card rows |
| `dashboard-ui/src/PhoneReview.tsx` | badge in the head; impact and verify under the claim; detail no longer repeats impact |
| `dashboard-ui/e2e/fixture.ts`, `scripts/stage-fixture.mjs`, `src/stage/fixture.json`, `bin/demo-fixture.py` | fixtures carry the fields on some findings and omit them on others |
| `dashboard-ui/src/findingCard.test.ts`, `bin/test_rs_review_schema.py` | new tests |
| `bin/test_rs_job_scripts.py`, `bin/test_rs_prompts.py`, `bin/test_rs_post.py`, `e2e/pr-page.spec.ts`, `e2e/mobile-screens.spec.ts` | extended |
| `docs/ARCHITECTURE.md`, `website/src/content/docs/guides/reviewing.mdx` | the field list and the card description |

## Out of scope, left open

- Posting the verify line to GitHub (a Settings toggle appending `Verify: …` to the body). The
  line is written for the reviewer, in the second person of the dashboard; the PR author would
  need a different sentence.
- Teaching the "maybe" tray to use `confidence` directly instead of `low`. `low` is kept so a
  dashboard from before this lane still sorts correctly against a new server.
- Scoring `how_to_verify` in the learnings loop (kept / edited / dropped per finding already
  exists; whether a verify line made a finding more often kept is a question for the data).
