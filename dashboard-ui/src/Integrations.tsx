import { useCallback, useEffect, useState } from "react";
import { api, errBanner, errMessage, type IntegrationsData, type Me } from "./api";
import { BrandIcon } from "./icons";

function Banner({ html }: { html: string }) {
  if (!html) return null;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function Card({
  icon,
  cls,
  name,
  chip,
  sub,
  ok,
  children,
}: {
  icon: React.ReactNode;
  cls: string;
  name: string;
  chip: React.ReactNode;
  sub: React.ReactNode;
  ok?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={"intg" + (ok ? " ok" : "")}>
      <div className="itop">
        <div className={"iico " + cls}>{icon}</div>
        <div className="imeta">
          <div className="iname">
            {name} {chip}
          </div>
          <div className="idesc">{sub}</div>
        </div>
      </div>
      <div className="ictl">{children}</div>
    </div>
  );
}

const ON = <span className="tag-on">Connected</span>;
const OFF = <span className="tag-off">Not connected</span>;
const REQ = <span className="tag-req">Required</span>;

function GithubCtl({ token, onDone }: { token: IntegrationsData["token"]; onDone: (b: string) => void }) {
  const [show, setShow] = useState(false);
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  if (!show)
    return (
      <button type="button" className="replace" onClick={() => setShow(true)}>
        Replace token
      </button>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const r = await api.saveSettings(token, { pat });
          setPat("");
          setShow(false);
          onDone(r.bannerHtml);
        } catch (x) {
          onDone(errBanner(x, "Couldn't save that token."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="inrow">
        <input
          type="password"
          className="in"
          placeholder="ghp_…"
          autoComplete="off"
          spellCheck={false}
          value={pat}
          onChange={(e) => setPat(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function SlackCtl({
  token,
  value,
  onDone,
}: {
  token: IntegrationsData["token"];
  value: string;
  onDone: (b: string) => void;
}) {
  const [slack, setSlack] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSlack(value), [value]);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const r = await api.saveSettings(token, { slack_id: slack.trim() });
          onDone(r.bannerHtml);
        } catch (x) {
          onDone(errBanner(x, "Couldn't save your Slack ID."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="inrow">
        <input
          type="text"
          className="in"
          placeholder="U0123ABCDEF"
          autoComplete="off"
          spellCheck={false}
          value={slack}
          onChange={(e) => setSlack(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="hint">
        In Slack: your <b>profile picture</b> → <b>Profile</b> → the <b>⋮</b> menu →{" "}
        <b>Copy member ID</b>.
      </div>
    </form>
  );
}

function DiscordCtl({
  token,
  value,
  onDone,
}: {
  token: IntegrationsData["token"];
  value: string;
  onDone: (b: string) => void;
}) {
  const [id, setId] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setId(value), [value]);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const r = await api.saveSettings(token, { discord_id: id.trim() });
          onDone(r.bannerHtml);
        } catch (x) {
          onDone(errBanner(x, "Couldn't save your Discord ID."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="inrow">
        <input
          type="text"
          className="in"
          placeholder="123456789012345678"
          autoComplete="off"
          spellCheck={false}
          inputMode="numeric"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="hint">
        In Discord: <b>User Settings</b> → <b>Advanced</b> → turn on <b>Developer Mode</b>, then
        right-click your name → <b>Copy User ID</b>.
      </div>
    </form>
  );
}

function WebhookInfo({ notify }: { notify: IntegrationsData["notify"] }) {
  const [open, setOpen] = useState(false);
  const e = notify.env;
  return (
    <>
      <div className="hint">
        {e.webhook_url ? (
          <span className="ok">
            ✓ <code>WEBHOOK_URL</code> is set{e.webhook_secret ? " and requests are signed (WEBHOOK_SECRET)" : " — unsigned; set WEBHOOK_SECRET to sign requests"}.
          </span>
        ) : (
          <>
            Not configured. Set <code>WEBHOOK_URL</code> (and optionally <code>WEBHOOK_SECRET</code>) in{" "}
            <code>.env</code>, then enable it in Settings.
          </>
        )}
      </div>
      <div className="hint">
        Every event POSTs one JSON object with header <code>X-ReviewStage-Event</code> and, when
        signed, <code>X-ReviewStage-Signature: sha256=HMAC-SHA256(secret, body)</code>.
      </div>
      <button className="btn sm soft" type="button" style={{ marginTop: 10 }} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide payload schema" : "Show payload schema"}
      </button>
      {open && <pre className="schema">{JSON.stringify(notify.payloadSchema, null, 2)}</pre>}
    </>
  );
}

function ClaudeCtl({
  d,
  onDone,
}: {
  d: IntegrationsData;
  onDone: (b: string) => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [code, setCode] = useState("");
  // Verifying takes several seconds (a round-trip to Anthropic, then a `claude` call): say so.
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  if (d.claude.connected)
    return (
      <>
        <div className="hint ok">
          ✓ Connected — reviews you start run on your own Claude account.
        </div>
        <button
          className="discbtn"
          type="button"
          onClick={async () => {
            try {
              const r = await api.claudeDisconnect(d.token);
              onDone(r.bannerHtml);
            } catch (x) {
              onDone(errBanner(x, "Couldn't disconnect."));
            }
          }}
        >
          Disconnect
        </button>
      </>
    );
  return (
    <>
      <a
        className="btn primary block"
        target="_blank"
        rel="noopener"
        href={d.claude.authUrl}
        onClick={() => setReveal(true)}
      >
        {BrandIcon.claude}
        <span className="lbl">{reveal ? "Reopen Claude" : "Connect with Claude"}</span>
      </a>
      <div className="hint">
        Opens Claude in a new tab — sign in with <em>your</em> account and click <b>Authorize</b>.
        Claude shows you a code; paste it below.
      </div>
      {reveal && (
        <div style={{ marginTop: 12 }}>
          <form
            aria-busy={pending}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!code.trim() || pending) return;
              setPending(true);
              setErr("");
              try {
                const r = await api.claudeCode(d.token, code.trim());
                if (r.connected) {
                  setCode("");
                  onDone(r.bannerHtml);
                } else {
                  // The server's banner carries the reason; keep it next to the form.
                  setErr(r.bannerHtml || "Claude did not accept that code. Try again.");
                }
              } catch (x) {
                setErr(x instanceof Error ? x.message : "Could not reach the server.");
              } finally {
                setPending(false);
              }
            }}
          >
            <div className="inrow">
              <input
                type="text"
                className="in"
                autoFocus
                placeholder="paste the code from Claude"
                autoComplete="off"
                spellCheck={false}
                value={code}
                disabled={pending}
                onChange={(e) => setCode(e.target.value)}
              />
              <button className="btn primary" type="submit" disabled={pending || !code.trim()}>
                {pending && <span className="spin" aria-hidden="true" />} {pending ? "Verifying…" : "Connect"}
              </button>
            </div>
            {pending && (
              <div className="hint" role="status">
                Verifying your Claude account… this takes a few seconds.
              </div>
            )}
            {err && !pending && (
              err.trimStart().startsWith("<") ? (
                <div role="alert" dangerouslySetInnerHTML={{ __html: err }} />
              ) : (
                <div className="banner err" role="alert">
                  <span>🚫</span>
                  <div>{err}</div>
                </div>
              )
            )}
          </form>
        </div>
      )}
    </>
  );
}

export function Integrations({ me }: { me: Me }) {
  const [d, setD] = useState<IntegrationsData | null>(null);
  const [banner, setBanner] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(
    () =>
      api
        .integrations()
        .then((x) => {
          setErr("");
          setD(x);
        })
        .catch((e: unknown) => setErr(errMessage(e, "Couldn't load your integrations."))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const onDone = (b: string) => {
    setBanner(b);
    load();
  };

  if (err && !d)
    return (
      <div className="banner err" data-testid="integrations-error">
        <span>🚫</span>
        <div>{err}</div>
      </div>
    );
  if (!d) return <div className="muted">Loading…</div>;
  const hasSlack = !!d.slack.id;
  const hasDiscord = !!d.discord.id;
  const hasClaude = d.claude.connected;

  return (
    <>
      <h1>Integrations</h1>
      <p className="lead">
        The services {me.brand} connects to. Everything is stored encrypted on this box and used
        only on your behalf.
      </p>
      <Banner html={banner} />
      <Card
        icon={BrandIcon.gh}
        cls="gh"
        name="GitHub"
        chip={ON}
        ok
        sub={
          d.github.via === "oauth" ? (
            <>
              Connected as <code>{d.github.login}</code> via GitHub sign-in (OAuth) — comments
              and approvals post under your name. Revoke at github.com → Settings → Applications.
            </>
          ) : (
            <>
              Connected as <code>{d.github.login}</code> — comments and approvals post under your
              name.
            </>
          )
        }
      >
        {d.github.via === "oauth" ? (
          // Someone who signed in through GitHub has no token to paste. The button only rendered
          // when the REDIRECT flow was configured, so on a device-flow install they were told to
          // reconnect with nothing to click. Either GitHub path can re-authenticate them.
          d.oauth || me.device_flow ? (
            <a className="btn soft" href="/oauth/start?next=%2Fintegrations">
              Reconnect with GitHub
            </a>
          ) : null
        ) : (
          <GithubCtl token={d.token} onDone={onDone} />
        )}
      </Card>
      <Card
        icon={BrandIcon.slack}
        cls="slack"
        name="Slack"
        chip={hasSlack ? ON : OFF}
        ok={hasSlack}
        sub="Pings you when a review is requested."
      >
        <SlackCtl token={d.token} value={d.slack.id} onDone={onDone} />
      </Card>
      <Card
        icon={BrandIcon.discord}
        cls="discord"
        name="Discord"
        chip={hasDiscord ? ON : OFF}
        ok={hasDiscord}
        sub={
          <>
            Mentions you in the Discord card when a review is requested.
            {!d.notify.env.discord_webhook && (
              <> <em>(No <code>DISCORD_WEBHOOK</code> on this server yet.)</em></>
            )}
          </>
        }
      >
        <DiscordCtl token={d.token} value={d.discord.id} onDone={onDone} />
      </Card>
      <Card
        icon={BrandIcon.webhook}
        cls="hook"
        name="Generic webhook"
        chip={d.notify.env.webhook_url ? ON : OFF}
        ok={d.notify.env.webhook_url}
        sub="Teams, Zapier, n8n or your own endpoint — the raw event JSON, HMAC-signed."
      >
        <WebhookInfo notify={d.notify} />
      </Card>
      <Card
        icon={BrandIcon.claude}
        cls="claude"
        name="Claude"
        chip={hasClaude ? ON : REQ}
        ok={hasClaude}
        sub={
          <>
            <b>Required to review.</b> Reviews and QA guides run on your own Claude subscription —
            never a shared account.
          </>
        }
      >
        <ClaudeCtl d={d} onDone={onDone} />
      </Card>
    </>
  );
}
