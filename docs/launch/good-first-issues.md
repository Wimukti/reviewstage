# Good first issues (drafts — open each as an issue with label `good first issue`)

Each has a file, the expected behaviour and the test that proves it. Keep the body to what is
here; link the contributing guide.

1. **Windows: `npx reviewstage` should fail with a helpful message instead of a stack trace.**
   `desktop/bin/reviewstage.js` — detect `win32`, print the Docker/WSL path from
   `docs/INSTALL-DESKTOP.md` and exit 1. Test: `desktop/test/tools.test.mjs` with
   `process.platform` stubbed.
2. **Doctor: report the fetched tool versions in `ROOT/bin`.** `bin/doctor.sh` — read the
   `.<tool>.version` stamps and print one PASS line each. Test: a shell test under
   `bin/test-*.sh` with a temp ROOT.
3. **Queue: keyboard shortcut `j`/`k` to move between rows, `Enter` to open.**
   `dashboard-ui/src/Queue.tsx`. Test: a Playwright spec in `e2e/shell.spec.ts`.
4. **Repository picker: "Select all visible" when a search narrows the list.**
   `dashboard-ui/src/RepoPicker.tsx`; respects `MAX_REPOS`. Test in `e2e/welcome.spec.ts`.
5. **Settings → Appearance: remember the choice per device, not per browser profile.**
   Investigate `localStorage` key `rs-theme` on the phone home-screen app vs Safari; document
   or fix. Test: `e2e/pwa.spec.ts`.
6. **Phone window: show the time remaining on the pair code and count it down.**
   `desktop/pages/phone.html` + the Settings phone card. Test: unit test of the formatter.
7. **`/api/github/repos`: include archived repositories behind a toggle, hidden by default.**
   `bin/server.py` (`gh api … --jq` filter) + picker toggle. Test: `bin/test_rs_personal.py`.
8. **Notifications: a "test notification" button per backend on Settings.**
   `bin/server.py` route + `dashboard-ui/src/Settings.tsx`. Test: Python route test with the
   fake notifier.
9. **Insights: export the current view as CSV.** `dashboard-ui/src/Dashboard.tsx`. Test:
   unit test of the CSV builder.
10. **Docs: a "Compared with" page** (Claude Code Review, CodeRabbit, Copilot review) in the
    product's own words, no rankings. `website/src/content/docs/start/compared.md`.
11. **PR page: copy a finding as Markdown.** `dashboard-ui/src/PrPage.tsx` finding card menu.
    Test: `e2e/pr-page.spec.ts` with clipboard permissions.
12. **Launcher: `--root <dir>` flag as an alias for the `ROOT` env var.**
    `desktop/bin/reviewstage.js`. Test: `desktop/test/smoke.test.mjs` (fresh root).
