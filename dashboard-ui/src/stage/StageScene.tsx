// The PR page's stage — verdict, findings and the commit bar — as a presentational component
// the site renders inside a shadow root (design.md §7). Its data is fixture.json (PR #38849
// from the e2e fixture, written by scripts/stage-fixture.mjs); its markup and class names are
// the PR page's own — the components in src/ReviewParts.tsx (FindingCard, CommitBar, Verdict,
// StatusLineView) with no-op handlers — so when those pieces are restyled the scene inherits
// the change. Nothing here talks to an API.
//
// `state` picks a still; `play` runs the scripted sequence once from "drafting" to the armed
// stage (~6 s) and stops. Under prefers-reduced-motion it jumps straight to the end. Bump
// `playKey` to replay.
import { useEffect, useMemo, useState } from "react";
import fixture from "./fixture.json";
import { CommitBar, FindingCard, KeyPoints, StatusLineView, Verdict } from "../ReviewParts";
import { PageHeader, RepoPill, StatusBadge, toneOf, wordOf } from "../ui";
import { StageProgress } from "./StageProgress";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

export type SceneState = "requested" | "drafting" | "staged" | "posted" | "approved";

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
      <Verdict_ />
      <div data-testid="post-panel">
        {visible.map((f) => (
          <FindingCard
            key={f.i}
            f={{ ...f, structured: true }}
            checked={posted ? false : !!staged[f.i]}
            disabled={posted}
            onToggle={() => setManual((m) => ({ ...m, [f.i]: !staged[f.i] }))}
          />
        ))}
        {state === "approved" && <Approved />}
        <CommitBar
          staged={count}
          inline={findings.filter((f) => staged[f.i] && f.anchorable).length}
          summary={findings.filter((f) => staged[f.i] && f.anchorable === false).length}
          posted={posted}
          postedAs={fixture.user}
          ghUrl="#"
          onPost={() => undefined}
          requestChanges={false}
          armed={armed}
        />
      </div>
    </div>
  );
}

// The PR page's header: the repository as a pill on the breadcrumb line, the number and title
// in the page header.
function Header() {
  return (
    <>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Queue</span>
        <span aria-hidden="true">/</span>
        <RepoPill repo={fixture.repo} />
        <span aria-hidden="true">/</span>
        <span className="text-foreground">#{fixture.pr}</span>
      </div>
      <PageHeader
        className="mb-3"
        title={
          <>
            <span className="text-primary">#{fixture.pr}</span> {fixture.title}
          </>
        }
      />
    </>
  );
}

function Requested() {
  return (
    <div className="prpage" data-stage="requested">
      <Header />
      <StatusLineView
        items={[{ key: "state", tone: toneOf("new"), word: wordOf("new") }]}
        meta={[`${fixture.author} asked for your review · +${fixture.additions} −${fixture.deletions} · ${fixture.changedFiles} files`]}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={(e) => e.preventDefault()}>
          <Play aria-hidden="true" />
          Review this PR
        </Button>
        <span className="text-xs text-muted-foreground">Runs on your Claude plan. Nothing reaches GitHub.</span>
      </div>
    </div>
  );
}

// PrPage's verdict() for this review: one should-fix, no blockers.
function Verdict_() {
  const fix = fixture.review.findings.filter((f) => f.severity === "should-fix").length;
  return (
    <>
      <Verdict
        tone={fix ? "amber" : "green"}
        text={fix ? `${fix} thing${fix > 1 ? "s" : ""} to fix before merge` : "Looks good — nothing to fix"}
        chips={fix ? [{ kind: "should-fix", n: fix }, { kind: "nit", n: fixture.review.findings.length - fix }] : []}
      />
      <KeyPoints points={fixture.review.keyPoints} />
    </>
  );
}

function Approved() {
  return (
    <div className="mt-3">
      <StatusBadge kind="approved">Approved by {fixture.user} · LGTM — no blockers</StatusBadge>
    </div>
  );
}
