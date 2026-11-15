// Walking and turning from input (SPEC 2.3). three-free: pure maths plus the Character and Input interfaces.
import { CHARACTER_RADIUS_M } from '../types';
import type { Grid } from '../types';
import { circleFree, moveCircle, nearestFree } from '../core/grid-query';
import type { Character } from './character';
import type { Input } from './controls';

const DEG = Math.PI / 180;
const WALK_MPS = 1.4;
const JOG_MPS = 2.8;
const REF_HEIGHT_M = 1.75;
/** Turn rate toward the movement direction (15 Nov 2026: was 10, which snapped a half turn in 0.3 s and looked like a spinning statue). */
const TURN_RAD_S = 6;
const DEADZONE = 0.05;
/** A push of this size (joystick) already means full walking speed. */
const FULL_PUSH = 0.85;
/** Speed changes at these rates, m/s^2, times height / 1.75: a start takes a third of a second, a stop a fifth. */
const ACCEL_MPS2 = 4.2;
const DECEL_MPS2 = 7;
/** The body walks only where it faces: full speed within this angle of the heading it wants, none beyond the other. */
const FACE_FULL_DEG = 30;
const FACE_NONE_DEG = 90;

function angleDiff(from: number, to: number): number {
  let d = (((to - from) % 360) + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

interface Mem { v: number; ux: number; uz: number; jog: boolean }
/** Per-character state the step keeps between frames (speed reached so far, the heading it is coasting along). Keyed by the character. */
const memory = new WeakMap<object, Mem>();
function memoryOf(ch: object): Mem {
  let m = memory.get(ch);
  if (!m) { m = { v: 0, ux: 0, uz: 1, jog: false }; memory.set(ch, m); }
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
    if (!(dt > 0) || mem.v <= 0.02) { mem.v = 0; ch.setLocomotion(0, false, 0); return 0; }
    mem.v = Math.max(0, mem.v - DECEL_MPS2 * scale * dt);
    return glide(ch, mem, grid, dt, 0);
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

  // turn toward the heading
  const target = Math.atan2(ux, uz) / DEG;
  const diff = angleDiff(ch.yawDeg, target);
  const maxStep = TURN_RAD_S * dt / DEG;
  const stepDeg = Math.max(-maxStep, Math.min(maxStep, diff));
  ch.yawDeg = ch.yawDeg + stepDeg;
  const turnRate = Math.abs(diff) > 1.5 ? Math.abs(stepDeg) * DEG / dt : 0;

  // how much of the wanted speed the body may use while it is still coming round
  const facing = 1 - smooth01((Math.abs(diff) - FACE_FULL_DEG) / (FACE_NONE_DEG - FACE_FULL_DEG));
  const goal = wanted * facing;
  mem.v = mem.v < goal ? Math.min(goal, mem.v + ACCEL_MPS2 * scale * dt) : Math.max(goal, mem.v - DECEL_MPS2 * scale * dt);
  mem.ux = ux; mem.uz = uz; mem.jog = jog;
  return glide(ch, mem, grid, dt, turnRate);
}

/** Moves along the remembered heading at the remembered speed, rescuing a character found inside something first. */
function glide(ch: Character, mem: Mem, grid: Grid, dt: number, turnRate: number): number {
  let pos = ch.position;
  if (!circleFree(grid, pos.x, pos.z, CHARACTER_RADIUS_M)) {
    const free = nearestFree(grid, pos.x, pos.z, CHARACTER_RADIUS_M);
    if (free) pos = free;
  }
  const next = moveCircle(grid, pos, { x: mem.ux * mem.v * dt, z: mem.uz * mem.v * dt }, CHARACTER_RADIUS_M);
  ch.position = next;
  const achieved = Math.hypot(next.x - pos.x, next.z - pos.z) / dt;
  // against a wall the speed it could not use does not pile up behind it
  if (achieved < mem.v * 0.5) mem.v = Math.max(achieved, 0);
  ch.setLocomotion(achieved, mem.jog, turnRate);
  return achieved;
}
