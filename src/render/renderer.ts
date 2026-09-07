/**
 * Draw a playfield to a canvas.
 *
 * The renderer only reads state -- it never mutates the grid. That is the one
 * structural departure from the original, which wrote single cells at each
 * mutation site (`gotoxy(x,y); col(12,16); write(Lava)`) and so had drawing
 * tangled through its game logic. Redrawing 1472 cells per frame costs nothing
 * and keeps the rules free of rendering.
 */

import type { AtlasDoc, Level } from '../types.ts';
import { HEIGHT, WIDTH, type Playfield } from '../engine/playfield.ts';
import { cp437 } from './cp437.ts';

/** Signpost colours for the text layer, picked to sit inside Crawl's palette. */
const TEXT_BG = '#5a4632';
const TEXT_FG = '#f2e6d0';
const VOID = '#0b0b0d';
/** The whip, drawn over whatever cell it is lashing. */
const WHIP_FG = '#fff4d0';

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly atlas: AtlasDoc;
  private readonly sheet: HTMLImageElement;
  /** Tile ids the original declares. Anything else is a fallen-through byte. */
  private readonly known: Set<number>;

  constructor(canvas: HTMLCanvasElement, atlas: AtlasDoc, sheet: HTMLImageElement, known: Set<number>) {
    this.canvas = canvas;
    this.atlas = atlas;
    this.sheet = sheet;
    this.known = known;
    this.size = atlas.meta.tileSize;
    canvas.width = WIDTH * this.size;
    canvas.height = HEIGHT * this.size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
  }

  /**
   * Per-level rendering rules. The Hide* flags come from the level procedures;
   * the two tile substitutions come from `if Level` tests inside
   * Display_Playfield, preserved in levels.json as `renderOverrides`.
   */
  private rulesFor(level: Level): (id: number) => number | null {
    const p = level.params;
    const hidden = new Set<number>();
    if (p.hideStairs) hidden.add(6);
    if (p.hideGems) hidden.add(9);
    if (p.hideTrap) hidden.add(16);
    if (p.hideCreate) hidden.add(35);
    if (p.hideMBlock) hidden.add(38);
    if (p.hideRock) hidden.add(65);
    if (p.hideOpenWall) { hidden.add(58); hidden.add(59); hidden.add(60); }
    if (level.n === 71 && !p.revealBlocks) hidden.add(4); // {Block} 4: if Level <> 71

    return (id) => {
      if (p.hideLevel) return null;
      if (hidden.has(id)) return null;
      if (level.n === 56 && id === 17) return 22; // {River} 17: if level=56 -> Lava
      return id;
    };
  }

  /**
   * Whether this tile actually shows on screen for this level.
   *
   * The inspector uses the renderer's own rules so the two can never disagree:
   * anything the level hides, or that Display_Playfield draws nothing for,
   * reports as invisible and stays a secret.
   */
  shows(level: Level, id: number): boolean {
    if (id === 40) return true; // the player sprite is drawn separately
    const mapped = this.rulesFor(level)(id);
    if (mapped === null) return false;
    if (mapped === 0) return true;
    const entry = this.atlas.tiles[String(mapped)];
    if (entry?.frames?.length || entry?.text !== undefined) return true;
    // Not a declared tile: Convert_Format kept the raw byte, drawn as a letter.
    return !this.known.has(mapped);
  }

  private blit(sprite: number, x: number, y: number): void {
    const cols = this.atlas.meta.cols;
    this.ctx.drawImage(
      this.sheet,
      (sprite % cols) * this.size,
      Math.floor(sprite / cols) * this.size,
      this.size,
      this.size,
      x * this.size,
      y * this.size,
      this.size,
      this.size,
    );
  }

  /** The letter fallback: text written straight into the playfield. */
  private glyph(ch: string, x: number, y: number): void {
    const s = this.size;
    this.ctx.fillStyle = TEXT_BG;
    this.ctx.fillRect(x * s, y * s, s, s);
    this.ctx.fillStyle = TEXT_FG;
    this.ctx.font = `bold ${Math.floor(s * 0.72)}px ui-monospace, "SF Mono", Menlo, monospace`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(ch, x * s + s / 2, y * s + s * 0.55);
  }

  /**
   * One frame of the level-change wipe.
   *
   * The original expands a rectangle from the middle of the playfield outwards
   * over 30 steps, twice: once filled in the level's gem colour, once clearing
   * to black with a rising tone. In screen cells it runs from (32,12)-(35,14)
   * to the full field, widening two columns a step but only two rows every
   * three -- so it opens sideways much faster than it does vertically.
   *
   * `under` is the screen as it looked before the level changed, since the wipe
   * covers the level you are leaving, not the one you are arriving at.
   */
  wipe(
    under: CanvasImageSource | null,
    step: number,
    colour: string | null,
    background: string | null = null,
  ): void {
    const s = this.size;
    // What the rectangle is expanding *over*: the level being left on the first
    // pass, and the colour that pass ended on for the second. Getting this
    // wrong makes the second expansion invisible, since it would be drawing
    // black onto black.
    if (under) this.ctx.drawImage(under, 0, 0);
    else {
      this.ctx.fillStyle = background ?? VOID;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    const left = Math.max(0, 30 - step);
    const right = Math.min(WIDTH - 1, 33 + step);
    const top = Math.max(0, 10 - Math.floor(step / 3));
    const bottom = Math.min(HEIGHT - 1, 12 + Math.floor(step / 3));
    this.ctx.fillStyle = colour ?? VOID;
    this.ctx.fillRect(left * s, top * s, (right - left + 1) * s, (bottom - top + 1) * s);
  }

  /** A glyph laid over the grid, with no background of its own. */
  private overlayGlyph(ch: string, x: number, y: number, colour: string): void {
    const s = this.size;
    this.ctx.fillStyle = colour;
    this.ctx.font = `bold ${Math.floor(s * 0.95)}px ui-monospace, "SF Mono", Menlo, monospace`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.shadowColor = '#000';
    this.ctx.shadowBlur = 4;
    this.ctx.fillText(ch, x * s + s / 2, y * s + s * 0.55);
    this.ctx.shadowBlur = 0;
  }

  /**
   * A halo pulsed around the player when a level starts. The original spends
   * 600 iterations cycling the player's colour at PX,PY on entry -- on a CRT
   * that read as a bright flash telling you where you are. `strength` runs
   * 1 down to 0 as the effect fades.
   */
  private spotlight(x: number, y: number, strength: number): void {
    const s = this.size;
    const cx = x * s + s / 2;
    const cy = y * s + s / 2;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 60);
    const radius = s * (1.1 + 2.2 * strength);
    const glow = this.ctx.createRadialGradient(cx, cy, s * 0.25, cx, cy, radius);
    glow.addColorStop(0, `rgba(255, 244, 208, ${0.55 * strength * (0.6 + 0.4 * pulse)})`);
    glow.addColorStop(1, 'rgba(255, 244, 208, 0)');
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * strength * pulse})`;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x * s + 1, y * s + 1, s - 2, s - 2);
  }

  draw(
    field: Playfield,
    level: Level,
    frame = 0,
    whip?: { x: number; y: number; code: number },
    flash = 0,
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = VOID;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const rule = this.rulesFor(level);
    const floor = level.params.makeFloor ? this.atlas.tiles['0'] : undefined;

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const raw = field.cells[y * WIDTH + x]!;
        const id = rule(raw);
        if (id === null) continue;

        if (id === 0) {
          // Empty floor is only painted when the level called MakeFloor.
          if (floor?.frames) this.blit(floor.frames[0]!, x, y);
          continue;
        }

        const entry = this.atlas.tiles[String(id)];
        if (entry?.frames?.length) {
          // Gems are re-coloured per level rather than animated, so their
          // frame comes from the level number. The multiplier must be coprime
          // with the frame count or the sequence collapses onto a few colours:
          // 9 and 14 are coprime, so every colour is reached.
          const pick =
            entry.pick === 'level'
              ? (level.n * 9 + 5) % entry.frames.length
              : frame % entry.frames.length;
          this.blit(entry.frames[pick]!, x, y);
        } else if (entry?.text !== undefined) {
          this.glyph(entry.text, x, y);
        } else if (id === 40) {
          // The player's own cell. Display_Playfield draws Stairs here, but the
          // original overwrites it with the player character immediately, so
          // the stairs were never actually seen; the sprite is drawn below.
          continue;
        } else if (this.known.has(id)) {
          // A declared tile that Display_Playfield draws nothing for: the
          // invisible walls, spell triggers and traps (`{Stop} 32:;`). These
          // occupy a cell and block movement but must not be painted.
          continue;
        } else {
          // Not a tile at all -- Convert_Format fell through to
          // `PF[x,y] := ord(char)`, so print the character itself.
          this.glyph(cp437(id), x, y);
        }
      }
    }

    if (!level.params.hideLevel) {
      if (flash > 0) this.spotlight(field.player.x, field.player.y, flash);
      this.blit(this.atlas.player.frames[0]!, field.player.x, field.player.y);
    }

    if (whip) this.overlayGlyph(cp437(whip.code), whip.x, whip.y, WHIP_FG);
  }
}
