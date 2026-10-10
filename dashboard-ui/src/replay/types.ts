// The shape of one replay fixture (dashboard-ui/fixtures/replay/<slug>.json): a real PR's
// review as the agent writes it (review.comments is the server's review.json shape, so the
// mapping in map.ts is the server's own), plus what only the public example needs — the diff
// hunks, the human's decision on each finding, and the "explain simply" paragraphs that would
// otherwise cost a model call.

export type Decision = "keep" | "drop" | "edit";

export interface FixtureComment {
  path: string;
  line: number;
  severity: string;
  confidence?: "high" | "medium" | "low";
  title?: string;
  impact?: string;
  how_to_verify?: string;
  body: string;
  suggestion?: string;
  reply_to?: string | null;
  critical_path?: string;
  teach?: Decision;
}

export interface FixtureFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  patch: string;
}

export interface FixtureDecision {
  action: Decision;
  reason: string;
  edited_body?: string;
}

export interface ReplayFixture {
  slug: string;
  repo: string;
  pr: string;
  title: string;
  author: string;
  head: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  language: string;
  headline: string;
  me: { login: string; name: string; personal: boolean; dry_run: boolean };
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    realTokens: number;
    costUsd: number;
    durationMs: number;
  };
  effort: { label: string; hint: string };
  files: FixtureFile[];
  review: {
    event: string;
    summary: string;
    keyPoints?: string[];
    explainer?: string;
    analysis?: string;
    comments: FixtureComment[];
  };
  decisions: FixtureDecision[];
  explain: Record<string, string>;
}
