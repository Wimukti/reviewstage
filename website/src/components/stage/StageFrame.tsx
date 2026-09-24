// The isolation boundary between the site and the app's components (design.md §7). Every
// island renders inside an open shadow root that carries the app's own stylesheets as inline
// strings, so the app's selectors never reach the site's markup and Tailwind's preflight never
// reaches the app's. Custom properties inherit through the boundary, so the site's tokens.css
// and its data-theme choice apply unchanged; @font-face does not, so the site declares the
// faces in the light DOM (styles/app.css) and only the family names cross.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import tokens from "@app/tokens.css?inline";
import styles from "@app/styles.css?inline";

// html/body rules in styles.css match nothing inside a shadow root, so the mount takes over
// the few that matter: the interface size, the face, the ink and the paper.
const ROOT_CSS =
  ".stage-root{font:var(--t-13)/1.5 var(--font);color:var(--ink);background:var(--paper);" +
  "border-radius:var(--r-m);overflow:hidden;-webkit-font-smoothing:antialiased}";

export function StageFrame({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<Root | null>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    if (!root.current) {
      const style = document.createElement("style");
      style.textContent = `${tokens}\n${styles}\n${ROOT_CSS}`;
      const mount = document.createElement("div");
      mount.className = "stage-root";
      shadow.append(style, mount);
      root.current = createRoot(mount);
    }
    root.current.render(children);
  });

  useEffect(() => {
    return () => {
      const r = root.current;
      root.current = null;
      // React forbids unmounting a root synchronously from inside another root's commit.
      if (r) queueMicrotask(() => r.unmount());
    };
  }, []);

  return <div ref={host} className={className} data-stage-frame aria-label={label} role={label ? "img" : undefined} />;
}
