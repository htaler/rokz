/**
 * Game state.
 *
 * `cells` is the whole world, exactly as `PF` was: tiles are ids and monsters
 * are tiles. The per-tier position arrays mirror the original's SX/SY, MX/MY
 * and FX/FY -- a work list, not an entity system. Nothing keeps them in sync
 * with `cells`; a slot whose cell is no longer that monster frees itself on the
 * next pass, which is how the original copes with monsters killed by whips,
 * bombs and blocks.
 */

import type { Level, LevelParams } from '../types.ts';
import { HEIGHT, WIDTH, buildPlayfield } from './playfield.ts';

export const TIER_TILES = [1, 2, 3] as const;

/** Timer slots, named after the comments in LOST1.LEV. */
export const T_SLOW = 1;
export const T_MEDIUM = 2;
export const T_FAST = 3;
export const T_SLOWTIME = 4;
export const T_INVISIBLE = 5;
export const T_SPEEDTIME = 6;
export const T_FREEZE = 7;
export const T_MBLOCK = 8;
export const T_STATUE = 9;

/**
 * Difficulty presets from the title screen. The value doubles as the spread on
 * chest contents (`random(Difficulty)+2` gems), so a novice finds more.
 * 9 is the original's undocumented "secret mode", reached by pressing `!`.
 */
export const DIFFICULTY = { novice: 8, experienced: 5, advanced: 2, secret: 9 } as const;

/** Starting inventory per difficulty, from Init_Screen. */
const STARTING = {
  9: { gems: 250, whips: 100, teleports: 50, keys: 1, whipPower: 3 },
  8: { gems: 20, whips: 0, teleports: 0, keys: 0, whipPower: 2 },
  5: { gems: 15, whips: 0, teleports: 0, keys: 0, whipPower: 2 },
  2: { gems: 10, whips: 0, teleports: 0, keys: 0, whipPower: 2 },
} as const;

export interface Monster {
  x: number;
  y: number;
}

export interface GameState {
  cells: Uint8Array;
  px: number;
  py: number;
  /** Tile the player is standing on and will restore when leaving (55..57, 75). */
  replacement: number;
  /** Grants one upward step on a gravity level (ropes set it). */
  oneMove: boolean;
  /** Index into WHIP_SWEEP while the whip is cracking, or -1 when idle. */
  whipStep: number;

  gems: number;
  whips: number;
  teleports: number;
  keys: number;
  whipPower: number;
  /** Progress through the K-R-O-Z bonus letters, 0..4. */
  bonus: number;
  score: number;
  level: number;
  difficulty: number;

  /** T[1..9]; index 0 unused so the numbering matches the Pascal. */
  timers: Int32Array;
  sTime: number;
  mTime: number;
  fTime: number;

  /** Monster work lists per tier, indexed 1..3. A null slot is free. */
  tiers: Record<number, (Monster | null)[]>;
  /** Moving-block work list, the equivalent of BX/BY. */
  blocks: (Monster | null)[];
  /** How many generators the level still has. */
  generators: number;
  /** Counts up to gravRate, then drops the player one cell. */
  gravCounter: number;

  /** Tiles already discovered, so a hint only shows once. */
  found: Set<number>;
  /** Hints raised this step, drained by the UI. */
  messages: string[];
  /** Sound effects raised this step, drained and played by the UI. */
  sounds: string[];
  /**
   * Notable things that happened this step, drained by the UI.
   *
   * Only for events that leave no trace in the state afterwards -- a monster
   * annihilated against a block, a generator smashed. Anything still visible in
   * the state (inventory, `found`, `bonus`) is read directly instead.
   */
  events: string[];
  /**
   * Timestamp until which the world is frozen because a sound is playing.
   *
   * In the original, `delay()` blocks the whole program, so every sound is a
   * pause during which monsters and the world do not move. Turbo Pascal's
   * Delay is CPU-calibrated, which makes these the only machine-independent
   * timings in the game -- and in practice the thing that paces it.
   */
  blockedUntil: number;

  params: LevelParams;
  /** State as of entering this level; what a save actually stores. */
  entry: import('./save.ts').Snapshot | null;
  dead: boolean;
  won: boolean;
  /** Tiles walked into that have no rule yet, for development visibility. */
  unimplemented: Set<number>;
}

export const at = (s: GameState, x: number, y: number): number =>
  x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT ? 14 : s.cells[y * WIDTH + x]!;

export const put = (s: GameState, x: number, y: number, tile: number): void => {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  s.cells[y * WIDTH + x] = tile;
};

/** Record a notable event for the UI to observe. */
export function emit(s: GameState, name: string): void {
  s.events.push(name);
}

/** Raise a sound effect for the UI to play; its duration will freeze the world. */
export function sfx(s: GameState, name: string): void {
  s.sounds.push(name);
}

export function say(s: GameState, tile: number, message: string): void {
  if (s.found.has(tile)) return;
  s.found.add(tile);
  s.messages.push(message);
}

/** Tiles the level-entry code re-forgets, so their hints show again. */
const RE_FORGET = [0, 8, 15, 17, 19, 20, 21, 22, 26, 28, 36, 66];

export function newGame(difficulty: number = DIFFICULTY.novice): GameState {
  const start = STARTING[difficulty as keyof typeof STARTING] ?? STARTING[8];
  return {
    cells: new Uint8Array(WIDTH * HEIGHT),
    px: 1,
    py: 1,
    replacement: 0,
    oneMove: false,
    whipStep: -1,
    gems: start.gems,
    whips: start.whips,
    teleports: start.teleports,
    keys: start.keys,
    whipPower: start.whipPower,
    bonus: 0,
    score: 0,
    level: 1,
    difficulty,
    timers: new Int32Array(10),
    sTime: 3,
    mTime: 2,
    fTime: 1,
    tiers: { 1: [], 2: [], 3: [] },
    blocks: [],
    generators: 0,
    gravCounter: 0,
    found: new Set(),
    messages: [],
    sounds: [],
    events: [],
    blockedUntil: 0,
    params: { gravRate: 20 },
    entry: null,
    dead: false,
    won: false,
    unimplemented: new Set(),
  };
}

/** Load a level into an existing state, preserving the player's inventory. */
export function enterLevel(s: GameState, level: Level, mapChars: Map<string, number>): void {
  const field = buildPlayfield(level, mapChars, s.level);
  s.cells = field.cells;
  s.px = field.player.x;
  s.py = field.player.y;
  s.replacement = 0;
  s.oneMove = false;
  s.whipStep = -1;
  s.bonus = 0;
  // copied, because a tablet may rewrite this level's parameters
  s.params = { ...level.params };
  s.level = level.n;

  s.timers.fill(0);
  s.timers[T_SLOW] = 5;
  s.timers[T_MEDIUM] = 6;
  s.timers[T_FAST] = 7;
  s.timers[T_MBLOCK] = 7;
  s.timers[T_STATUE] = -1;

  for (const tile of RE_FORGET) s.found.delete(tile);
  s.messages.length = 0;
  s.sounds.length = 0;
  s.events.length = 0;
  s.blockedUntil = 0;

  // Rebuild the monster work lists by scanning the grid, the way
  // Convert_Format and Create_Playfield populate SX/SY as they place tiles.
  s.tiers = { 1: [], 2: [], 3: [] };
  s.blocks = [];
  s.generators = 0;
  s.gravCounter = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const tile = s.cells[y * WIDTH + x]!;
      if (tile >= 1 && tile <= 3) s.tiers[tile]!.push({ x, y });
      if (tile === 38) s.blocks.push({ x, y });
      if (tile === 36) s.generators += 1;
      if (tile === 46) s.timers[T_STATUE] = 32000; // statue drains gems
    }
  }
}
