// "How it works": a numbered strip of five stops, each the app's own component in that state
// (design §7), as the app's Tabs (line variant, as the queue's views). Radix gives the tablist
// its roles, arrow keys and Home/End; the five panels stay mounted in one grid cell and
// cross-fade over --dur-slow (design §5), so each island hydrates once. The app's Help menu
// links to #how-it-works, so the id is part of the contract.
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@app/components/ui/tabs";
import StageIsland from "../stage/StageIsland";
import { FrameBar } from "./FrameBar";

const STOPS = [
  { key: "requested", kind: "new", label: "Requested", line: "A review request lands in your queue. Nothing runs until you click." },
  { key: "drafting", kind: "reviewing", label: "Drafting", line: "The agent reads the real diff, on your own Claude plan." },
  { key: "staged", kind: "staged", label: "Staged", line: "Findings wait privately. Tick the ones worth your name; edit any." },
  { key: "posted", kind: "posted", label: "Posted", line: "One plain comment review goes out, under your GitHub identity." },
  { key: "approved", kind: "approved", label: "Approved", line: "Approval is its own click. It never requests changes." },
] as const;

type Key = (typeof STOPS)[number]["key"];

function Panel({ k }: { k: Key }) {
  if (k === "requested") return <StageIsland scene="queue" state="new" label="The queue: one new review request" />;
  if (k === "drafting") return <StageIsland scene="progress" cur={2} label="The progress card: reviewing the diff" />;
  return <StageIsland scene="scene" state={k} label={`The PR page in its ${k} state`} />;
}

export default function HowItWorks({ initial = 2 }: { initial?: number }) {
  const [sel, setSel] = useState<Key>(STOPS[initial]?.key ?? "staged");
  const cur = STOPS.find((s) => s.key === sel) ?? STOPS[2];
  return (
    <Tabs value={sel} onValueChange={(v) => setSel(v as Key)} className="how gap-5" data-how-it-works>
      <TabsList variant="line" className="strip h-auto! w-full items-stretch justify-start gap-x-0.5 gap-y-1 p-0" aria-label="How it works">
        {STOPS.map((s, i) => (
          <TabsTrigger
            key={s.key}
            value={s.key}
            data-stop={s.key}
            className="stop h-auto min-h-11 flex-1 flex-col items-start gap-1 whitespace-normal px-3 py-3 text-left max-md:items-center max-md:px-1 max-md:py-2 max-md:text-center"
          >
            <span className="text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-sm font-medium max-md:text-xs">{s.label}</span>
            <span className="text-xs font-normal text-muted-foreground max-md:hidden">{s.line}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <p className="m-0 hidden text-sm text-muted-foreground max-md:block" aria-hidden="true">{cur.line}</p>
      <div className="stage-frame lift grid content-start overflow-hidden rounded-lg bg-card shadow-sm">
        <FrameBar kind={cur.kind === "staged" ? "" : cur.kind} tone={cur.kind === "staged" ? "blue" : undefined} title={cur.label} />
        <div className="stage-panels bg-background">
          {STOPS.map((s) => (
            <TabsContent key={s.key} value={s.key} forceMount className="stage-panel" data-stop={s.key}>
              <Panel k={s.key} />
            </TabsContent>
          ))}
        </div>
      </div>
    </Tabs>
  );
}
