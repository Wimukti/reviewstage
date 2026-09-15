import { useEffect, useMemo, useState } from "react";
import { api, type RollupData, type RollupSeriesPoint } from "./api";

// Insights — ReviewStage's activity, precision and agreement, aggregated from files it already writes.
// All charts are hand-rolled SVG (no chart dependency), matching ReviewStage's no-framework style.

const C = {
  accent: "#7c83f0",
  green: "#34a86e",
  amber: "#d9a441",
  red: "#e5658a",
  blue: "#4c9be8",
  dim: "#8a8f98",
  faint: "#3a3f4a",
};

// Below this many observations a percentage is noise with a decimal point on it. Show the
// sample instead of a number that will swing to 0.0% or 100.0% on the next finding.
const FLOOR = 20;
// rs_learn keeps only the most recent this many finding decisions; "all-time" cannot mean more.
const LOG_CAP = 300;

function num(n: number): string {
  return n.toLocaleString("en-US"); // org rule: commas in numbers
}
function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`; // org rule: one decimal
}
// A rate the sample can actually support, or an honest refusal to rate it.
function rate(n: number | null, sample: number): string {
  if (n == null) return "—";
  if (sample < FLOOR) return `n = ${num(sample)} — too few to rate`;
  return pct(n);
}
function thin(sample: number): boolean {
  return sample < FLOOR;
}
function dur(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} hr`;
  return `${(sec / 86400).toFixed(1)} days`;
}

// ---- charts ---------------------------------------------------------------------------------

function BarChart({ points, color, partialLast }:
  { points: RollupSeriesPoint[]; color: string; partialLast: boolean }) {
  const w = 720;
  const h = 150;
  const pad = 22;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.reviews));
  const bw = (w - pad * 2) / n;
  const ticks = [0, Math.floor(n / 2), n - 1];
  return (
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
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke={C.faint} strokeWidth={1} />
      {points.map((p, i) => {
        const bh = (p.reviews / max) * (h - pad * 2);
        const partial = partialLast && i === n - 1;
        return (
          <rect key={i} x={pad + i * bw + bw * 0.15} y={h - pad - bh}
                width={Math.max(1, bw * 0.7)} height={bh} rx={1.5}
                fill={partial ? "url(#rs-partial)" : color}>
            <title>
              {`${p.date}: ${p.reviews} review(s)${partial ? " — today so far (partial)" : ""}`}
            </title>
          </rect>
        );
      })}
      {ticks.map((t) => (
        <text key={t} x={pad + t * bw + bw / 2} y={h - 6} fontSize={9} fill={C.dim}
              textAnchor="middle">{points[t]?.date}</text>
      ))}
      <text x={pad} y={13} fontSize={9} fill={C.dim}>max {max}/day</text>
    </svg>
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
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={22} fontWeight={700} fill="#e8eaf0">
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

// `allTime` marks a tile the range pills do not control — several of these tiles never moved
// when the range changed, with nothing on screen saying so.
function Kpi({ label, value, sub, allTime }:
  { label: string; value: string; sub?: string; allTime?: boolean }) {
  return (
    <div className="kpi">
      <div className="kpi-l">
        {label}
        {allTime && (
          <span className="kpi-tag" title="Not affected by the range pills above">
            all-time
          </span>
        )}
      </div>
      <div className={"kpi-v" + (/too few/.test(value) ? " kpi-thin" : "")}>{value}</div>
      {sub && <div className="kpi-s">{sub}</div>}
    </div>
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
  const [err, setErr] = useState(false);
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
      .catch(() => setErr(true));
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

  if (err) return <div className="card"><p className="muted">Couldn't load insights.</p></div>;
  if (!d || !period) return <div className="wrap-load muted">Loading…</div>;

  const sev = d.severity;
  const allSev = sev.blocker + sev["should-fix"] + sev.nit + sev.question;
  const kt = d.keep.allTime;
  const allDecided = kt.kept + kt.edited + kt.dropped;
  const cp = d.keep.criticalPath;
  const cpDecided = (cp?.kept ?? 0) + (cp?.edited ?? 0) + (cp?.dropped ?? 0);
  // The last bucket is today only when the series really reaches today — a stale rollup file
  // must not hatch a bar that is in fact complete.
  const last = period.pts[period.pts.length - 1];
  const partialLast = !!last && last.date === new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="insights-head">
        <div>
          <h1>Insights</h1>
          <p className="muted sm">
            ReviewStage's activity, precision and agreement. Run counts and tokens come from every
            run this install has kept; the keep, severity and agreement numbers are computed over
            the most recent {num(d.findingsCap ?? LOG_CAP)} finding decisions only, not from day
            one. Read these as early signal to build on, not proof.
          </p>
        </div>
        <div className="rangepills" title="Applies to the activity chart and the tiles marked “last Nd”">
          {RANGES.map(([label, days]) => (
            <button key={days} type="button"
                    className={"rangepill" + (range === days ? " on" : "")}
                    onClick={() => setRange(days)}>
              {label}
            </button>
          ))}
        </div>
      </div>
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

      <div className="kpirow">
        <Kpi label={`Reviews · last ${range}d`} value={num(period.reviews)}
             sub={`${num(d.reviews.total)} recorded in total`} />
        <Kpi label={`Tokens · last ${range}d`} value={num(period.tokens)}
             sub={`${num(d.tokens.total)} in total · runs that reported usage`} />
        <Kpi label={`Kept as-is · last ${range}d`}
             value={rate(period.keepRate, period.decided)}
             sub={`posted unchanged, of ${num(period.decided)} decided · ${
               rate(d.keep.allTime.rate, allDecided)} over the logged ${num(allDecided)}`} />
        <Kpi label="PRs · reviewers" allTime value={`${num(d.prs)} · ${num(d.reviewers.length)}`}
             sub="distinct PRs · people" />
        <Kpi label="Rules promoted from evidence" allTime value={num(d.promotedRules ?? 0)}
             sub="repeated rejections accepted as Team rules" />
        <Kpi label="Kept on critical paths" allTime
             value={rate(d.keep.criticalPath?.rate ?? null, cpDecided)}
             sub={`posted unchanged, of ${num(cpDecided)} findings on profiled paths`} />
      </div>

      <div className="panel">
        <div className="panel-h">Review activity — per day (last {range} days)</div>
        <BarChart points={period.pts} color={C.accent} partialLast={partialLast} />
        <div className="muted sm">
          One bar per day, from runs this install recorded.
          {partialLast && " The hatched bar is today, still in progress."}
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="panel-h">Findings kept vs. edited vs. dropped (last {range}d)</div>
          <Donut
            center={thin(period.decided) ? `n = ${num(period.decided)}` : pct(period.keepRate)}
            sub={thin(period.decided) ? "too few to rate" : "kept as-is"}
            segments={[
              { label: "Kept", value: period.kept, color: C.green },
              { label: "Edited", value: period.edited, color: C.amber },
              { label: "Dropped", value: period.dropped, color: C.red },
            ]}
          />
        </div>
        <div className="panel">
          <div className="panel-h">
            Findings by severity — the logged {num(allSev)} decisions, whole range
          </div>
          <HBars
            color={C.blue}
            rows={[
              { label: "Blocker", value: sev.blocker },
              { label: "Should-fix", value: sev["should-fix"] },
              { label: "Nit", value: sev.nit },
              { label: "Question", value: sev.question },
            ]}
          />
        </div>
      </div>

      {!repo && d.repos.length > 0 && (
        <div className="panel">
          <div className="panel-h">By repository — recorded runs, whole range</div>
          <HBars color={C.amber}
                 rows={d.repos.map((r) => ({ label: r.repo, value: r.runs,
                                             note: `${num(r.runs)} runs · ${num(r.prs)} PRs · ${num(r.tokens)} tok` }))} />
        </div>
      )}

      <div className="grid2">
        <div className="panel">
          <div className="panel-h">By reviewer — recorded runs, whole range</div>
          <HBars color={C.accent}
                 rows={d.reviewers.map((r) => ({ label: r.login, value: r.runs }))} />
        </div>
        <div className="panel">
          <div className="panel-h">By model — recorded runs, whole range</div>
          <HBars color={C.green}
                 rows={d.models.map((m) => ({ label: m.model, value: m.runs,
                                              note: `${num(m.runs)} · ${num(m.tokens)} tok` }))} />
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="panel-h">Agreement across reviewers — whole range</div>
          <div className={"agreebig" + (thin(d.agreement.multiReviewerPRs) ? " kpi-thin" : "")}>
            {rate(d.agreement.avgRate, d.agreement.multiReviewerPRs)}
          </div>
          <p className="muted sm">
            The <b>unweighted mean of each PR's own agreement rate</b> across{" "}
            {num(d.agreement.multiReviewerPRs)} multi-reviewer PRs ({num(d.agreement.confirmedFindings)}{" "}
            confirmed findings) — a PR with two findings counts as much as one with twenty. A
            finding counts as confirmed only when a reviewer using a different skill, model or
            effort raised it too. A signal to improve toward, not a score: a lower number can mean
            broader coverage, not worse reviews.
          </p>
        </div>
        <div className="panel">
          <div className="panel-h">Cycle time (lagging) — whole range</div>
          <div className="agreebig">{dur(d.cycle.medianReviewToPostSec)}</div>
          <p className="muted sm">
            Median time from <b>GitHub requesting the review</b> to the first comment posted
            {d.cycle.n ? ` over ${num(d.cycle.n)} posted review(s)` : ""} — it includes however
            long the PR sat before anyone clicked Run, not just the run itself.
            {d.cycle.n ? "" : " Needs requested-at data — captured from now on."}
          </p>
        </div>
      </div>
    </>
  );
}
