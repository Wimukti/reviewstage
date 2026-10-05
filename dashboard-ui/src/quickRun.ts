// Run review from a queue row (the phone's swipe right, or the row's ⋯ menu). Exactly what the
// PR page's Run review button does with its defaults — the suggested effort, its model, no
// focus — on the clicker's own Claude account. It starts a run and nothing else: it never posts.
import { api, type PrRef } from "./api";
import { pokeRunning } from "./running";

/** The model the run form starts on for an effort (RunForm uses the same). */
export const defaultModelFor = (effort: string): string => (effort === "deep" ? "opus" : "");

export type QuickRun =
  | { kind: "started"; effort: string }
  | { kind: "busy" }
  | { kind: "no-claude" };

export async function quickRun(ref: PrRef): Promise<QuickRun> {
  const d = await api.pr(ref);
  if (!d.claudeConnected) return { kind: "no-claude" };
  const effort = d.runForm.suggested;
  const r = await api.review(ref, d.tokens.review, effort, "", defaultModelFor(effort));
  // A previous run still holds the per-PR lock.
  if (r.started === false) return { kind: "busy" };
  pokeRunning();
  return { kind: "started", effort: d.runForm.levels.find((l) => l.key === effort)?.name || effort };
}
