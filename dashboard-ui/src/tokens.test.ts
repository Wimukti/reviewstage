// The contrast rule from design.md §1 and §9: every text token reaches 4.5:1 (WCAG AA) on the
// page, the panel and the raised surface in its own theme; text on a blue fill reaches it on
// the fill; and ink and graphite still reach it over a panel lit by the stage light at its
// maximum alpha. Read straight from tokens.css so the test can never drift from what ships.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, "tokens.css"), "utf8");

type RGB = [number, number, number];
type Block = { hex: Record<string, string>; rgba: Record<string, [number, number, number, number]> };

function block(selector: string): Block {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `tokens.css has no ${selector} block`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const hex: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) hex[m[1]] = m[2];
  const rgba: Block["rgba"] = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*rgba\((\d+),(\d+),(\d+),(\.\d+|\d\.\d+|\d)\)/g)) {
    rgba[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  }
  return { hex, rgba };
}

const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function luminance(c: RGB): number {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
// Source-over compositing of an rgba light on an opaque surface: what the eye sees at the top
// of a lit card head, where the gradient is at full strength.
function blend(surface: string, light: [number, number, number, number]): string {
  const s = toRgb(surface);
  const [r, g, b, a] = light;
  return toHex([s[0] + a * (r - s[0]), s[1] + a * (g - s[1]), s[2] + a * (b - s[2])]);
}

const TEXT = ["ink", "graphite", "blue", "amber", "red", "green"];
const SURFACES = ["paper", "panel", "raised"];
const THEMES: [string, string][] = [
  ["dark", ":root {"],
  ["light", ':root[data-theme="light"]'],
  ["light (system)", ':root[data-theme="system"]'],
];

for (const [name, sel] of THEMES) {
  const t = block(sel);
  test(`${name}: every text token reaches 4.5:1 on paper, panel and raised`, () => {
    for (const tok of TEXT) {
      for (const surface of SURFACES) {
        const ratio = contrast(t.hex[tok], t.hex[surface]);
        assert.ok(ratio >= 4.5, `${name} --${tok} ${t.hex[tok]} on --${surface} ${t.hex[surface]} = ${ratio.toFixed(2)}`);
      }
    }
  });
  test(`${name}: blue-ink reaches 4.5:1 on blue`, () => {
    const ratio = contrast(t.hex["blue-ink"], t.hex.blue);
    assert.ok(ratio >= 4.5, `${name} --blue-ink on --blue = ${ratio.toFixed(2)}`);
  });
  test(`${name}: ink and graphite reach 4.5:1 over a panel lit by --light at full alpha`, () => {
    assert.ok(t.rgba.light, `${name} declares --light as rgba()`);
    const lit = blend(t.hex.panel, t.rgba.light);
    for (const tok of ["ink", "graphite"]) {
      const ratio = contrast(t.hex[tok], lit);
      assert.ok(ratio >= 4.5, `${name} --${tok} ${t.hex[tok]} on lit panel ${lit} = ${ratio.toFixed(2)}`);
    }
  });
  test(`${name}: the light is light, not a colour — no --light token is opaque`, () => {
    for (const k of ["light", "light-strong"]) {
      assert.ok(t.rgba[k], `${name} declares --${k} as rgba()`);
      assert.ok(t.rgba[k][3] < 0.5, `${name} --${k} alpha ${t.rgba[k][3]} should stay well under opaque`);
    }
  });
}

test("the pinned light block and the system light block are the same palette", () => {
  assert.deepEqual(block(':root[data-theme="light"]'), block(':root[data-theme="system"]'));
});

test("dark is the default: :root declares color-scheme: dark", () => {
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  assert.match(root, /color-scheme:\s*dark/);
});

test("the site's copy of tokens.css is byte-identical", () => {
  const site = readFileSync(join(HERE, "..", "..", "website", "src", "styles", "tokens.css"), "utf8");
  assert.equal(site, css);
});
