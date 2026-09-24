import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Self-hosted type (design.md §2): a LAN install never fetches a font. Latin subsets only for
// Plex — esbuild copies the woff2 files next to the bundle. Bricolage Grotesque (the display
// face) ships as one variable-weight file per script with unicode-range on each, so the
// browser downloads only the latin one; the package has no per-subset stylesheet to import.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource-variable/bricolage-grotesque/index.css";
import "./tokens.css";
import "./styles.css";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

// PWA: register the service worker in production bundles only, so `pnpm dev` never serves a
// stale shell from cache. Served from the root (/sw.js) so its scope covers the whole app.
//
// Two things here are about upgrades rather than offline.
//
// A browser only re-checks /sw.js on a navigation or an explicit update(), and this is a
// single-page app — a reviewer can keep one tab open for days, routing client-side, and never
// trigger either. So ask on every return to the tab (throttled), which is when a new release
// could plausibly have landed.
//
// And when the new worker does take over — it calls skipWaiting() then clients.claim(), so it
// does not wait for the tab to close — taking over does not re-render what is already on
// screen. Reload once on the handover, or the tab keeps running the old bundle: exactly the
// "I upgraded and still see the old interface" report. Two guards against a loop: only when a
// worker was already in control (on a first ever visit clients.claim() fires this too, and
// there is nothing stale to replace), and only once per page.
if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then((reg) => {
      let last = Date.now();
      const check = () => {
        if (document.visibilityState !== "visible" || Date.now() - last < 60_000) return;
        last = Date.now();
        void reg.update().catch(() => {
          /* offline, or the server is mid-restart; the next return to the tab retries */
        });
      };
      document.addEventListener("visibilitychange", check);
      window.addEventListener("focus", check);
    }).catch(() => {
      /* an unregistered worker just means no offline shell; the app works without it */
    });
  });
}
