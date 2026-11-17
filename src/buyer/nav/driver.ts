// The auto-walk: go to a room, and the room-by-room tour. A state machine over pure pieces, no DOM and no three: the walker, the camera, the walk
// grids and the doors come in through `DriverDeps`, so the same code runs in the page (src/buyer/nav/mount.ts) and in a unit test on the real layout.
//
// HOW IT MOVES (SPEC 2.6). A route is planned on the grid without any shut door leaf (grid-path.ts) and cut at the first shut door it goes through,
// at a spot outside that leaf's whole swing. The string-pulled route is rounded into a curve (glide.ts), a speed profile is worked out for it (eased
// start and stop with a jerk limit, slower in bends and doorways, ending at rest or running on), and the walker is moved along it by time. The camera
// looks along the path 1.2 m ahead through a critically damped follower, so it never snaps. A door ahead is opened when 1.5 m away: if it stands open
// by the time the walker reaches it the route is planned again from where they are, at the speed they have, and the glide goes on; if not, the speed
// profile has already eased them to a stop and they go on when it is open.
//
// FRAME RATE. Everything is integrated in fixed steps of 1/120 s (`SIM_DT`) from the real `dt` of the frames (a frame longer than a tenth of a second
// counts as a tenth), the profile is a function of time, and nothing counts frames: 20, 60 and 120 frames a second give the same path and the same
// duration. The body still moves with the same collision as walking by hand (`moveCircle` on the live grid).
import { CHARACTER_RADIUS_M } from '../../types';
import type { Grid, Layout, Vec2 } from '../../types';
import { circleFree, moveCircle, nearestFree } from '../../core/grid-query';
import { pointInPolygon } from '../../core/geometry';
import { reachableFast } from '../../building/clear-routes';
import { chooseSpawn } from '../../core/spawn';
import { freePos } from '../../core/doors';

import { roomAt } from '../../core/layout-geom';
import type { Door } from '../../core/doors';
import { findRoute, routesFrom } from './grid-path';
import { cutRoute, doorway, firstCrossing, gatesOf, isOpenEnough, planGridOf, standOffM } from './door-route';
import type { LeafState } from './door-route';
import { SHORTCUT_LAST_M, SHORTCUT_WALK_S, goPlan, pointAlongRoute } from './nav-model';
import { DWELL_S, pickNext, tourStops } from './tour-plan';
import type { Skipped, TourStop, Vantage } from './tour-plan';
import { GO_KIN, SIM_DT, TOUR_KIN, buildProfile, dampAngle, makeCurve, profileAt, roundCorners, smootherstep, speedCap } from './glide';
import type { Curve, Kinematics, Profile } from './glide';

const DEG = Math.PI / 180;
/** Speeds, m/s. A tour glides at a gentle pace; going to a room is a brisk, eased walk. */
export const TOUR_WALK_MPS = TOUR_KIN.vc;
export const GO_WALK_MPS = GO_KIN.vc;
/** A path no longer than this is walked; a longer one is a fade. */
/** What the glide never exceeds (the tests hold it to these, SPEC 2.6): heading rate, deg/s, and its change, deg/s^2. */
export const MAX_YAW_RATE_DEG_S = 60;
/** Where the camera looks along the path: this far ahead (m). */
const LOOK_AHEAD_M = 1.2;
/** The camera's follower: natural frequency (rad/s) for the tour and for going to a room. */
/** The longest route a go-to looks for, metres (a whole building floor). */
const ROUTE_MAX_M = 150;
const OMEGA_TOUR = 2.8, OMEGA_GO = 4.0;
/** The wanted heading is smoothed with this time constant (s) before the follower. */
const GOAL_TAU_S = 0.5;
/** The body turns a little quicker than the view, which is the point of a look-ahead. */
const OMEGA_BODY = 6;
/** A door is opened this far before the walker reaches the spot they stand at to open it (m). */
const DOOR_AHEAD_M = 1.5;
const STALL_S = 1.0, MAX_REPLANS = 3, MAX_DOOR_TRIES = 2, DOOR_WAIT_MAX_S = 20;
/** The slow arc at a vantage point, degrees: never less, never more. */
const ARC_MIN_DEG = 40, ARC_MAX_DEG = 70;
/** A tour's camera pitch, degrees down (a few, constant). */
export const TOUR_PITCH_DEG = 3;

export interface DriverDeps {
  layout: Layout;
  character: { position: Vec2; yawDeg: number; setLocomotion(speed: number, jog: boolean, turnRadS?: number): void };
  /** the heading the camera looks along: walk input is relative to it, and a first-person view looks along it */
  camera: { yawDeg: number };
  /** walls, furniture and people, with no door leaf on it: where a route may be planned */
  staticGrid(): Grid;
  /** what the body really collides with right now (leaves, people, everything) */
  liveGrid(): Grid;
  /** every door leaf and how far it stands open */
  leaves(): LeafState[];
  /** swings a door open and resolves when the leaf stands still (as far as it could go) */
  openDoor(doorId: string): Promise<unknown>;
  /** puts the walker at a place and heading with a cut or a fade (a long way, or no walkable path) */
  jump(to: { x: number; z: number; yawDeg: number }): Promise<void>;
  /** no glides and no pans: cuts with a fade */
  reducedMotion(): boolean;
  /** what a room is about (bed, sofa, table, counter), where it stands: the tour looks that way. Optional. */
  focal?(roomId: string): Vec2 | null;
  /** the tour's own camera (first person at eye height, the body hidden, a wider lens): entered when a tour starts, left when it ends or is interrupted */
  presentation?: { enter(): void; exit(): void };
}

export type WalkResult = 'arrived' | 'failed' | 'cancelled' | 'skipped' | 'cut';
export type GoResult = 'walked' | 'jumped' | 'no-spot' | 'cancelled';
export type TourPhase = 'walking' | 'door' | 'looking' | 'returning' | 'done' | 'stopped';

export interface TourState {
  active: boolean;
  paused: boolean;
  phase: TourPhase;
  /** stops reached so far, counting the one the walker is at */
  index: number;
  total: number;
  roomId: string | null;
  roomLabel: string | null;
  skipped: Skipped[];
  /** every stop visited, in order */
  visited: string[];
  /** how long the tour has run in the walker's own time (s) */
  elapsedS: number;
  /** which round of a looping tour this is (1 for a tour that runs once) */
  loop: number;
}

export interface TourOptions { loop?: boolean }

interface WalkAction {
  kind: 'walk';
  /** a leg the tour has already ended with a skip: it keeps moving for the rest of this frame and the next leg takes over at its speed, so a skip is one continuous eased move, not a stop and a catch-up */
  ghost?: boolean;
  target: Vec2;
  kin: Kinematics;
  /** end the walk after this many seconds of walking (a long go-to: the page fades on from there), or Infinity */
  cutAfterS: number;
  /** seconds spent walking so far, over every leg a door replanned (a.t starts again at each plan) */
  walkedS: number;
  /** the speed to arrive at: 0 (a stop) or on through */
  vEnd: number;
  curve: Curve;
  profile: Profile;
  t: number;
  /** distance along the curve now, and the speed there (from the profile) */
  s: number;
  v: number;
  /** points the route passes through on the way (a passage: glided through, no stop) */
  via: Vec2[];
  /** the shut door this leg ends at (open it, then plan again), or null when the leg ends at the target */
  door: Door | null;
  doorAsked: boolean;
  doorDone: boolean;
  doorReading?: unknown;
  doorWaitS: number;
  tries: Map<string, number>;
  stallS: number;
  replans: number;
  /** a wait at a door the walker has come to rest at */
  waiting: boolean;
  done: (r: WalkResult) => void;
}
interface LookAction {
  kind: 'look';
  t: number;
  dur: number;
  /** the heading to ease to over the dwell, degrees (continuous: the look starts from the heading the camera has) */
  from: number;
  sweep: number;
  /** exact end heading (a go-to settles on it) or null to leave the camera where the arc ended */
  settle: number | null;
  done: () => void;
}
type Action = WalkAction | LookAction;

const angleDiff = (from: number, to: number): number => {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
};

export class Driver {
  private action: Action | null = null;
  private token = 0;
  private paused = false;
  private tourState: TourState | null = null;
  private listeners = new Set<() => void>();
  private tourClock = 0;
  /** the view's heading follower and the body's: continuous across every action */
  private cam = { yaw: 0, rate: 0 };
  private body = { yaw: 0, rate: 0 };
  private seeded = false;
  private camGoal = 0;
  /** the time left over from the last frame, s */
  private acc = 0;
  /** speed carried into the next leg (m/s): a skip or a door that opened on the way does not stop the glide */
  private carryV = 0;
  private skipAsked = false;
  private presenting = false;
  private dwell = 0;
  private lastSpeed = 0;
  /** why the last walk ended in failure (for the debug hook and the tests; the buyer is told only that a room could not be reached) */
  lastFail: string | null = null;

  constructor(private readonly deps: DriverDeps) {}

  /** called whenever the tour's state changes (a new stop, paused, done) */
  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private emit(): void { for (const cb of [...this.listeners]) { try { cb(); } catch (e) { console.error('[walkthru] nav listener threw', e); } } }

  /** true while a go-to or a tour owns the walker */
  get busy(): boolean { return this.action !== null || (this.tourState?.active ?? false); }
  get touring(): boolean { return this.tourState?.active ?? false; }
  get tour(): TourState | null { return this.tourState ? { ...this.tourState, skipped: [...this.tourState.skipped], visited: [...this.tourState.visited] } : null; }
  /** how far through the dwell at the current stop the camera is, 0..1 (the tour card's line); 0 while walking */
  get dwellProgress(): number { return this.dwell; }
  /** the view's heading rate, deg/s, and the speed, m/s (for the motion plots and the tests) */
  get motion(): { yawRate: number; speed: number } { return { yawRate: this.cam.rate, speed: this.lastSpeed }; }

  pause(): void { if (this.touring && !this.paused) { this.paused = true; this.setTour({ paused: true }); } }
  resume(): void { if (this.paused) { this.paused = false; this.setTour({ paused: false }); } }
  /** Skips to the next room of a running tour with an eased move: the dwell or the leg ends and the next leg starts at the speed they have. */
  next(): void { if (this.touring) this.skipAsked = true; }

  /** Ends whatever is running where the walker stands. */
  stop(): void {
    this.token++;
    this.seeded = false;
    const a = this.action;
    this.action = null;
    this.paused = false;
    this.skipAsked = false;
    this.carryV = 0;
    this.dwell = 0;
    if (a?.kind === 'walk') a.done('cancelled'); else a?.done();
    this.deps.character.setLocomotion(0, false, 0);
    this.leavePresentation();
    if (this.tourState?.active) this.setTour({ active: false, paused: false, phase: 'stopped' });
  }

  private enterPresentation(): void { if (!this.presenting) { this.presenting = true; this.deps.presentation?.enter(); } }
  private leavePresentation(): void { if (this.presenting) { this.presenting = false; this.deps.presentation?.exit(); } }

  private setTour(patch: Partial<TourState>): void {
    if (!this.tourState) return;
    this.tourState = { ...this.tourState, ...patch };
    this.emit();
  }

  // ---------------------------------------------------------------- per frame

  /** Moves the walker for this frame. Returns true when the auto-walk has the walker (the caller then does not read the keys and the thumb). */
  update(dt: number): boolean {
    if (this.paused && this.action) { this.deps.character.setLocomotion(0, false, 0); return true; }
    // a skipped leg lives only for the frame it was skipped in: if no next leg has taken its place by now (the tour ended), it stops here
    if (this.action?.kind === 'walk' && this.action.ghost) { this.action = null; this.deps.character.setLocomotion(0, false, 0); this.lastSpeed = 0; }
    // the time of every frame is banked and spent in steps of SIM_DT; what a finished action leaves over goes to the next one (a tour's next leg
    // is set up a moment after the last one ends, and must not lose the time in between)
    this.acc = Math.min(this.acc + Math.min(Math.max(dt, 0), 0.1), 0.2);
    if (!this.action) return this.touring; // between two legs of a tour: stand still
    this.seed();
    for (let a = this.action; a && this.acc >= SIM_DT; a = this.action) {
      this.acc -= SIM_DT;
      if (this.tourState?.active) { this.tourClock += SIM_DT; this.tourState.elapsedS = this.tourClock; }
      if (a.kind === 'walk') this.stepWalk(a); else this.stepLook(a);
    }
    return true;
  }

  /** the followers start from the view the walker has now */
  private seed(): void {
    if (this.seeded) return;
    this.seeded = true;
    this.cam = { yaw: this.deps.camera.yawDeg, rate: 0 };
    this.camGoal = this.cam.yaw;
    this.body = { yaw: this.deps.character.yawDeg, rate: 0 };
  }

  private applyHeading(camTarget: number, bodyTarget: number, omega: number): void {
    // the wanted heading is eased before the follower sees it, so a new target (the end of a dwell, a corner) starts a turn gently, not with a kick
    this.camGoal += angleDiff(this.camGoal, camTarget) * (1 - Math.exp(-SIM_DT / GOAL_TAU_S));
    dampAngle(this.cam, this.camGoal, SIM_DT, omega, MAX_YAW_RATE_DEG_S);
    dampAngle(this.body, bodyTarget, SIM_DT, OMEGA_BODY, 220);
    this.deps.camera.yawDeg = this.cam.yaw;
    this.deps.character.yawDeg = this.body.yaw;
  }

  // ---------------------------------------------------------------- walking a route

  private doorMids(): Vec2[] {
    return this.deps.leaves().map((l) => { const w = doorway(l.door); return { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 }; });
  }

  /** Plans (or re-plans from where the walker is) the leg of `a`: the route, its curve, its speed profile. */
  private plan(a: WalkAction): boolean {
    const statics = this.deps.staticGrid();
    const leaves = this.deps.leaves();
    const grid = planGridOf(statics, leaves);
    const start = this.deps.character.position;
    const way = [...a.via, a.target];
    let from = start;
    const all: Vec2[] = [{ x: start.x, z: start.z }];
    for (const w of way) {
      const leg = findRoute(grid, from, w, Infinity, gatesOf(leaves));
      if (!leg) return false;
      all.push(...leg.points.slice(1));
      from = w;
    }
    const route = { points: all };
    const shut = leaves.filter((l) => !isOpenEnough(l)).map((l) => l.door);
    const cross = firstCrossing(route.points, shut);
    let pts: Vec2[];
    if (cross) { pts = cutRoute(route.points, standOffM(route.points, cross.atM, cross.door)); a.door = cross.door; } else { pts = route.points; a.door = null; }
    if (pts.length < 2 || Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].z - pts[0].z) < 1e-4) pts = [pts[0], { x: pts[0].x + 1e-3, z: pts[0].z }];
    const rounded = this.deps.reducedMotion() ? pts : roundCorners(pts, grid, CHARACTER_RADIUS_M);
    a.curve = makeCurve(rounded);
    const vEnd = a.door ? 0 : a.vEnd;
    a.profile = buildProfile(a.curve.length, Math.min(this.carryV, a.kin.vc), vEnd, a.kin, speedCap(a.curve, a.kin, this.doorMids()));
    a.t = 0; a.s = 0; a.v = this.carryV;
    a.doorAsked = a.doorDone = false;
    a.doorWaitS = 0;
    a.stallS = 0;
    a.waiting = false;
    return true;
  }

  /** After a replan, the passages already walked through are not walked to again. */
  private dropPassedVias(a: WalkAction): void {
    if (a.via.length === 0) return;
    const keep: Vec2[] = [];
    for (const v of a.via) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < a.curve.pts.length; i++) { const d = Math.hypot(a.curve.pts[i].x - v.x, a.curve.pts[i].z - v.z); if (d < bd) { bd = d; bi = i; } }
      if (a.curve.cum[bi] > a.s + 0.3) keep.push(v);
    }
    a.via = keep;
  }

  /** Walks to `target` along a planned, rounded route, opening the shut doors on the way. `vEnd` > 0 runs on through the target. */
  walkTo(target: Vec2, kin: Kinematics = TOUR_KIN, opts: { vEnd?: number; via?: Vec2[]; cutAfterS?: number } = {}): Promise<WalkResult> {
    const vEnd = opts.vEnd ?? 0, via = opts.via ?? [];
    return new Promise<WalkResult>((resolve) => {
      const a: WalkAction = {
        kind: 'walk', target: { x: target.x, z: target.z }, kin, cutAfterS: opts.cutAfterS ?? Infinity, walkedS: 0, vEnd, curve: makeCurve([{ x: 0, z: 0 }, { x: 0, z: 1 }]), profile: buildProfile(1, 0, 0, kin, () => 1),
        t: 0, s: 0, v: 0, via: via.map((p) => ({ x: p.x, z: p.z })), door: null, doorAsked: false, doorDone: false, doorWaitS: 0, tries: new Map(), stallS: 0, replans: 0, waiting: false, done: resolve,
      };
      if (!this.plan(a)) { this.lastFail = 'no route'; resolve('failed'); return; }
      this.action = a;
    });
  }

  private finish(a: WalkAction, r: WalkResult): void {
    if (this.action === a) this.action = null;
    // a skip and a cut go on at the speed they have: the next leg takes it over without a step
    const on = r === 'skipped' || r === 'cut';
    this.carryV = on ? a.v : 0;
    this.lastSpeed = on ? this.lastSpeed : 0;
    if (!on) this.deps.character.setLocomotion(0, false, 0);
    a.done(r);
  }

  private stepWalk(a: WalkAction): void {
    const { character: ch } = this.deps;
    const omega = a.kin === GO_KIN ? OMEGA_GO : OMEGA_TOUR;
    if (this.skipAsked && this.touring && !a.ghost) {
      // the tour is told the leg is over (it plans the next one a moment after this frame) but the walker does not stop for what is left of this frame:
      // the leg goes on at the speed it has, and the next leg starts from that speed (carryV). One frame of standing, then a double step, was the hitch.
      this.skipAsked = false;
      a.ghost = true;
      a.done('skipped');
    }
    const door = a.door;
    // the door ahead: ask for it when 1.5 m from the spot to stand at (a short leg asks at once)
    if (door && !a.doorAsked && a.curve.length - a.s <= DOOR_AHEAD_M) {
      a.doorAsked = true;
      const n = (a.tries.get(door.id) ?? 0) + 1;
      a.tries.set(door.id, n);
      if (n > MAX_DOOR_TRIES) { this.lastFail = `door ${door.id} would not open ${JSON.stringify(a.doorReading ?? null)}`; this.finish(a, 'failed'); return; }
      void this.deps.openDoor(door.id).then((r) => { a.doorDone = true; a.doorReading = r; }, () => { a.doorDone = true; });
    }
    if (door && a.doorAsked && a.doorDone) {
      // open: plan again from here, at this speed, and keep going (in this same step: no hitch)
      this.carryV = a.v;
      a.doorAsked = false;
      this.dropPassedVias(a);
      if (!this.plan(a)) { this.lastFail = `no route after ${door.id}`; this.carryV = 0; this.finish(a, 'failed'); return; }
    }
    if (a.waiting) {
      // at rest at a door that is still swinging
      ch.setLocomotion(0, false, 0);
      a.doorWaitS += SIM_DT;
      this.applyHeading(this.cam.yaw, this.body.yaw, omega);
      if (a.doorWaitS > DOOR_WAIT_MAX_S) { a.doorDone = true; a.doorAsked = true; }
      return;
    }
    const pos = ch.position;
    // the timeline waits for a body that is held back (a person, a leaf): it never races to catch up
    const lag = Math.hypot(a.curve.pointAt(a.s).x - pos.x, a.curve.pointAt(a.s).z - pos.z);
    let at = { s: a.s, v: a.v, done: false };
    if (lag <= 0.1) { a.t += SIM_DT; at = profileAt(a.profile, a.t); a.s = at.s; a.v = at.v; }
    if (a.ghost) this.carryV = a.v;
    const want = a.curve.pointAt(a.s);
    let dx = want.x - pos.x, dz = want.z - pos.z;
    const step = Math.hypot(dx, dz);
    const maxStep = Math.max(a.v, a.kin.vc * 0.5) * 1.5 * SIM_DT;
    if (step > maxStep) { dx *= maxStep / step; dz *= maxStep / step; }
    const next = step > 1e-9 ? moveCircle(this.deps.liveGrid(), pos, { x: dx, z: dz }, CHARACTER_RADIUS_M) : pos;
    ch.position = next;
    const achieved = Math.hypot(next.x - pos.x, next.z - pos.z) / SIM_DT;
    this.lastSpeed = achieved;
    // the camera looks 1.2 m down the path; at the end it settles on the way the path was going
    const remaining = a.curve.length - a.s;
    const la = a.curve.pointAt(Math.min(a.curve.length, a.s + LOOK_AHEAD_M));
    const tan = a.curve.tangentAt(Math.min(a.curve.length, a.s + 0.05));
    const lx = la.x - want.x, lz = la.z - want.z;
    const farEnough = Math.hypot(lx, lz) > 0.5;
    const bearing = farEnough ? Math.atan2(lx, lz) / DEG : Math.atan2(tan.x, tan.z) / DEG;
    void remaining;
    this.applyHeading(bearing, Math.atan2(tan.x, tan.z) / DEG, omega);
    // an automatic walk is always the walk clip, never the jog (a run through a flat looks silly in third person); its stride follows the speed
    ch.setLocomotion(achieved, false, Math.abs(this.body.rate) * DEG);
    a.walkedS += SIM_DT;
    if (a.walkedS >= a.cutAfterS && !(a.doorAsked && !a.doorDone)) { this.finish(a, 'cut'); return; }
    // no headway: something is in the way (a person who walked into the route): plan again
    if (lag > 0.3) a.stallS += SIM_DT; else a.stallS = 0;
    if (a.stallS > STALL_S) {
      a.stallS = 0;
      this.carryV = 0;
      this.dropPassedVias(a);
      if (++a.replans > MAX_REPLANS || !this.plan(a)) { this.lastFail = `stalled at ${pos.x.toFixed(2)},${pos.z.toFixed(2)}`; this.finish(a, 'failed'); }
      return;
    }
    if (at.done) {
      if (a.door) {
        // at rest at the door: on as soon as it is open
        if (a.doorAsked && a.doorDone) return; // handled at the top of the next step
        a.waiting = true; a.doorWaitS = 0; this.carryV = 0;
        ch.setLocomotion(0, false, 0);
        return;
      }
      this.finish(a, 'arrived');
    }
  }

  // ---------------------------------------------------------------- standing and looking

  /**
   * Eases the view to `yawDeg` over `dur` seconds (a smootherstep), standing where the walker is. With `sweepDeg` the arc is that long and ends
   * on `yawDeg`; the camera starts from the heading it has, so nothing snaps. `settle` finishes exactly on the heading.
   */
  look(yawDeg: number, dur: number, sweepDeg: number | null = null, settle = false): Promise<void> {
    return new Promise<void>((resolve) => {
      this.seed();
      const reduced = this.deps.reducedMotion();
      const ch = this.deps.character, cam = this.deps.camera;
      if (reduced) { ch.yawDeg = yawDeg; cam.yawDeg = yawDeg; this.cam = { yaw: yawDeg, rate: 0 }; this.camGoal = yawDeg; this.body = { yaw: yawDeg, rate: 0 }; }
      const from = reduced ? yawDeg : this.cam.yaw;
      const sweep = reduced ? 0 : sweepDeg !== null ? Math.sign(angleDiff(from, yawDeg) || 1) * sweepDeg : angleDiff(from, yawDeg);
      this.dwell = 0;
      this.action = { kind: 'look', t: 0, dur: Math.max(0.05, dur), from, sweep, settle: settle ? yawDeg : null, done: resolve };
    });
  }

  private stepLook(a: LookAction): void {
    const { character: ch } = this.deps;
    ch.setLocomotion(0, false, 0);
    this.lastSpeed = 0;
    if (this.skipAsked && this.touring) { this.skipAsked = false; this.dwell = 0; this.endLook(a); return; }
    a.t += SIM_DT;
    const k = Math.min(1, a.t / a.dur);
    this.dwell = this.tourState?.active ? k : 0;
    const target = a.from + a.sweep * smootherstep(a.t / (a.dur * 0.94));
    this.applyHeading(target, target, OMEGA_TOUR);
    if (a.t >= a.dur) {
      if (a.settle !== null) {
        this.cam = { yaw: a.settle, rate: 0 }; this.camGoal = a.settle; this.body = { yaw: a.settle, rate: 0 };
        this.deps.camera.yawDeg = a.settle; ch.yawDeg = a.settle;
      }
      this.dwell = 0;
      this.endLook(a);
    }
  }

  private endLook(a: LookAction): void {
    if (this.action === a) this.action = null;
    a.done();
  }

  // ---------------------------------------------------------------- go to a room

  /**
   * The static grid with every door's leaf stamped at the furthest it opens there: where a door that has been walked through stands. A standing spot
   * is chosen on this grid, so it is never in a pocket that an open leaf and a wardrobe cut off from the doorway (a tour or a tap would find the door
   * open and no way to the spot). Rooms whose leaves cut nothing off keep the start page's own spot.
   */
  private openGrid(): Grid {
    const statics = this.deps.staticGrid();
    const leaves = this.deps.leaves();
    if (leaves.length === 0) return statics;
    return planGridOf(statics, leaves.map((l) => ({ door: l.door, pos: freePos(statics, l.door, 0).pos })));
  }

  /** `p` itself when a body fits there with a hair to spare on the open grid, else the nearest such point inside the room (a toilet's spot hugs its doorway). */
  private clearIn(roomId: string, p: Vec2, open: Grid): Vec2 {
    if (circleFree(open, p.x, p.z, CHARACTER_RADIUS_M + 0.02)) return { x: p.x, z: p.z };
    const room = this.deps.layout.rooms.find((r) => r.id === roomId);
    const q = nearestFree(open, p.x, p.z, CHARACTER_RADIUS_M + 0.02, 1.2);
    return q && room && pointInPolygon(q, room.polygon) ? q : { x: p.x, z: p.z };
  }

  /**
   * `p` when a body can walk to it from inside the room's own doorway with every leaf open, else the nearest spot that is clear and can be (a door that stands open
   * into a room and a wardrobe can cut the room in two: the spot is on the side the doorway is on).
   */
  private reachableIn(roomId: string, p: Vec2, open: Grid): Vec2 {
    const room = this.deps.layout.rooms.find((r) => r.id === roomId);
    if (!room) return p;
    const R = CHARACTER_RADIUS_M + 0.005;
    const starts: Vec2[] = [];
    for (const l of this.deps.leaves()) {
      const d = l.door;
      if (!d.rooms.includes(roomId)) continue;
      const w = doorway(d), c = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
      for (const sg of [1, -1]) for (const off of [0.5, 0.8, 1.1]) {
        const q = { x: c.x + d.out.x * sg * off, z: c.z + d.out.z * sg * off };
        if (pointInPolygon(q, room.polygon) && circleFree(open, q.x, q.z, R)) starts.push(q);
      }
    }
    if (starts.length === 0) return p;
    if (starts.some((q) => reachableFast(open, q, [p], R)[0])) return p;
    const xs = room.polygon.map((q) => q.x), zs = room.polygon.map((q) => q.z);
    const cands: Vec2[] = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.25) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.25) {
      const q = { x, z };
      if (pointInPolygon(q, room.polygon) && circleFree(open, x, z, CHARACTER_RADIUS_M + 0.25)) cands.push(q);
    }
    cands.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const ok = starts.length ? reachableFast(open, starts[0], cands.slice(0, 200), R) : [];
    const i = ok.findIndex(Boolean);
    return i >= 0 ? cands[i] : p;
  }

  /** The room's standing spot (the start page's smart spawn), or null for a room that has none. */
  spotIn(roomId: string): { x: number; z: number; yawDeg: number } | null {
    const open = this.openGrid();
    let s = chooseSpawn(this.deps.layout, roomId, open);
    // a pocket of a room (a toilet) may leave no clear spot once the leaf is in: then the start page's own spot
    if (!s || !circleFree(open, s.x, s.z, CHARACTER_RADIUS_M)) s = chooseSpawn(this.deps.layout, roomId, this.deps.staticGrid()) ?? s;
    if (s) s = { ...s, ...this.reachableIn(roomId, this.clearIn(roomId, s, open), open) };
    return s ? { x: s.x, z: s.z, yawDeg: s.yawDeg } : null;
  }

  /**
   * Takes the walker to a room, on foot and calmly (GO_KIN: a brisk walk, the walk clip, eased start and stop, slower through doors and bends).
   * A route up to `SHORTCUT_FROM_M` is walked all the way, shut doors on the way opened; a longer one is walked for `SHORTCUT_WALK_S`, then the
   * page fades to a spot `SHORTCUT_LAST_M` before the end of the route and the walker walks the rest in at the speed it had. With no route, or with
   * reduced motion, a fade to the standing spot. Resolves when they are there.
   */
  async goTo(roomId: string): Promise<GoResult> {
    try { return await this.runGoTo(roomId); } catch (err) { console.error('[walkthru] going to a room failed', err); this.stop(); return 'cancelled'; }
  }

  private async runGoTo(roomId: string): Promise<GoResult> {
    this.stop();
    const token = this.token;
    const spot = this.spotIn(roomId);
    if (!spot) return 'no-spot';
    const grid = planGridOf(this.deps.staticGrid(), this.deps.leaves());
    const route = findRoute(grid, this.deps.character.position, spot, ROUTE_MAX_M, gatesOf(this.deps.leaves()));
    const plan = route && !this.deps.reducedMotion() ? goPlan(route.lengthM) : 'fade';
    if (route && plan !== 'fade') {
      let r = await this.walkTo(spot, GO_KIN, plan === 'shortcut' ? { cutAfterS: SHORTCUT_WALK_S } : {});
      if (token !== this.token) return 'cancelled';
      if (r === 'cut') {
        // the walker has set off; the viewer does not wait for the rest of a long way
        const rest = findRoute(grid, this.deps.character.position, spot, ROUTE_MAX_M, gatesOf(this.deps.leaves()));
        if (rest && rest.lengthM > SHORTCUT_LAST_M + 0.5) {
          const near = pointAlongRoute(rest.points, rest.lengthM - SHORTCUT_LAST_M);
          const ahead = pointAlongRoute(rest.points, rest.lengthM - SHORTCUT_LAST_M + 0.3);
          const yawDeg = Math.atan2(ahead.x - near.x, ahead.z - near.z) / DEG;
          await this.deps.jump({ x: near.x, z: near.z, yawDeg });
          if (token !== this.token) return 'cancelled';
          this.cam = { yaw: yawDeg, rate: 0 }; this.camGoal = yawDeg; this.body = { yaw: yawDeg, rate: 0 };
          r = await this.walkTo(spot, GO_KIN);
          if (token !== this.token) return 'cancelled';
        } else r = await this.walkTo(spot, GO_KIN);
      }
      if (r === 'arrived') {
        await this.look(spot.yawDeg, 2.0, null, true);
        return token !== this.token ? 'cancelled' : 'walked';
      }
      if (r === 'cancelled') return 'cancelled';
    }
    await this.deps.jump(spot);
    this.cam = { yaw: spot.yawDeg, rate: 0 }; this.camGoal = spot.yawDeg; this.body = { yaw: spot.yawDeg, rate: 0 };
    return token !== this.token ? 'cancelled' : 'jumped';
  }

  // ---------------------------------------------------------------- the tour

  /**
   * Starts at the walker's own room (one slow arc toward what it is about, seen from where they are), then glides to the nearest room not yet seen,
   * until every reachable room has been; the rooms that cannot be reached are left out and named. A passage is glided through with no stop. Ends
   * back where it started, or with `loop` goes round again without a reset. Resolves with the final state (a looping tour only when stopped).
   */
  async startTour(opts: TourOptions = {}): Promise<TourState> {
    try { return await this.runTour(opts); } catch (err) { console.error('[walkthru] the tour failed', err); this.stop(); return this.tour as TourState; }
  }

  private async runTour(opts: TourOptions): Promise<TourState> {
    this.stop();
    const token = this.token;
    const alive = (): boolean => token === this.token;
    const layout = this.deps.layout;
    const start = { x: this.deps.character.position.x, z: this.deps.character.position.z, yawDeg: this.deps.camera.yawDeg };
    const reduced = this.deps.reducedMotion();
    this.tourClock = 0;
    this.paused = false;
    this.skipAsked = false;
    this.carryV = 0;
    this.tourState = { active: true, paused: false, phase: 'walking', index: 0, total: 0, roomId: null, roomLabel: null, skipped: [], visited: [], elapsedS: 0, loop: 1 };
    this.enterPresentation();
    this.emit();
    for (let round = 1; alive(); round++) {
      const open = this.openGrid();
      const withLeaves = tourStops(layout, open, this.deps.focal);
      const plain = withLeaves.stops.some((st) => !circleFree(open, st.spot.x, st.spot.z, CHARACTER_RADIUS_M)) ? tourStops(layout, this.deps.staticGrid(), this.deps.focal).stops : [];
      const stops = withLeaves.stops.map((st) => (circleFree(open, st.spot.x, st.spot.z, CHARACTER_RADIUS_M) ? st : plain.find((x) => x.room.id === st.room.id) ?? st));
      const skipped = withLeaves.skipped;
      for (const st of stops) { const q = this.reachableIn(st.room.id, this.clearIn(st.room.id, st.spot, open), open); st.spot = { ...st.spot, x: q.x, z: q.z }; }
      // the order and the reachability are judged on the grid without any leaf (a leaf is a thing of the moment: how far a door has swung when a stop is chosen
      // depends on the frame rate, and so would the tour's order); a leaf that really shuts a room off fails the walk there, and that room is named as left out
      const first = routesFrom(this.deps.staticGrid(), this.deps.character.position, stops.map((s) => s.spot), Infinity, gatesOf(this.deps.leaves()));
      const reachable: TourStop[] = [];
      for (const s of stops) {
        if (Number.isFinite(first.lengthTo(s.spot))) reachable.push(s);
        else skipped.push({ roomId: s.room.id, label: s.room.label, why: 'not reachable' });
      }
      // the passages are glided through, not stopped at: they are not counted
      const counted = reachable.filter((s) => s.kind !== 'transit').length;
      this.tourState = { ...(this.tourState as TourState), phase: 'walking', index: 0, total: counted, roomId: null, roomLabel: null, skipped, visited: [], loop: round };
      this.emit();
      let remaining = reachable.slice();
      const visit = async (s: TourStop): Promise<void> => {
        const st = this.tourState as TourState;
        const stopsHere = s.kind !== 'transit';
        this.setTour({ phase: 'looking', index: stopsHere ? st.index + 1 : st.index, roomId: s.room.id, roomLabel: s.room.label, visited: [...st.visited, s.room.id] });
        if (!stopsHere) return;
        if (reduced) { await this.look(s.vantage.yawDeg, DWELL_S[s.kind] * 0.6, 0); return; }
        const from = this.cam.yaw;
        const diff = Math.abs(angleDiff(from, s.vantage.yawDeg));
        await this.look(s.vantage.yawDeg, DWELL_S[s.kind], Math.min(ARC_MAX_DEG, Math.max(ARC_MIN_DEG, diff)));
      };
      // the room they stand in is the first stop, seen from where they are
      const here = roomAt(layout, this.deps.character.position);
      const hereStop = here ? remaining.find((s) => s.room.id === here.id) : undefined;
      if (hereStop) {
        remaining = remaining.filter((s) => s !== hereStop);
        await visit(hereStop);
        if (!alive()) return this.tour as TourState;
      }
      while (remaining.length > 0 && alive()) {
        const grid = planGridOf(this.deps.staticGrid(), this.deps.leaves());
        // the next stop, and any passages on the way to it: they are glided through (the route runs over their standing spot), not stopped at
        const vias: TourStop[] = [];
        let stop: TourStop | null = null;
        let from: Vec2 = this.deps.character.position;
        while (remaining.length > 0) {
          const field = routesFrom(this.deps.staticGrid(), from, remaining.map((s) => s.vantage), Infinity, gatesOf(this.deps.leaves()));
          const pick = pickNext(remaining, (p) => field.lengthTo(p), (s) => s.vantage);
          for (const u of pick.unreachable) {
            this.tourState?.skipped.push({ roomId: u.room.id, label: u.room.label, why: 'not reachable' });
            remaining = remaining.filter((s) => s !== u);
          }
          if (!pick.next) break;
          remaining = remaining.filter((s) => s !== pick.next);
          if (pick.next.kind === 'transit' && remaining.some((s) => s.kind !== 'transit')) { vias.push(pick.next); from = pick.next.vantage; continue; }
          stop = pick.next;
          break;
        }
        if (!stop) break;
        this.setTour({ phase: 'walking', roomId: stop.room.id, roomLabel: stop.room.label });
        const v = stop.vantage;
        let r: WalkResult | 'jumped';
        if (reduced) { await this.deps.jump({ x: v.x, z: v.z, yawDeg: v.yawDeg }); r = 'jumped'; } else r = await this.walkTo(v, TOUR_KIN, { via: vias.map((t) => t.vantage) });
        if (!alive()) return this.tour as TourState;
        if (r === 'skipped') { this.setTour({ index: (this.tourState as TourState).index + (stop.kind === 'transit' ? 0 : 1) }); continue; }
        if (r !== 'arrived' && r !== 'jumped') {
          console.warn(`[walkthru] tour: could not reach ${stop.room.label} (${this.lastFail ?? r})`);
          this.tourState?.skipped.push({ roomId: stop.room.id, label: stop.room.label, why: 'not reachable', ...(this.lastFail ? { detail: this.lastFail } : {}) });
          this.setTour({ total: Math.max(0, (this.tourState as TourState).total - 1) });
          continue;
        }
        for (const t of vias) this.setTour({ visited: [...(this.tourState as TourState).visited, t.room.id] });
        await visit(stop);
        if (!alive()) return this.tour as TourState;
      }
      if (!alive()) return this.tour as TourState;
      // home again, eased: and with `loop`, round again from there
      this.setTour({ phase: 'returning', roomId: null, roomLabel: null });
      if (reduced) await this.deps.jump(start);
      else {
        const back = await this.walkTo(start, TOUR_KIN);
        if (!alive()) return this.tour as TourState;
        if (back !== 'arrived' && back !== 'skipped') await this.deps.jump(start);
      }
      if (!alive()) return this.tour as TourState;
      if (!opts.loop) break;
    }
    if (!alive()) return this.tour as TourState;
    this.action = null;
    this.leavePresentation();
    this.dwell = 0;
    this.setTour({ active: false, phase: 'done' });
    return this.tour as TourState;
  }
}

export type { Vantage };
