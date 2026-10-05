// Renders the favicon set and the social image from assets/logo.svg into public/.
// favicon.ico (16/32/48, PNG-in-ICO), favicon-192.png, favicon-512.png, apple-touch-icon.png
// (180, mark on paper). The social image, public/og.png, is a committed asset (1280×640).
// Runs in `pnpm build`; `pnpm brand` runs it alone. Everything is overwritten each time.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, "..", "public");
mkdirSync(out, { recursive: true });

// The tile paper comes from the light tokens (design.md §1): a dark square on a dark browser tab
// bar disappears.
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

/* og.png is no longer drawn here: since landing-v2 the social preview is the designed 1280x640
   image from the launch kit (the same one GitHub's repo settings carry), committed as
   public/og.png. Rendering it on every build overwrote it with the old 1200x630 card. */
console.log("brand → favicon.ico, favicon-192.png, favicon-512.png, apple-touch-icon.png");
