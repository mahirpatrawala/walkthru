// Owned by C9. SPEC 14.6 (select stage). Pure: parse COLMAP text models, rank fragments, coverage, camera poses.
import type { Vec3 } from '../types';
import type { Coverage, FrameCamera } from './types';

export interface ColmapImage {
  id: number;
  /** world-to-camera rotation (qw, qx, qy, qz) */
  q: [number, number, number, number];
  /** world-to-camera translation */
  t: [number, number, number];
  cameraId: number;
  name: string;
  /** camera centre in the model frame: C = -R^T t */
  centre: Vec3;
  /** viewing direction in the model frame: R^T (0, 0, 1) */
  forward: Vec3;
}

/** Rotation matrix (row-major, 9 numbers) of a unit quaternion given as (w, x, y, z). */
export function quatToMatrix(q: [number, number, number, number]): number[] {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const w = q[0] / n, x = q[1] / n, y = q[2] / n, z = q[3] / n;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/** Camera centre and forward of a COLMAP pose (world-to-camera q, t). */
export function cameraFromPose(q: [number, number, number, number], t: [number, number, number]): { centre: Vec3; forward: Vec3 } {
  const R = quatToMatrix(q);
  // C = -R^T t ; (R^T t)_i = sum_j R[j][i] * t_j
  const centre: Vec3 = {
    x: -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]),
    y: -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]),
    z: -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]),
  };
  // R^T (0, 0, 1) is the third row of R
  const forward: Vec3 = { x: R[6], y: R[7], z: R[8] };
  return { centre, forward };
}

const isNum = (s: string): boolean => s !== '' && Number.isFinite(Number(s));

/**
 * Parses COLMAP's images.txt. Each image is a header line `ID QW QX QY QZ TX TY TZ CAMERA_ID NAME` followed by a
 * (possibly empty) POINTS2D line. A header is recognised by its 10 tokens ending in a non-numeric name, so empty
 * or numeric POINTS2D lines are skipped without counting pairs.
 */
export function parseImagesTxt(text: string): ColmapImage[] {
  const out: ColmapImage[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tok = line.split(/\s+/);
    if (tok.length < 10 || isNum(tok[9])) continue;
    const nums = tok.slice(0, 9);
    if (!nums.every(isNum)) continue;
    const [id, qw, qx, qy, qz, tx, ty, tz, camId] = nums.map(Number);
    const q: [number, number, number, number] = [qw, qx, qy, qz];
    const t: [number, number, number] = [tx, ty, tz];
    const { centre, forward } = cameraFromPose(q, t);
    out.push({ id, q, t, cameraId: camId, name: tok.slice(9).join(' '), centre, forward });
  }
  return out;
}

/** `frame-000123.jpg` -> 123, else null. */
export function frameNumberFromName(name: string): number | null {
  const m = /(\d+)\.[a-z0-9]+$/i.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Spans of registered frames. Registered frames closer than `gapFrames` frame intervals belong to one span;
 * a span runs from its first frame's time to the end of its last frame (last time + 1 / fps).
 * `secondsCovered` is the total length of the spans.
 */
export function coverage(registeredTimes: number[], totalFrames: number, secondsTotal: number, fps: number,
  gapFrames = 1.5): Coverage {
  const times = [...registeredTimes].sort((a, b) => a - b);
  const dt = 1 / fps;
  const spans: { fromSec: number; toSec: number }[] = [];
  for (const t of times) {
    const last = spans[spans.length - 1];
    if (last && t - (last.toSec - dt) <= gapFrames * dt + 1e-9) last.toSec = t + dt;
    else spans.push({ fromSec: t, toSec: t + dt });
  }
  const round = (v: number): number => Math.round(v * 1000) / 1000;
  const rs = spans.map((s) => ({ fromSec: round(s.fromSec), toSec: round(s.toSec) }));
  const secondsCovered = round(rs.reduce((a, s) => a + (s.toSec - s.fromSec), 0));
  return { totalFrames, registeredFrames: times.length, secondsTotal, secondsCovered, spans: rs };
}

/** Largest first; ties keep the lower model number. */
export function rankModels<T extends { registered: number }>(models: T[]): T[] {
  return models.map((m, i) => ({ m, i })).sort((a, b) => b.m.registered - a.m.registered || a.i - b.i).map((e) => e.m);
}

/** Camera centre and forward of each registered image, with its frame time. */
export function camerasFromImages(images: ColmapImage[], timeOf: (name: string) => number | null): FrameCamera[] {
  const out: FrameCamera[] = [];
  for (const im of images) {
    const t = timeOf(im.name);
    if (t === null) continue;
    out.push({ frame: im.name, timeSec: t, centre: im.centre, forward: im.forward });
  }
  return out.sort((a, b) => a.timeSec - b.timeSec);
}

/** Reads the vertex count out of a PLY header. Returns null when the bytes do not start a PLY header. */
export function plyVertexCount(head: Uint8Array): number | null {
  const text = new TextDecoder('latin1').decode(head.subarray(0, Math.min(head.length, 4096)));
  if (!text.startsWith('ply')) return null;
  const end = text.indexOf('end_header');
  if (end < 0) return null;
  const m = /element\s+vertex\s+(\d+)/.exec(text.slice(0, end));
  return m ? Number(m[1]) : null;
}
