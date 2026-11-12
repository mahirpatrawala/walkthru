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
/** Turn rate toward the movement direction. */
const TURN_RAD_S = 10;
const DEADZONE = 0.05;
/** A push of this size (joystick) already means full walking speed. */
const FULL_PUSH = 0.85;

function angleDiff(from: number, to: number): number {
  let d = (((to - from) % 360) + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/**
 * Moves and turns the character from input and returns the speed actually achieved (m/s, 0 when posed or blocked).
 * Input is relative to the camera: `moveY` +1 is the way the camera looks, `moveX` +1 is to the screen's right.
 * Speeds are 1.4 m/s walking and 2.8 m/s jogging, both times height / 1.75. The character turns toward its
 * movement direction at 10 rad/s and slides along walls (`moveCircle`). A character found inside an obstacle
 * (a new item placed on top of them) is first moved to the nearest free spot.
 */
export function stepLocomotion(ch: Character, input: Input, cameraYawDeg: number, grid: Grid, dt: number): number {
  const s = ch.state;
  if (s !== 'idle' && s !== 'walk' && s !== 'jog') return 0;

  const raw = Math.hypot(input.moveX, input.moveY);
  const mag = Math.min(1, raw);
  if (mag < DEADZONE || !(dt > 0)) {
    ch.setLocomotion(0, false);
    return 0;
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

  const scale = ch.heightM / REF_HEIGHT_M;
  const jog = input.jog;
  const full = (jog ? JOG_MPS : WALK_MPS) * scale;
  const wanted = full * Math.min(1, mag / FULL_PUSH);

  // turn toward the heading
  const target = Math.atan2(ux, uz) / DEG;
  const diff = angleDiff(ch.yawDeg, target);
  const maxStep = TURN_RAD_S * dt / DEG;
  ch.yawDeg = ch.yawDeg + Math.max(-maxStep, Math.min(maxStep, diff));

  // rescue a character that is standing inside something
  let pos = ch.position;
  if (!circleFree(grid, pos.x, pos.z, CHARACTER_RADIUS_M)) {
    const free = nearestFree(grid, pos.x, pos.z, CHARACTER_RADIUS_M);
    if (free) pos = free;
  }

  const next = moveCircle(grid, pos, { x: ux * wanted * dt, z: uz * wanted * dt }, CHARACTER_RADIUS_M);
  ch.position = next;
  const achieved = Math.hypot(next.x - pos.x, next.z - pos.z) / dt;
  ch.setLocomotion(achieved, jog);
  return achieved;
}
