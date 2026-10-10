// The chip row's timing (lane2-reasons.md §2.2), on fake timers: it asks for ~6 s after a drop,
// closes on the next decision, never fires a stale timer, and a chosen reason is not its
// business — the row closing does not clear it.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { REASON_ROW_MS, ReasonPrompt } from "./reasonPrompt";

const fakeTimers = () => ({
  set: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clear: (id: number) => clearTimeout(id as unknown as NodeJS.Timeout),
});

function prompt() {
  const seen: Array<number | null> = [];
  const p = new ReasonPrompt((o) => seen.push(o), fakeTimers());
  return { p, seen };
}

test("the row is six seconds", () => {
  assert.equal(REASON_ROW_MS, 6000);
});

test("asks right after a drop and closes by itself after REASON_ROW_MS", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { p, seen } = prompt();
    p.ask(2);
    assert.equal(p.open, 2);
    mock.timers.tick(REASON_ROW_MS - 1);
    assert.equal(p.open, 2, "still asking just before the deadline");
    mock.timers.tick(1);
    assert.equal(p.open, null);
    assert.deepEqual(seen, [2, null]);
  } finally {
    mock.timers.reset();
  }
});

test("the next decision on any card ends the question at once, and the old timer never fires", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { p, seen } = prompt();
    p.ask(0);
    mock.timers.tick(1000);
    p.decided();
    assert.equal(p.open, null);
    mock.timers.tick(REASON_ROW_MS);
    assert.deepEqual(seen, [0, null], "no second close from the stale timer");
  } finally {
    mock.timers.reset();
  }
});

test("a second drop moves the question to the new card and restarts the clock", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { p, seen } = prompt();
    p.ask(0);
    mock.timers.tick(5000);
    p.ask(1);
    mock.timers.tick(5000);
    assert.equal(p.open, 1, "the first drop's timer must not close the second's row");
    mock.timers.tick(1000);
    assert.equal(p.open, null);
    assert.deepEqual(seen, [0, 1, null]);
  } finally {
    mock.timers.reset();
  }
});

test("dismissing an already-closed row is a no-op", () => {
  const { p, seen } = prompt();
  p.dismiss();
  p.decided();
  assert.deepEqual(seen, []);
});
