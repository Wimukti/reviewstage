import { useEffect, useMemo, useState } from "react";
import { api, errMessage, type Me, type QueueData, type QueueRow } from "./api";
import { parsePrRef, prUrl } from "./pr";
import { getRepoFilter, REPO_FILTER_EVENT, setRepoFilter } from "./repoFilter";
import { Link, navigate, useLocation } from "./router";
import { runningFor, useRunning } from "./running";

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


function Row({
  row,
  onChange,
  onError,
  showRepo,
  status,
}: {
  row: QueueRow;
  onChange: () => void;
  onError: (msg: string) => void;
  showRepo: boolean;
  status: string; // non-empty while a review of this PR is in flight for you
}) {
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
    } catch (x) {
      onError(errMessage(x, `Couldn't ${row.archived ? "restore" : "archive"} #${row.num}.`));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={"row" + (status ? " running" : "")}>
      <Link className="rowlink" to={prUrl(ref)}>
        <div className="rowtop">
          {showRepo && <span className="repochip" title={row.repo}>{row.repo}</span>}
          <span className="num">#{row.num}</span>
          <span className="ttl">{row.title}</span>
        </div>
        {status ? (
          // A run in flight replaces the meta line: the findings and timings it would show
          // are not written yet, and what the reviewer wants is "still going, and where".
          <div className="rowrun" data-testid="row-running">
            <span className="rundot" aria-hidden="true" />
            <span>{status}</span>
            <span className="runback">— open to watch</span>
          </div>
        ) : (
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
        )}
      </Link>
      <div className="rowmeta">
        <span className={"pill " + row.state}>{status ? "reviewing" : row.state}</span>
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
  // ?running=1 — where the sidebar pill points when several jobs are in flight.
  const onlyRunning = search.get("running") === "1";
  const jobs = useRunning();
  const [data, setData] = useState<QueueData | null>(null);
  const [q, setQ] = useState("");
  const [rv, setRv] = useState("");
  const [rvRepo, setRvRepo] = useState("");
  const [nonce, setNonce] = useState(0);
  const [err, setErr] = useState("");
  // Repository filter — remembered per browser (localStorage), "" = all.
  const [repoFilter, setRepoFilterState] = useState(getRepoFilter);
  useEffect(() => {
    const on = () => setRepoFilterState(getRepoFilter());
    window.addEventListener(REPO_FILTER_EVENT, on);
    return () => window.removeEventListener(REPO_FILTER_EVENT, on);
  }, []);

  const runKey = jobs.map((j) => `${j.kind}:${j.repo}#${j.num}`).join(",");
  useEffect(() => {
    let live = true;
    api.queue(tab, sort).then((d) => live && setData(d));
    return () => {
      live = false;
    };
    // runKey: a job appearing or finishing changes what these rows should say.
  }, [tab, sort, nonce, runKey]);

  // Every repo we know of: configured + anything in the rows (org-discovered).
  const repos = useMemo(() => {
    const set = new Set<string>([...(me.repos || []), ...(data?.repos || [])]);
    for (const r of data?.rows || []) if (r.repo) set.add(r.repo);
    return [...set];
  }, [me.repos, data]);
  const multi = repos.length > 1;
  // A remembered filter for a repo that no longer exists falls back to "all".
  const activeFilter = repoFilter && repos.includes(repoFilter) ? repoFilter : "";

  const statusOf = (r: QueueRow) =>
    runningFor(jobs, "review", r.repo, r.num)?.status || (r.running ? r.status || "reviewing" : "");

  const matches = (repo: string, num: string, title: string, author = "") => {
    if (activeFilter && repo !== activeFilter) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return `${repo} ${repo}#${num} #${num} ${title} ${author}`.toLowerCase().includes(needle);
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => matches(r.repo, r.num, r.title, r.author));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, activeFilter]);

  // ?running=1 is a view of the running-jobs store, not of a tab. Intersecting it with one tab's
  // rows hid every job on an archived or not-requested PR — and only matched kind "review", so a
  // QA guide in flight read as "Nothing running" while the sidebar pill counted it.
  const runningRows = useMemo(
    () => jobs.filter((j) => matches(j.repo, j.num, j.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey, q, activeFilter],
  );

  const parsed = parsePrRef(rv, repos);
  const needsPick = !!parsed && !parsed.repo && multi;
  const goReview = () => {
    if (!parsed) return;
    const repo = parsed.repo || (multi ? rvRepo || repos[0] : repos[0] || "");
    navigate(prUrl({ repo, num: parsed.number }));
  };

  if (!data) return <div className="wrap-load muted">Loading…</div>;
  const empty = EMPTY[tab] || ["📭", "Nothing here yet", "This view is empty."];
  const filtering = !!(q.trim() || activeFilter);
  // The server counts every tab over the whole install. Only the open tab's rows are here, so
  // only its count can honestly be recomputed — the rest are labelled rather than left to imply
  // that "2 rows" and "41" describe the same set.
  const countFor = (k: string) => (k === tab ? filtered.length : data.stats[k] ?? 0);
  const UNFILTERED = "Unfiltered — a search or repository filter applies only to the open tab.";
  // A brand-new install has nothing in the queue because nothing is set up yet, which is not the
  // same as being caught up.
  const notSetUp = me.claude_connected === false || me.poller_ran === false;

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
          placeholder="Review any PR — PR URL, owner/name#123, or a number…"
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
            <div className="k" title={filtering && k !== tab ? UNFILTERED : undefined}>
              {countFor(k).toLocaleString("en-US")}
              {filtering && k !== tab && <span className="cntnote"> all</span>}
            </div>
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
            <span
              className="cnt"
              title={filtering && t.key !== tab ? UNFILTERED : undefined}
            >
              {(t.key === tab ? filtered.length : t.count).toLocaleString("en-US")}
              {filtering && t.key !== tab ? " all" : ""}
            </span>
          </Link>
        ))}
      </div>
      <div className="tabdesc">
        {data.tabDesc}
        {filtering && (
          <span className="muted sm" data-testid="filter-note">
            {" "}
            Counts on the other tabs and tiles are for everything — the filter applies to this tab.
          </span>
        )}
      </div>

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


      {err && (
        <div className="banner err" data-testid="queue-error">
          <span>🚫</span>
          <div>{err}</div>
        </div>
      )}

      <div data-tour="queue">
      {onlyRunning ? (
        runningRows.length > 0 ? (
          <div className="list" id="qlist" data-testid="running-list">
            {runningRows.map((j) => (
              <div className="row running" key={`${j.kind}:${j.repo}#${j.num}`}>
                <Link className="rowlink" to={j.href}>
                  <div className="rowtop">
                    {multi && j.repo && (
                      <span className="repochip" title={j.repo}>
                        {j.repo}
                      </span>
                    )}
                    <span className="num">#{j.num}</span>
                    <span className="ttl">{j.title || `PR #${j.num}`}</span>
                  </div>
                  <div className="rowrun" data-testid="row-running">
                    <span className="rundot" aria-hidden="true" />
                    <span>{j.status || (j.kind === "qa" ? "building" : "reviewing")}</span>
                    <span className="runback">— open to watch</span>
                  </div>
                </Link>
                <div className="rowmeta">
                  <span className="pill reviewed">{j.kind === "qa" ? "QA guide" : "review"}</span>
                  <Link className="chev" to={j.href} aria-hidden="true">
                    ›
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <span className="ic">✅</span>
            <b>Nothing running</b>
            Every review and QA guide you started has finished.
          </div>
        )
      ) : filtered.length > 0 ? (
        <div className="list" id="qlist" data-tour="queuelist">
          {filtered.map((r) => (
            <Row
              key={`${r.repo}#${r.num}`}
              row={r}
              showRepo={multi}
              status={statusOf(r)}
              onChange={() => setNonce((n) => n + 1)}
              onError={setErr}
            />
          ))}
        </div>
      ) : filtering ? (
        <div className="empty">
          <span className="ic">🔍</span>
          <b>No matches</b>
          Nothing in this view matches your {q ? "search" : "repository filter"}.
        </div>
      ) : notSetUp && tab === "todo" ? (
        <div className="empty" data-testid="setup-needed">
          <span className="ic">🧭</span>
          <b>Finish setting {me.brand} up</b>
          Your queue is empty because this install isn't ready yet, not because you're caught up.
          <ul className="setuplist">
            <li>
              {me.claude_connected === false ? "○" : "✓"} Connect your Claude account —{" "}
              <Link to="/integrations">Integrations</Link>. Reviews run on it; nothing runs
              without it.
            </li>
            <li>
              {me.poller_ran === false ? "○" : "✓"} Let the poller run once so it can find the PRs
              that name you as a reviewer — <Link to="/settings">Settings</Link>.
            </li>
          </ul>
          You can review any PR right now with the box at the top of this page.
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
