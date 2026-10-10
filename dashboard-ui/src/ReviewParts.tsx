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
  Check,
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
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { StatusBadge, iconOf, toneOf, wordOf, type Tone } from "./ui";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
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

export function FindingCard({ f, checked, onToggle, disabled, explain, editor, teach }: FindingCardProps) {
  const x = useExplain(explain);
  const { expOpen, setExpOpen, runExplain } = x;
  // Unstructured findings (older reviews) show the comment inline; structured ones tuck it away.
  const [showDetail, setShowDetail] = useState(!f.structured);
  const [showTeach, setShowTeach] = useState(false);
  const [taught, setTaught] = useState(!!f.taught);
  const loc = `${f.path}:${f.line}`;
  const place = placementOf(f);
  const tone = toneOf(f.severity);
  // The footer actions sit in graphite until the card is hovered or focused (or one of them is
  // open), then take the full ink; they never collapse, so the card keeps its shape.
  const anyOpen = expOpen || (f.structured && showDetail) || showTeach;
  return (
    <Card
      data-testid="finding"
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
        <ConfidenceBadge confidence={f.confidence} />
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
        <CopyPath loc={loc} />
      </div>
      <div className="flex flex-col gap-2 px-4 pb-3 pl-[18px]">
        {f.structured && <div className="text-sm font-medium leading-snug">{f.title}</div>}
        {f.structured && f.impact && (
          <p className="m-0 max-w-[72ch] text-sm leading-relaxed text-muted-foreground" data-testid="why-it-matters">
            <span className="mr-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Why it matters</span>
            {f.impact}
          </p>
        )}
        <HowToVerify text={f.howToVerify} className="max-w-[72ch] text-sm" />
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
