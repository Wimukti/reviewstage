// The PR page on a phone (openspec/changes/mobile-app-feel M3): read, swipe, post.
//
// PrPage owns every piece of state and every request — the staged set the checkboxes drive,
// the comment bodies, the post itself — and hands this file what to draw. So a swipe and a
// checkbox change the one `selected` set, and the only way to the server's POST /api/post is the
// final button in the confirm sheet (PostSheet), which calls the same submitPost the desk's
// commit bar does.
//
// - Header: the title (two lines), `repo #n · author · +42 −8`, one status pill, and at most one
//   notice — only for something that stands between you and a meaningful post.
// - Finding cards: swipe right keeps (staged, green edge), swipe left drops (dimmed, one line,
//   tap to restore); tap the title for the full text with Edit and Explain; Teach and Copy in
//   the card's ⋯ menu. The checkbox and the menu do everything a swipe does.
// - A floating `N kept · Post` pill above the tab bar opens the confirm sheet.
// - Approve, Re-run and the long-form sections are in the ⋯ sheet in the navigation bar.
// - After a post: a success state with Back to queue and the next PR waiting on you.
import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Copy,
  Ellipsis,
  ExternalLink,
  GraduationCap,
  Layers,
  Loader2,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { api, type Finding, type PrData, type QueueRow } from "./api";
import { useSwipe } from "./gestures";
import { NavBarAction, useNavBar } from "./nav";
import { prUrl } from "./pr";
import { ExplainBody, OFFDIFF_HINT, placementOf, UNKNOWN_HINT, useExplain } from "./ReviewParts";
import { goBack, Link } from "./router";
import { StatusBadge, toneOf, wordOf, type Tone } from "./ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

const ITEM = "focus:bg-blue/14 min-h-[44px] text-[15px]";
const SHEET =
  "rs-sheet max-h-[88dvh] gap-0 overflow-y-auto rounded-t-2xl border-0 bg-background pb-[calc(env(safe-area-inset-bottom,0px)+16px)]";

// A release past this many px keeps (right) or drops (left) a finding.
export const CARD_COMMIT = 96;

const TONE_BORDER: Record<Tone, string> = {
  blue: "border-l-blue",
  amber: "border-l-amber",
  red: "border-l-red",
  green: "border-l-green",
  graphite: "border-l-graphite",
};

function Grabber() {
  return <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border" />;
}

// ---- header ----------------------------------------------------------------------------------

export function PhonePrHeader({ data, postedNow }: { data: PrData; postedNow: boolean }) {
  useNavBar({ ownsHeading: true });
  const [dismissed, setDismissed] = useState(false);
  const diff = (data.size || "").split(" · ")[0];
  const [add, del] = diff.split(/\s+/);
  const dead = data.canApprove === false;
  const kind = data.stopped ? "stopped" : postedNow && data.state === "done" ? "posted" : data.state;
  const rev = data.review;
  const headMoved = !!(rev?.approve?.reviewedHead && rev.approve.currentHead && rev.approve.reviewedHead !== rev.approve.currentHead);
  // One notice, and only for what stands between you and a post worth making. Claude not being
  // connected never does (posting runs on GitHub, not Claude); the run form says so where it matters.
  const notice =
    rev && !rev.posted && !postedNow
      ? data.stale
        ? "New commits since this review — the findings may be out of date. Re-run from ⋯ before posting."
        : headMoved
          ? "The branch has moved since this review ran. Approving needs a confirmation."
          : data.dryRun
            ? "Dry run — posting records your picks, but nothing reaches GitHub."
            : ""
      : "";
  return (
    <header className="mb-4" data-testid="pr-header">
      <h1 className="m-0 line-clamp-2 font-display text-[22px]/[28px] font-semibold tracking-tight" data-testid="pr-title">
        {data.title || `#${data.pr}`}
      </h1>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" data-testid="pr-meta">
          {data.repo} #{data.pr}
          {data.author && <> · {data.author}</>}
          {add && (
            <>
              {" · "}
              <span className="text-green">{add}</span> <span className="text-red">{del}</span>
            </>
          )}
        </span>
        {dead ? (
          <StatusBadge kind={data.merged ? "merged" : "closed"} className="shrink-0" data-testid="pr-state" />
        ) : (
          kind && <StatusBadge kind={kind} live={kind === "reviewing"} className="shrink-0" data-testid="review-state" />
        )}
      </div>
      {notice && !dismissed && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber/12 py-2 pl-3 pr-1 text-[14px] leading-snug" data-testid="pr-notice" role="note">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber" />
          <span className="min-w-0 flex-1 pt-px">{notice}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            className="-my-2 flex size-[36px] shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}
    </header>
  );
}

export function PhonePrSkeleton() {
  return (
    <div className="prpage" aria-busy="true" data-testid="pr-loading">
      <span className="sr-only" role="status">
        Loading this pull request
      </span>
      <Skeleton className="mb-2 h-[22px] w-11/12" />
      <Skeleton className="mb-3 h-[22px] w-2/3" />
      <div className="mb-6 flex items-center gap-2">
        <Skeleton className="h-[13px] w-1/2" />
        <Skeleton className="ml-auto h-[22px] w-[84px] rounded-full" />
      </div>
      <Skeleton className="mb-2 h-5 w-3/4" />
      <Skeleton className="mb-1.5 h-4 w-full" />
      <Skeleton className="mb-5 h-4 w-5/6" />
      {[0, 1, 2].map((i) => (
        <Card key={i} className="mt-3 gap-2 rounded-xl border-0 py-3 shadow-sm">
          <div className="flex items-center gap-2 px-4">
            <Skeleton className="size-5 rounded-[4px]" />
            <Skeleton className="h-[22px] w-20 rounded-full" />
            <Skeleton className="ml-auto size-6 rounded-full" />
          </div>
          <div className="flex flex-col gap-2 px-4">
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---- finding cards -----------------------------------------------------------------------------

export type CardExtras = {
  explain?: () => Promise<ReactNode>;
  editor?: ReactNode;
  teach?: { panel: (onTaught: () => void) => ReactNode };
};

export function PhoneFindingCard({
  f,
  kept,
  dropped,
  disabled,
  onToggle,
  onKeep,
  onDrop,
  onRestore,
  explain,
  editor,
  teach,
}: {
  f: Finding;
  kept: boolean;
  dropped: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onKeep: () => void;
  onDrop: () => void;
  onRestore: () => void;
} & CardExtras) {
  const [open, setOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(!f.structured);
  const [showTeach, setShowTeach] = useState(false);
  const [taught, setTaught] = useState(!!f.taught);
  const [copied, setCopied] = useState(false);
  const x = useExplain(explain);
  const sw = useSwipe({
    commit: CARD_COMMIT,
    canRight: !disabled && !kept,
    canLeft: !disabled && !dropped,
    onRight: onKeep,
    onLeft: onDrop,
    disabled,
  });
  const loc = `${f.path}:${f.line}`;
  const place = placementOf(f);
  const sev = wordOf(f.severity);
  const title = f.structured ? f.title : f.body.split("\n")[0];
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (dropped) {
    return (
      <div
        className="finding relative mt-2 overflow-hidden rounded-xl"
        data-testid="finding"
        data-dropped="1"
      >
        <button
          type="button"
          data-testid="finding-restore"
          onClick={onRestore}
          disabled={disabled}
          aria-label={`Dropped: ${title}. Restore`}
          className="flex min-h-[48px] w-full items-center gap-2.5 rounded-xl bg-card/60 px-4 text-left text-[15px] text-muted-foreground opacity-70 active:bg-accent/40"
        >
          <X aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate line-through decoration-muted-foreground/50">{title}</span>
          <span className="flex shrink-0 items-center gap-1 text-[13px] text-primary">
            <Undo2 aria-hidden="true" className="size-3.5" />
            Restore
          </span>
        </button>
      </div>
    );
  }

  const right = sw.dx > 0;
  return (
    <div className="relative mt-3 overflow-hidden rounded-xl" data-testid="finding-wrap">
      {/* What the swipe will do, under the card. */}
      {sw.dx !== 0 && (
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 flex items-center rounded-xl px-5 text-[15px] font-semibold",
            right ? "justify-start bg-green/25 text-foreground" : "justify-end bg-muted text-muted-foreground",
          )}
        >
          {right ? (
            <span className="flex items-center gap-2"><Check aria-hidden="true" className="size-5 text-green" /> Keep</span>
          ) : (
            <span className="flex items-center gap-2">Drop <X aria-hidden="true" className="size-5" /></span>
          )}
        </div>
      )}
      <Card
        {...sw.bind}
        data-testid="finding"
        data-staged={kept ? "1" : undefined}
        style={sw.dx ? { transform: `translateX(${sw.dx}px)` } : undefined}
        className={cn(
          "finding relative gap-0 rounded-xl border-0 border-l-[3px] py-0 shadow-sm touch-pan-y",
          kept ? "is-staged border-l-green ring-1 ring-green/35" : TONE_BORDER[toneOf(f.severity)],
          !sw.dragging && "transition-[transform,box-shadow] duration-200 ease-out motion-reduce:transition-none",
        )}
      >
        <div className="fhead flex items-center gap-2 py-1 pl-3.5 pr-1">
          <Checkbox
            checked={kept}
            disabled={disabled}
            onCheckedChange={() => onToggle()}
            aria-label={`Keep this ${sev} finding`}
            data-testid="finding-select"
            className="size-5 data-[state=checked]:border-green data-[state=checked]:bg-green dark:data-[state=checked]:bg-green"
          />
          <StatusBadge kind={f.severity} />
          {place === "summary" && (
            <StatusBadge tone="graphite" icon={ExternalLink} title={OFFDIFF_HINT} data-testid="placement">
              In summary
            </StatusBadge>
          )}
          {place === "unknown" && (
            <StatusBadge tone="amber" icon={TriangleAlert} title={UNKNOWN_HINT} data-testid="placement-unknown">
              Unknown
            </StatusBadge>
          )}
          {kept && <span className="text-[13px] font-medium text-green" data-testid="kept-label">Kept</span>}
          <span className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                type="button"
                className="size-[44px] text-muted-foreground data-[state=open]:bg-accent [&_svg]:size-5!"
                aria-label="More for this finding"
                data-testid="finding-menu"
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {!kept ? (
                <DropdownMenuItem className={ITEM} disabled={disabled} onSelect={onKeep}>
                  <Check aria-hidden="true" />
                  Keep
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className={ITEM} disabled={disabled} onSelect={onToggle}>
                  <Undo2 aria-hidden="true" />
                  Don't keep
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className={ITEM} disabled={disabled} onSelect={onDrop}>
                <X aria-hidden="true" />
                Drop
              </DropdownMenuItem>
              {teach && (
                <DropdownMenuItem
                  className={ITEM}
                  disabled={taught}
                  data-testid="teach-open"
                  onSelect={() => {
                    setOpen(true);
                    setShowTeach(true);
                  }}
                >
                  <GraduationCap aria-hidden="true" />
                  {taught ? "Already a rule" : "Teach the skill"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className={ITEM}
                onSelect={async () => {
                  try {
                    await navigator.clipboard.writeText(loc);
                    setCopied(true);
                  } catch {
                    /* the path stays selectable in the card */
                  }
                }}
              >
                <Copy aria-hidden="true" />
                Copy {f.path.split("/").pop()}:{f.line}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <button
          type="button"
          aria-expanded={open}
          data-testid="finding-expand"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-col gap-1 px-4 pb-3 pl-[18px] text-left"
        >
          <span className={cn("text-base font-medium leading-snug text-foreground", !open && "line-clamp-3")}>{title}</span>
          <span className="flex min-w-0 max-w-full items-center gap-1 text-[13px] text-muted-foreground" data-testid="finding-path">
            <span className="truncate select-all">{loc}</span>
            {copied && <span className="shrink-0 text-green">· Copied</span>}
            <ChevronRight aria-hidden="true" className={cn("ml-auto size-4 shrink-0 transition-transform", open && "rotate-90")} />
          </span>
        </button>
        {open && (
          <div className="flex flex-col gap-2.5 px-4 pb-3 pl-[18px]" data-testid="finding-detail">
            {f.structured && f.impact && (
              <p className="m-0 text-[15px] leading-relaxed text-muted-foreground">
                <span className="mr-1.5 text-xs font-medium uppercase tracking-wide">Why it matters</span>
                {f.impact}
              </p>
            )}
            {f.thread && <p className="m-0 text-[13px] text-muted-foreground">Reply to {f.thread}</p>}
            <div className="-ml-2 flex flex-wrap gap-1" data-testid="finding-actions">
              {f.structured && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-[44px] text-[15px] text-muted-foreground hover:text-foreground"
                  aria-expanded={showEdit}
                  disabled={disabled}
                  onClick={() => setShowEdit((v) => !v)}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="min-h-[44px] text-[15px] text-muted-foreground hover:text-foreground"
                aria-expanded={x.expOpen}
                data-testid="explain"
                onClick={() => {
                  const next = !x.expOpen;
                  x.setExpOpen(next);
                  if (next) void x.runExplain();
                }}
              >
                <Sparkles aria-hidden="true" />
                Explain
              </Button>
            </div>
            <ExplainBody x={x} />
            {showTeach && teach && teach.panel(() => setTaught(true))}
            {showEdit && editor}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---- the post pill, the confirm sheet, the success state --------------------------------------

export function PostPill({
  kept,
  posted,
  postedAs,
  stale,
  onOpen,
}: {
  kept: number;
  posted: boolean;
  postedAs: string;
  stale: boolean;
  onOpen: () => void;
}) {
  // Lifts the toasts above the pill while it is on screen (shell.css).
  useEffect(() => {
    document.documentElement.dataset.pill = "1";
    return () => {
      delete document.documentElement.dataset.pill;
    };
  }, []);
  const at = "fixed inset-x-0 z-20 flex justify-center px-4 bottom-[calc(49px+env(safe-area-inset-bottom,0px)+12px)] pointer-events-none";
  const quiet = "pointer-events-auto flex h-14 items-center gap-2 rounded-full bg-popover px-6 text-[15px] text-muted-foreground shadow-xl ring-1 ring-border";
  if (posted)
    return (
      <div className={at}>
        <div className={quiet} data-testid="post-pill" data-state="posted">
          <CircleCheck aria-hidden="true" className="size-5 text-green" />
          Posted as {postedAs}
        </div>
      </div>
    );
  if (stale)
    return (
      <div className={at}>
        <Button type="button" className="pointer-events-auto h-14 rounded-full px-6 text-[17px] shadow-xl" data-testid="post-pill" onClick={() => window.location.reload()}>
          <RotateCcw aria-hidden="true" />
          Reload to post
        </Button>
      </div>
    );
  if (kept === 0)
    return (
      <div className={at}>
        <div className={quiet} data-testid="post-pill" data-state="empty" aria-live="polite">
          Swipe right to keep findings
        </div>
      </div>
    );
  return (
    <div className={at}>
      <Button
        type="button"
        data-testid="post-pill"
        data-state="ready"
        aria-haspopup="dialog"
        onClick={onOpen}
        className="pointer-events-auto h-14 gap-2.5 rounded-full px-7 text-[17px] font-semibold shadow-xl shadow-primary/25 [&_svg]:size-5!"
      >
        <span className="tabular-nums" data-testid="post-pill-count">{kept} kept</span>
        <span aria-hidden="true" className="opacity-60">·</span>
        <span className="flex items-center gap-1.5">
          Post
          <Send aria-hidden="true" />
        </span>
      </Button>
    </div>
  );
}

export function PostSheet({
  open,
  onOpenChange,
  kept,
  inline,
  summary,
  unknown,
  maxPerPost,
  requestChanges,
  onRequestChanges,
  login,
  dryRun,
  busy,
  error,
  onPost,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kept: number;
  inline: number;
  summary: number;
  unknown: number;
  maxPerPost: number;
  requestChanges: boolean;
  onRequestChanges: (v: boolean) => void;
  login: string;
  dryRun: boolean;
  busy: boolean;
  error: ReactNode;
  onPost: () => void;
}) {
  const overCap = maxPerPost > 0 && kept > maxPerPost;
  const label = `${requestChanges ? "Request changes" : "Post"} as ${login}${dryRun ? " (dry run)" : ""}`;
  const stat = (n: number, what: string, testid: string, title?: string) => (
    <div className="flex flex-1 flex-col items-center rounded-xl bg-card px-2 py-3" data-testid={testid} title={title}>
      <span className="font-display text-2xl font-semibold tabular-nums leading-none">{n}</span>
      <span className="mt-1 text-[13px] text-muted-foreground">{what}</span>
    </div>
  );
  return (
    <Sheet open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <SheetContent side="bottom" showCloseButton={false} data-testid="post-sheet" className={SHEET}>
        <Grabber />
        <SheetHeader className="px-4 pb-3 pt-3 text-left">
          <SheetTitle className="m-0 font-display text-xl tracking-tight">
            Post {kept} comment{kept === 1 ? "" : "s"}
          </SheetTitle>
          <SheetDescription className="text-[15px]">
            {requestChanges
              ? "As a review that requests changes — it can block the PR until the author updates it."
              : "As one review with plain comments. Nothing blocks the merge."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4">
          <div className="flex gap-2" data-testid="post-counts">
            {stat(inline, "inline", "post-inline")}
            {stat(summary, "in the summary", "post-summary", OFFDIFF_HINT)}
            {unknown > 0 && stat(unknown, "unknown", "post-unknown", UNKNOWN_HINT)}
          </div>
          {overCap && (
            <p className="m-0 text-[14px] text-foreground" data-testid="over-cap">
              Over the {maxPerPost} per-post limit — GitHub takes a review all-or-nothing. Keep fewer.
            </p>
          )}
          <Label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl bg-card px-4 text-[15px] font-normal">
            <Checkbox
              checked={requestChanges}
              onCheckedChange={(v) => onRequestChanges(v === true)}
              data-testid="request-changes"
              className="size-5 data-[state=checked]:border-red data-[state=checked]:bg-red dark:data-[state=checked]:bg-red"
            />
            Request changes instead
          </Label>
          {dryRun && (
            <p className="m-0 text-[14px] text-muted-foreground" data-testid="post-dry">
              Dry run — this records your picks; nothing reaches GitHub.
            </p>
          )}
          {error}
          <Button
            type="button"
            data-post
            data-testid="post-confirm"
            variant={requestChanges ? "destructive" : "default"}
            disabled={busy || overCap}
            aria-busy={busy}
            onClick={onPost}
            className="h-12 w-full rounded-xl text-[17px] font-semibold [&_svg]:size-5!"
          >
            {busy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden="true" />}
            {busy ? "Posting…" : label}
          </Button>
          <Button type="button" variant="ghost" className="h-11 w-full text-[17px] text-primary hover:bg-transparent hover:text-primary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function PostSuccess({ data, count, login, dryRun }: { data: PrData; count: number; login: string; dryRun: boolean }) {
  const [next, setNext] = useState<QueueRow | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api
      .queue("todo", "newest")
      .then((d) => {
        if (!live) return;
        setNext(d.rows.find((r) => !(r.repo === data.repo && r.num === data.pr)) ?? null);
      })
      .catch(() => live && setNext(null));
    return () => {
      live = false;
    };
  }, [data.repo, data.pr]);
  return (
    <section className="mt-2 flex flex-col items-center px-2 pb-6 pt-8 text-center" data-testid="post-success">
      <div className="flex size-16 items-center justify-center rounded-full bg-green/15">
        <CircleCheck aria-hidden="true" className="size-9 text-green" />
      </div>
      <h2 className="mb-1 mt-4 font-display text-2xl font-semibold tracking-tight">
        {dryRun ? "Recorded" : "Posted"} {count} comment{count === 1 ? "" : "s"}
      </h2>
      <p className="m-0 max-w-[32ch] text-base text-muted-foreground">
        {dryRun ? `Dry run as ${login} — nothing reached GitHub.` : `As ${login} on #${data.pr}.`}
      </p>
      <div className="mt-6 flex w-full flex-col gap-2">
        {next && (
          <Button asChild className="h-auto min-h-14 w-full justify-between whitespace-normal rounded-xl px-4 py-2.5 text-left hover:no-underline">
            <Link to={prUrl({ repo: next.repo, num: next.num })} data-testid="post-next">
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-normal opacity-80">Next to review</span>
                <span className="line-clamp-2 text-base font-semibold" data-testid="post-next-title">
                  #{next.num} {next.title}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
            </Link>
          </Button>
        )}
        {next === null && <p className="m-0 text-sm text-muted-foreground" data-testid="post-next-none">Nothing else is waiting on your review.</p>}
        <Button type="button" variant="secondary" className="h-12 w-full rounded-xl text-[17px]" data-testid="post-back" onClick={() => goBack("/")}>
          Back to queue
        </Button>
      </div>
    </section>
  );
}

// ---- the ⋯ sheet --------------------------------------------------------------------------------

export type SheetSection = { key: string; label: string; icon: typeof Check; content: ReactNode };

export function PrActionSheet({ data, sections, notice }: { data: PrData; sections: SheetSection[]; notice?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const cur = sections.find((s) => s.key === panel) || null;
  const running = data.state === "reviewing" || data.state === "queued";
  // A re-run started from the sheet: the page turns into its progress, the sheet gets out of the way.
  useEffect(() => {
    if (running) setOpen(false);
  }, [running]);
  const order = ["approve", "rerun", "summary", "explainer"];
  const items = [...sections].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const row = "flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-base text-foreground hover:no-underline active:bg-accent/40";
  return (
    <>
      <NavBarAction>
        <Button
          variant="ghost"
          type="button"
          aria-label="Actions"
          aria-haspopup="dialog"
          data-testid="pr-actions"
          className="size-[44px] text-primary hover:bg-transparent hover:text-primary [&_svg]:size-6!"
          onClick={() => {
            setPanel(null);
            setOpen(true);
          }}
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </NavBarAction>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" showCloseButton={false} data-testid="pr-action-sheet" className={SHEET}>
          <Grabber />
          <SheetHeader className="flex-row items-center gap-1 px-2 pb-2 pt-2">
            {cur ? (
              <Button type="button" variant="ghost" className="h-[44px] gap-0 px-1.5 text-[17px] font-normal text-primary hover:bg-transparent hover:text-primary [&_svg]:size-6!" onClick={() => setPanel(null)} data-testid="sheet-back">
                <ChevronLeft aria-hidden="true" />
                Actions
              </Button>
            ) : (
              <span className="w-2" />
            )}
            <SheetTitle className="m-0 min-w-0 flex-1 truncate text-[17px]">{cur ? (cur.key === "rerun" ? "Re-run review" : cur.label) : `#${data.pr}`}</SheetTitle>
            <SheetDescription className="sr-only">Approve, re-run, and more for this pull request.</SheetDescription>
            <Button type="button" variant="ghost" className="h-[44px] px-3 text-[17px] font-semibold text-primary hover:bg-transparent hover:text-primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </SheetHeader>
          {cur ? (
            <div className="px-4 pb-2 text-[15px] [&_h2]:text-base" data-testid={`sheet-panel-${cur.key}`}>
              {notice}
              {cur.content}
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-4">
              {items.length > 0 && (
                <div className="divide-y divide-border overflow-hidden rounded-xl bg-card">
                  {items.map((s) => (
                    <button key={s.key} type="button" className={row} onClick={() => setPanel(s.key)} data-testid={`sheet-${s.key}`}>
                      <s.icon aria-hidden="true" className="size-5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">{s.key === "rerun" ? "Re-run review" : s.label}</span>
                      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
              <div className="divide-y divide-border overflow-hidden rounded-xl bg-card">
                <a href={data.ghUrl} target="_blank" rel="noopener" className={row}>
                  <ExternalLink aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                  <span className="flex-1">Open on GitHub</span>
                </a>
                <Link to={prUrl({ repo: data.repo, num: data.pr }, "/qa")} className={row} onClick={() => setOpen(false)}>
                  <ClipboardCheck aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                  <span className="flex-1">QA guide</span>
                </Link>
                {data.stack?.isStack && (
                  <Link to={prUrl({ repo: data.repo, num: data.pr }, "/stack")} className={row} onClick={() => setOpen(false)}>
                    <Layers aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                    <span className="flex-1">Stacked review ({data.stack.size} PRs)</span>
                  </Link>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
