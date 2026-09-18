// The contrast rule from design.md §1: every text token reaches 4.5:1 (WCAG AA) on both the
// page and the panel surface in its own theme, and text on a blue fill reaches it on the fill.
// Read straight from tokens.css so the test can never drift from what ships.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `tokens.css has no ${selector} block`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TEXT = ["ink", "graphite", "blue", "amber", "red", "green"];
const THEMES: [string, string][] = [
  ["light", ":root {"],
  ["dark", ':root[data-theme="dark"]'],
  ["dark (system)", ":root:not([data-theme=\"light\"])"],
];

for (const [name, sel] of THEMES) {
  const t = block(sel);
  test(`${name}: every text token reaches 4.5:1 on paper and panel`, () => {
    for (const tok of TEXT) {
      for (const surface of ["paper", "panel"]) {
        const ratio = contrast(t[tok], t[surface]);
        assert.ok(ratio >= 4.5, `${name} --${tok} ${t[tok]} on --${surface} ${t[surface]} = ${ratio.toFixed(2)}`);
      }
    }
  });
  test(`${name}: blue-ink reaches 4.5:1 on blue`, () => {
    const ratio = contrast(t["blue-ink"], t.blue);
    assert.ok(ratio >= 4.5, `${name} --blue-ink on --blue = ${ratio.toFixed(2)}`);
  });
}

test("the pinned dark block and the system dark block are the same palette", () => {
  assert.deepEqual(block(':root[data-theme="dark"]'), block(":root:not([data-theme=\"light\"])"));
});
