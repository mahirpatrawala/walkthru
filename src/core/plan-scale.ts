// Owned by C1. SPEC 4.10: plan scale from typed dimensions, and plan pixel <-> world.
import type { PlanUnderlay, Px, Vec2 } from '../types';

/**
 * Each dimension gives |b - a| / lengthM; pxPerM is the mean and disagreementPct = (max - min) / mean * 100
 * (0 for one dimension). Entries with a non-positive length or zero pixel length are ignored.
 * // SPEC-GAP: 4.10 does not say what an empty list gives; we return { pxPerM: 0, disagreementPct: 0 }.
 */
export function scaleFromDimensions(dims: { a: Px; b: Px; lengthM: number }[]): { pxPerM: number; disagreementPct: number } {
  const scales: number[] = [];
  for (const d of dims) {
    if (!(d.lengthM > 0)) continue;
    const px = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
    if (px > 0) scales.push(px / d.lengthM);
  }
  if (scales.length === 0) return { pxPerM: 0, disagreementPct: 0 };
  const mean = scales.reduce((s, v) => s + v, 0) / scales.length;
  const disagreementPct = scales.length === 1 ? 0 : ((Math.max(...scales) - Math.min(...scales)) / mean) * 100;
  return { pxPerM: mean, disagreementPct };
}

/** world.x = (px.x - originPx.x) / pxPerM, world.z = (px.y - originPx.y) / pxPerM (SPEC 3.1). */
export function pxToWorld(px: Px, u: Pick<PlanUnderlay, 'pxPerM' | 'originPx'>): Vec2 {
  return { x: (px.x - u.originPx.x) / u.pxPerM, z: (px.y - u.originPx.y) / u.pxPerM };
}

export function worldToPx(v: Vec2, u: Pick<PlanUnderlay, 'pxPerM' | 'originPx'>): Px {
  return { x: u.originPx.x + v.x * u.pxPerM, y: u.originPx.y + v.z * u.pxPerM };
}
