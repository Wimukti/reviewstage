// The review-in-flight card, as the PR page shows it (PrPage ProgressPanel), from fixture data
// and props alone: no API, no stop button. Rendered by the site's strip and by StageScene's
// "drafting" state. Presentational only (design.md §7); it composes the PR page's own
// ProgressSteps so a restyle there reaches the site.
import fixture from "./fixture.json";
import { ProgressSteps } from "../ReviewParts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function StageProgress({ cur = 2, effortLabel = "Standard" }: { cur?: number; effortLabel?: string }) {
  return (
    <Card className="mt-3 gap-3 border-0 py-4 shadow-sm" data-testid="stage-progress">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">
          Drafting review for {fixture.repo} #{fixture.pr}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{effortLabel} effort</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <ProgressSteps phases={fixture.phases} cur={cur} />
        <p className="m-0 text-xs text-muted-foreground">This page refreshes itself.</p>
      </CardContent>
    </Card>
  );
}
