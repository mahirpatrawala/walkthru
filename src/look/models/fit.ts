// The honest-sizing rule of the model library (SPEC 16.15). A size always comes from the home (the drawn box and heights), never from
// a model: a model is used only when it already is that size, give or take FIT_TOL on each axis, so it is never visibly stretched.
// Pure functions, no three, no DOM.

/** how far one axis may be scaled away from 1 (12 %): the owner's "never looks stretched" limit */
export const FIT_TOL = 0.12;
/** how far the surface a person sits on or a thing is put on (seat, bed, table top) may sit from the item's own surface height, metres */
export const SURFACE_TOL_M = 0.03;

/** width (x, along the item's width), height (y) and depth (z, out of the front), metres */
export interface Dims { w: number; h: number; d: number }

export interface FitResult {
  ok: boolean;
  /** per-axis scale to apply to the model (x, y, z); 1 when the model already is the size */
  scale: { x: number; y: number; z: number };
  /** the model is turned a quarter about the vertical (its width runs along the item's depth) */
  turned: boolean;
  /** the largest |scale - 1| of the chosen orientation */
  worst: number;
}

const dev = (s: { x: number; y: number; z: number }): number => Math.max(Math.abs(s.x - 1), Math.abs(s.y - 1), Math.abs(s.z - 1));

/**
 * Does `model` fit the `slot` (an item's drawn box and height) within `tol` on every axis? With `allowTurn` a model that looks the same
 * from the side (a round or square-ish table) may also be tried turned a quarter, and the better orientation is chosen.
 */
export function fitModel(model: Dims, slot: Dims, tol = FIT_TOL, allowTurn = false): FitResult {
  const straight = { x: slot.w / model.w, y: slot.h / model.h, z: slot.d / model.d };
  // turned a quarter: the model's own width lies along the item's depth, so its x scale is d / w and its z scale w / d
  const sideways = { x: slot.d / model.w, y: slot.h / model.h, z: slot.w / model.d };
  const a = { scale: straight, turned: false, worst: dev(straight) };
  const b = { scale: sideways, turned: true, worst: dev(sideways) };
  const pick = allowTurn && b.worst < a.worst ? b : a;
  return { ok: Number.isFinite(pick.worst) && pick.worst <= tol + 1e-9, scale: pick.scale, turned: pick.turned, worst: pick.worst };
}

/** the model's own surface height (measured at fetch time) scaled by the y scale lands within SURFACE_TOL_M of the item's surface height */
export function surfaceMatches(modelSurfaceM: number | undefined, scaleY: number, itemSurfaceM: number, tolM = SURFACE_TOL_M): boolean {
  if (modelSurfaceM === undefined) return true;
  return Math.abs(modelSurfaceM * scaleY - itemSurfaceM) <= tolM + 1e-9;
}

/** the uniform scale of a decor piece: as tall as the piece asks, never wider than `overhang` times its footprint, kept inside [min, max] */
export function decorScale(model: Dims, piece: { w: number; d: number; height: number; wall?: boolean }, overhang = 1.25, min = 0.35, max = 1.6): number {
  let s = piece.height / model.h;
  s = Math.min(s, (overhang * piece.w) / model.w);
  if (!piece.wall) s = Math.min(s, (overhang * piece.d) / model.d);
  return Math.max(min, Math.min(max, s));
}
