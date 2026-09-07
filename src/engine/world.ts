/**
 * Per-level world systems, ported from the main loop in LOST.PAS.
 *
 * These are the things that happen to a level whether or not the player acts:
 * lava creeping outward, forest regrowing, water evaporating, electrified walls
 * flickering on and off, generators spitting out monsters, blocks hunting you,
 * and gravity pulling you down. Each is gated by a rate carried in the level's
 * own parameters, which is why they were inert until now -- the data was
 * extracted, but nothing read it.
 */

import { HEIGHT, WIDTH } from './playfield.ts';
import { at, put, type GameState, T_MBLOCK } from './state.ts';
import { move } from './move.ts';

const rand = (n: number): number => Math.floor(Math.random() * n);
const range = (lo: number, hi: number): number[] =>
  Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

/** How often a generator fires; 17 on a period machine. */
export const GEN_FACTOR = 17;
/** Moving blocks step this often, as BTime. */
export const B_TIME = 2;

/** Cells lava can flow into. */
const LAVA_TAKES = new Set([
  ...range(0, 5), ...range(7, 11), 15, 16, ...range(18, 21), ...range(26, 28),
  ...range(32, 35), ...range(37, 39), 41, ...range(42, 45), ...range(47, 51),
  57, 60, 64, ...range(67, 74), ...range(77, 83),
]);

/** Bare cells that forest can creep into. */
const TREE_TAKES = new Set([0, 16, 27, 28, 32, 33, 37, 39]);

const orthogonallyTouches = (s: GameState, x: number, y: number, want: (t: number) => boolean) =>
  want(at(s, x + 1, y)) || want(at(s, x - 1, y)) || want(at(s, x, y + 1)) || want(at(s, x, y - 1));

/** Lava creeps outward from lava already on the level. */
function spreadLava(s: GameState): void {
  if (!s.params.lavaFlow || rand(10) !== 0) return;
  for (let i = 0; i < (s.params.lavaRate ?? 0); i++) {
    const x = rand(WIDTH);
    const y = rand(HEIGHT);
    if (!LAVA_TAKES.has(at(s, x, y))) continue;
    if (orthogonallyTouches(s, x, y, (t) => t === 22)) put(s, x, y, 22);
  }
}

/** Forest regrows next to existing forest -- one cell in four becomes a tree. */
function growForest(s: GameState): void {
  const rate = s.params.treeRate ?? -1;
  if (rate <= 0 || rand(10) !== 0) return;
  for (let i = 0; i < rate; i++) {
    const x = rand(WIDTH);
    const y = rand(HEIGHT);
    if (!TREE_TAKES.has(at(s, x, y))) continue;
    if (!orthogonallyTouches(s, x, y, (t) => t === 19 || t === 20)) continue;
    put(s, x, y, rand(4) === 0 ? 20 : 19);
  }
}

/** Rivers dry up. */
function evaporate(s: GameState): void {
  const rate = s.params.evapoRate ?? 0;
  if (rate <= 0 || rand(10) !== 0) return;
  for (let i = 0; i < rate; i++) {
    const x = rand(WIDTH);
    const y = rand(HEIGHT);
    if (at(s, x, y) === 17) put(s, x, y, 0);
  }
}

/**
 * Electrified walls blink in and out: a hundred probes turn hidden walls live,
 * then a hundred more turn live walls back into hidden ones.
 */
function flickerMagicWalls(s: GameState): void {
  if (!s.params.magicEWalls || rand(8) !== 0) return;
  for (let i = 0; i < 100; i++) {
    const x = rand(WIDTH);
    const y = rand(HEIGHT);
    if (at(s, x, y) === 55) put(s, x, y, 66);
  }
  for (let i = 0; i < 100; i++) {
    const x = rand(WIDTH);
    const y = rand(HEIGHT);
    if (at(s, x, y) === 66) put(s, x, y, 55);
  }
}

/** Generators on the level spit out slow monsters. */
function runGenerators(s: GameState): void {
  const slots = s.tiers[1];
  if (!slots || s.generators < 1 || slots.length >= 995) return;
  if (rand(GEN_FACTOR) !== 0) return;
  // The original keeps trying until it places one or gives up at random.
  for (let tries = 0; tries < 200; tries++) {
    const x = rand(WIDTH);
    const y = rand(HEIGHT);
    if (at(s, x, y) === 0) {
      put(s, x, y, 1);
      slots.push({ x, y });
      return;
    }
    if (rand(50) === 0) return;
  }
}

/** Moving blocks home in on the player, but only through empty cells. */
function moveBlocks(s: GameState): void {
  if (s.timers[T_MBLOCK]! >= 1) return;
  s.timers[T_MBLOCK] = B_TIME;

  for (let i = 0; i < s.blocks.length; i++) {
    const b = s.blocks[i];
    if (!b) continue;
    if (at(s, b.x, b.y) !== 38) {
      s.blocks[i] = null; // destroyed elsewhere; the slot frees itself
      continue;
    }
    put(s, b.x, b.y, 0);
    const fromX = b.x;
    const fromY = b.y;
    let x = b.x;
    let y = b.y;
    if (s.px < x) x -= 1;
    else if (s.px > x) x += 1;
    if (!s.params.sideways) {
      if (s.py < y) y -= 1;
      else if (s.py > y) y += 1;
    }
    if (at(s, x, y) === 0) {
      b.x = x;
      b.y = y;
      put(s, x, y, 38);
    } else {
      put(s, fromX, fromY, 38);
    }
  }
}

/** Gravity levels drop the player a cell at a time unless a rope holds them. */
function applyGravity(s: GameState): void {
  if (!s.params.gravOn || s.replacement === 75) return;
  s.gravCounter += 1;
  if (s.gravCounter <= (s.params.gravRate ?? 0)) return;
  s.gravCounter = 0;
  // Falling runs the full Move, so landing on lava or a pit still resolves --
  // but as a non-human move, so hitting the floor raises no complaint.
  move(s, 0, 1, false);
}

/** Run every world system once, in the order the original's loop does. */
export function tickWorld(s: GameState): void {
  moveBlocks(s);
  runGenerators(s);
  spreadLava(s);
  applyGravity(s);
  flickerMagicWalls(s);
  evaporate(s);
  growForest(s);
}
