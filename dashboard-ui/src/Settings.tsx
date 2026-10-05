import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, KeyRound, LogOut, Plus } from "lucide-react";
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
import { openAtLoginBridge, updateBridge } from "./desktop";
import { DesktopApp } from "./DesktopApp";
import { phoneBridge } from "./phone";
import { PhoneAccess } from "./PhoneAccess";
import { PushDevices } from "./PushDevices";
import { ThemeControl } from "./ThemeControl";
import { useIsPhone } from "./theme";
import { Link, useLocation } from "./router";
import { Banner, PageHeader, RepoPill, SettingRow as Row, StatusBadge } from "./ui";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

// Runtime settings — the knobs an operator changes without editing .env or restarting
// anything. They live in $ROOT/settings.json (settings.json > .env > default); the poller and
// the scripts re-read the file every cycle. Admin-only to save; everyone else sees a read-only
// view. DRY_RUN is deliberately absent: it stays in .env as a restart-gated safety.
//
// The page shows one section at a time (openspec/changes/settings-redesign/design.md §E2): a
// secondary nav of sections on the left, the section on the right, the URL hash naming it.

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

// ---- sections -----------------------------------------------------------------------------

type SectionId = "phone" | "desktop" | "appearance" | "repositories" | "poller" | "filters" | "notifications" | "webhooks" | "devices";
type Group = "This device" | "Reviewing" | "Notifications";
const GROUPS: Group[] = ["This device", "Reviewing", "Notifications"];
const SECTIONS: { id: SectionId; label: string; group: Group }[] = [
  { id: "phone", label: "Your phone", group: "This device" },
  { id: "desktop", label: "Desktop app", group: "This device" },
  { id: "appearance", label: "Appearance", group: "This device" },
  { id: "repositories", label: "Repositories", group: "Reviewing" },
  { id: "poller", label: "Poller", group: "Reviewing" },
  { id: "filters", label: "PR filters", group: "Reviewing" },
  { id: "notifications", label: "Notifications", group: "Notifications" },
  { id: "webhooks", label: "Webhooks", group: "Notifications" },
  { id: "devices", label: "Devices", group: "Notifications" },
];

// Your phone is the desktop app's (personal mode with the preload's bridge), and so is Desktop
// app (the update and open-at-login bridge, desktop-always-on). Everything else exists on every
// install; the first section that exists is the one an unhashed URL opens.
export function sectionsFor(me: Me) {
  const desktopApp = !!me.personal && !!phoneBridge();
  const desktopControls = !!me.personal && (!!updateBridge() || !!openAtLoginBridge());
  return SECTIONS.filter((s) => (s.id !== "phone" || desktopApp) && (s.id !== "desktop" || desktopControls));
}

// A section opened from the phone's You tab is a page of its own: the navigation bar names it,
// so its header keeps only the sentence.
const Standalone = createContext(false);

// The section header: the title and one sentence. The card under it carries no title of its own.
function SectionHeader({ title, children }: { title: string; children: ReactNode }) {
  const standalone = useContext(Standalone);
  return (
    <div className={standalone ? "mb-4" : "mb-5"}>
      {!standalone && <h2 className="m-0 text-lg font-semibold tracking-tight">{title}</h2>}
      <p className={cn("m-0 text-sm text-muted-foreground", !standalone && "mt-1")}>{children}</p>
    </div>
  );
}

// The one card of a section: rows divided by a hairline, no header.
function Rows({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Card className={cn("gap-0 py-0", className)} {...rest}>
      <CardContent className="divide-y divide-border px-5 py-0">{children}</CardContent>
    </Card>
  );
}

function SectionNav({ sections, current }: { sections: typeof SECTIONS; current: SectionId }) {
  const pills = useRef<HTMLElement>(null);
  // The pill row scrolls sideways; an active pill off its edge is brought just inside it,
  // without moving the page.
  useEffect(() => {
    const nav = pills.current;
    const el = nav?.querySelector<HTMLElement>(`[data-section="${current}"]`);
    if (!nav || !el) return;
    const pad = 16;
    if (el.offsetLeft < nav.scrollLeft + pad) nav.scrollTo({ left: Math.max(0, el.offsetLeft - pad) });
    else if (el.offsetLeft + el.offsetWidth > nav.scrollLeft + nav.clientWidth - pad)
      nav.scrollTo({ left: el.offsetLeft + el.offsetWidth - nav.clientWidth + pad });
  }, [current]);
  const item = (s: (typeof SECTIONS)[number], pill: boolean) => {
    const active = s.id === current;
    return (
      <Button
        key={s.id}
        asChild
        variant="ghost"
        size={pill ? "sm" : "default"}
        className={cn(
          "text-muted-foreground hover:no-underline",
          pill ? "shrink-0 rounded-full px-3.5" : "h-8 w-full justify-start px-2",
          active && "bg-accent font-medium text-foreground",
        )}
      >
        <Link to={`/settings#${s.id}`} aria-current={active ? "page" : undefined} data-section={s.id}>
          {s.label}
        </Link>
      </Button>
    );
  };
  return (
    <>
      <nav aria-label="Settings sections" data-testid="settings-nav" className="sticky top-6 hidden flex-col gap-5 self-start min-[1100px]:flex">
        {GROUPS.map((g) => {
          const items = sections.filter((s) => s.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g} className="flex flex-col gap-0.5">
              <div className="mb-1 px-2 text-xs font-medium text-muted-foreground">{g}</div>
              {items.map((s) => item(s, false))}
            </div>
          );
        })}
      </nav>
      <nav
        ref={pills}
        aria-label="Settings sections"
        data-testid="settings-pills"
        className="-mx-6 mb-5 flex gap-1.5 overflow-x-auto px-6 [scrollbar-width:none] max-[899px]:-mx-4 max-[899px]:px-4 min-[1100px]:hidden [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((s) => item(s, true))}
      </nav>
    </>
  );
}

// ---- the save bar ---------------------------------------------------------------------------

// Appears only while a runtime setting is dirty: the count on the left, Discard and Save on the
// right. After a save it shows "Saved" for two seconds, then slides away. Fixed to the bottom of
// the page column — above the tab bar on a phone, where its targets are 44px.
function SaveBar({
  count,
  saving,
  saved,
  error,
  onSave,
  onDiscard,
}: {
  count: number;
  saving: boolean;
  saved: boolean;
  error: string;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const state = count > 0 || saving ? "dirty" : saved ? "saved" : "hidden";
  const hidden = state === "hidden";
  return (
    <div
      data-testid="settings-save"
      data-state={state}
      inert={hidden}
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur transition-[transform,opacity,visibility] duration-(--dur-slow) ease-(--ease) max-[899px]:bottom-[calc(49px+env(safe-area-inset-bottom,0px)-var(--ios-gap,0px))] min-[900px]:left-[216px]",
        hidden ? "invisible translate-y-full opacity-0" : "visible translate-y-0 opacity-100",
      )}
    >
      <div className="flex min-h-[60px] max-w-[960px] items-center justify-between gap-4 px-6 py-2 max-[899px]:px-4">
        {state === "saved" ? (
          <span className="flex items-center gap-2 text-sm" role="status" data-testid="settings-saved">
            <Check aria-hidden="true" className="size-4 text-green" />
            Saved — the poller picks it up on its next cycle.
          </span>
        ) : (
          <>
            <div className="min-w-0 text-sm">
              <span className="font-medium" data-testid="settings-dirty">Unsaved changes</span>
              <span className="text-muted-foreground" data-testid="settings-dirty-count">
                {" "}· {count.toLocaleString("en-US")} {count === 1 ? "field" : "fields"}
              </span>
              {error && (
                <div className="mt-0.5 text-xs text-red" role="alert" data-testid="settings-save-error">
                  {error}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" type="button" className="h-9 max-[899px]:h-[44px]" disabled={saving} onClick={onDiscard}>
                Discard
              </Button>
              <Button type="button" className="h-9 max-[899px]:h-[44px]" disabled={saving} onClick={onSave}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- sections that act at once (never dirty) -------------------------------------------------

function RepositoriesSection({ me }: { me: Me }) {
  const repos = me.repos || [];
  const n = repos.length;
  const shown = repos.slice(0, 6);
  const more = n - shown.length;
  const pills = (
    <div className="flex flex-wrap items-center gap-1.5 py-4" data-testid="repos-pills">
      {shown.map((r) => (
        <RepoPill key={r} repo={r} />
      ))}
      {more > 0 && (
        <Badge variant="outline" className="text-muted-foreground">
          +{more.toLocaleString("en-US")} more
        </Badge>
      )}
      {n === 0 && <span className={NOTE}>No repositories yet.</span>}
    </div>
  );
  if (me.personal) {
    return (
      <>
        <SectionHeader title="Repositories">Review requests from these repositories reach your queue.</SectionHeader>
        <Rows>
          <Row
            label="Watched repositories"
            hint={<span data-testid="repos-count">{n.toLocaleString("en-US")} watched</span>}
          >
            <Button asChild variant="secondary" size="sm" className="hover:no-underline">
              <Link to="/repos">Manage</Link>
            </Button>
          </Row>
          {pills}
        </Rows>
      </>
    );
  }
  return (
    <>
      <SectionHeader title="Repositories">The repositories this install reviews, set by <code>REPOS</code> in <code>.env</code>.</SectionHeader>
      <Rows>
        <Row
          label="Configured repositories"
          hint={
            <>
              <span data-testid="repos-count">{n.toLocaleString("en-US")} configured</span> · change the list in{" "}
              <code>.env</code> and restart the server.
            </>
          }
        >
          <Source s="env" />
        </Row>
        {pills}
      </Rows>
    </>
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
// configured on GitHub. The section shows what GitHub needs and whether deliveries are arriving.
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

function WebhooksSection({ wh, pollSeconds }: { wh: WebhooksStatus; pollSeconds: number }) {
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
    <>
      <SectionHeader title="Webhooks">
        <span data-testid="webhooks-readonly">
          Nothing to save here: the secret lives in <code>.env</code> and the hook is configured on GitHub.
        </span>
      </SectionHeader>
      <Rows>
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
          <p className={cn(NOTE, "m-0 py-4 text-green")}>
            Webhooks are doing the work now — you can lower the poll interval or turn polling off
            in the Poller section. Polling stays on until you change it; it is the safety net for a
            missed delivery.
          </p>
        )}
      </Rows>
    </>
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
    <>
      <SectionHeader title="Devices">
        Tokens for phones, the CLI and other browsers · expire after {meta.ttl_days} unused days · up to {meta.max}.
      </SectionHeader>
      <Rows>
        {(err || minted) && (
          <div className="py-2">
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
          </div>
        )}
        {rows === null ? (
          <div className="flex flex-col gap-2 py-4" aria-busy="true">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : rows.length === 0 ? (
          <p className={cn(NOTE, "m-0 py-4")}>No devices yet.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-border p-0" aria-label="Your devices">
            {rows.map((d) => (
              <li className="flex items-center gap-3 py-3" key={d.id} data-testid="device-row">
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
        <div className="py-4">
          <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </Rows>
    </>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only" role="status">Loading your settings</span>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="mt-2 h-40 rounded-xl" />
    </div>
  );
}

// ---- the page --------------------------------------------------------------------------------

/**
 * `section` + `standalone`: the phone's You tab pushes one section as a page of its own
 * (/you/<id>) — no section pills, no repeated title. On the desktop it is the ordinary page,
 * opened at that section.
 */
export function Settings({ me, section: only, standalone }: { me: Me; section?: string; standalone?: boolean }) {
  const phone = useIsPhone();
  const alone = !!standalone && phone;
  const [d, setD] = useState<SettingsData | null>(null);
  const [form, setForm] = useState<RuntimeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [err, setErr] = useState("");
  const savedTimer = useRef<number | undefined>(undefined);
  const { hash } = useLocation();
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
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const sections = sectionsFor(me);
  const wanted = only ?? hash.replace(/^#/, "");
  const current = sections.find((s) => s.id === wanted)?.id ?? sections[0].id;
  // A section is a screen of its own: it opens at the top, nav included. The browser's own
  // scroll to `#id` lands once the section has rendered, so this runs on the frame after.
  const loaded = d !== null;
  useEffect(() => {
    const f = window.requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => window.cancelAnimationFrame(f);
  }, [current, loaded]);

  const header = (
    <PageHeader
      title="Settings"
      help={
        <>
          One section at a time; the address names it, so a section can be linked to. Poller,
          Notifications and PR filters apply on the next poller cycle, with no restart and no{" "}
          <code>.env</code> edit: saved values win over <code>.env</code>, which wins over the
          default, and the badge on each row says where the value in effect comes from.
          Notification URLs stay in <code>.env</code>. Behind a GitHub webhook, polling is only a
          safety net: lower the interval or switch it off. See{" "}
          <a href="https://reviewstage.dev/operations/configuration/#runtime-settings" target="_blank" rel="noopener">
            Runtime settings
          </a>{" "}
          in the docs.
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
  const changed = (Object.keys(form) as (keyof RuntimeSettings)[]).filter(
    (k) => JSON.stringify(form[k]) !== JSON.stringify(d.settings[k]),
  );
  const barShown = changed.length > 0 || saving || saved;
  const set = <K extends keyof RuntimeSettings>(k: K, v: RuntimeSettings[K]) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };
  const minutes = Math.round(form.poll_interval_seconds / 60);

  const toggleBackend = (b: NotifyBackend, on: boolean) => {
    let next: NotifyBackend[] = form.notify_backends.filter((x) => x !== "none");
    if (b === "none") next = on ? ["none"] : [];
    else next = on ? [...next, b] : next.filter((x) => x !== b);
    set("notify_backends", next.length ? next : ["none"]);
  };

  const save = async () => {
    setSaving(true);
    setSaveErr("");
    try {
      const r = await api.saveRuntimeSettings(d.token, form);
      setD(r);
      setForm(r.settings);
      setSaved(true);
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveErr(String((e as Error).message || e));
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    setSaveErr("");
    setForm(d.settings);
  };

  const section = (() => {
    switch (current) {
      case "phone":
        return (
          <>
            <SectionHeader title="Your phone">
              The same app at phone width, signed in as you, over a secure tunnel to this computer.
            </SectionHeader>
            <PhoneAccess />
          </>
        );
      case "desktop":
        return (
          <>
            <SectionHeader title="Desktop app">
              The app on this computer: which version runs, updates, and whether it starts when you log in.
            </SectionHeader>
            <DesktopApp />
          </>
        );
      case "appearance":
        return (
          <>
            <SectionHeader title="Appearance">How the app looks on this device.</SectionHeader>
            <Rows>
              <Row label="Theme" hint="A choice for this device, kept in this browser. Dark unless you pick otherwise.">
                <ThemeControl tall={alone} />
              </Row>
            </Rows>
          </>
        );
      case "repositories":
        return <RepositoriesSection me={me} />;
      case "poller":
        return (
          <>
            <SectionHeader title="Poller">How often GitHub is asked for new review requests.</SectionHeader>
            <Rows>
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
            </Rows>
          </>
        );
      case "filters":
        return (
          <>
            <SectionHeader title="PR filters">Which review requests are worth a card.</SectionHeader>
            <Rows>
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
            </Rows>
          </>
        );
      case "notifications":
        return (
          <>
            <SectionHeader title="Notifications">Where review cards go, and whether this device is told.</SectionHeader>
            <Rows>
              <Row
                label="Where review cards go"
                hint="Any of the services below. Per-person mentions come from the Slack / Discord IDs each reviewer saves in Integrations."
              >
                <Source s={d.sources.notify_backends} />
              </Row>
              {d.backends.map((b) => {
                const meta = BACKEND_META[b];
                const configured = meta.envKey(d.env);
                const on = form.notify_backends.includes(b);
                const id = `backend-${b}`;
                return (
                  <Row
                    key={b}
                    label={meta.name}
                    htmlFor={id}
                    hint={
                      <>
                        {meta.sub}
                        {meta.envLabel && (
                          <>
                            {" "}
                            <code>{meta.envLabel}</code> in <code>.env</code>.
                          </>
                        )}
                      </>
                    }
                  >
                    {meta.envLabel && (
                      <StatusBadge
                        tone={configured ? "green" : "graphite"}
                        icon={configured ? undefined : null}
                        title={`${configured ? "Set" : "Not set"} in .env: ${meta.envLabel}`}
                        data-testid="backend-env"
                      >
                        {configured ? "Configured" : "Not set"}
                      </StatusBadge>
                    )}
                    <Switch
                      id={id}
                      aria-label={`Backend ${meta.name}`}
                      checked={on}
                      disabled={ro}
                      onCheckedChange={(v) => toggleBackend(b, v)}
                    />
                  </Row>
                );
              })}
              <PushDevices />
            </Rows>
          </>
        );
      case "webhooks":
        return <WebhooksSection wh={d.webhooks} pollSeconds={form.poll_interval_seconds} />;
      case "devices":
        return <Devices me={me} />;
    }
  })();

  return (
    <>
      {header}
      {ro && (
        <Banner kind="info" icon="eye">
          Read-only: only the admin (<code>{d.admin || "the REVIEWER in .env"}</code>) can change
          these. You can see what is in effect.
        </Banner>
      )}

      <div className={cn("min-[1100px]:grid min-[1100px]:grid-cols-[200px_minmax(0,720px)] min-[1100px]:gap-10", barShown && "pb-20")}>
        {!alone && <SectionNav sections={sections} current={current} />}
        <div className="min-w-0" data-testid="settings-form">
          <section id={current} data-testid="settings-section" data-section={current}>
            <Standalone.Provider value={alone}>{section}</Standalone.Provider>
          </section>
        </div>
      </div>

      {!ro && (
        <SaveBar
          count={changed.length}
          saving={saving}
          saved={saved}
          error={saveErr}
          onSave={save}
          onDiscard={discard}
        />
      )}
    </>
  );
}
