---
title: Repository profile
description: Profile a repository once so every review walks its critical paths — what is gathered, what the model sees, how to edit it, and what it costs.
sidebar:
  order: 3
---

A **repository profile** is a short, checked list of the places in a codebase where a mistake
hurts most — payments, auth, migrations, public contracts, the module everything imports — with
the checks a reviewer must perform when a PR touches one. ReviewStage builds it once per
repository and then feeds it into every review of that repository.

Without a profile the agent reads each PR cold. With one, a Standard or Deep review that touches
`app/payments/**` is told, in so many words, to verify the callers, contracts, migrations and
tests behind that path and to say what it checked.

## What it does to a review

When a profile exists for the repository being reviewed, `run-review.sh`:

- **Merges the profile's `risk_paths`** into the risk-area banners — the same `label:pattern`
  rules as `RISK_PATHS`. An operator rule wins when both define a label.
- **Appends a "Critical paths for this repository" section** to Standard and Deep prompts (never
  Quick). It lists only the `critical_paths` whose glob matches a file in the PR's diff — at most
  12, each `why` cut to 200 characters — with their `checks`, followed by the repository's
  `review_rules` and `do_not_flag` list. The agent is instructed to explicitly verify each matched
  path is not broken and to set `critical_path` on any finding that concerns one.
- **Surfaces it on the PR page.** A finding with `critical_path` carries a small *critical path*
  badge. Learnings rows keep the field, so **Insights** can show one more number: the kept rate
  of findings on critical paths.

## What is gathered — no model involved

`bin/profile-repo.sh <owner/name>` first collects deterministic signals from the base clone with
plain git, in well under a second on a small repository:

| Signal | How |
| --- | --- |
| File tree | `git ls-files`, folded into directories to depth 3 (file counts per directory, root files), capped at 400 entries |
| Languages and manifests | Extension histogram of code files; root/one-level manifests (`package.json`, `composer.json`, `pyproject.toml`, `go.mod`, `Dockerfile`, …) |
| CODEOWNERS | The first 60 lines of `CODEOWNERS`, `.github/CODEOWNERS` or `docs/CODEOWNERS` |
| CI configuration | Names of `.github/workflows/*`, `.circleci/config.yml`, `.gitlab-ci.yml`, `Jenkinsfile`, … |
| Churn | Top 40 files by commits touching them in the last 12 months (`git log --since=12.months --name-only`) |
| In-degree | Top 40 files by how many other files import them, for the dominant language — relative imports for JS/TS, dotted modules for Python, class-name stems for PHP/Java/Kotlin/C#/Rust, best effort |
| Critical-looking directories | Any directory whose name is one of `auth`, `payment(s)`, `billing`, `migration(s)`, `schema`, `api`, `public`, `webhook(s)`, `crypto`, `permission(s)`, `admin`, `security`, `session`, … with its file count |

`bin/profile-repo.sh <owner/name> --signals-only` prints exactly this JSON and exits without
calling Claude. It is what the tests use, and the quickest way to see what the model would see.

Measured on the ReviewStage repository itself (161 tracked files, 118 commits in the last 12
months, TypeScript-dominant): the signals stage took **120 ms** inside Python and about
**0.3 s** wall-clock for the whole `--signals-only` run.

## What the model sees

One `claude -p` call — **Sonnet by default**, `PRBOT_MODEL` overrides — receives the
`skills/repo-profile` skill, the signals JSON above, and a strict output contract:

```json
{
  "summary": "2-4 sentences",
  "critical_paths": [{ "path_glob": "app/payments/**", "why": "…", "checks": ["…"] }],
  "risk_paths": [{ "label": "payments", "pattern": "app/payments/" }],
  "review_rules": ["…"],
  "do_not_flag": ["…"]
}
```

The model runs in the base clone with read-only tools (`Read`, `Glob`, `Grep`) so it can confirm
a path before naming it, and nothing else. Its reply is the JSON.

**Every `path_glob` is validated against the tree.** A glob that matches no tracked file is
dropped and logged (`dropped hallucinated path_glob …` in the job log; the Skills page shows the
dropped globs under the profile). Labels are restricted to `[A-Za-z0-9_-]`, lists are bounded,
and the profile is refused entirely if nothing survives.

### Cost and duration

- The signals stage is free and fast (see the measurement above).
- The model stage is **one Sonnet call**. Its exact tokens and duration depend on the size of the
  tree and how many files the model chooses to peek at; the Skills page shows the real model,
  token count and cost of the last run once it has completed. **As an estimate, not a
  measurement**: expect roughly one to three minutes and tens of thousands of input tokens for a
  mid-sized repository. The job's own timeout is 15 minutes, and it shares the box-wide review
  lock so it never runs beside a review.

## Where it lives

```
$ROOT/profiles/<owner>__<name>/
  profile.json          the machine copy reviews read (with generation metadata)
  profile.md            the human copy — edited from the dashboard, parsed back into JSON
  profile.<ts>.json     every earlier version, kept when a new one is written
  signals.json          exactly what the model was shown
  status · pid · .lock · usage.json · agent.log · run.log
```

## Running and editing it from the dashboard

The **Skills** page has a **Repository profile** section with one card per configured
repository:

- **Status** — never run · running, with the current phase (fetching the repository → gathering
  signals → asking the model → validating paths) and a **Stop** button · or the last run's date,
  model and token count, and who edited it last.
- **Profile this repo** / **Re-profile this repo** — runs on **your** connected Claude account,
  exactly like a review; the button is disabled until you connect one in Integrations.
- **Counts** — critical paths · risk paths · review rules · do-not-flag entries, and how many
  earlier versions exist.
- **The editor** — the same Preview / Edit markdown editor used for findings. Save parses the
  markdown back into the profile (headings `## Summary`, `## Critical paths` with one `### glob`
  per path, `Why:` and `- check:` lines, `## Risk paths` as `- label: pattern`, `## Review rules`,
  `## Do not flag`), validates every path against the base clone's tree, keeps the previous
  version, and records who edited it. The next review of that repository picks it up.
- **Re-profile automatically when the file tree changes materially** — admin only; see below.

The API behind it: `GET /api/profile?repo=`, `POST /api/profile/run`, `POST /api/profile/stop`,
`PUT /api/profile` (body `md` or `json` to save, or `auto_profile` to flip the checkbox). Run,
stop and save carry the signed `profile` token from the GET; run needs a connected Claude
account.

## Automatic re-profiling

With the checkbox on, `pr-watch.sh` checks that repository **at most once a day**: it refreshes
the base clone, sorts `git ls-files`, and compares it to the list recorded at the last profile.
If at least **max(5, 2 %)** of paths were added or removed, it asks the server
(`POST /api/profile/auto`, signed with the server secret) to rebuild the profile. The server runs
it **as the admin, on the admin's connected Claude account**; if the admin has none, it logs
`auto-profile skipped … admin has no connected Claude account` and does nothing. The poller never
handles a Claude token.

The setting is stored in `settings.json` as `"auto_profile": {"<owner>__<name>": true}` — see
[Configuration](/reviewstage/operations/configuration/#runtime-settings).

## Testing it without a model

- `bin/profile-repo.sh <owner/name> --signals-only` — the deterministic stage, JSON on stdout.
- `python3 -m unittest discover -s bin -p 'test_*.py'` — `bin/test_rs_profile.py` covers glob
  validation (hallucinated globs dropped, directory globs match files beneath), risk-rule
  merging, prompt assembly (cap of 12, `why` truncation, Quick gets nothing), the markdown
  round-trip, versioning, and the signals stage on a throwaway git repository with a canned
  model reply.
- The Playwright suite renders the Skills section from an offline fixture profile and
  round-trips an edit through the editor.
