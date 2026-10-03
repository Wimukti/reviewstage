import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowUp,
  Check,
  CheckCheck,
  Circle,
  CircleCheck,
  CircleDot,
  CircleHelp,
  CircleX,
  Clock,
  EyeOff,
  FlaskConical,
  GitMerge,
  GitPullRequestClosed,
  Loader2,
  MessageSquare,
  OctagonAlert,
  Pencil,
  Radio,
  SlidersHorizontal,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import { Icon } from "./icons";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// The shared status vocabulary: one component for every state and severity, a tone and a
// glyph per kind. The tone mapping is fixed and used everywhere — amber is "needs you", red is
// a blocker or a failure, green is done or posted, graphite is neutral, blue is staged or
// primary.
export type Tone = "blue" | "amber" | "red" | "green" | "graphite";

const TONES: Record<string, Tone> = {
  // severities
  blocker: "red", "should-fix": "amber", nit: "graphite", question: "graphite",
  // review / PR states
  new: "amber", reviewing: "amber", queued: "amber", done: "green", reviewed: "green",
  posted: "green", approved: "green", failed: "red", stalled: "red", stopped: "amber",
  dry: "amber", archived: "graphite", merged: "green", closed: "graphite",
  // misc
  ok: "green", warn: "amber", live: "green", stale: "amber", edited: "amber",
  promoted: "green", dismissed: "graphite", preference: "graphite",
};

const WORDS: Record<string, string> = {
  blocker: "Blocker", "should-fix": "Should fix", nit: "Nit", question: "Question",
  new: "New", reviewing: "Reviewing", queued: "Queued", done: "Reviewed", reviewed: "Reviewed",
  posted: "Posted", approved: "Approved", failed: "Failed", stalled: "Stalled", stopped: "Stopped",
  dry: "Dry run", archived: "Archived", merged: "Merged", closed: "Closed", live: "Live",
};

const KIND_ICON: Record<string, LucideIcon> = {
  blocker: OctagonAlert, "should-fix": TriangleAlert, nit: Sparkles, question: CircleHelp,
  new: CircleDot, reviewing: Loader2, queued: Clock, done: Check, reviewed: Check,
  posted: MessageSquare, approved: CheckCheck, failed: CircleX, stalled: Clock, stopped: Square,
  dry: FlaskConical, archived: Archive, merged: GitMerge, closed: GitPullRequestClosed,
  ok: CircleCheck, warn: TriangleAlert, live: Radio, stale: Clock, edited: Pencil,
  promoted: ArrowUp, dismissed: EyeOff, preference: SlidersHorizontal,
};
const TONE_ICON: Record<Tone, LucideIcon> = {
  blue: CircleDot, amber: TriangleAlert, red: CircleX, green: Check, graphite: Circle,
};
// A tinted surface and a coloured glyph; the label stays in the foreground ink so the badge
// reads at the same weight as the text around it in both themes.
const TONE_CLASS: Record<Tone, string> = {
  blue: "bg-blue/12 [&>svg]:text-blue",
  amber: "bg-amber/12 [&>svg]:text-amber",
  red: "bg-red/12 [&>svg]:text-red",
  green: "bg-green/12 [&>svg]:text-green",
  graphite: "bg-muted [&>svg]:text-muted-foreground",
};

export const toneOf = (kind: string): Tone => TONES[kind] ?? "graphite";
export const wordOf = (kind: string): string =>
  WORDS[kind] ?? (kind ? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/-/g, " ") : "");
export const iconOf = (kind: string, tone = toneOf(kind)): LucideIcon => KIND_ICON[kind] ?? TONE_ICON[tone];

export type StatusBadgeProps = {
  kind?: string;
  tone?: Tone;
  /** Overrides the word for `kind`; `children` does the same and wins. */
  label?: ReactNode;
  children?: ReactNode;
  /** The glyph. Defaults from `kind`, then from the tone; `null` draws none. */
  icon?: LucideIcon | null;
  /** In flight: the glyph becomes a spinner. */
  live?: boolean;
  title?: string;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "title" | "children">;

export function StatusBadge({ kind = "", tone, label, children, icon, live, title, className, ...rest }: StatusBadgeProps) {
  const t = tone ?? toneOf(kind);
  const Glyph = live ? Loader2 : icon === undefined ? iconOf(kind, t) : icon;
  return (
    <Badge
      variant="secondary"
      data-testid="status-badge"
      data-kind={kind || undefined}
      data-tone={t}
      data-live={live ? "true" : undefined}
      title={title}
      className={cn("text-foreground", TONE_CLASS[t], className)}
      {...rest}
    >
      {Glyph && <Glyph aria-hidden="true" className={cn(live && "animate-spin motion-reduce:animate-none")} />}
      {children ?? label ?? wordOf(kind)}
    </Badge>
  );
}

/**
 * @deprecated Use `StatusBadge`. Kept for one release so pages not yet rebuilt compile; it
 * renders a StatusBadge and carries the legacy `status is-<tone>` class hooks their specs
 * still target. The dot-and-word markup and its rules are gone.
 */
export function Status({ kind, tone, children, live, title, className, ...rest }: Omit<StatusBadgeProps, "label" | "icon">) {
  const t = tone ?? toneOf(kind ?? "");
  return (
    <StatusBadge
      kind={kind}
      tone={t}
      live={live}
      title={title}
      className={cn("status", `is-${t}`, live && "is-live", className)}
      {...rest}
    >
      {children}
    </StatusBadge>
  );
}

const avatarUrl = (login: string) => `https://github.com/${encodeURIComponent(login)}.png?size=64`;
const initials = (s: string) => (s || "?").replace(/[^a-z0-9]/gi, "").slice(0, 1).toUpperCase() || "?";

// A GitHub user: their avatar with an initial behind it until (or unless) the image arrives.
export function UserAvatar({
  login,
  size = "default",
  className,
  ...rest
}: { login: string; size?: "sm" | "default" | "lg"; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <Avatar size={size} data-testid="user-avatar" data-login={login} className={cn("bg-muted", className)} {...rest}>
      <AvatarImage src={avatarUrl(login)} alt={login} />
      <AvatarFallback aria-hidden="true" className="font-medium text-foreground">
        {initials(login)}
      </AvatarFallback>
    </Avatar>
  );
}

// A repository as a small pill: the owner's avatar and `owner/name` in sans. Never monospace.
export function RepoPill({
  repo,
  className,
  ...rest
}: { repo: string; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  const owner = repo.split("/")[0] || repo;
  return (
    <span
      data-testid="repo-pill"
      title={repo}
      className={cn(
        "inline-flex max-w-[260px] shrink-0 items-center gap-1.5 rounded-full bg-secondary py-0.5 pl-0.5 pr-2 text-xs font-medium text-secondary-foreground",
        className,
      )}
      {...rest}
    >
      <Avatar className="size-4">
        <AvatarImage src={avatarUrl(owner)} alt="" />
        <AvatarFallback aria-hidden="true" className="text-[9px] font-semibold">
          {initials(owner)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{repo}</span>
    </span>
  );
}

// Page header: the title in display type; the one orientation disclosure (design §6) behind a
// `?` Popover when a page genuinely needs it; an actions slot that wraps under the title on
// narrow screens.
export function PageHeader({
  title,
  help,
  actions,
  children,
  className,
  ...rest
}: {
  title: ReactNode;
  help?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <header data-testid="page-header" className={cn("mb-4 flex flex-wrap items-start justify-between gap-x-8 gap-y-3", className)} {...rest}>
      <div className="flex min-w-0 flex-1 basis-[280px] items-center gap-2">
        <h1 className="m-0 font-display text-2xl font-semibold tracking-tight max-[899px]:text-xl">{title}</h1>
        {help && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="About this page" className="text-muted-foreground">
                <CircleHelp aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 max-w-[calc(100vw-32px)] text-sm leading-relaxed" data-testid="about-box">
              {help}
            </PopoverContent>
          </Popover>
        )}
      </div>
      {actions && <div className="flex min-w-0 flex-1 basis-[420px] items-center gap-2 max-[899px]:basis-full">{actions}</div>}
      {children}
    </header>
  );
}

// Empty state: a glyph, a display title, one line, and (optionally) one action.
export function EmptyState({
  icon: Glyph,
  title,
  action,
  children,
  className,
  ...rest
}: {
  icon: LucideIcon;
  title: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <div data-testid="empty-state" className={cn("flex flex-col items-center px-5 py-10 text-center", className)} {...rest}>
      <Glyph aria-hidden="true" className="size-10 text-muted-foreground" strokeWidth={1.5} />
      <h2 className="mt-3 mb-1 font-display text-xl font-semibold tracking-tight">{title}</h2>
      <div className="max-w-[52ch] text-sm text-muted-foreground">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Banner: one shape for every notice. `kind` picks the tint and the icon; the words carry the
// meaning, the icon only echoes it.
const BANNER_ICON: Record<string, string> = { ok: "check", warn: "alert", err: "x", info: "info" };
export function Banner({
  kind = "info",
  icon,
  children,
  ...rest
}: {
  kind?: "ok" | "warn" | "err" | "info";
  icon?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`banner ${kind}`} {...rest}>
      <Icon name={icon ?? BANNER_ICON[kind]} />
      <div>{children}</div>
    </div>
  );
}

// Server-rendered banner HTML (the API answers with `bannerHtml`).
export function RawBanner({ html }: { html: string }) {
  if (!html) return null;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// The busy rule: a control swaps its label to the progressive verb and disables; a pulsing dot
// only appears once the wait has run past a second.
export function useSlowBusy(busy: boolean, ms = 1000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(t);
  }, [busy, ms]);
  return slow;
}
export function SlowBusy({ busy }: { busy: boolean }) {
  const slow = useSlowBusy(busy);
  return slow ? <span className="rundot" aria-hidden="true" /> : null;
}
