// Owned by C1. Stub from C0: signatures only (SPEC 7.1, algorithms in 4.10).
import type { PlanUnderlay, Px, Vec2 } from '../types';

export function scaleFromDimensions(dims: { a: Px; b: Px; lengthM: number }[]): { pxPerM: number; disagreementPct: number } {
  throw new Error('not implemented: C1 scaleFromDimensions');
}
export function pxToWorld(px: Px, u: Pick<PlanUnderlay, 'pxPerM' | 'originPx'>): Vec2 {
  throw new Error('not implemented: C1 pxToWorld');
}
export function worldToPx(v: Vec2, u: Pick<PlanUnderlay, 'pxPerM' | 'originPx'>): Px {
  throw new Error('not implemented: C1 worldToPx');
}
