// The personal-mode wizard's routing rules, kept free of components (and of the logo's SVG
// import) so a unit test can exercise them without a bundler. Re-exported by App.tsx and
// Welcome.tsx, which is where callers import them from.
import type { Me } from "./api";

export type StepIndex = 0 | 1 | 2;
// The privacy card sits after the three steps; it has no chip of its own.
export type WelcomeStep = StepIndex | 3;

export function welcomeStep(path: string): WelcomeStep {
  if (path.startsWith("/welcome/privacy")) return 3;
  if (path.startsWith("/welcome/repos")) return 2;
  if (path.startsWith("/welcome/claude")) return 1;
  return 0;
}

/**
 * Personal mode (`npx reviewstage`) has a first-run wizard at /welcome. While the install has
 * no signed-in user or no repository, every route but the wizard itself (and /login) goes
 * there; afterwards the wizard is still reachable but nothing redirects to it — except once,
 * for the one-time telemetry question, while the server reports it unanswered. Team installs
 * never redirect — the rule only reads `me.personal`.
 */
export function welcomeRedirect(me: Me, path: string): string | null {
  if (!me.personal) return null;
  if (path.startsWith("/welcome") || path === "/login") return null;
  const incomplete = !me.authed || !me.login || (me.repos || []).length === 0;
  if (incomplete) return "/welcome";
  // Older servers omit the flag, so they never redirect here.
  return me.telemetry_decided === false ? "/welcome/privacy" : null;
}
