import { useEffect, useRef, useState } from "react";
import { ApiError, api, type DeviceStart, type Me } from "./api";
import { Logo } from "./Logo";
import { Banner } from "./ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { BrandIcon } from "./icons";

const GitHubMark = () => <span className="inline-flex size-4 items-center [&>svg]:size-4" aria-hidden="true">{BrandIcon.gh}</span>;

// Fine-grained PAT (recommended): Pull requests read/write, Contents read, Metadata read on
// the repositories you review. A classic token with `repo` also works.
const NEW_TOKEN = "https://github.com/settings/personal-access-tokens/new";
const NEW_CLASSIC_TOKEN =
  "https://github.com/settings/tokens/new?" +
  new URLSearchParams({ scopes: "repo", description: "ReviewStage — PR reviews" }).toString();

const TEAM_DOCS = "https://wimukti.github.io/reviewstage/start/team-mode/";

function query() {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

type DeviceState =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "waiting"; start: DeviceStart }
  | { step: "done"; login: string }
  | { step: "failed"; why: "denied" | "expired" | "error"; message: string };

// Device flow: the server hands us a short code; the person enters it at
// github.com/login/device; we poll the server (which polls GitHub) until it has a token. The
// server enforces GitHub's minimum interval, so a 429 simply means "ask again later".
function useDeviceFlow(onOk: (login: string, welcome: boolean) => void) {
  const [state, setState] = useState<DeviceState>({ step: "idle" });
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const waiting = useRef(false);
  // A start already in flight. `disabled` on the button depends on rendered state, which two
  // triggers and a slow commit can race; this cannot be raced. A second start no longer breaks
  // the first (the server reuses the browser's binding), but it still spends a pending slot
  // and a GitHub call for nothing.
  const starting = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function fail(why: "denied" | "expired" | "error", message: string) {
    waiting.current = false;
    setState({ step: "failed", why, message });
  }

  function schedule(session: string, seconds: number) {
    if (timer.current) clearTimeout(timer.current);
    // A touch after the interval so the server never sees us early.
    timer.current = setTimeout(() => void poll(session, seconds), seconds * 1000 + 250);
  }

  async function poll(session: string, seconds: number) {
    if (!alive.current || !waiting.current) return;
    try {
      const r = await api.devicePoll(session);
      if (!alive.current || !waiting.current) return;
      if (r.status === "pending") {
        schedule(session, Math.max(r.interval || seconds, 1));
        return;
      }
      if (r.status === "ok") {
        waiting.current = false;
        setState({ step: "done", login: r.login || "" });
        onOk(r.login || "", !!r.welcome);
        return;
      }
      if (r.status === "denied") return fail("denied", "You cancelled the sign-in on GitHub.");
      if (r.status === "expired") return fail("expired", "That code expired before GitHub saw it.");
      fail("error", r.error || "GitHub did not complete the sign-in.");
    } catch {
      if (!alive.current || !waiting.current) return;
      // Network blip or the server restarting: keep waiting rather than failing the sign-in.
      schedule(session, seconds);
    }
  }

  /** Seconds to wait before retrying, for a 429; 0 for anything else. */
  function backoff(x: unknown): number {
    if (!(x instanceof ApiError) || x.status !== 429) return 0;
    const n = Number(x.data?.retry_after);
    return Math.min(Number.isFinite(n) && n > 0 ? n : 5, 30);
  }

  async function begin(retry = false) {
    if (starting.current) return;
    starting.current = true;
    if (timer.current) clearTimeout(timer.current);
    setCopied(false);
    waiting.current = false;
    setState({ step: "starting" });
    try {
      const start = await api.deviceStart();
      if (!alive.current) return;
      waiting.current = true;
      setState({ step: "waiting", start });
      schedule(start.session, Math.max(start.interval || 5, 1));
    } catch (x) {
      if (!alive.current) return;
      // A 429 is "not yet", not "no". Sit on the spinner and ask again once; only a second
      // refusal is worth telling the reviewer about.
      const wait = retry ? 0 : backoff(x);
      if (wait) {
        starting.current = false;
        timer.current = setTimeout(() => void begin(true), wait * 1000);
        return;
      }
      fail("error", x instanceof Error ? x.message : "Could not reach GitHub.");
    } finally {
      starting.current = false;
    }
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    waiting.current = false;
    const session = state.step === "waiting" ? state.start.session : "";
    setState({ step: "idle" });
    // Hand the pending slot back to the server instead of parking it until GitHub's 15-minute
    // code expiry — the table is capped, and the cap is what a flood attacks.
    if (session) {
      void api.deviceCancel(session).catch(() => {
        /* best effort: the session expires on its own */
      });
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => alive.current && setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (plain http, permissions) — the code is selectable text anyway */
    }
  }

  return { state, begin, cancel, copy, copied };
}

// Sign-in. "Continue with GitHub" is the one visible action whenever either GitHub path is on:
// the redirect flow when the admin registered an OAuth App (one click), else the device flow
// (a short code at github.com/login/device — works on every install, nothing to register).
// The token form sits behind a disclosure; it is the sign-in when both are off. `?device=1`
// is the mobile / CLI pairing flow: after sign-in the server's /device interstitial hands a
// device token to the app.
export function Login({ me, onDone }: { me: Me; onDone: () => void }) {
  return (
    <div className="auth flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="stage-login w-full max-w-[400px]">
        <Card className="authcard shadow-[0_24px_64px_-24px_rgba(0,0,0,.8)]">
          <CardContent className="flex flex-col items-center px-7 pb-7 pt-8 text-center">
            <Logo me={me} className="authlogo mb-4 size-10" />
            <h1 className="font-display text-2xl font-semibold tracking-tight">{me.brand}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Stage your review. Post it as yourself.</p>
            <LoginForm me={me} onDone={onDone} />
            <p className="authguarantee mt-6 w-full border-t border-border pt-4 text-xs text-muted-foreground">
              Nothing posts to GitHub until you click.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// The sign-in controls without the page around them, so the first-run wizard (Welcome.tsx)
// can embed the very same flow inside its own card. `onLanded`, when given, replaces the
// page's post-sign-in navigation (the wizard advances its own step instead); without it the
// behaviour is exactly the login page's.
export function LoginForm({
  me,
  onDone,
  onLanded,
}: {
  me: Me;
  onDone: () => void;
  onLanded?: (firstSignIn: boolean) => void;
}) {
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const q = query();
  const device = q.get("device") === "1";
  const devName = q.get("name") || "";
  // Seed from ?err= so an OAuth failure (redirected here by the server) is shown.
  const [err, setErr] = useState(() => q.get("err") || "");
  const redirectFlow = !!me.oauth;
  const deviceFlow = !redirectFlow && !!me.device_flow;
  const github = redirectFlow || deviceFlow;
  // GitHub is demoted (but still offered) when the org has not approved the app yet.
  const [showPat, setShowPat] = useState(!github || !!me.oauth_blocked || !!err);

  const deviceNext = "/device" + (devName ? `?name=${encodeURIComponent(devName)}` : "");
  const oauthHref = device ? `/oauth/start?next=${encodeURIComponent(deviceNext)}` : "/oauth/start";

  // Where a fresh session lands: the /device interstitial when pairing, Integrations on a
  // genuine first sign-in (there is nothing to review until Claude is connected), else ?next=
  // or the queue. Only local paths — an open redirect otherwise.
  //
  // This used to send first-timers to `/integrations?welcome=1&next=…`, and nothing anywhere
  // read either parameter: a teammate following a Slack link to a PR signed in and was
  // stranded on Integrations with no way back. `welcome` also fired on every sign-in forever
  // for anyone without Slack. The server's own redirect (see landing() in server.py) now
  // agrees with this.
  const rawNext = q.get("next") || "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  function landed(firstSignIn: boolean) {
    if (onLanded) {
      onLanded(firstSignIn);
      return;
    }
    if (device) {
      window.location.assign(deviceNext);
      return;
    }
    if (firstSignIn) {
      window.location.assign("/integrations");
      return;
    }
    // Signed in on /login itself: the SPA has no page there, so move to the destination.
    if (window.location.pathname.replace(/\/+$/, "") === "/login") {
      window.location.assign(next);
      return;
    }
    onDone();
  }

  const flow = useDeviceFlow((_login, welcome) => landed(welcome));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pat.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const r = (await api.login(pat.trim())) as unknown as { welcome?: boolean };
      landed(!!r.welcome);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  const patForm = (
    <form onSubmit={submit} aria-label="Sign in with a personal access token" className="mt-4 space-y-3">
      <Input
        type="password"
        placeholder="github_pat_… or ghp_…"
        disabled={busy}
        aria-label="GitHub personal access token"
        autoComplete="off"
        spellCheck={false}
        value={pat}
        onChange={(e) => setPat(e.target.value)}
        className="h-11 font-mono text-[13px]"
      />
      <Button
        type="submit"
        size="lg"
        variant={github ? "secondary" : "default"}
        className="w-full"
        disabled={busy || !pat.trim()}
        aria-busy={busy}
      >
        {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
        {busy ? "Verifying with GitHub…" : "Sign in with token"}
      </Button>
      <p className="text-xs leading-relaxed text-muted-foreground">
        <a className="underline underline-offset-2 hover:text-foreground" href={NEW_TOKEN} target="_blank" rel="noopener">
          Fine-grained token
        </a>{" "}
        (Pull requests: read and write · Contents: read · Metadata: read) or a{" "}
        <a className="underline underline-offset-2 hover:text-foreground" href={NEW_CLASSIC_TOKEN} target="_blank" rel="noopener">
          classic token
        </a>{" "}
        with <code className="font-mono">repo</code>. Stored encrypted.
      </p>
    </form>
  );

  const st = flow.state;
  const deviceCard =
    st.step === "waiting" || st.step === "done" ? (
      <div className="mt-2 rounded-lg bg-muted/60 p-4" role="group" aria-labelledby="devflow-title">
        <p id="devflow-title" className="text-sm font-medium">
          {st.step === "waiting" ? "Enter this code on GitHub" : "Signed in"}
        </p>
        {st.step === "waiting" && (
          <>
            <output
              className="my-3 block select-all rounded-md bg-background py-3 text-center font-mono text-3xl font-semibold tracking-[0.18em]"
              data-testid="device-user-code"
              aria-label="Your one-time GitHub code"
            >
              {st.start.user_code}
            </output>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => void flow.copy(st.start.user_code)}>
                {flow.copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {flow.copied ? "Copied" : "Copy code"}
              </Button>
              <Button asChild>
                <a href={st.start.verification_uri} target="_blank" rel="noopener">
                  Open github.com/login/device <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite" aria-label="Waiting for GitHub…">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Waiting for GitHub…
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              GitHub asks for the code, then to authorise <b className="text-foreground">{me.brand}</b>. This page signs you in by
              itself the moment you do.{" "}
              <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={flow.cancel}>
                Cancel
              </button>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground" data-testid="device-phishing-warning">
              <b className="text-foreground">Only continue a sign-in you started yourself.</b> If someone sent you this code
              or asked you to type one at github.com, stop — approving it would sign{" "}
              <i>them</i> in as you.
            </p>
          </>
        )}
        {st.step === "done" && (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
            <Check className="size-4 text-green" aria-hidden="true" />
            Signed in{st.login ? ` as ${st.login}` : ""} — loading…
          </p>
        )}
      </div>
    ) : null;

  const deviceFailed =
    st.step === "failed" ? (
      <Banner kind="err" role="alert">
        {st.message}{" "}
        <button type="button" className="underline underline-offset-2" onClick={() => void flow.begin()}>
          Try again
        </button>
      </Banner>
    ) : null;

  // The one permitted orientation sentence in the shell (design.md §6) sits here and nowhere
  // else; the team-setup instructions live in the docs, not on the screen.
  const teamLink = (
    <a className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" href={TEAM_DOCS} target="_blank" rel="noopener">
      Setting up sign-in for a team
    </a>
  );

  return (
            <div className="mt-6 w-full text-left">
              {err && <Banner kind="err">{err}</Banner>}
              {github ? (
                <>
                  {deviceFailed}
                  {deviceCard}
                  {redirectFlow && (
                    <Button asChild size="lg" className="w-full">
                      <a href={oauthHref}>
                        <GitHubMark /> Continue with GitHub
                      </a>
                    </Button>
                  )}
                  {deviceFlow && st.step !== "waiting" && st.step !== "done" && (
                    <Button
                      type="button"
                      size="lg"
                      className="w-full"
                      onClick={() => void flow.begin()}
                      disabled={st.step === "starting"}
                      aria-busy={st.step === "starting"}
                    >
                      {st.step === "starting" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <GitHubMark />}
                      {st.step === "starting" ? "Asking GitHub for a code…" : "Continue with GitHub"}
                    </Button>
                  )}
                  {me.oauth_blocked && !err && (
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      GitHub sign-in is waiting on an org owner to approve the app; a token works meanwhile.
                    </p>
                  )}
                  <div className="mt-3 text-center">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      aria-expanded={showPat}
                      aria-controls="pat-form"
                      data-testid="pat-toggle"
                      onClick={() => setShowPat((o) => !o)}
                    >
                      Use a token instead
                    </button>
                  </div>
                  {showPat && <div id="pat-form">{patForm}</div>}
                </>
              ) : (
                <>
                  {patForm}
                  <div className="mt-3 text-center">{teamLink}</div>
                </>
              )}
            </div>
  );
}
