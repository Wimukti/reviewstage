import { useState } from "react";
import { Md } from "./Md";
import { cn } from "@/lib/utils";

// A markdown field with Preview (formatted) / Edit (code) tabs — ports the old md_editor.
// Utilities only: the mode switch is a small segmented pair, the editor a mono textarea (the
// one place outside code blocks where monospace is permitted), the preview a prose panel.
const MODE = "h-7 rounded-[5px] px-2.5 text-xs font-medium transition-colors";
export function MdEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  return (
    <div className="mt-2 max-w-[80ch]" data-testid="md-editor">
      <div className="mb-2 inline-flex gap-0.5 rounded-md bg-muted p-0.5" role="group" aria-label="Preview or edit">
        <button
          type="button"
          className={cn(MODE, !edit ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
          aria-pressed={!edit}
          onClick={() => setEdit(false)}
        >
          Preview
        </button>
        <button
          type="button"
          className={cn(MODE, edit ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
          aria-pressed={edit}
          onClick={() => setEdit(true)}
        >
          Edit
        </button>
      </div>
      {edit ? (
        <textarea
          className="fedit field-sizing-content min-h-[120px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Md className="min-h-[60px] rounded-md bg-background px-3 py-2 text-[15px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_pre]:my-2">
          {value || "_Nothing to preview._"}
        </Md>
      )}
    </div>
  );
}
