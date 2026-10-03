import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Code2,
  Compass,
  Ellipsis,
  ExternalLink,
  Inbox,
  Monitor,
  Moon,
  Plug,
  Search,
  Settings,
  Smartphone,
  Sun,
} from "lucide-react";
import type { Me } from "./api";
import { openPalette } from "./CommandPalette";
import { Link, useLocation } from "./router";
import { useRunning } from "./running";
import { startTour } from "./Tour";
import { useTheme, type ThemeChoice } from "./theme";
import { StatusBadge, UserAvatar } from "./ui";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

// "How it works" lives on the site now (design.md: the app's copy duplicated the site's strip).
export const HOW_URL = "https://wimukti.github.io/reviewstage/#how-it-works";

type NavItem = [key: string, label: string, to: string, icon: LucideIcon];

// Two groups — what you do day to day, then what you configure once — separated by space alone.
const WORK: NavItem[] = [
  ["queue", "Queue", "/", Inbox],
  ["qa", "QA guides", "/qa", ClipboardCheck],
  ["learnings", "Learnings", "/learnings", BookOpen],
  ["dashboard", "Insights", "/dashboard", BarChart3],
];
const SETUP: NavItem[] = [
  ["skills", "Skills", "/skills", Code2],
  ["integrations", "Integrations", "/integrations", Plug],
  ["settings", "Settings", "/settings", Settings],
];

function activeKey(path: string): string {
  if (path === "/") return "queue";
  if (path.startsWith("/qa")) return "qa";
  if (path.startsWith("/learnings")) return "learnings";
  if (path.startsWith("/dashboard")) return "dashboard";
  if (path.startsWith("/skills")) return "skills";
  if (path.startsWith("/integrations")) return "integrations";
  if (path.startsWith("/settings")) return "settings";
  if (path.startsWith("/pr") || path.startsWith("/stack")) return "queue";
  return "";
}

// What this user has in flight: one job links straight to it; several link to the queue
// filtered to running.
function useRunningLink() {
  const jobs = useRunning();
  if (jobs.length === 0) return null;
  const one = jobs.length === 1 ? jobs[0] : null;
  const kind = one?.kind === "qa" ? "QA guide" : "review";
  return {
    to: one ? one.href : "/?tab=all&running=1",
    title: one ? `${one.repo} #${one.num} — ${one.status}` : "Jump to what's running",
    text: one ? `1 ${kind} running` : `${jobs.length} jobs running`,
  };
}

// The running indicator: a 2px amber sweep fixed to the top of the viewport, on every width.
// The words are for screen readers (and the tooltip); the bar itself is the signal. Rendered
// once by App, above whichever shell is showing. The sweep's keyframes live in shell.css.
export function RunningBar() {
  const r = useRunningLink();
  if (!r) return null;
  return (
    <Link className="runbar" data-testid="running-bar" to={r.to} title={r.title}>
      <span className="sr-only" aria-live="polite">
        {r.text}
      </span>
    </Link>
  );
}

const THEMES: [ThemeChoice, string, LucideIcon][] = [
  ["system", "System", Monitor],
  ["light", "Light", Sun],
  ["dark", "Dark", Moon],
];

// A nav entry: a ghost button that is really a link; the active one sits on the accent surface.
function NavLink({ item, active, className }: { item: NavItem; active: boolean; className?: string }) {
  const [k, label, to, Glyph] = item;
  return (
    <Button
      asChild
      variant="ghost"
      className={cn("h-[36px] w-full justify-start gap-2.5 px-2 text-muted-foreground hover:no-underline", active && "bg-accent text-foreground", className)}
    >
      <Link to={to} aria-current={active ? "page" : undefined} data-tour={k} data-active={active || undefined}>
        <Glyph aria-hidden="true" className={cn(active && "text-primary")} />
        <span>{label}</span>
      </Link>
    </Button>
  );
}

// Theme as a radio group of three buttons: the phone sheet shows it in the open, the desktop
// account menu uses the DropdownMenu radio items instead.
function ThemeRadios() {
  const [choice, setChoice] = useTheme();
  return (
    <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Theme" data-testid="theme-control">
      {THEMES.map(([k, label, Glyph]) => (
        <Button
          key={k}
          type="button"
          role="radio"
          variant={choice === k ? "secondary" : "ghost"}
          aria-checked={choice === k}
          data-theme-choice={k}
          className={cn("h-[44px]", choice !== k && "text-muted-foreground")}
          onClick={() => setChoice(k)}
        >
          <Glyph aria-hidden="true" />
          {label}
        </Button>
      ))}
    </div>
  );
}

function LiveBadge({ me }: { me: Me }) {
  return (
    <StatusBadge
      kind={me.dry_run ? "dry" : "live"}
      title={me.dry_run ? "Dry run — nothing posts to GitHub" : "Live"}
      className="shrink-0"
    />
  );
}

// One row: avatar · login · Live/Dry run. On the desktop it ends in a ⋯ menu holding the theme
// switch and the Help items; on the phone the sheet shows those directly.
const MENU_ITEM = "focus:bg-blue/14";

function AccountRow({ me, more }: { me: Me; more?: boolean }) {
  const [choice, setChoice] = useTheme();
  const moreBtn = useRef<HTMLButtonElement>(null);
  // Starting the tour from the menu: the menu's focus trap is still up inside onSelect, so the
  // tour starts as the menu closes, takes focus instead of ⋯, and hands it to ⋯ when it ends.
  const touring = useRef(false);
  return (
    <div className="flex min-h-9 items-center gap-2 pl-1" data-testid="account-card">
      <UserAvatar login={me.login || "?"} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{me.login}</span>
      <LiveBadge me={me} />
      {more && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={moreBtn} variant="ghost" size="icon-sm" aria-label="More" data-testid="account-more" className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground">
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            className="w-56"
            data-testid="more-menu"
            onCloseAutoFocus={(e) => {
              if (touring.current) {
                touring.current = false;
                e.preventDefault();
                startTour(moreBtn.current);
              }
            }}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={choice} onValueChange={(v) => setChoice(v as ThemeChoice)} data-testid="theme-control" aria-label="Theme">
              {THEMES.map(([k, label, Glyph]) => (
                <DropdownMenuRadioItem key={k} value={k} data-theme-choice={k} className={MENU_ITEM}>
                  <Glyph aria-hidden="true" />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Help</DropdownMenuLabel>
            <DropdownMenuItem asChild className={cn(MENU_ITEM, "text-foreground hover:no-underline")}>
              <a href={HOW_URL} target="_blank" rel="noopener">
                <ExternalLink aria-hidden="true" />
                How it works
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={MENU_ITEM}
              onSelect={() => {
                touring.current = true;
              }}
            >
              <Compass aria-hidden="true" />
              Take a tour
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function Sidebar({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { path } = useLocation();
  const active = activeKey(path);
  return (
    <aside
      data-testid="sidebar"
      className="sticky top-0 flex h-dvh w-[216px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-background px-2.5 py-3"
    >
      <Link className="flex items-center gap-2 px-2 pb-3 pt-1 text-sm font-semibold text-foreground hover:no-underline" to="/">
        <Logo me={me} className="size-5" />
        <span>{me.brand}</span>
      </Link>

      <Button variant="secondary" className="mb-1 w-full justify-start px-2.5" type="button" onClick={openPalette}>
        <Search aria-hidden="true" />
        <span className="flex-1 text-left">Review a PR</span>
        <kbd className="font-mono text-[11px] leading-[18px] text-muted-foreground">⌘K</kbd>
      </Button>

      <nav className="mt-2 flex flex-col gap-0.5" aria-label="Main">
        <div className="flex flex-col gap-0.5" data-testid="nav-work">
          {WORK.map((it) => (
            <NavLink key={it[0]} item={it} active={active === it[0]} />
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-0.5" data-testid="nav-setup">
          {SETUP.map((it) => (
            <NavLink key={it[0]} item={it} active={active === it[0]} />
          ))}
        </div>
      </nav>

      <div className="mt-auto flex flex-col gap-1 pt-3">
        <AccountRow me={me} more />
        <div className="flex items-center justify-end">
          <Button variant="ghost" size="sm" type="button" className="text-muted-foreground" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </aside>
  );
}

// Phone (< 900px): a 56px header with the mark and the search, and a labelled four-tab bar.
// More opens a bottom sheet with the rest of the navigation, the theme switch, the account row
// and Sign out. Every target is at least 44px.
const TABS: NavItem[] = [
  ["queue", "Queue", "/", Inbox],
  ["qa", "QA", "/qa", ClipboardCheck],
  ["skills", "Skills", "/skills", Code2],
];
const MORE: NavItem[] = [
  ["learnings", "Learnings", "/learnings", BookOpen],
  ["dashboard", "Insights", "/dashboard", BarChart3],
  ["integrations", "Integrations", "/integrations", Plug],
  ["settings", "Settings", "/settings", Settings],
  ["devices", "Devices", "/settings#devices", Smartphone],
];

const TAB_CLASS =
  "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-none text-xs font-medium text-muted-foreground hover:no-underline [&_svg]:size-5";

export function PhoneShell({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { path } = useLocation();
  const active = activeKey(path);
  const [more, setMore] = useState(false);
  const inMore = MORE.some(([k]) => k === active);

  // The sheet closes on navigation (Escape and the trigger's focus return are Radix's).
  useEffect(() => setMore(false), [path]);

  return (
    <>
      <header className="phone-head sticky top-0 z-30 flex h-14 items-center justify-between bg-background px-4">
        <Link className="-ml-2 flex size-[44px] items-center justify-center" to="/" aria-label={me.brand}>
          <Logo me={me} className="size-6" />
        </Link>
        <Button variant="ghost" size="icon-lg" className="-mr-2 size-[44px]" type="button" aria-label="Review a PR" title="Review a PR" onClick={openPalette}>
          <Search aria-hidden="true" className="size-5" />
        </Button>
      </header>

      <Sheet open={more} onOpenChange={setMore}>
        <nav
          className="tabbar fixed inset-x-0 bottom-0 z-30 flex h-[calc(56px+env(safe-area-inset-bottom,0px))] border-t bg-background pb-[env(safe-area-inset-bottom,0px)]"
          aria-label="Main"
          data-testid="tab-bar"
        >
          {TABS.map(([k, label, to, Glyph]) => (
            <Button key={k} asChild variant="ghost" className={cn(TAB_CLASS, active === k && "text-primary")}>
              <Link to={to} aria-current={active === k ? "page" : undefined} data-tour={k}>
                <Glyph aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </Button>
          ))}
          <SheetTrigger asChild>
            <Button type="button" variant="ghost" className={cn(TAB_CLASS, inMore && "text-primary")} data-testid="more-tab">
              <Ellipsis aria-hidden="true" />
              <span>More</span>
            </Button>
          </SheetTrigger>
        </nav>

        <SheetContent
          side="bottom"
          data-testid="more-sheet"
          aria-label="More"
          className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-xl border-t-0 bg-card px-2 pb-[calc(12px+env(safe-area-inset-bottom,0px))]"
        >
          <SheetHeader className="px-2 pb-2 pt-4">
            <SheetTitle className="text-sm">More</SheetTitle>
            <SheetDescription className="sr-only">The rest of the navigation, the theme and your account.</SheetDescription>
          </SheetHeader>
          {MORE.map((it) => (
            <NavLink key={it[0]} item={it} active={active === it[0]} className="h-[44px]" />
          ))}
          <Button asChild variant="ghost" className="h-[44px] w-full justify-start gap-2.5 px-2 text-muted-foreground hover:no-underline">
            <a href={HOW_URL} target="_blank" rel="noopener">
              <ExternalLink aria-hidden="true" />
              <span>How it works</span>
            </a>
          </Button>
          <Button
            variant="ghost"
            className="h-[44px] w-full justify-start gap-2.5 px-2 text-muted-foreground"
            type="button"
            onClick={() => {
              setMore(false);
              startTour();
            }}
          >
            <Compass aria-hidden="true" />
            <span>Take a tour</span>
          </Button>
          <div className="px-2 pb-1 pt-3">
            <div className="mb-1.5 text-xs text-muted-foreground">Theme</div>
            <ThemeRadios />
          </div>
          <div className="mt-2 px-1">
            <AccountRow me={me} />
          </div>
          <div className="mt-1 flex justify-end">
            <Button variant="ghost" className="h-[44px] text-muted-foreground" type="button" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
