// SPEC 4.12, the pure part: where a drawn body may be (the region in sight of the walker) and the least shift that fits it there;
// the door frame posts; and the walk's own rules at a wall (slow down for a dead end, stop when it is met head on, face along a wall
// while sliding, no jog stride in a boxed-in space).
import { describe, expect, it } from 'vitest';
import { BODY_FIT_MARGIN_M, BODY_FIT_MAX_SHIFT_M, bandOf, fitResidual, sightField, sightPush, solveBodyFit } from '../src/core/body-fit';
import { DOOR_POST_M, bodyGridOf, doorPosts, resolveDoors } from '../src/core/doors';
import { circleFree } from '../src/core/grid-query';
import { rasterizeLayout } from '../src/core/layout-raster';
import { stepLocomotion } from '../src/engine/locomotion';
import type { Character } from '../src/engine/character';
import type { Input } from '../src/engine/controls';
import { CHARACTER_RADIUS_M, GRID_CELL_M } from '../src/types';
import type { Grid, Vec2 } from '../src/types';
import { loadScene } from './helpers/nav-sim';

const C = GRID_CELL_M;
/** a 6 m square of free floor from (0, 0), with boxes of the given height (cm) stamped on it: [x0, z0, x1, z1, cm] */
function floor(boxes: [number, number, number, number, number][] = []): Grid {
  const n = Math.round(6 / C);
  const cells = new Uint8Array(n * n);
  for (const [x0, z0, x1, z1, cm] of boxes) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * C, z = (j + 0.5) * C;
      if (x >= x0 && x < x1 && z >= z0 && z < z1) cells[j * n + i] = cm;
    }
  }
  return { cellM: C, originX: 0, originZ: 0, nx: n, nz: n, cells };
}
const pts = (list: [number, number, number][]): Float32Array => new Float32Array(list.flatMap(([x, z, y]) => [x, z, bandOf(y)]));
const M = BODY_FIT_MARGIN_M;

describe('the region a body may be drawn in', () => {
  it('an open floor is open, and nothing is asked of any point', () => {
    const f = sightField(floor(), 3, 3, 1.2);
    expect(f.open).toBe(true);
    expect(sightPush(f, 0, 3.4, 3.2, M)).toBe(0);
    expect(solveBodyFit(f, pts([[3.5, 3, 1], [2.4, 3, 0.1]]), 2)).toEqual({ x: 0, z: 0, residual: 0 });
  });

  it('a point nearer a wall than the margin is asked to move straight off it by the shortfall; a point in the wall, by its depth plus the margin', () => {
    // a wall whose face is x = 4
    const f = sightField(floor([[4, 0, 6, 6, 250]]), 3, 3, 1.2);
    const out = { nx: 0, nz: 0 };
    expect(sightPush(f, 3, 3.9, 3.02, M, out)).toBe(0);
    expect(sightPush(f, 3, 3.97, 3.02, M, out)).toBeCloseTo(M - 0.03, 6);
    expect(out.nx).toBeCloseTo(-1, 6);
    expect(out.nz).toBeCloseTo(0, 6);
    expect(sightPush(f, 3, 4.08, 3.02, M, out)).toBeCloseTo(0.08 + M, 6);
    expect(out.nx).toBeCloseTo(-1, 6);
    // and the answer is continuous across the face
    const a = sightPush(f, 3, 3.9999, 3.02, M), b = sightPush(f, 3, 4.0001, 3.02, M);
    expect(Math.abs(a - b)).toBeLessThan(1e-3);
  });

  it('free floor on the far side of a thin wall is not room for the body: a hand through the wall is asked back to the near side', () => {
    // a 10 cm partition at x 4.0..4.1, free floor beyond
    const f = sightField(floor([[4, 0, 4.1, 6, 250]]), 3.6, 3, 1.2);
    const out = { nx: 0, nz: 0 };
    const d = sightPush(f, 2, 4.22, 3.02, M, out);
    expect(d).toBeCloseTo(0.22 + M, 6);
    expect(out.nx).toBeCloseTo(-1, 6);
    // a one-cell diagonal strip (a door leaf ajar) cannot be seen through either
    const diag = floor();
    for (let k = 0; k < 30; k++) diag.cells[(50 + k) * diag.nx + (70 + k)] = 250;
    // the strip is the line x - z = 1.0 (z 2.5 to 3.95); the walker stands 0.35 off it on one side
    const g = sightField(diag, 3.9, 2.55, 1.2);
    const at = (x: number, z: number): number => g.masks[0][Math.floor((z - g.z0) / C) * g.n + Math.floor((x - g.x0) / C)];
    let leaked = 0, seen = 0;
    for (let k = 6; k < 16; k++) {
      const x = 3.5 + k * C + 0.5 * C, z = 2.5 + k * C + 0.5 * C;
      if (at(x - 0.2, z + 0.2) === 1) leaked++; // 0.28 m beyond the strip, in free floor
      if (at(x + 0.2, z - 0.2) === 1) seen++; // and the same distance on the walker's side
    }
    expect(seen).toBeGreaterThan(5);
    expect(leaked).toBe(0);
  });

  it('low furniture hides only what is below its top: a shin may not stand in a bed, a hand may hang over it', () => {
    const f = sightField(floor([[3.5, 0, 6, 6, 45]]), 3, 3, 1.2);
    expect(sightPush(f, bandOf(0.2), 3.6, 3, M)).toBeGreaterThan(0.1);
    expect(sightPush(f, bandOf(0.9), 3.6, 3, M)).toBe(0);
    expect(sightPush(f, bandOf(1.5), 3.6, 3, M)).toBe(0);
    // a wardrobe hides every height
    const w = sightField(floor([[3.5, 0, 6, 6, 210]]), 3, 3, 1.2);
    expect(sightPush(w, bandOf(1.5), 3.6, 3, M)).toBeGreaterThan(0.1);
  });

  it('a walker standing inside something has no region (nothing is fitted until the walk has moved it out)', () => {
    const f = sightField(floor([[2.5, 2.5, 3.5, 3.5, 250]]), 3, 3, 1.2);
    expect(f.valid).toBe(false);
    expect(solveBodyFit(f, pts([[3.2, 3, 1]]), 1, M, 0.05, 0)).toEqual({ x: 0.05, z: 0, residual: 0 });
  });
});

describe('the least shift that fits the body', () => {
  it('one wall: the body moves straight off it, by exactly what its deepest point needs', () => {
    const f = sightField(floor([[4, 0, 6, 6, 250]]), 3.8, 3, 1.2);
    // a head 9 cm into the wall, a shoe 2 cm into it, a heel well clear behind
    const body = pts([[4.09, 3.01, 1.6], [4.02, 3.11, 0.05], [3.5, 3, 0.05]]);
    const fit = solveBodyFit(f, body, 3);
    expect(fit.x).toBeCloseTo(-(0.09 + M), 3);
    expect(fit.z).toBeCloseTo(0, 3);
    expect(fit.residual).toBeLessThan(1e-3);
    expect(fitResidual(f, body, 3, M, fit.x, fit.z)).toBeLessThan(1e-3);
  });

  it('a corner: off both walls at once', () => {
    const f = sightField(floor([[4, 0, 6, 6, 250], [0, 4, 6, 6, 250]]), 3.75, 3.75, 1.2);
    const body = pts([[4.05, 3.7, 1], [3.7, 4.08, 1]]);
    const fit = solveBodyFit(f, body, 2);
    expect(fit.x).toBeCloseTo(-(0.05 + M), 2);
    expect(fit.z).toBeCloseTo(-(0.08 + M), 2);
    expect(fit.residual).toBeLessThan(2e-3);
  });

  it('a gap narrower than the body: the shortfall is shared, neither wall gets all of it', () => {
    // walls at x < 2.7 and x >= 3.3: a 0.6 m gap; a body 0.66 m wide standing 6 cm off its middle
    const f = sightField(floor([[0, 0, 2.7, 6, 250], [3.3, 0, 6, 6, 250]]), 3.06, 3, 1.2);
    const body = pts([[3.06 - 0.33, 3.01, 1], [3.06 + 0.33, 3.01, 1]]);
    const before = [sightPush(f, 2, body[0], body[1], M), sightPush(f, 2, body[3], body[4], M)];
    expect(before[1] - before[0]).toBeGreaterThan(0.1);
    const fit = solveBodyFit(f, body, 2);
    expect(fit.x).toBeCloseTo(-0.06, 2);
    const after = [sightPush(f, 2, body[0] + fit.x, body[1], M), sightPush(f, 2, body[3] + fit.x, body[4], M)];
    expect(Math.abs(after[0] - after[1])).toBeLessThan(0.005);
    expect(fit.residual).toBeCloseTo(0.03 + M, 2);
  });

  it('a body that already fits is left where it starts (a shift eases away over time, it is never snapped back), and no shift exceeds the limit', () => {
    const f = sightField(floor([[4, 0, 6, 6, 250]]), 3.8, 3, 1.2);
    const fine = pts([[3.8, 3, 1]]);
    expect(solveBodyFit(f, fine, 1, M, -0.1, 0.02)).toEqual({ x: -0.1, z: 0.02, residual: 0 });
    const deep = pts([[4.9, 3, 1]]);
    const fit = solveBodyFit(f, deep, 1);
    expect(Math.hypot(fit.x, fit.z)).toBeLessThanOrEqual(BODY_FIT_MAX_SHIFT_M + 1e-9);
    expect(fit.residual).toBeGreaterThan(0.5);
  });

  it('the shift changes smoothly as the body moves along a wall (no steps from the cell lattice)', () => {
    const g = floor([[4, 0, 6, 6, 250]]);
    let prev: number | null = null, worst = 0;
    for (let z = 2; z < 4; z += 0.0037) {
      const f = sightField(g, 3.8, z, 1.2);
      const fit = solveBodyFit(f, pts([[4.06, z + 0.1, 1.5], [4.01, z - 0.12, 0.1]]), 2);
      expect(Math.abs(fit.z)).toBeLessThan(1e-6);
      if (prev !== null) worst = Math.max(worst, Math.abs(fit.x - prev));
      prev = fit.x;
    }
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('door frame posts', () => {
  it('two 50 mm posts stand inside every door hole, through the wall, and the body grid has them while the walk grid does not', () => {
    const prop = loadScene('test-tower-flat-3bhk-a');
    const doors = resolveDoors(prop.layout);
    const posts = doorPosts(doors);
    expect(posts.length).toBe(2 * doors.length);
    const d = doors.find((x) => x.id === 'door-powder-toilet')!;
    expect(d.widthM).toBeCloseTo(0.62, 6);
    const mine = posts.slice(2 * doors.indexOf(d), 2 * doors.indexOf(d) + 2);
    // the clear way between them is the door's width less two posts
    const gap = Math.hypot(mine[0].box.cx - mine[1].box.cx, mine[0].box.cz - mine[1].box.cz) - DOOR_POST_M;
    expect(gap).toBeCloseTo(0.62 - 2 * DOOR_POST_M, 6);
    const walk = rasterizeLayout(prop.layout);
    const body = bodyGridOf(prop.layout)(walk);
    expect(bodyGridOf(prop.layout)(walk)).not.toBe(walk);
    let added = 0;
    for (let k = 0; k < walk.cells.length; k++) if (walk.cells[k] !== body.cells[k]) { added++; expect(walk.cells[k]).toBe(0); }
    expect(added).toBeGreaterThan(doors.length * 2);
    // the walker's circle still goes through the narrowest door on the walk grid
    const mid = { x: (mine[0].box.cx + mine[1].box.cx) / 2, z: (mine[0].box.cz + mine[1].box.cz) / 2 };
    expect(circleFree(walk, mid.x, mid.z, CHARACTER_RADIUS_M)).toBe(true);
    // and the same stamper gives the same grid back until the walk grid is replaced
    const stamp = bodyGridOf(prop.layout);
    expect(stamp(walk)).toBe(stamp(walk));
  });
});

// ---------------------------------------------------------------- the walk at a wall

function fakeChar(x: number, z: number, yawDeg = 0, heightM = 1.75): Character & { calls: [number, boolean][] } {
  const calls: [number, boolean][] = [];
  const c = {
    state: 'idle' as string, heightM, yawDeg, position: { x, z } as Vec2, calls,
    setLocomotion(speed: number, jog: boolean) { calls.push([speed, jog]); c.state = speed > 0.02 ? (jog ? 'jog' : 'walk') : 'idle'; },
  };
  return c as unknown as Character & { calls: [number, boolean][] };
}
const push = (moveX: number, moveY: number, jog = false): Input => ({ moveX, moveY, jog }) as unknown as Input;
const DT = 1 / 60;

describe('walking at a wall', () => {
  // free floor with a wall whose face is z = 4 (camera yaw 0: forward is +z)
  const wall = floor([[0, 4, 6, 6, 250]]);

  it('slows for a dead end and arrives at a crawl: no full-pace stride into the wall, and it does reach it', () => {
    const ch = fakeChar(3, 2);
    const speeds: number[] = [];
    for (let i = 0; i < 240; i++) speeds.push(stepLocomotion(ch, push(0, 1), 0, wall, DT));
    const top = Math.max(...speeds);
    expect(top).toBeCloseTo(1.4, 2);
    // it stops within a cell of where the circle touches
    expect(ch.position.z).toBeGreaterThan(4 - CHARACTER_RADIUS_M - C);
    expect(circleFree(wall, ch.position.x, ch.position.z, CHARACTER_RADIUS_M)).toBe(true);
    // the last frame it moved, it was going at no more than the crawl
    const lastMoving = speeds.filter((v) => v > 0.02).at(-1)!;
    expect(lastMoving).toBeLessThan(0.45);
    // from full pace the speed only falls, and never by more than the stopping rate allows (8.5 m/s^2), until it stands
    const from = speeds.indexOf(top);
    const stop = speeds.findIndex((v, i) => i > from && v < 0.02);
    for (let i = from + 1; i < stop; i++) {
      expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] + 1e-9);
      expect(speeds[i - 1] - speeds[i]).toBeLessThan(8.5 * DT + 0.05);
    }
    // and then it stands: held against the wall, it does not start and stop
    expect(speeds.slice(stop).every((v) => v === 0)).toBe(true);
    expect(ch.calls.slice(stop).every(([v]) => v === 0)).toBe(true);
  });

  it('a jog brakes from further out: as soon as the wall is inside the 1.2 m look-ahead, then it follows the gentle approach curve down to a stand', () => {
    const ch = fakeChar(3, 0.5);
    const zs: number[] = [], speeds: number[] = [];
    for (let i = 0; i < 240; i++) { speeds.push(stepLocomotion(ch, push(0, 1, true), 0, wall, DT)); zs.push(ch.position.z); }
    const braking = speeds.findIndex((v, i) => i > 0 && v < speeds[i - 1] - 1e-6);
    // 3.4 m/s is far over the approach curve (sqrt(2 * 1.1 * d) + 0.18 is 1.8 m/s at 1.2 m): it brakes the moment the wall is inside the look-ahead
    expect(4 - CHARACTER_RADIUS_M - zs[braking]).toBeGreaterThan(0.9);
    expect(4 - CHARACTER_RADIUS_M - zs[braking]).toBeLessThan(1.25);
    // and never harder than the stopping rate, nor a frame of speed above the approach curve once on it
    for (let i = 1; i < speeds.length; i++) expect(speeds[i - 1] - speeds[i]).toBeLessThan(8.5 * DT + 0.02);
    expect(speeds.at(-1)).toBe(0);
  });

  it('met within 15 degrees of head on, the wall stops the walker; at a slant it slides, and turns to face along the wall', () => {
    const headOn = fakeChar(3, 3.6);
    const a = 8 * Math.PI / 180;
    for (let i = 0; i < 180; i++) stepLocomotion(headOn, push(-Math.sin(a), Math.cos(a)), 0, wall, DT);
    expect(headOn.calls.at(-1)).toEqual([0, false]);
    expect(Math.abs(headOn.position.x - 3)).toBeLessThan(0.12);
    expect(Math.abs(headOn.yawDeg - 8)).toBeLessThan(1); // still facing the way it was pushed

    const slant = fakeChar(3, 3.6);
    const b = 50 * Math.PI / 180;
    let v = 0;
    for (let i = 0; i < 120; i++) v = stepLocomotion(slant, push(-Math.sin(b), Math.cos(b)), 0, wall, DT);
    expect(slant.position.x).toBeGreaterThan(3.8); // it went along the wall (+x)
    expect(v).toBeGreaterThan(0.9);
    expect(Math.abs(slant.yawDeg - 90)).toBeLessThan(3); // facing along the wall, not 50 degrees into it
    expect(slant.calls.at(-1)![0]).toBeCloseTo(v, 6);
    // let go of the wall (push away from it): it faces where it is pushed again
    for (let i = 0; i < 90; i++) stepLocomotion(slant, push(0, -1), 0, wall, DT);
    expect(Math.abs((((slant.yawDeg % 360) + 360) % 360) - 180)).toBeLessThan(1);
  });

  it('the jog clip needs a jogging pace and a clear way: starting, or boxed in, a jog is a quick walk', () => {
    const open = floor();
    const ch = fakeChar(3, 0.5);
    const first = [] as boolean[];
    for (let i = 0; i < 60; i++) { stepLocomotion(ch, push(0, 1, true), 0, open, DT); first.push(ch.calls.at(-1)![1]); }
    expect(first[5]).toBe(false); // 0.1 s in: 0.6 m/s
    expect(first[59]).toBe(true); // at 3.4 m/s
    const on = first.indexOf(true);
    expect(ch.calls[on][0]).toBeGreaterThanOrEqual(0.62 * 3.4);
    // a 1 m deep passage: walls at z < 2.5 and z >= 3.54
    const box = floor([[0, 0, 6, 2.5, 250], [0, 3.54, 6, 6, 250]]);
    const boxed = fakeChar(3, 2.75);
    for (let i = 0; i < 120; i++) stepLocomotion(boxed, push(0, 1, true), 0, box, DT);
    expect(boxed.calls.some(([, jog]) => jog)).toBe(false);
    expect(boxed.calls.some(([v2]) => v2 > 0.5)).toBe(true);
  });
});
