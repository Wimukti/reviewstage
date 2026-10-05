// The phone shell (< 900px, openspec/changes/mobile-app-feel M1): an iOS navigation bar on top,
// three tabs at the bottom, the page between them.
//
// - The bar is 44px under the top safe area, translucent with a blur. A tab's root page shows
//   a large title under it that collapses into the bar as it scrolls away (an
//   IntersectionObserver on the title — no scroll listener); a pushed page shows ‹ <parent>
//   and a compact title. The hairline under the bar appears only once the page has scrolled.
// - A page's own controls go in the bar through <NavBarAction> (the queue's filter and search,
//   a PR's ⋯); transient messages through showToast() (Toast.tsx), drawn above the tab bar.
// - The tab bar: Queue (with the To review count), Activity, You. The active tab follows the
//   route, including the tab a PR was opened from.
// - Route changes slide (push/pop) or cross-fade (tab switch) with the View Transitions API,
//   or a CSS animation where it is missing; never under reduced motion, never blocking.
// - A pan from the left edge on a pushed page goes back.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, CircleUserRound, History, Inbox, type LucideIcon } from "lucide-react";
import type { Me } from "./api";
import { Logo } from "./Logo";
import {
  navOverrides,
  noteRoute,
  rememberTabUrl,
  routeMeta,
  setNavSlot,
  tabUrl,
  TABS,
  useNavStore,
  type RouteMeta,
  type TabKey,
} from "./nav";
import { useTodoCount } from "./queueCount";
import { goBack, Link, setNavigationWrapper, useLocation } from "./router";
import { Toaster } from "./Toast";
import { UpdateBanner } from "./UpdateBanner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const ICONS: Record<TabKey, LucideIcon> = { queue: Inbox, activity: History, you: CircleUserRound };

// Stable ref callbacks: an inline one would detach and re-attach (and re-emit) every render.
const actionRef = (el: HTMLElement | null) => setNavSlot("action", el);
const auxRef = (el: HTMLElement | null) => setNavSlot("aux", el);

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Anim = "push" | "pop" | "fade" | null;

/** How a route change should move: deeper slides in, shallower slides back, a tab cross-fades. */
export function animFor(from: RouteMeta, to: RouteMeta, samePath: boolean): Anim {
  if (samePath) return null;
  if (from.tab !== to.tab) return "fade";
  if (to.depth > from.depth) return "push";
  if (to.depth < from.depth) return "pop";
  return null;
}

// Wraps every route change while the phone shell is mounted. Small on purpose: if anything in
// here fails the navigation still happens, exactly once (router.run guards that).
function useTransitions(brand: string) {
  useEffect(() => {
    return setNavigationWrapper((from, to, _kind, apply) => {
      const a = new URL(from, location.href);
      const b = new URL(to, location.href);
      const fromUrl = a.pathname + a.search;
      const toUrl = b.pathname + b.search;
      noteRoute(fromUrl, brand);
      const fromMeta = routeMeta(fromUrl, brand);
      noteRoute(toUrl, brand); // a PR's tab is the one it was opened from
      const anim = reducedMotion() ? null : animFor(fromMeta, routeMeta(toUrl, brand), a.pathname === b.pathname);
      if (!anim) return apply();
      const root = document.documentElement;
      const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void> } };
      if (typeof doc.startViewTransition === "function") {
        root.dataset.nav = anim;
        const t = doc.startViewTransition(() => flushSync(apply));
        t.ready.catch(() => {});
        t.finished.catch(() => {}).finally(() => {
          if (root.dataset.nav === anim) delete root.dataset.nav;
        });
        return;
      }
      // Fallback: swap, then animate the new page in with a keyframe.
      apply();
      const main = document.getElementById("phone-page");
      if (!main) return;
      main.removeAttribute("data-anim");
      void main.offsetWidth; // restart the animation
      main.setAttribute("data-anim", anim);
      window.setTimeout(() => main.removeAttribute("data-anim"), 400);
    });
  }, [brand]);
}

// iOS Safari in a browser tab has its own edge swipe; ours would double it. Everywhere else
// (the home-screen app, Android, desktop Chromium) it is the only one.
const nativeEdgeSwipe = () => "standalone" in navigator && !(navigator as Navigator & { standalone?: boolean }).standalone;

const EDGE = 24;
const DISTANCE = 80;

function useEdgeSwipe(back: string | null) {
  const target = useRef(back);
  target.current = back;
  useEffect(() => {
    if (nativeEdgeSwipe()) return;
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start = target.current && e.touches.length === 1 && t.clientX <= EDGE ? { x: t.clientX, y: t.clientY } : null;
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      // A vertical scroll that began near the edge is the page's, not ours.
      if (Math.abs(t.clientY - start.y) > Math.max(16, Math.abs(t.clientX - start.x))) start = null;
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      start = null;
      if (dx > DISTANCE && dy < dx / 2 && target.current) goBack(target.current);
    };
    const cancel = () => {
      start = null;
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", cancel);
    };
  }, []);
}

// Collapsed: the large title has gone under the bar (or, on a pushed page, the page has moved
// at all). One observer on one element; the bar's own height is the root margin.
function useScrolled(bar: React.RefObject<HTMLElement | null>, watched: React.RefObject<HTMLElement | null>, key: string) {
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    const el = watched.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    setScrolled(false);
    const top = bar.current?.offsetHeight ?? 44;
    const io = new IntersectionObserver(
      ([e]) => setScrolled(!e.isIntersecting && e.boundingClientRect.top < top),
      { rootMargin: `-${top}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [bar, watched, key]);
  return scrolled;
}

function TabBar({ active, count }: { active: TabKey; count: number | null }) {
  return (
    <nav
      aria-label="Main"
      data-testid="tab-bar"
      className="tabbar fixed inset-x-0 bottom-0 z-30 flex h-[calc(49px+env(safe-area-inset-bottom,0px))] border-t bg-background/80 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl backdrop-saturate-150"
    >
      {TABS.map(({ key, label, root }) => {
        const on = key === active;
        const Glyph = ICONS[key];
        const badge = key === "queue" && count ? count : 0;
        return (
          <Link
            key={key}
            // The active tab's icon returns to its root; another tab reopens where it was.
            to={on ? root : tabUrl(key)}
            aria-current={on ? "page" : undefined}
            data-tab={key}
            className={cn(
              "relative flex min-w-[44px] flex-1 flex-col items-center justify-center gap-[3px] pt-1 text-[10px] font-medium leading-none text-muted-foreground hover:no-underline",
              on && "text-primary",
            )}
          >
            <span className="relative">
              <Glyph aria-hidden="true" className={cn("size-[26px]", on && "fill-primary/20")} strokeWidth={on ? 2.1 : 1.75} />
              {badge > 0 && (
                <span
                  data-testid="tab-badge"
                  aria-hidden="true"
                  className="absolute -right-2.5 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums leading-none text-primary-foreground ring-2 ring-background"
                >
                  {badge > 99 ? "99+" : badge.toLocaleString("en-US")}
                </span>
              )}
            </span>
            <span className="text-[10px] tracking-[0.01em]">{label}</span>
            {badge > 0 && <span className="sr-only">, {badge.toLocaleString("en-US")} to review</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function PhoneShell({ me, children }: { me: Me; children: ReactNode }) {
  const { path, search } = useLocation();
  const qs = search.toString();
  const url = path + (qs ? `?${qs}` : "");
  noteRoute(url, me.brand);
  useEffect(() => rememberTabUrl(url), [url]);
  useTransitions(me.brand);

  const meta = routeMeta(url, me.brand);
  const nav = useNavStore();
  const o = navOverrides(nav);
  const title = o.title ?? meta.title;
  const back = o.back ?? meta.back;
  const root = meta.depth === 0;
  const count = useTodoCount(path);
  useEdgeSwipe(root ? null : back?.to ?? null);

  const bar = useRef<HTMLElement>(null);
  const large = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const scrolled = useScrolled(bar, root ? large : sentinel, `${path}|${root}`);
  const collapsed = !root || scrolled;

  const queueTitle = path === "/";
  const bigTitle = queueTitle ? (
    <span className="flex items-center gap-2.5">
      <Logo me={me} className="size-[30px]" />
      <span>{me.brand}</span>
    </span>
  ) : (
    title
  );
  // One h1: the large title on a root; else the compact title, unless the page has its own.
  const compactIsHeading = !root && !o.ownsHeading;
  const Compact = compactIsHeading ? "h1" : "div";

  return (
    <>
      <header
        ref={bar}
        data-testid="nav-bar"
        data-collapsed={collapsed ? "true" : "false"}
        data-scrolled={scrolled ? "true" : "false"}
        className={cn(
          "phone-head sticky top-0 z-30 border-b bg-background/80 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl backdrop-saturate-150 transition-[border-color] duration-(--dur)",
          scrolled ? "border-border" : "border-transparent",
        )}
      >
        <div className="relative flex h-[44px] items-center px-1">
          <div className="relative z-10 flex min-w-0 flex-1 items-center">
            {!root && back && (
              <Button
                variant="ghost"
                type="button"
                data-testid="nav-back"
                aria-label={`Back to ${back.label}`}
                onClick={() => goBack(back.to)}
                className="h-[44px] min-w-[44px] max-w-[45vw] justify-start gap-0 px-1.5 text-[17px] font-normal text-primary hover:bg-transparent hover:text-primary [&_svg]:size-7!"
              >
                <ChevronLeft aria-hidden="true" className="-ml-1 shrink-0" strokeWidth={2.25} />
                <span className="truncate">{back.label}</span>
              </Button>
            )}
          </div>
          <Compact
            data-testid="nav-title"
            aria-hidden={root ? true : undefined}
            className={cn(
              "pointer-events-none absolute inset-x-[96px] m-0 truncate text-center font-sans text-[17px] font-semibold leading-[44px] tracking-normal transition-opacity duration-(--dur)",
              collapsed ? "opacity-100" : "opacity-0",
            )}
          >
            {title}
          </Compact>
          <div className="relative z-10 flex min-w-0 flex-1 items-center justify-end gap-0.5">
            {!root && <span ref={auxRef} className="contents" data-slot="nav-aux" />}
            <span ref={actionRef} className="contents" data-slot="nav-action" />
          </div>
        </div>
      </header>

      <main id="phone-page" className="phone-page main min-w-0 flex-1">
        <UpdateBanner />
        {root ? (
          <div ref={large} className="flex min-h-[52px] items-center gap-1.5 px-4 pb-1 pt-0.5" data-testid="large-title">
            <h1 className="m-0 min-w-0 truncate font-display text-[28px]/[34px] font-semibold tracking-tight">{bigTitle}</h1>
            <span ref={auxRef} className="contents" data-slot="nav-aux" />
          </div>
        ) : (
          <div ref={sentinel} aria-hidden="true" className="h-px" />
        )}
        <div className="min-w-0 px-4 pb-[calc(49px+env(safe-area-inset-bottom,0px)+32px)] pt-3">{children}</div>
      </main>

      <Toaster />
      <TabBar active={meta.tab} count={count} />
    </>
  );
}
