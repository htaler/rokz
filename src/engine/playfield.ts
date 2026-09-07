/**
 * Turn extracted level data into a playfield grid.
 *
 * This is the port of Convert_Format (hand-drawn levels) and Create_Playfield
 * (scattered levels) from LOST1.LEV / LOST4.TIT. The grid is the whole of the
 * game's world state, exactly as `PF : array[1..66,1..25] of byte` was: tiles
 * are ids, and monsters are tiles rather than separate entities.
 */

import type { Level, TilesDoc } from '../types.ts';

export const WIDTH = 64;
export const HEIGHT = 23;

export interface Playfield {
  /** Row-major tile ids, WIDTH * HEIGHT. */
  cells: Uint8Array;
  player: { x: number; y: number };
}

const index = (x: number, y: number) => y * WIDTH + x;

/** Deterministic PRNG so a given level and seed always lay out the same way. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

export function buildMapChars(tiles: TilesDoc): Map<string, number> {
  return new Map(tiles.mapChars.map((m) => [m.char, m.tile]));
}

/**
 * Hand-drawn levels: each layout character becomes a tile id. Characters with
 * no mapping fall through to their own byte value, which Display_Playfield then
 * draws as a letter -- that is how Kroz writes words into the playfield.
 */
function fromLayout(rows: string[], mapChars: Map<string, number>): Playfield {
  const cells = new Uint8Array(WIDTH * HEIGHT);
  let player = { x: 1, y: 1 };

  for (let y = 0; y < HEIGHT; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < WIDTH; x++) {
      // A row shorter than WIDTH leaves Null, matching the original reading
      // past the end of a Pascal string and getting its zero length byte.
      const ch = row[x];
      if (ch === undefined) continue;
      const tile = mapChars.get(ch) ?? ch.charCodeAt(0);
      cells[index(x, y)] = tile;
      if (tile === 40) player = { x, y };
    }
  }
  return { cells, player };
}

/**
 * Scattered levels: place N of each object at random empty cells.
 *
 * The original does rejection sampling in a `repeat ... until Done` loop with no
 * escape, which is why levels that fill 99%+ of the playfield (58 asks for 1471
 * objects into 1471 cells) probe thousands of times for their last placement.
 * Drawing from a shuffled cell list gives the same distribution in one pass.
 */
function fromCounts(counts: Record<string, number>, seed: number): Playfield {
  const cells = new Uint8Array(WIDTH * HEIGHT);
  const player = { x: WIDTH >> 1, y: HEIGHT >> 1 };
  cells[index(player.x, player.y)] = 40;

  const free: number[] = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] === 0) free.push(i);

  const rand = rng(seed);
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [free[i], free[j]] = [free[j]!, free[i]!];
  }

  let next = 0;
  for (const [id, count] of Object.entries(counts)) {
    const tile = Number(id);
    for (let n = 0; n < count && next < free.length; n++) cells[free[next++]!] = tile;
  }
  return { cells, player };
}

export function buildPlayfield(level: Level, mapChars: Map<string, number>, seed = 1): Playfield {
  return level.kind === 'drawn'
    ? fromLayout(level.rows, mapChars)
    : fromCounts(level.counts, seed * 2654435761 + level.n);
}
