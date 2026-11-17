// Walking and turning from input (SPEC 2.3). three-free: pure maths plus the Character and Input interfaces.
import { CHARACTER_RADIUS_M } from '../types';
import type { Grid } from '../types';
import { circleFree, moveCircle, nearestFree } from '../core/grid-query';
import type { Character } from './character';
import type { Input } from './controls';

const DEG = Math.PI / 180;
const WALK_MPS = 1.4;
const JOG_MPS = 3.4;
const REF_HEIGHT_M = 1.75;
/** Turn rate toward the movement direction (15 Nov 2026: was 10, which snapped a half turn in 0.3 s and looked like a spinning statue). */
const TURN_RAD_S = 6;
const DEADZONE = 0.05;
/** A push of this size (joystick) already means full walking speed. */
const FULL_PUSH = 0.85;
/** Speed changes at these rates, m/s^2, times height / 1.75: a start takes a quarter of a second to walking pace (SPEC 16.18, was a third), a stop a sixth. */
const ACCEL_MPS2 = 5.8;
const DECEL_MPS2 = 8.5;
/** The body walks only where it faces: full speed within this angle of the heading it wants, none beyond the other. */
const FACE_FULL_DEG = 30;
const FACE_NONE_DEG = 90;
/**
 * SPEC 4.12, walking at a wall. The walker looks this far ahead along its heading and slows so that it can stop where the way ends
 * (v^2 = 2 a d, with the stopping rate above): it arrives at a wall or a shut door at a crawl, standing, not in mid-stride.
 */
const LOOK_AHEAD_M = 1.0;
/** The look-ahead plans to stop at this share of the stopping rate: a frame of lag in the speed then still leaves a crawl at the wall, not a stride. */
const BRAKE_SHARE = 0.8;
/** The last of the way is taken at this pace, m/s, so the walker does reach the wall; under `ARRIVED_M` of free way it stands. */
const CREEP_MPS = 0.18;
const ARRIVED_M = 0.012;
/**
 * A wall met nearly head on stops the walker; it slides along a wall only when at least this share of its pace runs along it
 * (0.26 is a heading 15 degrees off the wall's normal). The second number is where a slide already under way ends.
 */
const SLIDE_MIN = 0.26;
const SLIDE_KEEP = 0.18;
/** Sliding, the body turns to face the way it is really going once that is this far off the heading asked for, degrees. */
const DEFLECT_DEG = 8;
/** The jog clip (a 1.6 m stride) is played only at a real jogging pace, as a share of this body's full jog; below, a jog that is starting or boxed in is a quick walk. */
const JOG_CLIP_ON = 0.62;
const JOG_CLIP_OFF = 0.52;

function angleDiff(from: number, to: number): number {
  let d = (((to - from) % 360) + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

interface Mem { v: number; ux: number; uz: number; jog: boolean; /** sliding along something: the way it is really going (unit, eased), and whether it is */ tx: number; tz: number; sliding: boolean; deflected: boolean; jogClip: boolean; /** the way ahead is clear for a jog's stride */ open: boolean }
/** Per-character state the step keeps between frames (speed reached so far, the heading it is coasting along). Keyed by the character. */
const memory = new WeakMap<object, Mem>();
function memoryOf(ch: object): Mem {
  let m = memory.get(ch);
  if (!m) { m = { v: 0, ux: 0, uz: 1, jog: false, tx: 0, tz: 1, sliding: false, deflected: false, jogClip: false, open: true }; memory.set(ch, m); }
  return m;
}
/** Forgets a character's speed (a teleport, a pose): the next step starts from standing. */
export function resetLocomotion(ch: object): void {
  memory.delete(ch);
}

function smooth01(k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
}

/**
 * Moves and turns the character from input and returns the speed actually achieved (m/s, 0 when posed or blocked).
 * Input is relative to the camera: `moveY` +1 is the way the camera looks, `moveX` +1 is to the screen's right.
 * Top speeds are 1.4 m/s walking and 2.8 m/s jogging, both times height / 1.75. The character turns toward its
 * movement direction at 6 rad/s, walks only once it faces that way (a half turn is done on the spot, stepping), speeds up
 * and slows down over a fraction of a second, and slides along walls (`moveCircle`). A character found inside an obstacle
 * (a new item placed on top of them) is first moved to the nearest free spot.
 */
export function stepLocomotion(ch: Character, input: Input, cameraYawDeg: number, grid: Grid, dt: number): number {
  const s = ch.state;
  if (s !== 'idle' && s !== 'walk' && s !== 'jog') { memory.delete(ch); return 0; }
  const mem = memoryOf(ch);
  const scale = ch.heightM / REF_HEIGHT_M;

  const raw = Math.hypot(input.moveX, input.moveY);
  const mag = Math.min(1, raw);
  const wantsMove = mag >= DEADZONE && dt > 0;
  if (!wantsMove) {
    // let go: keep gliding the way it was going while slowing down, then stand
    if (!(dt > 0) || mem.v <= 0.02) { mem.v = 0; mem.sliding = false; mem.deflected = false; mem.jogClip = false; ch.setLocomotion(0, false, 0); return 0; }
    mem.v = Math.max(0, mem.v - DECEL_MPS2 * scale * dt);
    return glide(ch, mem, grid, dt, 0, scale);
  }
  const mx = input.moveX / raw;
  const my = input.moveY / raw;

  // camera-relative direction on the floor: forward (sin y, cos y), screen right (-cos y, sin y)
  const y = cameraYawDeg * DEG;
  const dx = Math.sin(y) * my - Math.cos(y) * mx;
  const dz = Math.cos(y) * my + Math.sin(y) * mx;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;

  const jog = input.jog;
  const full = (jog ? JOG_MPS : WALK_MPS) * scale * (ch.walkFactor ?? 1);
  const wanted = full * Math.min(1, mag / FULL_PUSH);

  // turn toward the heading; sliding along a wall, toward the way the body is really going (a walker faces along the wall it follows, not into it)
  const target = (mem.deflected ? Math.atan2(mem.tx, mem.tz) : Math.atan2(ux, uz)) / DEG;
  const diff = angleDiff(ch.yawDeg, target);
  const maxStep = TURN_RAD_S * dt / DEG;
  const stepDeg = Math.max(-maxStep, Math.min(maxStep, diff));
  ch.yawDeg = ch.yawDeg + stepDeg;
  const turnRate = Math.abs(diff) > 1.5 ? Math.abs(stepDeg) * DEG / dt : 0;

  // how much of the wanted speed the body may use while it is still coming round
  const facing = 1 - smooth01((Math.abs(diff) - FACE_FULL_DEG) / (FACE_NONE_DEG - FACE_FULL_DEG));
  let goal = wanted * facing;
  // the way ends ahead: slow down in time to stop there
  const ahead = wayAhead(grid, ch.position, ux, uz);
  mem.open = ahead >= LOOK_AHEAD_M;
  if (ahead < LOOK_AHEAD_M) goal = Math.min(goal, ahead < ARRIVED_M ? 0 : Math.sqrt(2 * BRAKE_SHARE * DECEL_MPS2 * scale * (ahead - ARRIVED_M)) + CREEP_MPS * scale);
  mem.v = mem.v < goal ? Math.min(goal, mem.v + ACCEL_MPS2 * scale * dt) : Math.max(goal, mem.v - DECEL_MPS2 * scale * dt);
  mem.ux = ux; mem.uz = uz; mem.jog = jog;
  return glide(ch, mem, grid, dt, turnRate, scale);
}

/**
 * How far the walker can go along (ux, uz) before something stops it, metres, `LOOK_AHEAD_M` when that far is clear, or when what it meets
 * is a wall it would slide along (met at a slant): only a dead end counts.
 */
function wayAhead(grid: Grid, from: { x: number; z: number }, ux: number, uz: number): number {
  const STEP = 0.04;
  let d = 0;
  while (d < LOOK_AHEAD_M && circleFree(grid, from.x + ux * (d + STEP), from.z + uz * (d + STEP), CHARACTER_RADIUS_M)) d += STEP;
  if (d >= LOOK_AHEAD_M) return LOOK_AHEAD_M;
  // the last step, finer
  let lo = d, hi = d + STEP;
  for (let k = 0; k < 4; k++) { const mid = (lo + hi) / 2; if (circleFree(grid, from.x + ux * mid, from.z + uz * mid, CHARACTER_RADIUS_M)) lo = mid; else hi = mid; }
  // whether it slides on from there: the move is tried from where the walker is (the way the walk itself would take it), not from the contact spot,
  // where the wall's cells are met a millimetre at a time and the answer flickers with the lattice
  const probe = 0.12;
  const slid = moveCircle(grid, from, { x: ux * (lo + probe), z: uz * (lo + probe) }, CHARACTER_RADIUS_M);
  return Math.hypot(slid.x - from.x, slid.z - from.z) - lo >= SLIDE_MIN * probe ? LOOK_AHEAD_M : lo;
}

/** Moves along the remembered heading at the remembered speed, rescuing a character found inside something first. */
function glide(ch: Character, mem: Mem, grid: Grid, dt: number, turnRate: number, scale: number): number {
  let pos = ch.position;
  if (!circleFree(grid, pos.x, pos.z, CHARACTER_RADIUS_M)) {
    const free = nearestFree(grid, pos.x, pos.z, CHARACTER_RADIUS_M);
    if (free) pos = free;
  }
  const want = mem.v * dt;
  let next = want > 0 ? moveCircle(grid, pos, { x: mem.ux * want, z: mem.uz * want }, CHARACTER_RADIUS_M) : pos;
  let moved = Math.hypot(next.x - pos.x, next.z - pos.z);
  // met nearly head on, a wall stops the walker: it does not creep sideways along it with its face to the wall
  const share = want > 1e-9 ? moved / want : 1;
  if (share < (mem.sliding ? SLIDE_KEEP : SLIDE_MIN)) { next = pos; moved = 0; mem.sliding = false; }
  else mem.sliding = share < 0.999;
  ch.position = next;
  const achieved = moved / dt;
  // the way it is really going, for the body to face while it slides
  if (moved > 1e-6) {
    const k = 1 - Math.exp(-dt / 0.09);
    const dx = (next.x - pos.x) / moved, dz = (next.z - pos.z) / moved;
    if (!mem.deflected) { mem.tx = mem.ux; mem.tz = mem.uz; }
    mem.tx += (dx - mem.tx) * k; mem.tz += (dz - mem.tz) * k;
    const off = Math.acos(Math.max(-1, Math.min(1, dx * mem.ux + dz * mem.uz))) / DEG;
    mem.deflected = off > (mem.deflected ? DEFLECT_DEG / 2 : DEFLECT_DEG);
  } else mem.deflected = false;
  // against a wall the speed it could not use does not pile up behind it
  if (achieved < mem.v * 0.5) mem.v = Math.max(achieved, 0);
  mem.jogClip = mem.jog && mem.open && achieved >= (mem.jogClip ? JOG_CLIP_OFF : JOG_CLIP_ON) * JOG_MPS * scale * (ch.walkFactor ?? 1);
  ch.setLocomotion(achieved, mem.jogClip, turnRate);
  return achieved;
}
