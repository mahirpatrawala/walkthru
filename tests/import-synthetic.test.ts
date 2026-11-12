// C8 acceptance, synthetic (SPEC 13.11 items 1 to 13). Always runs.
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_TRUTH, PT_PER_M, buildDrawingPages, buildDrawingPdf, buildRasterPage, truthToImport,
} from '../scripts/make-test-drawing';
import { buildDraftProperty } from '../scripts/import-drawing';
import { classifyTruth } from '../scripts/make-test-room';
import { loadVectorPages } from '../src/import/pdfjs-adapter';
import { classifyPage, normalizePage } from '../src/import/vector-page';
import { bridgeGaps, selectWalls, wallBitmap } from '../src/import/walls';
import { proposeFromPages } from '../src/import/propose';
import { ImportError } from '../src/import/types';
import type { ImportResult, VectorPage } from '../src/import/types';
import { cellValue } from '../src/core/grid-codec';
import { mulberry32, polygonArea } from '../src/core/geometry';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { validateLayout, validateProperty } from '../src/core/layout-validate';
import { pxSizeFor } from '../src/import/regions';

const run = (v: 'A' | 'B'): ImportResult => proposeFromPages(buildDrawingPages(v), 'fixture.pdf', 'fixture');
const A = run('A');
const B = run('B');
const room = (r: ImportResult, label: string) => r.proposal.rooms.find((x) => x.label === label)!;
const finding = (r: ImportResult, label: string) => r.extras.rooms.find((x) => x.label === label)!;

describe('1. adapter: real PDF through pdf.js', () => {
  it('returns 2 pages with the same fills, areas and strings as the fixture pages', async () => {
    const got = await loadVectorPages(buildDrawingPdf('A'));
    const want = buildDrawingPages('A');
    expect(got.length).toBe(2);
    for (let i = 0; i < 2; i++) {
      const byColor = (p: VectorPage): Record<string, number[]> => {
        const m: Record<string, number[]> = {};
        for (const f of p.fills) (m[f.color] ??= []).push(f.area);
        for (const k of Object.keys(m)) m[k].sort((a, b) => a - b);
        return m;
      };
      const a = byColor(got[i]), b = byColor(want[i]);
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      let worst = 0;
      for (const c of Object.keys(b)) {
        expect(a[c].length, `fills of ${c} on page ${i + 1}`).toBe(b[c].length);
        a[c].forEach((v, k) => { worst = Math.max(worst, Math.abs(v - b[c][k]) / b[c][k]); });
      }
      // tiny glyph shapes round at 3 decimals; the 0.5% bar holds for everything over 1 pt^2
      expect(worst).toBeLessThan(0.005);
      expect(got[i].texts.map((t) => t.str).sort()).toEqual(want[i].texts.map((t) => t.str).sort());
      expect(got[i].strokes.length).toBe(want[i].strokes.length);
    }
    // the swings are real cubic curves in the PDF and flatten to strokes flagged as curves
    expect(got[0].strokes.filter((s) => s.hasCurve).length).toBe(2);
  });
  it('imports the same flat from the parsed PDF as from the fixture pages', async () => {
    const got = await loadVectorPages(buildDrawingPdf('A'));
    const r = proposeFromPages(got, 'fixture.pdf', 'fixture');
    expect(r.proposal.rooms.length).toBe(3);
    expect(r.extras.scale.ptPerM).toBeCloseTo(A.extras.scale.ptPerM, 1);
    expect(r.proposal.openings.length).toBe(4);
  });
});

describe('2. normalisation', () => {
  const n = normalizePage(buildDrawingPages('A')[0]);
  it('puts every label at angle 0', () => {
    for (const t of n.texts) expect(Math.abs(t.angle)).toBeLessThan(1e-6);
  });
  it('is a rotation, not a mirror: the balcony label is toward -z of the bedroom label', () => {
    const y = (s: string): number => n.texts.find((t) => t.str === s)!.y;
    expect(y('BALCONY')).toBeLessThan(y('BEDROOM 1'));
    expect(y('PASSAGE')).toBeGreaterThan(y('BEDROOM 1'));
    // text reads left to right: the size line starts where the name starts
    const x = (s: string): number => n.texts.find((t) => t.str === s)!.x;
    expect(x('BEDROOM 1')).toBeCloseTo(x('215 SQFT'), 3);
  });
  it('is idempotent', () => {
    const again = normalizePage(n);
    expect(again.texts[0].x).toBe(n.texts[0].x);
  });
});

describe('3. classification', () => {
  it('page 1 is the plan and page 2 an elevation', () => {
    const pages = buildDrawingPages('A');
    expect(classifyPage(pages[0])).toBe('plan');
    expect(classifyPage(pages[1])).toBe('elevation');
  });
  it('a full-page image with no paths is raster and the import refuses it', () => {
    expect(classifyPage(buildRasterPage())).toBe('raster');
    let err: unknown;
    try { proposeFromPages([buildRasterPage()], 'scan.pdf', 'scan'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe('raster-plan');
    expect((err as ImportError).message).toBe('This plan is an image. Trace it in the editor.');
  });
});

describe('4 and 5. walls and gaps', () => {
  const page = normalizePage(buildDrawingPages('A')[0]);
  const walls = selectWalls(page);
  it('chooses exactly the two grey groups and none of the 300 black shapes', () => {
    expect([...walls.colors].sort()).toEqual(['#666666', '#b3b3b3']);
    expect(walls.colors).not.toContain('#000000');
    expect(page.fills.filter((f) => f.color === '#000000').length).toBe(300);
  });
  it('wall thickness is 0.11 to 0.24 m at the true scale', () => {
    const tM = walls.t / PT_PER_M;
    expect(tM).toBeGreaterThan(0.11);
    expect(tM).toBeLessThan(0.24);
  });
  it('bridges exactly 4 gaps of 0.90, 1.60, 1.20 and 0.90 m', () => {
    const gaps = bridgeGaps(walls, wallBitmap(page, walls, pxSizeFor(page, walls.t)));
    expect(gaps.length).toBe(4);
    const w = gaps.map((g) => g.widthPt / PT_PER_M).sort((a, b) => a - b);
    [0.9, 0.9, 1.2, 1.6].forEach((v, i) => expect(Math.abs(w[i] - v)).toBeLessThanOrEqual(0.03));
  });
});

describe('6. scale', () => {
  it('lands on 31.7 pt per metre within 0.5% with at least 4 agreeing votes, furniture included', () => {
    const s = A.extras.scale;
    expect(Math.abs(s.ptPerM / 31.7 - 1)).toBeLessThan(0.005);
    expect(s.agreeing).toBeGreaterThanOrEqual(4);
    const agree = s.votes.filter((v) => Math.abs(v.ptPerM / s.ptPerM - 1) <= 0.03);
    expect(agree.length).toBe(s.agreeing);
    expect(agree.filter((v) => v.source.startsWith('furniture')).length).toBeGreaterThan(0);
  });
});

describe('7 and 9. rooms', () => {
  it('finds 3 rooms with the right areas, methods, types and labels', () => {
    expect(A.proposal.rooms.length).toBe(3);
    const area = (l: string): number => Math.abs(polygonArea(room(A, l).polygon));
    expect(Math.abs(area('Bedroom 1') / 20.0 - 1)).toBeLessThanOrEqual(0.015);
    expect(Math.abs(area('Passage') / 4.8 - 1)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(area('Balcony') / 4.5 - 1)).toBeLessThanOrEqual(0.04);
    expect(finding(A, 'Bedroom 1').method).toBe('walls');
    expect(finding(A, 'Passage').method).toBe('walls');
    expect(finding(A, 'Balcony').method).toBe('walls+strokes');
    expect(room(A, 'Bedroom 1').roomType).toBe('bedroom');
    expect(room(A, 'Passage').roomType).toBe('other');
    expect(room(A, 'Balcony').roomType).toBe('balcony');
  });
  it('polygons sit where the truth puts them (after the origin offset)', () => {
    for (const tr of FIXTURE_TRUTH.rooms) {
      const got = room(A, tr.label).polygon;
      expect(got.length).toBe(4);
      tr.polygon.forEach((p, i) => {
        const e = truthToImport(p.x, p.z);
        expect(Math.hypot(got[i].x - e.x, got[i].z - e.z), `${tr.label} vertex ${i}`).toBeLessThan(0.03);
      });
    }
  });
  it('balcony has three railings and one wall', () => {
    const e = room(A, 'Balcony').edges;
    expect(e.filter((k) => k === 'railing').length).toBe(3);
    expect(e.filter((k) => k === 'wall').length).toBe(1);
    expect(room(A, 'Balcony').edges).toEqual(['railing', 'railing', 'wall', 'railing']);
  });
});

describe('8. openings', () => {
  it('2 doors, 1 opening, 1 window, each on the right edge, centre within 0.05 m', () => {
    const o = A.proposal.openings;
    expect(o.filter((x) => x.type === 'door').length).toBe(2);
    expect(o.filter((x) => x.type === 'opening').length).toBe(1);
    expect(o.filter((x) => x.type === 'window').length).toBe(1);
    for (const t of FIXTURE_TRUTH.openings) {
      const rid = room(A, t.room).id;
      const m = o.find((x) => x.roomId === rid && x.edge === t.edge);
      expect(m, `${t.type} on ${t.room} edge ${t.edge}`).toBeDefined();
      expect(m!.type).toBe(t.type);
      expect(Math.abs(m!.centreM - t.centreM)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(m!.widthM - t.widthM)).toBeLessThanOrEqual(0.03);
    }
    const w = o.find((x) => x.type === 'window')!;
    expect(w.sillM).toBe(0.9);
    expect(w.headM).toBe(2.1);
  });
});

describe('10. furniture', () => {
  const at = (v: { cx: number; cz: number }): { x: number; z: number } => truthToImport(v.cx, v.cz);
  it('bed box is within 0.04 m of the truth, back on the wall, mattress 1.50 x 2.01', () => {
    const bed = A.extras.furniture.find((f) => f.kind === 'bed')!;
    const t = FIXTURE_TRUTH.bed, e = at(t);
    expect(Math.abs(bed.box.cx - e.x)).toBeLessThanOrEqual(0.04);
    expect(Math.abs(bed.box.cz - e.z)).toBeLessThanOrEqual(0.04);
    expect(Math.abs(bed.box.w - t.w)).toBeLessThanOrEqual(0.04);
    expect(Math.abs(bed.box.d - t.d)).toBeLessThanOrEqual(0.04);
    expect(bed.box.yawDeg).toBeCloseTo(t.yawDeg, 3);
    expect(bed.inner!.w).toBeCloseTo(1.5, 2);
    expect(bed.inner!.d).toBeCloseTo(2.01, 2);
    expect(bed.source).toBe('real');
  });
  it('sofa likewise, with its back on the wall', () => {
    const sofa = A.extras.furniture.find((f) => f.kind === 'sofa')!;
    const t = FIXTURE_TRUTH.sofa, e = at(t);
    expect(Math.abs(sofa.box.cx - e.x)).toBeLessThanOrEqual(0.04);
    expect(Math.abs(sofa.box.cz - e.z)).toBeLessThanOrEqual(0.04);
    expect(Math.abs(sofa.box.w - t.w)).toBeLessThanOrEqual(0.04);
    expect(Math.abs(sofa.box.d - t.d)).toBeLessThanOrEqual(0.04);
    expect(sofa.box.yawDeg).toBeCloseTo(t.yawDeg, 3);
  });
  it('the side table is left in unmapped', () => {
    expect(A.extras.unmapped.map((u) => u.label)).toContain('Side Table');
    expect(A.extras.furniture.length).toBe(2);
  });
});

describe('11. ceiling', () => {
  it('variant A reads 8\'6" from text', () => {
    expect(A.extras.ceiling.method).toBe('text');
    expect(A.extras.ceiling.heightM).toBeCloseTo(2.59, 2);
    expect(A.proposal.wallHeightM).toBeCloseTo(2.59, 2);
  });
  it('variant B finds 2.60 m from geometry and rejects the 2.08 m candidate', () => {
    expect(B.extras.ceiling.method).toBe('geometry');
    expect(Math.abs(B.extras.ceiling.heightM - 2.6)).toBeLessThanOrEqual(0.05);
    expect(B.extras.ceiling.candidatesM.every((c) => c >= 2.3 && c <= 3.4)).toBe(true);
    expect(B.extras.ceiling.candidatesM.length).toBe(1);
  });
});

describe('12. end to end', () => {
  const prop = buildDraftProperty('fixture', A);
  it('the draft property validates and has no layout errors', () => {
    expect(() => validateProperty(JSON.parse(JSON.stringify(prop)))).not.toThrow();
    expect(validateLayout(prop.layout).errors).toEqual([]);
    expect(prop.layout.scaleSource).toBe('plan-dimensions');
    expect(prop.furniture.length).toBe(2);
  });
  it('its grid agrees with the truth on at least 98% of 10,000 seeded samples', () => {
    const grid = stampFurniture(rasterizeLayout(prop.layout), prop.furniture);
    const rnd = mulberry32(12);
    let n = 0, agree = 0, skipped = 0;
    while (n < 10000) {
      const tx = -1 + rnd() * 6, tz = -2.5 + rnd() * 10;
      const truth = classifyTruth(tx, tz, 'furnished');
      if (truth === 'edge') { skipped++; continue; }
      n++;
      const e = truthToImport(tx, tz);
      const v = cellValue(grid, e.x, e.z);
      const mine = v === 255 ? 'void' : v === 0 ? 'free' : 'obstacle';
      if (mine === truth) agree++;
    }
    const pct = (agree / n) * 100;
    console.log(`grid agreement ${pct.toFixed(2)}% of ${n} samples (${skipped} edge samples skipped)`);
    expect(pct).toBeGreaterThanOrEqual(98);
  });
  it('a flood fill from the spawn reaches the balcony and the passage', () => {
    const grid = stampFurniture(rasterizeLayout(prop.layout), prop.furniture);
    const sp = A.extras.spawn!;
    expect(sp).not.toBeNull();
    expect(cellValue(grid, sp.x, sp.z)).toBe(0);
    const seen = new Uint8Array(grid.nx * grid.nz);
    const start = Math.floor((sp.z - grid.originZ) / grid.cellM) * grid.nx + Math.floor((sp.x - grid.originX) / grid.cellM);
    const stack = [start]; seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!; const i = k % grid.nx, j = (k - i) / grid.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= grid.nx || b >= grid.nz) continue;
        const q = b * grid.nx + a;
        if (!seen[q] && grid.cells[q] === 0) { seen[q] = 1; stack.push(q); }
      }
    }
    const reach = (x: number, z: number): boolean => seen[Math.floor((z - grid.originZ) / grid.cellM) * grid.nx + Math.floor((x - grid.originX) / grid.cellM)] === 1;
    const c = (l: string): { x: number; z: number } => {
      const p = room(A, l).polygon;
      return { x: p.reduce((s, q) => s + q.x, 0) / p.length, z: p.reduce((s, q) => s + q.z, 0) / p.length };
    };
    expect(reach(c('Balcony').x, c('Balcony').z)).toBe(true);
    expect(reach(c('Passage').x, c('Passage').z)).toBe(true);
  });
});

describe('13. robustness', () => {
  const FURN = /^(BED|SOFA|SIDE TABLE|4'11"X6'7"|6'7"X2'11"|2'0"X1'6")$/;
  it('without furniture labels the scale still lands within 1.5% on room votes', () => {
    const pages = buildDrawingPages('A').map((p) => ({ ...p, texts: p.texts.filter((t) => !FURN.test(t.str)) }));
    const r = proposeFromPages(pages, 'f.pdf', 'f');
    expect(Math.abs(r.extras.scale.ptPerM / 31.7 - 1)).toBeLessThan(0.015);
    expect(r.extras.scale.votes.every((v) => v.source.startsWith('room'))).toBe(true);
    expect(r.proposal.rooms.length).toBe(3);
    expect(r.extras.furniture.length).toBe(0);
  });
  it('with all text removed it returns 0 rooms, a wall-thickness scale guess and two warnings, without throwing', () => {
    const pages = buildDrawingPages('A').map((p) => ({ ...p, texts: [] }));
    const r = proposeFromPages(pages, 'f.pdf', 'f');
    expect(r.proposal.rooms.length).toBe(0);
    expect(r.extras.warnings).toContain('No dimensions found. Scale guessed from wall thickness.');
    expect(r.extras.warnings.some((w) => /No room labels/.test(w))).toBe(true);
    expect(r.extras.scale.votes.length).toBe(0);
    // the guess is: the measured wall thickness t is 0.23 m. The fixture mixes 0.23 m and 0.12 m walls, so the median
    // thickness lands between the two and the guess is off by that much. It is a guess, and the warning says so.
    const n = normalizePage(pages[0]);
    expect(r.extras.scale.ptPerM).toBeCloseTo(selectWalls(n).t / 0.23, 6);
    expect(r.proposal.confidence).toBeLessThanOrEqual(0.2);
  });
});
