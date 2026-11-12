// Third-person follow camera (SPEC 2.4). three only.
//
// Conventions: yawDeg is the heading the camera LOOKS along, same as everywhere (3.1: forward = (sin yaw, cos yaw)).
// pitchDeg is how far the camera sits above the pivot, looking down. The screen's right-hand direction on the
// floor is (-cos yaw, sin yaw). Dragging right turns the view left (yaw grows), dragging down raises the camera
// (pitch grows), the same feel as OrbitControls.
import * as THREE from 'three';
import { boomDistance } from '../core/grid-query';
import type { Grid, Vec2, Vec3 } from '../types';

const DEG = Math.PI / 180;

const PIVOT_HEIGHT_RATIO = 0.85;
const SHOULDER_M = 0.2;
const DEFAULT_BOOM_M = 2.0;
const DEFAULT_PITCH_DEG = 12;
const PITCH_MIN_DEG = -5;
const PITCH_MAX_DEG = 60;
const BOOM_MIN_M = 1.0;
const BOOM_MAX_M = 3.5;
const FOCUS_S = 0.5;
const LENGTHEN_MPS = 2;
/** Look drag sensitivity, degrees per pixel. */
const LOOK_DEG_PER_PX = 0.25;
/** Zoom, metres of boom per wheel notch. */
const ZOOM_M_PER_NOTCH = 0.25;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function angleDiff(from: number, to: number): number {
  let d = (((to - from) % 360) + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}
function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

interface Focus { centre: Vec3; distance: number; pitchDeg: number; yawDeg: number }

export class FollowCamera {
  /** Heading the camera looks along, degrees. Walk input is relative to this. */
  yawDeg = 0;
  /** Elevation of the camera above the pivot, degrees: -5 to 60. */
  pitchDeg = DEFAULT_PITCH_DEG;
  /** Wanted boom length, metres: 1.0 to 3.5. The boom actually used can be shorter (see `boom`). */
  distance = DEFAULT_BOOM_M;
  /** Ceiling height used for the boom's top limit; update it if the layout changes. */
  ceilingM: number;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly getGrid: () => Grid;
  private target: Vec2 = { x: 0, z: 0 };
  private heightM = 1.75;
  private focus: Focus | null = null;
  private focusActive = false;
  private focusT = 0;
  private boomLen = DEFAULT_BOOM_M;
  private haveBoom = false;
  private viewYaw = 0;

  constructor(camera: THREE.PerspectiveCamera, getGrid: () => Grid, ceilingM: number) {
    this.camera = camera;
    this.getGrid = getGrid;
    this.ceilingM = ceilingM;
    camera.near = 0.05;
    camera.far = 200;
    camera.updateProjectionMatrix();
  }

  /** Current boom length after collision. The buyer hides the character below 0.7 m and shows it again above 0.8 m. */
  get boom(): number {
    return this.boomLen;
  }

  /** The heading the camera actually has this frame (differs from yawDeg only while a focus is blending in or out). */
  get viewYawDeg(): number {
    return this.viewYaw;
  }

  setTarget(pos: Vec2, heightM: number): void {
    this.target = { x: pos.x, z: pos.z };
    this.heightM = heightM;
  }

  /**
   * Swings in 0.5 s to orbit `centre` at `distance` and `pitchDeg` (bed 50 degrees, sofa 20). `yawDeg` is the
   * heading to look along; when omitted the current heading is kept. Look drag and zoom then adjust the focus.
   * The boom collision rule still applies.
   */
  focusOn(centre: Vec3, distance: number, pitchDeg: number, yawDeg?: number): void {
    this.focus = {
      centre: { ...centre },
      distance: clamp(distance, 0.5, 8),
      pitchDeg: clamp(pitchDeg, PITCH_MIN_DEG, 85),
      yawDeg: yawDeg ?? this.viewYaw,
    };
    this.focusActive = true;
  }

  /** Swings back to following the character. The heading it had in the focus is kept. */
  releaseFocus(): void {
    if (this.focus) this.yawDeg = this.focus.yawDeg;
    this.focusActive = false;
  }

  update(dt: number, look: { dx: number; dy: number; zoom: number }): void {
    // 1. look and zoom act on the focus while one is active, otherwise on the follow values
    const f = this.focusActive ? this.focus : null;
    if (f) {
      f.yawDeg += look.dx * LOOK_DEG_PER_PX;
      f.pitchDeg = clamp(f.pitchDeg + look.dy * LOOK_DEG_PER_PX, PITCH_MIN_DEG, 85);
      f.distance = clamp(f.distance + look.zoom * ZOOM_M_PER_NOTCH, BOOM_MIN_M, 8);
    } else {
      this.yawDeg += look.dx * LOOK_DEG_PER_PX;
      this.pitchDeg = clamp(this.pitchDeg + look.dy * LOOK_DEG_PER_PX, PITCH_MIN_DEG, PITCH_MAX_DEG);
      this.distance = clamp(this.distance + look.zoom * ZOOM_M_PER_NOTCH, BOOM_MIN_M, BOOM_MAX_M);
    }
    this.pitchDeg = clamp(this.pitchDeg, PITCH_MIN_DEG, PITCH_MAX_DEG);
    this.distance = clamp(this.distance, BOOM_MIN_M, BOOM_MAX_M);

    // 2. focus blend 0..1 over 0.5 s
    const step = dt / FOCUS_S;
    this.focusT = clamp(this.focusT + (this.focusActive ? step : -step), 0, 1);
    if (this.focusT === 0 && !this.focusActive) this.focus = null;
    const s = this.focus ? smooth(this.focusT) : 0;

    // 3. effective heading, pitch, boom and pivot
    const fo = this.focus;
    const yaw = fo ? this.yawDeg + angleDiff(this.yawDeg, fo.yawDeg) * s : this.yawDeg;
    const pitch = fo ? this.pitchDeg + (fo.pitchDeg - this.pitchDeg) * s : this.pitchDeg;
    const wanted = fo ? this.distance + (fo.distance - this.distance) * s : this.distance;
    this.viewYaw = yaw;

    const yr = yaw * DEG;
    const shoulder = SHOULDER_M * (1 - s);
    const pivot: Vec3 = {
      x: this.target.x - Math.cos(yr) * shoulder,
      y: PIVOT_HEIGHT_RATIO * this.heightM,
      z: this.target.z + Math.sin(yr) * shoulder,
    };
    if (fo) {
      pivot.x += (fo.centre.x - pivot.x) * s;
      pivot.y += (fo.centre.y - pivot.y) * s;
      pivot.z += (fo.centre.z - pivot.z) * s;
    }

    // 4. boom: behind and above the pivot, shortened by the grid
    const pr = pitch * DEG;
    const dir: Vec3 = { x: -Math.sin(yr) * Math.cos(pr), y: Math.sin(pr), z: -Math.cos(yr) * Math.cos(pr) };
    const free = boomDistance(this.getGrid(), pivot, dir, wanted, this.ceilingM);
    if (!this.haveBoom || free < this.boomLen) {
      this.boomLen = free; // shorten instantly
      this.haveBoom = true;
    } else {
      this.boomLen = Math.min(free, this.boomLen + LENGTHEN_MPS * dt); // lengthen at 2 m/s
    }

    this.camera.position.set(pivot.x + dir.x * this.boomLen, pivot.y + dir.y * this.boomLen, pivot.z + dir.z * this.boomLen);
    this.camera.lookAt(pivot.x, pivot.y, pivot.z);
  }
}
