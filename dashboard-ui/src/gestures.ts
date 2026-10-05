// Touch gestures for the phone screens (openspec/changes/mobile-app-feel M2, M3, M5): a
// horizontal swipe on a list row or a finding card, pull to refresh, and a short haptic tick.
//
// Touch events, not pointer events: they are what iOS delivers in a home-screen app, and the
// element sets `touch-action: pan-y` so the browser keeps the vertical scroll and hands every
// horizontal pan to us. Nothing here ever calls the server; the callers decide what a swipe
// means, and every swipe has a button doing the same thing (the gesture is a shortcut).
import { useCallback, useEffect, useRef, useState } from "react";

/** A 10ms tick where the platform has one (Android); iOS has no web vibration and gets the visual. */
export function haptic(): void {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* not supported */
  }
}

// A touch that starts this close to the left edge belongs to the shell's swipe-back.
export const EDGE_GUARD = 24;
// Movement before the gesture decides between "scroll" and "swipe".
const SLOP = 8;

export type SwipeConfig = {
  /** Release past this many px to run the action. A function gets the element's width. */
  commit: number | ((width: number) => number);
  /** Release past this (but short of commit) to leave the action button showing; 0 = never. */
  reveal?: number;
  /** How far a revealed action sits open. */
  revealWidth?: number;
  canLeft?: boolean;
  canRight?: boolean;
  onLeft?: () => void;
  onRight?: () => void;
  disabled?: boolean;
};

type Phase = "idle" | "pending" | "drag" | "scroll";

/**
 * A horizontal swipe on one element. Returns the offset to translate the foreground by, which
 * side is revealed, and the touch handlers to spread on the element. A swipe that moved never
 * becomes a click (`onClickCapture` swallows it).
 */
export function useSwipe(cfg: SwipeConfig) {
  const c = useRef(cfg);
  c.current = cfg;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<"left" | "right" | null>(null);
  const s = useRef({ phase: "idle" as Phase, x: 0, y: 0, base: 0, width: 320, off: 0, endAt: 0 });

  const close = useCallback(() => {
    setOpen(null);
    setDx(0);
  }, []);

  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    const t = e.touches[0];
    const st = s.current;
    if (c.current.disabled || e.touches.length !== 1 || t.clientX <= EDGE_GUARD) {
      st.phase = "idle";
      return;
    }
    st.phase = "pending";
    st.x = t.clientX;
    st.y = t.clientY;
    st.base = dx;
    st.off = dx;
    st.width = (e.currentTarget as HTMLElement).offsetWidth || 320;
  };

  const onTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    const st = s.current;
    if (st.phase === "idle" || st.phase === "scroll") return;
    const t = e.touches[0];
    const mx = t.clientX - st.x;
    const my = t.clientY - st.y;
    if (st.phase === "pending") {
      if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return;
      if (Math.abs(my) >= Math.abs(mx)) {
        st.phase = "scroll";
        return;
      }
      st.phase = "drag";
      setDragging(true);
    }
    const { canLeft = true, canRight = true } = c.current;
    let off = st.base + mx;
    if (off > 0 && !canRight) off = off / 6;
    if (off < 0 && !canLeft) off = off / 6;
    // Past most of the width it gets heavy, so the row never leaves the screen under a thumb.
    const lim = st.width * 0.85;
    if (Math.abs(off) > lim) off = Math.sign(off) * (lim + (Math.abs(off) - lim) / 4);
    st.off = off;
    setDx(off);
  };

  const end = (cancelled: boolean) => {
    const st = s.current;
    const was = st.phase;
    st.phase = "idle";
    if (was !== "drag") return;
    st.endAt = Date.now();
    setDragging(false);
    const { commit, reveal = 0, revealWidth = 88, canLeft = true, canRight = true, onLeft, onRight } = c.current;
    const need = typeof commit === "function" ? commit(st.width) : commit;
    const off = st.off;
    if (!cancelled && off >= need && canRight && onRight) {
      close();
      onRight();
    } else if (!cancelled && off <= -need && canLeft && onLeft) {
      close();
      onLeft();
    } else if (!cancelled && reveal > 0 && off >= reveal && canRight && onRight) {
      setOpen("right");
      setDx(revealWidth);
    } else if (!cancelled && reveal > 0 && off <= -reveal && canLeft && onLeft) {
      setOpen("left");
      setDx(-revealWidth);
    } else close();
  };

  const onClickCapture = (e: React.MouseEvent) => {
    // The click a browser may synthesise at the end of a swipe is not a tap.
    if (Date.now() - s.current.endAt < 100) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // A tap on a row that has an action showing closes it instead of opening the row.
    if (open && !(e.target as HTMLElement).closest("[data-swipe-action]")) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return {
    dx,
    open,
    dragging,
    close,
    bind: {
      onTouchStart,
      onTouchMove,
      onTouchEnd: () => end(false),
      onTouchCancel: () => end(true),
      onClickCapture,
    },
  };
}

// Pull to refresh. The browser's own is off (overscroll-behavior: contain) and never existed in
// an iOS home-screen app, so this one is drawn by the page: pull down from the very top, let go
// past THRESHOLD, and the list reloads. Window listeners, all passive.
export const PTR_THRESHOLD = 64;
const PTR_MAX = 110;

export function usePullToRefresh(onRefresh: () => Promise<unknown>, enabled = true) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const fn = useRef(onRefresh);
  fn.current = onRefresh;
  const busy = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let cur = 0;
    let active = false;
    const blocked = () => busy.current || !!document.querySelector('[role="dialog"]');
    const down = (e: TouchEvent) => {
      start = null;
      active = false;
      if (e.touches.length !== 1 || window.scrollY > 0 || blocked()) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dy = t.clientY - start.y;
      const dx = t.clientX - start.x;
      if (!active) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // Sideways (a row swipe) or upwards (a scroll): not ours.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) {
          start = null;
          return;
        }
        active = true;
      }
      cur = Math.min(PTR_MAX, Math.max(0, dy * 0.5));
      setPull(cur);
    };
    const up = async () => {
      if (!start || !active) {
        start = null;
        return;
      }
      start = null;
      active = false;
      if (cur < PTR_THRESHOLD) {
        cur = 0;
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(PTR_THRESHOLD);
      haptic();
      const t0 = Date.now();
      try {
        await fn.current();
      } catch {
        /* the page shows its own error */
      }
      // Long enough to see that something happened.
      const left = 450 - (Date.now() - t0);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      busy.current = false;
      cur = 0;
      setRefreshing(false);
      setPull(0);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", up, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [enabled]);
  return { pull, refreshing };
}
