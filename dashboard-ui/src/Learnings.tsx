import { useEffect, useState } from "react";
import { api, errMessage, type LearningsData, type Me } from "./api";
import { PageHead } from "./About";
import { Banner } from "./ui";
import { Icon } from "./icons";
import { Status, wordOf, type Tone } from "./ui";

// The outcome of a decision, in the shared colour vocabulary: kept was posted (green), reworded
// was posted after a change (amber), dropped is a neutral outcome — noise the reviewer declined,
// not a failure — so it is graphite, never red. The server still sends `kind: "blocker"` for a
// drop; the label is what carries the meaning here.
const OUTCOME_TONE: Record<string, Tone> = { dropped: "graphite", reworded: "amber", kept: "green" };
const outcomeTone = (label: string): Tone => OUTCOME_TONE[label] ?? "graphite";

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
  const multi = d.repos.length > 1;

  const about = (
    <>
      <p>
        Every finding you drop as noise or reword before posting is remembered and weighed on the
        next review, same-repository decisions first, then the team's general preferences. A
        complaint rejected often enough is a <b>rolling preference</b>
        {win ? (
          <>
            {" "}
            that survives while it stays inside the window read before a review, the most recent{" "}
            <b>{win.dropped} drops</b> and <b>{win.edited} rewordings</b>
          </>
        ) : null}
        ; promote it on the Skills page and it becomes a Team rule for good.
      </p>
      <p data-testid="retention-note">
        {d.findingsCap
          ? `The decision log keeps only the most recent ${d.findingsCap.toLocaleString(
              "en-US",
            )} decisions; the totals are counted separately and never truncated. `
          : ""}
        One log for the whole install: every repository, every reviewer. These are preferences,
        not hard rules: a genuine higher-severity issue is still raised even if it resembles a
        past drop.
      </p>
    </>
  );

  return (
    <>
      <PageHead title={<>What {me.brand} has learned</>} about={about} aboutTestId="learnings-about" />
      <div className="stats">
        <div className="stat">
          <div className="k">{d.counts.dropped.toLocaleString("en-US")}</div>
          <div className="l">Dropped as noise</div>
        </div>
        <div className="stat">
          <div className="k">{d.counts.edited.toLocaleString("en-US")}</div>
          <div className="l">Reworded</div>
        </div>
        <div className="stat">
          <div className="k">{d.counts.kept.toLocaleString("en-US")}</div>
          <div className="l">Kept as-is</div>
        </div>
        <div className="stat">
          <div className="k">{d.promoted.toLocaleString("en-US")}</div>
          <div className="l">Promoted to rules</div>
        </div>
        {dry > 0 && (
          <div className="stat" data-testid="dry-count">
            <div className="k">{dry.toLocaleString("en-US")}</div>
            <div className="l">Made in dry run</div>
          </div>
        )}
      </div>
      {dry > 0 && (
        <Banner kind="info" icon="flask" data-testid="dry-banner">
            <b>
              {dry.toLocaleString("en-US")} of these decisions were made while <code>DRY_RUN=1</code>.
            </b>{" "}
            Nothing was posted to GitHub, so they are in none of the keep rates here or on
            Insights — but {me.brand} still reads them before every review, so they teach the
            reviewer exactly as a live decision does. They are marked <b>dry run</b> below.
          </Banner>
      )}

      {d.clusters.length > 0 && (
        <>
          <h2>Hardening into a rule</h2>
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
          <div className="list ltable" data-testid="learning-rows">
            <table>
              <thead>
                <tr>
                  <th scope="col">Decision</th>
                  <th scope="col">Finding</th>
                  {multi && <th scope="col">Repository</th>}
                  <th scope="col">Path</th>
                  <th scope="col">Severity</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r, i) => (
                  <tr key={i} data-testid={r.dry ? "dry-row" : undefined}>
                    <td>
                      <div className="lcell">
                        <Status tone={outcomeTone(r.label || r.kind)}>{wordOf(r.label || r.kind)}</Status>
                        {r.dry && (
                          <Status
                            tone="graphite"
                            data-testid="dry-mark"
                            title="Decided while DRY_RUN=1 — never posted to GitHub, and in no rate. It still teaches the reviewer."
                          >
                            Dry run
                          </Status>
                        )}
                      </div>
                    </td>
                    <td className="lgist">
                      {r.gist}
                      {r.editedGist && <div className="sub">Reworded to: {r.editedGist}</div>}
                    </td>
                    {multi && (
                      <td>
                        <span className="repochip">{r.repo}</span>
                      </td>
                    )}
                    <td>
                      <span className="loc">{r.loc}</span>
                    </td>
                    <td>
                      <Status kind={r.severity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
