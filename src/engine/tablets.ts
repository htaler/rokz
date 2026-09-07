/**
 * Ancient Tablets of Wisdom.
 *
 * Walking onto a tablet scores Level + 250 and then runs Tablet_Message for the
 * current level. Twenty-two levels have one. Most give a hint -- some of them
 * genuinely useful, a few of them lies -- but a third of them actually rewrite
 * the level, transmuting one tile type into another across the whole board.
 * Those are introduced by a short prayer, and they are the closest thing Kroz
 * has to a spell you cast rather than pick up.
 */

import type { GameState } from './state.ts';

/** Replace every cell of one type with another, level-wide. */
function transmute(s: GameState, from: number, to: number): void {
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === from) s.cells[i] = to;
}

const PRAYER = [
  'On the Ancient Tablet is a short Mantra, a prayer...',
  'You take a deep breath and speak the words aloud...',
];

interface Tablet {
  lines: string[];
  effect?: (s: GameState) => void;
}

/**
 * Levels 64 and 75 are written backwards -- read them in a mirror. They are
 * Scott Miller talking to anyone who got that deep.
 */
export const TABLETS: Record<number, Tablet> = {
  1: { lines: ['Once again you uncover the hidden tunnel leading to Kroz!'] },
  2: { lines: ['Warning to all Adventurers:  No one returns from Kroz!'] },
  4: { lines: ['Adventurer, try the top right corner if you desire.'] },
  6: { lines: ['A strange magical gravity force is tugging you downward!'] },
  8: { lines: ['Play this level as if viewing it from the side.'] },
  9: { lines: ['Explorer, you fell into a trap with no way out!'] },
  10: { lines: ['A magical forest grows out of control in this region of Kroz!'] },
  11: { lines: ['The tunnel below contains a magic spell.'] },
  18: { lines: ['Adventurer, check the "Valley of the M"!'] },
  22: { lines: ['These walls will seek to entrap you!'] },
  24: { lines: ['You have choosen the greedy path Adventurer!'] },

  26: {
    lines: [
      'No one has ever made it to the 26th level!',
      'You have shown exceptional skills to reach this far...',
      'Therefore I grant you the power to see...',
      'Behold...your path awaits...',
    ],
    effect: (s) => transmute(s, 30, 54), // invisible walls become visible
  },
  30: {
    lines: [...PRAYER, '"If goodness is in my heart, that which flows shall..."', '"...Turn to Gold!"'],
    effect: (s) => transmute(s, 17, 27), // rivers become nuggets
  },
  32: {
    lines: ['Adventurer, your path will be cleared...'],
    effect: (s) => { transmute(s, 43, 0); transmute(s, 44, 0); }, // as a block spell
  },
  37: {
    lines: [...PRAYER, '"Useless bits of rock, rubble and boulders, shall become..."', '"...Precious Gems of value!"'],
    effect: (s) => transmute(s, 65, 9), // boulders become gems
  },
  40: { lines: ["You'll need two keys from level 38 to complete this level!"] },
  42: {
    lines: [...PRAYER, '"Barriers of water, like barriers in life, can always be..."', '"...Overcome!"'],
    effect: (s) => transmute(s, 17, 43), // rivers become breakable blocks
  },
  46: { lines: ['Follow the sequence if you wish to be successful.'] },
  48: {
    lines: [...PRAYER, '"A gift can be granted to those who are worthy..."', '"...And you are found worthy, Adventurer!"'],
    effect: (s) => transmute(s, 55, 9), // hidden walls become gems
  },
  52: { lines: ['Up 4 steps, then left 16 steps.'] },
  54: { lines: ['K stands from Kroz!'] },
  56: {
    lines: ['The Lava parts to give you access!'],
    effect: (s) => transmute(s, 17, 32), // on this level rivers are drawn as lava
  },
  61: {
    lines: ['Walls that block your progress shall be removed...'],
    effect: (s) => transmute(s, 52, 0), // as an open-wall spell
  },
  64: {
    lines: [...PRAYER, '"Tnarg yna rerutnevda ohw sevivrus siht raf..."', '"...Dlog!"'],
    effect: (s) => transmute(s, 55, 27),
  },
  66: { lines: ['"Figurit\'s Revenge" appeared in the popular game Jumpman!'] },
  68: {
    lines: ['Suddendly, the lava begins to bubble and flow!'],
    effect: (s) => { s.params.lavaFlow = true; s.params.lavaRate = 75; },
  },
  71: {
    lines: [...PRAYER, '"Those not blinded by hate..."', '"...will be allowed to see!"'],
    effect: (s) => { s.params.revealBlocks = true; }, // level 71 stops hiding its blocks
  },
  72: {
    lines: [
      'You feel the entire chamber shiver for a brief moment...',
      'then a message magically appears on the tablet...',
      '"Find the Sacred Tome of Kroz, use it\'s wisdom to free us..."',
      'The the tablet disentagrates in your hands!',
      'You wonder for a moment what the message meant...',
      'And resume you journey no more enlightened than before.',
    ],
  },
  74: {
    lines: [
      'Suddenly an intense heat sweeps over this entire chamber...',
      'You begin to sweat profusely and drink some of your water!',
    ],
    effect: (s) => { s.params.evapoRate = 30; },
  },
  75: {
    lines: [
      ...PRAYER,
      '"Ttocs Rellim Setalutargnoc Uoy!"',
      'Your palms sweat as the words echo through the chamber...',
      '...Your eyes widen with anticipation!',
    ],
    effect: (s) => transmute(s, 23, 65), // the pits fill with boulders
  },
};

/** Read the tablet on this level: score it, speak it, and apply its magic. */
export function readTablet(s: GameState): void {
  s.score += s.level + 250;
  const tablet = TABLETS[s.level];
  if (!tablet) return;
  for (const line of tablet.lines) s.messages.push(line);
  tablet.effect?.(s);
}
