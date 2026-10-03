import { useCallback, useEffect, useState } from "react";
import { ChevronRight, GitBranch, Layers, Loader2, Play, Plug } from "lucide-react";
import { api, errMessage, type StackData } from "./api";
import { prUrl } from "./pr";
import { Crumbs, PrTitle } from "./PrPage";
import { Link, useLocation } from "./router";
import { Banner, EmptyState, PageHeader, StatusBadge } from "./ui";
import { BrandIcon } from "./icons";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const ITEM = "focus:bg-blue/14";

function StackSkeleton() {
  return (
    <Card className="gap-0 divide-y divide-border border-0 py-0 shadow-sm" aria-busy="true">
      <span className="sr-only" role="status">
        Loading this stack
      </span>
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-[18px] rounded-[4px]" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3 max-w-[420px]" />
            <Skeleton className="h-3.5 w-1/3 max-w-[200px]" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </Card>
  );
}

export function StackPage() {
  const { search } = useLocation();
  const pr = search.get("pr") || "";
  const repo = search.get("repo") || "";
  const ref = { repo, num: pr };
  const [d, setD] = useState<StackData | null>(null);
  const [effort, setEffort] = useState("standard");
  const [started, setStarted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loadErr, setLoadErr] = useState("");
  const load = useCallback(
    () =>
      pr
        ? api
            .stack(ref)
            .then((x) => {
              setLoadErr("");
              setD(x);
            })
            .catch((e: unknown) => setLoadErr(errMessage(e, "Couldn't load this stack.")))
        : Promise.resolve(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pr, repo],
  );
  useEffect(() => {
    load();
  }, [load]);
  // default: every PR in the stack selected
  useEffect(() => {
    if (d) setSel(new Set(d.stack.map((it) => it.num)));
  }, [d]);
  const toggle = (num: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      next.has(num) ? next.delete(num) : next.add(num);
      return next;
    });

  const head = (
    <>
      <Crumbs repo={d?.repo || repo} num={pr} tail="stack" />
      <PageHeader
        title={<PrTitle num={pr} title="Stacked review" />}
        className="mb-3"
        help={
          <>
            These open PRs form a stack — each is based on the one above it. Tick the ones to review
            and start them from here; they queue one at a time on this box, skipping any already
            running.
          </>
        }
      />
    </>
  );

  if (loadErr && !d)
    return (
      <div className="prpage">
        {head}
        <Banner kind="err" data-testid="stack-error">{loadErr}</Banner>
      </div>
    );
  if (!d)
    return (
      <div className="prpage">
        {head}
        <StackSkeleton />
      </div>
    );

  if (!d.isStack)
    return (
      <div className="prpage">
        {head}
        <Card className="border-0 py-0 shadow-sm">
          <EmptyState
            icon={Layers}
            title="Not a stack"
            action={
              <Button asChild variant="secondary">
                <Link to={prUrl({ repo: d.repo, num: pr })} className="hover:no-underline">
                  Back to the review
                </Link>
              </Button>
            }
          >
            Its base branch is not another open PR's branch.
          </EmptyState>
        </Card>
      </div>
    );

  const gate = (
    <div className="flex items-start gap-3" data-testid="claude-gate">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&>svg]:size-5">
        {BrandIcon.claude}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Connect your Claude account to run reviews</div>
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">Reviews run on your own Claude subscription.</p>
        <Button asChild>
          <Link to="/integrations" className="hover:no-underline">
            <Plug aria-hidden="true" />
            Connect Claude
          </Link>
        </Button>
      </div>
    </div>
  );

  async function runSelected() {
    if (!d || sel.size === 0 || busy) return;
    setErr("");
    setBusy(true);
    try {
      const r = await api.stackRun({ repo: d.repo, num: pr }, d.runToken, effort, [...sel]);
      setStarted(r.started);
      load();
    } catch (x) {
      setErr(errMessage(x, "Couldn't queue those reviews."));
    } finally {
      setBusy(false);
    }
  }

  const level = d.levels.find((lv) => lv.key === effort);
  return (
    <div className="prpage">
      {head}
      <Card className="gap-0 divide-y divide-border border-0 py-0 shadow-sm" data-testid="stack-list">
        {d.stack.map((it, i) => {
          const pos = i === 0 ? "top" : i === d.stack.length - 1 ? "bottom" : "";
          const current = it.num === pr;
          return (
            <div
              className={cn("flex min-h-[44px] items-center gap-3 pl-3.5 pr-2 first:rounded-t-lg last:rounded-b-lg hover:bg-accent/40", current && "bg-accent")}
              key={it.num}
              data-testid="stack-row"
              data-current={current || undefined}
            >
              <Checkbox
                checked={sel.has(it.num)}
                onCheckedChange={() => toggle(it.num)}
                aria-label={`Select #${it.num}`}
                data-testid="stack-select"
                className="size-[18px]"
              />
              <Link className="flex min-w-0 flex-1 flex-col gap-1 py-2.5 text-inherit hover:no-underline" to={prUrl({ repo: d.repo, num: it.num })}>
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-primary">#{it.num}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{it.title}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    <GitBranch aria-hidden="true" />
                    {it.head}
                  </Badge>
                  <span>into</span>
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    <GitBranch aria-hidden="true" />
                    {it.base}
                  </Badge>
                  {pos && <span>· {pos} of stack</span>}
                </span>
              </Link>
              <StatusBadge kind={it.state} />
              <Link
                className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground max-[899px]:hidden"
                to={prUrl({ repo: d.repo, num: it.num })}
                aria-hidden="true"
                tabIndex={-1}
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          );
        })}
      </Card>
      <Card className="mt-3 gap-3 border-0 py-4 shadow-sm" data-testid="stack-run">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Review the stack</CardTitle>
          <CardDescription className="text-xs">One effort level, applied to every ticked PR; they run one at a time on this box.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-4">
          {err && <Banner kind="err">{err}</Banner>}
          {started !== null && (
            <Banner kind="ok">
              Queued {started.toLocaleString("en-US")} review{started === 1 ? "" : "s"}. They run one at a
              time on the box.
            </Banner>
          )}
          {d.connected ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="stack-effort" className="text-xs font-medium text-muted-foreground">
                  Effort
                </Label>
                <Select value={effort} onValueChange={setEffort}>
                  <SelectTrigger id="stack-effort" aria-label="Effort" className="w-full max-w-[420px]">
                    <SelectValue>
                      <span>{level?.name ?? effort}</span>
                      {level && <span className="truncate text-xs text-muted-foreground">{level.sub}</span>}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {d.levels.map((lv) => (
                      <SelectItem key={lv.key} value={lv.key} className={ITEM}>
                        <span className="flex flex-col gap-0.5">
                          <span>{lv.name}</span>
                          <span className="text-xs text-muted-foreground">{lv.sub}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {sel.size.toLocaleString("en-US")} of {d.stack.length.toLocaleString("en-US")} ticked
                </span>
                <Button type="button" onClick={runSelected} disabled={busy || sel.size === 0} aria-busy={busy}>
                  {busy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Play aria-hidden="true" />}
                  {busy ? "Starting…" : `Review selected (${sel.size})`}
                </Button>
              </div>
            </>
          ) : (
            gate
          )}
        </CardContent>
      </Card>
    </div>
  );
}
