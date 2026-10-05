import { useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import { dismissVersion, dismissedVersion, updateBridge, useUpdate, refreshUpdate } from "./desktop";
import { Button } from "@/components/ui/button";

// The desktop app's update banner (openspec/changes/desktop-always-on F4): one slim line at the
// top of the shell when a newer version is published. "Restart to update" starts the new version
// and quits this one; the new one opens on the same data. Dismissed for that version only.
export function UpdateBanner() {
  const u = useUpdate();
  const [dismissed, setDismissed] = useState(dismissedVersion);
  const [error, setError] = useState("");
  const bridge = updateBridge();
  if (!bridge || !u?.available || !u.latest) return null;
  if (dismissed === u.latest && !u.installing) return null;

  const install = async () => {
    setError("");
    try {
      const r = await bridge.install();
      if (!r.ok) setError(r.error || "The update could not be started.");
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      void refreshUpdate();
    }
  };
  const failed = error || u.installError;

  return (
    <div
      className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-primary/10 px-6 py-1.5 text-sm max-[899px]:px-4"
      role="status"
      data-testid="update-banner"
    >
      <ArrowUpCircle aria-hidden="true" className="size-4 shrink-0 text-primary" />
      <span className="min-w-0">
        ReviewStage <b className="font-semibold">{u.latest}</b> is available
      </span>
      <span aria-hidden="true" className="text-muted-foreground">·</span>
      <Button variant="link" size="sm" type="button" className="h-auto p-0 text-sm" disabled={u.installing} onClick={() => void install()} data-testid="update-install">
        {u.installing ? "Restarting…" : "Restart to update"}
      </Button>
      {failed && (
        <span className="text-xs text-red" data-testid="update-error">
          Couldn't start the update: {failed}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="ml-auto size-7"
        aria-label={`Dismiss — remind me about the next version`}
        onClick={() => {
          dismissVersion(u.latest || "");
          setDismissed(u.latest || "");
        }}
        data-testid="update-dismiss"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
