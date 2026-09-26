/* One copy handler for every `[data-copy]` button on the page: writes the attribute's text to
 * the clipboard, flips `data-done` for 1.2 s, and swaps a `[data-copy-label]` child to "Copied"
 * for the same window so the Install button can say so in words. */
export function initCopy(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const label = b.querySelector<HTMLElement>("[data-copy-label]");
    const text = label?.textContent ?? "";
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy ?? "");
      } catch {
        return;
      }
      b.dataset.done = "1";
      if (label) label.textContent = "Copied";
      window.setTimeout(() => {
        delete b.dataset.done;
        if (label) label.textContent = text;
      }, 1200);
    });
  }
}
