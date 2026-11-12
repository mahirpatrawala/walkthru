// Owned by C7. SPEC 4.11: pin the levelled scan to the layout. Pure TypeScript, no DOM.
import type { LevelResult, Quat, SceneTransform, Vec2 } from '../../types';
import { quatFromAxisAngle, quatMul } from '../geometry';

/**
 * A 2D similarity from the levelled frame's XZ to world XZ: `world = s * Ry(theta) * p + t`, where Ry(theta) maps (x, z) to
 * (x cos t + z sin t, -x sin t + z cos t). Not in SPEC 7.1; the editor uses it to show the scan before it is pinned.
 */
export interface Placement2D { s: number; theta: number; tx: number; tz: number }

export function scanToWorld(pl: Placement2D, p: Vec2): Vec2 {
  const c = Math.cos(pl.theta), n = Math.sin(pl.theta);
  return { x: pl.s * (p.x * c + p.z * n) + pl.tx, z: pl.s * (-p.x * n + p.z * c) + pl.tz };
}

export function worldToScan(pl: Placement2D, w: Vec2): Vec2 {
  const c = Math.cos(pl.theta), n = Math.sin(pl.theta);
  const x = (w.x - pl.tx) / pl.s, z = (w.z - pl.tz) / pl.s;
  return { x: x * c - z * n, z: x * n + z * c };
}

/** The scene transform for a placement: `rotation = Ry(theta) o level.rotation`, `position = (tx, -s * floorOffsetRaw, tz)`. */
export function placeSplat(level: LevelResult, pl: Placement2D): SceneTransform {
  const ry = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, pl.theta);
  const rotation: Quat = quatMul(ry, level.rotation);
  return { rotation, scale: pl.s, position: [pl.tx, -pl.s * level.floorOffsetRaw, pl.tz] };
}

/** Inverse of `placeSplat` for a transform whose rotation is `level.rotation` composed with a turn about Y. */
export function placementFromTransform(t: SceneTransform, level?: LevelResult): Placement2D {
  let theta = 0;
  if (level) {
    // Ry(theta) = t.rotation o level.rotation^-1 ; read theta off its y-axis component
    const [lx, ly, lz, lw] = level.rotation;
    const inv: Quat = [-lx, -ly, -lz, lw];
    const r = quatMul(t.rotation, inv);
    theta = 2 * Math.atan2(r[1], r[3]);
  }
  return { s: t.scale, theta, tx: t.position[0], tz: t.position[2] };
}

function heading(v: Vec2): number {
  return Math.atan2(v.x, v.z);
}

/** The placement that carries the two scan points onto the two world points (the layout is the ruler, so scale is solved too). */
export function placementFromPairs(pairs: [{ scan: Vec2; world: Vec2 }, { scan: Vec2; world: Vec2 }]): Placement2D {
  const [{ scan: p1, world: w1 }, { scan: p2, world: w2 }] = pairs;
  const ds = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  const dw = Math.hypot(w2.x - w1.x, w2.z - w1.z);
  // SPEC-GAP: 4.11 does not say what happens when the two scan points coincide. We throw; the editor asks for two points further apart.
  if (!(ds > 1e-9) || !(dw > 1e-9)) throw new Error('The two pins are on the same spot. Pick two points that are further apart.');
  const s = dw / ds;
  const theta = heading({ x: w2.x - w1.x, z: w2.z - w1.z }) - heading({ x: p2.x - p1.x, z: p2.z - p1.z });
  const c = Math.cos(theta), n = Math.sin(theta);
  const rx = p1.x * c + p1.z * n;
  const rz = -p1.x * n + p1.z * c;
  return { s, theta, tx: w1.x - s * rx, tz: w1.z - s * rz };
}

/** SPEC 4.11 `alignSplat`. `scan` points are in the levelled frame's XZ. The result's scale is the splat's metres per raw unit. */
export function alignSplat(level: LevelResult, pairs: [{ scan: Vec2; world: Vec2 }, { scan: Vec2; world: Vec2 }]): SceneTransform {
  return placeSplat(level, placementFromPairs(pairs));
}

/** SPEC 4.11 `alignSplatByDistance`: scale only (theta 0), with `centre` (levelled XZ) moved to the world origin. */
export function alignSplatByDistance(level: LevelResult, a: Vec2, b: Vec2, realM: number, centre: Vec2): SceneTransform {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  if (!(d > 1e-9) || !(realM > 0)) throw new Error('Pick two different points and type a distance above zero.');
  const s = realM / d;
  return placeSplat(level, { s, theta: 0, tx: -s * centre.x, tz: -s * centre.z });
}
