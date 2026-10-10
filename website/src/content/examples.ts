/* The public examples: the replay fixtures (dashboard-ui/fixtures/replay/*.json) read by path,
 * so the static /examples pages, the live /try replay and its Playwright spec all render the
 * same stored reviews. The server-mapping port in @app/replay/map decides what each finding
 * looks like, exactly as it does in the replay. */
import type { ReplayFixture, FixtureComment, FixtureDecision, FixtureFile } from "@app/replay/types";
import { anchorable, reviewData, sortComments } from "@app/replay/map";

export type { ReplayFixture, FixtureComment, FixtureDecision, FixtureFile };

const modules = import.meta.glob<{ default: ReplayFixture }>("../../../dashboard-ui/fixtures/replay/*.json", { eager: true });
// The same order as @app/replay/fixtures (the index lists them; "first" is the replay default).
const ORDER = ["webhook-retry", "rate-limit-tenant", "cache-stale-read"];
export const examples: ReplayFixture[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug));

export const bySlug = (slug: string) => examples.find((e) => e.slug === slug);

/** One finding with the person's decision beside it, in the page order (by severity). */
export interface ExampleFinding {
  index: number; // position in the sorted list, as the replay numbers them
  comment: FixtureComment;
  decision: FixtureDecision;
  anchorable: boolean;
  finalBody: string | null; // what posts: the edited body, the original, or null when dropped
  file: FixtureFile | undefined;
}

export function findingsOf(fx: ReplayFixture): ExampleFinding[] {
  const sorted = sortComments(fx.review.comments);
  return sorted.map((comment, index) => {
    const original = fx.review.comments.indexOf(comment);
    const decision = fx.decisions[original];
    const finalBody = decision.action === "drop" ? null : decision.action === "edit" ? decision.edited_body ?? comment.body : comment.body;
    return {
      index,
      comment,
      decision,
      anchorable: anchorable(fx.files, comment),
      finalBody,
      file: fx.files.find((f) => f.filename === comment.path),
    };
  });
}

export const review = (fx: ReplayFixture) => reviewData(fx, true);

/** The verdict line the PR page shows (PrPage.tsx `verdict`), ported for the static page. */
export function verdictOf(fx: ReplayFixture): { tone: "red" | "amber" | "green"; text: string } {
  const rev = review(fx);
  const cnt = (k: string) => rev.chips.find((c) => c.kind === k)?.n ?? 0;
  const b = cnt("blocker");
  const f = cnt("should-fix");
  if (rev.event === "REQUEST_CHANGES") return { tone: "red", text: "Changes requested" };
  if (b) return { tone: "red", text: `${b} blocker${b > 1 ? "s" : ""} to resolve before merge` };
  if (f) return { tone: "amber", text: `${f} thing${f > 1 ? "s" : ""} to fix before merge` };
  if (rev.count === 0) return { tone: "green", text: "Looks good — nothing to fix" };
  return { tone: "green", text: "Looks good — comments only, nothing blocking" };
}

export const DECISION_WORD: Record<FixtureDecision["action"], string> = { keep: "Kept", drop: "Dropped", edit: "Edited" };
export const DECISION_TONE: Record<FixtureDecision["action"], string> = {
  keep: "bg-green/12 text-foreground [&>svg]:text-green",
  drop: "bg-red/12 text-foreground [&>svg]:text-red",
  edit: "bg-amber/12 text-foreground [&>svg]:text-amber",
};
export const CONFIDENCE_WORD: Record<string, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

export const tryUrl = (slug: string) => `/try/?example=${encodeURIComponent(slug)}`;
export const EXAMPLES_H1 = "Three reviews, and what a person did with them";
