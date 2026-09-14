// A tiny store for "what is this user running right now".
//
// A review takes minutes. Start one, walk away from the PR page, and until now nothing on any
// other screen said it was still going — so it looked like it had vanished. This store keeps the
// answer in one place: the sidebar pill, the queue rows and the QA index all read it.
//
// It deliberately owns exactly ONE timer, and only while something is running:
//   * the shell's own /api/me load seeds it (no extra request on boot);
//   * starting a review or a QA guide pokes it (immediate refresh);
//   * navigating between pages refreshes it (user-driven, not a timer);
//   * the tab becoming visible refreshes it;
//   * while any job is in flight and the tab is visible, it re-reads /api/me every 5 s.
// Idle, or hidden, it makes no requests at all.

import { api, type RunningJob } from "./api";
import { useSyncExternalStore } from "react";

const POLL_MS = 5000;

let jobs: RunningJob[] = [];
let timer: number | undefined;
let inFlight = false;
const subs = new Set<() => void>();

function emit() {
  for (const s of subs) s();
}

function reschedule() {
  window.clearTimeout(timer);
  timer = undefined;
  if (jobs.length === 0) return; // idle: no timer at all
  if (typeof document !== "undefined" && document.hidden) return; // hidden: stop burning polls
  timer = window.setTimeout(refresh, POLL_MS);
}

// Called by the shell with the /api/me it already fetched, so boot costs no extra request.
export function setRunning(next: RunningJob[] | undefined): void {
  const list = next ?? [];
  const same =
    list.length === jobs.length &&
    list.every((j, i) => {
      const p = jobs[i];
      return p && p.kind === j.kind && p.repo === j.repo && p.num === j.num && p.status === j.status;
    });
  if (!same) {
    jobs = list;
    emit();
  }
  reschedule();
}

// Ask the server now. Safe to call from anywhere; overlapping calls collapse into one.
export async function refresh(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const me = await api.me();
    setRunning(me.running);
  } catch {
    // Offline or signed out — keep what we have and try again on the next nudge.
    reschedule();
  } finally {
    inFlight = false;
  }
}

// A review or QA guide was just started: pick it up without waiting for the next tick.
export function pokeRunning(): void {
  void refresh();
}

export function getRunning(): RunningJob[] {
  return jobs;
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

let wired = false;
function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  // Navigating is a good moment to re-check, and costs nothing when idle.
  const onNav = () => void refresh();
  window.addEventListener("reviewstage:navigate", onNav);
  window.addEventListener("popstate", onNav);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearTimeout(timer);
      timer = undefined;
    } else {
      void refresh();
    }
  });
}

export function useRunning(): RunningJob[] {
  wire();
  return useSyncExternalStore(subscribe, getRunning, getRunning);
}

// The running job for one PR, if any — used to overlay a queue row with live status text.
export function runningFor(list: RunningJob[], kind: RunningJob["kind"], repo: string, num: string) {
  return list.find((j) => j.kind === kind && j.repo.toLowerCase() === repo.toLowerCase() && j.num === num);
}

// Test seam: drop every subscriber and timer.
export function resetRunning(): void {
  window.clearTimeout(timer);
  timer = undefined;
  jobs = [];
  subs.clear();
}
