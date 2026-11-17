// The made-up sample homes' living rooms read as arranged rooms (scripts/furnish-living.ts, SPEC 16.25): a sofa on a wall, a TV unit on the opposite wall, a centre table between them,
// a fridge in the kitchen, every route and door run clear, no door opening less far than before. Idempotent.
import { describe, expect, it } from 'vitest';
import { routeReport } from '../src/building/clear-routes';
import { freePos, resolveDoors } from '../src/core/doors';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { pointInPolygon } from '../src/core/geometry';
import { furnishKitchen, furnishLiving } from '../scripts/furnish-living';
import { readScene } from './helpers/sample-building';

const SAMPLES = [1, 2, 3, 4, 5].map((n) => `test-sample-${n}`);

describe('the sample homes have a furnished living room', () => {
  for (const id of SAMPLES) {
    it(id, () => {
      const s = readScene(id)!;
      const sofa = s.furniture.find((f) => f.id === 'sofa-1')!;
      const tv = s.furniture.find((f) => f.id === 'dress-tv')!;
      const table = s.furniture.find((f) => f.id === 'dress-table-centre')!;
      expect(tv, 'a TV unit').toBeTruthy();
      expect(table, 'a centre table').toBeTruthy();
      expect(tv.catalogId).toMatch(/^tv-unit/);
      // the sofa and the TV face each other across the room, at least 2.6 m apart, the table between
      const fwd = (b: { yawDeg: number }) => ({ x: Math.sin((b.yawDeg * Math.PI) / 180), z: Math.cos((b.yawDeg * Math.PI) / 180) });
      const a = fwd(sofa.box), b = fwd(tv.box);
      expect(a.x * b.x + a.z * b.z).toBeLessThan(-0.98);
      const d = { x: tv.box.cx - sofa.box.cx, z: tv.box.cz - sofa.box.cz };
      expect(d.x * a.x + d.z * a.z, 'the TV is in front of the sofa').toBeGreaterThan(2.6);
      const t = { x: table.box.cx - sofa.box.cx, z: table.box.cz - sofa.box.cz };
      const along = t.x * a.x + t.z * a.z;
      expect(along).toBeGreaterThan(0.6);
      expect(along).toBeLessThan(d.x * a.x + d.z * a.z);
      // all inside the living room, a fridge in the kitchen, routes clear
      const living = s.layout.rooms.find((r) => r.roomType === 'living' && pointInPolygon({ x: sofa.box.cx, z: sofa.box.cz }, r.polygon))!;
      for (const it of [sofa, tv, table]) expect(pointInPolygon({ x: it.box.cx, z: it.box.cz }, living.polygon)).toBe(true);
      const kitchen = s.layout.rooms.find((r) => r.roomType === 'kitchen')!;
      expect(s.furniture.some((f) => /fridge/.test(f.catalogId ?? '') && pointInPolygon({ x: f.box.cx, z: f.box.cz }, kitchen.polygon))).toBe(true);
      const rep = routeReport(s.layout, s.furniture, s.spawn);
      expect(rep.shut).toEqual([]);
      expect(rep.blockedDoors).toEqual([]);
      // no hinged door is stopped short by the dressing
      const grid = stampFurniture(rasterizeLayout(s.layout), s.furniture);
      const bare = stampFurniture(rasterizeLayout(s.layout), s.furniture.filter((f) => !f.id.startsWith('dress-')));
      for (const door of resolveDoors(s.layout).filter((x) => x.kind === 'hinged')) expect(freePos(grid, door, 0).pos, door.id).toBeGreaterThanOrEqual(Math.min(freePos(bare, door, 0).pos, 0.9 * door.maxPos) - 1e-6);
    });
    it(`${id}: running the pass again changes nothing`, () => {
      const s = readScene(id)!;
      const again = furnishKitchen(s.layout, furnishLiving(s.layout, s.furniture, s.spawn), s.spawn);
      const key = (list: typeof s.furniture) => list.filter((f) => f.id.startsWith('dress-') || f.id === 'sofa-1').map((f) => [f.id, Math.round(f.box.cx * 100), Math.round(f.box.cz * 100), Math.round(f.box.yawDeg)]).sort().join('|');
      expect(key(again)).toBe(key(s.furniture));
    }, 60000);
  }
});
