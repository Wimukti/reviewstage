/* Mirrors Starlight's storage contract (localStorage["starlight-theme"]) so a choice on the
 * homepage carries into the docs and back — but with the app's semantics: dark is the default
 * when nothing is stored, and every choice is stamped on <html data-theme> as "dark", "light"
 * or "system" (never the resolved value), so the media query in tokens.css can target a
 * light-system machine. Starlight's own provider is replaced (components/starlight/ThemeProvider)
 * because it would re-stamp the resolved value. Legacy "" (Starlight's auto) still reads as auto. */
export type Theme = "auto" | "dark" | "light";
const storageKey = "starlight-theme";
const parseTheme = (v: unknown): Theme =>
  v === "light" || v === "dark" ? v : v === "auto" || v === "" ? "auto" : "dark";

export const loadTheme = (): Theme => {
  try { return parseTheme(localStorage.getItem(storageKey)); } catch { return "dark"; }
};
const storeTheme = (t: Theme) => {
  try { localStorage.setItem(storageKey, t); } catch { /* blocked storage */ }
};
const preferred = (): Exclude<Theme, "auto"> =>
  matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
export const resolveTheme = (t: Theme) => (t === "auto" ? preferred() : t);
/** The attribute value for a choice: "system" for auto, otherwise the choice itself. */
export const stampOf = (t: Theme) => (t === "auto" ? "system" : t);

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = stampOf(theme);
  document.documentElement.dataset.themePreference = theme;
  storeTheme(theme);
  for (const option of document.querySelectorAll<HTMLElement>("[data-theme-option]")) {
    option.setAttribute("aria-pressed", String(option.dataset.themeOption === theme));
  }
}

export function initTheme(): void {
  applyTheme(loadTheme());
  for (const option of document.querySelectorAll<HTMLElement>("[data-theme-option]")) {
    option.addEventListener("click", () => applyTheme(parseTheme(option.dataset.themeOption)));
  }
}
