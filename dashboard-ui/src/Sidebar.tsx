import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  ChevronsUpDown,
  ClipboardCheck,
  Code2,
  FolderGit2,
  Inbox,
  LogOut,
  Plug,
  Search,
  Settings,
  UserRoundCog,
} from "lucide-react";
import type { Me } from "./api";
import { openPalette } from "./CommandPalette";
import { Link, useLocation } from "./router";
import { useRunning } from "./running";
import { StatusBadge, UserAvatar } from "./ui";
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
const setupFor = (me: Me) => (me.personal ? [REPOS, ...SETUP] : SETUP);

function activeKey(path: string): string {
  if (path === "/") return "queue";
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

export function LiveBadge({ me }: { me: Me }) {
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
  const { path } = useLocation();
  const active = activeKey(path);
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
            <NavLink key={it[0]} item={it} active={active === it[0]} />
          ))}
        </div>
      </nav>

      <div className="mt-auto pt-3">
        <AccountMenu me={me} onSignOut={onSignOut} onSwitchAccount={onSwitchAccount} />
      </div>
    </aside>
  );
}
