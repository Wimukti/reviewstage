import { useState } from "react";
import { api, type Me } from "./api";

const NEW_TOKEN =
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

// Sign-in. With GitHub OAuth configured, "Continue with GitHub" is the one visible action and
// the token form sits behind a disclosure. Without it, the token form is the sign-in and the
// admin gets a pointer to the OAuth App setup. `?device=1` is the mobile / CLI pairing flow:
// after sign-in the server's /device interstitial hands a device token to the app.
export function Login({ me, onDone }: { me: Me; onDone: () => void }) {
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const q = query();
  const device = q.get("device") === "1";
  const devName = q.get("name") || "";
  // Seed from ?err= so an OAuth failure (redirected here by the server) is shown.
  const [err, setErr] = useState(() => q.get("err") || "");
  // GitHub is demoted (but still offered) when the org has not approved the app yet.
  const [showPat, setShowPat] = useState(!me.oauth || !!me.oauth_blocked || !!err);

  const deviceNext = "/prbot/device" + (devName ? `?name=${encodeURIComponent(devName)}` : "");
  const oauthHref = device ? `/oauth/start?next=${encodeURIComponent(deviceNext)}` : "/oauth/start";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pat.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await api.login(pat.trim());
      if (device) {
        window.location.assign("/device" + (devName ? `?name=${encodeURIComponent(devName)}` : ""));
        return;
      }
      onDone();
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
          placeholder="ghp_…"
          aria-label="GitHub personal access token"
          autoComplete="off"
          spellCheck={false}
          value={pat}
          onChange={(e) => setPat(e.target.value)}
        />
      </div>
      <button className={"btn block " + (me.oauth ? "soft" : "primary")} type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in with token"}
      </button>
      <p className="authfine">
        Need a token? <a href={NEW_TOKEN} target="_blank" rel="noopener">Create one</a> with the{" "}
        <code>repo</code> scope, then paste it above. It is stored encrypted and used only for the
        comments and approvals you click.
      </p>
    </form>
  );

  return (
    <div className="auth">
      <div className="authcard">
        {me.logo && <img className="authlogo" src={me.logo} alt="" />}
        <h1>{me.brand}</h1>
        <p className="authsub">Stage your PR review. Post it as yourself.</p>
        <p className="authlead">
          {device
            ? "Sign in to connect this device. Every comment and approval it posts will carry your own name."
            : "Every comment and approval posts under your own name — nothing is ever posted for you."}
        </p>
        {err && (
          <div className="banner err">
            <span>🚫</span>
            <div>{err}</div>
          </div>
        )}
        {me.oauth ? (
          <>
            <a className="btn primary block" href={oauthHref}>
              Continue with GitHub
            </a>
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
              <b>Running this server?</b> Teams should sign in with GitHub instead of tokens: create a
              GitHub OAuth App with callback{" "}
              <code>{(me.public_url || "PUBLIC_URL") + "/prbot/oauth/callback"}</code> and set{" "}
              <code>GH_CLIENT_ID</code> / <code>GH_CLIENT_SECRET</code>. Step by step in{" "}
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
