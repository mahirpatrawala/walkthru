// The short fade that hides a teleport or the swap of one home for another. A small state machine over time: no three, no DOM.
// `update(dt)` is called every frame; the action runs once, at full black, and may take as long as it likes (a home loading): the screen stays black until it is done.
import { FADE_IN_S, FADE_OUT_S } from './config';

export type FadePhase = 'idle' | 'out' | 'busy' | 'in';

export class FadeMachine {
  phase: FadePhase = 'idle';
  private t = 0;
  private pending: { run: () => void | Promise<void>; done: () => void }[] = [];
  private running = false;
  /** how dark the screen is now, 0 clear to 1 black */
  alpha = 0;
  constructor(private readonly outS = FADE_OUT_S, private readonly inS = FADE_IN_S) {}

  get busy(): boolean { return this.phase !== 'idle'; }

  /** Fades out, runs `action` while black, fades in. Asked again while busy, it runs after the one in progress (never two jumps at once). Resolves when the screen is clear again. */
  go(action: () => void | Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      this.pending.push({ run: action, done: resolve });
      if (this.phase === 'idle') { this.phase = 'out'; this.t = 0; }
    });
  }

  /** Starts black and fades in (a session that has just begun: the first frames must not show the play space's origin). */
  startFromBlack(): void {
    this.phase = 'in'; this.t = 0; this.alpha = 1;
  }

  update(dt: number): void {
    if (this.phase === 'idle') return;
    if (this.phase === 'out') {
      this.t += dt;
      this.alpha = Math.min(1, this.t / this.outS);
      if (this.alpha >= 1) { this.phase = 'busy'; this.runNext(); }
    } else if (this.phase === 'in') {
      this.t += dt;
      this.alpha = Math.max(0, 1 - this.t / this.inS);
      if (this.alpha <= 0) {
        if (this.pending.length) { this.phase = 'out'; this.t = 0; } else this.phase = 'idle';
      }
    }
    // 'busy': black, waiting for the action
  }

  private runNext(): void {
    if (this.running) return;
    const job = this.pending.shift();
    if (!job) { this.phase = 'in'; this.t = 0; return; }
    this.running = true;
    void Promise.resolve().then(() => job.run()).catch((err) => console.error('[walkthru-vr] a faded action threw', err)).finally(() => {
      this.running = false;
      job.done();
      if (this.phase !== 'busy') return; // reset() was called meanwhile
      this.runNext(); // another jump was asked for while this one ran: still black, go straight on
    });
  }

  /** Clears everything at once (the session ended). Queued actions are dropped, their callers are let go. */
  reset(): void {
    this.phase = 'idle'; this.t = 0; this.alpha = 0;
    for (const job of this.pending.splice(0)) job.done();
  }
}
