import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./mobile.css";

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
if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* an unregistered worker just means no offline shell; the app works without it */
    });
  });
}
