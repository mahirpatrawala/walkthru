// Owned by C2. Stub from C0: signatures only (SPEC 7.1, algorithms in 4.5).
import type { Box, CatalogItem, Grid, PlacementResult } from '../types';

export function checkPlacement(grid: Grid, spec: CatalogItem, box: Box, ceilingM: number): PlacementResult {
  throw new Error('not implemented: C2 checkPlacement');
}
export function snapToWalls(grid: Grid, box: Box): Box {
  throw new Error('not implemented: C2 snapToWalls');
}
export function placementMessage(spec: CatalogItem, r: Omit<PlacementResult, 'message'>, ceilingM: number): string {
  throw new Error('not implemented: C2 placementMessage');
}
