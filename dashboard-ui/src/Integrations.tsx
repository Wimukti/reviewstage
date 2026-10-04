import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { api, errBanner, errMessage, type IntegrationsData, type Me } from "./api";
import { BrandIcon } from "./icons";
import { Banner, PageHeader, RawBanner, StatusBadge } from "./ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const NOTE = "text-xs text-muted-foreground";
const HINT = cn(NOTE, "m-0 mt-2 leading-relaxed [&_b]:text-foreground");

// One integration: the brand glyph in a tile, the name and its state, a one-line status, and
// the control on the right — on a phone the control drops under the words.
function Row({
  icon,
  name,
  chip,
  sub,
  children,
}: {
  icon: ReactNode;
  name: string;
  chip: ReactNode;
  sub: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-4" data-testid="integration">
      <div className="flex min-w-0 flex-1 basis-[260px] items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&>svg]:size-5" aria-hidden="true">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{name}</span>
            {chip}
          </div>
          <div className={cn(NOTE, "mt-0.5 max-w-[60ch]")}>{sub}</div>
        </div>
      </div>
      <div className="w-full min-w-0 shrink-0 min-[900px]:w-[340px]">{children}</div>
    </div>
  );
}

const ON = <StatusBadge tone="green" data-testid="integration-state">Connected</StatusBadge>;
const OFF = <StatusBadge tone="graphite" icon={null} data-testid="integration-state">Not connected</StatusBadge>;
const REQ = <StatusBadge tone="amber" data-testid="integration-state">Required</StatusBadge>;

function GithubCtl({ token, onDone }: { token: IntegrationsData["token"]; onDone: (b: string) => void }) {
  const [show, setShow] = useState(false);
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  if (!show)
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setShow(true)}>
        <KeyRound aria-hidden="true" />
        Replace token
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
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
      <Input
        type="password"
        className="min-w-[160px] flex-1"
        placeholder="ghp_…"
        aria-label="New GitHub token"
        autoComplete="off"
        spellCheck={false}
        value={pat}
        onChange={(e) => setPat(e.target.value)}
      />
      <Button variant="secondary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

function IdCtl({
  token,
  value,
  field,
  placeholder,
  inputMode,
  label,
  fallback,
  hint,
  onDone,
}: {
  token: IntegrationsData["token"];
  value: string;
  field: "slack_id" | "discord_id";
  placeholder: string;
  inputMode?: "numeric";
  label: string;
  fallback: string;
  hint: ReactNode;
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
          const r = await api.saveSettings(token, { [field]: id.trim() });
          onDone(r.bannerHtml);
        } catch (x) {
          onDone(errBanner(x, fallback));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          className="min-w-[160px] flex-1"
          placeholder={placeholder}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          inputMode={inputMode}
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <Button variant="secondary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className={HINT}>{hint}</p>
    </form>
  );
}

function WebhookInfo({ notify }: { notify: IntegrationsData["notify"] }) {
  const [open, setOpen] = useState(false);
  const e = notify.env;
  return (
    <div className="flex flex-col gap-1">
      <p className={cn(HINT, "mt-0")}>
        {e.webhook_url ? (
          <span className="text-green">
            <code>WEBHOOK_URL</code> is set{e.webhook_secret ? " and requests are signed (WEBHOOK_SECRET)" : " — unsigned; set WEBHOOK_SECRET to sign requests"}.
          </span>
        ) : (
          <>
            Not configured. Set <code>WEBHOOK_URL</code> (and optionally <code>WEBHOOK_SECRET</code>) in{" "}
            <code>.env</code>, then enable it in Settings.
          </>
        )}
      </p>
      <p className={cn(HINT, "mt-0")}>
        Every event POSTs one JSON object with header <code>X-ReviewStage-Event</code> and, when
        signed, <code>X-ReviewStage-Signature: sha256=HMAC-SHA256(secret, body)</code>.
      </p>
      <Collapsible open={open} onOpenChange={setOpen} className="mt-1">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <ChevronDown aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
            {open ? "Hide payload schema" : "Show payload schema"}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-1 max-h-[340px] max-w-full overflow-auto font-mono text-xs [overflow-wrap:anywhere]" data-testid="payload-schema">
            {JSON.stringify(notify.payloadSchema, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// Exported for the first-run wizard (Welcome.tsx), which embeds this exact control.
export function ClaudeCtl({
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
  // The authorize URL exists only once a connect is in flight. A GET never mints one, so on
  // the first click we POST /api/claude/start and open what comes back. An empty href here
  // used to open the dashboard itself in a second window.
  const [authUrl, setAuthUrl] = useState(d.claude.authUrl);
  const [starting, setStarting] = useState(false);
  useEffect(() => setAuthUrl(d.claude.authUrl), [d.claude.authUrl]);
  async function begin() {
    if (starting) return;
    setStarting(true);
    setErr("");
    try {
      const r = await api.claudeStart(d.token);
      if (!r.authUrl) throw new Error(r.bannerHtml || "Claude did not return a sign-in address.");
      setAuthUrl(r.authUrl);
      setReveal(true);
      window.open(r.authUrl, "_blank", "noopener");
    } catch (x) {
      setErr(errMessage(x, "Could not start the Claude connection."));
    } finally {
      setStarting(false);
    }
  }
  if (d.claude.connected)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
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
      </Button>
    );
  return (
    <>
      {authUrl ? (
        <Button asChild variant={reveal ? "secondary" : "default"} className="w-full">
          <a target="_blank" rel="noopener" href={authUrl} onClick={() => setReveal(true)}>
            {BrandIcon.claude}
            {reveal ? "Reopen Claude" : "Connect with Claude"}
            <ExternalLink aria-hidden="true" className="size-3.5 opacity-70" />
          </a>
        </Button>
      ) : (
        <Button type="button" className="w-full" onClick={() => void begin()} disabled={starting} aria-busy={starting}>
          {BrandIcon.claude}
          {starting ? "Opening Claude…" : "Connect with Claude"}
          <ExternalLink aria-hidden="true" className="size-3.5 opacity-70" />
        </Button>
      )}
      <p className={HINT}>
        Opens Claude in a new tab — sign in with <em>your</em> account and click <b>Authorize</b>.
        Claude shows you a code; paste it below.
      </p>
      {reveal && (
        <form
          className="mt-3"
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
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="text"
              className="min-w-[160px] flex-1"
              autoFocus
              placeholder="paste the code from Claude"
              aria-label="Code from Claude"
              autoComplete="off"
              spellCheck={false}
              value={code}
              disabled={pending}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" disabled={pending || !code.trim()}>
              {pending && <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
              {pending ? "Verifying…" : "Connect"}
            </Button>
          </div>
          {pending && (
            <p className={HINT} role="status">
              Verifying your Claude account… this takes a few seconds.
            </p>
          )}
          {err && !pending && (
            err.trimStart().startsWith("<") ? (
              <div role="alert" dangerouslySetInnerHTML={{ __html: err }} />
            ) : (
              <Banner kind="err" role="alert">{err}</Banner>
            )
          )}
        </form>
      )}
    </>
  );
}

function IntegrationsSkeleton() {
  return (
    <Card className="gap-0 divide-y divide-border py-0" aria-busy="true">
      <span className="sr-only" role="status">Loading your integrations</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-4">
          <Skeleton className="size-9 rounded-md" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
      ))}
    </Card>
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

  const header = (
    <PageHeader
      title="Integrations"
      help={
        <>
          The services {me.brand} connects to. Everything is stored encrypted on this box and
          used only on your behalf.
        </>
      }
    />
  );
  if (err && !d)
    return (
      <>
        {header}
        <Banner kind="err" data-testid="integrations-error">{err}</Banner>
      </>
    );
  if (!d)
    return (
      <>
        {header}
        <IntegrationsSkeleton />
      </>
    );
  const hasSlack = !!d.slack.id;
  const hasDiscord = !!d.discord.id;
  const hasClaude = d.claude.connected;

  return (
    <>
      {header}
      <RawBanner html={banner} />
      <Card className="gap-0 divide-y divide-border py-0" data-testid="integrations-list">
        <Row
          icon={BrandIcon.gh}
          name="GitHub"
          chip={ON}
          sub={
            <>
              Connected as <b className="text-foreground">{d.github.login}</b>
              {d.github.via === "oauth" ? " via GitHub sign-in" : ""}. Comments and approvals post
              under your name.
            </>
          }
        >
          {d.github.via === "oauth" ? (
            // Someone who signed in through GitHub has no token to paste. The button only rendered
            // when the REDIRECT flow was configured, so on a device-flow install they were told to
            // reconnect with nothing to click. Either GitHub path can re-authenticate them.
            d.oauth || me.device_flow ? (
              <Button asChild variant="secondary">
                <a href="/oauth/start?next=%2Fintegrations">Reconnect with GitHub</a>
              </Button>
            ) : null
          ) : (
            <GithubCtl token={d.token} onDone={onDone} />
          )}
        </Row>
        <Row
          icon={BrandIcon.slack}
          name="Slack"
          chip={hasSlack ? ON : OFF}
          sub="Pings you when a review is requested."
        >
          <IdCtl
            token={d.token}
            value={d.slack.id}
            field="slack_id"
            placeholder="U0123ABCDEF"
            label="Slack member ID"
            fallback="Couldn't save your Slack ID."
            onDone={onDone}
            hint={
              <>
                In Slack: your <b>profile picture</b>, then <b>Profile</b>, then the <b>more</b> menu, then{" "}
                <b>Copy member ID</b>.
              </>
            }
          />
        </Row>
        <Row
          icon={BrandIcon.discord}
          name="Discord"
          chip={hasDiscord ? ON : OFF}
          sub={
            <>
              Mentions you in the Discord card when a review is requested.
              {!d.notify.env.discord_webhook && (
                <> <em>(No <code>DISCORD_WEBHOOK</code> on this server yet.)</em></>
              )}
            </>
          }
        >
          <IdCtl
            token={d.token}
            value={d.discord.id}
            field="discord_id"
            placeholder="123456789012345678"
            inputMode="numeric"
            label="Discord user ID"
            fallback="Couldn't save your Discord ID."
            onDone={onDone}
            hint={
              <>
                In Discord: <b>User Settings</b>, then <b>Advanced</b>, turn on <b>Developer Mode</b>, then
                right-click your name and <b>Copy User ID</b>.
              </>
            }
          />
        </Row>
        <Row
          icon={BrandIcon.webhook}
          name="Generic webhook"
          chip={d.notify.env.webhook_url ? ON : OFF}
          sub="Teams, Zapier, n8n or your own endpoint — the raw event JSON, HMAC-signed."
        >
          <WebhookInfo notify={d.notify} />
        </Row>
        <Row
          icon={BrandIcon.claude}
          name="Claude"
          chip={hasClaude ? ON : REQ}
          sub="Reviews and QA guides run on your own Claude subscription, never a shared account."
        >
          <ClaudeCtl d={d} onDone={onDone} />
        </Row>
      </Card>
    </>
  );
}
