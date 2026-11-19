// The units of a tower and the north of a plan, as data (SPEC 22.1, 22.3): id generation, the parser's rejections, where a unit's walk goes,
// the sample's committed file, and how a north reaches a property file and a drawing proposal.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseBuilding } from '../src/building/parse';
import { byFloor, findUnit, generateUnits, unitId, unitPlanProblems, unitsOf, walkTargetOf, UNIT_ID_RE } from '../src/building/units';
import type { UnitPlan } from '../src/building/units';
import { createEmptyProperty, validateProperty } from '../src/core/layout-validate';
import { applyProposal, proposalToPatch } from '../src/editor/save';
import { northInScene } from '../src/core/north';
import { readFacing } from '../src/core/facing';

const read = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const tower = (): Record<string, unknown> => read('public/buildings/sample-tower/building.json');

describe('unit ids', () => {
  it('is the floor then two digits', () => {
    expect(unitId(2, 1)).toBe('201');
    expect(unitId(12, 4)).toBe('1204');
    expect(unitId(21, 4)).toBe('2104');
    expect(unitId(5, 10)).toBe('510');
    expect(unitId(103, 9)).toBe('10309');
  });
  it('generates floors x units, lowest floor first, in the floor\'s own order', () => {
    const plan: UnitPlan = { firstFloor: 2, floors: 20, perFloor: [1, 2, 3, 4].map((n) => ({ number: n, type: 'a' })) };
    const us = generateUnits(plan);
    expect(us).toHaveLength(80);
    expect(us[0]).toEqual({ id: '201', floor: 2, number: 1, type: 'a' });
    expect(us[3].id).toBe('204');
    expect(us[4].id).toBe('301');
    expect(us[79].id).toBe('2104');
    expect(new Set(us.map((u) => u.id)).size).toBe(80);
    expect(us.every((u) => UNIT_ID_RE.test(u.id))).toBe(true);
    expect(generateUnits(plan)).toEqual(us); // deterministic
  });
  it('is not tied to four a floor or to the sample', () => {
    const us = generateUnits({ firstFloor: 1, floors: 3, perFloor: [{ number: 1, type: 'x' }, { number: 2, type: 'y' }, { number: 5, type: 'x' }] });
    expect(us.map((u) => u.id)).toEqual(['101', '102', '105', '201', '202', '205', '301', '302', '305']);
    expect(generateUnits({ firstFloor: 1, floors: 1, perFloor: [{ number: 1, type: 'x' }] })).toHaveLength(1);
  });
  it('groups by floor, the top floor first', () => {
    const rows = byFloor(generateUnits({ firstFloor: 2, floors: 3, perFloor: [{ number: 1, type: 'x' }, { number: 2, type: 'x' }] }));
    expect(rows.map((r) => r.floor)).toEqual([4, 3, 2]);
    expect(rows[0].units.map((u) => u.id)).toEqual(['401', '402']);
  });
});

describe('a building file with units', () => {
  it('the sample tower has 20 floors x 4 = 80 units, 201 to 2104, of its four flat types', () => {
    const b = parseBuilding(tower());
    const us = unitsOf(b);
    expect(us).toHaveLength(80);
    expect(us[0].id).toBe('201'); expect(us[79].id).toBe('2104');
    expect(us.find((u) => u.id === '1204')).toMatchObject({ floor: 12, number: 4, type: '3bhk-a' });
    expect(new Set(us.map((u) => u.type))).toEqual(new Set(Object.keys(b.flatTypes)));
    expect(findUnit(b, '1204')?.floor).toBe(12);
    expect(findUnit(b, '999')).toBeNull();
    expect(findUnit(b, '')).toBeNull();
  });
  it('a building with no units block has none', () => {
    const j = tower(); delete j.units;
    expect(unitsOf(parseBuilding(j))).toEqual([]);
  });
  it('rejects a unit plan with a message that says where', () => {
    const bad = (u: unknown): string => { try { parseBuilding({ ...tower(), units: u }); return 'accepted'; } catch (e) { return (e as Error).message; } };
    expect(bad('x')).toMatch(/units must be/);
    expect(bad({ firstFloor: 0, floors: 5, perFloor: [{ number: 1, type: '3bhk-a' }] })).toMatch(/units\.firstFloor must be between 1 and 200/);
    expect(bad({ firstFloor: 2, floors: 1.5, perFloor: [{ number: 1, type: '3bhk-a' }] })).toMatch(/units\.floors must be a whole number/);
    expect(bad({ firstFloor: 2, floors: 5, perFloor: [] })).toMatch(/units\.perFloor needs at least 1 entry/);
    expect(bad({ firstFloor: 2, floors: 5, perFloor: [{ number: 100, type: '3bhk-a' }] })).toMatch(/perFloor\[0\]\.number must be between 1 and 99/);
    expect(bad({ firstFloor: 2, floors: 5, perFloor: [{ number: 1, type: 'nope' }] })).toMatch(/the type "nope" is not in flatTypes/);
    expect(bad({ firstFloor: 2, floors: 5, perFloor: [{ number: 1, type: '3bhk-a' }, { number: 1, type: '3bhk-b' }] })).toMatch(/number 1 is used twice/);
    expect(bad({ firstFloor: 2, floors: 200, perFloor: Array.from({ length: 20 }, (_, i) => ({ number: i + 1, type: '3bhk-a' })) })).toMatch(/more than the 2000 allowed/);
  });
  it('checks a plan against flat types on its own too', () => {
    expect(unitPlanProblems({ firstFloor: 1, floors: 1, perFloor: [{ number: 1, type: 'a' }] }, { a: {} })).toEqual([]);
  });
});

describe('where "Walk this flat" goes', () => {
  const b = parseBuilding(tower());
  it('a unit the building models goes to its own flat', () => {
    const t = walkTargetOf(b, findUnit(b, '203')!)!;
    expect(t.exact).toBe(true);
    expect(t.space.id).toBe('f2-203');
    expect(walkTargetOf(b, findUnit(b, '304')!)!.space.id).toBe('f3-304');
  });
  it('a floor the walk does not model goes to a flat of the same type, and says it is not exact', () => {
    const t = walkTargetOf(b, findUnit(b, '1204')!)!;
    expect(t.exact).toBe(false);
    expect(t.space.type).toBe('3bhk-a');
    expect(t.space.id).toBe('f2-204'); // the lowest modelled flat of that type
    expect(walkTargetOf(b, findUnit(b, '2102')!)!.space.type).toBe('2bhk-b2');
  });
  it('201 is not mistaken for 2010 or 2101 (an id is matched whole)', () => {
    const t = walkTargetOf(b, { id: '20', floor: 0, number: 20, type: '2bhk-b4' })!;
    expect(t.exact).toBe(false);
  });
  it('every unit of the sample has somewhere to go', () => {
    for (const u of unitsOf(b)) expect(walkTargetOf(b, u)).not.toBeNull();
  });
  it('a type nobody models cannot be walked', () => {
    const j = tower() as { flatTypes: Record<string, unknown>; units: UnitPlan };
    j.flatTypes['studio'] = { name: 'Studio', sceneId: 'test-tower-flat-2bhk-b4' };
    j.units.perFloor.push({ number: 5, type: 'studio' });
    const b2 = parseBuilding(j);
    expect(walkTargetOf(b2, findUnit(b2, '505')!)).toBeNull();
  });
});

describe('the sample tower\'s north', () => {
  it('is set on the building and labelled as a builder\'s value, up the plate (the demonstration choice the generator already used for the sun)', () => {
    const b = parseBuilding(tower());
    expect(b.north).toEqual({ deg: 0, source: 'builder' });
    expect(b.sample).toBe(true);
    expect(parseBuilding(read('public/buildings/sample-tower-empty/building.json')).north).toEqual({ deg: 0, source: 'builder' });
  });
  it('a flat\'s north in its own scene agrees with the scene\'s look.json (the sun) for every flat of every typical floor', () => {
    const b = parseBuilding(tower());
    for (const level of b.levels) for (const s of level.spaces) {
      if (s.kind !== 'home') continue;
      const look = read<{ northDeg: number }>(`public/scenes/${s.sceneId}/look.json`);
      const n = northInScene(b.north!, s.placement.rotDeg);
      expect((360 - n.deg) % 360).toBe(look.northDeg); // look.json is the bearing of the scene's up, the other way round
    }
  });
  it('the facing of every walkable flat is a real reading (a door and a balcony)', () => {
    const b = parseBuilding(tower());
    for (const level of b.levels) for (const s of level.spaces) {
      if (s.kind !== 'home') continue;
      const r = readFacing(validateProperty(read(`public/scenes/${s.sceneId}/property.json`)).layout, northInScene(b.north!, s.placement.rotDeg))!;
      expect(r.mainDoor).not.toBeNull();
      expect(r.rooms.some((x) => x.roomType === 'balcony' && x.facing !== null)).toBe(true);
    }
  });
  it('a north with a bad field is refused with the path', () => {
    expect(() => parseBuilding({ ...tower(), north: { deg: 'up', source: 'builder' } })).toThrow(/north\.deg must be a number/);
    expect(() => parseBuilding({ ...tower(), north: { deg: 10, source: 'sun' } })).toThrow(/north\.source must be/);
  });
});

describe('a north on a standalone home and from a drawing', () => {
  const home = (): Record<string, unknown> => read('public/scenes/test-tower-flat-2bhk-b4/property.json');
  it('a property file carries its north, normalised, or none', () => {
    expect(validateProperty(home()).north).toBeUndefined();
    expect(validateProperty({ ...home(), north: { deg: -90, source: 'builder' } }).north).toEqual({ deg: 270, source: 'builder' });
    expect(() => validateProperty({ ...home(), north: { deg: 5, source: 'nope' } })).toThrow(/north\.source must be/);
  });
  const proposal = { rooms: [{ id: 'r1', roomType: 'bedroom', label: 'Room', polygon: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 4 }, { x: 0, z: 4 }], edges: ['wall', 'wall', 'wall', 'wall'] }], openings: [] };
  it('the reader finds no north arrow today, so a proposal has none and a draft is left without one', () => {
    const patch = proposalToPatch(proposal, { version: 1, warnings: [] });
    expect(patch.north).toBeUndefined();
    const d = createEmptyProperty('x');
    applyProposal(d, patch);
    expect(d.north).toBeUndefined();
  });
  it('an arrow a reader does find (source drawing) fills an empty north, and never replaces one the builder set', () => {
    const patch = proposalToPatch(proposal, { version: 1, north: { deg: 90, source: 'drawing' } });
    expect(patch.north).toEqual({ deg: 90, source: 'drawing' });
    const d = createEmptyProperty('x');
    applyProposal(d, patch);
    expect(d.north).toEqual({ deg: 90, source: 'drawing' });
    const own = createEmptyProperty('y'); own.north = { deg: 200, source: 'builder' };
    applyProposal(own, patch);
    expect(own.north).toEqual({ deg: 200, source: 'builder' });
  });
  it('a north in the sidecar that is not marked as read from the drawing is left out with a note', () => {
    const patch = proposalToPatch(proposal, { version: 1, north: { deg: 90, source: 'builder' } });
    expect(patch.north).toBeUndefined();
    expect(patch.notes.join(' ')).toMatch(/not marked as read from the drawing/);
    expect(proposalToPatch(proposal, { version: 1, north: 'up' }).notes.join(' ')).toMatch(/could not be read/);
  });
});
