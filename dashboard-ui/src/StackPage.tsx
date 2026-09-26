import { useCallback, useEffect, useState } from "react";
import { api, errMessage, type StackData } from "./api";
import { prUrl } from "./pr";
import { PrTitle } from "./PrPage";
import { About } from "./ReviewParts";
import { Link, useLocation } from "./router";
import { Banner } from "./ui";
import { BrandIcon, Icon } from "./icons";
import { Status } from "./ui";

export function StackPage() {
  const { search } = useLocation();
  const pr = search.get("pr") || "";
  const repo = search.get("repo") || "";
  const ref = { repo, num: pr };
  const [d, setD] = useState<StackData | null>(null);
  const [effort, setEffort] = useState("standard");
  const [started, setStarted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loadErr, setLoadErr] = useState("");
  const load = useCallback(
    () =>
      pr
        ? api
            .stack(ref)
            .then((x) => {
              setLoadErr("");
              setD(x);
            })
            .catch((e: unknown) => setLoadErr(errMessage(e, "Couldn't load this stack.")))
        : Promise.resolve(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pr, repo],
  );
  useEffect(() => {
    load();
  }, [load]);
  // default: every PR in the stack selected
  useEffect(() => {
    if (d) setSel(new Set(d.stack.map((it) => it.num)));
  }, [d]);
  const toggle = (num: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      next.has(num) ? next.delete(num) : next.add(num);
      return next;
    });

  const head = (
    <>
      <nav className="bc">
        <Link to="/">Queue</Link>
        <span className="sep">/</span>
        {(d?.repo || repo) && (
          <>
            <Link to="/">{d?.repo || repo}</Link>
            <span className="sep">/</span>
          </>
        )}
        <Link to={prUrl({ repo: d?.repo || repo, num: pr })}>#{pr}</Link>
        <span className="sep">/</span>
        <span className="cur">stack</span>
      </nav>
      <div className="stackhead">
        <PrTitle repo={d?.repo || repo} num={pr} title="Stacked review" />
        <About>
          These open PRs form a stack — each is based on the one above it. Tick the ones to review
          and start them from here; they queue one at a time on this box, skipping any already
          running.
        </About>
      </div>
    </>
  );

  if (loadErr && !d)
    return (
      <>
        {head}
        <Banner kind="err" data-testid="stack-error">{loadErr}</Banner>
      </>
    );
  if (!d) return <>{head}<div className="muted">Loading…</div></>;

  if (!d.isStack)
    return (
      <>
        {head}
        <div className="card top">
          <h4 style={{ marginTop: 0 }}>Not a stack</h4>
          <p className="muted sm">
            Its base branch is not another open PR's branch.{" "}
            <Link to={prUrl({ repo: d.repo, num: pr })}>Back to the review</Link>.
          </p>
        </div>
      </>
    );

  const gate = (
    <div className="claudegate">
      <div className="cg-ico">{BrandIcon.claude}</div>
      <div className="cg-body">
        <b>Connect your Claude account to run reviews</b>
        <p className="muted sm">Reviews run on your own Claude subscription.</p>
        <Link className="btn primary" to="/integrations">
          Connect Claude
        </Link>
      </div>
    </div>
  );

  async function runSelected() {
    if (!d || sel.size === 0 || busy) return;
    setErr("");
    setBusy(true);
    try {
      const r = await api.stackRun({ repo: d.repo, num: pr }, d.runToken, effort, [...sel]);
      setStarted(r.started);
      load();
    } catch (x) {
      setErr(errMessage(x, "Couldn't queue those reviews."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {head}
      <div className="list">
        {d.stack.map((it, i) => {
          const pos = i === 0 ? "top" : i === d.stack.length - 1 ? "bottom" : "";
          return (
            <div className="row stackrow" key={it.num}>
              <input
                type="checkbox"
                className="fsel"
                checked={sel.has(it.num)}
                onChange={() => toggle(it.num)}
                aria-label={`Select #${it.num}`}
              />
              <Link className="rowlink" to={prUrl({ repo: d.repo, num: it.num })}>
                <div className="rowtop">
                  <span className="num">#{it.num}</span>
                  <span className="ttl">{it.title}</span>
                </div>
                <div className="muted sm rowsub">
                  <span>
                    <code>{it.head}</code> into <code>{it.base}</code>
                  </span>
                  {pos && <span>{pos} of stack</span>}
                </div>
              </Link>
              <div className="rowmeta">
                <Status kind={it.state} />
                <Link className="chev" to={prUrl({ repo: d.repo, num: it.num })} aria-hidden="true" tabIndex={-1}>
                  <Icon name="chevron-right" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      <div className="card top">
        {err && (
          <Banner kind="err">{err}</Banner>
        )}
        {started !== null && (
          <Banner kind="ok">
              Queued {started.toLocaleString()} review{started === 1 ? "" : "s"}. They run one at a
              time on the box.
            </Banner>
        )}
        {d.connected ? (
          <>
            <div className="effort-lbl">Effort (applied to every PR in the stack)</div>
            <div className="effrow">
              {d.levels.map((lv) => (
                <label key={lv.key} className={"eff" + (effort === lv.key ? " hot" : "")}>
                  <input
                    type="radio"
                    name="effort"
                    checked={effort === lv.key}
                    onChange={() => setEffort(lv.key)}
                  />
                  <span className="effname">{lv.name}</span>
                  <span className="effsub">{lv.sub}</span>
                </label>
              ))}
            </div>
            <div className="runrow">
              <span className="hint" style={{ flex: 1 }}>
                {sel.size.toLocaleString("en-US")} of {d.stack.length.toLocaleString("en-US")} ticked
              </span>
              <button
                className="btn primary"
                type="button"
                onClick={runSelected}
                disabled={busy || sel.size === 0}
                aria-busy={busy}
              >
                {busy ? "Starting…" : `Review selected (${sel.size})`}
              </button>
            </div>
          </>
        ) : (
          gate
        )}
      </div>
    </>
  );
}
