import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  FlaskConical,
  Loader2,
  RefreshCw,
  Sparkles,
  Square,
} from "lucide-react";
import { api, errMessage, type Me, type PrRef, type QaDetail, type QaGuide } from "./api";
import { Md } from "./Md";
import { parsePrRef, prLabel, prUrl, usageChip, usageTitle } from "./pr";
import { Link, navigate, useLocation } from "./router";
import { pokeRunning, runningFor, useRunning } from "./running";
import { Banner, EmptyState, PageHeader, RepoPill, StatusBadge } from "./ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const NOTE = "text-xs text-muted-foreground";
// Menu highlight: accent and popover share a tone in tw.css, so the system's own highlight is
// invisible on a popover; the blue tint is what the legacy menus used.
const ITEM = "focus:bg-blue/14";

// The guide body: prose at 15px, with the markdown's headings, lists, task boxes and tables
// sized for a document a tester works through. `qaguide` is a bare hook for the specs.
const GUIDE =
  "qaguide max-w-[80ch] text-[15px] leading-relaxed " +
  "[&>:first-child]:mt-0 [&_p]:mt-0 [&_p]:mb-2.5 [&_li]:my-1 " +
  "[&_h1]:font-sans [&_h1]:tracking-normal " +
  "[&_:is(h1,h2,h3,h4,h5)]:mt-5 [&_:is(h1,h2,h3,h4,h5)]:mb-1.5 [&_:is(h1,h2,h3,h4,h5)]:text-base [&_:is(h1,h2,h3,h4,h5)]:font-semibold " +
  "[&_li.task-list-item]:flex [&_li.task-list-item]:list-none [&_li.task-list-item]:items-start [&_li.task-list-item]:gap-2 " +
  "[&_ul.contains-task-list]:pl-1 [&_li.task-list-item>input]:mt-[3px] [&_li.task-list-item>input]:size-4 [&_li.task-list-item>input]:shrink-0 " +
  "[&_table]:my-2.5 [&_table]:block [&_table]:overflow-x-auto";

function QaIndex({ me }: { me: Me }) {
  const [guides, setGuides] = useState<QaGuide[]>([]);
  const [repos, setRepos] = useState<string[]>(me.repos || []);
  const [pr, setPr] = useState("");
  const [pickRepo, setPickRepo] = useState("");
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const jobs = useRunning();
  const runKey = jobs.map((j) => `${j.kind}:${j.repo}#${j.num}`).join(",");
  useEffect(() => {
    api
      .qaIndex()
      .then((d) => {
        setErr("");
        setGuides(d.guides);
        if (d.repos?.length) setRepos(d.repos);
      })
      .catch((e: unknown) => setErr(errMessage(e, "Couldn't load your QA guides.")))
      .finally(() => setLoaded(true));
    // A guide starting or finishing changes this list — re-read it then, no timer of our own.
  }, [runKey]);
  const multi = repos.length > 1;
  const parsed = parsePrRef(pr, repos);
  const needsPick = !!parsed && !parsed.repo && multi;
  const form = (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!parsed) return;
        const repo = parsed.repo || pickRepo || repos[0] || "";
        navigate(prUrl({ repo, num: parsed.number }, "/qa"));
      }}
    >
      <Input
        className="min-w-[200px] flex-1"
        autoComplete="off"
        aria-label="PR to build a QA guide for"
        placeholder="PR URL, owner/name#123, or a number"
        value={pr}
        onChange={(e) => setPr(e.target.value)}
      />
      {needsPick && (
        <Select value={pickRepo || repos[0]} onValueChange={setPickRepo}>
          <SelectTrigger aria-label="Repository" className="max-w-[220px]">
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
      <Button type="submit" disabled={!parsed}>
        Open
      </Button>
    </form>
  );
  // With no guides yet the form IS the empty state: the one thing to do on the page.
  const none = loaded && guides.length === 0 && !err;
  return (
    <>
      <PageHeader title="QA guides" actions={!none && form} />
      {err && (
        <Banner kind="err" data-testid="qa-index-error">{err}</Banner>
      )}
      {!loaded ? (
        <Card className="gap-0 divide-y divide-border py-0" aria-busy="true">
          <span className="sr-only" role="status">Loading your QA guides</span>
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2 px-4 py-3">
              <Skeleton className="h-4 w-2/3 max-w-[420px]" />
              <Skeleton className="h-3.5 w-1/3 max-w-[200px]" />
            </div>
          ))}
        </Card>
      ) : guides.length > 0 ? (
        <Card className="gap-0 divide-y divide-border py-0" data-testid="qa-list">
          {guides.map((g) => {
            const status = runningFor(jobs, "qa", g.repo, g.num)?.status || (g.running ? g.status || "building" : "");
            const to = prUrl({ repo: g.repo, num: g.num }, "/qa");
            return (
              <Link
                key={`${g.repo}#${g.num}`}
                to={to}
                data-testid="qa-row"
                data-running={status ? "true" : undefined}
                className="flex min-h-[44px] items-start gap-3 px-4 py-2.5 text-inherit hover:bg-accent/40 hover:no-underline"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden="true">
                  <FlaskConical className="size-4 text-muted-foreground" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    {multi && g.repo && <RepoPill repo={g.repo} />}
                    <span className="text-sm font-medium text-primary">#{g.num}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.title}</span>
                  </span>
                  {status ? (
                    <span className="flex flex-wrap items-center gap-2 text-xs" data-testid="row-running">
                      <StatusBadge kind="reviewing" live>Building</StatusBadge>
                      <span className="text-amber">{status}</span>
                      <span className="text-muted-foreground">— open to watch</span>
                    </span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge kind="done">Guide ready</StatusBadge>
                      <span className={NOTE}>{g.when}</span>
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </Card>
      ) : none ? (
        <Card className="py-0">
          <EmptyState icon={FlaskConical} title="Build your first QA guide" data-testid="qa-empty" action={<div className="w-[min(520px,calc(100vw-64px))]">{form}</div>}>
            Paste a PR URL, or type <code>owner/name#123</code> or a number.
          </EmptyState>
        </Card>
      ) : null}
    </>
  );
}

// The pre-clipboard-API copy: a hidden textarea plus document.execCommand("copy"). Deprecated,
// but the only thing that works on http://<lan-ip>, which is exactly how the docs say to install.
function execCommandCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    ta.remove();
  }
  return ok;
}

// Nothing more will happen to a guide in one of these states without another click.
const TERMINAL = new Set(["done", "failed", "stopped"]);

// The phase list a build walks: done green, current a spinner, pending graphite.
function Progress({ phases, cur, testId }: { phases: string[]; cur: number; testId?: string }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm" data-testid={testId ?? "qa-progress"}>
      {phases.map((ph, j) => (
        <li key={ph} className={cn("flex items-center gap-2.5", j < cur ? "text-muted-foreground" : j === cur ? "font-medium" : "text-muted-foreground")}>
          {j < cur ? (
            <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-green" />
          ) : j === cur ? (
            <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
          ) : (
            <Circle aria-hidden="true" className="size-4 shrink-0" />
          )}
          {ph}
        </li>
      ))}
    </ol>
  );
}

function QaDetailView({ pr }: { pr: PrRef }) {
  const [d, setD] = useState<QaDetail | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  // Set the moment Generate is clicked. The server reports "none" for the seconds the job takes
  // to spawn, so arming the timer on state === "running" alone meant the first-ever Generate
  // never polled: the page sat on "No guide yet" while the guide was being written.
  const [starting, setStarting] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const load = useCallback(
    () =>
      api
        .qaDetail(pr)
        .then((x) => {
          setLoadErr("");
          setD(x);
        })
        .catch((e: unknown) => setLoadErr(errMessage(e, "Couldn't load this QA guide."))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pr.repo, pr.num],
  );

  useEffect(() => {
    setD(null);
    setStarting(false);
    setErr("");
    setLoadErr("");
  }, [pr.repo, pr.num]);
  useEffect(() => {
    load();
  }, [load]);
  // The run has been picked up (or has ended): the optimistic state has done its job.
  useEffect(() => {
    if (d && (d.state === "running" || TERMINAL.has(d.state))) setStarting(false);
  }, [d]);
  useEffect(() => {
    window.clearInterval(timer.current);
    const live = d && !TERMINAL.has(d.state) && (d.state === "running" || starting);
    if (live) timer.current = window.setInterval(load, 4000);
    return () => window.clearInterval(timer.current);
  }, [d, starting, load]);

  const crumbs = (repo: string, ghUrl?: string) => (
    <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Link to="/qa" className="text-muted-foreground hover:text-foreground">QA guides</Link>
      <ChevronRight aria-hidden="true" className="size-3.5" />
      {repo && <RepoPill repo={repo} />}
      {ghUrl && (
        <a href={ghUrl} target="_blank" rel="noopener" className="ml-auto inline-flex items-center gap-1 text-xs">
          <ExternalLink aria-hidden="true" className="size-3.5" />
          Open on GitHub
        </a>
      )}
    </nav>
  );

  if (loadErr && !d)
    return (
      <>
        {crumbs(pr.repo)}
        <PageHeader title={<span className="text-primary">#{pr.num}</span>} />
        <Banner kind="err" data-testid="qa-load-error">{loadErr}</Banner>
      </>
    );
  if (!d)
    return (
      <>
        {crumbs(pr.repo)}
        <PageHeader title={<span className="text-primary">#{pr.num}</span>} />
        <Card className="gap-3 py-5" aria-busy="true">
          <span className="sr-only" role="status">Loading this QA guide</span>
          <CardContent className="flex flex-col gap-3 px-5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      </>
    );

  // A failed or stopped run never hides a guide that is already on disk — the server keeps the
  // state at "done" for exactly that reason. What went wrong rides above the guide as a warning,
  // with the agent's own last words behind a disclosure.
  const lastRun =
    d.lastRunFailed || d.lastRunStopped || d.failed || (d.stopped && d.md) ? (
      <Banner kind={d.lastRunStopped || d.stopped ? "warn" : "err"} icon="stop" data-testid="qa-last-run">
        <>
          <b>
            {d.lastRunStopped || d.stopped
              ? "The last attempt was stopped."
              : "The last attempt failed."}
          </b>{" "}
          {d.md
            ? "The guide below is the one already on disk — it is unchanged, not a result of that run."
            : "No guide was written."}
          {d.failed && <div className="mt-1.5 [overflow-wrap:anywhere]">{d.failed}</div>}
          {d.logTail && d.logTail.length > 0 && (
            <Collapsible open={logOpen} onOpenChange={setLogOpen} className="mt-1" data-testid="qa-log">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                  <ChevronRight aria-hidden="true" className={cn("transition-transform", logOpen && "rotate-90")} />
                  Last {d.logTail.length} lines of the log
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-1 max-h-[260px] overflow-auto whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">
                  {d.logTail.join("\n")}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      </Banner>
    ) : null;

  const chip = d.usage ? (
    <span className={NOTE} title={usageTitle(d.usage)} data-testid="qa-usage">
      {usageChip(d.usage)}
    </span>
  ) : null;

  // The server has no title for a PR it has never fetched and fills in "PR #n"; printing that
  // after the number read as `#38849 — PR #38849`.
  const hasTitle = !!d.title && d.title.trim() !== `PR #${pr.num}` && d.title.trim() !== `#${pr.num}`;
  const header = (
    <>
      {crumbs(d.repo, d.ghUrl)}
      <PageHeader
        title={
          <>
            <span className="text-primary">#{pr.num}</span>
            {hasTitle && <> {d.title}</>}
          </>
        }
      />
    </>
  );

  async function gen() {
    if (!d || busy) return;
    setErr("");
    setBusy(true);
    setStarting(true); // poll from this instant, not from the first "running" the server admits
    try {
      const r = await api.qaGen({ repo: d.repo, num: pr.num }, d.genToken);
      if (r.started === false) {
        setStarting(false);
        setErr(
          r.reason ||
            "Nothing started — a job for this PR may already be running, or the box is busy. " +
              "Try again in a moment.",
        );
        return;
      }
      pokeRunning();
      load();
    } catch (x) {
      setStarting(false);
      setErr(errMessage(x, "Couldn't start the QA guide."));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!d?.stopToken || busy) return;
    setErr("");
    setBusy(true);
    try {
      await api.qaStop({ repo: d.repo, num: pr.num }, d.stopToken);
      setStarting(false);
      load();
    } catch (x) {
      setErr(errMessage(x, "Couldn't stop it."));
    } finally {
      setBusy(false);
    }
  }
  // navigator.clipboard is undefined on a non-secure origin — which the documented LAN install
  // is — so the async API is only ever the first attempt, never the only one.
  async function copy() {
    if (!d?.md) return;
    setErr("");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(d.md);
      } else if (!execCommandCopy(d.md)) {
        throw new Error("This browser would not let the page copy.");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (x) {
      try {
        if (execCommandCopy(d.md)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
          return;
        }
      } catch {
        /* fall through to the message below */
      }
      setErr(
        errMessage(x, "Couldn't copy.") +
          " Use Download instead, or select the guide and copy it by hand.",
      );
    }
  }
  function download() {
    if (!d?.md) return;
    // Built in the browser from markdown the page already holds — no server endpoint needed.
    const url = URL.createObjectURL(new Blob([d.md], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `qa-${d.repo.replace("/", "-")}-${pr.num}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const progressCard = (title: ReactNode, body: ReactNode, testId?: string) => (
    <Card className="gap-3 py-5" data-testid={testId}>
      <CardHeader className="px-5">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-5">{body}</CardContent>
    </Card>
  );

  // The spawn window: clicked, but the server has not yet admitted a run. Without this the page
  // says "No guide yet" while the guide is being written.
  if (starting && d.state !== "running") {
    return (
      <>
        {header}
        {progressCard(
          <>Starting the QA guide for <b>{prLabel({ repo: d.repo, num: pr.num })}</b></>,
          <>
            <Progress phases={["Starting the job"]} cur={0} />
            <p className={cn(NOTE, "m-0")}>This page refreshes itself; the phases appear as soon as the job is picked up.</p>
          </>,
          "qa-starting",
        )}
      </>
    );
  }

  if (d.state === "running" && d.running) {
    const r = d.running;
    return (
      <>
        {header}
        {progressCard(
          <>Building QA guide for <b>{prLabel({ repo: d.repo, num: pr.num })}</b></>,
          <>
            <Progress phases={r.phases} cur={r.cur} />
            {r.queued && <p className={cn(NOTE, "m-0")}>Waiting for another job to finish first.</p>}
            <p className={cn(NOTE, "m-0")}>
              This page refreshes itself; reading the diff and review history takes a few minutes.
            </p>
            {err && (
              <Banner kind="err" data-testid="qa-error">{err}</Banner>
            )}
            <div>
              <Button variant="secondary" type="button" disabled={busy} onClick={stop}>
                <Square aria-hidden="true" />
                {busy ? "Stopping…" : "Stop"}
              </Button>
            </div>
          </>,
        )}
      </>
    );
  }

  if (d.state === "done" && d.md) {
    return (
      <>
        {header}
        {lastRun}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge kind="done">Guide ready</StatusBadge>
          {chip}
          <span className="flex-1" />
          {d.connected && (
            <Button variant="secondary" type="button" disabled={busy} onClick={gen}>
              <RefreshCw aria-hidden="true" />
              {busy ? "Starting…" : "Regenerate"}
            </Button>
          )}
          <Button variant="secondary" type="button" onClick={download} data-testid="qa-download">
            <Download aria-hidden="true" />
            Download .md
          </Button>
          <Button type="button" onClick={copy}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy guide"}
          </Button>
        </div>
        {err && (
          <Banner kind="err" data-testid="qa-error">{err}</Banner>
        )}
        <Card className="py-5">
          <CardContent className="px-5">
            <Md className={GUIDE} tasks>
              {d.md}
            </Md>
          </CardContent>
        </Card>
      </>
    );
  }

  // failed / stopped / none — no guide on disk, so the strip is all there is to show.
  const note =
    lastRun ??
    (d.state === "stopped" ? (
      <Banner kind="warn" icon="stop" data-testid="qa-last-run">
        <b>Stopped.</b> Generate a new guide below.
      </Banner>
    ) : null);

  return (
    <>
      {header}
      {note}
      {chip && <div className="mb-3">{chip}</div>}
      {err && (
        <Banner kind="err" data-testid="qa-error">{err}</Banner>
      )}
      <Card className="py-0">
        <EmptyState
          icon={d.connected ? FlaskConical : Sparkles}
          title={d.state === "none" && !note ? "No guide yet" : "Generate a new guide"}
          action={
            d.connected ? (
              <Button type="button" disabled={busy} aria-busy={busy} onClick={gen} data-testid="qa-generate">
                <FlaskConical aria-hidden="true" />
                {busy ? "Starting…" : "Generate QA guide"}
              </Button>
            ) : (
              <Button asChild>
                <Link to="/integrations">Connect Claude</Link>
              </Button>
            )
          }
        >
          {d.connected
            ? "Risk-tiered manual test cases, grounded in the diff and the review history. It takes a few minutes."
            : "Connect your Claude account first — generating a QA guide runs on your own Claude subscription."}
        </EmptyState>
      </Card>
    </>
  );
}

export function Qa({ me }: { me: Me }) {
  const { search } = useLocation();
  const pr = search.get("pr") || "";
  const repo = search.get("repo") || "";
  return pr ? <QaDetailView pr={{ repo, num: pr }} /> : <QaIndex me={me} />;
}
