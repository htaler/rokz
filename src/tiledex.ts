/**
 * Short descriptions for clicking a tile.
 *
 * This is a legend, not an x-ray. The Crawl sprites do not obviously map onto
 * Kroz's vocabulary -- a rune stands in for a key, a box for a chest -- so
 * naming what you can already see removes a translation problem the original
 * never had. What it deliberately does not do is reveal anything hidden:
 * invisible walls, unsprung traps and buried spells report an empty cell, so
 * every puzzle that depends on concealment still works.
 */

export const TILEDEX: Record<number, string> = {
  0: 'Empty floor.',
  1: 'A slow creature. Touching one costs a gem; it dies in the process.',
  2: 'A medium creature. Costs two gems if you walk into it.',
  3: 'A fast creature. Costs three gems if you walk into it.',
  4: 'A breakable wall. Whip it, or lure a creature into it to destroy both.',
  5: 'A whip. Your main weapon, and the only way through trees.',
  6: 'Stairs down to the next level.',
  7: 'A chest. Contains whips and gems; how many depends on difficulty.',
  8: 'A slow-time spell. Creatures move at a fifth speed for a while.',
  9: 'A gem. Gems are both score and life -- at zero, the next hit kills you.',
  10: 'An invisibility potion. You vanish for a short while.',
  11: 'A teleport scroll. Press T to jump somewhere random.',
  12: 'A key. Opens one door.',
  13: 'A door. Consumes a key.',
  14: 'A solid wall. Nothing gets through it.',
  15: 'A speed-time spell. Creatures move flat out -- rarely what you want.',
  16: 'A trap. Steps you somewhere else on the level.',
  17: 'A river. Impassable.',
  18: 'A power ring. Permanently raises your whip power.',
  19: 'Dense forest. One whip crack always clears it.',
  20: 'A tree. Resists the whip; the odds improve with whip power.',
  21: 'A bomb. Clears a wide area, creatures and breakables alike.',
  22: 'Lava. Costs ten gems to cross, and on some levels it spreads.',
  23: 'A bottomless pit. One step in is fatal.',
  24: 'The Tome of Kroz. The goal of the whole descent.',
  25: 'A tunnel. Drops you somewhere else entirely.',
  26: 'A freeze spell. Stops every creature for a while.',
  27: 'A gold nugget. Worth 500 points.',
  28: 'A quake trap. Rains boulders across the level.',
  34: 'A creature zap spell. Destroys up to forty creatures at random.',
  35: 'A creation trap. Floods the level with creatures.',
  36: 'A creature generator. Whip it -- but they only stop once all are gone.',
  38: 'A moving wall. It hunts you, and only travels through open floor.',
  40: 'You.',
  41: 'A reveal-gem scroll. Scatters gems across the level.',
  42: 'A tablet. Something is inscribed here.',
  43: 'A breakable block. A block spell dissolves every one at once.',
  45: 'A chance tile. Something is hidden under it.',
  46: 'A statue. While it stands it steals your gems from anywhere.',
  48: 'The letter K. Take K, R, O and Z in order for a bonus.',
  49: 'The letter R. Second of the four.',
  50: 'The letter O. Third of the four.',
  51: 'The letter Z. Last of the four -- in order, or the bonus is lost.',
  52: 'A wall. Some walls on this level are not what they seem.',
  53: 'A wall. Some walls on this level are not what they seem.',
  54: 'A grey wall. An open-wall spell may clear it.',
  58: 'An open-wall spell. Clears every matching wall on the level.',
  59: 'An open-wall spell. Clears every matching wall on the level.',
  60: 'An open-wall spell. Clears every matching wall on the level.',
  64: 'A grey breakable block.',
  65: 'A boulder. Push it -- including diagonally. Into an electrified wall, both vanish; into stairs or a pit, it falls in.',
  66: 'An electrified wall. Touching it costs a gem. A shoved boulder destroys it.',
  75: 'A rope. You can climb it on levels with gravity.',
  76: 'A rope chord. Touching it unrolls a rope down the level.',
  81: 'The Amulet of Yendor. Rather a long way from its own dungeon.',
  82: 'A magic spear, pointing right. It flies until something solid stops it.',
  83: 'A magic spear, pointing left. It flies until something solid stops it.',
  196: 'A chain rail. The chandeliers hang from it.',
  252: 'A tree.',
};
for (const id of [77, 78, 79, 80]) TILEDEX[id] = TILEDEX[76]!;

/**
 * What to report for a cell.
 *
 * `visible` is false for tiles the renderer draws nothing for -- exactly the
 * ones the game means to keep hidden. `known` says whether the id is a declared
 * tile; only ids that are *not* are the in-map lettering, where Convert_Format
 * fell through to `PF[x,y] := ord(char)` and the character is drawn as itself.
 *
 * That distinction matters because the two spaces overlap: tile 65 is a
 * boulder, but character 65 is "A", and tile 48 is the K bonus letter while
 * character 48 is "0". Deciding by id alone gets all of those wrong.
 */
export function describeTile(id: number, visible: boolean, known: boolean): string {
  if (!visible) return 'Nothing you can see.';
  if (!known) {
    const ch = String.fromCharCode(id).toUpperCase();
    return /[A-Z0-9]/.test(ch)
      ? `The letter "${ch}", carved into the level.`
      : 'Carved into the level.';
  }
  return TILEDEX[id] ?? 'Something unidentifiable.';
}
