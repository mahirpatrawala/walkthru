// A walker on a treadmill runs its belt. While the walker is on a machine piece with a moving part (the generator's `userData.motion`,
// src/look/gen/cardio.ts) the belt's ribs slide along the deck and wrap every pitch, at the belt's speed. At rest every part has the identity
// transform, so a bake of the room sees an ordinary still machine; with reduced motion asked for, nothing moves. Stops the moment the walker steps off.
import * as THREE from 'three';
import type { MachineMotion } from '../look/gen/cardio';
import { prefersReducedMotion } from './swing-motion';

/** The offset of the ribs `t` seconds after the belt started: the distance run, wrapped to one pitch, metres. */
export function beltOffset(t: number, speedMps: number, pitchM: number): number {
  const d = Math.max(0, t) * speedMps;
  return d - Math.floor(d / pitchM) * pitchM;
}

export interface MachineMotionHost { meshOf(id: string): THREE.Object3D | null | undefined }
export interface MachineMotionRunner {
  /** per frame: `on` is the machine the walker is standing on and has reached, or null */
  update(dt: number, on: { id: string } | null): void;
  /** the belt back to rest now */
  stop(): void;
  active(): string | null;
}

export function poseBelt(mesh: THREE.Object3D, offsetM: number): MachineMotion | null {
  const m = mesh.userData?.motion as MachineMotion | undefined;
  if (!m || m.kind !== 'belt') return null;
  const ribs = mesh.getObjectByName(m.mesh);
  if (ribs) ribs.position.z = offsetM;
  return m;
}

export function createMachineMotion(host: MachineMotionHost, reduced: () => boolean = prefersReducedMotion): MachineMotionRunner {
  let id: string | null = null;
  let t = 0;
  let mesh: THREE.Object3D | null = null;
  const stop = (): void => {
    if (mesh) poseBelt(mesh, 0);
    id = null; mesh = null; t = 0;
  };
  return {
    update(dt, on) {
      if (!on || reduced()) { if (id) stop(); return; }
      if (id !== on.id) {
        stop();
        mesh = host.meshOf(on.id) ?? null;
        if (!mesh?.userData?.motion) { mesh = null; return; }
        id = on.id; t = 0;
      }
      t += dt;
      const m = (mesh as THREE.Object3D).userData.motion as MachineMotion;
      poseBelt(mesh as THREE.Object3D, beltOffset(t, m.speedMps, m.pitchM));
    },
    stop,
    active: () => id,
  };
}
