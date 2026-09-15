// Typed client for ReviewStage's JSON API (/api/*). Same-origin, so the session cookie rides
// along automatically. Read endpoints hand back the signed exp/sig tokens for the actions
// available on a resource; POST endpoints pass those back (mirrors the old HTML forms).

const BASE = "/api";

export class Unauthorized extends Error {}

// A non-2xx reply. `data` is the server's JSON body — e.g. an "ambiguous repo" error carries the
// candidate `repos` so the UI can offer a picker. `status` is the HTTP status, so callers can
// tell an expired action token (403) from a refusal the reviewer has to act on.
export class ApiError extends Error {
  data: Record<string, unknown>;
  status: number;
  constructor(msg: string, data: Record<string, unknown>, status = 0) {
    super(msg);
    this.data = data;
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "same-origin", ...init });
  if (r.status === 401) throw new Unauthorized();
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok)
    throw new ApiError(data?.error || `${path} → ${r.status}`, data as Record<string, unknown>, r.status);
  return data as T;
}

// ---- error helpers ------------------------------------------------------------------------
// Every submit handler in the app shares these: a rejection has to reach the reviewer as words,
// never as a button stuck on "Starting…".

export function errMessage(e: unknown, fallback = "That didn't work — try again."): string {
  if (e instanceof Unauthorized)
    return "Your session has expired — reload the page and sign in again.";
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The banner markup the server would have sent, for pages that render bannerHtml.
export function errBanner(e: unknown, fallback?: string): string {
  return `<div class="banner err"><span>🚫</span><div>${escapeHtml(errMessage(e, fallback))}</div></div>`;
}

// Action tokens live 30 minutes; /api/pr mints fresh ones. A 403 whose message says the link
// expired (or was signed with another key) is recoverable by re-reading the page's tokens.
export function isExpiredToken(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 403 &&
    /has expired|signed with a different key|unsigned link/i.test(e.message)
  );
}

// A PR is (repo, number). `repo` may be "" for legacy links; the server resolves it when
// exactly one repository is configured.
export interface PrRef {
  repo: string;
  num: string;
}
const prq = (ref: PrRef) =>
  `${ref.repo ? `repo=${encodeURIComponent(ref.repo)}&` : ""}pr=${encodeURIComponent(ref.num)}`;
const prBody = (ref: PrRef) => ({ repo: ref.repo, pr: ref.num });

export function get<T>(path: string): Promise<T> {
  return req<T>(path);
}

export function post<T>(path: string, body: unknown = {}): Promise<T> {
  return req<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function put<T>(path: string, body: unknown = {}): Promise<T> {
  return req<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- shapes -------------------------------------------------------------------------------

// One review or QA guide this user has in flight right now (see running.ts).
export interface RunningJob {
  kind: "review" | "qa";
  repo: string;
  num: string;
  title: string;
  status: string; // "reviewing the diff", "queued", …
  href: string; // the page that shows its progress
}

export interface Me {
  authed: boolean;
  login?: string;
  name?: string;
  slack_id?: string;
  claude_connected?: boolean;
  active_skill?: "own" | "team";
  skill_label?: string;
  is_admin?: boolean;
  dry_run: boolean;
  repo: string; // the one configured repo, or "" when several are
  repos: string[]; // every repo this install reviews (configured + org-discovered)
  allowOrg: string;
  brand: string;
  oauth: boolean;
  oauth_blocked?: boolean; // GitHub sign-in worked but the org has not approved the app yet
  device_flow?: boolean; // "Sign in with GitHub" via device flow (shared public client ID)
  public_url?: string;
  logo?: string;
  webhooks_configured?: boolean; // GITHUB_WEBHOOK_SECRET is set on the server
  // Whether the PR poller has ever completed a cycle on this install. Absent on servers that do
  // not report it yet — the Queue treats "absent" as "cannot tell" and says nothing.
  poller_ran?: boolean;
  // Whether this person has already been shown the guided tour. Server-side (per user), not
  // per browser. Absent on older servers — the shell then falls back to not showing it twice
  // in one session rather than re-running it on every machine.
  tour_seen?: boolean;
  running?: RunningJob[]; // reviews / QA guides in flight for this user
  auth?: "cookie" | "bearer"; // how this request was authenticated
  login_via?: "oauth" | "pat"; // how the stored GitHub token was obtained
}

// GitHub device flow (Login). The server keeps GitHub's device_code; the browser gets only
// the code the person types at github.com/login/device and an opaque session to poll with.
export interface DeviceStart {
  session: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number; // seconds between polls
}
export interface DevicePoll {
  status: "pending" | "ok" | "expired" | "denied" | "error";
  interval?: number; // pending: GitHub asked us to slow down to this many seconds
  retry_after?: number; // pending (429): we polled too early
  login?: string; // ok
  welcome?: boolean; // ok: this login had no user record before — a first-ever sign-in
  error?: string; // error
}

// Settings → Devices (docs/MOBILE.md). Never carries the token or its hash.
export interface Device {
  id: string;
  name: string;
  created: number;
  last_seen: number;
  current: boolean; // the device whose bearer token made this request
}
export interface DevicesData {
  devices: Device[];
  max: number;
  ttl_days: number;
}
export interface MintedDevice {
  token: string; // shown once; the server keeps only its hash
  id: string;
  name: string;
  created: number;
  warning?: string;
}

export interface Token {
  exp: string;
  sig: string;
}

export interface SevChip {
  kind: string;
  n: number;
  label: string;
}

export interface QueueRow {
  repo: string;
  num: string;
  title: string;
  author: string;
  state: string;
  size: string;
  when: string[];
  sev: SevChip[];
  archived: boolean;
  running: boolean; // a review of this PR is in flight for you right now
  status: string; // its progress phrase, when running
  // The PR's own state on GitHub ("open" | "closed" | "merged"), persisted when the closed
  // webhook arrived. Absent on servers that do not report it — the row then says nothing.
  prState?: string;
  merged?: boolean;
  canApprove?: boolean;
  archiveToken: Token;
}

export interface QueueTab {
  key: string;
  label: string;
  count: number;
}

export interface QueueData {
  tab: string;
  sort: string;
  // The filters the server applied. Echoed back so the page can tell "the server filtered this"
  // from "an older server ignored the parameters".
  repo?: string;
  q?: string;
  tabs: QueueTab[];
  stats: Record<string, number>;
  // Per-repo tab counts under the SAME filter — every tab and tile can be rendered from one
  // response. Absent on servers that do not compute it.
  repoCounts?: Record<string, Record<string, number>>;
  tabDesc: string;
  rows: QueueRow[];
  repos: string[];
  slackOk: boolean;
}

export interface Finding {
  i: number;
  severity: string;
  sevLabel: string;
  path: string;
  line: number | string;
  thread: string | null;
  body: string;
  suggestion: string;
  low: boolean;
  title: string;
  impact: string;
  structured: boolean;
  criticalPath?: string; // the profile glob this finding concerns, "" when none
  // Tri-state. true: GitHub will take an inline comment on this line. false: the line is
  // outside the PR's diff, so the finding goes into the review body instead. null/undefined:
  // GitHub would not answer, so where it lands is genuinely unknown — never claim either.
  anchorable?: boolean | null;
  // Whether the server pre-ticked this finding. It caps the pre-selection so one click cannot
  // attempt a review GitHub will reject whole; absent on older servers.
  preselect?: boolean;
  agreement?: { confirmed: boolean; n: number; by: string[]; differ: string } | null;
}

export interface ApprovedData {
  at: string;
  ago: string;
  manual: boolean;
  body: string;
  user: string;
}

export interface ReviewData {
  // Identifies the exact run these findings came from, so a post cannot be applied to a review
  // that has since been replaced from another device. Absent on servers that do not send one —
  // the client then falls back to a fingerprint it computes from the findings themselves.
  reviewKey?: string;
  event: string;
  summary: string;
  keyPoints: string[];
  explainer: string;
  analysis: string;
  chips: SevChip[];
  findings: Finding[];
  count: number;
  posted: boolean;
  postLabel: string;
  reused?: boolean;
  convergence?: { rate: number | null; confirmed: number; total: number; nRuns: number } | null;
  // Findings past the render cap were not sent at all — the page must say so rather than
  // present a truncated list as the whole review.
  truncated?: { shown: number; total: number };
  // More findings were worth pre-ticking than one review should carry.
  preselectCapped?: { selected: number; eligible: number; max: number; note: string };
  maxPerPost?: number;
  // The anchor check could not run (or only partly ran): where the findings land is unknown,
  // which is NOT the same as knowing they fall outside the diff.
  anchorsUnknown?: boolean;
  anchorError?: string;
  approve?: {
    lgtm: boolean;
    blockers: number;
    defaultMsg: string;
    // The commit this verdict was written against, and where the branch is now. Sent back with
    // the approval so approving head B while reading head A's "LGTM" is caught server-side.
    reviewedHead?: string;
    currentHead?: string;
  };
  approved?: ApprovedData;
}

export interface Reviewer { login: string; state: string }
export interface ReviewersData { reviewers: Reviewer[]; decision: string | null }
export interface TimelineStep { label: string; done: boolean; note: string }
export interface EffortLevel { key: string; name: string; sub: string }
export interface OtherRun {
  login: string;
  effort: string;
  effortKey: string;
  focus: string;
  model: string;
  skill: string;
  skillKey: string;
  when: string;
}
// How long a level tends to take: a static range until this install has ≥3 runs at it, then
// the median of those runs ("typically ~N min here").
export interface EffortEstimate {
  label: string;
  source: "static" | "measured";
  samples: number;
  medianMs?: number;
}
export interface RunFormData {
  suggested: string;
  levels: EffortLevel[];
  models: EffortLevel[];
  skillLabel: string;
  othersOnHead: OtherRun[];
  estimates?: Record<string, EffortEstimate>;
}
export interface Risk { icon: string; title: string; note: string }
export interface HistoryRun {
  ts: number;
  effort: string;
  focus: string;
  findings: number;
  event: string;
}

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  // The QA build's usage record does not carry this one — only the review's does.
  cacheCreationTokens?: number;
  realTokens: number;
  costUsd: number;
  durationMs?: number;
}

export interface PrData {
  historyView?: boolean;
  ts?: number;
  when?: string;
  repo: string;
  pr: string;
  title: string;
  state: string;
  ghUrl: string;
  author: string;
  size: string;
  dryRun: boolean;
  awaiting: boolean;
  runner: string;
  effortBadge: { label: string; hint: string } | null;
  usage?: Usage | null;
  focus: string;
  stale: boolean;
  risk: Risk[];
  // Whether this PR is part of a stack of open PRs, and how many are in it.
  stack?: { isStack: boolean; size: number };
  timeline: TimelineStep[];
  reviewers: ReviewersData | null;
  claudeConnected: boolean;
  runForm: RunFormData;
  tokens: Record<string, Token>;
  reviewing?: {
    phases: string[];
    cur: number;
    queued: boolean;
    effortLabel: string;
    effortHint: string;
    focus: string;
  };
  stopped?: { halted: boolean };
  stalled?: { was: string; tail: string; pidAlive?: boolean };
  notReviewed?: boolean;
  failed?: string;
  approved?: ApprovedData;
  review?: ReviewData;
  showMarkDone?: boolean;
  history: HistoryRun[];
  // history view only
  summary?: string;
  findings?: { severity: string; sevLabel: string; path: string; line: number | string; body: string }[];
}

export interface BannerResult {
  bannerHtml: string;
}

export interface QaGuide {
  repo: string;
  num: string;
  title: string;
  when: string;
  running?: boolean;
  status?: string;
}
export interface QaIndex { repos: string[]; guides: QaGuide[] }
export interface QaDetail {
  repo: string;
  pr: string;
  title: string;
  ghUrl: string;
  state: string;
  connected: boolean;
  genToken: Token;
  stopToken?: Token;
  md?: string;
  failed?: string;
  stopped?: boolean;
  // A failed or stopped run NEVER hides a guide already on disk: the state stays "done" and
  // these say what went wrong with the last attempt.
  lastRunFailed?: boolean;
  lastRunStopped?: boolean;
  logTail?: string[];
  usage?: Usage | null;
  running?: { phases: string[]; cur: number; queued: boolean };
}

export interface SkillStat {
  skill: string;
  kept: number;
  edited: number;
  dropped: number;
  total: number;
  rate: number;
  label: string;
}
export interface RepoSkill { repo: string; content: string; has: boolean }

// One complaint the team keeps dropping, offered as a rule nobody has accepted yet.
export interface SuggestionFinding {
  repo: string;
  pr: string;
  path: string;
  line: number | null;
  severity: string;
  at: number;
  gist: string;
}
export interface RuleSuggestion {
  signature: string;
  outcome: "dropped" | "edited";
  severity: string;
  dir: string;
  count: number;
  prs: number;
  repos: string[];
  gist: string;
  findings: SuggestionFinding[];
  target: string; // "team" | "repo:<owner/name>"
  targetLabel: string;
  rule: string;
  rationale: string;
  dismissed: boolean;
  dismissedBy: string;
  connected: boolean;
  pending?: boolean;
  // Drafting is no longer automatic: it spends the acting user's Claude quota, so it happens on
  // a click. `needsDraft` means there is no sentence yet, `drafting` that a draft is in flight
  // on the server right now, and `draftError` the remembered reason the last attempt failed.
  needsDraft?: boolean;
  drafting?: boolean;
  draftError?: string;
}
export interface DepthInfo { name: string; meta: string; content: string; edited: boolean }
export interface SkillsData {
  token: Token;
  user: string;
  choice: "own" | "team";
  effLabel: string;
  hasMySkill: boolean;
  hasGlobal: boolean; // the team skill file exists — bootstrap seeds it, so this is not "edited"
  // True only when the team skill differs from the shipped one. Absent on servers that do not
  // compute it; the UI then says "In use" rather than guessing "Edited".
  globalEdited?: boolean;
  // Whether the shipped skill is on this box at all — without it "Restore built-in" has
  // nothing to restore and globalEdited cannot be computed.
  builtinAvailable?: boolean;
  teamSkill: string;
  mySkill: string;
  depths: Record<string, DepthInfo>;
  repoSkills: RepoSkill[];
  stats: SkillStat[];
  teamHistory: { hash: string; author: string; at: number; msg: string }[];
  suggestions: RuleSuggestion[];
  suggestMin: number;
}


export interface NotifyEnv {
  slack_webhook: boolean;
  slack_bot: boolean;
  discord_webhook: boolean;
  webhook_url: boolean;
  webhook_secret: boolean;
}

export interface IntegrationsData {
  token: Token;
  github: { login: string; via?: "oauth" | "pat" };
  slack: { id: string };
  discord: { id: string };
  claude: { connected: boolean; authUrl: string };
  notify: { env: NotifyEnv; backends: string[]; payloadSchema: Record<string, unknown> };
  oauth: boolean;
  brand: string;
}

// Runtime settings ($ROOT/settings.json): settings.json > .env > default.
export type NotifyBackend = "slack" | "discord" | "generic" | "none";
export interface RuntimeSettings {
  poller_enabled: boolean;
  poll_interval_seconds: number;
  notify_backends: NotifyBackend[];
  max_pr_age_days: number;
  skip_bot_prs: boolean;
}
export type SettingSource = "settings" | "env" | "default";
// $ROOT/webhooks.json + derived fields; the secret itself is never sent.
export interface WebhooksStatus {
  configured: boolean; // GITHUB_WEBHOOK_SECRET set
  active: boolean; // a verified event within 2 × poll interval
  url: string; // PUBLIC_URL + /webhooks/github — the GitHub payload URL
  last_event_at: number | null;
  last_event: string;
  last_ping: number | null;
  count: number;
  last_error: string;
}
export interface SettingsData {
  token: Token;
  settings: RuntimeSettings;
  sources: Record<keyof RuntimeSettings, SettingSource>;
  saved: Partial<RuntimeSettings>;
  env: NotifyEnv;
  is_admin: boolean;
  admin: string;
  poller: { lastPoll: number | null; envInterval: string };
  limits: { intervalMin: number; intervalMax: number };
  backends: NotifyBackend[];
  dry_run: boolean;
  webhooks: WebhooksStatus;
  bannerHtml?: string;
}

export interface LearningRow {
  kind: string;
  label: string;
  loc: string;
  severity: string;
  gist: string;
  repo: string;
  editedGist: string;
}
export interface LearningCluster {
  signature: string;
  gist: string;
  severity: string;
  count: number;
  prs: number;
  outcome: "dropped" | "edited";
  status: "promoted" | "dismissed" | "rolling";
  rule: string;
}
export interface LearningsData {
  // How many of each outcome a review actually reads back (rs_learn caps them separately).
  // Absent on servers that do not report it — the UI then uses the shipped defaults.
  windows?: { dropped: number; edited: number };
  counts: { dropped: number; edited: number; kept: number };
  // The cap on the detail log the recent rows come from (the counts above are uncapped).
  findingsCap?: number;
  repos: string[];
  clusters: LearningCluster[];
  promoted: number;
  rows: LearningRow[];
}

// Repository profile ($ROOT/profiles/<slug>/): the critical paths every review of the repo walks.
export interface ProfileCounts { critical: number; risk: number; rules: number; doNotFlag: number }
export interface ProfileUsage {
  model: string;
  tokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
}
export interface ProfileLast {
  at: number;
  when: string;
  model: string;
  usage: ProfileUsage | null;
  dropped: string[];
  runner: string;
  editedAt: number | null;
  editedBy: string;
  head: string;
}
export interface ProfileCriticalPath { path_glob: string; why: string; checks: string[] }
// How far the saved profile has drifted from the base clone. Null when there is no clone on the
// box, so nothing could be compared — never rendered as "fresh".
export interface ProfileStale {
  head: string;
  currentHead: string;
  stale: boolean;
  commitsBehind: number | null;
  unmatchedPaths: number;
  criticalPaths: number;
}
// Per-section entry counts, keyed as the profile stores them.
export type ProfileSections = Partial<Record<
  "critical_paths" | "risk_paths" | "review_rules" | "do_not_flag" | "summary", number>>;
export interface ProfileJson {
  summary: string;
  critical_paths: ProfileCriticalPath[];
  risk_paths: { label: string; pattern: string }[];
  review_rules: string[];
  do_not_flag: string[];
  meta?: Record<string, unknown>;
}
export interface ProfileData {
  repo: string;
  state: "none" | "running" | "failed" | "stopped" | "done";
  token: Token;
  connected: boolean;
  isAdmin: boolean;
  autoProfile: boolean;
  counts: ProfileCounts | null;
  versions: number[];
  md: string;
  json: ProfileJson | null;
  last: ProfileLast | null;
  running?: { phases: string[]; cur: number; queued: boolean; text: string };
  failed?: string; // the "failed: …" status line of the last run (also set when an older profile survives it)
  logTail?: string[]; // last lines of agent.log (or run.log) for that failed run
  stopped?: boolean;
  bannerHtml?: string;
  started?: boolean; // POST /profile/run: false with state "running" means "already running", not a failure
  reason?: string; // why started is false, e.g. "already running"
  confirmed?: boolean;
  // How far this profile has drifted from the checkout; null/absent when nothing could be
  // compared (no base clone).
  stale?: ProfileStale | null;
  // Whether path validation can run at all here. false means an edit is saved unchecked.
  canValidate?: boolean;
  sections?: ProfileSections | null;
  // A profile.json on disk that failed its shape check: the reason, so it can be fixed.
  invalid?: string;
  // GET ?version=<ts> — an earlier profile, read-only until restored.
  versionView?: boolean;
  ts?: number;
  // PUT /profile answers: what the save actually did.
  unknownHeadings?: string[];
  dropped?: string[];
  validated?: boolean;
  capped?: number;
  needsConfirm?: boolean;
}

export interface StackItem {
  num: string;
  title: string;
  base: string;
  head: string;
  state: string;
}
export interface StackData {
  repo: string;
  pr: string;
  isStack: boolean;
  connected: boolean;
  runToken: Token;
  levels: EffortLevel[];
  stack: StackItem[];
}

export interface HowData {
  images: Record<string, string>;
  brand: string;
  reviewer: string;
  tabs: { key: string; label: string; desc: string }[];
}

export interface RollupSeriesPoint {
  ts: number;
  date: string;
  reviews: number;
  tokens: number;
  kept: number;
  edited: number;
  dropped: number;
}
export interface RepoRollup { repo: string; runs: number; week: number; prs: number; tokens: number }
// One keep bucket. `rate`/`verbatimRate` are kept-verbatim; `keepRate` is the product's single
// keep rate (kept or reworded). `ratable` says whether the sample supports a percentage at all,
// and `minSample` is the server's floor — never hardcode one beside it.
export interface KeepBlock {
  kept: number;
  edited: number;
  dropped: number;
  rate: number | null;
  verbatimRate?: number | null;
  keepRate?: number | null;
  decided?: number;
  keptOrEdited?: number;
  ratable?: boolean;
  minSample?: number;
}
export interface RollupData {
  // How many finding decisions the keep/severity/agreement numbers were computed over, and the
  // cap on the log they come from. Absent on servers that do not report it.
  findingsCap?: number;
  generatedAt: number;
  repo: string; // the filter applied, or ""
  repos: RepoRollup[];
  reviews: { total: number; week: number };
  prs: number;
  reviewers: { login: string; runs: number; week: number; tokens: number }[];
  tokens: { total: number; week: number };
  keep: { allTime: KeepBlock; criticalPath?: KeepBlock };
  severity: { blocker: number; "should-fix": number; nit: number; question: number };
  models: { model: string; runs: number; tokens: number }[];
  agreement: {
    multiReviewerPRs: number;
    confirmedFindings: number;
    avgRate: number | null;
    // Pooled, not an unweighted mean of per-PR rates: confirmed and total are summed across
    // every reviewed head. Absent on servers still computing the old mean.
    pooled?: boolean;
    heads?: number;
    totalFindings?: number;
  };
  promotedRules: number;
  cycle: {
    medianReviewToPostSec: number | null;
    n: number;
    // What the median actually measures, in the server's own words, plus how many posted
    // reviews fell outside the population (no review request to measure from).
    measures?: string;
    label?: string;
    posts?: number;
    measured?: number;
    excluded?: number;
  };
  series: RollupSeriesPoint[];
}

export const api = {
  rollup: (repo = "") => get<RollupData>(`/rollup${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`),
  me: () => get<Me>("/me"),
  // `repo` and `q` filter EVERY tab, tile and count on the server — the client no longer
  // filters rows it was handed, because it only ever receives the open tab's.
  queue: (tab: string, sort: string, repo = "", q = "") =>
    get<QueueData>(
      `/queue?tab=${encodeURIComponent(tab)}&sort=${encodeURIComponent(sort)}` +
        (repo ? `&repo=${encodeURIComponent(repo)}` : "") +
        (q ? `&q=${encodeURIComponent(q)}` : ""),
    ),
  login: (pat: string) => post<{ ok: boolean; login: string }>("/login", { pat }),
  deviceStart: () => post<DeviceStart>("/auth/device/start"),
  // Hand the pending slot back when the person cancels, rather than parking it until GitHub's
  // 15-minute code expiry. Best effort by nature — the caller may ignore a rejection.
  deviceCancel: (session: string) => post<{ ok: boolean }>("/auth/device/cancel", { session }),
  // A 429 (polled faster than GitHub's interval) is a normal "pending" answer, not an error.
  devicePoll: async (session: string): Promise<DevicePoll> => {
    const r = await fetch(`${BASE}/auth/device/poll`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session }),
    });
    const data = (await r.json().catch(() => ({}))) as DevicePoll & { error?: string };
    if (r.status === 429) return { status: "pending", interval: data.retry_after };
    if (!r.ok) throw new ApiError(data?.error || `/auth/device/poll → ${r.status}`, data as unknown as Record<string, unknown>);
    return data;
  },
  logout: () => post<{ ok: boolean }>("/logout"),
  devices: () => get<DevicesData>("/devices"),
  mintDevice: (name: string) => post<MintedDevice>("/device-token", { name }),
  revokeDevice: (id: string) => post<{ ok: boolean; revoked: number }>("/devices/revoke", { id }),
  revokeAllDevices: () => post<{ ok: boolean; revoked: number }>("/devices/revoke", { all: true }),
  pr: (ref: PrRef, v?: string) => get<PrData>(`/pr?${prq(ref)}${v ? `&v=${v}` : ""}`),
  explain: (ref: PrRef, t: Token, idx: number) =>
    post<{ md: string }>("/explain", { ...prBody(ref), ...t, idx }),
  review: (ref: PrRef, t: Token, effort: string, focus: string, model: string) =>
    post<{ ok: boolean; started?: boolean }>("/review", { ...prBody(ref), ...t, effort, focus, model }),
  stop: (ref: PrRef, t: Token) =>
    post<{ ok: boolean; confirmed: boolean }>("/stop", { ...prBody(ref), ...t }),
  markdone: (ref: PrRef, t: Token) => post<{ ok: boolean }>("/markdone", { ...prBody(ref), ...t }),
  archive: (ref: PrRef, t: Token, action: "archive" | "unarchive") =>
    post<{ ok: boolean }>("/archive", { ...prBody(ref), ...t, action }),
  post: (
    ref: PrRef,
    t: Token,
    payload: {
      selected: number[];
      bodies: Record<number, string>;
      suggs: Record<number, string>;
      request_changes: boolean;
      // The review these indices belong to. The server matches findings by array index, so a
      // re-run from another device would otherwise silently re-point every comment.
      review_key: string;
    }
  ) => post<BannerResult>("/post", { ...prBody(ref), ...t, ...payload }),
  // `reviewedHead` is the commit the verdict on screen was written against. The server refuses
  // (or demands the confirmation) when the branch has moved since.
  approve: (ref: PrRef, t: Token, body: string, ack: boolean, reviewedHead = "") =>
    post<BannerResult>("/approve", {
      ...prBody(ref), ...t, body, ack, reviewed_head: reviewedHead,
    }),
  qaIndex: () => get<QaIndex>("/qa"),
  qaDetail: (ref: PrRef) => get<QaDetail>(`/qa?${prq(ref)}`),
  // `started` is false when nothing spawned (a run already holds the lock). Optional: older
  // servers always answered {ok:true}, and the UI must not claim a run began on that alone.
  qaGen: (ref: PrRef, t: Token) =>
    post<{ ok: boolean; started?: boolean; reason?: string }>("/qa/gen", { ...prBody(ref), ...t }),
  qaStop: (ref: PrRef, t: Token) => post<{ ok: boolean }>("/qa/stop", { ...prBody(ref), ...t }),
  skills: () => get<SkillsData>("/skills"),
  // `rule` carries the reviewer's edit of the drafted sentence; the server already prefers it
  // over its own draft. Omitted for dismiss/undismiss.
  // "draft" spends the acting user's Claude quota, so it only ever happens on a click.
  skillSuggestion: (
    t: Token,
    signature: string,
    action: "accept" | "dismiss" | "undismiss" | "draft",
    rule?: string,
  ) => post<SkillsData & BannerResult>("/skills/suggestion", { ...t, signature, action, rule }),
  skillAction: (step: string, payload: Record<string, unknown>) =>
    post<BannerResult>(`/skill/${step}`, payload),
  integrations: () => get<IntegrationsData>("/integrations"),
  saveSettings: (t: Token, fields: { slack_id?: string; discord_id?: string; pat?: string }) =>
    post<BannerResult>("/settings", { ...t, ...fields }),
  settings: () => get<SettingsData>("/settings"),
  saveRuntimeSettings: (t: Token, settings: Partial<RuntimeSettings>) =>
    put<SettingsData>("/settings", { ...t, settings }),
  claudeCode: (t: Token, code: string) =>
    post<BannerResult & { connected: boolean }>("/claude/code", { ...t, code }),
  claudeDisconnect: (t: Token) =>
    post<BannerResult & { connected: boolean }>("/claude/disconnect", { ...t }),
  claudeCancel: (t: Token) =>
    post<BannerResult & { connected: boolean }>("/claude/cancel", { ...t }),
  learnings: () => get<LearningsData>("/learnings"),
  // The tour's "seen" flag lives on the user record, not in this browser's localStorage.
  tourSeen: (seen = true) => post<{ ok: boolean; tour_seen: boolean }>("/tour-seen", { seen }),
  stack: (ref: PrRef) => get<StackData>(`/stack?${prq(ref)}`),
  stackRun: (ref: PrRef, t: Token, effort: string, nums: string[]) =>
    post<{ ok: boolean; started: number }>("/stack/run", { ...prBody(ref), ...t, effort, nums }),
  how: () => get<HowData>("/how"),
  profile: (repo: string) => get<ProfileData>(`/profile?repo=${encodeURIComponent(repo)}`),
  profileRun: (repo: string, t: Token) => post<ProfileData>("/profile/run", { repo, ...t }),
  profileStop: (repo: string, t: Token) => post<ProfileData>("/profile/stop", { repo, ...t }),
  saveProfile: (repo: string, t: Token, md: string, confirmEmpty = false) =>
    put<ProfileData>("/profile", { repo, ...t, md, confirm_empty: confirmEmpty }),
  // One of the earlier versions the page counts — readable, and restorable.
  profileVersion: (repo: string, ts: number) =>
    get<ProfileData>(`/profile?repo=${encodeURIComponent(repo)}&version=${ts}`),
  restoreProfile: (repo: string, t: Token, ts: number) =>
    put<ProfileData>("/profile", { repo, ...t, restore_version: String(ts) }),
  setAutoProfile: (repo: string, t: Token, on: boolean) =>
    put<ProfileData>("/profile", { repo, ...t, auto_profile: on }),
};
