import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Me,
  type NotifyBackend,
  type RuntimeSettings,
  type SettingsData,
  type SettingSource,
  type WebhooksStatus,
} from "./api";

// Runtime settings — the knobs an operator changes without editing .env or restarting
// anything. They live in $ROOT/settings.json (settings.json > .env > default); the poller and
// the scripts re-read the file every cycle. Admin-only to save; everyone else sees a read-only
// view. DRY_RUN is deliberately absent: it stays in .env as a restart-gated safety.

function Banner({ html }: { html: string }) {
  if (!html) return null;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

const SRC_LABEL: Record<SettingSource, string> = {
  settings: "Settings",
  env: ".env",
  default: "default",
};

function Source({ s }: { s: SettingSource }) {
  return (
    <span className={"setsrc " + s} title={`Where the current value comes from: ${SRC_LABEL[s]}`}>
      {SRC_LABEL[s]}
    </span>
  );
}

function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span />
    </label>
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
    <div className="card" data-testid="webhooks-card">
      <h2>Webhooks</h2>
      <p className="muted sm">
        GitHub can tell this install about a review request the moment it happens, instead of
        waiting for the next poll. The receiver only updates the queue and sends the card — it
        never starts a review.
      </p>
      <div className="setrow">
        <div className="setlbl">
          <b>Status</b>
          <div className="hint">
            {wh.active
              ? "A verified event arrived within two poll intervals — GitHub is reaching this server."
              : wh.configured
                ? `No event in the last ${2 * minutes} minutes. The poller is keeping the queue fresh; add the hook on GitHub (or check its Recent Deliveries) to go instant.`
                : "GITHUB_WEBHOOK_SECRET is not set in .env, so the endpoint answers 503 and the poller does all the work."}
          </div>
        </div>
        <div className="setctl">
          <span className={"pill " + (wh.active ? "ok" : "warn")} data-testid="webhooks-status">
            {wh.active ? "webhooks active" : "polling only"}
          </span>
        </div>
      </div>
      <div className="setrow">
        <div className="setlbl">
          <b>Payload URL</b>
          <div className="hint">
            <code>{wh.url}</code>
          </div>
        </div>
      </div>
      <div className="setrow">
        <div className="setlbl">
          <b>Secret</b>
          <div className="hint">
            {wh.configured ? (
              <span className="hint ok">✓ configured</span>
            ) : (
              <>
                not set · <code>GITHUB_WEBHOOK_SECRET</code> in <code>.env</code> (restart the server after adding it)
              </>
            )}
          </div>
        </div>
      </div>
      <div className="setrow">
        <div className="setlbl">
          <b>Deliveries</b>
          <div className="hint">
            {wh.count.toLocaleString()} event{wh.count === 1 ? "" : "s"} received · last event{" "}
            {wh.last_event_at ? `${agoText(wh.last_event_at)}${wh.last_event ? ` (${wh.last_event})` : ""}` : "never"}{" "}
            · last ping {wh.last_ping ? agoText(wh.last_ping) : "never"}
            {wh.last_error && (
              <>
                {" "}
                · <span className="hint err">last error: {wh.last_error}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="setrow">
        <div className="setlbl">
          <b>Set it up on GitHub</b>
          <pre className="schema" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
            {text}
          </pre>
        </div>
        <div className="setctl">
          <button className="btn ghost" type="button" onClick={copy}>
            {copied ? "Copied" : "Copy instructions"}
          </button>
        </div>
      </div>
      {wh.active && (
        <div className="hint ok">
          Webhooks are doing the work now — you can lower the poll interval or turn polling off
          in the Poller card. Polling stays on until you change it; it is the safety net for a
          missed delivery.
        </div>
      )}
    </div>
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

export function Settings({ me }: { me: Me }) {
  const [d, setD] = useState<SettingsData | null>(null);
  const [form, setForm] = useState<RuntimeSettings | null>(null);
  const [banner, setBanner] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(
    () =>
      api.settings().then((r) => {
        setD(r);
        setForm(r.settings);
      }),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  if (!d || !form) return <div className="muted">Loading…</div>;
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
        `<div class='banner err'><span>🚫</span><div>${String((e as Error).message || e)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</div></div>`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1>Settings</h1>
      <p className="lead">
        Runtime knobs for this {me.brand} install. Changes apply on the next poller cycle — no
        restart, no <code>.env</code> edit. Saved values win over <code>.env</code>, which wins
        over the default.
      </p>
      {ro && (
        <div className="banner info">
          <span>👁</span>
          <div>
            Read-only: only the admin (<code>{d.admin || "the REVIEWER in .env"}</code>) can change
            these. You can see what is in effect.
          </div>
        </div>
      )}
      <Banner html={banner} />

      <div className="card">
        <h2>Poller</h2>
        <div className="setrow">
          <div className="setlbl">
            <b>Poll GitHub for review requests</b>
            <div className="hint">
              Off pauses <code>pr-watch.sh</code> without stopping the service; the queue stops
              updating and no cards go out.
            </div>
          </div>
          <div className="setctl">
            <Source s={d.sources.poller_enabled} />
            <Switch
              label="Poller enabled"
              checked={form.poller_enabled}
              disabled={ro}
              onChange={(v) => set("poller_enabled", v)}
            />
          </div>
        </div>
        <div className="setrow">
          <div className="setlbl">
            <b>Poll interval</b>
            <div className="hint">
              Every <b>{minutes} minute{minutes === 1 ? "" : "s"}</b> ({form.poll_interval_seconds.toLocaleString()}s). 1 to 60 minutes.
            </div>
          </div>
          <div className="setctl">
            <Source s={d.sources.poll_interval_seconds} />
            <input
              type="range"
              aria-label="Poll interval in minutes"
              min={1}
              max={60}
              step={1}
              value={minutes}
              disabled={ro}
              onChange={(e) => set("poll_interval_seconds", Number(e.target.value) * 60)}
            />
            <input
              type="number"
              className="in"
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
          </div>
        </div>
        <div className="setrow">
          <div className="setlbl">
            <b>Last poll</b>
            <div className="hint">{agoText(d.poller.lastPoll)}</div>
          </div>
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          Running behind a GitHub webhook (see the Webhooks card below)? Then polling is only a
          safety net — lower the interval or switch it off here. See{" "}
          <a href="https://wimukti.github.io/reviewstage/operations/configuration/#runtime-settings" target="_blank" rel="noopener">
            Runtime settings
          </a>{" "}
          in the docs.
        </div>
      </div>

      <WebhooksCard wh={d.webhooks} pollSeconds={form.poll_interval_seconds} />

      <div className="card">
        <h2>Notifications</h2>
        <p className="muted sm">
          Which backends fire for review requested / review ready / stopped / QA ready. URLs come
          from <code>.env</code> and are shown here as configured or not — they cannot be edited
          from the browser.
        </p>
        {d.backends.map((b) => {
          const meta = BACKEND_META[b];
          const configured = meta.envKey(d.env);
          const on = form.notify_backends.includes(b);
          return (
            <label className="chk" key={b}>
              <input
                type="checkbox"
                checked={on}
                disabled={ro}
                aria-label={`Backend ${meta.name}`}
                onChange={(e) => toggleBackend(b, e.target.checked)}
              />
              <span>
                <b>{meta.name}</b> <span className="muted sm">— {meta.sub}</span>
              </span>
              {meta.envLabel && (
                <span className={"envnote" + (configured ? " on" : "")}>
                  {configured ? "✓ configured" : "not set"} · <code>{meta.envLabel}</code>
                </span>
              )}
            </label>
          );
        })}
        <div className="hint">
          <Source s={d.sources.notify_backends} /> Per-person mentions come from the Slack /
          Discord IDs each reviewer saves in Integrations.
        </div>
      </div>

      <div className="card">
        <h2>PR filters</h2>
        <div className="setrow">
          <div className="setlbl">
            <b>Ignore review requests on PRs older than</b>
            <div className="hint">
              Days since the PR was opened. Old PRs stay in the dashboard; only the card is
              suppressed. 0 disables the cutoff.
            </div>
          </div>
          <div className="setctl">
            <Source s={d.sources.max_pr_age_days} />
            <input
              type="number"
              className="in"
              aria-label="Max PR age in days"
              min={0}
              max={3650}
              value={form.max_pr_age_days}
              disabled={ro}
              onChange={(e) => set("max_pr_age_days", Math.max(0, Number(e.target.value) || 0))}
            />
            <span className="muted sm">days</span>
          </div>
        </div>
        <div className="setrow">
          <div className="setlbl">
            <b>Skip PRs opened by bots</b>
            <div className="hint">
              Off by default: AI-written PRs are where a skeptical review pays off most.
            </div>
          </div>
          <div className="setctl">
            <Source s={d.sources.skip_bot_prs} />
            <Switch
              label="Skip bot PRs"
              checked={form.skip_bot_prs}
              disabled={ro}
              onChange={(v) => set("skip_bot_prs", v)}
            />
          </div>
        </div>
      </div>

      {!ro && (
        <div className="setfoot">
          <button className="btn primary" type="button" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={!dirty || saving}
            onClick={() => setForm(d.settings)}
          >
            Reset
          </button>
          <span className="muted">
            Stored in <code>settings.json</code> on the server. <code>DRY_RUN</code> stays in{" "}
            <code>.env</code> on purpose.
          </span>
        </div>
      )}
    </>
  );
}
