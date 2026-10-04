import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { Login } from "./Login";
import { PrPage } from "./PrPage";
import { Qa } from "./Qa";
import { CommandPalette } from "./CommandPalette";
import { Integrations } from "./Integrations";
import { Learnings } from "./Learnings";
import { Queue } from "./Queue";
import { Repos } from "./Repos";
import { Rollup } from "./Rollup";
import { Settings } from "./Settings";
import { PhoneShell, RunningBar, Sidebar } from "./Sidebar";
import { Skills } from "./Skills";
import { StackPage } from "./StackPage";
import { Tour } from "./Tour";
import { Welcome } from "./Welcome";
import { PageHeader } from "./ui";
import { navigate, useLocation } from "./router";
import { setRunning } from "./running";
import { applyTheme, useIsPhone } from "./theme";

function NotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <p className="text-sm text-muted-foreground">That page doesn't exist. Head back to your queue.</p>
    </>
  );
}

function Routed({ me, reload }: { me: Me; reload: () => Promise<unknown> }) {
  const { path } = useLocation();
  if (path === "/") return <Queue me={me} />;
  if (path.startsWith("/repos")) return <Repos me={me} reload={reload} />;
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

/**
 * Personal mode (`npx reviewstage`) has a first-run wizard at /welcome. While the install has
 * no signed-in user or no repository, every route but the wizard itself (and /login) goes
 * there; afterwards the wizard is still reachable but nothing redirects to it. Team installs
 * never redirect — the rule only reads `me.personal`.
 */
export function welcomeRedirect(me: Me, path: string): string | null {
  if (!me.personal) return null;
  if (path.startsWith("/welcome") || path === "/login") return null;
  const incomplete = !me.authed || !me.login || (me.repos || []).length === 0;
  return incomplete ? "/welcome" : null;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const phone = useIsPhone();
  const { path } = useLocation();
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

  // Sign out, then straight to where a different account signs in: the wizard in personal
  // mode (it re-runs from GitHub), the login page otherwise.
  const switchAccount = useCallback(async () => {
    const personal = !!me?.personal;
    try {
      await api.logout();
    } finally {
      navigate(personal ? "/welcome" : "/login");
      load();
    }
  }, [load, me?.personal]);

  const redirect = me ? welcomeRedirect(me, path) : null;
  useEffect(() => {
    if (redirect) navigate(redirect);
  }, [redirect]);

  if (!me) return <div className="min-h-dvh" />;
  if (redirect) return <div className="min-h-dvh" />;
  // The wizard is a focused flow: no sidebar, no tour, signed in or not.
  if (me.personal && path.startsWith("/welcome")) return <Welcome me={me} reload={load} />;
  if (!me.authed) return <Login me={me} onDone={load} />;

  // The shell: sidebar beside the page on the desktop, header above and tab bar below it on
  // the phone. The page keeps clear of the fixed tab bar with its bottom padding.
  return (
    <div className="flex min-h-dvh items-stretch bg-background max-[899px]:flex-col">
      <RunningBar />
      {phone ? <PhoneShell me={me} onSignOut={signOut} /> : <Sidebar me={me} onSignOut={signOut} onSwitchAccount={switchAccount} />}
      <main className="main min-w-0 flex-1">
        <div className="min-w-0 max-w-[960px] px-6 pb-14 pt-6 max-[899px]:px-4 max-[899px]:pb-[calc(80px+env(safe-area-inset-bottom,0px))] max-[899px]:pt-5">
          <Routed me={me} reload={load} />
        </div>
      </main>
      <CommandPalette me={me} />
      <Tour me={me} />
    </div>
  );
}
