// Owned by C2. Stub from C0: signatures only (SPEC 7.1, algorithms in 4.3).
// cellValue lives in grid-codec.ts (C0).
import type { Grid, Vec2, Vec3 } from '../types';

export function circleFree(grid: Grid, x: number, z: number, r: number): boolean {
  throw new Error('not implemented: C2 circleFree');
}
export function moveCircle(grid: Grid, from: Vec2, delta: Vec2, r: number): Vec2 {
  throw new Error('not implemented: C2 moveCircle');
}
export function nearestFree(grid: Grid, x: number, z: number, r: number, maxM?: number): Vec2 | null {
  throw new Error('not implemented: C2 nearestFree');
}
export function clearance(grid: Grid, origin: Vec2, dir: Vec2, maxM?: number): number {
  throw new Error('not implemented: C2 clearance');
}
export function boomDistance(grid: Grid, pivot: Vec3, dir: Vec3, maxDist: number, ceilingM: number): number {
  throw new Error('not implemented: C2 boomDistance');
}
