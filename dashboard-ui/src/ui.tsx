import { useEffect, useState } from "react";
import { Icon } from "./icons";

// The shared status vocabulary (design.md §4): a coloured dot and a sentence-case word. The
// colour mapping is fixed and used everywhere — amber is "needs you", red is a blocker or a
// failure, green is done or posted, graphite is neutral, blue is staged or primary.
export type Tone = "blue" | "amber" | "red" | "green" | "graphite";

const TONES: Record<string, Tone> = {
  // severities
  blocker: "red", "should-fix": "amber", nit: "graphite", question: "graphite",
  // review / PR states
  new: "amber", reviewing: "amber", queued: "amber", done: "green", reviewed: "green",
  posted: "green", approved: "green", failed: "red", stalled: "red", stopped: "amber",
  dry: "amber", archived: "graphite", merged: "green", closed: "graphite",
  // misc
  ok: "green", warn: "amber", live: "green", stale: "amber", edited: "amber",
  promoted: "green", dismissed: "graphite", preference: "graphite",
};

const WORDS: Record<string, string> = {
  blocker: "Blocker", "should-fix": "Should fix", nit: "Nit", question: "Question",
  new: "New", reviewing: "Reviewing", queued: "Queued", done: "Reviewed", reviewed: "Reviewed",
  posted: "Posted", approved: "Approved", failed: "Failed", stalled: "Stalled", stopped: "Stopped",
  dry: "Dry run", archived: "Archived", merged: "Merged", closed: "Closed", live: "Live",
};

export const toneOf = (kind: string): Tone => TONES[kind] ?? "graphite";
export const wordOf = (kind: string): string =>
  WORDS[kind] ?? (kind ? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/-/g, " ") : "");

export function Status({
  kind,
  tone,
  children,
  live,
  title,
  ...rest
}: {
  kind?: string;
  tone?: Tone;
  children?: React.ReactNode;
  live?: boolean; // the running-dot pulse
  title?: string;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "title" | "children">) {
  const t = tone ?? toneOf(kind ?? "");
  return (
    <span className={`status is-${t}${live ? " is-live" : ""}`} title={title} {...rest}>
      <i aria-hidden="true" />
      {children ?? wordOf(kind ?? "")}
    </span>
  );
}

// Banner: one shape for every notice. `kind` picks the tint and the icon; the words carry the
// meaning, the icon only echoes it.
const BANNER_ICON: Record<string, string> = { ok: "check", warn: "alert", err: "x", info: "info" };
export function Banner({
  kind = "info",
  icon,
  children,
  ...rest
}: {
  kind?: "ok" | "warn" | "err" | "info";
  icon?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`banner ${kind}`} {...rest}>
      <Icon name={icon ?? BANNER_ICON[kind]} />
      <div>{children}</div>
    </div>
  );
}

// Server-rendered banner HTML (the API answers with `bannerHtml`).
export function RawBanner({ html }: { html: string }) {
  if (!html) return null;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// The busy rule: a control swaps its label to the progressive verb and disables; a pulsing dot
// only appears once the wait has run past a second.
export function useSlowBusy(busy: boolean, ms = 1000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(t);
  }, [busy, ms]);
  return slow;
}
export function SlowBusy({ busy }: { busy: boolean }) {
  const slow = useSlowBusy(busy);
  return slow ? <span className="rundot" aria-hidden="true" /> : null;
}
