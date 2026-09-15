import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMessage, type Me, type PrRef, type QaDetail, type QaGuide } from "./api";
import { Md } from "./Md";
import { parsePrRef, prLabel, prUrl, usageChip, usageTitle } from "./pr";
import { Link, navigate, useLocation } from "./router";
import { pokeRunning, runningFor, useRunning } from "./running";

function QaIndex({ me }: { me: Me }) {
  const [guides, setGuides] = useState<QaGuide[]>([]);
  const [repos, setRepos] = useState<string[]>(me.repos || []);
  const [pr, setPr] = useState("");
  const [pickRepo, setPickRepo] = useState("");
  const jobs = useRunning();
  const runKey = jobs.map((j) => `${j.kind}:${j.repo}#${j.num}`).join(",");
  useEffect(() => {
    api.qaIndex().then((d) => {
      setGuides(d.guides);
      if (d.repos?.length) setRepos(d.repos);
    });
    // A guide starting or finishing changes this list — re-read it then, no timer of our own.
  }, [runKey]);
  const multi = repos.length > 1;
  const parsed = parsePrRef(pr, repos);
  const needsPick = !!parsed && !parsed.repo && multi;
  return (
    <>
      <h1>QA guides</h1>
      <p className="lead">
        Generate a tester-ready QA guide for a PR — risk-tiered manual test cases, setup steps, a
        surface matrix and what <em>not</em> to file — all grounded in the real diff. Then hand it
        straight to QA.
      </p>
      <div className="card">
        <h4 style={{ marginTop: 0 }}>Generate a guide</h4>
        <form
          className="qagen"
          onSubmit={(e) => {
            e.preventDefault();
            if (!parsed) return;
            const repo = parsed.repo || pickRepo || repos[0] || "";
            navigate(prUrl({ repo, num: parsed.number }, "/qa"));
          }}
        >
          <input
            className="in"
            autoComplete="off"
            placeholder="PR URL, owner/name#123, or a number"
            value={pr}
            onChange={(e) => setPr(e.target.value)}
          />
          {needsPick && (
            <select aria-label="Repository" value={pickRepo || repos[0]} onChange={(e) => setPickRepo(e.target.value)}>
              {repos.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
          <button className="btn primary" type="submit">
            Open
          </button>
        </form>
        <div className="hint">
          Paste a PR URL, or type <code>owner/name#123</code> or a number, to view its guide
          or generate a new one.
        </div>
      </div>
      {guides.length > 0 ? (
        <>
          <h2>Recent guides</h2>
          <div className="list">
            {guides.map((g) => {
              const status = runningFor(jobs, "qa", g.repo, g.num)?.status || (g.running ? g.status || "building" : "");
              return (
              <div className={"row" + (status ? " running" : "")} key={`${g.repo}#${g.num}`}>
                <Link className="rowlink" to={prUrl({ repo: g.repo, num: g.num }, "/qa")}>
                  <div className="rowtop">
                    <span className="num">#{g.num}</span>
                    <span className="ttl">{g.title}</span>
                  </div>
                  {status ? (
                    <div className="rowrun" data-testid="row-running">
                      <span className="rundot" aria-hidden="true" />
                      <span>{status}</span>
                      <span className="runback">— open to watch</span>
                    </div>
                  ) : (
                    <div className="muted sm rowsub">
                      <span>guide ready · {g.when}</span>
                    </div>
                  )}
                </Link>
                <div className="rowmeta">
                  <Link className="chev" to={prUrl({ repo: g.repo, num: g.num }, "/qa")} aria-hidden="true">
                    ›
                  </Link>
                </div>
              </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="empty">
          <span className="ic">🧪</span>
          <b>No guides yet</b>
          Paste a PR URL or number above to build the first one.
        </div>
      )}
    </>
  );
}

// The pre-clipboard-API copy: a hidden textarea plus document.execCommand("copy"). Deprecated,
// but the only thing that works on http://<lan-ip>, which is exactly how the docs say to install.
function execCommandCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    ta.remove();
  }
  return ok;
}

// Nothing more will happen to a guide in one of these states without another click.
const TERMINAL = new Set(["done", "failed", "stopped"]);

function QaDetailView({ pr }: { pr: PrRef }) {
  const [d, setD] = useState<QaDetail | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Set the moment Generate is clicked. The server reports "none" for the seconds the job takes
  // to spawn, so arming the timer on state === "running" alone meant the first-ever Generate
  // never polled: the page sat on "No guide yet" while the guide was being written.
  const [starting, setStarting] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => api.qaDetail(pr).then(setD), [pr.repo, pr.num]);

  useEffect(() => {
    setD(null);
    setStarting(false);
    setErr("");
  }, [pr.repo, pr.num]);
  useEffect(() => {
    load();
  }, [load]);
  // The run has been picked up (or has ended): the optimistic state has done its job.
  useEffect(() => {
    if (d && (d.state === "running" || TERMINAL.has(d.state))) setStarting(false);
  }, [d]);
  useEffect(() => {
    window.clearInterval(timer.current);
    const live = d && !TERMINAL.has(d.state) && (d.state === "running" || starting);
    if (live) timer.current = window.setInterval(load, 4000);
    return () => window.clearInterval(timer.current);
  }, [d, starting, load]);

  if (!d) return <div className="muted">Loading…</div>;

  // A failed or stopped run never hides a guide that is already on disk — the server keeps the
  // state at "done" for exactly that reason. What went wrong rides above the guide as a warning,
  // with the agent's own last words behind a disclosure.
  const lastRun =
    d.lastRunFailed || d.lastRunStopped || d.failed || (d.stopped && d.md) ? (
      <div
        className={"banner " + (d.lastRunStopped || d.stopped ? "warn" : "err")}
        data-testid="qa-last-run"
      >
        <span>{d.lastRunStopped || d.stopped ? "🛑" : "🔴"}</span>
        <div>
          <b>
            {d.lastRunStopped || d.stopped
              ? "The last attempt was stopped."
              : "The last attempt failed."}
          </b>{" "}
          {d.md
            ? "The guide below is the one already on disk — it is unchanged, not a result of that run."
            : "No guide was written."}
          {d.failed && <div className="qafail">{d.failed}</div>}
          {d.logTail && d.logTail.length > 0 && (
            <details className="proferr-log" data-testid="qa-log">
              <summary>Last {d.logTail.length} lines of the log</summary>
              <pre>{d.logTail.join("\n")}</pre>
            </details>
          )}
        </div>
      </div>
    ) : null;

  const chip = d.usage ? (
    <span className="sideusage qausage" title={usageTitle(d.usage)} data-testid="qa-usage">
      {usageChip(d.usage)}
    </span>
  ) : null;

  const header = (
    <>
      <nav className="bc">
        <Link to="/qa">QA guides</Link>
        {d.repo && (
          <>
            <span className="sep">/</span>
            <span className="muted">{d.repo}</span>
          </>
        )}
        <span className="sep">/</span>
        <span className="cur">#{pr.num}</span>
      </nav>
      <h1 className="prtitle">
        {d.repo && <span className="repo">{d.repo}</span>}#{pr.num} — {d.title}
      </h1>
      <div className="meta">
        <a href={d.ghUrl} target="_blank" rel="noopener">
          open on GitHub
        </a>
      </div>
    </>
  );

  const gate = (
    <div className="claudegate">
      <div className="cg-ico">✳</div>
      <div className="cg-body">
        <b>Connect your Claude account to generate a QA guide</b>
        <p className="muted sm">Generating a QA guide runs on your own Claude subscription.</p>
        <Link className="btn primary" to="/integrations">
          Connect Claude →
        </Link>
      </div>
    </div>
  );

  async function gen() {
    if (!d || busy) return;
    setErr("");
    setBusy(true);
    setStarting(true); // poll from this instant, not from the first "running" the server admits
    try {
      const r = await api.qaGen({ repo: d.repo, num: pr.num }, d.genToken);
      if (r.started === false) {
        setStarting(false);
        setErr(
          r.reason ||
            "Nothing started — a job for this PR may already be running, or the box is busy. " +
              "Try again in a moment.",
        );
        return;
      }
      pokeRunning();
      load();
    } catch (x) {
      setStarting(false);
      setErr(errMessage(x, "Couldn't start the QA guide."));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!d?.stopToken || busy) return;
    setErr("");
    setBusy(true);
    try {
      await api.qaStop({ repo: d.repo, num: pr.num }, d.stopToken);
      setStarting(false);
      load();
    } catch (x) {
      setErr(errMessage(x, "Couldn't stop it."));
    } finally {
      setBusy(false);
    }
  }
  // navigator.clipboard is undefined on a non-secure origin — which the documented LAN install
  // is — so the async API is only ever the first attempt, never the only one.
  async function copy() {
    if (!d?.md) return;
    setErr("");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(d.md);
      } else if (!execCommandCopy(d.md)) {
        throw new Error("This browser would not let the page copy.");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (x) {
      try {
        if (execCommandCopy(d.md)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
          return;
        }
      } catch {
        /* fall through to the message below */
      }
      setErr(
        errMessage(x, "Couldn't copy.") +
          " Use Download instead, or select the guide and copy it by hand.",
      );
    }
  }
  function download() {
    if (!d?.md) return;
    // Built in the browser from markdown the page already holds — no server endpoint needed.
    const url = URL.createObjectURL(new Blob([d.md], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `qa-${d.repo.replace("/", "-")}-${pr.num}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // The spawn window: clicked, but the server has not yet admitted a run. Without this the page
  // says "No guide yet" while the guide is being written.
  if (starting && d.state !== "running") {
    return (
      <>
        {header}
        <div className="card top" data-testid="qa-starting">
          <div className="prog-hd">
            Starting the QA guide for <b>{prLabel({ repo: d.repo, num: pr.num })}</b>
          </div>
          <ul className="prog">
            <li className="now">
              <span className="pm spin" />
              Starting the job
            </li>
          </ul>
          <div className="progbar">
            <div className="progfill" />
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            This page refreshes itself; the phases appear as soon as the job is picked up.
          </div>
        </div>
      </>
    );
  }

  if (d.state === "running" && d.running) {
    const r = d.running;
    return (
      <>
        {header}
        <div className="card top">
          <div className="prog-hd">
            Building QA guide for <b>{prLabel({ repo: d.repo, num: pr.num })}</b>
          </div>
          <ul className="prog">
            {r.phases.map((ph, j) => (
              <li key={ph} className={j < r.cur ? "done" : j === r.cur ? "now" : ""}>
                <span className={"pm" + (j === r.cur ? " spin" : "")}>
                  {j < r.cur ? "✓" : j === r.cur ? "" : "○"}
                </span>
                {ph}
              </li>
            ))}
          </ul>
          <div className="progbar">
            <div className="progfill" />
          </div>
          {r.queued && <div className="hint">Waiting for another job to finish first.</div>}
          <div className="hint" style={{ marginTop: 10 }}>
            This page refreshes itself; reading the diff and review history takes a few minutes.
          </div>
          {err && (
            <div className="banner err" data-testid="qa-error">
              <span>🚫</span>
              <div>{err}</div>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <button className="btn soft" type="button" disabled={busy} onClick={stop}>
              {busy ? "Stopping…" : "Stop"}
            </button>
          </div>
        </div>
      </>
    );
  }

  if (d.state === "done" && d.md) {
    return (
      <>
        {header}
        {lastRun}
        <div className="qabar">
          <span className="muted sm">Guide ready — hand it to QA.</span>
          {chip}
          <span className="spacer" />
          {d.connected && (
            <button className="btn soft" type="button" disabled={busy} onClick={gen}>
              {busy ? "Starting…" : "Regenerate"}
            </button>
          )}
          <button className="btn soft" type="button" onClick={download} data-testid="qa-download">
            Download .md
          </button>
          <button className="btn primary" type="button" onClick={copy}>
            {copied ? "Copied ✓" : "Copy guide"}
          </button>
        </div>
        {err && (
          <div className="banner err" data-testid="qa-error">
            <span>🚫</span>
            <div>{err}</div>
          </div>
        )}
        <div className="card">
          <Md className="qaguide" tasks>
            {d.md}
          </Md>
        </div>
      </>
    );
  }

  // failed / stopped / none — no guide on disk, so the strip is all there is to show.
  const note =
    lastRun ??
    (d.state === "stopped" ? (
      <div className="banner warn" data-testid="qa-last-run">
        <span>🛑</span>
        <div>
          <b>Stopped.</b> Generate a new guide below.
        </div>
      </div>
    ) : null);

  return (
    <>
      {header}
      {note}
      {chip}
      {err && (
        <div className="banner err" data-testid="qa-error">
          <span>🚫</span>
          <div>{err}</div>
        </div>
      )}
      <div className="card top">
        {d.state === "none" && !note && <h4 style={{ marginTop: 0 }}>No guide yet</h4>}
        {d.state === "none" && !note && (
          <p className="muted sm">
            Build a tester-ready QA guide from this PR's diff, review threads and history.
          </p>
        )}
        {d.connected ? (
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={gen}
            data-testid="qa-generate"
          >
            {busy ? "Starting…" : "Generate QA guide"}
          </button>
        ) : (
          gate
        )}
      </div>
    </>
  );
}

export function Qa({ me }: { me: Me }) {
  const { search } = useLocation();
  const pr = search.get("pr") || "";
  const repo = search.get("repo") || "";
  return pr ? <QaDetailView pr={{ repo, num: pr }} /> : <QaIndex me={me} />;
}
