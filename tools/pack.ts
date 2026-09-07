/**
 * Pack the Crawl tiles referenced by tiles.map.json into a single atlas.
 *
 * The tileset ships 3,039 loose PNGs; a page that fetched them individually
 * would make 3,039 requests. Only the ~50 tiles the mapping actually uses are
 * composited into one image, and the renderer blits from it by index.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const DATA_DIR = join(HERE, '..', 'src', 'data');
const OUT_DIR = join(HERE, '..', 'public');

interface TileEntry {
  sprite?: string;
  frames?: string[];
  /** 'level' picks one frame per level instead of animating through them. */
  pick?: 'level';
  text?: string;
  comment?: string;
}
interface TileMap {
  meta: { tileSize: number; root: string; tileset: string; credit: string };
  tiles: Record<string, TileEntry>;
  player: { sprite: string };
}

const PNG_SIGNATURE = 8;
const CHUNK_OVERHEAD = 12; // 4 length + 4 type + 4 CRC

/**
 * Decode a Crawl tile.
 *
 * 39 of the ~50 tiles this mapping uses carry a second, redundant IEND chunk
 * after the first. Browsers ignore the extra bytes; strict decoders reject the
 * file outright ("unrecognised content at end of stream"). Walking the chunk
 * list and cutting after the first IEND normalises them without touching the
 * source assets.
 */
function readPng(file: string): PNG {
  const raw = readFileSync(file);
  let at = PNG_SIGNATURE;
  while (at + CHUNK_OVERHEAD <= raw.length) {
    const length = raw.readUInt32BE(at);
    const type = raw.toString('ascii', at + 4, at + 8);
    at += CHUNK_OVERHEAD + length;
    if (type === 'IEND') break;
  }
  return PNG.sync.read(at < raw.length ? raw.subarray(0, at) : raw);
}

const map = JSON.parse(readFileSync(join(DATA_DIR, 'tiles.map.json'), 'utf8')) as TileMap;
const SIZE = map.meta.tileSize;
const ROOT = join(REPO, map.meta.root);
const LOCAL = join(HERE, '..', 'assets');

/**
 * Resolve a sprite path. Most come from the Crawl tileset, but a "local/"
 * prefix reads from the port's own assets -- sprites built or drawn for tiles
 * the tileset has no equivalent for.
 */
const resolveSprite = (path: string): string =>
  path.startsWith('local/') ? join(LOCAL, path.slice('local/'.length)) : join(ROOT, path);

// ---- collect every distinct source image, in a stable order ---------------
const order: string[] = [];
const indexOf = new Map<string, number>();
const claim = (path: string): number => {
  let i = indexOf.get(path);
  if (i === undefined) {
    i = order.length;
    order.push(path);
    indexOf.set(path, i);
  }
  return i;
};

const tiles: Record<string, { frames?: number[]; pick?: 'level'; text?: string }> = {};
for (const [id, entry] of Object.entries(map.tiles)) {
  if (entry.text !== undefined) tiles[id] = { text: entry.text };
  else if (entry.frames) tiles[id] = { frames: entry.frames.map(claim), ...(entry.pick ? { pick: entry.pick } : {}) };
  else if (entry.sprite) tiles[id] = { frames: [claim(entry.sprite)] };
  else throw new Error(`tile ${id} has no sprite, frames or text`);
}
const player = { frames: [claim(map.player.sprite)] };

// ---- lay out a square-ish grid -------------------------------------------
const cols = Math.ceil(Math.sqrt(order.length));
const rows = Math.ceil(order.length / cols);
const atlas = new PNG({ width: cols * SIZE, height: rows * SIZE });
atlas.data.fill(0);

const oversized: string[] = [];
for (const [i, path] of order.entries()) {
  const src = readPng(resolveSprite(path));
  if (src.width !== SIZE || src.height !== SIZE) oversized.push(`${path} (${src.width}x${src.height})`);

  // Crawl draws tall sprites anchored to the bottom of the cell, so crop from
  // the bottom rather than the top when an image overflows.
  const sx0 = Math.max(0, Math.floor((src.width - SIZE) / 2));
  const sy0 = Math.max(0, src.height - SIZE);
  const dx0 = (i % cols) * SIZE;
  const dy0 = Math.floor(i / cols) * SIZE;

  for (let y = 0; y < Math.min(SIZE, src.height); y++) {
    for (let x = 0; x < Math.min(SIZE, src.width); x++) {
      const s = ((sy0 + y) * src.width + (sx0 + x)) * 4;
      const d = ((dy0 + y) * atlas.width + (dx0 + x)) * 4;
      atlas.data[d] = src.data[s]!;
      atlas.data[d + 1] = src.data[s + 1]!;
      atlas.data[d + 2] = src.data[s + 2]!;
      atlas.data[d + 3] = src.data[s + 3]!;
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'atlas.png'), PNG.sync.write(atlas));
writeFileSync(
  join(DATA_DIR, 'atlas.json'),
  JSON.stringify(
    {
      meta: { tileSize: SIZE, cols, rows, image: 'atlas.png', credit: map.meta.credit },
      // Index i sits at (i % cols, floor(i / cols)) scaled by tileSize.
      sources: order,
      tiles,
      player,
    },
    null,
    2,
  ) + '\n',
);

console.log(`packed ${order.length} sprites into ${cols}x${rows} (${atlas.width}x${atlas.height}px)`);
console.log(`tiles:  ${Object.keys(tiles).length} (${Object.values(tiles).filter((t) => t.text !== undefined).length} drawn as text)`);
if (oversized.length) console.log(`note:   ${oversized.length} source images were not ${SIZE}x${SIZE}: ${oversized.join(', ')}`);
console.log(`wrote   public/atlas.png, src/data/atlas.json`);
