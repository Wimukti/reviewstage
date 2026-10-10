// The one-line disclosure above the replayed PR page. Always visible, never dismissible: a
// visitor must not mistake a stored review for a live one.
import { FlaskConical } from "lucide-react";
import type { ReplayFixture } from "./types";

export const INSTALL_URL = "/start/install/";
export const EXAMPLES_URL = "/examples/";

export function ReplayBanner({ fixture }: { fixture: ReplayFixture }) {
  return (
    <div
      role="note"
      data-testid="replay-banner"
      className="sticky top-0 z-40 border-b border-border bg-amber/12 px-4 py-2 text-sm text-foreground backdrop-blur"
    >
      <div className="mx-auto flex max-w-[960px] flex-wrap items-center gap-x-3 gap-y-1">
        <FlaskConical aria-hidden="true" className="size-4 shrink-0 text-amber" />
        <span>
          <b>Precomputed example.</b> Nothing leaves this page.
        </span>
        <span className="text-muted-foreground max-[599px]:hidden" data-testid="replay-hint">
          Three findings — one to keep, one to drop, one to edit.
        </span>
        <span className="ml-auto flex items-center gap-3 text-sm">
          <a href={`${EXAMPLES_URL}${fixture.slug}/`} className="min-h-[44px] inline-flex items-center text-primary" data-testid="replay-readme">
            Read this example
          </a>
          <a href={INSTALL_URL} className="min-h-[44px] inline-flex items-center text-primary" data-testid="replay-install">
            Install
          </a>
        </span>
      </div>
    </div>
  );
}
