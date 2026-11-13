// C12f. SPEC 17.14: what the app knows about the view, as plain geometry. Wall faces and furniture boxes become triangles
// (for hidden-line tests) and edges (for the guide image and the size check). Pure: three is used for matrices only, so this
// runs under Node and the tests can render a synthetic frame from the same data the browser uses.
import * as THREE from 'three';
import { boxCorners } from '../core/geometry';
import { computeEdgeFrames, computeWallPieces, pieceRect } from '../core/layout-geom';
import type { FurnitureItem, Layout } from '../types';

export type V3 = [number, number, number];
export interface Seg { a: V3; b: V3; group: string }
/** One solid (a wall piece or a furniture box): 12 triangles, 9 numbers each, and its bounds. */
export interface Solid { group: string; tris: Float32Array; min: V3; max: V3 }
export interface PhotoGeometry { solids: Solid[]; segs: Seg[]; itemIds: string[] }

export const WALL_GROUP = 'wall';
export const itemGroup = (id: string): string => `item:${id}`;
export const isItemGroup = (g: string): boolean => g.startsWith('item:');

/** corners of the bottom loop c[0..3] (plan) from y0 to y1 -> 8 vertices, bottom 0..3 then top 4..7 */
function boxVerts(c: { x: number; z: number }[], y0: number, y1: number): V3[] {
  return [...c.map((p) => [p.x, y0, p.z] as V3), ...c.map((p) => [p.x, y1, p.z] as V3)];
}
const FACES: [number, number, number, number][] = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
const BOX_EDGES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

function solidOf(group: string, v: V3[]): Solid {
  const tris: number[] = [];
  for (const [a, b, c, d] of FACES) tris.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of v) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  return { group, tris: Float32Array.from(tris), min, max };
}

/**
 * Walls (the two long faces of every wall piece, so a wall seen from either side has its edges) and one box per furniture
 * item at its real size. The 3D walk-through's own geometry is the source: the same pieces buildShell draws.
 */
export function buildPhotoGeometry(layout: Layout, items: FurnitureItem[]): PhotoGeometry {
  const solids: Solid[] = [];
  const segs: Seg[] = [];
  const frames = computeEdgeFrames(layout);
  const frameOf = new Map(frames.map((f) => [`${f.roomId}:${f.edge}`, f]));
  for (const p of computeWallPieces(layout)) {
    const f = frameOf.get(`${p.roomId}:${p.edge}`);
    if (!f) continue;
    const rect = pieceRect(f, p);
    const v = boxVerts(rect, p.y0, p.y1);
    solids.push(solidOf(WALL_GROUP, v));
    // the near face (index 0 = u0, u1 edge at outward 0) and the far face (outward = thickness): their four edges each
    const face = (i0: number, i1: number): void => {
      const a = [v[i0], v[i1], v[i1 + 4], v[i0 + 4]];
      for (let k = 0; k < 4; k++) segs.push({ a: a[k], b: a[(k + 1) % 4], group: WALL_GROUP });
    };
    face(0, 1);
    if (p.thickness > 0.001) face(3, 2);
  }
  for (const it of items) {
    const v = boxVerts(boxCorners(it.box), 0, it.heightM);
    const g = itemGroup(it.id);
    solids.push(solidOf(g, v));
    for (const [i, j] of BOX_EDGES) segs.push({ a: v[i], b: v[j], group: g });
  }
  return { solids, segs, itemIds: items.map((i) => i.id) };
}

// ---------------------------------------------------------------- ray test

function rayHitsAabb(o: V3, d: V3, maxT: number, min: V3, max: V3): boolean {
  let t0 = 0;
  let t1 = maxT;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) { if (o[k] < min[k] || o[k] > max[k]) return false; continue; }
    let a = (min[k] - o[k]) / d[k];
    let b = (max[k] - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

/** Moeller-Trumbore, true when the triangle is hit at 0 < t < maxT (both faces). */
function rayHitsTri(o: V3, d: V3, maxT: number, t: Float32Array, i: number): boolean {
  const e1x = t[i + 3] - t[i], e1y = t[i + 4] - t[i + 1], e1z = t[i + 5] - t[i + 2];
  const e2x = t[i + 6] - t[i], e2y = t[i + 7] - t[i + 1], e2z = t[i + 8] - t[i + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const sx = o[0] - t[i], sy = o[1] - t[i + 1], sz = o[2] - t[i + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return tt > 1e-6 && tt < maxT;
}

/** True when a solid stands between the eye and the point (more than `slackM` in front of it). */
export function occluded(geom: PhotoGeometry, eye: V3, p: V3, slackM = 0.04): boolean {
  const d: V3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return false;
  d[0] /= len; d[1] /= len; d[2] /= len;
  const maxT = len - slackM;
  if (maxT <= 0) return false;
  for (const s of geom.solids) {
    if (!rayHitsAabb(eye, d, maxT, s.min, s.max)) continue;
    for (let i = 0; i < s.tris.length; i += 9) if (rayHitsTri(eye, d, maxT, s.tris, i)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- projection and sampling

/** The part of the canvas that is sent, as fractions of its width and height. */
export interface CropRect { u0: number; v0: number; uw: number; vh: number }
/** `ang` is the direction of the edge on screen in radians, folded to [0, PI) */
export interface SamplePoint { x: number; y: number; group: string; ang: number }
export interface Sampled {
  /** visible points on the edges, in output pixels */
  points: SamplePoint[];
  /** consecutive visible samples of one edge: x0, y0, x1, y1 in output pixels (the guide's lines) */
  lines: [number, number, number, number][];
}

/** Crop of a canvas to the given aspect ratio, centred; the larger side shrinks. */
export function cropToAspect(canvasW: number, canvasH: number, ratio: number): CropRect {
  const r = canvasW / canvasH;
  if (Math.abs(Math.log(r / ratio)) < 1e-3) return { u0: 0, v0: 0, uw: 1, vh: 1 };
  if (r > ratio) { const uw = ratio / r; return { u0: (1 - uw) / 2, v0: 0, uw, vh: 1 }; }
  const vh = r / ratio;
  return { u0: 0, v0: (1 - vh) / 2, uw: 1, vh };
}

const NEAR = 0.1;

/**
 * Walks every edge, keeps the samples that land inside the crop and are not hidden behind a wall or an item.
 * `stepFrac` is the spacing along the edge as a fraction of the image diagonal.
 */
export function sampleView(
  geom: PhotoGeometry, camera: THREE.PerspectiveCamera, crop: CropRect, outW: number, outH: number, stepFrac = 0.01,
): Sampled {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const view = camera.matrixWorldInverse;
  const proj = camera.projectionMatrix;
  const eyeV = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const eye: V3 = [eyeV.x, eyeV.y, eyeV.z];
  const diag = Math.hypot(outW, outH);
  const step = Math.max(2, stepFrac * diag);
  const tmp = new THREE.Vector3();

  const toPx = (p: V3): { x: number; y: number; z: number } => {
    tmp.set(p[0], p[1], p[2]).applyMatrix4(view);
    const z = tmp.z; // camera looks down -z
    tmp.applyMatrix4(proj);
    const u = (tmp.x + 1) / 2;
    const v = (1 - tmp.y) / 2;
    return { x: ((u - crop.u0) / crop.uw) * outW, y: ((v - crop.v0) / crop.vh) * outH, z };
  };

  const points: SamplePoint[] = [];
  const lines: Sampled['lines'] = [];
  for (const s of geom.segs) {
    // near clip in camera space
    const za = tmp.set(...s.a).applyMatrix4(view).z;
    const zb = tmp.set(...s.b).applyMatrix4(view).z;
    let ta = 0;
    let tb = 1;
    if (za > -NEAR && zb > -NEAR) continue;
    if (za > -NEAR) ta = (-NEAR - za) / (zb - za);
    else if (zb > -NEAR) tb = (-NEAR - za) / (zb - za);
    const at = (t: number): V3 => [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t, s.a[2] + (s.b[2] - s.a[2]) * t];
    const pa = toPx(at(ta));
    const pb = toPx(at(tb));
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (!Number.isFinite(len)) continue;
    // an edge that is far off screen is cut by its bounding box before sampling
    if (Math.max(pa.x, pb.x) < 0 || Math.min(pa.x, pb.x) > outW || Math.max(pa.y, pb.y) < 0 || Math.min(pa.y, pb.y) > outH) continue;
    const n = Math.min(400, Math.max(1, Math.ceil(len / step)));
    const raw = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    const ang = ((raw % Math.PI) + Math.PI) % Math.PI;
    let prev: { x: number; y: number } | null = null;
    for (let k = 0; k <= n; k++) {
      const t = ta + ((tb - ta) * k) / n;
      const p3 = at(t);
      const px = toPx(p3);
      const inside = px.x >= 0 && px.x <= outW && px.y >= 0 && px.y <= outH;
      if (!inside || occluded(geom, eye, p3)) { prev = null; continue; }
      points.push({ x: px.x, y: px.y, group: s.group, ang });
      if (prev) lines.push([prev.x, prev.y, px.x, px.y]);
      prev = px;
    }
  }
  return { points, lines };
}

// ---------------------------------------------------------------- the guide image

/** White image with the given lines in near-black, `widthPx` thick. RGBA. */
export function drawGuide(outW: number, outH: number, lines: Sampled['lines'], widthPx: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4).fill(255);
  const r = widthPx / 2;
  const ri = Math.ceil(r);
  const disc = (cx: number, cy: number): void => {
    const x0 = Math.max(0, Math.floor(cx - ri)), x1 = Math.min(outW - 1, Math.ceil(cx + ri));
    const y0 = Math.max(0, Math.floor(cy - ri)), y1 = Math.min(outH - 1, Math.ceil(cy + ri));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.25) { const i = (y * outW + x) * 4; out[i] = 24; out[i + 1] = 24; out[i + 2] = 24; }
    }
  };
  for (const [x0, y0, x1, y1] of lines) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) disc(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
  }
  return out;
}
