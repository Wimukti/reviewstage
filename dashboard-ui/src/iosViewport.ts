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

/** Run the re-measure after launch and whenever the app comes back to the foreground. */
export function installViewportFix(win: Window = window, doc: Document = document): () => void {
  if (!isIosStandalone(win.navigator)) return () => {};
  const run = () => win.requestAnimationFrame(() => remeasureViewport(doc, win));
  const onVisible = () => { if (doc.visibilityState === "visible") run(); };
  run();
  const late = win.setTimeout(run, 350);
  win.addEventListener("pageshow", run);
  win.addEventListener("orientationchange", run);
  doc.addEventListener("visibilitychange", onVisible);
  return () => {
    win.clearTimeout(late);
    win.removeEventListener("pageshow", run);
    win.removeEventListener("orientationchange", run);
    doc.removeEventListener("visibilitychange", onVisible);
  };
}
