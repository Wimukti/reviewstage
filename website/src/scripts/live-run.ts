/* Drives the hero's simulated run. Pure DOM: every panel and line is already in the
 * markup; this only toggles classes, types text and moves the cursor dot on a timeline.
 *
 * Timeline model: an element with data-t="<ms>" fires that many ms into its step. Its
 * step is data-s, or the first step of the enclosing [data-panel]. Entering step n puts
 * every element in its terminal state (s < n), resets it (s > n) or schedules it (s == n),
 * so jumping to any step from any other step is always consistent. */
const STEPS = 6;
const DUR = [1900, 2600, 2600, 2000, 3800, 2000];
const HOLD = 2000;
const TYPE_MS = 42;

type Act = "untick" | "edit" | "press" | undefined;
interface Ev { el: HTMLElement; s: number; t: number; act: Act; fired: boolean }

export function initLiveRun(root: HTMLElement): void {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const screen = root.querySelector<HTMLElement>(".lr-screen")!;
  const cursor = root.querySelector<HTMLElement>(".lr-cursor");
  const counter = root.querySelector<HTMLElement>("[data-counter]");
  const captions = [...root.querySelectorAll<HTMLElement>("[data-caption]")];
  const buttons = [...root.querySelectorAll<HTMLElement>("[data-lr-step]")];
  const panels = [...root.querySelectorAll<HTMLElement>("[data-panel]")];
  const rows = [...root.querySelectorAll<HTMLElement>(".lr-finding")];
  const counts = [...root.querySelectorAll<HTMLElement>("[data-count]")];

  const events: Ev[] = [...root.querySelectorAll<HTMLElement>("[data-t]")].map((el) => {
    const panel = el.closest<HTMLElement>("[data-panel]");
    const s = Number(el.dataset.s ?? panel?.dataset.panel?.split(" ")[0] ?? 1);
    return { el, s, t: Number(el.dataset.t), act: el.dataset.act as Act, fired: false };
  });
  for (const ev of events) {
    const typed = ev.el.querySelector<HTMLElement>("[data-type]") ?? (ev.el.matches("[data-type]") ? ev.el : null);
    if (typed && !typed.dataset.full) typed.dataset.full = typed.textContent ?? "";
    const edit = ev.el.querySelector<HTMLElement>("[data-edit]");
    if (edit && !edit.dataset.full) edit.dataset.full = edit.textContent ?? "";
  }

  let step = 0;
  let stepStart = 0;
  let raf = 0;
  let timers: number[] = [];
  let pinned = false;
  let hovering = false;
  let hoverTimer = 0;
  let onScreen = true;

  const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };
  const clearTimers = () => { for (const t of timers) clearTimeout(t); timers = []; };

  const typeInto = (el: HTMLElement, text: string, from = 0) => {
    let i = from;
    const tick = () => {
      el.textContent = text.slice(0, ++i);
      if (i < text.length) later(tick, TYPE_MS);
    };
    tick();
  };

  const updateCount = () => {
    const n = rows.length - rows.filter((r) => r.classList.contains("off")).length;
    for (const c of counts) c.textContent = String(n);
  };

  const moveCursor = (el: HTMLElement) => {
    if (!cursor) return;
    const a = screen.getBoundingClientRect();
    const target = el.querySelector<HTMLElement>("[data-hit]") ?? el;
    const b = target.getBoundingClientRect();
    cursor.style.translate = `${b.left - a.left + b.width / 2}px ${b.top - a.top + b.height / 2}px`;
    cursor.classList.add("show");
  };

  /* Terminal state, no motion. */
  const settle = (ev: Ev) => {
    const { el, act } = ev;
    el.classList.add("in");
    const typed = el.querySelector<HTMLElement>("[data-type]") ?? (el.matches("[data-type]") ? el : null);
    if (typed) typed.textContent = typed.dataset.full ?? "";
    if (act === "untick") el.classList.add("off");
    if (act === "edit") {
      el.classList.add("open");
      const e = el.querySelector<HTMLElement>("[data-edit]");
      if (e) e.textContent = (e.dataset.full ?? "").slice(0, -Number(e.dataset.cut ?? 0)) + (e.dataset.edit ?? "");
    }
  };

  const reset = (ev: Ev) => {
    const { el } = ev;
    el.classList.remove("in", "off", "open");
    const typed = el.querySelector<HTMLElement>("[data-type]") ?? (el.matches("[data-type]") ? el : null);
    if (typed) typed.textContent = "";
    const e = el.querySelector<HTMLElement>("[data-edit]");
    if (e) e.textContent = e.dataset.full ?? "";
  };

  /* Animated version, used when the step is playing. */
  const fire = (ev: Ev) => {
    const { el, act } = ev;
    const run = () => {
      el.classList.add("in");
      const typed = el.querySelector<HTMLElement>("[data-type]") ?? (el.matches("[data-type]") ? el : null);
      if (typed) typeInto(typed, typed.dataset.full ?? "");
      if (act === "untick") { el.classList.add("off"); updateCount(); }
      if (act === "edit") {
        el.classList.add("open");
        const e = el.querySelector<HTMLElement>("[data-edit]");
        if (e) {
          const full = e.dataset.full ?? "";
          const cut = Number(e.dataset.cut ?? 0);
          let n = 0;
          const del = () => {
            e.textContent = full.slice(0, full.length - ++n);
            if (n < cut) later(del, TYPE_MS);
            else typeInto(e, full.slice(0, -cut) + (e.dataset.edit ?? ""), full.length - cut);
          };
          later(del, 260);
        }
      }
    };
    if (act && cursor) { moveCursor(el); later(run, 320); } else run();
  };

  const goTo = (n: number) => {
    clearTimers();
    step = n;
    stepStart = performance.now();
    root.dataset.step = String(n);
    if (counter) counter.textContent = `${n} / ${STEPS}`;
    for (const p of panels) p.classList.toggle("active", (p.dataset.panel ?? "").split(" ").includes(String(n)));
    captions.forEach((c, i) => { c.hidden = i !== n - 1; });
    buttons.forEach((b, i) => {
      b.setAttribute("aria-current", i === n - 1 ? "step" : "false");
      b.tabIndex = i === n - 1 ? 0 : -1;
    });
    cursor?.classList.remove("show");
    for (const ev of events) {
      ev.fired = ev.s !== n;
      if (ev.s < n || (ev.s === n && reduce)) settle(ev); else reset(ev);
    }
    updateCount();
  };

  /* The loop runs whenever the card can be seen; hover and pin only stop it advancing. */
  const active = () => !reduce && onScreen && !document.hidden;
  const loop = () => {
    raf = 0;
    if (!active()) return;
    const elapsed = performance.now() - stepStart;
    for (const ev of events) if (!ev.fired && ev.t <= elapsed) { ev.fired = true; fire(ev); }
    const end = DUR[step - 1] + (step === STEPS ? HOLD : 0);
    if (!pinned && !hovering && elapsed >= end) goTo((step % STEPS) + 1);
    raf = requestAnimationFrame(loop);
  };
  const start = () => { if (!raf && active()) raf = requestAnimationFrame(loop); };
  const pause = () => { if (raf) cancelAnimationFrame(raf); raf = 0; clearTimers(); };
  const sync = () => { if (!active()) pause(); else if (!raf) { goTo(step); start(); } };

  buttons.forEach((b, i) => {
    const jump = () => { hovering = true; clearTimeout(hoverTimer); if (step !== i + 1) goTo(i + 1); start(); };
    b.addEventListener("pointerenter", jump);
    b.addEventListener("focus", jump);
    b.addEventListener("click", () => {
      pinned = !(pinned && step === i + 1);
      root.dataset.pinned = String(pinned);
      buttons.forEach((x, j) => x.setAttribute("aria-pressed", String(pinned && j === i)));
      if (reduce || step !== i + 1) goTo(i + 1);
      start();
    });
    b.addEventListener("keydown", (e: KeyboardEvent) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); buttons[(i + d + STEPS) % STEPS].focus(); }
    });
  });
  const stepper = root.querySelector<HTMLElement>(".lr-steps");
  const leave = () => {
    clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => { hovering = false; stepStart = performance.now(); }, 3000);
  };
  stepper?.addEventListener("pointerleave", leave);
  stepper?.addEventListener("focusout", (e: FocusEvent) => {
    if (!stepper.contains(e.relatedTarget as Node | null)) leave();
  });

  document.addEventListener("visibilitychange", sync);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      sync();
    }, { threshold: 0.15 }).observe(root);
  }

  root.dataset.reduced = String(reduce);
  goTo(reduce ? 4 : 1);
  start();
}

for (const r of document.querySelectorAll<HTMLElement>("[data-live-run]")) initLiveRun(r);
