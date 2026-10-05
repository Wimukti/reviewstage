// The phone's You tab (openspec/changes/mobile-app-feel M4): an inset grouped list in the iOS
// Settings shape. Who you are first, then this device, what gets reviewed, the desk tools,
// a few odds and ends, and the account actions as full-width rows at the end. Every row with
// a chevron pushes a page; a Settings row pushes its section as a page of its own (/you/<id>).
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  BookOpen,
  ChevronRight,
  ClipboardCheck,
  Code2,
  Compass,
  ExternalLink,
  Filter,
  FolderGit2,
  KeyRound,
  Laptop,
  LogOut,
  Palette,
  Plug,
  Radar,
  Settings as SettingsIcon,
  Smartphone,
  UserRoundCog,
} from "lucide-react";
import type { Me } from "./api";
import { Link, navigate } from "./router";
import { sectionsFor } from "./Settings";
import { LiveBadge } from "./Sidebar";
import { useTheme } from "./theme";
import { startTour } from "./Tour";
import { HOW_URL, PageHeader, UserAvatar, type Tone } from "./ui";
import { cn } from "@/lib/utils";

const TILE: Record<Tone, string> = {
  blue: "bg-blue/14 text-blue",
  amber: "bg-amber/14 text-amber",
  green: "bg-green/14 text-green",
  red: "bg-red/14 text-red",
  graphite: "bg-graphite/14 text-graphite",
};

const ROW =
  "flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] text-foreground hover:no-underline active:bg-accent/60";

function Glyph({ icon: I, tone }: { icon: LucideIcon; tone: Tone }) {
  return (
    <span className={cn("flex size-[30px] shrink-0 items-center justify-center rounded-lg", TILE[tone])} aria-hidden="true">
      <I className="size-[18px]" />
    </span>
  );
}

// The words of a row, with the hairline that separates rows drawn under them (inset past the
// tile, the iOS way) rather than across the whole card.
function Words({ label, detail, trail }: { label: ReactNode; detail?: ReactNode; trail?: ReactNode }) {
  return (
    <span className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 border-b border-border py-2 group-last/row:border-b-0">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail != null && <span className="shrink-0 text-sm text-muted-foreground">{detail}</span>}
      {trail}
    </span>
  );
}

type Item = { key: string; label: string; icon: LucideIcon; tone: Tone; to?: string; href?: string; detail?: ReactNode; onClick?: () => void };

function Row({ it }: { it: Item }) {
  const inner = (
    <>
      <Glyph icon={it.icon} tone={it.tone} />
      <Words
        label={it.label}
        detail={it.detail}
        trail={
          it.href ? (
            <ExternalLink aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground/70" />
          )
        }
      />
    </>
  );
  const cls = cn(ROW, "group/row pr-3");
  if (it.to)
    return (
      <Link to={it.to} className={cls} data-testid="you-row" data-key={it.key}>
        {inner}
      </Link>
    );
  if (it.href)
    return (
      <a href={it.href} target="_blank" rel="noopener" className={cls} data-testid="you-row" data-key={it.key}>
        {inner}
      </a>
    );
  return (
    <button type="button" onClick={it.onClick} className={cn(cls, "bg-transparent")} data-testid="you-row" data-key={it.key}>
      {inner}
    </button>
  );
}

function Group({ title, items, testId }: { title?: string; items: Item[]; testId: string }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-7" aria-label={title} data-testid={testId}>
      {title && <h2 className="m-0 mb-1.5 px-4 text-[13px] font-normal uppercase tracking-[0.04em] text-muted-foreground">{title}</h2>}
      <div className="overflow-hidden rounded-xl bg-card">
        {items.map((it) => (
          <Row key={it.key} it={it} />
        ))}
      </div>
    </section>
  );
}

const THEME_WORD = { system: "System", light: "Light", dark: "Dark" } as const;

export function You({ me, onSignOut, onSwitchAccount }: { me: Me; onSignOut: () => void; onSwitchAccount?: () => void }) {
  const [theme] = useTheme();
  const has = new Set(sectionsFor(me).map((s) => s.id));
  const login = me.login || "?";
  const repos = (me.repos || []).length;

  const device: Item[] = [
    ...(has.has("phone") ? [{ key: "phone", label: "Your phone", icon: Smartphone, tone: "blue" as Tone, to: "/you/phone" }] : []),
    ...(has.has("desktop") ? [{ key: "desktop", label: "Desktop app", icon: Laptop, tone: "graphite" as Tone, to: "/you/desktop" }] : []),
    { key: "notifications", label: "Notifications", icon: Bell, tone: "red", to: "/you/notifications" },
    { key: "appearance", label: "Appearance", icon: Palette, tone: "blue", to: "/you/appearance", detail: THEME_WORD[theme] },
  ];
  const reviewing: Item[] = [
    ...(me.personal
      ? [{ key: "repos", label: "Repositories", icon: FolderGit2, tone: "green" as Tone, to: "/repos", detail: repos ? repos.toLocaleString("en-US") : undefined }]
      : []),
    { key: "poller", label: "Poller", icon: Radar, tone: "amber", to: "/you/poller" },
    { key: "filters", label: "PR filters", icon: Filter, tone: "graphite", to: "/you/filters" },
  ];
  const tools: Item[] = [
    { key: "learnings", label: "Learnings", icon: BookOpen, tone: "amber", to: "/learnings" },
    { key: "insights", label: "Insights", icon: BarChart3, tone: "blue", to: "/dashboard" },
    { key: "skills", label: "Skills", icon: Code2, tone: "green", to: "/skills" },
    { key: "qa", label: "QA guides", icon: ClipboardCheck, tone: "graphite", to: "/qa" },
  ];
  const more: Item[] = [
    { key: "integrations", label: "Integrations", icon: Plug, tone: "blue", to: "/integrations" },
    { key: "devices", label: "Devices", icon: KeyRound, tone: "graphite", to: "/you/devices" },
    { key: "settings", label: "All settings", icon: SettingsIcon, tone: "graphite", to: "/settings" },
    { key: "how", label: "How it works", icon: ExternalLink, tone: "graphite", href: HOW_URL },
    // The tour walks the queue, so it starts there.
    { key: "tour", label: "Take a tour", icon: Compass, tone: "graphite", onClick: () => { navigate("/"); startTour(); } },
  ];

  return (
    <div className="mx-auto max-w-[640px]" data-testid="you-list">
      {/* The desktop reaches this page only by typing its address; give it a title there. */}
      <PageHeader title="You" />
      <section className="mb-7 flex items-center gap-3.5 rounded-xl bg-card px-4 py-3.5" data-testid="account-card" aria-label="Account">
        <UserAvatar login={login} size="lg" className="size-[52px]" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="max-w-full truncate text-[17px] font-semibold leading-tight" title={login}>
            {me.name && me.name !== login ? me.name : login}
          </span>
          <span className="flex max-w-full items-center gap-2 text-sm text-muted-foreground">
            {me.name && me.name !== login && <span className="truncate">{login}</span>}
            <LiveBadge me={me} />
          </span>
        </div>
      </section>

      <Group title="This device" items={device} testId="you-device" />
      <Group title="Reviewing" items={reviewing} testId="you-reviewing" />
      <Group title="Tools" items={tools} testId="you-tools" />
      <Group title="More" items={more} testId="you-more" />

      <section className="mb-4 overflow-hidden rounded-xl bg-card" aria-label="Account actions" data-testid="you-account">
        {onSwitchAccount && (
          <button
            type="button"
            onClick={onSwitchAccount}
            data-testid="switch-account"
            className={cn(ROW, "group/row justify-center border-b border-border bg-transparent text-primary")}
          >
            <UserRoundCog aria-hidden="true" className="size-[18px]" />
            Switch GitHub account
          </button>
        )}
        <button type="button" onClick={onSignOut} data-testid="sign-out" className={cn(ROW, "justify-center bg-transparent text-red")}>
          <LogOut aria-hidden="true" className="size-[18px]" />
          Sign out
        </button>
      </section>
    </div>
  );
}
