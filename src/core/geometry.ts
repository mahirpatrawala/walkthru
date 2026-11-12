import type { Box, Quat, Side, Vec2, Vec3 } from '../types';

const DEG = Math.PI / 180;

// ---------- polygons ----------

/** Signed area per SPEC 3.1: A = 0.5 * sum(x_i * z_{i+1} - x_{i+1} * z_i). Positive for room polygons. */
export function polygonArea(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.z - b.x * a.z;
  }
  return 0.5 * s;
}

/** Even-odd ray cast. Points exactly on the boundary may go either way. */
export function pointInPolygon(pt: Vec2, p: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i];
    const b = p[j];
    if (a.z > pt.z !== b.z > pt.z && pt.x < ((b.x - a.x) * (pt.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function distanceToSegment(pt: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pt.x - (a.x + t * dx), pt.z - (a.z + t * dz));
}

/** Distance to the polygon outline, or 0 when the point is inside. */
export function distanceToPolygon(pt: Vec2, p: Vec2[]): number {
  if (pointInPolygon(pt, p)) return 0;
  let best = Infinity;
  for (let i = 0; i < p.length; i++) {
    best = Math.min(best, distanceToSegment(pt, p[i], p[(i + 1) % p.length]));
  }
  return best;
}

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return cross(b.x - a.x, b.z - a.z, c.x - a.x, c.z - a.z);
}

function onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
  // c is collinear with a-b; is it within the segment's bounding box?
  return (
    Math.min(a.x, b.x) - 1e-12 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-12 &&
    Math.min(a.z, b.z) - 1e-12 <= c.z && c.z <= Math.max(a.z, b.z) + 1e-12
  );
}

/** Segments share at least one point (touching and collinear overlap count). */
function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

/**
 * True when any two non-adjacent edges touch or cross, or two adjacent edges fold back on
 * each other (a spike). A repeated vertex counts as self-intersection.
 */
export function polygonSelfIntersects(p: Vec2[]): boolean {
  const n = p.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = p[j];
      const d = p[(j + 1) % n];
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // shared vertex: only a collinear fold-back is a problem
        const shared = j === i + 1 ? b : a;
        const e1 = j === i + 1 ? a : b; // other end of edge i
        const e2 = j === i + 1 ? d : c; // other end of edge j
        const o = orient(shared, e1, e2);
        const dot = (e1.x - shared.x) * (e2.x - shared.x) + (e1.z - shared.z) * (e2.z - shared.z);
        if (Math.abs(o) < 1e-12 && dot > 0) return true;
        continue;
      }
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

// ---------- boxes ----------

/** Box frame per SPEC 3.1: a = (sin yaw, cos yaw) is the depth axis (front), b = (cos yaw, -sin yaw) the width axis (right). */
export function boxAxes(box: Box): { a: Vec2; b: Vec2 } {
  const y = box.yawDeg * DEG;
  const s = Math.sin(y);
  const c = Math.cos(y);
  return { a: { x: s, z: c }, b: { x: c, z: -s } };
}

/** Back-left, back-right, front-right, front-left. */
export function boxCorners(box: Box): [Vec2, Vec2, Vec2, Vec2] {
  const { a, b } = boxAxes(box);
  const hw = box.w / 2;
  const hd = box.d / 2;
  const at = (da: number, db: number): Vec2 => ({
    x: box.cx + a.x * da + b.x * db,
    z: box.cz + a.z * da + b.z * db,
  });
  return [at(-hd, -hw), at(-hd, hw), at(hd, hw), at(hd, -hw)];
}

/**
 * The 3-click furniture tag: p1 and p2 are the two ends of the back edge, frontPoint is any
 * point on the front side. Width = |p2 - p1|, depth = distance of frontPoint from the back edge line.
 * yawDeg is in [0, 360).
 */
export function boxFromBackEdge(p1: Vec2, p2: Vec2, frontPoint: Vec2): Box {
  const ex = p2.x - p1.x;
  const ez = p2.z - p1.z;
  const w = Math.hypot(ex, ez);
  // unit perpendicular to the edge; choose the sign that points toward frontPoint
  let ax = -ez / (w || 1);
  let az = ex / (w || 1);
  const side = (frontPoint.x - p1.x) * ax + (frontPoint.z - p1.z) * az;
  if (side < 0) {
    ax = -ax;
    az = -az;
  }
  const d = Math.abs(side);
  const mx = (p1.x + p2.x) / 2;
  const mz = (p1.z + p2.z) / 2;
  let yawDeg = (Math.atan2(ax, az) / DEG) % 360;
  if (yawDeg < 0) yawDeg += 360;
  if (yawDeg >= 360 - 1e-9) yawDeg = 0;
  return { cx: mx + (ax * d) / 2, cz: mz + (az * d) / 2, w, d, yawDeg };
}

/** `shrink` pulls every side inwards by that many metres (negative grows the box). */
export function pointInBox(pt: Vec2, box: Box, shrink = 0): boolean {
  const { a, b } = boxAxes(box);
  const dx = pt.x - box.cx;
  const dz = pt.z - box.cz;
  const v = dx * a.x + dz * a.z; // along depth
  const u = dx * b.x + dz * b.z; // along width
  return Math.abs(u) <= box.w / 2 - shrink && Math.abs(v) <= box.d / 2 - shrink;
}

/**
 * One side of a box. `mid` is the centre of that side, `normal` the outward unit vector,
 * `half` half the side's length. `along` is the unit direction of the side used for ray
 * offsets: +b for front and back (width axis), +a for left and right (depth axis).
 */
export function sideEdge(box: Box, side: Side): { mid: Vec2; along: Vec2; normal: Vec2; half: number } {
  const { a, b } = boxAxes(box);
  const hw = box.w / 2;
  const hd = box.d / 2;
  switch (side) {
    case 'front':
      return { mid: { x: box.cx + a.x * hd, z: box.cz + a.z * hd }, along: { ...b }, normal: { ...a }, half: hw };
    case 'back':
      return { mid: { x: box.cx - a.x * hd, z: box.cz - a.z * hd }, along: { ...b }, normal: { x: -a.x, z: -a.z }, half: hw };
    case 'right':
      return { mid: { x: box.cx + b.x * hw, z: box.cz + b.z * hw }, along: { ...a }, normal: { ...b }, half: hd };
    case 'left':
      return { mid: { x: box.cx - b.x * hw, z: box.cz - b.z * hw }, along: { ...a }, normal: { x: -b.x, z: -b.z }, half: hd };
  }
}

// ---------- quaternions, [x, y, z, w] ----------

/** Rotate vector v by unit quaternion q. (Named rotateY in SPEC 7.1; it is the general quaternion rotation.) */
export function rotateY(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  return {
    x: v.x + qw * tx + (qy * tz - qz * ty),
    y: v.y + qw * ty + (qz * tx - qx * tz),
    z: v.z + qw * tz + (qx * ty - qy * tx),
  };
}

/** Hamilton product: the result applies `b` first, then `a`. */
export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatFromAxisAngle(axis: Vec3, rad: number): Quat {
  const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const s = Math.sin(rad / 2) / len;
  return [axis.x * s, axis.y * s, axis.z * s, Math.cos(rad / 2)];
}

/** Inverse (conjugate divided by the squared norm, so it is safe for non-unit input). */
export function quatInvert(q: Quat): Quat {
  const n = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3] || 1;
  return [-q[0] / n, -q[1] / n, -q[2] / n, q[3] / n];
}

/** Shortest rotation taking unit vector `from` to unit vector `to`. */
export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const d = from.x * to.x + from.y * to.y + from.z * to.z;
  if (d < -0.999999) {
    // opposite: half a turn about any axis perpendicular to `from`. cross(from, +X) = (0, from.z, -from.y)
    if (Math.hypot(from.y, from.z) < 1e-6) return quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI);
    return quatFromAxisAngle({ x: 0, y: from.z, z: -from.y }, Math.PI);
  }
  const cx = from.y * to.z - from.z * to.y;
  const cy = from.z * to.x - from.x * to.z;
  const cz = from.x * to.y - from.y * to.x;
  const w = 1 + d;
  const n = Math.hypot(cx, cy, cz, w) || 1;
  return [cx / n, cy / n, cz / n, w / n];
}

// ---------- random ----------

/** Standard mulberry32; returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
