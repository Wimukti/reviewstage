// The "Why?" prompt after a drop (openspec/changes/p0-proof/lane2-reasons.md §2.2).
//
// A drop is instant — the checkbox or the swipe has already done its work before this is
// consulted. What this owns is only WHEN the chip row asking for a reason is on screen: it opens
// for the finding just dropped and closes after REASON_ROW_MS, on the next decision about any
// card, or when the reviewer dismisses it. The reason itself, once picked, lives in PrPage and
// outlives the row. Timers are injected so the timing can be tested without a browser.
export const REASON_ROW_MS = 6000;

export type PromptTimers = {
  set: (fn: () => void, ms: number) => number;
  clear: (id: number) => void;
};

const browserTimers: PromptTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
};

export class ReasonPrompt {
  // The finding index the row is open for, or null.
  open: number | null = null;
  private timer: number | undefined;

  constructor(
    private readonly onChange: (open: number | null) => void,
    private readonly timers: PromptTimers = browserTimers,
    private readonly ms: number = REASON_ROW_MS,
  ) {}

  /** A finding was just dropped: ask about it, and only it, for the next `ms`. */
  ask(i: number): void {
    this.stop();
    this.open = i;
    this.onChange(i);
    this.timer = this.timers.set(() => this.dismiss(), this.ms);
  }

  /** Close the row, keeping whatever reason was already chosen. */
  dismiss(): void {
    this.stop();
    if (this.open !== null) {
      this.open = null;
      this.onChange(null);
    }
  }

  /** Any decision on any card (keep, re-tick, restore, another drop) ends the question. */
  decided(): void {
    this.dismiss();
  }

  private stop(): void {
    if (this.timer !== undefined) {
      this.timers.clear(this.timer);
      this.timer = undefined;
    }
  }
}
