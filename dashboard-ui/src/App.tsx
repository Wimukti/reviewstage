import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { Login } from "./Login";
import { PrPage } from "./PrPage";
import { Qa } from "./Qa";
import { CommandPalette } from "./CommandPalette";
import { Integrations } from "./Integrations";
import { Learnings } from "./Learnings";
import { Queue } from "./Queue";
import { Rollup } from "./Rollup";
import { Settings } from "./Settings";
import { PhoneShell, RunningBar, Sidebar } from "./Sidebar";
import { Skills } from "./Skills";
import { StackPage } from "./StackPage";
import { Tour } from "./Tour";
import { useLocation } from "./router";
import { setRunning } from "./running";
import { applyTheme, useIsPhone } from "./theme";

function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p className="muted">That page doesn't exist. Head back to your queue.</p>
    </>
  );
}

function Routed({ me }: { me: Me }) {
  const { path } = useLocation();
  if (path === "/") return <Queue me={me} />;
  if (path.startsWith("/pr")) return <PrPage me={me} />;
  if (path.startsWith("/qa")) return <Qa me={me} />;
  if (path.startsWith("/skills")) return <Skills />;
  if (path.startsWith("/stack")) return <StackPage />;
  if (path.startsWith("/integrations")) return <Integrations me={me} />;
  if (path.startsWith("/settings")) return <Settings me={me} />;
  if (path.startsWith("/learnings")) return <Learnings me={me} />;
  if (path.startsWith("/dashboard")) return <Rollup />;
  return <NotFound />;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const phone = useIsPhone();
  // The shell applied the pinned theme before first paint; re-applying here keeps the meta
  // tags in step if the bundle and the shell ever disagree.
  useEffect(() => applyTheme(), []);
  // /api/me carries this user's in-flight jobs; hand them to the store so the sidebar has
  // them from the first paint and the poller only starts when there is something to watch.
  const load = useCallback(
    () =>
      api.me().then((m) => {
        setMe(m);
        setRunning(m.running);
      }),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const signOut = useCallback(async () => {
    // Even a failed logout must not leave the UI hanging — reloading /api/me shows the truth.
    try {
      await api.logout();
    } finally {
      load();
    }
  }, [load]);

  if (!me) return <div className="boot" />;
  if (!me.authed) return <Login me={me} onDone={load} />;

  return (
    <div className="app">
      <RunningBar />
      {phone ? <PhoneShell me={me} onSignOut={signOut} /> : <Sidebar me={me} onSignOut={signOut} />}
      <main className="main">
        <div className="wrap">
          <Routed me={me} />
        </div>
      </main>
      <CommandPalette me={me} />
      <Tour me={me} />
    </div>
  );
}
