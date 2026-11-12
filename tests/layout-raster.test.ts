import { describe, expect, it } from 'vitest';
import { buildTruthProperty, classifyTruth, truthGrid } from '../scripts/make-test-room';
import { cellValue } from '../src/core/grid-codec';
import { mulberry32 } from '../src/core/geometry';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { pointInPolygon } from '../src/core/geometry';
import { cellCentre } from '../src/core/grid-codec';
import { GRID_FREE, GRID_VOID } from '../src/types';
import type { Grid, Layout } from '../src/types';

const empty = buildTruthProperty('empty');
const furnished = buildTruthProperty('furnished');
const gridEmpty = rasterizeLayout(empty.layout);
const gridFurn = stampFurniture(rasterizeLayout(furnished.layout), furnished.furniture);

function agreement(grid: Grid, variant: 'empty' | 'furnished', n: number, seed: number): { used: number; ok: number } {
  const rnd = mulberry32(seed);
  let used = 0, ok = 0;
  while (used < n) {
    const x = -1.5 + rnd() * 7;
    const z = -3 + rnd() * 11;
    const cls = classifyTruth(x, z, variant);
    if (cls === 'edge') continue;
    used++;
    const v = cellValue(grid, x, z);
    const got = v === GRID_VOID ? 'void' : v === GRID_FREE ? 'free' : 'obstacle';
    if (got === cls) ok++;
  }
  return { used, ok };
}

describe('rasterizeLayout vs the truth oracle', () => {
  it('empty variant: >= 99.5% of 20,000 samples agree', () => {
    const r = agreement(gridEmpty, 'empty', 20000, 7);
    expect(r.ok / r.used).toBeGreaterThanOrEqual(0.995);
  });
  it('furnished variant (stampFurniture applied): >= 99.5% agree', () => {
    const r = agreement(gridFurn, 'furnished', 20000, 11);
    expect(r.ok / r.used).toBeGreaterThanOrEqual(0.995);
  });
  it('same bounds and (nearly) every cell equals truthGrid', () => {
    for (const [g, v] of [[gridEmpty, 'empty'], [gridFurn, 'furnished']] as const) {
      const t = truthGrid(v);
      expect([g.originX, g.originZ, g.nx, g.nz]).toEqual([t.originX, t.originZ, t.nx, t.nz]);
      let diff = 0;
      for (let k = 0; k < g.cells.length; k++) if (g.cells[k] !== t.cells[k]) diff++;
      expect(diff / g.cells.length).toBeLessThan(0.001);
    }
  });
  it('the specific probe points', () => {
    const v = (x: number, z: number) => cellValue(gridEmpty, x, z);
    expect(v(0.85, 5.06)).toBe(0);        // doorway
    expect(v(2.0, -0.06)).toBe(0);        // sliding opening
    expect(v(2.0, 5.03)).toBe(250);
    expect(v(0.2, -0.03)).toBe(250);
    expect(v(2.0, -1.63)).toBe(110);      // railing
    expect(v(-0.03, 4.0)).toBe(90);       // window sill
    expect(v(4.3, 5.7)).toBe(255);        // beyond the main door's stub
    expect(v(4.05, 5.7)).toBe(0);         // the stub is floored
  });
  it('stampFurniture copies and stamps bed 55 and sofa 85', () => {
    const base = rasterizeLayout(furnished.layout);
    expect(cellValue(base, 1, 2.25)).toBe(0);
    expect(cellValue(gridFurn, 1, 2.25)).toBe(55);
    expect(cellValue(gridFurn, 3.5, 3.5)).toBe(85);
  });
});

function flood(g: Grid, sx: number, sz: number): Set<number> {
  const i0 = Math.floor((sx - g.originX) / g.cellM);
  const j0 = Math.floor((sz - g.originZ) / g.cellM);
  const seen = new Set<number>();
  const q = [j0 * g.nx + i0];
  seen.add(q[0]);
  while (q.length) {
    const k = q.pop()!;
    const i = k % g.nx, j = (k - i) / g.nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
      const nk = nj * g.nx + ni;
      if (seen.has(nk) || g.cells[nk] !== GRID_FREE) continue;
      seen.add(nk);
      q.push(nk);
    }
  }
  return seen;
}

describe('connectivity', () => {
  it('free cells from the spawn reach the balcony and the passage (both variants)', () => {
    for (const g of [gridEmpty, gridFurn]) {
      const seen = flood(g, 2.6, 0.8);
      const has = (x: number, z: number) => seen.has(Math.floor((z - g.originZ) / g.cellM) * g.nx + Math.floor((x - g.originX) / g.cellM));
      expect(has(2, -0.87)).toBe(true);
      expect(has(2, 5.72)).toBe(true);
    }
  });
});

describe('L-shaped room', () => {
  const l: Layout = {
    wallHeightM: 2.6, wallThicknessM: 0.12, railingHeightM: 1.1,
    rooms: [{
      id: 'L', roomType: 'living', label: 'L',
      polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }],
      edges: ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
    }],
    openings: [], finishes: empty.layout.finishes, scaleSource: 'typed-sizes',
  };
  it('has no wall cells inside its polygon, and walls hug the outside, closing the reflex corner', () => {
    const g = rasterizeLayout(l);
    let inside = 0, wallInside = 0;
    for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
      const c = cellCentre(g, i, j);
      if (pointInPolygon(c, l.rooms[0].polygon)) { inside++; if (g.cells[j * g.nx + i] !== GRID_FREE) wallInside++; }
    }
    expect(inside).toBeGreaterThan(1000);
    expect(wallInside).toBe(0);
    expect(cellValue(g, 2.06, 2.06)).toBe(250); // reflex corner closed
    expect(cellValue(g, 3, 2.06)).toBe(250);
    expect(cellValue(g, 2.06, 3)).toBe(250);
  });
});
