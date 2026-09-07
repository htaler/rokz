/**
 * Player movement: the port of Go and Move from LOST1.LEV / LOST5.MOV.
 *
 * Move is one big dispatch on the tile being walked into. Every branch decides
 * whether the step happens (by calling `go`), what it costs or grants, and
 * which one-time hint it raises. Tiles with no rule yet block the step and are
 * recorded in `state.unimplemented` so gaps stay visible.
 */

import { HEIGHT, WIDTH } from './playfield.ts';
import { readTablet } from './tablets.ts';
import { at, emit, put, say, sfx, type GameState, T_FREEZE, T_INVISIBLE, T_SLOWTIME, T_SPEEDTIME } from './state.ts';

/** Tiles the player carries and restores on leaving: hidden walls and rope. */
const CARRIED = new Set([55, 56, 57, 75]);

/** Cleared by a bomb blast. Monsters inside it score before dying. */
const BOMBABLE = new Set([
  0, 1, 2, 3, 4, 13, 16, 19, 28, 29, 30, 31, 32, 33, 35, 36, 37, 38, 39, 43, 45,
  48, 49, 50, 51, 64, 67, 68, 69, 70, 71, 72, 73, 74,
  224, 225, 226, 227, 228, 229, 230, 231,
]);

const rand = (n: number): number => Math.floor(Math.random() * n);

const range = (lo: number, hi: number): number[] =>
  Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

/** Cells a pushed rock can roll into. */
const ROCK_ROLLS_INTO = new Set([
  0, 32, 33, 37, 39, 41, 44, 47, 55, 56, 57, 61, 62, 63, 67,
  ...range(68, 74), ...range(224, 231),
]);

/** Things a rock crushes on the way, destroying them. */
const ROCK_CRUSHES = new Set([
  5, 7, 8, 9, 10, 11, 12, 16, 18, 21, 26, 27, 34, 35, 42, 45,
  48, 49, 50, 51, 58, 59, 60, 76, 77, 78, 79, 80, 82, 83,
]);

/**
 * The move primitive. Restores whatever the player was standing on, steps, and
 * picks up the new cell if it is one of the carried tiles.
 */
export function go(s: GameState, dx: number, dy: number): void {
  // Gravity levels only allow upward movement while on a rope, or on the one
  // step a rope tile grants when you step onto it.
  if (s.params.sideways && dy === -1 && !s.oneMove && s.replacement !== 75) return;
  s.oneMove = false;

  put(s, s.px, s.py, s.replacement);
  s.px += dx;
  s.py += dy;
  const under = at(s, s.px, s.py);
  s.replacement = CARRIED.has(under) ? under : 0;
  put(s, s.px, s.py, 40);
  sfx(s, 'footStep');
}

function teleportToEmpty(s: GameState): void {
  for (let tries = 0; tries < 5000; tries++) {
    const x = rand(WIDTH);
    const y = rand(HEIGHT);
    if (at(s, x, y) === 0) {
      put(s, s.px, s.py, s.replacement);
      s.px = x;
      s.py = y;
      s.replacement = 0;
      put(s, x, y, 40);
      return;
    }
  }
}

function detonate(s: GameState): void {
  for (let y = Math.max(0, s.py - 4); y <= Math.min(HEIGHT - 1, s.py + 4); y++) {
    for (let x = Math.max(0, s.px - 4); x <= Math.min(WIDTH - 1, s.px + 4); x++) {
      const tile = at(s, x, y);
      if (!BOMBABLE.has(tile)) continue;
      if (tile >= 1 && tile <= 3) s.score += tile;
      put(s, x, y, 0);
    }
  }
  put(s, s.px, s.py, 40);
}

/** Cells a tunnel may deposit you in, and that a random walk may cross. */
const TUNNEL_EXIT = new Set([0, 32, 33, 37, 39, 55, 56, 57, 67, ...range(224, 231)]);

/** Scatter `count` of `tile` across empty cells, registering any monsters. */
function spawn(s: GameState, tile: number, count: number): void {
  for (let n = 0; n < count; n++) {
    for (let tries = 0; tries < 400; tries++) {
      const x = rand(WIDTH);
      const y = rand(HEIGHT);
      const here = at(s, x, y);
      if (here !== 0 && here !== 224) continue;
      put(s, x, y, tile);
      if (tile >= 1 && tile <= 3) s.tiers[tile]?.push({ x, y });
      break;
    }
  }
}

/**
 * A dropping rope stops when the cell two below is one of these -- walls,
 * water, doors, an existing rope. The look-ahead is the original's: it writes a
 * rope, steps down, then inspects the cell beyond that.
 */
const ROPE_STOPS = new Set([
  4, 13, 14, 17, ...range(19, 25), ...range(29, 31), 42, 43,
  ...range(52, 60), ...range(64, 66), 75,
  ...range(100, 223), ...range(232, 254),
]);

/** Cells the quake fills with rubble. */
const QUAKE_TAKES = new Set([
  ...range(0, 3), 5, ...range(7, 11), 15, 16, 26, 32, 33, 37, 39, 67, ...range(224, 231),
]);

/** Cells a surround-spawn trigger can drop its payload into. */
const TRIGGER_TAKES = new Set([0, 32, 33, 37, 39, 41, 47, ...range(67, 74), ...range(224, 231)]);

/** What each of the seven triggers surrounds you with. */
const TRIGGER_SPAWNS: Record<number, number> = {
  68: 4,  // breakable blocks
  69: 65, // boulders
  70: 9,  // gems
  71: 10, // blindness
  72: 5,  // whips
  73: 27, // nuggets
  74: 20, // trees
};

/** A spear is stopped dead by these. */
const SPEAR_STOPS = new Set([
  4, 6, 13, 14, 22, 25, 31, 36, 38, 42, 43, 46, ...range(52, 54), ...range(64, 66), 81,
]);

/** A spear passes over these without touching them -- water, pits, hidden walls. */
const SPEAR_IGNORES = new Set([
  0, 17, 23, ...range(28, 30), 32, 33, 37, 39, 41, 44, 47,
  ...range(55, 57), ...range(61, 63), ...range(67, 75),
]);

/** Fill the eight cells around the player, where they can take it. */
function surround(s: GameState, tile: number): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = s.px + dx;
      const y = s.py + dy;
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue;
      if (TRIGGER_TAKES.has(at(s, x, y))) put(s, x, y, tile);
    }
  }
}

/**
 * A magic spear flies horizontally until something solid stops it, clearing
 * what it passes. Monsters leave a stop-space behind rather than bare floor.
 */
function throwSpear(s: GameState, direction: 1 | -1): void {
  for (let x = s.px + direction; x >= 0 && x < WIDTH; x += direction) {
    const tile = at(s, x, s.py);
    if (SPEAR_STOPS.has(tile)) break;
    if (SPEAR_IGNORES.has(tile)) continue;
    put(s, x, s.py, tile >= 1 && tile <= 3 ? 32 : 0);
  }
}

/** Erase every cell holding `tile`. Traps wipe their own network when sprung. */
function clearAll(s: GameState, tile: number): void {
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === tile) s.cells[i] = 0;
}

/**
 * The original's AddScore: a lookup keyed by the tile you interacted with,
 * not by the tile's id. Several entries are penalties -- bumping walls and
 * blocks costs 2, springing a trap costs 5, and hitting the border costs half
 * the level number -- so clumsy play is scored down, not up. Two entries scale
 * with depth. Displayed score is ten times this total.
 */
export function addScore(s: GameState, what: number): void {
  switch (what) {
    case 1: case 2: case 3: s.score += what; break;
    case 4: case 14: if (s.score > 2) s.score -= 2; break;
    case 5: s.score += 1; break;
    case 6: s.score += s.level; break;
    case 7: s.score += 5; break;
    case 9: s.score += 1; break;
    case 10: s.score += 10; break;
    case 11: s.score += 1; break;
    case 15: s.score += 2; break;
    case 16: if (s.score > 5) s.score -= 5; break;
    case 20: if (s.score > s.level) s.score -= Math.floor(s.level / 2); break;
    case 22: s.score += 25; break;
    case 27: s.score += 50; break;
    case 35: s.score += s.level * 2; break;
    case 36: s.score += 50; break;
    case 38: s.score += 1; break;
  }
}

export function die(s: GameState): void {
  s.dead = true;
  sfx(s, 'death');
  s.messages.push('You died.');
}

/**
 * Walk one step. `dx`/`dy` are -1, 0 or 1.
 *
 * `human` is the original's flag of the same name: false when the world moves
 * you rather than you moving yourself, which in practice means gravity. Every
 * "something blocks your way" response is gated on it, so falling against the
 * floor of a gravity level does not buzz at you once per tick.
 */
export function move(s: GameState, dx: number, dy: number, human = true): void {
  if (s.dead || s.won) return;
  const nx = s.px + dx;
  const ny = s.py + dy;

  // On a gravity level you cannot climb unless a rope holds you, or you are
  // stepping onto one. This refuses the move outright, before any tile rule
  // runs -- which matters, because otherwise a rule could act on the world
  // (shoving a boulder, say) and then have the step itself refused, leaving
  // the boulder duplicated.
  if (s.params.sideways && dy === -1 && s.replacement !== 75) {
    const target = at(s, nx, ny);
    if (!(target >= 75 && target <= 80)) return;
  }

  if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) {
    if (!human) return; // gravity pressing you into the floor is not a collision
    addScore(s, 20);
    sfx(s, 'static');
    say(s, 0, 'An Electrified Wall blocks your way.');
    return;
  }

  const tile = at(s, nx, ny);
  switch (tile) {
    case 0: // Null
    case 32: // Stop
      go(s, dx, dy);
      return;

    case 1: // monsters: walking into one costs gems equal to its tier
    case 2:
    case 3: {
      s.gems -= tile;
      sfx(s, 'hurt');
      addScore(s, tile);
      if (s.gems < 0) return die(s);
      go(s, dx, dy);
      return;
    }

    case 4: // breakable blocks
    case 43:
    case 64:
      addScore(s, 4);
      if (!human) return;
      sfx(s, 'block');
      say(s, 4, 'A Breakable Wall blocks your way.');
      return;

    case 5: // Whip
      go(s, dx, dy);
      s.whips += 1;
      sfx(s, 'grab');
      addScore(s, 5);
      say(s, 5, 'You found a Whip.');
      return;

    case 6: // Stairs -- the caller advances the level
      go(s, dx, dy);
      addScore(s, 6);
      sfx(s, 'stairs');
      say(s, 6, 'Stairs take you to the next lower level.');
      return;

    case 7: { // Chest
      go(s, dx, dy);
      const whips = rand(3) + 2;
      const gems = rand(s.difficulty) + 2;
      s.whips += whips;
      s.gems += gems;
      addScore(s, 7);
      s.messages.push(`You found ${gems} gems and ${whips} whips inside the chest!`);
      return;
    }

    case 8: // SlowTime
      go(s, dx, dy);
      addScore(s, 5);
      s.timers[T_SLOWTIME] = 70;
      s.timers[T_SPEEDTIME] = 0;
      say(s, 8, 'Time has slowed down!');
      return;

    case 9: // Gem
      go(s, dx, dy);
      s.gems += 1;
      sfx(s, 'grab');
      addScore(s, 9);
      say(s, 9, 'Gems give you both points and life.');
      return;

    case 10: // Invisible
      go(s, dx, dy);
      addScore(s, 10);
      s.timers[T_INVISIBLE] = 35;
      say(s, 10, 'You are now invisible!');
      return;

    case 11: // Teleport scroll
      go(s, dx, dy);
      s.teleports += 1;
      addScore(s, 11);
      say(s, 11, 'Teleport scrolls move you randomly.');
      return;

    case 12: // Key
      go(s, dx, dy);
      s.keys += 1;
      sfx(s, 'grab');
      say(s, 12, 'You found a key!');
      return;

    case 13: // Door
      if (s.keys < 1) {
        if (!human) return;
        say(s, 13, 'A key is needed to open this door.');
        return;
      }
      s.keys -= 1;
      addScore(s, 11);
      go(s, dx, dy);
      return;

    case 14: // Wall
      if (!human) return;
      addScore(s, 14);
      sfx(s, 'block');
      say(s, 14, 'An impassable Wall blocks your way.');
      return;

    case 17: // River
      if (!human) return;
      addScore(s, 14);
      say(s, 17, 'A river blocks your way.');
      return;

    case 15: // SpeedTime
      go(s, dx, dy);
      addScore(s, 15);
      s.timers[T_SPEEDTIME] = 50;
      s.timers[T_SLOWTIME] = 0;
      say(s, 15, 'Time has speeded up!');
      return;

    case 16: // Trap: throws you somewhere else on the level
      go(s, dx, dy);
      addScore(s, 16);
      teleportToEmpty(s);
      say(s, 16, 'You activated a trap!');
      return;

    case 18: // Power: stronger whip
      go(s, dx, dy);
      addScore(s, 15);
      s.whipPower += 1;
      say(s, 18, 'Your whip power has increased!');
      return;

    case 19: // Forest
      if (!human) return;
      addScore(s, 4);
      say(s, 19, 'A forest blocks your way.');
      return;

    case 20: // Tree
      if (!human) return;
      addScore(s, 4);
      say(s, 20, 'A tree blocks your way.');
      return;

    case 21: // Bomb
      go(s, dx, dy);
      detonate(s);
      say(s, 21, 'BOOOOOM!!');
      return;

    case 22: // Lava
      s.gems -= 10;
      if (s.gems < 0) {
        s.gems = 0;
        return die(s);
      }
      addScore(s, 22);
      go(s, dx, dy);
      say(s, 22, 'You have been burned by the lava.');
      return;

    case 23: // Pit: you step in first, then it is over
      go(s, dx, dy);
      emit(s, 'pit');
      s.messages.push('* SPLAT!! *');
      return die(s);

    case 24: // Tome of Kroz -- the goal
      go(s, dx, dy);
      s.score += 5000;
      s.won = true;
      emit(s, 'tome');
      s.messages.push('You found the Tome of Kroz!');
      return;

    case 26: // Freeze
      go(s, dx, dy);
      s.timers[T_FREEZE] = 55;
      say(s, 26, 'Creatures are frozen for a short while!');
      return;

    case 27: // Nugget
      go(s, dx, dy);
      addScore(s, 27);
      say(s, 27, 'You found a gold nugget!');
      return;

    case 29: // Invisible block reveals itself as a block
      put(s, nx, ny, 4);
      say(s, 29, 'You bumped into an invisible wall.');
      return;

    case 30: // Invisible wall
      put(s, nx, ny, 14);
      say(s, 30, 'You bumped into an invisible wall.');
      return;

    case 31: // Invisible door
      put(s, nx, ny, 13);
      say(s, 31, 'You bumped into an invisible door.');
      return;

    case 45: // Chance
      go(s, dx, dy);
      say(s, 45, 'A mystery!');
      return;

    case 65: { // Rock: shoved one cell further in the direction of travel
      const rx = s.px + dx * 2;
      const ry = s.py + dy * 2;
      if (rx < 0 || rx >= WIDTH || ry < 0 || ry >= HEIGHT) {
        addScore(s, 20);
        say(s, 65, 'The rock will not budge.');
        return;
      }
      const beyond = at(s, rx, ry);

      // Rolling the rock along a rope is allowed, but not up or down one.
      const onRope = s.replacement === 75 && dy !== 0;

      if (beyond >= 1 && beyond <= 3) {
        s.score += beyond; // the rock crushes a monster
      } else if (ROCK_CRUSHES.has(beyond)) {
        // the rock destroys whatever item was there
      } else if (beyond === 6 || beyond === 23) {
        // Stairs or a pit behind the rock: it topples in and is gone, and you
        // take its square. This is the only way into level 1's stairwell.
        go(s, dx, dy);
        say(s, 65, 'The boulder tumbles away!');
        return;
      } else if (beyond === 66) {
        // An electrified wall shorts out: rock and wall both vanish.
        put(s, rx, ry, 0);
        go(s, dx, dy);
        say(s, 66, 'The rock shatters the electrified wall!');
        return;
      } else if (!ROCK_ROLLS_INTO.has(beyond) || onRope) {
        say(s, 65, 'The rock will not budge.');
        return;
      }

      put(s, rx, ry, 65);
      go(s, dx, dy);
      say(s, 65, 'You can push some rocks out of your way.');
      return;
    }

    case 28: // Quake: rubble rains across the level
      go(s, dx, dy);
      for (let i = 0; i < 50; i++) {
        const x = rand(WIDTH);
        const y = rand(HEIGHT);
        if (QUAKE_TAKES.has(at(s, x, y))) put(s, x, y, 65);
      }
      put(s, s.px, s.py, 40);
      say(s, 28, 'An earthquake shakes rubble loose!');
      return;

    case 34: { // Creature zap: kills up to 40 monsters at random
      go(s, dx, dy);
      let killed = 0;
      for (let tries = 0; tries < 600 && killed < 40; tries++) {
        const tier = rand(3) + 1;
        const slots = s.tiers[tier];
        if (!slots || slots.length < 2) continue;
        const i = rand(slots.length);
        const m = slots[i];
        if (!m) continue;
        put(s, m.x, m.y, 0);
        slots[i] = null;
        killed += 1;
      }
      emit(s, 'zap');
      s.messages.push(`The zap spell destroys ${killed} creatures!`);
      return;
    }

    case 36: // Monster generator: solid, but a whip destroys it
      if (!human) return;
      say(s, 36, 'A creature generator! Whip it to destroy it.');
      return;

    case 44: // Block spell: dissolves every ZBlock on the level
      go(s, dx, dy);
      clearAll(s, 43);
      clearAll(s, 44);
      say(s, 44, 'The blocks crumble away!');
      return;

    case 47: // Wall vanish trap: turns walls invisible
      go(s, dx, dy);
      for (let i = 0; i < 75; i++) {
        for (let tries = 0; tries < 200; tries++) {
          const x = rand(WIDTH);
          const y = rand(HEIGHT);
          const here = at(s, x, y);
          if (here === 4) { put(s, x, y, 29); break; }
          if (here === 14) { put(s, x, y, 30); break; }
        }
      }
      say(s, 47, 'Some walls have turned invisible!');
      return;

    case 81: // The Amulet of Yendor, a Rogue joke on level 26
      go(s, dx, dy);
      s.score += 2500;
      emit(s, 'amulet');
      s.messages.push('You have found the Amulet of Yendor -- 25,000 points!');
      say(s, 81, 'It seems that Kroz and Rogue share the same underground!');
      return;

    case 82: // Magic spears, flying right and left
    case 83:
      go(s, dx, dy);
      throwSpear(s, tile === 82 ? 1 : -1);
      say(s, 82, 'A magic spear flies out!');
      return;

    case 41: // ShowGems: a scattering of gems appears
      go(s, dx, dy);
      spawn(s, 9, s.difficulty * 2 + 5);
      say(s, 41, 'You found a cache of gems!');
      return;

    case 38: // Moving block: solid to the player
      if (!human) return;
      addScore(s, 4);
      say(s, 38, 'A moving wall blocks your way.');
      return;

    case 35: // Create: floods the level with monsters -- or, on a sideways
             // level, is a gem eraser instead.
      go(s, dx, dy);
      if (s.params.sideways) {
        if (s.gems >= 10) s.gems -= 3;
        say(s, 35, 'Something drained three of your gems!');
        return;
      }
      addScore(s, 35);
      spawn(s, 1, 45);
      say(s, 35, 'You hear a loud rumbling...');
      return;

    case 33: // Traps: springing one erases every trap of its kind
    case 37:
    case 39:
    case 67:
    case 224: case 225: case 226: case 227:
    case 228: case 229: case 230: case 231:
      go(s, dx, dy);
      clearAll(s, tile);
      say(s, 33, 'You sprung a trap!');
      return;

    case 61: // Closed-wall spells turn their hidden walls solid
    case 62:
    case 63: {
      const hidden = tile - 6; // 61->55, 62->56, 63->57
      go(s, dx, dy);
      for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === hidden) s.cells[i] = 14;
      say(s, 61, 'A magical wall has appeared!');
      return;
    }

    case 48: // K, R, O and Z, collected in that order, pay a bonus
    case 49:
    case 50:
    case 51: {
      go(s, dx, dy);
      const wanted = tile - 48; // K=0, R=1, O=2, Z=3
      if (s.bonus === wanted) {
        s.bonus += 1;
        if (s.bonus === 4) {
          s.score += 1000;
          emit(s, 'kroz');
          s.messages.push('Super Kroz Bonus -- 10,000 points!');
        }
      }
      return;
    }

    case 25: { // Tunnel: a random walk drops you somewhere else
      const fromX = s.px;
      const fromY = s.py;
      go(s, dx, dy);
      put(s, s.px, s.py, 25); // the mouth of the tunnel stays behind

      let x = rand(WIDTH);
      let y = rand(HEIGHT);
      let landed = false;
      for (let i = 0; i < 100 && !landed; i++) {
        const a = rand(3) - 1;
        const b = rand(3) - 1;
        const nx2 = x + a;
        const ny2 = y + b;
        if (nx2 < 0 || ny2 < 0 || nx2 >= WIDTH || ny2 >= HEIGHT) continue;
        if (!TUNNEL_EXIT.has(at(s, nx2, ny2))) continue;
        x = nx2;
        y = ny2;
        landed = true;
      }
      if (!landed) {
        x = fromX;
        y = fromY;
      }
      s.px = x;
      s.py = y;
      const under = at(s, x, y);
      s.replacement = under >= 55 && under <= 57 ? under : 0;
      put(s, x, y, 40);
      say(s, 25, 'A tunnel takes you somewhere else.');
      return;
    }

    case 252: // A tree hiding the 1990 easter egg
      go(s, dx, dy);
      emit(s, 'secret');
      s.messages.push(
        'You notice a secret message carved into the old tree... ' +
          '"Goodness of Heart Overcomes Adversity."',
      );
      say(s, 252, 'Report this to Scott Miller for a Master Kroz Certificate!');
      return;

    case 55: // hidden walls: walkable, and carried by the player
    case 56:
    case 57:
    case 68: // Surround-spawn triggers: eight of something appear around you
    case 69: case 70: case 71: case 72: case 73: case 74: {
      const payload = TRIGGER_SPAWNS[tile] ?? 0;
      go(s, dx, dy);
      if (payload) surround(s, payload);
      emit(s, 'surround');
      say(s, 68, 'Something appears all around you!');
      return;
    }

    case 75: // Rope
      go(s, dx, dy);
      s.oneMove = true;
      say(s, 75, 'You can climb up and down the rope.');
      return;

    case 76: // Rope drop: unrolls a rope down the column it marks
    case 77:
    case 78:
    case 79:
    case 80: {
      const marker = tile;
      go(s, dx, dy);
      s.oneMove = true;
      // Every chord of this same type unrolls, not just the one touched --
      // which is why a level scatters several of one kind.
      for (let x = 0; x < WIDTH; x++) {
        for (let y = 0; y < HEIGHT; y++) {
          if (at(s, x, y) !== marker) continue;
          for (let i = y; i < HEIGHT; i++) {
            // The rope passes through the player, who then carries it.
            if (at(s, x, i) === 40) s.replacement = 75;
            else put(s, x, i, 75);
            if (i + 2 >= HEIGHT || ROPE_STOPS.has(at(s, x, i + 2))) break;
          }
        }
      }
      say(s, 76, 'A rope drops down!');
      return;
    }

    case 58: // Open-wall spells clear every matching wall on the level
    case 59:
    case 60: {
      const target = tile - 6; // 58->52, 59->53, 60->54
      go(s, dx, dy);
      for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === target) s.cells[i] = 0;
      say(s, 58, 'A magical wall has vanished!');
      return;
    }

    case 52: // Open walls, until their spell is found
    case 53:
    case 54:
      addScore(s, 14);
      if (!human) return;
      say(s, 52, 'A Solid Wall blocks your way.');
      return;

    // Punctuation written into the map. Convert_Format gives these their own
    // ids because '.', '?', ',' and ':' are already taken as tile characters,
    // so they are signpost lettering and simply block, like the letters do.
    case 180: case 181: case 182: case 183: case 184: case 195:
      return;

    case 66: // Electrified wall: shocks you for a gem, and does not yield
      if (!human) return;
      s.gems -= 1;
      sfx(s, 'static');
      addScore(s, 20);
      if (s.gems < 0) return die(s);
      say(s, 66, 'You hit an Electrified Wall!  You lose one Gem.');
      return;

    case 42: // Tablet of Wisdom: scores, speaks, and sometimes rewrites the level
      go(s, dx, dy);
      sfx(s, 'grab');
      say(s, 42, 'You found an Ancient Tablet of Wisdom...2,500 points!');
      readTablet(s);
      return;

    case 46: // Statue: drains gems while it stands
      if (!human) return;
      say(s, 46, 'A statue watches you.');
      return;

    default:
      // No rule yet: block the step and remember, so gaps show up in the HUD.
      s.unimplemented.add(tile);
      return;
  }
}
