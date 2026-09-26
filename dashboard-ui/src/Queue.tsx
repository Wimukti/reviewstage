import { useEffect, useMemo, useState } from "react";
import { api, errMessage, type Me, type QueueData, type QueueRow } from "./api";
import { parsePrRef, prUrl } from "./pr";
import { getRepoFilter, REPO_FILTER_EVENT, setRepoFilter } from "./repoFilter";
import { Link, navigate, useLocation } from "./router";
import { runningFor, useRunning } from "./running";
import { About } from "./ReviewParts";
import { Banner } from "./ui";
import { Icon } from "./icons";
import { Status } from "./ui";

const SORTS: [string, string][] = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["activity", "Recent activity"],
  ["findings", "Most findings"],
];

const EMPTY: Record<string, [string, string, string]> = {
  todo: ["check", "You're all caught up", "No PRs are waiting on your review."],
  reviewed: ["inbox", "Nothing to post", "Reviews you've run and not yet posted show here."],
  posted: ["chat", "Nothing pending approval", "PRs you've commented on but not approved."],
  approved: ["check", "Nothing approved yet", "PRs you approve will be listed here."],
  archived: ["inbox", "No archived PRs", "Archived PRs are hidden from your working set."],
};

// The second line of a row: the PR's state as a dot and a phrase, then what the review found.
// A run in flight replaces it — the findings and timings it would show are not written yet,
// and what the reviewer wants is "still going, and where".
function RowState({ row, status }: { row: QueueRow; status: string }) {
  const dead = row.prState === "merged" || row.prState === "closed";
  if (status) {
    return (
      <div className="rowsub rowrun" data-testid="row-running">
        <Status kind="reviewing" live />
        <span>{status}</span>
        <span className="runback">— open to watch</span>
      </div>
    );
  }
  return (
    <div className="rowsub">
      <Status kind={row.state} />
      {dead && <Status kind={row.merged ? "merged" : "closed"} data-testid="pr-state" />}
      {row.sev.map((s) => (
        <Status key={s.kind} kind={s.kind}>
          {s.n} {s.label}
        </Status>
      ))}
      {row.size && <span className="muted sm">{row.size}</span>}
      {row.canApprove === false && (
        <span
          className="rownote"
          data-testid="no-approve"
          title={
            row.merged
              ? "This PR is merged — GitHub will not take an approval on it."
              : "This PR is closed — an approval on it would not be actionable."
          }
        >
          can't approve
        </span>
      )}
    </div>
  );
}

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
  // "no longer requested" is true of a merged PR too, and saying only that made a shipped PR
  // look like one someone quietly dropped you from.
  const dead = row.prState === "merged" || row.prState === "closed";
  const when = dead ? row.when.filter((w) => w !== "no longer requested") : row.when;
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
  const label = row.archived ? `Restore #${row.num}` : `Archive #${row.num}`;
  return (
    <div className={"row" + (status ? " running" : "")}>
      <Link className="rowlink" to={prUrl(ref)}>
        <div className="rowtop">
          {showRepo && <span className="repochip" title={row.repo}>{row.repo}</span>}
          <span className="num">#{row.num}</span>
          <span className="ttl">{row.title}</span>
        </div>
        <RowState row={row} status={status} />
      </Link>
      <div className="rowside">
        <span className="rowby">
          {[row.author, ...when].filter(Boolean).map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </span>
        <button
          type="button"
          className="rowact"
          onClick={toggleArchive}
          disabled={busy}
          aria-label={label}
          title={label}
        >
          <Icon name={row.archived ? "unarchive" : "archive"} />
        </button>
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

  // A remembered filter for a repo that no longer exists falls back to "all"; `repos` is only
  // known after the first response, so the first request sends whatever is remembered and the
  // effect re-runs if it turns out to be unknown.
  const [query, setQuery] = useState(q); // `q` debounced — one request per pause, not per key
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const runKey = jobs.map((j) => `${j.kind}:${j.repo}#${j.num}`).join(",");
  useEffect(() => {
    let live = true;
    // The filters go to the server, which applies them to EVERY tab — not just to the rows it
    // sends back — so a tab number and the list under it describe one set of PRs.
    api
      .queue(tab, sort, repoFilter, query)
      .then((d) => {
        if (!live) return;
        setErr("");
        setData(d);
      })
      .catch((e: unknown) => live && setErr(errMessage(e, "Couldn't load your queue.")));
    return () => {
      live = false;
    };
    // runKey: a job appearing or finishing changes what these rows should say.
  }, [tab, sort, nonce, runKey, repoFilter, query]);

  // Every repo we know of: configured + whatever the server reports. Deliberately NOT the
  // repos of the visible rows — under a repo filter that list is one entry, and the picker
  // offering exactly the filter you already applied is a dead end.
  const repos = useMemo(
    () => [...new Set<string>([...(me.repos || []), ...(data?.repos || [])])],
    [me.repos, data],
  );
  const multi = repos.length > 1;
  const activeFilter = repoFilter && repos.includes(repoFilter) ? repoFilter : "";
  // A remembered filter for a repository that no longer exists would otherwise be sent to the
  // server for ever and match nothing, while the picker said "All repositories". Forget it.
  useEffect(() => {
    if (data && repoFilter && !repos.includes(repoFilter)) setRepoFilter("");
  }, [data, repoFilter, repos]);

  const statusOf = (r: QueueRow) =>
    runningFor(jobs, "review", r.repo, r.num)?.status || (r.running ? r.status || "reviewing" : "");

  // Only the in-flight jobs still need filtering here: they come from the running store, not
  // from /api/queue, so the server never saw them.
  const matches = (repo: string, num: string, title: string) => {
    if (activeFilter && repo !== activeFilter) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${repo} ${repo}#${num} #${num} ${title}`.toLowerCase().includes(needle);
  };

  // ?running=1 is a view of the running-jobs store, not of a tab. Intersecting it with one tab's
  // rows hid every job on an archived or not-requested PR — and only matched kind "review", so a
  // QA guide in flight read as "Nothing running" while the sidebar pill counted it.
  const runningRows = useMemo(
    () => jobs.filter((j) => matches(j.repo, j.num, j.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey, query, activeFilter],
  );

  // The one field does both: what is typed filters the queue as it goes, and if it reads as a
  // PR reference — a URL, owner/name#123 or a bare number — Enter opens that PR.
  const parsed = parsePrRef(q, repos);
  const needsPick = !!parsed && !parsed.repo && multi;
  const goReview = () => {
    if (!parsed) return;
    const repo = parsed.repo || (multi ? rvRepo || repos[0] : repos[0] || "");
    navigate(prUrl({ repo, num: parsed.number }));
  };

  if (err && !data)
    return (
      <Banner kind="err" data-testid="queue-error">{err}</Banner>
    );
  if (!data) return <div className="wrap-load muted">Loading…</div>;
  const empty = EMPTY[tab] || ["inbox", "Nothing here yet", "This view is empty."];
  const filtering = !!(query.trim() || activeFilter);
  const rows = data.rows;
  // Per-repo counts for the open tab, so the picker says how much is behind each option.
  const repoCount = (r: string) => data.repoCounts?.[r]?.[tab];
  // A brand-new install has nothing in the queue because nothing is set up yet, which is not the
  // same as being caught up.
  const notSetUp = me.claude_connected === false || me.poller_ran === false;

  return (
    <>
      <div className="pagehead">
        <div className="pagehead-t">
          <h1>Your review queue</h1>
          <About>
            Reviews requested from you across{" "}
            {multi ? (
              <>
                <b>{repos.length} repositories</b>
                {me.allowOrg ? <> (and any under <code>{me.allowOrg}</code>)</> : null}
              </>
            ) : (
              <code>{repos[0] || me.repo}</code>
            )}
            . Type to filter, or paste a PR URL, <code>owner/name#123</code> or a number and press
            Enter to open it. Nothing reaches GitHub without your click.
          </About>
        </div>
        <form
          className="qsearch"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            goReview();
          }}
        >
          <input
            id="qsearch"
            className="in"
            type="search"
            autoComplete="off"
            aria-label="Filter your queue, or open a PR by URL or number"
            placeholder="Filter, or paste a PR URL or #123…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {parsed && (
            <button className="btn quiet" type="submit" data-testid="open-pr">
              Open #{parsed.number}
            </button>
          )}
        </form>
      </div>
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
        <Banner kind="warn">
            No Slack member ID yet — review requests won't ping you.{" "}
            <Link to="/integrations">Add it in Integrations.</Link>
          </Banner>
      )}

      <div className="tabs">
        {data.tabs.map((t) => (
          <Link key={t.key} className={"tab" + (tab === t.key ? " on" : "")} to={`/?tab=${t.key}&sort=${sort}`}>
            {t.label}
            <span className="cnt">{t.count.toLocaleString("en-US")}</span>
          </Link>
        ))}
      </div>
      <div className="qtools">
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
              {repos.map((r) => {
                const n = repoCount(r);
                return (
                  <option key={r} value={r}>
                    {r}
                    {n === undefined ? "" : ` (${n.toLocaleString("en-US")})`}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        <div className="seg sortseg" role="group" aria-label="Sort">
          {SORTS.map(([k, lbl]) => (
            <Link
              key={k}
              className={"sortopt" + (sort === k ? " on" : "")}
              aria-current={sort === k ? "true" : undefined}
              to={`/?tab=${tab}&sort=${k}`}
            >
              {lbl}
            </Link>
          ))}
        </div>
        {filtering && (
          <span className="filter-note" data-testid="filter-note">
            Every count above is for the filtered set.
          </span>
        )}
      </div>

      {err && (
        <Banner kind="err" data-testid="queue-error">{err}</Banner>
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
                  <div className="rowsub rowrun" data-testid="row-running">
                    <Status kind="reviewing" live>{j.kind === "qa" ? "QA guide" : "Review"}</Status>
                    <span>{j.status || (j.kind === "qa" ? "building" : "reviewing")}</span>
                    <span className="runback">— open to watch</span>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <Icon name="check" />
            <b>Nothing running</b>
            Every review and QA guide you started has finished.
          </div>
        )
      ) : rows.length > 0 ? (
        <div className="list" id="qlist" data-tour="queuelist">
          {rows.map((r) => (
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
          <Icon name="search" />
          <b>No matches</b>
          Nothing in this view matches your {query ? "search" : "repository filter"}.
        </div>
      ) : notSetUp && tab === "todo" ? (
        <div className="empty" data-testid="setup-needed">
          <Icon name="compass" />
          <b>Finish setting {me.brand} up</b>
          Your queue is empty because this install isn't ready yet, not because you're caught up.
          <ul className="setuplist">
            <li>
              <Icon name={me.claude_connected === false ? "circle" : "check"} />
              <span>
                Connect your Claude account — <Link to="/integrations">Integrations</Link>. Reviews
                run on it; nothing runs without it.
              </span>
            </li>
            <li>
              <Icon name={me.poller_ran === false ? "circle" : "check"} />
              <span>
                Let the poller run once so it can find the PRs that name you as a reviewer —{" "}
                <Link to="/settings">Settings</Link>.
              </span>
            </li>
          </ul>
          You can review any PR right now with the box at the top of this page.
        </div>
      ) : (
        <div className="empty">
          <Icon name={empty[0]} />
          <b>{empty[1]}</b>
          {empty[2]}
        </div>
      )}
      </div>
    </>
  );
}
