import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Check, CircleCheck, Circle, Compass, Inbox, MessageSquare, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, errMessage, type Me, type QueueData, type QueueRow } from "./api";
import { parsePrRef, prUrl } from "./pr";
import { getRepoFilter, REPO_FILTER_EVENT, setRepoFilter } from "./repoFilter";
import { Link, navigate, useLocation } from "./router";
import { runningFor, useRunning } from "./running";
import { Banner, EmptyState, PageHeader, RepoPill, StatusBadge, UserAvatar } from "./ui";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SORTS: [string, string][] = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["activity", "Recent activity"],
  ["findings", "Most findings"],
];

const EMPTY: Record<string, [LucideIcon, string, string]> = {
  todo: [CircleCheck, "You're all caught up", "No PRs are waiting on your review."],
  reviewed: [Inbox, "Nothing to post", "Reviews you've run and not yet posted show here."],
  posted: [MessageSquare, "Nothing pending approval", "PRs you've commented on but not approved."],
  approved: [CircleCheck, "Nothing approved yet", "PRs you approve will be listed here."],
  archived: [Archive, "No archived PRs", "Archived PRs are hidden from your working set."],
};

// Radix Select cannot carry an empty-string item, so "all repositories" travels under a key.
const ALL = "__all__";
// Menu highlight: accent and popover share a tone in tw.css, so the system's own highlight is
// invisible on a popover; the blue tint is what the legacy menus used.
const ITEM = "focus:bg-blue/14";

// The second line of a row: the PR's state as a badge, then what the review found. A run in
// flight replaces it — the findings and timings it would show are not written yet, and what the
// reviewer wants is "still going, and where".
function RunningLine({ label, status }: { label?: string; status: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="row-running">
      <StatusBadge kind="reviewing" live>
        {label}
      </StatusBadge>
      <span className="text-amber">{status}</span>
      <span className="text-muted-foreground">— open to watch</span>
    </div>
  );
}

function RowState({ row, status }: { row: QueueRow; status: string }) {
  const dead = row.prState === "merged" || row.prState === "closed";
  if (status) return <RunningLine status={status} />;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="row-state">
      <StatusBadge kind={row.state} />
      {dead && <StatusBadge kind={row.merged ? "merged" : "closed"} data-testid="pr-state" />}
      {row.sev.map((s) => (
        <StatusBadge key={s.kind} kind={s.kind}>
          {s.n} {s.label}
        </StatusBadge>
      ))}
      {row.size && <span className="text-xs text-muted-foreground">{row.size}</span>}
      {row.canApprove === false && (
        <span
          className="text-xs text-muted-foreground"
          data-testid="no-approve"
          title={
            row.merged
              ? "This PR is merged — GitHub will not take an approval on it."
              : "This PR is closed — an approval on it would not be actionable."
          }
        >
          can't approve
        </span>
      )}
    </div>
  );
}

// The first line: repository pill, number, title.
function RowTitle({ repo, num, title, showRepo }: { repo: string; num: string; title: string; showRepo: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {showRepo && repo && <RepoPill repo={repo} />}
      <span className="text-sm font-medium text-primary">#{num}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
    </div>
  );
}

const ROW_CLASS = "group relative flex min-h-[44px] flex-wrap items-start gap-x-3 hover:bg-accent/40 max-[899px]:flex-col max-[899px]:gap-0";
const ROW_LINK_CLASS = "flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-2.5 text-inherit hover:no-underline max-[899px]:w-full";

function Row({
  row,
  onChange,
  onError,
  showRepo,
  status,
}: {
  row: QueueRow;
  onChange: () => void;
  onError: (msg: string) => void;
  showRepo: boolean;
  status: string; // non-empty while a review of this PR is in flight for you
}) {
  const [busy, setBusy] = useState(false);
  const ref = { repo: row.repo, num: row.num };
  // "no longer requested" is true of a merged PR too, and saying only that made a shipped PR
  // look like one someone quietly dropped you from.
  const dead = row.prState === "merged" || row.prState === "closed";
  const when = dead ? row.when.filter((w) => w !== "no longer requested") : row.when;
  async function toggleArchive(e: React.MouseEvent) {
    // The button sits outside the row's <Link>, but guard anyway so a click never navigates.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await api.archive(ref, row.archiveToken, row.archived ? "unarchive" : "archive");
      onChange();
    } catch (x) {
      onError(errMessage(x, `Couldn't ${row.archived ? "restore" : "archive"} #${row.num}.`));
    } finally {
      setBusy(false);
    }
  }
  const label = row.archived ? `Restore #${row.num}` : `Archive #${row.num}`;
  const Glyph = row.archived ? ArchiveRestore : Archive;
  return (
    <div className={ROW_CLASS} data-testid="queue-row" data-running={status ? "true" : undefined}>
      <Link className={ROW_LINK_CLASS} data-testid="row-link" to={prUrl(ref)}>
        <RowTitle repo={row.repo} num={row.num} title={row.title} showRepo={showRepo} />
        <RowState row={row} status={status} />
      </Link>
      <div className="flex max-w-[45%] shrink-0 items-start gap-2 py-2 pl-3 pr-2 max-[899px]:w-full max-[899px]:max-w-none max-[899px]:justify-between max-[899px]:py-0 max-[899px]:pb-2 max-[899px]:pl-4">
        <div className="flex items-start gap-2 pt-0.5">
          <UserAvatar login={row.author} size="sm" />
          <span className="flex flex-wrap justify-end gap-x-1.5 pt-1 text-right text-xs leading-4 text-muted-foreground max-[899px]:justify-start max-[899px]:text-left" data-testid="row-by">
            {[row.author, ...when].filter(Boolean).map((w, i) => (
              <span key={i} className="after:ml-1.5 after:content-['·'] last:after:content-none">
                {w}
              </span>
            ))}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50 max-[899px]:size-[44px] max-[899px]:opacity-100"
          onClick={toggleArchive}
          disabled={busy}
          aria-label={label}
          title={label}
        >
          <Glyph aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <Card className="mt-4 gap-0 divide-y divide-border py-0" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your queue
      </span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3 max-w-[420px]" />
            <Skeleton className="h-3.5 w-1/3 max-w-[200px]" />
          </div>
          <Skeleton className="size-6 rounded-full" />
        </div>
      ))}
    </Card>
  );
}

export function Queue({ me }: { me: Me }) {
  const { search } = useLocation();
  const tab = search.get("tab") || "todo";
  const sort = search.get("sort") || "newest";
  // ?running=1 — where the sidebar pill points when several jobs are in flight.
  const onlyRunning = search.get("running") === "1";
  const jobs = useRunning();
  const [data, setData] = useState<QueueData | null>(null);
  const [q, setQ] = useState("");
  const [rvRepo, setRvRepo] = useState("");
  const [nonce, setNonce] = useState(0);
  const [err, setErr] = useState("");
  // Repository filter — remembered per browser (localStorage), "" = all.
  const [repoFilter, setRepoFilterState] = useState(getRepoFilter);
  useEffect(() => {
    const on = () => setRepoFilterState(getRepoFilter());
    window.addEventListener(REPO_FILTER_EVENT, on);
    return () => window.removeEventListener(REPO_FILTER_EVENT, on);
  }, []);

  // A remembered filter for a repo that no longer exists falls back to "all"; `repos` is only
  // known after the first response, so the first request sends whatever is remembered and the
  // effect re-runs if it turns out to be unknown.
  const [query, setQuery] = useState(q); // `q` debounced — one request per pause, not per key
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const runKey = jobs.map((j) => `${j.kind}:${j.repo}#${j.num}`).join(",");
  useEffect(() => {
    let live = true;
    // The filters go to the server, which applies them to EVERY tab — not just to the rows it
    // sends back — so a tab number and the list under it describe one set of PRs.
    api
      .queue(tab, sort, repoFilter, query)
      .then((d) => {
        if (!live) return;
        setErr("");
        setData(d);
      })
      .catch((e: unknown) => live && setErr(errMessage(e, "Couldn't load your queue.")));
    return () => {
      live = false;
    };
    // runKey: a job appearing or finishing changes what these rows should say.
  }, [tab, sort, nonce, runKey, repoFilter, query]);

  // Every repo we know of: configured + whatever the server reports. Deliberately NOT the
  // repos of the visible rows — under a repo filter that list is one entry, and the picker
  // offering exactly the filter you already applied is a dead end.
  const repos = useMemo(
    () => [...new Set<string>([...(me.repos || []), ...(data?.repos || [])])],
    [me.repos, data],
  );
  const multi = repos.length > 1;
  const activeFilter = repoFilter && repos.includes(repoFilter) ? repoFilter : "";
  // A remembered filter for a repository that no longer exists would otherwise be sent to the
  // server for ever and match nothing, while the picker said "All repositories". Forget it.
  useEffect(() => {
    if (data && repoFilter && !repos.includes(repoFilter)) setRepoFilter("");
  }, [data, repoFilter, repos]);

  const statusOf = (r: QueueRow) =>
    runningFor(jobs, "review", r.repo, r.num)?.status || (r.running ? r.status || "reviewing" : "");

  // Only the in-flight jobs still need filtering here: they come from the running store, not
  // from /api/queue, so the server never saw them.
  const matches = (repo: string, num: string, title: string) => {
    if (activeFilter && repo !== activeFilter) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${repo} ${repo}#${num} #${num} ${title}`.toLowerCase().includes(needle);
  };

  // ?running=1 is a view of the running-jobs store, not of a tab. Intersecting it with one tab's
  // rows hid every job on an archived or not-requested PR — and only matched kind "review", so a
  // QA guide in flight read as "Nothing running" while the sidebar pill counted it.
  const runningRows = useMemo(
    () => jobs.filter((j) => matches(j.repo, j.num, j.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey, query, activeFilter],
  );

  // The one field does both: what is typed filters the queue as it goes, and if it reads as a
  // PR reference — a URL, owner/name#123 or a bare number — Enter opens that PR.
  const parsed = parsePrRef(q, repos);
  const needsPick = !!parsed && !parsed.repo && multi;
  const goReview = () => {
    if (!parsed) return;
    const repo = parsed.repo || (multi ? rvRepo || repos[0] : repos[0] || "");
    navigate(prUrl({ repo, num: parsed.number }));
  };

  const header = (
    <PageHeader
      title="Your review queue"
      help={
        <>
          Reviews requested from you across{" "}
          {multi ? (
            <>
              <b>{repos.length} repositories</b>
              {me.allowOrg ? <> (and any under <code>{me.allowOrg}</code>)</> : null}
            </>
          ) : (
            <code>{repos[0] || me.repo}</code>
          )}
          . Type to filter, or paste a PR URL, <code>owner/name#123</code> or a number and press Enter
          to open it. Nothing reaches GitHub without your click.
        </>
      }
      actions={
        <form
          className="flex w-full items-center gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            goReview();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="qsearch"
              type="search"
              autoComplete="off"
              aria-label="Filter your queue, or open a PR by URL or number"
              placeholder="Filter, or paste a PR URL or #123…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          {parsed && (
            <Button variant="secondary" type="submit" data-testid="open-pr">
              Open #{parsed.number}
            </Button>
          )}
        </form>
      }
    />
  );

  if (err && !data)
    return (
      <>
        {header}
        <Banner kind="err" data-testid="queue-error">{err}</Banner>
      </>
    );
  if (!data)
    return (
      <>
        {header}
        <QueueSkeleton />
      </>
    );
  const empty = EMPTY[tab] || [Inbox, "Nothing here yet", "This view is empty."];
  const filtering = !!(query.trim() || activeFilter);
  const rows = data.rows;
  // Per-repo counts for the open tab, so the picker says how much is behind each option.
  const repoCount = (r: string) => data.repoCounts?.[r]?.[tab];
  // A brand-new install has nothing in the queue because nothing is set up yet, which is not the
  // same as being caught up.
  const noRepos = me.personal === true && (me.repos ?? []).length === 0;
  const notSetUp = me.claude_connected === false || me.poller_ran === false || noRepos;

  return (
    <>
      {header}
      {needsPick && (
        <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="repo-pick">
          <span className="text-sm text-muted-foreground">Which repository is #{parsed!.number} in?</span>
          <Select value={rvRepo || repos[0]} onValueChange={setRvRepo}>
            <SelectTrigger size="sm" aria-label="Repository for the pasted PR number">
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
        </div>
      )}
      {!data.slackOk && (
        <Banner kind="warn">
          No Slack member ID yet — review requests won't ping you.{" "}
          <Link to="/integrations">Add it in Integrations.</Link>
        </Banner>
      )}

      <Tabs value={tab} onValueChange={(v) => navigate(`/?tab=${v}&sort=${sort}`)} className="mt-1">
        <TabsList variant="line" className="h-auto! flex-wrap justify-start gap-x-0.5 gap-y-1 p-0" aria-label="Queue views">
          {data.tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="h-9 flex-none gap-1.5 px-3">
              {t.label}
              <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[11px] tabular-nums text-muted-foreground in-data-[state=active]:text-foreground" data-testid="tab-count">
                {t.count.toLocaleString("en-US")}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {multi && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Repository</span>
            <Select value={activeFilter || ALL} onValueChange={(v) => setRepoFilter(v === ALL ? "" : v)}>
              <SelectTrigger id="repofilter" size="sm" aria-label="Filter by repository" className="max-w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className={ITEM}>All repositories</SelectItem>
                {repos.map((r) => {
                  const n = repoCount(r);
                  return (
                    <SelectItem key={r} value={r} className={ITEM}>
                      {r}
                      {n === undefined ? "" : ` (${n.toLocaleString("en-US")})`}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-0.5" role="group" aria-label="Sort">
          {SORTS.map(([k, lbl]) => (
            <Button
              key={k}
              asChild
              variant={sort === k ? "secondary" : "ghost"}
              size="sm"
              className={cn("hover:no-underline", sort !== k && "text-muted-foreground")}
            >
              <Link aria-current={sort === k ? "true" : undefined} to={`/?tab=${tab}&sort=${k}`}>
                {lbl}
              </Link>
            </Button>
          ))}
        </div>
        {filtering && (
          <span className="text-xs text-muted-foreground" data-testid="filter-note">
            Every count above is for the filtered set.
          </span>
        )}
      </div>

      {err && (
        <Banner kind="err" data-testid="queue-error">{err}</Banner>
      )}

      <div data-tour="queue" className="mt-4">
        {onlyRunning ? (
          runningRows.length > 0 ? (
            <Card className="gap-0 divide-y divide-border py-0" id="qlist" data-testid="running-list">
              {runningRows.map((j) => (
                <div className={ROW_CLASS} data-testid="queue-row" data-running="true" key={`${j.kind}:${j.repo}#${j.num}`}>
                  <Link className={ROW_LINK_CLASS} data-testid="row-link" to={j.href}>
                    <RowTitle repo={j.repo} num={j.num} title={j.title || `PR #${j.num}`} showRepo={multi} />
                    <RunningLine label={j.kind === "qa" ? "QA guide" : "Review"} status={j.status || (j.kind === "qa" ? "building" : "reviewing")} />
                  </Link>
                </div>
              ))}
            </Card>
          ) : (
            <Card className="py-0">
              <EmptyState icon={Check} title="Nothing running">
                Every review and QA guide you started has finished.
              </EmptyState>
            </Card>
          )
        ) : rows.length > 0 ? (
          <Card className="gap-0 divide-y divide-border py-0" id="qlist" data-tour="queuelist">
            {rows.map((r) => (
              <Row
                key={`${r.repo}#${r.num}`}
                row={r}
                showRepo={multi}
                status={statusOf(r)}
                onChange={() => setNonce((n) => n + 1)}
                onError={setErr}
              />
            ))}
          </Card>
        ) : filtering ? (
          <Card className="py-0">
            <EmptyState icon={Search} title="No matches">
              Nothing in this view matches your {query ? "search" : "repository filter"}.
            </EmptyState>
          </Card>
        ) : notSetUp && tab === "todo" ? (
          <Card className="py-0">
            <EmptyState
              icon={Compass}
              title={`Finish setting ${me.brand} up`}
              data-testid="setup-needed"
            >
              Your queue is empty because this install isn't ready yet, not because you're caught up.
              <ul className="mx-auto my-3 flex max-w-[520px] list-none flex-col gap-2 p-0 text-left text-foreground">
                {me.personal && (
                  <li className="flex items-start gap-2">
                    {noRepos ? (
                      <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-green" />
                    )}
                    <span>
                      Pick the repositories to watch — <Link to="/repos">Repositories</Link>.
                    </span>
                  </li>
                )}
                <li className="flex items-start gap-2">
                  {me.claude_connected === false ? (
                    <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-green" />
                  )}
                  <span>
                    Connect your Claude account — <Link to="/integrations">Integrations</Link>. Reviews run on
                    it; nothing runs without it.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  {me.poller_ran === false ? (
                    <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-green" />
                  )}
                  <span>
                    Let the poller run once so it can find the PRs that name you as a reviewer —{" "}
                    <Link to="/settings">Settings</Link>.
                  </span>
                </li>
              </ul>
              You can review any PR right now with the box at the top of this page.
            </EmptyState>
          </Card>
        ) : (
          <Card className="py-0">
            <EmptyState icon={empty[0]} title={empty[1]}>
              {empty[2]}
            </EmptyState>
          </Card>
        )}
      </div>
    </>
  );
}
