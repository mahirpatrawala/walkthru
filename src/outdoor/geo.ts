// Small geometry helpers of the outdoor builder (SPEC 19). three only; runs under Node (the tests count triangles).
import * as THREE from 'three';
import type { Vec2 } from '../types';
import { mergeGeos } from '../look/gen/geo';

/** A flat polygon with holes at height `y`, normals up, UV = plan position / `tile` (so a texture's repeat does not depend on the polygon). */
export function flatGeometry(poly: Vec2[], holes: Vec2[][] | undefined, y: number, tile = 1): THREE.BufferGeometry {
  const contour = poly.map((p) => new THREE.Vector2(p.x, p.z));
  const hs = (holes ?? []).map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)));
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = [...poly, ...(holes ?? []).flat()];
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const t of tris) {
    const p = t.map((i) => all[i]);
    // face up whatever the winding
    const cy = (p[1].z - p[0].z) * (p[2].x - p[0].x) - (p[1].x - p[0].x) * (p[2].z - p[0].z);
    const order = cy >= 0 ? [0, 1, 2] : [0, 2, 1];
    for (const k of order) { pos.push(p[k].x, y, p[k].z); nor.push(0, 1, 0); uv.push(p[k].x / tile, p[k].z / tile); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** An axis-aligned box with flat normals and UV from the world position (top: x, z; sides: along, y), `tile` metres a repeat. */
export function boxGeometry(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tile = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ay > 0.5) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
    else if (ax > 0.5) uv.setXY(i, p.getZ(i) / tile, p.getY(i) / tile);
    else uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
  }
  return g;
}

/** A box laid along the segment a to b: `width` across, from `y0` to `y1`, its centre line pushed `offset` metres to the left of a to b (plan, x right and z down: left of the walker facing a to b). */
export function segmentBox(a: Vec2, b: Vec2, width: number, y0: number, y1: number, offset = 0, tile = 1): THREE.BufferGeometry {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const g = new THREE.BoxGeometry(len, y1 - y0, width).toNonIndexed();
  // uv before the transform: along the segment, up, across
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ay > 0.5) uv.setXY(i, p.getX(i) / tile + a.x / tile, p.getZ(i) / tile);
    else if (ax > 0.5) uv.setXY(i, p.getZ(i) / tile, p.getY(i) / tile);
    else uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
  }
  const yaw = Math.atan2(-dz, dx); // rotation about +y that turns +x into the segment's direction
  const lx = dz / (len || 1), lz = -dx / (len || 1); // left normal
  g.rotateY(yaw);
  g.translate((a.x + b.x) / 2 + lx * offset, (y0 + y1) / 2, (a.z + b.z) / 2 + lz * offset);
  return g;
}

/** A round column or post as a tube, with `sides` facets. */
export function tube(x: number, z: number, y0: number, y1: number, r: number, sides = 10, r1?: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1 ?? r, r, y1 - y0, sides, 1, false).toNonIndexed();
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

export { mergeGeos };

/** Everything in `list` as one geometry (null for an empty list). The inputs are disposed. */
export function mergeAndFree(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (list.length === 0) return null;
  const m = mergeGeos(list);
  for (const g of list) g.dispose();
  return m;
}

/** A closed outline of a rounded rectangle (for a jogging track or a pond): `seg` points a quarter circle. */
export function roundedRectOutline(x0: number, z0: number, x1: number, z1: number, r: number, seg = 6): Vec2[] {
  const out: Vec2[] = [];
  const corner = (cx: number, cz: number, a0: number): void => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r }); } };
  corner(x1 - r, z0 + r, -Math.PI / 2); // north-east
  corner(x1 - r, z1 - r, 0); // south-east
  corner(x0 + r, z1 - r, Math.PI / 2); // south-west
  corner(x0 + r, z0 + r, Math.PI); // north-west
  return out;
}

/** Reverses a polygon (for a hole, which the triangulator wants wound the other way). */
export const reversed = (p: Vec2[]): Vec2[] => [...p].reverse();
