// Every piece is drawn exactly its row's size (SPEC 16.2 rule 1): the pool-side and garden generators build a piece the way a joiner would, then this
// brings its bounding box to the item's width, depth and height by the few millimetres a round rail or a splayed leg would otherwise add or lack.
// Parts named `skip` (a parasol's canopy, which reaches beyond its base on purpose) are neither measured nor scaled.
import * as THREE from 'three';

export function fitToBox(g: THREE.Group, size: { w: number; d: number; h: number }, lift = 0, skip: RegExp | null = null): THREE.Group {
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3();
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(skip && skip.test(m.name))) bb.union(new THREE.Box3().setFromObject(m)); });
  if (bb.isEmpty()) return g;
  const sx = size.w / Math.max(1e-6, bb.max.x - bb.min.x), sz = size.d / Math.max(1e-6, bb.max.z - bb.min.z), sy = (size.h - lift) / Math.max(1e-6, bb.max.y - bb.min.y);
  const cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (skip && skip.test(m.name))) return;
    m.geometry.translate(-cx, -bb.min.y, -cz);
    m.geometry.scale(sx, sy, sz);
    m.geometry.translate(0, lift, 0);
  });
  // the skipped parts follow the base they sit on
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !(skip && skip.test(m.name))) return;
    m.geometry.translate(-cx, 0, -cz);
  });
  return g;
}
