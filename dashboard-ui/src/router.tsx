// Tiny hand-rolled router (no react-router). ReviewStage serves at the site root; links are
// always built root-relative.

import { useEffect, useState } from "react";

export function toPath(loc: string): string {
  let p = loc || "/";
  if (p.length > 1) p = p.replace(/\/$/, "");
  return p || "/";
}

export function navigate(to: string): void {
  const url = to || "/";
  window.history.pushState({}, "", url);
  window.dispatchEvent(new Event("reviewstage:navigate"));
}

export function useLocation(): { path: string; search: URLSearchParams } {
  const read = () => ({
    path: toPath(window.location.pathname),
    search: new URLSearchParams(window.location.search),
  });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener("popstate", on);
    window.addEventListener("reviewstage:navigate", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("reviewstage:navigate", on);
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
