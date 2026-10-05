// "Your Mac isn't reachable" (openspec/changes/desktop-always-on F5). On a phone the server is
// the desktop app on the person's Mac, reached through a tunnel: when the Mac sleeps or the app
// quit, Cloudflare answers 530 (or a 502/503/504), or the request fails outright. Those are not
// errors the person can act on in the page, so the app shows one full-screen state instead of
// a red banner — the same words as public/offline.html, which the service worker serves when
// even the page itself cannot load.
import { useEffect, useState } from "react";
import { ApiError } from "./api";

export const UNREACHABLE = {
  title: "Your Mac isn't reachable",
  body: "The phone reaches ReviewStage on your Mac. Open it there — or wake the Mac — and try again.",
  moved: "If ReviewStage was restarted, open the newest link from your notifications or scan a new code.",
};

const GATEWAY = new Set([502, 503, 504, 530]);

/** A failure that means "the server is not there", not "the server said no". */
export function isUnreachable(e: unknown): boolean {
  if (e instanceof ApiError) return GATEWAY.has(e.status);
  // fetch rejects with a TypeError when there is no response at all.
  return e instanceof TypeError;
}

let down = false;
const watchers = new Set<(d: boolean) => void>();
export function setUnreachable(d: boolean) {
  if (down === d) return;
  down = d;
  watchers.forEach((w) => w(d));
}
/** Report a failure: flips the state only when it is an unreachable one. Returns whether it was. */
export function noteFailure(e: unknown): boolean {
  if (!isUnreachable(e)) return false;
  setUnreachable(true);
  return true;
}

export function useUnreachable(): boolean {
  const [d, setD] = useState(down);
  useEffect(() => {
    watchers.add(setD);
    setD(down);
    return () => {
      watchers.delete(setD);
    };
  }, []);
  return d;
}
