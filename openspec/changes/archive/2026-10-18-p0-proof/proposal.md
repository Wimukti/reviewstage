# p0-proof — prove the loop before widening the product

Source: the third-pass decision memo (10/10/26). Order from `recon.md` §"Cross-lane ordering".
All five lanes shipped 10/11/26 on `main`; each lane file holds proposal · design · what shipped.

| Lane | Branch | What a reviewer gets | Doc |
| --- | --- | --- | --- |
| 3 | `p0-verify` | Every finding card: claim · severity · confidence · path:line · why it matters · **how to verify**. Old runs render unchanged (`bin/rs_review_schema.py` normalises, never rejects). | `lane3-verify.md` |
| 5 | `p0-doctor` | `reviewstage --doctor` no longer fails personal installs; checks Claude + GitHub auth and expiry, port from `desktop.json`, permissions, environment; `--json`, `--live`, `--strict`. | `lane5-doctor.md` |
| 4 | `p0-replay` | `/try` — the shipped PR page running on fixtures with no auth and no network (CSP `connect-src 'none'`); three finding types (keep · drop · edit); `/examples/<slug>/` static pages; local-only conversion counters. | `lane4-replay.md` |
| 2 | `p0-reasons` | Optional reason on every drop (7-slug taxonomy); drop stays instant; reasons stored on learnings, counted (`rs_learn.reason_counts`), shown on Learnings/Skills, steer rule proposals. | `lane2-reasons.md` |
| 1 | `p0-telemetry` | Local counters always; network telemetry off unless `RS_TELEMETRY≠0` **and** admin enabled **and** user consented **and** `RS_TELEMETRY_ENDPOINT` set (shipped: unset). Welcome consent card, Settings → Privacy (view/export/clear/disable), published schema, tests that prove zero egress. | `lane1-telemetry.md` |

Gates on the merged tree (10/11/26): Python 691 OK · dashboard typecheck clean, unit 119 ·
desktop 39 pass / 1 skipped (live tunnel) · website build 28 pages, check clean, verify all
passed · Playwright: see the release notes.

Not built, on purpose (memo P1 — needs design-partner evidence first): incremental re-review,
`REVIEW.md` export, queue signal columns, dedicated disproof pass, repository quality history.
Partner protocol: `docs/launch/design-partners.md`.
