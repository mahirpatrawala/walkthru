// The doll house camera's maths, pure: the bounds of a layout, the distance that frames them, the orbit limits, damping, zoom and pan.
// Coordinates are the plan's: x east, z south, y up. The orbit is described by a target point, `theta` (the bearing of the camera round the
// target, 0 = the camera stands on the +z side and looks toward -z), `phi` (the angle from straight up: 0 = overhead, 90 = level) and a distance.
import { computeEdgeFrames } from '../../core/layout-geom';
import { pointInPolygon } from '../../core/geometry';
import type { Layout, Vec2 } from '../../types';

const DEG = Math.PI / 180;

export interface Bounds { x0: number; z0: number; x1: number; z1: number; /** wall height */ h: number }
export interface Vec3 { x: number; y: number; z: number }

/** The footprint of every room plus the wall thickness all round, and the wall height; null for a layout with no rooms. */
export function layoutBounds(layout: Pick<Layout, 'rooms' | 'wallThicknessM' | 'wallHeightM'>): Bounds | null {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of layout.rooms) for (const p of r.polygon) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  if (!Number.isFinite(x0)) return null;
  const t = layout.wallThicknessM;
  return { x0: x0 - t, z0: z0 - t, x1: x1 + t, z1: z1 + t, h: layout.wallHeightM };
}

export const boundsCentre = (b: Bounds): Vec3 => ({ x: (b.x0 + b.x1) / 2, y: b.h / 2, z: (b.z0 + b.z1) / 2 });
/** half the diagonal of the box (the bounding sphere's radius) */
export const boundsRadius = (b: Bounds): number => Math.hypot((b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, b.h / 2);

/** The simple rule: the distance at which a sphere of `radius` just fits the narrower of the field of view (in degrees). */
export function sphereDistance(radius: number, fovDeg: number): number {
  return radius / Math.sin((Math.max(1, Math.min(170, fovDeg)) * DEG) / 2);
}

/** The unit vector from the target toward the camera. */
export function viewVector(theta: number, phi: number): Vec3 {
  return { x: Math.sin(phi) * Math.sin(theta), y: Math.cos(phi), z: Math.sin(phi) * Math.cos(theta) };
}

/**
 * The distance at which the whole box fits the picture, looking from (theta, phi): the eight corners are projected on the camera's right and
 * up axes and the distance is the least that brings every one inside the vertical and the horizontal field of view. Never more than the
 * bounding-sphere distance (that is the loose rule), so a tight fit is what a flat-roomed layout gets. `margin` leaves air round it.
 */
export function fitDistance(b: Bounds, fovVDeg: number, aspect: number, theta: number, phi: number, margin = 1.1): number {
  const tanV = Math.tan((fovVDeg * DEG) / 2);
  const tanH = tanV * Math.max(0.2, aspect);
  const c = boundsCentre(b);
  const v = viewVector(theta, phi);
  // camera axes: forward = -v, right = forward x up (normalised), up' = right x forward
  let rx = v.z, ry = 0, rz = -v.x; // (-v) x (0,1,0) = (-vz*1 - ... ) written out below
  // forward = (-vx,-vy,-vz); forward x up = (fy*0 - fz*1, fz*0 - fx*0, fx*1 - fy*0) = (-fz, 0, fx) = (vz, 0, -vx)
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  // up' = right x forward
  const fx = -v.x, fy = -v.y, fz = -v.z;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  let need = 0;
  for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) for (const y of [0, b.h]) {
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const px = dx * rx + dy * ry + dz * rz;
    const py = dx * ux + dy * uy + dz * uz;
    const toward = dx * v.x + dy * v.y + dz * v.z; // how far this corner is toward the camera
    need = Math.max(need, Math.abs(px) / tanH + toward, Math.abs(py) / tanV + toward);
  }
  return Math.max(0.5, need) * margin;
}

/** The outward direction (unit, plan) of the layout's main entrance: the widest door whose far side is outside every room. Null when none. */
export function entranceOutward(layout: Layout): Vec2 | null {
  const frames = new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, f]));
  let best: { out: Vec2; w: number } | null = null;
  for (const o of layout.openings) {
    if (o.type !== 'door') continue;
    const f = frames.get(`${o.roomId}:${o.edge}`);
    if (!f || f.kind === 'none') continue;
    const at = { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM };
    const beyond = { x: at.x + f.out.x * (f.thickness + 0.45), z: at.z + f.out.z * (f.thickness + 0.45) };
    if (layout.rooms.some((r) => r.roomType !== 'balcony' && pointInPolygon(beyond, r.polygon))) continue;
    if (layout.rooms.some((r) => pointInPolygon(beyond, r.polygon))) continue; // a door onto a balcony of this space is not the entrance
    if (!best || o.widthM > best.w) best = { out: { x: f.out.x, z: f.out.z }, w: o.widthM };
  }
  return best ? best.out : null;
}

export interface OrbitGoal { tx: number; ty: number; tz: number; theta: number; phi: number; dist: number }
export interface OrbitLimits {
  phiMin: number; phiMax: number; distMin: number; distMax: number;
  /** the target may wander inside this rectangle */
  pan: { x0: number; z0: number; x1: number; z1: number };
}

export const DOLL_PHI_MIN_DEG = 20;
export const DOLL_PHI_MAX_DEG = 80;
/** the first elevation above the horizon, degrees (polar 40 degrees from vertical) */
export const DOLL_ELEVATION_DEG = 50;
export const DOLL_FOV_DEG = 42;
export const DOLL_FOV_PORTRAIT_DEG = 52;

export function dollFov(aspect: number): number {
  return aspect < 1 ? DOLL_FOV_PORTRAIT_DEG : DOLL_FOV_DEG;
}

/** The first pose: centred, 50 degrees up, the entrance side nearest the viewer when it is known, the whole layout in frame. */
export function initialOrbit(b: Bounds, o: { fovVDeg: number; aspect: number; entrance?: Vec2 | null }): { goal: OrbitGoal; limits: OrbitLimits } {
  const c = boundsCentre(b);
  const theta = o.entrance ? Math.atan2(o.entrance.x, o.entrance.z) : 0;
  const phi = (90 - DOLL_ELEVATION_DEG) * DEG;
  const dist = fitDistance(b, o.fovVDeg, o.aspect, theta, phi);
  const span = Math.max(b.x1 - b.x0, b.z1 - b.z0);
  const r = boundsRadius(b);
  const loose = sphereDistance(r, o.fovVDeg) * 1.2;
  const limits: OrbitLimits = {
    phiMin: DOLL_PHI_MIN_DEG * DEG, phiMax: DOLL_PHI_MAX_DEG * DEG,
    distMin: Math.max(1.6, r * 0.3), distMax: Math.max(loose, dist * 1.9),
    pan: { x0: b.x0 - span * 0.3, z0: b.z0 - span * 0.3, x1: b.x1 + span * 0.3, z1: b.z1 + span * 0.3 },
  };
  return { goal: clampOrbit({ tx: c.x, ty: c.y * 0.35, tz: c.z, theta, phi, dist }, limits), limits };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function clampOrbit(g: OrbitGoal, l: OrbitLimits): OrbitGoal {
  return {
    tx: clamp(g.tx, l.pan.x0, l.pan.x1), ty: g.ty, tz: clamp(g.tz, l.pan.z0, l.pan.z1),
    theta: g.theta, phi: clamp(g.phi, l.phiMin, l.phiMax), dist: clamp(g.dist, l.distMin, l.distMax),
  };
}

export function orbitPosition(g: OrbitGoal): Vec3 {
  const v = viewVector(g.theta, g.phi);
  return { x: g.tx + v.x * g.dist, y: g.ty + v.y * g.dist, z: g.tz + v.z * g.dist };
}

/** Frame-rate independent easing: after `dt` seconds `current` has closed `1 - exp(-rate * dt)` of the gap to `goal`. */
export function damp(current: number, goal: number, dt: number, rate = 9): number {
  return goal + (current - goal) * Math.exp(-rate * Math.max(0, dt));
}
export function dampAngle(current: number, goal: number, dt: number, rate = 9): number {
  let d = (goal - current) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return current + d * (1 - Math.exp(-rate * Math.max(0, dt)));
}
export function dampOrbit(cur: OrbitGoal, goal: OrbitGoal, dt: number, rate = 9): OrbitGoal {
  return {
    tx: damp(cur.tx, goal.tx, dt, rate), ty: damp(cur.ty, goal.ty, dt, rate), tz: damp(cur.tz, goal.tz, dt, rate),
    theta: dampAngle(cur.theta, goal.theta, dt, rate), phi: damp(cur.phi, goal.phi, dt, rate), dist: damp(cur.dist, goal.dist, dt, rate),
  };
}

/** Orbit by a drag of (dx, dy) pixels: a drag across the whole picture turns it about a half turn. */
export function orbitBy(g: OrbitGoal, dxPx: number, dyPx: number, viewportH: number, l: OrbitLimits): OrbitGoal {
  const k = Math.PI / Math.max(300, viewportH);
  return clampOrbit({ ...g, theta: g.theta - dxPx * k * 1.15, phi: g.phi - dyPx * k * 0.9 }, l);
}

/** Zoom by `notches` of the wheel (a notch is 12%) or by a pinch ratio (`factor`, > 1 spreads the fingers). */
export function zoomBy(g: OrbitGoal, notches: number, l: OrbitLimits): OrbitGoal {
  return clampOrbit({ ...g, dist: g.dist * Math.exp(notches * 0.12) }, l);
}
export function zoomByFactor(g: OrbitGoal, factor: number, l: OrbitLimits): OrbitGoal {
  return clampOrbit({ ...g, dist: g.dist / Math.max(0.2, Math.min(5, factor)) }, l);
}

/** Pan the target over the floor by a drag of (dx, dy) pixels: the point under the finger stays under it. */
export function panBy(g: OrbitGoal, dxPx: number, dyPx: number, viewportH: number, fovVDeg: number, l: OrbitLimits): OrbitGoal {
  const metresPerPx = (2 * g.dist * Math.tan((fovVDeg * DEG) / 2)) / Math.max(1, viewportH);
  const right = { x: Math.cos(g.theta), z: -Math.sin(g.theta) };
  const fwd = { x: -Math.sin(g.theta), z: -Math.cos(g.theta) };
  const elev = Math.max(0.3, Math.cos(g.phi)); // the ground is foreshortened up the picture
  return clampOrbit({
    ...g,
    tx: g.tx - right.x * dxPx * metresPerPx + fwd.x * dyPx * metresPerPx / elev,
    tz: g.tz - right.z * dxPx * metresPerPx + fwd.z * dyPx * metresPerPx / elev,
  }, l);
}
