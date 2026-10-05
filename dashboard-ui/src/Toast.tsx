// The phone's one transient message: a pill above the tab bar ("Archived #38850 · Undo",
// "Review started"). One at a time; a new one replaces the last. Rendered by the phone shell,
// shown from anywhere with showToast(). Polite live region, so VoiceOver reads it once.
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type ToastAction = { label: string; run: () => void };
export type ToastSpec = { text: string; tone?: "default" | "err"; action?: ToastAction; ms?: number };
type Live = ToastSpec & { id: number };

let current: Live | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function showToast(t: ToastSpec): number {
  current = { ...t, id: ++seq };
  emit();
  return current.id;
}

export function dismissToast(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

export function Toaster() {
  const t = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
  useEffect(() => {
    if (!t) return;
    const h = window.setTimeout(() => dismissToast(t.id), t.ms ?? (t.action ? 5000 : 3000));
    return () => window.clearTimeout(h);
  }, [t]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="rs-toaster pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 bottom-[calc(49px+env(safe-area-inset-bottom,0px)+12px-var(--ios-gap,0px))]"
    >
      {t && (
        <div
          key={t.id}
          data-testid="toast"
          className={cn(
            "pointer-events-auto flex min-h-[48px] max-w-[440px] items-center gap-3 rounded-full bg-popover py-1.5 pl-5 pr-1.5 text-[15px] text-foreground shadow-xl ring-1 ring-border motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2",
            t.tone === "err" && "ring-red/50",
            !t.action && "pr-5",
          )}
        >
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.action && (
            <Button
              type="button"
              variant="ghost"
              data-testid="toast-action"
              className="h-[40px] rounded-full px-4 text-[15px] font-semibold text-primary hover:bg-accent hover:text-primary"
              onClick={() => {
                const a = t.action!;
                dismissToast(t.id);
                a.run();
              }}
            >
              {t.action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
