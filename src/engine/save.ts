/**
 * Saved games, ported from the original's SaveType record.
 *
 * The save holds no playfield -- only the level number, inventory, position and
 * which hints have been seen. Restoring therefore rebuilds the level from
 * scratch. That is why the original saves the `I_*` variables, a snapshot taken
 * when you *entered* the level, rather than your current state: saving halfway
 * through a level and restoring into a freshly rebuilt one would otherwise put
 * you somewhere that no longer makes sense.
 */

import type { GameState } from './state.ts';

/** The original offers three slots, chosen by letter. */
export const SLOTS = ['A', 'B', 'C'] as const;
export type Slot = (typeof SLOTS)[number];

export interface Snapshot {
  level: number;
  score: number;
  gems: number;
  whips: number;
  teleports: number;
  keys: number;
  whipPower: number;
  difficulty: number;
  px: number;
  py: number;
  found: number[];
}

const KEY = (slot: Slot) => `kroz.save.${slot}`;

/** Take the level-entry snapshot; called whenever a level loads. */
export function snapshot(s: GameState): Snapshot {
  return {
    level: s.level,
    score: s.score,
    gems: s.gems,
    whips: s.whips,
    teleports: s.teleports,
    keys: s.keys,
    whipPower: s.whipPower,
    difficulty: s.difficulty,
    px: s.px,
    py: s.py,
    found: [...s.found],
  };
}

/** Apply a snapshot back onto a state. The caller reloads the level after. */
export function restore(s: GameState, snap: Snapshot): void {
  s.level = snap.level;
  s.score = snap.score;
  s.gems = snap.gems;
  s.whips = snap.whips;
  s.teleports = snap.teleports;
  s.keys = snap.keys;
  s.whipPower = snap.whipPower;
  s.difficulty = snap.difficulty;
  s.found = new Set(snap.found);
  s.dead = false;
  s.won = false;
}

export function write(slot: Slot, snap: Snapshot): boolean {
  try {
    localStorage.setItem(KEY(slot), JSON.stringify(snap));
    return true;
  } catch {
    return false; // private browsing, or storage disabled
  }
}

export function read(slot: Slot): Snapshot | null {
  try {
    const raw = localStorage.getItem(KEY(slot));
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

/** A one-line description of each slot, for the UI. */
export function describeSlots(): string {
  return SLOTS.map((slot) => {
    const snap = read(slot);
    return snap ? `${slot}: level ${snap.level}` : `${slot}: empty`;
  }).join('   ');
}
