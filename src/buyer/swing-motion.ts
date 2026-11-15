// A seated walker rocks a swing. While the walker sits on a swing piece (src/core/pieces.ts pose 'swing') the seat and the chains of its mesh
// move as a pendulum (the generator's `userData.swingRig`, src/look/gen/swing.ts) and the walker rides with the seat. Nothing here moves when
// nobody sits (a swing at rest has the identity transforms), and nothing moves at all when the viewer asks the system for reduced motion.
// The swing stops the moment the walker gets up. Pure maths (`swingAngle`, `swingOffsets`) is separate from the three.js writes so it is tested headless.
import * as THREE from 'three';
import type { SwingRig } from '../look/gen/swing';
import type { Vec3 } from '../types';

const G = 9.81;
/** how gently it is rocked: the visual amplitude, degrees (the fit check assumes a bigger, pushed swing, see src/core/catalog-more.ts) */
export const SWING_VISUAL_DEG = 12;
/** seconds to reach the full amplitude from rest */
const RAMP_S = 2.0;

/** The pendulum's period, seconds, for chains of length `lengthM`. */
export function swingPeriodS(lengthM: number): number {
  return 2 * Math.PI * Math.sqrt(Math.max(0.3, lengthM) / G);
}

/** The angle (radians) `t` seconds after the walker sat: a sine at the pendulum's own period, eased in from rest. */
export function swingAngle(t: number, lengthM: number, maxDeg: number = SWING_VISUAL_DEG): number {
  const ease = 1 - Math.exp(-t / (RAMP_S / 3));
  return ease * ((maxDeg * Math.PI) / 180) * Math.sin((2 * Math.PI * t) / swingPeriodS(lengthM));
}

/** Where the seat is at angle `a`: forward (along the swing's front) and up from rest, metres. */
export function swingOffsets(lengthM: number, a: number): { forward: number; up: number } {
  return { forward: lengthM * Math.sin(a), up: lengthM * (1 - Math.cos(a)) };
}

/** true when the system asks for less motion */
export function prefersReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export interface SwingItemLike { id: string; box: { yawDeg: number } }
export interface SwingHost {
  ridePose(o: { dx: number; dy: number; dz: number; pitchRad: number } | null): void;
  meshOf(id: string): THREE.Object3D | null | undefined;
}

/** Applies the angle to the mesh's moving groups. Returns false when the mesh is not a generated swing. */
export function poseSwingMesh(mesh: THREE.Object3D, a: number): SwingRig | null {
  const rig = mesh.userData?.swingRig as SwingRig | undefined;
  if (!rig) return null;
  const { forward, up } = swingOffsets(rig.lengthM, a);
  if (rig.mode === 'parallel') {
    mesh.getObjectByName('swing-seat')?.position.set(0, up, forward);
    for (const n of ['swing-chains-front', 'swing-chains-back']) { const g = mesh.getObjectByName(n); if (g) g.rotation.x = a === 0 ? 0 : -a; }
  } else {
    const g = mesh.getObjectByName('swing-rig');
    if (g) g.rotation.x = a === 0 ? 0 : -a;
  }
  return rig;
}

/** Puts a swing mesh back to rest. */
export function restSwingMesh(mesh: THREE.Object3D): void {
  poseSwingMesh(mesh, 0);
}

export interface SwingMotion {
  /** per frame: `sitting` is the swing the walker is seated on and has reached, or null */
  update(dt: number, sitting: SwingItemLike | null): void;
  /** back to rest now, the walker back at the seat */
  stop(): void;
  active(): string | null;
}

export function createSwingMotion(host: SwingHost, reduced: () => boolean = prefersReducedMotion): SwingMotion {
  let id: string | null = null;
  let t = 0;
  let mesh: THREE.Object3D | null = null;
  const stop = (): void => {
    if (mesh) { restSwingMesh(mesh); host.ridePose(null); }
    id = null; mesh = null; t = 0;
  };
  return {
    update(dt, sitting) {
      if (!sitting || reduced()) { if (id) stop(); return; }
      if (id !== sitting.id) {
        stop();
        mesh = host.meshOf(sitting.id) ?? null;
        if (!mesh?.userData?.swingRig) { mesh = null; return; }
        id = sitting.id; t = 0;
      }
      // a tier change rebuilds the mesh's children: look the groups up again every frame, by name
      t += dt;
      const rig = (mesh as THREE.Object3D).userData.swingRig as SwingRig;
      const a = swingAngle(t, rig.lengthM);
      poseSwingMesh(mesh as THREE.Object3D, a);
      const { forward, up } = swingOffsets(rig.lengthM, a);
      const yaw = (sitting.box.yawDeg * Math.PI) / 180;
      host.ridePose({ dx: Math.sin(yaw) * forward, dy: up, dz: Math.cos(yaw) * forward, pitchRad: rig.mode === 'rigid' ? -a : 0 });
    },
    stop,
    active: () => id,
  };
}
void (null as unknown as Vec3);
