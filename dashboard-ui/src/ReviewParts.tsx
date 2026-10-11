// The PR page's presentational pieces — the finding card, the commit bar, the assessment head,
// the status line, the run progress — as components that take props and call no API. PrPage
// wires them to the server; src/stage/StageScene renders the same components from fixture
// JSON for the website's islands (design.md §7), so a restyle here reaches both by
// construction. Nothing in this file may import api.ts, the router, or the markdown stack:
// the site bundles whatever this pulls in.
//
// Built on the system (rebuild-on-a-system/design.md): shadcn components and Tailwind
// utilities. `.finding`, `.fhead`, `.commit-bar`, `.has-staged`, `.is-staged`, `.stage-count`
// are bare class hooks — the two stage-light rules in review.css and the specs target them;
// nothing else styles them.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleDot,
  CircleHelp,
  Copy,
  ExternalLink,
  FileCode2,
  GraduationCap,
  ListChecks,
  Loader2,
  Pencil,
  Route,
  Search,
  Send,
  ShieldCheck,
  ShieldQuestionMark,
  Sparkles,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { REASON_LABELS, REASONS, type Badge as BadgeData, type Checked, type Evidence, type GuideData, type Reason, type ReadPlanRow, type Snippet, type Where } from "./api";
import { StatusBadge, iconOf, toneOf, wordOf, type Tone } from "./ui";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

// What a card needs to know about a finding. api.ts's Finding satisfies it; the stage fixture
// supplies the subset it has.
export interface FindingView {
  i: number;
  severity: string;
  path: string;
  line: number | string;
  title?: string;
  impact?: string;
  structured?: boolean;
  // The verification contract (p0-proof/lane3-verify.md); both absent on older servers and in
  // reviews from before it, and the card then omits them. A string, not the union api.ts
  // narrows to, because the stage fixture is plain JSON.
  confidence?: string | null;
  howToVerify?: string;
  // Where / what to check / expected / actual, the cited diff lines and the evidence verdict
  // (trust-and-plain §1.3–1.4). All optional: an older review omits every row.
  where?: Where | null;
  whatToCheck?: string;
  expected?: string;
  actual?: string;
  snippet?: Snippet | null;
  evidence?: Evidence | null;
  // Part 2: the disproof verdict and the earned-confidence badge. Both optional; an older
  // server sends neither and the head shows the self-report alone, as it did.
  checked?: Checked | null;
  badge?: BadgeData | null;
  thread?: string | null;
  criticalPath?: string;
  // Tri-state: true inline, false into the review body, null/undefined genuinely unknown.
  anchorable?: boolean | null;
  agreement?: { confirmed: boolean; n: number; by: string[]; differ: string } | null;
  taught?: boolean;
}

export const OFFDIFF_HINT =
  "This line is not part of the PR's diff, so GitHub cannot take an inline comment. " +
  "It will appear in the review body with a link to the line.";

export const UNKNOWN_HINT =
  "GitHub would not say which lines this PR touches, so where this comment lands is unknown. " +
  "It goes inline if the line is in the diff, and into the review body if it is not.";

// Where a finding will land. `undefined`/`null` is a real third answer: the server could not ask
// GitHub, and promising "inline" on that is the post bar telling the reviewer something it does
// not know.
export type Placement = "inline" | "summary" | "unknown";
export const placementOf = (f: FindingView): Placement =>
  f.anchorable === true ? "inline" : f.anchorable === false ? "summary" : "unknown";

// The severity tone as the card's one permitted border (3px, on the left) and as ink.
const TONE_BORDER: Record<Tone, string> = {
  blue: "border-l-blue",
  amber: "border-l-amber",
  red: "border-l-red",
  green: "border-l-green",
  graphite: "border-l-graphite",
};
const TONE_TEXT: Record<Tone, string> = {
  blue: "text-blue",
  amber: "text-amber",
  red: "text-red",
  green: "text-green",
  graphite: "text-muted-foreground",
};

// The path is content a reviewer pastes into an editor, so it is shown whole and selectable in
// one click; the button is for the case where select-all is out of reach (a phone). Sans, in a
// pill: a path is metadata here, not code.
export function CopyPath({ loc }: { loc: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-0.5" data-testid="finding-path">
      <Badge
        variant="outline"
        className="min-w-0 max-w-full select-all whitespace-normal font-normal text-muted-foreground [overflow-wrap:anywhere]"
      >
        <FileCode2 aria-hidden="true" className="shrink-0" />
        <span>{loc}</span>
      </Badge>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        aria-label={`Copy ${loc}`}
        title={done ? "Copied" : "Copy path"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(loc);
            setDone(true);
          } catch {
            /* the text stays selectable by hand */
          }
        }}
      >
        {done ? <Check aria-hidden="true" className="text-green" /> : <Copy aria-hidden="true" />}
      </Button>
    </span>
  );
}

export interface FindingCardProps {
  f: FindingView;
  checked: boolean;
  onToggle: () => void;
  // Posted: the checkbox and the comment toggle are inert.
  disabled?: boolean;
  // Resolves to the rendered "explain simply" content. Absent, the disclosure opens to nothing.
  explain?: () => Promise<ReactNode>;
  // The comment editor, shown under "Edit comment" (or at once for an unstructured finding).
  editor?: ReactNode;
  // Teach the skill from this finding; absent, the button is not rendered.
  teach?: { panel: (onTaught: () => void) => ReactNode };
  // Why the reviewer dropped it (lane2-reasons.md). `askReason` opens the chip row under the
  // card for a moment after an untick; `reason` is the answer, shown as one chip while the card
  // stays unticked. Both are PrPage's state; a card never asks on its own.
  reason?: Reason;
  askReason?: boolean;
  onReason?: (r: Reason | null) => void;
  onReasonDismiss?: () => void;
}

// The chip row that asks why a finding was dropped — purely presentational, shared by the desk
// card and the phone's bottom bar. Chips are buttons in a group; Escape dismisses the row; a
// chosen reason collapses the row to one chip with a ✕ to clear it. 44 px targets on touch.
export function ReasonChips({
  value,
  onPick,
  onClose,
  size = "sm",
  className,
}: {
  value?: Reason;
  onPick: (r: Reason | null) => void;
  onClose?: () => void;
  size?: "sm" | "lg";
  className?: string;
}) {
  const chip = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    size === "lg" ? "min-h-[44px] px-3.5 text-[14px]" : "h-6",
  );
  if (value) {
    return (
      <div className={cn("flex flex-wrap items-center gap-1.5", className)} data-testid="reason-picked" data-reason={value}>
        <span className={cn(chip, "border-foreground/30 text-foreground")}>
          Dropped · {REASON_LABELS[value].toLowerCase()}
          <button
            type="button"
            aria-label="Clear the reason"
            data-testid="reason-clear"
            className="-mr-1 ml-0.5 inline-flex size-5 items-center justify-center rounded-full hover:bg-accent"
            onClick={() => onPick(null)}
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-label="Why did you drop this finding?"
      data-testid="reason-row"
      className={cn("flex items-center gap-1.5", size === "lg" ? "overflow-x-auto [scrollbar-width:none]" : "flex-wrap", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onClose) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <span className={cn("shrink-0 text-xs text-muted-foreground", size === "lg" && "text-[14px]")}>Why?</span>
      {REASONS.map((r) => (
        <button key={r} type="button" className={chip} data-testid="reason-chip" data-reason={r} aria-pressed={false} onClick={() => onPick(r)}>
          {REASON_LABELS[r]}
        </button>
      ))}
      {onClose && (
        <button
          type="button"
          aria-label="Skip"
          data-testid="reason-skip"
          className={cn("inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground", size === "lg" ? "size-11" : "size-6")}
          onClick={onClose}
        >
          <X aria-hidden="true" className={size === "lg" ? "size-4" : "size-3.5"} />
        </button>
      )}
    </div>
  );
}

// "Explain simply": fetched once, on the first open. The desk card and the phone card share it.
export function useExplain(explain?: () => Promise<ReactNode>) {
  const [exp, setExp] = useState<ReactNode>(null);
  const [expOpen, setExpOpen] = useState(false);
  const [expLoading, setExpLoading] = useState(false);
  const [expErr, setExpErr] = useState("");
  const runExplain = async () => {
    if (!explain || expLoading || exp) return;
    setExpErr("");
    setExpLoading(true);
    try {
      setExp(await explain());
    } catch {
      setExpErr("Couldn't explain this one — try again.");
    } finally {
      setExpLoading(false);
    }
  };
  return { exp, expOpen, setExpOpen, expLoading, expErr, runExplain };
}

// The explanation's disclosure body: a skeleton while it loads, the error with a retry, the box.
export function ExplainBody({ x }: { x: ReturnType<typeof useExplain> }) {
  const { exp, expOpen, setExpOpen, expLoading, expErr, runExplain } = x;
  return (
    <Collapsible open={expOpen} onOpenChange={setExpOpen}>
      <CollapsibleContent>
        {expLoading && (
          <div className="flex flex-col gap-2 py-1" aria-busy="true" data-testid="explain-loading">
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        )}
        {expErr && (
          <p className="m-0 text-sm text-red">
            {expErr}{" "}
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={runExplain}>
              Try again
            </Button>
          </p>
        )}
        {exp && (
          <div className="rounded-md bg-accent p-3 text-sm leading-relaxed" data-testid="explain-box">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles aria-hidden="true" className="size-3.5 text-blue" />
              In plain words · how to verify
            </div>
            {exp}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// The verification contract (p0-proof/lane3-verify.md): every card states the run's confidence
// and, when the run gave one, a single line on how to confirm the finding. Both are omitted
// outright when absent — an older run or a custom skill renders exactly the card it always did.
export function ConfidenceBadge({ confidence }: { confidence?: FindingView["confidence"] }) {
  if (!confidence) return null;
  return (
    <StatusBadge
      tone="graphite"
      icon={null}
      title="How sure the run is that this finding is real"
      data-testid="confidence"
      data-confidence={confidence}
      className="text-[11px] font-normal"
    >
      {confidence} confidence
    </StatusBadge>
  );
}

// Earned confidence (trust-and-plain Part 2): three levels — Checked / Likely / Maybe — from
// the evidence check, the disproof pass and the calibration readout, never from the model's own
// estimate. The chip carries the level; the reason line under the card's rows says why.
const BADGE_TONE: Record<string, Tone> = { checked: "green", likely: "blue", maybe: "amber" };
const BADGE_ICON: Record<string, LucideIcon> = { checked: ShieldCheck, likely: Circle, maybe: ShieldQuestionMark };

export function TrustBadge({ badge, className }: { badge?: BadgeData | null; className?: string }) {
  if (!badge) return null;
  return (
    <StatusBadge
      tone={BADGE_TONE[badge.level] ?? "graphite"}
      icon={BADGE_ICON[badge.level] ?? null}
      title={badge.reason}
      data-testid="trust"
      data-level={badge.level}
      className={cn("text-[11px]", className)}
    >
      {badge.label}
    </StatusBadge>
  );
}

// The badge's reason, one line: "Checked: the cited lines exist, a second pass could not
// disprove it, reviewers kept 85.0% of findings like this here."
export function TrustLine({ badge, className }: { badge?: BadgeData | null; className?: string }) {
  if (!badge) return null;
  const Glyph = BADGE_ICON[badge.level] ?? Circle;
  const tone = badge.level === "checked" ? "text-green" : badge.level === "maybe" ? "text-amber" : "text-muted-foreground";
  const [head, ...rest] = badge.reason.split(": ");
  return (
    <p
      className={cn("m-0 flex items-baseline gap-1.5 leading-relaxed text-muted-foreground", className)}
      data-testid="trust-line"
      data-level={badge.level}
    >
      <Glyph aria-hidden="true" className={cn("relative top-[2px] size-3.5 shrink-0", tone)} />
      <span className={cn("shrink-0 font-mono text-xs font-medium uppercase tracking-wide", tone)}>{head}</span>
      <span className="min-w-0">{rest.join(": ")}</span>
    </p>
  );
}

// The disproof pass's own sentence (§2.1), at the position lane 1 reserved under Evidence:
// "Checked: stands — the second pass found no handling of a 2xx reset." Absent when the pass
// did not run for this finding.
const VERDICT_TONE: Record<string, string> = { stands: "text-green", weakened: "text-amber", refuted: "text-amber" };

export function CheckedLine({ checked, className }: { checked?: Checked | null; className?: string }) {
  if (!checked) return null;
  const Glyph = checked.verdict === "stands" ? CircleCheck : TriangleAlert;
  return (
    <p
      className={cn("m-0 flex items-baseline gap-1.5 leading-relaxed text-muted-foreground", className)}
      data-testid="checked"
      data-verdict={checked.verdict}
    >
      <Glyph aria-hidden="true" className={cn("relative top-[2px] size-3.5 shrink-0", VERDICT_TONE[checked.verdict])} />
      <span className={cn("shrink-0 font-mono text-xs font-medium uppercase tracking-wide", VERDICT_TONE[checked.verdict])}>
        Checked: {checked.verdict}{" "}
      </span>
      {checked.reason && <span className="min-w-0">— {checked.reason}</span>}
    </p>
  );
}

// The model's own estimate (design §2.3): still requested, never shown alone. It sits under
// "More" beside the raw comment once a badge exists; with no badge (an older server) the head
// shows it as before.
export function SelfReport({ confidence, className }: { confidence?: FindingView["confidence"]; className?: string }) {
  if (!confidence) return null;
  return (
    <p className={cn("m-0 flex flex-wrap items-center gap-1.5 text-muted-foreground", className)} data-testid="self-report">
      <span className="font-mono text-xs font-medium uppercase tracking-wide">The run's own estimate</span>
      <ConfidenceBadge confidence={confidence} />
    </p>
  );
}

export function HowToVerify({ text, className }: { text?: string; className?: string }) {
  if (!text) return null;
  return (
    <p className={cn("m-0 flex items-baseline gap-1.5 leading-relaxed text-muted-foreground", className)} data-testid="how-to-verify">
      <ListChecks aria-hidden="true" className="relative top-[2px] size-3.5 shrink-0" />
      <span className="shrink-0 font-mono text-xs font-medium uppercase tracking-wide">How to verify</span>
      <span className="min-w-0">{text}</span>
    </p>
  );
}

// `path:start-end` for a finding with a cited range, `path:line` otherwise.
export function locOf(f: Pick<FindingView, "path" | "line" | "where">): string {
  const w = f.where;
  if (w && w.end > w.start) return `${f.path}:${w.start}-${w.end}`;
  return `${f.path}:${f.line}`;
}

// The cited diff lines (§1.3 row 2): 8–12 lines of the hunk around the cited range, the changed
// lines highlighted, the cited ones marked. Mono, numbered on the new side; a removed line
// shows with no number. The reviewer reads the evidence without opening the diff.
export function DiffSnippet({ snippet, className }: { snippet?: Snippet | null; className?: string }) {
  if (!snippet || !snippet.lines.length) return null;
  return (
    <pre
      className={cn("m-0 max-w-full overflow-x-auto rounded-md border border-border bg-background/60 py-1.5 font-mono text-[12px] leading-[1.45]", className)}
      data-testid="diff-snippet"
      data-start={snippet.start}
      data-end={snippet.end}
      aria-label={`Diff lines ${snippet.start} to ${snippet.end}`}
    >
      {snippet.lines.map((l, i) => (
        <span
          key={i}
          className={cn(
            "flex min-w-max gap-2 px-2",
            l.kind === "add" && "bg-green/12",
            l.kind === "del" && "bg-red/10 text-muted-foreground line-through decoration-muted-foreground/40",
            l.cited && "border-l-2 border-l-primary bg-primary/10",
            !l.cited && "border-l-2 border-l-transparent",
          )}
          data-kind={l.kind}
          data-cited={l.cited ? "1" : undefined}
        >
          <span className="w-8 shrink-0 select-none text-right text-muted-foreground/70 tabular-nums">{l.n ?? ""}</span>
          <span className="w-3 shrink-0 select-none text-muted-foreground/70">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
          <span className="whitespace-pre">{l.text || " "}</span>
        </span>
      ))}
    </pre>
  );
}

// Row 2 of the card: the location (copyable) and the cited lines under it.
export function WhereRow({ f, className }: { f: FindingView; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="where">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">Where</span>
        <CopyPath loc={locOf(f)} />
      </div>
      <DiffSnippet snippet={f.snippet} />
    </div>
  );
}

// Row 3: the one imperative sentence (§1.3). Falls back to the older `how_to_verify` line so a
// review from before the field still has one row that tells the reviewer what to do.
export function WhatToCheck({ text, className }: { text?: string; className?: string }) {
  if (!text) return null;
  return (
    <p className={cn("m-0 flex items-baseline gap-1.5 leading-relaxed text-foreground", className)} data-testid="what-to-check">
      <Search aria-hidden="true" className="relative top-[2px] size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">What to check</span>
      <span className="min-w-0">{text}</span>
    </p>
  );
}

// Row 4: expected against actual, two short lines. Either alone still renders.
export function Contrast({ expected, actual, className }: { expected?: string; actual?: string; className?: string }) {
  if (!expected && !actual) return null;
  return (
    <dl className={cn("m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 leading-relaxed", className)} data-testid="contrast">
      {expected && (
        <>
          <dt className="font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">Expected</dt>
          <dd className="m-0 min-w-0" data-testid="expected">{expected}</dd>
        </>
      )}
      {actual && (
        <>
          <dt className="font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual</dt>
          <dd className="m-0 min-w-0" data-testid="actual">{actual}</dd>
        </>
      )}
    </dl>
  );
}

// Row 6: the deterministic evidence check (§1.4) in one line. PASS reads green, WARN amber;
// the line is the plain reason. Absent when the diff could not be checked.
export function EvidenceLine({ evidence, className }: { evidence?: Evidence | null; className?: string }) {
  if (!evidence) return null;
  const warn = evidence.status === "warn";
  const Glyph = warn ? TriangleAlert : CircleCheck;
  return (
    <p
      className={cn("m-0 flex items-baseline gap-1.5 leading-relaxed text-muted-foreground", className)}
      data-testid="evidence"
      data-status={evidence.status}
      data-flags={(evidence.flags ?? []).join(" ") || undefined}
    >
      <Glyph aria-hidden="true" className={cn("relative top-[2px] size-3.5 shrink-0", warn ? "text-amber" : "text-green")} />
      <span className={cn("shrink-0 font-mono text-xs font-medium uppercase tracking-wide", warn ? "text-amber" : "text-green")}>
        Evidence{warn ? " · check" : ""}
      </span>
      <span className="min-w-0">{evidence.line}</span>
    </p>
  );
}

// ---- the reading guide ------------------------------------------------------------------------

const RISK_TONE: Record<string, Tone> = { breaks: "red", "can break": "amber", "safe-looking": "green", unclear: "graphite" };

export interface ReadingGuideProps {
  guide: GuideData;
  // Open by default on first view; the caller may remember a collapse.
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  // A row click goes to the hunk: the caller resolves path + lines to a card or a GitHub link.
  onJump?: (row: ReadPlanRow) => void;
  className?: string;
}

// The Reading guide card (§1.2): what this PR does · why · read in this order · not reviewed.
// Sits above the findings on the desk and is the first card on the phone. Collapsible; the
// header stays so the risk word is always one glance away.
export function ReadingGuide({ guide, defaultOpen = true, onOpenChange, onJump, className }: ReadingGuideProps) {
  const [open, setOpen] = useState(defaultOpen);
  const has = guide.does || guide.why || guide.readPlan.length > 0 || guide.notCovered.length > 0 || guide.risk;
  if (!has) return null;
  const risk = guide.risk ? RISK_TONE[guide.risk] ?? "graphite" : null;
  return (
    <Collapsible
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        onOpenChange?.(v);
      }}
      className={className}
    >
      <Card data-testid="reading-guide" data-open={open ? "1" : "0"} className="mb-3 gap-0 rounded-lg border-0 py-0 shadow-sm">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-4 py-2.5 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[899px]:min-h-[44px]"
            aria-expanded={open}
            data-testid="guide-toggle"
          >
            <BookOpen aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">Reading guide</span>
            {guide.risk && risk && (
              <StatusBadge tone={risk} icon={risk === "green" ? CircleCheck : risk === "graphite" ? CircleHelp : TriangleAlert} data-testid="guide-risk" data-risk={guide.risk} title="The run's read of this PR's risk">
                {guide.risk}
              </StatusBadge>
            )}
            <span className="min-w-0 flex-1" />
            {!open && guide.does && <span className="min-w-0 flex-1 basis-full truncate text-sm text-muted-foreground min-[900px]:basis-auto" data-testid="guide-peek">{guide.does}</span>}
            <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 px-4 pb-3.5 pt-0.5 text-sm leading-relaxed">
            {guide.does && (
              <p className="m-0 max-w-[72ch]" data-testid="guide-does">
                <span className="mr-1.5 font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">What this PR does</span>
                {guide.does}
              </p>
            )}
            {guide.why && (
              <p className="m-0 max-w-[72ch] text-muted-foreground" data-testid="guide-why">
                <span className="mr-1.5 font-mono text-xs font-medium uppercase tracking-wide">Why</span>
                {guide.why}
              </p>
            )}
            {guide.readPlan.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">Read in this order</span>
                <ol className="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="guide-plan">
                  {guide.readPlan.map((r, i) => {
                    const loc = r.lines ? `${r.path}:${r.lines}` : r.path;
                    const inner = (
                      <>
                        <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium [overflow-wrap:anywhere]" data-testid="guide-row-loc">{loc}</span>
                          {r.why && <span className="text-muted-foreground"> — {r.why}</span>}
                        </span>
                      </>
                    );
                    return (
                      <li key={i} className="flex" data-testid="guide-row" data-path={r.path} data-lines={r.lines ?? undefined}>
                        {onJump ? (
                          <button
                            type="button"
                            className="-mx-1.5 flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[899px]:min-h-[44px]"
                            onClick={() => onJump(r)}
                            title="Go to this hunk"
                          >
                            {inner}
                          </button>
                        ) : (
                          <span className="flex min-w-0 flex-1 items-baseline gap-2 py-1">{inner}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
            {guide.notCovered.length > 0 && (
              <p className="m-0 text-muted-foreground" data-testid="guide-not-covered">
                <span className="mr-1.5 font-mono text-xs font-medium uppercase tracking-wide">Not reviewed</span>
                {guide.notCovered.join(" · ")}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function FindingCard({ f, checked, onToggle, disabled, explain, editor, teach, reason, askReason, onReason, onReasonDismiss }: FindingCardProps) {
  const x = useExplain(explain);
  const { expOpen, setExpOpen, runExplain } = x;
  // Unstructured findings (older reviews) show the comment inline; structured ones tuck it away.
  const [showDetail, setShowDetail] = useState(!f.structured);
  const [showTeach, setShowTeach] = useState(false);
  const [taught, setTaught] = useState(!!f.taught);
  const place = placementOf(f);
  const tone = toneOf(f.severity);
  // The footer actions sit in graphite until the card is hovered or focused (or one of them is
  // open), then take the full ink; they never collapse, so the card keeps its shape.
  const anyOpen = expOpen || (f.structured && showDetail) || showTeach;
  // One "what to check" row: the §1.3 sentence, else the older how_to_verify line. When both
  // exist the verify line moves under "More" with the body.
  const check = f.whatToCheck || f.howToVerify;
  const verifyUnderMore = !!(f.whatToCheck && f.howToVerify);
  return (
    <Card
      data-testid="finding"
      data-finding={f.i}
      data-staged={checked ? "1" : undefined}
      className={cn(
        "finding",
        checked && "is-staged",
        "group relative mt-3 gap-0 overflow-hidden rounded-lg border-0 border-l-[3px] py-0 shadow-sm",
        TONE_BORDER[tone],
        checked && "ring-1 ring-primary/40",
      )}
    >
      <div className="fhead flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5 pl-3.5">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={() => onToggle()}
          aria-label={`Stage this ${wordOf(f.severity)} finding`}
          data-testid="finding-select"
          className="size-[18px] max-[899px]:size-5"
        />
        <StatusBadge kind={f.severity} />
        {f.badge ? <TrustBadge badge={f.badge} /> : <ConfidenceBadge confidence={f.confidence} />}
        {place === "summary" && (
          <StatusBadge tone="graphite" icon={ExternalLink} title={OFFDIFF_HINT} data-testid="placement">
            In summary
          </StatusBadge>
        )}
        {place === "unknown" && (
          <StatusBadge tone="amber" icon={CircleHelp} title={UNKNOWN_HINT} data-testid="placement-unknown">
            Placement unknown
          </StatusBadge>
        )}
        <span className="min-w-0 flex-1 basis-[200px]" />
      </div>
      <div className="flex flex-col gap-2 px-4 pb-3 pl-[18px]">
        {!checked && onReason && (reason || askReason) && (
          <ReasonChips value={reason} onPick={onReason} onClose={onReasonDismiss} />
        )}
        {/* §1.3, top to bottom: title · where (+ cited lines) · what to check · expected/actual ·
            why it matters · evidence. Nothing else between them. */}
        {f.structured && <div className="text-sm font-medium leading-snug" data-testid="finding-title">{f.title}</div>}
        <WhereRow f={f} className="text-sm" />
        {f.whatToCheck ? (
          <WhatToCheck text={check} className="max-w-[72ch] text-sm" />
        ) : (
          <HowToVerify text={f.howToVerify} className="max-w-[72ch] text-sm" />
        )}
        <Contrast expected={f.expected} actual={f.actual} className="max-w-[72ch] text-sm" />
        {f.structured && f.impact && (
          <p className="m-0 max-w-[72ch] text-sm leading-relaxed text-muted-foreground" data-testid="why-it-matters">
            <span className="mr-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Why it matters</span>
            {f.impact}
          </p>
        )}
        <EvidenceLine evidence={f.evidence} className="max-w-[72ch] text-sm" />
        <TrustLine badge={f.badge} className="max-w-[72ch] text-sm" />
        <CheckedLine checked={f.checked} className="max-w-[72ch] text-sm" />
        {(f.criticalPath || f.agreement) && (
          <div className="flex flex-wrap gap-1.5">
            {f.criticalPath && (
              <StatusBadge tone="amber" icon={Route} title={`Concerns a profiled critical path: ${f.criticalPath}`}>
                critical path
              </StatusBadge>
            )}
            {f.agreement?.confirmed ? (
              <StatusBadge tone="green" icon={Users} title={`Also raised by ${f.agreement.by.join(", ")} (${f.agreement.differ})`}>
                {f.agreement.n} independent
              </StatusBadge>
            ) : f.agreement ? (
              <StatusBadge tone="graphite" icon={Users}>
                only your run
              </StatusBadge>
            ) : null}
          </div>
        )}
        {f.thread && <p className="m-0 text-xs text-muted-foreground">Reply to {f.thread}</p>}
        <div
          className={cn(
            "-ml-2 flex flex-wrap gap-0.5 pt-0.5 transition-opacity",
            !anyOpen && "min-[900px]:opacity-70 min-[900px]:group-hover:opacity-100 min-[900px]:group-focus-within:opacity-100",
          )}
          data-testid="finding-actions"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground max-[899px]:min-h-[44px]"
            aria-expanded={expOpen}
            data-testid="explain"
            onClick={() => {
              const next = !expOpen;
              setExpOpen(next);
              if (next) void runExplain();
            }}
          >
            <Sparkles aria-hidden="true" />
            Explain simply
          </Button>
          {f.structured && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground max-[899px]:min-h-[44px]"
              aria-expanded={showDetail}
              disabled={disabled}
              onClick={() => setShowDetail((v) => !v)}
            >
              <Pencil aria-hidden="true" />
              Edit comment
            </Button>
          )}
          {teach && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground max-[899px]:min-h-[44px]"
              aria-expanded={showTeach}
              disabled={taught}
              title={taught ? "This one is already a rule" : undefined}
              onClick={() => setShowTeach((v) => !v)}
              data-testid="teach-open"
            >
              <GraduationCap aria-hidden="true" />
              {taught ? "Already a rule" : "Teach the skill"}
            </Button>
          )}
        </div>
        <ExplainBody x={x} />
        {/* Deliberately not gated on `taught`: adding the rule sets it, and gating here would
            unmount the panel at the exact moment it has something to confirm. The button above
            is what stops a second visit. */}
        {showTeach && teach && teach.panel(() => setTaught(true))}
        {showDetail && verifyUnderMore && <HowToVerify text={f.howToVerify} className="max-w-[72ch] text-sm" />}
        {showDetail && f.badge && <SelfReport confidence={f.confidence} className="text-sm" />}
        {showDetail && editor}
      </div>
    </Card>
  );
}

// The one permitted orientation disclosure (design.md §6): a ? button that opens a popover.
// The sentence that used to sit under a title goes here.
export function About({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="About this page" className="shrink-0 text-muted-foreground">
          <CircleHelp aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-32px)] text-sm leading-relaxed" data-testid="about-box">
        {children}
      </PopoverContent>
    </Popover>
  );
}

// ---- the commit bar --------------------------------------------------------------------------

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The staged count in display type. When it changes the old value slides up and out while the
// new one slides in (design.md §5); the new value is keyed on itself so it is a fresh element
// every time. Under reduced motion the swap is plain: nothing outgoing is rendered. The
// keyframes live in review.css; `.stage-count.is-in/.is-out` are their hooks.
export function StageCount({ n }: { n: number }) {
  const last = useRef(n);
  const [out, setOut] = useState<number | null>(null);
  useEffect(() => {
    if (last.current === n) return;
    const prev = last.current;
    last.current = n;
    if (reducedMotion()) return;
    setOut(prev);
    const t = window.setTimeout(() => setOut(null), 320);
    return () => window.clearTimeout(t);
  }, [n]);
  const digit = "stage-count [grid-area:1/1] font-display text-2xl font-semibold leading-none tracking-tight text-foreground tabular-nums";
  return (
    <span className="stage-roll inline-grid overflow-hidden align-baseline leading-none">
      <b key={n} className={cn(digit, out !== null && "is-in")} data-stage-count={n}>
        {n}
      </b>
      {out !== null && (
        <b className={cn(digit, "is-out")} aria-hidden="true">
          {out}
        </b>
      )}
    </span>
  );
}

export interface CommitBarProps {
  staged: number;
  inline?: number;
  summary?: number;
  unknown?: number;
  dryRun?: boolean;
  posted?: boolean;
  // Who the review posted as, and where; `postedNow` marks a post made in this session.
  postedAs?: string;
  postedNow?: boolean;
  ghUrl?: string;
  onPost: () => void;
  requestChanges: boolean;
  onRequestChanges?: (v: boolean) => void;
  postLabel?: string;
  busy?: boolean;
  // The stored review has been replaced: the button is dead until a reload.
  stale?: boolean;
  // GitHub takes a review all-or-nothing; over this many findings the post is refused.
  maxPerPost?: number;
  // Kept for callers: the bar no longer animates on entrance (design §2, motion).
  entering?: boolean;
  // Something is on the stage and the button is live. Defaults to "count above zero and not
  // posted"; the site's scripted scene delays it until the sequence's last step.
  armed?: boolean;
}

export function CommitBar({
  staged,
  inline = 0,
  summary = 0,
  unknown = 0,
  dryRun = false,
  posted = false,
  postedAs = "",
  postedNow = false,
  ghUrl = "",
  onPost,
  requestChanges,
  onRequestChanges,
  postLabel = "Post selected to GitHub",
  busy = false,
  stale = false,
  maxPerPost = 0,
  entering = false,
  armed,
}: CommitBarProps) {
  const overCap = maxPerPost > 0 && staged > maxPerPost;
  const lit = armed ?? (!posted && staged > 0);
  return (
    <Card
      className={cn(
        "commit-bar",
        entering && "is-entering",
        posted && "is-posted",
        lit && "has-staged",
        "sticky bottom-0 z-20 mt-4 gap-0 rounded-lg border-0 bg-popover py-0 shadow-xl",
        "max-[899px]:fixed max-[899px]:inset-x-0 max-[899px]:bottom-[calc(49px+env(safe-area-inset-bottom,0px)-var(--ios-gap,0px))] max-[899px]:mt-0 max-[899px]:rounded-b-none",
      )}
      data-testid="commit-bar"
    >
      <div className="flex min-h-[56px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        {posted ? (
          <>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground" data-testid="commit-posted">
              <StatusBadge kind="posted">Posted as {postedAs}</StatusBadge>
              {postedNow && dryRun && <span>· dry run — nothing reached GitHub</span>}
              {!dryRun && ghUrl && (
                <a href={ghUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
                  · View on GitHub <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              )}
            </span>
            <Button type="button" disabled data-post>
              <Check aria-hidden="true" />
              Posted
            </Button>
          </>
        ) : (
          <>
            <span
              className="flex min-w-0 flex-1 basis-[240px] flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
              data-testid="commit-summary"
            >
              <span>
                <StageCount n={staged} /> staged
              </span>
              {(summary > 0 || unknown > 0) && (
                <>
                  <span>· {inline} inline</span>
                  {summary > 0 && <span title={OFFDIFF_HINT}>· {summary} in the summary</span>}
                  {unknown > 0 && (
                    <span title={UNKNOWN_HINT} data-testid="placement-unknown-count">
                      · {unknown} unknown
                    </span>
                  )}
                </>
              )}
              <span>· {requestChanges ? "requests changes — can block the PR until updated" : "posts as plain comments"}</span>
              {overCap && (
                <b className="text-foreground" data-testid="over-cap">
                  · over the {maxPerPost} per-post limit — untick some
                </b>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 max-[899px]:w-full max-[899px]:justify-between">
              <Label className="min-h-9 cursor-pointer gap-2 text-xs font-normal text-muted-foreground hover:text-foreground">
                <Checkbox
                  checked={requestChanges}
                  onCheckedChange={(v) => onRequestChanges?.(v === true)}
                  data-testid="request-changes"
                  className="data-[state=checked]:border-red data-[state=checked]:bg-red"
                />
                Request changes instead
              </Label>
              <Button
                type="button"
                variant={requestChanges ? "destructive" : "default"}
                className="transition-[box-shadow,background-color] duration-300 motion-reduce:transition-none motion-reduce:duration-0"
                data-post
                disabled={busy || stale || overCap}
                aria-busy={busy}
                title={
                  stale
                    ? "Reload the page — this review has been replaced"
                    : overCap
                      ? `GitHub takes a review all-or-nothing; post at most ${maxPerPost} at a time`
                      : ""
                }
                onClick={onPost}
              >
                {busy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden="true" />}
                {busy ? "Posting…" : requestChanges ? "Request changes" : postLabel}
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

// ---- the assessment head ---------------------------------------------------------------------

export interface VerdictProps {
  tone: Tone;
  text: string;
  // Orientation for the verdict, behind the ? button (design.md §6).
  about?: ReactNode;
  chips?: { kind: string; n: number }[];
  testid?: string;
}

const VERDICT_ICON: Record<Tone, LucideIcon> = {
  red: iconOf("blocker"),
  amber: iconOf("should-fix"),
  green: CircleCheck,
  blue: CircleDot,
  graphite: Circle,
};

export function Verdict({ tone, text, about, chips = [], testid }: VerdictProps) {
  const Glyph = VERDICT_ICON[tone];
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 pt-1" data-testid={testid}>
      <div className="flex min-w-0 flex-1 basis-[280px] items-center gap-2">
        <Glyph aria-hidden="true" className={cn("size-5 shrink-0", TONE_TEXT[tone])} />
        <h2 className="m-0 font-display text-xl font-semibold tracking-tight max-[899px]:text-lg">{text}</h2>
        {about && <About>{about}</About>}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="verdict-chips">
          {chips.map((c) => (
            <StatusBadge key={c.kind} kind={c.kind}>
              {c.n} {wordOf(c.kind).toLowerCase()}
            </StatusBadge>
          ))}
        </div>
      )}
    </div>
  );
}

export function KeyPoints({ points }: { points: string[] }) {
  return (
    <ul className="my-1 mb-4 max-w-[64ch] list-disc pl-5 text-[15px] leading-relaxed marker:text-muted-foreground">
      {points.map((pt, i) => (
        <li key={i} className="my-1">
          {pt}
        </li>
      ))}
    </ul>
  );
}

// ---- the status line and the progress steps ---------------------------------------------------

// One condition on the status line: a badge with a glyph and a word, the full sentence as its
// title. `kind` picks the glyph from the shared vocabulary, `icon` overrides it; `to` makes it a
// link, rendered by whoever owns a router.
export interface StatusItem {
  key: string;
  tone: Tone;
  word: string;
  kind?: string;
  icon?: LucideIcon;
  title?: string;
  testid?: string;
  to?: string;
}

export function StatusLineView({
  items,
  meta = [],
  link,
  testid,
}: {
  items: StatusItem[];
  meta?: ReactNode[];
  link?: (to: string, child: ReactNode, title: string | undefined) => ReactNode;
  testid?: string;
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid={testid}>
      {items.map((it) => {
        const s = (
          <StatusBadge key={it.key} kind={it.kind} tone={it.tone} icon={it.icon} title={it.title} {...(it.testid ? { "data-testid": it.testid } : {})}>
            {it.word}
          </StatusBadge>
        );
        return it.to && link ? <Fragment key={it.key}>{link(it.to, s, it.title)}</Fragment> : s;
      })}
      {meta.length > 0 && (
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {meta.map((m, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">·</span>}
              {m}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

export interface Step {
  label: string;
  done: boolean;
  note?: string;
}

// The three-step progress as a compact stepper: chips joined by a thin line; done is a green
// check, the first step still to do is blue, the rest sit in graphite.
export function Steps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="m-0 mb-4 flex list-none flex-wrap items-center gap-y-1 p-0 text-xs text-muted-foreground" data-testid="steps">
      {steps.map((s, i) => {
        const state = s.done ? "done" : i === current ? "current" : "pending";
        return (
          <li key={s.label} className="flex items-center" data-testid={s.done ? "step-done" : "step-todo"} data-state={state}>
            {i > 0 && <span aria-hidden="true" className="mx-1.5 h-px w-5 bg-border max-[899px]:mx-0.5 max-[899px]:w-2" />}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
                state === "done" && "bg-green/12 text-foreground",
                state === "current" && "bg-blue/12 text-foreground",
              )}
            >
              {state === "done" ? (
                <CircleCheck aria-hidden="true" className="size-3.5 text-green" />
              ) : state === "current" ? (
                <CircleDot aria-hidden="true" className="size-3.5 text-blue" />
              ) : (
                <Circle aria-hidden="true" className="size-3.5 text-muted-foreground" />
              )}
              <span>{s.label}</span>
              {s.note && <span className="text-muted-foreground">{s.note}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// The phases of a run in flight, ticked to `cur`.
export function ProgressSteps({ phases, cur }: { phases: string[]; cur: number }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="progress-steps">
      {phases.map((ph, j) => {
        const state = j < cur ? "done" : j === cur ? "now" : "todo";
        return (
          <li
            key={ph}
            data-state={state}
            className={cn("flex items-center gap-2.5 py-1 text-sm", state === "now" ? "font-medium text-foreground" : "text-muted-foreground")}
          >
            {state === "done" ? (
              <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-green" />
            ) : state === "now" ? (
              <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-amber motion-reduce:animate-none" />
            ) : (
              <Circle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            )}
            {ph}
          </li>
        );
      })}
    </ol>
  );
}
