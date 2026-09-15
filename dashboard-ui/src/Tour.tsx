import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Me } from "./api";
import { navigate } from "./router";

interface TourStep {
  sel?: string;
  title: string;
  text: string;
  cta?: { label: string; to: string };
}

const TOUR: TourStep[] = [
  {
    title: "Welcome to ReviewStage 👋",
    text: "ReviewStage drafts the PR reviews you owe your team. You tick what's worth saying and post it — as yourself. Here's the 30-second setup.",
  },
  {
    sel: '[data-tour="integrations"]',
    title: "1. Connect your accounts",
    text: "Start in Integrations: add your Claude account (reviews run on it) and your Slack member ID (so ReviewStage can ping you when a review is requested).",
  },
  {
    sel: '[data-tour="skills"]',
    title: "2. Pick a review skill",
    text: "ReviewStage follows a review skill. The shared team default works out of the box — or bring your own here. You can switch any time.",
  },
  {
    // The list when there is one; the card (empty state included) otherwise.
    sel: '[data-tour="queuelist"], [data-tour="queue"]',
    title: "3. Your review queue",
    text: "PRs waiting on your review land here. Open one, choose an effort level, and ReviewStage drafts the review — nothing posts to GitHub without your click.",
  },
  {
    title: "You're set 🎉",
    text: "Open a PR from your queue to run your first review. You stay the reviewer — ReviewStage just does the reading and drafting.",
    cta: { label: "Go to Integrations", to: "/integrations" },
  },
];

const EVT = "reviewstage:start-tour";
// The queue renders after its data loads, so the auto-start waits for the target this long.
const AUTO_START_SEL = '[data-tour="queue"]';
const AUTO_START_WAIT_MS = 5000;

// Comma-separated selectors are tried in order: the first that matches wins (unlike
// querySelector, which picks document order).
function findTarget(sel: string): HTMLElement | null {
  for (const one of sel.split(",")) {
    const el = document.querySelector(one.trim()) as HTMLElement | null;
    if (el) return el;
  }
  return null;
}

// Resolve once `sel` is in the DOM (now, or when it appears within `ms`); false on timeout.
function whenPresent(sel: string, ms: number): { promise: Promise<boolean>; cancel: () => void } {
  let cancel = () => {};
  const promise = new Promise<boolean>((resolve) => {
    if (document.querySelector(sel)) return resolve(true);
    const obs = new MutationObserver(() => {
      if (document.querySelector(sel)) {
        done(true);
      }
    });
    const t = window.setTimeout(() => done(false), ms);
    const done = (ok: boolean) => {
      obs.disconnect();
      window.clearTimeout(t);
      resolve(ok);
    };
    cancel = () => done(false);
    obs.observe(document.body, { childList: true, subtree: true });
  });
  return { promise, cancel };
}

// Fire from anywhere (e.g. the sidebar) to (re)open the tour.
export function startTour() {
  window.dispatchEvent(new Event(EVT));
}

export function Tour({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  // Whether this person has seen it. The flag lives on the user record, not in localStorage:
  // that was per BROWSER, so the second person to sign in on a shared box never saw the tour,
  // and the same person on a new laptop saw it again. Held here as well so dismissing it takes
  // effect immediately rather than on the next /api/me.
  const [seen, setSeen] = useState(me.tour_seen !== false);
  const ringRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const end = useCallback(() => {
    setSeen(true);
    setOpen(false);
    // Best effort: a server that cannot record it costs the person one repeat, not an error.
    void api.tourSeen().catch(() => {});
  }, []);

  // Open on demand, and auto-start once on the queue for first-timers. `tour_seen` absent means
  // an older server that cannot remember a dismissal — auto-starting then would reopen it on
  // every load, so we only ever offer it from the Help menu there.
  useEffect(() => {
    const onStart = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(EVT, onStart);
    let t: number | undefined;
    let waiter: ReturnType<typeof whenPresent> | undefined;
    if (me.tour_seen === false && !seen) {
      // First visit: the queue card mounts after its fetch, so wait for it rather than
      // checking once. Empty queue or not, the card is there — the tour still runs.
      waiter = whenPresent(AUTO_START_SEL, AUTO_START_WAIT_MS);
      waiter.promise.then((ok) => {
        if (ok) t = window.setTimeout(onStart, 450);
      });
    }
    return () => {
      window.removeEventListener(EVT, onStart);
      waiter?.cancel();
      window.clearTimeout(t);
    };
    // Deliberately mount-only: `seen` flipping mid-session must not re-arm the waiter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Position the ring + card against the current step's target.
  const place = useCallback(() => {
    const s = TOUR[i];
    const ring = ringRef.current;
    const card = cardRef.current;
    if (!ring || !card) return;
    const tgt = s.sel ? findTarget(s.sel) : null;
    if (tgt) {
      tgt.scrollIntoView({ block: "center", behavior: "smooth" });
      const r = tgt.getBoundingClientRect();
      const pad = 6;
      ring.style.display = "block";
      ring.style.left = `${r.left - pad}px`;
      ring.style.top = `${r.top - pad}px`;
      ring.style.width = `${r.width + pad * 2}px`;
      ring.style.height = `${r.height + pad * 2}px`;
      card.style.left = `${Math.min(window.innerWidth - 360, Math.max(16, r.right + 14))}px`;
      card.style.top = `${Math.max(16, r.top)}px`;
      card.style.transform = "none";
    } else {
      ring.style.display = "none";
      card.style.left = "50%";
      card.style.top = "50%";
      card.style.transform = "translate(-50%,-50%)";
    }
  }, [i]);

  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, place]);

  if (!open) return null;
  const s = TOUR[i];
  const dimmed = !s.sel;
  const last = i === TOUR.length - 1;

  return (
    <div className={"tourv" + (dimmed ? " dim" : "")} data-testid="tour" role="dialog" aria-label="Guided tour">
      <div className="tourmask" onClick={end} />
      <div className="tourring" ref={ringRef} />
      <div className="tourcard" ref={cardRef}>
        <div className="tourh">{s.title}</div>
        <div className="tourtext">{s.text}</div>
        <div className="tourdots">
          {TOUR.map((_, j) => (
            <span key={j} className={"tdot" + (j === i ? " on" : "")} />
          ))}
        </div>
        <div className="tourbtns">
          <button className="btn ghost" onClick={end}>
            Skip
          </button>
          <span className="spacer" />
          {i > 0 && (
            <button className="btn soft" onClick={() => setI((n) => n - 1)}>
              Back
            </button>
          )}
          {s.cta ? (
            <button
              className="btn primary"
              onClick={() => {
                navigate(s.cta!.to);
                end();
              }}
            >
              {s.cta.label}
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={() => (last ? end() : setI((n) => n + 1))}
            >
              {last ? "Done" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
