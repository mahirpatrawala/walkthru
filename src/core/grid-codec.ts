import { GRID_CELL_M, GRID_FREE, GRID_VOID } from '../types';
import type { Grid, Vec2 } from '../types';

/**
 * New grid with cells of GRID_CELL_M. `fill` defaults to GRID_FREE (all zeros).
 * // SPEC-GAP: 7.1 gives no default for `fill`; layout-raster passes GRID_VOID explicitly (4.2 step 1).
 */
export function createGrid(originX: number, originZ: number, nx: number, nz: number, fill: number = GRID_FREE): Grid {
  const cells = new Uint8Array(nx * nz);
  if (fill !== 0) cells.fill(fill);
  return { cellM: GRID_CELL_M, originX, originZ, nx, nz, cells };
}

/** Flat index j * nx + i of the cell containing (x, z), or -1 outside the grid. */
export function cellIndex(grid: Grid, x: number, z: number): number {
  const i = Math.floor((x - grid.originX) / grid.cellM);
  const j = Math.floor((z - grid.originZ) / grid.cellM);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) return -1;
  return j * grid.nx + i;
}

/** The cell's value, GRID_VOID (255) outside the bounds. */
export function cellValue(grid: Grid, x: number, z: number): number {
  const k = cellIndex(grid, x, z);
  return k < 0 ? GRID_VOID : grid.cells[k];
}

export function cellCentre(grid: Grid, i: number, j: number): Vec2 {
  return { x: grid.originX + (i + 0.5) * grid.cellM, z: grid.originZ + (j + 0.5) * grid.cellM };
}

export function cloneGrid(grid: Grid): Grid {
  return { ...grid, cells: new Uint8Array(grid.cells) };
}
