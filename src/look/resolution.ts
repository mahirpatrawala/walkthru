// SPEC 16.18 "Resolution governor": the pixel ratio is the cheapest thing to give up when a frame is slow and the first thing a buyer
// sees as softness, so it has a ladder of its own that is walked BEFORE the quality tier steps down. Pure (no three, no DOM): the caller
// feeds frame times and applies the ratio it is told, so every rule here is a unit test on a list of fps samples.
//
// Rules, in the order they are checked when a measuring window closes:
//   1. below target for a whole window: one step down the ladder (2 -> 1.75 -> 1.5 -> 1.25);
//   2. below target at the lowest step: `exhausted`, the one event the tier watchdog (look.ts) acts on;
//   3. comfortably above target for `upHoldSec` in a row: one step up, as a probe (a display that caps at 60 Hz hides how much spare
//      time there is, so the step up is tried and judged by the next windows rather than predicted);
//   4. a step up that has to be undone within `regretSec` doubles `upHoldSec` (to a ceiling), so the ratio settles instead of oscillating.
// A window's frame rate leaves out its slowest tenth of frames (22 Nov 2026): a shader compile, a texture upload or a model decoding
// during load is a hitch, not what the GPU costs per frame, and it used to walk a fast laptop down the ladder and the tier with it.

/** The ratios the governor moves between, high to low. */
export const RATIO_STEPS = [2, 1.75, 1.5, 1.25] as const;
/** the lowest ratio it goes to on a screen that has one: below this the picture is visibly soft on a retina laptop */
export const RATIO_FLOOR = 1.25;
/** the share of a window's slowest frames left out of its frame rate (hitches: a compile, an upload, a decode) */
export const HITCH_SHARE = 0.1;

/**
 * The ladder for a screen: the largest ratio allowed (device ratio and the tier's cap), then every step below it down to the floor.
 * `floor` is RATIO_FLOOR except on the low tier of a desktop (22 Nov 2026), whose ladder ends at 1 so the cheapest tier still has a last step.
 */
export function ratioLadder(maxRatio: number, floor: number = RATIO_FLOOR): number[] {
  const top = Math.max(1, Math.round(maxRatio * 100) / 100);
  if (top <= floor) return [top];
  const out = [top];
  for (const s of [...RATIO_STEPS, 1]) if (s < top - 1e-6 && s >= floor - 1e-6) out.push(s);
  return out;
}

export interface ResolutionOptions {
  /** frames per second to hold */
  target: number;
  /** seconds per measuring window */
  windowSec?: number;
  /** frames at the start of a window (right after a ratio change or a tier switch) that are not counted: the resize itself costs one slow frame */
  settleFrames?: number;
  /** a window needs at least this many frames to count */
  minFrames?: number;
  /** fps must be at least target * upMargin for the window to count towards a step up */
  upMargin?: number;
  /** seconds of such windows in a row before a step up */
  upHoldSec?: number;
  /** a step down this soon after a step up is a regret */
  regretSec?: number;
  /** the longest the step-up wait grows to */
  upHoldMaxSec?: number;
  /** frames longer than this are skipped (a hidden tab, an asset upload) */
  ignoreAboveSec?: number;
  /** the lowest ratio of the ladder (RATIO_FLOOR by default) */
  floor?: number;
}

export type ResolutionEvent =
  | { type: 'ratio'; ratio: number; from: number; reason: 'slow' | 'headroom' }
  | { type: 'exhausted'; ratio: number };

export class ResolutionGovernor {
  private ladder: number[];
  private idx = 0;
  private target: number;
  private floor: number;
  private readonly o: Required<Omit<ResolutionOptions, 'target' | 'floor'>>;
  private t = 0;
  private n = 0;
  private dts: number[] = [];
  private settle: number;
  private goodSec = 0;
  private clock = 0;
  private lastUpAt = -Infinity;
  private upHold: number;

  constructor(maxRatio: number, opts: ResolutionOptions) {
    this.floor = opts.floor ?? RATIO_FLOOR;
    this.ladder = ratioLadder(maxRatio, this.floor);
    this.target = opts.target;
    this.o = {
      windowSec: opts.windowSec ?? 2, settleFrames: opts.settleFrames ?? 6, minFrames: opts.minFrames ?? 20, upMargin: opts.upMargin ?? 1.08,
      upHoldSec: opts.upHoldSec ?? 20, regretSec: opts.regretSec ?? 40, upHoldMaxSec: opts.upHoldMaxSec ?? 160, ignoreAboveSec: opts.ignoreAboveSec ?? 0.5,
    };
    this.upHold = this.o.upHoldSec;
    this.settle = this.o.settleFrames;
  }

  /** the ratio to draw at now */
  get ratio(): number { return this.ladder[this.idx]; }
  get steps(): readonly number[] { return this.ladder; }
  get atFloor(): boolean { return this.idx === this.ladder.length - 1; }
  get upWaitSec(): number { return this.upHold; }

  setTarget(fps: number): void { this.target = fps; this.resetWindow(); this.goodSec = 0; }

  /** A new largest ratio (the tier changed, or the screen's own ratio did): the ladder is rebuilt and the walk starts again from its top. */
  setMax(maxRatio: number, floor: number = this.floor): number {
    this.floor = floor;
    const next = ratioLadder(maxRatio, floor);
    const same = next.length === this.ladder.length && next.every((v, i) => v === this.ladder[i]);
    if (!same) { this.ladder = next; this.idx = 0; this.upHold = this.o.upHoldSec; this.lastUpAt = -Infinity; }
    this.resetWindow();
    this.goodSec = 0;
    return this.ratio;
  }

  /** takes back the last step down (the page gave up something cheaper first, e.g. 2K textures, SPEC 16.21): the ladder goes up one rung and the window starts again */
  undoStep(): number {
    if (this.idx > 0) this.idx--;
    this.resetWindow();
    return this.ratio;
  }

  /** drop the window in progress (a tier switch, a hidden tab) */
  resetWindow(): void { this.t = 0; this.n = 0; this.dts.length = 0; this.settle = this.o.settleFrames; }

  /** Feed one frame time in seconds. Returns an event when the window just closed and something has to change. */
  frame(dtSec: number): ResolutionEvent | null {
    if (dtSec <= 0 || dtSec > this.o.ignoreAboveSec) return null;
    this.clock += dtSec;
    if (this.settle > 0) { this.settle--; return null; }
    this.t += dtSec;
    this.n += 1;
    this.dts.push(dtSec);
    if (this.t < this.o.windowSec || this.n < this.o.minFrames) return null;
    const fps = steadyFps(this.dts);
    const span = this.t;
    this.t = 0; this.n = 0; this.dts.length = 0;
    if (fps < this.target) {
      this.goodSec = 0;
      if (this.idx < this.ladder.length - 1) {
        const from = this.ratio;
        this.idx++;
        if (this.clock - this.lastUpAt < this.o.regretSec) this.upHold = Math.min(this.o.upHoldMaxSec, this.upHold * 2);
        this.settle = this.o.settleFrames;
        return { type: 'ratio', ratio: this.ratio, from, reason: 'slow' };
      }
      return { type: 'exhausted', ratio: this.ratio };
    }
    if (this.idx > 0 && fps >= this.target * this.o.upMargin) {
      this.goodSec += span;
      if (this.goodSec >= this.upHold) {
        const from = this.ratio;
        this.idx--;
        this.goodSec = 0;
        this.lastUpAt = this.clock;
        this.settle = this.o.settleFrames;
        return { type: 'ratio', ratio: this.ratio, from, reason: 'headroom' };
      }
    } else this.goodSec = 0;
    return null;
  }
}

/** Frames per second over a window with its slowest HITCH_SHARE of frames left out: a steady cost shows, a few hitches do not. */
export function steadyFps(dts: readonly number[]): number {
  if (dts.length === 0) return 0;
  const sorted = [...dts].sort((a, b) => a - b);
  const keep = sorted.length - Math.floor(sorted.length * HITCH_SHARE);
  let t = 0;
  for (let i = 0; i < keep; i++) t += sorted[i];
  return t > 0 ? keep / t : 0;
}
