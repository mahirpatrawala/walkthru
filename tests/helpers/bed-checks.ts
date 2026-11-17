// What may lie on a bed, and that a person lying on it rests their head on a pillow with nothing reaching into them.
// Shared by the tests of every bed builder (the style generator, the classic bed, the grey-box bed).
import * as THREE from 'three';
import { expect } from 'vitest';
import { QUILT_PROUD_M } from '../../src/core/bed-layout';
import { boxAxes } from '../../src/core/geometry';
import { liePose } from '../../src/core/poses';
import type { FurnitureItem } from '../../src/types';

/** mattress widths (m): single, double, queen, king; each on a frame 5 cm wider all round */
export const BED_SIZES: { name: string; w: number; d: number; pillows: 1 | 2 }[] = [
  { name: 'single', w: 0.9, d: 1.9, pillows: 1 },
  { name: 'double', w: 1.37, d: 1.9, pillows: 2 },
  { name: 'queen', w: 1.52, d: 1.98, pillows: 2 },
  { name: 'king', w: 1.83, d: 1.98, pillows: 2 },
];
export const YAWS = [0, 90, 180, 270];
/** anything with one of these in its name is not a mattress, a quilt or a sleeping pillow */
export const ACCENT_RE = /cushion|bolster|throw|runner|fold|roll|tray|book/i;
const PILLOW_RE = /^pillow/i;

export function bedOf(size: { w: number; d: number }, yawDeg = 0, withInner = true): FurnitureItem {
  const box = withInner ? { cx: 3, cz: 4, w: size.w + 0.1, d: size.d + 0.1, yawDeg } : { cx: 3, cz: 4, w: size.w, d: size.d, yawDeg };
  return { id: 'bed-t', source: 'real', kind: 'bed', label: 'Bed', box, heightM: 0.9, surfaceHeightM: 0.5, ...(withInner ? { inner: { w: size.w, d: size.d } } : {}) };
}

const meshes = (g: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  g.updateMatrixWorld(true);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
};

/** how many separate bodies a mesh holds (a builder may merge two pillows into one mesh): groups of triangles that share a corner position */
export function islands(m: THREE.Mesh): number {
  const pos = m.geometry.attributes.position;
  const idx = m.geometry.index;
  const id = new Map<string, number>();
  const parent: number[] = [];
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const node = (i: number): number => {
    const k = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
    let n = id.get(k);
    if (n === undefined) { n = parent.length; parent.push(n); id.set(k, n); }
    return n;
  };
  const count = idx ? idx.count : pos.count;
  for (let t = 0; t < count; t += 3) {
    const [p, q, r] = [0, 1, 2].map((k) => find(node(idx ? idx.getX(t + k) : t + k)));
    parent[q] = p; parent[find(r)] = p;
  }
  return new Set(parent.map((_, i) => find(i))).size;
}

/** how many separate pillows the bed carries */
export function pillowCount(g: THREE.Object3D): number {
  return meshes(g).filter((x) => PILLOW_RE.test(x.name)).reduce((n, m) => n + islands(m), 0);
}

/** a bed carries a mattress, a quilt and `pillows` sleeping pillows; nothing with an accent's name */
export function expectPlainBed(g: THREE.Object3D, pillows: number): void {
  const names = meshes(g).map((m) => m.name);
  expect(names.filter((n) => ACCENT_RE.test(n)), `accent parts on the bed: ${names.join(' ')}`).toEqual([]);
  expect(pillowCount(g)).toBe(pillows);
}

/**
 * A person `H` tall lies on the bed from each side: their body (a box 0.5 m wide, H long, 0.25 m high, resting on the quilt) meets nothing
 * of the bed but a pillow, and the middle of their head is over a pillow. `g` is the bed's group as placed in the world.
 */
export function expectLieClear(g: THREE.Object3D, item: FurnitureItem, H = 1.75): void {
  const { a, b } = boxAxes(item.box);
  const S = item.surfaceHeightM;
  const all = meshes(g);
  const pillows = all.filter((m) => PILLOW_RE.test(m.name));
  expect(pillows.length).toBeGreaterThan(0);
  for (const side of [-1, 1]) {
    const approach = { x: item.box.cx + b.x * side * 2, z: item.box.cz + b.z * side * 2 };
    const pose = liePose(item, H, approach);
    expect(pose.surfaceY).toBe(S);
    const head = { x: pose.feet.x - a.x * H, z: pose.feet.z - a.z * H };
    const corners = [head, pose.feet].flatMap((p) => [-0.25, 0.25].map((u) => new THREE.Vector3(p.x + b.x * u, 0, p.z + b.z * u)));
    const body = new THREE.Box3().setFromPoints(corners);
    body.min.y = S + QUILT_PROUD_M + 0.002;
    body.max.y = S + 0.25;
    for (const m of all) {
      if (PILLOW_RE.test(m.name)) continue;
      const bb = new THREE.Box3().setFromObject(m);
      expect(bb.intersectsBox(body), `${m.name} reaches into a person lying on the bed (yaw ${item.box.yawDeg}, side ${side})`).toBe(false);
    }
    // the middle of the head (0.11 m below the crown) is over a pillow, and the pillow is low enough to rest a head on
    const hp = new THREE.Vector3(head.x + a.x * 0.11, 5, head.z + a.z * 0.11);
    const hit = new THREE.Raycaster(hp, new THREE.Vector3(0, -1, 0)).intersectObjects(pillows, false)[0];
    expect(hit, `no pillow under the head (yaw ${item.box.yawDeg}, side ${side})`).toBeTruthy();
    expect(hit.point.y).toBeGreaterThan(S + 0.03);
    expect(hit.point.y).toBeLessThan(S + 0.11);
    // and the whole body is on the mattress (a person as long as the mattress keeps their head 5 cm inside it and overhangs the foot by the rest)
    const L = item.inner ?? item.box;
    const along = (p: { x: number; z: number }): number => (p.x - item.box.cx) * a.x + (p.z - item.box.cz) * a.z;
    expect(along(head)).toBeGreaterThanOrEqual(-L.d / 2 + 0.05 - 1e-6);
    expect(along(pose.feet)).toBeLessThanOrEqual(L.d / 2 + Math.max(0, H + 0.05 - L.d) + 1e-6);
  }
}
