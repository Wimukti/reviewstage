import { useCallback, useEffect, useRef, useState } from "react";
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
import { PageHead } from "./About";
import { Banner, RawBanner, SlowBusy } from "./ui";
import { Icon } from "./icons";
import { Status } from "./ui";

// Fallback only: every stat the server sends carries its own sample floor, and one definition
// of "enough data to rate" ships in this product.
const RATE_FLOOR = 20;
const floorOf = (s: SkillStat) => s.minSample ?? RATE_FLOOR;
const ratable = (s: SkillStat) => s.ratable ?? s.total >= floorOf(s);

// The skill editor: a plain <textarea> for a11y and for the tests, laid over a <pre> mirror that
// draws the line numbers and marks the managed "## Team rules" section. Both share one font,
// padding and wrap rule (pages.css), so the caret lands exactly on the mirrored glyph.
const RULES_MARKER = "## Team rules";
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
    <div className="codearea" data-testid="code-area">
      <pre className="codearea-mirror" aria-hidden="true">
        {lines.map((l, i) => {
          const rules = start >= 0 && i >= start && i < end;
          return (
            <div
              key={i}
              className={"ln" + (rules ? " is-rules" : "") + (i === start ? " is-rules-h" : "")}
              data-n={i + 1}
            >
              {l || "\u200b"}
            </div>
          );
        })}
      </pre>
      <textarea
        className="in codearea-in"
        aria-label={label}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
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
  return (
    <div className="rulebox">
      <div className="rule-lbl">Quick-add a rule</div>
      <form
        className="rulerow"
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
        <input
          className="in"
          autoComplete="off"
          placeholder="e.g. Don’t ask for a Jira ticket link in code comments"
          value={rule}
          onChange={(e) => setRule(e.target.value)}
        />
        <button className="btn secondary" type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add rule"}
        </button>
      </form>
    </div>
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
        <div className="inrow" style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save skill"}
          </button>
          {!isGlobal && value && (
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                act(
                  () => api.skillAction("reset", { ...token, target, from: "skills" }),
                  "Couldn't clear it.",
                )
              }
            >
              {isRepo ? "Clear override (use team default)" : "Clear (use team default)"}
            </button>
          )}
        </div>
      </form>
      {isGlobal && builtinAvailable !== false && (
        <details className="restorebox">
          <summary>Restore built-in skill…</summary>
          <form
            className="rulerow"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                const r = await api.skillAction("restore", {
                  ...token,
                  target: "global",
                  from: "skills",
                  confirm,
                });
                setConfirm("");
                return r;
              }, "Couldn't restore the built-in skill.");
            }}
          >
            <input
              className="in"
              autoComplete="off"
              placeholder="Type restore to confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button className="btn destructive" type="submit" disabled={busy}>
              {busy ? "Restoring…" : "Restore"}
            </button>
          </form>
          <div className="hint">
            Discards the team's edits and reverts everyone to the built-in review skill.
          </div>
        </details>
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
    <div className="depthed" data-testid="depth-editor">
      <div className="depthmeta">
        <b>{d.name}</b>
        <span className="muted">{d.meta}</span>
        <Status kind={d.edited ? "edited" : "archived"}>{d.edited ? "Edited" : "Default"}</Status>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () =>
              api.skillAction("save", {
                ...token,
                target: `effort_${level}`,
                from: "skills",
                skill: text,
              }),
            "Couldn't save that depth.",
          );
        }}
      >
        <CodeArea label={`${d.name} depth instructions`} value={text} onChange={setText} />
        <div className="inrow" style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save depth"}
          </button>
          {d.edited && (
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                act(
                  () =>
                    api.skillAction("reset", {
                      ...token,
                      target: `effort_${level}`,
                      from: "skills",
                    }),
                  "Couldn't reset that depth.",
                )
              }
            >
              Reset to default
            </button>
          )}
        </div>
      </form>
    </div>
  );
}


// One repository's profile: the critical paths, risk paths and rules every Standard/Deep review
// of it is told to walk. Built by bin/profile-repo.sh (one Sonnet call), editable here as
// markdown, re-buildable by hand or automatically when the file tree changes materially.
function RepoProfile({ repo, onBanner }: { repo: string; onBanner: (b: string) => void }) {
  const [d, setD] = useState<ProfileData | null>(null);
  const [md, setMd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
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

  if (!d) {
    return (
      <details className="skilled" data-testid="repo-profile">
        <summary>
          Profile for <code>{repo}</code>{" "}
          {err ? <Status tone="red">Unavailable</Status> : <Status tone="graphite">Loading</Status>}
        </summary>
        {err && (
          <div className="dbody">
            <div className="proferr" role="alert" data-testid="profile-error">
              <div className="proferr-text">{err}</div>
            </div>
          </div>
        )}
      </details>
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
      <Status tone="amber" live>Profiling</Status>
    ) : d.state === "done" ? (
      <Status tone="green">Profiled</Status>
    ) : d.state === "failed" ? (
      <Status tone="red">Failed</Status>
    ) : (
      <Status tone="graphite">Never run</Status>
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

  return (
    <details className="skilled" data-testid="repo-profile">
      <summary>
        Profile for <code>{repo}</code> {tag}
        {drifted && (
          <Status kind="stale" data-testid="profile-stale">Stale</Status>
        )}
        {d.invalid && (
          <Status tone="red">Unreadable</Status>
        )}
      </summary>
      <div className="dbody">
        {d.invalid && (
          <div className="proferr" role="alert" data-testid="profile-invalid">
            <div className="proferr-text">
              <b>This repository's profile.json could not be read, so no review is using it:</b>{" "}
              {d.invalid}. Fix the file on the box, or re-profile to replace it.
            </div>
          </div>
        )}
        {drifted && st && (
          <Banner kind="warn" data-testid="profile-stale-note">
              <b>This profile is out of date with the checkout.</b>{" "}
              {st.head !== st.currentHead && (
                <>
                  Built against <code>{st.head}</code>; the clone is now at{" "}
                  <code>{st.currentHead}</code>
                  {st.commitsBehind ? `, ${st.commitsBehind.toLocaleString("en-US")} commit(s) later` : ""}.{" "}
                </>
              )}
              {st.unmatchedPaths > 0 && (
                <>
                  {st.unmatchedPaths.toLocaleString("en-US")} of{" "}
                  {st.criticalPaths.toLocaleString("en-US")} critical path(s) no longer match
                  anything in the tree — those are dead weight in every review of this repo until
                  it is re-profiled or edited.
                </>
              )}
            </Banner>
        )}
        {unchecked && (
          <Banner kind="warn" data-testid="profile-unvalidated">
              <b>These paths were never checked against the repository.</b> The profile was saved
              with no clone of <code>{repo}</code> on this box, so nothing confirmed the globs
              match real files — and reviews are handed it as fact.
              {meta?.validated_note ? <> ({meta.validated_note})</> : null}
            </Banner>
        )}
        {degraded.length > 0 && (
          <div className="hint" data-testid="profile-degraded">
            Some signals were not gathered when this was built, so it was written from less than
            the full picture: {degraded.join("; ")}.
          </div>
        )}
        {capped > 0 && (
          <div className="hint" data-testid="profile-capped">
            {capped.toLocaleString("en-US")} further critical path(s) were over the cap and were
            not stored.
          </div>
        )}
        {d.state === "running" && d.running ? (
          <div className="profstat" data-testid="profile-status">
            <span className="dot run" />
            <span>
              {d.running.queued
                ? "Queued — waiting for another job to finish"
                : `${d.running.phases[d.running.cur]} (${d.running.cur + 1}/${d.running.phases.length})`}
            </span>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() => act(() => api.profileStop(repo, d.token))}
            >
              Stop
            </button>
          </div>
        ) : d.state === "done" && d.last ? (
          <div className="profstat" data-testid="profile-status">
            <span className="dot ok" />
            <span>
              Last run {d.last.when}
              {d.last.model ? ` · ${d.last.model}` : ""}
              {usage ? ` · ${usage.tokens.toLocaleString("en-US")} tokens` : ""}
              {d.last.runner && d.last.runner !== "shared" ? ` · on ${d.last.runner}'s account` : ""}
              {d.last.editedBy ? ` · edited by ${d.last.editedBy}` : ""}
            </span>
          </div>
        ) : d.state === "failed" ? (
          <div className="profstat" data-testid="profile-status">
            <span className="dot bad" />
            <span>The last run failed.</span>
          </div>
        ) : (
          <div className="profstat" data-testid="profile-status">
            <span className="dot" />
            <span>{d.stopped ? "Stopped before it finished." : "Never run."}</span>
          </div>
        )}

        {d.failed && d.state !== "running" && (
          <div className="proferr" role="alert" data-testid="profile-error">
            <div className="proferr-text">{d.failed}</div>
            {d.logTail && d.logTail.length > 0 && (
              <details className="proferr-log" data-testid="profile-log">
                <summary>Last {d.logTail.length} lines of the log</summary>
                <pre>{d.logTail.join("\n")}</pre>
              </details>
            )}
          </div>
        )}

        {c && (
          <div className="profcounts" data-testid="profile-counts">
            {c.critical} critical paths · {c.risk} risk paths · {c.rules} review rules ·{" "}
            {c.doNotFlag} do-not-flag
            {d.sections?.summary === 0 ? " · no summary" : ""}
          </div>
        )}
        {d.unknownHeadings && d.unknownHeadings.length > 0 && (
          <div className="proferr" role="alert" data-testid="profile-unknown-headings">
            <div className="proferr-text">
              <b>Heading(s) the parser did not recognise, so nothing under them was saved:</b>{" "}
              {d.unknownHeadings.join(", ")}.
            </div>
          </div>
        )}
        {d.versions.length > 0 && (
          <details className="profvers" data-testid="profile-versions">
            <summary>
              {d.versions.length} earlier version{d.versions.length === 1 ? "" : "s"}
            </summary>
            <div className="dbody">
              <ul className="verlist">
                {d.versions.map((ts) => (
                  <li key={ts}>
                    <span className="verwhen">
                      {new Date(ts * 1000).toLocaleString("en-US", {
                        month: "2-digit", day: "2-digit", year: "2-digit",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    <button
                      type="button"
                      className="linkbtn"
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
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      data-testid="profile-restore"
                      disabled={busy || running}
                      onClick={() => {
                        setViewing(null);
                        act(() => api.restoreProfile(repo, d.token, ts));
                      }}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
              {viewing?.json && (
                <div className="verview" data-testid="profile-version-view">
                  <div className="rule-lbl">
                    Version from{" "}
                    {new Date((viewing.ts ?? 0) * 1000).toLocaleString("en-US")} — read only
                  </div>
                  <pre>{viewing.md}</pre>
                  <button type="button" className="linkbtn" onClick={() => setViewing(null)}>
                    Close
                  </button>
                </div>
              )}
            </div>
          </details>
        )}

        <div className="inrow">
          <button
            className={"btn " + (d.state === "done" ? "secondary" : "primary")}
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
          </button>
          {!d.connected && (
            <span className="hint" style={{ margin: 0 }}>
              Runs on your Claude account — connect it in Integrations first.
            </span>
          )}
        </div>
        {d.last && d.last.dropped.length > 0 && (
          <div className="profdrop">
            Dropped as not in the tree:{" "}
            {d.last.dropped.map((g) => (
              <code key={g} style={{ marginRight: 6 }}>
                {g}
              </code>
            ))}
          </div>
        )}

        {d.state === "done" && (
          <form
            style={{ marginTop: 14 }}
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
            <div className="hint">
              Edit the markdown and save — it is parsed back into the profile reviews read. The
              previous version is kept.{" "}
              {d.canValidate === false ? (
                <b data-testid="profile-cannot-validate">
                  There is no clone of this repository on the box, so your paths will be saved
                  without being checked against the tree.
                </b>
              ) : (
                "Paths that match nothing in the tree are dropped."
              )}
            </div>
            <div className="inrow" style={{ marginTop: 10 }}>
              <button
                className={"btn " + (confirmEmpty ? "destructive" : "primary")}
                type="submit"
                disabled={busy || md === d.md}
              >
                {confirmEmpty ? "Save anyway — a section will be emptied" : "Save profile"}
              </button>
            </div>
          </form>
        )}

        <label className="profauto">
          <input
            type="checkbox"
            checked={d.autoProfile}
            disabled={busy || !d.isAdmin}
            onChange={(e) => act(() => api.setAutoProfile(repo, d.token, e.target.checked))}
          />
          <span>
            Re-profile automatically when the file tree changes materially
            {!d.isAdmin && <span className="muted"> (admin only)</span>}
            <br />
            <span className="muted sm">
              Checked at most once a day by the poller; runs on the admin's Claude account and skips when
              it isn't connected.
            </span>
          </span>
        </label>
      </div>
    </details>
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
  // The drafted sentence goes into the team's shared skill, so it has to be editable first —
  // accept-verbatim-or-dismiss is the wrong shape for a human-gated product. The server already
  // prefers a `rule` in the body over its own draft.
  const [draft, setDraft] = useState(s.rule);
  useEffect(() => setDraft(s.rule), [s.rule]);
  const edited = draft.trim() !== s.rule.trim();
  const act = async (action: "accept" | "dismiss" | "undismiss" | "draft") => {
    setBusy(true);
    try {
      const r = await api.skillSuggestion(
        token,
        s.signature,
        action,
        action === "accept" ? draft.trim() : undefined,
      );
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
  const evidence = `from ${s.count} finding${s.count === 1 ? "" : "s"} ${verb} across ${s.prs} PR${
    s.prs === 1 ? "" : "s"
  }`;

  return (
    <div className="row" data-testid="rule-suggestion">
      <div className="rowlink">
        <div className="rowtop">
          <Status tone="blue">Suggested rule</Status>
          <Status kind={s.severity} />
          {s.repos.length === 1 && <span className="repochip">{s.repos[0]}</span>}
          <span className="muted sm">{evidence}</span>
        </div>
        {s.rule ? (
          s.dismissed ? (
            <div className="suggrule" data-testid="rule-sentence">
              {s.rule}
            </div>
          ) : (
            <div className="suggedit">
              <label className="rule-lbl" htmlFor={`rule-${s.signature}`}>
                The rule that will be added — edit it before you accept
              </label>
              <textarea
                id={`rule-${s.signature}`}
                className="in suggrule-in"
                data-testid="rule-sentence"
                rows={2}
                spellCheck={false}
                value={draft}
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
              />
              {edited && (
                <div className="hint" style={{ margin: "4px 0 0" }}>
                  Your wording will be added, not the draft.
                </div>
              )}
            </div>
          )
        ) : (
          <div className="muted sm" style={{ marginTop: 6 }} data-testid="rule-pending">
            The complaint: <i>{s.gist}</i>
            <div style={{ marginTop: 8 }}>
              {/* Drafting spends the acting user's Claude quota, so it happens on a click and
                  never on a page load — this page used to burn two model calls per render. */}
              {s.connected ? (
                <button
                  className="btn secondary"
                  type="button"
                  data-testid="rule-draft"
                  disabled={busy || s.drafting}
                  aria-busy={busy || s.drafting || undefined}
                  onClick={() => act("draft")}
                >
                  {busy || s.drafting ? "Drafting…" : "Draft a rule"}
                </button>
              ) : (
                "Connect your Claude account in Integrations to draft a rule from this."
              )}
              {s.connected && (
                <span className="hint" style={{ margin: "0 0 0 8px" }}>
                  One Haiku call on your own Claude account.
                </span>
              )}
            </div>
            {s.draftError && (
              <div className="ferr" style={{ marginTop: 8 }} data-testid="rule-draft-error">
                The last attempt to draft this failed: {s.draftError}
              </div>
            )}
          </div>
        )}
        {s.rationale && (
          <div className="muted sm" style={{ marginTop: 4 }}>
            {s.rationale}
          </div>
        )}
        <details className="suggev">
          <summary>Show the {s.count} findings behind it</summary>
          <ul>
            {s.findings.map((f, i) => (
              <li key={i}>
                <a href={`https://github.com/${f.repo}/pull/${f.pr}`} target="_blank" rel="noreferrer">
                  {f.repo}#{f.pr}
                </a>{" "}
                <span className="loc">
                  {f.path}
                  {f.line ? `:${f.line}` : ""}
                </span>{" "}
                — {f.gist}
              </li>
            ))}
          </ul>
        </details>
        <div className="inrow" style={{ marginTop: 10 }}>
          {s.dismissed ? (
            <button className="btn secondary" type="button" disabled={busy} onClick={() => act("undismiss")}>
              Undo dismiss
            </button>
          ) : (
            <>
              <button
                className="btn primary"
                type="button"
                disabled={busy || !draft.trim()}
                title={draft.trim() ? "" : "Write the rule first, or dismiss this suggestion"}
                onClick={() => act("accept")}
              >
                Accept — add to {s.targetLabel}
              </button>
              <button className="btn quiet" type="button" disabled={busy} onClick={() => act("dismiss")}>
                Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    </div>
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
    <div data-testid="suggested-rules">
      {live.length > 0 && (
        <div className="list" style={{ marginTop: 0 }}>
          {live.map((s) => (
            <Suggestion key={s.signature} s={s} token={d.token} onDone={onDone} />
          ))}
        </div>
      )}
      {live.length === 0 && (
        <div className="empty" data-testid="rules-empty">
          <Icon name="bulb" />
          <b>{dismissed.length > 0 ? "Nothing pending" : "No suggestions yet"}</b>
          {dismissed.length > 0
            ? "Every suggestion has been accepted or dismissed."
            : `Drop the same kind of finding ${d.suggestMin} times across different PRs and a rule is drafted here.`}
        </div>
      )}
      {dismissed.length > 0 && (
        <>
          <button
            className="btn secondary"
            type="button"
            style={{ marginTop: 10 }}
            data-testid="show-dismissed"
            onClick={() => setShowDismissed((v) => !v)}
          >
            {showDismissed ? "Hide dismissed" : `Show dismissed (${dismissed.length})`}
          </button>
          {showDismissed && (
            <div className="list" style={{ marginTop: 10 }} data-testid="dismissed-list">
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
const ABOUT: Record<string, React.ReactNode> = {
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
      <span className="cpbadge">critical path</span> badge. Profiling gathers the tree, churn,
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

function SkillTabs({ tab, go, counts }: { tab: string; go: (k: string) => void; counts: Record<string, number> }) {
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  // Arrow keys move between tabs and select as they go; Tab leaves the list for the panel.
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let j = -1;
    if (e.key === "ArrowRight") j = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") j = (i + TABS.length - 1) % TABS.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = TABS.length - 1;
    if (j < 0) return;
    e.preventDefault();
    const k = TABS[j][0];
    go(k);
    refs.current[k]?.focus();
  };
  return (
    <div className="tabs skilltabs" role="tablist" aria-label="Skills" data-testid="skill-tabs">
      {TABS.map(([k, label], i) => (
        <a
          key={k}
          href={`#${k}`}
          id={`tab-${k}`}
          role="tab"
          aria-selected={tab === k}
          aria-controls={`panel-${k}`}
          tabIndex={tab === k ? 0 : -1}
          className={"tab" + (tab === k ? " on" : "")}
          ref={(el) => {
            refs.current[k] = el;
          }}
          onClick={(e) => {
            e.preventDefault();
            go(k);
          }}
          onKeyDown={(e) => onKey(e, i)}
        >
          {label}
          {counts[k] ? <span className="cnt">{counts[k]}</span> : null}
        </a>
      ))}
    </div>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, React.ReactNode][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          className={value === k ? "on" : ""}
          onClick={() => onChange(k)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Skills() {
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

  if (err && !d)
    return (
      <Banner kind="err" data-testid="skills-error">{err}</Banner>
    );
  if (!d) return <div className="muted">Loading…</div>;

  const opt = (v: "team" | "own", name: string, sub: string, dis: boolean) => (
    <label className={"eff" + (d.choice === v ? " hot" : "") + (dis ? " off" : "")}>
      <input
        type="radio"
        name="choice"
        checked={d.choice === v}
        disabled={dis}
        onChange={async () => {
          try {
            const r = await api.skillAction("use", { ...d.token, choice: v, from: "skills" });
            onDone(r.bannerHtml);
          } catch (x) {
            onDone(errBanner(x, "Couldn't switch skills."));
          }
        }}
      />
      <span className="effname">{name}</span>
      <span className="effsub">{sub}</span>
    </label>
  );

  const live = d.suggestions.filter((s) => !s.dismissed).length;
  const counts: Record<string, number> = { rules: live };
  const repos = d.repoSkills;
  const curRepo = repos.find((r) => r.repo === repo) ?? repos[0];
  const panel = (k: string, children: React.ReactNode) => (
    <div
      role="tabpanel"
      id={`panel-${k}`}
      aria-labelledby={`tab-${k}`}
      className="tabpanel"
      hidden={tab !== k}
      data-testid={`panel-${k}`}
    >
      {tab === k && children}
    </div>
  );

  return (
    <>
      <PageHead title="Review skills" about={ABOUT[tab]} aboutTestId="skills-about" />
      {banner && <RawBanner html={banner} />}

      <SkillTabs tab={tab} go={go} counts={counts} />

      {panel(
        "which",
        <>
          <div className="skillsel">
            {opt("team", "Team default", "the shared reviewing approach", false)}
            {opt(
              "own",
              "My own skill",
              d.hasMySkill ? "your personal skill" : "add one on the Editors tab to use it",
              !d.hasMySkill
            )}
          </div>
          <div className="skillnow" data-testid="skill-now">
            <span className="muted">Runs with</span> <b>{d.effLabel}</b>
            {repos.some((r) => r.has) && (
              <>
                <span className="muted">· overrides</span>
                {repos.filter((r) => r.has).map((r) => (
                  <span key={r.repo} className="repochip">
                    {r.repo}
                  </span>
                ))}
              </>
            )}
          </div>

          <h2>Scores</h2>
          {d.stats.length === 0 ? (
            <div className="empty">
              <Icon name="compass" />
              <b>No scores yet</b>
              Post a few reviews and each skill's kept-rate will show up here.
            </div>
          ) : (
            <div className="list skilltable">
              <table data-testid="skill-stats">
                <thead>
                  <tr>
                    <th scope="col">Skill</th>
                    <th scope="col" className="num">Kept</th>
                    <th scope="col" className="num">Reworded</th>
                    <th scope="col" className="num">Dropped</th>
                    <th scope="col" className="num">Findings</th>
                    <th scope="col">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {d.stats.map((s) => (
                    <tr key={s.skill} data-testid="skill-stat">
                      <td>
                        {s.label ? s.label[0].toUpperCase() + s.label.slice(1) : s.skill}
                        {s.skill === d.user && <span className="chip">you</span>}
                      </td>
                      <td className="num">{s.kept.toLocaleString("en-US")}</td>
                      <td className="num">{s.edited.toLocaleString("en-US")}</td>
                      <td className="num">{s.dropped.toLocaleString("en-US")}</td>
                      <td className="num">{s.total.toLocaleString("en-US")}</td>
                      <td>
                        {ratable(s) ? (
                          <span className="rating">
                            <span className="ratebar">
                              <span className="ratefill" style={{ width: `${s.rate}%` }} />
                            </span>
                            <span className="num">{s.rate.toFixed(1)}%</span>
                          </span>
                        ) : (
                          <span className="muted">
                            n = {s.total.toLocaleString("en-US")} of {floorOf(s).toLocaleString("en-US")} · too few
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
          <div className="rowtop" style={{ marginBottom: 12 }}>
            <Seg
              label="Which skill to edit"
              value={editor}
              onChange={setEditor}
              options={[
                [
                  "global",
                  <>
                    Team default{" "}
                    {d.globalEdited === true ? (
                      <Status kind="edited">Edited</Status>
                    ) : d.globalEdited === false ? (
                      <Status tone="graphite">Built-in</Status>
                    ) : null}
                  </>,
                ],
                [
                  "me",
                  <>
                    My own skill{" "}
                    <Status tone={d.hasMySkill ? "green" : "graphite"}>{d.hasMySkill ? "Custom" : "None yet"}</Status>
                  </>,
                ],
              ]}
            />
          </div>
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
                <div className="skillhist">
                  <div className="skillhist-h">Revision history</div>
                  <ul>
                    {d.teamHistory.map((h) => (
                      <li key={h.hash}>
                        <span className="skillhist-msg">{h.msg}</span>
                        <span className="skillhist-meta">
                          {h.author} · {new Date(h.at * 1000).toLocaleDateString("en-US")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
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
          <div className="empty">
            <Icon name="git" />
            <b>No repositories configured</b>
            Add repositories to <code>REPOS</code> in <code>.env</code> and each gets its own team default here.
          </div>
        ) : (
          <>
            <div className="list" style={{ marginTop: 0 }} data-testid="repo-skill-list">
              {repos.map((r) => {
                const on = curRepo?.repo === r.repo;
                return (
                  <div className={"row" + (on ? " is-current" : "")} key={r.repo} data-testid="repo-skill">
                    <div className="rowlink">
                      <div className="rowtop">
                        <span className="repochip big">{r.repo}</span>
                        <Status tone={r.has ? "green" : "graphite"}>{r.has ? "Override" : "Shared default"}</Status>
                      </div>
                    </div>
                    <div className="rowmeta">
                      <button
                        type="button"
                        className="rowact"
                        aria-pressed={on}
                        onClick={() => setRepo(r.repo)}
                      >
                        {on ? "Editing" : "Edit"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {curRepo && (
              <div className="repoed" data-testid="repo-skill-editor">
                <h2>
                  Team default for <code>{curRepo.repo}</code>
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
          <div className="empty">
            <Icon name="target" />
            <b>No repositories configured</b>
            A profile names the paths where a mistake hurts most; there is nothing to profile yet.
          </div>
        ) : (
          <>
            <div className="stack">
              {repos.map((r) => (
                <RepoProfile key={r.repo} repo={r.repo} onBanner={setBanner} />
              ))}
            </div>
          </>
        ),
      )}

      {panel(
        "depth",
        <>
          <div className="rowtop" style={{ marginBottom: 12 }}>
            <Seg
              label="Which depth to edit"
              value={depth}
              onChange={setDepth}
              options={["quick", "standard", "deep"].map((lv) => [lv, d.depths[lv]?.name ?? lv] as [string, React.ReactNode])}
            />
          </div>
          {d.depths[depth] && (
            <DepthEditor key={depth} token={d.token} level={depth} d={d.depths[depth]} onDone={onDone} />
          )}
        </>,
      )}
    </>
  );
}
