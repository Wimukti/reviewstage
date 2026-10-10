# Decisions that need the maintainer (10/10/26)

Everything else from the third-pass memo is either done, in progress, or scheduled below. These
items cannot be done by the assistant: they bind the maintainer's money, identity or legal
exposure, or they are judgments only the maintainer should make.

| # | Decision | Input ready | Blocked work |
| --- | --- | --- | --- |
| 1 | **Run the blind name test** (approve the protocol; recruit 10–15 testers). | `openspec/changes/rename/name-test.md` (protocol, scoring, form). | Final name. |
| 2 | **Trademark advice before purchase** — commission or skip. | Diligence checklist in `name-test.md`. | Purchase. |
| 3 | **Choose the final brand** after test + diligence. | Shortlist: KeepDrop (lead), DiffKeeper, PeerLayer. | Entire migration. |
| 4 | **Buy domains and reserve namespaces** — `<name>.dev`, `<name>.app` (defensive), npm `<name>`, GitHub rename. | `openspec/changes/rename/inventory.md` lists exactly what changes and the rollback. | Migration execution. |
| 5 | **Telemetry endpoint** — operate a first-party endpoint (where, who pays, log retention) or ship local-only counters with no endpoint at launch. | Lane 1 design in `openspec/changes/p0-proof/`. | Only the network half; local counters ship regardless. |
| 6 | **Design-partner recruiting** — the DMs come from the maintainer. | `docs/launch/design-partners.md`. | Evidence for P1. |
| 7 | **Re-record one word** in the voice-over once the name is chosen. | `docs/launch/video/voiceover-script.md`. | Launch video. |
| 8 | **Search Console + Bing** sitemap submission (needs the maintainer's Google/Microsoft login). | Live sitemap index. | Search visibility monitoring. |

## Settled — not reopened

Rename before any public launch · no Vouch · category sentence and campaign line unchanged ·
Claude Code and Plannotator are the primary comparisons · reviewers-not-reviews north star ·
precise competitor and egress copy · technical SEO lane closed unless live verification fails ·
no auto-post, no auto-approve, no signature, no one-click fixes · P1 features (incremental
re-review, `REVIEW.md` export, queue columns, verification pass, quality history) wait for
observed evidence from design partners.
