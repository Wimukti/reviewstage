// The thin chrome above every stage frame: a graphite status dot and the PR's name in mono,
// with room on the right for one control. Same `.status` dot-and-word as everywhere else.
import type { ReactNode } from "react";

export function FrameBar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="frame-bar">
      <span className="status frame-title">
        <i aria-hidden="true" />
        <span className="frame-mono">{title}</span>
      </span>
      {children}
    </div>
  );
}
