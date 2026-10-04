import { useEffect, useState } from "react";
import { Check, Copy, Smartphone } from "lucide-react";
import { PHONE_STRINGS as S, onPhoneData, phoneBridge, refreshPhoneStatus, usePhoneStatus, type PhoneData } from "./phone";
import { useHashTarget } from "./router";
import { StatusBadge } from "./ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const NOTE = "text-xs text-muted-foreground";

// Settings → Your phone: the desktop app's phone access, in the app. The same data and words
// as the phone window (desktop/pages/phone.html) — main.js sends both the same payload.
export function PhoneCard() {
  const bridge = phoneBridge();
  const here = useHashTarget("phone");
  const status = usePhoneStatus();
  const [data, setData] = useState<PhoneData>({});
  const [busy, setBusy] = useState<"enable" | "disable" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(
    () =>
      onPhoneData((p) => {
        if (p.stopped) {
          setData({ stopped: p.stopped });
          return;
        }
        setData((d) => ({ ...d, ...p, stopped: undefined }));
        if (p.warning) setError("");
      }),
    [],
  );

  if (!bridge) return null;

  const enabled = !!status?.enabled;
  const opening = busy === "enable" && !enabled;
  const url = data.url || status?.url || "";

  const enable = async () => {
    setBusy("enable");
    setError("");
    setData({});
    try {
      const r = await bridge.enable();
      if (r.error) setError(r.error);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      await refreshPhoneStatus();
      setBusy(null);
    }
  };
  const disable = async () => {
    setBusy("disable");
    try {
      await bridge.disable();
    } finally {
      setData({});
      await refreshPhoneStatus();
      setBusy(null);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className={cn("gap-0 py-0 scroll-mt-4", here && "ring-2 ring-primary")} id="phone" tabIndex={-1} data-testid="phone-card">
      <CardHeader className="px-5 pb-0 pt-4">
        <CardTitle className="flex items-center gap-2">
          <Smartphone aria-hidden="true" className="size-4" />
          <h2 className="m-0 text-sm font-medium leading-none">Your phone</h2>
        </CardTitle>
        <CardDescription className={NOTE}>
          A secure tunnel to this computer and a code that signs your phone in as you. The queue,
          the findings and the Post button are the same app at phone width.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3" data-testid="setting-row">
          <div className="min-w-0 flex-1 basis-[200px]">
            <div className="text-sm font-medium">Phone access</div>
            <div className={cn(NOTE, "mt-1 flex min-w-0 flex-wrap items-center gap-2")} data-testid="phone-state">
              {opening ? (
                <StatusBadge tone="amber" live>Opening…</StatusBadge>
              ) : enabled ? (
                <>
                  <StatusBadge tone="green">On</StatusBadge>
                  {url && <code className="truncate">{url}</code>}
                </>
              ) : (
                <StatusBadge tone="graphite" icon={null}>Off</StatusBadge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {enabled ? (
              <>
                <Button variant="secondary" size="sm" type="button" disabled={!!busy} onClick={enable}>
                  {data.dataUrl ? "New code" : "Show code"}
                </Button>
                <Button variant="ghost" size="sm" type="button" disabled={!!busy} onClick={disable} data-testid="phone-off">
                  {busy === "disable" ? "Turning off…" : "Turn off"}
                </Button>
              </>
            ) : (
              <Button type="button" disabled={!!busy} onClick={enable} data-testid="phone-enable">
                {opening ? "Opening…" : "Enable phone access"}
              </Button>
            )}
          </div>
        </div>

        {(error || data.stopped) && (
          <p className="m-0 pb-2 text-xs text-red" role="alert" data-testid="phone-error">
            {data.stopped || error}
          </p>
        )}

        {(enabled || opening) && (
          <div className="flex flex-wrap gap-5 border-t pt-4" data-testid="phone-code">
            {data.dataUrl ? (
              <img
                src={data.dataUrl}
                alt="QR code that signs your phone in"
                className="size-[224px] shrink-0 rounded-lg bg-[#0B0C10] [image-rendering:pixelated]"
                data-testid="phone-qr"
              />
            ) : (
              <Skeleton className="size-[224px] shrink-0 rounded-lg" aria-busy="true" />
            )}
            <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-3">
              <p className="m-0 text-sm" data-testid="phone-pair">
                {data.pair === undefined ? (
                  <span className="text-muted-foreground">{S.opening}</span>
                ) : data.pair ? (
                  S.pair(data.pair.login, S.until(data.pair.exp))
                ) : (
                  S.signedOut
                )}
              </p>
              <div className="flex items-center gap-2 rounded-md border bg-background py-1 pl-2.5 pr-1">
                <code className="min-w-0 flex-1 truncate text-xs" title={url} data-testid="phone-url">{url || "…"}</code>
                <Button variant="ghost" size="xs" type="button" disabled={!url} onClick={copy}>
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              {data.check && (
                <p
                  className={cn("m-0 text-xs", data.check === "ok" ? "text-green" : "text-muted-foreground")}
                  title={data.check === "slow" ? data.checkDetail : undefined}
                  data-testid="phone-check"
                  data-state={data.check}
                >
                  {S.check[data.check] ?? S.check.slow}
                </p>
              )}
              {data.notice && <p className="m-0 text-xs text-primary">{data.notice}</p>}
              {data.warning && <p className="m-0 text-xs text-red">{data.warning}</p>}
              <ol className={cn(NOTE, "m-0 flex list-decimal flex-col gap-0.5 pl-5 leading-relaxed marker:font-semibold marker:text-primary")}>
                {S.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className={cn(NOTE, "m-0")}>
                {S.fine}{" "}
                <a href={S.fineUrl} target="_blank" rel="noopener" className="text-muted-foreground underline underline-offset-2">
                  {S.fineLink}
                </a>
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
