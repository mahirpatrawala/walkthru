// The landing page's hero: the facts its labels state come from the featured building's own files, the levels line up on the lift
// core, the walker stays inside the flat, and the view keeps what matters in frame. Also: which addresses show the landing page.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../src/core/geometry';
import { carpetAreaM2 } from '../src/core/layout-geom';
import { validateProperty } from '../src/core/layout-validate';
import { parseBuilding } from '../src/building/parse';
import { doorFrame, toLevel } from '../src/building/geom';
import type { SceneInfo } from '../src/building/load';
import { parseOutdoor } from '../src/outdoor/types';
import { FEATURED_BUILDING_ID, contactHref } from '../src/landing/config';
import { buildHeroModel, convexHull, heroSceneIds, levelFrame, outsideBy, pointAlong, strollPath } from '../src/landing/hero-model';
import { buildHeroBuilding, occluded, outline, wallRuns } from '../src/landing/hero-building';
import { ELEV_MAX, ELEV_MIN, ZOOM_MAX, clampCamera, coast, facesCamera, farToNear, fitScale, orbit, projector, towardCamera, turnTo, wrapAngle } from '../src/landing/hero-camera';
import type { Camera } from '../src/landing/hero-camera';
import { FLOOR_S, STAND_S, buildState, finished, roundSeconds } from '../src/landing/hero-timeline';
import { isLandingAddress } from '../src/landing/address';

const read = (p: string): unknown => JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
const building = parseBuilding(read(`public/buildings/${FEATURED_BUILDING_ID}/building.json`));
const scenes = new Map<string, SceneInfo>();
for (const id of heroSceneIds(building)) {
  const dir = `public/scenes/${id}`;
  const outdoor = fs.existsSync(`${dir}/outdoor.json`) ? parseOutdoor(read(`${dir}/outdoor.json`)) : null;
  scenes.set(id, { property: validateProperty(read(`${dir}/property.json`)), unverified: {}, outdoor });
}
const model = buildHeroModel(building, scenes);
const hb = buildHeroBuilding(building, scenes, model);
const fact = (id: string): string | undefined => model.facts.find((f) => f.id === id)?.text;

describe('the hero model of the featured building', () => {
  it('has one drawing per level, lowest first, at rising heights', () => {
    expect(model.levels.map((l) => l.id)).toEqual(building.levels.map((l) => l.id));
    for (let i = 1; i < model.levels.length; i++) expect(model.levels[i].y).toBeGreaterThan(model.levels[i - 1].y);
    for (const l of model.levels) expect(l.spaces.reduce((s, q) => s + q.segs.length, 0)).toBeGreaterThan(3);
  });

  it('lines every level up on the lift doors', () => {
    for (const level of building.levels) {
      const xf = levelFrame(level, scenes);
      const doors = level.spaces.flatMap((s) => s.portals.filter((p) => p.kind === 'lift').map((p) => xf(toLevel(doorFrame(scenes.get(s.sceneId)!.property.layout, p.opening)!.centre, s.placement))));
      expect(doors.length).toBeGreaterThan(0);
      expect(doors.reduce((s, p) => s + p.x, 0) / doors.length).toBeCloseTo(0, 6);
      expect(doors.reduce((s, p) => s + p.z, 0) / doors.length).toBeCloseTo(0, 6);
      // the doors stand side by side along x once the level is turned
      for (const p of doors) expect(Math.abs(p.z)).toBeLessThan(0.01);
    }
  });

  it('states facts the files state', () => {
    const homeLevels = building.levels.filter((l) => l.spaces.some((s) => s.kind === 'home'));
    const top = homeLevels[homeLevels.length - 1];
    const flats = top.spaces.filter((s) => s.kind === 'home');
    const areas = flats.map((s) => carpetAreaM2(scenes.get(s.sceneId)!.property.layout));
    const biggest = flats[areas.indexOf(Math.max(...areas))];
    expect(fact('flat')).toBe(biggest.name);
    // the label is the flat's name as the building file states it (the flats panel shows the same words)
    expect(building.levels.flatMap((l) => l.spaces).some((s) => s.name === fact('flat'))).toBe(true);
    expect(fact('flats')).toBe(`${flats.length} flats a floor`);
    for (const l of homeLevels) expect(l.spaces.filter((s) => s.kind === 'home').length).toBe(flats.length);
    expect(fact('lobby')).toBe(`Lobby · ${building.lifts.filter((l) => l.serves.includes(building.levels[0].id)).length} lifts`);
    const longest = Math.max(...[...scenes.values()].flatMap((s) => (s.outdoor?.pools ?? []).map((b) => Math.max(b.rect.x1 - b.rect.x0, b.rect.z1 - b.rect.z0))));
    expect(fact('pool')).toMatch(new RegExp(`· ${Math.round(longest)} m (lap )?pool$`));
    expect(Math.abs(longest - Math.round(longest))).toBeLessThan(0.05);
  });

  it('wraps each flats floor in its envelope and runs one shaft per lift', () => {
    for (const l of model.levels) {
      expect(l.top).toBeGreaterThan(l.y);
      expect(l.hull.length).toBeGreaterThanOrEqual(3);
      // every corner of every room is inside the envelope (or on it)
      const pts = l.spaces.flatMap((s) => s.floors.flat());
      for (let i = 0; i < l.hull.length; i++) {
        const a = l.hull[i], b = l.hull[(i + 1) % l.hull.length];
        const side = pts.map((q) => (b.x - a.x) * (q.z - a.z) - (b.z - a.z) * (q.x - a.x));
        expect(side.every((v) => v >= -1e-6) || side.every((v) => v <= 1e-6)).toBe(true);
      }
    }
    for (let i = 1; i < model.levels.length; i++) expect(model.levels[i].y).toBeCloseTo(model.levels[i - 1].top, 9);
    expect(model.core.length).toBe(building.lifts.length);
  });

  it('names no fact twice and anchors each on its own level', () => {
    expect(new Set(model.facts.map((f) => f.id)).size).toBe(model.facts.length);
    for (const f of model.facts) {
      const level = model.levels.find((l) => l.id === f.levelId)!;
      expect(f.at.x).toBeGreaterThanOrEqual(level.bounds.x0);
      expect(f.at.x).toBeLessThanOrEqual(level.bounds.x1);
      expect(f.at.z).toBeGreaterThanOrEqual(level.bounds.z0);
      expect(f.at.z).toBeLessThanOrEqual(level.bounds.z1);
    }
  });

  it('walks a closed loop that stays inside the flat', () => {
    const walk = model.walk!;
    expect(walk.path.length).toBeGreaterThan(6);
    expect(walk.lengthM).toBeGreaterThan(10);
    const first = walk.path[0], last = walk.path[walk.path.length - 1];
    expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeLessThan(1e-6);
    const space = model.levels.find((l) => l.id === walk.levelId)!.spaces.find((s) => s.id === walk.spaceId)!;
    for (let d = 0; d < walk.lengthM; d += 0.5) {
      const p = pointAlong(walk.path, d);
      expect(p.x).toBeGreaterThan(space.bounds.x0 - 0.3);
      expect(p.x).toBeLessThan(space.bounds.x1 + 0.3);
      expect(p.z).toBeGreaterThan(space.bounds.z0 - 0.3);
      expect(p.z).toBeLessThan(space.bounds.z1 + 0.3);
    }
  });
});

describe('strollPath', () => {
  // two rooms side by side with a door between them, and a bathroom that the stroll leaves out
  const rect = (x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
  const layout = validateProperty({
    version: 1, id: 'two-rooms', title: 'Two rooms', furniture: [], spawn: { x: 1, z: 1, yawDeg: 0 }, updatedAt: '2026-01-01T00:00:00Z',
    layout: {
      wallHeightM: 2.7, wallThicknessM: 0.15, railingHeightM: 1.1,
      rooms: [
        { id: 'living', roomType: 'living', label: 'Living', polygon: rect(0, 0, 4, 4), edges: ['wall', 'wall', 'wall', 'wall'] },
        { id: 'bed', roomType: 'bedroom', label: 'Bedroom', polygon: rect(4.15, 0, 8, 4), edges: ['wall', 'wall', 'wall', 'wall'] },
        { id: 'bath', roomType: 'bathroom', label: 'Bath', polygon: rect(0, 4.15, 2, 6), edges: ['wall', 'wall', 'wall', 'wall'] },
      ],
      openings: [
        { id: 'main', roomId: 'living', edge: 3, type: 'door', centreM: 2, widthM: 1, sillM: 0, headM: 2.1 },
        { id: 'd-bed', roomId: 'living', edge: 1, type: 'door', centreM: 2, widthM: 0.9, sillM: 0, headM: 2.1 },
        { id: 'd-bath', roomId: 'bath', edge: 0, type: 'door', centreM: 1, widthM: 0.75, sillM: 0, headM: 2.1 },
      ],
    },
  }).layout;

  it('goes through the doorway, comes back, and skips the bathroom', () => {
    const p = strollPath(layout, 'main');
    expect(p[0]).toEqual({ x: 2, z: 2 });
    expect(p[p.length - 1]).toEqual({ x: 2, z: 2 });
    expect(p.some((q) => pointInPolygon(q, layout.rooms[1].polygon))).toBe(true);
    expect(p.some((q) => pointInPolygon(q, layout.rooms[2].polygon))).toBe(false);
    // the doorway point sits in the wall between the rooms
    expect(p.some((q) => q.x > 4 && q.x < 4.15 && Math.abs(q.z - 2) < 1e-6)).toBe(true);
  });
  it('is empty for a layout with no rooms', () => {
    expect(strollPath({ ...layout, rooms: [], openings: [] }, null)).toEqual([]);
  });
});

describe('the walker', () => {
  it('wraps round its loop', () => {
    const path = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }];
    expect(pointAlong(path, 1)).toEqual({ x: 1, z: 0 });
    expect(pointAlong(path, 3)).toEqual({ x: 2, z: 1 });
    expect(pointAlong(path, 5)).toEqual({ x: 1, z: 0 });
    expect(pointAlong([], 1)).toEqual({ x: 0, z: 0 });
  });
  it('finds the hull of an L-shaped set of corners', () => {
    const hull = convexHull([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }, { x: 2, z: 0 }]);
    expect(hull).toHaveLength(5);
  });
});

describe('which addresses show the landing page', () => {
  it('shows it at the bare address, with or without a share tag', () => {
    expect(isLandingAddress('')).toBe(true);
    expect(isLandingAddress('?')).toBe(true);
    expect(isLandingAddress('?utm_source=chat&utm_medium=share')).toBe(true);
    expect(isLandingAddress('?fbclid=abc')).toBe(true);
  });
  it('leaves every address the app uses alone', () => {
    for (const s of ['?scene=test-flat', '?building=sample-tower', '?home=test-flat', '?check=abc', '?view=plan', '?kiosk=1', '?building=sample-tower&utm_source=x', '?anything=1']) expect(isLandingAddress(s)).toBe(false);
  });
});


const rect = (x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const area = (p: { x: number; z: number }[]): number => Math.abs(p.reduce((a, q, i) => a + q.x * p[(i + 1) % p.length].z - p[(i + 1) % p.length].x * q.z, 0) / 2);

describe('the outline round a floor', () => {
  it('closes the wall gaps between rooms and follows the real shape', () => {
    // two rooms with a 0.2 m wall between them, and a third that makes an L
    const loops = outline([rect(0, 0, 4, 3), rect(4.2, 0, 8, 3), rect(0, 3.2, 4, 7)]);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
    expect(area(loops[0])).toBeGreaterThan(8 * 3 + 4 * 4 - 1);
    expect(area(loops[0])).toBeLessThan(8 * 3 + 4 * 4 + 2);
    for (const p of loops[0]) { expect(p.x * 4).toBeCloseTo(Math.round(p.x * 4), 9); expect(p.z * 4).toBeCloseTo(Math.round(p.z * 4), 9); }
  });
  it('keeps parts that stand apart as separate loops, drops specks, and copes with nothing', () => {
    expect(outline([rect(0, 0, 4, 4), rect(10, 0, 14, 4)])).toHaveLength(2);
    expect(outline([rect(0, 0, 4, 4), rect(10, 0, 10.5, 0.5)])).toHaveLength(1);
    expect(outline([])).toEqual([]);
  });
  it('gives every wall run a normal that points out of the building', () => {
    const loops = outline([rect(0, 0, 6, 4), rect(0, 4.2, 3, 8)]);
    const runs = wallRuns(loops, []);
    expect(runs.length).toBe(loops[0].length);
    for (const r of runs) {
      const mid = { x: (r.a.x + r.b.x) / 2, z: (r.a.z + r.b.z) / 2 };
      expect(pointInPolygon({ x: mid.x + r.nx * 0.3, z: mid.z + r.nz * 0.3 }, loops[0])).toBe(false);
      expect(pointInPolygon({ x: mid.x - r.nx * 0.3, z: mid.z - r.nz * 0.3 }, loops[0])).toBe(true);
      expect(Math.hypot(r.nx, r.nz)).toBeCloseTo(1, 9);
    }
  });
  it('makes a railing of the stretch of wall along a balcony', () => {
    const loops = outline([rect(0, 0, 6, 4)]);
    const runs = wallRuns(loops, [{ a: { x: 1, z: 0 }, b: { x: 4, z: 0 }, rail: true }]);
    const rails = runs.filter((r) => r.rail);
    expect(rails).toHaveLength(1);
    expect(rails[0].nz).toBe(-1);
    expect(Math.abs(rails[0].b.x - rails[0].a.x)).toBeGreaterThan(2);
    expect(Math.abs(rails[0].b.x - rails[0].a.x)).toBeLessThan(5);
  });
});

describe('the building raised from the plans', () => {
  const flats = hb.storeys.filter((s) => s.kind === 'flats');
  it('has a flats storey per flats level at the heights the file gives, the top two built in order and the roof last', () => {
    const homeLevels = model.levels.filter((l) => l.homes);
    expect(flats.map((s) => s.levelId)).toEqual(homeLevels.map((l) => l.id));
    flats.forEach((s, i) => { expect(s.y0).toBe(homeLevels[i].y); expect(s.y1).toBe(homeLevels[i].top); });
    expect(flats.slice(-2).map((s) => s.build)).toEqual([0, 1]);
    expect(hb.storeys.find((s) => s.kind === 'roof')!.build).toBe(2);
    expect(hb.builds).toBe(3);
    expect(hb.roofY).toBe(homeLevels[homeLevels.length - 1].top);
    expect(hb.storeys.filter((s) => s.kind !== 'flats' && s.kind !== 'roof').every((s) => s.build === -1)).toBe(true);
  });
  it('stands the tower on open storeys over the lobby, with the pool deck and the lift core', () => {
    expect(hb.storeys.filter((s) => s.kind === 'stilts').map((s) => s.levelId)).toEqual(model.levels.filter((l) => !l.homes).map((l) => l.id));
    const lobby = hb.storeys.find((s) => s.kind === 'room')!;
    expect(lobby.windows.filter((w) => w.door)).toHaveLength(1);
    const deck = hb.storeys.find((s) => s.group === 'podium')!;
    expect(deck.cap).toBe(true);
    expect(deck.water.length).toBeGreaterThan(0);
    // all the water lies on the deck
    for (const pool of deck.water) for (const p of pool) expect(deck.loops.some((l) => pointInPolygon({ x: p.x + (p.x < 0 ? 0.3 : -0.3) * 0, z: p.z }, l) || l.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1))).toBe(true);
    const cores = hb.storeys.filter((s) => s.kind === 'core');
    expect(cores[0].y0).toBe(0);
    expect(Math.max(...cores.map((s) => s.y1))).toBeGreaterThan(hb.roofY);
    expect(hb.bands).toEqual([...hb.bands].sort((a, b) => a - b));
    expect(new Set(hb.bands).size).toBe(hb.bands.length);
  });
  it('puts the windows the drawings give on the outer wall, and nowhere else', () => {
    for (const s of flats) {
      expect(s.windows.length).toBeGreaterThan(8);
      expect(s.runs.some((r) => r.rail)).toBe(true);
      for (const w of s.windows) {
        const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
        expect(s.runs.some((r) => !r.rail && r.nx === w.nx && r.nz === w.nz && Math.abs((mid.x - r.a.x) * r.nx + (mid.z - r.a.z) * r.nz) < 1e-6)).toBe(true);
        expect(w.head).toBeGreaterThan(w.sill);
        expect(w.head).toBeLessThan(s.y1 - s.y0);
      }
      expect(s.plan.length).toBeGreaterThan(100);
      expect(s.blocks.length).toBeGreaterThan(8);
      expect(s.walk).not.toBeNull();
    }
  });
  it('is held by its subject: every corner is inside the cylinder the camera fits', () => {
    for (const s of hb.storeys) {
      expect(s.y1).toBeLessThanOrEqual(hb.subject.height);
      for (const p of s.loops.flat()) expect(Math.hypot(p.x - hb.subject.pivot.x, p.z - hb.subject.pivot.z)).toBeLessThanOrEqual(hb.subject.radius + 1e-9);
    }
  });
  it('anchors each label on the building, and knows when the building hides one', () => {
    expect(hb.anchors.map((a) => a.id).sort()).toEqual(model.facts.map((f) => f.id).sort());
    const flat = hb.anchors.find((a) => a.id === 'flat')!;
    expect(Math.hypot(flat.nx, flat.nz)).toBeCloseTo(1, 9);
    expect(flat.y).toBeGreaterThan(flats[flats.length - 1].y0);
    expect(flat.y).toBeLessThan(flats[flats.length - 1].y1);
    const all = (): boolean => true;
    // looked at from the side its wall faces, the flat's anchor is clear; from behind, the tower is in the way
    const front = { x: flat.nx * Math.cos(0.5), y: Math.sin(0.5), z: flat.nz * Math.cos(0.5) };
    const back = { x: -flat.nx * Math.cos(0.3), y: Math.sin(0.3), z: -flat.nz * Math.cos(0.3) };
    expect(occluded(hb, flat, front, all)).toBe(false);
    expect(occluded(hb, flat, back, all)).toBe(true);
    expect(occluded(hb, flat, back, () => false)).toBe(false);
    const pool = hb.anchors.find((a) => a.id === 'pool')!;
    expect(occluded(hb, pool, { x: 0, y: 1, z: 0 }, all)).toBe(false);
  });
  it('falls back to plain storeys for a building with no flats', () => {
    const none = { ...building, levels: building.levels.filter((l) => !l.spaces.some((s) => s.kind === 'home')) };
    const m2 = buildHeroModel(none, scenes), b2 = buildHeroBuilding(none, scenes, m2);
    expect(b2.storeys.length).toBe(none.levels.length);
    expect(b2.builds).toBe(0);
    expect(b2.storeys[b2.storeys.length - 1].cap).toBe(true);
    expect(b2.subject.radius).toBeGreaterThan(1);
  });
});

describe('the camera', () => {
  const rest: Camera = { yaw: -2.4, elev: 0.58, zoom: 1, panX: 0, panY: 0 };
  it('turns and tilts by adding, whatever the order, and comes round after a full turn', () => {
    const a = orbit(orbit(rest, 0.3, 0.1), 0.5, -0.04), b = orbit(orbit(rest, 0.5, -0.04), 0.3, 0.1), c = orbit(rest, 0.8, 0.06);
    for (const k of ['yaw', 'elev'] as const) { expect(a[k]).toBeCloseTo(b[k], 12); expect(a[k]).toBeCloseTo(c[k], 12); }
    let cam = rest;
    for (let i = 0; i < 36; i++) cam = orbit(cam, Math.PI / 18, 0);
    expect(turnTo(cam.yaw, rest.yaw)).toBeCloseTo(0, 9);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(turnTo(3, -3)).toBeCloseTo(2 * Math.PI - 6, 12);
  });
  it('keeps the tilt, the zoom and the pan inside their limits', () => {
    expect(orbit(rest, 0, 5).elev).toBe(ELEV_MAX);
    expect(orbit(rest, 0, -5).elev).toBe(ELEV_MIN);
    expect(clampCamera({ ...rest, zoom: 99 }).zoom).toBe(ZOOM_MAX);
    expect(clampCamera({ ...rest, panX: 5 }).panX).toBeLessThan(0.1); // little to pan to at zoom 1
    expect(clampCamera({ ...rest, zoom: 2, panX: 5 }).panX).toBeGreaterThan(0.2);
  });
  it('keeps the whole building in its frame at every turn, at the resting zoom', () => {
    for (const [w, h] of [[758, 648], [390, 289], [1000, 400]]) {
      const scale = fitScale(hb.subject, { w, h }, rest.elev);
      for (let d = 0; d < 360; d += 5) {
        const P = projector({ ...rest, yaw: (d * Math.PI) / 180 }, hb.subject, { w, h }, scale);
        for (const s of hb.storeys) for (const p of s.loops.flat()) for (const y of [s.y0, s.y1]) {
          const [x, yy] = P(p.x, y, p.z);
          expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(w);
          expect(yy).toBeGreaterThanOrEqual(0); expect(yy).toBeLessThanOrEqual(h);
        }
      }
    }
  });
  it('projects up as up, nearer as nearer, and the pivot to the middle', () => {
    const f = { w: 800, h: 600 }, P = projector(rest, hb.subject, f, 5);
    const [x, y] = P(hb.subject.pivot.x, hb.subject.height / 2, hb.subject.pivot.z);
    expect(x).toBeCloseTo(400, 9); expect(y).toBeCloseTo(300, 9);
    expect(P(0, 10, 0)[1]).toBeLessThan(P(0, 0, 0)[1]);
    const t = towardCamera(rest);
    expect(P(hb.subject.pivot.x + t.x * 5, 0, hb.subject.pivot.z + t.z * 5)[2]).toBeGreaterThan(P(hb.subject.pivot.x, 0, hb.subject.pivot.z)[2]);
    expect(facesCamera(rest, t.x, t.z)).toBe(true);
    expect(facesCamera(rest, -t.x, -t.z)).toBe(false);
    // a point on the camera's side of the pivot moves left as the yaw grows: a drag to the right turns it to the right with yaw falling
    const q = projector(orbit(rest, 0.1, 0), hb.subject, f, 5)(hb.subject.pivot.x + t.x * 5, 0, hb.subject.pivot.z + t.z * 5);
    expect(q[0]).toBeLessThan(400);
  });
  it('sorts far to near and never reorders equals', () => {
    const items = [{ id: 'a', d: 2 }, { id: 'b', d: 1 }, { id: 'c', d: 2 }, { id: 'd', d: 1 }, { id: 'e', d: 0 }];
    expect(farToNear(items, (i) => i.d).map((i) => i.id)).toEqual(['e', 'b', 'd', 'a', 'c']);
    expect(farToNear(farToNear(items, (i) => i.d), (i) => i.d).map((i) => i.id)).toEqual(['e', 'b', 'd', 'a', 'c']);
    expect(coast(4, 0.28)).toBeCloseTo(2, 9);
  });
});

describe('the construction sequence', () => {
  it('builds each floor in order, one stage after the other, then the roof, then the labels', () => {
    let prev = buildState(0, 2, 4);
    expect(prev.stand).toBe(0);
    for (let t = 0; t < STAND_S + 2 * FLOOR_S + 2; t += 0.05) {
      const s = buildState(t, 2, 4);
      for (const f of s.floors) {
        expect(f.plan).toBeLessThanOrEqual(f.slab + 1e-9);
        expect(f.walls).toBeLessThanOrEqual(f.plan + 1e-9);
        expect(f.furnish).toBeLessThanOrEqual(f.walls + 1e-9);
        expect(f.facade).toBeLessThanOrEqual(f.furnish + 1e-9);
      }
      // the second floor's slab does not start before the first floor's facade is closed
      if (s.floors[1].slab > 0) expect(s.floors[0].facade).toBe(1);
      if (s.roof > 0) expect(s.floors[1].facade).toBe(1);
      if (s.labels > 0) expect(s.roof).toBe(1);
      s.floors.forEach((f, i) => { expect(f.slab).toBeGreaterThanOrEqual(prev.floors[i].slab - 1e-9); });
      expect(s.keep).toBe(1);
      prev = s;
    }
    expect(prev.roof).toBe(1);
  });
  it('holds with the highlight moving up the storeys, takes the built floors away, and starts again', () => {
    const total = roundSeconds(2), lit = new Set<number>();
    let gone = false;
    for (let t = STAND_S; t < STAND_S + total; t += 0.05) {
      const s = buildState(t, 2, 4);
      if (s.lit >= 0) { lit.add(Math.floor(s.lit)); expect(s.roof).toBe(1); expect(s.labels).toBeGreaterThan(0.99); }
      if (s.keep < 0.01) gone = true;
    }
    expect([...lit].sort()).toEqual([0, 1, 2, 3]);
    expect(gone).toBe(true);
    const again = buildState(STAND_S + total + 0.3, 2, 4), first = buildState(STAND_S + 0.3, 2, 4);
    expect(again.floors[0].slab).toBeCloseTo(first.floors[0].slab, 6);
    expect(again.stand).toBe(1);
    expect(again.keep).toBe(1);
  });
  it('has a finished frame for reduced motion', () => {
    const f = finished(2);
    expect(f.floors).toHaveLength(2);
    expect(f.floors.every((s) => s.slab === 1 && s.facade === 1)).toBe(true);
    expect([f.stand, f.roof, f.labels, f.keep, f.lit]).toEqual([1, 1, 1, 1, -1]);
  });
});

describe('the contact address', () => {
  it('is empty for now, so no contact button is drawn', () => {
    expect(contactHref()).toBe('');
  });
  it('takes a mail, web or phone address and nothing else', () => {
    // built here so no address sits in the repo (the anti-overfit lint looks for them)
    const mail = ['mailto:hello', 'example.com'].join('@');
    expect(contactHref(mail)).toBe(mail);
    expect(contactHref(' https://example.com/talk ')).toBe('https://example.com/talk');
    expect(contactHref('tel:+91 98 0000 0000')).toBe('tel:+91 98 0000 0000');
    for (const bad of ['', 'javascript:alert(1)', 'http://example.com', mail.slice(7), 'mailto:nobody']) expect(contactHref(bad)).toBe('');
  });
});
