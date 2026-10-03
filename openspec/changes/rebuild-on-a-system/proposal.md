# Rebuild the interface on a design system, instead of a third bespoke pass

## Why the first two passes did not land

The maintainer's verdict after each pass was the same: "it looks old, the fonts are not good."
Both passes were real work and both were wrong in the same way.

Rendering the current PR page in four typefaces settles the font question. Geist reads a little
more modern than IBM Plex; Inter and Onest sit between. None of them changes the verdict,
because the layout is identical in every render and the layout is what reads old:

- **Borders are the structure.** Every card, button, input, tab, chip and table cell is a 1px
  hairline box. The 2019 GitHub register. Modern tools (Linear, Vercel, Raycast, Arc) structure
  with surface tone and spacing, and use a border only where two surfaces of the same tone
  meet.
- **Everything is text.** Statuses are a dot and a word. Severity is a dot and a word. The
  repository is a monospace string inside the title. Authors are a word. There is not one icon,
  avatar or glyph in the content area. The eye has nothing to land on.
- **Monospace everywhere.** `var(--mono)` is used in 20 places in the stylesheet: repository
  names, paths, chips, metadata, counts. Monospace outside a code block is the single strongest
  "developer intranet" signal there is.
- **Buttons are outlined boxes with text.** No fill, no weight, no icon.
- **The bespoke CSS is the cause, not the symptom.** Two passes of hand-written CSS by the same
  author produced the same visual language twice, under two different contracts. A third
  contract will do it a third time.

## What to do instead

Adopt **shadcn/ui** (Radix primitives + Tailwind, the component system most 2025–26 developer
products are visibly built on) for the app, and build the site on the same tokens. This is not a
restyle. It is replacing the hand-rolled component layer with one whose defaults already look
like the references the maintainer named.

What that buys, concretely:

| | Now | After |
|---|---|---|
| Buttons | 1px outlined boxes | filled subtle (`secondary`), filled accent (`default`), ghost, with icons |
| Structure | hairline on everything | surface tone + 8–12px radius + one soft shadow tier; borders at 8% white only between same-tone surfaces |
| Status / severity | dot + word | icon + label `Badge`, colour-coded, 6 severities and states as one component |
| Repository, author | monospace string / bare word | GitHub avatar + name, repository as a small pill with its avatar |
| Interface type | Plex 13px | **Geist** 14px / 15px body, Geist Mono only inside code |
| Finding card | bordered box, checkbox in a header bar | conversation card: severity accent, title, path as a pill, actions on hover, selection as a filled check |
| Inputs, selects, tabs, menus, dialogs, tooltips, toasts, command palette | hand-rolled each | Radix: accessible by default, keyboard-complete, animated |
| Loading | none | skeletons |
| Empty states | a line of text | illustration + one line + one action |

Everything the previous passes got right is kept: dark default, one blue, the stage light in its
three places, the five non-negotiable properties, the browser suite, the site rendering the
app's components in shadow roots (Tailwind's output inlines into the shadow root exactly as the
current stylesheet does).

## The site

Same system. The home page stays four sections and under 400 words. What changes is the
surface: shadcn's `Card`, `Badge`, `Button`, `Tabs` for the strip, Geist throughout, the hero
frame with a subtle inner highlight and the stage light. The docs sidebar restyled with the same
components. Nothing hand-rolled.

## Mobile

The app is already an installable PWA: standalone display, icons, service worker, offline shell.
A reviewer can add it to their home screen today and review from a phone without the laptop.
That is proven at 390px by the browser suite on every push.

What is missing is **push**: nobody is told a review is waiting unless they open the app or read
Slack/Discord. Web Push (VAPID key pair on the server, a subscription per device, one more
notifier backend beside Slack and Discord) reaches installed PWAs on Android, iOS 16.4+ home
screen, and desktop browsers. That is one feature, server plus client, and it is the whole of
"review with their phones even if the laptop is not with them."

A **native app** (Capacitor wrapping the same React build) adds App Store presence and native
push. It is worth doing only when a paying team asks for store distribution. The device-token
auth path it needs already exists.

## Desktop

The server runs on a box; a desktop app is a shell around its URL. **Tauri** (Rust, ~3 MB) over
Electron (~150 MB). What it adds over the browser: a dock icon, a badge with the number of PRs
waiting, native notifications, a global shortcut to the command palette, launch at login. Real,
modest value. Do it after Web Push, because notifications are the only part people would
actually feel, and Web Push gives desktop browsers the same thing first.

## Phasing

1. **System** (one lane, first): Tailwind + shadcn into `dashboard-ui` under esbuild; Geist
   self-hosted; token bridge so `tokens.css` drives Tailwind's theme and the site stays
   byte-identical; one page (login) rebuilt end to end as the proof; contrast test extended.
2. **App pages** (three parallel lanes): shell + queue; PR page + stack; the rest.
3. **Site** (one lane): home, docs, with the app's rebuilt components in the hero and strip.
4. **Web Push** (one lane, independent of the above): VAPID, subscriptions, notifier backend,
   Settings → Devices entry, iOS install hint.
5. **Proof**: full gates, screenshots, review.
6. **Tauri desktop shell** and **Capacitor** when there is demand.

## How this is proven

- The before set is `../stage-light/after/`. The after set is screenshotted from one build.
- `grep -c 'var(--mono)' styles` outside `pre, code` is 0.
- No `border: 1px solid var(--hairline)` on `button`, `.card`, `.row`, `.tab`.
- Every interactive primitive is a Radix component (grep for hand-rolled `role="menu"`,
  `role="tablist"`, `role="dialog"` returns only Radix's).
- Web Push: a real notification arrives on the maintainer's phone from the test box.
- The maintainer looks at the login screen and the PR page and does not call them old.
