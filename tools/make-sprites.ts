/**
 * Build the tiles the Crawl set has no equivalent for, cut from Castlevania.png.
 *
 * Source: "New Gothic Haunted Castle Tileset 32x32" by MidnitePixel. The sheet
 * is 704x448, which is 22x14 cells at 32px -- the chandeliers sit one per cell,
 * chains centred at x = 207, 239, 271, 303 -- so nothing needs scaling.
 *
 * Output goes to port/assets/, which the packer reads for any sprite path
 * beginning "local/".
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..', 'Castlevania.png');
const ASSETS = join(HERE, '..', 'assets');
const SIZE = 32;
const ZOOM = 1; // the sheet is already 32px per cell, so nothing is scaled

const src = PNG.sync.read(readFileSync(SRC));
const at = (x: number, y: number): [number, number, number, number] => {
  const i = (y * src.width + x) * 4;
  return [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!, src.data[i + 3]!];
};

function blank(): PNG {
  const png = new PNG({ width: SIZE, height: SIZE });
  png.data.fill(0);
  return png;
}

function put(png: PNG, x: number, y: number, rgba: [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || rgba[3] === 0) return;
  const d = (y * SIZE + x) * 4;
  png.data[d] = rgba[0];
  png.data[d + 1] = rgba[1];
  png.data[d + 2] = rgba[2];
  png.data[d + 3] = 255;
}

/**
 * The rope: a hanging chain.
 *
 * The chain's link repeats every 7 pixels, which does not divide 32 and would
 * put a visible break wherever two rope tiles meet. Padding the link to 8 makes
 * it 16 doubled, so a tile is exactly two links and stacks cleanly at any length.
 */
function rope(): PNG {
  const CHAIN_X = 270, CHAIN_W = 5, LINK_TOP = 98, LINK_H = 7, PADDED = 8;
  const png = blank();
  const dx = Math.floor((SIZE - CHAIN_W * ZOOM) / 2);
  for (let y = 0; y < SIZE; y++) {
    const row = Math.floor(y / ZOOM) % PADDED;
    const srcY = LINK_TOP + Math.min(row, LINK_H - 1);
    for (let x = 0; x < CHAIN_W * ZOOM; x++) {
      put(png, dx + x, y, at(CHAIN_X + Math.floor(x / ZOOM), srcY));
    }
  }
  return png;
}

/**
 * The drop-chord: the same chain, hanging from its mounting bracket.
 *
 * A chandelier read badly next to the rope it produces -- the join between the
 * two sprites was jarring. This is the chain with the bracket it hangs from at
 * the top, so a chord and the rope below it form one continuous run while still
 * being distinguishable: the bracket marks the cell you can activate.
 */
function dropChord(): PNG {
  // The chandelier is drawn across two cells -- chain in the one above, bowl in
  // this one -- so the lower cell is taken whole, bracket and bowl included.
  const CELL_X = 256, CELL_Y = 128;
  const png = blank();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) put(png, x, y, at(CELL_X + x, CELL_Y + y));
  }
  return png;
}

/**
 * The ceiling rail: the same chain turned on its side.
 *
 * CP437 byte 196 draws a horizontal rule, and every level that uses it lays a
 * complete 64-cell row of them -- on the gravity levels, directly above the row
 * of chandeliers. So it is the rail they hang from, and drawing it as the same
 * chain rotated makes the fixtures and the ropes below read as one structure.
 */
function chainRail(): PNG {
  const CHAIN_X = 270, CHAIN_W = 5, LINK_TOP = 98, LINK_H = 7, PADDED = 8;
  const png = blank();
  const dy = Math.floor((SIZE - CHAIN_W * ZOOM) / 2);
  for (let x = 0; x < SIZE; x++) {
    // Walking along the tile steps along the link, as height did for the rope.
    const col = Math.floor(x / ZOOM) % PADDED;
    const srcY = LINK_TOP + Math.min(col, LINK_H - 1);
    for (let y = 0; y < CHAIN_W * ZOOM; y++) {
      put(png, x, dy + y, at(CHAIN_X + Math.floor(y / ZOOM), srcY));
    }
  }
  return png;
}

/**
 * The CGA palette the game draws in. New_Gem_Color re-rolls a gem's colour on
 * every level, picking 1..15 but never 8, so a level's gems are one of these
 * fourteen -- which is why the sprite is generated once per colour rather than
 * chosen from the tileset.
 */
const CGA: Record<number, [number, number, number]> = {
  1: [0, 0, 170], 2: [0, 170, 0], 3: [0, 170, 170], 4: [170, 0, 0],
  5: [170, 0, 170], 6: [170, 85, 0], 7: [170, 170, 170], 9: [85, 85, 255],
  10: [85, 255, 85], 11: [85, 255, 255], 12: [255, 85, 85], 13: [255, 85, 255],
  14: [255, 255, 85], 15: [255, 255, 255],
};

/**
 * A cut gem. The original draws CP437 4, the diamond suit, so the shape is a
 * rhombus; the facets are added because at 32px a flat diamond reads as a
 * playing-card pip rather than treasure.
 */
function gem(colour: number): PNG {
  const [r, g, b] = CGA[colour]!;
  const png = blank();
  const TOP = 5, MID = 13, BOT = 26, HALF = 8, CX = 16;
  const shade = (f: number): [number, number, number, number] => [
    Math.min(255, Math.round(r * f)),
    Math.min(255, Math.round(g * f)),
    Math.min(255, Math.round(b * f)),
    255,
  ];
  for (let y = TOP; y <= BOT; y++) {
    const half = Math.round(
      y <= MID ? ((y - TOP) / (MID - TOP)) * HALF : ((BOT - y) / (BOT - MID)) * HALF,
    );
    for (let x = CX - half; x <= CX + half; x++) {
      // Lit from the upper left: the crown catches light, the pavilion darkens.
      let f = y <= MID ? 1.25 : 0.75;
      if (x < CX) f += 0.2;
      if (y > MID + 4) f -= 0.15;
      png.data.set(shade(f), (y * SIZE + x) * 4);
    }
  }
  // A hard highlight on the table, and a dark girdle to separate crown from pavilion.
  for (let x = CX - 3; x <= CX - 1; x++) png.data.set([255, 255, 255, 255], ((TOP + 3) * SIZE + x) * 4);
  for (let x = CX - HALF; x <= CX + HALF; x++) png.data.set(shade(0.45), (MID * SIZE + x) * 4);
  return png;
}

for (const colour of Object.keys(CGA).map(Number)) {
  writeFileSync(join(ASSETS, `gem-${colour}.png`), PNG.sync.write(gem(colour)));
}
console.log(`wrote ${Object.keys(CGA).length} gem colours`);

for (const [name, make] of [['rope', rope], ['dropchord', dropChord], ['rail', chainRail]] as const) {
  writeFileSync(join(ASSETS, `${name}.png`), PNG.sync.write(make()));
  console.log(`wrote assets/${name}.png (${SIZE}x${SIZE})`);
}
