// The thin chrome above every stage frame: the stop's state as the app's own StatusBadge, with
// room on the right for one control. A card-toned bar over the canvas-toned stage: two tones,
// so no line between them.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { StatusBadge, type Tone } from "@app/ui";

export function FrameBar({
  kind = "",
  tone,
  icon,
  title,
  children,
}: {
  kind?: string;
  tone?: Tone;
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="frame-bar flex min-h-10 items-center justify-between gap-3 bg-card px-3 py-1.5 max-sm:min-h-[52px]">
      <StatusBadge kind={kind} tone={tone} icon={icon} className="frame-title">
        {title}
      </StatusBadge>
      {children}
    </div>
  );
}
