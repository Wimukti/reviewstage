import { useEffect, useRef, useState } from "react";
import { ApiError, api, type DeviceStart, type Me } from "./api";
import { Logo } from "./Logo";
import { Banner, SlowBusy } from "./ui";

// Fine-grained PAT (recommended): Pull requests read/write, Contents read, Metadata read on
// the repositories you review. A classic token with `repo` also works.
const NEW_TOKEN = "https://github.com/settings/personal-access-tokens/new";
const NEW_CLASSIC_TOKEN =
  "https://github.com/settings/tokens/new?" +
  new URLSearchParams({ scopes: "repo", description: "ReviewStage — PR reviews" }).toString();

const OAUTH_DOCS = "https://wimukti.github.io/reviewstage/start/install/#github-sign-in";

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

// Sign-in. "Sign in with GitHub" is the one visible action whenever either GitHub path is on:
// the redirect flow when the admin registered an OAuth App (one click), else the device flow
// (a short code at github.com/login/device — works on every install, nothing to register).
// The token form sits behind a disclosure; it is the sign-in when both are off. `?device=1`
// is the mobile / CLI pairing flow: after sign-in the server's /device interstitial hands a
// device token to the app.
export function Login({ me, onDone }: { me: Me; onDone: () => void }) {
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
    <form onSubmit={submit} aria-label="Sign in with a personal access token">
      <div className="tokfield">
        <input
          className="in"
          type="password"
          placeholder="github_pat_… or ghp_…"
          disabled={busy}
          aria-label="GitHub personal access token"
          autoComplete="off"
          spellCheck={false}
          value={pat}
          onChange={(e) => setPat(e.target.value)}
        />
      </div>
      <button
        className={"btn block " + (github ? "secondary" : "primary")}
        type="submit"
        disabled={busy || !pat.trim()}
        aria-busy={busy}
      >
        <SlowBusy busy={busy} />{busy ? "Verifying with GitHub…" : "Sign in with token"}
      </button>
      <p className="authfine">
        Need a token?{" "}
        <a href={NEW_TOKEN} target="_blank" rel="noopener">
          Create a fine-grained token
        </a>{" "}
        for the repositories you review with <b>Pull requests: Read and write</b>,{" "}
        <b>Contents: Read</b> and <b>Metadata: Read</b>, then paste it above. It is stored
        encrypted and used only for the comments and approvals you click.
      </p>
      <p className="authfine">
        A{" "}
        <a href={NEW_CLASSIC_TOKEN} target="_blank" rel="noopener">
          classic token
        </a>{" "}
        with the <code>repo</code> scope also works.
      </p>
    </form>
  );

  const st = flow.state;
  const deviceCard =
    st.step === "waiting" || st.step === "done" ? (
      <div className="devflow" role="group" aria-labelledby="devflow-title">
        <p id="devflow-title" className="devflow-title">
          {st.step === "waiting" ? "Enter this code on GitHub" : "Signed in"}
        </p>
        {st.step === "waiting" && (
          <>
            <output className="devcode" data-testid="device-user-code" aria-label="Your one-time GitHub code">
              {st.start.user_code}
            </output>
            <div className="devflow-actions">
              <button type="button" className="btn secondary" onClick={() => void flow.copy(st.start.user_code)}>
                {flow.copied ? "Copied" : "Copy code"}
              </button>
              <a className="btn primary" href={st.start.verification_uri} target="_blank" rel="noopener">
                Open github.com/login/device
              </a>
            </div>
            <p className="devflow-wait" role="status" aria-live="polite" aria-label="Waiting for GitHub…">
              <span className="rundot" aria-hidden="true" /> Waiting for GitHub…
            </p>
            <p className="authfine">
              GitHub asks for the code, then to authorise <b>{me.brand}</b>. This page signs you in by
              itself the moment you do.{" "}
              <button type="button" className="linkbtn" onClick={flow.cancel}>
                Cancel
              </button>
            </p>
            <p className="authfine" data-testid="device-phishing-warning">
              <b>Only continue a sign-in you started yourself.</b> If someone sent you this code
              or asked you to type one at github.com, stop — approving it would sign{" "}
              <i>them</i> in as you.
            </p>
          </>
        )}
        {st.step === "done" && (
          <p className="devflow-wait" role="status" aria-live="polite">
            Signed in{st.login ? ` as ${st.login}` : ""} — loading…
          </p>
        )}
      </div>
    ) : null;

  const deviceFailed =
    st.step === "failed" ? (
      <Banner kind="err" role="alert">
          {st.message}{" "}
          <button type="button" className="linkbtn" onClick={() => void flow.begin()}>
            Try again
          </button>
        </Banner>
    ) : null;

  return (
    <div className="auth">
      <div className="authcard">
        <Logo me={me} className="authlogo" />
        <h1>{me.brand}</h1>
        <p className="authsub">Stage your PR review. Post it as yourself.</p>
        <p className="authlead">
          {device
            ? "Sign in to connect this device. Every comment and approval it posts will carry your own name."
            : "Every comment and approval posts under your own name — nothing is ever posted for you."}
        </p>
        {err && (
          <Banner kind="err">{err}</Banner>
        )}
        {github ? (
          <>
            {deviceFailed}
            {deviceCard}
            {redirectFlow && (
              <a className="btn primary block" href={oauthHref}>
                Sign in with GitHub
              </a>
            )}
            {deviceFlow && st.step !== "waiting" && st.step !== "done" && (
              <button
                type="button"
                className="btn primary block"
                onClick={() => void flow.begin()}
                disabled={st.step === "starting"}
                aria-busy={st.step === "starting"}
              >
                <SlowBusy busy={st.step === "starting"} />
                {st.step === "starting" ? "Asking GitHub for a code…" : "Sign in with GitHub"}
              </button>
            )}
            {deviceFlow && st.step === "idle" && (
              <p className="authfine devflow-hint">
                Shows a short code to enter at github.com/login/device. Nothing to install, no token to paste.
              </p>
            )}
            {me.oauth_blocked && !err && (
              <p className="authfine">
                GitHub sign-in is waiting on an org owner to approve the app; a token works meanwhile.
              </p>
            )}
            <details
              className="authalt"
              open={showPat}
              onToggle={(e) => setShowPat((e.target as HTMLDetailsElement).open)}
            >
              <summary>Use a personal access token instead</summary>
              {patForm}
            </details>
          </>
        ) : (
          <>
            {patForm}
            <p className="authfine authadmin">
              <b>Running this server?</b> Teams should sign in with GitHub instead of tokens. Set{" "}
              <code>GH_DEVICE_FLOW=1</code> for the zero-setup device flow, or create a GitHub OAuth App
              with callback <code>{(me.public_url || "PUBLIC_URL") + "/oauth/callback"}</code> and set{" "}
              <code>GH_CLIENT_ID</code> / <code>GH_CLIENT_SECRET</code> for one-click sign-in. Step by
              step in{" "}
              <a href={OAUTH_DOCS} target="_blank" rel="noopener">
                the install guide
              </a>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
