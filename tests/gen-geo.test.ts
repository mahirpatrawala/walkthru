// Geometry helpers of the style generators: winding agrees with the normals, sizes are exact.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { chamferBox, fluteStrip, grainUV, prism, roundedRectOutline, triCount } from '../src/look/gen/geo';

/** triangles whose winding disagrees with their vertex normals */
function windingErrors(g: THREE.BufferGeometry): number {
  const p = g.attributes.position, n = g.attributes.normal;
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i);
  let bad = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
    const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (fn.lengthSq() < 1e-14) continue;
    const vn = new THREE.Vector3().fromBufferAttribute(n, idx[i]).add(new THREE.Vector3().fromBufferAttribute(n, idx[i + 1])).add(new THREE.Vector3().fromBufferAttribute(n, idx[i + 2]));
    if (fn.dot(vn) < 0) bad++;
  }
  return bad;
}
const box = (g: THREE.BufferGeometry): THREE.Box3 => { g.computeBoundingBox(); return g.boundingBox!.clone(); };

describe('chamferBox', () => {
  it('spans exactly the given box and is wound outward', () => {
    const g = chamferBox(-0.5, 0.5, 0, 1, -0.3, 0.3, 0.02);
    const b = box(g);
    expect(b.min.x).toBeCloseTo(-0.5, 6); expect(b.max.x).toBeCloseTo(0.5, 6);
    expect(b.min.y).toBeCloseTo(0, 6); expect(b.max.y).toBeCloseTo(1, 6);
    expect(b.min.z).toBeCloseTo(-0.3, 6); expect(b.max.z).toBeCloseTo(0.3, 6);
    expect(triCount(g)).toBe(44);
    expect(windingErrors(g)).toBe(0);
  });
  it('with no chamfer is a plain 12-triangle box', () => {
    const g = chamferBox(0, 1, 0, 1, 0, 1, 0);
    expect(triCount(g)).toBe(12);
    expect(windingErrors(g)).toBe(0);
  });
  it('clamps a chamfer larger than the part (a thin slat never inverts)', () => {
    const g = chamferBox(0, 0.03, 0, 2, 0, 0.02, 0.05);
    const b = box(g);
    expect(b.max.x - b.min.x).toBeCloseTo(0.03, 6);
    expect(windingErrors(g)).toBe(0);
  });
});

describe('prism and flutes', () => {
  it('a rounded prism is wound outward, spans its outline and its height', () => {
    const g = prism(roundedRectOutline(-1, 1, -0.8, 0.8, [0.1, 0.1, 0.1, 0.1], 4), 0, 0.03, 0.01);
    const b = box(g);
    expect(b.min.x).toBeCloseTo(-1, 6); expect(b.max.x).toBeCloseTo(1, 6);
    expect(b.min.z).toBeCloseTo(-0.8, 6); expect(b.max.z).toBeCloseTo(0.8, 6);
    expect(b.max.y).toBeCloseTo(0.03, 6);
    expect(windingErrors(g)).toBe(0);
  });
  it('a prism has a top face that covers its outline (the cap is not lost)', () => {
    const g = prism(roundedRectOutline(-1.3, 1.3, -1.29, 1.29, [0.06, 0.06, 0.06, 0.06], 6), 0, 0.025, 0.0125);
    const p = g.attributes.position, idx = Array.from(g.index!.array);
    let area = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, idx[i]), b = new THREE.Vector3().fromBufferAttribute(p, idx[i + 1]), c = new THREE.Vector3().fromBufferAttribute(p, idx[i + 2]);
      const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (fn.y > 0 && fn.y > 0.99 * fn.length()) area += fn.y / 2;
    }
    // the rectangle less its corners and less the bevel band
    expect(area).toBeGreaterThan(2.6 * 2.58 * 0.97 - 0.2);
    expect(area).toBeLessThan(2.6 * 2.58);
  });
  it('rounded outlines run counter-clockwise and stay inside their rectangle', () => {
    const o = roundedRectOutline(0, 2, 0, 1, [0.2, 0, 0.2, 0], 4);
    let a2 = 0;
    for (let i = 0; i < o.length; i++) { const [x0, z0] = o[i], [x1, z1] = o[(i + 1) % o.length]; a2 += x0 * z1 - x1 * z0; }
    expect(a2).toBeGreaterThan(0);
    for (const [x, z] of o) { expect(x).toBeGreaterThanOrEqual(-1e-9); expect(x).toBeLessThanOrEqual(2 + 1e-9); expect(z).toBeGreaterThanOrEqual(-1e-9); expect(z).toBeLessThanOrEqual(1 + 1e-9); }
  });
  it('an outline whose corner radii meet has no repeated point (a window seat with a half-round end)', () => {
    const o = roundedRectOutline(-0.8, 0.8, -0.23, 0.23, [0.23, 0, 0, 0.23], 8);
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(1e-4);
    }
    // the cap of its prism stays inside the outline
    const g = prism(o, 0.35, 0.45, 0.03);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeGreaterThanOrEqual(-0.8 - 1e-6);
    expect(g.boundingBox!.max.x).toBeLessThanOrEqual(0.8 + 1e-6);
  });
  it('a square-cornered prism is wound outward too', () => {
    expect(windingErrors(prism(roundedRectOutline(-1, 1, -0.8, 0.8, [0, 0, 0, 0], 4), 0, 0.03, 0.01))).toBe(0);
  });
  it('a flute strip fills its width and height, ribs stand out by their depth', () => {
    const g = fluteStrip(0.5, 0.4, 0.02, 0.008);
    const b = box(g);
    expect(b.max.x - b.min.x).toBeCloseTo(0.5, 6);
    expect(b.max.y - b.min.y).toBeCloseTo(0.4, 6);
    expect(b.max.z).toBeLessThanOrEqual(0.008 + 1e-9);
    expect(windingErrors(g)).toBe(0);
  });
});

describe('grainUV', () => {
  it('runs the grain (v) along the part\'s long axis', () => {
    // a long shelf along x: on its top, v follows x; on its front, v follows x too
    const g = chamferBox(0, 2, 0, 0.03, 0, 0.4, 0).toNonIndexed();
    grainUV(g, 1, 'x');
    const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(n.getY(i)) > 0.9 || Math.abs(n.getZ(i)) > 0.9) expect(uv.getY(i)).toBeCloseTo(p.getX(i), 6);
    }
  });
  it('keeps a door\'s grain up and down by default', () => {
    const g = chamferBox(0, 0.45, 0, 2, 0, 0.018, 0).toNonIndexed();
    grainUV(g, 1, 'y');
    const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) if (Math.abs(n.getZ(i)) > 0.9) expect(uv.getY(i)).toBeCloseTo(p.getY(i), 6);
  });
});
