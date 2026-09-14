// Shared by icons.mjs and brand.mjs: rasterise an SVG mark centred on a solid #171922 tile.
// `inner` is the mark's share of the tile edge; `radius` rounds the tile (0 = square, for
// maskable icons the platform crops itself).
export const TILE_BG = "#171922";

export async function tile(sharp, svg, size, { radius = 0, inner = 0.72 } = {}) {
  const glyph = Math.round(size * inner);
  const mark = await sharp(Buffer.from(svg), { density: 300 })
    .resize(glyph, glyph, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const shape = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${TILE_BG}"/></svg>`,
  );
  return sharp(shape).composite([{ input: mark, gravity: "centre" }]).png().toBuffer();
}
