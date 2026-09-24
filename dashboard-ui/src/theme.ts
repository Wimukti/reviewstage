// Theme: dark by default, light or the system preference as a per-device choice. The pin is a
// localStorage key rather than a user preference on the server because the shell has to apply
// it before the first paint (see index_html in bin/server.py) and because it is a property of
// the screen in front of you, not of your account — a dark laptop and a light desktop are both
// right. Every choice is stamped on <html data-theme>: "dark", "light", or "system" (the media
// query in tokens.css targets the last one), so nothing is ever the absence of an attribute.
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "rs-theme";
export const DEFAULT_THEME: ThemeChoice = "dark";
const EVT = "reviewstage:theme";

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "system" ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function resolvedTheme(choice = getTheme()): "light" | "dark" {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const PAPER = { light: "#F6F6F9", dark: "#0B0C10" };

export function applyTheme(choice = getTheme()): void {
  document.documentElement.setAttribute("data-theme", choice);
  const scheme = document.querySelector<HTMLMetaElement>("meta[name=color-scheme]");
  if (scheme) scheme.content = choice === "system" ? "light dark" : choice;
  const color = document.querySelector<HTMLMetaElement>("meta[name=theme-color]");
  if (color) color.content = PAPER[resolvedTheme(choice)];
}

export function setTheme(choice: ThemeChoice): void {
  try {
    // Dark is the default, so "system" has to be stored as a choice in its own right.
    if (choice === DEFAULT_THEME) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  applyTheme(choice);
  window.dispatchEvent(new Event(EVT));
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(getTheme);
  useEffect(() => {
    const on = () => setChoice(getTheme());
    window.addEventListener(EVT, on);
    window.addEventListener("storage", on);
    // A system change while "System" is chosen only needs the theme-color meta refreshed; the
    // CSS follows the media query by itself.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => applyTheme();
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener("storage", on);
      mq.removeEventListener("change", onMq);
    };
  }, []);
  return [choice, setTheme];
}

// True below the desktop breakpoint (design.md §6: the sidebar exists from 900px).
export function useIsPhone(): boolean {
  const q = "(max-width: 899px)";
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}
