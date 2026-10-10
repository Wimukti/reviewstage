// The first-run wizard for personal mode (`npx reviewstage`): three steps on one card under the
// login stage light. Each step is its own route so the GitHub device-flow redirect and a reload
// land back on the step the person was on:
//   /welcome          Continue with GitHub   (Login.tsx's flow, embedded)
//   /welcome/claude   Connect Claude         (Integrations.tsx's control, embedded; skippable)
//   /welcome/repos    Pick repositories      (GET /api/github/repos → POST /api/repos)
//   /welcome/privacy  One question, once     (Privacy.tsx's ConsentCard → POST /api/telemetry/consent)
// The privacy card is not a setup step — nothing is configured by it — so the stepper keeps its
// three chips, all done by then, and the card follows the repositories step until answered.
// App.tsx sends a personal install here while it has no signed-in user or no repository, and
// renders this without the sidebar: it is a focused flow, not a page in the shell.
import { useEffect, useState } from "react";
import { Check, FolderGit2 } from "lucide-react";
import { BrandIcon } from "./icons";
import { api, errMessage, type IntegrationsData, type Me } from "./api";
import { ClaudeCtl } from "./Integrations";
import { LoginForm } from "./Login";
import { Logo } from "./Logo";
import { RepoPicker } from "./RepoPicker";
import { ConsentCard } from "./Privacy";
import { navigate, useLocation } from "./router";
import { Banner, RawBanner, StatusBadge, UserAvatar } from "./ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const STEPS = ["GitHub", "Claude", "Repositories"] as const;
export { welcomeStep } from "./welcomeFlow";
import { welcomeStep, type WelcomeStep } from "./welcomeFlow";

// Each chip carries the mark of what it connects to — GitHub's, Claude's, a repository —
// coloured by state; a small check joins the label once the step is done.
const STEP_ICONS = [BrandIcon.gh, BrandIcon.claude, <FolderGit2 key="repo" strokeWidth={2} />];

// Three chips joined by a line — the PR page's stepper, with `current` pinned to the route
// rather than to the first undone step, because Claude can be skipped and come back to later.
function Stepper({ current, done }: { current: WelcomeStep; done: boolean[] }) {
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
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex [&_svg]:size-3.5",
                  state === "done" ? "text-green" : state === "current" ? "text-blue" : "text-muted-foreground",
                )}
              >
                {STEP_ICONS[i]}
              </span>
              <span>{label}</span>
              {state === "done" && <Check aria-hidden="true" className="size-3 text-green" />}
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
  // Older servers never report the flag: then there is no card to show.
  const askPrivacy = me.telemetry_decided === false;

  // The route is the truth; these only move it forward when a fact changes under it.
  useEffect(() => {
    if (!signedIn && step !== 0) navigate("/welcome");
    else if (signedIn && step === 0) navigate("/welcome/claude");
    else if (signedIn && claude && step === 1) navigate("/welcome/repos");
    else if (step === 3 && !askPrivacy) navigate("/");
  }, [signedIn, claude, step, askPrivacy]);

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
            {step === 2 && <ReposStep me={me} reload={reload} askPrivacy={askPrivacy} />}
            {step === 3 && (
              <ConsentCard
                me={me}
                onDone={() => {
                  void reload();
                  navigate("/");
                }}
              />
            )}
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

function ReposStep({ me, reload, askPrivacy }: { me: Me; reload: () => Promise<unknown>; askPrivacy: boolean }) {
  return (
    <div data-testid="welcome-repos" className="flex min-h-0 flex-col">
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Pick repositories</h2>
        {me.login && <SignedInAs login={me.login} />}
      </div>
      <p className="mb-4 mt-1 text-xs leading-relaxed text-muted-foreground">
        The repositories whose review requests you want here. Yours, and the ones you collaborate on.
      </p>
      <RepoPicker
        me={me}
        onSaved={async () => {
          await reload();
          navigate(askPrivacy ? "/welcome/privacy" : "/");
        }}
      />
    </div>
  );
}
