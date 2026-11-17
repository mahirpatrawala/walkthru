// Loose furniture and decor never shut a room away (owner, 17 Nov 2026: the balcony of a flat was effectively unreachable, two chairs left 0.45 m at its
// sliding door). Every gallery home and every tower flat: each room the empty home reaches (balconies, decks and utility rooms included) is still reachable
// from the entrance with a body 0.30 m clear on all sides, and every door keeps a clear strip through it. Only movable pieces are held to it
// (src/building/clear-routes.ts): where a bed or a WC alone shuts a room, that is the drawing's.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLEAR_RADIUS_M, clearRoutes, isMovable, routeReport } from '../src/building/clear-routes';
import { planLivedIn, pieceBox } from '../src/look/lived-in';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import type { FurnitureItem } from '../src/types';
import { readScene } from './helpers/sample-building';

const ROOT = path.resolve(import.meta.dirname, '..');
const ids = fs.readdirSync(path.join(ROOT, 'public/scenes')).filter((d) => fs.existsSync(path.join(ROOT, 'public/scenes', d, 'property.json')));

describe(`every room of every home stays reachable with ${CLEAR_RADIUS_M} m clear, and every door keeps its strip`, () => {
  for (const id of ids) {
    const scene = readScene(id);
    if (!scene) continue;
    it(id, () => {
      const rep = routeReport(scene.layout, scene.furniture, scene.spawn);
      expect(rep.shut, 'rooms the loose furniture shuts away').toEqual([]);
      expect(rep.blockedDoors, 'doors whose clear strip a piece blocks').toEqual([]);
    });
  }
});

describe('the lived-in decor leaves every route clear too', () => {
  for (const id of ids) {
    const scene = readScene(id);
    if (!scene || (scene.spaceKind && scene.spaceKind !== 'home')) continue;
    it(id, () => {
      const real = scene.furniture.filter((i) => i.source === 'real');
      const grid = stampFurniture(rasterizeLayout(scene.layout), scene.furniture);
      const floor = planLivedIn({ layout: scene.layout, items: real, grid }).filter((p) => p.place === 'floor' && p.kind !== 'rug');
      // a decor piece stands on the floor like a planter: stamp each as one
      const pieces: FurnitureItem[] = floor.map((p) => ({ id: p.id, source: 'real', kind: 'counter', catalogId: 'planter-pot', label: p.kind, box: pieceBox(p), heightM: p.height, surfaceHeightM: p.height }));
      const rep = routeReport(scene.layout, [...scene.furniture, ...pieces], scene.spawn);
      expect(rep.shut, 'rooms the decor shuts away').toEqual([]);
      expect(rep.blockedDoors, 'doors the decor blocks').toEqual([]);
    });
  }
});

describe('the clearing pass', () => {
  it('moves only movable pieces, never far, and leaves a clear home alone', () => {
    const s = readScene('test-tower-flat-3bhk-a')!;
    const out = clearRoutes(s.layout, s.furniture, s.spawn);
    expect(out.moved).toEqual([]);
    expect(out.left.shut).toEqual([]);
    expect(s.furniture.some(isMovable)).toBe(true);
  });
  it('slides a chair that shuts a balcony door aside (a balcony 1.4 m deep, a chair in front of its door)', () => {
    const s = readScene('test-tower-flat-3bhk-a')!;
    const chair = s.furniture.find((f) => f.id === 'chair-balcony-2')!;
    const blocked = s.furniture.map((f) => (f.id === chair.id ? { ...f, box: { ...f.box, cx: 1.95, cz: 11.35 } } : f.id === 'chair-balcony-1' ? { ...f, box: { ...f.box, cx: 1.25, cz: 11.35 } } : f));
    expect(routeReport(s.layout, blocked, s.spawn).shut.length + routeReport(s.layout, blocked, s.spawn).blockedDoors.length).toBeGreaterThan(0);
    const out = clearRoutes(s.layout, blocked, s.spawn);
    expect(out.left.shut).toEqual([]);
    expect(out.left.blockedDoors).toEqual([]);
    expect(out.moved.length).toBeGreaterThan(0);
    for (const m of out.moved) expect(Math.hypot(m.dx, m.dz)).toBeLessThanOrEqual(1.11);
    // nothing but movable pieces moved
    const was = new Map(blocked.map((f) => [f.id, f.box]));
    for (const f of out.furniture) if (!isMovable(f)) expect(f.box).toEqual(was.get(f.id));
  });
});
