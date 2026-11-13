// The start page's spawn: inside the chosen room, just in from the main door, 0.6 m clear, facing the room's centre.
import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { circleFree } from '../src/core/grid-query';
import { pointInPolygon } from '../src/core/geometry';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { chooseSpawn, polygonCentroid, SPAWN_CLEAR_M, yawToward } from '../src/core/spawn';
import { defaultStartRoom, resolveStartRoom, startableRooms } from '../src/core/start-rooms';
import type { Layout, RoomTag } from '../src/types';
import { crowdedFurniture, crowdedLayout } from './helpers/crowded-flat';
import { DEFAULT_FINISHES } from '../src/types';

const flat = buildTruthProperty('furnished');
const crowded = { layout: crowdedLayout, furniture: crowdedFurniture, spawn: { x: -1.81, z: 1.43, yawDeg: 180 } };
type Scene = { layout: Layout; furniture: typeof crowdedFurniture };

const gridOf = (p: Scene) => stampFurniture(rasterizeLayout(p.layout), p.furniture);
const room = (p: Scene, id: string): RoomTag => p.layout.rooms.find((r) => r.id === id)!;
const angleDiff = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);

function box(id: string, x0: number, z0: number, x1: number, z1: number, type: RoomTag['roomType'] = 'bedroom'): RoomTag {
  return { id, roomType: type, label: id, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'] };
}
function layoutOf(rooms: RoomTag[], openings: Layout['openings'] = []): Layout {
  return { wallHeightM: 2.6, wallThicknessM: 0.12, railingHeightM: 1.1, rooms, openings, finishes: DEFAULT_FINISHES, scaleSource: 'typed-sizes' };
}

describe('chooseSpawn', () => {
  it('puts the spawn inside the chosen crowded room, 0.6 m clear, looking at its centre (a guessed spawn in the passage is not used)', () => {
    const g = gridOf(crowded);
    const sp = chooseSpawn(crowded.layout, 'main', g)!;
    expect(sp).not.toBeNull();
    const r = room(crowded, 'main');
    expect(pointInPolygon(sp, r.polygon)).toBe(true);
    expect(circleFree(g, sp.x, sp.z, SPAWN_CLEAR_M)).toBe(true);
    // not where a guess would have put it (a passage at a door frame)
    expect(Math.hypot(sp.x - crowded.spawn.x, sp.z - crowded.spawn.z)).toBeGreaterThan(1);
    const c = polygonCentroid(r.polygon);
    expect(angleDiff(sp.yawDeg, yawToward(sp, c))).toBeLessThan(1e-6);
  });

  it('stands just in from the bedroom door of the test flat and faces the room', () => {
    const g = gridOf(flat);
    const sp = chooseSpawn(flat.layout, 'bedroom', g)!;
    const r = room(flat, 'bedroom');
    expect(sp.how).toBe('door');
    expect(pointInPolygon(sp, r.polygon)).toBe(true);
    expect(circleFree(g, sp.x, sp.z, SPAWN_CLEAR_M)).toBe(true);
    // the door is on the z = 5 wall, x 0.7..1.6: we are within 1.3 m of it, not across the room
    expect(5 - sp.z).toBeLessThan(1.3);
    expect(Math.abs(sp.x - 1.15)).toBeLessThan(1.0);
    // facing into the room: forward (sin, cos) points to smaller z
    expect(Math.cos((sp.yawDeg * Math.PI) / 180)).toBeLessThan(0);
  });

  it('with no door, stands near the wall farthest from the centre', () => {
    const l = layoutOf([box('a', 0, 0, 6, 3)]);
    const sp = chooseSpawn(l, 'a', rasterizeLayout(l))!;
    expect(sp.how).toBe('wall');
    expect(circleFree(rasterizeLayout(l), sp.x, sp.z, SPAWN_CLEAR_M)).toBe(true);
    // the short walls (x = 0 and x = 6) are farthest from the centre (3, 1.5)
    expect(Math.min(sp.x, 6 - sp.x)).toBeLessThan(1.8);
    expect(angleDiff(sp.yawDeg, yawToward(sp, { x: 3, z: 1.5 }))).toBeLessThan(1e-6);
  });

  it('keeps 0.6 m from furniture that sits in front of the door', () => {
    const base = layoutOf([box('a', 0, 0, 4, 4)], [{ id: 'd', roomId: 'a', edge: 2, type: 'door', centreM: 2, widthM: 0.9, sillM: 0, headM: 2.1 }]);
    const g = rasterizeLayout(base);
    const withBed = stampFurniture(g, [{
      id: 'bed', source: 'real', kind: 'bed', label: 'bed', box: { cx: 2, cz: 3.0, w: 1.6, d: 1.0, yawDeg: 0 }, heightM: 0.5, surfaceHeightM: 0.5,
    }]);
    const sp = chooseSpawn(base, 'a', withBed)!;
    expect(circleFree(withBed, sp.x, sp.z, SPAWN_CLEAR_M)).toBe(true);
    expect(pointInPolygon(sp, base.rooms[0].polygon)).toBe(true);
  });

  it('never spawns in a partial room, a missing room, or a room with nowhere to stand', () => {
    const partial: RoomTag = { ...box('p', 0, 0, 4, 4), partial: { reason: 'runs off the sheet' } };
    const l = layoutOf([partial]);
    expect(chooseSpawn(l, 'p', rasterizeLayout(l))).toBeNull();
    expect(chooseSpawn(l, 'nope', rasterizeLayout(l))).toBeNull();
    const tiny = layoutOf([box('t', 0, 0, 0.3, 0.3)]);
    expect(chooseSpawn(tiny, 't', rasterizeLayout(tiny))).toBeNull();
  });

  it('relaxes the clear space in a narrow room instead of failing', () => {
    const l = layoutOf([box('n', 0, 0, 1.0, 4)]);
    const g = rasterizeLayout(l);
    const sp = chooseSpawn(l, 'n', g)!;
    expect(sp).not.toBeNull();
    expect(sp.clearM).toBeLessThan(SPAWN_CLEAR_M);
    expect(circleFree(g, sp.x, sp.z, sp.clearM)).toBe(true);
  });

  it('prefers a door that leads to another room over one that leads nowhere', () => {
    // room a (0..4 x 0..4), neighbour b to the west (-3..-0.1); a has a door to b (west wall, edge 3) and a window-less opening south to nowhere
    const a = box('a', 0, 0, 4, 4), b = box('b', -3, 0, -0.1, 4, 'other');
    const l = layoutOf([a, b], [
      { id: 'out', roomId: 'a', edge: 2, type: 'door', centreM: 2, widthM: 1.2, sillM: 0, headM: 2.1 },
      { id: 'to-b', roomId: 'a', edge: 3, type: 'door', centreM: 2, widthM: 0.9, sillM: 0, headM: 2.1 },
    ]);
    const sp = chooseSpawn(l, 'a', rasterizeLayout(l))!;
    expect(sp.x).toBeLessThan(2); // by the west door, not the south one
  });
});

describe('start rooms', () => {
  it('lists only whole rooms, not passages, bathrooms or balconies', () => {
    expect(startableRooms(crowded.layout).map((r) => r.id)).toEqual(['main', 'second']);
    expect(startableRooms(flat.layout).map((r) => r.id)).toEqual(['bedroom']);
  });

  it('never offers a partial room, even when it is the only bedroom', () => {
    const l = layoutOf([{ ...box('a', 0, 0, 4, 4), partial: { reason: 'x' } }, box('h', 4, 0, 8, 3, 'living')]);
    expect(startableRooms(l).map((r) => r.id)).toEqual(['h']);
    expect(resolveStartRoom(l, 'a')!.id).toBe('h');
    expect(startableRooms(layoutOf([{ ...box('a', 0, 0, 4, 4), partial: { reason: 'x' } }]))).toEqual([]);
  });

  it('falls back to passages and balconies when they are all there is', () => {
    const l = layoutOf([box('b', 0, 0, 2, 2, 'balcony'), box('p', 2, 0, 4, 1, 'other')]);
    expect(startableRooms(l).map((r) => r.id)).toEqual(['b', 'p']);
  });

  it('preselects the largest bedroom or living room, preferring a measured one', () => {
    const l = layoutOf([box('small', 0, 0, 3, 3), box('big', 3, 0, 9, 4), box('hall', 9, 0, 20, 10, 'other'), box('lounge', 0, 4, 5, 8, 'living')]);
    expect(defaultStartRoom(l)!.id).toBe('big');
    expect(defaultStartRoom(l, { big: 'label size only' })!.id).toBe('lounge');
    expect(defaultStartRoom(l, { big: 'x', lounge: 'x', small: 'x' })!.id).toBe('big');
    expect(defaultStartRoom(crowded.layout, { second: 'label size only', hall: 'runs off the drawing' })!.id).toBe('main');
  });

  it('resolves ?room= and falls back to the default for a stale or unknown id', () => {
    expect(resolveStartRoom(flat.layout, 'bedroom')!.id).toBe('bedroom');
    expect(resolveStartRoom(flat.layout, 'gone')!.id).toBe('bedroom');
    expect(resolveStartRoom(flat.layout, null)!.id).toBe('bedroom');
    expect(resolveStartRoom(crowded.layout, 'second')!.id).toBe('second');
  });
});
