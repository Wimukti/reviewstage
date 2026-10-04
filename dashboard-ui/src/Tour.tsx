import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, type Me } from "./api";
import { Link } from "./router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverAnchor } from "@/components/ui/popover";
import {
  Dialog as DialogPrimitive,
  Popover as PopoverPrimitive,
} from "radix-ui";

interface TourStep {
  sel?: string;
  title: string;
  text: string;
  cta?: { label: string; to: string };
}

const TOUR: TourStep[] = [
  {
    title: "Welcome to ReviewStage",
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
    title: "You're set",
    text: "Open a PR from your queue to run your first review. You stay the reviewer — ReviewStage just does the reading and drafting.",
    cta: { label: "Go to Integrations", to: "/integrations" },
  },
];

const EVT = "reviewstage:start-tour";
// The queue renders after its data loads, so the auto-start waits for the target this long.
const AUTO_START_SEL = '[data-tour="queue"]';
const AUTO_START_WAIT_MS = 5000;
const CARD_W = 340;
const CARD_H_GUESS = 240;
const GAP = 14;

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
function whenPresent(
  sel: string,
  ms: number,
): { promise: Promise<boolean>; cancel: () => void } {
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

// Fire from anywhere (e.g. the sidebar) to (re)open the tour. `returnTo` is where focus goes
// when it ends; by default, whatever had focus when it started — which is wrong when that was
// a menu item that closes with its menu.
export function startTour(returnTo?: HTMLElement | null) {
  window.dispatchEvent(
    new CustomEvent(EVT, { detail: { returnTo: returnTo ?? null } }),
  );
}

type Side = "top" | "right" | "bottom" | "left";
type Ring = { left: number; top: number; width: number; height: number } | null;

export function Tour({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  // Whether this person has seen it. The flag lives on the user record, not in localStorage:
  // that was per BROWSER, so the second person to sign in on a shared box never saw the tour,
  // and the same person on a new laptop saw it again. Held here as well so dismissing it takes
  // effect immediately rather than on the next /api/me.
  const [seen, setSeen] = useState(me.tour_seen !== false);
  // Where the ring sits (null: the step has no target and the card is centred) and which side
  // of it the card goes; Radix does the exact placement and the collision shifting.
  const [ring, setRing] = useState<Ring>(null);
  const [side, setSide] = useState<Side>("right");
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // Whatever had focus when the tour opened gets it back when it closes.
  const trigger = useRef<HTMLElement | null>(null);

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
    const onStart = (e?: Event) => {
      const returnTo = (
        e as CustomEvent<{ returnTo?: HTMLElement | null }> | undefined
      )?.detail?.returnTo;
      trigger.current =
        returnTo ?? (document.activeElement as HTMLElement | null);
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
        if (ok) t = window.setTimeout(() => onStart(), 450);
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

  // Put the ring on the current step's target and pick the card's side. The card never covers
  // what it points at: on the phone the target is scrolled to start beneath where the card
  // will sit and the card goes above it; on the desktop it goes to the right of the target
  // when there is room, otherwise below, otherwise above.
  const place = useCallback(() => {
    const s = TOUR[i];
    const tgt = s.sel ? findTarget(s.sel) : null;
    if (!tgt) {
      setRing(null);
      return;
    }
    const phone = window.innerWidth < 900;
    const pad = 6;
    const cardH = cardRef.current?.offsetHeight || CARD_H_GUESS;
    if (phone) {
      const under = 16 + cardH + GAP + pad;
      window.scrollBy({
        top: tgt.getBoundingClientRect().top - under,
        behavior: "auto",
      });
    } else {
      tgt.scrollIntoView({ block: "center", behavior: "auto" });
    }
    const r = tgt.getBoundingClientRect();
    setRing({
      left: r.left - pad,
      top: r.top - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    });
    if (phone) {
      setSide("top");
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (r.right + GAP + CARD_W <= vw - 16) setSide("right");
    else if (r.bottom + GAP + cardH <= vh - 16) setSide("bottom");
    else setSide("top");
  }, [i]);

  // Before paint, so a step never flashes centred before its ring and card land.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    // place() measures the card BEFORE this step's content has rendered, so on the phone a
    // step with a taller card than the last scrolled the target too little and the card's
    // bottom edge sat on it. One corrective pass after paint, from the real rectangles.
    const raf = requestAnimationFrame(() => {
      if (window.innerWidth >= 900) return;
      const s = TOUR[i];
      const tgt = s.sel ? findTarget(s.sel) : null;
      const card = cardRef.current;
      if (!tgt || !card) return;
      const c = card.getBoundingClientRect();
      const t = tgt.getBoundingClientRect();
      const overlap = c.bottom + GAP - t.top;
      if (overlap > 0) {
        window.scrollBy({ top: -overlap, behavior: "auto" });
        place();
      }
    });
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
    };
  }, [open, place, i]);

  // Focus lands on Next (Radix traps it inside the dialog and handles Tab). `ring` is a
  // dependency because the card remounts inside the popover once the ring is placed.
  useEffect(() => {
    if (!open) return;
    nextRef.current?.focus();
  }, [open, i, ring]);

  if (!open) return null;
  const s = TOUR[i];
  const dimmed = !s.sel || !ring;
  const last = i === TOUR.length - 1;

  const card = (
    <Card
      ref={cardRef}
      className="tourcard w-[340px] max-w-[calc(100vw-32px)] gap-0 rounded-xl bg-popover py-0 shadow-xl"
    >
      <CardContent className="px-4 py-4">
        <DialogPrimitive.Title className="text-sm font-medium">
          {s.title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-1 mb-0 text-sm leading-relaxed text-muted-foreground">
          {s.text}
        </DialogPrimitive.Description>
        <div className="my-3 flex gap-1.5" aria-hidden="true">
          {TOUR.map((_, j) => (
            <span
              key={j}
              className={cn(
                "size-1.5 rounded-full",
                j === i ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="text-muted-foreground"
            onClick={end}
          >
            Skip
          </Button>
          <span className="flex-1" />
          {i > 0 && (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setI((n) => n - 1)}
            >
              Back
            </Button>
          )}
          {/* The tour ends where it started; the CTA is an offer, not the exit. */}
          {s.cta && (
            <Button
              asChild
              variant="secondary"
              size="sm"
              className="hover:no-underline"
            >
              <Link to={s.cta.to} onClick={end}>
                {s.cta.label}
              </Link>
            </Button>
          )}
          <Button
            ref={nextRef}
            size="sm"
            type="button"
            onClick={() => (last ? end() : setI((n) => n + 1))}
          >
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    // A Radix dialog (role, aria-modal, focus trap, Escape); the mask, ring and card are its content.
    <DialogPrimitive.Root open modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={rootRef}
          data-testid="tour"
          aria-label="Guided tour"
          aria-modal="true"
          className="fixed inset-0 z-[70] outline-hidden"
          // Portals mount a render after `open`, so focus is placed here, once the card exists.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            nextRef.current?.focus();
          }}
          // Focus goes back to whatever opened the tour once the focus trap is down; moving it
          // from end() would be undone by the trap, which is still up while the dialog closes.
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            end();
          }}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div
            className={cn("absolute inset-0", dimmed && "bg-background/70")}
            onClick={end}
          />
          {ring ? (
            <Popover open modal={false}>
              <PopoverAnchor asChild>
                <div
                  className="pointer-events-none absolute rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background"
                  style={{
                    left: ring.left,
                    top: ring.top,
                    width: ring.width,
                    height: ring.height,
                  }}
                />
              </PopoverAnchor>
              {/* Composed from the primitive: the shadcn wrapper does not expose the portal's
              container, and the card has to live inside this dialog for the focus trap. */}
              <PopoverPrimitive.Portal container={rootRef.current}>
                <PopoverPrimitive.Content
                  side={side}
                  align="start"
                  sideOffset={GAP}
                  collisionPadding={16}
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    nextRef.current?.focus();
                  }}
                  // Focus goes back to whatever opened the tour once the focus trap is down; moving it
          // from end() would be undone by the trap, which is still up while the dialog closes.
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
                  onInteractOutside={(e) => e.preventDefault()}
                  onEscapeKeyDown={(e) => e.preventDefault()}
                  className="z-50 outline-hidden"
                >
                  {card}
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </Popover>
          ) : (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              {card}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
