// One queue row for PR #38849, as Queue.tsx renders it (Row, RowTitle, RowState), from fixture
// data alone: the link goes nowhere and the archive button does nothing. Presentational only
// (design.md §7); the site's strip shows it for the "requested" and "posted" stops. Built from
// the same pieces as the queue — Card, RepoPill, UserAvatar, StatusBadge, the Button — so a
// change to the queue's row reaches the site on the next build.
import { Archive } from "lucide-react";
import fixture from "./fixture.json";
import { RepoPill, StatusBadge, UserAvatar } from "../ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type QueueCardState = "new" | "reviewing" | "reviewed" | "posted" | "approved";

const WHEN: Record<QueueCardState, string[]> = {
  new: ["requested 2 days ago"],
  reviewing: ["requested 2 days ago"],
  reviewed: ["reviewed just now"],
  posted: ["posted just now"],
  approved: ["approved just now"],
};

// Queue.tsx's ROW_CLASS / ROW_LINK_CLASS, verbatim.
const ROW_CLASS = "group relative flex min-h-[44px] flex-wrap items-start gap-x-3 hover:bg-accent/40 max-[899px]:flex-col max-[899px]:gap-0";
const ROW_LINK_CLASS = "flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-2.5 text-inherit hover:no-underline max-[899px]:w-full";

export function StageQueueCard({ state = "new", showRepo = true }: { state?: QueueCardState; showRepo?: boolean }) {
  const running = state === "reviewing";
  const sev = fixture.review.findings.reduce<Record<string, number>>((m, f) => ((m[f.severity] = (m[f.severity] ?? 0) + 1), m), {});
  const label: Record<string, string> = { blocker: "blocker", "should-fix": "should fix", nit: "nit", question: "question" };
  const archive = `Archive #${fixture.pr}`;
  return (
    <Card className="gap-0 divide-y divide-border py-0" data-testid="stage-queue">
      <div className={ROW_CLASS} data-testid="queue-row" data-running={running ? "true" : undefined}>
        <a className={ROW_LINK_CLASS} data-testid="row-link" href="#" onClick={(e) => e.preventDefault()}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {showRepo && <RepoPill repo={fixture.repo} />}
            <span className="text-sm font-medium text-primary">#{fixture.pr}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{fixture.title}</span>
          </div>
          {running ? (
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="row-running">
              <StatusBadge kind="reviewing" live />
              <span className="text-amber">{fixture.phases[2]}</span>
              <span className="text-muted-foreground">— open to watch</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2" data-testid="row-state">
              <StatusBadge kind={state} />
              {state !== "new" &&
                Object.entries(sev).map(([k, n]) => (
                  <StatusBadge key={k} kind={k}>
                    {n} {label[k] ?? k}
                  </StatusBadge>
                ))}
              <span className="text-xs text-muted-foreground">
                +{fixture.additions} −{fixture.deletions} · {fixture.changedFiles} files
              </span>
            </div>
          )}
        </a>
        <div className="flex max-w-[45%] shrink-0 items-start gap-2 py-2 pl-3 pr-2 max-[899px]:w-full max-[899px]:max-w-none max-[899px]:justify-between max-[899px]:py-0 max-[899px]:pb-2 max-[899px]:pl-4">
          <div className="flex items-start gap-2 pt-0.5">
            <UserAvatar login={fixture.author} size="sm" />
            <span className="flex flex-wrap justify-end gap-x-1.5 pt-1 text-right text-xs leading-4 text-muted-foreground max-[899px]:justify-start max-[899px]:text-left" data-testid="row-by">
              {[fixture.author, ...WHEN[state]].map((w, i) => (
                <span key={i} className="after:ml-1.5 after:content-['·'] last:after:content-none">
                  {w}
                </span>
              ))}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-[899px]:size-[44px] max-[899px]:opacity-100"
            aria-label={archive}
            title={archive}
            onClick={(e) => e.preventDefault()}
          >
            <Archive aria-hidden="true" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
