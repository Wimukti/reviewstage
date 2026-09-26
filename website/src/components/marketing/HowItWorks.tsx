// "How it works": a numbered strip of five stops, each the app's own component in that state
// (design §7), rendered as a tablist. Clicks and arrow keys move the selection; the panels sit
// in one grid cell and cross-fade over --dur-slow (design §5). The app's Help menu links to
// #how-it-works, so the id is part of the contract.
import { useId, useRef, useState, type KeyboardEvent } from "react";
import StageIsland from "../stage/StageIsland";
import { FrameBar } from "./FrameBar";

const STOPS = [
  { key: "requested", label: "Requested", line: "A review request lands in your queue. Nothing runs until you click." },
  { key: "drafting", label: "Drafting", line: "The agent reads the real diff, on your own Claude plan." },
  { key: "staged", label: "Staged", line: "Findings wait privately. Tick the ones worth your name; edit any." },
  { key: "posted", label: "Posted", line: "One plain comment review goes out, under your GitHub identity." },
  { key: "approved", label: "Approved", line: "Approval is its own click. It never requests changes." },
] as const;

type Key = (typeof STOPS)[number]["key"];

function Panel({ k }: { k: Key }) {
  if (k === "requested") return <StageIsland scene="queue" state="new" label="The queue: one new review request" />;
  if (k === "drafting") return <StageIsland scene="progress" cur={2} label="The progress card: reviewing the diff" />;
  return <StageIsland scene="scene" state={k} label={`The PR page in its ${k} state`} />;
}

export default function HowItWorks({ initial = 2 }: { initial?: number }) {
  const [sel, setSel] = useState(initial);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const go = (i: number) => {
    const n = (i + STOPS.length) % STOPS.length;
    setSel(n);
    tabs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(STOPS.length - 1); }
  };
  return (
    <div className="how" data-how-it-works>
      <div className="strip" role="tablist" aria-label="How it works">
        {STOPS.map((s, i) => (
          <button
            key={s.key}
            ref={(el) => { tabs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${id}-tab-${s.key}`}
            aria-selected={i === sel}
            aria-controls={`${id}-panel-${s.key}`}
            tabIndex={i === sel ? 0 : -1}
            className="stop"
            onClick={() => setSel(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="stop-n">{String(i + 1).padStart(2, "0")}</span>
            <span className="stop-l">{s.label}</span>
            <span className="stop-line">{s.line}</span>
          </button>
        ))}
      </div>
      <p className="stop-current" aria-hidden="true">{STOPS[sel].line}</p>
      <div className="stage-frame lift">
        <FrameBar title={STOPS[sel].label.toLowerCase()} />
        <div className="stage-panels">
          {STOPS.map((s, i) => (
            <div
              key={s.key}
              role="tabpanel"
              id={`${id}-panel-${s.key}`}
              aria-labelledby={`${id}-tab-${s.key}`}
              aria-hidden={i !== sel}
              className={"stage-panel" + (i === sel ? " is-on" : "")}
              data-stop={s.key}
            >
              <Panel k={s.key} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
