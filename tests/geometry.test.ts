import { describe, expect, it } from 'vitest';
import {
  boxAxes, boxCorners, boxFromBackEdge, distanceToPolygon, distanceToSegment, mulberry32, pointInBox,
  pointInPolygon, polygonArea, polygonSelfIntersects, quatFromAxisAngle, quatFromUnitVectors, quatInvert,
  quatMul, rotateY, sideEdge,
} from '../src/core/geometry';
import { buildTruthProperty } from '../scripts/make-test-room';

const truth = buildTruthProperty('furnished');
const room = (id: string) => truth.layout.rooms.find((r) => r.id === id)!;
const bed = truth.furniture.find((f) => f.id === 'bed-1')!;

describe('polygons', () => {
  it('areas of the truth rooms', () => {
    expect(polygonArea(room('bedroom').polygon)).toBeCloseTo(20, 9);
    expect(polygonArea(room('balcony').polygon)).toBeCloseTo(4.5, 9);
    expect(polygonArea(room('passage').polygon)).toBeCloseTo(4.8, 9);
  });
  it('is signed: reversing flips the sign', () => {
    expect(polygonArea([...room('bedroom').polygon].reverse())).toBeCloseTo(-20, 9);
  });
  it('point in polygon, including an L shape', () => {
    const L = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }];
    expect(pointInPolygon({ x: 1, z: 3 }, L)).toBe(true);
    expect(pointInPolygon({ x: 3, z: 1 }, L)).toBe(true);
    expect(pointInPolygon({ x: 3, z: 3 }, L)).toBe(false);
    expect(pointInPolygon({ x: -1, z: 1 }, L)).toBe(false);
  });
  it('distances', () => {
    expect(distanceToSegment({ x: 1, z: 1 }, { x: 0, z: 0 }, { x: 2, z: 0 })).toBeCloseTo(1, 12);
    expect(distanceToSegment({ x: 5, z: 0 }, { x: 0, z: 0 }, { x: 2, z: 0 })).toBeCloseTo(3, 12);
    const p = room('bedroom').polygon;
    expect(distanceToPolygon({ x: 2, z: 2 }, p)).toBe(0);
    expect(distanceToPolygon({ x: 5, z: 2 }, p)).toBeCloseTo(1, 12);
  });
  it('self intersection', () => {
    expect(polygonSelfIntersects(room('bedroom').polygon)).toBe(false);
    const L = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }];
    expect(polygonSelfIntersects(L)).toBe(false);
    const bowtie = [{ x: 0, z: 0 }, { x: 4, z: 4 }, { x: 4, z: 0 }, { x: 0, z: 4 }];
    expect(polygonSelfIntersects(bowtie)).toBe(true);
    const spike = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 3 }];
    expect(polygonSelfIntersects(spike)).toBe(true);
  });
});

describe('boxes', () => {
  it('truth bed corners are back-left, back-right, front-right, front-left', () => {
    const c = boxCorners(bed.box);
    const want = [{ x: 0, z: 3 }, { x: 0, z: 1.5 }, { x: 2, z: 1.5 }, { x: 2, z: 3 }];
    c.forEach((p, i) => {
      expect(p.x).toBeCloseTo(want[i].x, 9);
      expect(p.z).toBeCloseTo(want[i].z, 9);
    });
  });
  it('axes follow the frame in 3.1', () => {
    const { a, b } = boxAxes({ cx: 0, cz: 0, w: 1, d: 1, yawDeg: 90 });
    expect(a.x).toBeCloseTo(1, 12); expect(a.z).toBeCloseTo(0, 12);
    expect(b.x).toBeCloseTo(0, 12); expect(b.z).toBeCloseTo(-1, 12);
  });
  it('boxFromBackEdge: the 3-click tag', () => {
    const b = boxFromBackEdge({ x: 0, z: 1.5 }, { x: 0, z: 3.0 }, { x: 1.2, z: 2 });
    expect(b.w).toBeCloseTo(1.5, 9);
    expect(b.d).toBeCloseTo(1.2, 9);
    expect(((b.yawDeg % 360) + 360) % 360).toBeCloseTo(90, 6);
    expect(b.cx).toBeCloseTo(0.6, 9);
    expect(b.cz).toBeCloseTo(2.25, 9);
  });
  it('boxFromBackEdge: clicking the other end order or side still faces the front point', () => {
    const b = boxFromBackEdge({ x: 0, z: 3.0 }, { x: 0, z: 1.5 }, { x: 1.2, z: 2 });
    expect(b.yawDeg).toBeCloseTo(90, 6);
    expect(b.cx).toBeCloseTo(0.6, 9);
    const c = boxFromBackEdge({ x: 4, z: 1 }, { x: 4, z: 3 }, { x: 3, z: 2 });
    expect(c.yawDeg).toBeCloseTo(270, 6);
    expect(c.cx).toBeCloseTo(3.5, 9);
  });
  it('pointInBox with shrink', () => {
    expect(pointInBox({ x: 1, z: 2.25 }, bed.box)).toBe(true);
    expect(pointInBox({ x: 2.01, z: 2.25 }, bed.box)).toBe(false);
    expect(pointInBox({ x: 1.99, z: 2.25 }, bed.box, 0.03)).toBe(false);
    expect(pointInBox({ x: 1.95, z: 2.25 }, bed.box, 0.03)).toBe(true);
  });
  it('side edges: left of the truth bed faces +Z', () => {
    const left = sideEdge(bed.box, 'left');
    expect(left.normal.x).toBeCloseTo(0, 12);
    expect(left.normal.z).toBeCloseTo(1, 12);
    expect(left.mid.z).toBeCloseTo(3.0, 12);
    expect(left.half).toBeCloseTo(1.0, 12);
    const back = sideEdge(bed.box, 'back');
    expect(back.normal.x).toBeCloseTo(-1, 12);
    expect(back.mid.x).toBeCloseTo(0, 12);
    expect(back.half).toBeCloseTo(0.75, 12);
    const front = sideEdge(bed.box, 'front');
    expect(front.mid.x).toBeCloseTo(2, 12);
  });
});

describe('quaternions', () => {
  it('rotates about an axis and inverts', () => {
    const q = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const v = rotateY(q, { x: 0, y: 0, z: 1 });
    expect(v.x).toBeCloseTo(1, 12); expect(v.y).toBeCloseTo(0, 12); expect(v.z).toBeCloseTo(0, 12);
    const back = rotateY(quatInvert(q), v);
    expect(back.z).toBeCloseTo(1, 12);
  });
  it('quatMul applies the right-hand quaternion first', () => {
    const rx = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2);
    const ry = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const via = rotateY(rx, rotateY(ry, { x: 1, y: 0, z: 0 }));
    const comp = rotateY(quatMul(rx, ry), { x: 1, y: 0, z: 0 });
    expect(comp.x).toBeCloseTo(via.x, 12); expect(comp.y).toBeCloseTo(via.y, 12); expect(comp.z).toBeCloseTo(via.z, 12);
  });
  it('quatFromUnitVectors, including the opposite and parallel cases', () => {
    const cases: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0.6, 0, 0.8]];
    for (const [x, y, z] of cases) {
      const q = quatFromUnitVectors({ x: 0, y: 0, z: 1 }, { x, y, z });
      const r = rotateY(q, { x: 0, y: 0, z: 1 });
      expect(r.x).toBeCloseTo(x, 9); expect(r.y).toBeCloseTo(y, 9); expect(r.z).toBeCloseTo(z, 9);
      expect(Math.hypot(...q)).toBeCloseTo(1, 9);
    }
    const q = quatFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
    const r = rotateY(q, { x: 1, y: 0, z: 0 });
    expect(r.x).toBeCloseTo(-1, 9);
  });
});

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
