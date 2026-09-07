/**
 * Engine smoke tests.
 *
 * These build small hand-made playfields rather than using level data, so each
 * rule is exercised in isolation and the result does not depend on the random
 * scatter. Run with `npm run smoke`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TilesDoc } from '../src/types.ts';
import { HEIGHT, WIDTH, buildMapChars } from '../src/engine/playfield.ts';
import { newGame, put, type GameState } from '../src/engine/state.ts';
import { move } from '../src/engine/move.ts';
import { moveTier } from '../src/engine/monsters.ts';
import { whip } from '../src/engine/game.ts';
import { describeTile } from '../src/tiledex.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const tiles = JSON.parse(
  readFileSync(join(HERE, '..', 'src', 'data', 'tiles.json'), 'utf8'),
) as TilesDoc;

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

/** An empty field with the player in the middle. */
function blank(): GameState {
  const s = newGame();
  s.cells = new Uint8Array(WIDTH * HEIGHT);
  s.px = 10;
  s.py = 10;
  put(s, s.px, s.py, 40);
  return s;
}

console.log('\nplayer movement');
{
  const s = blank();
  move(s, 1, 0);
  check('steps into empty space', [s.px, s.py], [11, 10]);

  put(s, 12, 10, 14); // wall
  move(s, 1, 0);
  check('wall blocks the step', [s.px, s.py], [11, 10]);
  check('wall raises its hint once', s.messages.length, 1);
  s.messages.length = 0;
  move(s, 1, 0);
  check('hint is not repeated', s.messages.length, 0);
}

console.log('\ngravity against the floor');
{
  // Standing on the bottom row of a gravity level, the fall is refused every
  // tick; it must not report a collision each time.
  const s = blank();
  s.params = { sideways: true, gravOn: true, gravRate: 0 };
  s.px = 10; s.py = HEIGHT - 1;
  s.cells.fill(0); put(s, s.px, s.py, 40);
  for (let i = 0; i < 5; i++) move(s, 0, 1, false);
  check('falling into the floor is silent', [s.messages.length, s.sounds.length], [0, 0]);
  check('and costs nothing', s.score, 0);

  const walked = blank();
  walked.px = 10; walked.py = HEIGHT - 1;
  move(walked, 0, 1); // the player deliberately walking into it still does
  check('but walking into the border still reports', walked.messages.length, 1);
}

console.log('\nitems');
{
  const s = blank();
  put(s, 11, 10, 9); // gem
  move(s, 1, 0);
  check('gem is collected', s.gems, 21);

  put(s, 12, 10, 12); // key
  move(s, 1, 0);
  check('key is collected', s.keys, 1);

  put(s, 13, 10, 13); // door
  move(s, 1, 0);
  check('door consumes the key', [s.keys, s.px], [0, 13]);

  put(s, 14, 10, 13); // another door, no key left
  move(s, 1, 0);
  check('locked door blocks', s.px, 13);
}

console.log('\ncarried tiles');
{
  const s = blank();
  put(s, 11, 10, 75); // rope
  move(s, 1, 0);
  check('rope is carried, not consumed', s.replacement, 75);
  move(s, 1, 0);
  check('rope is restored on leaving', s.cells[10 * WIDTH + 11], 75);
}

console.log('\nmonsters');
{
  const s = blank();
  put(s, 13, 10, 1); // slow monster three cells to the right
  s.tiers[1] = [{ x: 13, y: 10 }];
  moveTier(s, 1, 1, s.sTime);
  check('monster homes in on the player', s.tiers[1]![0], { x: 12, y: 10 });

  moveTier(s, 1, 1, s.sTime);
  check('monster reaches the player', s.tiers[1]![0], { x: 11, y: 10 });
  moveTier(s, 1, 1, s.sTime);
  check('contact costs a gem', s.gems, 19);
  check('monster is consumed on contact', s.tiers[1]![0], null);
}

console.log('\nluring monsters into walls');
{
  const s = blank();
  put(s, 12, 10, 1); // monster
  put(s, 11, 10, 4); // breakable block between it and the player
  s.tiers[1] = [{ x: 12, y: 10 }];
  moveTier(s, 1, 1, s.sTime);
  check('monster and block annihilate', [s.cells[10 * WIDTH + 11], s.tiers[1]![0]], [0, null]);
  check('the kill scores a point', s.score, 1);
}

console.log('\nwhip');
{
  const s = blank();
  s.whips = 1;
  put(s, 11, 10, 1); // adjacent monster
  put(s, 9, 9, 2); // diagonally adjacent monster
  put(s, 11, 11, 3);
  s.tiers[1] = [{ x: 11, y: 10 }];
  whip(s);
  check('whip is spent', s.whips, 0);
  check('all adjacent monsters die', [s.cells[10 * WIDTH + 11], s.cells[9 * WIDTH + 9], s.cells[11 * WIDTH + 11]], [0, 0, 0]);
  check('kills score their tier', s.score, 1 + 2 + 3);

  const t = blank();
  check('whip needs a charge', whip(t), false);

  // Boulders and statues yield to the whip, but rarely at base power, so these
  // check the outcome over many attempts rather than a single crack.
  const rock = blank();
  rock.whips = 400; rock.whipPower = 29; // near-certain, to test the path exists
  put(rock, 11, 10, 65);
  whip(rock);
  check('a boulder can be whipped away', rock.cells[10 * WIDTH + 11], 0);

  const statue = blank();
  statue.whips = 400; statue.whipPower = 49;
  statue.timers[9] = 32000;
  put(statue, 11, 10, 46);
  whip(statue);
  check('whipping a statue stops the gem drain', [statue.cells[10 * WIDTH + 11], statue.timers[9]], [0, -1]);
}

console.log('\npushing rocks');
{
  const s = blank();
  put(s, 11, 10, 65);
  move(s, 1, 0);
  check('rock is shoved one cell on', [s.cells[10 * WIDTH + 12], s.px], [65, 11]);

  const blocked = blank();
  put(blocked, 11, 10, 65);
  put(blocked, 12, 10, 14); // wall right behind it
  move(blocked, 1, 0);
  check('rock against a wall will not move', blocked.px, 10);

  const crush = blank();
  crush.px = 10;
  put(crush, 11, 10, 65);
  put(crush, 12, 10, 2); // a monster behind the rock
  move(crush, 1, 0);
  check('rock crushes a monster and scores', [crush.cells[10 * WIDTH + 12], crush.score], [65, 2]);

  const stairs = blank();
  put(stairs, 11, 10, 65);
  put(stairs, 12, 10, 6); // stairs behind the rock
  move(stairs, 1, 0);
  check('rock topples into stairs and clears', [stairs.px, stairs.cells[10 * WIDTH + 12]], [11, 6]);

  const pit = blank();
  put(pit, 11, 10, 65);
  put(pit, 12, 10, 23); // pit behind the rock
  move(pit, 1, 0);
  check('rock topples into a pit too', pit.px, 11);

  const grav = blank();
  grav.params = { sideways: true, gravOn: true };
  put(grav, 10, 9, 65);  // a boulder directly above the player
  const rocksBefore = grav.cells.filter((t) => t === 65).length;
  move(grav, 0, -1);
  check('gravity refuses an upward push', grav.py, 10);
  check('and does not duplicate the boulder', grav.cells.filter((t) => t === 65).length, rocksBefore);

  const edge = blank();
  edge.px = WIDTH - 2;
  put(edge, WIDTH - 1, 10, 65);
  move(edge, 1, 0);
  check('rock at the edge will not move', edge.px, WIDTH - 2);
}

console.log('\nbomb');
{
  const s = blank();
  put(s, 11, 10, 21); // bomb
  put(s, 13, 12, 4); // block inside the blast
  put(s, 20, 10, 4); // block outside it
  move(s, 1, 0);
  check('blast clears nearby tiles', s.cells[12 * WIDTH + 13], 0);
  check('blast has a radius', s.cells[10 * WIDTH + 20], 4);
  check('player survives the blast', s.cells[10 * WIDTH + 11], 40);
}

console.log('\ndrop-chords');
{
  const s = blank();
  put(s, 11, 10, 76);        // the chord the player touches
  put(s, 20, 4, 76);         // another of the same type, elsewhere
  put(s, 20, 9, 14);         // a wall for its rope to stop above
  move(s, 1, 0);
  // Stepping onto a chord consumes it -- the player now occupies that cell --
  // so the rope unrolls at the OTHER chords of the same type, not underfoot.
  check('the touched chord is consumed', s.cells[10 * WIDTH + 11], 40);
  check('nothing unrolls under the player', s.cells[11 * WIDTH + 11], 0);
  check('other chords of the same type unroll', s.cells[4 * WIDTH + 20], 75);
  // The stop test looks two cells ahead, so the rope halts one short of the wall.
  check('rope runs down the column', [s.cells[5 * WIDTH + 20], s.cells[7 * WIDTH + 20]], [75, 75]);
  check('and stops short of the wall', [s.cells[8 * WIDTH + 20], s.cells[9 * WIDTH + 20]], [0, 14]);
}

console.log('\ntablets');
{
  // A transmuting tablet rewrites the whole level, not just the cell you stand on.
  const s = blank();
  s.level = 37;
  put(s, 20, 5, 65); put(s, 40, 12, 65); // boulders elsewhere on the level
  put(s, 11, 10, 42); // the tablet
  move(s, 1, 0);
  check('boulders become gems', [s.cells[5 * WIDTH + 20], s.cells[12 * WIDTH + 40]], [9, 9]);
  check('the tablet speaks', s.messages.length > 1, true);

  const l61 = blank();
  l61.level = 61;
  put(l61, 30, 4, 52); // an open-wall
  put(l61, 11, 10, 42);
  move(l61, 1, 0);
  check('level 61 tablet clears open-walls', l61.cells[4 * WIDTH + 30], 0);

  const plain = blank();
  plain.level = 2; // a hint-only tablet
  put(plain, 11, 10, 42);
  const before = plain.score;
  move(plain, 1, 0);
  check('tablets score level + 250', plain.score - before, 2 + 250);
}

console.log('\ntile descriptions');
{
  // Tile ids and ASCII codes overlap, so a declared tile must never be
  // reported as the letter with the same numeric value.
  check('boulder is not "A"', describeTile(65, true, true).slice(0, 10), 'A boulder.'.slice(0, 10));
  check('electrified wall is not "B"', describeTile(66, true, true).startsWith('An electrified'), true);
  check('K letter is not "0"', describeTile(48, true, true).startsWith('The letter K'), true);
  check('unmapped byte is lettering', describeTile(97, true, false), 'The letter "A", carved into the level.');
  check('hidden tiles stay hidden', describeTile(33, false, true), 'Nothing you can see.');
}

console.log('\nlevel data still loads');
{
  const mapChars = buildMapChars(tiles);
  check('map characters parsed', mapChars.get('#'), 14);
  check('player character parsed', mapChars.get('P'), 40);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failures\n`);
process.exit(failures === 0 ? 0 : 1);
