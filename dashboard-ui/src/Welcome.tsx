// The first-run wizard for personal mode (`npx reviewstage`): three steps on one card under the
// login stage light. Each step is its own route so the GitHub device-flow redirect and a reload
// land back on the step the person was on:
//   /welcome          Continue with GitHub   (Login.tsx's flow, embedded)
//   /welcome/claude   Connect Claude         (Integrations.tsx's control, embedded; skippable)
//   /welcome/repos    Pick repositories      (GET /api/github/repos → POST /api/repos)
// App.tsx sends a personal install here while it has no signed-in user or no repository, and
// renders this without the sidebar: it is a focused flow, not a page in the shell.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, CircleCheck, CircleDot, FolderGit2, Lock, Search } from "lucide-react";
import { api, errMessage, type GithubRepo, type IntegrationsData, type Me } from "./api";
import { ClaudeCtl } from "./Integrations";
import { LoginForm } from "./Login";
import { Logo } from "./Logo";
import { navigate, useLocation } from "./router";
import { Banner, EmptyState, RawBanner, RepoPill, StatusBadge, UserAvatar } from "./ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export const MAX_REPOS = 50;
const STEPS = ["GitHub", "Claude", "Repositories"] as const;
type StepIndex = 0 | 1 | 2;

export function welcomeStep(path: string): StepIndex {
  if (path.startsWith("/welcome/repos")) return 2;
  if (path.startsWith("/welcome/claude")) return 1;
  return 0;
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

// Three chips joined by a line — the PR page's stepper, with `current` pinned to the route
// rather than to the first undone step, because Claude can be skipped and come back to later.
function Stepper({ current, done }: { current: StepIndex; done: boolean[] }) {
  return (
    <ol className="m-0 flex list-none flex-wrap items-center justify-center gap-y-1 p-0 text-xs text-muted-foreground" data-testid="welcome-steps" aria-label="Setup steps">
      {STEPS.map((label, i) => {
        const state = done[i] ? "done" : i === current ? "current" : "pending";
        return (
          <li key={label} className="flex items-center" data-testid="welcome-step" data-state={state} aria-current={i === current ? "step" : undefined}>
            {i > 0 && <span aria-hidden="true" className="mx-1.5 h-px w-5 bg-border max-[899px]:w-3" />}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
                state === "done" && "bg-green/12 text-foreground",
                state === "current" && "bg-blue/12 text-foreground",
              )}
            >
              {state === "done" ? (
                <CircleCheck aria-hidden="true" className="size-3.5 text-green" />
              ) : state === "current" ? (
                <CircleDot aria-hidden="true" className="size-3.5 text-blue" />
              ) : (
                <Circle aria-hidden="true" className="size-3.5 text-muted-foreground" />
              )}
              <span>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Who the steps act as, at the right of the step heading: the avatar with the login beside
// it, so the initials fallback reads as a person rather than a stray letter.
function SignedInAs({ login }: { login: string }) {
  return (
    <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-testid="signed-in-as">
      <UserAvatar login={login} size="sm" />
      <span className="truncate">{login}</span>
    </span>
  );
}

export function Welcome({ me, reload }: { me: Me; reload: () => Promise<unknown> }) {
  const { path } = useLocation();
  const step = welcomeStep(path);
  const signedIn = !!me.authed && !!me.login;
  const claude = !!me.claude_connected;
  const haveRepos = (me.repos || []).length > 0;

  // The route is the truth; these only move it forward when a fact changes under it.
  useEffect(() => {
    if (!signedIn && step !== 0) navigate("/welcome");
    else if (signedIn && step === 0) navigate("/welcome/claude");
    else if (signedIn && claude && step === 1) navigate("/welcome/repos");
  }, [signedIn, claude, step]);

  return (
    <div className="auth flex min-h-dvh items-center justify-center overflow-x-hidden px-4 py-10" data-testid="welcome">
      <div className={cn("stage-login w-full", step === 2 ? "max-w-[560px]" : "max-w-[440px]")}>
        <Card className="authcard shadow-[0_24px_64px_-24px_rgba(0,0,0,.8)]">
          <CardContent className="flex flex-col px-7 pb-6 pt-7 max-[899px]:px-5">
            <div className="flex flex-col items-center text-center">
              <Logo me={me} className="authlogo mb-3 size-10" />
              <h1 className="font-display text-2xl font-semibold tracking-tight">{me.brand}</h1>
              <p className="mt-1 text-sm text-muted-foreground">Three steps, then your queue.</p>
              <div className="mt-4">
                <Stepper current={step} done={[signedIn, claude, haveRepos]} />
              </div>
            </div>
            {step === 0 && <GithubStep me={me} reload={reload} />}
            {step === 1 && <ClaudeStep me={me} reload={reload} />}
            {step === 2 && <ReposStep me={me} reload={reload} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function GithubStep({ me, reload }: { me: Me; reload: () => Promise<unknown> }) {
  return (
    <div data-testid="welcome-github">
      <h2 className="mt-6 text-sm font-medium">Continue with GitHub</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Review requests are found with your account, and everything you post is posted as you.
      </p>
      {/* The login page's own flow; on success the wizard reloads /api/me and advances. */}
      <LoginForm me={me} onDone={() => void reload()} onLanded={() => void reload()} />
    </div>
  );
}

function ClaudeStep({ me, reload }: { me: Me; reload: () => Promise<unknown> }) {
  const [d, setD] = useState<IntegrationsData | null>(null);
  const [err, setErr] = useState("");
  const [banner, setBanner] = useState("");
  const load = () =>
    api
      .integrations()
      .then((x) => {
        setD(x);
        setErr("");
      })
      .catch((x) => setErr(errMessage(x, "Could not load the Claude connection.")));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div data-testid="welcome-claude">
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Connect Claude</h2>
        {me.claude_connected && <StatusBadge kind="ok" label="Connected" />}
        {me.login && <SignedInAs login={me.login} />}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Reviews run on <em>your</em> Claude subscription, never a shared account. You can do this later
        from Integrations — nothing runs until it is connected.
      </p>
      <div className="mt-4">
        <RawBanner html={banner} />
        {err && <Banner kind="err">{err}</Banner>}
        {!d && !err && <Skeleton className="h-9 w-full" />}
        {d && (
          <ClaudeCtl
            d={d}
            onDone={(b) => {
              setBanner(b);
              void load();
              void reload();
            }}
          />
        )}
      </div>
      <div className="mt-4 text-center">
        <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/welcome/repos")} data-testid="claude-later">
          I'll do this later
        </Button>
      </div>
    </div>
  );
}

function ReposStep({ me, reload }: { me: Me; reload: () => Promise<unknown> }) {
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
      await api.saveRepos(picked);
      await reload();
      navigate("/");
    } catch (x) {
      setSaveErr(errMessage(x, "Could not save the repositories."));
      setSaving(false);
    }
  }

  return (
    <div data-testid="welcome-repos" className="flex min-h-0 flex-col">
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Pick repositories</h2>
        {me.login && <SignedInAs login={me.login} />}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        The repositories whose review requests you want here. Yours, and the ones you collaborate on.
      </p>
      <div className="relative mt-4">
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
            {saving ? "Saving…" : `Start reviewing (${picked.length.toLocaleString("en-US")})`}
          </Button>
        </div>
      </div>
    </div>
  );
}
