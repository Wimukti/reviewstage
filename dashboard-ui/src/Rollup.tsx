import { useEffect, useMemo, useState } from "react";
import { api, errMessage, type KeepBlock, type RollupData, type RollupSeriesPoint } from "./api";
import { Link } from "./router";

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
// sample instead of a number that will swing to 0.0% or 100.0% on the next finding. The server
// ships the real floor with every keep bucket — this is only the fallback for one that does not.
const FLOOR = 20;

function num(n: number): string {
  return n.toLocaleString("en-US"); // org rule: commas in numbers
}
function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`; // org rule: one decimal
}
// A rate the sample can actually support, or an honest refusal to rate it.
function rate(n: number | null, sample: number, floor = FLOOR): string {
  if (n == null) return "—";
  if (sample < floor) return `n = ${num(sample)} — too few to rate`;
  return pct(n);
}
function thin(sample: number, floor = FLOOR): boolean {
  return sample < floor;
}
// One keep bucket, rated the way the server says it may be rated: it carries both the sample it
// was computed over and the minimum it considers enough, so no surface here invents a floor.
function keepRate(b: KeepBlock | undefined, which: "rate" | "keepRate" = "rate"): string {
  if (!b) return "—";
  const decided = b.decided ?? b.kept + b.edited + b.dropped;
  const v = which === "keepRate" ? b.keepRate ?? b.rate : b.rate;
  if (v == null) return "—";
  const ratable = b.ratable ?? decided >= (b.minSample ?? FLOOR);
  return ratable ? pct(v) : `n = ${num(decided)} — too few to rate`;
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
      <div className="banner err" data-testid="insights-error">
        <span>🚫</span>
        <div>{err}</div>
      </div>
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
  return (
    <>
      <div className="insights-head">
        <div>
          <h1>Insights</h1>
          <p className="muted sm">
            ReviewStage's activity, precision and agreement. Run counts and tokens come from every
            run this install has kept; the keep, severity and agreement numbers are computed over
            {d.findingsCap
              ? ` the most recent ${num(d.findingsCap)} finding decisions only, not from day one.`
              : " a capped window of recent finding decisions, not from day one."}{" "}
            Read these as early signal to build on, not proof.
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

      {dry > 0 && (
        <div className="banner info" data-testid="dry-banner">
          <span>🧪</span>
          <div>
            <b>
              {num(dry)} finding decision(s) were made while <code>DRY_RUN=1</code>
              {allDecided === 0 ? " — and none outside it yet" : ""}.
            </b>{" "}
            Nothing was posted to GitHub, so they are in none of the keep rates or charts below;
            that is why those can read as empty on a pilot. They are not lost —{" "}
            <Link to="/learnings">What has been learned</Link> lists them, and every review
            weighs them. Turn <code>DRY_RUN</code> off to start rating.
          </div>
        </div>
      )}

      <div className="kpirow">
        <Kpi label={`Reviews · last ${range}d`} value={num(period.reviews)}
             sub={`${num(d.reviews.total)} recorded in total`} />
        <Kpi label={`Tokens · last ${range}d`} value={num(period.tokens)}
             sub={`${num(d.tokens.total)} in total · runs that reported usage`} />
        <Kpi label={`Kept as-is · last ${range}d`}
             value={rate(period.keepRate, period.decided, floor)}
             sub={`posted unchanged, of ${num(period.decided)} decided · ${
               keepRate(kt)} over the logged ${num(allDecided)}`} />
        <Kpi label="PRs · reviewers" allTime value={`${num(d.prs)} · ${num(d.reviewers.length)}`}
             sub="distinct PRs · people" />
        <Kpi label="Rules promoted from evidence" allTime value={num(d.promotedRules ?? 0)}
             sub="repeated rejections accepted as Team rules" />
        <Kpi label="Kept on critical paths" allTime
             value={keepRate(cp)}
             sub={`posted unchanged, of ${num(cpDecided)} findings on profiled paths`} />
        <Kpi label="Kept or reworded" allTime value={keepRate(kt, "keepRate")}
             sub={`the share worth posting at all, of ${num(allDecided)} decided`} />
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
              Excludes {num(dry)} decision(s) made in dry run, which never reached GitHub.
            </div>
          )}
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
          {(() => {
            const ag = d.agreement;
            // Pooled: confirmed and total are summed across every reviewed head, so the sample
            // is findings, not PRs. The old copy described an unweighted mean of per-PR rates,
            // which is not what the server computes any more.
            const sample = ag.totalFindings ?? ag.multiReviewerPRs;
            return (
              <>
                <div className={"agreebig" + (thin(sample) ? " kpi-thin" : "")} data-testid="agreement">
                  {rate(ag.avgRate, sample)}
                </div>
                <p className="muted sm">
                  {ag.pooled ? (
                    <>
                      <b>Pooled</b> across every reviewed commit:{" "}
                      {num(ag.confirmedFindings)} confirmed of{" "}
                      {num(ag.totalFindings ?? 0)} findings, over{" "}
                      {num(ag.heads ?? 0)} commit(s) on {num(ag.multiReviewerPRs)} multi-reviewer
                      PR(s). A big PR therefore counts for more than a small one — the earlier
                      per-PR mean let a PR with two findings weigh as much as one with twenty.
                    </>
                  ) : (
                    <>
                      Across {num(ag.multiReviewerPRs)} multi-reviewer PRs (
                      {num(ag.confirmedFindings)} confirmed findings).
                    </>
                  )}{" "}
                  A finding counts as confirmed only when a reviewer using a different skill,
                  model or effort raised it too. A signal to improve toward, not a score: a lower
                  number can mean broader coverage, not worse reviews.
                </p>
              </>
            );
          })()}
        </div>
        <div className="panel">
          <div className="panel-h">Cycle time (lagging) — whole range</div>
          <div className="agreebig">{dur(d.cycle.medianReviewToPostSec)}</div>
          <p className="muted sm">
            {/* The server names what it measured; restating it here is how the two drifted
                apart the first time. */}
            Median time {d.cycle.label ?? "from GitHub's review request to the post"}
            {d.cycle.n ? ` over ${num(d.cycle.n)} posted review(s)` : ""} — it includes however
            long the PR sat before anyone clicked Run, not just the run itself.
            {d.cycle.excluded
              ? ` ${num(d.cycle.excluded)} of ${num(d.cycle.posts ?? 0)} posted review(s) are
                 outside this: nobody had requested them, so there is no request to measure from.`
              : ""}
            {d.cycle.n ? "" : " Needs requested-at data — captured from now on."}
          </p>
        </div>
      </div>
    </>
  );
}
