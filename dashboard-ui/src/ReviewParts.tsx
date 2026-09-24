// The PR page's presentational pieces — the finding card, the commit bar, the assessment head,
// the status line, the run progress — as components that take props and call no API. PrPage
// wires them to the server; src/stage/StageScene renders the same components from fixture
// JSON for the website's islands (design.md §7), so a restyle here reaches both by
// construction. Nothing in this file may import api.ts, the router, or the markdown stack:
// the site bundles whatever this pulls in.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { Status, wordOf, type Tone } from "./ui";

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

// The path is content a reviewer pastes into an editor, so it is shown whole and selectable in
// one click; the button is for the case where select-all is out of reach (a phone).
export function CopyPath({ loc }: { loc: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <div className="fpath">
      <code>{loc}</code>
      <button
        type="button"
        className="copybtn"
        aria-label={`Copy ${loc}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(loc);
            setDone(true);
          } catch {
            /* the text stays selectable by hand */
          }
        }}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
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

export function FindingCard({ f, checked, onToggle, disabled, explain, editor, teach }: FindingCardProps) {
  const [exp, setExp] = useState<ReactNode>(null);
  const [expLoading, setExpLoading] = useState(false);
  const [expErr, setExpErr] = useState("");
  // Unstructured findings (older reviews) show the comment inline; structured ones tuck it away.
  const [showDetail, setShowDetail] = useState(!f.structured);
  const [showTeach, setShowTeach] = useState(false);
  const [taught, setTaught] = useState(!!f.taught);
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
  const loc = `${f.path}:${f.line}`;
  const place = placementOf(f);
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
        {place === "summary" && (
          <Status tone="graphite" title={OFFDIFF_HINT} data-testid="placement">
            In summary
          </Status>
        )}
        {place === "unknown" && (
          <Status tone="amber" title={UNKNOWN_HINT} data-testid="placement-unknown">
            Placement unknown
          </Status>
        )}
      </div>
      <div className="fmain">
        {f.structured && <div className="ftitle">{f.title}</div>}
        <CopyPath loc={loc} />
        {f.structured && f.impact && (
          <div className="fimpact">
            <span className="fimpact-l">Why it matters</span>
            {f.impact}
          </div>
        )}
        {(f.criticalPath || f.agreement) && (
          <div className="fmeta">
            {f.criticalPath && (
              <span className="cpbadge" title={`Concerns a profiled critical path: ${f.criticalPath}`}>
                critical path
              </span>
            )}
            {f.agreement?.confirmed ? (
              <span className="agree ok" title={`Also raised by ${f.agreement.by.join(", ")} (${f.agreement.differ})`}>
                {f.agreement.n} independent
              </span>
            ) : f.agreement ? (
              <span className="agree solo">only your run</span>
            ) : null}
          </div>
        )}
        {f.thread && <div className="freply">Reply to {f.thread}</div>}
        <details
          className="explain"
          onToggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open) void runExplain();
          }}
        >
          <summary>Explain simply</summary>
          {expLoading && <div className="hint">Explaining…</div>}
          {expErr && (
            <div className="ferr">
              {expErr}{" "}
              <button type="button" className="linkbtn" onClick={runExplain}>
                Try again
              </button>
            </div>
          )}
          {exp && (
            <div className="explainbox">
              <div className="explainbox-h">In plain words · how to verify</div>
              {exp}
            </div>
          )}
        </details>
        {(f.structured || teach) && (
          <div className="factions">
            {f.structured && (
              <button
                type="button"
                className="fbtn"
                aria-expanded={showDetail}
                disabled={disabled}
                onClick={() => setShowDetail((v) => !v)}
              >
                Edit comment
              </button>
            )}
            {teach && (
              <button
                type="button"
                className="fbtn"
                aria-expanded={showTeach}
                disabled={taught}
                title={taught ? "This one is already a rule" : undefined}
                onClick={() => setShowTeach((v) => !v)}
                data-testid="teach-open"
              >
                {taught ? "Already a rule" : "Teach the skill"}
              </button>
            )}
          </div>
        )}
        {/* Deliberately not gated on `taught`: adding the rule sets it, and gating here would
            unmount the panel at the exact moment it has something to confirm. The button above
            is what stops a second visit. */}
        {showTeach && teach && teach.panel(() => setTaught(true))}
        {showDetail && editor}
      </div>
    </div>
  );
}

// ---- the commit bar --------------------------------------------------------------------------

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
  // The first-stage slide (one-identity §5.3).
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
    <div
      className={
        "commit-bar" + (entering ? " is-entering" : "") + (posted ? " is-posted" : "") + (lit ? " has-staged" : "")
      }
      data-testid="commit-bar"
    >
      <div className="inner">
        {posted ? (
          <>
            <span className="muted sm" data-testid="commit-posted">
              <Status tone="green">Posted as {postedAs}</Status>
              {postedNow && dryRun && <> · dry run — nothing reached GitHub</>}
              {!dryRun && ghUrl && (
                <>
                  {" · "}
                  <a href={ghUrl} target="_blank" rel="noreferrer">
                    View on GitHub
                  </a>
                </>
              )}
            </span>
            <span className="spacer" />
            <button className="btn primary" type="button" disabled>
              Posted
            </button>
          </>
        ) : (
          <>
            <span className="muted sm">
              {/* keyed on the count so a roll animation restarts on every change */}
              <b key={staged} className="stage-count" data-stage-count={staged}>
                {staged}
              </b>{" "}
              staged
              {(summary > 0 || unknown > 0) && (
                <>
                  {" · "}
                  {inline} inline
                  {summary > 0 && (
                    <>
                      {" · "}
                      <span title={OFFDIFF_HINT}>{summary} in the summary</span>
                    </>
                  )}
                  {unknown > 0 && (
                    <>
                      {" · "}
                      <span title={UNKNOWN_HINT} data-testid="placement-unknown-count">
                        {unknown} unknown
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
              <input
                type="checkbox"
                checked={requestChanges}
                onChange={(e) => onRequestChanges?.(e.target.checked)}
              />{" "}
              Request changes instead
            </label>
            <button
              className={"btn " + (requestChanges ? "destructive" : "primary")}
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
              onClick={onPost}
            >
              {busy ? "Posting…" : requestChanges ? "Request changes" : postLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---- the assessment head ---------------------------------------------------------------------

export interface VerdictProps {
  tone: Tone;
  text: string;
  sub?: ReactNode;
  chips?: { kind: string; n: number }[];
  testid?: string;
}

export function Verdict({ tone, text, sub, chips = [], testid }: VerdictProps) {
  return (
    <div className="verdict" data-testid={testid}>
      <div className="verdict-main">
        <div className="verdict-t">
          <Status tone={tone}>{text}</Status>
        </div>
        {sub && <div className="verdict-sub">{sub}</div>}
      </div>
      {chips.length > 0 && (
        <div className="verdict-chips">
          {chips.map((c) => (
            <Status key={c.kind} kind={c.kind}>
              {c.n} {wordOf(c.kind).toLowerCase()}
            </Status>
          ))}
        </div>
      )}
    </div>
  );
}

export function KeyPoints({ points }: { points: string[] }) {
  return (
    <ul className="keypoints">
      {points.map((pt, i) => (
        <li key={i}>{pt}</li>
      ))}
    </ul>
  );
}

// ---- the status line and the progress steps ---------------------------------------------------

// One condition on the status line: a dot and a word, the full sentence as its title. `to` makes
// it a link, rendered by whoever owns a router.
export interface StatusItem {
  key: string;
  tone: Tone;
  word: string;
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
    <div className="statusline" data-testid={testid}>
      {items.map((it) => {
        const s = (
          <Status key={it.key} tone={it.tone} title={it.title} data-testid={it.testid}>
            {it.word}
          </Status>
        );
        return it.to && link ? <Fragment key={it.key}>{link(it.to, s, it.title)}</Fragment> : s;
      })}
      {meta.length > 0 && (
        <span className="meta-t">
          {meta.map((m, i) => (
            <span key={i}>
              {i > 0 && " · "}
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

export function Steps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <div className="steps" data-testid="steps">
      {steps.map((s) => (
        <span key={s.label} className={"step" + (s.done ? " hit" : "")} data-testid={s.done ? "step-done" : "step-todo"}>
          <span className="tick" aria-hidden="true">{s.done ? <Icon name="check" /> : null}</span>
          <span>
            {s.label}
            {s.note && <span className="muted"> {s.note}</span>}
          </span>
        </span>
      ))}
    </div>
  );
}

// The phases of a run in flight, ticked to `cur`.
export function ProgressSteps({ phases, cur }: { phases: string[]; cur: number }) {
  return (
    <ul className="prog">
      {phases.map((ph, j) => (
        <li key={ph} className={j < cur ? "done" : j === cur ? "now" : ""}>
          <span className="pm">
            {j < cur ? <Icon name="check" /> : j === cur ? <span className="rundot" aria-hidden="true" /> : <Icon name="circle" />}
          </span>
          {ph}
        </li>
      ))}
    </ul>
  );
}
