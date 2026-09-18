/* One severity vocabulary for every mock and the live run: dot colour plus a sentence-case word. */
export type Tone = "blue" | "amber" | "red" | "green" | "graphite";
export const severity: Record<string, { word: string; tone: Tone }> = {
  blocker: { word: "Blocker", tone: "red" },
  high: { word: "Blocker", tone: "red" },
  "should-fix": { word: "Should fix", tone: "amber" },
  medium: { word: "Should fix", tone: "amber" },
  nit: { word: "Nit", tone: "graphite" },
  low: { word: "Nit", tone: "graphite" },
  question: { word: "Question", tone: "blue" },
  p0: { word: "P0", tone: "red" },
  p1: { word: "P1", tone: "amber" },
  p2: { word: "P2", tone: "graphite" },
};
export const sev = (key: string) => severity[key] ?? { word: key, tone: "graphite" as Tone };
