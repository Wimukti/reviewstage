// The replay bundle: the shipped PR page (PrPage.tsx, ReviewParts.tsx, api.ts — all untouched)
// mounted over an in-memory server. boot.ts has to be the first import: it installs the fetch
// shim and the PR reference before any component can ask for either.
import { fixture, store } from "./boot";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "../tokens.css";
import "../generated/tw.css";
import "../styles.css";
import { PrPage } from "../PrPage";
import { setNavigationWrapper } from "../router";
import { applyTheme, type ThemeChoice } from "../theme";
import { bump } from "./events";
import { meData } from "./map";
import { PostPreview } from "./PostPreview";
import { EXAMPLES_URL, ReplayBanner } from "./ReplayBanner";

// The site stores its theme as Starlight does (localStorage["starlight-theme"]: "dark",
// "light", "auto"); the app's theme.ts reads its own key. Follow the site's, live.
function siteTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem("starlight-theme");
    return v === "light" ? "light" : v === "auto" || v === "" ? "system" : "dark";
  } catch {
    return "dark";
  }
}

// The page's own links (the queue crumb, "back to the current review") have nowhere to go in a
// one-PR replay: the queue becomes the examples index, everything else stays put.
setNavigationWrapper((_from, to, kind, apply) => {
  if (kind === "pop" || to.startsWith(window.location.pathname)) return apply();
  if (to === "/") window.location.assign(EXAMPLES_URL);
});

// The first keep, drop or edit — read off the DOM so PrPage stays untouched: a tick on a
// finding's checkbox, a choice in a phone card's menu, or a keystroke in a comment editor.
function countFirstDecision() {
  let seen = false;
  const once = () => {
    if (seen) return;
    seen = true;
    bump("first_decision");
  };
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest) return;
      if (el.closest("[data-testid=finding] [role=checkbox], [data-testid=finding-select], [role=menuitem]")) once();
    },
    true,
  );
  document.addEventListener(
    "input",
    (e) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-testid=finding-body]")) once();
    },
    true,
  );
}

function Replay() {
  const [me] = useState(() => meData(fixture));
  useEffect(() => {
    applyTheme(siteTheme());
    const on = () => applyTheme(siteTheme());
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  return (
    <div className="flex min-h-dvh flex-col bg-background" data-testid="replay" data-example={fixture.slug}>
      <ReplayBanner fixture={fixture} />
      <main className="main min-w-0 flex-1">
        <div className="min-w-0 max-w-[960px] px-6 pb-14 pt-6 max-[899px]:px-4 max-[899px]:pb-[calc(96px+env(safe-area-inset-bottom,0px))] max-[899px]:pt-5">
          <PrPage me={me} />
        </div>
      </main>
      <PostPreview />
    </div>
  );
}

countFirstDecision();
void store;
const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Replay />
    </StrictMode>,
  );
}
