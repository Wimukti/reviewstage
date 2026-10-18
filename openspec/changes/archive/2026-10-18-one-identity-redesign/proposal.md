# One identity: redesign the app and site around the mark

## Why

ReviewStage currently has two visual identities and neither comes from its own logo.
The app is a cold near-black dashboard with an indigo accent and Inter; the website is a
warm cream page with an orange accent and Outfit. The mark itself is dark ink (`#171922`)
and one electric blue (`#3947FF`). A stranger who reads the site and then opens the app
meets a different product.

Underneath that, the app's visual language is the generic dashboard kit: twelve border
radii in one stylesheet, every surface an identical bordered card, tracked all-caps labels
on every section and status pill, emoji standing in for status icons, and no light theme
at all. The one page that matters most, the PR page, is a long undifferentiated stack in
which the single decision it exists for (what to post) sits mid-scroll below three side
cards and a banner.

The copy is good and stays. The information architecture is mostly right and stays.
This change is about making the product look like one deliberate thing, and making the
core decision the loudest element on the core page.

## Design properties touched

None of the five non-negotiables. This is presentation only; every endpoint, guard and
job path is unchanged. Where a page is restructured, every existing control keeps its
name and its behaviour.

## The idea to build around: the staging area

The product's whole promise is that findings sit in a private stage until a human commits
them to GitHub. That is a git concept engineers already carry in their heads. It becomes
the one memorable visual device:

- A **staged** finding has a solid ink-blue left edge. An **unstaged** one is a ghost
  outline. Ticking a finding fills the edge; that fill is one of only three animations in
  the app.
- The post control becomes a **commit bar** pinned to the bottom of the PR page, always
  visible, reading like a git commit footer: `3 staged · 2 inline · 1 in summary` on the
  left and `Post as acme-dev` on the right. It is the only raised surface on the page.
- Everything else is quiet: no cards for things that are not containers, no eyebrow
  labels, no decorative gradient, no emoji.

## Token system (one system, app and site)

Colour, from the two SVG variants of the mark:

| Token | Light (default) | Dark | Role |
|---|---|---|---|
| paper | `#F6F6F9` | `#101117` | page |
| panel | `#FFFFFF` | `#171922` | container |
| ink | `#171922` | `#E8E9F0` | text |
| graphite | `#5A5F73` | `#9AA0B4` | secondary text |
| hairline | `#E1E3EA` | `#262A38` | borders |
| blue | `#3947FF` | `#5C67FF` | staged state, primary action, links |
| amber | `#B8780F` | `#E0A63A` | needs you |
| red | `#C93A52` | `#F0718A` | blocker, destructive |
| green | `#1F8A5B` | `#3DD98F` | done, posted, LGTM |

Blue is the only accent. Amber, red and green carry state and nothing else. Light is the
default; the tool is used in daylight next to an editor, and a paper-first developer tool
is a deliberate departure from the dark-dashboard default. Dark follows the system
preference and can be pinned from the account card. Orange leaves the website entirely.

Type: IBM Plex Sans for interface and display, IBM Plex Mono for paths, refs, numbers and
codes. One superfamily, two clearly distinct roles, an engineered character that suits a
review tool, self-hosted through fontsource so a LAN install never fetches a font. Scale:
13 · 14 (body) · 16 · 20 · 26 · 34, line-height 1.5 for body, prose capped at 72 characters.
Sentence case everywhere; the tracked all-caps eyebrow is removed as a pattern, not
restyled.

Shape: three radii only, 4px for inputs and pills, 8px for panels, full round for
avatars. Three surface levels: page (no border), panel (hairline, no shadow), and one
raised element per page (the commit bar) that alone carries a shadow.

Status: a coloured dot plus a sentence-case word (`● Should fix`, `● Reviewing`). No
filled pills, no uppercase. The dot carries the colour so the word stays legible in
both themes and never relies on colour alone.

Icons: the existing SVG line set, everywhere. No emoji in the interface.

Motion: three, all answering the user. The running dot pulses; the staged edge fills on
tick (120 ms); the commit bar slides up the first time a finding is staged. Nothing
animates on load. `prefers-reduced-motion` disables all three.

## Page by page

**PR page.** Header with breadcrumb, title, and a single Actions menu replacing the three
side cards. One verdict line (dot, headline, reviewed-when, dry-run flag) with the key
points beneath. Findings, then four collapsed sections in a row: Full summary, What this
PR does, Approve, Re-run. Commit bar pinned at the bottom; on the phone it is a bottom
sheet. Approve keeps its typed confirmation and moved-head warning inside its section.

**Queue.** The four stat tiles duplicate the tabs and go. The paste-a-PR input moves to
the page header as a quiet field. Rows: repo, number, title on one line; state as dot
plus phrase on the second. A running row's dot pulses.

**Skills.** Six tabs, Which skill, Suggested rules, Editors, Per repository, Profiles,
Depth, replacing the accordion wall. Each tab is one screen.

**Insights.** Tiles show numbers and a two-word label only; every explanatory paragraph
moves into a single "How these are measured" disclosure at the foot of the page. Charts
are unchanged.

**Phone.** A labelled bottom tab bar, Queue, QA, Skills, More, replaces the seven
unlabelled icons. A running job is a thin strip under the header, not a pill above the
logo. Side cards never stack above primary content.

**Sidebar.** Same items, no group eyebrows, a hairline gap between the two groups. The
account card gains the theme control.

**Website.** Same tokens, same type. The live-run hero stays as the site's one memorable
element and is re-skinned to the tokens. Feature-section mocks are re-skinned so product
shots match the product. Favicon set: 32px ICO, 192 and 512 PNG, 180 Apple touch icon,
and a 1200×630 social image, all rendered from the mark. Tab title becomes `ReviewStage`
with the description in metadata.

## How this is proven

Screenshots of every page in both themes at 1440 and 390, before and after, reviewed
side by side. Measured WCAG contrast for every text token on every surface in both
themes, in a test. No horizontal scroll at 390 on any page. Keyboard focus visible on
every control. The existing 95 browser tests pass unchanged, because behaviour is
unchanged. A stranger shown the site and then the app should say they are the same
product.

## Non-goals

No new features, no copy rewrite beyond removing labels, no change to any API or
endpoint, no change to the docs site's Starlight structure beyond tokens and fonts.
