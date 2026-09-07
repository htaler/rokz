/**
 * Monster movement: the port of Move_Slow / Move_Medium / Move_Fast.
 *
 * All three tiers run the same algorithm and differ only in how often their
 * timer lets them run. Each routine resets its own timer, which is where the
 * tier speeds actually live -- the T[1]:=5 style values set on level entry are
 * just an initial grace period.
 */

import { at, emit, put, type GameState, T_FREEZE, T_SLOWTIME, T_SPEEDTIME } from './state.ts';
import { die } from './move.ts';

/** Destination tiles a monster simply steps onto. 68..74 are trap triggers. */
const WALKABLE = new Set([0, 68, 69, 70, 71, 72, 73, 74]);

/** Items a monster destroys by stepping on them. */
const CONSUMABLE = new Set([5, 7, 8, 9, 10, 11, 12, 15, 16, 18, 26, 27, 48, 49, 50, 51, 82, 83]);

/** Breakable blocks: the monster and the block annihilate each other. */
const ANNIHILATING = new Set([4, 38, 43, 64]);

function tierInterval(s: GameState, base: number): number {
  if (s.timers[T_SPEEDTIME]! > 0) return 0; // player sped up: monsters run flat out
  return s.timers[T_SLOWTIME]! < 1 ? base : base * 5;
}

/**
 * Advance one tier by a single step. Monsters home in on the player one cell at
 * a time, diagonally where both axes differ.
 */
export function moveTier(s: GameState, tier: number, timerSlot: number, base: number): void {
  s.timers[timerSlot] = tierInterval(s, base);

  const slots = s.tiers[tier];
  if (!slots) return;

  for (let i = 0; i < slots.length; i++) {
    if (s.dead) return;
    const m = slots[i];
    if (!m) continue;

    // The work list is not kept in sync with the grid. If this cell is no
    // longer this monster it was killed by a whip, bomb or block, so the slot
    // frees itself here rather than at the point of death.
    if (at(s, m.x, m.y) !== tier) {
      slots[i] = null;
      continue;
    }

    put(s, m.x, m.y, 0);
    const fromX = m.x;
    const fromY = m.y;
    let x = m.x;
    let y = m.y;
    if (s.px < x) x -= 1;
    else if (s.px > x) x += 1;
    // Gravity levels pin monsters to their row.
    if (!s.params.sideways) {
      if (s.py < y) y -= 1;
      else if (s.py > y) y += 1;
    }

    const target = at(s, x, y);

    if (WALKABLE.has(target) || CONSUMABLE.has(target)) {
      m.x = x;
      m.y = y;
      put(s, x, y, tier);
    } else if (ANNIHILATING.has(target)) {
      // Luring monsters into breakable walls kills both -- the tactic the
      // 1990 release notes single out as the game's strategic angle.
      put(s, x, y, 0);
      slots[i] = null;
      s.score += 1;
      emit(s, 'lure');
    } else if (target === 40) {
      // Reaching the player costs a gem and consumes the monster: its cell now
      // holds the player, so the slot frees itself on the next pass.
      s.gems -= 1;
      slots[i] = null;
      if (s.gems < 0) die(s);
    } else {
      // Blocked by anything else: stay put.
      put(s, fromX, fromY, tier);
    }
  }
}

export function moveMonsters(s: GameState): void {
  if (s.dead || s.won) return;
  if (s.timers[T_FREEZE]! > 0) return;
  if (s.timers[1]! < 1) moveTier(s, 1, 1, s.sTime);
  if (s.timers[2]! < 1) moveTier(s, 2, 2, s.mTime);
  if (s.timers[3]! < 1) moveTier(s, 3, 3, s.fTime);
}
