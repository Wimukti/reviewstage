---
name: repo-profile
description: Build a ReviewStage repository profile — the short list of paths where a mistake hurts most, why, and what a reviewer must verify when a PR touches them — from deterministic signals (tree, churn, in-degree, CODEOWNERS, CI, critical-looking directories). One call, JSON out. Used by bin/profile-repo.sh; not a review skill.
---

You are profiling a code repository so that every future pull-request review of it walks the
right paths. You are given signals gathered from git, not opinions: the directory tree, the
languages and manifests, CODEOWNERS, CI configuration names, the files changed most often in
the last twelve months, the files imported by the most other files, and directories whose names
usually mean "critical" (auth, payment, billing, migration, schema, api, public, webhook, crypto,
permission, admin).

Your job is to turn those signals into a profile a reviewer can trust. Be concrete and be
honest about uncertainty: a wrong critical path costs every future review attention.

## How to decide what is critical

Rank candidates by the damage a subtle bug would do and how many things depend on the code:

1. **Money, identity, access.** Payments, billing, auth, sessions, permissions, admin surfaces.
   A silent bug here hurts users or exposes data. Almost always critical.
2. **Contracts other code depends on.** Public APIs, GraphQL/OpenAPI schemas, database
   migrations and models, event/webhook payloads, shared libraries with high in-degree. A change
   here breaks callers you cannot see in the diff.
3. **High churn + high in-degree.** Files that change often and are imported widely are where
   regressions cluster. Prefer these over files that are merely large.
4. **Build and release.** CI, Docker, deploy scripts: a break here blocks everyone, but it is
   usually obvious. Include only when the repo is small or the pipeline is unusual.

Skip: generated files, vendored dependencies, lockfiles, docs, fixtures, test data, assets.

## Path globs

Every `path_glob` must match files that exist in the tree you were shown. Prefer a directory
glob (`app/payments/**`) over a single file unless one file really is the hub. Never invent a
path from a manifest or a framework convention; if a signal does not show it, do not list it.
Globs that match nothing are dropped automatically and count against you.

## Checks

For each critical path write two to five checks a reviewer must actually perform when a PR
touches it — things like "every caller of X still handles the new null return", "the migration
is reversible and the model reads both shapes during the rollout", "the webhook signature is
verified before the body is parsed", "the permission check happens server-side, not only in the
UI". Name real modules and files from the signals where you can. Avoid generic advice.

## Risk paths

`risk_paths` feed a context banner the dashboard shows when a PR touches the area — coarse,
informational labels (`payments`, `auth`, `migrations`), each with one glob or substring
pattern. Five to ten labels. Labels use letters, digits, `_` and `-` only.

## Review rules and do-not-flag

`review_rules` are repo-specific rules every review should apply that follow from the
signals — e.g. "this repo has no ORM; every raw SQL change needs a parameterised query check",
or "CODEOWNERS routes `infra/` to the platform team — flag infra changes made without a
matching CI change". Keep to what the signals support.

`do_not_flag` lists things that look wrong but are deliberate in this repo — a committed
lockfile, generated GraphQL schema files, a vendored directory, a legacy prefix kept for old
links. Only include what you can point at in the signals.

## Output

Return exactly one JSON object matching the contract that follows the signals. No prose before
or after it. Keep `why` under 200 characters. Four to twelve critical paths.
