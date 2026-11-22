// SPEC 16.24, second pass: the soft parts of a sofa or armchair at 2K. Seat and back pads are separate crowned forms with rounded corners and a cord round their top
// edge, the arms carry a soft pad on top, scatter cushions are pinched at the corners like a stuffed case. Every part stays inside the box the plain builder draws
// (exact bounds: the pads are shrunk, never grown), and a scatter cushion is the same thickness and place as before (16.2, and the sitter-clear rule of src/core/poses.ts).
import * as THREE from 'three';
import { softCushion } from './soft';
import { shade } from './core';
import type { MatSpec, Parts } from './core';
import { rod } from './geo';

/** a crowned pad: the middle of every face reaches the bound, the edges are `puff` inside it, corners rounded `r` */
export function crownedPad(w: number, h: number, d: number, r: number, puff: number): THREE.BufferGeometry {
  return softCushion(w, h, d, { r: Math.min(r, Math.min(w, h, d) / 2.2), puff, seg: 5 });
}

/** the corners of a stuffed case drawn in (only inward): w along x, h along y; `k` is the share taken off a corner */
export function pinchCorners(g: THREE.BufferGeometry, w: number, h: number, k: number): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / (w / 2), v = pos.getY(i) / (h / 2);
    const f = 1 - k * Math.pow(Math.abs(u) * Math.abs(v), 1.4);
    pos.setX(i, pos.getX(i) * f); pos.setY(i, pos.getY(i) * f);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** a cord along the top edge of a seat pad: the front and both sides, 5.5 mm thick, just inside the crown */
export function padCord(parts: Parts, fab: MatSpec, cx: number, wd: number, yTop: number, z0: number, z1: number): void {
  const cord = shade(fab, 0.78), y = yTop - 0.013, x0 = cx - wd / 2 + 0.012, x1 = cx + wd / 2 - 0.012;
  parts.put('sofa-piping', cord, rod({ x: x0, y, z: z1 - 0.0055 }, { x: x1, y, z: z1 - 0.0055 }, 0.0055, 12), { noShadow: true });
  for (const x of [x0, x1]) parts.put('sofa-piping', cord, rod({ x, y, z: z0 + 0.03 }, { x, y, z: z1 - 0.0055 }, 0.0055, 12), { noShadow: true });
}
