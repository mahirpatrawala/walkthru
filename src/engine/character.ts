// Owned by C2. Stub from C0: signatures only (SPEC 7.1, behaviour in 4.6).
import type * as THREE from 'three';
import type { LiePose, SeatPose, StandPose, Vec2 } from '../types';

export type CharacterState = 'idle' | 'walk' | 'jog' | 'sitting' | 'lying' | 'standing-at' | 'transition';

export class Character {
  static load(url?: string): Promise<Character> {
    throw new Error('not implemented: C2 Character.load');
  }
  readonly object!: THREE.Group;
  readonly state!: CharacterState;
  heightM!: number;
  /** get/set, world */
  position!: Vec2;
  /** get/set */
  yawDeg!: number;
  setHeight(m: number, tint: string): void {
    throw new Error('not implemented: C2 Character.setHeight');
  }
  /** speed in m/s; 0 = idle. Ignored while posed. */
  setLocomotion(speed: number, jog: boolean): void {
    throw new Error('not implemented: C2 Character.setLocomotion');
  }
  lie(pose: LiePose): Promise<void> {
    throw new Error('not implemented: C2 Character.lie');
  }
  sit(pose: SeatPose): Promise<void> {
    throw new Error('not implemented: C2 Character.sit');
  }
  standAt(pose: StandPose): Promise<void> {
    throw new Error('not implemented: C2 Character.standAt');
  }
  /** leave any pose, ending at `to` */
  release(to: Vec2): Promise<void> {
    throw new Error('not implemented: C2 Character.release');
  }
  setVisible(v: boolean): void {
    throw new Error('not implemented: C2 Character.setVisible');
  }
  update(dt: number): void {
    throw new Error('not implemented: C2 Character.update');
  }
}
