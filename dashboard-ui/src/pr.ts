// PR identity on the client: a PR is (repo, number). parsePrRef() turns whatever a user typed or
// pasted — a bare number, "#123", "owner/name#123", or a full GitHub PR URL — into a PrRef,
// resolving the repo from the configured list when the input carries none. Shared by the Queue
// paste box, the QA form and the command palette so all three parse the same way.

export interface PrRef {
  repo: string; // owner/name; "" when the input had no repo and several are configured
  num: string;
}

const URL_RE = /github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/;
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
