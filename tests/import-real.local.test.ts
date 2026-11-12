// C8 acceptance on the real drawing (SPEC 13.11, "Real file, local only"). The PDF stays outside the repo.
// Path: WALKTHRU_REAL_DRAWING, default ~/walkthru-tools/drawings/real-dev-1/drawing.pdf (outside the repo). Skips when absent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadVectorPages } from '../src/import/pdfjs-adapter';
import { classifyPage, normalizePage } from '../src/import/vector-page';
import { selectWalls } from '../src/import/walls';
import { proposeFromPages } from '../src/import/propose';
import type { ImportResult, VectorPage } from '../src/import/types';
import { pointInPolygon, polygonArea } from '../src/core/geometry';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { validateLayout } from '../src/core/layout-validate';
import { buildDraftProperty, reviewSummary } from '../scripts/import-drawing';

const file = process.env.WALKTHRU_REAL_DRAWING ?? path.join(os.homedir(), 'walkthru-tools', 'drawings', 'real-dev-1', 'drawing.pdf');

describe.skipIf(!fs.existsSync(file))('real development drawing (local only)', () => {
  let pages: VectorPage[]; let r: ImportResult;
  beforeAll(async () => {
    pages = await loadVectorPages(new Uint8Array(fs.readFileSync(file)));
    r = proposeFromPages(pages, path.basename(file), 'son-bedroom');
    console.log('\n' + reviewSummary(r));
  });
  const room = (l: string) => r.proposal.rooms.find((x) => x.label === l)!;
  const dims = (l: string): { short: number; long: number; area: number } => {
    const p = room(l).polygon; const xs = p.map((q) => q.x), zs = p.map((q) => q.z);
    const a = Math.max(...xs) - Math.min(...xs), b = Math.max(...zs) - Math.min(...zs);
    return { short: Math.min(a, b), long: Math.max(a, b), area: Math.abs(polygonArea(p)) };
  };
  const within = (v: number, want: number, pct: number): boolean => Math.abs(v / want - 1) <= pct;

  it('page 1 is the plan and pages 2 to 6 are elevations', () => {
    expect(pages.length).toBe(6);
    expect(classifyPage(normalizePage(pages[0]))).toBe('plan');
    for (let i = 1; i < 6; i++) expect(classifyPage(normalizePage(pages[i]))).toBe('elevation');
  });
  it('wall colours include #666666 and #b3b3b3 and exclude #000000', () => {
    const w = selectWalls(normalizePage(pages[0]));
    expect(w.colors).toContain('#666666');
    expect(w.colors).toContain('#b3b3b3');
    expect(w.colors).not.toContain('#000000');
  });
  it('finds two bedrooms, Son Room and Master Room, and the drawn Passage', () => {
    expect(r.proposal.rooms.map((x) => x.label).sort()).toEqual(['Master Room', 'Passage', 'Son Room']);
    expect(room('Son Room').roomType).toBe('bedroom');
    expect(room('Master Room').roomType).toBe('bedroom');
  });
  it('Son Room: the label dimensions 11\'0" x 12\'6" within 3%, and the 150 SQFT disagreement is reported', () => {
    const d = dims('Son Room');
    console.log(`Son Room measured: short ${d.short.toFixed(3)} m, long ${d.long.toFixed(3)} m, area ${d.area.toFixed(3)} m2`);
    expect(within(d.short, 3.3528, 0.03)).toBe(true);
    expect(within(d.long, 3.81, 0.03)).toBe(true);
    expect(within(d.area, 3.3528 * 3.81, 0.03)).toBe(true);
    expect(r.extras.warnings).toContain('Label says 150 sq ft but 11\'0"×12\'6" is 137.5 sq ft. The drawn walls agree with 11\'0"×12\'6".');
  });
  it('Master Room: 3.66 x 2.74 m within 3%, cut off by the drawing edge so label-rect', () => {
    const d = dims('Master Room');
    console.log(`Master Room measured: ${d.long.toFixed(3)} x ${d.short.toFixed(3)} m`);
    expect(within(d.long, 3.6576, 0.03)).toBe(true);
    expect(within(d.short, 2.7432, 0.03)).toBe(true);
    expect(r.extras.rooms.find((x) => x.label === 'Master Room')!.method).toBe('label-rect');
  });
  it('furniture: beds in each room, the study as a counter', () => {
    const beds = r.extras.furniture.filter((f) => f.kind === 'bed');
    const inRoom = (l: string) => {
      const p = room(l).polygon; const xs = p.map((q) => q.x), zs = p.map((q) => q.z);
      return (f: { box: { cx: number; cz: number } }) => f.box.cx >= Math.min(...xs) && f.box.cx <= Math.max(...xs) && f.box.cz >= Math.min(...zs) && f.box.cz <= Math.max(...zs);
    };
    const son = beds.find(inRoom('Son Room'))!; const master = beds.find(inRoom('Master Room'))!;
    expect(son).toBeDefined(); expect(master).toBeDefined();
    expect(within(son.inner!.w, 1.524, 0.01) && within(son.inner!.d, 1.8288, 0.01)).toBe(true);
    expect(within(master.inner!.w, 1.6002, 0.01) && within(master.inner!.d, 1.7526, 0.01)).toBe(true);
    const study = r.extras.furniture.find((f) => f.label === 'Study')!;
    expect(study).toBeDefined();
    console.log(`Study box ${Math.min(study.box.w, study.box.d).toFixed(3)} x ${Math.max(study.box.w, study.box.d).toFixed(3)} m`);
    expect(within(Math.min(study.box.w, study.box.d), 0.6096, 0.03)).toBe(true);
    expect(within(Math.max(study.box.w, study.box.d), 1.2192, 0.03)).toBe(true);
    expect(r.extras.unmapped).toEqual([]);
  });
  it('wardrobe 2.74 x 0.61, dressing / storage, and both side tables are placed', () => {
    const w = r.extras.furniture.find((f) => f.label === 'Wardrobe')!;
    expect(w.kind).toBe('wardrobe');
    console.log(`Wardrobe box ${Math.max(w.box.w, w.box.d).toFixed(3)} x ${Math.min(w.box.w, w.box.d).toFixed(3)} m, height ${w.heightM}`);
    expect(within(Math.max(w.box.w, w.box.d), 2.7432, 0.03)).toBe(true);
    expect(within(Math.min(w.box.w, w.box.d), 0.6096, 0.06)).toBe(true);
    expect(r.extras.furniture.find((f) => f.label === 'Dressing / storage')!.kind).toBe('wardrobe');
    const st = r.extras.furniture.filter((f) => f.label === 'Side table');
    expect(st.length).toBe(2);
    for (const f of st) expect(f.kind).toBe('counter');
  });
  it('the drawn passage is about 0.94 m deep, has the entry door, and everything is reachable from the spawn', () => {
    const d = dims('Passage');
    console.log(`Passage measured ${d.long.toFixed(3)} x ${d.short.toFixed(3)} m`);
    expect(within(d.short, 0.94, 0.05)).toBe(true);
    expect(r.extras.rooms.find((x) => x.label === 'Passage')!.method).toMatch(/^walls/);
    expect(r.extras.warnings.some((w) => /runs off the edge of the drawing/.test(w))).toBe(true);
    const entry = r.proposal.openings.find((o) => o.roomId === 'passage' && o.type === 'door')!;
    console.log(`Entry door ${entry.widthM.toFixed(3)} m wide`);
    expect(within(entry.widthM, 0.84, 0.1)).toBe(true);
    const prop = buildDraftProperty('son-bedroom', r);
    expect(validateLayout(prop.layout).errors).toEqual([]);
    const grid = stampFurniture(rasterizeLayout(prop.layout), prop.furniture);
    const seen = new Uint8Array(grid.nx * grid.nz);
    const sp = prop.spawn;
    const si = Math.floor((sp.z - grid.originZ) / grid.cellM) * grid.nx + Math.floor((sp.x - grid.originX) / grid.cellM);
    expect(grid.cells[si]).toBe(0);
    const st = [si]; seen[si] = 1;
    while (st.length) {
      const k = st.pop()!; const i = k % grid.nx, j = (k - i) / grid.nx;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = i + a, y = j + b; if (x < 0 || y < 0 || x >= grid.nx || y >= grid.nz) continue;
        const q = y * grid.nx + x; if (!seen[q] && grid.cells[q] === 0) { seen[q] = 1; st.push(q); }
      }
    }
    for (const rm of prop.layout.rooms) {
      let free = 0, reach = 0;
      for (let j = 0; j < grid.nz; j++) for (let i = 0; i < grid.nx; i++) {
        const x = grid.originX + (i + 0.5) * grid.cellM, z = grid.originZ + (j + 0.5) * grid.cellM;
        if (!pointInPolygon({ x, z }, rm.polygon) || grid.cells[j * grid.nx + i] !== 0) continue;
        free++; if (seen[j * grid.nx + i]) reach++;
      }
      expect(reach / free, `${rm.label} reachable`).toBeGreaterThan(0.99);
    }
  });
  it('ceiling 2.59 m +/- 0.08 by geometry', () => {
    console.log(`Ceiling measured: ${r.extras.ceiling.heightM.toFixed(3)} m by ${r.extras.ceiling.method}, candidates ${r.extras.ceiling.candidatesM.map((c) => c.toFixed(2)).join(', ')}`);
    expect(r.extras.ceiling.method).toBe('geometry');
    expect(Math.abs(r.extras.ceiling.heightM - 2.59)).toBeLessThanOrEqual(0.08);
  });
});
