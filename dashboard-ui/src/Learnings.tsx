import { useEffect, useState } from "react";
import { api, type LearningsData, type Me } from "./api";

function Pill({ kind, label }: { kind: string; label?: string }) {
  return <span className={"pill " + kind}>{label || kind}</span>;
}

// What a review actually reads back, per rs_learn: the most recent N of each outcome, capped
// separately. The old copy said "the last 40 decisions", which is neither number.
const WINDOW = { dropped: 24, edited: 12 };

export function Learnings({ me }: { me: Me }) {
  const [d, setD] = useState<LearningsData | null>(null);
  useEffect(() => {
    api.learnings().then(setD);
  }, []);
  if (!d) return <div className="muted">Loading…</div>;
  const win = d.windows ?? WINDOW;

  return (
    <>
      <h1>What {me.brand} has learned</h1>
      <p className="lead">
        Every time you drop a finding as noise or reword one before posting, {me.brand} remembers it
        and weighs it on the next review — same-repository decisions first, then the team's general
        preferences — so it stops repeating what you reject. This is that memory.
      </p>
      <div className="stats">
        <a className="stat hot">
          <div className="k">{d.counts.dropped.toLocaleString()}</div>
          <div className="l">Dropped as noise</div>
        </a>
        <a className="stat">
          <div className="k">{d.counts.edited.toLocaleString()}</div>
          <div className="l">Reworded</div>
        </a>
        <a className="stat">
          <div className="k">{d.counts.kept.toLocaleString()}</div>
          <div className="l">Kept as-is</div>
        </a>
        <a className="stat">
          <div className="k">{d.promoted.toLocaleString()}</div>
          <div className="l">Promoted to rules</div>
        </a>
      </div>

      {d.clusters.length > 0 && (
        <>
          <h2>What is hardening into a rule</h2>
          <p className="muted sm">
            The same complaint, rejected again and again. While it is a <b>rolling preference</b> it
            survives only as long as it stays inside the window {me.brand} reads before a review —
            the most recent <b>{win.dropped} drops</b> and <b>{win.edited} rewordings</b>, counted
            separately. Once you promote it on the Skills page it becomes a Team rule and leaves
            that window for good.
          </p>
          <div className="list" data-testid="learning-clusters">
            {d.clusters.map((c) => (
              <div className="row" key={c.signature}>
                <div className="rowlink">
                  <div className="rowtop">
                    <span className={"pill " + (c.status === "promoted" ? "posted" : "archived")}>
                      {c.status === "promoted"
                        ? "Promoted to a rule"
                        : c.status === "dismissed"
                        ? "Dismissed"
                        : "Rolling preference"}
                    </span>
                    <Pill kind={c.severity} />
                    <span className="muted sm">
                      {c.count} {c.outcome === "dropped" ? "drops" : "rewordings"} across {c.prs} PRs
                    </span>
                  </div>
                  <div className="muted sm" style={{ marginTop: 5 }}>
                    {c.gist}
                  </div>
                  {c.rule && (
                    <div className="suggrule" style={{ marginTop: 6 }}>
                      {c.rule}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {d.rows.length === 0 ? (
        <div className="empty">
          <span className="ic">🧠</span>
          <b>Nothing learned yet</b>
          Post or drop a few findings and they'll show up here.
        </div>
      ) : (
        <>
          <h2>Recent decisions</h2>
          <div className="list">
            {d.rows.map((r, i) => (
              <div className="row" key={i}>
                <div className="rowlink">
                  <div className="rowtop">
                    <Pill kind={r.kind} label={r.label} />
                    {r.repo && d.repos.length > 1 && <span className="repochip">{r.repo}</span>}
                    <span className="loc">{r.loc}</span>
                    <Pill kind={r.severity} />
                  </div>
                  <div className="muted sm" style={{ marginTop: 5 }}>
                    {r.gist}
                  </div>
                  {r.editedGist && (
                    <div className="muted sm" style={{ marginTop: 4 }}>
                      → {r.editedGist}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="fine">
            One log for the whole install: every repository, every reviewer. {me.brand} weighs
            decisions from the repository under review first, but nothing here is scoped to a
            single repo. These are preferences, not hard rules — it still raises a genuine
            higher-severity issue even if it resembles a past drop.
          </p>
        </>
      )}
    </>
  );
}
