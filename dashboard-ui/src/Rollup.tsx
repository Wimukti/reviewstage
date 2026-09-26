import { useEffect, useMemo, useState } from "react";
import { api, errMessage, type KeepBlock, type RollupData, type RollupSeriesPoint } from "./api";
import { Link } from "./router";
import { PageHead } from "./About";
import { Banner } from "./ui";

// Insights — ReviewStage's activity, precision and agreement, aggregated from files it already writes.
// All charts are hand-rolled SVG (no chart dependency), matching ReviewStage's no-framework style.
// Tiles carry a number and a two-word label in one dense row; how each is measured lives behind
// the page's one `?`, so the page reads as numbers first and method on request.

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
    <div className="barchart">
      <div className="axis-max muted sm">max {max}/day</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="chart" preserveAspectRatio="none" role="img"
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
      <div className="axis-x muted sm" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t}>{points[t]?.date}</span>
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
    <div className="donutwrap">
      <svg viewBox="0 0 132 132" width={132} height={132}>
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
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize={9} fill={C.dim}>{sub}</text>
      </svg>
      <div className="legend">
        {segments.map((s) => (
          <div key={s.label} className="legrow">
            <span className="legdot" style={{ background: s.color }} />
            {s.label} <b>{num(s.value)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function HBars({ rows, color }: { rows: { label: string; value: number; note?: string }[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.length === 0 && <div className="muted sm">No data yet.</div>}
      {rows.map((r) => (
        <div key={r.label} className="hbar">
          <div className="hbar-label" title={r.label}>{r.label}</div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
          <div className="hbar-val">{r.note ?? num(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

// A tile is a number and a two-word label. A sample too small to rate is a quiet graphite line
// in the number's place, never a headline.
function Kpi({ label, value, thin, testId, all }:
  { label: string; value: string; thin?: boolean; testId?: string; all?: boolean }) {
  return (
    <div className={"kpi" + (all ? " is-all" : "")} data-testid={testId}>
      <div className={"kpi-v" + (thin ? " kpi-thin" : "")} title={thin ? "Too few to rate" : undefined}>
        {value}
        {thin && <span className="kpi-thin-note">too few to rate</span>}
      </div>
      <div className="kpi-l">{label}</div>
    </div>
  );
}

// A chart on the canvas: a title and the drawing, no panel around it (design: Insights).
function Chart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="chartblock">
      <h2 className="chart-h">{title}</h2>
      {children}
    </section>
  );
}

// ---- page -----------------------------------------------------------------------------------

const RANGES: [string, number][] = [
  ["7 days", 7],
  ["30 days", 30],
  ["90 days", 90],
];

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
        // The unfiltered call knows every repo; keep that list for the pills while filtering.
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

  if (err)
    return (
      <Banner kind="err" data-testid="insights-error">{err}</Banner>
    );
  if (!d || !period) return <div className="wrap-load muted">Loading…</div>;

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
    <div data-testid="methodology">
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
      <ul>
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
  return (
    <>
      <PageHead title="Insights" about={method} aboutTestId="insights-about">
        <div className="rangepills" title="Applies to the activity chart and the first three tiles">
          {RANGES.map(([label, days]) => (
            <button key={days} type="button"
                    className={"rangepill" + (range === days ? " on" : "")}
                    onClick={() => setRange(days)}>
              {label}
            </button>
          ))}
        </div>
      </PageHead>
      {allRepos.length > 1 && (
        <div className="rangepills" style={{ marginBottom: 14 }} data-testid="repo-pills" aria-label="Filter by repository">
          <button type="button" className={"rangepill" + (repo === "" ? " on" : "")} onClick={() => setRepo("")}>
            All repositories
          </button>
          {allRepos.map((r) => (
            <button key={r} type="button" className={"rangepill" + (repo === r ? " on" : "")} onClick={() => setRepo(r)}>
              {r}
            </button>
          ))}
        </div>
      )}

      {dry > 0 && (
        <Banner kind="info" icon="flask" data-testid="dry-banner">
          {num(dry)} decision{dry === 1 ? "" : "s"} made while <code>DRY_RUN=1</code> never reached
          GitHub, so {dry === 1 ? "it is" : "they are"} outside every rate and chart here —{" "}
          <Link to="/learnings">Learnings</Link> lists them.
        </Banner>
      )}

      {/* One dense row (design: Insights): the range group, then all time, split by a rule. The
          eyebrows sit in their own grid row so every tile shares one top edge. */}
      <div className="kpigrid" data-testid="kpis">
        <div className="kpi-g" data-testid="kpis-range-h">Last {range} days</div>
        <div className="kpi-g kpi-g-all" data-testid="kpis-all-h">All time</div>
        <Kpi label="Reviews run" value={num(period.reviews)} />
        <Kpi label="Tokens used" value={num(period.tokens)} />
        <Kpi label="Kept as-is" value={periodKeep.value} thin={periodKeep.thin} testId="kpi-kept" />
        <Kpi label="Reviews recorded" all value={num(d.reviews.total)} />
        <Kpi label="PRs reviewed" all value={num(d.prs)} />
        <Kpi label="Active reviewers" all value={num(d.reviewers.length)} />
        <Kpi label="Rules promoted" all value={num(d.promotedRules ?? 0)} />
        <Kpi label="Critical-path keep" all value={cpKeep.value} thin={cpKeep.thin} />
        <Kpi label="Worth posting" all value={worth.value} thin={worth.thin} testId="kpi-worth" />
      </div>

      <Chart title="Review activity per day">
        <BarChart points={period.pts} color={C.accent} partialLast={partialLast} />
        {partialLast && <div className="muted sm">The hatched bar is today, still in progress.</div>}
      </Chart>

      <div className="grid2">
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
            <div className="muted sm" data-testid="dry-donut-note">
              Excludes {num(dry)} decision{dry === 1 ? "" : "s"} made in dry run.
            </div>
          )}
        </Chart>
        <Chart title="Findings by severity">
          <HBars
            color={C.blue}
            rows={[
              { label: "Blocker", value: sev.blocker },
              { label: "Should fix", value: sev["should-fix"] },
              { label: "Nit", value: sev.nit },
              { label: "Question", value: sev.question },
            ]}
          />
          <div className="muted sm" style={{ marginTop: 8 }}>{num(allSev)} logged decisions.</div>
        </Chart>
      </div>

      {!repo && d.repos.length > 0 && (
        <Chart title="Runs by repository">
          <HBars color={C.blue}
                 rows={d.repos.map((r) => ({ label: r.repo, value: r.runs,
                                             note: `${num(r.runs)} runs · ${num(r.prs)} PRs · ${num(r.tokens)} tok` }))} />
        </Chart>
      )}

      <div className="grid2">
        <Chart title="Runs by reviewer">
          <HBars color={C.accent}
                 rows={d.reviewers.map((r) => ({ label: r.login, value: r.runs }))} />
        </Chart>
        <Chart title="Runs by model">
          <HBars color={C.green}
                 rows={d.models.map((m) => ({ label: m.model, value: m.runs,
                                              note: `${num(m.runs)} · ${num(m.tokens)} tok` }))} />
        </Chart>
      </div>

      <div className="grid2">
        <Chart title="Agreement across reviewers">
          <div className={"agreebig" + (agreement.thin ? " kpi-thin" : "")} data-testid="agreement">
            {agreement.value}
            {agreement.thin && <span className="kpi-thin-note"> · too few to rate</span>}
          </div>
          <div className="muted sm">
            {num(ag.confirmedFindings)} confirmed of {num(ag.totalFindings ?? 0)} findings on{" "}
            {num(ag.multiReviewerPRs)} multi-reviewer PR{ag.multiReviewerPRs === 1 ? "" : "s"}.
          </div>
        </Chart>
        <Chart title="Cycle time">
          <div className="agreebig">{dur(d.cycle.medianReviewToPostSec)}</div>
          <div className="muted sm">
            {d.cycle.n
              ? `Median over ${num(d.cycle.n)} posted review${d.cycle.n === 1 ? "" : "s"}.`
              : "Needs requested-at data — captured from now on."}
          </div>
        </Chart>
      </div>

    </>
  );
}
