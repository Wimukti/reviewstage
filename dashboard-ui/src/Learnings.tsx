import { useEffect, useState } from "react";
import { api, errMessage, type LearningsData, type Me } from "./api";
import { Banner } from "./ui";
import { Icon } from "./icons";
import { Status, wordOf } from "./ui";

export function Learnings({ me }: { me: Me }) {
  const [d, setD] = useState<LearningsData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api
      .learnings()
      .then(setD)
      .catch((e: unknown) => setErr(errMessage(e, "Couldn't load what has been learned.")));
  }, []);
  if (err)
    return (
      <Banner kind="err" data-testid="learnings-error">{err}</Banner>
    );
  if (!d) return <div className="muted">Loading…</div>;
  // How many rows of each outcome a review actually reads back. These are the server's numbers
  // and it states them to the reader — a copy of them here would silently go stale the day
  // rs_learn changed either one, which is exactly how the old "last 40 decisions" got there.
  const win = d.windows;
  // Decisions recorded while DRY_RUN=1. They are real judgements and they do shape the next
  // review, but nothing was posted, so no rate may be computed from them.
  const dry = d.counts.dry ?? 0;

  return (
    <>
      <h1>What {me.brand} has learned</h1>
      <p className="lead">
        Every time you drop a finding as noise or reword one before posting, {me.brand} remembers it
        and weighs it on the next review — same-repository decisions first, then the team's general
        preferences — so it stops repeating what you reject. This is that memory.
      </p>
      <div className="stats">
        <a className="stat hot">
          <div className="k">{d.counts.dropped.toLocaleString()}</div>
          <div className="l">Dropped as noise</div>
        </a>
        <a className="stat">
          <div className="k">{d.counts.edited.toLocaleString()}</div>
          <div className="l">Reworded</div>
        </a>
        <a className="stat">
          <div className="k">{d.counts.kept.toLocaleString()}</div>
          <div className="l">Kept as-is</div>
        </a>
        <a className="stat">
          <div className="k">{d.promoted.toLocaleString()}</div>
          <div className="l">Promoted to rules</div>
        </a>
        {dry > 0 && (
          <a className="stat" data-testid="dry-count">
            <div className="k">{dry.toLocaleString()}</div>
            <div className="l">Made in dry run</div>
          </a>
        )}
      </div>
      {dry > 0 && (
        <Banner kind="info" icon="flask" data-testid="dry-banner">
            <b>
              {dry.toLocaleString()} of these decisions were made while <code>DRY_RUN=1</code>.
            </b>{" "}
            Nothing was posted to GitHub, so they are in none of the keep rates here or on
            Insights — but {me.brand} still reads them before every review, so they teach the
            reviewer exactly as a live decision does. They are marked <b>dry run</b> below.
          </Banner>
      )}

      {d.clusters.length > 0 && (
        <>
          <h2>What is hardening into a rule</h2>
          <p className="muted sm">
            The same complaint, rejected again and again. While it is a <b>rolling preference</b> it
            survives only as long as it stays inside the window {me.brand} reads before a review
            {win ? (
              <>
                {" "}
                — the most recent <b>{win.dropped} drops</b> and <b>{win.edited} rewordings</b>,
                counted separately
              </>
            ) : null}
            . Once you promote it on the Skills page it becomes a Team rule and leaves that window
            for good.
          </p>
          <div className="list" data-testid="learning-clusters">
            {d.clusters.map((c) => (
              <div className="row" key={c.signature}>
                <div className="rowlink">
                  <div className="rowtop">
                    <Status kind={c.status === "promoted" ? "promoted" : c.status === "dismissed" ? "dismissed" : "preference"}>
                      {c.status === "promoted"
                        ? "Promoted to a rule"
                        : c.status === "dismissed"
                        ? "Dismissed"
                        : "Rolling preference"}
                    </Status>
                    <Status kind={c.severity} />
                    <span className="muted sm">
                      {c.count} {c.outcome === "dropped" ? "drops" : "rewordings"} across {c.prs} PRs
                    </span>
                  </div>
                  <div className="muted sm" style={{ marginTop: 5 }}>
                    {c.gist}
                  </div>
                  {c.rule && (
                    <div className="suggrule" style={{ marginTop: 6 }}>
                      {c.rule}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {d.rows.length === 0 ? (
        <div className="empty">
          <Icon name="bulb" />
          <b>Nothing learned yet</b>
          Post or drop a few findings and they'll show up here.
        </div>
      ) : (
        <>
          <h2>Recent decisions</h2>
          <div className="list">
            {d.rows.map((r, i) => (
              <div className="row" key={i}>
                <div className="rowlink">
                  <div className="rowtop">
                    <Status kind={r.kind}>{wordOf(r.label || r.kind)}</Status>
                    {r.repo && d.repos.length > 1 && <span className="repochip">{r.repo}</span>}
                    <span className="loc">{r.loc}</span>
                    <Status kind={r.severity} />
                    {r.dry && (
                      <Status
                        kind="dry"
                        data-testid="dry-row"
                        title="Decided while DRY_RUN=1 — never posted to GitHub, and in no rate. It still teaches the reviewer."
                      />
                    )}
                  </div>
                  <div className="muted sm" style={{ marginTop: 5 }}>
                    {r.gist}
                  </div>
                  {r.editedGist && (
                    <div className="muted sm" style={{ marginTop: 4 }}>
                      Reworded to: {r.editedGist}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="fine">
            {d.findingsCap
              ? `This list is the detail log, which keeps only the most recent ${d.findingsCap.toLocaleString(
                  "en-US",
                )} decisions — the totals above are counted separately and are never truncated. `
              : ""}
            One log for the whole install: every repository, every reviewer. {me.brand} weighs
            decisions from the repository under review first, but nothing here is scoped to a
            single repo. These are preferences, not hard rules — it still raises a genuine
            higher-severity issue even if it resembles a past drop.
          </p>
        </>
      )}
    </>
  );
}
