// Product telemetry: the one-time consent card (the wizard's last card) and the Settings →
// Privacy section. Both show the SAME closed list of what is counted — the table below is the
// schema as shipped (bin/rs_telemetry.py SCHEMA), spelled out so the person reads exactly what
// a "yes" means — and the list of what is never collected. Nothing here can send anything:
// the server decides (rs_telemetry.decision), and the shipped default has no endpoint.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Download, Trash2 } from "lucide-react";
import { api, errMessage, TELEMETRY_EXPORT_URL, type Me, type TelemetryData, type TelemetryState } from "./api";
import { Banner, SettingRow as Row, StatusBadge } from "./ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";

// One row per event class, in the order the server lists them. `dims` names the fixed
// vocabulary; "count" means a plain tally with no dimension at all.
export const EVENT_ROWS: { event: string; dims: string; when: string }[] = [
  { event: "install_completed", dims: "count", when: "the first sign-in of a personal install" },
  { event: "connect_result", dims: "service: github, claude · error_category: ok, denied, expired_code, network, bad_token, other", when: "a GitHub sign-in or a Claude connect finishes" },
  { event: "review_started", dims: "effort: quick, standard, deep", when: "a review is started" },
  { event: "review_completed", dims: "outcome: done, failed, stopped, timeout", when: "a review ends" },
  { event: "run_duration_bucket", dims: "bucket: lt1m, 1to3m, 3to10m, gt10m", when: "a review ends" },
  { event: "findings_shown", dims: "count", when: "a review ends" },
  { event: "findings_kept · findings_edited · findings_dropped", dims: "count", when: "a review is posted (or dry-run posted)" },
  { event: "dismissal_reason", dims: "reason: a short slug from the dismissal menu", when: "a finding is dropped with a reason" },
  { event: "post_attempted · post_succeeded", dims: "dry: 0, 1", when: "a post is attempted and when it lands" },
  { event: "return_7d · return_28d", dims: "true/false", when: "derived when a day is packaged: was there activity on another day in the last 7 / 28" },
];

export const NEVER = [
  "your GitHub login, name or email",
  "repository names, PR numbers or titles",
  "file paths, branches, diffs, finding text or gists",
  "tokens of any kind, hostnames, your public URL or IP address",
  "free-text error messages, or any timestamp finer than the day",
];

const STATE_LABEL: Record<TelemetryState, { label: string; kind: string }> = {
  killed: { label: "Off", kind: "stopped" },
  disabled_by_admin: { label: "Off", kind: "stopped" },
  no_consent: { label: "Local only", kind: "archived" },
  no_endpoint: { label: "Local only", kind: "archived" },
  active: { label: "Sharing", kind: "posted" },
};

/** The schema, the never-list and what the endpoint situation is, as prose. */
export function TelemetrySchema({ endpointSet, compact }: { endpointSet: boolean; compact?: boolean }) {
  return (
    <div className={cn("text-xs leading-relaxed", compact ? "" : "mt-3")} data-testid="telemetry-schema">
      <p className="m-0 mb-2 text-muted-foreground">
        Counts per day of the events below, from a fixed vocabulary, plus a random install id. That is the whole schema; the
        server refuses anything else.
      </p>
      <table className="w-full border-collapse text-left" data-testid="telemetry-schema-table">
        <thead>
          <tr className="text-muted-foreground">
            <th className="border-b py-1 pr-2 font-medium">Event</th>
            <th className="border-b py-1 pr-2 font-medium">Values</th>
            {!compact && <th className="border-b py-1 font-medium">When</th>}
          </tr>
        </thead>
        <tbody>
          {EVENT_ROWS.map((r) => (
            <tr key={r.event} className="align-top">
              <td className="border-b py-1 pr-2 font-mono text-[11px]">{r.event}</td>
              <td className="border-b py-1 pr-2 text-muted-foreground">{r.dims}</td>
              {!compact && <td className="border-b py-1 text-muted-foreground">{r.when}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m-0 mb-1 mt-3 font-medium text-foreground">Never collected</p>
      <ul className="m-0 list-disc pl-4 text-muted-foreground" data-testid="telemetry-never">
        {NEVER.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="m-0 mt-3 text-muted-foreground" data-testid="telemetry-endpoint">
        {endpointSet
          ? "An endpoint is configured on this server; with your consent one summary per day is posted to it."
          : "No endpoint is configured on this server — nothing is sent either way. Consent only decides what happens if one is set later."}
      </p>
    </div>
  );
}

/**
 * The wizard's last card. Two equal choices; the local one has the default focus. The choice is
 * written to the server (one install, one answer) and can be changed any time in Settings.
 */
export function ConsentCard({ me, onDone }: { me: Me; onDone: () => void }) {
  const [t, setT] = useState<TelemetryData | null>(null);
  const [busy, setBusy] = useState<"local" | "share" | "">("");
  const [err, setErr] = useState("");
  useEffect(() => {
    api.telemetry().then(setT).catch(() => setT(null));
  }, []);
  const choose = async (share: boolean) => {
    setBusy(share ? "share" : "local");
    setErr("");
    try {
      await api.telemetryConsent(share);
      onDone();
    } catch (e) {
      setErr(errMessage(e, "Could not save your choice — try again."));
      setBusy("");
    }
  };
  return (
    <div data-testid="welcome-privacy">
      <h2 className="mt-6 text-sm font-medium">One question: share anonymous product counters?</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {me.brand} keeps a few counters on this machine — how many reviews ran, how many findings you kept or dropped —
        so you can see them in Settings → Privacy. Sharing them is off unless you say otherwise, and nothing is sent
        while no endpoint is configured.
      </p>
      <TelemetrySchema endpointSet={!!t?.endpointSet} compact />
      {err && (
        <div className="mt-3">
          <Banner kind="err">{err}</Banner>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2 max-[399px]:grid-cols-1">
        <Button type="button" variant="outline" autoFocus disabled={!!busy} onClick={() => void choose(false)} data-testid="telemetry-keep-local">
          {busy === "local" ? "Saving…" : "Keep it local"}
        </Button>
        <Button type="button" variant="outline" disabled={!!busy} onClick={() => void choose(true)} data-testid="telemetry-share">
          {busy === "share" ? "Saving…" : "Share anonymous product events"}
        </Button>
      </div>
      <p className="mb-0 mt-3 text-center text-xs text-muted-foreground">You can change this any time in Settings → Privacy.</p>
    </div>
  );
}

/**
 * The rows of Settings → Privacy. `initial` lets a test render it without a server; otherwise
 * it loads GET /api/telemetry. `adminRow` is the team admin's server-wide switch, which the
 * Settings page owns because it goes through the dirty bar like every runtime setting.
 */
export function PrivacyRows({ initial, adminRow }: { initial?: TelemetryData; adminRow?: ReactNode }) {
  const [t, setT] = useState<TelemetryData | null>(initial ?? null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(
    () =>
      api
        .telemetry()
        .then((x) => {
          setT(x);
          setErr("");
        })
        .catch((e) => setErr(errMessage(e, "Could not load the telemetry state."))),
    [],
  );
  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);

  const run = async (fn: () => Promise<TelemetryData>) => {
    setBusy(true);
    setErr("");
    try {
      setT(await fn());
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!t) return <div className="py-4 text-sm text-muted-foreground">{err || "Loading…"}</div>;
  const s = STATE_LABEL[t.state] ?? STATE_LABEL.no_consent;
  const locked = t.killSwitch || t.adminDisabled;
  const days = Object.keys(t.counters).length;
  const total = Object.values(t.counters).reduce((n, d) => n + Object.values(d).reduce((a, b) => a + b, 0), 0);
  return (
    <>
      {err && (
        <div className="py-3">
          <Banner kind="err">{err}</Banner>
        </div>
      )}
      <Row label="Status" hint={<span data-testid="telemetry-reason">{t.reason}</span>}>
        <StatusBadge kind={s.kind} label={s.label} data-testid="telemetry-state" data-state={t.state} />
      </Row>
      <Row
        label="Share anonymous product events"
        hint={
          locked ? (
            <span data-testid="telemetry-locked">
              {t.killSwitch ? (
                <>
                  Locked off by <code>RS_TELEMETRY=0</code> on this server.
                </>
              ) : (
                "Locked off: the admin disabled telemetry for this server."
              )}
            </span>
          ) : (
            "Counts only, per day, from the list below. Off by default; nothing is sent while no endpoint is configured."
          )
        }
      >
        <Switch
          aria-label="Share anonymous product events"
          checked={t.consented}
          disabled={busy || locked}
          onCheckedChange={(v) => void run(() => api.telemetryConsent(v))}
          data-testid="telemetry-consent"
        />
      </Row>
      <Row
        label="What is counted"
        hint={
          <>
            {days.toLocaleString("en-US")} {days === 1 ? "day" : "days"} on this machine, {total.toLocaleString("en-US")}{" "}
            {total === 1 ? "event" : "events"} in all.
          </>
        }
      >
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" size="sm" data-testid="telemetry-view-queued">
              {open ? "Hide" : "View queued"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre
              className="mt-3 max-h-[320px] max-w-[560px] overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-snug"
              data-testid="telemetry-queued"
            >
              {JSON.stringify({ counters: t.counters, outbox: t.outbox }, null, 1)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </Row>
      <div className="py-4">
        <TelemetrySchema endpointSet={t.endpointSet} />
      </div>
      <Row label="Export" hint="A JSON file of the counters, the consent record and the queue — exactly what is on disk.">
        <Button asChild variant="outline" size="sm">
          <a href={TELEMETRY_EXPORT_URL} download="reviewstage-telemetry.json" data-testid="telemetry-export">
            <Download aria-hidden="true" />
            Export
          </a>
        </Button>
      </Row>
      <Row
        label="Clear"
        hint="Deletes every counter and the queue. If you are sharing, the install id is replaced, so earlier days cannot be joined to later ones."
      >
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={busy}
          data-testid="telemetry-clear"
          onClick={() => {
            if (window.confirm("Clear every telemetry counter and the queue on this machine?")) void run(() => api.telemetryClear());
          }}
        >
          <Trash2 aria-hidden="true" />
          Clear
        </Button>
      </Row>
      {adminRow}
    </>
  );
}
