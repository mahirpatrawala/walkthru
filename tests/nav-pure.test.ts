// The pure parts of the navigation aids: grid paths, the door a route goes through, the chip model, the minimap's geometry and the tour order.
import { describe, expect, it } from 'vitest';
import { CHARACTER_RADIUS_M, DEFAULT_FINISHES } from '../src/types';
import type { Layout, Opening, RoomTag } from '../src/types';
import { circleFree } from '../src/core/grid-query';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { resolveDoors } from '../src/core/doors';
import { findRoute, lineFree, routeLength, routesFrom, PLAN_RADIUS_TIGHT_M } from '../src/buyer/nav/grid-path';
import { crossesDoorway, cutRoute, firstCrossing, planGridOf, pointAlong, standOffM } from '../src/buyer/nav/door-route';
import { chipCaption, conePath, goDecision, liftAbove, roomChips, roomNear } from '../src/buyer/nav/nav-model';
import { ORDER_PENALTY_M, pickNext, roomKind, skippedNote, tourStops } from '../src/buyer/nav/tour-plan';
import type { TourStop } from '../src/buyer/nav/tour-plan';

function rect(id: string, x0: number, z0: number, x1: number, z1: number, type: RoomTag['roomType'] = 'bedroom', label = id): RoomTag {
  return { id, roomType: type, label, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'] };
}
const layoutOf = (rooms: RoomTag[], openings: Opening[] = []): Layout => ({ wallHeightM: 2.75, wallThicknessM: 0.12, railingHeightM: 1.1, rooms, openings, finishes: DEFAULT_FINISHES, scaleSource: 'typed-sizes' });

/** Two 4 x 4 rooms side by side, a 0.9 m door in the wall between them (x = 4, z 1.55..2.45) */
function twoRooms() {
  const a = rect('a', 0, 0, 4, 4, 'living', 'Living'), b = rect('b', 4.12, 0, 8.12, 4, 'bedroom', 'Bedroom');
  const door: Opening = { id: 'd1', roomId: 'a', edge: 1, type: 'door', centreM: 2, widthM: 0.9, sillM: 0, headM: 2.1, leaf: { hinge: 'start', swing: 'in', kind: 'hinged' } };
  return layoutOf([a, b], [door]);
}

describe('grid paths', () => {
  it('finds a route through a doorway, clear of the walls, and none through a wall', () => {
    const lay = twoRooms();
    const g = rasterizeLayout(lay);
    const route = findRoute(g, { x: 1, z: 2 }, { x: 7, z: 2 });
    expect(route).not.toBeNull();
    const r = route!;
    expect(r.points[0]).toEqual({ x: 1, z: 2 });
    expect(r.points[r.points.length - 1]).toEqual({ x: 7, z: 2 });
    expect(r.lengthM).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(r.lengthM).toBeLessThan(6.6);
    for (let m = 0; m <= r.lengthM; m += 0.05) {
      const p = pointAlong(r.points, m);
      expect(circleFree(g, p.x, p.z, CHARACTER_RADIUS_M)).toBe(true);
    }
    // a wall of a room with no door: no route
    const noDoor = rasterizeLayout(layoutOf(lay.rooms));
    expect(findRoute(noDoor, { x: 1, z: 2 }, { x: 7, z: 2 })).toBeNull();
  });

  it('goes round furniture, and says Infinity for a place it cannot reach', () => {
    const lay = twoRooms();
    const g0 = rasterizeLayout(lay);
    const box = { id: 'x', source: 'virtual' as const, kind: 'wardrobe' as const, label: 'x', box: { cx: 2.5, cz: 2, w: 0.6, d: 1.6, yawDeg: 0 }, heightM: 1.8, surfaceHeightM: 1.8 };
    const g = stampFurniture(g0, [box]);
    const field = routesFrom(g, { x: 1, z: 2 }, [{ x: 3.5, z: 2 }, { x: 20, z: 20 }]);
    expect(field.lengthTo({ x: 3.5, z: 2 })).toBeGreaterThan(2.5);
    expect(field.lengthTo({ x: 20, z: 20 })).toBe(Infinity);
    expect(field.routeTo({ x: 20, z: 20 })).toBeNull();
    const route = field.routeTo({ x: 3.5, z: 2 })!;
    expect(lineFree(g, route.points[0], route.points[1], PLAN_RADIUS_TIGHT_M)).toBe(true);
    expect(routeLength(route.points)).toBeCloseTo(route.lengthM, 6);
  });

  it('stops where a search is not worth going on (a fade, not a walk)', () => {
    const g = rasterizeLayout(twoRooms());
    expect(routesFrom(g, { x: 1, z: 2 }, [{ x: 7, z: 2 }], 3).lengthTo({ x: 7, z: 2 })).toBe(Infinity);
    expect(findRoute(g, { x: 1, z: 2 }, { x: 7, z: 2 }, 3)).toBeNull();
  });
});

describe('doors on a route', () => {
  const lay = twoRooms();
  const door = resolveDoors(lay)[0];
  it('finds the first shut door a route goes through and a standing place outside its swing', () => {
    const g = rasterizeLayout(lay);
    const route = findRoute(g, { x: 1, z: 2 }, { x: 7, z: 2 })!;
    const cross = firstCrossing(route.points, [door])!;
    expect(cross.door.id).toBe('d1');
    expect(cross.atM).toBeGreaterThan(2.4);
    const stand = standOffM(route.points, cross.atM, door);
    expect(stand).toBeLessThan(cross.atM - 0.3);
    const cut = cutRoute(route.points, stand);
    expect(routeLength(cut)).toBeCloseTo(stand, 3);
    // a route that stays in one room crosses nothing
    expect(firstCrossing(findRoute(g, { x: 1, z: 1 }, { x: 3, z: 3 })!.points, [door])).toBeNull();
    expect(crossesDoorway(door, { x: 1, z: 2 }, { x: 7, z: 2 })).not.toBeNull();
    expect(crossesDoorway(door, { x: 1, z: 3.8 }, { x: 7, z: 3.8 })).toBeNull();
  });
  it('plans with a leaf that stands open as a solid thing, and without one that is shut', () => {
    const g = rasterizeLayout(lay);
    const shut = planGridOf(g, [{ door, pos: 0 }]);
    expect(shut).toBe(g);
    const open = planGridOf(g, [{ door, pos: door.maxPos }]);
    expect(open).not.toBe(g);
    expect(Array.from(open.cells).some((v, i) => v !== g.cells[i])).toBe(true);
  });
});

describe('the room bar', () => {
  const lay = twoRooms();
  it('says the size the Rooms sheet says, and "Not measured" where a size is unverified, never a number', () => {
    const [a, b] = roomChips(lay, { b: 'size read from a label' });
    expect(a.area).toMatch(/^\d+ sq ft · \d+\.\d m²$/);
    expect(a.title).toBe(`Living, ${a.area}`);
    expect(b.area).toBe('Not measured');
    expect(b.unmeasured).toBe(true);
    expect(b.title).toContain('Not measured (size read from a label)');
    expect(chipCaption(a)).toBe(`Living · ${a.area}`);
  });
  it('marks a room only partly on the drawing: no size, not a place to go', () => {
    const l2 = layoutOf([rect('a', 0, 0, 3, 3), { ...rect('p', 3, 0, 6, 3), partial: { reason: 'runs off the sheet' } }]);
    const [, p] = roomChips(l2, {});
    expect(p.partial).toBe(true);
    expect(p.goable).toBe(false);
    expect(p.area).toBe('Shape guessed');
    expect(p.area).not.toMatch(/\d/);
  });
});

describe('the minimap geometry', () => {
  it('draws a view cone that points where the walker looks (forward is (sin yaw, cos yaw))', () => {
    const d = conePath({ x: 1, z: 1 }, 0, 2, 30, 2);
    // yaw 0 looks along +z: the arc is at z = 1 + 2 cos(30 deg) and x = 1 +- 1
    expect(d).toContain('L0.000,2.732');
    expect(d).toContain('L2.000,2.732');
    expect(conePath({ x: 0, z: 0 }, 90, 1, 10, 1)).toContain('L0.985,-0.174');
  });
  it('lifts the plan clear of a prompt pill that stands over it, and ignores one beside it', () => {
    const map = { left: 12, right: 150, top: 600, bottom: 740 };
    expect(liftAbove(map, [{ left: 100, right: 300, top: 690, bottom: 740 }])).toBe(740 - 690 + 8);
    expect(liftAbove(map, [{ left: 200, right: 300, top: 690, bottom: 740 }])).toBe(0);
    expect(liftAbove(map, [{ left: 100, right: 300, top: 400, bottom: 480 }])).toBe(0);
    expect(liftAbove(map, [{ left: 0, right: 400, top: 650, bottom: 790 }, { left: 100, right: 300, top: 690, bottom: 740 }])).toBe(740 - 650 + 8);
  });
  it('picks the room a tap lands in, or the nearest one within reach, but never a room only partly drawn', () => {
    const lay = layoutOf([rect('a', 0, 0, 3, 3), rect('b', 3.2, 0, 6, 3), { ...rect('p', 0, 3.4, 6, 6), partial: { reason: 'x' } }]);
    expect(roomNear(lay, { x: 1, z: 1 }, 0.3)?.id).toBe('a');
    expect(roomNear(lay, { x: 3.1, z: 1 }, 0.3)?.id).toBe('a');
    expect(roomNear(lay, { x: 10, z: 10 }, 0.3)).toBeNull();
    expect(roomNear(lay, { x: 3, z: 4.5 }, 0.3)).toBeNull();
  });
  it('walks a path up to 12 m and fades for a longer one or none', () => {
    expect(goDecision(4)).toBe('walk');
    expect(goDecision(12)).toBe('walk');
    expect(goDecision(12.5)).toBe('fade');
    expect(goDecision(null)).toBe('fade');
    expect(goDecision(Infinity)).toBe('fade');
  });
});

describe('tour order', () => {
  const stop = (id: string, type: RoomTag['roomType'], label = id): TourStop => ({ room: rect(id, 0, 0, 3, 3, type, label), kind: roomKind({ roomType: type, label }), spot: { x: 0, z: 0, yawDeg: 0, roomId: id, how: 'door', clearM: 0.6 }, vantage: { x: 0, z: 0, yawDeg: 0, focal: { x: 1, z: 1 } } });
  it('classifies passages by name, and puts toilets after the living areas', () => {
    expect(roomKind({ roomType: 'other', label: 'Master bed passage' })).toBe('transit');
    expect(roomKind({ roomType: 'other', label: 'Utility' })).toBe('other');
    expect(roomKind({ roomType: 'bathroom', label: 'Toilet 1' })).toBe('wet');
    const remaining = [stop('t', 'bathroom'), stop('k', 'kitchen'), stop('u', 'other')];
    const dist: Record<string, number> = { t: 2, k: 6, u: 3 };
    // the toilet is nearest but costs more than the kitchen six metres further
    expect(2 + ORDER_PENALTY_M.wet).toBeGreaterThan(6);
    expect(pickNext(remaining, (p) => dist[remaining.find((s) => s.spot === p)!.room.id]).next?.room.id).toBe('k');
  });
  it('keeps unreachable stops apart and says what was left out', () => {
    const remaining = [stop('a', 'living'), stop('b', 'bedroom')];
    const r = pickNext(remaining, (p) => (p === remaining[1].spot ? Infinity : 5));
    expect(r.next?.room.id).toBe('a');
    expect(r.unreachable.map((s) => s.room.id)).toEqual(['b']);
    expect(skippedNote([])).toBeNull();
    expect(skippedNote([{ roomId: 'b', label: 'Balcony', why: 'not reachable' }])).toBe('Balcony could not be reached.');
    expect(skippedNote([{ roomId: 'b', label: 'Balcony', why: 'not reachable' }, { roomId: 'c', label: 'Store', why: 'no place to stand' }])).toBe('Left out: Balcony, Store.');
  });
  it('makes a stop of every whole room that has a place to stand and leaves out a partial one', () => {
    const lay = twoRooms();
    lay.rooms.push({ ...rect('p', 8.3, 0, 11, 4), partial: { reason: 'x' } });
    const { stops, skipped } = tourStops(lay, rasterizeLayout(lay));
    expect(stops.map((s) => s.room.id).sort()).toEqual(['a', 'b']);
    expect(skipped).toEqual([{ roomId: 'p', label: 'p', why: 'not on the drawing' }]);
  });
});
