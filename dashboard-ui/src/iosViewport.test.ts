import { test } from "node:test";
import assert from "node:assert/strict";
import { installViewportFix, isIosStandalone, remeasureViewport, viewportGap } from "./iosViewport.ts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1";

test("only the iOS home-screen app counts as standalone", () => {
  assert.equal(isIosStandalone({ userAgent: IPHONE, standalone: true } as unknown as Navigator), true);
  assert.equal(isIosStandalone({ userAgent: IPHONE, standalone: false } as unknown as Navigator), false);
  assert.equal(isIosStandalone({ userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/140", standalone: true } as unknown as Navigator), false);
});

test("re-measuring restores the viewport meta and the scroll position", () => {
  const sets: string[] = [];
  const meta = { _c: "width=device-width,initial-scale=1,viewport-fit=cover",
    get content() { return this._c; }, set content(v: string) { sets.push(v); this._c = v; } };
  const scrolls: number[] = [];
  const doc = { querySelector: () => meta } as unknown as Document;
  const win = { scrollY: 40, scrollTo: (_x: number, y: number) => scrolls.push(y) } as unknown as Window;
  remeasureViewport(doc, win);
  assert.equal(meta.content, "width=device-width,initial-scale=1,viewport-fit=cover");
  assert.equal(sets.length, 2);
  assert.deepEqual(scrolls, [41, 40]);
});

test("a browser tab installs nothing", () => {
  let added = 0;
  const win = { navigator: { userAgent: IPHONE, standalone: false }, addEventListener: () => added++ } as unknown as Window;
  const undo = installViewportFix(win, {} as Document);
  undo();
  assert.equal(added, 0);
});

const win = (innerHeight: number, w = 440, h = 956, portrait = true) =>
  ({ innerHeight, innerWidth: portrait ? w : h, screen: { width: w, height: h },
     matchMedia: () => ({ matches: portrait }) }) as unknown as Window;

test("the cold-launch gap is the missing status-bar inset, and zero once iOS corrects", () => {
  // iPhone 16 Pro Max: 440×956 points, 62pt status-bar inset (the maintainer's screenshots).
  assert.equal(viewportGap(win(956 - 62)), 62);
  assert.equal(viewportGap(win(956)), 0);
  // Landscape uses the short side of the screen.
  assert.equal(viewportGap(win(440, 440, 956, false)), 0);
  // Something else entirely (a much smaller window) is not this bug.
  assert.equal(viewportGap(win(500)), 0);
});
