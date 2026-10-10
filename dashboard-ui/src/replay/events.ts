// Local-only conversion counters for the public examples and the replay. The site has no
// server and this must stay true: every count lives in this browser's localStorage, nothing
// is ever transmitted, and every access is wrapped so blocked storage costs nothing. Exposed as
// window.__rsReplayEvents so the Playwright spec can read the tally.
export const EVENT_NAMES = [
  "example_viewed",
  "replay_started",
  "first_decision",
  "replay_completed",
  "install_copied",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];
export type EventCounts = Record<EventName, number>;

export const EVENTS_KEY = "rs_replay_events";
export const EVENT = "rs-replay:event";

const empty = (): EventCounts =>
  Object.fromEntries(EVENT_NAMES.map((n) => [n, 0])) as EventCounts;

export function readEvents(): EventCounts {
  const out = empty();
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const n of EVENT_NAMES) {
      const v = parsed[n];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[n] = Math.floor(v);
    }
  } catch {
    /* blocked or corrupt storage: counts read as zero */
  }
  return out;
}

export function bump(name: EventName): EventCounts {
  const counts = readEvents();
  counts[name] += 1;
  try {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(counts));
  } catch {
    /* private mode: the count lasts for this page only */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { name, counts } }));
  } catch {
    /* no window */
  }
  return counts;
}

export function resetEvents(): void {
  try {
    localStorage.removeItem(EVENTS_KEY);
  } catch {
    /* nothing stored */
  }
}

export interface ReplayEventsApi {
  key: string;
  names: readonly EventName[];
  read: () => EventCounts;
  bump: (name: EventName) => EventCounts;
  reset: () => void;
}

declare global {
  interface Window {
    __rsReplayEvents?: ReplayEventsApi;
  }
}

/** Puts the counters on window for devtools and tests. Idempotent. */
export function exposeEvents(): ReplayEventsApi {
  const api: ReplayEventsApi = { key: EVENTS_KEY, names: EVENT_NAMES, read: readEvents, bump, reset: resetEvents };
  try {
    window.__rsReplayEvents = api;
  } catch {
    /* no window */
  }
  return api;
}
