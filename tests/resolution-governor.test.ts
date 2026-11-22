// SPEC 16.18: the resolution governor as a pure function of frame times.
import { describe, expect, it } from 'vitest';
import { RATIO_FLOOR, ResolutionGovernor, ratioLadder, steadyFps } from '../src/look/resolution';
import type { ResolutionEvent } from '../src/look/resolution';

/** Feeds `sec` seconds of frames at `fps`, returns every event raised. */
function run(g: ResolutionGovernor, fps: number, sec: number): ResolutionEvent[] {
  const out: ResolutionEvent[] = [];
  const n = Math.round(fps * sec);
  for (let i = 0; i < n; i++) { const e = g.frame(1 / fps); if (e) out.push(e); }
  return out;
}

/** Feeds slow frames until the governor has stepped down `n` times. */
function drop(g: ResolutionGovernor, n: number): void {
  let k = 0;
  for (let i = 0; i < 100000 && k < n; i++) { const e = g.frame(1 / 30); if (e && e.type === 'ratio') k++; }
}

describe('ratioLadder', () => {
  it('walks 2, 1.75, 1.5, 1.25 on a 2x screen and never below the floor', () => {
    expect(ratioLadder(2)).toEqual([2, 1.75, 1.5, 1.25]);
    expect(ratioLadder(3)).toEqual([3, 2, 1.75, 1.5, 1.25]);
  });
  it('starts at the screen or the cap, whichever is smaller', () => {
    expect(ratioLadder(1.5)).toEqual([1.5, 1.25]);
    expect(ratioLadder(1.25)).toEqual([1.25]);
    expect(ratioLadder(1)).toEqual([1]);
    expect(RATIO_FLOOR).toBe(1.25);
  });
  it('a lower floor (the low tier on a desktop) adds 1 as the last rung', () => {
    expect(ratioLadder(2, 1)).toEqual([2, 1.75, 1.5, 1.25, 1]);
    expect(ratioLadder(1.5, 1)).toEqual([1.5, 1.25, 1]);
    expect(ratioLadder(1, 1)).toEqual([1]);
  });
});

describe('ResolutionGovernor', () => {
  it('holds the ratio while the target is met', () => {
    const g = new ResolutionGovernor(2, { target: 50 });
    expect(run(g, 58, 12)).toEqual([]);
    expect(g.ratio).toBe(2);
  });

  it('steps down one rung per slow window until the floor, then reports exhausted once per window', () => {
    const g = new ResolutionGovernor(2, { target: 50 });
    const ev = run(g, 30, 30);
    const ratios = ev.filter((e) => e.type === 'ratio').map((e) => (e as { ratio: number }).ratio);
    expect(ratios).toEqual([1.75, 1.5, 1.25]);
    expect(ev.some((e) => e.type === 'exhausted')).toBe(true);
    expect(g.ratio).toBe(1.25);
    expect(g.atFloor).toBe(true);
    // the tier watchdog may act only after the ladder is spent
    expect(ev.findIndex((e) => e.type === 'exhausted')).toBe(3);
  });

  it('a screen with no room below the floor (1x) reports exhausted straight away', () => {
    const g = new ResolutionGovernor(1, { target: 50 });
    const ev = run(g, 30, 5);
    expect(ev[0]).toEqual({ type: 'exhausted', ratio: 1 });
  });

  it('ignores one slow frame and frames from a hidden tab', () => {
    const g = new ResolutionGovernor(2, { target: 50 });
    run(g, 60, 3);
    expect(g.frame(0.6)).toBeNull();
    expect(g.frame(2)).toBeNull();
    expect(run(g, 60, 6)).toEqual([]);
    expect(g.ratio).toBe(2);
  });

  it('the first frames after a change are not counted (the resize itself is slow)', () => {
    const g = new ResolutionGovernor(2, { target: 50 });
    drop(g, 1); // one step down
    expect(g.ratio).toBe(1.75);
    // six slow frames at the start of the next window, then healthy: no second step down
    for (let i = 0; i < 6; i++) g.frame(0.2);
    expect(run(g, 60, 4)).toEqual([]);
    expect(g.ratio).toBe(1.75);
  });

  it('steps back up one rung only after a sustained stretch well above target', () => {
    const g = new ResolutionGovernor(2, { target: 50 });
    drop(g, 2); // 1.5
    expect(g.ratio).toBe(1.5);
    expect(run(g, 54, 10)).toEqual([]); // above target but inside the margin: no
    expect(run(g, 70, 15)).toEqual([]); // above the margin but not long enough
    const up = run(g, 70, 10);
    expect(up).toEqual([{ type: 'ratio', ratio: 1.75, from: 1.5, reason: 'headroom' }]);
  });

  it('a dip in the middle resets the wait for a step up', () => {
    const g = new ResolutionGovernor(2, { target: 50 });
    drop(g, 1); // 1.75
    run(g, 70, 15);
    drop(g, 1); // slow again: down
    expect(g.ratio).toBe(1.5);
    expect(run(g, 70, 15)).toEqual([]);
  });

  it('does not oscillate: a step up that has to be undone doubles the wait', () => {
    const g = new ResolutionGovernor(2, { target: 50 });
    drop(g, 1); // 1.75
    const wait0 = g.upWaitSec;
    // the scene can hold 60 fps at 1.75 and 40 fps at 2: probing 2 fails every time
    const trace: number[] = [];
    let t = 0;
    while (t < 400) {
      const fps = g.ratio >= 2 ? 40 : 60;
      for (const e of run(g, fps, 1)) if (e.type === 'ratio') trace.push(e.ratio);
      t += 1;
    }
    expect(g.upWaitSec).toBeGreaterThan(wait0);
    const ups = trace.filter((r, i) => r === 2 && trace[i - 1] === 1.75).length;
    // 400 s with waits of 20, 40, 80, 160: at most four probes, and the last 150 s are quiet
    expect(ups).toBeGreaterThanOrEqual(2);
    expect(ups).toBeLessThanOrEqual(4);
    expect(g.ratio).toBe(1.75);
  });

  it('setMax rebuilds the ladder from the top for a new tier and keeps it when nothing changed', () => {
    const g = new ResolutionGovernor(2, { target: 50 });
    drop(g, 2);
    expect(g.ratio).toBe(1.5);
    expect(g.setMax(2)).toBe(1.5); // same ladder: stays where it learned
    expect(g.setMax(1.5)).toBe(1.5);
    expect(g.steps).toEqual([1.5, 1.25]);
    expect(g.setMax(1)).toBe(1);
  });

  it('setTarget restarts the measuring window', () => {
    const g = new ResolutionGovernor(2, { target: 55 });
    run(g, 52, 1.5);
    g.setTarget(50);
    expect(run(g, 52, 6)).toEqual([]);
  });

  it('load hitches do not walk the ladder down (22 Nov 2026): the slowest tenth of a window is left out', () => {
    const g = new ResolutionGovernor(2, { target: 55 });
    // two seconds at 60 fps with a shader compile, a texture upload and a decode in it: the plain average is 46 fps
    const out: ResolutionEvent[] = [];
    for (let s = 0; s < 6; s++) {
      for (let i = 0; i < 120; i++) { const e = g.frame(i % 40 === 7 ? 0.2 : 1 / 60); if (e) out.push(e); }
    }
    expect(out).toEqual([]);
    expect(g.ratio).toBe(2);
    expect(steadyFps([...Array(18).fill(1 / 60), 0.3, 0.3])).toBeCloseTo(60, 5);
  });

  it('a steady slow GPU still steps down, and the low ladder ends at 1', () => {
    const g = new ResolutionGovernor(2, { target: 30, floor: 1 });
    const ev = run(g, 20, 40);
    const ratios = ev.filter((e) => e.type === 'ratio').map((e) => (e as { ratio: number }).ratio);
    expect(ratios).toEqual([1.75, 1.5, 1.25, 1]);
    expect(ev.some((e) => e.type === 'exhausted')).toBe(true);
    expect(g.setMax(2, 1.25)).toBe(2);
    expect(g.steps).toEqual([2, 1.75, 1.5, 1.25]);
  });
});
