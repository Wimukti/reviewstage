// The review-in-flight card, as the PR page shows it (PrPage ProgressPanel), from fixture data
// and props alone: no API, no stop button. Rendered by the site's strip and by StageScene's
// "drafting" state. Presentational only (design.md §7).
import fixture from "./fixture.json";

export function StageProgress({ cur = 2, effortLabel = "Standard" }: { cur?: number; effortLabel?: string }) {
  return (
    <div className="card top" data-testid="stage-progress">
      <div className="prog-hd">
        Drafting review for <b>{fixture.repo} #{fixture.pr}</b> · <span className="muted sm">{effortLabel} effort</span>
      </div>
      <ul className="prog">
        {fixture.phases.map((ph, j) => (
          <li key={ph} className={j < cur ? "done" : j === cur ? "now" : ""}>
            <span className="pm">
              {j < cur ? <Tick /> : j === cur ? <span className="rundot" aria-hidden="true" /> : <Circle />}
            </span>
            {ph}
          </li>
        ))}
      </ul>
      <div className="hint" style={{ marginTop: 10 }}>This page refreshes itself.</div>
    </div>
  );
}

// The two glyphs ProgressPanel takes from icons.tsx, inlined so the stage bundle on the site
// carries nothing it does not draw.
const Tick = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12l5 5L20 7" />
  </svg>
);
const Circle = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
  </svg>
);
