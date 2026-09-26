// Renders the favicon set and the social image from assets/logo.svg into public/.
// favicon.ico (16/32/48, PNG-in-ICO), favicon-192.png, favicon-512.png, apple-touch-icon.png
// (180, mark on paper) and og.png (1200×630: mark, wordmark, descriptor on the dark paper).
// Runs in `pnpm build`; `pnpm brand` runs it alone. Everything is overwritten each time.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, "..", "public");
mkdirSync(out, { recursive: true });

// The tokens the site's identity comes from (design.md §1). The dark theme is the default, so
// the social image and the tiles are dark; the light values stay for the favicon tiles, where a
// dark square on a dark browser tab bar disappears.
const PAPER = "#0B0C10", INK = "#ECEEF3", BLUE = "#7A83FF", GRAPHITE = "#9AA0B4", HAIRLINE = "#22262F";
const TILE_PAPER = "#F6F6F9";
const markSvg = readFileSync(join(root, "assets", "logo.svg"), "utf8");

const mark = (px) => sharp(Buffer.from(markSvg)).resize(px, px).png().toBuffer();

/* The mark centred on a paper square; `inner` is the mark's share of the side. */
async function tile(size, inner) {
  const m = Math.round(size * inner);
  const composite = await mark(m);
  return sharp({ create: { width: size, height: size, channels: 4, background: TILE_PAPER } })
    .composite([{ input: composite, gravity: "centre" }])
    .png()
    .toBuffer();
}

/* ICO container with PNG entries (supported since Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = header.length + dir.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]);
}

const icoSizes = [16, 32, 48];
writeFileSync(join(out, "favicon.ico"), ico(await Promise.all(icoSizes.map(async (s) => ({ size: s, buf: await tile(s, 0.92) })))));
writeFileSync(join(out, "favicon-192.png"), await tile(192, 0.8));
writeFileSync(join(out, "favicon-512.png"), await tile(512, 0.8));
writeFileSync(join(out, "apple-touch-icon.png"), await tile(180, 0.72));

/* og.png: wordmark (mark + "ReviewStage") top-left, the fold's two lines beneath, on dark paper.
   The mark's own panels are dark ink, so on dark paper they are redrawn in --ink. */
const W = 1200, H = 630;
const descriptor = ["Stage every finding privately.", "Post the ones you mean, as yourself."];
const ogMarkSvg = markSvg.replace(/url\(#dark\)/g, INK).replace(/url\(#blue\)/g, BLUE);
const ogMark = await sharp(Buffer.from(ogMarkSvg)).resize(88, 88).png().toBuffer();
const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <text x="208" y="234" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="44" font-weight="600" fill="${INK}">ReviewStage</text>
  ${descriptor.map((line, i) => `<text x="96" y="${380 + i * 62}" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="46" font-weight="600" letter-spacing="-1" fill="${i ? BLUE : INK}">${line}</text>`).join("")}
  <rect x="96" y="${H - 97}" width="${W - 192}" height="1" fill="${HAIRLINE}"/>
  <text x="96" y="${H - 56}" font-family="IBM Plex Mono, Menlo, monospace" font-size="20" fill="${GRAPHITE}">wimukti.github.io/reviewstage · open source · self-hosted</text>
</svg>`;
const og = await sharp(Buffer.from(text)).composite([{ input: ogMark, left: 96, top: 176 }]).png().toBuffer();
writeFileSync(join(out, "og.png"), og);
console.log("brand → favicon.ico, favicon-192.png, favicon-512.png, apple-touch-icon.png, og.png");
