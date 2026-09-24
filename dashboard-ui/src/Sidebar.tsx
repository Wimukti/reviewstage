import { useEffect, useRef, useState } from "react";
import type { Me } from "./api";
import { openPalette } from "./CommandPalette";
import { Icon, NavIcon } from "./icons";
import { Link, useLocation } from "./router";
import { useRunning } from "./running";
import { startTour } from "./Tour";
import { useTheme, type ThemeChoice } from "./theme";
import { Status } from "./ui";
import { Logo } from "./Logo";

// "How it works" lives on the site now (design.md: the app's copy duplicated the site's strip).
export const HOW_URL = "https://wimukti.github.io/reviewstage/#how-it-works";

// Two groups — what you do day to day, then what you configure once — separated by space alone.
const WORK: [string, string, string][] = [
  ["queue", "Queue", "/"],
  ["qa", "QA guides", "/qa"],
  ["learnings", "Learnings", "/learnings"],
  ["dashboard", "Insights", "/dashboard"],
];
const SETUP: [string, string, string][] = [
  ["skills", "Skills", "/skills"],
  ["integrations", "Integrations", "/integrations"],
  ["settings", "Settings", "/settings"],
];

function activeKey(path: string): string {
  if (path === "/") return "queue";
  if (path.startsWith("/qa")) return "qa";
  if (path.startsWith("/learnings")) return "learnings";
  if (path.startsWith("/dashboard")) return "dashboard";
  if (path.startsWith("/skills")) return "skills";
  if (path.startsWith("/integrations")) return "integrations";
  if (path.startsWith("/settings")) return "settings";
  if (path.startsWith("/pr") || path.startsWith("/stack")) return "queue";
  return "";
}

// What this user has in flight: one job links straight to it; several link to the queue
// filtered to running.
function useRunningLink() {
  const jobs = useRunning();
  if (jobs.length === 0) return null;
  const one = jobs.length === 1 ? jobs[0] : null;
  const kind = one?.kind === "qa" ? "QA guide" : "review";
  return {
    to: one ? one.href : "/?tab=all&running=1",
    title: one ? `${one.repo} #${one.num} — ${one.status}` : "Jump to what's running",
    text: one ? `1 ${kind} running` : `${jobs.length} jobs running`,
  };
}

// The running indicator: a 2px amber sweep fixed to the top of the viewport, on every width.
// The words are for screen readers (and the tooltip); the bar itself is the signal. Rendered
// once by App, above whichever shell is showing.
export function RunningBar() {
  const r = useRunningLink();
  if (!r) return null;
  return (
    <Link className="runbar" data-testid="running-bar" to={r.to} title={r.title}>
      <span className="vh" aria-live="polite">
        {r.text}
      </span>
    </Link>
  );
}

const THEMES: [ThemeChoice, string, string][] = [
  ["system", "System", "monitor"],
  ["light", "Light", "sun"],
  ["dark", "Dark", "moon"],
];

function ThemeControl() {
  const [choice, setChoice] = useTheme();
  return (
    <div className="seg themeseg" role="radiogroup" aria-label="Theme" data-testid="theme-control">
      {THEMES.map(([k, label, icon]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={choice === k}
          className={choice === k ? "on" : ""}
          data-theme-choice={k}
          onClick={() => setChoice(k)}
        >
          <Icon name={icon} />
          {label}
        </button>
      ))}
    </div>
  );
}

// Closes on an outside click or Escape.
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

// One row: avatar · login · Live/Dry run. On the desktop it ends in a More button whose menu
// holds the theme switch; on the phone the sheet shows the switch directly.
function AccountRow({ me, more }: { me: Me; more?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div className="acct" data-testid="account-card" ref={ref}>
      <span className="av" aria-hidden="true">{(me.login || "?").slice(0, 1).toUpperCase()}</span>
      <span className="nm">{me.login}</span>
      <Status
        kind={me.dry_run ? "dry" : "live"}
        title={me.dry_run ? "Dry run — nothing posts to GitHub" : "Live"}
      >
        {me.dry_run ? "Dry run" : "Live"}
      </Status>
      {more && (
        <>
          <button
            className="iconbtn sm"
            type="button"
            aria-label="More"
            aria-expanded={open}
            aria-haspopup="menu"
            data-testid="account-more"
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="more" />
          </button>
          {open && (
            <div className="moremenu" data-testid="more-menu">
              <div className="moremenu-l">Theme</div>
              <ThemeControl />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HelpMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div className="helpwrap" ref={ref}>
      <button className="so" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Help
      </button>
      {open && (
        <div className="helpmenu">
          <a className="helpitem" href={HOW_URL} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
            How it works
            <Icon name="external" />
          </a>
          <button
            className="helpitem"
            type="button"
            onClick={() => {
              setOpen(false);
              startTour();
            }}
          >
            Take a tour
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { path } = useLocation();
  const active = activeKey(path);
  return (
    <aside className="side">
      <Link className="brand" to="/">
        <Logo me={me} />
        <span className="n">{me.brand}</span>
      </Link>

      <button className="btn secondary reviewbtn" type="button" onClick={openPalette}>
        <span className="rb-label">Review a PR</span>
        <kbd className="rb-kbd">⌘K</kbd>
      </button>

      <nav className="nav" aria-label="Main">
        {[WORK, SETUP].map((g, i) => (
          <div className="navgroup" key={i}>
            {g.map(([k, label, to]) => (
              <Link
                key={k}
                to={to}
                className={"ni" + (active === k ? " on" : "")}
                aria-current={active === k ? "page" : undefined}
                data-tour={k}
              >
                {NavIcon[k]}
                <span>{label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidefoot">
        <AccountRow me={me} more />
        <div className="foota">
          <HelpMenu />
          <span className="spacer" />
          <button className="so" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}

// Phone (< 900px): a 56px header with the mark and the search, and a labelled four-tab bar.
// More opens a sheet with the rest of the navigation, the account row, the theme switch and
// Sign out. Every target is at least 44px.
const TABS: [string, string, string][] = [
  ["queue", "Queue", "/"],
  ["qa", "QA", "/qa"],
  ["skills", "Skills", "/skills"],
];
const MORE: [string, string, string][] = [
  ["learnings", "Learnings", "/learnings"],
  ["dashboard", "Insights", "/dashboard"],
  ["integrations", "Integrations", "/integrations"],
  ["settings", "Settings", "/settings"],
  ["devices", "Devices", "/settings#devices"],
];

export function PhoneShell({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { path } = useLocation();
  const active = activeKey(path);
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const inMore = MORE.some(([k]) => k === active);

  // The sheet closes on navigation and on Escape, and hands focus back to the More tab.
  useEffect(() => {
    if (!more) return;
    sheet.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMore(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      moreBtn.current?.focus();
    };
  }, [more]);
  useEffect(() => setMore(false), [path]);

  return (
    <>
      <header className="phone-head">
        <Link className="brand" to="/" aria-label={me.brand}>
          <Logo me={me} />
        </Link>
        <button className="iconbtn" type="button" aria-label="Review a PR" title="Review a PR" onClick={openPalette}>
          <Icon name="search" />
        </button>
      </header>

      <nav className="tabbar" aria-label="Main">
        {TABS.map(([k, label, to]) => (
          <Link key={k} to={to} className={active === k ? "on" : ""} aria-current={active === k ? "page" : undefined} data-tour={k}>
            {NavIcon[k]}
            <span>{label}</span>
          </Link>
        ))}
        <button
          ref={moreBtn}
          type="button"
          className={inMore ? "on" : ""}
          aria-expanded={more}
          aria-haspopup="dialog"
          data-testid="more-tab"
          onClick={() => setMore((o) => !o)}
        >
          <Icon name="more" />
          <span>More</span>
        </button>
      </nav>

      {more && (
        <>
          <div className="sheet-back" onClick={() => setMore(false)} />
          <div className="sheet" role="dialog" aria-label="More" ref={sheet} data-testid="more-sheet">
            <div className="sheet-h">
              <span>More</span>
              <button className="iconbtn" type="button" aria-label="Close" onClick={() => setMore(false)}>
                <Icon name="x" />
              </button>
            </div>
            {MORE.map(([k, label, to]) => (
              <Link key={k} to={to} className={"ni" + (active === k ? " on" : "")} data-tour={k}>
                {NavIcon[k]}
                <span>{label}</span>
              </Link>
            ))}
            <a className="ni" href={HOW_URL} target="_blank" rel="noopener">
              {NavIcon.how}
              <span>How it works</span>
            </a>
            <button
              className="ni"
              type="button"
              onClick={() => {
                setMore(false);
                startTour();
              }}
            >
              <Icon name="compass" />
              <span>Take a tour</span>
            </button>
            <div className="sheet-theme">
              <span className="moremenu-l">Theme</span>
              <ThemeControl />
            </div>
            <AccountRow me={me} />
            <div className="foota">
              <span className="spacer" />
              <button className="so" type="button" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
