// SPEC 16.18: frame-rate-independent smoothing for the camera and anything else that has to glide. Pure maths, no three.
//
// Every function here is the EXACT solution of a damped system over the frame time, not an Euler step, so the state after one second is
// the same at 30, 60 or 120 fps (to rounding), and a long frame cannot jump: the frame time is clamped first (`MAX_SMOOTH_DT`).

/** The longest frame the smoothing believes (a hidden tab or a long upload does not make the camera lurch). */
export const MAX_SMOOTH_DT = 0.1;

export const clampDt = (dt: number): number => (dt > 0 ? Math.min(dt, MAX_SMOOTH_DT) : 0);

/** One step of exponential approach: `current` moves towards `target` with time constant `tau` seconds (about 63 % of the way in one tau). Never overshoots. */
export function damp(current: number, target: number, tau: number, dt: number): number {
  const d = clampDt(dt);
  if (!(tau > 1e-6)) return d > 0 ? target : current;
  return target + (current - target) * Math.exp(-d / tau);
}

/** The shortest signed difference between two angles in degrees, -180..180. */
export function angleDelta(from: number, to: number): number {
  let d = (((to - from) % 360) + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/** `damp` for an angle in degrees: goes round the short way. The result is not wrapped (it stays near `current`). */
export function dampAngle(current: number, target: number, tau: number, dt: number): number {
  return current + (damp(0, angleDelta(current, target), tau, dt));
}

/** A value with a velocity, for critically damped motion. */
export interface Spring { value: number; velocity: number }

/**
 * Critically damped smoothing (the exact solution of x'' = -w^2 (x - target) - 2 w x' with w = 2 / smoothTime): it reaches the target in about
 * `smoothTime` seconds with no overshoot, and its velocity is continuous, so a target that jumps makes the value glide, not turn a corner.
 * Starting from rest it is monotone. Mutates and returns `s`.
 */
export function springTo(s: Spring, target: number, smoothTime: number, dt: number): Spring {
  const d = clampDt(dt);
  if (d === 0) return s;
  if (!(smoothTime > 1e-6)) { s.value = target; s.velocity = 0; return s; }
  const w = 2 / smoothTime;
  const c = s.value - target;
  const e = Math.exp(-w * d);
  const t = (s.velocity + w * c) * d;
  s.value = target + (c + t) * e;
  s.velocity = (s.velocity - w * t) * e;
  return s;
}

/** `springTo` for an angle in degrees (the short way round). */
export function springAngleTo(s: Spring, target: number, smoothTime: number, dt: number): Spring {
  const goal = s.value + angleDelta(s.value, target);
  return springTo(s, goal, smoothTime, dt);
}

/** smoothstep on 0..1 */
export const ease01 = (k: number): number => { const x = Math.min(1, Math.max(0, k)); return x * x * (3 - 2 * x); };
