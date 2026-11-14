// SPEC 16.14: the light set-up the bake and the runtime agree on. Pure (no three, no DOM): where the sun is for each baked preset,
// which openings let the sky in (portals), where the recessed downlights go, and which points the probe grid samples.
import { computeEdgeFrames, computeTunnels } from '../../core/layout-geom';
import { distanceToSegment, pointInPolygon } from '../../core/geometry';
import type { Layout, Vec2 } from '../../types';
import { PRESET_HOURS } from '../grade';
import { sunState } from '../sun';
import type { LookFile } from '../types';
import type { Fixture, SunKey } from './types';

/** The three baked suns: Morning, Afternoon, Evening. Night has no sun. The slider between them cross-fades two of them. */
export const SUN_PRESETS = ['morning', 'afternoon', 'evening'] as const;

export function sunKeys(layout: Layout, look: Pick<LookFile, 'northDeg'> | null): SunKey[] {
  return SUN_PRESETS.map((p, i) => {
    const s = sunState(layout, look, PRESET_HOURS[p]);
    return { id: (['sun0', 'sun1', 'sun2'] as const)[i], hour: PRESET_HOURS[p], toSun: [s.toSun[0], s.toSun[1], s.toSun[2]] };
  });
}

export interface Portal {
  center: [number, number, number];
  /** unit, points into the room */
  normal: [number, number, number];
  w: number;
  h: number;
}

/** Sky portals: one per window or opening that looks straight outdoors (its edge has no room facing it). They only reduce bake noise. */
export function outdoorPortals(layout: Layout): Portal[] {
  const frames = new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, f]));
  const out: Portal[] = [];
  for (const t of computeTunnels(layout)) {
    if (t.openingId === null || (t.type !== 'window' && t.type !== 'opening')) continue;
    const f = frames.get(`${t.roomId}:${t.edge}`);
    if (!f || f.partnerGap !== null) continue;
    const u = (t.u0 + t.u1) / 2;
    const o = t.depth / 2;
    const y0 = t.sillM, y1 = t.headM;
    out.push({
      center: [f.a.x + f.dir.x * u + f.out.x * o, (y0 + y1) / 2, f.a.z + f.dir.z * u + f.out.z * o],
      normal: [-f.out.x, 0, -f.out.z], w: t.u1 - t.u0, h: Math.max(0.05, y1 - y0),
    });
  }
  return out;
}

/** distance from a point to the outline of a polygon, inside or out (core's distanceToPolygon is 0 inside) */
export function distanceToOutline(pt: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distanceToSegment(pt, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

const DOWNLIGHT_ROOMS = new Set(['bedroom', 'living', 'kitchen', 'other', 'bathroom']);
/** distance from a wall to the first row of downlights: close enough that each one draws a scallop of light on the wall */
export const DOWNLIGHT_INSET_M = 0.5;
export const DOWNLIGHT_SPACING_M = 1.35;
export const DOWNLIGHT_MAX_PER_ROOM = 12;

/**
 * Recessed downlights on a grid inset from the walls of every furnished room (SPEC 16.14). A typical fitting, like the fan and the tube:
 * "not from your drawing". Rooms of 3 m2 or less get one, balconies and partial rooms none. Deterministic.
 */
export function planDownlights(layout: Layout): Fixture[] {
  const out: Fixture[] = [];
  const y = layout.wallHeightM - 0.005;
  for (const room of layout.rooms) {
    if (room.partial || room.roomType === 'balcony' || !DOWNLIGHT_ROOMS.has(room.roomType) || room.polygon.length < 3) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of room.polygon) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const w = x1 - x0, d = z1 - z0;
    if (w * d < 2) continue;
    const small = w * d <= 3.2 || Math.min(w, d) < 1.4;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const pts: Vec2[] = [];
    if (small) {
      pts.push({ x: cx, z: cz });
    } else {
      const inset = Math.min(DOWNLIGHT_INSET_M, Math.min(w, d) / 3);
      const nx = Math.max(2, Math.round((w - 2 * inset) / DOWNLIGHT_SPACING_M) + 1);
      const nz = Math.max(2, Math.round((d - 2 * inset) / DOWNLIGHT_SPACING_M) + 1);
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const p = { x: x0 + inset + ((w - 2 * inset) * i) / (nx - 1), z: z0 + inset + ((d - 2 * inset) * j) / (nz - 1) };
        if (!pointInPolygon(p, room.polygon) || distanceToOutline(p, room.polygon) < inset * 0.6) continue;
        // keep the middle of a bedroom or living room for the ceiling fan
        if ((room.roomType === 'bedroom' || room.roomType === 'living') && Math.hypot(p.x - cx, p.z - cz) < 0.55) continue;
        pts.push(p);
      }
    }
    pts.slice(0, DOWNLIGHT_MAX_PER_ROOM).forEach((p) => out.push({ kind: 'downlight', position: [round3(p.x), round3(y), round3(p.z)], radiusM: 0.045, roomId: room.id }));
  }
  return out;
}
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface ProbeSpec {
  origin: [number, number, number];
  spacing: [number, number, number];
  dims: [number, number, number];
  /** every probe position, x-fastest, then z, then y */
  positions: Float32Array;
  /** 1 where the probe sits in a room's air (it is baked); 0 in walls and outside (it copies a neighbour) */
  valid: Uint8Array;
}

/** Probe grid over the flat: `step` metres apart on the floor plan, three or four layers up. Probes inside rooms are the valid ones. */
export function probeGridFor(layout: Layout, step: number): ProbeSpec {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of layout.rooms) for (const p of r.polygon) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  if (!isFinite(x0)) { x0 = z0 = -1; x1 = z1 = 1; }
  const nx = Math.max(2, Math.ceil((x1 - x0) / step) + 1), nz = Math.max(2, Math.ceil((z1 - z0) / step) + 1);
  const sx = (x1 - x0) / (nx - 1), sz = (z1 - z0) / (nz - 1);
  const H = layout.wallHeightM;
  const ny = H > 2.9 ? 4 : 3;
  const y0 = 0.35, y1 = Math.min(H - 0.3, 2.1);
  const sy = (y1 - y0) / (ny - 1);
  const positions = new Float32Array(nx * nz * ny * 3);
  const valid = new Uint8Array(nx * nz * ny);
  let k = 0;
  for (let j = 0; j < ny; j++) for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) {
    const p = { x: x0 + a * sx, z: z0 + b * sz };
    positions[k * 3] = p.x; positions[k * 3 + 1] = y0 + j * sy; positions[k * 3 + 2] = p.z;
    valid[k] = layout.rooms.some((r) => !r.partial && r.polygon.length >= 3 && pointInPolygon(p, r.polygon) && distanceToOutline(p, r.polygon) > 0.12) ? 1 : 0;
    k++;
  }
  return { origin: [x0, y0, z0], spacing: [sx, sy, sz], dims: [nx, ny, nz], positions, valid };
}
