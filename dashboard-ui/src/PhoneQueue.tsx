// The queue on a phone (openspec/changes/mobile-app-feel M2). Same data as the desk page
// (queueModel.ts), laid out for a thumb:
//
// - Search is the bar's action: the field expands over the title, Escape or Cancel collapses
//   it. What is typed filters; a PR reference opens on Enter.
// - Two views in a segmented control, To review · In flight; Activity has the rest.
//   Repository and sort live in a filter sheet behind the bar's filter button (a dot when one
//   is set) and show as removable chips.
// - Full-width rows: the title first (two lines), `repo #n · author · when` under it, one
//   status pill. Swipe left to archive (with Undo), swipe right to run a review on your own
//   account (a short swipe shows the button, a long one runs it). Every row's ⋯ menu does both.
// - Pull to refresh, drawn by the page so it works in an iOS home-screen app.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { Archive, ArchiveRestore, Check, Ellipsis, Loader2, Play, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { api, errMessage, type Me, type QueueRow, type RunningJob } from "./api";
import { haptic, usePullToRefresh, useSwipe, PTR_THRESHOLD } from "./gestures";
import { NavBarAction } from "./nav";
import { prUrl } from "./pr";
import { quickRun } from "./quickRun";
import { EMPTY, SORTS, useQueueModel, type QueueModel } from "./queueModel";
import { setRepoFilter } from "./repoFilter";
import { Link, navigate } from "./router";
import { showToast } from "./Toast";
import { Banner, StatusBadge } from "./ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ITEM = "focus:bg-blue/14 min-h-[44px] text-[15px]";
const BAR_BTN = "size-[44px] text-primary hover:bg-transparent hover:text-primary [&_svg]:size-[22px]!";

// Swipe thresholds (px). A release past REVEAL leaves the action showing; past half the row
// (and at least COMMIT_MIN) runs it.
export const ROW_REVEAL = 64;
export const ROW_REVEAL_WIDTH = 96;
export const ROW_COMMIT_MIN = 160;
const rowCommit = (w: number) => Math.max(ROW_COMMIT_MIN, w * 0.5);

const keyOf = (r: { repo: string; num: string }) => `${r.repo}#${r.num}`;

type Props = { me: Me; views?: readonly string[]; base?: string; title?: string };

export function PhoneQueue({ me, views, base = "/" }: Props) {
  const m = useQueueModel(me, views);
  const { tab, sort, onlyRunning, data, err, q, setQ, multi, repos, activeFilter } = m;
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  // Optimistic: an archived row leaves at once; a run being started says so at once.
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [starting, setStarting] = useState<Set<string>>(() => new Set());
  const input = useRef<HTMLInputElement>(null);
  const home = views ? views[0] : "todo";
  const ptr = usePullToRefresh(m.refresh, !searchOpen);

  const urlFor = (o: { tab?: string; sort?: string; running?: boolean }) => {
    const p = new URLSearchParams();
    if (o.running) p.set("running", "1");
    else if (o.tab && o.tab !== home) p.set("tab", o.tab);
    const s = o.sort ?? sort;
    if (s !== "newest") p.set("sort", s);
    const qs = p.toString();
    return base + (qs ? `?${qs}` : "");
  };

  const openSearch = () => {
    // Synchronously, inside the tap: iOS only raises the keyboard for a focus the gesture made.
    flushSync(() => setSearchOpen(true));
    input.current?.focus();
  };
  const closeSearch = () => {
    setQ("");
    setSearchOpen(false);
  };

  const filterOn = !!activeFilter || sort !== "newest";
  const sortName = SORTS.find(([k]) => k === sort)?.[1] || sort;
  const tabLabel = (k: string) => data?.tabs.find((t) => t.key === k)?.label || k;
  const count = (k: string) => data?.tabs.find((t) => t.key === k)?.count;

  function archive(row: QueueRow) {
    const k = keyOf(row);
    const undoing = row.archived;
    setGone((s) => new Set(s).add(k));
    haptic();
    const p = api.archive({ repo: row.repo, num: row.num }, row.archiveToken, undoing ? "unarchive" : "archive");
    const back = () =>
      setGone((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
    showToast({
      text: `${undoing ? "Restored" : "Archived"} #${row.num}`,
      action: {
        label: "Undo",
        run: () => {
          back();
          void p
            .then(() => api.archive({ repo: row.repo, num: row.num }, row.archiveToken, undoing ? "archive" : "unarchive"))
            .catch((e) => showToast({ tone: "err", text: errMessage(e, `Couldn't undo #${row.num}.`) }))
            .finally(m.reload);
        },
      },
    });
    p.then(m.reload, (e) => {
      back(); // roll back: the row comes back where it was
      showToast({ tone: "err", text: errMessage(e, `Couldn't ${undoing ? "restore" : "archive"} #${row.num}.`) });
    });
  }

  async function run(row: QueueRow) {
    const k = keyOf(row);
    if (starting.has(k)) return;
    setStarting((s) => new Set(s).add(k));
    haptic();
    try {
      const r = await quickRun({ repo: row.repo, num: row.num });
      if (r.kind === "started") showToast({ text: `Review started on #${row.num} · ${r.effort}` });
      else if (r.kind === "busy") showToast({ text: `A review of #${row.num} is still finishing.` });
      else
        showToast({
          tone: "err",
          text: "Connect your Claude account to run reviews.",
          action: { label: "Connect", run: () => navigate("/integrations") },
        });
    } catch (e) {
      showToast({ tone: "err", text: errMessage(e, `Couldn't start a review of #${row.num}.`) });
    } finally {
      setStarting((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
      m.reload();
    }
  }

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (!views && !onlyRunning && tab !== home) chips.push({ key: "tab", label: tabLabel(tab), clear: () => navigate(urlFor({ tab: home }), { replace: true }) });
  if (activeFilter) chips.push({ key: "repo", label: activeFilter, clear: () => setRepoFilter("") });
  if (sort !== "newest") chips.push({ key: "sort", label: sortName, clear: () => navigate(urlFor({ tab, running: onlyRunning, sort: "newest" }), { replace: true }) });

  const segValue = onlyRunning ? "running" : tab;

  return (
    <div className="phone-queue" data-testid="phone-queue">
      <NavBarAction>
        <Button
          variant="ghost"
          type="button"
          className={cn(BAR_BTN, "relative")}
          aria-label={filterOn ? "Filter and sort (on)" : "Filter and sort"}
          aria-haspopup="dialog"
          data-testid="filter-open"
          onClick={() => setFilterOpen(true)}
        >
          <SlidersHorizontal aria-hidden="true" />
          {filterOn && <span aria-hidden="true" data-testid="filter-dot" className="absolute right-[9px] top-[10px] size-2 rounded-full bg-primary ring-2 ring-background" />}
        </Button>
        <Button
          variant="ghost"
          type="button"
          className={BAR_BTN}
          aria-label="Search or open a PR"
          aria-expanded={searchOpen}
          data-testid="search-open"
          onClick={openSearch}
        >
          <Search aria-hidden="true" />
        </Button>
      </NavBarAction>

      <SearchOverlay
        open={searchOpen}
        inputRef={input}
        q={q}
        setQ={setQ}
        onCancel={closeSearch}
        onSubmit={m.goReview}
      />

      {searchOpen && m.parsed && (
        <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="search-open-pr">
          {m.needsPick && (
            <Select value={m.rvRepo || repos[0]} onValueChange={m.setRvRepo}>
              <SelectTrigger aria-label="Repository for the pasted PR number" className="h-11 min-w-0 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {repos.map((r) => (
                  <SelectItem key={r} value={r} className={ITEM}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="button" className="h-11 text-base" data-testid="open-pr" onClick={m.goReview}>
            Open #{m.parsed.number}
          </Button>
        </div>
      )}

      {data && !data.slackOk && (
        <Banner kind="warn">
          No Slack member ID yet — review requests won't ping you. <Link to="/integrations">Add it in Integrations.</Link>
        </Banner>
      )}

      <Tabs
        value={segValue}
        onValueChange={(v) => navigate(v === "running" ? urlFor({ running: true }) : urlFor({ tab: v }), { replace: !views })}
      >
        {views ? (
          <TabsList className="h-11! w-full" aria-label="Activity views" data-testid="activity-views">
            {views.map((k) => (
              <TabsTrigger key={k} value={k} className="gap-1.5 px-2 text-[15px]">
                {data ? tabLabel(k) : EMPTY_LABEL[k] || k}
                <span className="text-[13px] tabular-nums text-muted-foreground in-data-[state=active]:text-foreground" data-testid="tab-count">
                  {(count(k) ?? 0).toLocaleString("en-US")}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        ) : (
          <TabsList className="h-11! w-full" aria-label="Queue views" data-testid="queue-views">
            <TabsTrigger value="todo" className="gap-1.5 px-2 text-[15px]">
              To review
              <span className="text-[13px] tabular-nums text-muted-foreground in-data-[state=active]:text-foreground" data-testid="tab-count">
                {(count("todo") ?? 0).toLocaleString("en-US")}
              </span>
            </TabsTrigger>
            <TabsTrigger value="running" className="gap-1.5 px-2 text-[15px]">
              In flight
              <span className="text-[13px] tabular-nums text-muted-foreground in-data-[state=active]:text-foreground" data-testid="tab-count">
                {m.runningRows.length.toLocaleString("en-US")}
              </span>
            </TabsTrigger>
          </TabsList>
        )}
      </Tabs>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="filter-chips">
          {chips.map((c) => (
            <span key={c.key} data-testid="filter-chip" className="inline-flex h-8 items-center gap-1 rounded-full bg-accent pl-3 text-sm text-foreground">
              <span className="max-w-[220px] truncate">{c.label}</span>
              <button
                type="button"
                aria-label={`Remove filter: ${c.label}`}
                onClick={c.clear}
                className="-my-1.5 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </span>
          ))}
        </div>
      )}

      {err && <Banner kind="err" data-testid="queue-error">{err}</Banner>}

      <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} />

      <div data-tour="queue" className="-mx-4 mt-2">
        {!data && !err ? (
          <RowsSkeleton />
        ) : !data ? null : onlyRunning ? (
          m.runningRows.length ? (
            <ul className="m-0 list-none p-0" id="qlist" data-testid="running-list">
              {m.runningRows.map((j) => (
                <RunningRow key={`${j.kind}:${keyOf(j)}`} job={j} />
              ))}
            </ul>
          ) : (
            <PhoneEmpty text="Nothing is running right now." action={["Back to To review", () => navigate(urlFor({ tab: home }), { replace: true })]} />
          )
        ) : (
          <Rows m={m} gone={gone} starting={starting} multi={multi} onArchive={archive} onRun={run} empty={
            m.filtering ? (
              <PhoneEmpty
                text="Nothing here matches your search or filter."
                action={["Clear filters", () => { setQ(""); setRepoFilter(""); }]}
              />
            ) : m.notSetUp && tab === "todo" ? (
              <PhoneEmpty
                text="Your queue is empty because setup isn't finished, not because you're caught up."
                action={["Finish setting up", () => navigate(m.noRepos ? "/repos" : me.claude_connected === false ? "/integrations" : "/you/poller")]}
                testid="setup-needed"
              />
            ) : tab === "todo" ? (
              <PhoneEmpty text="You're all caught up — nothing is waiting on your review." action={["Review a PR", openSearch]} />
            ) : (
              <PhoneEmpty
                text={EMPTY[tab]?.[2] || "This view is empty."}
                action={views ? ["Go to your queue", () => navigate("/")] : ["Back to To review", () => navigate(urlFor({ tab: home }), { replace: true })]}
              />
            )
          } />
        )}
      </div>

      <FilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        repos={multi ? repos : []}
        repoCount={(r) => data?.repoCounts?.[r]?.[onlyRunning ? "todo" : tab]}
        repo={activeFilter}
        sort={sort}
        onRepo={(r) => setRepoFilter(r)}
        onSort={(s) => navigate(urlFor({ tab, running: onlyRunning, sort: s }), { replace: true })}
      />
    </div>
  );
}

const EMPTY_LABEL: Record<string, string> = { reviewed: "Reviewed", posted: "Posted", approved: "Approved" };

function Rows({
  m,
  gone,
  starting,
  multi,
  onArchive,
  onRun,
  empty,
}: {
  m: QueueModel;
  gone: Set<string>;
  starting: Set<string>;
  multi: boolean;
  onArchive: (r: QueueRow) => void;
  onRun: (r: QueueRow) => void;
  empty: ReactNode;
}) {
  const rows = (m.data?.rows || []).filter((r) => !gone.has(keyOf(r)));
  if (!rows.length) return <>{empty}</>;
  return (
    <ul className="m-0 list-none p-0" id="qlist" data-tour="queuelist">
      {rows.map((r) => (
        <PhoneRow
          key={keyOf(r)}
          row={r}
          status={starting.has(keyOf(r)) ? "starting" : m.statusOf(r)}
          showRepo={multi}
          onArchive={() => onArchive(r)}
          onRun={() => onRun(r)}
        />
      ))}
    </ul>
  );
}

function rowMeta(repo: string, num: string, author: string, when: string | undefined, showRepo: boolean) {
  return [showRepo || !repo ? `${repo} #${num}` : `#${num}`, author, when].filter(Boolean).join(" · ");
}

function Pill({ row, status }: { row: QueueRow; status: string }) {
  if (status) return <StatusBadge kind="reviewing" live className="shrink-0">{status === "starting" ? "Starting" : "Reviewing"}</StatusBadge>;
  if (row.prState === "merged" || row.prState === "closed")
    return <StatusBadge kind={row.merged ? "merged" : "closed"} className="shrink-0" data-testid="pr-state" />;
  return <StatusBadge kind={row.state} className="shrink-0" />;
}

const ROW_FG =
  "relative flex min-h-[72px] items-center gap-2 bg-background pr-1 touch-pan-y after:pointer-events-none after:absolute after:bottom-0 after:left-4 after:right-0 after:h-px after:bg-border";

export function PhoneRow({
  row,
  status,
  showRepo,
  onArchive,
  onRun,
}: {
  row: QueueRow;
  status: string;
  showRepo: boolean;
  onArchive: () => void;
  onRun: () => void;
}) {
  const canRun = !status;
  const dead = row.prState === "merged" || row.prState === "closed";
  const when = (dead ? row.when.filter((w) => w !== "no longer requested") : row.when)[0];
  const sw = useSwipe({
    commit: rowCommit,
    reveal: ROW_REVEAL,
    revealWidth: ROW_REVEAL_WIDTH,
    canRight: canRun,
    onRight: onRun,
    onLeft: onArchive,
  });
  const runLabel = row.state === "new" ? "Run review" : "Re-run review";
  const archiveLabel = row.archived ? `Restore #${row.num}` : `Archive #${row.num}`;
  const ArchiveGlyph = row.archived ? ArchiveRestore : Archive;
  const right = sw.dx > 0;
  const left = sw.dx < 0;
  return (
    <li className="relative overflow-hidden" data-testid="queue-row" data-running={status ? "true" : undefined} data-swiped={sw.open ?? undefined}>
      {/* The actions under the row: Run on the left (revealed by a swipe right), Archive on the
          right. Reachable only once revealed; the ⋯ menu is the always-there way to both. */}
      <div className="absolute inset-0" aria-hidden={sw.open ? undefined : true}>
        <button
          type="button"
          data-swipe-action="run"
          tabIndex={sw.open === "right" ? 0 : -1}
          onClick={() => {
            sw.close();
            onRun();
          }}
          style={{ width: right ? sw.dx : 0 }}
          className={cn(
            "absolute inset-y-0 left-0 flex items-center justify-start gap-2 overflow-hidden bg-primary pl-5 text-[15px] font-semibold text-primary-foreground",
            !sw.dragging && "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <Play aria-hidden="true" className="size-5 shrink-0" />
          <span className="whitespace-nowrap">{runLabel.replace(" review", "")}</span>
        </button>
        <button
          type="button"
          data-swipe-action="archive"
          tabIndex={sw.open === "left" ? 0 : -1}
          onClick={() => {
            sw.close();
            onArchive();
          }}
          style={{ width: left ? -sw.dx : 0 }}
          className={cn(
            "absolute inset-y-0 right-0 flex items-center justify-end gap-2 overflow-hidden bg-muted-foreground pr-5 text-[15px] font-semibold text-background",
            !sw.dragging && "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <span className="whitespace-nowrap">{row.archived ? "Restore" : "Archive"}</span>
          <ArchiveGlyph aria-hidden="true" className="size-5 shrink-0" />
        </button>
      </div>
      <div
        {...sw.bind}
        data-testid="row-fg"
        className={cn(ROW_FG, !sw.dragging && "transition-transform duration-200 ease-out motion-reduce:transition-none")}
        style={sw.dx ? { transform: `translateX(${sw.dx}px)` } : undefined}
      >
        <Link
          className="flex min-h-[72px] min-w-0 flex-1 flex-col justify-center gap-0.5 py-2.5 pl-4 text-inherit hover:no-underline active:bg-accent/40"
          data-testid="row-link"
          to={prUrl({ repo: row.repo, num: row.num })}
        >
          <span className="line-clamp-2 text-[17px] font-medium leading-[22px] text-foreground" data-testid="row-title">
            {row.title}
          </span>
          <span className="truncate text-[13px] leading-[18px] text-muted-foreground" data-testid="row-by">
            {rowMeta(row.repo, row.num, row.author, when, showRepo)}
          </span>
        </Link>
        <Pill row={row} status={status} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              type="button"
              className="size-[44px] shrink-0 text-muted-foreground data-[state=open]:bg-accent [&_svg]:size-5!"
              aria-label={`Actions for #${row.num}`}
              data-testid="row-actions"
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem className={ITEM} disabled={!canRun} onSelect={onRun}>
              <Play aria-hidden="true" />
              {runLabel}
            </DropdownMenuItem>
            <DropdownMenuItem className={ITEM} onSelect={onArchive}>
              <ArchiveGlyph aria-hidden="true" />
              {archiveLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function RunningRow({ job }: { job: RunningJob }) {
  return (
    <li className="relative" data-testid="queue-row" data-running="true">
      <div className={ROW_FG}>
        <Link className="flex min-h-[72px] min-w-0 flex-1 flex-col justify-center gap-0.5 py-2.5 pl-4 text-inherit hover:no-underline active:bg-accent/40" data-testid="row-link" to={job.href}>
          <span className="line-clamp-2 text-[17px] font-medium leading-[22px] text-foreground">{job.title || `PR #${job.num}`}</span>
          <span className="truncate text-[13px] leading-[18px] text-amber" data-testid="row-running">
            {job.repo} #{job.num} · {job.status || (job.kind === "qa" ? "building" : "reviewing")}
          </span>
        </Link>
        <StatusBadge kind="reviewing" live className="mr-3 shrink-0">
          {job.kind === "qa" ? "QA guide" : "Review"}
        </StatusBadge>
      </div>
    </li>
  );
}

function RowsSkeleton() {
  return (
    <div aria-busy="true" data-testid="rows-skeleton">
      <span className="sr-only" role="status">
        Loading your queue
      </span>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={cn(ROW_FG, "pl-4 pr-4")}>
          <div className="flex min-w-0 flex-1 flex-col gap-2 py-3">
            <Skeleton className={cn("h-[17px]", i % 2 ? "w-4/5" : "w-11/12")} />
            <Skeleton className="h-[13px] w-1/2" />
          </div>
          <Skeleton className="h-[22px] w-[76px] rounded-full" />
        </div>
      ))}
    </div>
  );
}

function PhoneEmpty({ text, action, testid }: { text: string; action: [string, () => void]; testid?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 px-8 py-16 text-center" data-testid={testid ?? "empty-state"}>
      <p className="m-0 max-w-[30ch] text-base text-muted-foreground">{text}</p>
      <Button type="button" variant="secondary" className="h-11 px-5 text-base" onClick={action[1]}>
        {action[0]}
      </Button>
    </div>
  );
}

function PullIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  const p = Math.min(1, pull / PTR_THRESHOLD);
  return (
    <div
      data-testid="ptr"
      data-state={refreshing ? "refreshing" : pull > 0 ? "pulling" : "idle"}
      aria-hidden={refreshing ? undefined : true}
      className={cn("flex items-end justify-center overflow-hidden", pull === 0 && "transition-[height] duration-200")}
      style={{ height: pull }}
    >
      {refreshing ? (
        <span className="mb-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
          Refreshing
        </span>
      ) : (
        <RefreshCw
          aria-hidden="true"
          className={cn("mb-3 size-5", p >= 1 ? "text-primary" : "text-muted-foreground")}
          style={{ opacity: p, transform: `rotate(${p * 270}deg)` }}
        />
      )}
    </div>
  );
}

function SearchOverlay({
  open,
  inputRef,
  q,
  setQ,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  q: string;
  setQ: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onCancel]);
  // Portalled: the page is its own stacking context (its view-transition name), so from in
  // there nothing can sit over the navigation bar.
  return createPortal(
    <div
      data-testid="search-bar"
      hidden={!open}
      className="fixed inset-x-0 top-0 z-40 bg-background/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl backdrop-saturate-150 motion-safe:animate-in motion-safe:fade-in-0"
    >
      <form
        role="search"
        className="flex h-[44px] items-center gap-1 pl-3 pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="relative min-w-0 flex-1 motion-safe:animate-in motion-safe:slide-in-from-right-8">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            id="qsearch"
            type="search"
            autoComplete="off"
            enterKeyHint="go"
            aria-label="Filter your queue, or open a PR by URL or number"
            placeholder="Search, or paste a PR link"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 rounded-lg border-0 bg-muted pl-8"
          />
        </div>
        <Button type="button" variant="ghost" className="h-[44px] px-3 text-[17px] font-normal text-primary hover:bg-transparent hover:text-primary" onClick={onCancel}>
          Cancel
        </Button>
      </form>
    </div>,
    document.body,
  );
}

function Choice({ on, label, sub, onClick }: { on: boolean; label: string; sub?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-base text-foreground active:bg-accent/40"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {sub && <span className="text-sm tabular-nums text-muted-foreground">{sub}</span>}
      <Check aria-hidden="true" className={cn("size-5 shrink-0 text-primary", !on && "invisible")} />
    </button>
  );
}

function FilterSheet({
  open,
  onOpenChange,
  repos,
  repoCount,
  repo,
  sort,
  onRepo,
  onSort,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  repos: string[];
  repoCount: (r: string) => number | undefined;
  repo: string;
  sort: string;
  onRepo: (r: string) => void;
  onSort: (s: string) => void;
}) {
  const group = "m-0 divide-y divide-border overflow-hidden rounded-xl bg-card";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid="filter-sheet"
        className="rs-sheet max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border-0 bg-background pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 rounded-full bg-border" />
        <SheetHeader className="flex-row items-center justify-between px-4 pb-2 pt-2">
          <SheetTitle className="m-0 text-[17px]">Filter and sort</SheetTitle>
          <SheetDescription className="sr-only">Choose a repository and an order for the queue.</SheetDescription>
          <Button type="button" variant="ghost" className="-mr-2 h-[44px] px-3 text-[17px] font-semibold text-primary hover:bg-transparent hover:text-primary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </SheetHeader>
        {repos.length > 0 && (
          <section className="px-4 pb-4">
            <h2 className="mx-4 mb-1.5 mt-0 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">Repository</h2>
            <div role="radiogroup" aria-label="Repository" className={group}>
              <Choice on={!repo} label="All repositories" onClick={() => onRepo("")} />
              {repos.map((r) => {
                const n = repoCount(r);
                return <Choice key={r} on={repo === r} label={r} sub={n === undefined ? undefined : n.toLocaleString("en-US")} onClick={() => onRepo(r)} />;
              })}
            </div>
          </section>
        )}
        <section className="px-4 pb-2">
          <h2 className="mx-4 mb-1.5 mt-0 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">Sort</h2>
          <div role="radiogroup" aria-label="Sort" className={group}>
            {SORTS.map(([k, lbl]) => (
              <Choice key={k} on={sort === k} label={lbl} onClick={() => onSort(k)} />
            ))}
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
