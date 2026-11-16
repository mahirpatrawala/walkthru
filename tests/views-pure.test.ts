// The view modes' pure parts: the state machine, the doll house camera maths, wall caps, the ceiling rules and label placement.
import { describe, expect, it } from 'vitest';
import { DEFAULT_FINISHES } from '../src/types';
import type { Layout, Opening, RoomTag } from '../src/types';
import {
  FLIGHT_S, createViewMachine, parseViewParam, smootherstep, withViewParam,
} from '../src/buyer/views/view-modes';
import {
  boundsCentre, boundsRadius, clampOrbit, damp, dampAngle, dampOrbit, entranceOutward, fitDistance, initialOrbit, layoutBounds, orbitBy,
  orbitPosition, panBy, sphereDistance, viewVector, zoomBy,
} from '../src/buyer/views/framing';
import { CAP_LIFT_M, capPositions, wallCapQuads } from '../src/buyer/views/wall-caps';
import { ceilingOpacity, classifyHang, keepBelow } from '../src/buyer/views/hang';
import { distanceOpacity, labelPoint, placeLabels } from '../src/buyer/views/labels';

function rect(id: string, x0: number, z0: number, x1: number, z1: number, type: RoomTag['roomType'] = 'bedroom', label = id): RoomTag {
  return { id, roomType: type, label, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'] };
}
const layoutOf = (rooms: RoomTag[], openings: Opening[] = []): Layout => ({ wallHeightM: 2.75, wallThicknessM: 0.12, railingHeightM: 1.1, rooms, openings, finishes: DEFAULT_FINISHES, scaleSource: 'typed-sizes' });
/** two rooms side by side with a door between them and a front door on the south wall of the first (edge 2 runs x1 -> x0 at z1) */
function flat(): Layout {
  const a = rect('a', 0, 0, 4, 4, 'living', 'Living'), b = rect('b', 4.12, 0, 8.12, 4, 'bedroom', 'Bedroom');
  const inner: Opening = { id: 'd1', roomId: 'a', edge: 1, type: 'door', centreM: 2, widthM: 0.9, sillM: 0, headM: 2.1, leaf: { hinge: 'start', swing: 'in', kind: 'hinged' } };
  const front: Opening = { id: 'front', roomId: 'a', edge: 2, type: 'door', centreM: 2, widthM: 1.0, sillM: 0, headM: 2.1, leaf: { hinge: 'start', swing: 'in', kind: 'hinged' } };
  const win: Opening = { id: 'w1', roomId: 'b', edge: 0, type: 'window', centreM: 2, widthM: 1.2, sillM: 0.9, headM: 2.1 };
  return layoutOf([a, b], [inner, front, win]);
}

describe('view machine', () => {
  it('starts in the mode it is given and defaults to walk', () => {
    expect(createViewMachine().mode()).toBe('walk');
    const m = createViewMachine('dollhouse');
    expect(m.mode()).toBe('dollhouse');
    expect(m.flight().amount).toBe(1);
    expect(createViewMachine('plan').planAmount()).toBe(1);
  });
  it('flies up in FLIGHT_S seconds whatever the frame size, and back down', () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 20]) {
      const m = createViewMachine('walk');
      expect(m.set('dollhouse')).toBe(true);
      let t = 0;
      while (m.flight().moving) { m.tick(dt); t += dt; if (t > 5) break; }
      expect(t).toBeGreaterThanOrEqual(FLIGHT_S - 1e-9);
      expect(t).toBeLessThan(FLIGHT_S + dt + 1e-9);
      expect(m.flight().amount).toBe(1);
      m.set('walk');
      m.tick(FLIGHT_S / 2);
      const mid = m.flight();
      expect(mid.dir).toBe(-1);
      expect(mid.amount).toBeCloseTo(0.5, 5); // smootherstep(0.5)
      m.tick(FLIGHT_S);
      expect(m.flight().amount).toBe(0);
      expect(m.dollhouseOn()).toBe(false);
    }
  });
  it('turns round mid-flight without a jump', () => {
    const m = createViewMachine('walk');
    m.set('dollhouse');
    m.tick(0.3);
    const a = m.flight().raw;
    m.set('walk');
    expect(m.flight().raw).toBe(a);
    m.tick(0.1);
    expect(m.flight().raw).toBeLessThan(a);
  });
  it('the plan fades over the 3D view and lets the frame loop rest only when it has fully covered it', () => {
    const m = createViewMachine('walk');
    m.set('plan');
    expect(m.rendering3D()).toBe(true);
    m.tick(0.1);
    expect(m.planAmount()).toBeGreaterThan(0);
    expect(m.rendering3D()).toBe(true);
    m.tick(1);
    expect(m.planAmount()).toBe(1);
    expect(m.rendering3D()).toBe(false);
    m.set('walk');
    expect(m.rendering3D()).toBe(true);
  });
  it('the plan from the doll house keeps the doll house camera, from walk it keeps the walker', () => {
    const a = createViewMachine('dollhouse');
    a.set('plan'); a.tick(2);
    expect(a.flight().amount).toBe(1);
    const b = createViewMachine('walk');
    b.set('plan'); b.tick(2);
    expect(b.flight().amount).toBe(0);
  });
  it('reports changes and ignores a repeat', () => {
    const m = createViewMachine();
    const seen: string[] = [];
    m.onChange((n, p) => seen.push(`${p}>${n}`));
    expect(m.set('walk')).toBe(false);
    m.set('plan'); m.set('dollhouse');
    expect(seen).toEqual(['walk>plan', 'plan>dollhouse']);
  });
  it('instant jumps land at once', () => {
    const m = createViewMachine('walk');
    m.set('dollhouse', { instant: true });
    expect(m.flight().amount).toBe(1);
    expect(m.flight().moving).toBe(false);
  });
});

describe('the ?view= address', () => {
  it('reads dollhouse, plan and walk, and falls back to walk', () => {
    expect(parseViewParam('?view=dollhouse')).toBe('dollhouse');
    expect(parseViewParam('?scene=x&view=plan&debug=1')).toBe('plan');
    expect(parseViewParam('?view=walk')).toBe('walk');
    expect(parseViewParam('?view=sideways')).toBe('walk');
    expect(parseViewParam('')).toBe('walk');
  });
  it('keeps every other parameter and drops the parameter for walk', () => {
    expect(withViewParam('/?building=sample-tower&space=f2-204&debug=1', 'dollhouse')).toBe('/?building=sample-tower&space=f2-204&debug=1&view=dollhouse');
    expect(withViewParam('/?scene=a&view=plan', 'walk')).toBe('/?scene=a');
    expect(withViewParam('/?scene=a&view=plan#top', 'dollhouse')).toBe('/?scene=a&view=dollhouse#top');
    expect(withViewParam('/', 'walk')).toBe('/');
  });
  it('smootherstep is flat at both ends', () => {
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 6);
    expect(smootherstep(0.01)).toBeLessThan(0.0001);
  });
});

describe('framing', () => {
  const bounds = layoutBounds(flat())!;
  it('measures the layout with the wall thickness', () => {
    expect(bounds.x0).toBeCloseTo(-0.12, 6);
    expect(bounds.x1).toBeCloseTo(8.24, 6);
    expect(bounds.h).toBe(2.75);
    expect(layoutBounds({ rooms: [], wallThicknessM: 0.1, wallHeightM: 2.7 })).toBeNull();
  });
  it('fits the whole box at every orbit angle, never farther than the bounding sphere rule', () => {
    const fov = 42;
    for (const aspect of [0.46, 1, 1.6, 2.2]) {
      for (const theta of [0, 1, 2.5, -1.2]) {
        for (const phi of [20, 40, 80]) {
          const d = fitDistance(bounds, fov, aspect, theta, (phi * Math.PI) / 180, 1);
          const loose = sphereDistance(boundsRadius(bounds), Math.min(fov, (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * aspect) * 180) / Math.PI));
          expect(d).toBeLessThanOrEqual(loose + 1e-6);
          expect(d).toBeGreaterThan(boundsRadius(bounds) * 0.5);
        }
      }
    }
  });
  it('really frames every corner (projecting them inside the field of view)', () => {
    const fov = 42, aspect = 1.6, theta = 0.7, phi = (40 * Math.PI) / 180;
    const d = fitDistance(bounds, fov, aspect, theta, phi, 1);
    const c = boundsCentre(bounds);
    const v = viewVector(theta, phi);
    const cam = { x: c.x + v.x * d, y: c.y + v.y * d, z: c.z + v.z * d };
    const f = { x: -v.x, y: -v.y, z: -v.z };
    let r = { x: f.z * 0 - f.z, y: 0, z: f.x }; r = { x: -f.z, y: 0, z: f.x };
    const rl = Math.hypot(r.x, r.z); r = { x: r.x / rl, y: 0, z: r.z / rl };
    const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
    const tanV = Math.tan((fov * Math.PI) / 360);
    let worst = 0;
    for (const x of [bounds.x0, bounds.x1]) for (const z of [bounds.z0, bounds.z1]) for (const y of [0, bounds.h]) {
      const p = { x: x - cam.x, y: y - cam.y, z: z - cam.z };
      const depth = p.x * f.x + p.y * f.y + p.z * f.z;
      const nx = (p.x * r.x + p.y * r.y + p.z * r.z) / depth / (tanV * aspect);
      const ny = (p.x * u.x + p.y * u.y + p.z * u.z) / depth / tanV;
      worst = Math.max(worst, Math.abs(nx), Math.abs(ny));
    }
    expect(worst).toBeLessThanOrEqual(1 + 1e-6);
    expect(worst).toBeGreaterThan(0.97); // and it is a tight fit, not a loose one
  });
  it('finds the entrance side from the door that opens to the outside, and none when there is none', () => {
    const out = entranceOutward(flat());
    expect(out).not.toBeNull();
    expect(out!.z).toBeCloseTo(1, 6); // the front door is in the wall at z = 4: outward is +z
    expect(Math.abs(out!.x)).toBeLessThan(1e-6);
    const closed = layoutOf([rect('a', 0, 0, 4, 4), rect('b', 4.12, 0, 8.12, 4)], [flat().openings[0]]);
    expect(entranceOutward(closed)).toBeNull();
  });
  it('starts 50 degrees up, the entrance side nearest, with the pose inside its own limits', () => {
    const { goal, limits } = initialOrbit(bounds, { fovVDeg: 42, aspect: 1.6, entrance: { x: 0, z: 1 } });
    expect(goal.theta).toBeCloseTo(0, 6);
    expect((90 - (goal.phi * 180) / Math.PI)).toBeCloseTo(50, 6);
    expect(clampOrbit(goal, limits)).toEqual(goal);
    const pos = orbitPosition(goal);
    expect(pos.z).toBeGreaterThan(goal.tz); // on the entrance (+z) side
    const north = initialOrbit(bounds, { fovVDeg: 42, aspect: 1.6, entrance: { x: 0, z: -1 } });
    expect(orbitPosition(north.goal).z).toBeLessThan(north.goal.tz);
    expect(initialOrbit(bounds, { fovVDeg: 42, aspect: 1.6 }).goal.theta).toBe(0);
  });
  it('holds the polar angle between 20 and 80 degrees from vertical, and the distance and pan inside their limits', () => {
    const { goal, limits } = initialOrbit(bounds, { fovVDeg: 42, aspect: 1.6 });
    let g = orbitBy(goal, 0, 100000, 900, limits);
    expect((g.phi * 180) / Math.PI).toBeCloseTo(20, 6);
    g = orbitBy(goal, 0, -100000, 900, limits);
    expect((g.phi * 180) / Math.PI).toBeCloseTo(80, 6);
    expect(zoomBy(goal, 1e3, limits).dist).toBe(limits.distMax);
    expect(zoomBy(goal, -1e3, limits).dist).toBe(limits.distMin);
    const far = panBy(goal, 1e6, 1e6, 900, 42, limits);
    expect(far.tx).toBeGreaterThanOrEqual(limits.pan.x0);
    expect(far.tx).toBeLessThanOrEqual(limits.pan.x1);
    expect(far.tz).toBeGreaterThanOrEqual(limits.pan.z0);
    expect(far.tz).toBeLessThanOrEqual(limits.pan.z1);
  });
  it('a drag to the right turns the view the way OrbitControls does and pan keeps the point under the finger', () => {
    const { goal, limits } = initialOrbit(bounds, { fovVDeg: 42, aspect: 1.6 });
    expect(orbitBy(goal, 50, 0, 900, limits).theta).toBeLessThan(goal.theta);
    const p = panBy({ ...goal, theta: 0 }, 100, 0, 900, 42, limits); // theta 0: the camera looks toward -z, screen right is +x; the view slides right so the target goes left
    expect(p.tx).toBeLessThan(goal.tx);
    expect(p.tz).toBeCloseTo(goal.tz, 9);
  });
  it('damping is frame-rate independent and angles take the short way round', () => {
    let a = 0, b = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 1 / 60);
    for (let i = 0; i < 240; i++) b = damp(b, 1, 1 / 240);
    expect(a).toBeCloseTo(b, 9);
    expect(dampAngle(3.0, -3.0, 0.05)).toBeGreaterThan(3.0); // 3 -> -3 is 0.28 rad through pi, not 6 rad back
    const g = initialOrbit(bounds, { fovVDeg: 42, aspect: 1 }).goal;
    const mid = dampOrbit({ ...g, dist: g.dist * 2 }, g, 1 / 60);
    expect(mid.dist).toBeLessThan(g.dist * 2);
    expect(mid.dist).toBeGreaterThan(g.dist);
  });
});

describe('wall caps', () => {
  it('caps every full-height piece and the lintels, and nothing that stops short of the ceiling', () => {
    const lay = flat();
    const quads = wallCapQuads(lay);
    expect(quads.length).toBeGreaterThanOrEqual(8); // 4 walls per room, cut by the doors into pieces
    // every cap lies inside the layout's bounds plus its thickness
    const b = layoutBounds(lay)!;
    for (const q of quads) for (const p of q) {
      expect(p.x).toBeGreaterThanOrEqual(b.x0 - 0.2); expect(p.x).toBeLessThanOrEqual(b.x1 + 0.2);
      expect(p.z).toBeGreaterThanOrEqual(b.z0 - 0.2); expect(p.z).toBeLessThanOrEqual(b.z1 + 0.2);
    }
  });
  it('leaves out a partly drawn room and the edges another module owns', () => {
    const lay = flat();
    const all = wallCapQuads(lay).length;
    lay.rooms[1] = { ...lay.rooms[1], partial: { reason: 'runs off the sheet' } };
    expect(wallCapQuads(lay).length).toBeLessThan(all);
    const skip = new Set(['a:0', 'a:1', 'a:2', 'a:3']);
    expect(wallCapQuads(flat(), skip).length).toBeLessThan(all);
  });
  it('lays two upward-facing triangles per quad at the given height', () => {
    const quads = wallCapQuads(flat());
    const pos = capPositions(quads, 2.75 + CAP_LIFT_M);
    expect(pos.length).toBe(quads.length * 18);
    for (let i = 0; i < pos.length; i += 9) {
      expect(pos[i + 1]).toBeCloseTo(2.754, 6);
      const ax = pos[i], az = pos[i + 2], bx = pos[i + 3], bz = pos[i + 5], cx = pos[i + 6], cz = pos[i + 8];
      const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az); // the y of (B-A)x(C-A): positive faces up
      expect(up).toBeGreaterThan(0);
    }
  });
});

describe('what hangs from the ceiling', () => {
  const H = 2.75;
  it('fades slabs, hides the ceiling kit and the signs, filters the merged fixtures mesh, keeps the rest', () => {
    expect(classifyHang({ name: 'ceiling:living' }, H)).toBe('fade');
    for (const n of ['kit:cove', 'kit:cove-led', 'kit:fan-light', 'kit:fan-blades', 'kit:tube-lens', 'door-labels', 'portal-signs']) expect(classifyHang({ name: n }, H)).toBe('hide');
    expect(classifyHang({ name: 'kit:fixtures' }, H)).toBe('filter');
    expect(classifyHang({ name: 'kit:skirting' }, H)).toBe('keep');
    expect(classifyHang({ name: 'walls:a' }, H)).toBe('keep');
    expect(classifyHang({ name: 'floor:a' }, H)).toBe('keep');
  });
  it('hides a hung light by tag but keeps a standing lamp, and hides a pendant by height but not a tall wardrobe', () => {
    expect(classifyHang({ name: 'x', light: 'fan' }, H)).toBe('hide');
    expect(classifyHang({ name: 'x', light: 'tube' }, H)).toBe('hide');
    expect(classifyHang({ name: 'x', light: 'lamp' }, H)).toBe('keep');
    expect(classifyHang({ name: 'pendant', inFurniture: true, minY: 2.2 }, H)).toBe('hide');
    expect(classifyHang({ name: 'wardrobe', inFurniture: true, minY: 0 }, H)).toBe('keep');
    expect(classifyHang({ name: 'overhead-cabinet', inFurniture: true, minY: 1.45 }, H)).toBe('keep');
    expect(classifyHang({ name: 'pendant', inFurniture: false, minY: 2.2 }, H)).toBe('keep'); // the height rule is for the furniture tree only
  });
  it('drops only the triangles inside the ceiling band, indexed or not', () => {
    // three triangles: one at the ceiling (a fan housing), one low (a switchboard), one straddling
    const pos = [
      0, 2.7, 0, 1, 2.7, 0, 0, 2.7, 1, // all at 2.7
      0, 1.2, 0, 1, 1.2, 0, 0, 1.4, 1, // low
      0, 2.2, 0, 1, 2.6, 0, 0, 1.0, 1, // one corner low
    ];
    const plain = keepBelow(pos, null, 1.95);
    expect(plain.dropped).toBe(1);
    expect(Array.from(plain.index)).toEqual([3, 4, 5, 6, 7, 8]);
    const idx = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(keepBelow(pos, idx, 1.95).dropped).toBe(1);
    expect(keepBelow(pos, null, 99).dropped).toBe(0);
    expect(keepBelow(pos, null, 1.95, -0.8).dropped).toBe(0); // the same mesh set 0.8 m lower: nothing is in the band any more
  });
  it('the ceiling fades out before the flight is half over', () => {
    expect(ceilingOpacity(0)).toBe(1);
    expect(ceilingOpacity(0.55)).toBe(0);
    expect(ceilingOpacity(0.3)).toBeGreaterThan(0);
    expect(ceilingOpacity(0.3)).toBeLessThan(1);
    expect(ceilingOpacity(1)).toBe(0);
  });
});

describe('room tags', () => {
  const c = (id: string, sx: number, sy: number, weight: number, extra: Partial<Parameters<typeof placeLabels>[0][0]> = {}) => ({ id, sx, sy, ok: true, w: 120, h: 34, dist: 10, weight, ...extra });
  it('keeps the heavier of two tags that collide and dims the other', () => {
    const out = placeLabels([c('small', 500, 300, 1), c('big', 520, 310, 9), c('apart', 900, 300, 2)], { near: 12, far: 30 });
    expect(out.find((o) => o.id === 'big')!.opacity).toBe(1);
    expect(out.find((o) => o.id === 'small')!.opacity).toBe(0);
    expect(out.find((o) => o.id === 'apart')!.opacity).toBe(1);
  });
  it('hides a tag behind the camera or off the picture', () => {
    expect(placeLabels([c('a', 0, 0, 1, { ok: false })], { near: 10, far: 20 })[0].opacity).toBe(0);
  });
  it('fades with distance and is gone far beyond the far mark', () => {
    expect(distanceOpacity(5, 10, 30)).toBe(1);
    expect(distanceOpacity(20, 10, 30)).toBeLessThan(1);
    expect(distanceOpacity(20, 10, 30)).toBeGreaterThan(distanceOpacity(30, 10, 30) - 1e-9);
    expect(distanceOpacity(60, 10, 30)).toBe(0);
  });
  it('puts an L shaped room tag inside the room', () => {
    const L = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 6 }, { x: 0, z: 6 }];
    const p = labelPoint(L);
    const inside = (p.x >= 0 && p.x <= 6 && p.z >= 0 && p.z <= 1) || (p.x >= 0 && p.x <= 1 && p.z >= 0 && p.z <= 6);
    expect(inside).toBe(true);
  });
});
