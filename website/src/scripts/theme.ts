/* Mirrors Starlight's contract (localStorage["starlight-theme"] = "light" | "dark" | "" for
 * auto) so a choice on the homepage carries into the docs and back. */
export type Theme = "auto" | "dark" | "light";
const storageKey = "starlight-theme";
const order: Theme[] = ["light", "dark", "auto"];
const parseTheme = (v: unknown): Theme => (v === "auto" || v === "dark" || v === "light" ? v : "auto");

export const loadTheme = (): Theme => {
  try { return parseTheme(localStorage.getItem(storageKey)); } catch { return "auto"; }
};
const storeTheme = (t: Theme) => {
  try { localStorage.setItem(storageKey, t === "auto" ? "" : t); } catch { /* blocked storage */ }
};
const preferred = (): Exclude<Theme, "auto"> =>
  matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
export const resolveTheme = (t: Theme) => (t === "auto" ? preferred() : t);

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme);
  document.documentElement.dataset.themePreference = theme;
  storeTheme(theme);
  for (const control of document.querySelectorAll<HTMLElement>("[data-theme-switch]")) {
    control.style.setProperty("--switch-index", String(order.indexOf(theme)));
    for (const option of control.querySelectorAll<HTMLElement>("[data-theme-option]")) {
      option.setAttribute("aria-pressed", String(option.dataset.themeOption === theme));
    }
  }
}

export function initTheme(): void {
  applyTheme(loadTheme());
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (loadTheme() === "auto") applyTheme("auto");
  });
  for (const option of document.querySelectorAll<HTMLElement>("[data-theme-option]")) {
    option.addEventListener("click", () => applyTheme(parseTheme(option.dataset.themeOption)));
  }
}
