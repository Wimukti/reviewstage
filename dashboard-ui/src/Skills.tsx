import { useCallback, useEffect, useState } from "react";
import { api, type ProfileData, type RuleSuggestion, type SkillsData, type Token } from "./api";
import { MdEditor } from "./MdEditor";

function Banner({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

const COPY_HINT = (
  <div className="hint">
    Load a local skill onto the clipboard, then paste it here:
    <br />
    <code>cat ~/.claude/skills/pr-review/SKILL.md | pbcopy</code> (macOS) ·{" "}
    <code>… | xclip -selection clipboard</code> or <code>… | wl-copy</code> (Linux).
  </div>
);

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
  return (
    <div className="rulebox">
      <div className="rule-lbl">Quick-add a rule</div>
      <form
        className="rulerow"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!rule.trim()) return;
          const r = await api.skillAction("rule", { ...token, target, from: "skills", rule });
          setRule("");
          onDone(r.bannerHtml);
        }}
      >
        <input
          className="in"
          autoComplete="off"
          placeholder="e.g. Don’t ask for a Jira ticket link in code comments"
          value={rule}
          onChange={(e) => setRule(e.target.value)}
        />
        <button className="btn soft" type="submit">
          Add rule
        </button>
      </form>
      <div className="hint">
        Type a preference in plain words — ReviewStage tidies it into the skill so you don't have to edit
        the whole file.
      </div>
    </div>
  );
}

function SkillEditor({
  token,
  target,
  value,
  onDone,
}: {
  token: Token;
  target: string; // "global" | "me" | "repo:<owner/name>"
  value: string;
  onDone: (b: string) => void;
}) {
  const [text, setText] = useState(value);
  const [confirm, setConfirm] = useState("");
  useEffect(() => setText(value), [value]);
  const isGlobal = target === "global";
  const isRepo = target.startsWith("repo:");
  const repoName = isRepo ? target.slice(5) : "";
  return (
    <>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await api.skillAction("save", { ...token, target, from: "skills", skill: text });
          onDone(r.bannerHtml);
        }}
      >
        <textarea
          className="in"
          spellCheck={false}
          style={{ minHeight: 150, fontSize: "12.5px" }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            isGlobal
              ? "The shared reviewing approach — edit it right here."
              : isRepo
              ? `A reviewing approach just for ${repoName} — leave blank to use the team default.`
              : "Paste your pr-review SKILL.md here — or leave blank to use the team default."
          }
        />
        <div className="hint">
          {isGlobal
            ? "Everyone without their own skill uses this. ReviewStage always appends its output format."
            : isRepo
            ? `Every review of ${repoName} runs with this — it takes precedence over personal skills and the team default for that repository. Clear it to fall back.`
            : "Your skill's logic runs; ReviewStage always appends its output format. Reviews others start are unaffected."}
        </div>
        {COPY_HINT}
        <div className="inrow" style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit">
            Save skill
          </button>
          {!isGlobal && value && (
            <button
              className="btn soft"
              type="button"
              onClick={async () => {
                const r = await api.skillAction("reset", { ...token, target, from: "skills" });
                onDone(r.bannerHtml);
              }}
            >
              {isRepo ? "Clear override (use team default)" : "Clear (use team default)"}
            </button>
          )}
        </div>
      </form>
      {isGlobal && (
        <details className="restorebox">
          <summary>Restore built-in skill…</summary>
          <form
            className="rulerow"
            style={{ marginTop: 8 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await api.skillAction("restore", {
                ...token,
                target: "global",
                from: "skills",
                confirm,
              });
              setConfirm("");
              onDone(r.bannerHtml);
            }}
          >
            <input
              className="in"
              autoComplete="off"
              placeholder="Type RESTORE to confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button className="btn warn" type="submit">
              Restore
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
  useEffect(() => setText(d.content), [d.content]);
  return (
    <details className="skilled">
      <summary>
        {d.name} depth{" "}
        <span className={d.edited ? "tag-on" : "tag-off"}>{d.edited ? "Edited" : "Default"}</span>
      </summary>
      <div className="dbody">
        <p className="muted sm" style={{ marginTop: 0 }}>
          What ReviewStage does on a <b>{d.name}</b> review ({d.meta}). Appended to whichever skill runs.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await api.skillAction("save", {
              ...token,
              target: `effort_${level}`,
              from: "skills",
              skill: text,
            });
            onDone(r.bannerHtml);
          }}
        >
          <textarea
            className="in"
            spellCheck={false}
            style={{ minHeight: 150, fontSize: "12.5px" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="inrow" style={{ marginTop: 10 }}>
            <button className="btn primary" type="submit">
              Save depth
            </button>
            {d.edited && (
              <button
                className="btn soft"
                type="button"
                onClick={async () => {
                  const r = await api.skillAction("reset", {
                    ...token,
                    target: `effort_${level}`,
                    from: "skills",
                  });
                  onDone(r.bannerHtml);
                }}
              >
                Reset to default
              </button>
            )}
          </div>
        </form>
      </div>
    </details>
  );
}


// One repository's profile: the critical paths, risk paths and rules every Standard/Deep review
// of it is told to walk. Built by bin/profile-repo.sh (one Sonnet call), editable here as
// markdown, re-buildable by hand or automatically when the file tree changes materially.
function RepoProfile({ repo, onBanner }: { repo: string; onBanner: (b: string) => void }) {
  const [d, setD] = useState<ProfileData | null>(null);
  const [md, setMd] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api.profile(repo).then((p) => {
        setD(p);
        setMd(p.md);
      }),
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
          Profile for <code>{repo}</code> <span className="tag-off">Loading</span>
        </summary>
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
          `<div class='banner warn'><span>⏳</span><div>Already profiling this repository — that click did not start a second build.</div></div>`
        );
      else if (r.started === false && r.reason)
        onBanner(`<div class='banner err'><span>⏳</span><div>Not started: ${r.reason}.</div></div>`);
    } catch (e) {
      onBanner(
        `<div class='banner err'><span>🚫</span><div>${(e as Error).message || "That didn't work."}</div></div>`
      );
    } finally {
      setBusy(false);
    }
  };
  const tag =
    d.state === "running" ? (
      <span className="tag-req">Profiling</span>
    ) : d.state === "done" ? (
      <span className="tag-on">Profiled</span>
    ) : d.state === "failed" ? (
      <span className="tag-req">Failed</span>
    ) : (
      <span className="tag-off">Never run</span>
    );
  const usage = d.last?.usage;
  const c = d.counts;
  const running = d.state === "running";

  return (
    <details className="skilled" data-testid="repo-profile">
      <summary>
        Profile for <code>{repo}</code> {tag}
      </summary>
      <div className="dbody">
        {d.state === "running" && d.running ? (
          <div className="profstat" data-testid="profile-status">
            <span className="dot run" />
            <span>
              {d.running.queued
                ? "Queued — waiting for another job to finish"
                : `${d.running.phases[d.running.cur]} (${d.running.cur + 1}/${d.running.phases.length})`}
            </span>
            <button
              className="btn soft"
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
            {c.critical} critical paths · {c.risk} risk paths · {c.rules} review rules · {c.doNotFlag} do-not-flag
            {d.versions.length > 0 ? ` · ${d.versions.length} earlier version${d.versions.length === 1 ? "" : "s"}` : ""}
          </div>
        )}

        <div className="inrow">
          <button
            className="btn primary"
            type="button"
            data-testid="profile-run"
            disabled={busy || running || !d.connected}
            aria-busy={running || undefined}
            title={d.connected ? "" : "Connect your Claude account in Integrations first"}
            onClick={() => act(() => api.profileRun(repo, d.token))}
          >
            {running && <span className="spin" aria-hidden="true" />}{" "}
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
        <div className="hint">
          Gathers the tree, churn, in-degree, CODEOWNERS and CI names with no model call, then makes one
          Sonnet call to name the critical paths. Every path is checked against the tree; anything that
          matches nothing is dropped.
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
            onSubmit={(e) => {
              e.preventDefault();
              act(() => api.saveProfile(repo, d.token, md));
            }}
          >
            <MdEditor value={md} onChange={setMd} />
            <div className="hint">
              Edit the markdown and save — it is parsed back into the profile reviews read. Paths that
              match nothing in the tree are dropped; the previous version is kept.
            </div>
            <div className="inrow" style={{ marginTop: 10 }}>
              <button className="btn primary" type="submit" disabled={busy || md === d.md}>
                Save profile
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
  const act = async (action: "accept" | "dismiss" | "undismiss") => {
    setBusy(true);
    try {
      const r = await api.skillSuggestion(token, s.signature, action);
      onDone(r, r.bannerHtml);
    } catch (e) {
      onDone(
        null as unknown as SkillsData,
        `<div class='banner err'><span>🚫</span><div>${(e as Error).message || "That didn't work."}</div></div>`,
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
          <span className="pill blocker">Suggested rule</span>
          <span className={"pill " + s.severity} />
          {s.repos.length === 1 && <span className="repochip">{s.repos[0]}</span>}
          <span className="muted sm">{evidence}</span>
        </div>
        {s.rule ? (
          <div className="suggrule" data-testid="rule-sentence">
            {s.rule}
          </div>
        ) : (
          <div className="muted sm" style={{ marginTop: 6 }} data-testid="rule-pending">
            {s.connected
              ? "Drafting the rule on your Claude account — reload in a moment."
              : "Connect your Claude account in Integrations and ReviewStage will draft the rule."}{" "}
            The complaint: <i>{s.gist}</i>
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
            <button className="btn soft" type="button" disabled={busy} onClick={() => act("undismiss")}>
              Undo dismiss
            </button>
          ) : (
            <>
              <button
                className="btn primary"
                type="button"
                disabled={busy || !s.rule}
                title={s.rule ? "" : "Nothing drafted to accept yet"}
                onClick={() => act("accept")}
              >
                Accept — add to {s.targetLabel}
              </button>
              <button className="btn soft" type="button" disabled={busy} onClick={() => act("dismiss")}>
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
  if (live.length === 0 && dismissed.length === 0) return null;

  return (
    <div data-testid="suggested-rules">
      <h2>Suggested rules</h2>
      <p className="muted sm">
        A finding the team drops once is a preference; one dropped {d.suggestMin} times across
        different PRs is a standard nobody has written down. These are drafted from your own
        rejections — nothing is added to a skill until you accept it.
      </p>
      <div className="list">
        {live.map((s) => (
          <Suggestion key={s.signature} s={s} token={d.token} onDone={onDone} />
        ))}
      </div>
      {live.length === 0 && (
        <div className="muted sm">Nothing pending — every suggestion has been accepted or dismissed.</div>
      )}
      {dismissed.length > 0 && (
        <>
          <button
            className="btn soft"
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

export function Skills() {
  const [d, setD] = useState<SkillsData | null>(null);
  const [banner, setBanner] = useState("");
  const load = useCallback(() => api.skills().then(setD), []);
  useEffect(() => {
    load();
  }, [load]);
  const onDone = (b: string) => {
    setBanner(b);
    load();
  };

  if (!d) return <div className="muted">Loading…</div>;

  const opt = (v: "team" | "own", name: string, sub: string, dis: boolean) => (
    <label className={"eff" + (d.choice === v ? " hot" : "") + (dis ? " off" : "")}>
      <input
        type="radio"
        name="choice"
        checked={d.choice === v}
        disabled={dis}
        onChange={async () => {
          const r = await api.skillAction("use", { ...d.token, choice: v, from: "skills" });
          onDone(r.bannerHtml);
        }}
      />
      <span className="effname">{name}</span>
      <span className="effsub">{sub}</span>
    </label>
  );

  return (
    <>
      <h1>Review skills</h1>
      <p className="lead">
        The skill is the reviewing approach ReviewStage follows. Pick which one runs your reviews; edit it
        below. Quick / Standard / Deep all use the same skill — they differ only in the review-depth
        instructions, which you can edit too.
      </p>
      {banner && <Banner html={banner} />}

      <div className="card">
        <h4 style={{ marginTop: 0 }}>Which skill runs your reviews?</h4>
        <div className="skillsel">
          {opt("team", "Team default", "the shared reviewing approach", false)}
          {opt(
            "own",
            "My own skill",
            d.hasMySkill ? "your personal skill" : "add a skill below to use it",
            !d.hasMySkill
          )}
        </div>
        <div className="hint">
          Reviews run with <b>{d.effLabel}</b>. Learnings sharpen whichever skill runs — every
          finding you keep or drop feeds the next review.
          {d.repoSkills.some((r) => r.has) && (
            <>
              {" "}
              Repositories with a <b>team default for that repo</b> below use it instead:{" "}
              {d.repoSkills.filter((r) => r.has).map((r) => (
                <span key={r.repo} className="repochip" style={{ marginRight: 4 }}>
                  {r.repo}
                </span>
              ))}
            </>
          )}
        </div>
      </div>

      <SuggestedRules
        d={d}
        onDone={(fresh, b) => {
          setBanner(b);
          if (fresh) setD(fresh);
          else load();
        }}
      />

      <h2>The skill</h2>
      <details className="skilled">
        <summary>
          Edit the team default skill{" "}
          <span className={d.hasGlobal ? "tag-on" : "tag-off"}>{d.hasGlobal ? "Edited" : "Built-in"}</span>
        </summary>
        <div className="dbody">
          <p className="muted sm" style={{ marginTop: 0 }}>
            The shared skill everyone falls back to. Editing it changes reviews for everyone without
            their own.
          </p>
          <SkillEditor token={d.token} target="global" value={d.teamSkill} onDone={onDone} />
          {d.teamHistory && d.teamHistory.length > 0 && (
            <div className="skillhist">
              <div className="skillhist-h">Revision history — how the team standard evolved</div>
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
      </details>
      <details className="skilled">
        <summary>
          Edit your own skill{" "}
          <span className={d.hasMySkill ? "tag-on" : "tag-off"}>{d.hasMySkill ? "Custom" : "None yet"}</span>
        </summary>
        <div className="dbody">
          <SkillEditor token={d.token} target="me" value={d.mySkill} onDone={onDone} />
        </div>
      </details>

      {d.repoSkills.length > 0 && (
        <>
          <h2>Team default per repository</h2>
          <p className="muted sm">
            Optional. A repository with its own team default is reviewed with it — ahead of personal
            skills and the shared default. Leave it empty to use the shared default.
          </p>
          {d.repoSkills.map((r) => (
            <details className="skilled" key={r.repo} data-testid="repo-skill">
              <summary>
                Team default for <code>{r.repo}</code>{" "}
                <span className={r.has ? "tag-on" : "tag-off"}>{r.has ? "Override" : "Shared default"}</span>
              </summary>
              <div className="dbody">
                <SkillEditor token={d.token} target={`repo:${r.repo}`} value={r.content} onDone={onDone} />
              </div>
            </details>
          ))}
        </>
      )}

      {d.repoSkills.length > 0 && (
        <>
          <h2>Repository profile</h2>
          <p className="muted sm">
            A profile names the paths where a mistake hurts most in each repository. When a PR touches one,
            Standard and Deep reviews are told to verify it explicitly — callers, contracts, migrations,
            tests — and findings on it carry a <span className="cpbadge">critical path</span> badge. Its
            risk paths join the context banners.
          </p>
          {d.repoSkills.map((r) => (
            <RepoProfile key={r.repo} repo={r.repo} onBanner={setBanner} />
          ))}
        </>
      )}

      <h2>Review depth</h2>
      <p className="muted sm">
        How deep each level goes. Deep is a thorough, whole-repo analysis. All three run the skill
        above.
      </p>
      {["quick", "standard", "deep"].map((lv) => (
        <DepthEditor key={lv} token={d.token} level={lv} d={d.depths[lv]} onDone={onDone} />
      ))}

      <h2>How each skill scores</h2>
      {d.stats.length === 0 ? (
        <div className="empty">
          <span className="ic">🧭</span>
          <b>No scores yet</b>
          Post a few reviews and each skill's kept-rate will show up here.
        </div>
      ) : (
        <div className="list">
          {d.stats.map((s) => (
            <div className="row" key={s.skill}>
              <div className="rowlink">
                <div className="rowtop">
                  <span className="ttl">
                    {s.label ? s.label[0].toUpperCase() + s.label.slice(1) : s.skill}
                    {s.skill === d.user && <span className="tag-on" style={{ marginLeft: 6 }}>you</span>}
                  </span>
                  <span className="num" style={{ WebkitTextFillColor: "var(--fg)" }}>
                    {s.rate}% kept
                  </span>
                </div>
                <div className="ratebar">
                  <div className="ratefill" style={{ width: `${s.rate}%` }} />
                </div>
                <div className="muted sm" style={{ marginTop: 6 }}>
                  {s.kept} kept · {s.edited} reworded · {s.dropped} dropped · {s.total} findings
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
