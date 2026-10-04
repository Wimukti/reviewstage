import type { LucideIcon } from "lucide-react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice } from "./theme";
import { cn } from "@/lib/utils";

const THEMES: [ThemeChoice, string, LucideIcon][] = [
  ["system", "System", Monitor],
  ["light", "Light", Sun],
  ["dark", "Dark", Moon],
];

// Theme as a three-way segmented control (a radio group, so the choice is `aria-checked`).
// Settings → Appearance shows it at control height; the phone's More sheet at 44px targets.
export function ThemeControl({ tall, className }: { tall?: boolean; className?: string }) {
  const [choice, setChoice] = useTheme();
  return (
    <div
      className={cn("grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-[3px]", tall ? "w-full" : "w-fit", className)}
      role="radiogroup"
      aria-label="Theme"
      data-testid="theme-control"
    >
      {THEMES.map(([k, label, Glyph]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={choice === k}
          data-theme-choice={k}
          onClick={() => setChoice(k)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-all outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
            tall ? "h-[44px]" : "h-8",
            choice === k && "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30",
          )}
        >
          <Glyph aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
