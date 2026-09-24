// The PR page's stage — verdict, findings and the commit bar — as a presentational component
// the site renders inside a shadow root (design.md §7). Its data is fixture.json (PR #38849
// from the e2e fixture, written by scripts/stage-fixture.mjs); its markup and class names are
// the PR page's own (PrPage FindingCard, the commit bar) with no-op handlers, so when the A2
// lane restyles those pieces the scene inherits the change. The A2 lane extracts the shared
// pieces; until then this file mirrors them by hand and nothing here talks to an API.
//
// `state` picks a still; `play` runs the scripted sequence once from "drafting" to the armed
// stage (~6 s) and stops. Under prefers-reduced-motion it jumps straight to the end. Bump
// `playKey` to replay.
import { useEffect, useMemo, useState } from "react";
import fixture from "./fixture.json";
import { Status, wordOf } from "../ui";
import { StageProgress } from "./StageProgress";

export type SceneState = "requested" | "drafting" | "staged" | "posted" | "approved";

type Finding = (typeof fixture.review.findings)[number];

// The scripted sequence, as (delay from the previous step, step index) pairs.
const SCRIPT: [number, number][] = [
  [0, 0],      // drafting: the progress card
  [1400, 1],   // the findings list replaces it, the first card appears
  [700, 2],    // the second card appears
  [1200, 3],   // the first is ticked — the count reads 1
  [1000, 4],   // the second is ticked — the count rolls to 2
  [1100, 5],   // the post button arms
];
const END = SCRIPT.length - 1;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function StageScene({
  state,
  play = false,
  playKey = 0,
  onDone,
}: {
  state: SceneState;
  play?: boolean;
  playKey?: number;
  onDone?: () => void;
}) {
  const [step, setStep] = useState(play && !reducedMotion() ? 0 : END);
  useEffect(() => {
    if (!play) return;
    if (reducedMotion()) {
      setStep(END);
      onDone?.();
      return;
    }
    setStep(0);
    const timers: number[] = [];
    let at = 0;
    for (const [delay, s] of SCRIPT.slice(1)) {
      at += delay;
      timers.push(window.setTimeout(() => {
        setStep(s);
        if (s === END) onDone?.();
      }, at));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // onDone is deliberately not a dependency: a new callback must not restart the sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, playKey]);

  const findings = fixture.review.findings;
  // Which findings are ticked. In the still states every finding is staged (the server
  // pre-ticks confident findings); while playing they tick one at a time. The checkboxes
  // stay live so a visitor can untick one and watch the count fall.
  const [manual, setManual] = useState<Record<number, boolean>>({});
  const staged = useMemo(() => {
    const out: Record<number, boolean> = {};
    for (const f of findings) {
      const scripted = !play ? true : step >= 3 + f.i;
      out[f.i] = manual[f.i] ?? scripted;
    }
    return out;
  }, [findings, play, step, manual]);
  const count = findings.filter((f) => staged[f.i]).length;

  if (state === "requested") return <Requested />;
  if (state === "drafting" || (play && step === 0)) {
    return (
      <div className="prpage" data-stage="drafting">
        <Header />
        <StageProgress cur={2} />
      </div>
    );
  }
  const posted = state === "posted" || state === "approved";
  const visible = play ? findings.filter((f) => step >= 1 + f.i) : findings;
  const armed = !posted && count > 0 && (!play || step >= END);
  return (
    <div className="prpage" data-stage={state} data-stage-step={play ? step : undefined}>
      <Header />
      <Verdict />
      <div data-testid="post-panel">
        {visible.map((f) => (
          <FindingCard
            key={f.i}
            f={f}
            checked={posted ? false : !!staged[f.i]}
            disabled={posted}
            onToggle={() => setManual((m) => ({ ...m, [f.i]: !staged[f.i] }))}
          />
        ))}
        {state === "approved" && <Approved />}
        <div
          className={"commit-bar" + (posted ? " is-posted" : "") + (armed ? " has-staged" : "")}
          data-testid="commit-bar"
        >
          <div className="inner">
            {posted ? (
              <>
                <span className="muted sm" data-testid="commit-posted">
                  <Status tone="green">Posted as {fixture.user}</Status>
                  {" · "}
                  <a href="#" onClick={(e) => e.preventDefault()}>View on GitHub</a>
                </span>
                <span className="spacer" />
                <button className="btn primary" type="button" disabled>
                  Posted
                </button>
              </>
            ) : (
              <>
                <span className="muted sm">
                  {/* keyed on the count so the A2 lane's roll animation restarts on every change */}
                  <b key={count} className="stage-count" data-stage-count={count}>
                    {count}
                  </b>{" "}
                  staged · posts as plain comments
                </span>
                <span className="spacer" />
                <label className="rqtoggle">
                  <input type="checkbox" checked={false} onChange={() => undefined} /> Request changes instead
                </label>
                <button className="btn primary" type="button" disabled={count === 0} onClick={(e) => e.preventDefault()}>
                  Post selected to GitHub
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="prhead">
      <h1 className="prtitle">
        <span className="repo">{fixture.repo}</span>
        <span className="num">#{fixture.pr}</span> {fixture.title}
      </h1>
    </div>
  );
}

function Requested() {
  return (
    <div className="prpage" data-stage="requested">
      <Header />
      <div className="statusline">
        <Status kind="new" />
        <span className="meta-t">
          {fixture.author} asked for your review · +{fixture.additions} −{fixture.deletions} · {fixture.changedFiles} files
        </span>
      </div>
      <div className="practions">
        <button className="btn primary" type="button" onClick={(e) => e.preventDefault()}>
          Review this PR
        </button>
        <span className="hint">Runs on your Claude plan. Nothing reaches GitHub.</span>
      </div>
    </div>
  );
}

// PrPage's verdict() for this review: one should-fix, no blockers.
function Verdict() {
  const fix = fixture.review.findings.filter((f) => f.severity === "should-fix").length;
  return (
    <>
      <div className="verdict">
        <div className="verdict-main">
          <div className="verdict-t">
            <Status tone={fix ? "amber" : "green"}>
              {fix ? `${fix} thing${fix > 1 ? "s" : ""} to fix before merge` : "Looks good — nothing to fix"}
            </Status>
          </div>
          <div className="verdict-sub">{fixture.review.explainer}</div>
        </div>
      </div>
      <ul className="keypoints">
        {fixture.review.keyPoints.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
    </>
  );
}

function Approved() {
  return (
    <div className="approve-verdict">
      <Status tone="green">Approved by {fixture.user} · LGTM — no blockers</Status>
    </div>
  );
}

function FindingCard({ f, checked, disabled, onToggle }: { f: Finding; checked: boolean; disabled?: boolean; onToggle: () => void }) {
  const loc = `${f.path}:${f.line}`;
  return (
    <div className={"finding" + (checked ? " is-staged" : "")} data-staged={checked ? "1" : undefined}>
      <div className="fhead">
        <input
          type="checkbox"
          className="fsel"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Stage this ${wordOf(f.severity)} finding`}
        />
        <Status kind={f.severity} />
        {f.anchorable === false && (
          <Status tone="graphite" title="This line is not part of the PR's diff, so it goes into the review body.">
            In summary
          </Status>
        )}
      </div>
      <div className="fmain">
        <div className="ftitle">{f.title}</div>
        <div className="fpath">
          <code>{loc}</code>
          <button type="button" className="copybtn" aria-label={`Copy ${loc}`} onClick={(e) => e.preventDefault()}>
            Copy
          </button>
        </div>
        {f.impact && (
          <div className="fimpact">
            <span className="fimpact-l">Why it matters</span>
            {f.impact}
          </div>
        )}
        <details className="explain">
          <summary>Explain simply</summary>
        </details>
        <div className="factions">
          <button type="button" className="fbtn" disabled={disabled}>
            Edit comment
          </button>
        </div>
      </div>
    </div>
  );
}
