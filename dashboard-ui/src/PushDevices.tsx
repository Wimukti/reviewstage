// Settings → Notifications → "Notifications on this device". Self-contained rows: mount them
// inside any settings card signed-in. Turning the switch on asks the browser for permission,
// subscribes this browser and files the subscription under the signed-in user; the list below
// is every browser/device that user has turned on, each removable from here. It acts at once
// and never makes the page dirty. A notification only ever opens a page — it never runs or
// posts anything (openspec/config.yaml).
import { Loader2, Send, Smartphone, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingRow } from "./ui";
import { deviceName, usePush, type PushDevice } from "./push";

function when(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function DeviceRow({
  d,
  current,
  busy,
  onRemove,
}: {
  d: PushDevice;
  current: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5" data-testid="push-device">
      <Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{d.device}</span>
          {current ? (
            <Badge variant="default">This device</Badge>
          ) : (
            <Badge variant="outline">Subscribed</Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {d.endpoint}
          {d.added ? ` · added ${when(d.added)}` : ""}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${d.device}`}
        title="Stop notifications on this device"
        disabled={busy}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

export function PushDevices() {
  const p = usePush();
  const canToggle = p.supported && p.serverEnabled !== false && p.permission !== "denied" && !p.busy;
  const offReason = !p.supported
    ? p.iosNeedsInstall
      ? ""
      : "This browser cannot receive push notifications."
    : p.serverEnabled === false
      ? "Push is switched off on this server (RS_PUSH=0, or Python has no `cryptography`)."
      : p.permission === "denied"
        ? "Notifications are blocked for this site — allow them in the browser's site settings."
        : "";

  return (
    <div className="divide-y divide-border" data-testid="push-devices">
      <SettingRow
        label="Notifications on this device"
        hint={
          <>
            A notification here when someone requests your review. It opens the review page;
            nothing runs and nothing is posted until you choose to.
            {offReason && (
              <>
                {" "}
                <span data-testid="push-off-reason">{offReason}</span>
              </>
            )}
          </>
        }
      >
        <Switch
          aria-label="Notifications on this device"
          checked={p.enabled}
          disabled={!canToggle}
          onCheckedChange={(on) => (on ? void p.enable(deviceName()) : void p.disable())}
        />
      </SettingRow>
      <div className="flex flex-col gap-3 py-4">
        {p.iosNeedsInstall && (
          <p className="m-0 rounded-md border border-dashed px-3 py-2 text-xs leading-relaxed text-muted-foreground" data-testid="ios-hint">
            Add to Home Screen first — Safari only delivers push to installed apps. Tap Share, then
            “Add to Home Screen”, and open ReviewStage from there.
          </p>
        )}
        {p.error && (
          <p className="m-0 text-xs text-red" role="alert">
            {p.error}
          </p>
        )}
        {p.notice && !p.error && (
          <p className="m-0 text-xs text-muted-foreground" role="status">
            {p.notice}
          </p>
        )}
        {p.devices.length > 0 ? (
          <ul className="m-0 list-none divide-y divide-border p-0" aria-label="Subscribed devices">
            {p.devices.map((d) => (
              <DeviceRow
                key={d.id}
                d={d}
                current={d.id === p.currentId}
                busy={p.busy}
                onRemove={() => void (d.id === p.currentId ? p.disable() : p.remove(d.id))}
              />
            ))}
          </ul>
        ) : (
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            No devices yet. Turn the switch on here, and on your phone from its home-screen app.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={p.busy || p.devices.length === 0}
            onClick={() => void p.test()}
          >
            {p.busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            Send a test
          </Button>
          <span className="text-xs text-muted-foreground">
            Up to {p.max} devices. The server keeps only each device’s push address and public keys.
          </span>
        </div>
      </div>
    </div>
  );
}
