// SPEC 16.15 "crisp furniture": the shared soft-furnishing and loft helpers keep exact bounds, close their surfaces and have clean normals.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { softCushion } from '../src/look/gen/soft';
import { boardOffset, loft, taperedLeg } from '../src/look/gen/geo';

const bounds = (g: THREE.BufferGeometry): THREE.Box3 => { g.computeBoundingBox(); return g.boundingBox as THREE.Box3; };

describe('softCushion', () => {
  for (const [w, h, d, puff, r] of [[0.6, 0.2, 0.55, 0.014, 0.055], [0.46, 0.13, 0.46, 0.04, 0.06], [1.5, 0.22, 0.9, 0, 0.04], [0.4, 0.4, 0.14, 0.035, 0.07]] as const) {
    it(`fills exactly ${w} x ${h} x ${d} (puff ${puff})`, () => {
      const b = bounds(softCushion(w, h, d, { r, puff, seg: 3 }));
      expect(b.max.x - b.min.x).toBeCloseTo(w, 4);
      expect(b.max.y - b.min.y).toBeCloseTo(h, 4);
      expect(b.max.z - b.min.z).toBeCloseTo(d, 4);
    });
  }
  it('is one welded surface: no vertex repeated, every normal unit length and pointing out of the centre', () => {
    const g = softCushion(0.6, 0.2, 0.55, { r: 0.05, puff: 0.012, seg: 2 });
    const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
    const seen = new Set<string>();
    for (let i = 0; i < p.count; i++) {
      seen.add(`${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`);
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
      expect(n.getX(i) * p.getX(i) + n.getY(i) * p.getY(i) + n.getZ(i) * p.getZ(i)).toBeGreaterThan(0);
    }
    expect(seen.size).toBe(p.count);
  });
  it('the edges of a face are drawn in below its middle (a crown), the box stays exact', () => {
    const g = softCushion(0.6, 0.2, 0.55, { r: 0.05, puff: 0.02, seg: 3 });
    const p = g.attributes.position as THREE.BufferAttribute;
    let topMid = -1, topEdge = -1;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getX(i)) < 0.12 && Math.abs(p.getZ(i)) < 0.12) topMid = Math.max(topMid, p.getY(i));
      if (Math.abs(p.getX(i)) > 0.26 && p.getY(i) > 0.05) topEdge = Math.max(topEdge, p.getY(i));
    }
    expect(bounds(g).max.y).toBeCloseTo(0.1, 5);
    expect(topMid).toBeGreaterThan(0.098);
    expect(topEdge).toBeLessThan(topMid - 0.008);
  });
});

describe('loft', () => {
  const secs = [{ y: 0, w: 0.2, d: 0.34, zc: -0.02 }, { y: 0.2, w: 0.37, d: 0.62, zc: 0.05 }, { y: 0.4, w: 0.38, d: 0.66, zc: 0.03 }];
  it('has the exact width, depth and height of its sections', () => {
    const { body, cap } = loft(secs, 32);
    const b = bounds(body).union(bounds(cap));
    expect(b.max.x - b.min.x).toBeCloseTo(0.38, 4);
    expect(b.max.z - b.min.z).toBeCloseTo(0.66 + 0.0, 2);
    expect(b.max.y).toBeCloseTo(0.4, 5);
    expect(b.min.y).toBeCloseTo(0, 5);
  });
  it('has outward normals on the sides and an upward cap', () => {
    const { body, cap } = loft(secs, 32);
    const p = body.attributes.position as THREE.BufferAttribute, n = body.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 7) expect(n.getX(i) * p.getX(i) + n.getZ(i) * (p.getZ(i) - 0.03)).toBeGreaterThan(-0.02);
    const cn = cap.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < cn.count; i++) expect(cn.getY(i)).toBe(1);
  });
});

describe('legs and boards', () => {
  it('a tapered leg stands on the floor with exact extremes', () => {
    const b = bounds(taperedLeg(0.5, -0.3, 0.12, 0.027, 0.016, 12));
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(0.12, 6);
    expect(b.max.x - b.min.x).toBeCloseTo(0.054, 4);
  });
  it('a board keeps the same grain offset on every build and boards of one wood differ', () => {
    const a = new THREE.BoxGeometry(1, 0.02, 0.4).translate(0, 0.5, 0), c = new THREE.BoxGeometry(1, 0.02, 0.4).translate(0, 0.9, 0.5);
    expect(boardOffset(a)).toEqual(boardOffset(a.clone()));
    expect(boardOffset(a)).not.toEqual(boardOffset(c));
  });
});
