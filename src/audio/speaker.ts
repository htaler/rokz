/**
 * PC speaker emulation.
 *
 * The original drives the speaker directly -- `sound(freq)` starts a square
 * wave, `nosound` stops it, and `delay(ms)` blocks. A Web Audio square-wave
 * oscillator reproduces that one-for-one, so the timbre is the real thing
 * rather than an approximation.
 *
 * The blocking matters as much as the sound. Turbo Pascal's Delay is
 * CPU-calibrated, so `delay(120)` was 120 real milliseconds on every machine
 * Kroz ever ran on -- unlike the game's counting loop, which varied with the
 * hardware. While a sound plays, nothing else in the game happens.
 */

/** One step of a sound: hold `freq` Hz for `ms`, or silence when freq is 0. */
export interface Step {
  freq: number;
  ms: number;
}

export class Speaker {
  private ctx: AudioContext | null = null;
  private muted = false;

  /** Browsers only allow audio after a gesture, so this is called on first input. */
  resume(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    void this.ctx?.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Queue a sequence and return how long it lasts, whether or not it is heard. */
  play(steps: Step[]): number {
    const total = steps.reduce((sum, s) => sum + s.ms, 0);
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return total;

    let at = ctx.currentTime;
    for (const step of steps) {
      const seconds = step.ms / 1000;
      if (step.freq > 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(Math.max(20, Math.min(step.freq, 20000)), at);
        // The speaker was on or off; a short ramp only removes the click.
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.06, at + 0.002);
        gain.gain.setValueAtTime(0.06, at + seconds - 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + seconds);
      }
      at += seconds;
    }
    return total;
  }
}

const rand = (n: number): number => Math.floor(Math.random() * n);

/**
 * The game's sound effects, as step sequences. Durations are the Pascal's own
 * `delay()` values; runs of `sound()` with no delay between them are collapsed
 * into one short sweep, since on original hardware they went by in microseconds.
 */
export const SFX = {
  /** Every successful move. The 120ms pause is the game's timing anchor. */
  footStep: (): Step[] => [
    { freq: rand(550) + 350, ms: 8 },
    { freq: 0, ms: 120 },
    { freq: rand(50) + 150, ms: 8 },
  ],
  /** Bumping a wall or block: a short descending buzz. */
  block: (): Step[] =>
    Array.from({ length: 31 }, (_, i) => ({ freq: 60 - i, ms: 1 })),
  /** Picking something up: a high shimmer with no pause behind it. */
  grab: (): Step[] =>
    Array.from({ length: 6 }, () => ({ freq: rand(1000) + 1000, ms: 3 })),
  /** Trying to use something you do not have. */
  none: (): Step[] =>
    Array.from({ length: 5 }, () => [
      { freq: 400, ms: 10 }, { freq: 0, ms: 10 },
      { freq: 700, ms: 10 }, { freq: 0, ms: 10 },
    ]).flat(),
  /** The electrified wall: bursts of noise. */
  static: (): Step[] =>
    Array.from({ length: 16 }, () => [
      { freq: rand(4000) + 3000, ms: 6 }, { freq: 0, ms: rand(30) },
    ]).flat(),
  /** Cracking the whip, per position of the sweep. */
  whip: (): Step[] => [{ freq: 70, ms: 10 }],
  /** Taking the stairs. */
  stairs: (): Step[] =>
    Array.from({ length: 12 }, (_, i) => ({ freq: 200 + i * 60, ms: 12 })),
  /** Losing a gem to a monster. */
  hurt: (): Step[] => [{ freq: 400, ms: 25 }],
  /** Earning a trophy: a rising arpeggio, unlike anything the game itself plays. */
  trophy: (): Step[] => [
    { freq: 523, ms: 70 }, { freq: 659, ms: 70 }, { freq: 784, ms: 70 },
    { freq: 1047, ms: 140 }, { freq: 0, ms: 40 }, { freq: 1047, ms: 120 },
  ],
  /** The level-change wipe: a tone rising with the expanding rectangle. */
  wipe: (): Step[] =>
    Array.from({ length: 30 }, (_, i) => ({ freq: (i + 1) * 45, ms: 14 })),
  /** Pausing: the original plays a falling two-tone. */
  pause: (): Step[] => [{ freq: 500, ms: 100 }, { freq: 200, ms: 60 }],
  unpause: (): Step[] => [{ freq: 200, ms: 60 }, { freq: 500, ms: 100 }],
  /** Dying. */
  death: (): Step[] =>
    Array.from({ length: 20 }, (_, i) => ({ freq: 600 - i * 28, ms: 25 })),
} as const;
