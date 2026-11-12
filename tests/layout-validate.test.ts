import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { createEmptyProperty, normalizeRoom, validateLayout, validateProperty } from '../src/core/layout-validate';
import { computeTunnels } from '../src/core/layout-geom';
import { polygonArea } from '../src/core/geometry';
import type { Layout, RoomTag } from '../src/types';

const truthProp = buildTruthProperty('furnished');
const clone = (): Layout => JSON.parse(JSON.stringify(truthProp.layout));

describe('validateLayout', () => {
  it('the truth layout has no errors and no warnings', () => {
    expect(validateLayout(truthProp.layout)).toEqual({ errors: [], warnings: [] });
  });
  it('an opening pushed off its edge is an error', () => {
    const l = clone();
    l.openings[0].centreM = 3.9; // 0.9 wide on a 4 m edge
    expect(validateLayout(l).errors.length).toBe(1);
  });
  it('an opening on a missing room or edge is an error', () => {
    const l = clone();
    l.openings.push({ id: 'x', roomId: 'nope', edge: 0, type: 'door', centreM: 1, widthM: 0.9, sillM: 0, headM: 2.1 });
    l.openings.push({ id: 'y', roomId: 'bedroom', edge: 9, type: 'door', centreM: 1, widthM: 0.9, sillM: 0, headM: 2.1 });
    expect(validateLayout(l).errors.length).toBe(2);
  });
  it('a bow-tie polygon is an error', () => {
    const l = clone();
    l.rooms[0].polygon = [{ x: 0, z: 0 }, { x: 4, z: 5 }, { x: 4, z: 0 }, { x: 0, z: 5 }];
    expect(validateLayout(l).errors.some((e) => /crosses itself/.test(e))).toBe(true);
  });
  it('two overlapping rooms are an error, a 0.04 m² sliver is not', () => {
    const l = clone();
    l.rooms[2].polygon = l.rooms[2].polygon.map((p) => ({ x: p.x, z: p.z - 0.5 })); // passage now overlaps the bedroom by 4 x 0.38
    const e = validateLayout(l).errors;
    expect(e.some((m) => /overlap by 1\.52/.test(m))).toBe(true);
    const l2 = clone();
    l2.rooms[2].polygon = l2.rooms[2].polygon.map((p) => ({ x: p.x, z: p.z - 0.12 - 0.01 })); // 4 x 0.01 = 0.04 m²
    expect(validateLayout(l2).errors).toEqual([]);
  });
  it('overlap works for concave rooms', () => {
    const l = clone();
    l.rooms = [
      { id: 'L', roomType: 'living', label: 'L', polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }], edges: ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'] },
      // sits in the notch (no overlap)
      { id: 'N', roomType: 'other', label: 'N', polygon: [{ x: 2.1, z: 2.1 }, { x: 4, z: 2.1 }, { x: 4, z: 4 }, { x: 2.1, z: 4 }], edges: ['wall', 'wall', 'wall', 'wall'] },
      // pokes 1 x 1 into the L's leg
      { id: 'P', roomType: 'other', label: 'P', polygon: [{ x: 0.5, z: 3 }, { x: 1.5, z: 3 }, { x: 1.5, z: 5 }, { x: 0.5, z: 5 }], edges: ['wall', 'wall', 'wall', 'wall'] },
    ];
    l.openings = [];
    const e = validateLayout(l).errors;
    expect(e.length).toBe(1);
    expect(e[0]).toMatch(/L and P overlap by 1 m/);
  });
  it('a 1.6 m door is a warning, not an error', () => {
    const l = clone();
    l.openings[0].widthM = 1.6;
    l.openings[0].centreM = 2;
    const r = validateLayout(l);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toContain('Door 1.6 m wide. Check the scale.');
  });
  it('other warnings: tiny room, huge room, wall height, disagreement, no way out', () => {
    const l = clone();
    l.wallHeightM = 2.0;
    l.underlay!.disagreementPct = 4;
    l.rooms.push({ id: 'closet', roomType: 'other', label: 'Closet', polygon: [{ x: 10, z: 0 }, { x: 11, z: 0 }, { x: 11, z: 1 }, { x: 10, z: 1 }], edges: ['wall', 'wall', 'wall', 'wall'] });
    l.rooms.push({ id: 'hall', roomType: 'other', label: 'Hall', polygon: [{ x: 20, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 7 }, { x: 20, z: 7 }], edges: ['wall', 'wall', 'wall', 'wall'] });
    const w = validateLayout(l).warnings.join('\n');
    expect(w).toMatch(/Closet is only 1 m²/);
    expect(w).toMatch(/Closet has no door/);
    expect(w).toMatch(/Hall is 70 m²/);
    expect(w).toMatch(/Wall height 2 m is unusual/);
    expect(w).toMatch(/disagree by 4%/);
    expect(w).not.toMatch(/Balcony has no door/);
    expect(computeTunnels(l).length).toBe(4);
  });
});

describe('normalizeRoom', () => {
  const cw: RoomTag = {
    id: 'r', roomType: 'other', label: 'r',
    polygon: [{ x: 0, z: 0 }, { x: 0, z: 3 }, { x: 4, z: 3 }, { x: 4, z: 0 }],
    edges: ['wall', 'railing', 'none', 'wall'],
  };
  it('reverses a negative-area polygon and keeps each segment its edge kind', () => {
    expect(polygonArea(cw.polygon)).toBeLessThan(0);
    const r = normalizeRoom(cw);
    expect(polygonArea(r.polygon)).toBeCloseTo(12, 9);
    // old edge 1 was (0,3)->(4,3) 'railing'; in the new polygon that segment runs (4,3)->(0,3)
    const n = r.polygon.length;
    for (let i = 0; i < n; i++) {
      const a = r.polygon[i], b = r.polygon[(i + 1) % n];
      if (a.x === 4 && a.z === 3 && b.x === 0 && b.z === 3) expect(r.edges[i]).toBe('railing');
      if (a.x === 4 && a.z === 0 && b.x === 4 && b.z === 3) expect(r.edges[i]).toBe('none');
    }
  });
  it('leaves a positive polygon alone', () => {
    const ok = buildTruthProperty('empty').layout.rooms[0];
    expect(normalizeRoom(ok)).toBe(ok);
  });
});

describe('property files', () => {
  it('createEmptyProperty is valid JSON the validator accepts', () => {
    const p = createEmptyProperty('abc');
    expect(p.id).toBe('abc');
    expect(p.layout.wallHeightM).toBe(2.75);
    expect(validateProperty(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it('validateProperty round-trips both truth properties', () => {
    for (const v of ['empty', 'furnished'] as const) {
      const p = buildTruthProperty(v);
      expect(validateProperty(JSON.parse(JSON.stringify(p)))).toEqual(JSON.parse(JSON.stringify(p)));
    }
  });
  it('throws readable messages', () => {
    expect(() => validateProperty(null)).toThrow(/JSON object/);
    expect(() => validateProperty({ version: 2 })).toThrow(/version/);
    const bad = JSON.parse(JSON.stringify(truthProp));
    bad.layout.rooms[1].roomType = 'garage';
    expect(() => validateProperty(bad)).toThrow(/layout\.rooms\[1\]\.roomType must be one of/);
    const bad2 = JSON.parse(JSON.stringify(truthProp));
    bad2.layout.rooms[0].polygon[2] = { x: 'a' };
    expect(() => validateProperty(bad2)).toThrow(/polygon\[2\] must be \{x, z\} numbers/);
    const bad3 = JSON.parse(JSON.stringify(truthProp));
    bad3.layout.rooms[0].edges.pop();
    expect(() => validateProperty(bad3)).toThrow(/edges has 3 entries for 4 corners/);
  });
  it('a clockwise room is normalised and its openings stay where they were drawn', () => {
    const p = JSON.parse(JSON.stringify(truthProp));
    const room = p.layout.rooms[0]; // bedroom, edges: 0 north, 1 east, 2 south, 3 west
    room.polygon = [...room.polygon].reverse();            // now clockwise: (0,5),(4,5),(4,0),(0,0)
    room.edges = ['wall', 'wall', 'wall', 'wall'];
    // door was on z = 5 from x 0.4..1.3. In the clockwise polygon that is edge 0 (0,5)->(4,5), centre x 0.85
    p.layout.openings[0] = { ...p.layout.openings[0], edge: 0, centreM: 0.85 };
    const out = validateProperty(p);
    expect(polygonArea(out.layout.rooms[0].polygon)).toBeCloseTo(20, 9);
    const r = out.layout.rooms[0];
    const o = out.layout.openings[0];
    const a = r.polygon[o.edge], b = r.polygon[(o.edge + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const dirx = (b.x - a.x) / len, dirz = (b.z - a.z) / len;
    const cx = a.x + dirx * o.centreM, cz = a.z + dirz * o.centreM;
    expect(cx).toBeCloseTo(0.85, 9);
    expect(cz).toBeCloseTo(5, 9);
  });
});
