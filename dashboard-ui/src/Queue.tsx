import { useEffect, useMemo, useState } from "react";
import { api, type Me, type QueueData, type QueueRow } from "./api";
import { parsePrRef, prUrl } from "./pr";
import { getRepoFilter, REPO_FILTER_EVENT, setRepoFilter } from "./repoFilter";
import { Link, navigate, useLocation } from "./router";

const SORTS: [string, string][] = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["activity", "Recent activity"],
  ["findings", "Most findings"],
];

const EMPTY: Record<string, [string, string, string]> = {
  todo: ["🎉", "You're all caught up", "No PRs are waiting on your review."],
  reviewed: ["📝", "Nothing to post", "Reviews you've run and not yet posted show here."],
  posted: ["💬", "Nothing pending approval", "PRs you've commented on but not approved."],
  approved: ["✅", "Nothing approved yet", "PRs you approve will be listed here."],
  archived: ["🗂️", "No archived PRs", "Archived PRs are hidden from your working set."],
};


function Row({ row, onChange, showRepo }: { row: QueueRow; onChange: () => void; showRepo: boolean }) {
  const [busy, setBusy] = useState(false);
  const ref = { repo: row.repo, num: row.num };
  async function toggleArchive(e: React.MouseEvent) {
    // The button sits outside the row's <Link>, but guard anyway so a click never navigates.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await api.archive(ref, row.archiveToken, row.archived ? "unarchive" : "archive");
      onChange();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="row">
      <Link className="rowlink" to={prUrl(ref)}>
        <div className="rowtop">
          {showRepo && <span className="repochip" title={row.repo}>{row.repo}</span>}
          <span className="num">#{row.num}</span>
          <span className="ttl">{row.title}</span>
        </div>
        <div className="muted sm rowsub">
          {row.author && <span>{row.author}</span>}
          {row.size && <span>{row.size}</span>}
          {row.when.map((w, i) => (
            <span key={i}>{w}</span>
          ))}
          {row.sev.length > 0 && (
            <span className="chipwrap">
              {row.sev.map((s) => (
                <span key={s.kind} className={"pill " + s.kind}>
                  {s.n} {s.label}
                </span>
              ))}
            </span>
          )}
        </div>
      </Link>
      <div className="rowmeta">
        <span className={"pill " + row.state}>{row.state}</span>
        <button
          type="button"
          className="rowact"
          onClick={toggleArchive}
          disabled={busy}
          aria-label={row.archived ? `Restore #${row.num}` : `Archive #${row.num}`}
        >
          {busy ? "…" : row.archived ? "restore" : "archive"}
        </button>
        <Link className="chev" to={prUrl(ref)} aria-hidden="true">
          ›
        </Link>
      </div>
    </div>
  );
}

export function Queue({ me }: { me: Me }) {
  const { search } = useLocation();
  const tab = search.get("tab") || "todo";
  const sort = search.get("sort") || "newest";
  const [data, setData] = useState<QueueData | null>(null);
  const [q, setQ] = useState("");
  const [rv, setRv] = useState("");
  const [rvRepo, setRvRepo] = useState("");
  const [nonce, setNonce] = useState(0);
  // Repository filter — remembered per browser (localStorage), "" = all.
  const [repoFilter, setRepoFilterState] = useState(getRepoFilter);
  useEffect(() => {
    const on = () => setRepoFilterState(getRepoFilter());
    window.addEventListener(REPO_FILTER_EVENT, on);
    return () => window.removeEventListener(REPO_FILTER_EVENT, on);
  }, []);

  useEffect(() => {
    let live = true;
    api.queue(tab, sort).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [tab, sort, nonce]);

  // Every repo we know of: configured + anything in the rows (org-discovered).
  const repos = useMemo(() => {
    const set = new Set<string>([...(me.repos || []), ...(data?.repos || [])]);
    for (const r of data?.rows || []) if (r.repo) set.add(r.repo);
    return [...set];
  }, [me.repos, data]);
  const multi = repos.length > 1;
  // A remembered filter for a repo that no longer exists falls back to "all".
  const activeFilter = repoFilter && repos.includes(repoFilter) ? repoFilter : "";

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (activeFilter && r.repo !== activeFilter) return false;
      if (!needle) return true;
      return `${r.repo} ${r.repo}#${r.num} #${r.num} ${r.title} ${r.author}`.toLowerCase().includes(needle);
    });
  }, [data, q, activeFilter]);

  const parsed = parsePrRef(rv, repos);
  const needsPick = !!parsed && !parsed.repo && multi;
  const goReview = () => {
    if (!parsed) return;
    const repo = parsed.repo || (multi ? rvRepo || repos[0] : repos[0] || "");
    navigate(prUrl({ repo, num: parsed.number }));
  };

  if (!data) return <div className="wrap-load muted">Loading…</div>;
  const empty = EMPTY[tab] || ["📭", "Nothing here yet", "This view is empty."];

  return (
    <>
      <h1>Your review queue</h1>
      <p className="muted sm">
        Reviews requested from you across{" "}
        {multi ? (
          <>
            <b>{repos.length} repositories</b>
            {me.allowOrg ? <> (and any under <code>{me.allowOrg}</code>)</> : null}
          </>
        ) : (
          <code>{repos[0] || me.repo}</code>
        )}
        . Nothing reaches GitHub without your click.
      </p>

      <form
        className="reviewany"
        onSubmit={(e) => {
          e.preventDefault();
          goReview();
        }}
      >
        <span className="ra-ico">✨</span>
        <input
          className="in"
          type="text"
          autoComplete="off"
          placeholder={
            multi
              ? "Review any PR — paste a GitHub URL, owner/name#123, or a number…"
              : "Review any PR — paste a number or GitHub URL…"
          }
          value={rv}
          onChange={(e) => setRv(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={!parsed}>
          Review
        </button>
      </form>
      {needsPick && (
        <div className="repopick" data-testid="repo-pick">
          <span className="lbl">Which repository is #{parsed!.number} in?</span>
          <select
            aria-label="Repository for the pasted PR number"
            value={rvRepo || repos[0]}
            onChange={(e) => setRvRepo(e.target.value)}
          >
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      )}
      {!data.slackOk && (
        <div className="banner warn">
          <span>💬</span>
          <div>
            No Slack member ID yet — review requests won't ping you.{" "}
            <Link to="/integrations">Add it in Integrations.</Link>
          </div>
        </div>
      )}

      <div className="stats">
        {(["todo", "reviewed", "posted", "approved"] as const).map((k, i) => (
          <Link
            key={k}
            className={"stat" + (i === 0 ? " hot" : "") + (tab === k ? " on" : "")}
            to={`/?tab=${k}&sort=${sort}`}
          >
            <div className="k">{data.stats[k]}</div>
            <div className="l">
              {k === "todo"
                ? "Awaiting your review"
                : k === "reviewed"
                ? "Ready to post"
                : k === "posted"
                ? "Pending approval"
                : "Approved"}
            </div>
          </Link>
        ))}
      </div>

      <div className="tabs">
        {data.tabs.map((t) => (
          <Link key={t.key} className={"tab" + (tab === t.key ? " on" : "")} to={`/?tab=${t.key}&sort=${sort}`}>
            {t.label}
            <span className="cnt">{t.count}</span>
          </Link>
        ))}
      </div>
      <div className="tabdesc">{data.tabDesc}</div>

      <div className="qtools">
        <input
          id="qsearch"
          className="in"
          type="search"
          autoComplete="off"
          placeholder={multi ? "Filter your queue — title, author, repo…" : "Filter your queue…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {multi && (
          <label className="repofilter">
            <span className="muted sm">Repository</span>
            <select
              id="repofilter"
              aria-label="Filter by repository"
              value={activeFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
            >
              <option value="">All repositories</option>
              {repos.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="sortbar">
          <span className="muted sm">Sort</span>
          {SORTS.map(([k, lbl]) => (
            <Link key={k} className={"sortopt" + (sort === k ? " on" : "")} to={`/?tab=${tab}&sort=${k}`}>
              {lbl}
            </Link>
          ))}
        </div>
      </div>


      <div data-tour="queue">
      {filtered.length > 0 ? (
        <div className="list" id="qlist" data-tour="queuelist">
          {filtered.map((r) => (
            <Row key={`${r.repo}#${r.num}`} row={r} showRepo={multi} onChange={() => setNonce((n) => n + 1)} />
          ))}
        </div>
      ) : q || activeFilter ? (
        <div className="empty">
          <span className="ic">🔍</span>
          <b>No matches</b>
          Nothing in this view matches your {q ? "search" : "repository filter"}.
        </div>
      ) : (
        <div className="empty">
          <span className="ic">{empty[0]}</span>
          <b>{empty[1]}</b>
          {empty[2]}
        </div>
      )}
      </div>
    </>
  );
}
