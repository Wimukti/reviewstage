# Tasks

Foundation (tokens, type, theme, controls, shell, phone, staged primitive) and the
website are lanes 1 and W, already in progress against design.md. The tasks below are
the page restructures that sit on the foundation, plus every audit finding not already
covered by design.md. Each task names its files so lanes do not collide. Audit row
references are to `audit.md`.

## Lane P — PR page and Stack page
Files: `dashboard-ui/src/PrPage.tsx`, `StackPage.tsx`, their e2e specs.
- [x] (09710b9) Restructure to the proposal wireframe: breadcrumb → title → one Actions menu
      (replaces the three side cards) → verdict line + key points → findings → a row of
      four collapsed sections (Full summary, What this PR does, Approve, Re-run) → commit
      bar sticky at the bottom (bottom sheet on phone). (audit should-fix 1)
- [x] (09710b9) Collapse the banner stack: dry run, stale, head moved, Claude disconnected, merged,
      placement-unknown become one status line under the title with dot-plus-word items,
      ordered by what the reviewer must act on; never more than one full-width banner,
      and only for an error. (should-fix 2)
- [x] (09710b9) After Post: the commit bar switches in place to the posted state (count → "Posted
      as <login>", button disabled, progress step ticked) without a full reload; the
      green banner is the only other change. (should-fix 3)
- [x] (09710b9) Unknown PR: keep the breadcrumb and the typed reference as the title; "Back to
      queue" and "Try another" actions; no bare red page. (should-fix 5)
- [x] (09710b9) Finding card: path on its own line under the title, full and copyable; Explain
      becomes a disclosure that can collapse; "View / edit comment" keeps one verb;
      the head row carries checkbox, severity status, placement status only. (nit 5)
- [x] (190e8e9) Stack page: same title pattern as the PR page; rows use `.status`. (nit 8)
- [x] (09710b9, 190e8e9) Severity words `Blocker / Should fix / Nit / Question` everywhere on both pages.

## Lane Q — Queue, command palette, QA index, Learnings
Files: `Queue.tsx`, `CommandPalette.tsx`, `Qa.tsx`, `Learnings.tsx`, their e2e specs.
- [x] Queue: remove the four stat tiles (the tabs carry the counts); move the paste-a-PR
      field into the page header as a quiet input; rows become two lines — repo, number,
      title / state as dot-plus-phrase, with author · age right-aligned and archive as an
      icon button revealed on hover and focus; sort as a segmented control. (nit 2, nit 3)
      — `14d9c41`
- [x] Command palette: `role=listbox` / `option` with `aria-activedescendant`; offer
      "Review PR #n" once, only when the input no longer matches an existing row. (nit 7)
      — `13630d8`
- [x] QA index: title renders the PR title only when one exists (fix `#n — PR #n`);
      empty state is an invitation to act. (should-fix 4) — `2a6e511`
- [x] Learnings: rows as a table with columns (decision, repo, path, severity, when);
      the retention footnote becomes an info disclosure; dry-run rows keep their marker
      via `.status`. (nit 9) — `4b5d29d`. No "when" column: `/api/learnings` rows carry no
      timestamp (`bin/`, out of lane); the columns are decision, finding, repository, path,
      severity.

## Lane S — Skills, Insights, Settings, Integrations, How it works, Tour
Files: `Skills.tsx`, `Rollup.tsx`, `Settings.tsx`, `Integrations.tsx`, `HowItWorks.tsx`,
`Tour.tsx`, their e2e specs.
- [ ] Skills: six tabs — Which skill, Suggested rules, Editors, Per repository, Profiles,
      Depth — each one screen; the suggested-rule card is the only primary action on its
      tab. (should-fix 10)
- [ ] Insights: tiles show number + two-word label only; every methodology paragraph
      moves into one "How these are measured" disclosure at the foot; the dry-run notice
      is one sentence; at 390 the bar chart's axis labels are legible or hidden. (should-fix 11)
- [ ] Settings: one "Save settings" that visibly applies to every editable card, placed
      where the eye lands; read-only cards say so; phone label rows never wrap one word
      per line; Devices gets a nav entry under More / Settings. (should-fix 12)
- [ ] Tour: `aria-modal`, focus trap, initial focus, Escape closes and returns focus, the
      final step ends on the queue it explains; step 4 never covers the list it points at
      on the phone. (should-fix 13)
- [ ] Integrations: cards to panels; connected state as `.status`; the Claude card's
      primary is the one primary on the page. Help moves into the account card / More.
      (nit 4)
- [ ] How it works: regenerate the embedded images from the fixture on the new UI, or
      replace them with the live mock components so they cannot drift again. (nit 10)

## Lane W addenda (already sent to the website lane)
- [ ] Closing CTA install command renders (containment collapse). (blocker 3)
- [ ] Docs sidebar group labels sentence case; "On this page" rail does not style
      "Overview" as a link. (nit 11)

## Cross-cutting, owned by whichever lane touches the file
- [ ] Vocabulary: one spelling per state and action across pages; "Sign out" /
      "Sign out everywhere" / "Revoke" each mean one thing and are used for that thing
      only. (should-fix 8)
- [ ] Colour meaning: amber only for needs-you, red only for blocker / failed /
      destructive, green only for done, blue only for staged / primary, graphite for
      neutral — including Learnings, where "dropped" is neutral, not red. (should-fix 7)
      — Learnings part done in `4b5d29d`; other pages' lanes tick the rest.

## Done when
- Every checkbox above is ticked with a commit reference.
- `after/` holds every page in both themes at both widths; a side-by-side review against
  `before/` is written up in `review.md` with what changed and what was deliberately kept.
- design.md §8 proofs all hold on main.
