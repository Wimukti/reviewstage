// Settings → "Notifications on this device". Self-contained: mount it anywhere signed-in.
// Turning the switch on asks the browser for permission, subscribes this browser and files the
// subscription under the signed-in user; the list below is every browser/device that user has
// turned on, each removable from here. A notification only ever opens a page — it never runs
// or posts anything (openspec/config.yaml).
import { BellRing, Loader2, Send, Smartphone, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { deviceName, usePush, type PushDevice } from "./push";

function when(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function Row({
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
    <li className="flex items-center gap-3 py-2" data-testid="push-device">
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
    <Card id="notifications" data-testid="push-devices">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" aria-hidden />
          Notifications on this device
        </CardTitle>
        <CardDescription>
          Get a notification here when someone requests your review. It opens the review page;
          nothing runs and nothing is posted until you choose to.
        </CardDescription>
        <CardAction>
          <Switch
            aria-label="Notifications on this device"
            checked={p.enabled}
            disabled={!canToggle}
            onCheckedChange={(on) => (on ? void p.enable(deviceName()) : void p.disable())}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {p.iosNeedsInstall && (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground" data-testid="ios-hint">
            Add to Home Screen first — Safari only delivers push to installed apps. Tap Share, then
            “Add to Home Screen”, and open ReviewStage from there.
          </p>
        )}
        {offReason && (
          <p className="text-sm text-muted-foreground" data-testid="push-off-reason">
            {offReason}
          </p>
        )}
        {p.error && (
          <p className="text-sm text-destructive" role="alert">
            {p.error}
          </p>
        )}
        {p.notice && !p.error && (
          <p className="text-sm text-muted-foreground" role="status">
            {p.notice}
          </p>
        )}
        {p.devices.length > 0 ? (
          <ul className="divide-y" aria-label="Subscribed devices">
            {p.devices.map((d) => (
              <Row
                key={d.id}
                d={d}
                current={d.id === p.currentId}
                busy={p.busy}
                onRemove={() => void (d.id === p.currentId ? p.disable() : p.remove(d.id))}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No devices yet. Turn the switch on here, and on your phone from its home-screen app.
          </p>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={p.busy || p.devices.length === 0}
          onClick={() => void p.test()}
        >
          {p.busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          Send a test
        </Button>
        <span className="text-xs text-muted-foreground">
          Up to {p.max} devices. The server keeps only each device’s push address and public keys.
        </span>
      </CardFooter>
    </Card>
  );
}
