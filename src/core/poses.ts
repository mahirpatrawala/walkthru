// Poses (SPEC 4.6). Pure. `approach` is where the character stood when they pressed the button.
import { SIT_HIP_BACK_RATIO, SIT_SEAT_RATIO } from '../types';
import type { Box, FurnitureItem, LiePose, SeatPose, StandPose, Vec2 } from '../types';
import { boxAxes } from './geometry';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Signed distance of `approach` from the box centre along the width axis b. */
function lateral(item: FurnitureItem, approach: Vec2): number {
  const { b } = boxAxes(item.box);
  return (approach.x - item.box.cx) * b.x + (approach.z - item.box.cz) * b.z;
}

/**
 * Lying along the item's length, head 5 cm from the head end of the mattress, feet `heightM` further toward +a.
 * On a mattress 1.2 m wide or more the body takes the half nearest to `approach` (a quarter of the width off centre).
 */
export function liePose(item: FurnitureItem, heightM: number, approach: Vec2): LiePose {
  const box = item.box;
  const { a, b } = boxAxes(box);
  const inner = item.inner ?? { w: box.w, d: box.d };
  const headInset = (box.d - inner.d) / 2 + 0.05;
  const lat = inner.w < 1.2 ? 0 : Math.sign(lateral(item, approach)) * (inner.w / 4);
  const along = box.d / 2 - headInset;
  const head = { x: box.cx - a.x * along + b.x * lat, z: box.cz - a.z * along + b.z * lat };
  return {
    feet: { x: head.x + a.x * heightM, z: head.z + a.z * heightM },
    yawDeg: box.yawDeg,
    surfaceY: item.surfaceHeightM,
  };
}

/** Sitting at the seat spot nearest `approach`, facing the item's front (+a). */
export function seatPose(item: FurnitureItem, heightM: number, approach: Vec2): SeatPose {
  const box = item.box;
  const { a, b } = boxAxes(box);
  const m = box.w / 2 - 0.35;
  const lat = clamp(lateral(item, approach), -m, m);
  const hip = {
    x: box.cx + a.x * (box.d / 2 - 0.3) + b.x * lat,
    z: box.cz + a.z * (box.d / 2 - 0.3) + b.z * lat,
  };
  const back = SIT_HIP_BACK_RATIO * heightM;
  return {
    root: { x: hip.x + a.x * back, z: hip.z + a.z * back },
    rootY: Math.max(-0.02, item.surfaceHeightM - SIT_SEAT_RATIO * heightM),
    yawDeg: box.yawDeg,
  };
}

/** How far behind the middle of a chair seat the hips sit. */
export const CHAIR_HIP_BACK_M = 0.04;

/** Sitting on a single-seat chair: hips over the seat (a little behind its middle), facing the chair's front (+a). */
export function chairPose(box: Box, seatHeightM: number, heightM: number): SeatPose {
  const { a } = boxAxes(box);
  const hip = { x: box.cx - a.x * CHAIR_HIP_BACK_M, z: box.cz - a.z * CHAIR_HIP_BACK_M };
  const back = SIT_HIP_BACK_RATIO * heightM;
  return {
    root: { x: hip.x + a.x * back, z: hip.z + a.z * back },
    rootY: Math.max(-0.02, seatHeightM - SIT_SEAT_RATIO * heightM),
    yawDeg: box.yawDeg,
  };
}

/** Standing 0.30 m in front of the item, facing it. */
export function standPose(item: FurnitureItem, heightM: number, approach: Vec2): StandPose {
  void heightM;
  const box = item.box;
  const { a, b } = boxAxes(box);
  const m = Math.max(0, box.w / 2 - 0.3);
  const lat = clamp(lateral(item, approach), -m, m);
  const out = box.d / 2 + 0.3;
  return {
    root: { x: box.cx + a.x * out + b.x * lat, z: box.cz + a.z * out + b.z * lat },
    yawDeg: (box.yawDeg + 180) % 360,
  };
}
