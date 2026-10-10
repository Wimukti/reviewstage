import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Crosshair,
  Ellipsis,
  ExternalLink,
  EyeOff,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestClosed,
  History,
  Info,
  Layers,
  ListChecks,
  ListFilter,
  Loader2,
  MapPinOff,
  Play,
  Plug,
  RefreshCw,
  RotateCcw,
  SearchX,
  ShieldAlert,
  Square,
  Unplug,
  Users,
} from "lucide-react";
import {
  api,
  ApiError,
  errMessage,
  isExpiredToken,
  type Finding,
  type ReviewData,
  type TeachDirection,
  type Me,
  type PrData,
  type PrRef,
  type Reason,
  type ReviewersData,
  type RunFormData,
  type Token,
} from "./api";
import { openPalette } from "./CommandPalette";
import { Md } from "./Md";
import { MdEditor } from "./MdEditor";
import { prLabel, prUrl, usageChip, usageTitle } from "./pr";
import { setRepoFilter } from "./repoFilter";
import { Link, useLocation } from "./router";
import { useIsPhone } from "./theme";
import { haptic } from "./gestures";
import { PhoneFindingCard, PhonePrHeader, PhonePrSkeleton, PhoneReasonBar, PostPill, PostSheet, PostSuccess, PrActionSheet } from "./PhoneReview";
import { ReasonPrompt } from "./reasonPrompt";
import { defaultModelFor } from "./quickRun";
import { pokeRunning } from "./running";
import { BrandIcon } from "./icons";
import {
  CommitBar,
  FindingCard,
  KeyPoints,
  placementOf,
  ProgressSteps,
  StatusLineView,
  Steps,
  Verdict,
  type StatusItem,
} from "./ReviewParts";
import { Banner, EmptyState, PageHeader, RawBanner, RepoPill, StatusBadge, UserAvatar, toneOf as toneOfState, wordOf, type Tone } from "./ui";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DEFAULT_KEY = "__plan_default__";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const refOf = (d: PrData): PrRef => ({ repo: d.repo, num: d.pr });

// The severity tone as a card's left accent (the history view's cards; FindingCard has its own).
const SEV_BORDER: Record<Tone, string> = {
  blue: "border-l-blue", amber: "border-l-amber", red: "border-l-red", green: "border-l-green", graphite: "border-l-graphite",
};

// Menu highlight: accent and popover share a tone in tw.css, so the system's own highlight is
// invisible on a popover; the blue tint is what the legacy menus used.
const ITEM = "focus:bg-blue/14";

const REV_STATE: Record<string, [Tone, string]> = {
  APPROVED: ["green", "Approved"],
  CHANGES_REQUESTED: ["red", "Changes requested"],
  COMMENTED: ["graphite", "Commented"],
  DISMISSED: ["graphite", "Dismissed"],
  AWAITING: ["amber", "Awaiting review"],
};

// A labelled field in a form: the label in metadata type above its control.
function Field({ label, htmlFor, children }: { label: React.ReactNode; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Reviewers({ data }: { data: ReviewersData }) {
  const [open, setOpen] = useState(false);
  if (!data.reviewers.length) return null;
  const dec =
    data.decision === "CHANGES_REQUESTED"
      ? "Changes requested must be addressed to merge."
      : data.decision === "APPROVED"
      ? "Approved — ready to merge."
      : data.decision === "REVIEW_REQUIRED"
      ? "Review required before merge."
      : "";
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3" data-testid="reviewers">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground">
          <Users aria-hidden="true" />
          Reviewers ({data.reviewers.length})
          <ChevronDown aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 divide-y divide-border">
          {data.reviewers.map((r) => {
            const [tone, lbl] = REV_STATE[r.state] || ["amber", "Pending"];
            return (
              <div className="flex min-h-[44px] items-center gap-2.5 py-1.5" key={r.login}>
                <UserAvatar login={r.login} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={r.login}>
                  {r.login}
                </span>
                <StatusBadge tone={tone}>{lbl}</StatusBadge>
              </div>
            );
          })}
        </div>
        {dec && <p className="mb-0 mt-2 text-xs text-muted-foreground">{dec}</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ClaudeGate({ action }: { action: string }) {
  return (
    <div className="flex items-start gap-3 py-1" data-testid="claude-gate">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&>svg]:size-5">
        {BrandIcon.claude}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Connect your Claude account to {action}</div>
        <p className="mb-3 mt-0.5 max-w-[52ch] text-xs text-muted-foreground">
          {action[0].toUpperCase() + action.slice(1)}s run on <b>your own</b> Claude subscription —
          nothing runs on anyone else's plan. Connect once and you're set.
        </p>
        <Button asChild>
          <Link to="/integrations" className="hover:no-underline">
            <Plug aria-hidden="true" />
            Connect Claude
          </Link>
        </Button>
      </div>
    </div>
  );
}

// Effort or model as a Select: name on the row, its one-line description under it.
function LevelSelect({
  id,
  value,
  onChange,
  levels,
  suggested,
  titles,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  levels: { key: string; name: string; sub: string }[];
  suggested?: string;
  titles?: Record<string, string | undefined>;
  label: string;
}) {
  const cur = levels.find((l) => l.key === value);
  // Radix Select treats "" as "no selection", so the plan-default model (key "") rendered
  // blank and could not be picked back. It travels under a stand-in key inside the control.
  const enc = (k: string) => (k === "" ? DEFAULT_KEY : k);
  const dec = (k: string) => (k === DEFAULT_KEY ? "" : k);
  return (
    <Select value={enc(value)} onValueChange={(v) => onChange(dec(v))}>
      <SelectTrigger id={id} aria-label={label} className="w-full max-w-[420px]" title={titles?.[value]}>
        <SelectValue>
          <span className="truncate">{cur?.name ?? value}</span>
          {cur && <span className="truncate text-xs text-muted-foreground">{cur.sub}</span>}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {levels.map((l) => (
          <SelectItem key={l.key} value={enc(l.key)} className={ITEM} title={titles?.[l.key]}>
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2">
                {l.name}
                {l.key === suggested && (
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px] text-muted-foreground">
                    Suggested
                  </Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{l.sub}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RunForm({
  pr,
  token,
  form,
  label,
  connected,
  onStarted,
}: {
  pr: PrRef;
  token: Token;
  form: RunFormData;
  label: string;
  connected: boolean;
  onStarted: () => void;
}) {
  const [effort, setEffort] = useState(form.suggested);
  const [model, setModel] = useState(defaultModelFor(form.suggested));
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const focusRef = useRef<HTMLTextAreaElement>(null);
  const others = form.othersOnHead || [];
  if (!connected) return <ClaudeGate action="review" />;
  const estTitle = Object.fromEntries(
    form.levels.map((l) => {
      const est = form.estimates?.[l.key];
      return [
        l.key,
        est?.source === "measured"
          ? `Median of ${est.samples} ${l.name} run${est.samples === 1 ? "" : "s"} on this install`
          : undefined,
      ];
    }),
  );
  const suggestedName = form.levels.find((l) => l.key === form.suggested)?.name;
  return (
    <form
      className="flex flex-col gap-4"
      data-testid="run-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        setBusy(true);
        try {
          const r = await api.review(pr, token, effort, focus, model);
          if (r.started === false) {
            // A previous run still holds the per-PR lock (e.g. a stop that could not be confirmed).
            setErr(
              "Couldn't start — a previous run may still be finishing or holding the lock. " +
                "Try Stop, then start again in a moment.",
            );
            return;
          }
          pokeRunning(); // so the sidebar says so the moment the reviewer leaves this page
          onStarted();
        } catch (x) {
          setErr(errMessage(x, "Couldn't start the review."));
        } finally {
          setBusy(false);
        }
      }}
    >
      {err && <Banner kind="err">{err}</Banner>}
      {others.length > 0 && (
        <div className="rounded-md bg-muted/60 p-3 text-sm" data-testid="others-nudge">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <Users aria-hidden="true" className="size-4 text-muted-foreground" />
            {others.length === 1
              ? `${others[0].login} already reviewed this commit`
              : `${others.length} reviewers already reviewed this commit`}
          </div>
          <ul className="my-1 list-disc pl-5 text-xs text-muted-foreground">
            {others.map((o) => (
              <li key={o.login}>
                <b className="text-foreground">{o.login}</b> — {o.effort}
                {o.model ? ` · ${o.model}` : ""} · {o.skill}
                {o.focus ? ` · focus: “${o.focus}”` : " · no focus"}
                {o.when ? ` · ${o.when}` : ""}
              </li>
            ))}
          </ul>
          <p className="m-0 text-xs text-muted-foreground">
            A second review adds the most when it checks something the first didn’t — add a focus
            below, or switch skills on the Skills page. Or run the same way to compare notes.{" "}
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => focusRef.current?.focus()}>
              Add a focus
            </Button>
          </p>
        </div>
      )}
      <Field
        htmlFor="run-effort"
        label={
          <>
            Effort
            {suggestedName && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] text-muted-foreground" data-testid="suggested-effort">
                Suggested: {suggestedName}
              </Badge>
            )}
          </>
        }
      >
        <LevelSelect id="run-effort" label="Effort" value={effort} onChange={setEffort} levels={form.levels} suggested={form.suggested} titles={estTitle} />
      </Field>
      {form.models && form.models.length > 0 && (
        <Field htmlFor="run-model" label="Model">
          <LevelSelect id="run-model" label="Model" value={model} onChange={setModel} levels={form.models} />
        </Field>
      )}
      <Field htmlFor="run-focus" label="Focus — optional">
        <Textarea
          id="run-focus"
          ref={focusRef}
          rows={2}
          className="min-h-14 max-w-[640px] font-sans"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="Anything specific to check? e.g. “pay close attention to the order-flow cost calculation.”"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 basis-[200px] text-xs text-muted-foreground">
          Runs with {form.skillLabel} · deeper reviews cost more of your weekly usage.
        </span>
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {busy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Play aria-hidden="true" />}
          {busy ? "Starting…" : label}
        </Button>
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        {Object.values(form.estimates ?? {}).some((e) => e.source === "measured")
          ? "“Typically” times are medians of this install’s own runs; ranges are estimates. Both depend on the PR’s size, the model and your plan."
          : "Times are estimates — they depend on the PR’s size, the model and your plan."}
      </p>
    </form>
  );
}

// The stalled banner's Stop: only rendered when the server says the run's process group is
// still alive (bash gone, the agent it started still burning tokens).
function StopStalled({ pr, token, onDone }: { pr: PrRef; token: Token; onDone: () => void }) {
  const [stopping, setStopping] = useState(false);
  const [err, setErr] = useState("");
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        className="ml-1 align-middle"
        disabled={stopping}
        onClick={async () => {
          setErr("");
          setStopping(true);
          try {
            await api.stop(pr, token);
            onDone();
          } catch (x) {
            setErr(errMessage(x, "Couldn't stop it."));
          } finally {
            setStopping(false);
          }
        }}
      >
        <Square aria-hidden="true" />
        {stopping ? "Stopping…" : "Stop it"}
      </Button>
      {err && <div className="mt-2 text-sm text-red">{err}</div>}
    </>
  );
}

function HistoryList({ pr, runs }: { pr: PrRef; runs: PrData["history"] }) {
  if (!runs || !runs.length) return null;
  return (
    <Card className="mt-3 gap-0 border-0 py-0 shadow-sm" data-testid="history">
      <div className="flex items-center gap-2 px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">
        <History aria-hidden="true" className="size-4" />
        Earlier runs ({runs.length})
      </div>
      <div className="divide-y divide-border">
        {runs.map((h) => (
          <Link
            key={h.ts}
            className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-inherit hover:bg-accent/40 hover:no-underline"
            to={prUrl(pr, "/pr", `&v=${h.ts}`)}
          >
            <span className="text-sm font-medium">earlier run</span>
            <span className="text-xs text-muted-foreground">
              {h.effort} · {h.findings} finding(s)
              {h.focus ? ` · focus: “${h.focus.slice(0, 80)}”` : ""}
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function ProgressPanel({ pr, data, onStop }: { pr: PrRef; data: PrData; onStop: () => void }) {
  const r = data.reviewing!;
  const [stopping, setStopping] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Card className="mt-3 gap-3 border-0 py-4 shadow-sm" data-testid="progress-panel">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">
          Drafting review for {prLabel(pr)}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{r.effortLabel} effort</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <ProgressSteps phases={r.phases} cur={r.cur} />
        {r.focus && <p className="m-0 text-xs text-muted-foreground">Focusing on: “{r.focus}”</p>}
        {r.queued && (
          <p className="m-0 text-xs text-muted-foreground">
            Waiting for another review to finish first — one runs at a time on this box.
          </p>
        )}
        <p className="m-0 text-xs text-muted-foreground">This page refreshes itself; {r.effortHint}.</p>
        {err && <Banner kind="err">{err}</Banner>}
        <div>
          <Button
            variant="secondary"
            type="button"
            disabled={stopping}
            onClick={async () => {
              setErr("");
              setStopping(true);
              try {
                await api.stop(pr, data.tokens.stop);
                onStop();
              } catch (x) {
                setErr(errMessage(x, "Couldn't stop the review."));
              } finally {
                setStopping(false);
              }
            }}
          >
            <Square aria-hidden="true" />
            {stopping ? "Stopping…" : "Stop review"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Teaching the skill from this one finding. The clustering engine needs the same complaint
// dropped several times across several PRs before it offers anything; a reviewer reading the
// card already knows. Nothing is written until the rule has been read and the button pressed.
function TeachPanel({ f, pr, token, teach, onTaught }: {
  f: Finding;
  pr: PrRef;
  token: Token;
  teach: { target: string; targetLabel: string; connected: boolean };
  onTaught: () => void;
}) {
  const [dir, setDir] = useState<TeachDirection | "">("");
  const [rule, setRule] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState<"" | "draft" | "add">("");
  const [err, setErr] = useState("");
  const [added, setAdded] = useState("");

  const draft = async (d: TeachDirection) => {
    setDir(d);
    setErr("");
    setBusy("draft");
    try {
      const r = await api.teach(pr, token, f.i, d, "draft");
      setRule(r.rule);
      setWhy(r.rationale || "");
    } catch (e) {
      setErr(errMessage(e, "Could not draft a rule — try again."));
    } finally {
      setBusy("");
    }
  };
  const add = async () => {
    if (!dir || !rule.trim()) return;
    setErr("");
    setBusy("add");
    try {
      const r = await api.teach(pr, token, f.i, dir, "add", rule);
      setAdded(r.targetLabel);
      onTaught();
    } catch (e) {
      setErr(errMessage(e, "Could not add the rule — try again."));
    } finally {
      setBusy("");
    }
  };

  const shell = "mt-1 flex flex-col gap-2 rounded-md bg-muted/60 p-3";
  if (added) {
    return (
      <div className={shell} data-testid="teach-added">
        <StatusBadge kind="done">Added to {added}</StatusBadge>
        <p className="m-0 text-xs text-muted-foreground">
          Every review from now on reads this. <Link to="/skills#rules">See it on Skills</Link>.
        </p>
      </div>
    );
  }
  return (
    <div className={shell} data-testid="teach">
      {!teach.connected ? (
        <p className="m-0 text-xs text-muted-foreground" data-testid="teach-noclaude">
          Drafting a rule runs on your own Claude account.{" "}
          <Link to="/integrations">Connect one</Link> to use this.
        </p>
      ) : (
        <>
          <p className="m-0 text-xs text-muted-foreground">What should the next review do with this complaint?</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={dir === "avoid" ? "default" : "secondary"}
              size="sm"
              className="max-[899px]:h-10 max-[899px]:flex-1"
              disabled={!!busy}
              onClick={() => void draft("avoid")}
              data-testid="teach-avoid"
            >
              <EyeOff aria-hidden="true" />
              Don't raise it again
            </Button>
            <Button
              type="button"
              variant={dir === "always" ? "default" : "secondary"}
              size="sm"
              className="max-[899px]:h-10 max-[899px]:flex-1"
              disabled={!!busy}
              onClick={() => void draft("always")}
              data-testid="teach-always"
            >
              <ListChecks aria-hidden="true" />
              Always check it
            </Button>
          </div>
          {busy === "draft" && (
            <div className="flex flex-col gap-2 py-1" aria-busy="true">
              <span className="sr-only" role="status">Writing the rule</span>
              <Skeleton className="h-3.5 w-10/12" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          )}
          {err && (
            <p className="m-0 text-sm text-red" data-testid="teach-err">
              {err}
            </p>
          )}
          {rule && busy !== "draft" && (
            <>
              <Label htmlFor={`teach-${f.i}`} className="mt-1 text-xs font-medium" data-testid="teach-label">
                The rule, as it will be written to {teach.targetLabel}
              </Label>
              <Textarea
                id={`teach-${f.i}`}
                rows={2}
                className="min-h-14 font-sans text-[15px] leading-relaxed"
                value={rule}
                onChange={(e) => setRule(e.target.value)}
                data-testid="teach-rule"
              />
              {why && <p className="m-0 text-xs text-muted-foreground">{why}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  className="max-[899px]:h-10 max-[899px]:flex-1"
                  disabled={busy === "add" || !rule.trim()}
                  onClick={() => void add()}
                  data-testid="teach-add"
                >
                  {busy === "add" ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <GitCommitHorizontal aria-hidden="true" />}
                  {busy === "add" ? "Adding…" : "Add this rule"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="max-[899px]:h-10 max-[899px]:flex-1"
                  disabled={!!busy}
                  onClick={() => void draft(dir as TeachDirection)}
                >
                  <RefreshCw aria-hidden="true" />
                  Redraft
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function FindingBody({ body, onBody, suggestion }:
  { body: string; onBody: (v: string) => void; suggestion: string }) {
  return (
    <div className="max-w-[80ch]" data-testid="finding-body">
      <MdEditor value={body} onChange={onBody} />
      {suggestion && (
        <div className="mt-2 overflow-hidden rounded-md bg-green/10">
          <div className="px-3 py-1.5 text-xs text-green">Suggested change — the author can apply this in one click on GitHub</div>
          <pre className="m-0 rounded-none border-0 bg-transparent">
            <code>{suggestion}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

function ClampSummary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 260;
  return (
    <div className="mb-3 max-w-[64ch] text-[15px] leading-relaxed">
      <div className={!open && long ? "line-clamp-4" : ""}>
        <Md>{text}</Md>
      </div>
      {long && (
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}

function verdict(rev: ReviewData) {
  const cnt = (k: string) => rev.chips.find((c) => c.kind === k)?.n ?? 0;
  const b = cnt("blocker");
  const f = cnt("should-fix");
  if (rev.event === "REQUEST_CHANGES") return { tone: "red" as Tone, text: "Changes requested" };
  if (b) return { tone: "red" as Tone, text: `${b} blocker${b > 1 ? "s" : ""} to resolve before merge` };
  if (f) return { tone: "amber" as Tone, text: `${f} thing${f > 1 ? "s" : ""} to fix before merge` };
  if (rev.count === 0) return { tone: "green" as Tone, text: "Looks good — nothing to fix" };
  return { tone: "green" as Tone, text: "Looks good — comments only, nothing blocking" };
}

// Which review these findings came from. The server matches a post to its stored review by
// array index, so a re-run started on another device would silently re-point every comment at a
// different file and line. This is the server's own identity for the run — a fingerprint
// computed here could only agree with the very list the server handed us, so it proved nothing
// and made a replaced run look current. An older server sends none: we send "" and it skips the
// check, exactly as it did before the key existed.
const reviewIdentity = (rev: ReviewData): string => rev.reviewKey || "";

// The server answers a write with banner HTML, not a status. Its `kind` is the only signal of
// whether the stage was committed: `ok` is a post, and in dry run the deliberate "nothing was
// sent" is a `warn` that says so.
function postedFromBanner(html: string, dryRun: boolean): boolean {
  const kind = /class='banner (\w+)'/.exec(html)?.[1];
  if (kind === "ok") return true;
  return kind === "warn" && dryRun && /dry run/i.test(html);
}

const headMovedOf = (rev: ReviewData | undefined): boolean =>
  !!(
    rev?.approve?.reviewedHead &&
    rev.approve.currentHead &&
    rev.approve.reviewedHead !== rev.approve.currentHead
  );

// The four sections as one tab list, one panel open at a time (Radix: arrow keys move and
// select, Home/End jump). The first section is open on arrival.
interface Section {
  key: string;
  label: string;
  icon: typeof FileText;
  content: React.ReactNode;
}
function SectionTabs({ sections }: { sections: Section[] }) {
  const [open, setOpen] = useState(sections[0]?.key ?? "");
  if (!sections.length) return null;
  const cur = sections.find((s) => s.key === open) ?? sections[0];
  return (
    <Tabs value={cur.key} onValueChange={setOpen} className="mt-4 gap-2" data-testid="sections">
      <TabsList variant="line" className="h-auto! w-full flex-wrap justify-start gap-x-0.5 gap-y-1 p-0" aria-label="Sections" data-testid="section-row">
        {sections.map((s) => (
          <TabsTrigger key={s.key} value={s.key} data-testid={`sec-${s.key}`} className="h-9 flex-none gap-1.5 px-3 max-[899px]:h-10">
            <s.icon aria-hidden="true" />
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={cur.key} id={`secpanel-${cur.key}`}>
        <Card className="gap-0 border-0 py-4 shadow-sm">
          <CardContent className="px-4 [&>h2:first-child]:mt-0">{cur.content}</CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function ReviewBody({
  data,
  me,
  onDone,
  onPosted,
}: {
  data: PrData;
  me: Me;
  onDone: () => void;
  onPosted: () => void;
}) {
  const rev = data.review!;
  const [bodies, setBodies] = useState<Record<number, string>>(
    () => Object.fromEntries(rev.findings.map((f) => [f.i, f.body]))
  );
  // The server pre-selects, and caps how many it pre-selects: GitHub takes a review
  // all-or-nothing, so ticking every non-low finding of a 200-finding run turned one click into
  // a review GitHub rejects whole. Fall back to "everything not low" only when it does not say.
  const [selected, setSelected] = useState<Set<number>>(() => {
    const serverKnows = rev.findings.some((f) => f.preselect !== undefined);
    const pick = serverKnows ? (f: Finding) => f.preselect === true : (f: Finding) => !f.low;
    return new Set(rev.findings.filter(pick).map((f) => f.i));
  });
  const [requestChanges, setRequestChanges] = useState(false);
  const [banner, setBanner] = useState("");
  const [err, setErr] = useState("");
  const [stale, setStale] = useState(false); // the server refused: this run has been replaced
  const [busy, setBusy] = useState(false);
  // The stage was committed in this session: the bar switches in place, no reload needed.
  const [postedNow, setPostedNow] = useState(false);
  const posted = postedNow || rev.posted;
  const [maybeOpen, setMaybeOpen] = useState(false);
  // The phone: dropped findings (local only, never sent), the confirm sheet, and how many the
  // post carried for the success state.
  const phone = useIsPhone();
  const [dropped, setDropped] = useState<Set<number>>(() => new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [postedCount, setPostedCount] = useState(0);
  // Why each dropped finding was dropped (lane2-reasons.md). Optional: the drop itself is the
  // tick or the swipe and is already done; `askReason` is the one card the chip row is open
  // for, and the prompt closes it after ~6 s or on the next decision about any card.
  const [reasons, setReasons] = useState<Record<number, Reason>>({});
  const [askReason, setAskReason] = useState<number | null>(null);
  const prompt = useRef<ReasonPrompt | null>(null);
  if (!prompt.current) prompt.current = new ReasonPrompt(setAskReason);
  useEffect(() => () => prompt.current?.dismiss(), []);
  const forgetReason = (i: number) =>
    setReasons((r) => {
      if (!(i in r)) return r;
      const n = { ...r };
      delete n[i];
      return n;
    });
  const pickReason = (i: number, r: Reason | null) => {
    if (r) setReasons((all) => ({ ...all, [i]: r }));
    else forgetReason(i);
    prompt.current?.dismiss();
  };

  // approve
  const [approveBody, setApproveBody] = useState(rev.approve?.defaultMsg || "");
  const [ack, setAck] = useState(false);

  // An explicit untick is a drop and asks why; a re-tick clears the answer. Either way the
  // tick lands first — the question never stands between the reviewer and the decision.
  const toggle = (i: number) => {
    const wasSelected = selected.has(i);
    setSelected((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
    if (wasSelected) prompt.current?.ask(i);
    else {
      forgetReason(i);
      prompt.current?.decided();
    }
  };
  // A swipe stages exactly what the checkbox does: keep adds to `selected`, drop takes it out.
  const without = (s: Set<number>, i: number) => {
    const n = new Set(s);
    n.delete(i);
    return n;
  };
  const keep = (i: number) => {
    setSelected((s) => new Set(s).add(i));
    setDropped((d) => without(d, i));
    forgetReason(i);
    prompt.current?.decided();
    haptic();
  };
  const drop = (i: number) => {
    setSelected((s) => without(s, i));
    setDropped((d) => new Set(d).add(i));
    prompt.current?.ask(i);
    haptic();
  };
  const restore = (i: number) => {
    setDropped((d) => without(d, i));
    forgetReason(i);
    prompt.current?.decided();
  };

  // Where the selected findings will land — GitHub only takes an inline comment on a changed
  // line, and sometimes it will not say which lines those are.
  const sel = rev.findings.filter((f) => selected.has(f.i));
  const selInline = sel.filter((f) => placementOf(f) === "inline").length;
  const selOff = sel.filter((f) => placementOf(f) === "summary").length;
  const selUnknown = sel.filter((f) => placementOf(f) === "unknown").length;
  const shown = rev.findings.filter((f) => !f.low);
  const maybe = rev.findings.filter((f) => f.low);
  // GitHub accepts a review all-or-nothing, so a batch over the server's cap is refused there
  // anyway — catch it before the click rather than after the whole review is lost.
  const maxPerPost = rev.maxPerPost ?? 0;
  // Approving head B while reading head A's "LGTM, no blockers" is the failure this catches. The
  // server refuses it too; this just makes the reason visible before the click.
  const headMoved = headMovedOf(rev);
  const needsAck = !!rev.approve && (!rev.approve.lgtm || headMoved);
  // The server refuses an approval on a PR that is no longer open; say so before the click
  // instead of after it.
  const noApprove = data.canApprove === false;
  const noApproveWhy = data.merged
    ? "This PR is merged — GitHub will not take an approval on it."
    : "This PR is closed — an approval on it would not be actionable.";

  // An action token lives 30 minutes and /api/pr only re-mints while a review runs, so reading a
  // long review and then clicking Post used to 403 into a dead button. Re-read the PR for a
  // fresh token and try the write exactly once more.
  async function withFreshToken<T>(
    pick: (d: PrData) => Token,
    call: (t: Token) => Promise<T>,
  ): Promise<T> {
    try {
      return await call(pick(data));
    } catch (e) {
      if (!isExpiredToken(e)) throw e;
      const fresh = await api.pr(refOf(data));
      return await call(pick(fresh));
    }
  }

  async function submitPost(): Promise<boolean> {
    if (busy) return false;
    setErr("");
    setBusy(true);
    try {
      const res = await withFreshToken(
        (d) => d.tokens.post,
        (t) =>
          api.post(refOf(data), t, {
            selected: [...selected],
            bodies,
            suggs: {},
            request_changes: requestChanges,
            review_key: reviewIdentity(rev),
            // Only the reasons for findings that are still dropped travel; a re-ticked card
            // already forgot its answer, so this is the whole map.
            reasons,
          }),
      );
      setBanner(res.bannerHtml);
      const ok = postedFromBanner(res.bannerHtml, data.dryRun);
      if (ok) {
        setPostedCount(selected.size);
        setPostedNow(true);
        onPosted();
      }
      onDone();
      return ok;
    } catch (e) {
      // 409: the stored review is not the one on screen. Say so in those words and offer the
      // only thing that helps — a reload — rather than a button that looks retryable.
      setBanner("");
      if (e instanceof ApiError && e.status === 409) {
        setStale(true);
        setErr("");
        return false;
      }
      setErr(errMessage(e, "Couldn't post to GitHub."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitApprove() {
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      const res = await withFreshToken(
        (d) => d.tokens.approve,
        (t) => api.approve(refOf(data), t, approveBody, ack, rev.approve?.reviewedHead || ""),
      );
      setBanner(res.bannerHtml);
      onDone();
    } catch (e) {
      setBanner("");
      setErr(errMessage(e, "Couldn't approve on GitHub."));
    } finally {
      setBusy(false);
    }
  }

  const teachOn = data.teach && data.tokens.teach ? data.teach : null;
  const teachToken = data.tokens.teach;
  // What a card needs beyond its finding — the same for the desk card and the phone card.
  const extras = (f: Finding) => ({
    explain: async () => {
      const r = await api.explain(refOf(data), data.tokens.explain, f.i);
      return <Md className="dbody p-0">{r.md}</Md>;
    },
    editor: (
      <>
        {f.structured && <p className="m-0 text-xs text-muted-foreground">This is the comment posted to GitHub — edit if needed.</p>}
        <FindingBody
          body={bodies[f.i] ?? ""}
          onBody={(v) => setBodies((b) => ({ ...b, [f.i]: v }))}
          suggestion={f.suggestion}
        />
      </>
    ),
    teach:
      teachOn && teachToken
        ? {
            panel: (onTaught: () => void) => (
              <TeachPanel f={f} pr={refOf(data)} token={teachToken} teach={teachOn} onTaught={onTaught} />
            ),
          }
        : undefined,
  });
  const renderFinding = (f: Finding) =>
    phone ? (
      <PhoneFindingCard
        key={f.i}
        f={f}
        kept={selected.has(f.i)}
        dropped={dropped.has(f.i)}
        disabled={posted}
        onToggle={() => {
          toggle(f.i);
          haptic();
        }}
        onKeep={() => keep(f.i)}
        onDrop={() => drop(f.i)}
        onRestore={() => restore(f.i)}
        reason={reasons[f.i]}
        onAskReason={() => prompt.current?.ask(f.i)}
        {...extras(f)}
      />
    ) : (
      <FindingCard
        key={f.i}
        f={f}
        checked={selected.has(f.i)}
        onToggle={() => toggle(f.i)}
        reason={reasons[f.i]}
        askReason={askReason === f.i}
        onReason={(r) => pickReason(f.i, r)}
        onReasonDismiss={() => prompt.current?.dismiss()}
        {...extras(f)}
      />
    );

  // At most one full-width banner, and only for something that went wrong. The server's answer
  // to a write is the exception: it is the receipt for the click.
  const errorBanner = stale ? (
    <Banner kind="err" data-testid="rerun-refusal">
      <b>This review was re-run — reload before posting.</b> The findings on the server are
      not the ones on this page, so your ticks and edits no longer line up with them.
      Nothing was posted.{" "}
      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => window.location.reload()}>
        Reload the page
      </Button>
      .
    </Banner>
  ) : err ? (
    <Banner kind="err" data-testid="action-error">{err}</Banner>
  ) : null;

  const sections: Section[] = [];
  if ((rev.keyPoints && rev.keyPoints.length > 0 && rev.summary) || rev.analysis) {
    sections.push({
      key: "summary",
      label: "Full summary",
      icon: FileText,
      content: (
        <>
          {rev.keyPoints && rev.keyPoints.length > 0 && rev.summary && (
            <Md className="dbody p-0">{rev.summary}</Md>
          )}
          {rev.analysis && (
            <>
              <h2>Reviewer's notes — what was checked, and what was dropped</h2>
              <Md className="dbody p-0">{rev.analysis}</Md>
            </>
          )}
        </>
      ),
    });
  }
  if (rev.explainer) {
    sections.push({
      key: "explainer",
      label: "What this PR does",
      icon: Info,
      content: <Md className="dbody p-0">{rev.explainer}</Md>,
    });
  }
  if (rev.approved) {
    sections.push({
      key: "approve",
      label: "Approved",
      icon: CheckCheck,
      content: <ApprovedBody a={rev.approved} ghUrl={data.ghUrl} reviewers={data.reviewers} />,
    });
  } else if (rev.approve) {
    const a = rev.approve;
    sections.push({
      key: "approve",
      label: "Approve",
      icon: CheckCheck,
      content: (
        <div className="flex flex-col gap-3">
          {headMoved && (
            <Banner kind="warn" data-testid="head-moved">
              <b>The branch has moved since this review ran.</b> The verdict above was
              written against <code>{a.reviewedHead!.slice(0, 7)}</code>; GitHub is
              now at <code>{a.currentHead!.slice(0, 7)}</code>. Approving would
              bless commits nobody here has read — re-run the review, or confirm below to
              approve the current commit anyway.
            </Banner>
          )}
          <div>
            {a.lgtm ? (
              <StatusBadge kind="approved" className="whitespace-normal">LGTM — no blockers</StatusBadge>
            ) : (
              <StatusBadge tone="amber" className="whitespace-normal text-left">
                Not LGTM —{" "}
                {a.blockers ? `${a.blockers} blocker(s)` : "the agent's assessment is REQUEST_CHANGES"}
                . Approving anyway needs the confirmation below.
              </StatusBadge>
            )}
          </div>
          {/* Not a <form>, for the same reason as the post panel: Enter must never approve
              a PR. The acknowledgement that `required` used to enforce gates the button. */}
          <div data-testid="approve-panel" className="flex flex-col gap-3">
            <Field htmlFor="approve-body" label="Approval comment — posted on the PR as a whole, then the PR is approved">
              <Textarea
                id="approve-body"
                rows={3}
                className="max-w-[80ch] font-sans text-[15px] leading-relaxed"
                value={approveBody}
                onChange={(e) => setApproveBody(e.target.value)}
              />
            </Field>
            {needsAck && (
              <Label className="min-h-9 items-start gap-2.5 text-sm font-normal leading-snug">
                <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" data-testid="approve-ack" />
                <span>
                  {headMoved && a.lgtm
                    ? "I know the branch has moved and want to approve the current commit."
                    : "I've read the findings above and want to approve anyway."}
                </span>
              </Label>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                disabled={busy || noApprove || (needsAck && !ack)}
                aria-busy={busy}
                title={noApprove ? noApproveWhy : needsAck && !ack ? "Tick the confirmation above first" : ""}
                onClick={submitApprove}
              >
                {busy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <CheckCheck aria-hidden="true" />}
                {busy
                  ? "Approving…"
                  : data.dryRun
                    ? "Approve (dry run)"
                    : `Approve #${data.pr}`}
              </Button>
              {noApprove && (
                <span className="text-xs text-muted-foreground" data-testid="no-approve">
                  {noApproveWhy}
                </span>
              )}
            </div>
          </div>
          {data.reviewers && <Reviewers data={data.reviewers} />}
        </div>
      ),
    });
  }
  sections.push({
    key: "rerun",
    label: "Re-run",
    icon: RotateCcw,
    content: <RerunBody data={data} onDone={onDone} />,
  });

  const v = verdict(rev);
  if (phone) {
    const receipt = banner ? <RawBanner html={banner} /> : null;
    if (postedNow)
      return (
        <>
          <PrActionSheet data={data} sections={sections} notice={errorBanner} />
          <PostSuccess data={data} count={postedCount} login={me.login || "you"} dryRun={data.dryRun} />
        </>
      );
    return (
      <>
        <PrActionSheet data={data} sections={sections} notice={<>{receipt}{errorBanner}</>} />
        {receipt}
        {!sheetOpen && errorBanner}
        <Verdict tone={v.tone} text={v.text} chips={rev.chips} testid="verdict" />
        {rev.keyPoints && rev.keyPoints.length > 0 ? (
          <KeyPoints points={rev.keyPoints} />
        ) : rev.summary ? (
          <ClampSummary text={rev.summary} />
        ) : null}
        <div data-testid="post-panel">
          {rev.count === 0 ? (
            <p className="text-base text-muted-foreground">No findings — nothing to post.</p>
          ) : (
            <>
              {shown.map(renderFinding)}
              {maybe.length > 0 && (
                <Collapsible open={maybeOpen} onOpenChange={setMaybeOpen} className="mt-3" data-testid="maybe">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="-ml-2 min-h-[44px] text-[15px] text-muted-foreground hover:text-foreground">
                      <ListFilter aria-hidden="true" />
                      {maybe.length} lower-confidence finding{maybe.length !== 1 ? "s" : ""}
                      <ChevronDown aria-hidden="true" className={cn("transition-transform", maybeOpen && "rotate-180")} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>{maybe.map(renderFinding)}</CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </div>
        {rev.count > 0 && (
          <>
            <PostPill kept={selected.size} posted={posted} postedAs={me.login || ""} stale={stale} onOpen={() => setSheetOpen(true)} />
            {askReason !== null && !posted && (
              <PhoneReasonBar
                finding={rev.findings.find((f) => f.i === askReason)}
                value={reasons[askReason]}
                onPick={(r) => pickReason(askReason, r)}
                onClose={() => prompt.current?.dismiss()}
              />
            )}
            <PostSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              kept={selected.size}
              inline={selInline}
              summary={selOff}
              unknown={selUnknown}
              maxPerPost={maxPerPost}
              requestChanges={requestChanges}
              onRequestChanges={setRequestChanges}
              login={me.login || "you"}
              dryRun={data.dryRun}
              busy={busy}
              error={errorBanner}
              onPost={async () => {
                if (await submitPost()) {
                  haptic();
                  setSheetOpen(false);
                }
              }}
            />
          </>
        )}
      </>
    );
  }
  return (
    <>
      {banner && <RawBanner html={banner} />}
      {errorBanner}
      <Verdict
        tone={v.tone}
        text={v.text}
        about="The agent's read of this PR. Comments post as a plain review either way — nothing here blocks a merge unless you ask for changes."
        chips={rev.chips}
        testid="verdict"
      />
      {rev.keyPoints && rev.keyPoints.length > 0 ? (
        <KeyPoints points={rev.keyPoints} />
      ) : rev.summary ? (
        <ClampSummary text={rev.summary} />
      ) : null}

      {rev.convergence && rev.convergence.total > 0 && (
        <p className="mb-3 mt-0 max-w-[64ch] text-xs text-muted-foreground">
          <b className="text-foreground">{rev.convergence.confirmed}</b> of {rev.convergence.total} finding(s) confirmed by
          independent reviews ({rev.convergence.rate}% agreement across {rev.convergence.nRuns}{" "}
          reviewers on this commit). A finding only counts as confirmed when a reviewer using a
          different skill/model/effort raised it too — a signal to build on, not a score.
        </p>
      )}
      {/* Deliberately not a <form>: browsers implicitly submit one on Enter, and these are
          checkboxes. A stray keystroke while ticking findings would have posted the review. */}
      <div data-testid="post-panel">
        {rev.count === 0 ? (
          <p className="text-sm text-muted-foreground">No findings — nothing to post.</p>
        ) : (
          <>
            {shown.map(renderFinding)}
            {maybe.length > 0 && (
              <Collapsible open={maybeOpen} onOpenChange={setMaybeOpen} className="mt-3" data-testid="maybe">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground">
                    <ListFilter aria-hidden="true" />
                    Maybe — {maybe.length} lower-confidence finding{maybe.length !== 1 ? "s" : ""} (unchecked)
                    <ChevronDown aria-hidden="true" className={cn("transition-transform", maybeOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>{maybe.map(renderFinding)}</CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
        <SectionTabs sections={sections} />
        {rev.count > 0 && (
          <CommitBar
            staged={selected.size}
            inline={selInline}
            summary={selOff}
            unknown={selUnknown}
            dryRun={data.dryRun}
            posted={posted}
            postedAs={me.login}
            postedNow={postedNow}
            ghUrl={data.ghUrl}
            onPost={submitPost}
            requestChanges={requestChanges}
            onRequestChanges={setRequestChanges}
            postLabel={rev.postLabel}
            busy={busy}
            stale={stale}
            maxPerPost={maxPerPost}
          />
        )}
      </div>
    </>
  );
}

function ApprovedBody({
  a,
  ghUrl,
  reviewers,
}: {
  a: NonNullable<PrData["approved"]>;
  ghUrl: string;
  reviewers?: ReviewersData | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <StatusBadge kind="approved" className="whitespace-normal text-left">
          {a.manual ? "Marked as approved" : "Approved"} on {a.at} ({a.ago})
          {!a.manual && <> as {a.user}</>}
        </StatusBadge>
      </div>
      {a.body && !a.manual && (
        <div>
          <p className="mb-1 mt-0 text-xs text-muted-foreground">Comment posted with the approval:</p>
          <pre className="m-0">
            <code>{a.body}</code>
          </pre>
        </div>
      )}
      <div>
        <Button asChild variant="secondary">
          <a href={ghUrl} target="_blank" rel="noopener" className="hover:no-underline">
            <ExternalLink aria-hidden="true" />
            View on GitHub
          </a>
        </Button>
      </div>
      {reviewers && <Reviewers data={reviewers} />}
    </div>
  );
}

function RerunBody({ data, onDone }: { data: PrData; onDone: () => void }) {
  return (
    <div id="rerun" className="flex flex-col gap-3">
      <p className="m-0 text-xs text-muted-foreground">
        Run it again — a fresh effort level or a focus note. The current review is kept in history below.
      </p>
      <RunForm
        pr={refOf(data)}
        token={data.tokens.review}
        form={data.runForm}
        label="Re-run review"
        connected={data.claudeConnected}
        onStarted={onDone}
      />
      <HistoryList pr={refOf(data)} runs={data.history} />
    </div>
  );
}

// Breadcrumbs: Queue / repository pill / #123. Clicking the repo crumb filters the queue to it.
const Sep = ({ className }: { className?: string }) => (
  <ChevronRight aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground/60", className)} />
);
export function Crumbs({ repo, num, tail, linkNum }: { repo: string; num: string; tail?: React.ReactNode; linkNum?: boolean }) {
  return (
    <nav aria-label="Breadcrumb" data-testid="crumbs" className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {/* On a phone the navigation bar's back button is the way back; the repository stays. */}
      <Link to="/" className="text-muted-foreground hover:text-foreground max-[899px]:hidden">
        Queue
      </Link>
      {repo && (
        <>
          <Sep className="max-[899px]:hidden" />
          <Link to="/" className="hover:no-underline" onClick={() => setRepoFilter(repo)} title="Filter the queue to this repository">
            <RepoPill repo={repo} />
          </Link>
        </>
      )}
      {/* The bar's title is the number on a phone; only the repository is new information. */}
      <Sep className={tail ? undefined : "max-[899px]:hidden"} />
      {tail || linkNum ? (
        <Link to={prUrl({ repo, num })} className="text-muted-foreground hover:text-foreground">
          #{num}
        </Link>
      ) : (
        <span className="text-foreground max-[899px]:hidden">#{num}</span>
      )}
      {tail && (
        <>
          <Sep />
          <span className="text-foreground">{tail}</span>
        </>
      )}
    </nav>
  );
}

// The one title pattern: the number in the accent, then the title. The repository lives in the
// breadcrumb pill above, never in the title. The Stack page reuses it.
export function PrTitle({ num, title }: { num: string; title: string }) {
  return (
    <>
      <span className="text-primary">#{num}</span>
      {title ? <> {title}</> : null}
    </>
  );
}

// The one Actions menu, in place of the three side cards.
function ActionsMenu({ data }: { data: PrData }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Actions"
          title="Actions"
          data-testid="pr-actions"
          className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground max-[899px]:size-[44px]"
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" data-testid="pr-actions-menu">
        <DropdownMenuItem asChild className={cn(ITEM, "text-foreground hover:no-underline")}>
          <a href={data.ghUrl} target="_blank" rel="noopener">
            <ExternalLink aria-hidden="true" />
            Open on GitHub
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={cn(ITEM, "text-foreground hover:no-underline")}>
          <Link to={prUrl(refOf(data), "/qa")}>
            <ClipboardCheck aria-hidden="true" />
            QA guide
          </Link>
        </DropdownMenuItem>
        {data.stack?.isStack && (
          <DropdownMenuItem asChild className={cn(ITEM, "text-foreground hover:no-underline")}>
            <Link to={prUrl(refOf(data), "/stack")}>
              <Layers aria-hidden="true" />
              Stacked review ({data.stack.size} PRs)
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeaderTop({ data, tail }: { data: PrData; tail?: React.ReactNode }) {
  return (
    <>
      <Crumbs repo={data.repo} num={data.pr} tail={tail} />
      <PageHeader title={<PrTitle num={data.pr} title={data.title} />} className="mb-3 items-start" keepOnPhone>
        <div className="ml-auto shrink-0">
          <ActionsMenu data={data} />
        </div>
      </PageHeader>
    </>
  );
}

// One status line under the title. Every condition that used to be a banner is a badge with a
// glyph and a word here, ordered by what the reviewer must act on: things that block or mislead
// an approval first, then the flags, then where the PR stands, then plain facts. The full
// sentence each banner carried is the item's title.
function statusItems(data: PrData, postedNow: boolean): StatusItem[] {
  const rev = data.review;
  const items: StatusItem[] = [];
  if (headMovedOf(rev)) {
    items.push({
      key: "head-moved",
      tone: "amber",
      icon: GitBranch,
      word: "Branch moved",
      testid: "status-head-moved",
      title:
        `The branch has moved since this review ran — the verdict was written against ` +
        `${rev!.approve!.reviewedHead!.slice(0, 7)}, GitHub is now at ` +
        `${rev!.approve!.currentHead!.slice(0, 7)}. Approving needs the confirmation in Approve.`,
    });
  }
  if (data.stale) {
    items.push({
      key: "stale",
      tone: "amber",
      icon: GitCommitHorizontal,
      word: "New commits since review",
      testid: "status-stale",
      title: "The author pushed new commits since this review. The findings may be out of date — re-run.",
    });
  }
  if (!data.claudeConnected) {
    items.push({
      key: "claude",
      tone: "amber",
      icon: Unplug,
      word: "Claude not connected",
      testid: "status-claude",
      to: "/integrations",
      title: "Reviews run on your own Claude subscription. Connect it on Integrations to run one here.",
    });
  }
  if (rev?.anchorsUnknown) {
    items.push({
      key: "anchors",
      tone: "amber",
      icon: MapPinOff,
      word: "Placement unknown",
      testid: "anchors-unknown",
      title:
        "Where these comments will land could not be checked. GitHub would not say which lines " +
        "this PR touches, so this is not a claim that the findings sit outside the diff — it is " +
        "simply unknown. Each one goes inline if its line is in the diff, and into the review " +
        "body if it is not." +
        (rev.anchorError ? ` The check failed with: ${rev.anchorError}.` : ""),
    });
  }
  if (rev?.truncated) {
    items.push({
      key: "truncated",
      tone: "amber",
      icon: ListFilter,
      word: `Showing ${rev.truncated.shown.toLocaleString("en-US")} of ${rev.truncated.total.toLocaleString("en-US")} findings`,
      testid: "truncated",
      title:
        "This run produced more than one page — and one review — should carry, so the rest were " +
        "not rendered and cannot be posted from here. Re-run with a focus to narrow it.",
    });
  }
  if (rev?.preselectCapped) {
    items.push({
      key: "precap",
      tone: "amber",
      icon: ListChecks,
      word: `Pre-selection capped at ${rev.preselectCapped.max}`,
      testid: "preselect-capped",
      title: rev.preselectCapped.note,
    });
  }
  for (const r of data.risk) {
    items.push({ key: `risk-${r.title}`, tone: "amber", icon: ShieldAlert, word: r.title, title: r.note });
  }
  if (data.stopped) {
    items.push({
      key: "stopped",
      tone: "amber",
      kind: "stopped",
      word: "Review stopped",
      title: data.stopped.halted
        ? "No agent is running — Claude usage has halted. Start a new run below."
        : "A process may still be running. Start a new run below.",
    });
  }
  if (data.dryRun) {
    items.push({
      key: "dry",
      tone: "amber",
      kind: "dry",
      word: "Dry run",
      testid: "status-dry",
      title: "Dry run — the buttons on this page do not write to GitHub.",
    });
  }
  if (data.canApprove === false) {
    items.push({
      key: "prstate",
      tone: data.merged ? "green" : "graphite",
      kind: data.merged ? "merged" : "closed",
      word: data.merged ? "Merged" : "Closed",
      testid: "pr-state",
      title: data.merged
        ? "This pull request is merged. GitHub will not take an approval on it, and comments " +
          "posted now cannot be acted on. The review below is kept for the record."
        : "This pull request is closed. An approval on it would not be actionable. Reopen it on " +
          "GitHub if you still want to sign off.",
    });
  }
  if (data.state && !data.stopped) {
    const kind = postedNow && data.state === "done" ? "posted" : data.state;
    items.push({ key: "state", tone: toneOfState(kind), kind, word: wordOf(kind), testid: "review-state" });
  }
  if (data.focus && data.state === "done") {
    items.push({
      key: "focus",
      tone: "graphite",
      icon: Crosshair,
      word: "Focused review",
      title: `You asked ReviewStage to focus on: “${data.focus}”.`,
    });
  }
  if (rev?.reused) {
    items.push({
      key: "reused",
      tone: "graphite",
      icon: RefreshCw,
      word: "Reused earlier run",
      title: "Reused your earlier run of this exact configuration on this commit — 0 new tokens.",
    });
  }
  if (!data.awaiting) {
    items.push({ key: "awaiting", tone: "graphite", icon: EyeOff, word: "Not awaiting your review" });
  }
  return items;
}
function StatusLine({ data, postedNow }: { data: PrData; postedNow: boolean }) {
  const items = statusItems(data, postedNow);
  const meta: React.ReactNode[] = [];
  if (data.author)
    meta.push(
      <span className="inline-flex items-center gap-1.5" data-testid="pr-author">
        <UserAvatar login={data.author} size="sm" className="size-5" />
        {data.author}
      </span>,
    );
  if (data.size) meta.push(data.size);
  if (data.effortBadge) meta.push(<span title={data.effortBadge.hint}>{data.effortBadge.label}</span>);
  if (data.usage) meta.push(<span title={usageTitle(data.usage)}>{usageChip(data.usage)}</span>);
  if (data.runner)
    meta.push(`Ran on ${data.runner !== "shared" ? `${data.runner}'s` : "the shared team"} Claude account`);
  const steps = data.timeline.map((s) =>
    postedNow && s.label === "Comments posted" ? { ...s, done: true, note: s.note || "just now" } : s,
  );
  return (
    <>
      <StatusLineView
        items={items}
        meta={meta}
        testid="status-line"
        link={(to, child, title) => (
          <Link to={to} title={title} className="hover:no-underline">
            {child}
          </Link>
        )}
      />
      <Steps steps={steps} />
    </>
  );
}

// A loading PR in the shape of the page: breadcrumb, title, status line, two cards.
function PrSkeleton() {
  return (
    <div className="prpage" aria-busy="true" data-testid="pr-loading">
      <span className="sr-only" role="status">
        Loading this pull request
      </span>
      <Skeleton className="mb-3 h-3.5 w-48" />
      <Skeleton className="mb-3 h-7 w-3/4 max-w-[560px]" />
      <div className="mb-5 flex gap-2">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-32 rounded-full" />
      </div>
      {[0, 1].map((i) => (
        <Card key={i} className="mt-3 gap-0 border-0 py-0 shadow-sm">
          <div className="flex items-center gap-2 px-4 py-3">
            <Skeleton className="size-[18px] rounded-[4px]" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="ml-auto h-5 w-44 rounded-full" />
          </div>
          <div className="flex flex-col gap-2 px-4 pb-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  );
}

// A run card: "Not reviewed here", "Review stopped", the stalled re-run — a title, a line, the form.
function RunCard({ title, description, children, testid }: { title?: string; description?: React.ReactNode; children: React.ReactNode; testid?: string }) {
  return (
    <Card className="mt-3 gap-3 border-0 py-4 shadow-sm" data-testid={testid}>
      {title && (
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

export function PrPage({ me }: { me: Me }) {
  const { search } = useLocation();
  const num = search.get("pr") || "";
  const repo = search.get("repo") || "";
  const v = search.get("v") || "";
  const pr: PrRef = { repo, num };
  const [data, setData] = useState<PrData | null>(null);
  const [pick, setPick] = useState<string[] | null>(null); // repos to choose from (ambiguous link)
  const [err, setErr] = useState("");
  const [postedNow, setPostedNow] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const phone = useIsPhone();

  const load = useCallback(() => {
    if (!num) return;
    api
      .pr(pr, v || undefined)
      .then((d) => {
        setPick(null);
        setErr("");
        setData(d);
      })
      .catch((e: unknown) => {
        // A legacy /pr?pr=N link on a multi-repo install: the server cannot place the number, so
        // it hands back the candidates and we let the reviewer pick.
        if (e instanceof ApiError && Array.isArray(e.data.repos) && e.data.error === "ambiguous repo") {
          setPick(e.data.repos as string[]);
        } else {
          setErr(e instanceof Error ? e.message : "Could not load this PR.");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, num, v]);

  useEffect(() => {
    setData(null);
    setPostedNow(false);
    load();
  }, [load]);

  // Auto-refresh while a review is in progress.
  useEffect(() => {
    window.clearInterval(timer.current);
    if (data && (data.state === "reviewing" || data.state === "queued")) {
      timer.current = window.setInterval(load, 4000);
    }
    return () => window.clearInterval(timer.current);
  }, [data, load]);

  if (pick) {
    const repos = pick.length ? pick : me.repos || [];
    return (
      <div className="prpage">
        <Crumbs repo="" num={num} />
        <PageHeader title={`Which repository is #${num} in?`} keepOnPhone />
        <Card className="gap-0 border-0 py-0 shadow-sm" data-testid="repo-pick">
          <p className="m-0 px-4 py-3 text-sm text-muted-foreground">
            This link names a PR number but not a repository, and this ReviewStage reviews several.
            Pick one to continue.
          </p>
          <div className="divide-y divide-border">
            {repos.map((r) => (
              <Link
                key={r}
                className="flex min-h-[44px] items-center gap-2 px-4 py-2 text-inherit hover:bg-accent/40 hover:no-underline"
                to={prUrl({ repo: r, num })}
              >
                <RepoPill repo={r} />
                <span className="text-sm font-medium text-primary">#{num}</span>
                <ChevronRight aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    );
  }
  if (err)
    // The frame stays: breadcrumb, the reference as typed, and a way back or on. The error is
    // the one line the empty state carries.
    return (
      <div className="prpage" data-testid="pr-unknown">
        <Crumbs repo={repo} num={num} />
        <PageHeader title={<PrTitle num={num} title="" />} className="mb-3" keepOnPhone />
        <Card className="border-0 py-0 shadow-sm">
          <EmptyState
            icon={SearchX}
            title="Couldn't load this PR"
            action={
              <div className="flex flex-wrap justify-center gap-2" data-testid="unknown-actions">
                <Button asChild variant="secondary">
                  <Link to="/" className="hover:no-underline">
                    Back to queue
                  </Link>
                </Button>
                <Button variant="ghost" type="button" onClick={openPalette}>
                  Try another
                </Button>
              </div>
            }
          >
            <p className="m-0 text-foreground" data-testid="pr-error">
              {err}
            </p>
            <p className="mb-0 mt-2">
              If this came from the queue, the queue and GitHub disagree about it — check the number
              and the repository.
            </p>
          </EmptyState>
        </Card>
      </div>
    );
  if (!data) return phone ? <PhonePrSkeleton /> : <PrSkeleton />;

  if (data.historyView) {
    return (
      <div className="prpage">
        <HeaderTop data={data} tail="earlier run" />
        <StatusLineView
          testid="status-line"
          items={[{ key: "when", tone: "graphite", icon: History, word: `Earlier run from ${data.when}` }]}
          meta={[<Link to={prUrl(refOf(data))}>Back to the current review</Link>]}
        />
        <h2>Assessment</h2>
        <Md className="max-w-[72ch] text-[15px] leading-relaxed">{data.summary || ""}</Md>
        <h2>Findings ({data.findings?.length || 0})</h2>
        {(data.findings || []).map((f, i) => (
          <Card key={i} className={cn("mt-3 gap-2 border-0 border-l-[3px] py-3 shadow-sm", SEV_BORDER[toneOfState(f.severity)])}>
            <div className="flex flex-wrap items-center gap-2 px-4">
              <StatusBadge kind={f.severity} />
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {f.path}:{f.line}
              </Badge>
            </div>
            <Md className="px-4 text-sm leading-relaxed">{f.body}</Md>
          </Card>
        ))}
      </div>
    );
  }

  // The one full-width banner for a state that is not a review: a run that died, or one that
  // failed to start.
  const runError = data.stalled ? (
    <Banner kind="err" data-testid="stalled-banner">
      <b>The review stopped before it finished.</b> It was at <code>{data.stalled.was}</code>. Re-run below.
      {data.stalled.pidAlive && (
        <>
          {" "}
          A process from that run is still alive.{" "}
          <StopStalled pr={pr} token={data.tokens.stop} onDone={load} />
        </>
      )}
    </Banner>
  ) : data.notReviewed && !data.approved && data.failed ? (
    <Banner kind="err">{data.failed}</Banner>
  ) : null;

  const dead = data.canApprove === false;
  const runForm = (label: string) => (
    <RunForm
      pr={pr}
      token={data.tokens.review}
      form={data.runForm}
      label={label}
      connected={data.claudeConnected}
      onStarted={load}
    />
  );

  return (
    <div className="prpage max-[899px]:pb-[88px]">
      {phone ? (
        <>
          <PhonePrHeader data={data} postedNow={postedNow} />
          {/* Without a review the ⋯ sheet has only the links; ReviewBody adds Approve and Re-run. */}
          {!data.review && <PrActionSheet data={data} sections={[]} />}
        </>
      ) : (
        <>
          <HeaderTop data={data} />
          <StatusLine data={data} postedNow={postedNow} />
        </>
      )}
      {runError}
      {data.reviewing && <ProgressPanel pr={pr} data={data} onStop={load} />}
      {data.stopped && (
        <>
          <RunCard
            title="Review stopped"
            description={
              <>
                {data.stopped.halted ? "No agent is running — Claude usage has halted." : "A process may still be running."}{" "}
                Start a new run below.
              </>
            }
          >
            {runForm("Start review")}
          </RunCard>
          <HistoryList pr={pr} runs={data.history} />
        </>
      )}
      {data.stalled && (
        <>
          <RunCard>{runForm("Re-run review")}</RunCard>
          <HistoryList pr={pr} runs={data.history} />
        </>
      )}
      {data.notReviewed && !data.approved && (
        <>
          {dead ? (
            // Merged or closed on GitHub and never reviewed here: a run would only be for the
            // record, so the state leads and the form follows.
            <Card className="mt-3 border-0 py-0 shadow-sm" data-testid="pr-dead">
              <EmptyState
                icon={data.merged ? GitMerge : GitPullRequestClosed}
                title={data.merged ? "Merged on GitHub" : "Closed on GitHub"}
                action={
                  <Button asChild variant="secondary">
                    <a href={data.ghUrl} target="_blank" rel="noopener" className="hover:no-underline">
                      <ExternalLink aria-hidden="true" />
                      Open on GitHub
                    </a>
                  </Button>
                }
              >
                {data.merged
                  ? "GitHub will not take an approval on it, and comments posted now cannot be acted on."
                  : "An approval on it would not be actionable. Reopen it on GitHub if you still want to sign off."}
              </EmptyState>
            </Card>
          ) : null}
          <RunCard
            title={dead ? "Review it anyway" : "Not reviewed here"}
            description={dead ? "For the record — nothing here reaches the merge." : "No review has been run for this PR on this box."}
          >
            {runForm("Run review")}
          </RunCard>
          <HistoryList pr={pr} runs={data.history} />
          {data.reviewers && (
            <Card className="mt-3 gap-0 border-0 py-2 shadow-sm">
              <CardContent className="px-4">
                <Reviewers data={data.reviewers} />
              </CardContent>
            </Card>
          )}
        </>
      )}
      {data.notReviewed && data.approved && (
        <Card className="mt-3 gap-0 border-0 py-4 shadow-sm">
          <CardContent className="px-4">
            <ApprovedBody a={data.approved} ghUrl={data.ghUrl} reviewers={data.reviewers} />
          </CardContent>
        </Card>
      )}
      {data.review && (
        <ReviewBody data={data} me={me} onDone={load} onPosted={() => setPostedNow(true)} />
      )}
    </div>
  );
}
