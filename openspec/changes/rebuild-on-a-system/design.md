# Rebuild on a system — lane contract

Binding for every page lane. The system is installed (commit 61954ed): Tailwind 4 under esbuild
and Vite from one source `dashboard-ui/src/tw.css`, twenty shadcn/ui components under
`dashboard-ui/src/components/ui/`, Radix, lucide-react, Geist and Geist Mono, the `@/` alias,
`cn()` in `src/lib/utils.ts`. Login (`src/Login.tsx`) is the worked example — read it first.

## 1. What a rebuilt page is

- Markup composed from `@/components/ui/*` (Button, Badge, Card, Input, Textarea, Checkbox,
  Select, Tabs, DropdownMenu, Dialog, Sheet, Tooltip, Popover, Command, Avatar, Skeleton,
  Separator, Switch, ScrollArea, Label) and Tailwind utilities. No new hand-written CSS rules
  for anything a utility or a component can express.
- Every bespoke rule for an element you rebuild is **deleted** from `styles.css` / `shell.css` /
  `review.css` / `pages.css` in the same commit. The legacy stylesheets shrink monotonically;
  a lane's report states the line count before and after.
- Behaviour is unchanged. Every `data-testid`, `role`, `aria-*`, visible label and keyboard path
  survives. Existing specs change only where a class they target was deliberately removed, and
  then to a role or test-id selector, never to a new class.

## 2. The visual rules

- **Surfaces, not borders.** Page canvas `bg-background`; panels `Card` (`bg-card`) with
  `rounded-lg`; raised menus and popovers `bg-popover`. A border appears only between two
  surfaces of the same tone (a row divider inside a card: `divide-y divide-border`). No
  `border` on buttons except the `outline` variant, and `outline` is for genuinely tertiary
  actions.
- **Icons on everything that is a kind of thing.** lucide-react at `size-4`. Severity, state,
  repository, author, model, effort, each gets a glyph. Decorative icons are `aria-hidden`.
- **Avatars.** Authors and the signed-in user render `Avatar` with
  `https://github.com/<login>.png?size=64` and initials fallback. Repositories render a small
  pill: `Avatar` of the owner + `owner/name` in sans.
- **Monospace only inside code.** `font-mono` is permitted on `<code>`, `<pre>`, the device
  code, token inputs, and diff/line numbers. Paths, repository names, counts, metadata and
  chips are sans. Grep gate: `font-mono|var(--mono)` outside those contexts is a defect.
- **Type.** `text-sm` (14px) for interface, `text-[15px] leading-relaxed` for prose bodies,
  `text-xs text-muted-foreground` for metadata. Page `h1`: `font-display text-2xl font-semibold
  tracking-tight`. Card titles `text-sm font-medium`. No `--t-*` tokens in new markup.
- **Status and severity** go through one component, `StatusBadge` in `src/ui.tsx` (lane 1 builds
  it, everyone consumes it): `Badge` + icon + label, tones blue / amber / red / green / graphite
  mapped from the existing `toneOf` / `wordOf`. The `.status` dot-and-word is removed.
- **Buttons.** `default` for the one primary action on a surface, `secondary` for the rest,
  `ghost` for icon-only and inline, `destructive` for stop/delete. Icon + label where the label
  alone is ambiguous. `size="sm"` in dense rows, default elsewhere.
- **Empty states.** A lucide icon at `size-10 text-muted-foreground`, a `font-display` title, one
  line, one Button.
- **Loading.** `Skeleton` in the shape of the content, never a spinner alone, never a bare
  "Loading…" string.
- **Motion.** Radix handles menus, dialogs and sheets. Keep the three stage-light placements:
  `.stage-login::before` (done), `.finding.is-staged` head light, `.commit-bar.has-staged`
  glow — the selectors stay as class hooks on the rebuilt markup; the rules stay in
  `review.css`. Nothing else animates on entrance.
- **Phone.** 44px targets, the bottom tab bar stays, no horizontal scroll at 390.

## 3. Lane ownership

| Lane | Rebuilds | Shared things it owns |
|---|---|---|
| **S1 shell + queue** | `Sidebar.tsx`, `Queue.tsx`, `CommandPalette.tsx` (on `Command`), `Tour.tsx`, `App.tsx` shell wrappers | `StatusBadge`, `RepoPill`, `UserAvatar`, `PageHeader` (title, optional `?` Popover, actions slot), `EmptyState` — all in `src/ui.tsx`; `shell.css` emptied |
| **S2 PR page** | `PrPage.tsx`, `ReviewParts.tsx`, `StackPage.tsx`, `src/stage/StageScene.tsx` keeps composing the rebuilt parts | `review.css` reduced to the two stage-light rules |
| **S3 the rest** | `Skills.tsx`, `Rollup.tsx`, `Learnings.tsx`, `Qa.tsx`, `Integrations.tsx`, `Settings.tsx` | `pages.css` emptied |
| **S4 site** | `website/` home, docs restyle on the same tokens, `StageFrame` inlines `tw.css` output | `verify-site.mjs` gates |
| **S5 web push** | `bin/` VAPID + subscriptions + notifier backend; `Settings` Devices entry; service worker push handler | independent of S1–S4 |

Lanes run one at a time. Each lane's gate: `pnpm typecheck && pnpm test && pnpm build`,
`RS_E2E_PORT=<unique> pnpm test:browser` once, `python3 -m unittest discover -s bin`, grep
gates from §2, screenshots of every rebuilt view in both themes at 1440 and 390 into
`openspec/changes/rebuild-on-a-system/after/<lane>/`, each one looked at.

## 4. Done when

- `grep -cE 'var\(--mono\)|font-mono' src/*.css src/*.tsx` outside `code|pre|devcode|tokfield|
  linenos` is 0.
- `grep -c '\.btn' src/*.tsx` is 0; `grep -c 'className="status' src/*.tsx` is 0.
- `styles.css + shell.css + review.css + pages.css` under 300 lines total (from 1,100).
- Every hand-rolled `role="menu"|"dialog"|"tablist"|"listbox"` is gone; Radix provides them.
- 190+ browser tests, 489 python, Docker build, site verify, all green.
- Web Push: a notification from the maintainer's test box arrives on their phone.
