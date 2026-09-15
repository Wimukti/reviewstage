import type { Usage } from "./api";

// PR identity on the client: a PR is (repo, number). parsePrRef() turns whatever a user typed or
// pasted — a bare number, "#123", "owner/name#123", or a full GitHub PR URL — into a PrRef,
// resolving the repo from the configured list when the input carries none. Shared by the Queue
// paste box, the QA form and the command palette so all three parse the same way.

export interface PrRef {
  repo: string; // owner/name; "" when the input had no repo and several are configured
  num: string;
}

// Case-insensitive: hostnames are, and a URL copied from a title bar or an email can
// arrive as "GitHub.com". canonicalRepo() then restores the configured spelling.
const URL_RE = /github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/i;
const SHORT_RE = /^([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)#(\d{1,7})$/;

// The configured spelling of a repo (GitHub repo names are case-insensitive), else as typed.
export function canonicalRepo(repo: string, repos: string[]): string {
  const low = repo.toLowerCase();
  return repos.find((r) => r.toLowerCase() === low) ?? repo;
}

// Returns null when there is no PR number in the input. When the input names no repo and
// exactly one is configured, that repo is filled in; with several, `repo` is "" and the caller
// shows a picker.
export function parsePrRef(input: string, repos: string[]): { repo: string; number: string } | null {
  const s = input.trim();
  const u = s.match(URL_RE);
  if (u) return { repo: canonicalRepo(u[1], repos), number: u[2] };
  const sh = s.match(SHORT_RE);
  if (sh) return { repo: canonicalRepo(sh[1], repos), number: sh[2] };
  const n = s.replace(/^#/, "");
  if (!/^\d{1,7}$/.test(n)) return null;
  return { repo: repos.length === 1 ? repos[0] : "", number: n };
}

// Legacy helper: just the number, or "" when there is none.
export function prnum(s: string): string {
  return parsePrRef(s, [])?.number ?? "";
}

// The dashboard URL for a PR page (or its QA / stack sibling). A missing repo yields the legacy
// `?pr=N` form, which the server resolves when exactly one repo is configured.
export function prUrl(ref: PrRef, path = "/pr", extra = ""): string {
  const rq = ref.repo ? `repo=${encodeURIComponent(ref.repo)}&` : "";
  return `${path}?${rq}pr=${ref.num}${extra}`;
}

// The `owner/name #123` label used in headers and Slack.
export function prLabel(ref: PrRef): string {
  return ref.repo ? `${ref.repo} #${ref.num}` : `#${ref.num}`;
}

// Wall-clock of a finished run for the usage chip: "3m 24s", "48s", "1h 02m". 0/undefined → "".
export function fmtDuration(ms: number | undefined | null): string {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

// The usage chip a finished run carries: model, real tokens, wall clock. Shared by the review
// page and the QA guide — a QA build spends the same subscription and had no chip at all.
export function usageChip(u: Usage): string {
  const d = fmtDuration(u.durationMs);
  return `${u.model.replace(/^claude-/, "")} · ${u.realTokens.toLocaleString("en-US")} tokens${
    d ? ` · ${d}` : ""
  }`;
}

// Details on hover: the real breakdown, plus the API-list-price estimate clearly marked as NOT
// what a Claude subscription is billed (it isn't per-token).
export function usageTitle(u: Usage): string {
  const cache = u.cacheReadTokens + (u.cacheCreationTokens ?? 0);
  const cost =
    u.costUsd > 0
      ? ` · ≈ $${u.costUsd.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} at API list prices (not billed on your Claude subscription)`
      : "";
  return (
    `${u.inputTokens.toLocaleString("en-US")} input · ${u.outputTokens.toLocaleString("en-US")} ` +
    `output · ${cache.toLocaleString("en-US")} cached context re-reads${cost}`
  );
}
