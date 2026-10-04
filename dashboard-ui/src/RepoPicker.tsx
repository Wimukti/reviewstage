// The repository picker: search over GET /api/github/repos (the signed-in person's own
// repositories), tick the ones to watch, POST /api/repos. The wizard's third step and the
// /repos page both render it; `onSaved` is where each one goes afterwards.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FolderGit2, Lock, Search } from "lucide-react";
import { api, errMessage, type GithubRepo, type Me } from "./api";
import { Banner, EmptyState, RepoPill, StatusBadge } from "./ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export const MAX_REPOS = 50;

export function RepoPicker({ me, onSaved, cta = "Start reviewing" }: { me: Me; onSaved: (repos: string[]) => void | Promise<void>; cta?: string }) {
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [rows, setRows] = useState<GithubRepo[] | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  // Pre-checked: whatever this install already reviews (from .env or an earlier visit).
  const [picked, setPicked] = useState<string[]>(() => [...(me.repos || [])]);
  const seeded = useRef(false);

  // 250 ms after the last keystroke the server filters; the first fetch is immediate.
  useEffect(() => {
    const t = window.setTimeout(() => setNeedle(q.trim()), q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    setRows(null);
    api
      .githubRepos(needle)
      .then((r) => {
        if (!live) return;
        setRows(r.repos);
        setErr("");
        if (!seeded.current) {
          seeded.current = true;
          const already = r.repos.filter((x) => x.already).map((x) => x.full_name);
          setPicked((p) => [...new Set([...p, ...already])]);
        }
      })
      .catch((x) => {
        if (!live) return;
        setRows([]);
        setErr(errMessage(x, "Could not list your repositories."));
      });
    return () => {
      live = false;
    };
  }, [needle]);

  const pickedSet = useMemo(() => new Set(picked.map((r) => r.toLowerCase())), [picked]);
  const full = picked.length >= MAX_REPOS;

  function toggle(name: string, on: boolean) {
    setPicked((p) => {
      const low = name.toLowerCase();
      const rest = p.filter((r) => r.toLowerCase() !== low);
      if (!on) return rest;
      if (rest.length >= MAX_REPOS) return p;
      return [...rest, name];
    });
  }

  async function start() {
    if (!picked.length || saving) return;
    setSaving(true);
    setSaveErr("");
    try {
      const r = await api.saveRepos(picked);
      await onSaved(r.repos);
    } catch (x) {
      setSaveErr(errMessage(x, "Could not save the repositories."));
      setSaving(false);
    }
  }

  return (
    <div data-testid="repo-picker" className="flex min-h-0 flex-col">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your repositories"
          aria-label="Search your repositories"
          autoComplete="off"
          spellCheck={false}
          className="pl-8"
          data-testid="repo-search"
        />
      </div>
      {err && (
        <div className="mt-3">
          <Banner kind="err" role="alert">{err}</Banner>
        </div>
      )}
      <ul className="m-0 mt-3 max-h-[min(52vh,420px)] list-none overflow-y-auto overflow-x-hidden rounded-lg bg-muted/40 p-0" data-testid="repo-list" aria-busy={rows === null}>
        {rows === null &&
          [0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2.5" data-testid="repo-skeleton">
              <Skeleton className="size-4 rounded-sm" />
              <Skeleton className="h-5 w-44 rounded-full" />
              <Skeleton className="ml-auto h-3 w-16" />
            </li>
          ))}
        {rows && rows.length === 0 && !err && (
          <li>
            <EmptyState icon={FolderGit2} title={needle ? "No match" : "No repositories"} className="py-8">
              {needle ? <>Nothing you can see is called “{needle}”.</> : <>GitHub lists no repositories for your account.</>}
            </EmptyState>
          </li>
        )}
        {rows?.map((r) => {
          const on = pickedSet.has(r.full_name.toLowerCase());
          const id = `repo-${r.full_name.replace(/[^a-z0-9]/gi, "-")}`;
          return (
            <li key={r.full_name} data-testid="repo-row" data-repo={r.full_name} data-checked={on ? "true" : "false"}>
              <label htmlFor={id} className={cn("flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/70", !on && full && "cursor-not-allowed opacity-60")}>
                <Checkbox id={id} checked={on} disabled={!on && full} onCheckedChange={(v) => toggle(r.full_name, v === true)} aria-label={r.full_name} />
                <RepoPill repo={r.full_name} avatar={r.owner_avatar} className="max-w-[min(100%,320px)]" />
                {r.private && <Lock aria-label="Private" className="size-3.5 shrink-0 text-muted-foreground" />}
                {r.already && <StatusBadge tone="green" icon={Check} label="Reviewing" className="shrink-0" data-testid="repo-already" />}
                <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">{pushedAgo(r.pushed_at)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-0 -mx-7 mt-4 border-t border-border bg-card px-7 pt-4 max-[899px]:-mx-5 max-[899px]:px-5" data-testid="repo-footer">
        {saveErr && <Banner kind="err" role="alert">{saveErr}</Banner>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground" data-testid="repo-count" aria-live="polite">
            {full ? `That's the most — ${MAX_REPOS} repositories.` : `${picked.length.toLocaleString("en-US")} selected`}
          </span>
          <Button type="button" size="lg" onClick={() => void start()} disabled={!picked.length || saving} aria-busy={saving} data-testid="start-reviewing">
            {saving ? "Saving…" : `${cta} (${picked.length.toLocaleString("en-US")})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** "pushed 3d ago" — coarse on purpose; it orders the list in the reader's head, nothing more. */
export function pushedAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 3600) return `pushed ${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `pushed ${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `pushed ${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 365) return `pushed ${Math.floor(s / (86400 * 30))}mo ago`;
  return `pushed ${Math.floor(s / (86400 * 365))}y ago`;
}
