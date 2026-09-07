/**
 * Achievements.
 *
 * Deliberately a pure observer: it reads GameState after each tick and never
 * writes to it, so the engine stays a faithful port and nothing here can affect
 * play. Most conditions are read straight out of state the game already keeps
 * -- `found` is the original's own FoundSet, a record of which tile types you
 * have discovered. Only events that leave no trace afterwards go through the
 * engine's `events` channel.
 *
 * Nothing rewards behaviour the game itself penalises: AddScore docks points
 * for bumping walls and springing traps, so there are no achievements for doing
 * either carelessly.
 */

import type { GameState } from './engine/state.ts';

export interface Achievement {
  id: string;
  name: string;
  hint: string;
  group: 'Discovery' | 'Mastery' | 'Progress' | 'Curios';
  /** True once earned. `events` holds what happened since the last check. */
  test: (s: GameState, events: Set<string>, tally: Tally) => boolean;
  /** Hidden until earned, for the genuine surprises. */
  secret?: boolean;
}

/** Counters that have to persist across levels and sessions. */
export interface Tally {
  krozLevels: number;
  deepest: number;
  flawlessLevels: number;
  levelsCleared: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  // --- Discovery: the original's FoundSet already records these
  { id: 'whip', name: 'Crack of the Whip', hint: 'Find your first whip.', group: 'Discovery',
    test: (s) => s.found.has(5) },
  { id: 'gem', name: 'Gems are Life', hint: 'Pick up a gem.', group: 'Discovery',
    test: (s) => s.found.has(9) },
  { id: 'key', name: 'Keyholder', hint: 'Find a key.', group: 'Discovery',
    test: (s) => s.found.has(12) },
  { id: 'tablet', name: 'Ancient Words', hint: 'Read a tablet.', group: 'Discovery',
    test: (s) => s.found.has(42) },
  { id: 'rope', name: 'Rope Work', hint: 'Climb a rope.', group: 'Discovery',
    test: (s) => s.found.has(75) },
  { id: 'tunnel', name: 'Down the Tunnel', hint: 'Travel by tunnel.', group: 'Discovery',
    test: (s) => s.found.has(25) },

  // --- Mastery
  { id: 'kroz1', name: 'K-R-O-Z', hint: 'Spell KROZ on any level.', group: 'Mastery',
    test: (_s, e) => e.has('kroz') },
  { id: 'kroz10', name: 'Krozzword', hint: 'Spell KROZ on ten levels.', group: 'Mastery',
    test: (_s, _e, t) => t.krozLevels >= 10 },
  { id: 'kroz35', name: 'Master of Kroz', hint: 'Spell KROZ on all thirty-five levels that allow it.', group: 'Mastery',
    test: (_s, _e, t) => t.krozLevels >= 35 },
  { id: 'lure', name: 'Let Them Come', hint: 'Lure a creature into a breakable wall.', group: 'Mastery',
    test: (_s, e) => e.has('lure') },
  { id: 'generator', name: 'Cut Off the Source', hint: 'Destroy a creature generator with your whip.', group: 'Mastery',
    test: (_s, e) => e.has('generator') },
  { id: 'zap', name: 'Fireworks', hint: 'Set off a creature zap spell.', group: 'Mastery',
    test: (_s, e) => e.has('zap') },
  { id: 'flawless', name: 'Untouched', hint: 'Clear a level without losing a single gem.', group: 'Mastery',
    test: (_s, _e, t) => t.flawlessLevels >= 1 },

  // --- Progress
  { id: 'depth10', name: 'Into the Turf', hint: 'Reach level 10.', group: 'Progress',
    test: (_s, _e, t) => t.deepest >= 10 },
  { id: 'depth25', name: 'Going Down', hint: 'Reach level 25.', group: 'Progress',
    test: (_s, _e, t) => t.deepest >= 25 },
  { id: 'depth50', name: 'The Marathon', hint: 'Reach level 50.', group: 'Progress',
    test: (_s, _e, t) => t.deepest >= 50 },
  { id: 'gravity', name: 'Heading for a Fall', hint: 'Survive a level with gravity.', group: 'Progress',
    test: (s) => !!(s.params.gravOn || s.params.sideways) && !s.dead },
  { id: 'tome', name: 'The Sacred Tome', hint: 'Recover the Tome of Kroz.', group: 'Progress',
    test: (_s, e) => e.has('tome') },

  // --- Curios: the things you would otherwise never know were there
  { id: 'secret', name: 'Carved in the Old Tree', hint: 'Find the secret message.', group: 'Curios', secret: true,
    test: (_s, e) => e.has('secret') },
  { id: 'amulet', name: 'Wrong Dungeon', hint: 'Find the Amulet of Yendor.', group: 'Curios', secret: true,
    test: (_s, e) => e.has('amulet') },
  { id: 'surround', name: 'Expect the Unexpected', hint: 'Spring a surround-spawn trigger.', group: 'Curios', secret: true,
    test: (_s, e) => e.has('surround') },
  { id: 'pit', name: 'SPLAT!!', hint: 'Fall into a bottomless pit.', group: 'Curios', secret: true,
    test: (_s, e) => e.has('pit') },
];

const EARNED_KEY = 'kroz.achievements';
const TALLY_KEY = 'kroz.tally';

const emptyTally = (): Tally => ({ krozLevels: 0, deepest: 1, flawlessLevels: 0, levelsCleared: 0 });

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable; achievements simply will not persist */
  }
}

export class Achievements {
  private earned = new Set<string>(load<string[]>(EARNED_KEY, []));
  private tally: Tally = load<Tally>(TALLY_KEY, emptyTally());
  /** Levels already counted, so replaying one cannot inflate the tallies. */
  private krozDone = new Set<number>(load<number[]>('kroz.krozLevels', []));
  private flawlessDone = new Set<number>(load<number[]>('kroz.flawless', []));

  has(id: string): boolean {
    return this.earned.has(id);
  }
  get all(): Achievement[] {
    return ACHIEVEMENTS;
  }
  get count(): number {
    return this.earned.size;
  }

  /** Note reaching a level; called on entry. */
  enterLevel(n: number): void {
    if (n > this.tally.deepest) {
      this.tally.deepest = n;
      save(TALLY_KEY, this.tally);
    }
  }

  /** Note leaving a level by the stairs, with the gems held on entry. */
  clearLevel(n: number, gemsOnEntry: number, gemsNow: number, bonus: number): void {
    this.tally.levelsCleared += 1;
    if (bonus >= 4 && !this.krozDone.has(n)) {
      this.krozDone.add(n);
      this.tally.krozLevels = this.krozDone.size;
      save('kroz.krozLevels', [...this.krozDone]);
    }
    if (gemsNow >= gemsOnEntry && !this.flawlessDone.has(n)) {
      this.flawlessDone.add(n);
      this.tally.flawlessLevels = this.flawlessDone.size;
      save('kroz.flawless', [...this.flawlessDone]);
    }
    save(TALLY_KEY, this.tally);
  }

  /** Check every unearned achievement. Returns those newly earned. */
  check(state: GameState, events: Set<string>): Achievement[] {
    const won: Achievement[] = [];
    for (const a of ACHIEVEMENTS) {
      if (this.earned.has(a.id)) continue;
      if (!a.test(state, events, this.tally)) continue;
      this.earned.add(a.id);
      won.push(a);
    }
    if (won.length) save(EARNED_KEY, [...this.earned]);
    return won;
  }

  reset(): void {
    this.earned.clear();
    this.tally = emptyTally();
    this.krozDone.clear();
    this.flawlessDone.clear();
    for (const k of [EARNED_KEY, TALLY_KEY, 'kroz.krozLevels', 'kroz.flawless']) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  }
}
