import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  errMessage,
  isExpiredToken,
  type Finding,
  type ReviewData,
  type Me,
  type PrData,
  type PrRef,
  type ReviewersData,
  type RunFormData,
  type Token,
} from "./api";
import { Md } from "./Md";
import { MdEditor } from "./MdEditor";
import { fmtDuration, prLabel, prUrl } from "./pr";
import { setRepoFilter } from "./repoFilter";
import { Link, useLocation } from "./router";
import { pokeRunning } from "./running";

const refOf = (d: PrData): PrRef => ({ repo: d.repo, num: d.pr });

const REV_STATE: Record<string, [string, string, string]> = {
  APPROVED: ["ok", "✓", "Approved"],
  CHANGES_REQUESTED: ["chg", "±", "Changes requested"],
  COMMENTED: ["cmt", "💬", "Commented"],
  DISMISSED: ["cmt", "○", "Dismissed"],
  AWAITING: ["await", "●", "Awaiting review"],
};

function Banner({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function Reviewers({ data }: { data: ReviewersData }) {
  if (!data.reviewers.length) return null;
  const dec =
    data.decision === "CHANGES_REQUESTED"
      ? "Changes requested must be addressed to merge."
      : data.decision === "APPROVED"
      ? "✅ Approved — ready to merge."
      : data.decision === "REVIEW_REQUIRED"
      ? "Review required before merge."
      : "";
  return (
    <details className="revcard">
      <summary>Reviewers ({data.reviewers.length})</summary>
      <div className="dbody">
        {data.reviewers.map((r) => {
          const [cls, ic, lbl] = REV_STATE[r.state] || ["await", "●", "Pending"];
          return (
            <div className="revrow" key={r.login}>
              <span className="revav">{(r.login[0] || "?").toUpperCase()}</span>
              <div className="revmeta">
                <span className="revname" title={r.login}>{r.login}</span>
                <span className={"revst " + cls}>
                  {ic} {lbl}
                </span>
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
      <div className="cg-ico">✳</div>
      <div className="cg-body">
        <b>Connect your Claude account to {action}</b>
        <p className="muted sm">
          {action[0].toUpperCase() + action.slice(1)}s run on <b>your own</b> Claude subscription —
          nothing runs on anyone else's plan. Connect once and you're set.
        </p>
        <Link className="btn primary" to="/integrations">
          Connect Claude →
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
        <div className="banner warn">
          <span>⚠️</span>
          <div>{err}</div>
        </div>
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
          {busy && <span className="spin" aria-hidden="true" />} {busy ? "Starting…" : label}
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
        className="btn soft"
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
    <div className="card">
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
      <ul className="prog">
        {r.phases.map((ph, j) => (
          <li key={ph} className={j < r.cur ? "done" : j === r.cur ? "now" : ""}>
            <span className={"pm" + (j === r.cur ? " spin" : "")}>{j < r.cur ? "✓" : j === r.cur ? "" : "○"}</span>
            {ph}
          </li>
        ))}
      </ul>
      <div className="progbar">
        <div className="progfill" />
      </div>
      {r.focus && <div className="hint">🎯 Focusing on: “{r.focus}”</div>}
      {r.queued && (
        <div className="hint">Waiting for another review to finish first — one runs at a time on this box.</div>
      )}
      <div className="hint" style={{ marginTop: 10 }}>
        This page refreshes itself; {r.effortHint}.
      </div>
      {err && (
        <div className="banner err">
          <span>🚫</span>
          <div>{err}</div>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <button
          className="btn soft"
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

const OFFDIFF_HINT =
  "This line is not part of the PR's diff, so GitHub cannot take an inline comment. " +
  "It will appear in the review body with a link to the line.";

const UNKNOWN_HINT =
  "GitHub would not say which lines this PR touches, so where this comment lands is unknown. " +
  "It goes inline if the line is in the diff, and into the review body if it is not.";

// Where a finding will land. `undefined`/`null` is a real third answer: the server could not ask
// GitHub, and promising "inline" on that is the post bar telling the reviewer something it does
// not know.
type Placement = "inline" | "summary" | "unknown";
const placementOf = (f: Finding): Placement =>
  f.anchorable === true ? "inline" : f.anchorable === false ? "summary" : "unknown";

function FindingCard({
  f,
  checked,
  onToggle,
  body,
  onBody,
  pr,
  explainToken,
}: {
  f: Finding;
  checked: boolean;
  onToggle: () => void;
  body: string;
  onBody: (v: string) => void;
  pr: PrRef;
  explainToken: Token;
}) {
  const [exp, setExp] = useState("");
  const [expLoading, setExpLoading] = useState(false);
  const [expErr, setExpErr] = useState("");
  // Unstructured findings (older reviews) show the comment inline; structured ones tuck it away.
  const [showDetail, setShowDetail] = useState(!f.structured);
  const explain = async () => {
    if (expLoading) return;
    setExpErr("");
    setExpLoading(true);
    try {
      const r = await api.explain(pr, explainToken, f.i);
      setExp(r.md);
    } catch {
      setExpErr("Couldn't explain this one — try again.");
    } finally {
      setExpLoading(false);
    }
  };
  const loc = `${f.path}:${f.line}`;
  return (
    <div className={"finding" + (checked ? " sel" : "")}>
      <div className="fhead">
        <input type="checkbox" className="fsel" checked={checked} onChange={onToggle} />
        <span className={"pill " + f.severity}>{f.sevLabel}</span>
        {f.criticalPath && (
          <span className="cpbadge" title={`Concerns a profiled critical path: ${f.criticalPath}`}>
            critical path
          </span>
        )}
        {placementOf(f) === "summary" && (
          <span className="offdiff" title={OFFDIFF_HINT}>
            in summary
          </span>
        )}
        {placementOf(f) === "unknown" && (
          <span className="offdiff" title={UNKNOWN_HINT} data-testid="placement-unknown">
            placement unknown
          </span>
        )}
        {f.agreement?.confirmed ? (
          <span className="agree ok" title={`Also raised by ${f.agreement.by.join(", ")} (${f.agreement.differ})`}>
            ✓ {f.agreement.n} independent
          </span>
        ) : f.agreement ? (
          <span className="agree solo">only your run</span>
        ) : null}
        <span className="fhead-sp" />
        <span className="loc" title={loc}>{loc}</span>
      </div>
      <div className="fmain">
        {f.structured && (
          <>
            <div className="ftitle">{f.title}</div>
            {f.impact && (
              <div className="fimpact">
                <span className="fimpact-l">Why it matters</span>
                {f.impact}
              </div>
            )}
          </>
        )}
        {f.thread && <div className="freply">↩ reply to {f.thread}</div>}
        <div className="factions">
          {!exp && (
            <button type="button" className="fbtn accent" onClick={explain} disabled={expLoading}>
              {expLoading ? "Explaining…" : "✨ Explain simply"}
            </button>
          )}
          {f.structured && (
            <button type="button" className="fbtn" onClick={() => setShowDetail((v) => !v)}>
              {showDetail ? "Hide comment" : "View / edit comment"}
            </button>
          )}
        </div>
        {expErr && <div className="ferr">{expErr}</div>}
        {exp && (
          <div className="explainbox">
            <div className="explainbox-h">In plain words · how to verify</div>
            <Md className="dbody">{exp}</Md>
          </div>
        )}
        {showDetail && (
          <>
            {f.structured && <div className="fbody-note">This is the comment posted to GitHub — edit if needed.</div>}
            <FindingBody body={body} onBody={onBody} suggestion={f.suggestion} />
          </>
        )}
      </div>
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
          <div className="sugglabel">💡 Suggested change — the author can apply this in one click on GitHub</div>
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
  if (rev.event === "REQUEST_CHANGES") return { ico: "🔴", text: "Changes requested", cls: "v-bad" };
  if (b) return { ico: "🔴", text: `${b} blocker${b > 1 ? "s" : ""} to resolve before merge`, cls: "v-bad" };
  if (f) return { ico: "🟡", text: `${f} thing${f > 1 ? "s" : ""} to fix before merge`, cls: "v-warn" };
  if (rev.count === 0) return { ico: "🟢", text: "Looks good — nothing to fix", cls: "v-good" };
  return { ico: "🟢", text: "Looks good — comments only, nothing blocking", cls: "v-good" };
}

// Which review these findings came from. The server matches a post to its stored review by
// array index, so a re-run started on another device would silently re-point every comment at a
// different file and line. This is the server's own identity for the run — a fingerprint
// computed here could only agree with the very list the server handed us, so it proved nothing
// and made a replaced run look current. An older server sends none: we send "" and it skips the
// check, exactly as it did before the key existed.
const reviewIdentity = (rev: ReviewData): string => rev.reviewKey || "";

function ReviewBody({ data, onDone }: { data: PrData; onDone: () => void }) {
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
  const overCap = maxPerPost > 0 && selected.size > maxPerPost;
  // Approving head B while reading head A's "LGTM, no blockers" is the failure this catches. The
  // server refuses it too; this just makes the reason visible before the click.
  const headMoved = !!(
    rev.approve?.reviewedHead &&
    rev.approve?.currentHead &&
    rev.approve.reviewedHead !== rev.approve.currentHead
  );
  const needsAck = !!rev.approve && (!rev.approve.lgtm || headMoved);

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
      onDone();
    } catch (e) {
      // 409: the stored review is not the one on screen. Say so in those words and offer the
      // only thing that helps — a reload — rather than a button that looks retryable.
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
      setErr(errMessage(e, "Couldn't approve on GitHub."));
    } finally {
      setBusy(false);
    }
  }

  const renderFinding = (f: Finding) => (
    <FindingCard
      key={f.i}
      f={f}
      checked={selected.has(f.i)}
      onToggle={() => toggle(f.i)}
      body={bodies[f.i] ?? ""}
      onBody={(v) => setBodies((b) => ({ ...b, [f.i]: v }))}
      pr={refOf(data)}
      explainToken={data.tokens.explain}
    />
  );

  return (
    <>
      {data.dryRun && (
        <div className="banner warn">
          <span>🧪</span>
          <div>
            <b>DRY RUN — the buttons on this page do not write to GitHub.</b>
          </div>
        </div>
      )}
      {banner && <Banner html={banner} />}
      {err && (
        <div className="banner err" data-testid="action-error">
          <span>🚫</span>
          <div>{err}</div>
        </div>
      )}
      {stale && (
        <div className="banner err" data-testid="rerun-refusal">
          <span>🔁</span>
          <div>
            <b>This review was re-run — reload before posting.</b> The findings on the server are
            not the ones on this page, so your ticks and edits no longer line up with them.
            Nothing was posted.{" "}
            <button type="button" className="linkbtn" onClick={() => window.location.reload()}>
              Reload the page
            </button>
            .
          </div>
        </div>
      )}
      {rev.anchorsUnknown && (
        <div className="banner warn" data-testid="anchors-unknown">
          <span>❓</span>
          <div>
            <b>Where these comments will land could not be checked.</b> GitHub would not say which
            lines this PR touches, so this is not a claim that the findings sit outside the diff —
            it is simply unknown. Each one goes inline if its line is in the diff, and into the
            review body if it is not.
            {rev.anchorError ? <> The check failed with: <code>{rev.anchorError}</code>.</> : null}
          </div>
        </div>
      )}
      {rev.truncated && (
        <div className="banner warn" data-testid="truncated">
          <span>✂️</span>
          <div>
            <b>
              Showing {rev.truncated.shown.toLocaleString("en-US")} of{" "}
              {rev.truncated.total.toLocaleString("en-US")} findings.
            </b>{" "}
            This run produced more than one page — and one review — should carry, so the rest were
            not rendered and cannot be posted from here. Re-run with a focus to narrow it.
          </div>
        </div>
      )}
      {rev.preselectCapped && (
        <div className="banner warn" data-testid="preselect-capped">
          <span>⚠️</span>
          <div>{rev.preselectCapped.note}</div>
        </div>
      )}

      {rev.reused && (
        <div className="banner ok">
          <span>♻️</span>
          <div>Reused your earlier run of this exact configuration on this commit — 0 new tokens.</div>
        </div>
      )}
      {(() => {
        const v = verdict(rev);
        return (
          <div className={"verdict " + v.cls}>
            <span className="verdict-ico">{v.ico}</span>
            <div className="verdict-main">
              <div className="verdict-t">{v.text}</div>
              <div className="verdict-sub">the agent's read · comments post as a plain review either way</div>
            </div>
            {rev.chips.length > 0 && (
              <div className="verdict-chips">
                {rev.chips.map((c) => (
                  <span key={c.kind} className={"pill " + c.kind}>
                    {c.n} {c.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })()}
      {rev.keyPoints && rev.keyPoints.length > 0 ? (
        <ul className="keypoints">
          {rev.keyPoints.map((pt, i) => (
            <li key={i}>{pt}</li>
          ))}
        </ul>
      ) : rev.summary ? (
        <ClampSummary text={rev.summary} />
      ) : null}
      {rev.keyPoints && rev.keyPoints.length > 0 && rev.summary && (
        <details className="refblock">
          <summary>Full summary</summary>
          <div className="dbody">
            <Md>{rev.summary}</Md>
          </div>
        </details>
      )}
      {rev.explainer && (
        <details className="refblock">
          <summary>What this PR does</summary>
          <Md className="dbody">{rev.explainer}</Md>
        </details>
      )}
      {rev.analysis && (
        <details className="refblock">
          <summary>Reviewer's notes — what was checked, and what was dropped</summary>
          <Md className="dbody">{rev.analysis}</Md>
        </details>
      )}

      <h2>Findings ({rev.count})</h2>
      {rev.convergence && rev.convergence.total > 0 && (
        <div className="conv-summary">
          <b>{rev.convergence.confirmed}</b> of {rev.convergence.total} finding(s) confirmed by
          independent reviews ({rev.convergence.rate}% agreement across {rev.convergence.nRuns}{" "}
          reviewers on this commit). A finding only counts as confirmed when a reviewer using a
          different skill/model/effort raised it too — a signal to build on, not a score.
        </div>
      )}
      {rev.count === 0 ? (
        <div className="card">
          <p className="muted">No findings — nothing to post.</p>
        </div>
      ) : (
        // Deliberately not a <form>: browsers implicitly submit one on Enter, and these are
        // checkboxes. A stray keystroke while ticking findings would have posted the review.
        <div data-testid="post-panel">
          {rev.posted && (
            <div className="banner ok">
              <span>✓</span>
              <div>
                Posted to GitHub as your review.{" "}
                <a href={data.ghUrl} target="_blank" rel="noreferrer">View on GitHub</a>.
              </div>
            </div>
          )}
          {shown.map(renderFinding)}
          {maybe.length > 0 && (
            <details className="maybe">
              <summary>
                🤔 Maybe — {maybe.length} lower-confidence finding{maybe.length !== 1 ? "s" : ""} (unchecked)
              </summary>
              <div className="dbody">{maybe.map(renderFinding)}</div>
            </details>
          )}
          {!rev.posted && (
            <div className="bar">
              <div className="inner">
                <span className="muted sm">
                  <b>{selected.size}</b> selected
                  {(selOff > 0 || selUnknown > 0) && (
                    <>
                      {" · "}
                      {selInline} inline
                      {selOff > 0 && (
                        <>
                          {" · "}
                          <span title={OFFDIFF_HINT}>{selOff} in the summary</span>
                        </>
                      )}
                      {selUnknown > 0 && (
                        <>
                          {" · "}
                          <span title={UNKNOWN_HINT} data-testid="placement-unknown-count">
                            {selUnknown} unknown
                          </span>
                        </>
                      )}
                    </>
                  )}{" "}
                  ·{" "}
                  {requestChanges ? "requests changes — can block the PR until updated" : "posts as plain comments"}
                  {overCap && (
                    <>
                      {" · "}
                      <b data-testid="over-cap">
                        over the {maxPerPost} per-post limit — untick some
                      </b>
                    </>
                  )}
                </span>
                <span className="spacer" />
                <label className="rqtoggle">
                  <input type="checkbox" checked={requestChanges} onChange={(e) => setRequestChanges(e.target.checked)} />{" "}
                  Request changes instead
                </label>
                <button
                  className={"btn " + (requestChanges ? "warn" : "primary")}
                  type="button"
                  disabled={busy || stale || overCap}
                  aria-busy={busy}
                  title={
                    stale
                      ? "Reload the page — this review has been replaced"
                      : overCap
                        ? `GitHub takes a review all-or-nothing; post at most ${maxPerPost} at a time`
                        : ""
                  }
                  onClick={submitPost}
                >
                  {busy ? "Posting…" : requestChanges ? "Request changes" : rev.postLabel}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {rev.approved ? (
        <ApprovedCard a={rev.approved} ghUrl={data.ghUrl} />
      ) : (
        rev.approve && (
          <>
            <h2>Approve</h2>
            <div className="card">
              {headMoved && (
                <div className="banner warn" data-testid="head-moved">
                  <span>🔄</span>
                  <div>
                    <b>The branch has moved since this review ran.</b> The verdict above was
                    written against <code>{rev.approve.reviewedHead!.slice(0, 7)}</code>; GitHub is
                    now at <code>{rev.approve.currentHead!.slice(0, 7)}</code>. Approving would
                    bless commits nobody here has read — re-run the review, or confirm below to
                    approve the current commit anyway.
                  </div>
                </div>
              )}
              {rev.approve.lgtm ? (
                <div className="banner ok">
                  <span>✅</span>
                  <div>
                    <b>LGTM</b> — no blockers.
                  </div>
                </div>
              ) : (
                <div className="banner warn">
                  <span>⚠️</span>
                  <div>
                    <b>Not LGTM</b> —{" "}
                    {rev.approve.blockers ? `${rev.approve.blockers} blocker(s)` : "the agent's assessment is REQUEST_CHANGES"}
                    . Approving anyway needs the confirmation below.
                  </div>
                </div>
              )}
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
                      {headMoved && rev.approve.lgtm
                        ? "I know the branch has moved and want to approve the current commit."
                        : "I've read the findings above and want to approve anyway."}
                    </label>
                  </p>
                )}
                <p>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={busy || (needsAck && !ack)}
                    aria-busy={busy}
                    title={needsAck && !ack ? "Tick the confirmation above first" : ""}
                    onClick={submitApprove}
                  >
                    {busy
                      ? "Approving…"
                      : data.dryRun
                        ? "Approve (dry run)"
                        : `Approve #${data.pr}`}
                  </button>
                </p>
              </div>
            </div>
          </>
        )
      )}

      <RerunSection data={data} onDone={onDone} />
    </>
  );
}

function ApprovedCard({ a, ghUrl }: { a: NonNullable<PrData["approved"]>; ghUrl: string }) {
  return (
    <>
      <h2>Approved</h2>
      <div className="card">
        <div className="banner ok">
          <span>✅</span>
          <div>
            <b>
              {a.manual ? "Marked as approved" : "Approved"} on {a.at}
            </b>{" "}
            ({a.ago}){!a.manual && <> as <code>{a.user}</code></>}
          </div>
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
          <a className="btn" href={ghUrl} target="_blank" rel="noopener">
            View on GitHub
          </a>
        </p>
      </div>
    </>
  );
}

function RerunSection({ data, onDone }: { data: PrData; onDone: () => void }) {
  return (
    <div id="rerun">
      <h2>Re-run</h2>
      <div className="card">
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
    </div>
  );
}

function usageChip(u: NonNullable<PrData["usage"]>): string {
  const dur = fmtDuration(u.durationMs);
  return `${u.model.replace(/^claude-/, "")} · ${u.realTokens.toLocaleString()} tokens${dur ? ` · ${dur}` : ""}`;
}

// Details on hover: the real breakdown, plus the API-list-price estimate clearly marked as NOT
// what a Claude subscription is billed (it isn't per-token).
function usageTitle(u: NonNullable<PrData["usage"]>): string {
  const cache = u.cacheReadTokens + u.cacheCreationTokens;
  const cost =
    u.costUsd > 0
      ? ` · ≈ $${u.costUsd.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} at API list prices (not billed on your Claude subscription)`
      : "";
  return (
    `${u.inputTokens.toLocaleString()} input · ${u.outputTokens.toLocaleString()} output · ` +
    `${cache.toLocaleString()} cached context re-reads${cost}`
  );
}

// Breadcrumbs: Queue / owner/name / #123. Clicking the repo crumb filters the queue to it.
function Crumbs({ data, tail }: { data: PrData; tail?: React.ReactNode }) {
  return (
    <nav className="bc">
      <Link to="/">Queue</Link>
      {data.repo && (
        <>
          <span className="sep">/</span>
          <Link to="/" className="repo" onClick={() => setRepoFilter(data.repo)} title="Filter the queue to this repository">
            {data.repo}
          </Link>
        </>
      )}
      <span className="sep">/</span>
      {tail ? <Link to={prUrl(refOf(data))}>#{data.pr}</Link> : <span className="cur">#{data.pr}</span>}
      {tail && (
        <>
          <span className="sep">/</span>
          <span className="cur">{tail}</span>
        </>
      )}
    </nav>
  );
}

function Title({ data }: { data: PrData }) {
  return (
    <h1 className="prtitle">
      {data.repo && <span className="repo">{data.repo}</span>}#{data.pr} — {data.title}
    </h1>
  );
}

function HeaderTop({ data }: { data: PrData }) {
  return (
    <>
      <Crumbs data={data} />
      <Title data={data} />
    </>
  );
}

// The GitHub-style right rail: quick actions, PR details, and review progress, grouped.
function PrSidebar({ data }: { data: PrData }) {
  return (
    <div className="prside-inner">
      <div className="sidecard">
        <div className="sidehead">Actions</div>
        <a className="sideact" href={data.ghUrl} target="_blank" rel="noopener">
          <span className="sideact-ico">↗</span> Open on GitHub
        </a>
        <Link className="sideact" to={prUrl(refOf(data), "/qa")}>
          <span className="sideact-ico">🧪</span> QA guide
        </Link>
        {data.stack?.isStack && (
          <Link className="sideact" to={prUrl(refOf(data), "/stack")}>
            <span className="sideact-ico">🔗</span> Stacked review ({data.stack.size} PRs)
          </Link>
        )}
      </div>

      <div className="sidecard">
        <div className="sidehead">Details</div>
        <div className="siderow">
          <span className={"pill " + data.state}>{data.state}</span>
          {data.dryRun && <span className="pill dry">dry run</span>}
          {data.effortBadge && (
            <span className="effbadge" title={data.effortBadge.hint}>
              {data.effortBadge.label}
            </span>
          )}
        </div>
        {data.usage && (
          <div className="sideusage" title={usageTitle(data.usage)}>
            {usageChip(data.usage)}
          </div>
        )}
        {(data.author || data.size) && (
          <div className="sidemeta">
            {data.author}
            {data.size ? ` · ${data.size}` : ""}
          </div>
        )}
        {data.runner && (
          <div className="sidemeta muted">
            Ran on {data.runner !== "shared" ? `${data.runner}'s` : "the shared team"} Claude account
          </div>
        )}
        {!data.awaiting && <div className="sidemeta muted">Not awaiting your review</div>}
      </div>

      <div className="sidecard">
        <div className="sidehead">Review progress</div>
        <div className="sidesteps">
          {data.timeline.map((s) => (
            <div key={s.label} className={"sidestep" + (s.done ? " hit" : "")}>
              <span className="sidetick">{s.done ? "✓" : "○"}</span>
              <span>
                {s.label}
                {s.note && <span className="muted"> {s.note}</span>}
              </span>
            </div>
          ))}
        </div>
        {data.reviewers && <Reviewers data={data.reviewers} />}
      </div>
    </div>
  );
}

// Contextual alert banners (risk / focus / stale) — shown atop the main column.
function PrBanners({ data }: { data: PrData }) {
  return (
    <>
      {data.risk.map((r) => (
        <div className="banner info" key={r.title}>
          <span>{r.icon}</span>
          <div>
            <b>{r.title}.</b> {r.note}
          </div>
        </div>
      ))}
      {data.focus && data.state === "done" && (
        <div className="banner info">
          <span>🎯</span>
          <div>
            <b>Focused review.</b> You asked ReviewStage to focus on: “{data.focus}”.
          </div>
        </div>
      )}
      {data.stale && (
        <div className="banner warn">
          <span>🔄</span>
          <div>
            <b>The author pushed new commits since this review.</b> The findings may be out of date —
            re-run below.
          </div>
        </div>
      )}
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
    return (
      <div className="banner err">
        <span>🔴</span>
        <div>{err}</div>
      </div>
    );
  if (!data) return <div className="muted">Loading…</div>;

  if (data.historyView) {
    return (
      <>
        <Crumbs data={data} tail="earlier run" />
        <Title data={data} />
        <div className="banner info">
          <span>🕓</span>
          <div>
            <b>Viewing an earlier run</b> from {data.when}. <Link to={prUrl(refOf(data))}>Back to the current review</Link>.
          </div>
        </div>
        <h2>Assessment</h2>
        <div className="card">
          <Md>{data.summary || ""}</Md>
        </div>
        <h2>Findings ({data.findings?.length || 0})</h2>
        {(data.findings || []).map((f, i) => (
          <div className="card" key={i}>
            <div className="meta">
              <span className={"pill " + f.severity}>{f.sevLabel}</span>
              <code>
                {f.path}:{f.line}
              </code>
            </div>
            <Md>{f.body}</Md>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <HeaderTop data={data} />
      <div className="prlayout">
        <div className="prmain">
          <PrBanners data={data} />
          {data.reviewing && <ProgressPanel pr={pr} data={data} onStop={load} />}
      {data.stopped && (
        <>
          <div className="banner warn">
            <span>🛑</span>
            <div>
              <b>Review stopped.</b>{" "}
              {data.stopped.halted ? "✅ No agent is running — Claude usage has halted." : "⚠️ A process may still be running."}{" "}
              Start a new run below.
            </div>
          </div>
          <div className="card top">
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
          <div className="banner err" data-testid="stalled-banner">
            <span>🔴</span>
            <div>
              <b>The review stopped before it finished.</b> It was at <code>{data.stalled.was}</code>. Re-run below.
              {data.stalled.pidAlive && (
                <>
                  {" "}
                  A process from that run is still alive.{" "}
                  <StopStalled pr={pr} token={data.tokens.stop} onDone={load} />
                </>
              )}
            </div>
          </div>
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
          {data.failed && (
            <div className="banner err">
              <span>🔴</span>
              <div>{data.failed}</div>
            </div>
          )}
          <div className="card top">
            <h4>Not reviewed here</h4>
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
        </>
      )}
      {data.notReviewed && data.approved && <ApprovedCard a={data.approved} ghUrl={data.ghUrl} />}
          {data.review && <ReviewBody data={data} onDone={load} />}
        </div>
        <aside className="prside">
          <PrSidebar data={data} />
        </aside>
      </div>
    </>
  );
}
