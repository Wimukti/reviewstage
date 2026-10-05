import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { UNREACHABLE } from "./reach";
import { Button } from "@/components/ui/button";

const RETRY_MS = 15_000;

// The whole screen when the server behind the page has gone (reach.ts). Try again re-runs
// `retry`; while the page is visible it also re-runs by itself every 15 s, so a phone left on
// this screen comes back the moment the Mac does.
export function Unreachable({ retry }: { retry: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const attempt = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await retry();
    } catch {
      /* still down: the screen stays */
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [retry]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void attempt();
    }, RETRY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void attempt();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [attempt]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 py-10 text-center" data-testid="unreachable" role="alert">
      <div className="flex max-w-[360px] flex-col items-center">
        <img src="/icons/icon-192.png" alt="" className="mb-5 size-14 rounded-[14px]" />
        <h1 className="m-0 text-xl font-semibold tracking-tight">{UNREACHABLE.title}</h1>
        <p className="m-0 mt-2 text-sm text-muted-foreground">{UNREACHABLE.body}</p>
        <Button className="mt-6" type="button" disabled={busy} onClick={() => void attempt()} data-testid="unreachable-retry">
          <RotateCw aria-hidden="true" className={busy ? "animate-spin" : undefined} />
          {busy ? "Trying…" : "Try again"}
        </Button>
        <p className="m-0 mt-6 text-xs text-muted-foreground">{UNREACHABLE.moved}</p>
      </div>
    </div>
  );
}
