// Owned by C2. Stub from C0: signatures only (SPEC 7.1, behaviour in 2.4).
import type * as THREE from 'three';
import type { Grid, Vec2, Vec3 } from '../types';

export class FollowCamera {
  constructor(camera: THREE.PerspectiveCamera, getGrid: () => Grid, ceilingM: number) {
    throw new Error('not implemented: C2 FollowCamera');
  }
  yawDeg!: number;
  pitchDeg!: number;
  distance!: number;
  setTarget(pos: Vec2, heightM: number): void {
    throw new Error('not implemented: C2 FollowCamera.setTarget');
  }
  focusOn(centre: Vec3, distance: number, pitchDeg: number, yawDeg?: number): void {
    throw new Error('not implemented: C2 FollowCamera.focusOn');
  }
  releaseFocus(): void {
    throw new Error('not implemented: C2 FollowCamera.releaseFocus');
  }
  /** current boom length after collision; the buyer hides the character below 0.7 */
  readonly boom!: number;
  update(dt: number, look: { dx: number; dy: number; zoom: number }): void {
    throw new Error('not implemented: C2 FollowCamera.update');
  }
}
