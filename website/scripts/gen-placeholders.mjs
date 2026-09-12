// Generates placeholder screenshots so the site builds before real captures exist.
// Any file that already exists is left alone — drop a real PNG in and it wins.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../src/assets/screenshots");
mkdirSync(dir, { recursive: true });

const shots = [
  ["hero", "PR page — findings staged, nothing posted"],
  ["gate", "Post to GitHub — a plain COMMENT review"],
  ["staging", "Findings — tick, edit, explain, suggestion block"],
  ["run", "Run form — effort, model, focus note"],
  ["team", "Queue — per-reviewer tabs and Slack card"],
  ["learnings", "Skills — keep-rate per skill, revision history"],
  ["qa", "QA guide — P0 / P1 / P2 test cases"],
];
const themes = {
  dark: { bg: "#26231f", panel: "#2d2a25", line: "#3a362f", fg: "#e9e4d8", muted: "#9c968a", accent: "#e0855e" },
  light: { bg: "#faf8f3", panel: "#f1ede4", line: "#dcd6c9", fg: "#3b362d", muted: "#847d70", accent: "#c8643f" },
};
const W = 1600, H = 1000;

function svg(label, t) {
  const rows = Array.from({ length: 6 }, (_, i) =>
    `<rect x="380" y="${250 + i * 110}" width="${900 - (i % 3) * 120}" height="70" rx="12" fill="${t.panel}" stroke="${t.line}"/>
     <rect x="404" y="${274 + i * 110}" width="22" height="22" rx="5" fill="none" stroke="${i < 4 ? t.accent : t.line}" stroke-width="2"/>
     ${i < 4 ? `<path d="M409 ${285 + i * 110} l5 5 8-9" fill="none" stroke="${t.accent}" stroke-width="2.5"/>` : ""}
     <rect x="450" y="${278 + i * 110}" width="${360 - (i % 2) * 80}" height="14" rx="7" fill="${t.muted}" opacity=".7"/>
     <rect x="450" y="${302 + i * 110}" width="${560 - (i % 3) * 100}" height="10" rx="5" fill="${t.muted}" opacity=".35"/>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  <rect x="0" y="0" width="300" height="${H}" fill="${t.panel}"/>
  <rect x="24" y="28" width="150" height="26" rx="8" fill="${t.accent}" opacity=".9"/>
  ${[0,1,2,3,4,5].map(i => `<rect x="24" y="${100 + i * 46}" width="${180 - (i%2)*40}" height="14" rx="7" fill="${t.muted}" opacity="${i===1?0.9:0.4}"/>`).join("")}
  <rect x="380" y="60" width="700" height="34" rx="8" fill="${t.fg}" opacity=".85"/>
  <rect x="380" y="112" width="440" height="16" rx="8" fill="${t.muted}" opacity=".5"/>
  <rect x="380" y="170" width="1120" height="1" fill="${t.line}"/>
  ${rows}
  <rect x="380" y="920" width="1120" height="50" rx="12" fill="${t.panel}" stroke="${t.line}"/>
  <rect x="1300" y="932" width="180" height="26" rx="8" fill="${t.accent}"/>
  <text x="800" y="${H - 40}" text-anchor="middle" font-family="ui-sans-serif, system-ui" font-size="26" fill="${t.muted}">PLACEHOLDER · ${label}</text>
</svg>`;
}

for (const [name, label] of shots) {
  for (const [theme, t] of Object.entries(themes)) {
    const out = join(dir, `${name}-${theme}.png`);
    if (existsSync(out)) continue;
    const png = await sharp(Buffer.from(svg(label, t))).png().toBuffer();
    writeFileSync(out, png);
    console.log("placeholder →", out);
  }
}
