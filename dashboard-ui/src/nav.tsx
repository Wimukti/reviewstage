// The phone shell's navigation model (openspec/changes/mobile-app-feel M1).
//
// Three tabs, each a stack: a root page (large title) and the detail pages pushed on it (a
// back button naming the parent, a compact title). What tab a route belongs to, its title and
// its parent come from routeMeta(); a page can override the title and the back target with
// useNavBar(), and put one control in the bar with <NavBarAction>. Everything here is inert on
// the desktop: the hooks only write to a store nobody reads, and the portals have no slot.
import { useLayoutEffect, useId, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toPath } from "./router";

export type TabKey = "queue" | "activity" | "you";
export const TABS: { key: TabKey; label: string; root: string }[] = [
  { key: "queue", label: "Queue", root: "/" },
  { key: "activity", label: "Activity", root: "/activity" },
  { key: "you", label: "You", root: "/you" },
];
export const tabLabel = (k: TabKey) => TABS.find((t) => t.key === k)!.label;

// The queue views Activity shows (what you reviewed, posted, approved).
export const ACTIVITY_VIEWS = ["reviewed", "posted", "approved"] as const;

// The Settings sections a You row pushes as a page of its own (/you/<id>).
export const SECTION_LABELS: Record<string, string> = {
  phone: "Your phone",
  desktop: "Desktop app",
  appearance: "Appearance",
  privacy: "Privacy",
  repositories: "Repositories",
  poller: "Poller",
  filters: "PR filters",
  notifications: "Notifications",
  webhooks: "Webhooks",
  devices: "Devices",
};

const DESK: Record<string, string> = {
  "/settings": "Settings",
  "/repos": "Repositories",
  "/integrations": "Integrations",
  "/learnings": "Learnings",
  "/dashboard": "Insights",
  "/skills": "Skills",
  "/qa": "QA guides",
};

export type Back = { label: string; to: string };
export type RouteMeta = {
  tab: TabKey;
  /** 0 for a tab's root, more for each push. Drives push/pop versus cross-fade. */
  depth: number;
  title: string;
  back: Back | null;
};

// Where the open PR was opened from: the page it goes back to and the tab it keeps lit.
type Origin = { url: string; label: string; tab: TabKey };
let origin: Origin = { url: "/", label: "Queue", tab: "queue" };
let lastSeen = "";

const split = (url: string) => {
  const u = new URL(url, "http://x");
  return { path: toPath(u.pathname), search: u.searchParams };
};

const isPr = (path: string) => path.startsWith("/pr") || path.startsWith("/stack");

/** The route's place in the shell. Pure but for the PR origin, which noteRoute() keeps. */
export function routeMeta(url: string, brand = "ReviewStage"): RouteMeta {
  const { path, search } = split(url);
  const you: Back = { label: "You", to: "/you" };
  if (path === "/") return { tab: "queue", depth: 0, title: brand, back: null };
  if (path === "/activity") return { tab: "activity", depth: 0, title: "Activity", back: null };
  if (path === "/you") return { tab: "you", depth: 0, title: "You", back: null };
  if (path.startsWith("/you/")) {
    const id = path.slice(5);
    return { tab: "you", depth: 1, title: SECTION_LABELS[id] || "Settings", back: you };
  }
  if (path.startsWith("/pr")) {
    const n = search.get("pr");
    return { tab: origin.tab, depth: 1, title: n ? `#${n}` : "Pull request", back: { label: origin.label, to: origin.url } };
  }
  if (path.startsWith("/stack")) {
    return { tab: origin.tab, depth: 2, title: "Stack", back: { label: origin.label, to: origin.url } };
  }
  if (path === "/qa" && search.get("pr")) {
    const n = search.get("pr")!.replace(/^.*#/, "");
    return { tab: "you", depth: 2, title: `#${n}`, back: { label: "QA guides", to: "/qa" } };
  }
  const desk = Object.keys(DESK).find((k) => path === k || path.startsWith(k + "/"));
  if (desk) return { tab: "you", depth: 1, title: DESK[desk], back: you };
  return { tab: "queue", depth: 1, title: "Not found", back: { label: "Queue", to: "/" } };
}

/**
 * Record a route change so a PR opened from Activity goes back to Activity (and keeps that
 * tab lit), and one opened from Insights goes back to Insights. Idempotent per URL.
 */
export function noteRoute(url: string, brand?: string): void {
  if (url === lastSeen) return;
  const prev = lastSeen;
  lastSeen = url;
  if (!prev || !isPr(split(url).path) || isPr(split(prev).path)) return;
  const m = routeMeta(prev, brand);
  origin = { url: prev, label: m.depth === 0 ? tabLabel(m.tab) : m.title, tab: m.tab };
}

// The URL each tab was last showing at its root, so going back to Activity keeps its view.
const tabUrls: Record<TabKey, string> = { queue: "/", activity: "/activity", you: "/you" };
export function rememberTabUrl(url: string): void {
  const m = routeMeta(url);
  if (m.depth === 0) tabUrls[m.tab] = url;
}
export const tabUrl = (k: TabKey) => tabUrls[k];

// ---- the bar's page-set state ----------------------------------------------------------------

export type NavOptions = {
  /** The compact title (and the large title on a tab root). */
  title?: string;
  /** Where ‹ goes, and the parent's name it shows. */
  back?: Back;
  /** The page renders its own h1 (the PR title), so the bar's title is not a heading. */
  ownsHeading?: boolean;
};

type Store = { opts: Map<string, NavOptions>; action: HTMLElement | null; aux: HTMLElement | null };
let store: Store = { opts: new Map(), action: null, aux: null };
const subs = new Set<() => void>();
const emit = (next: Store) => {
  store = next;
  subs.forEach((s) => s());
};
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

export function useNavStore(): Store {
  return useSyncExternalStore(subscribe, () => store);
}

/** The merged page overrides (the most recently mounted page wins). */
export function navOverrides(s: Store): NavOptions {
  const out: NavOptions = {};
  for (const o of s.opts.values()) Object.assign(out, Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)));
  return out;
}

/**
 * Set this page's title, back target or heading ownership in the phone navigation bar. Pass
 * only what differs from the route's defaults (routeMeta). Cleared when the page unmounts.
 */
export function useNavBar(opts: NavOptions): void {
  const id = useId();
  const { title, back, ownsHeading } = opts;
  const backLabel = back?.label;
  const backTo = back?.to;
  useLayoutEffect(() => {
    const next = new Map(store.opts);
    next.set(id, {
      title,
      back: backLabel !== undefined && backTo !== undefined ? { label: backLabel, to: backTo } : undefined,
      ownsHeading,
    });
    emit({ ...store, opts: next });
    return () => {
      const after = new Map(store.opts);
      after.delete(id);
      emit({ ...store, opts: after });
    };
  }, [id, title, backLabel, backTo, ownsHeading]);
}

export function setNavSlot(which: "action" | "aux", el: HTMLElement | null): void {
  if (store[which] === el) return;
  emit({ ...store, [which]: el });
}

/**
 * The one control on the right of the phone navigation bar (search on the queue, ⋯ on a PR).
 * Give it a 44×44 target and an aria-label. Renders nothing on the desktop.
 */
export function NavBarAction({ children }: { children: ReactNode }) {
  const { action } = useNavStore();
  return action ? createPortal(children, action) : null;
}

/** Beside the large title on a tab root, else on the right of the bar: the page's `?`. */
export function NavBarAux({ children }: { children: ReactNode }) {
  const { aux } = useNavStore();
  return aux ? createPortal(children, aux) : null;
}
