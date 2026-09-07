/**
 * Extract tile and level data from the original Turbo Pascal source of
 * "The Lost Adventures of Kroz" (Scott Miller / Apogee Software, 1990).
 *
 *   LOST1.LEV   tile constants, Convert_Format, DF[] scatter tables
 *   LOST2.LEV   hand-drawn level layouts
 *   LOST2B.LEV  hand-drawn level layouts, continued
 *   LOST.PAS    per-level special-case overrides
 *
 * The Pascal files are CP437 byte streams, NOT UTF-8. High bytes are
 * load-bearing map characters (0xF1-0xF6 are tiles 58-63, 0x91-0x97 are
 * 68-74), so every file is decoded as latin1 -- one byte becomes one
 * codepoint in 0..255, which JSON then round-trips exactly.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', '..', 'source', 'LOSTKROZ', 'MASTER');
const OUT_DIR = join(HERE, '..', 'src', 'data');

/** Playfield is 64x23 cells; Kroz ships 75 levels. */
const XSIZE = 64;
const YSIZE = 23;
const LEVEL_COUNT = 75;

/**
 * Parse_Field reads DF[] in fixed 3-character fields. The declared type is
 * string[222] == 74 fields, so only tiles 1..74 are reachable through a
 * scatter table even though TotObjects is 83.
 */
const DF_FIELD_WIDTH = 3;
const DF_OBJECTS = 74;
const TOT_OBJECTS = 83;

// ---------------------------------------------------------------- types

export interface Tile {
  id: number;
  name: string;
  /** CP437 code point the original wrote to the screen. 0 means invisible. */
  cp437: number | null;
  visible: boolean;
  /** Characters in a level layout that produce this tile. */
  mapChars: string[];
}

export interface LevelParams {
  /** CP437 glyphs the level reskins its three monster tiers with. */
  slow?: number;
  medium?: number;
  fast?: number;
  gravOn?: boolean;
  /** Gravity levels: the player falls and can only climb on a rope. */
  sideways?: boolean;
  oneMove?: boolean;
  gravRate?: number;
  evapoRate?: number;
  genFactor?: number;
  bonus?: number;
  replacement?: number;
  floorPattern?: boolean;
  fastPC?: boolean;
  lavaFlow?: boolean;
  lavaRate?: number;
  treeRate?: number;
  magicEWalls?: boolean;
  hideStairs?: boolean;
  hideMBlock?: boolean;
  hideGems?: boolean;
  hideCreate?: boolean;
  hideOpenWall?: boolean;
  hideLevel?: boolean;
  hideRock?: boolean;
  hideTrap?: boolean;
  revealBlocks?: boolean;
  /** MakeFloor(tile, colour1, colour2, back1, back2) -- decorative floor fill. */
  makeFloor?: { tile: number; cf1: number; cf2: number; bf1: number; bf2: number };
  /** Tiles pre-added to FoundSet, i.e. already "discovered" on entry. */
  foundSet?: number[];
}

export type Level =
  | {
      n: number;
      kind: 'drawn';
      rows: string[];
      params: LevelParams;
      renderOverrides?: { tiles: number[]; source: string }[];
      notes?: string[];
    }
  | {
      n: number;
      kind: 'scattered';
      counts: Record<number, number>;
      params: LevelParams;
      renderOverrides?: { tiles: number[]; source: string }[];
      /** Places the original source disagrees with its own field layout. */
      warnings?: string[];
    };

// ---------------------------------------------------------------- helpers

/** Read a Pascal source as latin1 lines, dropping CR and any trailing DOS EOF. */
function readSource(file: string): string[] {
  return readFileSync(join(SRC_DIR, file))
    .toString('latin1')
    .replace(/\x1a\s*$/, '')
    .split(/\r?\n/);
}

/** Turbo Pascal identifiers are PascalCase; our JSON keys are camelCase. */
function camel(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

const BOOL_PARAMS = new Set([
  'GravOn', 'LavaFlow', 'MagicEWalls', 'HideStairs', 'HideMBlock', 'HideGems',
  'HideCreate', 'HideOpenWall', 'HideLevel', 'HideRock', 'HideTrap', 'Sideways',
  'OneMove', 'FloorPattern', 'FastPC',
]);
const NUM_PARAMS = new Set([
  'Slow', 'Medium', 'Fast', 'LavaRate', 'TreeRate', 'EvapoRate', 'GravRate',
  'GenFactor', 'Bonus', 'Replacement',
]);

/**
 * Pull every parameter assignment out of one line of a level procedure.
 * Levels put several statements on a line (`MakeFloor(#250,6,7,0,0); HideCreate:=true;`),
 * so each pattern is matched globally rather than once.
 */
function collectParams(line: string, into: LevelParams): void {
  // Strip { ... } comments first: `Fast:=#234;{or #1}` must not yield "#1".
  const code = line.replace(/\{[^}]*\}/g, ' ');

  for (const m of code.matchAll(/\b(\w+)\s*:=\s*#?(\d+)/g)) {
    const [, name, value] = m;
    if (name && NUM_PARAMS.has(name)) {
      (into as Record<string, unknown>)[camel(name)] = Number(value);
    }
  }
  for (const m of code.matchAll(/\b(\w+)\s*:=\s*(true|false)\b/gi)) {
    const [, name, value] = m;
    if (name && BOOL_PARAMS.has(name)) {
      (into as Record<string, unknown>)[camel(name)] = value!.toLowerCase() === 'true';
    }
  }
  for (const m of code.matchAll(/MakeFloor\(\s*#?(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g)) {
    into.makeFloor = {
      tile: Number(m[1]), cf1: Number(m[2]), cf2: Number(m[3]),
      bf1: Number(m[4]), bf2: Number(m[5]),
    };
  }
  for (const m of code.matchAll(/FoundSet\s*:=\s*FoundSet\s*\+\s*\[(\d+)\]/g)) {
    (into.foundSet ??= []).push(Number(m[1]));
  }
}

// ---------------------------------------------------------------- parsers

/**
 * The constant block gives each tile a name and the CP437 glyph the original
 * printed. Lines look like:
 *
 *   {X}  {4}  Block     = #178;
 *   {<}  {48}  { K }                 <- KROZ letters, no constant of their own
 *   {\xbd}  {77}{DropRope}           <- alias of an earlier tile
 */
function parseTileConstants(lines: string[]): Map<number, { name: string; cp437: number | null }> {
  const tiles = new Map<number, { name: string; cp437: number | null }>();
  let inBlock = false;

  for (const line of lines) {
    if (!inBlock) {
      if (/^const\b/.test(line)) inBlock = true;
      continue;
    }
    if (/^\s*TotObjects\s*=/.test(line)) break;

    const entry = /^\{(.)\}\s*\{(\d+)\}\s*(.*)$/.exec(line);
    if (!entry) continue;
    const id = Number(entry[2]);
    const rest = entry[3] ?? '';

    const declared = /^(\w+)\s*=\s*#(\d+)/.exec(rest);
    if (declared) {
      tiles.set(id, { name: declared[1]!, cp437: Number(declared[2]) });
      continue;
    }
    // No constant: the name sits in a trailing comment, e.g. `{ K }`.
    const aliased = /^\{\s*([\w ]+?)\s*\}/.exec(rest);
    if (aliased) tiles.set(id, { name: aliased[1]!, cp437: null });
  }
  return tiles;
}

/**
 * Convert_Format is the authoritative layout-character -> tile-id mapping.
 * The constant block's own `{X}` hints disagree with it in at least one place
 * (Trap5 is commented `{ }` but is actually written `$`), so this wins.
 */
function parseMapChars(lines: string[]): Map<string, number> {
  const start = lines.findLastIndex((l) => /^procedure Convert_Format;/.test(l));
  if (start < 0) throw new Error('Convert_Format implementation not found in LOST1.LEV');
  const end = lines.findIndex((l, i) => i > start && /end;\s*\{\s*Convert_Format/.test(l));
  if (end < 0) throw new Error('Convert_Format has no terminator');

  const mapChars = new Map<string, number>();
  let pending: string | null = null;

  for (const line of lines.slice(start, end)) {
    // A case label may be followed by its assignment on the same line, or by a
    // multi-line `begin ... end` block (used where the tile also has to be
    // recorded in a monster/block position list).
    const label = /^\s*'(.)'\s*:/.exec(line);
    if (label) pending = label[1]!;
    if (pending === null) continue;

    const assign = /PF\[[^\]]*\]\s*:=\s*(\d+|Null)/.exec(line);
    if (!assign) continue;
    mapChars.set(pending, assign[1] === 'Null' ? 0 : Number(assign[1]));
    pending = null;
  }
  return mapChars;
}

/**
 * Display_Playfield is the only place the original states what each tile looks
 * like: a `case` mapping tile id to `col(fg,bg)` / `bak(..)` plus the glyph to
 * write. Several entries are conditional (treasure randomly disguises itself as
 * a Chance tile, some tiles are hidden by level flags), so each entry keeps its
 * verbatim Pascal alongside the extracted draw calls.
 */
/**
 * A col()/bak() argument pair. Numbers are literal CGA attributes; strings are
 * Pascal variables resolved at draw time (`GemColor` re-rolls each level,
 * `ArtColor` animates, `CF1`/`CF2`/`BF1`/`BF2` come from MakeFloor).
 */
export type ColorArg = [number | string, number | string];

export interface RenderEntry {
  ids: number[];
  variants: { col: ColorArg; bak: ColorArg | null; write: string }[];
  source: string;
}

function parseRenderTable(lines: string[]): { entries: RenderEntry[]; fallback: string } {
  const start = lines.findLastIndex((l) => /^procedure Display_Playfield;/.test(l));
  if (start < 0) throw new Error('Display_Playfield not found in LOST4.TIT');
  const end = lines.findIndex((l, i) => i > start && /^\s*FloorPattern\s*:=\s*false/.test(l));
  if (end < 0) throw new Error('Display_Playfield has no terminator');
  const body = lines.slice(start, end);

  // Individual entries use if/else too (`{Chest} 7:` disguises itself as a
  // Chance tile at random), so the *last* `else` is the case-level one that
  // renders any unmapped tile id as a letter. Assert on its contents so a bad
  // guess fails loudly instead of silently swallowing entries.
  const elseAt = body.findLastIndex((l) => /^\s*(?:\{[^}]*\}\s*)?else\b/.test(l));
  if (elseAt < 0) throw new Error('Display_Playfield has no case-level else branch');
  const fallback = body.slice(elseAt).join(' ').replace(/\s+/g, ' ').trim();
  if (!fallback.includes('upcase')) {
    throw new Error(`case-level else does not look like the letter fallback: ${fallback}`);
  }

  // Entry labels look like `{Tree} 20,252:` or `{CWall1..3} 55..57:`.
  const LABEL = /^\s*(?:\{[^}]*\}\s*)?((?:\d+(?:\.\.\d+)?)(?:\s*,\s*\d+(?:\.\.\d+)?)*)\s*:/;
  const entries: RenderEntry[] = [];
  let current: { ids: number[]; text: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const source = current.text.join(' ').replace(/\s+/g, ' ').trim();
    const variants: RenderEntry['variants'] = [];
    // Walk draw calls in order; each `write` closes the col/bak that preceded it.
    const arg = (raw: string): number | string => (/^\d+$/.test(raw) ? Number(raw) : raw);
    let col: ColorArg | null = null;
    let bak: ColorArg | null = null;
    for (const m of source.matchAll(/\b(col|bak)\((\w+),(\w+)\)|write\((?:'((?:''|[^'])*)'|(\w+))\)/g)) {
      if (m[1] === 'col') col = [arg(m[2]!), arg(m[3]!)];
      else if (m[1] === 'bak') bak = [arg(m[2]!), arg(m[3]!)];
      else {
        const literal = m[4] !== undefined ? m[4].replace(/''/g, "'") : m[5]!;
        if (col) variants.push({ col, bak, write: literal });
        bak = null;
      }
    }
    entries.push({ ids: current.ids, variants, source });
    current = null;
  };

  for (const line of body.slice(0, elseAt)) {
    const label = LABEL.exec(line);
    if (label) {
      flush();
      const ids: number[] = [];
      for (const part of label[1]!.split(',')) {
        const range = /^\s*(\d+)\.\.(\d+)\s*$/.exec(part);
        if (range) for (let i = Number(range[1]); i <= Number(range[2]); i++) ids.push(i);
        else ids.push(Number(part.trim()));
      }
      current = { ids, text: [line.slice(label[0].length)] };
      continue;
    }
    if (current) current.text.push(line);
  }
  flush();
  return { entries, fallback };
}

/**
 * DF[n] holds a level with no hand-drawn layout: a fixed-width table of
 * "scatter this many of object N at random empty cells". The literal is split
 * across three quoted chunks interleaved with header comments listing which
 * object each 3-character field belongs to:
 *
 *   chunk 0 -> tiles  1..39   (117 chars)
 *   chunk 1 -> tiles 40..67   ( 84 chars)
 *   chunk 2 -> tiles 68..74   ( 21 chars)
 *
 * 117+84+21 == 222 == the declared string[222] capacity, so tiles 75..83 are
 * unreachable from a scatter table.
 *
 * Each chunk is sliced on its own field grid rather than concatenating first.
 * DF[71] ships with an 85-character middle chunk, and a flat slice would let
 * that stray character shift every later field by one -- which is exactly the
 * corruption the original binary has, since string[222] truncation removes a
 * trailing space and leaves the misalignment in place. Chunk-wise parsing
 * recovers the intended table; `warnings` records where the source disagrees.
 */
const DF_CHUNK_FIELDS = [39, 28, 7] as const;

function parseScatterTables(
  lines: string[],
): Map<number, { counts: Record<number, number>; warnings: string[] }> {
  const tables = new Map<number, { counts: Record<number, number>; warnings: string[] }>();

  for (let i = 0; i < lines.length; i++) {
    const head = /^DF\[(\d+)\]\s*:=/.exec(lines[i]!);
    if (!head) continue;

    const chunks: string[] = [];
    for (let j = i; j < lines.length; j++) {
      const line = lines[j]!;
      let sawLiteral = false;
      for (const lit of line.matchAll(/'([^']*)'/g)) {
        chunks.push(lit[1]!);
        sawLiteral = true;
      }
      if (sawLiteral && /;\s*$/.test(line)) break;
    }

    const counts: Record<number, number> = {};
    const warnings: string[] = [];
    if (chunks.length !== DF_CHUNK_FIELDS.length) {
      warnings.push(`expected ${DF_CHUNK_FIELDS.length} chunks, found ${chunks.length}`);
    }

    let firstTile = 1;
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c]!;
      const fieldCount = DF_CHUNK_FIELDS[c] ?? Math.floor(chunk.length / DF_FIELD_WIDTH);
      const expected = fieldCount * DF_FIELD_WIDTH;
      if (chunk.length !== expected) {
        warnings.push(`chunk ${c} is ${chunk.length} chars, expected ${expected}`);
      }
      for (let field = 0; field < fieldCount; field++) {
        const raw = chunk.slice(field * DF_FIELD_WIDTH, (field + 1) * DF_FIELD_WIDTH).trim();
        if (!raw) continue;
        const n = Number(raw);
        if (Number.isInteger(n) && n > 0) counts[firstTile + field] = n;
        else warnings.push(`tile ${firstTile + field}: unparsable field ${JSON.stringify(raw)}`);
      }
      firstTile += fieldCount;
    }
    tables.set(Number(head[1]), { counts, warnings });
  }
  return tables;
}

/**
 * Hand-drawn levels are procedures holding 23 layout strings plus a handful of
 * parameter assignments:
 *
 *   procedure Level1;
 *    begin
 *     FP[1]:= '//\///...';
 *     ...
 *     Fast:=#234;
 *     Convert_Format;
 *    end; { Level1 }
 */
function parseDrawnLevels(files: string[][]): Map<number, { rows: string[]; params: LevelParams }> {
  const levels = new Map<number, { rows: string[]; params: LevelParams }>();

  for (const lines of files) {
    // Skip the interface section, which repeats every procedure heading.
    const bodyStart = lines.findIndex((l) => /^implementation\b/.test(l));
    if (bodyStart < 0) throw new Error('level unit has no implementation section');

    let current: { n: number; rows: string[]; params: LevelParams } | null = null;

    for (const line of lines.slice(bodyStart)) {
      const open = /^procedure Level(\d+);/.exec(line);
      if (open) {
        current = { n: Number(open[1]), rows: [], params: {} };
        continue;
      }
      if (!current) continue;

      if (/^\s*end;\s*\{\s*Level\d+/.test(line)) {
        levels.set(current.n, { rows: current.rows, params: current.params });
        current = null;
        continue;
      }

      const row = /^\s*FP\[(\d+)\]\s*:=\s*'(.*)'\s*;/.exec(line);
      if (row) {
        current.rows[Number(row[1]) - 1] = row[2]!;
        continue;
      }
      collectParams(line, current.params);
    }
  }
  return levels;
}

/**
 * LOST.PAS applies a few overrides after the level loads, under the comment
 * "the lines below are special conditions". They run last, so they win.
 */
function parseSpecialCases(lines: string[]): Map<number, LevelParams> {
  const overrides = new Map<number, LevelParams>();
  for (const line of lines) {
    const m = /^\s*if\s+Level\s*=\s*(\d+)\s+then\s+(.*)$/i.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    const params = overrides.get(n) ?? {};
    collectParams(m[2]!, params);
    if (Object.keys(params).length > 0) overrides.set(n, params);
  }
  return overrides;
}

/**
 * Tiles 1/2/3 are the three monster tiers. Their glyphs are mutable globals,
 * not constants: Init_Screen seeds them, level procedures override them, and
 * the move routines flip them between two characters on each step -- a
 * two-frame walk cycle. `frames` is that pair where one exists.
 */
export interface MonsterTier {
  tile: number;
  variable: string;
  default: number;
  frames: number[];
}

function parseMonsters(lost4: string[], lostMain: string[]): MonsterTier[] {
  const tiers: { tile: number; variable: string }[] = [
    { tile: 1, variable: 'Slow' },
    { tile: 2, variable: 'Medium' },
    { tile: 3, variable: 'Fast' },
  ];

  // The interface section declares it too; the body is the last occurrence.
  const initAt = lost4.findLastIndex((l) => /^\s*procedure Init_Screen;/.test(l));
  if (initAt < 0) throw new Error('Init_Screen not found in LOST4.TIT');
  const initBody = lost4.slice(initAt, initAt + 40).join('\n');

  return tiers.map(({ tile, variable }) => {
    const seed = new RegExp(`\\b${variable}\\s*:=\\s*#(\\d+)`).exec(initBody);
    if (!seed) throw new Error(`no Init_Screen default for ${variable}`);

    // `if random(2)=0 then Slow:=#142 else Slow:=#65;` -- pick up both frames.
    const frames = new Set<number>([Number(seed[1])]);
    const flicker = new RegExp(
      `random\\(2\\)\\s*=\\s*0\\s*then\\s+${variable}\\s*:=\\s*#(\\d+)\\s*else\\s+${variable}\\s*:=\\s*#(\\d+)`,
      'gi',
    );
    for (const m of lostMain.join('\n').matchAll(flicker)) {
      frames.add(Number(m[1]));
      frames.add(Number(m[2]));
    }
    return { tile, variable, default: Number(seed[1]), frames: [...frames] };
  });
}

/**
 * Two tiles render differently on one specific level: blocks are invisible on
 * level 71, and rivers are drawn as lava on level 56. A consumer reading only
 * levels.json would miss both, so the conditions are lifted onto the levels.
 */
function parseRenderConditions(entries: RenderEntry[]): Map<number, { tiles: number[]; source: string }[]> {
  const byLevel = new Map<number, { tiles: number[]; source: string }[]>();
  for (const entry of entries) {
    for (const m of entry.source.matchAll(/if\s+level\s*(<>|=)\s*(\d+)/gi)) {
      const n = Number(m[2]);
      if (!byLevel.has(n)) byLevel.set(n, []);
      byLevel.get(n)!.push({ tiles: entry.ids, source: entry.source });
    }
  }
  return byLevel;
}

// ---------------------------------------------------------------- main

function main(): void {
  const lost1 = readSource('LOST1.LEV');
  const lost2 = readSource('LOST2.LEV');
  const lost2b = readSource('LOST2B.LEV');
  const lost4 = readSource('LOST4.TIT');
  const lostMain = readSource('LOST.PAS');

  const constants = parseTileConstants(lost1);
  const mapChars = parseMapChars(lost1);
  const scatterTables = parseScatterTables(lost1);
  const drawn = parseDrawnLevels([lost2, lost2b]);
  const render = parseRenderTable(lost4);
  const monsters = parseMonsters(lost4, lostMain);
  const renderConditions = parseRenderConditions(render.entries);
  const specialCases = parseSpecialCases(lostMain);

  // --- tiles -------------------------------------------------------------
  const charsByTile = new Map<number, string[]>();
  for (const [ch, id] of mapChars) {
    if (!charsByTile.has(id)) charsByTile.set(id, []);
    charsByTile.get(id)!.push(ch);
  }

  const renderById = new Map<number, RenderEntry>();
  for (const entry of render.entries) for (const id of entry.ids) renderById.set(id, entry);

  const ids = new Set<number>([...constants.keys(), ...charsByTile.keys(), ...renderById.keys()]);
  const tiles: Tile[] = [...ids]
    .sort((a, b) => a - b)
    .map((id) => {
      const known = constants.get(id);
      const cp437 = known?.cp437 ?? null;
      const drawn = renderById.get(id);
      return {
        id,
        name: known?.name ?? (id === 0 ? 'Null' : `Unnamed${id}`),
        cp437,
        // A tile is drawn if Display_Playfield actually emits a glyph for it;
        // the constant alone is not enough (several declare #0 and render
        // nothing, and 180..195 render punctuation with no constant at all).
        visible: (drawn?.variants.length ?? 0) > 0,
        mapChars: charsByTile.get(id) ?? [],
        render: drawn ? { variants: drawn.variants, source: drawn.source } : null,
      };
    });

  // --- levels ------------------------------------------------------------
  const levels: Level[] = [];
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const hand = drawn.get(n);
    const scatter = scatterTables.get(n);
    if (hand && scatter) throw new Error(`level ${n} is both drawn and scattered`);

    // Special cases run after the level body, so they override it.
    const params: LevelParams = { ...(hand?.params ?? {}), ...(specialCases.get(n) ?? {}) };
    const overrides = renderConditions.get(n);
    const extra = overrides ? { renderOverrides: overrides } : {};

    if (hand) {
      // Rows are kept exactly as the Pascal has them so the extraction can be
      // round-tripped. Where a row is short, Convert_Format reads past the end
      // of the Pascal string, gets its zero length byte and stores Null -- so a
      // consumer pads to `width` with tile 0 to match the original.
      const notes: string[] = [];
      hand.rows.forEach((row, i) => {
        if (row.length !== XSIZE) {
          notes.push(`row ${i + 1} is ${row.length} chars, not ${XSIZE}; original pads with Null`);
        }
      });
      levels.push({ n, kind: 'drawn', rows: hand.rows, params, ...extra, ...(notes.length ? { notes } : {}) });
    }
    else if (scatter)
      levels.push({
        n,
        kind: 'scattered',
        counts: scatter.counts,
        params,
        ...extra,
        ...(scatter.warnings.length > 0 ? { warnings: scatter.warnings } : {}),
      });
    else throw new Error(`level ${n} has neither a layout nor a scatter table`);
  }

  // --- write -------------------------------------------------------------
  mkdirSync(OUT_DIR, { recursive: true });

  const tilesDoc = {
    meta: {
      game: 'The Lost Adventures of Kroz',
      source: 'source/LOSTKROZ/MASTER',
      totObjects: TOT_OBJECTS,
      note:
        'Convert_Format falls through to PF[x,y] := ord(char) for characters ' +
        'not listed here, so a layout may reference tile ids outside this table.',
    },
    fallback: render.fallback,
    monsters,
    mapChars: [...mapChars]
      .map(([char, tile]) => ({ char, byte: char.charCodeAt(0), tile }))
      .sort((a, b) => a.byte - b.byte),
    tiles,
  };

  const levelsDoc = {
    meta: {
      game: 'The Lost Adventures of Kroz',
      source: 'source/LOSTKROZ/MASTER',
      width: XSIZE,
      height: YSIZE,
      levelCount: LEVEL_COUNT,
      drawn: levels.filter((l) => l.kind === 'drawn').length,
      scattered: levels.filter((l) => l.kind === 'scattered').length,
    },
    levels,
  };

  writeFileSync(join(OUT_DIR, 'tiles.json'), JSON.stringify(tilesDoc, null, 2) + '\n');
  writeFileSync(join(OUT_DIR, 'levels.json'), JSON.stringify(levelsDoc, null, 2) + '\n');

  const flagged = [...scatterTables].filter(([, t]) => t.warnings.length > 0);
  console.log(`tiles:      ${tiles.length} ids, ${tiles.filter((t) => t.visible).length} visible`);
  console.log(`map chars:  ${mapChars.size}`);
  console.log(`levels:     ${levelsDoc.meta.drawn} drawn + ${levelsDoc.meta.scattered} scattered = ${levels.length}`);
  console.log(`render:     ${render.entries.length} case entries, fallback: ${render.fallback ? 'yes' : 'MISSING'}`);
  console.log(`monsters:   ${monsters.map((m) => `${m.variable}=${m.frames.join('/')}`).join(', ')}`);
  console.log(`render if:  level-conditional tiles on level ${[...renderConditions.keys()].sort((a, b) => a - b).join(', ')}`);
  for (const [n, t] of flagged) console.log(`  ! DF[${n}]: ${t.warnings.join('; ')}`);
  console.log(`special:    post-load overrides on level ${[...specialCases.keys()].sort((a, b) => a - b).join(', ')}`);
  console.log(`written to  ${OUT_DIR}`);
}

main();
