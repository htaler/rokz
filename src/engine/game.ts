/**
 * Tick orchestration and player actions.
 *
 * The original's loop spins a counter and advances the world when it overflows,
 * but a pending keypress forces the counter past the threshold immediately:
 *
 *     if keypressed then SkipTime:=801 else SkipTime:=SkipTime+1;
 *     if SkipTime>800 then <decrement timers; move monsters>
 *
 * So input steps the world, and the idle count is only a fallback for when the
 * player stands still. That is what lets a good player chain moves through a
 * monster field, so it is reproduced here: `act` advances the world after the
 * player's move, and `idle` advances it on a timer otherwise.
 */

import type { Level } from '../types.ts';
import { at, emit, enterLevel, put, say, sfx, type GameState, T_STATUE } from './state.ts';
import { addScore, die, move } from './move.ts';
import { moveMonsters } from './monsters.ts';
import { tickWorld } from './world.ts';
import { snapshot } from './save.ts';
import { HEIGHT, WIDTH } from './playfield.ts';

/**
 * How often the world advances while the player is idle.
 *
 * The original does not measure anything: it spins ~800 iterations of a tight
 * loop and asks the player "Slow or Fast PC (S/F)?" at startup, scaling the
 * monster timers to compensate. That means no wall-clock rate is recoverable
 * from the source -- it was machine-dependent in 1990 by design.
 *
 * Since our tick is already wall-clock, no compensation is needed; the pace is
 * simply this interval. A tier's step interval is IDLE_MS * (tierTime + 1),
 * with tierTimes of 3/2/1, so NORMAL puts a slow monster's step at almost
 * exactly one second, which is how the original is remembered playing.
 */
export const SPEEDS = {
  relaxed: 350,
  normal: 250,
  brisk: 175,
  frantic: 110,
} as const;

export type SpeedName = keyof typeof SPEEDS;
export const DEFAULT_SPEED: SpeedName = 'normal';
export const IDLE_MS = SPEEDS[DEFAULT_SPEED];

const rand = (n: number): number => Math.floor(Math.random() * n);

/** Damage one cell, as procedure Hit. Blocks and trees resist by whip power. */
function hit(s: GameState, x: number, y: number): void {
  const tile = at(s, x, y);

  if (tile >= 1 && tile <= 3) { // creatures die outright
    put(s, x, y, 0);
    s.score += tile;
    return;
  }

  if (tile === 4 || tile === 19 || tile === 20 || tile === 252) {
    // Forest always yields; trees and breakables resist by whip power.
    const power = tile === 19 ? 8 : s.whipPower;
    if (rand(7) < power) put(s, x, y, 0);
    return;
  }

  if (tile === 38 || tile === 43 || tile === 64) { // the other block types
    if (rand(7) < s.whipPower) {
      put(s, x, y, 0);
      addScore(s, 38);
    }
    return;
  }

  if (tile === 65) { // boulders: slow going at low whip power, but possible
    if (rand(30) < s.whipPower) {
      put(s, x, y, 0);
      s.score += 100;
    }
    return;
  }

  if (tile === 46) { // a statue -- destroying it stops the gem drain for good
    if (rand(50) < s.whipPower) {
      put(s, x, y, 0);
      s.score += 10;
      s.timers[T_STATUE] = -1;
      s.messages.push("You've destroyed the Statue!  Your Gems are now safe.");
    }
    return;
  }

  if (tile === 32) { // stop spaces are simply cleared
    put(s, x, y, 0);
    return;
  }

  // Destroyed outright: invisibility, speed, traps, power-ups, monster
  // generators and the K-R-O-Z letters.
  if (tile === 10 || tile === 15 || tile === 16 || tile === 18 || tile === 36 ||
      (tile >= 48 && tile <= 51)) {
    put(s, x, y, 0);
    if (tile === 36) { s.score += 50; emit(s, 'generator'); }
  }
}

/**
 * The whip's eight positions, in the order Player_Move calls Hit: from the
 * upper left, down the left side, along the bottom, up the right side and back
 * across the top. Each carries the CP437 line character drawn there, so the
 * whip reads as a lash circling the player.
 */
export const WHIP_SWEEP: readonly (readonly [number, number, number])[] = [
  [-1, -1, 92],  // \
  [-1, 0, 196],  // horizontal rule
  [-1, 1, 47],   // /
  [0, 1, 179],   // vertical rule
  [1, 1, 92],    // \
  [1, 0, 196],   // horizontal rule
  [1, -1, 47],   // /
  [0, -1, 179],  // vertical rule
];

/** How long each of the eight positions is shown. */
export const WHIP_FRAME_MS = 28;

/**
 * Start a crack of the whip. Damage is not applied here: the original resolves
 * each position inside its own Hit call, one after another, so a monster is
 * only struck once the lash has visibly reached it.
 */
export function startWhip(s: GameState): boolean {
  if (s.whips < 1 || s.dead || s.won || s.whipStep >= 0) {
    if (s.whips < 1 && !s.dead && !s.won) sfx(s, 'none');
    return false;
  }
  s.whips -= 1;
  s.whipStep = 0;
  sfx(s, 'whip');
  say(s, 5, 'Your whip is your main weapon.');
  return true;
}

/** Resolve the current position of the sweep. Returns false once it is over. */
export function stepWhip(s: GameState): boolean {
  if (s.whipStep < 0) return false;
  const spot = WHIP_SWEEP[s.whipStep];
  if (spot) {
    const x = s.px + spot[0];
    const y = s.py + spot[1];
    if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) hit(s, x, y);
  }
  s.whipStep += 1;
  if (s.whipStep >= WHIP_SWEEP.length) {
    s.whipStep = -1;
    return false;
  }
  return true;
}

/** Run a whole crack at once. Used by tests, where timing is irrelevant. */
export function whip(s: GameState): boolean {
  if (!startWhip(s)) return false;
  while (stepWhip(s));
  return true;
}

/** Spend a scroll to jump somewhere random. */
export function teleport(s: GameState): boolean {
  if (s.teleports < 1 || s.dead || s.won) return false;
  s.teleports -= 1;
  for (let tries = 0; tries < 5000; tries++) {
    const x = rand(WIDTH);
    const y = rand(HEIGHT);
    if (at(s, x, y) !== 0) continue;
    put(s, s.px, s.py, s.replacement);
    s.px = x;
    s.py = y;
    s.replacement = 0;
    put(s, x, y, 40);
    return true;
  }
  return false;
}

/** Advance the world one step: timers, monsters, gravity, gem drain. */
export function advance(s: GameState): void {
  if (s.dead || s.won) return;
  // A sound in progress freezes the world, exactly as the original's blocking
  // delay() did. This is what stops key-mashing from outrunning the game.
  if (performance.now() < s.blockedUntil) return;
  for (let i = 1; i < s.timers.length; i++) s.timers[i] = s.timers[i]! - 1;

  moveMonsters(s);

  // A statue on the level steals gems at random.
  if (s.timers[T_STATUE]! > 0 && rand(18) === 0) {
    s.gems -= 1;
    if (s.gems < 0) die(s);
  }

  tickWorld(s);
}

export class Game {
  state: GameState;
  private readonly levels: Level[];
  private readonly mapChars: Map<string, number>;

  constructor(state: GameState, levels: Level[], mapChars: Map<string, number>) {
    this.state = state;
    this.levels = levels;
    this.mapChars = mapChars;
    this.load(state.level);
  }

  get level(): Level {
    return this.levels.find((l) => l.n === this.state.level) ?? this.levels[0]!;
  }

  load(n: number): void {
    const level = this.levels.find((l) => l.n === n) ?? this.levels[0]!;
    this.state.level = level.n;
    enterLevel(this.state, level, this.mapChars);
    this.state.dead = false;
    this.state.won = false;
    // The snapshot is taken on entry, and is what a save writes out.
    this.state.entry = snapshot(this.state);
  }

  /** A player action, which also advances the world. */
  act(dx: number, dy: number): void {
    const s = this.state;
    if (s.dead || s.won) return;
    // Input during a sound is dropped, the way the original discards the
    // keyboard buffer after a blocking effect.
    if (performance.now() < s.blockedUntil) return;
    // Stairs are handled here rather than inside `move`, which only applies the
    // tile's own effect; the level change belongs to the driver.
    const takingStairs = at(s, s.px + dx, s.py + dy) === 6;
    move(s, dx, dy);
    if (takingStairs && !s.dead) {
      if (s.level >= this.levels.length) {
        s.won = true;
        s.messages.push('You have finished Kroz!');
        return;
      }
      this.load(s.level + 1);
      return;
    }
    advance(s);
  }

  /** No input this frame; the world still moves. */
  idle(): void {
    advance(this.state);
  }
}

export { HEIGHT, WIDTH };
