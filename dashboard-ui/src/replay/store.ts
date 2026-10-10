// The in-memory server behind the replay: answers the handful of /api routes the PR page and
// its parts call, from one fixture. It never writes anywhere. A post is recorded in memory and
// announced on the window so PostPreview can show what would have reached GitHub.
import type { BannerResult, Finding } from "../api";
import { bump } from "./events";
import { meData, prData, queueData } from "./map";
import type { ReplayFixture } from "./types";

export interface PostedComment {
  i: number;
  path: string;
  line: number | string;
  severity: string;
  title: string;
  body: string;
  suggestion: string;
  anchorable: boolean | null | undefined;
}

export interface WouldPost {
  event: "COMMENT" | "REQUEST_CHANGES";
  requestChanges: boolean;
  comments: PostedComment[];
  summary: string;
  login: string;
  repo: string;
  pr: string;
}

export const POSTED_EVENT = "rs-replay:posted";

export interface Reply {
  status: number;
  json: unknown;
}

const json = (status: number, body: unknown): Reply => ({ status, json: body });

const NOT_HERE =
  "This is a precomputed example — nothing runs or posts from this page. " +
  "Install ReviewStage to do this on your own PR.";

export class ReplayStore {
  readonly posts: WouldPost[] = [];
  private readonly pr;
  private readonly me;
  private readonly queue;

  constructor(readonly fixture: ReplayFixture) {
    this.pr = prData(fixture);
    this.me = meData(fixture);
    this.queue = queueData(fixture);
  }

  /** `path` is the part after `/api`, query string included. */
  handle(method: string, path: string, body: unknown): Reply {
    const url = new URL(path, "http://replay.local");
    const route = url.pathname.replace(/\/$/, "") || "/";
    const q = url.searchParams;
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    if (method === "GET") {
      switch (route) {
        case "/me":
          return json(200, this.me);
        case "/pr": {
          if (q.get("pr") && q.get("pr") !== this.fixture.pr) return json(404, { error: `#${q.get("pr")} is not part of this example.` });
          if (q.get("repo") && q.get("repo") !== this.fixture.repo) return json(404, { error: `${q.get("repo")} is not part of this example.` });
          return json(200, this.pr);
        }
        case "/queue":
          return json(200, this.queue);
        case "/stack":
          return json(200, { repo: this.fixture.repo, pr: this.fixture.pr, isStack: false, connected: false, levels: [], stack: [] });
        case "/public-url":
          return json(200, { url: "", runtime: false });
        default:
          return json(404, { error: `${route} is not part of this example.` });
      }
    }
    switch (route) {
      case "/post":
        return json(200, this.post(b));
      case "/explain": {
        const idx = String(b.idx ?? "");
        const md = this.fixture.explain[idx];
        return md ? json(200, { md }) : json(404, { error: "No explanation stored for this finding." });
      }
      case "/tour-seen":
        return json(200, { ok: true, tour_seen: true });
      case "/logout":
        return json(200, { ok: true });
      case "/teach":
        return json(501, { error: NOT_HERE });
      case "/review":
      case "/stop":
      case "/approve":
      case "/markdone":
      case "/archive":
      case "/qa/gen":
        return json(400, { error: NOT_HERE });
      default:
        return json(404, { error: `${route} is not part of this example.` });
    }
  }

  private post(b: Record<string, unknown>): BannerResult {
    const findings = this.pr.review?.findings ?? [];
    const selected = new Set((Array.isArray(b.selected) ? b.selected : []).map((x) => Number(x)));
    const bodies = (b.bodies && typeof b.bodies === "object" ? b.bodies : {}) as Record<string, string>;
    const requestChanges = b.request_changes === true;
    const comments: PostedComment[] = findings
      .filter((f: Finding) => selected.has(f.i))
      .map((f: Finding) => ({
        i: f.i,
        path: f.path,
        line: f.line,
        severity: f.severity,
        title: f.title,
        body: bodies[String(f.i)] ?? f.body,
        suggestion: f.suggestion,
        anchorable: f.anchorable,
      }));
    const would: WouldPost = {
      event: requestChanges ? "REQUEST_CHANGES" : "COMMENT",
      requestChanges,
      comments,
      summary: this.pr.review?.summary ?? "",
      login: this.fixture.me.login,
      repo: this.fixture.repo,
      pr: this.fixture.pr,
    };
    this.posts.push(would);
    bump("replay_completed");
    try {
      window.dispatchEvent(new CustomEvent(POSTED_EVENT, { detail: would }));
    } catch {
      /* no window */
    }
    const n = comments.length;
    return {
      bannerHtml:
        "<div class='banner warn'><span>🧪</span><div><b>Dry run — nothing was sent.</b> " +
        `This is a precomputed example: on your own PR, ${n} comment${n === 1 ? "" : "s"} would ` +
        `have posted to GitHub as you just now.</div></div>`,
    };
  }
}
