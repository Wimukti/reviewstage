// Typed client for ReviewStage's JSON API (/api/*). Same-origin, so the session cookie rides
// along automatically. Read endpoints hand back the signed exp/sig tokens for the actions
// available on a resource; POST endpoints pass those back (mirrors the old HTML forms).

const BASE = "/api";

export class Unauthorized extends Error {}

// A non-2xx reply. `data` is the server's JSON body — e.g. an "ambiguous repo" error carries the
// candidate `repos` so the UI can offer a picker.
export class ApiError extends Error {
  data: Record<string, unknown>;
  constructor(msg: string, data: Record<string, unknown>) {
    super(msg);
    this.data = data;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "same-origin", ...init });
  if (r.status === 401) throw new Unauthorized();
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new ApiError(data?.error || `${path} → ${r.status}`, data as Record<string, unknown>);
  return data as T;
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
  public_url?: string;
  logo?: string;
  webhooks_configured?: boolean; // GITHUB_WEBHOOK_SECRET is set on the server
  auth?: "cookie" | "bearer"; // how this request was authenticated
  login_via?: "oauth" | "pat"; // how the stored GitHub token was obtained
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
  tabs: QueueTab[];
  stats: Record<string, number>;
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
  approve?: { lgtm: boolean; blockers: number; defaultMsg: string };
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
  cacheCreationTokens: number;
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

export interface QaGuide { repo: string; num: string; title: string; when: string }
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
export interface DepthInfo { name: string; meta: string; content: string; edited: boolean }
export interface SkillsData {
  token: Token;
  user: string;
  choice: "own" | "team";
  effLabel: string;
  hasMySkill: boolean;
  hasGlobal: boolean;
  teamSkill: string;
  mySkill: string;
  depths: Record<string, DepthInfo>;
  repoSkills: RepoSkill[];
  stats: SkillStat[];
  teamHistory: { hash: string; author: string; at: number; msg: string }[];
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
export interface LearningsData {
  counts: { dropped: number; edited: number; kept: number };
  repos: string[];
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
  failed?: string;
  stopped?: boolean;
  bannerHtml?: string;
  started?: boolean;
  confirmed?: boolean;
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
export interface RollupData {
  generatedAt: number;
  repo: string; // the filter applied, or ""
  repos: RepoRollup[];
  reviews: { total: number; week: number };
  prs: number;
  reviewers: { login: string; runs: number; week: number; tokens: number }[];
  tokens: { total: number; week: number };
  keep: {
    allTime: { kept: number; edited: number; dropped: number; rate: number | null };
    criticalPath?: { kept: number; edited: number; dropped: number; rate: number | null };
  };
  severity: { blocker: number; "should-fix": number; nit: number; question: number };
  models: { model: string; runs: number; tokens: number }[];
  agreement: { multiReviewerPRs: number; confirmedFindings: number; avgRate: number | null };
  cycle: { medianReviewToPostSec: number | null; n: number };
  series: RollupSeriesPoint[];
}

export const api = {
  rollup: (repo = "") => get<RollupData>(`/rollup${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`),
  me: () => get<Me>("/me"),
  queue: (tab: string, sort: string) =>
    get<QueueData>(`/queue?tab=${encodeURIComponent(tab)}&sort=${encodeURIComponent(sort)}`),
  login: (pat: string) => post<{ ok: boolean; login: string }>("/login", { pat }),
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
    payload: { selected: number[]; bodies: Record<number, string>; suggs: Record<number, string>; request_changes: boolean }
  ) => post<BannerResult>("/post", { ...prBody(ref), ...t, ...payload }),
  approve: (ref: PrRef, t: Token, body: string, ack: boolean) =>
    post<BannerResult>("/approve", { ...prBody(ref), ...t, body, ack }),
  qaIndex: () => get<QaIndex>("/qa"),
  qaDetail: (ref: PrRef) => get<QaDetail>(`/qa?${prq(ref)}`),
  qaGen: (ref: PrRef, t: Token) => post<{ ok: boolean }>("/qa/gen", { ...prBody(ref), ...t }),
  qaStop: (ref: PrRef, t: Token) => post<{ ok: boolean }>("/qa/stop", { ...prBody(ref), ...t }),
  skills: () => get<SkillsData>("/skills"),
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
  stack: (ref: PrRef) => get<StackData>(`/stack?${prq(ref)}`),
  stackRun: (ref: PrRef, t: Token, effort: string, nums: string[]) =>
    post<{ ok: boolean; started: number }>("/stack/run", { ...prBody(ref), ...t, effort, nums }),
  how: () => get<HowData>("/how"),
  profile: (repo: string) => get<ProfileData>(`/profile?repo=${encodeURIComponent(repo)}`),
  profileRun: (repo: string, t: Token) => post<ProfileData>("/profile/run", { repo, ...t }),
  profileStop: (repo: string, t: Token) => post<ProfileData>("/profile/stop", { repo, ...t }),
  saveProfile: (repo: string, t: Token, md: string) => put<ProfileData>("/profile", { repo, ...t, md }),
  setAutoProfile: (repo: string, t: Token, on: boolean) =>
    put<ProfileData>("/profile", { repo, ...t, auto_profile: on }),
};
