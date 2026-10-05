// The Queue tab's badge: how many PRs are waiting on your review ("To review"). One number in
// one place. The queue page publishes it whenever it loads unfiltered data (no extra request
// while you are looking at the queue); elsewhere the phone shell asks /api/queue for it on
// boot, on a return to the app and on navigation, at most once every 20 s. Failures are
// silent: a badge is never worth an error, and the unreachable state belongs to the pages.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";

const MIN_GAP_MS = 20_000;

let count: number | null = null;
let last = 0;
let inFlight = false;
const subs = new Set<() => void>();

export function setTodoCount(n: number | null | undefined): void {
  last = Date.now();
  const next = typeof n === "number" && n >= 0 ? n : null;
  if (next === count) return;
  count = next;
  subs.forEach((s) => s());
}

export async function refreshTodoCount(force = false): Promise<void> {
  if (inFlight || (!force && Date.now() - last < MIN_GAP_MS)) return;
  inFlight = true;
  try {
    const d = await api.queue("todo", "newest");
    setTodoCount(d.tabs.find((t) => t.key === "todo")?.count);
  } catch {
    /* keep the last number */
  } finally {
    inFlight = false;
  }
}

/** The To review count (null until known), kept fresh while the caller is mounted. */
export function useTodoCount(path: string): number | null {
  const n = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => count,
  );
  useEffect(() => {
    void refreshTodoCount();
  }, [path]);
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === "visible") void refreshTodoCount();
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return n;
}
