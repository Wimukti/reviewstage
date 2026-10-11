// A TypeScript port of bin/rs_evidence.py — the deterministic evidence check and the inline
// snippet (openspec/changes/trust-and-plain/design.md §1.4). The server runs the Python module
// once per render; this port exists for the one place that has no server, the public replay
// (src/replay/map.ts), whose fixtures carry the diff hunks. src/evidence.test.ts holds it to the
// Python module's own output for the e2e fixture (src/stage/fixture.json, written by the Python
// CLI), so the two cannot drift. Pure: no DOM, no API, no imports from the app.
import type { Evidence, Snippet, SnippetLine, Where } from "./api";

export const SNIPPET_MIN = 8;
export const SNIPPET_MAX = 12;
export const SNIPPET_TARGET = 10;
export const DEMOTE_AT = 2;

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const BACKTICK = /`([^`\n]{1,80})`/g;
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;

export interface EvidenceInput {
  path?: string | null;
  line?: number | string | null;
  severity?: string;
  title?: string | null;
  what_to_check?: string | null;
  expected?: string | null;
  actual?: string | null;
  where?: Where | null;
}

type Row = { n: number | null; text: string; kind: SnippetLine["kind"] };

/** One list per hunk; `n` is the new-file line number, null for a removed line. */
export function hunks(patch: string | null | undefined): Row[][] {
  const out: Row[][] = [];
  let cur: Row[] | null = null;
  let n = 0;
  const rows = (patch ?? "").split("\n");
  if (rows.length && rows[rows.length - 1] === "") rows.pop();
  for (const raw of rows) {
    const m = HUNK.exec(raw);
    if (m) {
      cur = [];
      out.push(cur);
      n = Number(m[1]);
      continue;
    }
    if (cur === null || (raw === "" && n === 0)) continue;
    if (raw.startsWith("\\")) continue;
    const head = raw.slice(0, 1);
    if (head === "+") {
      cur.push({ n, text: raw.slice(1), kind: "add" });
      n += 1;
    } else if (head === "-") {
      cur.push({ n: null, text: raw.slice(1), kind: "del" });
    } else if (head === " " || raw === "") {
      cur.push({ n, text: raw.slice(1), kind: "ctx" });
      n += 1;
    }
  }
  return out.filter((h) => h.length > 0);
}

/** {new-file line → text} for every added or context line. */
export function newLines(patch: string | null | undefined): Map<number, string> {
  const out = new Map<number, string>();
  for (const h of hunks(patch)) for (const r of h) if (r.n !== null) out.set(r.n, r.text);
  return out;
}

export function snippet(patch: string | null | undefined, start: number | null, end: number | null, target = SNIPPET_TARGET, lo = SNIPPET_MIN, hi = SNIPPET_MAX): Snippet | null {
  if (start === null || start === undefined) return null;
  const last_ = end ?? start;
  for (const h of hunks(patch)) {
    const idx = h.map((r, i) => (r.n !== null && start <= r.n && r.n <= last_ ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const first = idx[0];
    const last = idx[idx.length - 1];
    let want = Math.max(lo, Math.min(hi, target, h.length));
    want = Math.max(want, Math.min(hi, last - first + 1));
    let a = first;
    let b = last + 1;
    while (b - a < want && (a > 0 || b < h.length)) {
      if (a > 0 && (b >= h.length || first - a <= b - last - 1)) a -= 1;
      else if (b < h.length) b += 1;
    }
    const lines: SnippetLine[] = h.slice(a, b).map((r) => ({ ...r, cited: r.n !== null && start <= r.n && r.n <= last_ }));
    const nums = lines.map((r) => r.n).filter((x): x is number => x !== null);
    return { start: nums.length ? Math.min(...nums) : start, end: nums.length ? Math.max(...nums) : last_, lines };
  }
  return null;
}

/** Identifiers quoted in backticks, in order, de-duplicated. */
export function symbols(...texts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    if (typeof t !== "string") continue;
    for (const m of t.matchAll(BACKTICK)) {
      for (const id of m[1].match(IDENT) ?? []) {
        if (["a", "the", "an"].includes(id.toLowerCase()) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

const tick = (s: string) => "`" + s + "`";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `where` for a finding from path:line (the normaliser's reading, for fixtures without one). */
export function whereOf(c: EvidenceInput): Where | null {
  if (c.where && typeof c.where === "object") return c.where;
  const n = typeof c.line === "number" ? c.line : typeof c.line === "string" && /^\d+$/.test(c.line.trim()) ? Number(c.line) : null;
  if (!c.path || n === null || n <= 0) return null;
  return { path: c.path, start: n, end: n };
}

/** The verdict; null when there is no diff to check against. */
export function check(c: EvidenceInput, patches: Map<string, string | null> | null, changed?: Set<string>): Evidence | null {
  if (patches === null) return null;
  const files = changed ?? new Set(patches.keys());
  const where = whereOf(c);
  const path = where?.path ?? c.path ?? null;
  const start = where?.start ?? null;
  const end = where?.end ?? start;
  const flags: string[] = [];
  const notes: string[] = [];
  let found: string[] = [];
  const quoted = symbols(c.title, c.what_to_check);
  const patch = path ? (patches.get(path) ?? null) : null;
  const inDiff = !!path && files.has(path);
  if (!inDiff) {
    flags.push("path_not_in_diff");
    notes.push(`${path ? tick(path) : "The file"} is not a file this PR changes.`);
  } else if (patch && start !== null) {
    const lines = newLines(patch);
    const cited = [...lines.entries()].filter(([n]) => start <= n && n <= (end ?? start));
    if (!cited.length) {
      flags.push("lines_not_in_diff");
      const rng = start === end ? `${start}` : `${start}–${end}`;
      const base = path!.split("/").pop();
      notes.push(`Lines ${rng} are not in this PR's changes to ${tick(base!)}.`);
    } else if (quoted.length) {
      const win = snippet(patch, start, end ?? start);
      const hay = win ? win.lines.map((r) => r.text).join("\n") : cited.map(([, t]) => t).join("\n");
      found = quoted.filter((q) => new RegExp(`(?<![A-Za-z0-9_])${escapeRe(q)}(?![A-Za-z0-9_])`).test(hay));
      if (!found.length) {
        flags.push("symbol_not_found");
        const shown = quoted.slice(0, 3).map(tick).join(", ");
        notes.push(`${shown} ${quoted.length === 1 ? "does" : "do"} not appear in the cited lines.`);
      }
    }
  }
  const newShape = !!(c.what_to_check || c.expected || c.actual);
  if (c.severity === "blocker" && newShape && !(c.expected && c.actual)) {
    flags.push("no_contrast");
    notes.push("A blocker needs both Expected and Actual.");
  }
  let line: string;
  if (flags.length) line = notes.join(" ");
  else if (found.length) line = "The cited lines are in this diff and mention " + found.slice(0, 3).map(tick).join(", ") + ".";
  else if (inDiff && (!patch || start === null)) line = "The file is in this diff; its lines could not be checked.";
  else line = "The cited lines are in this diff.";
  return { status: flags.length ? "warn" : "pass", flags, line, symbols: found };
}

export const demoted = (ev: Evidence | null | undefined): boolean => !!ev && (ev.flags?.length ?? 0) >= DEMOTE_AT;

/** {filename → patch or null} from the GitHub files-API payload (or a fixture's `files`). */
export function patchesOf(files: { filename?: string; patch?: string | null }[] | null | undefined): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const f of files ?? []) if (f.filename) out.set(f.filename, f.patch || null);
  return out;
}

/** `evidence` and `snippet` for one finding, as the server sends them. */
export function annotate(c: EvidenceInput, patches: Map<string, string | null> | null): { evidence: Evidence | null; snippet: Snippet | null } {
  const evidence = check(c, patches);
  const where = whereOf(c);
  const patch = patches && where ? patches.get(where.path) : null;
  return { evidence, snippet: patch ? snippet(patch, where!.start, where!.end) : null };
}
