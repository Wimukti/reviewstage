// iOS home-screen apps (seen on iOS 26) lay out the first screen after a cold launch with a
// stale viewport: the fixed tab bar sits too high with a band of empty space under it until the
// first scroll or navigation makes WebKit measure again. Asking for that measurement ourselves
// — re-applying the viewport meta and a 1px scroll round trip — puts the bar where it belongs
// on the first frame. Only the standalone iOS app runs this; everywhere else it is a no-op.

export function isIosStandalone(nav: Navigator = navigator): boolean {
  const standalone = (nav as Navigator & { standalone?: boolean }).standalone === true;
  return standalone && /iPhone|iPad|iPod/.test(nav.userAgent);
}

export function remeasureViewport(doc: Document = document, win: Window = window): void {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta) {
    const content = meta.content;
    meta.content = `${content},maximum-scale=1`;
    meta.content = content;
  }
  const y = win.scrollY;
  win.scrollTo(0, y + 1);
  win.scrollTo(0, y);
}

/**
 * How many CSS pixels the layout viewport is short of the screen. On a cold launch iOS sizes it
 * without the status-bar inset (62px on Dynamic Island phones), then corrects on the first
 * scroll; until then every bottom-anchored fixed element floats that far up. They all subtract
 * `--ios-gap` from their `bottom`, so publishing the gap puts them where they belong.
 */
export function viewportGap(win: Window): number {
  const portrait = win.matchMedia ? win.matchMedia("(orientation: portrait)").matches : win.innerHeight >= win.innerWidth;
  const s = win.screen;
  const full = portrait ? Math.max(s.width, s.height) : Math.min(s.width, s.height);
  const gap = Math.round(full - win.innerHeight);
  // Anything outside a status bar's worth is not this bug (a split view, a zoomed display).
  return gap > 0 && gap <= 120 ? gap : 0;
}

export function publishGap(win: Window = window, doc: Document = document): number {
  const gap = viewportGap(win);
  doc.documentElement.style.setProperty("--ios-gap", `${gap}px`);
  return gap;
}

/** Run the re-measure after launch and whenever the app comes back to the foreground. */
export function installViewportFix(win: Window = window, doc: Document = document): () => void {
  if (!isIosStandalone(win.navigator)) return () => {};
  const run = () => {
    publishGap(win, doc);
    win.requestAnimationFrame(() => { remeasureViewport(doc, win); publishGap(win, doc); });
  };
  const onResize = () => publishGap(win, doc);
  const onVisible = () => { if (doc.visibilityState === "visible") run(); };
  run();
  const late = win.setTimeout(run, 350);
  win.addEventListener("pageshow", run);
  win.addEventListener("orientationchange", run);
  win.addEventListener("resize", onResize);
  win.visualViewport?.addEventListener("resize", onResize);
  doc.addEventListener("visibilitychange", onVisible);
  return () => {
    win.clearTimeout(late);
    win.removeEventListener("pageshow", run);
    win.removeEventListener("orientationchange", run);
    win.removeEventListener("resize", onResize);
    win.visualViewport?.removeEventListener("resize", onResize);
    doc.removeEventListener("visibilitychange", onVisible);
  };
}
