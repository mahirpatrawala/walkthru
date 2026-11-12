// Owned by C1. SPEC 4.2: collision grid from the layout.
import { GRID_CELL_M, GRID_FREE, GRID_VOID } from '../types';
import type { EdgeFrame, FurnitureItem, Grid, Layout, Vec2 } from '../types';
import { createGrid, cloneGrid, cellCentre } from './grid-codec';
import { boxCorners, pointInBox, pointInPolygon } from './geometry';
import { computeEdgeFrames, computeTunnels, computeWallPieces } from './layout-geom';

/** Visit every cell whose centre lies in the plan bounding box of `pts`. */
function forCellsIn(grid: Grid, pts: Vec2[], fn: (k: number, c: Vec2) => void): void {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const i0 = Math.max(0, Math.floor((minX - grid.originX) / grid.cellM) - 1);
  const i1 = Math.min(grid.nx - 1, Math.ceil((maxX - grid.originX) / grid.cellM) + 1);
  const j0 = Math.max(0, Math.floor((minZ - grid.originZ) / grid.cellM) - 1);
  const j1 = Math.min(grid.nz - 1, Math.ceil((maxZ - grid.originZ) / grid.cellM) + 1);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) fn(j * grid.nx + i, cellCentre(grid, i, j));
  }
}

/** Cells whose centre is inside u0..u1 (along the edge) by o0..o1 (outward). */
function forCellsInEdgeRect(
  grid: Grid, f: EdgeFrame, u0: number, u1: number, o0: number, o1: number, fn: (k: number) => void,
): void {
  const at = (u: number, o: number): Vec2 => ({
    x: f.a.x + f.dir.x * u + f.out.x * o,
    z: f.a.z + f.dir.z * u + f.out.z * o,
  });
  forCellsIn(grid, [at(u0, o0), at(u1, o0), at(u1, o1), at(u0, o1)], (k, c) => {
    const dx = c.x - f.a.x;
    const dz = c.z - f.a.z;
    const u = dx * f.dir.x + dz * f.dir.z;
    const o = dx * f.out.x + dz * f.out.z;
    if (u >= u0 && u < u1 && o >= o0 && o < o1) fn(k);
  });
}

export function rasterizeLayout(layout: Layout): Grid {
  // 1. bounds: all polygons padded 1.0 m, snapped outward to the cell size
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const r of layout.rooms) {
    for (const p of r.polygon) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
  }
  if (!isFinite(minX)) return createGrid(0, 0, 1, 1, GRID_VOID);
  const eps = 1e-9;
  const ix0 = Math.floor((minX - 1) / GRID_CELL_M + eps);
  const iz0 = Math.floor((minZ - 1) / GRID_CELL_M + eps);
  const nx = Math.ceil((maxX + 1) / GRID_CELL_M - eps) - ix0;
  const nz = Math.ceil((maxZ + 1) / GRID_CELL_M - eps) - iz0;
  const grid = createGrid(ix0 * GRID_CELL_M, iz0 * GRID_CELL_M, nx, nz, GRID_VOID);
  const cells = grid.cells;

  // 2. room interiors
  for (const r of layout.rooms) {
    if (r.polygon.length < 3) continue;
    forCellsIn(grid, r.polygon, (k, c) => {
      if (pointInPolygon(c, r.polygon)) cells[k] = GRID_FREE;
    });
  }

  const frames = computeEdgeFrames(layout);
  const frameOf = new Map<string, EdgeFrame>();
  for (const f of frames) frameOf.set(`${f.roomId}:${f.edge}`, f);
  const pieces = computeWallPieces(layout);
  const tunnels = computeTunnels(layout);

  // 3. wall pieces that reach the floor
  for (const p of pieces) {
    if (p.y0 > 0.2) continue;
    const f = frameOf.get(`${p.roomId}:${p.edge}`);
    if (!f) continue;
    const v = Math.max(1, Math.min(250, Math.round(p.y1 * 100)));
    forCellsInEdgeRect(grid, f, p.u0, p.u1, 0, p.thickness, (k) => {
      const cur = cells[k];
      cells[k] = cur === GRID_FREE || cur === GRID_VOID ? v : Math.max(cur, v);
    });
  }

  // 4. passable tunnels open the doorway and floor the threshold
  for (const t of tunnels) {
    if (!t.passable) continue;
    const f = frameOf.get(`${t.roomId}:${t.edge}`);
    if (!f) continue;
    forCellsInEdgeRect(grid, f, t.u0, t.u1, -0.02, t.depth + 0.02, (k) => {
      cells[k] = GRID_FREE;
    });
  }
  return grid;
}

/** A copy of the grid with every item's box stamped at its height in cm (20..250). */
export function stampFurniture(grid: Grid, items: FurnitureItem[]): Grid {
  const out = cloneGrid(grid);
  for (const it of items) {
    const v = Math.max(20, Math.min(250, Math.round(it.heightM * 100)));
    forCellsIn(out, boxCorners(it.box), (k, c) => {
      if (pointInBox(c, it.box)) out.cells[k] = v;
    });
  }
  return out;
}
