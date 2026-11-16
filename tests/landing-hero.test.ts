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
import { FEATURED_BUILDING_ID } from '../src/landing/config';
import { buildHeroModel, convexHull, fitView, heroSceneIds, levelFrame, pointAlong, project, strollPath } from '../src/landing/hero-model';
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

describe('the view', () => {
  it('projects straight down the page for height and keeps the focus in the box', () => {
    const v = fitView(model, 800, 600, -0.6, 0.6, 2, 40);
    const [, y0] = project(v, 0, 0, 0);
    const [, y1] = project(v, 0, 3, 0);
    expect(y1).toBeLessThan(y0);
    for (const f of model.focus) {
      const level = model.levels.find((l) => l.id === f.levelId)!;
      for (const [x, z] of [[f.bounds.x0, f.bounds.z0], [f.bounds.x1, f.bounds.z1], [f.bounds.x0, f.bounds.z1], [f.bounds.x1, f.bounds.z0]]) {
        const [sx, sy] = project(v, x, level.y, z);
        expect(sx).toBeGreaterThanOrEqual(40 - 1e-6);
        expect(sx).toBeLessThanOrEqual(760 + 1e-6);
        expect(sy).toBeGreaterThanOrEqual(40 - 1e-6);
        expect(sy).toBeLessThanOrEqual(560 + 1e-6);
      }
    }
  });
  it('finds the hull of an L-shaped set of corners', () => {
    const hull = convexHull([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }, { x: 2, z: 0 }]);
    expect(hull).toHaveLength(5);
    expect(hull.some((p) => p.x === 2 && p.z === 2)).toBe(false);
    expect(hull.some((p) => p.x === 2 && p.z === 0)).toBe(false);
  });
  it('wraps the walker round its loop', () => {
    const path = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }];
    expect(pointAlong(path, 1)).toEqual({ x: 1, z: 0 });
    expect(pointAlong(path, 3)).toEqual({ x: 2, z: 1 });
    expect(pointAlong(path, 5)).toEqual({ x: 1, z: 0 });
    expect(pointAlong([], 1)).toEqual({ x: 0, z: 0 });
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
