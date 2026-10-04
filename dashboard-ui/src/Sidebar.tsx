import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  ChevronsUpDown,
  ClipboardCheck,
  Code2,
  Compass,
  Ellipsis,
  ExternalLink,
  FolderGit2,
  Inbox,
  LogOut,
  Plug,
  Search,
  Settings,
  Smartphone,
  UserRoundCog,
} from "lucide-react";
import type { Me } from "./api";
import { openPalette } from "./CommandPalette";
import { phoneBridge, usePhoneStatus } from "./phone";
import { Link, useLocation } from "./router";
import { useRunning } from "./running";
import { startTour } from "./Tour";
import { ThemeControl } from "./ThemeControl";
import { HOW_URL, StatusBadge, UserAvatar } from "./ui";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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
// Personal mode picks its repositories in the app; a team install's live in .env.
const REPOS: NavItem = ["repos", "Repositories", "/repos", FolderGit2];
// The desktop app only (the preload's phone bridge is present): Settings → Your phone.
const PHONE: NavItem = ["phone", "Phone", "/settings#phone", Smartphone];
const inDesktopApp = (me: Me) => !!me.personal && !!phoneBridge();
const setupFor = (me: Me) => [...(me.personal ? [REPOS] : []), ...SETUP, ...(inDesktopApp(me) ? [PHONE] : [])];

function activeKey(path: string, hash = ""): string {
  if (path === "/") return "queue";
  if (path.startsWith("/settings") && hash === "#phone") return "phone";
  if (path.startsWith("/repos")) return "repos";
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

// A nav entry: a ghost button that is really a link; the active one sits on the accent surface.
function NavLink({ item, active, className, trailing }: { item: NavItem; active: boolean; className?: string; trailing?: ReactNode }) {
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
        {trailing}
      </Link>
    </Button>
  );
}

// The Phone item's dot: green while phone access is on.
function PhoneDot() {
  const status = usePhoneStatus();
  if (!status?.enabled) return null;
  return (
    <span className="ml-auto size-2 rounded-full bg-green" data-testid="phone-dot" title="Phone access is on">
      <span className="sr-only">on</span>
    </span>
  );
}

function LiveBadge({ me }: { me: Me }) {
  return (
    <StatusBadge
      kind={me.dry_run ? "dry" : "live"}
      title={me.dry_run ? "Dry run — nothing posts to GitHub" : "Live"}
      className="w-fit shrink-0"
    />
  );
}

// Avatar · login · Live/Dry run. Name over state, so the badge never squeezes the login to
// "ac…" in a 216px sidebar.
function AccountWords({ me }: { me: Me }) {
  return (
    <>
      <UserAvatar login={me.login || "?"} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
        <span className="truncate text-sm font-medium leading-tight" title={me.login}>{me.login}</span>
        <LiveBadge me={me} />
      </div>
    </>
  );
}

const MENU_ITEM = "focus:bg-blue/14";

// The desktop account row is the menu's trigger (shadcn NavUser): the whole row is a button
// ending in a ChevronsUpDown, and the menu opens above it — a header, then the account items.
function AccountMenu({ me, onSignOut, onSwitchAccount }: { me: Me; onSignOut: () => void; onSwitchAccount?: () => void }) {
  const login = me.login || "?";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-2.5 px-1 py-0.5 text-foreground data-[state=open]:bg-accent"
          data-testid="account-card"
        >
          <AccountWords me={me} />
          <ChevronsUpDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={6} className="w-[216px]" data-testid="account-menu">
        <DropdownMenuLabel className="flex items-center gap-2.5 px-1.5 py-1.5 font-normal">
          <UserAvatar login={login} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium leading-tight">{login}</span>
            <a
              href={`https://github.com/${encodeURIComponent(login)}`}
              target="_blank"
              rel="noopener"
              className="truncate text-xs text-muted-foreground hover:text-foreground"
              data-testid="account-profile"
            >
              github.com/{login}
            </a>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {onSwitchAccount && (
          <DropdownMenuItem className={MENU_ITEM} onSelect={onSwitchAccount} data-testid="switch-account">
            <UserRoundCog aria-hidden="true" />
            Switch GitHub account
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={MENU_ITEM} onSelect={onSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar({ me, onSignOut, onSwitchAccount }: { me: Me; onSignOut: () => void; onSwitchAccount?: () => void }) {
  const { path, hash } = useLocation();
  const active = activeKey(path, hash);
  const setup = setupFor(me);
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
          {setup.map((it) => (
            <NavLink key={it[0]} item={it} active={active === it[0]} trailing={it[0] === "phone" ? <PhoneDot /> : undefined} />
          ))}
        </div>
      </nav>

      <div className="mt-auto pt-3">
        <AccountMenu me={me} onSignOut={onSignOut} onSwitchAccount={onSwitchAccount} />
      </div>
    </aside>
  );
}

// Phone (< 900px): a 56px header with the mark and the search, and a labelled four-tab bar.
// More opens a bottom sheet with the rest of the navigation, the Help items, the theme switch,
// the account row, Switch GitHub account and Sign out. Every target is at least 44px.
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

export function PhoneShell({ me, onSignOut, onSwitchAccount }: { me: Me; onSignOut: () => void; onSwitchAccount?: () => void }) {
  const { path } = useLocation();
  const active = activeKey(path);
  const [more, setMore] = useState(false);
  const moreItems = me.personal ? [REPOS, ...MORE] : MORE;
  const inMore = moreItems.some(([k]) => k === active);

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
              <Link to={to} aria-current={active === k ? "page" : undefined}>
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
          {moreItems.map((it) => (
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
            <ThemeControl tall />
          </div>
          <div className="mt-2 flex min-h-10 items-center gap-2.5 px-2" data-testid="account-card">
            <AccountWords me={me} />
          </div>
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            {onSwitchAccount && (
              <Button variant="ghost" className="h-[44px] text-muted-foreground" type="button" onClick={onSwitchAccount} data-testid="switch-account">
                <UserRoundCog aria-hidden="true" />
                Switch GitHub account
              </Button>
            )}
            <Button variant="ghost" className="h-[44px] text-muted-foreground" type="button" onClick={onSignOut}>
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
