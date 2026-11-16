// The auto-walk: go to a room, and the room-by-room tour. Pure state machine, no DOM and no three: the walker, the camera, the walk grids and the
// doors come in through `DriverDeps`, so the same code runs in the page (src/buyer/nav/mount.ts) and in a unit test on the real layout.
//
// How a walk goes. A route is planned on the grid without any shut door leaf (src/buyer/nav/grid-path.ts) and cut at the first shut door it
// goes through, at a spot outside that leaf's whole swing. The walker walks there, the door is opened through the door system (it swings
// and refuses to touch the body, a wall or furniture as ever), and the route is planned again from where they stand, now with the open leaf
// as a solid thing. So a route never goes through a leaf, and the leaf is never asked to open into the body. The body moves with the same
// collision as walking by hand (`moveCircle` on the live grid); if it makes no headway for a second it plans again, and after three tries
// the walk reports 'failed'.
import { CHARACTER_RADIUS_M } from '../../types';
import type { Grid, Layout, Vec2 } from '../../types';
import { moveCircle } from '../../core/grid-query';
import { chooseSpawn } from '../../core/spawn';
import { roomAt } from '../../core/layout-geom';
import type { Door } from '../../core/doors';
import { findRoute, routesFrom } from './grid-path';
import { cutRoute, firstCrossing, isOpenEnough, planGridOf, standOffM } from './door-route';
import type { LeafState } from './door-route';
import { goDecision } from './nav-model';
import { DWELL_S, pickNext, tourStops } from './tour-plan';
import type { Skipped, TourStop } from './tour-plan';

const DEG = Math.PI / 180;
/** Speeds, m/s. A tour walks at an easy pace; going to a room is a brisk walk (a jog's clip, the same body). */
export const TOUR_WALK_MPS = 1.5;
export const GO_WALK_MPS = 3.0;
/** A path no longer than this is walked; a longer one is a fade. */
export const MAX_WALK_M = 12;
const TURN_DEG_S = 330;
const ACCEL = 5, DECEL = 8;
const CAMERA_FOLLOW = 3.2;
const STALL_S = 1.0, MAX_REPLANS = 3, MAX_DOOR_TRIES = 2, DOOR_WAIT_MAX_S = 20;
/** The pan of a look round: half-width in degrees, and how long the eyes take to come round to the room first. */
const LOOK_AMP_DEG = 52, LOOK_TURN_S = 0.9;

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
  /** no look-around sweep, no turning in place: cuts */
  reducedMotion(): boolean;
}

export type WalkResult = 'arrived' | 'failed' | 'cancelled';
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
}

interface WalkAction {
  kind: 'walk';
  target: Vec2;
  speed: number;
  jog: boolean;
  route: Vec2[];
  i: number;
  /** the shut door this leg ends at (open it, then plan again), or null when the leg ends at the target */
  door: Door | null;
  phase: 'go' | 'door';
  doorAsked: boolean;
  doorDone: boolean;
  /** what the door system answered when the leaf stood still */
  doorReading?: unknown;
  doorWaitS: number;
  tries: Map<string, number>;
  stallS: number;
  replans: number;
  v: number;
  done: (r: WalkResult) => void;
}
interface LookAction {
  kind: 'look';
  t: number;
  dur: number;
  baseYaw: number;
  charFrom: number;
  camFrom: number;
  amp: number;
  done: () => void;
}
type Action = WalkAction | LookAction;

const angleDiff = (from: number, to: number): number => {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
};
const smooth01 = (k: number): number => { const x = Math.min(1, Math.max(0, k)); return x * x * (3 - 2 * x); };

export class Driver {
  private action: Action | null = null;
  private token = 0;
  private paused = false;
  private tourState: TourState | null = null;
  private listeners = new Set<() => void>();
  private tourClock = 0;
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

  pause(): void { if (this.touring && !this.paused) { this.paused = true; this.setTour({ paused: true }); } }
  resume(): void { if (this.paused) { this.paused = false; this.setTour({ paused: false }); } }

  /** Ends whatever is running where the walker stands. */
  stop(): void {
    this.token++;
    const a = this.action;
    this.action = null;
    this.paused = false;
    if (a?.kind === 'walk') a.done('cancelled'); else a?.done();
    this.deps.character.setLocomotion(0, false, 0);
    if (this.tourState?.active) this.setTour({ active: false, paused: false, phase: 'stopped' });
  }

  private setTour(patch: Partial<TourState>): void {
    if (!this.tourState) return;
    this.tourState = { ...this.tourState, ...patch };
    this.emit();
  }

  // ---------------------------------------------------------------- per frame

  /** Moves the walker for this frame. Returns true when the auto-walk has the walker (the caller then does not read the keys and the thumb). */
  update(dt: number): boolean {
    if (this.tourState?.active && !this.paused) { this.tourClock += dt; this.tourState.elapsedS = this.tourClock; }
    const a = this.action;
    if (!a) return this.touring; // between two legs of a tour: stand still
    if (this.paused) { this.deps.character.setLocomotion(0, false, 0); return true; }
    if (a.kind === 'walk') this.stepWalk(a, dt); else this.stepLook(a, dt);
    return true;
  }

  // ---------------------------------------------------------------- walking a route

  private plan(a: WalkAction): boolean {
    const statics = this.deps.staticGrid();
    const leaves = this.deps.leaves();
    const grid = planGridOf(statics, leaves);
    const route = findRoute(grid, this.deps.character.position, a.target);
    if (!route) return false;
    const shut = leaves.filter((l) => !isOpenEnough(l)).map((l) => l.door);
    const cross = firstCrossing(route.points, shut);
    if (cross) {
      a.route = cutRoute(route.points, standOffM(route.points, cross.atM, cross.door));
      a.door = cross.door;
    } else {
      a.route = route.points;
      a.door = null;
    }
    a.i = Math.min(1, a.route.length - 1);
    a.phase = 'go';
    a.doorAsked = a.doorDone = false;
    a.doorWaitS = 0;
    a.stallS = 0;
    return true;
  }

  /** Walks to `target` along a planned route, opening the shut doors on the way. */
  walkTo(target: Vec2, speed = TOUR_WALK_MPS, jog = false): Promise<WalkResult> {
    return new Promise<WalkResult>((resolve) => {
      const a: WalkAction = {
        kind: 'walk', target: { x: target.x, z: target.z }, speed, jog, route: [], i: 0, door: null, phase: 'go', doorAsked: false, doorDone: false,
        doorWaitS: 0, tries: new Map(), stallS: 0, replans: 0, v: 0, done: resolve,
      };
      if (!this.plan(a)) { this.lastFail = 'no route'; resolve('failed'); return; }
      this.action = a;
    });
  }

  private finish(a: WalkAction, r: WalkResult): void {
    if (this.action === a) this.action = null;
    this.deps.character.setLocomotion(0, false, 0);
    a.done(r);
  }

  private stepWalk(a: WalkAction, dt: number): void {
    const { character: ch, camera } = this.deps;
    if (a.phase === 'door') {
      ch.setLocomotion(0, false, 0);
      const door = a.door as Door;
      if (!a.doorAsked) {
        a.doorAsked = true;
        const n = (a.tries.get(door.id) ?? 0) + 1;
        a.tries.set(door.id, n);
        if (n > MAX_DOOR_TRIES) { this.lastFail = `door ${door.id} would not open ${JSON.stringify(a.doorReading ?? null)}`; this.finish(a, 'failed'); return; }
        void this.deps.openDoor(door.id).then((r) => { a.doorDone = true; a.doorReading = r; }, () => { a.doorDone = true; });
      }
      a.doorWaitS += dt;
      if (a.doorDone || a.doorWaitS > DOOR_WAIT_MAX_S) {
        a.doorAsked = false;
        if (!this.plan(a)) { this.lastFail = `no route after ${door.id}`; this.finish(a, 'failed'); }
      }
      return;
    }
    const pos = ch.position;
    // walk through the corners: a corner is passed within a hand, the last point is reached within a few centimetres
    for (;;) {
      const last = a.i >= a.route.length - 1;
      const w = a.route[a.i];
      if (Math.hypot(w.x - pos.x, w.z - pos.z) > (last ? 0.045 : 0.14)) break;
      if (!last) { a.i++; continue; }
      if (a.door) { a.phase = 'door'; a.doorAsked = false; ch.setLocomotion(0, false, 0); return; }
      this.finish(a, 'arrived');
      return;
    }
    const w = a.route[a.i];
    const dx = w.x - pos.x, dz = w.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const headDeg = Math.atan2(dx, dz) / DEG;
    const diff = angleDiff(ch.yawDeg, headDeg);
    const reduced = this.deps.reducedMotion();
    const stepDeg = reduced ? diff : Math.max(-TURN_DEG_S * dt, Math.min(TURN_DEG_S * dt, diff));
    ch.yawDeg += stepDeg;
    const turnRate = Math.abs(diff) > 1.5 && dt > 0 ? (Math.abs(stepDeg) * DEG) / dt : 0;
    const facing = 1 - smooth01((Math.abs(diff) - 30) / 60);
    // slow into the end of the leg (the last corner, or the spot to stand at before a door)
    let remaining = dist;
    for (let k = a.i; k < a.route.length - 1; k++) remaining += Math.hypot(a.route[k + 1].x - a.route[k].x, a.route[k + 1].z - a.route[k].z);
    const cap = Math.max(0.35, Math.sqrt(2 * 3 * remaining));
    const goal = Math.min(a.speed, cap) * facing;
    a.v = a.v < goal ? Math.min(goal, a.v + ACCEL * dt) : Math.max(goal, a.v - DECEL * dt);
    const grid = this.deps.liveGrid();
    const step = Math.min(dist, a.v * dt);
    const next = moveCircle(grid, pos, { x: (dx / dist) * step, z: (dz / dist) * step }, CHARACTER_RADIUS_M);
    ch.position = next;
    const achieved = dt > 0 ? Math.hypot(next.x - pos.x, next.z - pos.z) / dt : 0;
    ch.setLocomotion(achieved, a.jog, turnRate);
    // the camera comes round behind the heading
    camera.yawDeg += angleDiff(camera.yawDeg, ch.yawDeg) * (1 - Math.exp(-CAMERA_FOLLOW * dt));
    // no headway for a second: something is in the way (a person who walked into the route): plan again
    if (goal > 0.3 && achieved < 0.2 * goal) a.stallS += dt; else a.stallS = 0;
    if (a.stallS > STALL_S) {
      a.stallS = 0;
      if (++a.replans > MAX_REPLANS || !this.plan(a)) { this.lastFail = `stalled at ${pos.x.toFixed(2)},${pos.z.toFixed(2)}`; this.finish(a, 'failed'); }
    }
  }

  // ---------------------------------------------------------------- standing and looking

  /** Turns to face `yawDeg` and, with `amp` > 0, pans slowly either side of it for `dur` seconds. */
  look(yawDeg: number, dur: number, amp = LOOK_AMP_DEG): Promise<void> {
    return new Promise<void>((resolve) => {
      const reduced = this.deps.reducedMotion();
      const ch = this.deps.character, cam = this.deps.camera;
      if (reduced) { ch.yawDeg = yawDeg; cam.yawDeg = yawDeg; }
      this.action = { kind: 'look', t: 0, dur, baseYaw: yawDeg, charFrom: ch.yawDeg, camFrom: cam.yawDeg, amp: reduced ? 0 : amp, done: resolve };
    });
  }

  private stepLook(a: LookAction, dt: number): void {
    const { character: ch, camera } = this.deps;
    ch.setLocomotion(0, false, 0);
    a.t += dt;
    const turnS = Math.min(LOOK_TURN_S, Math.max(0.05, a.dur * 0.5));
    const k = smooth01(a.t / turnS);
    ch.yawDeg = a.charFrom + angleDiff(a.charFrom, a.baseYaw) * k;
    const pan = a.amp > 0 && a.t > turnS ? a.amp * Math.sin((2 * Math.PI * (a.t - turnS)) / Math.max(0.5, a.dur - turnS)) * smooth01((a.t - turnS) / 0.6) : 0;
    camera.yawDeg = a.camFrom + angleDiff(a.camFrom, a.baseYaw) * k + pan;
    if (a.t >= a.dur) {
      camera.yawDeg = a.baseYaw;
      if (this.action === a) this.action = null;
      a.done();
    }
  }

  // ---------------------------------------------------------------- go to a room

  /** The room's standing spot (the start page's smart spawn), or null for a room that has none. */
  spotIn(roomId: string): { x: number; z: number; yawDeg: number } | null {
    const s = chooseSpawn(this.deps.layout, roomId, this.deps.staticGrid());
    return s ? { x: s.x, z: s.z, yawDeg: s.yawDeg } : null;
  }

  /**
   * Takes the walker to a room: along the path, briskly, when it is short (up to 12 m, doors on the way opened), otherwise a fade to a good
   * standing spot facing into the room. Resolves when they are there.
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
    const route = findRoute(grid, this.deps.character.position, spot, MAX_WALK_M + 6);
    if (route && goDecision(route.lengthM, MAX_WALK_M) === 'walk') {
      const r = await this.walkTo(spot, GO_WALK_MPS, true);
      if (token !== this.token) return 'cancelled';
      if (r === 'arrived') {
        await this.look(spot.yawDeg, 0.7, 0);
        return token !== this.token ? 'cancelled' : 'walked';
      }
      if (r === 'cancelled') return 'cancelled';
    }
    await this.deps.jump(spot);
    return token !== this.token ? 'cancelled' : 'jumped';
  }

  // ---------------------------------------------------------------- the tour

  /**
   * Starts at the walker's own room (looking round where they stand), then goes to the nearest room not yet seen, until every reachable room
   * has been; the rooms that cannot be reached are left out and named. Ends back where it started. Resolves with the final state.
   */
  async startTour(): Promise<TourState> {
    try { return await this.runTour(); } catch (err) { console.error('[walkthru] the tour failed', err); this.stop(); return this.tour as TourState; }
  }

  private async runTour(): Promise<TourState> {
    this.stop();
    const token = this.token;
    const alive = (): boolean => token === this.token;
    const layout = this.deps.layout;
    const start = { x: this.deps.character.position.x, z: this.deps.character.position.z, yawDeg: this.deps.camera.yawDeg };
    const { stops, skipped } = tourStops(layout, this.deps.staticGrid());
    this.tourClock = 0;
    this.paused = false;
    // which stops can be walked to at all from here (shut doors count as passable: they get opened)
    const first = routesFrom(planGridOf(this.deps.staticGrid(), this.deps.leaves()), start, stops.map((s) => s.spot));
    const reachable: TourStop[] = [];
    for (const s of stops) {
      if (Number.isFinite(first.lengthTo(s.spot))) reachable.push(s);
      else skipped.push({ roomId: s.room.id, label: s.room.label, why: 'not reachable' });
    }
    this.tourState = { active: true, paused: false, phase: 'walking', index: 0, total: reachable.length, roomId: null, roomLabel: null, skipped, visited: [], elapsedS: 0 };
    this.emit();
    let remaining = reachable.slice();
    // the room they stand in is the first stop, seen from where they are
    const here = roomAt(layout, start);
    const hereStop = here ? remaining.find((s) => s.room.id === here.id) : undefined;
    const visit = async (s: TourStop, yaw: number): Promise<void> => {
      const st = this.tourState as TourState;
      this.setTour({ phase: 'looking', index: st.index + 1, roomId: s.room.id, roomLabel: s.room.label, visited: [...st.visited, s.room.id] });
      await this.look(yaw, DWELL_S[s.kind], s.kind === 'transit' ? 0 : LOOK_AMP_DEG);
    };
    if (hereStop) {
      remaining = remaining.filter((s) => s !== hereStop);
      await visit(hereStop, start.yawDeg);
      if (!alive()) return this.tour as TourState;
    }
    while (remaining.length > 0 && alive()) {
      const field = routesFrom(planGridOf(this.deps.staticGrid(), this.deps.leaves()), this.deps.character.position, remaining.map((s) => s.spot));
      const pick = pickNext(remaining, (p) => field.lengthTo(p));
      for (const u of pick.unreachable) {
        this.tourState?.skipped.push({ roomId: u.room.id, label: u.room.label, why: 'not reachable' });
        remaining = remaining.filter((s) => s !== u);
      }
      if (!pick.next) break;
      const stop = pick.next;
      remaining = remaining.filter((s) => s !== stop);
      this.setTour({ phase: 'walking', roomId: stop.room.id, roomLabel: stop.room.label });
      const r = await this.walkTo(stop.spot, TOUR_WALK_MPS, false);
      if (!alive()) return this.tour as TourState;
      if (r !== 'arrived') {
        console.warn(`[walkthru] tour: could not reach ${stop.room.label} (${this.lastFail ?? r})`);
        this.tourState?.skipped.push({ roomId: stop.room.id, label: stop.room.label, why: 'not reachable', ...(this.lastFail ? { detail: this.lastFail } : {}) });
        this.setTour({ total: Math.max(0, (this.tourState as TourState).total - 1) });
        continue;
      }
      await visit(stop, stop.spot.yawDeg);
    }
    if (!alive()) return this.tour as TourState;
    // home again
    this.setTour({ phase: 'returning', roomId: null, roomLabel: null });
    const back = await this.walkTo(start, TOUR_WALK_MPS, false);
    if (!alive()) return this.tour as TourState;
    if (back === 'arrived') await this.look(start.yawDeg, 0.8, 0);
    else await this.deps.jump(start);
    if (!alive()) return this.tour as TourState;
    this.action = null;
    this.setTour({ active: false, phase: 'done' });
    return this.tour as TourState;
  }
}
