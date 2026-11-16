// SPEC 16.19: daylight from windows and glazed doors, downlight pools in windowless rooms, wet-room tile, mirrors, calm signs.
import { describe, expect, it } from 'vitest';
import { createEmptyProperty } from '../src/core/layout-validate';
import { defaultEdges } from '../src/core/layout-geom';
import { gradeAt, TRUE_GRADE } from '../src/look/grade';
import { MAX_WINDOW_LIGHTS, lampColour, lampSources, nearestTo, skylightColour, windowSources } from '../src/look/daylight';
import { createLookMaterials } from '../src/look/materials';
import { MIRROR_W_M, mirrorSites } from '../src/look/kit/rules';
import { getPack, loadPack } from '../src/look/packs';
import { roomFinishIds, resetStyle, setStyle } from '../src/look/style';
import { signLook } from '../src/look/sign-style';
import type { FurnitureItem, Layout, Opening, RoomTag, RoomType } from '../src/types';

const rect = (id: string, type: RoomType, x0: number, z0: number, x1: number, z1: number): RoomTag => ({
  id, roomType: type, label: id, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'],
});
function layoutOf(rooms: RoomTag[], openings: Opening[] = []): Layout {
  const p = createEmptyProperty('synthetic-daylight');
  p.layout.rooms = rooms.map((r) => ({ ...r, edges: r.edges.map((e, i) => (e === 'wall' ? defaultEdges(r, rooms)[i] : e)) }));
  p.layout.openings = openings;
  p.layout.wallHeightM = 2.6;
  return p.layout;
}
const win = (roomId: string, edge: number, centreM: number, widthM = 1.2): Opening => ({ id: `w-${roomId}-${edge}`, roomId, edge, type: 'window', centreM, widthM, sillM: 0.9, headM: 2.1 });
const door = (roomId: string, edge: number, centreM: number): Opening => ({ id: `d-${roomId}-${edge}`, roomId, edge, type: 'door', centreM, widthM: 0.9, sillM: 0, headM: 2.1 });
const flat = (): Layout => layoutOf([rect('living', 'living', 0, 0, 5, 4), rect('bath', 'bathroom', 0, 4.12, 1.8, 6.4), rect('hall', 'other', 5.12, 0, 7, 3)], [win('living', 3, 2, 1.8), door('bath', 0, 0.9), door('hall', 3, 1)]);

describe('window sources', () => {
  it('a window is a source on its wall, its normal points into the room, its size is the glass', () => {
    const l = flat();
    const w = windowSources(l);
    expect(w.map((x) => x.roomId)).toEqual(['living']);
    const a = w[0];
    expect(Math.hypot(a.nx, a.nz)).toBeCloseTo(1, 6);
    // the living room's edge 3 is its west wall (x = 0): the room is at +x of it
    expect(a.nx).toBeGreaterThan(0.9);
    expect(a.hw).toBeCloseTo(0.9, 6);
    expect(a.hh).toBeCloseTo(0.6, 6);
    expect(a.y).toBeCloseTo(1.5, 6);
  });
  it('rooms with no window or glazed door are lit by their own downlights, and only those', () => {
    const l = flat();
    const lamps = lampSources(l, windowSources(l));
    const rooms = new Set(lamps.map((x) => x.roomId));
    expect(rooms.has('living')).toBe(false);
    expect(rooms.has('bath') || rooms.has('hall')).toBe(true);
    for (const x of lamps) expect(x.y).toBeCloseTo(2.595, 2);
  });
  it('the nearest few are chosen and the list is not mutated', () => {
    const list = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 3, z: 0 }, { x: 1, z: 0 }];
    expect(nearestTo(list, 0, 0, 2)).toEqual([{ x: 0, z: 0 }, { x: 1, z: 0 }]);
    expect(list.length).toBe(4);
    expect(MAX_WINDOW_LIGHTS).toBeGreaterThanOrEqual(4);
  });
});

describe('the light of a window and of a lamp', () => {
  it('is none in True colours, a trickle at night, cool by day and warmer in the evening', () => {
    expect(skylightColour(TRUE_GRADE, true)).toEqual([0, 0, 0]);
    const day = skylightColour(gradeAt(15), false), eve = skylightColour(gradeAt(17.8), false), night = skylightColour(gradeAt(20.5), false);
    expect(day[2]).toBeGreaterThan(day[0] * 0.98); // not warm
    expect(eve[0] / eve[2]).toBeGreaterThan(day[0] / day[2]); // warmer
    expect(night[0] + night[1] + night[2]).toBeLessThan((day[0] + day[1] + day[2]) * 0.15);
    expect(lampColour(TRUE_GRADE, true)).toEqual([0, 0, 0]);
    const lamp = lampColour(gradeAt(15), false);
    expect(lamp[0]).toBeGreaterThan(lamp[2]); // warm
  });
});

describe('wet rooms', () => {
  it('a wall tile material is its own material with the tile uniforms, a painted wall of the same colour is another', () => {
    const lm = createLookMaterials({ wallHeightM: 2.6 });
    const paint = lm.wall('#ECEEED');
    const tile = lm.wall('#ECEEED', { wM: 0.3, hM: 0.6 });
    expect(tile).not.toBe(paint);
    expect(lm.wall('#ECEEED', { wM: 0.3, hM: 0.6 })).toBe(tile);
    lm.dispose();
  });
  it('the default pack tiles a bathroom that has no finish of its own, and leaves other rooms alone', () => {
    setStyle({ packId: 'clean-contrast' });
    const wet = roomFinishIds('bath', undefined, 'bathroom');
    expect(wet.wall?.[0]).toBe('tile-wet-white');
    expect(wet.floor?.[0]).toBe('tile-wet-grey');
    const dry = roomFinishIds('living', undefined, 'living');
    expect(dry.wall?.[0]).toBe('wall-bright');
    resetStyle();
  });
  it('loadPack takes a wet finish and drops an unknown one', () => {
    const { pack, dropped } = loadPack({ id: 'w', name: 'W', room: { wet: { wall: 'tile-wet-white', floor: 'nope' } } });
    expect(pack?.room.wet).toEqual({ wall: 'tile-wet-white' });
    expect(dropped.length).toBe(1);
    expect(getPack('clean-contrast')?.trim?.grill).toBe('white-laminate');
  });
  it('a mirror goes on the wall behind each wash basin of a bathroom, clear of doors', () => {
    const l = flat();
    const basin: FurnitureItem = { id: 'basin-1', source: 'real', kind: 'counter', label: 'Wash basin', catalogId: 'basin-wall', box: { cx: 0.9, cz: 6.1, w: 0.55, d: 0.45, yawDeg: 0 }, heightM: 0.95, surfaceHeightM: 0.95 };
    const m = mirrorSites(l, [basin]);
    expect(m.length).toBe(1);
    expect(m[0].roomId).toBe('bath');
    expect(m[0].w).toBe(MIRROR_W_M);
    expect(m[0].y0).toBeGreaterThan(0.95);
    expect(mirrorSites(l, [{ ...basin, box: { ...basin.box, cx: 5, cz: 1 } }]).length).toBe(0); // not in a bathroom
  });
});

describe('calm signs', () => {
  it('the clean packs have a small light plate, the others keep the dark one', () => {
    setStyle({ packId: 'clean-contrast' });
    const calm = signLook();
    expect(calm.scale).toBeLessThan(0.8);
    expect(calm.bg).toBe('#F6F4F0');
    setStyle({ packId: 'light-scandinavian' });
    expect(signLook().scale).toBeLessThan(0.8); // every pack but Classic
    setStyle({ packId: 'classic' });
    expect(signLook().scale).toBe(1);
    resetStyle();
  });
});
