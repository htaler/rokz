/**
 * Verify the extracted JSON against the original Pascal source.
 *
 * The important check is the round-trip: every hand-drawn layout row is
 * re-emitted in its original `FP[n]:= '...';` form and compared to the bytes in
 * LOST2.LEV / LOST2B.LEV. If that passes, the level data survived extraction
 * intact including the high-byte CP437 map characters.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Level, Tile } from './extract.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', '..', 'source', 'LOSTKROZ', 'MASTER');
const DATA_DIR = join(HERE, '..', 'src', 'data');

const XSIZE = 64;
const YSIZE = 23;
const LEVEL_COUNT = 75;
/** XBot..XTop by YBot..YTop, minus the cell Create_Playfield reserves for the player. */
const SCATTER_CAPACITY = XSIZE * YSIZE - 1;

const readSource = (f: string) =>
  readFileSync(join(SRC_DIR, f)).toString('latin1').replace(/\x1a\s*$/, '').split(/\r?\n/);

const tilesDoc = JSON.parse(readFileSync(join(DATA_DIR, 'tiles.json'), 'utf8')) as {
  fallback: string;
  monsters: { tile: number; variable: string; default: number; frames: number[] }[];
  mapChars: { char: string; byte: number; tile: number }[];
  tiles: Tile[];
};
const levelsDoc = JSON.parse(readFileSync(join(DATA_DIR, 'levels.json'), 'utf8')) as {
  levels: Level[];
};

/**
 * Pinned counts. These are facts about the 1990 source, so they do not drift:
 * if a parser regression silently drops a unit these fail instead of quietly
 * reporting a smaller number.
 */
const EXPECT = {
  levels: 75,
  drawn: 41,
  scattered: 34,
  layoutRows: 943,
  mapChars: 98,
  shortRows: 1,          // Level44 FP[7], a typo in the original
  scatterWarnings: 1,    // DF[71], an 85-character middle chunk
  monsters: [
    { variable: 'Slow', default: 142, frames: [142, 65] },
    { variable: 'Medium', default: 153, frames: [153, 148] },
    { variable: 'Fast', default: 234, frames: [234] },
  ],
} as const;

let failures = 0;
let warnings = 0;
const fail = (msg: string) => { failures++; console.log(`  FAIL  ${msg}`); };
const warn = (msg: string) => { warnings++; console.log(`  warn  ${msg}`); };
const section = (name: string) => console.log(`\n${name}`);

// ---------------------------------------------------------------- coverage
section('level coverage');
{
  const seen = new Map<number, string>();
  for (const level of levelsDoc.levels) {
    if (seen.has(level.n)) fail(`level ${level.n} defined twice`);
    seen.set(level.n, level.kind);
  }
  for (let n = 1; n <= LEVEL_COUNT; n++) if (!seen.has(n)) fail(`level ${n} missing`);
  const drawn = [...seen.values()].filter((k) => k === 'drawn').length;
  console.log(`  ${seen.size} levels: ${drawn} drawn + ${seen.size - drawn} scattered`);
  if (seen.size !== EXPECT.levels) fail(`expected ${EXPECT.levels} levels, got ${seen.size}`);
  if (drawn !== EXPECT.drawn) fail(`expected ${EXPECT.drawn} drawn levels, got ${drawn}`);
  if (seen.size - drawn !== EXPECT.scattered) fail(`expected ${EXPECT.scattered} scattered levels, got ${seen.size - drawn}`);
}

// ------------------------------------------------------------- round-trip
section('round-trip against Pascal source');
{
  // Collect every FP[] assignment as it appears in the original, per level.
  const original = new Map<number, string[]>();
  for (const file of ['LOST2.LEV', 'LOST2B.LEV']) {
    const lines = readSource(file);
    const bodyStart = lines.findIndex((l) => /^implementation\b/.test(l));
    let n = 0;
    for (const line of lines.slice(bodyStart)) {
      const open = /^procedure Level(\d+);/.exec(line);
      if (open) { n = Number(open[1]); original.set(n, []); continue; }
      const row = /^\s*FP\[(\d+)\]\s*:=\s*'(.*)'\s*;/.exec(line);
      if (row && n) original.get(n)![Number(row[1]) - 1] = row[2]!;
    }
  }

  let checked = 0;
  for (const level of levelsDoc.levels) {
    if (level.kind !== 'drawn') continue;
    const src = original.get(level.n);
    if (!src) { fail(`level ${level.n} has no source rows`); continue; }
    if (level.rows.length !== YSIZE) fail(`level ${level.n}: ${level.rows.length} rows, expected ${YSIZE}`);
    for (let y = 0; y < YSIZE; y++) {
      const got = level.rows[y];
      const want = src[y];
      if (got === undefined) { fail(`level ${level.n} row ${y + 1} missing`); continue; }
      if (got !== want) fail(`level ${level.n} row ${y + 1} differs from source`);
      else if (got.length !== XSIZE && !(level.notes ?? []).some((n) => n.startsWith(`row ${y + 1} `))) {
        fail(`level ${level.n} row ${y + 1} is ${got.length} chars and is not recorded in notes`);
      }
      checked++;
    }
  }
  console.log(`  ${checked} layout rows match the Pascal source byte for byte`);
  if (checked !== EXPECT.layoutRows) fail(`expected ${EXPECT.layoutRows} layout rows, got ${checked}`);
}

// ------------------------------------------------------------- map chars
section('layout characters resolve');
{
  const byChar = new Map(tilesDoc.mapChars.map((m) => [m.char, m.tile]));
  const rendered = new Set(tilesDoc.tiles.filter((t) => t.visible).map((t) => t.id));
  const asText = new Map<string, number>();

  for (const level of levelsDoc.levels) {
    if (level.kind !== 'drawn') continue;
    for (const row of level.rows) {
      for (const ch of row) {
        if (byChar.has(ch)) continue;
        // Convert_Format's else branch: the tile id is the character's own byte,
        // and Display_Playfield prints it as an uppercase letter.
        asText.set(ch, (asText.get(ch) ?? 0) + 1);
      }
    }
  }
  const sample = [...asText].sort((a, b) => b[1] - a[1]).slice(0, 18);
  console.log(`  ${byChar.size} characters map to tiles`);
  if (byChar.size !== EXPECT.mapChars) fail(`expected ${EXPECT.mapChars} map characters, got ${byChar.size}`);
  console.log(`  ${asText.size} fall through to the letter fallback (in-map text):`);
  console.log(`    ${sample.map(([c, n]) => `${JSON.stringify(c)}x${n}`).join(' ')}`);

  // The fallback prints upcase(chr(id)), so letters become text and the high
  // bytes become their own CP437 glyph -- scenery drawn straight from the font.
  const decorative = [...asText.keys()].filter((ch) => !/[a-z0-9 ]/i.test(ch));
  console.log(
    `  ${decorative.length} of those are decorative CP437 glyphs drawn via the font: ` +
      decorative.map((c) => `${c.charCodeAt(0)}`).sort((a, b) => Number(a) - Number(b)).join(', '),
  );
  for (const ch of decorative) {
    const code = ch.charCodeAt(0);
    if (code < 32) fail(`layout uses control byte ${code}, which cannot be rendered`);
  }
}

section('known source defects');
{
  let shortRows = 0;
  for (const level of levelsDoc.levels) {
    if (level.kind !== 'drawn') continue;
    for (const n of level.notes ?? []) {
      console.log(`  level ${level.n}: ${n}`);
      shortRows++;
    }
  }
  if (shortRows !== EXPECT.shortRows) fail(`expected ${EXPECT.shortRows} short row(s), got ${shortRows}`);

  const scatterWarnings = levelsDoc.levels
    .filter((l) => l.kind === 'scattered')
    .reduce((sum, l) => sum + (l.warnings?.length ?? 0), 0);
  if (scatterWarnings !== EXPECT.scatterWarnings) {
    fail(`expected ${EXPECT.scatterWarnings} scatter-table defect(s), got ${scatterWarnings}`);
  }
}

section('monster tiers');
{
  for (const want of EXPECT.monsters) {
    const got = tilesDoc.monsters.find((m) => m.variable === want.variable);
    if (!got) { fail(`monster tier ${want.variable} missing`); continue; }
    console.log(`  ${got.variable.padEnd(6)} tile ${got.tile}  default #${got.default}  frames ${got.frames.map((f) => '#' + f).join(' ')}`);
    if (got.default !== want.default) fail(`${want.variable} default is #${got.default}, expected #${want.default}`);
    if ([...got.frames].sort().join() !== [...want.frames].sort().join()) {
      fail(`${want.variable} frames are ${got.frames.join('/')}, expected ${want.frames.join('/')}`);
    }
  }
}

section('level-conditional rendering');
{
  for (const level of levelsDoc.levels) {
    for (const o of level.renderOverrides ?? []) {
      console.log(`  level ${level.n}: tile ${o.tiles.join(',')} -- ${o.source.slice(0, 72)}`);
    }
  }
}

// -------------------------------------------------------- scatter tables
section('scatter tables');
{
  for (const level of levelsDoc.levels) {
    if (level.kind !== 'scattered') continue;
    const total = Object.values(level.counts).reduce((a, b) => a + b, 0);
    if (total > SCATTER_CAPACITY) {
      // Create_Playfield does `repeat ... until Done` with no escape hatch.
      fail(`level ${level.n} scatters ${total} objects into ${SCATTER_CAPACITY} cells (original would hang)`);
    } else if (total > SCATTER_CAPACITY * 0.9) {
      warn(`level ${level.n} fills ${((total / SCATTER_CAPACITY) * 100).toFixed(1)}% of the playfield (${total} objects)`);
    }
    for (const w of level.warnings ?? []) warn(`level ${level.n}: ${w}`);
  }
  const totals = levelsDoc.levels
    .filter((l): l is Extract<Level, { kind: 'scattered' }> => l.kind === 'scattered')
    .map((l) => Object.values(l.counts).reduce((a, b) => a + b, 0));
  console.log(`  object counts: min ${Math.min(...totals)}, max ${Math.max(...totals)}, capacity ${SCATTER_CAPACITY}`);
}

// -------------------------------------------------------------- rendering
section('render table');
{
  const withRender = tilesDoc.tiles.filter((t) => t.visible);
  const noRender = tilesDoc.tiles.filter((t) => !t.visible && t.mapChars.length > 0);
  console.log(`  ${withRender.length} tiles draw something; ${noRender.length} are invisible but placeable`);
  console.log(`  invisible: ${noRender.map((t) => t.name).join(', ')}`);
  if (!tilesDoc.fallback.includes('upcase')) fail('letter fallback was not captured');
}

// ---------------------------------------------------------------- summary
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failures, ${warnings} warnings`);
process.exit(failures === 0 ? 0 : 1);
