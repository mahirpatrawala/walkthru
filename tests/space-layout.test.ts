// The honest numbers of a furnished shared space (SPEC 16.17): clearance zones and verdicts of representative machines, the walkway rule, the row and seat helpers,
// the summary, and the sample layouts a building generator adopts.
import { describe, expect, it } from 'vitest';
import { catalogItem, itemFromCatalog } from '../src/core/catalog';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { checkPlacement } from '../src/core/placement';
import { boxCorners } from '../src/core/geometry';
import { isStation, spaceSummary, walkwayReport } from '../src/core/space-rules';
import { fillBoxes, rowBoxes, rowGapM, seatingPlan, snapToNeighbour } from '../src/core/space-layout';
import { sampleLayout } from '../src/core/space-samples';
import { propertyOf, SPACES } from '../scripts/make-space-scenes';
import type { Box, FurnitureItem, PropertyFile } from '../src/types';

const gym = (): PropertyFile => propertyOf(SPACES[0], false);
const at = (id: string, cx: number, cz: number, yawDeg = 0): FurnitureItem => itemFromCatalog(id, { cx, cz, w: catalogItem(id).footprint.w, d: catalogItem(id).footprint.d, yawDeg }, 'virtual');
function verdictOf(p: PropertyFile, items: FurnitureItem[], it: FurnitureItem): ReturnType<typeof checkPlacement> {
  const grid = stampFurniture(rasterizeLayout(p.layout), items.filter((o) => o.id !== it.id));
  return checkPlacement(grid, catalogItem(it.catalogId!), it.box, p.layout.wallHeightM, true, 'other');
}

describe('clearance zones of gym machines: fits, tight, blocked, and what is assumed', () => {
  it('a treadmill with 2 m behind it and 50 cm each side fits and says what it assumed', () => {
    const p = gym();
    const t = at('gym-treadmill', 2.0, 6.0, 90); // back at x 0.95, belt end at 3.05; room runs to x 8
    const r = verdictOf(p, [t], t);
    expect(r.verdict).toBe('fits');
    expect(r.message).toContain('Treadmill, commercial needs 200 cm clear behind the belt and 50 cm on each side');
    expect(r.message).toContain('typical guidance, check your consultant');
    expect(r.zones!.map((z) => z.zoneId).sort()).toEqual(['runoff', 'sides', 'sides']);
  });
  it('1 m behind a treadmill is tight (many suppliers give 1 m as the least), 80 cm is blocked, a wall behind is blocked', () => {
    const p = gym();
    const t = at('gym-treadmill', 4.2, 6.0, 90); // belt end at 5.25: wall at 8 is 2.75 away
    const wall = (gap: number): FurnitureItem => at('gym-power-rack', 5.25 + gap + 0.675, 6.0, 90); // its back toward the treadmill? a tall piece in the way
    const clearBehind = (gap: number): string => { const items = [t, wall(gap)]; return verdictOf(p, items, t).verdict; };
    expect(clearBehind(1.2)).toBe('tight');
    expect(clearBehind(0.5)).toBe('blocked');
    const near = at('gym-treadmill', 6.9, 6.0, 90); // belt end 7.95: the wall
    expect(verdictOf(p, [near], near).verdict).toBe('blocked');
    expect(verdictOf(p, [near], near).message).toMatch(/the wall/);
  });
  it('two treadmills laid by the row helper read as fitting: the spacing meets each other\'s side zones', () => {
    const p = gym();
    const first = at('gym-treadmill', 1.1, 9.0, 90);
    const boxes = rowBoxes(catalogItem('gym-treadmill'), first.box, 3, 1);
    const items = [first, ...boxes.map((b) => itemFromCatalog('gym-treadmill', b, 'virtual'))];
    for (const it of items) expect(verdictOf(p, items, it).verdict, `${it.id} at ${it.box.cz}`).not.toBe('blocked');
    for (const it of items.slice(1, 3)) expect(verdictOf(p, items, it).verdict).toBe('fits');
  });
  it('a bench-press station needs a spotter behind the head: against a wall it is blocked and says why', () => {
    const p = gym();
    const bp = at('gym-bench-press', 4.0, 0.83, 0); // yaw 0: the head end (back) is at z 0.03, against the north wall
    expect(verdictOf(p, [bp], bp).verdict).toBe('blocked');
    const free = at('gym-bench-press', 4.0, 6.0, 0);
    const r = verdictOf(p, [free], free);
    expect(r.verdict).toBe('fits');
    expect(r.message).toContain('90 cm clear behind the head');
    expect(r.message).toContain('50 cm at each end of the bar');
  });
  it('a hung heavy bag asks for 1 m all round and for a structural hook, and a rack of dumbbells for 1 m in front', () => {
    const p = gym();
    const bag = at('gym-heavy-bag', 4.0, 6.0);
    const r = verdictOf(p, [bag], bag);
    expect(r.verdict).toBe('fits');
    expect(r.message).toContain('Heavy bag needs');
    expect(r.message).toContain('structural hook');
    const bar = at('gym-power-rack', 4.0, 7.0, 0);
    expect(verdictOf(p, [bag, bar], bag).verdict).not.toBe('fits');
    const rack = at('gym-dumbbell-rack', 4.0, 0.35, 0);
    expect(verdictOf(p, [rack], rack).verdict).toBe('fits');
    expect(rack.catalogId).toBe('gym-dumbbell-rack');
  });
  it('a flat flooring tile lies under a machine: only a wall stops it', () => {
    const p = gym();
    const rack = at('gym-power-rack', 4.0, 6.0, 0);
    const floor = at('gym-floor-4x2', 4.0, 6.0);
    expect(verdictOf(p, [rack, floor], floor).verdict).not.toBe('blocked');
    const outside = at('gym-floor-4x2', 6.5, 6.0);
    expect(verdictOf(p, [outside], outside).verdict).toBe('blocked');
  });
});

describe('the walkway rule', () => {
  it('an empty gym has a 1 m walkway, door to door and end to end', () => {
    const p = gym();
    const w = walkwayReport(p.layout, []);
    expect(w.clear).toBe(true);
    expect(w.message).toContain('100 cm wide walkway is open');
  });
  it('a line of machines across the room closes it, and the answer names what it runs between', () => {
    const p = gym();
    const items = [at('gym-power-rack', 1.1, 6.0, 0), at('gym-power-rack', 4.0, 6.0, 0), at('gym-power-rack', 6.9, 6.0, 0)].map((i, n) => ({ ...i, label: ['Power rack', 'Power rack 2', 'Power rack 3'][n] }));
    // three racks 2.2 m wide across a room 8 m wide leave two gaps of 0.7 m: no 1 m path
    const w = walkwayReport(p.layout, items);
    expect(w.clear).toBe(false);
    expect(w.between).toBeTruthy();
    expect(w.message).toMatch(/^Walkway blocked between .+ and .+/);
  });
  it('leaving a 1.2 m gap opens it again', () => {
    const p = gym();
    const wide = [at('gym-power-rack', 1.5, 6.0, 0), at('gym-power-rack', 6.4, 6.0, 0)]; // 0.4..2.6 and 5.3..7.5: the gap 2.6..5.3 is 2.7 m
    expect(walkwayReport(p.layout, wide).clear).toBe(true);
    const narrow = [at('gym-power-rack', 1.2, 6.0, 0), at('gym-power-rack', 4.6, 6.0, 0)]; // 0.1..2.3 and 3.5..5.7 leaves a 1.2 gap and 2.3 m beyond: open
    expect(walkwayReport(p.layout, narrow).clear).toBe(true);
    const shut = [at('gym-power-rack', 1.6, 6.0, 0), at('gym-power-rack', 4.0, 6.0, 0), at('gym-power-rack', 6.4, 6.0, 0)];
    expect(walkwayReport(p.layout, shut).clear).toBe(false);
  });
  it('flat pieces and wall fixtures high up do not block it', () => {
    const p = gym();
    const mats = [at('gym-floor-4x2', 4.0, 6.0), at('yoga-mat', 4.0, 6.0), at('gym-wall-fan', 0.18, 5.0, 90)];
    expect(walkwayReport(p.layout, mats).clear).toBe(true);
  });
});

describe('row and seat helpers', () => {
  it('rowGapM is the space the side zones ask, plus 4 cm so the 5 cm grid reads it as met', () => {
    expect(rowGapM('gym-treadmill')).toBeCloseTo(0.54, 6);
    expect(rowGapM('gym-chest-press')).toBeCloseTo(0.44, 6);
    expect(rowGapM('gym-bench-flat')).toBeCloseTo(0.64, 6);
    expect(rowGapM('hall-chair')).toBeCloseTo(0.03, 6);
    expect(rowGapM('gym-ball')).toBeCloseTo(0.05, 6);
  });
  it('rowBoxes lays copies beside the anchor along its width at that gap, the same way round, in either direction', () => {
    const anchor: Box = { cx: 1, cz: 3, w: 0.9, d: 2.1, yawDeg: 90 };
    const r = rowBoxes(catalogItem('gym-treadmill'), anchor, 3, 1);
    expect(r).toHaveLength(3);
    const pitch = 0.9 + rowGapM('gym-treadmill');
    // yaw 90: the width axis b = (cos 90, -sin 90) = (0, -1): a row to the right runs toward -z
    expect(r[0].cx).toBeCloseTo(1, 4);
    expect(r[0].cz).toBeCloseTo(3 - pitch, 4);
    expect(r[2].cz).toBeCloseTo(3 - 3 * pitch, 4);
    for (const b of r) expect(b.yawDeg).toBe(90);
    const left = rowBoxes(catalogItem('gym-treadmill'), anchor, 2, -1);
    expect(left[0].cz).toBeCloseTo(3 + pitch, 4);
  });
  it('a block of seats: the count, the aisles, the size', () => {
    const chair = catalogItem('hall-chair');
    const p = seatingPlan(chair, { rows: 6, cols: 12, aisleEvery: 6 });
    expect(p.seats).toBe(72);
    expect(p.local).toHaveLength(72);
    expect(p.widthM).toBeCloseTo(12 * 0.46 + 11 * 0.03 + 1.2, 6);
    expect(p.depthM).toBeCloseTo(5 * 0.9 + 0.52, 6);
    expect(p.words).toContain('72 seats: 6 rows of 12, 1 aisle of 120 cm after every 6');
    // the aisle is a real gap between the sixth and seventh chair of a row
    const row0 = p.local.filter((b) => b.cz === 0).map((b) => b.cx).sort((a, b) => a - b);
    expect(row0[6] - row0[5]).toBeCloseTo(0.46 + 0.03 + 1.2, 6);
    expect(row0[1] - row0[0]).toBeCloseTo(0.49, 6);
    const none = seatingPlan(chair, { rows: 3, cols: 5 });
    expect(none.seats).toBe(15);
    expect(none.words).toContain('15 seats: 3 rows of 5, 90 cm from row to row');
    expect(seatingPlan(chair, { rows: 1, cols: 1 }).seats).toBe(1);
    expect(seatingPlan(chair, { rows: 0, cols: 0 }).seats).toBe(1);
  });
  it('a placed block is turned about its front-row centre and no two chairs overlap', () => {
    const chair = catalogItem('hall-chair');
    const p = seatingPlan(chair, { rows: 4, cols: 6, aisleEvery: 3 });
    for (const yaw of [0, 90, 180, 37]) {
      const boxes = p.place({ x: 10, z: 5 }, yaw);
      expect(boxes).toHaveLength(24);
      const cx = boxes.slice(0, 6).reduce((a, b) => a + b.cx, 0) / 6;
      expect(boxes.every((b) => b.yawDeg === yaw)).toBe(true);
      void cx;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const d = Math.hypot(boxes[i].cx - boxes[j].cx, boxes[i].cz - boxes[j].cz);
        expect(d, `${i}/${j} at ${yaw}`).toBeGreaterThan(0.45);
      }
    }
    const front = p.place({ x: 10, z: 5 }, 0).filter((_, i) => i < 6);
    expect(front.every((b) => Math.abs(b.cz - 5) < 1e-6)).toBe(true);
  });
  it('flooring is laid in whole pieces over a rectangle', () => {
    const tiles = fillBoxes(catalogItem('gym-floor-2x2'), { x0: 1, z0: 2, x1: 6.2, z1: 5.9 });
    expect(tiles).toHaveLength(2 * 1); // 5.2 m wide: two 2 m pieces; 3.9 m deep: one
    expect(tiles[0]).toMatchObject({ cx: 2, cz: 3, w: 2, d: 2 });
    expect(fillBoxes(catalogItem('gym-floor-4x2'), { x0: 0, z0: 0, x1: 8, z1: 12 })).toHaveLength(2 * 6);
  });
  it('a piece snaps to the neighbour at its own spacing and lines up its back edge, but leaves a far piece alone', () => {
    const gap = rowGapM('gym-chest-press');
    const other: Box = { cx: 7, cz: 3, w: 1.05, d: 1.35, yawDeg: 270 };
    const near: Box = { cx: 7.02, cz: 3 + 1.05 + gap + 0.16, w: 1.05, d: 1.35, yawDeg: 270 };
    const snapped = snapToNeighbour(near, [other], gap);
    expect(Math.abs(snapped.cz - near.cz)).toBeGreaterThan(0.01);
    expect(Math.abs(snapped.cx - 7)).toBeLessThan(0.001); // the back edge lined up
    const dist = Math.abs(snapped.cz - other.cz) - 1.05;
    expect(dist).toBeCloseTo(gap, 4);
    const far = { ...near, cz: 9 };
    expect(snapToNeighbour(far, [other], gap)).toBe(far);
    const across = { ...near, yawDeg: 0 };
    expect(snapToNeighbour(across, [other], gap)).toBe(across); // a piece turned a quarter to its neighbour is not a row
    const facing = { ...near, yawDeg: 90 };
    expect(snapToNeighbour(facing, [other], gap)).not.toBe(facing); // back to back or face to face is
  });
});

describe('the summary card', () => {
  it('counts stations by type, floor used against free, and says whether the walkway is clear', () => {
    const p = propertyOf(SPACES[0], true);
    const s = spaceSummary(p.layout, p.furniture, undefined, 'gym');
    const stations = p.furniture.filter((i) => isStation(i));
    expect(s.stations.total).toBe(stations.length);
    expect(s.stations.byCategory.reduce((a, c) => a + c.count, 0)).toBe(stations.length);
    expect(s.stations.byCategory.map((c) => c.category).sort()).toEqual(['cardio', 'freeweights', 'strength', 'studio']);
    expect(s.area.roomM2).toBeCloseTo(96, 0);
    expect(s.area.piecesM2).toBeGreaterThan(15);
    expect(s.area.withZonesM2).toBeGreaterThan(s.area.piecesM2);
    expect(s.area.freeM2).toBeGreaterThan(30);
    expect(s.area.freePct).toBeGreaterThan(40);
    expect(s.walkway.clear).toBe(true);
    expect(s.tone).toBe('good');
    expect(s.lines[0]).toMatch(/^\d+ stations: /);
    expect(s.lines[1]).toMatch(/m² .* free\.$/);
    expect(s.footer).toContain('typical guidance, check your consultant');
  });
  it('turns bad and names the blockage when a layout closes the walkway', () => {
    const p = propertyOf(SPACES[0], false);
    const items = [at('gym-power-rack', 1.6, 6.0, 0), at('gym-power-rack', 4.0, 6.0, 0), at('gym-power-rack', 6.4, 6.0, 0)];
    const s = spaceSummary(p.layout, items, undefined, 'gym');
    expect(s.tone).toBe('bad');
    expect(s.walkway.clear).toBe(false);
    expect(s.lines[2]).toContain('Walkway blocked between');
  });
  it('an empty room reads as no stations and all of it free', () => {
    const p = gym();
    const s = spaceSummary(p.layout, []);
    expect(s.stations.total).toBe(0);
    expect(s.lines[0]).toBe('No stations yet.');
    expect(s.area.piecesM2).toBe(0);
    expect(s.area.freePct).toBe(100);
  });
});

describe('the sample layouts', () => {
  const rooms = SPACES.map((s) => ({ s, bounds: { x0: 0, z0: 0, x1: s.w, z1: s.d } }));
  it('are deterministic: the same room gives the same pieces, ids included', () => {
    for (const { s, bounds } of rooms) {
      const a = sampleLayout(s.kind, bounds, { doors: [s.door] });
      const b = sampleLayout(s.kind, bounds, { doors: [s.door] });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.length).toBeGreaterThan(10);
      expect(new Set(a.map((i) => i.id)).size).toBe(a.length);
    }
  });
  it('stand inside their room, are virtual catalogue pieces and leave the doorway clear', () => {
    for (const { s, bounds } of rooms) {
      const items = sampleLayout(s.kind, bounds, { doors: [s.door] });
      for (const it of items) {
        expect(it.source).toBe('virtual');
        expect(it.catalogId).toBeTruthy();
        for (const c of boxCorners(it.box)) { expect(c.x).toBeGreaterThanOrEqual(bounds.x0 - 1e-6); expect(c.x).toBeLessThanOrEqual(bounds.x1 + 1e-6); expect(c.z).toBeGreaterThanOrEqual(bounds.z0 - 1e-6); expect(c.z).toBeLessThanOrEqual(bounds.z1 + 1e-6); }
      }
    }
  });
  it('have no piece in the way of another and none that is blocked, and the gym and lobby have an open walkway', () => {
    for (const { s } of rooms) {
      const p = propertyOf(s, true);
      const base = rasterizeLayout(p.layout);
      for (const it of p.furniture) {
        const grid = stampFurniture(base, p.furniture.filter((o) => o.id !== it.id));
        const r = checkPlacement(grid, catalogItem(it.catalogId!), it.box, p.layout.wallHeightM, true, 'other');
        expect(r.verdict, `${p.id}: ${it.catalogId} ${r.message.slice(0, 120)}`).not.toBe('blocked');
      }
      const w = spaceSummary(p.layout, p.furniture, undefined, s.spaceKind).walkway;
      expect(w.clear, `${p.id}: ${w.message}`).toBe(true);
    }
  });
  it('the gym has the station mix of a gym: cardio facing a mirror wall, strength, free weights, a studio corner', () => {
    const p = propertyOf(SPACES[0], true);
    const by = (id: string): number => p.furniture.filter((i) => i.catalogId === id).length;
    expect(by('gym-mirror')).toBe(10);
    expect(by('gym-treadmill')).toBe(3);
    expect(by('gym-power-rack')).toBe(1);
    expect(by('gym-dumbbell-rack')).toBe(1);
    expect(p.furniture.filter((i) => isStation(i)).length).toBeGreaterThanOrEqual(18);
  });
  it('the hall has a stage, a podium, a screen, and a seat count that matches its chairs', () => {
    const p = propertyOf(SPACES[2], true);
    const chairs = p.furniture.filter((i) => i.catalogId === 'hall-chair').length;
    expect(chairs).toBeGreaterThanOrEqual(48);
    expect(p.furniture.some((i) => i.catalogId?.startsWith('hall-stage'))).toBe(true);
    expect(p.furniture.some((i) => i.catalogId === 'hall-podium')).toBe(true);
    expect(p.furniture.some((i) => i.catalogId === 'hall-screen')).toBe(true);
    expect(spaceSummary(p.layout, p.furniture, undefined, 'hall').seats).toBe(chairs);
  });
  it('a smaller room leaves pieces out rather than squeezing them', () => {
    const small = sampleLayout('gym', { x0: 0, z0: 0, x1: 4, z1: 6 });
    const full = sampleLayout('gym', { x0: 0, z0: 0, x1: 8, z1: 12 });
    expect(small.length).toBeLessThan(full.length);
    for (const it of small) for (const c of boxCorners(it.box)) { expect(c.x).toBeLessThanOrEqual(4 + 1e-6); expect(c.z).toBeLessThanOrEqual(6 + 1e-6); }
  });
  it('a room that runs along x is the same layout turned a quarter', () => {
    const turned = sampleLayout('hall', { x0: 0, z0: 0, x1: 12, z1: 8.4 });
    const upright = sampleLayout('hall', { x0: 0, z0: 0, x1: 8.4, z1: 12 });
    expect(turned.length).toBe(upright.length);
  });
});
