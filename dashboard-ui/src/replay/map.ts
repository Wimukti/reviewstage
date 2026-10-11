// A TypeScript port of the server's review → page mapping (bin/server.py `_review_data`,
// `_fallback_title`, `_as_markdown`, `sev_counts`, `default_approve_msg`, plus the PrData
// envelope `api_pr` builds), so the replay hands the untouched PR page exactly what the real
// server would. src/replay.test.ts asserts parity against src/stage/fixture.json, which is
// generated from the real server's fixture.
import type { Finding, GuideData, Me, PrData, QueueData, ReviewData, SevChip, Where } from "../api";
import { badge as badgeOf, isMaybe } from "../confidence";
import { annotate, demoted, patchesOf } from "../evidence";
import type { FixtureComment, FixtureFile, FixtureGuide, ReplayFixture } from "./types";

export const SEV_ORDER: Record<string, number> = { blocker: 0, "should-fix": 1, nit: 2, question: 3 };
export const SEV_LABEL: Record<string, string> = {
  blocker: "blocker", "should-fix": "should fix", nit: "nit", question: "question",
};
export const PRESELECT_CAP = 25;
export const POST_COMMENT_CAP = 50;

export const sevOrder = (s: string | undefined) => SEV_ORDER[s ?? ""] ?? 9;
export const sevLabel = (s: string) => SEV_LABEL[s] ?? s;

export function asMarkdown(v: unknown): string {
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const x of v) {
      const t = String(x).trim();
      if (t) out.push("-*#>".includes(t[0]) ? t : `- ${t}`);
    }
    return out.join("\n");
  }
  return String(v ?? "");
}

export function fallbackTitle(c: FixtureComment): string {
  const body = (c.body || "").trim();
  if (body) {
    const line = body.split(/\r?\n/)[0].replace(/[`*_#>]/g, "").trim();
    if (line) return line.slice(0, 90) + (line.length > 90 ? "…" : "");
  }
  const loc = c.path || "?";
  return c.line !== undefined && c.line !== null ? `${loc}:${c.line}` : loc;
}

export function sevCounts(comments: FixtureComment[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of comments) {
    const s = c.severity || "nit";
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

export function chipsOf(comments: FixtureComment[]): SevChip[] {
  return Object.entries(sevCounts(comments))
    .sort((a, b) => sevOrder(a[0]) - sevOrder(b[0]))
    .map(([kind, n]) => ({ kind, n, label: sevLabel(kind) }));
}

/** The server's stable sort by severity (Python's sort is stable; so is Array.prototype.sort). */
export function sortComments(comments: FixtureComment[]): FixtureComment[] {
  return [...comments].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity));
}

// GitHub takes an inline comment only on a line the diff touches or shows as context. The
// server asks GitHub for the PR's files and reads the hunks; here the fixture carries them.
export function linesInDiff(files: FixtureFile[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const f of files) {
    const lines = new Set<number>();
    let n = 0;
    for (const raw of f.patch.split("\n")) {
      const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (h) {
        n = Number(h[1]);
        continue;
      }
      if (raw.startsWith("-")) continue;
      if (raw.startsWith("+") || raw.startsWith(" ") || raw === "") {
        if (raw.startsWith("+") || raw.startsWith(" ")) lines.add(n);
        n += 1;
      }
    }
    out.set(f.filename, lines);
  }
  return out;
}

export const anchorable = (files: FixtureFile[], c: FixtureComment): boolean =>
  linesInDiff(files).get(c.path)?.has(Number(c.line)) ?? false;

/** rs_review_schema.normalize_where: path:line, widened by end_line; null without a line. */
export function whereOf(c: FixtureComment): Where | null {
  const start = Number(c.line);
  if (!c.path || !Number.isInteger(start) || start <= 0) return null;
  const end = c.end_line && c.end_line > start ? c.end_line : start;
  return { path: c.path, start, end };
}

/** rs_review_schema.normalize_guide → server._guide_data, for the fixture's `guide`. */
export function guideOf(g: FixtureGuide | undefined): GuideData | null {
  if (!g || typeof g !== "object") return null;
  const out: GuideData = {
    does: (g.does || "").trim(),
    why: (g.why || "").trim(),
    risk: g.risk ?? null,
    readPlan: (g.read_plan ?? []).filter((r) => r && r.path).map((r) => ({ path: r.path, lines: r.lines ?? null, why: (r.why || "").trim() })),
    notCovered: (g.not_covered ?? []).map((x) => String(x).trim()).filter(Boolean),
  };
  if (!out.does && !out.why && !out.risk && !out.readPlan.length && !out.notCovered.length) return null;
  return out;
}

// `files` is the fixture's diff; `where` answers anchorability as the server's Anchors would.
export function mapFindings(
  comments: FixtureComment[],
  where: (c: FixtureComment) => boolean | null,
  files: FixtureFile[] | null = null,
  // Only `status` is read; the fixture's record and the wire's (`durationMs`) both fit.
  disproof: { status: string } | null = null,
): Finding[] {
  const shown = sortComments(comments);
  const patches = files ? patchesOf(files) : null;
  const evidence = shown.map((c) => annotate({ ...c, where: whereOf(c) }, patches));
  // The badge (Part 2): evidence, the fixture's disproof verdict, no calibration (the replay
  // has no learnings). The server's maybe-tray decision: low confidence, two or more evidence
  // flags, or a Maybe badge.
  const badges = shown.map((c, i) => badgeOf(evidence[i].evidence, c.checked ?? null, null, disproof ?? null));
  const maybe = shown.map((c, i) => c.confidence === "low" || demoted(evidence[i].evidence) || isMaybe(badges[i]));
  const preselectable = maybe.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0);
  const preselect = new Set(preselectable.length > PRESELECT_CAP ? preselectable.slice(0, PRESELECT_CAP) : preselectable);
  return shown.map((c, i) => ({
    i,
    severity: c.severity || "nit",
    sevLabel: sevLabel(c.severity || "nit"),
    path: c.path || "?",
    line: c.line ?? "?",
    thread: c.reply_to ? c.reply_to : null,
    body: c.body || "",
    suggestion: c.suggestion || "",
    low: maybe[i],
    confidence: c.confidence ?? null,
    howToVerify: c.how_to_verify ?? "",
    title: c.title || fallbackTitle(c),
    impact: (c.impact || "").trim(),
    where: whereOf(c),
    whatToCheck: (c.what_to_check || "").trim(),
    expected: (c.expected || "").trim(),
    actual: (c.actual || "").trim(),
    snippet: evidence[i].snippet,
    evidence: evidence[i].evidence,
    checked: c.checked ?? null,
    badge: badges[i],
    criticalPath: (c.critical_path || "").trim(),
    structured: !!((c.title || "").trim() && (c.impact || "").trim()),
    agreement: null,
    preselect: preselect.has(i),
    taught: false,
    anchorable: where(c),
  }));
}

const gist = (body: string) => body.split(/\r?\n/)[0].replace(/[`*_#>]/g, "").trim().slice(0, 120);

export function defaultApproveMsg(comments: FixtureComment[]): string {
  const items = comments.filter((c) => c.severity === "blocker" || c.severity === "should-fix");
  if (!items.length) return "LGTM 🚀";
  const lines = ["LGTM. Just handle these before merge:", ""];
  for (const c of items) {
    const where = c.line ? `\`${c.path}:${c.line}\`` : `\`${c.path}\``;
    lines.push(`- ${where}: ${gist(c.body || "")}`);
  }
  return lines.join("\n");
}

export function reviewData(fx: ReplayFixture, dryRun: boolean): ReviewData {
  const rev = fx.review;
  const sorted = sortComments(rev.comments);
  const cs = sevCounts(sorted);
  return {
    reviewKey: `${fx.head}:replay`,
    event: rev.event || "COMMENT",
    summary: asMarkdown(rev.summary),
    guide: guideOf(rev.guide),
    disproof: rev.disproof
      ? { status: rev.disproof.status, n: rev.disproof.n, checked: rev.disproof.checked, durationMs: rev.disproof.duration_ms, mode: rev.disproof.mode }
      : null,
    keyPoints: (rev.keyPoints ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 6),
    explainer: asMarkdown(rev.explainer),
    analysis: asMarkdown(rev.analysis),
    chips: chipsOf(sorted),
    findings: mapFindings(rev.comments, (c) => anchorable(fx.files, c), fx.files, rev.disproof ?? null),
    count: sorted.length,
    posted: false,
    postLabel: "Post selected" + (dryRun ? " (dry run)" : " to GitHub"),
    reused: false,
    anchorsUnknown: false,
    anchorError: "",
    convergence: null,
    maxPerPost: POST_COMMENT_CAP,
    approve: {
      lgtm: (cs.blocker ?? 0) === 0 && rev.event !== "REQUEST_CHANGES",
      blockers: cs.blocker ?? 0,
      defaultMsg: defaultApproveMsg(rev.comments),
      reviewedHead: fx.head,
      currentHead: fx.head,
    },
  };
}

const TOKEN = { exp: "4102444800", sig: "replay" };
const TOKENS = ["review", "stop", "post", "approve", "markdone", "archive", "unarchive", "explain", "teach"];

export function meData(fx: ReplayFixture): Me {
  return {
    authed: true,
    login: fx.me.login,
    name: fx.me.name,
    claude_connected: false,
    dry_run: fx.me.dry_run,
    repo: fx.repo,
    repos: [fx.repo],
    allowOrg: "",
    brand: "ReviewStage",
    oauth: false,
    personal: fx.me.personal,
    tour_seen: true,
    poller_ran: true,
    running: [],
    auth: "cookie",
    login_via: "oauth",
  };
}

export function prData(fx: ReplayFixture): PrData {
  const files = fx.changedFiles === 1 ? "1 file" : `${fx.changedFiles} files`;
  return {
    repo: fx.repo,
    pr: fx.pr,
    title: fx.title,
    state: "done",
    ghUrl: `https://github.com/${fx.repo}/pull/${fx.pr}`,
    author: fx.author,
    size: `+${fx.additions.toLocaleString("en-US")} −${fx.deletions.toLocaleString("en-US")} · ${files}`,
    dryRun: fx.me.dry_run,
    prState: "open",
    merged: false,
    canApprove: true,
    awaiting: true,
    runner: fx.me.login,
    effortBadge: fx.effort,
    usage: fx.usage,
    focus: "",
    stale: false,
    risk: [],
    stack: { isStack: false, size: 0 },
    timeline: [
      { label: "Reviewed", done: true, note: "3 minutes ago" },
      { label: "Comments posted", done: false, note: "" },
      { label: "Approved", done: false, note: "" },
    ],
    reviewers: null,
    claudeConnected: false,
    runForm: {
      suggested: "standard",
      levels: [
        { key: "quick", name: "Quick", sub: "Diff only, a first pass" },
        { key: "standard", name: "Standard", sub: "The diff and the files it touches" },
        { key: "deep", name: "Deep", sub: "Follows calls across the repository" },
      ],
      models: [{ key: "sonnet", name: "Sonnet", sub: "The default" }],
      skillLabel: "your skill",
      othersOnHead: [],
    },
    tokens: Object.fromEntries(TOKENS.map((k) => [k, TOKEN])),
    history: [],
    review: reviewData(fx, fx.me.dry_run),
    showMarkDone: true,
  };
}

export function queueData(fx: ReplayFixture): QueueData {
  const chips = chipsOf(fx.review.comments);
  return {
    tab: "todo",
    sort: "newest",
    tabs: [{ key: "todo", label: "To do", count: 1 }],
    stats: { todo: 1 },
    tabDesc: "Reviews requested from you.",
    rows: [
      {
        repo: fx.repo,
        num: fx.pr,
        title: fx.title,
        author: fx.author,
        state: "done",
        size: `+${fx.additions} −${fx.deletions}`,
        when: ["requested 3 minutes ago"],
        sev: chips,
        archived: false,
        running: false,
        status: "",
        archiveToken: TOKEN,
      } as QueueData["rows"][number],
    ],
    repos: [fx.repo],
    slackOk: false,
  } as QueueData;
}
