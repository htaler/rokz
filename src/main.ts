/**
 * Browser front end: input, HUD and the render loop.
 *
 * The engine underneath is a direct port; this file only drives it. Movement
 * advances the world (see game.ts), and a timer advances it while idle.
 */

import atlasDoc from './data/atlas.json';
import levelsDoc from './data/levels.json';
import tilesDoc from './data/tiles.json';
import type { AtlasDoc, Level, LevelsDoc, TilesDoc } from './types.ts';
import { HEIGHT, WIDTH, buildMapChars } from './engine/playfield.ts';
import {
  DEFAULT_SPEED, Game, SPEEDS, WHIP_FRAME_MS, WHIP_SWEEP,
  type SpeedName, startWhip, stepWhip, teleport,
} from './engine/game.ts';
import { DIFFICULTY, newGame } from './engine/state.ts';
import { Renderer } from './render/renderer.ts';
import { SFX, Speaker, type Step } from './audio/speaker.ts';
import { Achievements } from './achievements.ts';
import { describeTile } from './tiledex.ts';
import { Overlay, type MenuItem, type Screen } from './ui/overlay.ts';
import { SLOTS, describeSlots, read as readSave, restore, type Slot, write as writeSave } from './engine/save.ts';

const atlas = atlasDoc as AtlasDoc;
const levels = (levelsDoc as LevelsDoc).levels;
const tiles = tilesDoc as TilesDoc;
const mapChars = buildMapChars(tiles);
const knownTiles = new Set(tiles.tiles.map((t) => t.id));

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#stage');
const hud = $<HTMLDivElement>('#hud');
const log = $<HTMLDivElement>('#log');
const banner = $<HTMLDivElement>('#banner');
const krozBox = $<HTMLDivElement>('#kroz');
const achievements = new Achievements();
const overlay = new Overlay($<HTMLElement>('#overlay'), $<HTMLElement>('#overlayBody'));

/** The slot furthest into the game, which is what Continue resumes. */
function bestSave(): { slot: Slot; level: number } | null {
  let best: { slot: Slot; level: number } | null = null;
  for (const slot of SLOTS) {
    const snap = readSave(slot);
    if (snap && (!best || snap.level > best.level)) best = { slot, level: snap.level };
  }
  return best;
}

function showStart(): void {
  const save = bestSave();
  const menu: MenuItem[] = [];
  if (save) {
    menu.push({
      key: 'r',
      label: 'Continue',
      detail: `slot ${save.slot} · level ${save.level}`,
      run: () => { overlay.close(); resolveSlotDirect(save.slot); },
    });
  }
  menu.push(
    { key: 'n', label: 'New game', detail: 'clears trophies', run: () => startNewRun() },
    {
      key: 'd',
      label: 'Difficulty',
      detail: named(difficulty),
      run: () => {
        const i = DIFFICULTY_ORDER.findIndex(([v]) => v === difficulty);
        difficulty = DIFFICULTY_ORDER[(i + 1) % DIFFICULTY_ORDER.length]![0];
        showStart();
      },
    },
    {
      key: 's',
      label: 'Speed',
      detail: speedName,
      run: () => {
        speedName = SPEED_ORDER[(SPEED_ORDER.indexOf(speedName) + 1) % SPEED_ORDER.length]!;
        setPace();
        showStart();
      },
    },
    { key: 'h', label: 'How to play', run: () => showHelp() },
    { key: 't', label: 'Trophies', detail: `${achievements.count} of ${achievements.all.length}`, run: () => showAchievements() },
    { key: 'c', label: 'Cheats', detail: 'jump to any level', run: () => showCheats() },
    { key: 'a', label: 'About this port', run: () => showAbout() },
  );
  overlay.open('start', {
    heading: 'a port of The Lost Adventures of Kroz',
    lines: [
      "Scott Miller's 1990 dungeon crawl, rebuilt from the original Turbo Pascal.",
      'Seventy-five levels down. Your gems are your life, and the whip is your way through.',
    ],
    menu,
  });
}

/**
 * A new game is a clean slate, trophies included -- otherwise the discovery
 * ones stay earned forever and stop meaning anything on a second run.
 */
function startNewRun(): void {
  achievements.reset();
  overlay.close();
  game = startLevel(1);
  drawHud();
}

/**
 * Cheats: jumping levels and forcing a difficulty. Kept apart from the ordinary
 * settings because both skip the game rather than configure it -- a level
 * entered directly also gets a loadout it would never have earned.
 */
function showCheats(): void {
  overlay.open('cheats', {
    heading: 'Cheats',
    lines: [
      'Jumping straight to a level also hands you supplies for it, since nothing carried over from the levels you skipped.',
    ],
    build: (body) => {
      const form = document.createElement('div');
      form.className = 'cheatrow';
      const label = document.createElement('label');
      label.textContent = `Jump to level (1–${levels.length})`;
      label.htmlFor = 'levelJump';
      const input = document.createElement('input');
      input.id = 'levelJump';
      input.type = 'number';
      input.min = '1';
      input.max = String(levels.length);
      input.value = String(game.state.level);
      const go = () => {
        const n = Number(input.value);
        if (!Number.isInteger(n) || n < 1 || n > levels.length) return;
        const from = game.state.level;
        const screen = snapshotScreen();
        overlay.close();
        location.hash = String(n);
        game = startLevel(n);
        startWipe(from);
        if (wipe) wipe.under = screen;
        drawHud();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // the panel's own key handling must not eat digits
        if (e.key === 'Enter') go();
        if (e.key === 'Escape') overlay.close();
      });
      const button = document.createElement('button');
      button.className = 'go';
      button.textContent = 'Go';
      button.addEventListener('click', go);
      form.append(label, input, button);
      body.append(form);
      queueMicrotask(() => input.focus());
    },
    menu: [
      {
        key: 'd',
        label: 'Difficulty',
        detail: named(difficulty),
        run: () => {
          const i = DIFFICULTY_ORDER.findIndex(([v]) => v === difficulty);
          difficulty = DIFFICULTY_ORDER[(i + 1) % DIFFICULTY_ORDER.length]![0];
          showCheats();
        },
      },
      { key: 'b', label: 'Back', run: () => showStart() },
    ],
  });
}

function showHelp(): void {
  overlay.open('help', {
    heading: 'How to play',
    lines: [
      'Reach the stairs on each level. Gems are both your score and your life: touch a creature and you lose one, run out and you die.',
    ],
    grid: [
      ['Move', 'Arrows, WASD or the numpad'],
      ['Diagonally', 'Q E Z C, or numpad 7 9 1 3'],
      ['Space', 'Crack the whip at everything adjacent'],
      ['T', 'Spend a teleport scroll'],
      ['P', 'Pause'],
      ['K / L', 'Save to a slot, load from one'],
      ['Shift-R', 'Restart this level'],
      ['?', 'This screen'],
      ['V', 'Trophies'],
      ['Click a tile', 'Name whatever is on it'],
    ],
    menu: [{ key: 'b', label: 'Back', run: () => showStart() }],
  });
}

function showAchievements(): void {
  overlay.open('achievements', {
    heading: `Trophies · ${achievements.count} of ${achievements.all.length}`,
    menu: [{ key: 'b', label: 'Back', run: () => showStart() }],
  });
  // The list is dense, so it is built directly rather than through the panel's
  // simple line and grid forms.
  const body = $<HTMLElement>('#overlayBody');
  const list = document.createElement('dl');
  list.className = 'grid';
  for (const group of ['Discovery', 'Mastery', 'Progress', 'Curios'] as const) {
    const h = document.createElement('h4');
    h.textContent = group;
    list.append(h);
    for (const a of achievements.all.filter((x) => x.group === group)) {
      const got = achievements.has(a.id);
      const dt = document.createElement('dt');
      dt.className = got ? 'ach got' : 'ach';
      dt.textContent = got ? '★' : '☆';
      const dd = document.createElement('dd');
      dd.className = got ? 'ach got' : 'ach';
      dd.textContent = got ? `${a.name} — ${a.hint}` : a.secret ? '???' : `${a.name} — ${a.hint}`;
      list.append(dt, dd);
    }
  }
  body.insertBefore(list, body.querySelector('.menu'));
}

function showAbout(): void {
  overlay.open('about', {
    heading: 'About this port',
    lines: [
      'Kroz was Apogee’s first game, written by Scott Miller between 1987 and 1990. Apogee released it as freeware in 2009, source code included.',
      'This port reads that Turbo Pascal directly: every level, tile rule and sound is extracted from it, and the 943 hand-drawn layout rows still match the original byte for byte.',
      'Tiles are the Dungeon Crawl Stone Soup set, released to the public domain by its authors. The chains and ceiling rail are cut from a Castlevania asset pack by MidnitePixel, used with permission. The gems are drawn here.',
      'Kroz is a trademark of Apogee Software. The original source is GPL v2, and so is this port.',
    ],
    menu: [{ key: 'b', label: 'Back', run: () => showStart() }],
  });
}

/** Load a slot without going through the two-step prompt. */
function resolveSlotDirect(slot: Slot): void {
  const snap = readSave(slot);
  if (!snap) return;
  game = startLevel(snap.level, snap.difficulty);
  game.load(snap.level);
  restore(game.state, snap);
  prompt(`Resumed slot ${slot} — level ${snap.level}.`);
  drawHud();
}
const mutePicker = $<HTMLInputElement>('#mute');
const trophyBox = $<HTMLElement>('#trophy');

/** Chosen before a run starts, from the menu, rather than mid-play. */
let difficulty: number = DIFFICULTY.novice;
let speedName: SpeedName = DEFAULT_SPEED;

const DIFFICULTY_ORDER: [number, string][] = [
  [DIFFICULTY.novice, 'Novice'], [DIFFICULTY.experienced, 'Experienced'],
  [DIFFICULTY.advanced, 'Advanced'], [DIFFICULTY.secret, 'Secret'],
];
const SPEED_ORDER: SpeedName[] = ['relaxed', 'normal', 'brisk', 'frantic'];
const named = (n: number) => DIFFICULTY_ORDER.find(([v]) => v === n)?.[1] ?? 'Novice';

const sheet = new Image();
sheet.src = atlas.meta.image;
await sheet.decode();

const renderer = new Renderer(canvas, atlas, sheet, knownTiles);
const speaker = new Speaker();

/**
 * Play whatever the engine raised and freeze the world for that long.
 *
 * This is the original's timing model: `delay()` blocks, so a sound is a pause.
 * A footstep is 120ms, which is why moving cannot outrun the game no matter how
 * fast you press keys -- and why the pacing held up across every machine Kroz
 * ran on, since Turbo Pascal calibrated Delay against the CPU.
 */
function drainSounds(): void {
  const s = game.state;
  if (!s.sounds.length) return;
  let total = 0;
  for (const name of s.sounds) {
    const make = SFX[name as keyof typeof SFX];
    if (make) total += speaker.play(make() as Step[]);
  }
  s.sounds.length = 0;
  if (total > 0) s.blockedUntil = performance.now() + total;
}

/**
 * A testing loadout for levels entered directly from the picker.
 *
 * Init_Screen only ever equips you for level 1, because the original assumes
 * you arrive anywhere else by playing there. Jumping straight to level 40 with
 * no whips is unplayable, so a direct jump grants roughly what a player would
 * have accumulated by then. This is a development affordance, not the game:
 * it is applied here in the UI layer, never in the engine, and arriving at a
 * level by taking the stairs carries your real inventory instead.
 */
function equipForTesting(state: ReturnType<typeof newGame>, n: number): void {
  if (n <= 1) return; // level 1 is the real starting loadout
  state.gems += n * 2;
  state.whips += 15 + n;
  state.teleports += 2 + Math.floor(n / 10);
  state.keys += 2;
  state.whipPower += Math.floor(n / 25);
}

function startLevel(n: number, difficultyOverride?: number): Game {
  const chosen = difficultyOverride ?? difficulty;
  const state = newGame(chosen);
  state.level = n;
  equipForTesting(state, n);
  return new Game(state, levels, mapChars);
}

const opening = fromHash();
let game = startLevel(opening.level, opening.difficulty);
let frame = 0;


/** `#12` selects level 12; `#12,9` also sets difficulty. Linkable and reloadable. */
function fromHash(): { level: number; difficulty: number } {
  const [rawLevel, rawDifficulty] = location.hash.slice(1).split(',');
  const n = Number(rawLevel);
  const d = Number(rawDifficulty);
  return {
    level: Number.isInteger(n) && n >= 1 && n <= levels.length ? n : 1,
    difficulty: [2, 5, 8, 9].includes(d) ? d : difficulty,
  };
}

/** PrintNum appends a zero to the score, so the HUD shows ten times the total. */
function displayScore(score: number): string {
  return score > 0 ? `${score}0` : '0';
}

/**
 * Drain the engine's event channel and award anything newly earned.
 *
 * Achievements only ever read state; nothing here can influence play.
 */
/**
 * Announce a trophy over the playfield.
 *
 * Reassigning the animation forces it to restart, so trophies earned in quick
 * succession each get their own moment instead of the first one's fade
 * swallowing the rest.
 */
let trophyTimer: number | undefined;
function announceTrophy(name: string): void {
  trophyBox.replaceChildren();
  const what = document.createElement('div');
  what.className = 'what';
  what.textContent = 'Trophy earned';
  const who = document.createElement('div');
  who.className = 'name';
  who.textContent = name;
  trophyBox.append(what, who);
  trophyBox.hidden = false;
  trophyBox.style.animation = 'none';
  void trophyBox.offsetWidth;
  trophyBox.style.animation = '';
  speaker.play(SFX.trophy());
  clearTimeout(trophyTimer);
  trophyTimer = setTimeout(() => { trophyBox.hidden = true; }, 2800) as unknown as number;
}

function checkAchievements(): void {
  const s = game.state;
  const events = new Set(s.events);
  s.events.length = 0;
  const won = achievements.check(s, events);
  if (!won.length) return;
  log.textContent = won.map((a) => `★ ${a.name} — ${a.hint}`).join('   ');
  announceTrophy(won[0]!.name);
}

/**
 * The level-change wipe.
 *
 * Two passes of an expanding rectangle: the first fills the level you are
 * leaving with its gem colour, the second clears to black. The screen you are
 * leaving is snapshotted first, because the wipe covers the old level -- by the
 * time it runs, the engine has already swapped in the new one.
 */
const WIPE_STEPS = 30;
const WIPE_MS = 14;

/** The CGA palette, for the colour of the first pass. */
const CGA = [
  '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
];

let wipe: { step: number; phase: 0 | 1; under: HTMLCanvasElement | null; colour: string } | null = null;
let wipeTimer: number | undefined;

/** Copy the canvas as it stands, to play the wipe over. */
function snapshotScreen(): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  return copy;
}

function startWipe(fromLevel: number): void {
  clearInterval(wipeTimer);
  wipe = {
    step: 0,
    phase: 0,
    under: snapshotScreen(),
    colour: CGA[(fromLevel * 9 + 5) % CGA.length]!,
  };
  speaker.play(SFX.wipe());
  wipeTimer = setInterval(() => {
    if (!wipe) return;
    wipe.step += 1;
    if (wipe.step <= WIPE_STEPS) return;
    if (wipe.phase === 0) {
      // Second pass: the same expansion again, this time clearing to black.
      wipe = { ...wipe, step: 0, phase: 1, under: null };
      return;
    }
    clearInterval(wipeTimer);
    wipe = null;
    enteredAt = performance.now(); // the arrival flash starts as the wipe ends
  }, WIPE_MS) as unknown as number;
}

/** Restart the entry spotlight whenever the level actually changes. */
let lastLevel = -1;
function noteLevelChange(): void {
  if (game.state.level !== lastLevel) {
    lastLevel = game.state.level;
    document.title = `Rokz — level ${game.state.level}`;
    enteredAt = performance.now();
    achievements.enterLevel(game.state.level);
  }
}

/** How long the entry spotlight lasts. */
const FLASH_MS = 1600;
let enteredAt = performance.now();

/**
 * The K-R-O-Z tracker.
 *
 * The letters must be taken in order, and stepping on one out of order consumes
 * it without credit -- so the bonus can become impossible while the level looks
 * unchanged. Showing which letters are banked, which are still out there, and
 * which have been lost makes that visible instead of silent.
 */
function drawKroz(): void {
  const s = game.state;
  const onBoard = new Set<number>();
  for (const cell of s.cells) if (cell >= 48 && cell <= 51) onBoard.add(cell);
  const anyEver = onBoard.size > 0 || s.bonus > 0;
  krozBox.hidden = !anyEver;
  if (!anyEver) return;

  krozBox.replaceChildren(
    ...['K', 'R', 'O', 'Z'].map((letter, i) => {
      const el = document.createElement('span');
      el.textContent = letter;
      el.className = i < s.bonus ? 'got' : onBoard.has(48 + i) ? 'out' : 'lost';
      el.title = i < s.bonus ? 'collected' : onBoard.has(48 + i) ? 'still on this level' : 'lost';
      return el;
    }),
  );
}

function drawHud(): void {
  const s = game.state;
  const status = s.dead ? ' · DEAD' : s.won ? ' · WON' : '';
  banner.hidden = !(s.dead || s.won || paused);
  if (paused && !s.dead && !s.won) {
    banner.textContent = 'PAUSED    Press any key to resume game.';
    banner.className = 'paused';
  } else if (s.dead || s.won) {
    banner.textContent = s.dead
      ? 'YOU HAVE DIED!!    Shift-R to restart · L to load a save'
      : 'YOUR QUEST FOR THE ANCIENT TOME OF KROZ WAS SUCCESSFUL!!    R to play the level again';
    banner.className = s.dead ? 'dead' : 'won';
  }
  hud.textContent =
    `level ${s.level}  score ${displayScore(s.score)}  gems ${s.gems}  whips ${s.whips}  ` +
    `teleports ${s.teleports}  keys ${s.keys}  whip power ${s.whipPower}${status}`;
  // Gems are health, so the original switches the counter to a warning colour
  // once it drops below ten: `if Gems > 9 then col(4,7) else col(20,23)`.
  hud.style.color = s.gems > 9 ? '' : '#ff6b5a';
  drawKroz();
  noteLevelChange();

  if (s.messages.length) {
    log.textContent = s.messages.join('  ·  ');
    s.messages.length = 0;
  }
  if (s.unimplemented.size) {
    log.textContent = `(no rule yet for tile ${[...s.unimplemented].join(', ')})`;
    s.unimplemented.clear();
  }
}

/**
 * Pause, as the original's P key: the world stops and any key resumes. The
 * resuming key is swallowed rather than acted on, so you do not walk somewhere
 * on the way back in.
 */
let paused = false;

let whipTimer: number | undefined;

/** Drive the eight-position sweep; each step lands its own damage. */
function crackWhip(): void {
  if (!startWhip(game.state)) return;
  clearInterval(whipTimer);
  whipTimer = setInterval(() => {
    if (paused) return;
    drainSounds();
    if (!stepWhip(game.state)) {
      clearInterval(whipTimer);
      whipTimer = undefined;
      game.idle();
    }
    drawHud();
  }, WHIP_FRAME_MS) as unknown as number;
}

/**
 * Save and restore both need a slot letter, so `S` or `R` arms a prompt and the
 * next A/B/C answers it -- the same two-step the original uses.
 */
let pending: 'save' | 'restore' | null = null;

function prompt(text: string): void {
  log.textContent = text;
}

function armSlotPrompt(kind: 'save' | 'restore'): void {
  pending = kind;
  prompt(`${kind === 'save' ? 'SAVE to' : 'RESTORE from'} which slot? A, B or C   (${describeSlots()})`);
}

function resolveSlot(slot: Slot): void {
  const kind = pending;
  pending = null;
  if (kind === 'save') {
    const snap = game.state.entry;
    if (!snap) return;
    prompt(writeSave(slot, snap) ? `Saved to slot ${slot} (level ${snap.level}).` : 'Could not save.');
    return;
  }
  const snap = readSave(slot);
  if (!snap) { prompt(`Slot ${slot} is empty.`); return; }
  game = startLevel(snap.level, snap.difficulty);
  game.load(snap.level);
  restore(game.state, snap); // overwrites the testing loadout with the real one
  prompt(`Restored slot ${slot} — level ${snap.level}.`);
}

const DIRECTIONS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
  Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
  Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
  // Diagonals sit around WASD, so they work with either hand position.
  KeyQ: [-1, -1], KeyE: [1, -1], KeyZ: [-1, 1], KeyC: [1, 1],
};

addEventListener('keydown', (event) => {
  if (overlay.isOpen) {
    if (event.key === 'Escape') overlay.close();
    else if (event.key === 'ArrowDown') overlay.move(1);
    else if (event.key === 'ArrowUp') overlay.move(-1);
    else if (event.key === 'Enter' || event.key === ' ') overlay.activate();
    else if (!overlay.activate(event.key)) return;
    event.preventDefault();
    return;
  }

  if (paused) {
    paused = false;
    speaker.play(SFX.unpause());
    event.preventDefault();
    drawHud();
    return;
  }

  // A pending save/restore swallows the next key as its slot letter.
  if (pending) {
    const letter = event.key.toUpperCase();
    if ((SLOTS as readonly string[]).includes(letter)) resolveSlot(letter as Slot);
    else { pending = null; prompt('Cancelled.'); }
    event.preventDefault();
    drawHud();
    return;
  }
  const dir = DIRECTIONS[event.code];
  if (dir) {
    const before = {
      level: game.state.level,
      gems: game.state.gems,
      bonus: game.state.bonus,
      entryGems: game.state.entry?.gems ?? game.state.gems,
    };
    const screen = snapshotScreen();
    game.act(dir[0], dir[1]);
    if (game.state.level !== before.level) {
      startWipe(before.level);
      if (wipe) wipe.under = screen;
      achievements.clearLevel(before.level, before.entryGems, before.gems, before.bonus);
      achievements.enterLevel(game.state.level);
    }
  } else if (event.code === 'Space') {
    crackWhip();
  } else if (event.key === '?' || event.code === 'Escape') {
    showStart();
  } else if (event.code === 'KeyV') {
    showAchievements();
  } else if (event.code === 'KeyP') {
    paused = true;
    speaker.play(SFX.pause());
  } else if (event.code === 'KeyT') {
    if (teleport(game.state)) game.idle();
  } else if (event.code === 'KeyK') {
    armSlotPrompt('save');
  } else if (event.code === 'KeyL') {
    armSlotPrompt('restore');
  } else if (event.code === 'KeyR' && event.shiftKey) {
    // Shift-R, not plain R: R sits next to E, and a stray press while moving
    // north-east should not throw the level away.
    const from = game.state.level;
    const screen = snapshotScreen();
    game = startLevel(from);
    startWipe(from);
    if (wipe) wipe.under = screen;
    prompt(`Restarted level ${game.state.level}.`);
  } else {
    return;
  }
  event.preventDefault();
  speaker.resume();
  drainSounds();
  checkAchievements();
  drawHud();
});

/**
 * Click a tile to have it named. A legend, not an x-ray: the Crawl art does not
 * map obviously onto Kroz's vocabulary, so this closes that gap without
 * revealing anything the level is deliberately hiding.
 */
canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  const x = Math.floor(((event.clientX - rect.left) * scale) / atlas.meta.tileSize);
  const y = Math.floor(((event.clientY - rect.top) * scale) / atlas.meta.tileSize);
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const s = game.state;
  const id = s.cells[y * WIDTH + x] ?? 0;
  const shown = renderer.shows(game.level, id);
  log.textContent = `(${x}, ${y})  ${describeTile(id, shown, knownTiles.has(id) || atlas.tiles[String(id)] !== undefined)}`;
});

/** The idle tick is the game's pace; changing it restarts the timer. */
let idleTimer: number | undefined;
function setPace(): void {
  clearInterval(idleTimer);
  const ms = SPEEDS[speedName] ?? SPEEDS[DEFAULT_SPEED];
  idleTimer = setInterval(() => {
    if (paused || wipe || overlay.isOpen) return;
    game.idle();
    drainSounds();
    checkAchievements();
    drawHud();
  }, ms) as unknown as number;
}
mutePicker.addEventListener('change', () => speaker.setMuted(mutePicker.checked));
setPace();

// Lava cycles through four frames; slower than the tick so it reads as flowing.
setInterval(() => { frame++; }, 180);

function paint(): void {
  if (wipe) {
    // Pass 1: the gem colour grows over the level you are leaving.
    // Pass 2: black grows over that colour, ending on an empty screen.
    if (wipe.phase === 0) renderer.wipe(wipe.under, wipe.step, wipe.colour);
    else renderer.wipe(null, wipe.step, null, wipe.colour);
    requestAnimationFrame(paint);
    return;
  }
  const s = game.state;
  const spot = s.whipStep >= 0 ? WHIP_SWEEP[s.whipStep] : undefined;
  const age = performance.now() - enteredAt;
  const flash = age < FLASH_MS ? 1 - age / FLASH_MS : 0;
  renderer.draw(
    { cells: s.cells, player: { x: s.px, y: s.py } },
    { ...game.level, params: s.params },
    frame,
    spot ? { x: s.px + spot[0], y: s.py + spot[1], code: spot[2] } : undefined,
    flash,
  );
  requestAnimationFrame(paint);
}

drawHud();
paint();
showStart();
