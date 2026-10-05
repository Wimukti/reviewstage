// Tiny hand-rolled router (no react-router). ReviewStage serves at the site root; links are
// always built root-relative.
//
// Every in-app push records the URL it came from in history.state (`rsPrev`), so a phone back
// button can tell "the entry behind me is my parent" (pop it) from "I was opened directly"
// (push the parent instead). Route changes are announced with one internal event, and the
// phone shell may wrap that announcement in a view transition (nav.tsx).

import { useEffect, useState } from "react";

export function toPath(loc: string): string {
  let p = loc || "/";
  if (p.length > 1) p = p.replace(/\/$/, "");
  return p || "/";
}

const EVT = "reviewstage:navigate";
const here = () => window.location.pathname + window.location.search + window.location.hash;

export type NavKind = "push" | "pop" | "replace";
type Wrap = (from: string, to: string, kind: NavKind, apply: () => void) => void;
let wrap: Wrap | null = null;

/** Lets the phone shell wrap every route change (its transitions). Returns the unhook. */
export function setNavigationWrapper(w: Wrap | null): () => void {
  wrap = w;
  return () => {
    if (wrap === w) wrap = null;
  };
}

const announce = () => window.dispatchEvent(new Event(EVT));

function run(from: string, to: string, kind: NavKind, apply: () => void) {
  if (!wrap) return apply();
  let applied = false;
  const once = () => {
    if (applied) return;
    applied = true;
    apply();
  };
  try {
    wrap(from, to, kind, once);
  } catch {
    once();
  }
}

export function navigate(to: string, opts: { replace?: boolean; pop?: boolean } = {}): void {
  const url = to || "/";
  const from = here();
  run(from, url, opts.pop ? "pop" : opts.replace ? "replace" : "push", () => {
    if (opts.replace) window.history.replaceState(window.history.state, "", url);
    else window.history.pushState({ rsPrev: from }, "", url);
    announce();
  });
}

const pathOf = (url: string) => toPath(url.split(/[?#]/)[0]);

/** Back to `parent`: pops the history entry when it is that page, else pushes the parent. */
export function goBack(parent: string): void {
  const prev = (window.history.state as { rsPrev?: string } | null)?.rsPrev;
  if (prev && pathOf(prev) === pathOf(parent)) {
    window.history.back();
    return;
  }
  navigate(parent, { pop: true });
}

// The browser's own back and forward: the URL has already moved, so a wrapper only gets to
// animate the re-render. Registered once for the whole app.
let lastUrl = typeof window !== "undefined" ? here() : "/";
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => run(lastUrl, here(), "pop", announce));
  window.addEventListener(EVT, () => {
    lastUrl = here();
  });
  window.addEventListener("hashchange", () => {
    lastUrl = here();
  });
}

export function useLocation(): { path: string; search: URLSearchParams; hash: string } {
  const read = () => ({
    path: toPath(window.location.pathname),
    search: new URLSearchParams(window.location.search),
    hash: window.location.hash,
  });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    // popstate is re-announced as EVT above, inside the wrapper when there is one.
    window.addEventListener("hashchange", on);
    window.addEventListener(EVT, on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener(EVT, on);
    };
  }, []);
  return loc;
}

export function Link(
  props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }
) {
  const { to, onClick, children, ...rest } = props;
  const href = to.startsWith("http") ? to : to || "/";
  const external = to.startsWith("http");
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (external || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
