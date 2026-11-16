// Authoring a flat from printed room sizes (scripts/building/flat-spec.ts, SPEC 18.13): the spec is built into a scene only if it keeps its own numbers.
import { describe, expect, it } from 'vitest';
import { buildFlatScene, buildLayout, checkFlat, ft, printedPlan as pl, printedTable as tb, unionOutline } from '../scripts/building/flat-spec';
import type { AuthoredFlat } from '../scripts/building/flat-spec';
import { validateLayout } from '../src/core/layout-validate';
import { polygonArea } from '../src/core/geometry';

/** A small two-room flat: a living room and a bedroom side by side, a door between them, the main door on the living room's north wall. */
const base = (): AuthoredFlat => ({
  typeId: 't', name: 'T', sceneId: 'test-tower-flat-t', title: 'T', origin: 'typed', carpetAreaM2: 30, carpetToleranceFrac: 0.03, northDeg: 0, brochureFacing: 'W', wallHeightM: 2.75,
  mainDoor: 'door-main', spawn: { x: 1, z: 1, yawDeg: 0 },
  rooms: [
    { id: 'living', label: 'Living', type: 'living', finish: 'dry', parts: [{ x: 0, z: 0, w: 4, d: 4, printed: pl(4, 4) }] },
    { id: 'bed', label: 'Bedroom', type: 'bedroom', finish: 'dry', parts: [{ x: 4.12, z: 0, w: 3, d: 4, printed: pl(3, 4) }] },
  ],
  openings: [
    { id: 'door-main', room: 'living', wall: 'N', at: 1, widthM: 1, kind: 'door', hinge: 'W' },
    { id: 'door-bed', room: 'bed', wall: 'W', at: 2, widthM: 0.9, kind: 'door', hinge: 'N' },
    { id: 'win', room: 'bed', wall: 'E', at: 2, widthM: 1.2, kind: 'window' },
  ],
  pieces: [{ id: 'bed-1', kind: 'bed', catalogId: 'bed-double', label: 'Bed', at: { x: 5.6, z: 2 }, facing: 'W' }],
  notes: [],
});
// 28 m2 of rooms and 0.48 m2 of wall between them: 28.48
const withArea = (a: AuthoredFlat, area: number): AuthoredFlat => ({ ...a, carpetAreaM2: area });
const good = (): AuthoredFlat => withArea(base(), 28.5);

describe('the authoring check', () => {
  it('a spec that keeps its numbers builds a flat scene that validates', () => {
    const { property, report } = buildFlatScene(good(), 'x');
    expect(report.errors).toEqual([]);
    expect(validateLayout(property.layout).errors).toEqual([]);
    expect(property.layout.rooms.map((r) => r.id)).toEqual(['living', 'bed']);
    expect(property.furniture.map((f) => f.id)).toEqual(['bed-1']);
    expect(report.area.partitionsM2).toBeCloseTo(0.12 * 4, 6);
  });

  it('every room is built to its printed size, either order, within 2 cm', () => {
    const a = good();
    a.rooms[1].parts[0].printed = pl(4, 3); // printed the other way round: fine
    expect(checkFlat(a).errors).toEqual([]);
    a.rooms[1].parts[0].printed = pl(4, 3.05); // 5 cm off
    expect(checkFlat(a).errors.join()).toMatch(/Bedroom: printed 3\.05 x 4\.00 m \(plan\), built 3\.00 x 4\.00 m/);
    a.rooms[1].parts[0].printed = pl(4, 3.019);
    expect(checkFlat(a).errors).toEqual([]);
    expect(() => buildFlatScene({ ...a, rooms: [a.rooms[0], { ...a.rooms[1], parts: [{ ...a.rooms[1].parts[0], printed: pl(5, 5) }] }] }, 'x')).toThrow(/does not follow its printed numbers/);
  });

  it('printed sizes in feet and inches read to the centimetre', () => {
    expect(ft(12, 6)).toBeCloseTo(3.81, 2);
    expect(ft(18, 3)).toBeCloseTo(5.563, 3);
    expect(tb([12, 6], [18, 3])).toEqual({ aM: ft(12, 6), bM: ft(18, 3), from: 'table' });
    const a = good();
    a.rooms[0].parts[0] = { x: 0, z: 0, w: 3.81, d: 5.56, printed: tb([12, 6], [18, 3]) };
    expect(checkFlat(a).rooms[0].parts[0].from).toBe('table');
    expect(checkFlat(a).errors.filter((e) => /Living/.test(e))).toEqual([]);
  });

  it('a wall thinner than 6 cm between two rooms is reported', () => {
    const a = good();
    a.rooms[1].parts[0].x = 4.03;
    expect(checkFlat(a).warnings.join()).toMatch(/Living and Bedroom are 3 cm apart: a wall thinner than 6 cm/);
    expect(checkFlat(good()).warnings).toEqual([]);
  });

  it('two rooms may touch but not overlap', () => {
    const a = good();
    a.rooms[1].parts[0].x = 3.5;
    expect(checkFlat(a).errors.join()).toMatch(/Living and Bedroom overlap by 2\.00 m2/);
  });

  it('every room must be walkable from the main door', () => {
    const a = good();
    a.openings = a.openings.filter((o) => o.id !== 'door-bed');
    expect(checkFlat(a).errors.join()).toMatch(/Bedroom cannot be reached from the main door/);
    // a doorless open stretch counts as a way through
    const b = good();
    b.openings = b.openings.filter((o) => o.id !== 'door-bed');
    b.rooms[1].parts[0].x = 4;
    b.rooms[0].openTo = ['bed'];
    expect(checkFlat(b).errors).toEqual([]);
    expect(buildLayout(b).rooms[0].edges).toEqual(['wall', 'none', 'wall', 'wall']);
  });

  it('the main door is a door on an outside wall', () => {
    const a = good();
    a.mainDoor = 'door-bed';
    expect(checkFlat(a).errors.join()).toMatch(/main door opens into another room/);
    a.mainDoor = 'nope';
    expect(checkFlat(a).errors.join()).toMatch(/not an opening of the flat/);
  });

  it('a window must look outside, and openings must lie on their wall and not on each other', () => {
    const a = good();
    a.openings.push({ id: 'win2', room: 'bed', wall: 'W', at: 3.2, widthM: 1.0, kind: 'window' });
    expect(checkFlat(a).errors.join()).toMatch(/window win2 of Bedroom looks into Living/);
    const b = good();
    b.openings.push({ id: 'far', room: 'living', wall: 'S', at: 3.8, widthM: 1.0, kind: 'window' });
    expect(checkFlat(b).errors.join()).toMatch(/no S wall of "living" runs from 3.3 to 4.3/);
    const c = good();
    c.openings.push({ id: 'door-2', room: 'living', wall: 'N', at: 1.4, widthM: 1.0, kind: 'door' });
    expect(checkFlat(c).errors.join()).toMatch(/door-main and door-2 overlap on one wall of Living/);
  });

  it('the rooms and the walls between them must add up to the stated carpet area within the tolerance', () => {
    expect(checkFlat(withArea(base(), 28.48)).area.withinTolerance).toBe(true);
    const lo = checkFlat(withArea(base(), 28.48 / 0.97 + 0.05));
    expect(lo.area.withinTolerance).toBe(false);
    expect(lo.errors.join()).toMatch(/is -3\.\d % from the stated carpet area/);
    const hi = checkFlat(withArea(base(), 28.48 / 1.03 - 0.05));
    expect(hi.area.withinTolerance).toBe(false);
    expect(() => buildFlatScene(withArea(base(), 40), 'x')).toThrow(/stated carpet area 40 m2/);
    // the rooms alone, without the walls, are 28.00: the walls are what the brochure's carpet area also counts
    expect(checkFlat(good()).area.roomsM2).toBeCloseTo(28, 6);
  });

  it('a room of two rectangles is one rectilinear room, each rectangle held to its own printed size', () => {
    const outline = unionOutline([{ x: 0, z: 0, w: 2, d: 1 }, { x: 1, z: 1, w: 1, d: 1 }]);
    expect(outline).toEqual([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: 1, z: 2 }, { x: 1, z: 1 }, { x: 0, z: 1 }]);
    expect(polygonArea(outline)).toBe(3);
    const a = withArea(base(), 30);
    a.rooms[1].parts = [{ x: 4.12, z: 0, w: 3, d: 4, printed: pl(3, 4) }, { x: 4.12, z: 4, w: 1.5, d: 1, printed: pl(1.5, 1) }];
    const r = checkFlat(a);
    expect(r.errors).toEqual([]);
    expect(r.rooms[1].parts.length).toBe(2);
    expect(r.rooms[1].areaM2).toBeCloseTo(13.5, 6);
    a.rooms[1].parts[1].printed = pl(1.5, 1.2);
    expect(checkFlat(a).errors.join()).toMatch(/Bedroom: printed 1\.20 x 1\.50 m/);
    expect(() => unionOutline([{ x: 0, z: 0, w: 1, d: 1 }, { x: 3, z: 3, w: 1, d: 1 }])).toThrow(/pinch|hole|touch/);
  });

  it('openings are placed by wall and plan coordinate, with hinge and swing by compass', () => {
    const b = buildLayout(good());
    const main = b.openings.find((o) => o.id === 'door-main')!;
    expect(main).toMatchObject({ roomId: 'living', edge: 0, centreM: 1, widthM: 1, type: 'door' });
    expect(main.leaf).toEqual({ hinge: 'start', swing: 'in', kind: 'hinged' });
    const bed = b.openings.find((o) => o.id === 'door-bed')!;
    expect(bed).toMatchObject({ roomId: 'bed', edge: 3, centreM: 2 }); // the west wall runs south to north: the middle is 2 m from the start
    expect(bed.leaf).toMatchObject({ hinge: 'end' }); // hung on the north post, which is the end of a west wall's edge
    const win = b.openings.find((o) => o.id === 'win')!;
    expect(win).toMatchObject({ roomId: 'bed', edge: 1, type: 'window', sillM: 0.9 });
    expect(win.leaf).toBeUndefined();
  });

  it('a balcony is railed where nothing faces it, except the sides the plan draws as piers', () => {
    const a = good();
    a.rooms.push({ id: 'balc', label: 'Balcony', type: 'balcony', finish: 'balcony', solidSides: ['W'], parts: [{ x: 0.2, z: 4.12, w: 3, d: 1, printed: pl(3, 1) }] });
    a.openings.push({ id: 'slide', room: 'living', wall: 'S', at: 1.7, widthM: 2, kind: 'sliding', hinge: 'W' });
    const b = buildLayout(a);
    // N faces the living room, W is a pier, E and S look outside
    expect(b.rooms.find((r) => r.id === 'balc')!.edges).toEqual(['wall', 'railing', 'railing', 'wall']);
    expect(b.errors).toEqual([]);
  });
});
