import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleX,
  Compass,
  GitBranch,
  Lightbulb,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Target,
} from "lucide-react";
import {
  api,
  ApiError,
  errBanner,
  errMessage,
  type ProfileData,
  type RuleSuggestion,
  type SkillsData,
  type SkillStat,
  type Token,
} from "./api";
import { MdEditor } from "./MdEditor";
import { Banner, EmptyState, PageHeader, RawBanner, RepoPill, SlowBusy, StatusBadge } from "./ui";
import { useIsPhone } from "./theme";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// Fallback only: every stat the server sends carries its own sample floor, and one definition
// of "enough data to rate" ships in this product.
const RATE_FLOOR = 20;
const floorOf = (s: SkillStat) => s.minSample ?? RATE_FLOOR;
const ratable = (s: SkillStat) => s.ratable ?? s.total >= floorOf(s);

const H2 = "mb-2 mt-6 text-sm font-medium";
const ROW = "flex flex-wrap items-center gap-2";

// A small label-above-control stack and a section heading, both plain utilities.
function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <>
      <h2 className={H2}>{title}</h2>
      {children}
    </>
  );
}

// The skill editor: a plain <textarea> for a11y and for the tests, laid over a <pre> mirror that
// draws the line numbers and marks the managed "## Team rules" section. Both carry the same
// metrics (CODE), so the caret lands exactly on the mirrored glyph. The only monospace on the
// page: this is a code surface.
const RULES_MARKER = "## Team rules";
const CODE = "m-0 font-mono text-[13px] leading-[1.6] tracking-normal whitespace-pre-wrap [overflow-wrap:anywhere] [tab-size:4]";
const GUTTER = "3.5rem";
function CodeArea({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
}) {
  const lines = value.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === RULES_MARKER);
  let end = lines.length;
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
  }
  return (
    <Card
      className="relative gap-0 overflow-hidden rounded-lg bg-background py-0 shadow-none transition-[box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
      data-testid="code-area"
      style={{ "--gutter": GUTTER } as React.CSSProperties}
    >
      <pre
        className={cn(CODE, "codearea-mirror min-h-[180px] overflow-visible rounded-none border-0 bg-transparent p-0 py-2.5 text-foreground")}
        aria-hidden="true"
      >
        {lines.map((l, i) => {
          const rules = start >= 0 && i >= start && i < end;
          return (
            <div
              key={i}
              className={cn(
                "ln relative min-h-[1.6em] border-l-2 border-l-transparent pl-[var(--gutter)] pr-3",
                "before:absolute before:left-0 before:top-0 before:w-[calc(var(--gutter)-14px)] before:select-none before:text-right before:text-muted-foreground before:tabular-nums before:content-[attr(data-n)]",
                rules && "is-rules border-l-primary bg-primary/8",
                i === start && "is-rules-h text-primary",
              )}
              data-n={i + 1}
            >
              {l || "​"}
            </div>
          );
        })}
      </pre>
      <textarea
        className={cn(
          CODE,
          "fedit absolute inset-0 h-full min-h-0 w-full resize-none overflow-hidden rounded-none border-0 border-l-2 border-l-transparent bg-transparent py-2.5 pl-[var(--gutter)] pr-3 text-transparent caret-foreground outline-none placeholder:text-muted-foreground",
        )}
        aria-label={label}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </Card>
  );
}

function RuleForm({
  token,
  target,
  onDone,
}: {
  token: Token;
  target: string; // "global" | "me" | "repo:<owner/name>"
  onDone: (b: string) => void;
}) {
  const [rule, setRule] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `quick-rule-${target.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <form
      className="mt-5 flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!rule.trim() || busy) return;
        setBusy(true);
        try {
          const r = await api.skillAction("rule", { ...token, target, from: "skills", rule });
          setRule("");
          onDone(r.bannerHtml);
        } catch (x) {
          onDone(errBanner(x, "Couldn't add that rule."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Label htmlFor={id} className="basis-full text-xs text-muted-foreground">
        Quick-add a rule
      </Label>
      <Input
        id={id}
        className="min-w-[200px] flex-1"
        autoComplete="off"
        placeholder="e.g. Don’t ask for a Jira ticket link in code comments"
        value={rule}
        onChange={(e) => setRule(e.target.value)}
      />
      <Button variant="secondary" type="submit" disabled={busy}>
        <Plus aria-hidden="true" />
        {busy ? "Adding…" : "Add rule"}
      </Button>
    </form>
  );
}

function SkillEditor({
  token,
  target,
  value,
  onDone,
  builtinAvailable,
}: {
  token: Token;
  target: string; // "global" | "me" | "repo:<owner/name>"
  value: string;
  onDone: (b: string) => void;
  // Whether the shipped skill exists on this box. Without it "Restore built-in" has nothing to
  // restore, and offering the button is a promise the server cannot keep.
  builtinAvailable?: boolean;
}) {
  const [text, setText] = useState(value);
  const [confirm, setConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(value), [value]);
  // One wrapper for every write on this card: a rejection becomes a banner, never a dead button.
  const act = async (fn: () => Promise<{ bannerHtml: string }>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    try {
      onDone((await fn()).bannerHtml);
    } catch (x) {
      onDone(errBanner(x, fallback));
    } finally {
      setBusy(false);
    }
  };
  const isGlobal = target === "global";
  const isRepo = target.startsWith("repo:");
  const repoName = isRepo ? target.slice(5) : "";
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () => api.skillAction("save", { ...token, target, from: "skills", skill: text }),
            "Couldn't save the skill.",
          );
        }}
      >
        <CodeArea
          label={isGlobal ? "Team default skill" : isRepo ? `Team default for ${repoName}` : "My own skill"}
          value={text}
          onChange={setText}
          placeholder={
            isGlobal
              ? "The shared reviewing approach — edit it right here."
              : isRepo
                ? `A reviewing approach just for ${repoName} — leave blank to use the team default.`
                : "Paste your pr-review SKILL.md here — or leave blank to use the team default."
          }
        />
        <div className={cn(ROW, "mt-3")}>
          <Button type="submit" disabled={busy}>
            <Save aria-hidden="true" />
            {busy ? "Saving…" : "Save skill"}
          </Button>
          {!isGlobal && value && (
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() =>
                act(() => api.skillAction("reset", { ...token, target, from: "skills" }), "Couldn't clear it.")
              }
            >
              {isRepo ? "Clear override (use team default)" : "Clear (use team default)"}
            </Button>
          )}
          {isGlobal && builtinAvailable !== false && (
            <Button variant="ghost" type="button" disabled={busy} onClick={() => setRestoring(true)}>
              <RotateCcw aria-hidden="true" />
              Restore built-in
            </Button>
          )}
        </div>
      </form>
      {isGlobal && builtinAvailable !== false && (
        <Dialog open={restoring} onOpenChange={(o) => { setRestoring(o); if (!o) setConfirm(""); }}>
          <DialogContent>
            <form
              className="contents"
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  const r = await api.skillAction("restore", { ...token, target: "global", from: "skills", confirm });
                  setConfirm("");
                  setRestoring(false);
                  return r;
                }, "Couldn't restore the built-in skill.");
              }}
            >
              <DialogHeader>
                <DialogTitle>Restore the built-in skill?</DialogTitle>
                <DialogDescription>
                  Discards the team's edits and reverts everyone to the built-in review skill.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Label htmlFor="restore-confirm">Type <b>restore</b> to confirm</Label>
                <Input
                  id="restore-confirm"
                  autoComplete="off"
                  autoFocus
                  placeholder="restore"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" type="button" onClick={() => setRestoring(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" type="submit" disabled={busy || confirm.trim() !== "restore"}>
                  {busy ? "Restoring…" : "Restore"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      <RuleForm token={token} target={target} onDone={onDone} />
    </>
  );
}

function DepthEditor({ token, level, d, onDone }: {
  token: Token;
  level: string;
  d: SkillsData["depths"][string];
  onDone: (b: string) => void;
}) {
  const [text, setText] = useState(d.content);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(d.content), [d.content]);
  const act = async (fn: () => Promise<{ bannerHtml: string }>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    try {
      onDone((await fn()).bannerHtml);
    } catch (x) {
      onDone(errBanner(x, fallback));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="depth-editor">
      <div className={cn(ROW, "mb-3 min-h-9")}>
        <span className="text-sm font-medium">{d.name}</span>
        <span className="text-xs text-muted-foreground">{d.meta}</span>
        <StatusBadge kind={d.edited ? "edited" : "archived"}>{d.edited ? "Edited" : "Default"}</StatusBadge>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () => api.skillAction("save", { ...token, target: `effort_${level}`, from: "skills", skill: text }),
            "Couldn't save that depth.",
          );
        }}
      >
        <CodeArea label={`${d.name} depth instructions`} value={text} onChange={setText} />
        <div className={cn(ROW, "mt-3")}>
          <Button type="submit" disabled={busy}>
            <Save aria-hidden="true" />
            {busy ? "Saving…" : "Save depth"}
          </Button>
          {d.edited && (
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() =>
                act(
                  () => api.skillAction("reset", { ...token, target: `effort_${level}`, from: "skills" }),
                  "Couldn't reset that depth.",
                )
              }
            >
              <RotateCcw aria-hidden="true" />
              Reset to default
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

// A row of small disclosure: a ghost button with a chevron that turns, and the content under it.
function Disclosure({
  label,
  children,
  testId,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid={testId} className={className}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <ChevronDown aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
          {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

const fmtWhen = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-US", {
    month: "2-digit", day: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });

// One repository's profile: the critical paths, risk paths and rules every Standard/Deep review
// of it is told to walk. Built by bin/profile-repo.sh (one Sonnet call), editable here as
// markdown, re-buildable by hand or automatically when the file tree changes materially.
function RepoProfile({ repo, onBanner }: { repo: string; onBanner: (b: string) => void }) {
  const [d, setD] = useState<ProfileData | null>(null);
  const [md, setMd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  // An earlier version being read, or null for the live profile. Reading one does not change
  // anything; Restore is a separate, explicit click.
  const [viewing, setViewing] = useState<ProfileData | null>(null);
  // The server refuses an edit that empties a section that was not empty — the markdown round
  // trip loses a whole section to one retitled heading, and it used to save silently. Confirming
  // is the only way through, so the refusal has to leave a button behind.
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const load = useCallback(
    () =>
      api
        .profile(repo)
        .then((p) => {
          setErr("");
          setD(p);
          setMd(p.md);
        })
        .catch((e: unknown) => setErr(errMessage(e, `Couldn't load the profile for ${repo}.`))),
    [repo]
  );
  useEffect(() => {
    load();
  }, [load]);
  // Poll while a build runs so the phase list advances without a reload.
  useEffect(() => {
    if (d?.state !== "running") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [d?.state, load]);

  const head = (badges: ReactNode, body: ReactNode) => (
    <Card className="gap-0 py-0" data-testid="repo-profile">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-[52px] w-full flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-testid="profile-toggle"
          >
            <span className={ROW} data-testid="profile-head">
              <RepoPill repo={repo} />
              {badges}
            </span>
            <ChevronDown aria-hidden="true" className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-4 pb-4 pt-3 text-sm">{body}</CollapsibleContent>
      </Collapsible>
    </Card>
  );

  if (!d) {
    return head(
      err ? <StatusBadge tone="red">Unavailable</StatusBadge> : <StatusBadge tone="graphite" live>Loading</StatusBadge>,
      err ? (
        <Banner kind="err" role="alert" data-testid="profile-error">{err}</Banner>
      ) : (
        <Skeleton className="h-4 w-2/3" />
      ),
    );
  }

  const act = async (fn: () => Promise<ProfileData>) => {
    setBusy(true);
    try {
      const r = await fn();
      setD(r);
      setMd(r.md);
      if (r.bannerHtml) onBanner(r.bannerHtml);
      // A click while a build is alive is "already running" — the card keeps its Profiling
      // view (r.state is "running"); only a click that started nothing for another reason is
      // an error.
      else if (r.started === false && r.state === "running")
        onBanner(
          `<div class='banner warn'><div>Already profiling this repository — that click did not start a second build.</div></div>`
        );
      else if (r.started === false && r.reason)
        onBanner(`<div class='banner err'><div>Not started: ${r.reason}.</div></div>`);
    } catch (e) {
      onBanner(
        `<div class='banner err'><div>${(e as Error).message || "That didn't work."}</div></div>`
      );
    } finally {
      setBusy(false);
    }
  };
  const tag =
    d.state === "running" ? (
      <StatusBadge tone="amber" live>Profiling</StatusBadge>
    ) : d.state === "done" ? (
      <StatusBadge tone="green">Profiled</StatusBadge>
    ) : d.state === "failed" ? (
      <StatusBadge tone="red">Failed</StatusBadge>
    ) : (
      <StatusBadge tone="graphite" icon={Circle}>Never run</StatusBadge>
    );
  const usage = d.last?.usage;
  const c = d.counts;
  const running = d.state === "running";
  const meta = d.json?.meta;
  // A profile saved with no base clone was never checked against a real tree, yet reviews read
  // it as ground truth. `canValidate` is about future saves; meta.validated about this one.
  const unchecked = meta?.validated === false;
  const st = d.stale;
  // Drifted: the checkout has moved on, or globs that once matched now match nothing. Null
  // means there was no clone to compare with — never render that as "fresh".
  const drifted = !!st?.stale;
  const capped = meta?.capped_critical_paths ?? 0;
  const degraded = meta?.degraded ?? [];
  const hint = "text-xs text-muted-foreground";

  const status = (
    <div className={cn(ROW, "mb-3 text-sm text-muted-foreground")} data-testid="profile-status">
      {d.state === "running" && d.running ? (
        <>
          <Loader2 aria-hidden="true" className="size-4 animate-spin text-amber motion-reduce:animate-none" />
          <span>
            {d.running.queued
              ? "Queued — waiting for another job to finish"
              : `${d.running.phases[d.running.cur]} (${d.running.cur + 1}/${d.running.phases.length})`}
          </span>
          <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => act(() => api.profileStop(repo, d.token))}>
            Stop
          </Button>
        </>
      ) : d.state === "done" && d.last ? (
        <>
          <CircleCheck aria-hidden="true" className="size-4 text-green" />
          <span>
            Last run {d.last.when}
            {d.last.model ? ` · ${d.last.model}` : ""}
            {usage ? ` · ${usage.tokens.toLocaleString("en-US")} tokens` : ""}
            {d.last.runner && d.last.runner !== "shared" ? ` · on ${d.last.runner}'s account` : ""}
            {d.last.editedBy ? ` · edited by ${d.last.editedBy}` : ""}
          </span>
        </>
      ) : d.state === "failed" ? (
        <>
          <CircleX aria-hidden="true" className="size-4 text-red" />
          <span>The last run failed.</span>
        </>
      ) : (
        <>
          <Circle aria-hidden="true" className="size-4" />
          <span>{d.stopped ? "Stopped before it finished." : "Never run."}</span>
        </>
      )}
    </div>
  );

  return head(
    <>
      {tag}
      {drifted && <StatusBadge kind="stale" data-testid="profile-stale">Stale</StatusBadge>}
      {d.invalid && <StatusBadge tone="red">Unreadable</StatusBadge>}
    </>,
    <>
      {d.invalid && (
        <Banner kind="err" role="alert" data-testid="profile-invalid">
          <b>This repository's profile.json could not be read, so no review is using it:</b>{" "}
          {d.invalid}. Fix the file on the box, or re-profile to replace it.
        </Banner>
      )}
      {drifted && st && (
        <Banner kind="warn" data-testid="profile-stale-note">
          <b>This profile is out of date with the checkout.</b>{" "}
          {st.head !== st.currentHead && (
            <>
              Built against <code>{st.head}</code>; the clone is now at <code>{st.currentHead}</code>
              {st.commitsBehind ? `, ${st.commitsBehind.toLocaleString("en-US")} commit(s) later` : ""}.{" "}
            </>
          )}
          {st.unmatchedPaths > 0 && (
            <>
              {st.unmatchedPaths.toLocaleString("en-US")} of {st.criticalPaths.toLocaleString("en-US")} critical
              path(s) no longer match anything in the tree — those are dead weight in every review of this repo
              until it is re-profiled or edited.
            </>
          )}
        </Banner>
      )}
      {unchecked && (
        <Banner kind="warn" data-testid="profile-unvalidated">
          <b>These paths were never checked against the repository.</b> The profile was saved with no clone of{" "}
          <code>{repo}</code> on this box, so nothing confirmed the globs match real files — and reviews are
          handed it as fact.
          {meta?.validated_note ? <> ({meta.validated_note})</> : null}
        </Banner>
      )}
      {degraded.length > 0 && (
        <p className={cn(hint, "my-2")} data-testid="profile-degraded">
          Some signals were not gathered when this was built, so it was written from less than the full picture:{" "}
          {degraded.join("; ")}.
        </p>
      )}
      {capped > 0 && (
        <p className={cn(hint, "my-2")} data-testid="profile-capped">
          {capped.toLocaleString("en-US")} further critical path(s) were over the cap and were not stored.
        </p>
      )}
      {status}

      {d.failed && d.state !== "running" && (
        <Banner kind="err" role="alert" data-testid="profile-error">
          <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{d.failed}</div>
          {d.logTail && d.logTail.length > 0 && (
            <Disclosure label={`Last ${d.logTail.length} lines of the log`} testId="profile-log" className="mt-1">
              <pre className="mt-1 max-h-[260px] overflow-auto whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">
                {d.logTail.join("\n")}
              </pre>
            </Disclosure>
          )}
        </Banner>
      )}

      {c && (
        <div className={cn(hint, "mb-3 tabular-nums")} data-testid="profile-counts">
          {c.critical} critical paths · {c.risk} risk paths · {c.rules} review rules · {c.doNotFlag} do-not-flag
          {d.sections?.summary === 0 ? " · no summary" : ""}
        </div>
      )}
      {d.unknownHeadings && d.unknownHeadings.length > 0 && (
        <Banner kind="err" role="alert" data-testid="profile-unknown-headings">
          <b>Heading(s) the parser did not recognise, so nothing under them was saved:</b>{" "}
          {d.unknownHeadings.join(", ")}.
        </Banner>
      )}
      {d.versions.length > 0 && (
        <Disclosure
          label={`${d.versions.length} earlier version${d.versions.length === 1 ? "" : "s"}`}
          testId="profile-versions"
          className="mb-3"
        >
          <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
            {d.versions.map((ts) => (
              <li key={ts} className={ROW}>
                <span className="min-w-[11rem] text-xs text-muted-foreground tabular-nums">{fmtWhen(ts)}</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setViewing(await api.profileVersion(repo, ts));
                    } catch (e) {
                      onBanner(errBanner(e, "Couldn't read that version."));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  View
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="profile-restore"
                  disabled={busy || running}
                  onClick={() => {
                    setViewing(null);
                    act(() => api.restoreProfile(repo, d.token, ts));
                  }}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
          {viewing?.json && (
            <div className="mt-3" data-testid="profile-version-view">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Version from {new Date((viewing.ts ?? 0) * 1000).toLocaleString("en-US")} — read only
              </div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{viewing.md}</pre>
              <Button type="button" variant="ghost" size="sm" onClick={() => setViewing(null)}>
                Close
              </Button>
            </div>
          )}
        </Disclosure>
      )}

      <div className={ROW}>
        <Button
          variant={d.state === "done" ? "secondary" : "default"}
          type="button"
          data-testid="profile-run"
          disabled={busy || running || !d.connected}
          aria-busy={running || undefined}
          title={d.connected ? "" : "Connect your Claude account in Integrations first"}
          onClick={() => act(() => api.profileRun(repo, d.token))}
        >
          <SlowBusy busy={running} />
          {running
            ? `Profiling… (${d.running?.text || "starting"})`
            : d.state === "failed" || d.failed
              ? "Retry"
              : d.state === "done"
                ? "Re-profile this repo"
                : "Profile this repo"}
        </Button>
        {!d.connected && <span className={hint}>Runs on your Claude account — connect it in Integrations first.</span>}
      </div>
      {d.last && d.last.dropped.length > 0 && (
        <div className={cn(hint, "mt-2 flex flex-wrap items-center gap-1.5")}>
          Dropped as not in the tree:
          {d.last.dropped.map((g) => (
            <code key={g}>{g}</code>
          ))}
        </div>
      )}

      {d.state === "done" && (
        <form
          className="mt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            try {
              const r = await api.saveProfile(repo, d.token, md, confirmEmpty);
              setD(r);
              setMd(r.md);
              setConfirmEmpty(false);
              if (r.bannerHtml) onBanner(r.bannerHtml);
            } catch (x) {
              if (x instanceof ApiError && x.data.needsConfirm) setConfirmEmpty(true);
              onBanner(errBanner(x, "Couldn't save the profile."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <MdEditor
            value={md}
            onChange={(v) => {
              setConfirmEmpty(false);
              setMd(v);
            }}
          />
          <p className={cn(hint, "mt-2")}>
            Edit the markdown and save — it is parsed back into the profile reviews read. The previous version is
            kept.{" "}
            {d.canValidate === false ? (
              <b data-testid="profile-cannot-validate">
                There is no clone of this repository on the box, so your paths will be saved without being
                checked against the tree.
              </b>
            ) : (
              "Paths that match nothing in the tree are dropped."
            )}
          </p>
          <div className={cn(ROW, "mt-3")}>
            <Button variant={confirmEmpty ? "destructive" : "default"} type="submit" disabled={busy || md === d.md}>
              <Save aria-hidden="true" />
              {confirmEmpty ? "Save anyway — a section will be emptied" : "Save profile"}
            </Button>
          </div>
        </form>
      )}

      <div className="mt-4 flex items-start gap-2.5">
        <Checkbox
          id={`auto-${repo}`}
          className="mt-0.5"
          checked={d.autoProfile}
          disabled={busy || !d.isAdmin}
          onCheckedChange={(v) => act(() => api.setAutoProfile(repo, d.token, v === true))}
        />
        <Label htmlFor={`auto-${repo}`} className="flex-col items-start gap-0.5 font-normal leading-snug">
          <span>
            Re-profile automatically when the file tree changes materially
            {!d.isAdmin && <span className="text-muted-foreground"> (admin only)</span>}
          </span>
          <span className={hint}>
            Checked at most once a day by the poller; runs on the admin's Claude account and skips when it isn't
            connected.
          </span>
        </Label>
      </div>
    </>,
  );
}

// Suggested rules — the durable half of the learnings loop. A complaint the team has dropped
// enough times, drafted into one sentence in the house style and waiting on a click. Nothing
// here reaches a skill until someone presses Accept.
function Suggestion({
  s,
  token,
  onDone,
}: {
  s: RuleSuggestion;
  token: Token;
  onDone: (d: SkillsData, banner: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState(false);
  // The drafted sentence goes into the team's shared skill, so it has to be editable first —
  // accept-verbatim-or-dismiss is the wrong shape for a human-gated product. The server already
  // prefers a `rule` in the body over its own draft.
  const [draft, setDraft] = useState(s.rule);
  useEffect(() => setDraft(s.rule), [s.rule]);
  const edited = draft.trim() !== s.rule.trim();
  const act = async (action: "accept" | "dismiss" | "undismiss" | "draft") => {
    setBusy(true);
    try {
      const r = await api.skillSuggestion(token, s.signature, action, action === "accept" ? draft.trim() : undefined);
      onDone(r, r.bannerHtml);
    } catch (e) {
      onDone(
        null as unknown as SkillsData,
        `<div class='banner err'><div>${(e as Error).message || "That didn't work."}</div></div>`,
      );
    } finally {
      setBusy(false);
    }
  };
  const verb = s.outcome === "dropped" ? "you dropped" : "you reworded";
  const from = `from ${s.count} finding${s.count === 1 ? "" : "s"} ${verb} across ${s.prs} PR${s.prs === 1 ? "" : "s"}`;
  const drafting = busy || !!s.drafting;

  return (
    <Card className="gap-0 py-4" data-testid="rule-suggestion">
      <CardContent className="flex flex-col gap-3 px-4">
        <div className={ROW}>
          <StatusBadge tone="blue" icon={Lightbulb}>Suggested rule</StatusBadge>
          <StatusBadge kind={s.severity} />
          {s.repos.length === 1 && <RepoPill repo={s.repos[0]} />}
          <span className="text-xs text-muted-foreground">{from}</span>
        </div>
        {s.rule ? (
          s.dismissed ? (
            <p className="m-0 text-[15px] font-medium leading-relaxed" data-testid="rule-sentence">
              {s.rule}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rule-${s.signature}`} className="text-xs text-muted-foreground">
                The rule that will be added — edit it before you accept
              </Label>
              <Textarea
                id={`rule-${s.signature}`}
                data-testid="rule-sentence"
                rows={2}
                spellCheck={false}
                className="min-h-0 text-[15px] font-medium leading-relaxed md:text-[15px]"
                value={draft}
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
              />
              {edited && <p className="m-0 text-xs text-muted-foreground">Your wording will be added, not the draft.</p>}
            </div>
          )
        ) : (
          <div className="text-sm text-muted-foreground" data-testid="rule-pending">
            The complaint: <i>{s.gist}</i>
            {drafting ? (
              <div className="mt-3 flex flex-col gap-2" aria-busy="true">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : null}
            <div className={cn(ROW, "mt-3")}>
              {/* Drafting spends the acting user's Claude quota, so it happens on a click and
                  never on a page load — this page used to burn two model calls per render. */}
              {s.connected ? (
                <>
                  <Button
                    variant="secondary"
                    type="button"
                    data-testid="rule-draft"
                    disabled={drafting}
                    aria-busy={drafting || undefined}
                    onClick={() => act("draft")}
                  >
                    {drafting ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Lightbulb aria-hidden="true" />}
                    {drafting ? "Drafting…" : "Draft a rule"}
                  </Button>
                  <span className="text-xs">One Haiku call on your own Claude account.</span>
                </>
              ) : (
                "Connect your Claude account in Integrations to draft a rule from this."
              )}
            </div>
            {s.draftError && (
              <p className="m-0 mt-2 text-sm text-destructive" role="alert" data-testid="rule-draft-error">
                The last attempt to draft this failed: {s.draftError}
              </p>
            )}
          </div>
        )}
        {s.rationale && <p className="m-0 text-xs text-muted-foreground">{s.rationale}</p>}
        <Collapsible open={evidence} onOpenChange={setEvidence}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
              <ChevronDown aria-hidden="true" className={cn("transition-transform", evidence && "rotate-180")} />
              {evidence ? "Hide" : "Show"} the {s.count} findings behind it
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0 text-sm text-muted-foreground">
              {s.findings.map((f, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                  <a href={`https://github.com/${f.repo}/pull/${f.pr}`} target="_blank" rel="noreferrer">
                    {f.repo}#{f.pr}
                  </a>
                  <Badge variant="outline" className="max-w-[260px] truncate font-normal">
                    {f.path}
                    {f.line ? `:${f.line}` : ""}
                  </Badge>
                  <span>— {f.gist}</span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
        <div className={ROW}>
          {s.dismissed ? (
            <Button variant="secondary" type="button" disabled={busy} onClick={() => act("undismiss")}>
              Undo dismiss
            </Button>
          ) : (
            <>
              <Button
                type="button"
                disabled={busy || !draft.trim()}
                title={draft.trim() ? "" : "Write the rule first, or dismiss this suggestion"}
                onClick={() => act("accept")}
              >
                <Check aria-hidden="true" />
                Accept — add to {s.targetLabel}
              </Button>
              <Button variant="ghost" type="button" disabled={busy} onClick={() => act("dismiss")}>
                Dismiss
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SuggestedRules({
  d,
  onDone,
}: {
  d: SkillsData;
  onDone: (d: SkillsData, banner: string) => void;
}) {
  const [showDismissed, setShowDismissed] = useState(false);
  const live = d.suggestions.filter((s) => !s.dismissed);
  const dismissed = d.suggestions.filter((s) => s.dismissed);

  return (
    <div data-testid="suggested-rules" className="flex flex-col gap-3">
      {live.map((s) => (
        <Suggestion key={s.signature} s={s} token={d.token} onDone={onDone} />
      ))}
      {live.length === 0 && (
        <Card className="py-0">
          <EmptyState icon={Lightbulb} title={dismissed.length > 0 ? "Nothing pending" : "No suggestions yet"} data-testid="rules-empty">
            {dismissed.length > 0
              ? "Every suggestion has been accepted or dismissed."
              : `Drop the same kind of finding ${d.suggestMin} times across different PRs and a rule is drafted here.`}
          </EmptyState>
        </Card>
      )}
      {dismissed.length > 0 && (
        <>
          <div>
            <Button variant="secondary" type="button" data-testid="show-dismissed" onClick={() => setShowDismissed((v) => !v)}>
              {showDismissed ? "Hide dismissed" : `Show dismissed (${dismissed.length})`}
            </Button>
          </div>
          {showDismissed && (
            <div className="flex flex-col gap-3" data-testid="dismissed-list">
              {dismissed.map((s) => (
                <Suggestion key={s.signature} s={s} token={d.token} onDone={onDone} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Orientation per tab, behind the page's one `?` (design §6). Everything that used to be a
// sentence under a heading lives here and nowhere else.
const ABOUT: Record<string, ReactNode> = {
  which: (
    <>
      The skill is the reviewing approach ReviewStage follows. Quick, Standard and Deep all run
      the same skill and differ only in the depth instructions. Scores are the share of a skill's
      findings that were posted at all, kept as-is or reworded; Insights' &ldquo;kept as-is&rdquo;
      is stricter and reads lower.
    </>
  ),
  rules: (
    <>
      A finding the team drops once is a preference; one dropped often enough across different
      PRs is a standard nobody has written down. Rules are drafted from your own rejections and
      nothing reaches a skill until you accept it.
    </>
  ),
  editors: (
    <>
      The team default is what everyone without their own skill runs; your own skill runs only
      the reviews you start. ReviewStage always appends its output format. To load a local skill:{" "}
      <code>cat ~/.claude/skills/pr-review/SKILL.md | pbcopy</code> (macOS) or{" "}
      <code>… | wl-copy</code> (Linux), then paste it here.
    </>
  ),
  repos: (
    <>
      Optional. A repository with its own team default is reviewed with it, ahead of personal
      skills and the shared default. Leave it empty to use the shared default.
    </>
  ),
  profiles: (
    <>
      A profile names the paths where a mistake hurts most in each repository. When a PR touches
      one, Standard and Deep reviews verify it explicitly and its findings carry a{" "}
      <Badge variant="outline" className="align-middle">critical path</Badge> badge. Profiling gathers the tree, churn,
      CODEOWNERS and CI names with no model call, then makes one Sonnet call; every path is
      checked against the tree.
    </>
  ),
  depth: (
    <>
      How deep each level goes, appended to whichever skill runs. Deep is a thorough, whole-repo
      analysis.
    </>
  ),
};

// The six tabs, each one screen. The hash is the tab, so a link from Learnings or a
// notification (`/skills#rules`) lands on the right one and Back returns to the last.
const TABS: [string, string][] = [
  ["which", "Which skill"],
  ["rules", "Suggested rules"],
  ["editors", "Editors"],
  ["repos", "Per repository"],
  ["profiles", "Profiles"],
  ["depth", "Depth"],
];
const TAB_KEYS = TABS.map(([k]) => k);

function useHashTab(): [string, (k: string) => void] {
  const read = () => {
    const h = window.location.hash.replace(/^#/, "");
    return TAB_KEYS.includes(h) ? h : "which";
  };
  const [tab, setTab] = useState(read);
  useEffect(() => {
    const on = () => setTab(read());
    window.addEventListener("hashchange", on);
    window.addEventListener("reviewstage:navigate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("reviewstage:navigate", on);
    };
  }, []);
  const go = (k: string) => {
    if (window.location.hash !== `#${k}`) window.location.hash = k;
    setTab(k);
  };
  return [tab, go];
}

// A small choice between a few named things (which editor, which depth): the queue's sort
// control, a group of small buttons with the chosen one filled.
function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, ReactNode][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-0.5" role="group" aria-label={label}>
      {options.map(([k, text]) => (
        <Button
          key={k}
          type="button"
          variant={value === k ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={value === k}
          className={cn(value !== k && "text-muted-foreground")}
          onClick={() => onChange(k)}
        >
          {text}
        </Button>
      ))}
    </div>
  );
}

function SkillsSkeleton() {
  return (
    <Card className="gap-3 py-5" aria-busy="true">
      <span className="sr-only" role="status">Loading your skills</span>
      <CardContent className="flex flex-col gap-3 px-5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}

// Scores on a phone: one card per skill — the name and its rating on top, the four counts
// as a small grid under it — instead of a six-column table that scrolls sideways.
function SkillScoreCards({ stats, user }: { stats: SkillStat[]; user: string }) {
  return (
    <div className="flex flex-col gap-2" data-testid="skill-stat-cards">
      {stats.map((s) => (
        <Card key={s.skill} className="gap-3 px-4 py-3.5" data-testid="skill-stat-card">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
              {s.label ? s.label[0].toUpperCase() + s.label.slice(1) : s.skill}
              {s.skill === user && (
                <Badge variant="outline" className="ml-1.5 align-middle">you</Badge>
              )}
            </span>
            {ratable(s) ? (
              <StatusBadge tone={s.rate >= 70 ? "green" : s.rate >= 40 ? "amber" : "red"} icon={null} className="tabular-nums">
                {s.rate.toFixed(1)}%
              </StatusBadge>
            ) : (
              <StatusBadge tone="graphite" icon={null} className="tabular-nums">
                n = {s.total.toLocaleString("en-US")} of {floorOf(s).toLocaleString("en-US")} · too few
              </StatusBadge>
            )}
          </div>
          {ratable(s) && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-primary" style={{ width: `${s.rate}%` }} />
            </div>
          )}
          <dl className="m-0 grid grid-cols-4 gap-2 text-center">
            {(
              [
                ["Kept", s.kept],
                ["Reworded", s.edited],
                ["Dropped", s.dropped],
                ["Findings", s.total],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col-reverse gap-0.5">
                <dt className="text-[11px] text-muted-foreground">{k}</dt>
                <dd className="m-0 text-base font-semibold tabular-nums">{v.toLocaleString("en-US")}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  );
}

export function Skills() {
  const phone = useIsPhone();
  const [d, setD] = useState<SkillsData | null>(null);
  const [banner, setBanner] = useState("");
  const [err, setErr] = useState("");
  const [tab, go] = useHashTab();
  const [editor, setEditor] = useState<"global" | "me">("global");
  const [repo, setRepo] = useState("");
  const [depth, setDepth] = useState("standard");
  const load = useCallback(
    () =>
      api
        .skills()
        .then((x) => {
          setErr("");
          setD(x);
        })
        .catch((e: unknown) => setErr(errMessage(e, "Couldn't load your skills."))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const onDone = (b: string) => {
    setBanner(b);
    load();
  };

  const header = <PageHeader title="Review skills" help={ABOUT[tab]} />;
  if (err && !d)
    return (
      <>
        {header}
        <Banner kind="err" data-testid="skills-error">{err}</Banner>
      </>
    );
  if (!d)
    return (
      <>
        {header}
        <SkillsSkeleton />
      </>
    );

  const choose = async (v: "team" | "own") => {
    if (d.choice === v) return;
    try {
      const r = await api.skillAction("use", { ...d.token, choice: v, from: "skills" });
      onDone(r.bannerHtml);
    } catch (x) {
      onDone(errBanner(x, "Couldn't switch skills."));
    }
  };
  const opt = (v: "team" | "own", name: string, sub: string, dis: boolean) => {
    const on = d.choice === v;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        disabled={dis}
        data-testid="skill-choice"
        className="group rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => choose(v)}
      >
        <Card className={cn("h-full gap-0 py-4 transition-colors group-hover:bg-accent/40", on && "bg-accent/30 ring-2 ring-primary")}>
          <CardContent className="flex items-start gap-3 px-4">
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                on ? "bg-primary text-primary-foreground" : "border border-input",
              )}
            >
              {on && <Check className="size-3.5" strokeWidth={3} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{name}</span>
              <span className="block text-xs text-muted-foreground">{sub}</span>
            </span>
          </CardContent>
        </Card>
      </button>
    );
  };

  const live = d.suggestions.filter((s) => !s.dismissed).length;
  const counts: Record<string, number> = { rules: live };
  const repos = d.repoSkills;
  const curRepo = repos.find((r) => r.repo === repo) ?? repos[0];
  const panel = (k: string, children: ReactNode) => (
    <TabsContent value={k} data-testid={`panel-${k}`} className="mt-3">
      {children}
    </TabsContent>
  );

  return (
    <>
      {header}
      {banner && <RawBanner html={banner} />}

      <Tabs value={tab} onValueChange={go}>
        <TabsList
          variant={phone ? "default" : "line"}
          className={
            phone
              ? // One segmented row that scrolls sideways on its own; the page never does.
                "h-10! w-full justify-start overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              : "h-auto! flex-wrap justify-start gap-x-0.5 gap-y-1 p-0"
          }
          aria-label="Skills"
          data-testid="skill-tabs"
        >
          {TABS.map(([k, label]) => (
            <TabsTrigger key={k} value={k} className={phone ? "h-full flex-none gap-1.5 px-3" : "h-9 flex-none gap-1.5 px-3"}>
              {label}
              {counts[k] ? (
                <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[11px] tabular-nums text-muted-foreground in-data-[state=active]:text-foreground">
                  {counts[k]}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {panel(
          "which",
          <>
            <div className="grid grid-cols-2 gap-3 max-[599px]:grid-cols-1" role="radiogroup" aria-label="Which skill">
              {opt("team", "Team default", "the shared reviewing approach", false)}
              {opt(
                "own",
                "My own skill",
                d.hasMySkill ? "your personal skill" : "add one on the Editors tab to use it",
                !d.hasMySkill,
              )}
            </div>
            <div className={cn(ROW, "mt-3 min-h-9 text-sm text-muted-foreground")} data-testid="skill-now">
              <span>Runs with</span>
              <b className="text-foreground">{d.effLabel}</b>
              {repos.some((r) => r.has) && (
                <>
                  <span>· overrides</span>
                  {repos.filter((r) => r.has).map((r) => (
                    <RepoPill key={r.repo} repo={r.repo} />
                  ))}
                </>
              )}
            </div>

            <Section title="Scores">
              {d.stats.length === 0 ? (
                <Card className="py-0">
                  <EmptyState icon={Compass} title="No scores yet">
                    Post a few reviews and each skill's kept-rate will show up here.
                  </EmptyState>
                </Card>
              ) : (
                phone ? (
                  <SkillScoreCards stats={d.stats} user={d.user} />
                ) : (
                <Card className="gap-0 overflow-x-auto py-0">
                  <table data-testid="skill-stats" className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground">
                        <th scope="col" className="h-10 whitespace-nowrap border-0 px-4 text-left font-medium">Skill</th>
                        <th scope="col" className="h-10 whitespace-nowrap border-0 px-3 text-right font-medium">Kept</th>
                        <th scope="col" className="h-10 whitespace-nowrap border-0 px-3 text-right font-medium">Reworded</th>
                        <th scope="col" className="h-10 whitespace-nowrap border-0 px-3 text-right font-medium">Dropped</th>
                        <th scope="col" className="h-10 whitespace-nowrap border-0 px-3 text-right font-medium">Findings</th>
                        <th scope="col" className="h-10 w-[38%] whitespace-nowrap border-0 px-4 text-left font-medium">Rating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {d.stats.map((s) => {
                        const num = "whitespace-nowrap border-0 px-3 py-0 text-right align-middle tabular-nums";
                        return (
                          <tr key={s.skill} data-testid="skill-stat" className="h-11">
                            <td className="whitespace-nowrap border-0 px-4 py-0 align-middle font-medium">
                              {s.label ? s.label[0].toUpperCase() + s.label.slice(1) : s.skill}
                              {s.skill === d.user && (
                                <Badge variant="outline" className="ml-1.5 align-middle">you</Badge>
                              )}
                            </td>
                            <td className={num}>{s.kept.toLocaleString("en-US")}</td>
                            <td className={num}>{s.edited.toLocaleString("en-US")}</td>
                            <td className={num}>{s.dropped.toLocaleString("en-US")}</td>
                            <td className={num}>{s.total.toLocaleString("en-US")}</td>
                            <td className="border-0 px-4 py-0 align-middle">
                              {ratable(s) ? (
                                <div className="flex items-center gap-2.5">
                                  <div className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                                    <div className="h-full rounded-full bg-primary" style={{ width: `${s.rate}%` }} />
                                  </div>
                                  <StatusBadge tone={s.rate >= 70 ? "green" : s.rate >= 40 ? "amber" : "red"} icon={null} className="tabular-nums">
                                    {s.rate.toFixed(1)}%
                                  </StatusBadge>
                                </div>
                              ) : (
                                <StatusBadge tone="graphite" icon={null} className="tabular-nums">
                                  n = {s.total.toLocaleString("en-US")} of {floorOf(s).toLocaleString("en-US")} · too few
                                </StatusBadge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
                )
              )}
            </Section>
          </>,
        )}

        {panel(
          "rules",
          <SuggestedRules
            d={d}
            onDone={(fresh, b) => {
              setBanner(b);
              if (fresh) setD(fresh);
              else load();
            }}
          />,
        )}

        {panel(
          "editors",
          <>
            <Choice
              label="Which skill to edit"
              value={editor}
              onChange={setEditor}
              options={[
                [
                  "global",
                  <>
                    Team default
                    {d.globalEdited === true ? (
                      <StatusBadge kind="edited">Edited</StatusBadge>
                    ) : d.globalEdited === false ? (
                      <StatusBadge tone="graphite" icon={null}>Built-in</StatusBadge>
                    ) : null}
                  </>,
                ],
                [
                  "me",
                  <>
                    My own skill
                    <StatusBadge tone={d.hasMySkill ? "green" : "graphite"} icon={d.hasMySkill ? undefined : null}>
                      {d.hasMySkill ? "Custom" : "None yet"}
                    </StatusBadge>
                  </>,
                ],
              ]}
            />
            {editor === "global" ? (
              <div data-testid="editor-global">
                <SkillEditor
                  token={d.token}
                  target="global"
                  value={d.teamSkill}
                  onDone={onDone}
                  builtinAvailable={d.builtinAvailable}
                />
                {d.teamHistory && d.teamHistory.length > 0 && (
                  <Section title="Revision history">
                    <Card className="gap-0 divide-y divide-border py-0">
                      {d.teamHistory.map((h) => (
                        <div key={h.hash} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
                          <span className="min-w-0 flex-1">{h.msg}</span>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            {h.author} · {new Date(h.at * 1000).toLocaleDateString("en-US")}
                          </span>
                        </div>
                      ))}
                    </Card>
                  </Section>
                )}
              </div>
            ) : (
              <div data-testid="editor-me">
                <SkillEditor token={d.token} target="me" value={d.mySkill} onDone={onDone} />
              </div>
            )}
          </>,
        )}

        {panel(
          "repos",
          repos.length === 0 ? (
            <Card className="py-0">
              <EmptyState icon={GitBranch} title="No repositories configured">
                Add repositories to <code>REPOS</code> in <code>.env</code> and each gets its own team default here.
              </EmptyState>
            </Card>
          ) : (
            <>
              <Card className="gap-0 divide-y divide-border py-0" data-testid="repo-skill-list">
                {repos.map((r) => {
                  const on = curRepo?.repo === r.repo;
                  return (
                    <div
                      className={cn("flex min-h-[44px] flex-wrap items-center gap-2 px-4 py-2", on && "bg-accent/40")}
                      key={r.repo}
                      data-testid="repo-skill"
                    >
                      <RepoPill repo={r.repo} />
                      <StatusBadge tone={r.has ? "green" : "graphite"} icon={r.has ? undefined : null}>
                        {r.has ? "Override" : "Shared default"}
                      </StatusBadge>
                      <Button
                        type="button"
                        variant={on ? "secondary" : "ghost"}
                        size="sm"
                        className={cn("ml-auto", !on && "text-muted-foreground")}
                        aria-pressed={on}
                        onClick={() => setRepo(r.repo)}
                      >
                        {on ? "Editing" : "Edit"}
                      </Button>
                    </div>
                  );
                })}
              </Card>
              {curRepo && (
                <div data-testid="repo-skill-editor">
                  <h2 className={cn(H2, "flex flex-wrap items-center gap-2")}>
                    Team default for <RepoPill repo={curRepo.repo} />
                  </h2>
                  <SkillEditor
                    key={curRepo.repo}
                    token={d.token}
                    target={`repo:${curRepo.repo}`}
                    value={curRepo.content}
                    onDone={onDone}
                  />
                </div>
              )}
            </>
          ),
        )}

        {panel(
          "profiles",
          repos.length === 0 ? (
            <Card className="py-0">
              <EmptyState icon={Target} title="No repositories configured">
                A profile names the paths where a mistake hurts most; there is nothing to profile yet.
              </EmptyState>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {repos.map((r) => (
                <RepoProfile key={r.repo} repo={r.repo} onBanner={setBanner} />
              ))}
            </div>
          ),
        )}

        {panel(
          "depth",
          <>
            <Choice
              label="Which depth to edit"
              value={depth}
              onChange={setDepth}
              options={["quick", "standard", "deep"].map((lv) => [lv, d.depths[lv]?.name ?? lv] as [string, ReactNode])}
            />
            {d.depths[depth] && (
              <DepthEditor key={depth} token={d.token} level={depth} d={d.depths[depth]} onDone={onDone} />
            )}
          </>,
        )}
      </Tabs>
    </>
  );
}
