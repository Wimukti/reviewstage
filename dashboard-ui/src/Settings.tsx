import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, KeyRound, LogOut, MonitorSmartphone, Plus, Save } from "lucide-react";
import {
  api,
  errMessage,
  type Device,
  type Me,
  type MintedDevice,
  type NotifyBackend,
  type RuntimeSettings,
  type SettingsData,
  type SettingSource,
  type WebhooksStatus,
} from "./api";
import { PushDevices } from "./PushDevices";
import { Banner, PageHeader, RawBanner, StatusBadge } from "./ui";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

// Runtime settings — the knobs an operator changes without editing .env or restarting
// anything. They live in $ROOT/settings.json (settings.json > .env > default); the poller and
// the scripts re-read the file every cycle. Admin-only to save; everyone else sees a read-only
// view. DRY_RUN is deliberately absent: it stays in .env as a restart-gated safety.

const NOTE = "text-xs text-muted-foreground";
const SRC_LABEL: Record<SettingSource, string> = {
  settings: "Settings",
  env: ".env",
  default: "default",
};

function Source({ s }: { s: SettingSource }) {
  return (
    <Badge variant="outline" className="text-muted-foreground" title={`Where the current value comes from: ${SRC_LABEL[s]}`}>
      {SRC_LABEL[s]}
    </Badge>
  );
}

// A settings group: a Card with a real heading, rows divided by one hairline.
function Group({ title, description, children, className, ...rest }: { title: string; description?: ReactNode; children: ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <Card className={cn("gap-0 py-0", className)} {...rest}>
      <CardHeader className="px-5 pb-0 pt-4">
        <CardTitle>
          <h2 className="m-0 text-sm font-medium leading-none">{title}</h2>
        </CardTitle>
        {description && <CardDescription className={NOTE}>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="divide-y divide-border px-5 pb-1">{children}</CardContent>
    </Card>
  );
}

// A row: the words on the left, the control on the right; on a phone the control drops under
// the label so a long hint never wraps a word per line beside a wide control.
function Row({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 py-3 max-[899px]:grid-cols-1" data-testid="setting-row">
      <div className="min-w-0">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-sm font-medium">{label}</Label>
        ) : (
          <div className="text-sm font-medium">{label}</div>
        )}
        {hint && <div className={cn(NOTE, "mt-0.5 leading-relaxed")} data-testid="setting-hint">{hint}</div>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{children}</div>}
    </div>
  );
}

function agoText(ts: number | null): string {
  if (!ts) return "never (no completed poll recorded yet)";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  const when = new Date(ts * 1000);
  const mm = String(when.getMonth() + 1).padStart(2, "0");
  const dd = String(when.getDate()).padStart(2, "0");
  const yy = String(when.getFullYear()).slice(-2);
  const hh = String(when.getHours()).padStart(2, "0");
  const mi = String(when.getMinutes()).padStart(2, "0");
  const rel = s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
  return `${mm}/${dd}/${yy} ${hh}:${mi} (${rel})`;
}

// GitHub → ReviewStage webhooks. Read-only here: the secret lives in .env, the hook itself is
// configured on GitHub. The card shows what GitHub needs and whether deliveries are arriving.
const WEBHOOK_EVENTS = "Pull requests, Pull request reviews";

function webhookInstructions(url: string): string {
  return [
    "GitHub → your repository (or organization) → Settings → Webhooks → Add webhook",
    `Payload URL: ${url}`,
    "Content type: application/json",
    "Secret: the value of GITHUB_WEBHOOK_SECRET in the server's .env",
    `Events: "Let me select individual events" → tick ${WEBHOOK_EVENTS}`,
    "Save. GitHub sends a ping — 'Last ping' below updates within a few seconds.",
  ].join("\n");
}

function WebhooksCard({ wh, pollSeconds }: { wh: WebhooksStatus; pollSeconds: number }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const text = webhookInstructions(wh.url);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (http, permissions) — the text is visible below anyway */
    }
  };
  const minutes = Math.round(pollSeconds / 60);
  return (
    <Card className="gap-0 py-0" data-testid="webhooks-card">
      <CardHeader className="px-5 pb-0 pt-4">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-sm font-medium leading-none">Webhooks</h2>
          <StatusBadge tone="graphite" icon={null}>Read-only</StatusBadge>
        </CardTitle>
        <CardDescription className={NOTE} data-testid="webhooks-readonly">
          Nothing to save here: the secret lives in <code>.env</code> and the hook is configured on GitHub.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border px-5 pb-1">
        <Row
          label="Status"
          hint={
            wh.active
              ? "A verified event arrived within two poll intervals — GitHub is reaching this server."
              : wh.configured
                ? `No event in the last ${2 * minutes} minutes. The poller is keeping the queue fresh; add the hook on GitHub (or check its Recent Deliveries) to go instant.`
                : "GITHUB_WEBHOOK_SECRET is not set in .env, so the endpoint answers 503 and the poller does all the work."
          }
        >
          <StatusBadge kind={wh.active ? "ok" : "warn"} data-testid="webhooks-status">
            {wh.active ? "Webhooks active" : "Polling only"}
          </StatusBadge>
        </Row>
        <Row label="Payload URL" hint={<code className="[overflow-wrap:anywhere]">{wh.url}</code>} />
        <Row
          label="Secret"
          hint={
            wh.configured ? (
              <StatusBadge tone="green">Configured</StatusBadge>
            ) : (
              <>
                not set · <code>GITHUB_WEBHOOK_SECRET</code> in <code>.env</code> (restart the server after adding it)
              </>
            )
          }
        />
        <Row
          label="Deliveries"
          hint={
            <>
              {wh.count.toLocaleString("en-US")} event{wh.count === 1 ? "" : "s"} received · last event{" "}
              {wh.last_event_at ? `${agoText(wh.last_event_at)}${wh.last_event ? ` (${wh.last_event})` : ""}` : "never"}{" "}
              · last ping {wh.last_ping ? agoText(wh.last_ping) : "never"}
              {wh.last_error && (
                <>
                  {" "}
                  · <span className="text-red">last error: {wh.last_error}</span>
                </>
              )}
            </>
          }
        />
        <Collapsible open={open} onOpenChange={setOpen} className="py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-2">
                <ChevronDown aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
                Set it up on GitHub
              </Button>
            </CollapsibleTrigger>
            <Button variant="ghost" size="sm" type="button" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy instructions"}
            </Button>
          </div>
          <CollapsibleContent>
            <pre className="mt-1 mb-2 whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]" data-testid="webhook-instructions">
              {text}
            </pre>
          </CollapsibleContent>
        </Collapsible>
        {wh.active && (
          <p className={cn(NOTE, "m-0 py-3 text-green")}>
            Webhooks are doing the work now — you can lower the poll interval or turn polling off
            in the Poller card. Polling stays on until you change it; it is the safety net for a
            missed delivery.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const BACKEND_META: Record<NotifyBackend, { name: string; sub: string; envKey: (e: SettingsData["env"]) => boolean; envLabel: string }> = {
  slack: {
    name: "Slack",
    sub: "Block Kit cards; threaded replies with a bot token.",
    envKey: (e) => e.slack_webhook || e.slack_bot,
    envLabel: "SLACK_WEBHOOK or SLACK_BOT_TOKEN + SLACK_CHANNEL",
  },
  discord: {
    name: "Discord",
    sub: "An embed per card, mentioning the reviewer's Discord ID.",
    envKey: (e) => e.discord_webhook,
    envLabel: "DISCORD_WEBHOOK",
  },
  generic: {
    name: "Generic webhook",
    sub: "Raw JSON POST, HMAC-signed — Teams, Zapier, n8n, your own endpoint.",
    envKey: (e) => e.webhook_url,
    envLabel: "WEBHOOK_URL (+ WEBHOOK_SECRET)",
  },
  none: {
    name: "None — the dashboard is the inbox",
    sub: "Nothing is sent anywhere; open the queue yourself.",
    envKey: () => true,
    envLabel: "",
  },
};

function dateText(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

// Settings → Devices. Per-user, not admin-only: every signed-in person manages the bearer
// tokens their own phone / CLI / second browser hold (docs/MOBILE.md). The token is shown
// exactly once, on creation; the server keeps only its hash.
export function Devices({ me }: { me: Me }) {
  const [rows, setRows] = useState<Device[] | null>(null);
  const [devOnly, setDevOnly] = useState(false);
  useEffect(() => {
    const on = () => {
      const here = window.location.hash === "#devices";
      setDevOnly(here);
      if (here) document.getElementById("devices")?.scrollIntoView({ block: "start" });
    };
    on();
    window.addEventListener("hashchange", on);
    window.addEventListener("reviewstage:navigate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("reviewstage:navigate", on);
    };
  }, []);
  const [meta, setMeta] = useState({ max: 10, ttl_days: 180 });
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<MintedDevice | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(
    () =>
      api
        .devices()
        .then((d) => {
          setRows(d.devices);
          setMeta({ max: d.max, ttl_days: d.ttl_days });
        })
        .catch((e: unknown) => setErr(errMessage(e, "Couldn't load your devices."))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const mint = () =>
    run(async () => {
      const r = await api.mintDevice(name.trim() || "CLI");
      setMinted(r);
      setCopied(false);
      setName("");
    });

  const copy = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const viaBearer = me.auth === "bearer";

  return (
    <Card className={cn("gap-0 py-0 scroll-mt-4", devOnly && "ring-2 ring-primary")} id="devices" tabIndex={-1}>
      <CardHeader className="px-5 pb-0 pt-4">
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone aria-hidden="true" className="size-4" />
          <h2 className="m-0 text-sm font-medium leading-none">Devices</h2>
        </CardTitle>
        <CardDescription className={NOTE}>
          Tokens for phones, the CLI and other browsers · expire after {meta.ttl_days} unused days · up to {meta.max}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        {err && <Banner kind="err">{err}</Banner>}
        {minted && (
          <Banner kind="warn" icon="key" role="status">
            <b>Token for “{minted.name}” — copy it now.</b> It is shown once and cannot be
            recovered; the server keeps only a hash. Anyone holding it can act as you until you
            revoke it here.
            <pre className="my-2 select-all whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]" data-testid="device-token">{minted.token}</pre>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={copy}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? "Copied" : "Copy token"}
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => setMinted(null)}>
                I have saved it
              </Button>
            </div>
            <p className={cn(NOTE, "mb-0 mt-2")}>
              Use it as <code>Authorization: Bearer &lt;token&gt;</code> on any <code>/api/*</code>{" "}
              call.{minted.warning ? ` ${minted.warning}` : ""}
            </p>
          </Banner>
        )}
        {rows === null ? (
          <div className="flex flex-col gap-2 py-3" aria-busy="true">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : rows.length === 0 ? (
          <p className={cn(NOTE, "my-3")}>No devices yet.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-border p-0" aria-label="Your devices">
            {rows.map((d) => (
              <li className="flex items-center gap-3 py-2.5" key={d.id} data-testid="device-row">
                <KeyRound aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{d.name}</span>
                    {d.current && <Badge variant="default">This device</Badge>}
                  </div>
                  <div className={NOTE}>
                    Created {dateText(d.created)} · last seen {dateText(d.last_seen)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={busy}
                  aria-label={`Revoke ${d.name}`}
                  onClick={() => run(() => api.revokeDevice(d.id))}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            type="text"
            className="min-w-[200px] flex-1"
            maxLength={60}
            placeholder="Name it — “CLI on laptop”, “iPhone”…"
            aria-label="New device name"
            value={name}
            disabled={busy || viaBearer}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="button" disabled={busy || viaBearer} onClick={mint}>
            <Plus aria-hidden="true" />
            Create a token for the CLI/mobile
          </Button>
          {rows && rows.length > 0 && (
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Sign out everywhere? Every device token AND every browser session — " +
                      "including this one, on every machine — stops working. You stay signed in " +
                      "here; everywhere else has to sign in again.",
                  )
                ) {
                  run(() => api.revokeAllDevices());
                }
              }}
            >
              <LogOut aria-hidden="true" />
              Sign out everywhere
            </Button>
          )}
        </div>
        {viaBearer && (
          <p className={cn(NOTE, "mb-0 mt-2")}>
            You are signed in with a device token. Creating another one needs a browser session —
            open Settings on the web.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only" role="status">Loading your settings</span>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}

export function Settings({ me }: { me: Me }) {
  const [d, setD] = useState<SettingsData | null>(null);
  const [form, setForm] = useState<RuntimeSettings | null>(null);
  const [banner, setBanner] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(
    () =>
      api
        .settings()
        .then((r) => {
          setErr("");
          setD(r);
          setForm(r.settings);
        })
        .catch((e: unknown) => setErr(errMessage(e, "Couldn't load your settings."))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const header = (
    <PageHeader
      title="Settings"
      help={
        <>
          Changes apply on the next poller cycle, with no restart and no <code>.env</code> edit.
          Saved values win over <code>.env</code>, which wins over the default; the badge on each
          row says where the value in effect comes from. Notification URLs stay in{" "}
          <code>.env</code>. Behind a GitHub webhook, polling is only a safety net: lower the
          interval or switch it off. See{" "}
          <a href="https://wimukti.github.io/reviewstage/operations/configuration/#runtime-settings" target="_blank" rel="noopener">
            Runtime settings
          </a>{" "}
          in the docs. Your <a href="#devices">devices</a> are at the foot of this page.
        </>
      }
    />
  );
  if (err && !d)
    return (
      <>
        {header}
        <Banner kind="err" data-testid="settings-error">{err}</Banner>
      </>
    );
  if (!d || !form)
    return (
      <>
        {header}
        <SettingsSkeleton />
      </>
    );
  const ro = !d.is_admin;
  const dirty = JSON.stringify(form) !== JSON.stringify(d.settings);
  const set = <K extends keyof RuntimeSettings>(k: K, v: RuntimeSettings[K]) =>
    setForm({ ...form, [k]: v });
  const minutes = Math.round(form.poll_interval_seconds / 60);

  const toggleBackend = (b: NotifyBackend, on: boolean) => {
    let next: NotifyBackend[] = form.notify_backends.filter((x) => x !== "none");
    if (b === "none") next = on ? ["none"] : [];
    else next = on ? [...next, b] : next.filter((x) => x !== b);
    set("notify_backends", next.length ? next : ["none"]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.saveRuntimeSettings(d.token, form);
      setD(r);
      setForm(r.settings);
      setBanner(r.bannerHtml || "");
    } catch (e) {
      setBanner(
        `<div class='banner err'><div>${String((e as Error).message || e)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</div></div>`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {header}
      {ro && (
        <Banner kind="info" icon="eye">
          Read-only: only the admin (<code>{d.admin || "the REVIEWER in .env"}</code>) can change
          these. You can see what is in effect.
        </Banner>
      )}
      <RawBanner html={banner} />

      <div className="flex flex-col gap-3" data-testid="settings-form">
        <Group title="Poller">
          <Row
            label="Poll GitHub for review requests"
            hint={
              <>
                Off pauses <code>pr-watch.sh</code> without stopping the service; the queue stops
                updating and no cards go out.
              </>
            }
          >
            <Source s={d.sources.poller_enabled} />
            <Switch
              aria-label="Poller enabled"
              checked={form.poller_enabled}
              disabled={ro}
              onCheckedChange={(v) => set("poller_enabled", v)}
            />
          </Row>
          <Row
            label="Poll interval"
            htmlFor="poll-minutes"
            hint={
              <>
                Every <b className="text-foreground">{minutes} minute{minutes === 1 ? "" : "s"}</b> ({form.poll_interval_seconds.toLocaleString("en-US")}s). 1 to 60 minutes.
              </>
            }
          >
            <Source s={d.sources.poll_interval_seconds} />
            <input
              type="range"
              className="w-[160px] accent-primary max-[899px]:min-w-[120px] max-[899px]:flex-1"
              aria-label="Poll interval in minutes"
              min={1}
              max={60}
              step={1}
              value={minutes}
              disabled={ro}
              onChange={(e) => set("poll_interval_seconds", Number(e.target.value) * 60)}
            />
            <Input
              id="poll-minutes"
              type="number"
              className="w-[84px] tabular-nums"
              aria-label="Poll interval (minutes)"
              min={1}
              max={60}
              value={minutes}
              disabled={ro}
              onChange={(e) => {
                const m = Math.min(60, Math.max(1, Number(e.target.value) || 1));
                set("poll_interval_seconds", m * 60);
              }}
            />
          </Row>
          <Row label="Last poll" hint={agoText(d.poller.lastPoll)} />
        </Group>

        <Group
          title="Notifications"
          description={
            <>
              <Source s={d.sources.notify_backends} /> Per-person mentions come from the Slack / Discord IDs each
              reviewer saves in Integrations.
            </>
          }
        >
          {d.backends.map((b) => {
            const meta = BACKEND_META[b];
            const configured = meta.envKey(d.env);
            const on = form.notify_backends.includes(b);
            const id = `backend-${b}`;
            return (
              <div className="flex flex-wrap items-center gap-3 py-3" key={b} data-testid="setting-row">
                <Switch
                  id={id}
                  aria-label={`Backend ${meta.name}`}
                  checked={on}
                  disabled={ro}
                  onCheckedChange={(v) => toggleBackend(b, v)}
                />
                <div className="min-w-0 flex-1 basis-[200px]">
                  <Label htmlFor={id} className="text-sm font-medium">{meta.name}</Label>
                  <div className={cn(NOTE, "mt-0.5")} data-testid="setting-hint">{meta.sub}</div>
                </div>
                {meta.envLabel && (
                  <Badge
                    variant="outline"
                    className={cn("block max-w-full truncate max-[899px]:ml-11", configured ? "text-green" : "text-muted-foreground")}
                    title={`${configured ? "Set" : "Not set"} in .env: ${meta.envLabel}`}
                  >
                    {configured ? "Configured" : "Not set"} · {meta.envLabel}
                  </Badge>
                )}
              </div>
            );
          })}
        </Group>

        <Group title="PR filters">
          <Row
            label="Ignore review requests on PRs older than"
            htmlFor="max-age"
            hint="Days since the PR was opened. Old PRs stay in the dashboard; only the card is suppressed. 0 disables the cutoff."
          >
            <Source s={d.sources.max_pr_age_days} />
            <Input
              id="max-age"
              type="number"
              className="w-[84px] tabular-nums"
              aria-label="Max PR age in days"
              min={0}
              max={3650}
              value={form.max_pr_age_days}
              disabled={ro}
              onChange={(e) => set("max_pr_age_days", Math.max(0, Number(e.target.value) || 0))}
            />
            <span className={NOTE}>days</span>
          </Row>
          <Row
            label="Skip PRs opened by bots"
            hint="Off by default: AI-written PRs are where a skeptical review pays off most."
          >
            <Source s={d.sources.skip_bot_prs} />
            <Switch
              aria-label="Skip bot PRs"
              checked={form.skip_bot_prs}
              disabled={ro}
              onCheckedChange={(v) => set("skip_bot_prs", v)}
            />
          </Row>
        </Group>

        {!ro && (
          <div className="flex flex-wrap items-center gap-3 px-1 py-1" data-testid="settings-save">
            <Button type="button" disabled={!dirty || saving} onClick={save}>
              <Save aria-hidden="true" />
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Button variant="ghost" type="button" disabled={!dirty || saving} onClick={() => setForm(d.settings)}>
              Reset
            </Button>
            {dirty ? (
              <StatusBadge tone="amber" data-testid="settings-dirty">Unsaved changes</StatusBadge>
            ) : (
              <span className={NOTE}>
                Saves Poller, Notifications and PR filters to <code>settings.json</code> on the server.{" "}
                <code>DRY_RUN</code> stays in <code>.env</code> on purpose.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3">
        <WebhooksCard wh={d.webhooks} pollSeconds={form.poll_interval_seconds} />
        <PushDevices />
        <Devices me={me} />
      </div>
    </>
  );
}
