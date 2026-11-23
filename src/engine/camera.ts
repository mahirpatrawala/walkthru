// Third-person follow camera (SPEC 2.4). three only.
//
// Conventions: yawDeg is the heading the camera LOOKS along, same as everywhere (3.1: forward = (sin yaw, cos yaw)).
// pitchDeg is how far the camera sits above the pivot, looking down. The screen's right-hand direction on the
// floor is (-cos yaw, sin yaw). Dragging right turns the view left (yaw grows), dragging down raises the camera
// (pitch grows), the same feel as OrbitControls.
import * as THREE from 'three';
import { boomDistance } from '../core/grid-query';
import type { Grid, Vec2, Vec3 } from '../types';
import { clampDt, damp, ease01, springAngleTo, springTo } from './smooth';
import type { Spring } from './smooth';

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

/** First person (SPEC 16.6.8, 16.18): vertical field of view by aspect (72 on a desktop or tablet landscape; a portrait phone has a narrow slice, so 80), the near plane (a wall 15 cm from the eye does not clip), and how far down and up the walker may look. */
const FP_FOV_DEG = 72;
const FP_FOV_PORTRAIT_DEG = 80;
const FP_NEAR_M = 0.03;
const THIRD_NEAR_M = 0.05;
/** third person, close to a wall (SPEC 16.18): below 0.95 m of boom the camera glides to the walker's eyes (a gentle fade into first person), and is there at 0.4 m. Seen from 40 cm behind the head, a room is hidden by a back. */
const CLOSE_FULL_M = 0.4;
const CLOSE_NONE_M = 0.95;
const EYE_RATIO = 0.93;
const fpFov = (aspect: number): number => (aspect < 1 ? FP_FOV_PORTRAIT_DEG : FP_FOV_DEG);
const thirdFovFor = (aspect: number): number => (aspect < 1 ? 70 : 60);

/**
 * Smoothing (SPEC 16.18). Every time below is a critically damped smooth time in seconds (about 60 % of the way in one smooth time, 99 % in three),
 * the exact solution over the frame (src/engine/smooth.ts), so 30 and 120 fps feel the same and a long frame cannot jump.
 */
/** a look drag (yaw and pitch, both views): fluid, not laggy */
const LOOK_SMOOTH_S = 0.12;
/** the boom, shortening and lengthening: it never pops, and never goes more than BOOM_INTRUSION_M past the collision length */
const BOOM_SHORTEN_S = 0.14;
/** lengthening is slower than shortening: it lets the camera back out gently (a peak of about 2 m/s for a 1.5 m change) */
const BOOM_LENGTHEN_S = 0.45;
const BOOM_INTRUSION_M = 0.1;
/** the pivot the third-person camera follows (steps of the walker's collision slide) */
const PIVOT_TAU_S = 0.045;
/** first person: the eye's height is held steady (a head bone bobs a little), its position is nearly direct */
const EYE_Y_TAU_S = 0.14;
const EYE_XZ_TAU_S = 0.03;
/** view switches (first <-> third) cross-fade over this long */
const VIEW_BLEND_S = 0.36;
const FP_PITCH_MIN_DEG = -80;
const FP_PITCH_MAX_DEG = 80;
/** Lying on a bed the walker looks at the ceiling: this much above level, eased in. */
const FP_LIE_PITCH_DEG = -55;

export class FollowCamera {
  /** Heading the camera looks along, degrees. Walk input is relative to this. */
  yawDeg = 0;
  /** Elevation of the camera above the pivot, degrees: -5 to 60. */
  pitchDeg = DEFAULT_PITCH_DEG;
  /** Wanted boom length, metres: 1.0 to 3.5. The boom actually used can be shorter (see `boom`). */
  distance = DEFAULT_BOOM_M;
  /** Ceiling height used for the boom's top limit; update it if the layout changes. */
  ceilingM: number;
  /** the longest boom and the steepest look-down the player can ask for: an open-air space (SPEC 19.5) allows more of both */
  private boomMax = BOOM_MAX_M;
  private pitchMax = PITCH_MAX_DEG;
  /** an open-air space: the boom stops at the edge of the space instead of passing into nothing (through a doorway, over a railing) */
  private blockVoid = false;

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
  private firstPersonOn = false;
  private fpEye: Vec3 | null = null;
  private fpPitch = 0;
  private fpBias = 0;
  private fpBiasTarget = 0;
  private yawTween: { from: number; to: number; t: number; dur: number } | null = null;
  private closeFade = 0;
  // smoothed state (SPEC 16.18): the heading and elevation the pose is built from, the boom, the pivot and the eye
  private yawSp: Spring = { value: 0, velocity: 0 };
  private pitchSp: Spring = { value: DEFAULT_PITCH_DEG, velocity: 0 };
  private fpPitchSp: Spring = { value: 0, velocity: 0 };
  private boomSp: Spring = { value: DEFAULT_BOOM_M, velocity: 0 };
  private pivotS: Vec2 | null = null;
  private eyeS: Vec3 | null = null;
  private smoothReady = false;
  /** 0 = third person, 1 = first person; moves towards `firstPersonOn` over VIEW_BLEND_S */
  private blendV = 0;
  // the public director layer: a driven pose, the body, a temporary field of view
  private drive = { weight: 0, target: 0, tau: 0.4, springs: [0, 1, 2, 3, 4, 5].map((): Spring => ({ value: 0, velocity: 0 })), smooth: 0.4, on: false };
  private bodyHiddenOverride: boolean | null = null;
  private fovOverride = { deg: null as number | null, sp: { value: 0, velocity: 0 } as Spring, smooth: 0.4, active: false, init: false };

  constructor(camera: THREE.PerspectiveCamera, getGrid: () => Grid, ceilingM: number) {
    this.camera = camera;
    this.getGrid = getGrid;
    this.ceilingM = ceilingM;
    // the viewer's resize asks for the field of view of the view as it is now (SPEC 16.18)
    camera.userData.fovFor = (aspect: number): number => thirdFovFor(aspect) + (fpFov(aspect) - thirdFovFor(aspect)) * ease01(this.blendV);
    camera.near = 0.05;
    camera.far = 200;
    camera.updateProjectionMatrix();
  }

  /**
   * An open-air space has no ceiling and a lot to look at: a longer boom, a steeper look-down and a higher, wider start (a nicer view of a
   * pool or a lawn than the 2 m boom of a room). First person is unchanged.
   */
  setOpenAir(on: boolean): void {
    this.boomMax = on ? 6.5 : BOOM_MAX_M;
    this.pitchMax = on ? 72 : PITCH_MAX_DEG;
    this.blockVoid = on;
    if (on) { this.distance = 3.8; this.pitchDeg = 22; this.haveBoom = false; }
  }

  /** Current boom length after collision. The buyer hides the character below 0.7 m and shows it again above 0.8 m. */
  get boom(): number {
    return this.boomLen;
  }

  /** The heading the camera actually has this frame (differs from yawDeg only while a focus is blending in or out). */
  get viewYawDeg(): number {
    return this.viewYaw;
  }

  /** True when the view is (or is gliding to) first person: no body in shot, the camera at the walker's eyes. */
  get firstPerson(): boolean {
    return this.firstPersonOn;
  }
  /** Switches view with a 360 ms cross-fade (never a cut). `setView(on, { instant: true })` for a start-up or a test. */
  set firstPerson(on: boolean) {
    this.setView(on);
  }
  setView(on: boolean, opts: { instant?: boolean } = {}): void {
    const changed = on !== this.firstPersonOn;
    this.firstPersonOn = on;
    if (changed) {
      this.focusActive = false;
      this.focusT = 0;
      this.focus = null;
      this.fpPitch = 0;
      this.fpBias = 0;
      this.fpBiasTarget = 0;
      this.yawTween = null;
      if (on) { this.fpPitchSp = { value: 0, velocity: 0 }; this.eyeS = null; }
      else { this.haveBoom = false; this.boomLen = this.distance; }
    }
    if (opts.instant) this.blendV = on ? 1 : 0;
    this.applyFov(this.camera.aspect);
  }
  /** 0..1: how far the camera has glided to the walker's eyes. 1 in first person; in third person it rises as a wall behind the walker shortens the boom. The page hides the body above 0.55. */
  get fade(): number {
    if (this.bodyHiddenOverride !== null) return this.bodyHiddenOverride ? 1 : 0;
    return Math.max(this.closeFade, ease01(this.blendV));
  }
  /** 0 (third person) .. 1 (first person): the cross-fade as it runs. */
  get viewBlend(): number {
    return ease01(this.blendV);
  }

  // ---- the director layer: a small public API for a driver that is not this file (the tour, a cut-scene, a screenshot)

  /**
   * Eases the camera to this pose over about `smoothTimeSec` (critically damped, no overshoot; the position and the point looked at are each smoothed)
   * and holds it, whatever the walker and the look drag do, until `releaseDrive`. Call it again with a new pose to move on: the motion stays continuous.
   * The caller is responsible for a pose that is inside the home (the camera does not collide while driven).
   */
  driveTo(position: Vec3, lookAt: Vec3, smoothTimeSec = 0.4): void {
    const d = this.drive;
    d.smooth = Math.max(0.05, smoothTimeSec);
    d.target = 1;
    if (!d.on) {
      d.on = true;
      // start from where the camera is now, so taking over never cuts
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      const look = new THREE.Vector3().copy(this.camera.position).addScaledVector(dir, 5);
      const start = [this.camera.position.x, this.camera.position.y, this.camera.position.z, look.x, look.y, look.z];
      d.springs.forEach((sp, i) => { sp.value = start[i]; sp.velocity = 0; });
    }
    this.driveGoal = [position.x, position.y, position.z, lookAt.x, lookAt.y, lookAt.z];
  }
  /** Gives the camera back to the walker, gliding over about `smoothTimeSec`. */
  releaseDrive(smoothTimeSec = 0.4): void {
    this.drive.smooth = Math.max(0.05, smoothTimeSec);
    this.drive.target = 0;
  }
  /** true while a driven pose has any say in the picture */
  get driven(): boolean {
    return this.drive.on;
  }
  /** `true` hides the body, `false` shows it, `null` leaves it to the camera (the fade near a wall, first person). The page reads `fade`. */
  setBodyHidden(hidden: boolean | null): void {
    this.bodyHiddenOverride = hidden;
  }
  /** A temporary vertical field of view in degrees, eased in over `smoothTimeSec`; `null` eases back to the view's own. */
  setFov(deg: number | null, smoothTimeSec = 0.4): void {
    this.fovOverride.smooth = Math.max(0.05, smoothTimeSec);
    this.fovOverride.deg = deg;
    if (deg !== null) this.fovOverride.active = true;
  }
  private driveGoal: number[] = [0, 0, 0, 0, 0, 0];

  /** the vertical field of view of the view as it is now (the cross-fade between third and first person, then any temporary override), set on the camera */
  private applyFov(aspect: number, dt = 0): void {
    const e = ease01(this.blendV);
    let fov = thirdFovFor(aspect) + (fpFov(aspect) - thirdFovFor(aspect)) * e;
    const o = this.fovOverride;
    if (o.active) {
      if (!o.init) { o.sp.value = this.camera.fov || fov; o.sp.velocity = 0; o.init = true; }
      springTo(o.sp, o.deg ?? fov, o.smooth, dt);
      if (o.deg === null && Math.abs(o.sp.value - fov) < 0.02 && Math.abs(o.sp.velocity) < 0.05) { o.active = false; o.init = false; } else fov = o.sp.value;
    }
    const near = THIRD_NEAR_M + (FP_NEAR_M - THIRD_NEAR_M) * e;
    if (Math.abs(this.camera.fov - fov) > 1e-3 || Math.abs(this.camera.near - near) > 1e-5) {
      this.camera.fov = fov;
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /** The eyes, world metres, each frame while `firstPerson` is on (the walker's `eyePosition`). */
  setEye(p: Vec3): void {
    this.fpEye = { x: p.x, y: p.y, z: p.z };
  }

  /** First person: look this many degrees below level (a composed view, SPEC 2.10). `instant` skips the easing (the camera is driven over it anyway). */
  setFirstPersonPitch(deg: number, instant = false): void {
    this.fpPitch = clamp(deg, FP_PITCH_MIN_DEG, FP_PITCH_MAX_DEG);
    this.fpBiasTarget = 0;
    if (instant) { this.fpBias = 0; this.fpPitchSp = { value: this.fpPitch, velocity: 0 }; }
  }

  /** Eases the heading to `yawDeg` over `seconds` by the short way round (first person: face the way a seat or a bed points). */
  turnTo(yawDeg: number, seconds = 0.5): void {
    this.yawTween = { from: this.yawDeg, to: this.yawDeg + angleDiff(this.yawDeg, yawDeg), t: 0, dur: Math.max(0.05, seconds) };
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
    if (this.firstPersonOn) {
      // no figure to frame: on the bed (a steep view of it) the walker looks up at the ceiling, on a sofa straight ahead
      this.fpBiasTarget = pitchDeg >= 40 ? FP_LIE_PITCH_DEG : 0;
      return;
    }
    // a portrait phone sees a much narrower slice: pull back so the whole bed or sofa stays in frame (never past the 8 m cap)
    const aspect = this.camera.aspect > 0 ? this.camera.aspect : 1.6;
    const fit = aspect < 1 ? clamp(0.75 / aspect, 1, 1.7) : 1;
    const dist = clamp(distance * fit, 0.5, 8);
    const pitch = clamp(pitchDeg, PITCH_MIN_DEG, 85);
    this.focus = {
      centre: { ...centre },
      distance: dist,
      pitchDeg: pitch,
      yawDeg: this.bestFocusYaw(centre, dist, pitch, yawDeg ?? this.viewYaw),
    };
    this.focusActive = true;
  }

  /**
   * Integrator fix: furniture usually stands against a wall, so the requested heading can put the boom straight
   * into that wall. Try headings in 15 degree steps outward from the requested one and keep the first whose boom
   * is at least 90% free; otherwise the one with the most room.
   */
  private bestFocusYaw(centre: Vec3, distance: number, pitchDeg: number, wantYaw: number): number {
    const pr = pitchDeg * DEG;
    let best = wantYaw, bestFree = -1;
    for (let i = 0; i < 24; i++) {
      const off = (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * 15;
      const yaw = wantYaw + off, yr = yaw * DEG;
      const dir: Vec3 = { x: -Math.sin(yr) * Math.cos(pr), y: Math.sin(pr), z: -Math.cos(yr) * Math.cos(pr) };
      const free = boomDistance(this.getGrid(), centre, dir, distance, this.ceilingM, true);
      if (free >= 0.9 * distance) return yaw;
      if (free > bestFree) { bestFree = free; best = yaw; }
    }
    return best;
  }

  /** Swings back to following the character. The heading it had in the focus is kept. */
  releaseFocus(): void {
    if (this.firstPersonOn) { this.fpBiasTarget = 0; return; }
    if (this.focus) this.yawDeg = this.focus.yawDeg;
    this.focusActive = false;
  }

  update(dtIn: number, look: { dx: number; dy: number; zoom: number }): void {
    const dt = clampDt(dtIn);
    // the view cross-fade
    const goal = this.firstPersonOn ? 1 : 0;
    if (this.blendV !== goal) this.blendV = this.blendV < goal ? Math.min(goal, this.blendV + dt / VIEW_BLEND_S) : Math.max(goal, this.blendV - dt / VIEW_BLEND_S);
    const e = ease01(this.blendV);
    // the look drag belongs to the view the walker is going to
    const none = { dx: 0, dy: 0, zoom: 0 };
    let pos: THREE.Vector3, dir: THREE.Vector3;
    if (e >= 1) { const f = this.stepFirst(dt, look); pos = f.pos; dir = f.dir; }
    else if (e <= 0) { const t = this.stepThird(dt, look); pos = t.pos; dir = t.dir; }
    else {
      // between the two: both poses are built (the look drag goes to the view being switched to), then blended in position and direction
      const t = this.stepThird(dt, this.firstPersonOn ? none : look);
      const f = this.stepFirst(dt, this.firstPersonOn ? look : none);
      pos = t.pos.clone().lerp(f.pos, e);
      dir = t.dir.clone().lerp(f.dir, e).normalize();
    }
    this.applyFov(this.camera.aspect, dt);
    // a driven pose (the tour, a cut-scene) takes over with a weight that eases in and out
    const d = this.drive;
    if (d.on) {
      d.weight = springWeight(d, dt);
      d.springs.forEach((sp, i) => { springTo(sp, this.driveGoal[i], d.smooth, dt); });
      const w = ease01(d.weight);
      const dp = new THREE.Vector3(d.springs[0].value, d.springs[1].value, d.springs[2].value);
      const dl = new THREE.Vector3(d.springs[3].value, d.springs[4].value, d.springs[5].value);
      const dd = dl.sub(dp);
      if (dd.lengthSq() > 1e-9) dd.normalize(); else dd.copy(dir);
      pos = pos.clone().lerp(dp, w);
      dir = dir.clone().lerp(dd, w).normalize();
      if (d.target === 0 && d.weight < 1e-3) { d.on = false; d.weight = 0; }
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.x + dir.x * 5, pos.y + dir.y * 5, pos.z + dir.z * 5);
  }

  /** the third-person pose: the pivot, the boom shortened by the grid, glides to the eyes close to a wall */
  private stepThird(dt: number, look: { dx: number; dy: number; zoom: number }): { pos: THREE.Vector3; dir: THREE.Vector3 } {
    // 1. look and zoom act on the focus while one is active, otherwise on the follow values
    const f = this.focusActive ? this.focus : null;
    if (f) {
      f.yawDeg += look.dx * LOOK_DEG_PER_PX;
      f.pitchDeg = clamp(f.pitchDeg + look.dy * LOOK_DEG_PER_PX, PITCH_MIN_DEG, 85);
      f.distance = clamp(f.distance + look.zoom * ZOOM_M_PER_NOTCH, BOOM_MIN_M, 8);
    } else {
      this.yawDeg += look.dx * LOOK_DEG_PER_PX;
      this.pitchDeg = clamp(this.pitchDeg + look.dy * LOOK_DEG_PER_PX, PITCH_MIN_DEG, this.pitchMax);
      this.distance = clamp(this.distance + look.zoom * ZOOM_M_PER_NOTCH, BOOM_MIN_M, this.boomMax);
    }
    this.pitchDeg = clamp(this.pitchDeg, PITCH_MIN_DEG, this.pitchMax);
    this.distance = clamp(this.distance, BOOM_MIN_M, this.boomMax);

    // 2. focus blend 0..1 over 0.5 s
    const step = dt / FOCUS_S;
    this.focusT = clamp(this.focusT + (this.focusActive ? step : -step), 0, 1);
    if (this.focusT === 0 && !this.focusActive) this.focus = null;
    const s = this.focus ? smooth(this.focusT) : 0;

    // 3. wanted heading, elevation, boom and pivot (the focus blended in), then the heading and elevation actually used: smoothed
    const fo = this.focus;
    const yawWant = fo ? this.yawDeg + angleDiff(this.yawDeg, fo.yawDeg) * s : this.yawDeg;
    const pitchWant = fo ? this.pitchDeg + (fo.pitchDeg - this.pitchDeg) * s : this.pitchDeg;
    const wanted = fo ? this.distance + (fo.distance - this.distance) * s : this.distance;
    this.smoothInit(yawWant, pitchWant);
    springAngleTo(this.yawSp, yawWant, LOOK_SMOOTH_S, dt);
    springTo(this.pitchSp, pitchWant, LOOK_SMOOTH_S, dt);
    if (Math.abs(this.yawSp.value) > 720) this.yawSp.value -= 360 * Math.round(this.yawSp.value / 360);
    const yaw = this.yawSp.value, pitch = clamp(this.pitchSp.value, PITCH_MIN_DEG, 85);
    this.viewYaw = yaw;

    // the pivot the camera follows is the walker's, lightly smoothed (a slide along a wall is a staircase of small steps)
    const pv = this.pivotS ?? (this.pivotS = { x: this.target.x, z: this.target.z });
    pv.x = damp(pv.x, this.target.x, PIVOT_TAU_S, dt);
    pv.z = damp(pv.z, this.target.z, PIVOT_TAU_S, dt);
    const yr = yaw * DEG;
    const shoulder = SHOULDER_M * (1 - s);
    const pivot: Vec3 = {
      x: pv.x - Math.cos(yr) * shoulder,
      y: PIVOT_HEIGHT_RATIO * this.heightM,
      z: pv.z + Math.sin(yr) * shoulder,
    };
    if (fo) {
      pivot.x += (fo.centre.x - pivot.x) * s;
      pivot.y += (fo.centre.y - pivot.y) * s;
      pivot.z += (fo.centre.z - pivot.z) * s;
    }

    // 4. boom: behind and above the pivot, as long as the grid allows. The boom's own length is critically damped (no pop when a doorframe
    // swings across the ray); the camera may sit up to BOOM_INTRUSION_M past the collision length, which already stops 0.2 m short of a wall
    const pr = pitch * DEG;
    const dir: Vec3 = { x: -Math.sin(yr) * Math.cos(pr), y: Math.sin(pr), z: -Math.cos(yr) * Math.cos(pr) };
    // While focused, the pivot sits on the furniture itself, so low furniture must not block the boom.
    const free = boomDistance(this.getGrid(), pivot, dir, wanted, this.ceilingM, s > 0, this.blockVoid);
    if (!this.haveBoom) { this.boomSp.value = free; this.boomSp.velocity = 0; this.haveBoom = true; }
    springTo(this.boomSp, free, free < this.boomSp.value ? BOOM_SHORTEN_S : BOOM_LENGTHEN_S, dt);
    const cap = free + BOOM_INTRUSION_M;
    if (this.boomSp.value > cap) { this.boomSp.value = cap; if (this.boomSp.velocity > 0) this.boomSp.velocity = 0; }
    this.boomLen = Math.max(0, this.boomSp.value);

    const px = pivot.x + dir.x * this.boomLen, py = pivot.y + dir.y * this.boomLen, pz = pivot.z + dir.z * this.boomLen;
    // close to a wall: glide from the boom to the eyes, and look ahead instead of at the back (no pop: the blend is continuous in the boom length)
    const k = clamp((this.boomLen - CLOSE_FULL_M) / (CLOSE_NONE_M - CLOSE_FULL_M), 0, 1);
    const t = (1 - smooth(k)) * (1 - s);
    this.closeFade = this.closeFade + (t - this.closeFade) * (1 - Math.exp(-dt / 0.08));
    const c = this.closeFade;
    if (c > 1e-3) {
      const ex = pv.x - Math.sin(yr) * 0.04, ey = EYE_RATIO * this.heightM, ez = pv.z - Math.cos(yr) * 0.04;
      const ax = ex + Math.sin(yr) * Math.cos(pr) * 2, ay = ey - Math.sin(pr) * 2, az = ez + Math.cos(yr) * Math.cos(pr) * 2;
      const pos = new THREE.Vector3(px + (ex - px) * c, py + (ey - py) * c, pz + (ez - pz) * c);
      const look3 = new THREE.Vector3(pivot.x + (ax - pivot.x) * c, pivot.y + (ay - pivot.y) * c, pivot.z + (az - pivot.z) * c);
      return { pos, dir: look3.sub(pos).normalize() };
    }
    const pos = new THREE.Vector3(px, py, pz);
    return { pos, dir: new THREE.Vector3(pivot.x - px, pivot.y - py, pivot.z - pz).normalize() };
  }

  /** the first-person pose: the eyes (height held steady), looking along the smoothed heading and elevation */
  private stepFirst(dt: number, look: { dx: number; dy: number; zoom: number }): { pos: THREE.Vector3; dir: THREE.Vector3 } {
    if (this.yawTween) {
      const tw = this.yawTween;
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      this.yawDeg = tw.from + (tw.to - tw.from) * smooth(k);
      if (look.dx !== 0 || k >= 1) this.yawTween = null;
    }
    this.yawDeg += look.dx * LOOK_DEG_PER_PX;
    this.fpPitch = clamp(this.fpPitch + look.dy * LOOK_DEG_PER_PX, FP_PITCH_MIN_DEG, FP_PITCH_MAX_DEG);
    this.fpBias += (this.fpBiasTarget - this.fpBias) * (1 - Math.exp(-dt * 3));
    const pitchWant = clamp(this.fpPitch + this.fpBias, FP_PITCH_MIN_DEG, FP_PITCH_MAX_DEG);
    this.smoothInit(this.yawDeg, DEFAULT_PITCH_DEG);
    springAngleTo(this.yawSp, this.yawDeg, LOOK_SMOOTH_S * 0.75, dt);
    springTo(this.fpPitchSp, pitchWant, LOOK_SMOOTH_S * 0.75, dt);
    if (Math.abs(this.yawSp.value) > 720) this.yawSp.value -= 360 * Math.round(this.yawSp.value / 360);
    this.viewYaw = this.yawSp.value;
    this.boomLen = 0; // the buyer page hides the body
    const eye = this.fpEye ?? { x: this.target.x, y: PIVOT_HEIGHT_RATIO * this.heightM, z: this.target.z };
    const es = this.eyeS ?? (this.eyeS = { x: eye.x, y: eye.y, z: eye.z });
    es.x = damp(es.x, eye.x, EYE_XZ_TAU_S, dt);
    es.z = damp(es.z, eye.z, EYE_XZ_TAU_S, dt);
    // a seat or a bed moves the eye a long way: that is let through quickly; the walking bob of the head is what the slow height filter removes
    const dy = Math.abs(eye.y - es.y);
    es.y = damp(es.y, eye.y, dy > 0.12 ? EYE_Y_TAU_S * 0.35 : EYE_Y_TAU_S, dt);
    const pitch = clamp(this.fpPitchSp.value, FP_PITCH_MIN_DEG, FP_PITCH_MAX_DEG) * DEG;
    const yr = this.viewYaw * DEG;
    const dir = new THREE.Vector3(Math.sin(yr) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yr) * Math.cos(pitch));
    return { pos: new THREE.Vector3(es.x, es.y, es.z), dir };
  }

  /** the smoothed heading and elevation start where the view is, not at zero (the first frame, and after a long pause) */
  private smoothInit(yaw: number, pitch: number): void {
    if (this.smoothReady) return;
    this.smoothReady = true;
    this.yawSp = { value: yaw, velocity: 0 };
    this.pitchSp = { value: pitch, velocity: 0 };
  }
}

/** the weight of a driven pose moves towards its target with the drive's own smooth time */
function springWeight(d: { weight: number; target: number; smooth: number }, dt: number): number {
  const rate = dt / d.smooth;
  return d.target > d.weight ? Math.min(d.target, d.weight + rate * 1.6) : Math.max(d.target, d.weight - rate * 1.6);
}
