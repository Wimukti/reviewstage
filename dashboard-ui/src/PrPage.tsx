import { useCallback, useEffect, useRef, useState } from "react";
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
import { pokeRunning } from "./running";
import { BrandIcon, Icon } from "./icons";
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
import { Status, toneOf as toneOfState, wordOf, type Tone } from "./ui";
import { Banner, RawBanner, SlowBusy } from "./ui";

const refOf = (d: PrData): PrRef => ({ repo: d.repo, num: d.pr });

const REV_STATE: Record<string, [Tone, string]> = {
  APPROVED: ["green", "Approved"],
  CHANGES_REQUESTED: ["red", "Changes requested"],
  COMMENTED: ["graphite", "Commented"],
  DISMISSED: ["graphite", "Dismissed"],
  AWAITING: ["amber", "Awaiting review"],
};

function Reviewers({ data }: { data: ReviewersData }) {
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
    <details className="revcard">
      <summary>Reviewers ({data.reviewers.length})</summary>
      <div className="dbody">
        {data.reviewers.map((r) => {
          const [tone, lbl] = REV_STATE[r.state] || ["amber", "Pending"];
          return (
            <div className="revrow" key={r.login}>
              <span className="revav">{(r.login[0] || "?").toUpperCase()}</span>
              <div className="revmeta">
                <span className="revname" title={r.login}>{r.login}</span>
                <Status tone={tone}>{lbl}</Status>
              </div>
            </div>
          );
        })}
        {dec && <div className="hint" style={{ marginTop: 8 }}>{dec}</div>}
      </div>
    </details>
  );
}

function ClaudeGate({ action }: { action: string }) {
  return (
    <div className="claudegate">
      <div className="cg-ico">{BrandIcon.claude}</div>
      <div className="cg-body">
        <b>Connect your Claude account to {action}</b>
        <p className="muted sm">
          {action[0].toUpperCase() + action.slice(1)}s run on <b>your own</b> Claude subscription —
          nothing runs on anyone else's plan. Connect once and you're set.
        </p>
        <Link className="btn primary" to="/integrations">
          Connect Claude
        </Link>
      </div>
    </div>
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
  const [model, setModel] = useState(form.suggested === "deep" ? "opus" : "");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const focusRef = useRef<HTMLTextAreaElement>(null);
  const others = form.othersOnHead || [];
  if (!connected) return <ClaudeGate action="review" />;
  return (
    <form
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
      {err && (
        <Banner kind="err">{err}</Banner>
      )}
      {others.length > 0 && (
        <div className="nudge">
          <div className="nudge-h">
            {others.length === 1
              ? `${others[0].login} already reviewed this commit`
              : `${others.length} reviewers already reviewed this commit`}
          </div>
          <ul className="nudge-list">
            {others.map((o) => (
              <li key={o.login}>
                <b>{o.login}</b> — {o.effort}
                {o.model ? ` · ${o.model}` : ""} · {o.skill}
                {o.focus ? ` · focus: “${o.focus}”` : " · no focus"}
                {o.when ? ` · ${o.when}` : ""}
              </li>
            ))}
          </ul>
          <div className="nudge-cta">
            A second review adds the most when it checks something the first didn’t — add a focus
            below, or switch skills on the Skills page. Or run the same way to compare notes.{" "}
            <button type="button" className="linkbtn" onClick={() => focusRef.current?.focus()}>
              Add a focus
            </button>
          </div>
        </div>
      )}
      <div className="effort-lbl">Effort</div>
      <div className="effrow">
        {form.levels.map((l) => {
          const est = form.estimates?.[l.key];
          return (
            <label
              key={l.key}
              className={"eff" + (effort === l.key ? " hot" : "")}
              title={
                est?.source === "measured"
                  ? `Median of ${est.samples} ${l.name} run${est.samples === 1 ? "" : "s"} on this install`
                  : undefined
              }
            >
              <input type="radio" name="effort" checked={effort === l.key} onChange={() => setEffort(l.key)} />
              <span className="effname">
                {l.name}
                {l.key === form.suggested ? " · suggested" : ""}
              </span>
              <span className="effsub">{l.sub}</span>
            </label>
          );
        })}
      </div>
      {form.models && form.models.length > 0 && (
        <>
          <div className="effort-lbl">Model</div>
          <div className="effrow">
            {form.models.map((m) => (
              <label key={m.key} className={"eff" + (model === m.key ? " hot" : "")}>
                <input
                  type="radio"
                  name="model"
                  checked={model === m.key}
                  onChange={() => setModel(m.key)}
                />
                <span className="effname">{m.name}</span>
                <span className="effsub">{m.sub}</span>
              </label>
            ))}
          </div>
        </>
      )}
      <div className="focuswrap">
        <div className="effort-lbl">Focus — optional</div>
        <textarea
          ref={focusRef}
          className="in"
          rows={2}
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="Anything specific to check? e.g. “pay close attention to the order-flow cost calculation.”"
        />
      </div>
      <div className="runrow">
        <span className="hint" style={{ flex: 1 }}>
          Runs with {form.skillLabel} · deeper reviews cost more of your weekly usage.
        </span>
        <button className="btn primary" type="submit" disabled={busy} aria-busy={busy}>
          <SlowBusy busy={busy} />{busy ? "Starting…" : label}
        </button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {Object.values(form.estimates ?? {}).some((e) => e.source === "measured")
          ? "“Typically” times are medians of this install’s own runs; ranges are estimates. Both depend on the PR’s size, the model and your plan."
          : "Times are estimates — they depend on the PR’s size, the model and your plan."}
      </div>
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
      <button
        className="btn secondary"
        type="button"
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
        {stopping ? "Stopping…" : "Stop it"}
      </button>
      {err && <div className="ferr">{err}</div>}
    </>
  );
}

function HistoryList({ pr, runs }: { pr: PrRef; runs: PrData["history"] }) {
  if (!runs || !runs.length) return null;
  return (
    <div className="histwrap">
      <div className="effort-lbl">Earlier runs ({runs.length})</div>
      <div className="histlist">
        {runs.map((h) => (
          <Link key={h.ts} className="histrow" to={prUrl(pr, "/pr", `&v=${h.ts}`)}>
            <span className="histwhen">earlier run</span>
            <span className="muted sm">
              {h.effort} · {h.findings} finding(s)
              {h.focus ? ` · focus: “${h.focus.slice(0, 80)}”` : ""}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ProgressPanel({ pr, data, onStop }: { pr: PrRef; data: PrData; onStop: () => void }) {
  const r = data.reviewing!;
  const [stopping, setStopping] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="card top" data-testid="progress-panel">
      <div className="prog-hd">
        Drafting review for <b>{prLabel(pr)}</b> · <span className="muted sm">{r.effortLabel} effort</span>
      </div>
      <ProgressSteps phases={r.phases} cur={r.cur} />
      {r.focus && <div className="hint">Focusing on: “{r.focus}”</div>}
      {r.queued && (
        <div className="hint">Waiting for another review to finish first — one runs at a time on this box.</div>
      )}
      <div className="hint" style={{ marginTop: 10 }}>
        This page refreshes itself; {r.effortHint}.
      </div>
      {err && (
        <Banner kind="err">{err}</Banner>
      )}
      <div style={{ marginTop: 12 }}>
        <button
          className="btn secondary"
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
          {stopping ? "Stopping…" : "Stop review"}
        </button>
      </div>
    </div>
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

  if (added) {
    return (
      <div className="teach" data-testid="teach-added">
        <Status tone="green">Added to {added}</Status>
        <p className="teach-note">
          Every review from now on reads this. <Link to="/skills#rules">See it on Skills</Link>.
        </p>
      </div>
    );
  }
  return (
    <div className="teach" data-testid="teach">
      {!teach.connected ? (
        <p className="teach-note" data-testid="teach-noclaude">
          Drafting a rule runs on your own Claude account.{" "}
          <Link to="/integrations">Connect one</Link> to use this.
        </p>
      ) : (
        <>
          <p className="teach-note">What should the next review do with this complaint?</p>
          <div className="teach-dirs">
            <button type="button" className={"btn" + (dir === "avoid" ? " is-on" : "")}
                    disabled={!!busy} onClick={() => void draft("avoid")}
                    data-testid="teach-avoid">
              Don't raise it again
            </button>
            <button type="button" className={"btn" + (dir === "always" ? " is-on" : "")}
                    disabled={!!busy} onClick={() => void draft("always")}
                    data-testid="teach-always">
              Always check it
            </button>
          </div>
          {busy === "draft" && <div className="hint">Writing the rule…</div>}
          {err && <div className="ferr" data-testid="teach-err">{err}</div>}
          {rule && busy !== "draft" && (
            <>
              <label className="teach-l" htmlFor={`teach-${f.i}`}>
                The rule, as it will be written to {teach.targetLabel}
              </label>
              <textarea id={`teach-${f.i}`} className="in teach-in" rows={2} value={rule}
                        onChange={(e) => setRule(e.target.value)} />
              {why && <p className="teach-note">{why}</p>}
              <div className="teach-acts">
                <button type="button" className="btn primary" disabled={busy === "add" || !rule.trim()}
                        onClick={() => void add()} data-testid="teach-add">
                  {busy === "add" ? "Adding…" : "Add this rule"}
                </button>
                <button type="button" className="btn" disabled={!!busy}
                        onClick={() => void draft(dir as TeachDirection)}>
                  Redraft
                </button>
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
    <div className="fbody">
      <MdEditor value={body} onChange={onBody} />
      {suggestion && (
        <div className="sugg">
          <div className="sugglabel">Suggested change — the author can apply this in one click on GitHub</div>
          <pre className="suggin-pre">
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
    <div className="assess-summary">
      <div className={!open && long ? "clamp" : ""}>
        <Md>{text}</Md>
      </div>
      {long && (
        <button type="button" className="morebtn" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </button>
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

// One segmented control for the four sections; at most one panel is open beneath it, so the
// control itself never reflows. Arrow keys move between the segments, Enter or Space toggles.
interface Section {
  key: string;
  label: string;
  content: React.ReactNode;
}
function SectionSeg({ sections }: { sections: Section[] }) {
  const [open, setOpen] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  if (!sections.length) return null;
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const n = btns.length;
    const to =
      e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowLeft" ? (at + n - 1) % n : (at + 1) % n;
    btns[to].focus();
  };
  const cur = sections.find((s) => s.key === open);
  return (
    <>
      <div className="seg secseg" role="group" aria-label="Sections" data-testid="section-row" ref={ref} onKeyDown={onKey}>
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            className={open === s.key ? "on" : ""}
            id={`sec-${s.key}`}
            aria-expanded={open === s.key}
            aria-controls={`secpanel-${s.key}`}
            data-testid={`sec-${s.key}`}
            onClick={() => setOpen((o) => (o === s.key ? "" : s.key))}
          >
            {s.label}
          </button>
        ))}
      </div>
      {cur && (
        <section className="secpanel" id={`secpanel-${cur.key}`} aria-labelledby={`sec-${cur.key}`}>
          {cur.content}
        </section>
      )}
    </>
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
  // The commit bar slides up the first time a finding is staged in this session — the third
  // of the three animations. Pre-selected findings count as staged, so it also plays on load
  // when the server ticked something; it is instant on every later toggle.
  const [entering, setEntering] = useState(false);
  const everStaged = useRef(false);
  useEffect(() => {
    if (selected.size > 0 && !everStaged.current) {
      everStaged.current = true;
      setEntering(true);
      const t = window.setTimeout(() => setEntering(false), 250);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [selected]);
  const [banner, setBanner] = useState("");
  const [err, setErr] = useState("");
  const [stale, setStale] = useState(false); // the server refused: this run has been replaced
  const [busy, setBusy] = useState(false);
  // The stage was committed in this session: the bar switches in place, no reload needed.
  const [postedNow, setPostedNow] = useState(false);
  const posted = postedNow || rev.posted;

  // approve
  const [approveBody, setApproveBody] = useState(rev.approve?.defaultMsg || "");
  const [ack, setAck] = useState(false);

  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

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

  async function submitPost() {
    if (busy) return;
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
          }),
      );
      setBanner(res.bannerHtml);
      if (postedFromBanner(res.bannerHtml, data.dryRun)) {
        setPostedNow(true);
        onPosted();
      }
      onDone();
    } catch (e) {
      // 409: the stored review is not the one on screen. Say so in those words and offer the
      // only thing that helps — a reload — rather than a button that looks retryable.
      setBanner("");
      if (e instanceof ApiError && e.status === 409) {
        setStale(true);
        setErr("");
        return;
      }
      setErr(errMessage(e, "Couldn't post to GitHub."));
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
  const renderFinding = (f: Finding) => (
    <FindingCard
      key={f.i}
      f={f}
      checked={selected.has(f.i)}
      onToggle={() => toggle(f.i)}
      explain={async () => {
        const r = await api.explain(refOf(data), data.tokens.explain, f.i);
        return <Md className="dbody">{r.md}</Md>;
      }}
      editor={
        <>
          {f.structured && <div className="fbody-note">This is the comment posted to GitHub — edit if needed.</div>}
          <FindingBody
            body={bodies[f.i] ?? ""}
            onBody={(v) => setBodies((b) => ({ ...b, [f.i]: v }))}
            suggestion={f.suggestion}
          />
        </>
      }
      teach={
        teachOn && teachToken
          ? {
              panel: (onTaught) => (
                <TeachPanel f={f} pr={refOf(data)} token={teachToken} teach={teachOn} onTaught={onTaught} />
              ),
            }
          : undefined
      }
    />
  );

  // At most one full-width banner, and only for something that went wrong. The server's answer
  // to a write is the exception: it is the receipt for the click.
  const errorBanner = stale ? (
    <Banner kind="err" data-testid="rerun-refusal">
      <b>This review was re-run — reload before posting.</b> The findings on the server are
      not the ones on this page, so your ticks and edits no longer line up with them.
      Nothing was posted.{" "}
      <button type="button" className="linkbtn" onClick={() => window.location.reload()}>
        Reload the page
      </button>
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
      content: (
        <>
          {rev.keyPoints && rev.keyPoints.length > 0 && rev.summary && (
            <Md className="dbody">{rev.summary}</Md>
          )}
          {rev.analysis && (
            <>
              <h2>Reviewer's notes — what was checked, and what was dropped</h2>
              <Md className="dbody">{rev.analysis}</Md>
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
      content: <Md className="dbody">{rev.explainer}</Md>,
    });
  }
  if (rev.approved) {
    sections.push({
      key: "approve",
      label: "Approved",
      content: <ApprovedBody a={rev.approved} ghUrl={data.ghUrl} reviewers={data.reviewers} />,
    });
  } else if (rev.approve) {
    const a = rev.approve;
    sections.push({
      key: "approve",
      label: "Approve",
      content: (
        <>
          {headMoved && (
            <Banner kind="warn" data-testid="head-moved">
              <b>The branch has moved since this review ran.</b> The verdict above was
              written against <code>{a.reviewedHead!.slice(0, 7)}</code>; GitHub is
              now at <code>{a.currentHead!.slice(0, 7)}</code>. Approving would
              bless commits nobody here has read — re-run the review, or confirm below to
              approve the current commit anyway.
            </Banner>
          )}
          <div className="approve-verdict">
            {a.lgtm ? (
              <Status tone="green">LGTM — no blockers</Status>
            ) : (
              <Status tone="amber">
                Not LGTM —{" "}
                {a.blockers ? `${a.blockers} blocker(s)` : "the agent's assessment is REQUEST_CHANGES"}
                . Approving anyway needs the confirmation below.
              </Status>
            )}
          </div>
          {/* Not a <form>, for the same reason as the post panel: Enter must never approve
              a PR. The acknowledgement that `required` used to enforce gates the button. */}
          <div data-testid="approve-panel">
            <label className="muted sm">
              Approval comment — posted on the PR as a whole, then the PR is approved
            </label>
            <MdEditor value={approveBody} onChange={setApproveBody} />
            {needsAck && (
              <p className="sm">
                <label>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{" "}
                  {headMoved && a.lgtm
                    ? "I know the branch has moved and want to approve the current commit."
                    : "I've read the findings above and want to approve anyway."}
                </label>
              </p>
            )}
            <p>
              <button
                className="btn primary"
                type="button"
                disabled={busy || noApprove || (needsAck && !ack)}
                aria-busy={busy}
                title={noApprove ? noApproveWhy : needsAck && !ack ? "Tick the confirmation above first" : ""}
                onClick={submitApprove}
              >
                {busy
                  ? "Approving…"
                  : data.dryRun
                    ? "Approve (dry run)"
                    : `Approve #${data.pr}`}
              </button>
              {noApprove && (
                <span className="rownote" data-testid="no-approve">
                  {noApproveWhy}
                </span>
              )}
            </p>
          </div>
          {data.reviewers && <Reviewers data={data.reviewers} />}
        </>
      ),
    });
  }
  sections.push({
    key: "rerun",
    label: "Re-run",
    content: <RerunBody data={data} onDone={onDone} />,
  });

  const v = verdict(rev);
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
        <div className="conv-summary">
          <b>{rev.convergence.confirmed}</b> of {rev.convergence.total} finding(s) confirmed by
          independent reviews ({rev.convergence.rate}% agreement across {rev.convergence.nRuns}{" "}
          reviewers on this commit). A finding only counts as confirmed when a reviewer using a
          different skill/model/effort raised it too — a signal to build on, not a score.
        </div>
      )}
      {/* Deliberately not a <form>: browsers implicitly submit one on Enter, and these are
          checkboxes. A stray keystroke while ticking findings would have posted the review. */}
      <div data-testid="post-panel">
        {rev.count === 0 ? (
          <p className="muted">No findings — nothing to post.</p>
        ) : (
          <>
            {shown.map(renderFinding)}
            {maybe.length > 0 && (
              <details className="maybe">
                <summary>
                  Maybe — {maybe.length} lower-confidence finding{maybe.length !== 1 ? "s" : ""} (unchecked)
                </summary>
                <div className="dbody">{maybe.map(renderFinding)}</div>
              </details>
            )}
          </>
        )}
        <SectionSeg sections={sections} />
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
            entering={entering}
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
    <>
      <div className="approve-verdict">
        <Status tone="green">
          {a.manual ? "Marked as approved" : "Approved"} on {a.at} ({a.ago})
          {!a.manual && <> as <code>{a.user}</code></>}
        </Status>
      </div>
      {a.body && !a.manual && (
        <>
          <p className="muted sm">Comment posted with the approval:</p>
          <pre>
            <code>{a.body}</code>
          </pre>
        </>
      )}
      <p>
        <a className="btn secondary" href={ghUrl} target="_blank" rel="noopener">
          View on GitHub
        </a>
      </p>
      {reviewers && <Reviewers data={reviewers} />}
    </>
  );
}

function RerunBody({ data, onDone }: { data: PrData; onDone: () => void }) {
  return (
    <div id="rerun">
      <p className="muted sm" style={{ marginTop: 0 }}>
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

// Breadcrumbs: Queue / owner/name / #123. Clicking the repo crumb filters the queue to it.
function Crumbs({ repo, num, tail, linkNum }: { repo: string; num: string; tail?: React.ReactNode; linkNum?: boolean }) {
  return (
    <nav className="bc">
      <Link to="/">Queue</Link>
      {repo && (
        <>
          <span className="sep">/</span>
          <Link to="/" className="repo" onClick={() => setRepoFilter(repo)} title="Filter the queue to this repository">
            {repo}
          </Link>
        </>
      )}
      <span className="sep">/</span>
      {tail || linkNum ? <Link to={prUrl({ repo, num })}>#{num}</Link> : <span className="cur">#{num}</span>}
      {tail && (
        <>
          <span className="sep">/</span>
          <span className="cur">{tail}</span>
        </>
      )}
    </nav>
  );
}

// The one title pattern: mono repo, then #number — title. The Stack page reuses it.
export function PrTitle({ repo, num, title }: { repo: string; num: string; title: string }) {
  return (
    <h1 className="prtitle">
      {repo && <span className="repo">{repo}</span>}#{num}
      {title ? <> — {title}</> : null}
    </h1>
  );
}

// The one Actions menu, in place of the three side cards.
function ActionsMenu({ data }: { data: PrData }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="actwrap" ref={ref}>
      <button
        className="btn secondary"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="pr-actions"
        onClick={() => setOpen((o) => !o)}
      >
        Actions
      </button>
      {open && (
        <div className="actmenu" data-testid="pr-actions-menu">
          <a className="actitem" href={data.ghUrl} target="_blank" rel="noopener" onClick={close}>
            <Icon name="external" /> Open on GitHub
          </a>
          <Link className="actitem" to={prUrl(refOf(data), "/qa")} onClick={close}>
            <Icon name="flask" /> QA guide
          </Link>
          {data.stack?.isStack && (
            <Link className="actitem" to={prUrl(refOf(data), "/stack")} onClick={close}>
              <Icon name="layers" /> Stacked review ({data.stack.size} PRs)
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function HeaderTop({ data, tail }: { data: PrData; tail?: React.ReactNode }) {
  return (
    <>
      <Crumbs repo={data.repo} num={data.pr} tail={tail} />
      <div className="prhead">
        <PrTitle repo={data.repo} num={data.pr} title={data.title} />
        <ActionsMenu data={data} />
      </div>
    </>
  );
}

// One status line under the title. Every condition that used to be a banner is a dot and a
// word here, ordered by what the reviewer must act on: things that block or mislead an approval
// first, then the flags, then where the PR stands, then plain facts. The full sentence each
// banner carried is the item's title.
function statusItems(data: PrData, postedNow: boolean): StatusItem[] {
  const rev = data.review;
  const items: StatusItem[] = [];
  if (headMovedOf(rev)) {
    items.push({
      key: "head-moved",
      tone: "amber",
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
      word: "New commits since review",
      testid: "status-stale",
      title: "The author pushed new commits since this review. The findings may be out of date — re-run.",
    });
  }
  if (!data.claudeConnected) {
    items.push({
      key: "claude",
      tone: "amber",
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
      word: `Pre-selection capped at ${rev.preselectCapped.max}`,
      testid: "preselect-capped",
      title: rev.preselectCapped.note,
    });
  }
  for (const r of data.risk) {
    items.push({ key: `risk-${r.title}`, tone: "amber", word: r.title, title: r.note });
  }
  if (data.stopped) {
    items.push({
      key: "stopped",
      tone: "amber",
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
      word: "Dry run",
      testid: "status-dry",
      title: "Dry run — the buttons on this page do not write to GitHub.",
    });
  }
  if (data.canApprove === false) {
    items.push({
      key: "prstate",
      tone: data.merged ? "green" : "graphite",
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
    items.push({ key: "state", tone: toneOfState(kind), word: wordOf(kind), testid: "review-state" });
  }
  if (data.focus && data.state === "done") {
    items.push({
      key: "focus",
      tone: "graphite",
      word: "Focused review",
      title: `You asked ReviewStage to focus on: “${data.focus}”.`,
    });
  }
  if (rev?.reused) {
    items.push({
      key: "reused",
      tone: "graphite",
      word: "Reused earlier run",
      title: "Reused your earlier run of this exact configuration on this commit — 0 new tokens.",
    });
  }
  if (!data.awaiting) {
    items.push({ key: "awaiting", tone: "graphite", word: "Not awaiting your review" });
  }
  return items;
}
function StatusLine({ data, postedNow }: { data: PrData; postedNow: boolean }) {
  const items = statusItems(data, postedNow);
  const meta: React.ReactNode[] = [];
  if (data.author) meta.push(data.author);
  if (data.size) meta.push(data.size);
  if (data.effortBadge) meta.push(<span title={data.effortBadge.hint}>{data.effortBadge.label}</span>);
  if (data.usage) meta.push(<span className="usage" title={usageTitle(data.usage)}>{usageChip(data.usage)}</span>);
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
          <Link to={to} title={title}>
            {child}
          </Link>
        )}
      />
      <Steps steps={steps} />
    </>
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
      <>
        <nav className="bc">
          <Link to="/">Queue</Link>
          <span className="sep">/</span>
          <span className="cur">#{num}</span>
        </nav>
        <h1 className="prtitle">Which repository is #{num} in?</h1>
        <div className="card top" data-testid="repo-pick">
          <p className="muted sm">
            This link names a PR number but not a repository, and this ReviewStage reviews several.
            Pick one to continue.
          </p>
          <div className="list">
            {repos.map((r) => (
              <Link key={r} className="row" to={prUrl({ repo: r, num })}>
                <span className="rowlink">
                  <span className="repochip big">{r}</span> <span className="num">#{num}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </>
    );
  }
  if (err)
    // The frame stays: breadcrumb, the reference as typed, and a way back or on. The error is
    // the one banner the page allows.
    return (
      <div className="prpage" data-testid="pr-unknown">
        <Crumbs repo={repo} num={num} />
        <div className="prhead">
          <PrTitle repo={repo} num={num} title="" />
        </div>
        <Banner kind="err" data-testid="pr-error">{err}</Banner>
        <p className="muted sm">
          If this came from the queue, the queue and GitHub disagree about it — check the number
          and the repository.
        </p>
        <div className="practions" data-testid="unknown-actions">
          <Link className="btn secondary" to="/">
            Back to queue
          </Link>
          <button className="btn quiet" type="button" onClick={openPalette}>
            Try another
          </button>
        </div>
      </div>
    );
  if (!data) return <div className="muted">Loading…</div>;

  if (data.historyView) {
    return (
      <div className="prpage">
        <HeaderTop data={data} tail="earlier run" />
        <div className="statusline">
          <Status tone="graphite">Earlier run from {data.when}</Status>
          <span className="meta-t">
            <Link to={prUrl(refOf(data))}>Back to the current review</Link>
          </span>
        </div>
        <h2>Assessment</h2>
        <Md className="assess-summary">{data.summary || ""}</Md>
        <h2>Findings ({data.findings?.length || 0})</h2>
        {(data.findings || []).map((f, i) => (
          <div className="card" key={i}>
            <div className="meta">
              <Status kind={f.severity} />
              <code>
                {f.path}:{f.line}
              </code>
            </div>
            <Md>{f.body}</Md>
          </div>
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

  return (
    <div className="prpage">
      <HeaderTop data={data} />
      <StatusLine data={data} postedNow={postedNow} />
      {runError}
      {data.reviewing && <ProgressPanel pr={pr} data={data} onStop={load} />}
      {data.stopped && (
        <>
          <div className="card top">
            <h4 style={{ marginTop: 0 }}>Review stopped</h4>
            <p className="muted sm">
              {data.stopped.halted ? "No agent is running — Claude usage has halted." : "A process may still be running."}{" "}
              Start a new run below.
            </p>
            <RunForm
              pr={pr}
              token={data.tokens.review}
              form={data.runForm}
              label="Start review"
              connected={data.claudeConnected}
              onStarted={load}
            />
          </div>
          <HistoryList pr={pr} runs={data.history} />
        </>
      )}
      {data.stalled && (
        <>
          <div className="card top">
            <RunForm
              pr={pr}
              token={data.tokens.review}
              form={data.runForm}
              label="Re-run review"
              connected={data.claudeConnected}
              onStarted={load}
            />
          </div>
          <HistoryList pr={pr} runs={data.history} />
        </>
      )}
      {data.notReviewed && !data.approved && (
        <>
          <div className="card top">
            <h4 style={{ marginTop: 0 }}>Not reviewed here</h4>
            <p className="muted sm">No review has been run for this PR on this box.</p>
            <RunForm
              pr={pr}
              token={data.tokens.review}
              form={data.runForm}
              label="Run review"
              connected={data.claudeConnected}
              onStarted={load}
            />
          </div>
          <HistoryList pr={pr} runs={data.history} />
          {data.reviewers && <Reviewers data={data.reviewers} />}
        </>
      )}
      {data.notReviewed && data.approved && (
        <div className="card top">
          <ApprovedBody a={data.approved} ghUrl={data.ghUrl} reviewers={data.reviewers} />
        </div>
      )}
      {data.review && (
        <ReviewBody data={data} me={me} onDone={load} onPosted={() => setPostedNow(true)} />
      )}
    </div>
  );
}
