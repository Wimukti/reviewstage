import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Cpu } from "lucide-react";
import { api, errMessage, type KeepBlock, type RollupData, type RollupSeriesPoint } from "./api";
import { Link } from "./router";
import { Banner, PageHeader, RepoPill, StatusBadge, UserAvatar } from "./ui";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Insights — ReviewStage's activity, precision and agreement, aggregated from files it already writes.
// All charts are hand-rolled SVG (no chart dependency); each sits in a Card with its title. The
// tiles are one grid row of Cards: a number in display type and a two-word label. How each is
// measured lives behind the page's one `?`, so the page reads as numbers first and method on request.

// Chart colours are the tokens, so the charts follow the theme like everything else.
const C = {
  accent: "var(--blue)",
  green: "var(--green)",
  amber: "var(--amber)",
  red: "var(--red)",
  blue: "var(--blue)",
  dim: "var(--graphite)",
  faint: "var(--hairline)",
  ink: "var(--ink)",
};

// Below this many observations a percentage is noise with a decimal point on it. Show the
// sample instead of a number that will swing to 0.0% or 100.0% on the next finding. The server
// ships the real floor with every keep bucket — this is only the fallback for one that does not.
const FLOOR = 20;

function num(n: number): string {
  return n.toLocaleString("en-US"); // org rule: commas in numbers
}
function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`; // org rule: one decimal
}
// A rate the sample can support, or the sample itself — the caller renders "too few" quietly.
type Rated = { value: string; thin: boolean };
function rate(n: number | null, sample: number, floor = FLOOR): Rated {
  if (n == null) return { value: "—", thin: false };
  if (sample < floor) return { value: `n = ${num(sample)}`, thin: true };
  return { value: pct(n), thin: false };
}
function thin(sample: number, floor = FLOOR): boolean {
  return sample < floor;
}
// One keep bucket, rated the way the server says it may be rated: it carries both the sample it
// was computed over and the minimum it considers enough, so no surface here invents a floor.
function keepRate(b: KeepBlock | undefined, which: "rate" | "keepRate" = "rate"): Rated {
  if (!b) return { value: "—", thin: false };
  const decided = b.decided ?? b.kept + b.edited + b.dropped;
  const v = which === "keepRate" ? b.keepRate ?? b.rate : b.rate;
  if (v == null) return { value: "—", thin: false };
  const ratable = b.ratable ?? decided >= (b.minSample ?? FLOOR);
  return ratable ? { value: pct(v), thin: false } : { value: `n = ${num(decided)}`, thin: true };
}
function dur(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} hr`;
  return `${(sec / 86400).toFixed(1)} days`;
}

const NOTE = "text-xs text-muted-foreground";
const TooFew = () => (
  <StatusBadge tone="graphite" icon={null} className="font-sans font-medium tracking-normal">
    too few to rate
  </StatusBadge>
);

// ---- charts ---------------------------------------------------------------------------------

// Bars in an SVG that stretches to the container; the axis labels are HTML underneath so they
// stay legible at 390 instead of being squeezed with the drawing.
function BarChart({ points, color, partialLast }:
  { points: RollupSeriesPoint[]; color: string; partialLast: boolean }) {
  const w = 720;
  const h = 130;
  const pad = 4;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.reviews));
  const bw = (w - pad * 2) / n;
  const ticks = [0, Math.floor(n / 2), n - 1].filter((t, i, a) => a.indexOf(t) === i);
  return (
    <div>
      <div className={cn(NOTE, "mb-1 tabular-nums")}>max {max}/day</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-[130px] w-full" preserveAspectRatio="none" role="img"
           aria-label="Reviews per day">
        <defs>
          {/* Today's bar covers part of a day, so it is drawn hatched — otherwise every chart
              ends on a dip that looks like a slowdown. */}
          <pattern id="rs-partial" width={5} height={5} patternUnits="userSpaceOnUse"
                   patternTransform="rotate(45)">
            <rect width={5} height={5} fill={C.faint} />
            <line x1={0} y1={0} x2={0} y2={5} stroke={color} strokeWidth={2.5} />
          </pattern>
        </defs>
        <line x1={pad} y1={h - 1} x2={w - pad} y2={h - 1} stroke={C.faint} strokeWidth={1} />
        {points.map((p, i) => {
          const bh = (p.reviews / max) * (h - 8);
          const partial = partialLast && i === n - 1;
          return (
            <rect key={i} x={pad + i * bw + bw * 0.15} y={h - 1 - bh}
                  width={Math.max(1, bw * 0.7)} height={bh} rx={1.5}
                  fill={partial ? "url(#rs-partial)" : color}>
              <title>
                {`${p.date}: ${p.reviews} review(s)${partial ? " — today so far (partial)" : ""}`}
              </title>
            </rect>
          );
        })}
      </svg>
      {/* text-xs rounds to 11.998px under the 14px root; the phone legibility floor is a true 12. */}
      <div className="mt-1 flex justify-between text-[12px] text-muted-foreground tabular-nums" aria-hidden="true" data-testid="axis-x">
        {ticks.map((t, i) => (
          <span key={t} className={cn(i === 1 && ticks.length === 3 && "text-center", i === ticks.length - 1 && "text-right")}>
            {points[t]?.date}
          </span>
        ))}
      </div>
    </div>
  );
}

function Donut({ segments, center, sub }:
  { segments: { label: string; value: number; color: string }[]; center: string; sub: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = 52;
  const cx = 66;
  const cy = 66;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 132 132" width={132} height={132} className="font-display">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.faint} strokeWidth={16} />
        {total > 0 &&
          segments.map((s, i) => {
            const len = (s.value / total) * circ;
            const el = (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={16}
                      strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset}
                      transform={`rotate(-90 ${cx} ${cy})`}>
                <title>{`${s.label}: ${s.value}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={22} fontWeight={600} fill={C.ink}>
          {center}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize={9} fill={C.dim} className="font-sans">{sub}</text>
      </svg>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-muted-foreground">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
            {s.label} <b className="text-foreground tabular-nums">{num(s.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

type HBarRow = { key: string; label: ReactNode; title: string; value: number; note?: string };
function HBars({ rows, color }: { rows: HBarRow[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && <div className={NOTE}>No data yet.</div>}
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[150px_1fr_auto] items-center gap-2.5 text-sm max-[899px]:grid-cols-[110px_1fr_auto]">
          <div className="flex min-w-0 items-center" title={r.title}>{r.label}</div>
          <div className="h-3.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full min-w-0.5 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
          <div className={cn(NOTE, "whitespace-nowrap tabular-nums")}>{r.note ?? num(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

// A tile is a Card with a number in display type and a two-word label. A sample too small to
// rate shows the sample and a quiet graphite badge in the number's place, never a headline.
function Kpi({ label, value, thin, id, all }:
  { label: string; value: string; thin?: boolean; id?: string; all?: boolean }) {
  return (
    <Card
      className={cn("min-w-0 gap-1 rounded-lg px-3 py-3", all && "max-[899px]:order-3")}
      data-testid="kpi"
      data-key={id}
    >
      <div
        className={cn(
          "min-h-6 min-w-0",
          thin
            ? "flex flex-wrap items-center gap-1.5 text-sm font-medium leading-none tabular-nums"
            : "truncate font-display text-2xl font-semibold leading-none tracking-tight tabular-nums",
        )}
        data-testid="kpi-value"
        data-thin={thin ? "true" : undefined}
        title={thin ? "Too few to rate" : undefined}
      >
        {value}
        {thin && <TooFew />}
      </div>
      <div className={cn(NOTE, "leading-tight")} data-testid="kpi-label">{label}</div>
    </Card>
  );
}

// A chart: a Card with a title and the drawing.
function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="min-w-0 gap-3 py-4" data-testid="chart">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

// The two headline figures (agreement, cycle time) in display type.
function Big({ value, thin, testId }: { value: string; thin?: boolean; testId?: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 font-display text-3xl font-semibold leading-none tracking-tight tabular-nums" data-testid={testId}>
      {value}
      {thin && <TooFew />}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">Loading insights</span>
      <div className="mb-6 grid grid-cols-9 gap-2 max-[899px]:grid-cols-3">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

// ---- page -----------------------------------------------------------------------------------

const RANGES: [string, number][] = [
  ["7 days", 7],
  ["30 days", 30],
  ["90 days", 90],
];
// Radix Tabs cannot carry an empty-string value, so "every repository" travels under a key.
const ALL = "__all__";

export function Rollup() {
  const [d, setD] = useState<RollupData | null>(null);
  const [err, setErr] = useState("");
  const [range, setRange] = useState(30);
  const [repo, setRepo] = useState(""); // "" = every repository
  const [allRepos, setAllRepos] = useState<string[]>([]);

  useEffect(() => {
    api
      .rollup(repo)
      .then((r) => {
        setD(r);
        // The unfiltered call knows every repo; keep that list for the filter while filtering.
        if (!repo) setAllRepos(r.repos.map((x) => x.repo));
      })
      .catch((e: unknown) => setErr(errMessage(e, "Couldn't load insights.")));
  }, [repo]);

  const period = useMemo(() => {
    if (!d) return null;
    const pts = d.series.slice(-range);
    const reviews = pts.reduce((a, p) => a + p.reviews, 0);
    const tokens = pts.reduce((a, p) => a + p.tokens, 0);
    const kept = pts.reduce((a, p) => a + p.kept, 0);
    const edited = pts.reduce((a, p) => a + p.edited, 0);
    const dropped = pts.reduce((a, p) => a + p.dropped, 0);
    const kt = kept + edited + dropped;
    return { pts, reviews, tokens, kept, edited, dropped, decided: kt,
             keepRate: kt ? (100 * kept) / kt : null };
  }, [d, range]);

  const rangeTabs = (
    <Tabs value={String(range)} onValueChange={(v) => setRange(Number(v))} className="ml-auto">
      <TabsList aria-label="Range" title="Applies to the activity chart and the first three tiles" data-testid="range-tabs">
        {RANGES.map(([label, days]) => (
          <TabsTrigger key={days} value={String(days)} className="px-3">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  if (err)
    return (
      <>
        <PageHeader title="Insights" />
        <Banner kind="err" data-testid="insights-error">{err}</Banner>
      </>
    );
  if (!d || !period)
    return (
      <>
        <PageHeader title="Insights">{rangeTabs}</PageHeader>
        <InsightsSkeleton />
      </>
    );

  const sev = d.severity;
  const allSev = sev.blocker + sev["should-fix"] + sev.nit + sev.question;
  const kt = d.keep.allTime;
  const allDecided = kt.decided ?? kt.kept + kt.edited + kt.dropped;
  const cp = d.keep.criticalPath;
  const cpDecided = cp ? cp.decided ?? cp.kept + cp.edited + cp.dropped : 0;
  // The floor the server applies to its own buckets, reused for the per-range numbers this
  // page computes itself so the two cannot disagree about what "too few" means.
  const floor = kt.minSample ?? FLOOR;
  // The last bucket is today only when the series really reaches today — a stale rollup file
  // must not hatch a bar that is in fact complete. Compare on the point's `ts`, the server's
  // UTC-midnight bucket key: `date` is a display string (%m/%d/%y) and never matched.
  const last = period.pts[period.pts.length - 1];
  const todayTs = Math.floor(Date.now() / 86400000) * 86400;
  const partialLast = !!last && last.ts === todayTs;
  // Decisions recorded while DRY_RUN=1. Excluded from every rate on this page — nothing was
  // posted — so without saying so a pilot install reads as one where nobody decided anything.
  const dry = d.dryDecisions ?? 0;
  const ag = d.agreement;
  // Pooled: confirmed and total are summed across every reviewed head, so the sample is
  // findings, not PRs.
  const agSample = ag.totalFindings ?? ag.multiReviewerPRs;
  const agreement = rate(ag.avgRate, agSample);
  const periodKeep = rate(period.keepRate, period.decided, floor);
  const allKeep = keepRate(kt);
  const cpKeep = keepRate(cp);
  const worth = keepRate(kt, "keepRate");
  const method = (
    <div data-testid="methodology" className="[&_li]:my-1 [&_p]:mt-0 [&_ul]:mb-0 [&_ul]:mt-2 [&_ul]:pl-4">
      <p>
        Activity, precision and agreement for this install: early signal, not proof. Run counts
        and tokens come from every run this install has kept. The keep, severity and agreement
        numbers are computed over{" "}
        {d.findingsCap
          ? `the most recent ${num(d.findingsCap)} finding decisions only`
          : "a capped window of recent finding decisions"}
        , not from day one. The range control applies to the activity chart and the first three
        tiles; everything else is all time.
      </p>
      <ul className="text-muted-foreground [&_b]:text-foreground">
        <li>
          <b>Kept as-is</b> — findings posted unchanged, as a share of every finding decided
          in the range ({num(period.decided)} decided; {allKeep.value}
          {allKeep.thin ? ", too few to rate," : ""} over the logged {num(allDecided)}).
        </li>
        <li>
          <b>Worth posting</b> — kept or reworded, as a share of the {num(allDecided)} logged
          decisions: the share of findings worth posting at all. Kept as-is is stricter and reads lower.
        </li>
        <li>
          <b>Critical-path keep</b> — kept as-is, over the {num(cpDecided)} findings on profiled
          critical paths.
        </li>
        <li>
          <b>Rules promoted</b> — repeated rejections accepted as team rules on the Skills page.
        </li>
        <li>
          <b>Agreement</b> —{" "}
          {ag.pooled
            ? `pooled across every reviewed commit: confirmed and total findings are summed over ${num(ag.heads ?? 0)} commit(s), so a big PR counts for more than a small one.`
            : "the mean of per-PR rates across multi-reviewer PRs."}{" "}
          A finding counts as confirmed only when a reviewer using a different skill, model or
          effort raised it too. A signal to improve toward, not a score: a lower number can
          mean broader coverage, not worse reviews.
        </li>
        <li>
          <b>Cycle time</b> — median time {d.cycle.label ?? "from GitHub's review request to the post"}
          {d.cycle.n ? ` over ${num(d.cycle.n)} posted review(s)` : ""}; it includes however long
          the PR sat before anyone clicked Run, not just the run itself.
          {d.cycle.excluded
            ? ` ${num(d.cycle.excluded)} of ${num(d.cycle.posts ?? 0)} posted review(s) had no request to measure from and are outside it.`
            : ""}
        </li>
        <li>
          <b>Too few to rate</b> — below {num(floor)} decided findings a percentage would swing
          to 0.0% or 100.0% on the next one, so the sample is shown instead.
        </li>
        {dry > 0 && (
          <li>
            <b>Dry run</b> — the {num(dry)} decision{dry === 1 ? "" : "s"} made while{" "}
            <code>DRY_RUN=1</code> {dry === 1 ? "is" : "are"} in no rate here because nothing was
            posted. Every review still weighs them; turn <code>DRY_RUN</code> off to start rating.
          </li>
        )}
      </ul>
    </div>
  );
  const eyebrow = "text-xs font-medium text-muted-foreground";
  return (
    <>
      <PageHeader title="Insights" help={method}>
        {rangeTabs}
      </PageHeader>
      {allRepos.length > 1 && (
        <Tabs value={repo || ALL} onValueChange={(v) => setRepo(v === ALL ? "" : v)} className="mb-3">
          <TabsList aria-label="Filter by repository" data-testid="repo-pills" className="h-auto! flex-wrap">
            <TabsTrigger value={ALL} className="flex-none px-3">All repositories</TabsTrigger>
            {allRepos.map((r) => (
              <TabsTrigger key={r} value={r} className="flex-none px-3">
                {r}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {dry > 0 && (
        <Banner kind="info" icon="flask" data-testid="dry-banner">
          {num(dry)} decision{dry === 1 ? "" : "s"} made while <code>DRY_RUN=1</code> never reached
          GitHub, so {dry === 1 ? "it is" : "they are"} outside every rate and chart here —{" "}
          <Link to="/learnings">Learnings</Link> lists them.
        </Banner>
      )}

      {/* One row of nine tiles at 1440: the range group, then all time. The eyebrows take the
          first grid row so every tile shares one top edge; below 900 the grid is three across
          and the all-time group follows the range group. */}
      <div className="mt-1 mb-4 grid grid-cols-9 gap-2 max-[899px]:grid-cols-3" data-testid="kpis">
        <div className={cn(eyebrow, "col-span-3 max-[899px]:col-span-full")} data-testid="kpis-range-h">Last {range} days</div>
        <div className={cn(eyebrow, "col-span-6 max-[899px]:order-2 max-[899px]:col-span-full max-[899px]:mt-2")} data-testid="kpis-all-h">All time</div>
        <Kpi label="Reviews run" value={num(period.reviews)} />
        <Kpi label="Tokens used" value={num(period.tokens)} />
        <Kpi label="Kept as-is" value={periodKeep.value} thin={periodKeep.thin} id="kept" />
        <Kpi label="Reviews recorded" all value={num(d.reviews.total)} />
        <Kpi label="PRs reviewed" all value={num(d.prs)} />
        <Kpi label="Active reviewers" all value={num(d.reviewers.length)} />
        <Kpi label="Rules promoted" all value={num(d.promotedRules ?? 0)} />
        <Kpi label="Critical-path keep" all value={cpKeep.value} thin={cpKeep.thin} />
        <Kpi label="Worth posting" all value={worth.value} thin={worth.thin} id="worth" />
      </div>

      <div className="flex flex-col gap-3">
        <Chart title="Review activity per day">
          <BarChart points={period.pts} color={C.accent} partialLast={partialLast} />
          {partialLast && <div className={cn(NOTE, "mt-2")}>The hatched bar is today, still in progress.</div>}
        </Chart>

        <div className="grid grid-cols-2 gap-3 max-[899px]:grid-cols-1">
          <Chart title="Findings kept, edited, dropped">
            <Donut
              center={thin(period.decided, floor) ? `n = ${num(period.decided)}` : pct(period.keepRate)}
              sub={thin(period.decided, floor) ? "too few to rate" : "kept as-is"}
              segments={[
                { label: "Kept", value: period.kept, color: C.green },
                { label: "Edited", value: period.edited, color: C.amber },
                { label: "Dropped", value: period.dropped, color: C.red },
              ]}
            />
            {dry > 0 && (
              <div className={cn(NOTE, "mt-2")} data-testid="dry-donut-note">
                Excludes {num(dry)} decision{dry === 1 ? "" : "s"} made in dry run.
              </div>
            )}
          </Chart>
          <Chart title="Findings by severity">
            <HBars
              color={C.blue}
              rows={(["blocker", "should-fix", "nit", "question"] as const).map((k) => ({
                key: k,
                label: <StatusBadge kind={k} />,
                title: k,
                value: sev[k],
              }))}
            />
            <div className={cn(NOTE, "mt-2")}>{num(allSev)} logged decisions.</div>
          </Chart>
        </div>

        {!repo && d.repos.length > 0 && (
          <Chart title="Runs by repository">
            <HBars
              color={C.blue}
              rows={d.repos.map((r) => ({
                key: r.repo,
                label: <RepoPill repo={r.repo} className="max-w-full" />,
                title: r.repo,
                value: r.runs,
                note: `${num(r.runs)} runs · ${num(r.prs)} PRs · ${num(r.tokens)} tok`,
              }))}
            />
          </Chart>
        )}

        <div className="grid grid-cols-2 gap-3 max-[899px]:grid-cols-1">
          <Chart title="Runs by reviewer">
            <HBars
              color={C.accent}
              rows={d.reviewers.map((r) => ({
                key: r.login,
                label: (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <UserAvatar login={r.login} size="sm" />
                    <span className="truncate">{r.login}</span>
                  </span>
                ),
                title: r.login,
                value: r.runs,
              }))}
            />
          </Chart>
          <Chart title="Runs by model">
            <HBars
              color={C.green}
              rows={d.models.map((m) => ({
                key: m.model,
                label: (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Cpu aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{m.model.replace(/^claude-/, "")}</span>
                  </span>
                ),
                title: m.model,
                value: m.runs,
                note: `${num(m.runs)} · ${num(m.tokens)} tok`,
              }))}
            />
          </Chart>
        </div>

        <div className="grid grid-cols-2 gap-3 max-[899px]:grid-cols-1">
          <Chart title="Agreement across reviewers">
            <Big value={agreement.value} thin={agreement.thin} testId="agreement" />
            <div className={NOTE}>
              {num(ag.confirmedFindings)} confirmed of {num(ag.totalFindings ?? 0)} findings on{" "}
              {num(ag.multiReviewerPRs)} multi-reviewer PR{ag.multiReviewerPRs === 1 ? "" : "s"}.
            </div>
          </Chart>
          <Chart title="Cycle time">
            <Big value={dur(d.cycle.medianReviewToPostSec)} />
            <div className={NOTE}>
              {d.cycle.n
                ? `Median over ${num(d.cycle.n)} posted review${d.cycle.n === 1 ? "" : "s"}.`
                : "Needs requested-at data — captured from now on."}
            </div>
          </Chart>
        </div>
      </div>
    </>
  );
}
