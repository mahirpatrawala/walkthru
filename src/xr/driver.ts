// What the VR page needs from "a headset", as an interface, so the same page logic runs on a real WebXR session (driver-webxr.ts) and on the in-page
// emulator that checks it without one (driver-fake.ts, `?xrfake=1`). The page logic never touches `navigator.xr` or `renderer.xr` itself.
import type * as THREE from 'three';
import type { Pose } from './pose';
import type { V3 } from './teleport';

/** One hand's pointer for one frame. `origin` and `dir` are in the home (the play space already carries the pose). */
export interface PointerFrame {
  id: string;
  hand: 'left' | 'right' | 'none';
  /** false while the controller is not tracked (set down, out of view): it is ignored */
  tracked: boolean;
  /** the pointer is a tracked hand, not a controller (a pinch is its trigger) */
  isHand: boolean;
  origin: V3;
  /** unit vector */
  dir: V3;
  /** the trigger (or a pinch) is held now */
  triggerDown: boolean;
  /** it went down this frame */
  triggerPressed: boolean;
  /** the panel button went down this frame: B or Y on a controller, a squeeze on a hand */
  menuPressed: boolean;
  stickX: number;
  stickY: number;
}

export interface HeadReading {
  /** the head in the home */
  world: V3;
  /** the head's forward direction in the home, unit */
  forward: V3;
  /** the head in the play space: where the viewer really is in the room they stand in, and which way they are turned (a camera yaw, radians) */
  local: { x: number; y: number; z: number; yaw: number };
}

export interface XrDriver {
  readonly kind: 'webxr' | 'fake';
  /** may a session be started here */
  supported(): Promise<boolean>;
  /** Starts the session and resolves when frames are being presented. Must be called from a tap or a key press on a real headset. */
  start(): Promise<void>;
  /** Ends it. Resolves once `onEnd` callbacks have run. */
  stop(): Promise<void>;
  isPresenting(): boolean;
  /** called once at the start of every frame, before anything reads the head or the hands */
  beginFrame(): void;
  /** where the play space sits in the home from the next frame on */
  setPose(p: Pose): void;
  readonly pose: Pose;
  frames(): PointerFrame[];
  head(): HeadReading;
  /** the objects the controller models hang on, in the scene graph, one per hand */
  pointerObjects(): THREE.Object3D[];
  onEnd(cb: () => void): () => void;
  /** the refresh rate the headset runs at, when it says */
  hz(): number | null;
  /** the framebuffer scale in force */
  scale(): number | null;
  haptic(hand: string, strength: number, ms: number): void;
  /** how many event listeners this driver holds on the session and the controllers (for the teardown check) */
  listenerCount(): number;
  dispose(): void;
}
