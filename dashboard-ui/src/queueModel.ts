// The queue's data and filters, shared by the desk page (Queue.tsx) and the phone page
// (PhoneQueue.tsx) so the two layouts read one source: the tab, sort, repository filter and
// search all live in the URL or the remembered filter, the server applies them to every tab, and
// the running-jobs store supplies what is in flight.
import { Archive, CircleCheck, Inbox, MessageSquare, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errMessage, type Me, type QueueData, type QueueRow, type RunningJob } from "./api";
import { parsePrRef, prUrl } from "./pr";
import { noteFailure } from "./reach";
import { getRepoFilter, REPO_FILTER_EVENT, setRepoFilter } from "./repoFilter";
import { navigate, useLocation } from "./router";
import { setTodoCount } from "./queueCount";
import { runningFor, useRunning } from "./running";

export const SORTS: [string, string][] = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["activity", "Recent activity"],
  ["findings", "Most findings"],
];

export const EMPTY: Record<string, [LucideIcon, string, string]> = {
  todo: [CircleCheck, "You're all caught up", "No PRs are waiting on your review."],
  reviewed: [Inbox, "Nothing to post", "Reviews you've run and not yet posted show here."],
  posted: [MessageSquare, "Nothing pending approval", "PRs you've commented on but not approved."],
  approved: [CircleCheck, "Nothing approved yet", "PRs you approve will be listed here."],
  archived: [Archive, "No archived PRs", "Archived PRs are hidden from your working set."],
};

export function useQueueModel(me: Me, views?: readonly string[]) {
  const { search } = useLocation();
  const asked = search.get("tab") || "";
  const tab = views ? (views.includes(asked) ? asked : views[0]) : asked || "todo";
  const sort = search.get("sort") || "newest";
  // ?running=1 — where the sidebar pill points when several jobs are in flight.
  const onlyRunning = search.get("running") === "1";
  const jobs = useRunning();
  const [data, setData] = useState<QueueData | null>(null);
  const [q, setQ] = useState("");
  const [rvRepo, setRvRepo] = useState("");
  const [nonce, setNonce] = useState(0);
  const [err, setErr] = useState("");
  // Resolved when the next response (or failure) lands — pull to refresh waits on it.
  const waiters = useRef<(() => void)[]>([]);
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
    const settle = () => {
      const w = waiters.current;
      waiters.current = [];
      w.forEach((f) => f());
    };
    // The filters go to the server, which applies them to EVERY tab — not just to the rows it
    // sends back — so a tab number and the list under it describe one set of PRs.
    api
      .queue(tab, sort, repoFilter, query)
      .then((d) => {
        if (!live) return;
        setErr("");
        setData(d);
        // The tab bar's badge, for free, whenever these counts are the whole install's.
        if (!repoFilter && !query.trim()) setTodoCount(d.tabs.find((t) => t.key === "todo")?.count);
      })
      .catch((e: unknown) => {
        // The server is gone (a sleeping Mac behind the tunnel): the whole screen says so.
        if (!live || noteFailure(e)) return;
        setErr(errMessage(e, "Couldn't load your queue."));
      })
      .finally(() => {
        if (live) settle();
      });
    return () => {
      live = false;
    };
    // runKey: a job appearing or finishing changes what these rows should say.
  }, [tab, sort, nonce, runKey, repoFilter, query]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  /** Reload and resolve when the new answer is on screen. */
  const refresh = useCallback(
    () =>
      new Promise<void>((res) => {
        waiters.current.push(res);
        setNonce((n) => n + 1);
      }),
    [],
  );

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
  const runningRows: RunningJob[] = useMemo(
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

  const filtering = !!(query.trim() || activeFilter);
  // A brand-new install has nothing in the queue because nothing is set up yet, which is not the
  // same as being caught up.
  const noRepos = me.personal === true && (me.repos ?? []).length === 0;
  const notSetUp = me.claude_connected === false || me.poller_ran === false || noRepos;

  return {
    tab,
    sort,
    onlyRunning,
    jobs,
    data,
    err,
    setErr,
    q,
    setQ,
    query,
    rvRepo,
    setRvRepo,
    reload,
    refresh,
    repos,
    multi,
    activeFilter,
    statusOf,
    runningRows,
    parsed,
    needsPick,
    goReview,
    filtering,
    noRepos,
    notSetUp,
  };
}

export type QueueModel = ReturnType<typeof useQueueModel>;
