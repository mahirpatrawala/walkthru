// C8 acceptance on the real drawing (SPEC 13.11, "Real file, local only"). The PDF stays outside the repo.
// Path: WALKTHRU_REAL_DRAWING, default ~/Downloads/SON BEDROOM-Binder1.pdf. Skips when it is absent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadVectorPages } from '../src/import/pdfjs-adapter';
import { classifyPage, normalizePage } from '../src/import/vector-page';
import { selectWalls } from '../src/import/walls';
import { proposeFromPages } from '../src/import/propose';
import type { ImportResult, VectorPage } from '../src/import/types';
import { polygonArea } from '../src/core/geometry';
import { reviewSummary } from '../scripts/import-drawing';

const file = process.env.WALKTHRU_REAL_DRAWING ?? path.join(os.homedir(), 'Downloads', 'SON BEDROOM-Binder1.pdf');

describe.skipIf(!fs.existsSync(file))('real drawing: SON BEDROOM-Binder1.pdf', () => {
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
  it('finds two rooms, Son Room and Master Room, both bedrooms', () => {
    expect(r.proposal.rooms.map((x) => x.label).sort()).toEqual(['Master Room', 'Son Room']);
    expect(room('Son Room').roomType).toBe('bedroom');
    expect(room('Master Room').roomType).toBe('bedroom');
  });
  it('Son Room: short side 3.35 m and area 13.94 m2, each within 3%', () => {
    const d = dims('Son Room');
    console.log(`Son Room measured: short ${d.short.toFixed(3)} m, long ${d.long.toFixed(3)} m, area ${d.area.toFixed(3)} m2`);
    expect(within(d.short, 3.3528, 0.03)).toBe(true);
    expect(within(d.area, 13.94, 0.03)).toBe(true);
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
    const study = r.extras.furniture.find((f) => f.kind === 'counter')!;
    expect(study).toBeDefined();
    console.log(`Study box ${Math.min(study.box.w, study.box.d).toFixed(3)} x ${Math.max(study.box.w, study.box.d).toFixed(3)} m`);
    expect(within(Math.min(study.box.w, study.box.d), 0.6096, 0.03)).toBe(true);
    expect(within(Math.max(study.box.w, study.box.d), 1.2192, 0.03)).toBe(true);
    const un = r.extras.unmapped.map((u) => u.label);
    expect(un).toContain('Side Table');
  });
  it('ceiling 2.59 m +/- 0.08 by geometry', () => {
    console.log(`Ceiling measured: ${r.extras.ceiling.heightM.toFixed(3)} m by ${r.extras.ceiling.method}, candidates ${r.extras.ceiling.candidatesM.map((c) => c.toFixed(2)).join(', ')}`);
    expect(r.extras.ceiling.method).toBe('geometry');
    expect(Math.abs(r.extras.ceiling.heightM - 2.59)).toBeLessThanOrEqual(0.08);
  });
});
