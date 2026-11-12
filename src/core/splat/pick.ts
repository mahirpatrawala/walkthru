// Owned by C7. SPEC 4.11 `pickSurfacePoint`: which point of the scan did the broker click? Brute force, pure TypeScript.
import type { SceneTransform, Vec3 } from '../../types';
import { quatInvert, rotateY } from '../geometry';

const MIN_BYTE = 77;

/**
 * Brute force. For each point with opacity byte >= 77: `t = (p - o) . d`; skip `t < 0.15`; accept when the perpendicular distance is
 * under `max(0.015, 0.006 * t)` (units of the cloud). Accepted `t` go in bins of 1 % of the scene diagonal; take the nearest bin holding
 * at least 3 points (else the nearest accepted point); return `o + d * median(t in that bin)`. `dir` is normalised here.
 */
export function pickSurfacePoint(positions: Float32Array, opacity: Uint8Array, origin: Vec3, dir: Vec3): Vec3 | null {
  const n = opacity.length;
  const dl = Math.hypot(dir.x, dir.y, dir.z);
  if (n === 0 || !(dl > 0)) return null;
  const dx = dir.x / dl, dy = dir.y / dl, dz = dir.z / dl;

  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const binW = Math.max(1e-9, 0.01 * Math.hypot(x1 - x0, y1 - y0, z1 - z0));

  // SPEC-GAP: 4.11 accepts points inside max(0.015, 0.006 t) of the ray and returns null when there are none. On a sparse scan
  // (a 2.5 cm lattice is wider than that tube) a click can fall between points, so the tube is widened x2, then x4 before giving up.
  let ts: number[] = [];
  for (const widen of [1, 2, 4]) {
    ts = [];
    for (let i = 0; i < n; i++) {
      if (opacity[i] < MIN_BYTE) continue;
      const rx = positions[i * 3] - origin.x, ry = positions[i * 3 + 1] - origin.y, rz = positions[i * 3 + 2] - origin.z;
      const t = rx * dx + ry * dy + rz * dz;
      if (t < 0.15) continue;
      const px = rx - t * dx, py = ry - t * dy, pz = rz - t * dz;
      const perp = Math.sqrt(px * px + py * py + pz * pz);
      if (perp < widen * Math.max(0.015, 0.006 * t)) ts.push(t);
    }
    if (ts.length > 0) break;
  }
  if (ts.length === 0) return null;

  const bins = new Map<number, number[]>();
  let nearest = Infinity;
  for (const t of ts) {
    if (t < nearest) nearest = t;
    const b = Math.floor(t / binW);
    const list = bins.get(b);
    if (list) list.push(t); else bins.set(b, [t]);
  }
  let chosen: number | null = null;
  const keys = [...bins.keys()].sort((a, b) => a - b);
  for (const k of keys) {
    const list = bins.get(k)!;
    if (list.length >= 3) {
      list.sort((a, b) => a - b);
      chosen = (list[(list.length - 1) >> 1] + list[list.length >> 1]) / 2;
      break;
    }
  }
  if (chosen === null) chosen = nearest;
  return { x: origin.x + dx * chosen, y: origin.y + dy * chosen, z: origin.z + dz * chosen };
}

/** A world-space ray (e.g. from the 3D camera) expressed in raw splat space, given the splat's current transform. */
export function worldRayToRaw(t: SceneTransform, origin: Vec3, dir: Vec3): { origin: Vec3; dir: Vec3 } {
  const inv = quatInvert(t.rotation);
  const o = rotateY(inv, { x: (origin.x - t.position[0]) / t.scale, y: (origin.y - t.position[1]) / t.scale, z: (origin.z - t.position[2]) / t.scale });
  return { origin: o, dir: rotateY(inv, dir) };
}

/** A raw splat-space point in world space under a scene transform: `p_world = scale * rotate(rotation, p_raw) + position`. */
export function rawToWorld(t: SceneTransform, p: Vec3): Vec3 {
  const r = rotateY(t.rotation, p);
  return { x: t.scale * r.x + t.position[0], y: t.scale * r.y + t.position[1], z: t.scale * r.z + t.position[2] };
}
