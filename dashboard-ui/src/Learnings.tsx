import { useEffect, useState } from "react";
import { ChevronDown, Info, Lightbulb } from "lucide-react";
import { api, errMessage, type LearningsData, type Me } from "./api";
import { Banner, EmptyState, PageHeader, RepoPill, StatusBadge, wordOf, type Tone } from "./ui";
import { useIsPhone } from "./theme";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";

// The outcome of a decision, in the shared colour vocabulary: kept was posted (green), reworded
// was posted after a change (amber), dropped is a neutral outcome — noise the reviewer declined,
// not a failure — so it is graphite, never red. The server still sends `kind: "blocker"` for a
// drop; the label is what carries the meaning here.
const OUTCOME_TONE: Record<string, Tone> = { dropped: "graphite", reworded: "amber", kept: "green" };
const outcomeTone = (label: string): Tone => OUTCOME_TONE[label] ?? "graphite";

const NOTE = "text-xs text-muted-foreground";
const H2 = "mb-2 mt-6 text-sm font-medium";
const TH = "h-10 whitespace-nowrap border-0 px-4 text-left font-medium";
const TD = "border-0 px-4 py-2.5 align-top";

// A stat tile: the same Card the Insights page uses, a number in display type and a label.
function Tile({ value, label, testId }: { value: number; label: string; testId?: string }) {
  return (
    <Card className="min-w-0 gap-1 rounded-lg px-3 py-3" data-testid={testId ?? "stat"}>
      <div className="truncate font-display text-2xl font-semibold leading-none tracking-tight tabular-nums">
        {value.toLocaleString("en-US")}
      </div>
      <div className={cn(NOTE, "leading-tight")}>{label}</div>
    </Card>
  );
}

function LearningsSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">Loading what has been learned</span>
      <div className="mb-6 grid grid-cols-4 gap-2 max-[599px]:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

export function Learnings({ me }: { me: Me }) {
  const phone = useIsPhone();
  const [d, setD] = useState<LearningsData | null>(null);
  const [err, setErr] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  useEffect(() => {
    api
      .learnings()
      .then(setD)
      .catch((e: unknown) => setErr(errMessage(e, "Couldn't load what has been learned.")));
  }, []);
  const title = <>What {me.brand} has learned</>;
  if (err)
    return (
      <>
        <PageHeader title={title} />
        <Banner kind="err" data-testid="learnings-error">{err}</Banner>
      </>
    );
  if (!d)
    return (
      <>
        <PageHeader title={title} />
        <LearningsSkeleton />
      </>
    );
  // How many rows of each outcome a review actually reads back. These are the server's numbers
  // and it states them to the reader — a copy of them here would silently go stale the day
  // rs_learn changed either one, which is exactly how the old "last 40 decisions" got there.
  const win = d.windows;
  // Decisions recorded while DRY_RUN=1. They are real judgements and they do shape the next
  // review, but nothing was posted, so no rate may be computed from them.
  const dry = d.counts.dry ?? 0;
  const multi = d.repos.length > 1;

  const about = (
    <div className="[&_p]:mt-0 [&_p:last-child]:mb-0">
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
    </div>
  );

  return (
    <>
      <PageHeader title={title} help={about} />
      <div className={cn("grid gap-2 max-[599px]:grid-cols-2", dry > 0 ? "grid-cols-5" : "grid-cols-4")} data-testid="stats">
        <Tile value={d.counts.dropped} label="Dropped as noise" />
        <Tile value={d.counts.edited} label="Reworded" />
        <Tile value={d.counts.kept} label="Kept as-is" />
        <Tile value={d.promoted} label="Promoted to rules" />
        {dry > 0 && <Tile value={dry} label="Made in dry run" testId="dry-count" />}
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
          <h2 className={H2}>Hardening into a rule</h2>
          <div className="flex flex-col gap-3" data-testid="learning-clusters">
            {d.clusters.map((c) => (
              <Card key={c.signature} className="gap-0 py-4">
                <CardContent className="flex flex-col gap-2 px-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge kind={c.status === "promoted" ? "promoted" : c.status === "dismissed" ? "dismissed" : "preference"}>
                      {c.status === "promoted"
                        ? "Promoted to a rule"
                        : c.status === "dismissed"
                          ? "Dismissed"
                          : "Rolling preference"}
                    </StatusBadge>
                    <StatusBadge kind={c.severity} />
                    <span className={NOTE}>
                      {c.count} {c.outcome === "dropped" ? "drops" : "rewordings"} across {c.prs} PRs
                    </span>
                  </div>
                  <p className="m-0 text-sm text-muted-foreground">{c.gist}</p>
                  {c.rule && (
                    <p className="m-0 border-l-2 border-l-primary pl-3 text-[15px] font-medium leading-relaxed">
                      {c.rule}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      {d.rows.length === 0 ? (
        <Card className="mt-6 py-0">
          <EmptyState icon={Lightbulb} title="Nothing learned yet">
            Post or drop a few findings and they'll show up here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <h2 className={H2}>Recent decisions</h2>
          {phone ? (
            // A phone reads a decision as a list row: the finding first, its facts small under it.
            <Card className="gap-0 divide-y divide-border py-0" data-testid="learning-rows">
              {d.rows.map((r, i) => (
                <div key={i} className="flex flex-col gap-1.5 px-4 py-3" data-testid={r.dry ? "dry-row" : "learning-row"}>
                  <div className="text-[15px] leading-snug">{r.gist}</div>
                  {r.editedGist && <div className={NOTE}>Reworded to: {r.editedGist}</div>}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={outcomeTone(r.label || r.kind)}>{wordOf(r.label || r.kind)}</StatusBadge>
                    <StatusBadge kind={r.severity} />
                    {r.dry && (
                      <StatusBadge kind="dry" tone="graphite" data-testid="dry-mark">
                        Dry run
                      </StatusBadge>
                    )}
                    {multi && <RepoPill repo={r.repo} />}
                    <span className={cn(NOTE, "min-w-0 max-w-full truncate")} title={r.loc}>
                      {r.loc}
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          ) : (
          <Card className="gap-0 overflow-x-auto py-0" data-testid="learning-rows">
            <table className="w-full text-sm max-[899px]:min-w-[640px]">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className={TH}>Decision</th>
                  <th scope="col" className={TH}>Finding</th>
                  {multi && <th scope="col" className={TH}>Repository</th>}
                  <th scope="col" className={TH}>Path</th>
                  <th scope="col" className={TH}>Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.rows.map((r, i) => (
                  <tr key={i} data-testid={r.dry ? "dry-row" : undefined}>
                    <td className={TD}>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge tone={outcomeTone(r.label || r.kind)}>{wordOf(r.label || r.kind)}</StatusBadge>
                        {r.dry && (
                          <StatusBadge
                            kind="dry"
                            tone="graphite"
                            data-testid="dry-mark"
                            title="Decided while DRY_RUN=1 — never posted to GitHub, and in no rate. It still teaches the reviewer."
                          >
                            Dry run
                          </StatusBadge>
                        )}
                      </div>
                    </td>
                    <td className={cn(TD, "min-w-[16rem] max-w-[40ch]")}>
                      {r.gist}
                      {r.editedGist && <div className={cn(NOTE, "mt-0.5")}>Reworded to: {r.editedGist}</div>}
                    </td>
                    {multi && (
                      <td className={TD}>
                        <RepoPill repo={r.repo} />
                      </td>
                    )}
                    <td className={TD}>
                      <Badge variant="outline" className="max-w-[260px] truncate font-normal" title={r.loc}>
                        {r.loc}
                      </Badge>
                    </td>
                    <td className={TD}>
                      <StatusBadge kind={r.severity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          )}
        </>
      )}

      <Collapsible open={aboutOpen} onOpenChange={setAboutOpen} className="mt-4" data-testid="about-log">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <Info aria-hidden="true" />
            About this log
            <ChevronDown aria-hidden="true" className={cn("transition-transform", aboutOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="max-w-[72ch] px-2 py-2 text-sm leading-relaxed text-muted-foreground">
            Before a review, {me.brand} reads back
            {win ? (
              <>
                {" "}the most recent <b className="text-foreground">{win.dropped} drops</b> and{" "}
                <b className="text-foreground">{win.edited} rewordings</b>
              </>
            ) : (
              " the most recent drops and rewordings"
            )}{" "}
            from this log, same-repository decisions first. A complaint that recurs becomes a rolling
            preference; it fades once it falls out of that window unless someone promotes it to a rule on
            the Skills page. Decisions made in dry run are read the same way, but counted in no rate.
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
