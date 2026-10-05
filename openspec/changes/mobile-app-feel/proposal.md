# mobile-app-feel — audit and plan

Maintainer, 10/05/26: "the phone view looks really bad — the bottom navigation and the top
logo without the ReviewStage text. Can't we make this feel like a real mobile app? Audit
everything and come up with a plan."

Screens: `audit/00-login.png` … `audit/14-run-form.png`, iPhone 15 (393×852 @2x) from the
offline fixture, script `dashboard-ui/e2e/shots-mobile-audit.ts`.

## What a phone is for here

On the phone you **triage and post**: something needs your review → open it → read the
drafted findings → keep two, drop one → Post. Configuring skills, reading Insights or editing
rules are desk work. Today the phone is the desktop layout squeezed to 390px, so the screens
spend their space on desk tasks and give the phone task very little.

## Audit (worst first)

1. **No navigation bar.** The header is a bare logo and a search icon (`01`). There is no
   title in it, no back button, and every page repeats its title as a large heading under it.
   In a home-screen app there is no browser back either, so the PR page's only way back is a
   desktop breadcrumb (`Queue › acme/widgets › #38849`, `03`).
2. **The tab bar spends its slots on desk work.** Queue · QA · Skills · More: two of four tabs
   are things nobody does on a phone, while the queue has no count badge. The icons are thin
   outlines with no filled active state, and the bar is a flat strip with no blur and no
   safe-area treatment.
3. **The queue shows one PR per screen.** The search field, six status tabs wrapping onto two
   rows, a repository select, and four sort chips wrapping onto two rows fill 60% of the
   screen before the first row (`01`). Rows are cards with a truncated title
   ("Retry the vendor syn…") and a meta line that wraps.
4. **The PR page buries the findings.** Three status chips, an author line, and a three-step
   stepper that wraps with an orphaned "— Approved" fill the first screen (`03`). The commit
   bar is pinned at about 270px, a fifth of the screen, permanently, and carries a "Request
   changes instead" checkbox. Each finding's actions wrap onto two rows ("Teach the skill"
   alone on the second, `04`). Approve and Re-run sit in a tab strip under the findings.
5. **Ticking checkboxes is the only way to stage.** That is the desk interaction. The phone
   interaction is a swipe or a tap on the whole card.
6. **More is a dumping ground** (`12`): seven links, the theme control, and the account row
   with Switch account and Sign out squeezed into one line at the bottom edge.
7. **Desk pages render as-is.** Skills has six tabs wrapping and a table that scrolls sideways
   (`09`); Insights is a three-column tile grid with labels wrapping (`08`); Settings is a
   sectioned desk page with a pill row (`11`).
8. **No app behaviour.** Pages swap with no transition, there is no pull-to-refresh, no
   swipe-back, no launch screen (white flash on open), the status bar colour doesn't follow
   the theme, inputs under 16px make iOS zoom on focus, and when the Mac is away the app
   shows a raw error (fixed in `desktop-always-on` F5).

## Plan

Same React app, same server, no second codebase: a phone shell and phone layouts behind the
existing `< 900px` breakpoint, with the desktop untouched.

### M1. The shell: navigation bar + tab bar

- **Navigation bar:** a 44px bar plus a large title that collapses into the bar on scroll (the
  iOS pattern). The title is the page's name; detail pages get a **‹ Back** with the parent's
  name and the title shrinks to the PR number. Right side: one contextual action (search on
  the queue, ⋯ on a PR). The logo appears once, on the queue's large title row, beside the
  word ReviewStage. Translucent with backdrop blur, honouring the top safe area.
- **Tab bar, three tabs:** **Queue** (with a count badge of items to review) · **Activity**
  (what you reviewed, posted, approved: today's "Reviewed / Posted / Approved / All" tabs) ·
  **You** (account, Settings, Repositories, Your phone, plus Learnings, Insights, Skills and QA
  guides under a "Tools" group). Filled icon and accent colour when active, 49px plus the
  bottom safe area, translucent with blur.
- **Transitions:** push (slide in from the right) going into a PR, pop going back, a cross-
  fade between tabs, all disabled under reduced motion. **Swipe from the left edge** goes back.
- **Launch:** an iOS startup image and theme-coloured status bar so opening the home-screen
  app shows the brand, not a white flash.

### M2. Queue

- Search moves into the navigation bar (tap the icon → the field expands over the title).
- Status narrows to a 2-way segmented control: **To review** · **Waiting on others**
  (in flight). Repository and sort move into a **filter sheet** behind a filter icon; an
  active filter shows as a removable chip under the bar.
- **Rows:** full-width list rows, not cards. Title first (up to two lines), then
  `repo #number · author · 2h` small, a status pill on the right. 72px rows: six to eight
  visible per screen instead of one.
- **Swipe actions:** swipe left → Archive; swipe right → Run review (the default effort; long
  swipe runs it, short swipe shows the button). **Pull to refresh.**
- Empty state for the phone: one sentence and one button.

### M3. PR page: read, swipe, post

- **Header:** title (two lines), `repo #number · author · +42 −8`, one status pill. Claude-not-
  connected and dry-run become a single dismissible notice only when they block posting. The
  stepper is hidden on phones (the status pill says where you are).
- **Findings as a stack of cards; swipe to decide:** swipe right → **Keep** (staged, green
  edge), swipe left → **Drop** (dimmed, collapsible), tap → expand to the full text with Edit
  and Explain. The rarely used actions (Teach the skill, copy) move into the card's ⋯ menu.
  Checkboxes remain for accessibility (VoiceOver gets explicit Keep/Drop actions).
- **Post bar:** a compact floating pill — `2 kept · Post` — 56px, above the tab bar. Tapping
  Post opens a **sheet**: the count, inline vs summary, "Request changes instead", and the
  final **Post as Wimukti** button. Approve and Re-run move into the ⋯ action sheet in the
  navigation bar.
- After posting: a full-width success state with "Back to queue" and the next item's title
  (`Next: #38851 Retry the vendor sync`).

### M4. You

- An inset grouped list, iOS Settings style: your avatar and name at the top with Live/Dry run;
  **This device** (Your phone, Notifications, Appearance); **Reviewing** (Repositories,
  Poller, PR filters); **Tools** (Learnings, Insights, Skills, QA guides); then Switch GitHub
  account and Sign out as full-width rows at the bottom. Each row pushes its own page.
- **Desk pages on the phone:** Insights becomes a two-column tile grid; Skills keeps its tabs
  as a scrolling segmented row and turns the scores table into one card per skill;
  Learnings and QA guides become lists.

### M5. Feel

- Body 16px on phones (17px in lists), every input at least 16px so iOS never zooms.
- Haptics where Android supports `navigator.vibrate` (keep/drop/post); iOS gets the visual.
- Skeletons in the shape of the real rows; optimistic updates on Keep/Drop/Archive.
- The "Mac isn't reachable" screen from `desktop-always-on` styled to match.
- Tap highlight off, `overscroll-behavior` contained in scroll areas, safe areas everywhere.

### M6. Proof

- The browser suite gains phone specs for each item (swipe gestures via touch events, the
  collapse, the tab badge, the sheets), at 390×844 and 430×932.
- Screens of every page at 390 dark and light, before/after, into `after/`.
- A real-iPhone pass by the maintainer before it ships: open from the home screen, triage
  three PRs, post one.

## Order and size

M1 → M2 → M3 are the change people will feel; M4 and M5 follow. Two lanes, one after
`desktop-always-on` lands (it touches the same service worker and Settings): lane G (M1 + M4,
the shell) then lane H (M2 + M3 + M5, the screens), each about a day of agent time, then M6.

## Not in this change

A native app (Capacitor/App Store) stays on the roadmap; everything here carries over to it
unchanged, because the native shell would wrap this same build.
