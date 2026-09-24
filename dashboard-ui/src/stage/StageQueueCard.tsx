// One queue row for PR #38849, as Queue.tsx renders it (Row + RowState), from fixture data
// alone: the link goes nowhere and the archive button does nothing. Presentational only
// (design.md §7); the site's strip shows it for the "requested" and "posted" stops.
import fixture from "./fixture.json";
import { Status } from "../ui";

export type QueueCardState = "new" | "reviewing" | "reviewed" | "posted" | "approved";

const WHEN: Record<QueueCardState, string[]> = {
  new: ["requested 2 days ago"],
  reviewing: ["requested 2 days ago"],
  reviewed: ["reviewed just now"],
  posted: ["posted just now"],
  approved: ["approved just now"],
};

export function StageQueueCard({ state = "new", showRepo = true }: { state?: QueueCardState; showRepo?: boolean }) {
  const running = state === "reviewing";
  const sev = fixture.review.findings.reduce<Record<string, number>>((m, f) => ((m[f.severity] = (m[f.severity] ?? 0) + 1), m), {});
  const label: Record<string, string> = { blocker: "blocker", "should-fix": "should fix", nit: "nit", question: "question" };
  return (
    <div className="list" data-testid="stage-queue">
      <div className={"row" + (running ? " running" : "")}>
        <a className="rowlink" href="#" onClick={(e) => e.preventDefault()}>
          <div className="rowtop">
            {showRepo && <span className="repochip" title={fixture.repo}>{fixture.repo}</span>}
            <span className="num">#{fixture.pr}</span>
            <span className="ttl">{fixture.title}</span>
          </div>
          {running ? (
            <div className="rowsub rowrun">
              <Status kind="reviewing" live />
              <span>{fixture.phases[2]}</span>
              <span className="runback">— open to watch</span>
            </div>
          ) : (
            <div className="rowsub">
              <Status kind={state} />
              {state !== "new" &&
                Object.entries(sev).map(([k, n]) => (
                  <Status key={k} kind={k}>
                    {n} {label[k] ?? k}
                  </Status>
                ))}
              <span className="muted sm">
                +{fixture.additions} −{fixture.deletions} · {fixture.changedFiles} files
              </span>
            </div>
          )}
        </a>
        <div className="rowside">
          <span className="rowby">
            {[fixture.author, ...WHEN[state]].map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </span>
          <button type="button" className="rowact" aria-label={`Archive #${fixture.pr}`} title={`Archive #${fixture.pr}`} onClick={(e) => e.preventDefault()}>
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
