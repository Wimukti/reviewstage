import { useEffect, useState } from "react";
import { appShortcutBridge, openAtLoginBridge, refreshUpdate, updateBridge, useUpdate, whenText, type AppShortcut, type OpenAtLogin } from "./desktop";
import { SettingRow, StatusBadge } from "./ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

// Settings → Desktop app (openspec/changes/desktop-always-on F2 + F4): the running version and
// its update state, and open at login. The section header carries the title; this is the card.
export function DesktopApp() {
  const update = updateBridge();
  const login = openAtLoginBridge();
  const u = useUpdate();
  const [checking, setChecking] = useState(false);
  const [installErr, setInstallErr] = useState("");
  const [auto, setAuto] = useState<OpenAtLogin | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const apps = appShortcutBridge();
  const [shortcut, setShortcut] = useState<AppShortcut | null>(null);
  const [shortcutBusy, setShortcutBusy] = useState(false);
  useEffect(() => {
    if (!apps) return;
    apps.status().then(setShortcut, () => setShortcut(null));
  }, [apps]);
  const toggleShortcut = async (on: boolean) => {
    if (!apps) return;
    setShortcutBusy(true);
    try {
      setShortcut(await apps.set(on));
    } finally {
      setShortcutBusy(false);
    }
  };

  useEffect(() => {
    if (!login) return;
    login.status().then(setAuto, () => setAuto(null));
  }, [login]);

  const check = async () => {
    setChecking(true);
    try {
      await refreshUpdate(true);
    } finally {
      setChecking(false);
    }
  };
  const install = async () => {
    setInstallErr("");
    const r = await update!.install().catch((e: Error) => ({ ok: false, error: e.message }));
    if (!r.ok) setInstallErr(r.error || "The update could not be started.");
    void refreshUpdate();
  };
  const toggle = async (on: boolean) => {
    if (!login) return;
    setAutoBusy(true);
    try {
      setAuto(await login.set(on));
    } finally {
      setAutoBusy(false);
    }
  };

  const status = !u ? null : u.dev ? (
    <StatusBadge tone="graphite" icon={null}>Development build</StatusBadge>
  ) : u.available ? (
    <StatusBadge tone="blue">{u.latest} available</StatusBadge>
  ) : u.error ? (
    <StatusBadge tone="amber">Couldn't check</StatusBadge>
  ) : u.checkedAt ? (
    <StatusBadge tone="green">Up to date</StatusBadge>
  ) : null;

  return (
    <Card className="gap-0 py-0" data-testid="desktop-app">
      <CardContent className="divide-y divide-border px-5 py-0">
        {update && (
          <SettingRow
            label="Version"
            hint={
              <>
                <span className="flex min-w-0 flex-wrap items-center gap-2" data-testid="desktop-version">
                  <code>{u?.current ?? "…"}</code>
                  {status}
                </span>
                <span className="mt-1.5 block" data-testid="desktop-checked">
                  {u?.dev
                    ? "Updates are offered to published versions; this one runs from a checkout."
                    : u?.error
                      ? `${u.error}. Last checked ${whenText(u.checkedAt)}.`
                      : `Checked at launch and every 6 hours. Last checked ${whenText(u?.checkedAt ?? null)}.`}
                </span>
                {(installErr || u?.installError) && (
                  <span className="mt-1.5 block text-red" role="alert">Couldn't start the update: {installErr || u?.installError}</span>
                )}
              </>
            }
          >
            {u?.available && (
              <Button type="button" size="sm" disabled={u.installing} onClick={() => void install()} data-testid="desktop-install">
                {u.installing ? "Restarting…" : "Restart to update"}
              </Button>
            )}
            <Button variant="secondary" size="sm" type="button" disabled={checking} onClick={() => void check()} data-testid="desktop-check">
              {checking ? "Checking…" : "Check now"}
            </Button>
          </SettingRow>
        )}
        {login && (
          <SettingRow
            label="Open at login"
            htmlFor="open-at-login"
            hint={
              <>
                {!auto?.supported && auto
                  ? "Available on macOS and Linux."
                  : auto && !auto.available
                    ? "Start ReviewStage with npx reviewstage to turn this on."
                    : "Starts ReviewStage in the menu bar when you log in, on the newest version."}
                {auto?.error && <span className="mt-1.5 block text-red" role="alert">{auto.error}</span>}
              </>
            }
          >
            <Switch
              id="open-at-login"
              checked={!!auto?.enabled}
              disabled={!auto || !auto.supported || (!auto.available && !auto.enabled) || autoBusy}
              onCheckedChange={(on) => void toggle(on)}
              data-testid="open-at-login"
            />
          </SettingRow>
        )}
        {apps && (
          <SettingRow
            label="Show in Applications"
            htmlFor="app-shortcut"
            hint={
              <>
                {!shortcut?.supported && shortcut
                  ? "Available on macOS and Linux."
                  : shortcut && !shortcut.available && !shortcut.installed
                    ? "Start ReviewStage with npx reviewstage to turn this on."
                    : "So Spotlight, Launchpad and your app launcher find ReviewStage. It opens the newest version."}
                {shortcut?.error && <span className="mt-1.5 block text-red" role="alert">{shortcut.error}</span>}
              </>
            }
          >
            <Switch
              id="app-shortcut"
              checked={!!shortcut?.installed}
              disabled={!shortcut || !shortcut.supported || (!shortcut.available && !shortcut.installed) || shortcutBusy}
              onCheckedChange={(on) => void toggleShortcut(on)}
              data-testid="app-shortcut"
            />
          </SettingRow>
        )}
        <SettingRow
          label="Closing the window"
          hint="ReviewStage keeps running in the menu bar, so phone access and review notifications keep working. Quit it from the menu bar icon."
        />
      </CardContent>
    </Card>
  );
}
