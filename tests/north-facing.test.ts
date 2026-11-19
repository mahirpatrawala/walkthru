// North, facing and the zone grid (SPEC 22.1): the angle conventions, the 8-way labels, the 3 x 3 grid turned to true north.
import { describe, expect, it } from 'vitest';
import { DEFAULT_FINISHES } from '../src/types';
import type { Layout, Opening, RoomTag } from '../src/types';
import {
  DIRS8, bearingOf, dir8, facingOf, lookNorthDeg, northFromLook, northInScene, parseNorth, planAngle, planDirOf, toCompass, viewBearing,
} from '../src/core/north';
import type { NorthRef } from '../src/core/north';
import { polygonCentroid, readFacing, zoneGrid, zoneOf } from '../src/core/facing';
import type { Zone } from '../src/core/facing';
import { mainEntrance } from '../src/core/entrance';

const N = (deg: number): NorthRef => ({ deg, source: 'builder' });

function room(id: string, x0: number, z0: number, x1: number, z1: number, type: RoomTag['roomType'] = 'other', label = id): RoomTag {
  return { id, roomType: type, label, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'] };
}
const layoutOf = (rooms: RoomTag[], openings: Opening[] = []): Layout => ({ wallHeightM: 2.75, wallThicknessM: 0.12, railingHeightM: 1.1, rooms, openings, finishes: DEFAULT_FINISHES, scaleSource: 'typed-sizes' });
const door = (id: string, roomId: string, edge: number, w = 1): Opening => ({ id, roomId, edge, type: 'door', centreM: 1.5, widthM: w, sillM: 0, headM: 2.1, leaf: { hinge: 'start', swing: 'in', kind: 'hinged' } });
const win = (id: string, roomId: string, edge: number): Opening => ({ id, roomId, edge, type: 'window', centreM: 1.5, widthM: 1.2, sillM: 0.9, headM: 2.1 });

/** nine 3 x 3 m rooms on the page: row 0 is the top (up the page), column 0 the left. Named by where they stand when north is up. */
const NAMES: Zone[][] = [['NW', 'N', 'NE'], ['W', 'C', 'E'], ['SW', 'S', 'SE']];
function nine(): RoomTag[] {
  const out: RoomTag[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(room(NAMES[r][c], c * 3, r * 3, c * 3 + 3, r * 3 + 3));
  return out;
}

describe('angles and labels', () => {
  it('labels a bearing by the 45 degree sector round each point', () => {
    expect(dir8(0)).toBe('N'); expect(dir8(22.4)).toBe('N'); expect(dir8(22.6)).toBe('NE'); expect(dir8(90)).toBe('E');
    expect(dir8(180)).toBe('S'); expect(dir8(270)).toBe('W'); expect(dir8(337.4)).toBe('NW'); expect(dir8(337.6)).toBe('N'); expect(dir8(-45)).toBe('NW'); expect(dir8(720)).toBe('N');
    expect(DIRS8.map((_, i) => dir8(i * 45))).toEqual([...DIRS8]);
  });
  it('plan angle runs clockwise from the page up', () => {
    expect(planAngle({ x: 0, z: -1 })).toBeCloseTo(0, 9);
    expect(planAngle({ x: 1, z: 0 })).toBeCloseTo(90, 9);
    expect(planAngle({ x: 0, z: 1 })).toBeCloseTo(180, 9);
    expect(planAngle({ x: -1, z: 0 })).toBeCloseTo(270, 9);
  });
  it('reads a direction against a turned north', () => {
    // north up the page: a door facing the page's right faces east
    expect(facingOf(N(0), { x: 1, z: 0 })).toBe('E');
    // north points to the right of the page (deg 90): the page's right is north, the page's top is west, its bottom is east
    expect(facingOf(N(90), { x: 1, z: 0 })).toBe('N');
    expect(facingOf(N(90), { x: 0, z: -1 })).toBe('W');
    expect(facingOf(N(90), { x: 0, z: 1 })).toBe('E');
    // north to the left (270): the page's left is north
    expect(facingOf(N(270), { x: -1, z: 0 })).toBe('N');
    expect(bearingOf(N(45), { x: 0, z: -1 })).toBeCloseTo(315, 9); // the page's up is north-west when north is 45 degrees clockwise of it
  });
  it('turns compass bearings back into plan directions', () => {
    for (const deg of [0, 30, 90, 200, 270]) for (const b of [0, 45, 90, 180, 300]) {
      const v = planDirOf(N(deg), b);
      expect(Math.hypot(v.x, v.z)).toBeCloseTo(1, 9);
      const diff = Math.abs(((bearingOf(N(deg), v) - b + 540) % 360) - 180); // a bearing of 359.9999999 is a bearing of 0
      expect(diff).toBeCloseTo(0, 6);
    }
  });
  it('the compass frame: north and east are perpendicular, and a point reads in them', () => {
    expect(toCompass(N(0), { x: 2, z: -3 })).toEqual({ e: 2, n: 3 });
    const c = toCompass(N(90), { x: 2, z: -3 }); // north is the page's right
    expect(c.n).toBeCloseTo(2, 9); expect(c.e).toBeCloseTo(-3, 9); // east is the page's bottom (+z), so a point at z -3 is 3 m west
  });
  it('look.json northDeg is the other way round and converts both ways', () => {
    expect(lookNorthDeg(90)).toBe(270); expect(lookNorthDeg(0)).toBe(0);
    expect(northFromLook(90).deg).toBe(270); expect(northFromLook(lookNorthDeg(130)).deg).toBe(130);
    // a page whose compass puts north to the LEFT: north is 270 clockwise of up, and the plan's up has bearing 90 (it faces east)
    expect(northFromLook(90).deg).toBe(270);
    expect(bearingOf(N(270), { x: 0, z: -1 })).toBeCloseTo(90, 9);
  });
  it('a scene turned on a plate has north turned the opposite way', () => {
    expect(northInScene(N(0), 0).deg).toBe(0);
    expect(northInScene(N(0), 90).deg).toBe(270);
    expect(northInScene(N(0), 180).deg).toBe(180);
    expect(northInScene(N(30), 270).deg).toBe(120);
    expect(northInScene({ deg: 10, source: 'drawing' }, 0).source).toBe('drawing');
  });
  it('the way the walker looks follows the camera yaw (forward is (sin yaw, cos yaw))', () => {
    expect(viewBearing(N(0), 180)).toBeCloseTo(0, 9); // looking up the page = north
    expect(viewBearing(N(0), 90)).toBeCloseTo(90, 9); // yaw 90 looks +x, the page's right
    expect(viewBearing(N(0), 0)).toBeCloseTo(180, 9);
    expect(viewBearing(N(90), 180)).toBeCloseTo(270, 9);
  });
  it('parses a north field and refuses a wrong one', () => {
    expect(parseNorth({ deg: -90, source: 'drawing' })).toEqual({ deg: 270, source: 'drawing' });
    expect(() => parseNorth({ deg: 'x', source: 'drawing' })).toThrow(/deg/);
    expect(() => parseNorth({ deg: 10, source: 'guess' })).toThrow(/source/);
    expect(() => parseNorth(null)).toThrow();
    expect(() => parseNorth({ deg: NaN, source: 'builder' })).toThrow();
  });
});

describe('the zone grid turned to true north', () => {
  const layout = layoutOf(nine());
  const zones = (north: NorthRef): Record<string, Zone> => {
    const g = zoneGrid(layout, north)!;
    return Object.fromEntries(layout.rooms.map((r) => [r.id, zoneOf(g, polygonCentroid(r.polygon))]));
  };
  it('with north up each room is where its name says', () => {
    const z = zones(N(0));
    for (const r of layout.rooms) expect(z[r.id]).toBe(r.id);
  });
  it('turned 90 degrees clockwise (north to the page right) the rooms move a quarter turn the other way', () => {
    const z = zones(N(90));
    // the page's right column is north, the top row is west
    expect(z.NE).toBe('NW'); // top right of the page: north + west
    expect(z.NW).toBe('SW'); // top left: south + west
    expect(z.SE).toBe('NE'); // bottom right: north + east
    expect(z.SW).toBe('SE');
    expect(z.E).toBe('N'); expect(z.N).toBe('W'); expect(z.W).toBe('S'); expect(z.S).toBe('E'); expect(z.C).toBe('C');
  });
  it('180 turns every zone to its opposite', () => {
    const z = zones(N(180));
    expect(z.NE).toBe('SW'); expect(z.N).toBe('S'); expect(z.W).toBe('E'); expect(z.C).toBe('C');
  });
  it('a turn that is not a quarter gives the box in the compass frame, not the page frame, and the middle stays the middle', () => {
    const g = zoneGrid(layout, N(30))!;
    const k = Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6); // a square of side 9 turned 30 degrees has this much more width in each axis
    expect(g.e1 - g.e0).toBeCloseTo(9 * k, 6);
    expect(g.n1 - g.n0).toBeCloseTo(9 * k, 6);
    expect(zones(N(30)).C).toBe('C');
    // worked by hand (offsets of 3 m from the middle, north = (sin 30, -cos 30), east = (cos 30, sin 30)): the page's top-left room is 4.1 m west and 1.1 m north of
    // the middle, so it is in the west zone; top-right is 4.1 north and 1.1 east; bottom-right 4.1 east; bottom-left 4.1 south
    const z = zones(N(30));
    expect(z.NW).toBe('W'); expect(z.NE).toBe('N'); expect(z.SE).toBe('E'); expect(z.SW).toBe('S');
  });
  it('a balcony outside the walls does not stretch the box, and falls in the nearest cell', () => {
    const rooms = [...nine(), room('balc', 9, 0, 11, 3, 'balcony', 'Balcony')];
    const l = layoutOf(rooms);
    const g = zoneGrid(l, N(0))!;
    expect(g.e1).toBeCloseTo(9, 9);
    expect(zoneOf(g, polygonCentroid(rooms[9].polygon))).toBe('NE');
  });
  it('is null for a layout with no rooms', () => {
    expect(zoneGrid(layoutOf([]), N(0))).toBeNull();
    expect(readFacing(layoutOf([]), N(0))).toBeNull();
  });
});

describe('facing readings', () => {
  it('the main door faces the way its wall looks out, in 8 ways, whatever the turn', () => {
    // a flat of one room with the front door on its south wall (edge 2): out is +z, the page's bottom
    const l = layoutOf([room('a', 0, 0, 4, 4, 'living', 'Living')], [door('front', 'a', 2)]);
    expect(mainEntrance(l)!.out).toEqual({ x: 0, z: 1 });
    expect(readFacing(l, N(0))!.mainDoor!.facing).toBe('S');
    expect(readFacing(l, N(90))!.mainDoor!.facing).toBe('E');
    expect(readFacing(l, N(180))!.mainDoor!.facing).toBe('N');
    expect(readFacing(l, N(270))!.mainDoor!.facing).toBe('W');
    expect(readFacing(l, N(135))!.mainDoor!.facing).toBe('NE');
  });
  it('a flat with no outside door has no main door reading', () => {
    const l = layoutOf([room('a', 0, 0, 4, 4)]);
    expect(readFacing(l, N(0))!.mainDoor).toBeNull();
  });
  it('a balcony faces the way its open railing looks, a room the way its window does', () => {
    const rooms = [room('living', 0, 0, 4, 4, 'living', 'Living'), room('balc', 4.1, 0, 6.1, 4, 'balcony', 'Balcony'), room('bed', 0, 4.1, 4, 8, 'bedroom', 'Bedroom')];
    rooms[1].edges = ['wall', 'railing', 'wall', 'wall'];
    const l = layoutOf(rooms, [win('w', 'bed', 2), door('slide', 'living', 1)]);
    const r = readFacing(l, N(0))!;
    expect(r.rooms.find((x) => x.roomId === 'balc')!.facing).toBe('E');
    expect(r.rooms.find((x) => x.roomId === 'bed')!.facing).toBe('S');
    expect(r.rooms.find((x) => x.roomId === 'living')!.facing).toBeNull(); // its only outside look is through the balcony
    expect(readFacing(l, N(90))!.rooms.find((x) => x.roomId === 'balc')!.facing).toBe('N'); // the page's right is north
  });
});
