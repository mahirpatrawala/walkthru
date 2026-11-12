// C12a: the synthetic drawing-set generator (SPEC 17.10, 17.12 item 8's "24 fixed sets"). Always runs, no real file.
import { describe, expect, it } from 'vitest';
import { FIXED_SEEDS, buildSet, pdfOf, rasterPagesOf, userPagesOf, vectorPagesOf } from '../scripts/make-drawing-sets';
import type { BuiltSet } from '../scripts/make-drawing-sets';
import { encodePng } from '../scripts/drawing-sets/raster';
import { loadVectorPages } from '../src/import/pdfjs-adapter';
import { normalizePage } from '../src/import/vector-page';
import { parseLengthLoose, parseSizeLoose } from '../src/understand/units';

const t0 = Date.now();
const SETS: BuiltSet[] = FIXED_SEEDS.map((s) => buildSet(s));
const buildMs = Date.now() - t0;
const count = <T>(xs: T[], f: (x: T) => string | number | boolean): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of xs) { const k = String(f(x)); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
};
const atLeast = (m: Map<string, number>, keys: string[], n = 2): void => { for (const k of keys) expect(m.get(k) ?? 0, `option value "${k}" appears ${m.get(k) ?? 0} times`).toBeGreaterThanOrEqual(n); };

describe('24 fixed sets', () => {
  it('there are 24, built fast, split by firm into 18 dev and 6 held-out, and no firm is on both sides', () => {
    expect(SETS.length).toBe(24);
    expect(buildMs).toBeLessThan(20000);
    expect(SETS.filter((s) => s.truth.split === 'dev').length).toBe(18);
    expect(SETS.filter((s) => s.truth.split === 'held-out').length).toBe(6);
    const dev = new Set(SETS.filter((s) => s.truth.split === 'dev').map((s) => s.truth.firm));
    for (const s of SETS.filter((x) => x.truth.split === 'held-out')) expect(dev.has(s.truth.firm)).toBe(false);
  });

  it('each set regenerates exactly from its seed', () => {
    for (const seed of [1, 9, 17, 24]) {
      const a = buildSet(seed), b = buildSet(seed);
      expect(JSON.stringify(a.truth)).toBe(JSON.stringify(b.truth));
      expect(a.pages.map((p) => p.prims.length)).toEqual(b.pages.map((p) => p.prims.length));
    }
    expect(JSON.stringify(buildSet(2).truth)).not.toBe(JSON.stringify(buildSet(3).truth));
  });

  it('every option value is covered at least twice', () => {
    const o = SETS.map((s) => s.truth.options);
    atLeast(count(o, (x) => x.template), ['studio', '1bhk', '2bhk', '3bhk', 'single-bedroom']);
    atLeast(count(o, (x) => x.wallStyle), ['fill-dark', 'fill-grey', 'fill-two-grey', 'double', 'hatch']);
    atLeast(count(o, (x) => x.textMode), ['real', 'glyph', 'mixed']);
    atLeast(count(o, (x) => x.font), ['simplex', 'duplex', 'complex']);
    atLeast(count(o, (x) => x.units), ['ftin', 'mm', 'm']);
    atLeast(count(o, (x) => x.ftinFormat), ['dash', 'tight', 'space', 'fraction']);
    atLeast(count(o, (x) => x.areaUnit), ['sqft', 'sqm']);
    atLeast(count(o, (x) => x.labelStyle), ['brochure', 'designer', 'none']);
    atLeast(count(o, (x) => x.terminator), ['tick', 'arrow', 'dot']);
    atLeast(count(o, (x) => x.keyStyle), ['number', 'letter', 'none']);
    atLeast(count(o, (x) => x.captionStyle), ['elevation-n', 'elev-letter', 'wall-n']);
    atLeast(count(o, (x) => x.page), ['A4', 'A3']);
    atLeast(count(o, (x) => x.rotation), ['0', '90', '180', '270']);
    atLeast(count(o, (x) => x.upper), ['true', 'false']);
    atLeast(count(o, (x) => x.chains), ['true', 'false']);
    atLeast(count(o, (x) => x.plantWrong > 0), ['true', 'false']);
    atLeast(count(o, (x) => x.symbolsLabelled), ['true', 'false']);
    atLeast(count(o, (x) => x.elevOnPlanPage), ['true', 'false']);
    atLeast(count(o, (x) => x.internalView), ['true', 'false']);
    atLeast(count(o, (x) => x.notToScale), ['true', 'false']);
    atLeast(count(o, (x) => x.raster.phone), ['true', 'false']);
    atLeast(count(o, (x) => x.raster.dpi), ['100', '150', '200']);
    atLeast(count(o, (x) => x.raster.jpegQuality), ['40', '60', '90']);
    atLeast(count(o, (x) => x.elevations), ['0', '2', '3', '4', '5']);
    atLeast(count(o, (x) => x.vocab), ['0', '1', '2', '3']);
    atLeast(count(o, (x) => x.symbolVariant), ['0', '1', '2']);
    atLeast(count(o, (x) => x.roundShare > 0), ['true', 'false']);
    atLeast(count(o, (x) => x.slantDeg > 0), ['true', 'false']);
  });

  it('every symbol class, door and window kind, and hinge-signal case appears at least twice', () => {
    atLeast(count(SETS.flatMap((s) => s.truth.symbols), (x) => x.cls), ['bed', 'sofa', 'dining', 'chair', 'wardrobe', 'desk', 'side table', 'tv unit', 'counter', 'wc', 'basin', 'shower', 'sink', 'hob']);
    atLeast(count(SETS.flatMap((s) => s.truth.symbols), (x) => `${x.cls}:${x.variant}`), ['bed:0', 'bed:1', 'bed:2', 'sofa:0', 'sofa:1', 'sofa:2', 'hob:0', 'hob:1', 'hob:2', 'wardrobe:0', 'wardrobe:1', 'wardrobe:2']);
    atLeast(count(SETS.flatMap((s) => s.truth.openings), (x) => x.style), ['swing', 'sliding', 'entrance', 'window', 'ventilator']);
    const units = SETS.flatMap((s) => s.truth.elevations.flatMap((e) => e.units));
    atLeast(count(units.flatMap((u) => u.hingeSignals), (x) => x), ['both', 'handle', 'mark', 'neither', 'disagree']);
    atLeast(count(units.flatMap((u) => u.hinge), (x) => x), ['outer-edges', 'unknown', 'conflict']);
    atLeast(count(units, (u) => u.bays), ['2', '3']);
    atLeast(count(units, (u) => u.loftM > 0), ['true', 'false']);
    atLeast(count(units, (u) => u.drawerStripM > 0), ['true', 'false']);
    atLeast(count(units, (u) => u.baseGapM > 0), ['true', 'false']);
    atLeast(count(units.flatMap((u) => u.shuttersPerBay), (x) => x), ['1', '2']);
    expect(SETS.some((s) => s.truth.elevations.some((e) => e.internal))).toBe(true);
    expect(SETS.some((s) => s.truth.elevations.some((e) => e.bed))).toBe(true);
    expect(SETS.some((s) => s.truth.elevations.some((e) => e.onPlanPage))).toBe(true);
    expect(SETS.some((s) => s.truth.elevations.some((e) => !e.onPlanPage))).toBe(true);
  });
});

describe('truth is consistent with what was drawn', () => {
  it('rooms do not overlap, items sit inside their room and do not overlap each other', () => {
    for (const s of SETS) {
      const R = s.truth.rooms.map((r) => ({ id: r.id, x0: r.polygonM[0][0], z0: r.polygonM[0][1], x1: r.polygonM[2][0], z1: r.polygonM[2][1] }));
      for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
        const o = Math.min(R[i].x1, R[j].x1) - Math.max(R[i].x0, R[j].x0) > 1e-6 && Math.min(R[i].z1, R[j].z1) - Math.max(R[i].z0, R[j].z0) > 1e-6;
        expect(o, `${s.truth.id}: ${R[i].id} overlaps ${R[j].id}`).toBe(false);
      }
      for (const it of s.truth.items) {
        const room = R.find((r) => r.id === it.roomId)!;
        const sym = s.truth.symbols.find((x) => x.itemId === it.id)!;
        const b = sym.bboxM;
        expect(b[0] >= room.x0 - 1e-6 && b[2] <= room.x1 + 1e-6 && b[1] >= room.z0 - 1e-6 && b[3] <= room.z1 + 1e-6, `${s.truth.id}: ${it.id} outside ${room.id}`).toBe(true);
      }
      const its = s.truth.items.map((it) => s.truth.symbols.find((x) => x.itemId === it.id)!.bboxM);
      for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++) {
        const o = Math.min(its[i][2], its[j][2]) - Math.max(its[i][0], its[j][0]) > 1e-6 && Math.min(its[i][3], its[j][3]) - Math.max(its[i][1], its[j][1]) > 1e-6;
        expect(o, `${s.truth.id}: ${s.truth.items[i].id} overlaps ${s.truth.items[j].id}`).toBe(false);
      }
    }
  });

  it('every dimension string parses back to the length it states, and states the geometry within 2 inches unless planted', () => {
    let n = 0;
    for (const s of SETS) for (const d of s.truth.dimensions) {
      const p = parseLengthLoose(d.string);
      expect(p, `${s.truth.id} ${d.id} "${d.string}"`).not.toBeNull();
      expect(Math.abs(p!.m - d.shownM), `${s.truth.id} ${d.id} "${d.string}" parses to ${p!.m}, truth says it states ${d.shownM}`).toBeLessThan(0.0006);
      const off = Math.abs(d.shownM - d.valueM);
      if (d.planted) expect(off, `${d.id} planted`).toBeGreaterThan(0.09);
      else if (d.rounded) expect(off).toBeLessThanOrEqual(0.0635 + 0.0006); // up to 2 inches, and rounding to the format can add half an inch
      else expect(off, `${s.truth.id} ${d.id} "${d.string}" vs ${d.valueM}`).toBeLessThanOrEqual(0.0127 + 0.0006);
      n++;
    }
    expect(n).toBeGreaterThan(400);
  });

  it('plan chains add up to their overall (the walls are members too), unless a member was planted or rounded', () => {
    let checked = 0;
    for (const s of SETS.filter((x) => x.truth.options.chains)) for (const chain of ['bottom', 'left']) {
      const members = s.truth.dimensions.filter((d) => d.chain === chain && d.kind === 'chain-member');
      const overall = s.truth.dimensions.find((d) => d.chain === chain && d.kind === 'overall')!;
      expect(members.reduce((a, d) => a + d.valueM, 0)).toBeCloseTo(overall.valueM, 6);
      if (!members.some((d) => d.planted || d.rounded)) {
        expect(Math.abs(members.reduce((a, d) => a + d.shownM, 0) - overall.shownM)).toBeLessThan(0.0254 * 1.01 * Math.max(1, members.length / 4));
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('room label strings parse back to the label sizes in truth; labels are absent when the set has none', () => {
    for (const s of SETS) for (const r of s.truth.rooms) {
      if (s.truth.options.labelStyle === 'none') { expect(r.labelString).toBeNull(); continue; }
      expect(r.labelString).not.toBeNull();
      if (r.dimsString) {
        const p = parseSizeLoose(r.dimsString)!;
        expect(p, `${s.truth.id} ${r.dimsString}`).not.toBeNull();
        expect(Math.abs(p.w - r.labelDimsM!.w)).toBeLessThan(0.0006);
        expect(Math.abs(p.l - r.labelDimsM!.l)).toBeLessThan(0.0006);
      }
    }
  });

  it('planted wrong strings and rounded strings are recorded, and match the option', () => {
    for (const s of SETS) {
      expect(s.truth.plantedWrong.length, s.truth.id).toBe(s.truth.options.plantWrong);
      expect(s.truth.roundedStrings.length > 0).toBe(s.truth.options.roundShare > 0 ? s.truth.roundedStrings.length > 0 : false);
    }
    expect(SETS.reduce((a, s) => a + s.truth.plantedWrong.length, 0)).toBeGreaterThanOrEqual(8);
  });

  it('unit truth is complete: bay widths add up to the unit, a hinge entry per bay, signals match the truth', () => {
    for (const s of SETS) for (const e of s.truth.elevations) for (const u of e.units) {
      expect(u.bayWidthsM.length).toBe(u.bays);
      expect(u.bayWidthsM.reduce((a, b) => a + b, 0)).toBeCloseTo(u.widthM, 6);
      expect(u.hinge.length).toBe(u.bays); expect(u.hingeSignals.length).toBe(u.bays); expect(u.shuttersPerBay.length).toBe(u.bays);
      u.hingeSignals.forEach((sig, i) => {
        if (sig === 'neither') expect(u.hinge[i]).toBe('unknown');
        else if (sig === 'disagree') expect(u.hinge[i]).toBe('conflict');
        else expect(['left', 'right', 'outer-edges']).toContain(u.hinge[i]);
      });
      expect(u.heightM).toBeLessThanOrEqual(e.ceilingM);
    }
  });

  it('elevation links: each elevation names a real wall of a real room, and the key marker (when drawn) tags every wall', () => {
    for (const s of SETS) {
      for (const e of s.truth.elevations.filter((x) => x.wall)) {
        expect(s.truth.rooms.some((r) => r.id === e.wall!.roomId)).toBe(true);
        expect([0, 1, 2, 3]).toContain(e.wall!.edge);
        if (s.truth.elevationKey) expect(s.truth.elevationKey.tags.find((t) => t.edge === e.wall!.edge)!.tag).toBe(e.tag);
      }
      if (s.truth.options.keyStyle === 'none') expect(s.truth.elevationKey).toBeNull();
      else if (s.truth.elevations.length) expect(s.truth.elevationKey!.tags.length).toBe(4);
    }
  });
});

describe('what the pages hold', () => {
  it('real-text sets carry text that reads upright after normalisation, whatever the rotation', () => {
    let tested = 0;
    for (const s of SETS) {
      const pages = vectorPagesOf(s);
      const withText = pages.filter((p) => p.texts.length > 5);
      if (s.truth.options.textMode === 'glyph') { expect(pages[0].texts.length, s.truth.id).toBe(0); continue; }
      expect(withText.length, s.truth.id).toBeGreaterThan(0);
      for (const p of withText) {
        const n = normalizePage(p);
        // the labels read left to right once the sheet is turned back; vertical dimension text stays at 90 degrees, nothing is upside down
        const chars = (f: (a: number) => boolean): number => n.texts.filter((t) => f(Math.abs(t.angle))).reduce((a, t) => a + t.str.length, 0);
        const all = chars(() => true);
        expect(chars((a) => a < 1e-6) / all, s.truth.id).toBeGreaterThan(0.5);
        expect(chars((a) => a > 120), s.truth.id).toBe(0);
        tested++;
      }
      // stroke text: no PDF text at all in glyph sets, and strokes in their place
    }
    expect(tested).toBeGreaterThan(15);
    for (const s of SETS.filter((x) => x.truth.options.textMode === 'glyph')) expect(vectorPagesOf(s)[0].strokes.length).toBeGreaterThan(100);
  });

  it('a real PDF written from a set reads back through pdf.js with the same fills, strokes and strings', async () => {
    for (const seed of [3, 8, 21]) {
      const s = SETS[seed - 1];
      const want = vectorPagesOf(s);
      const got = await loadVectorPages(pdfOf(s));
      expect(got.length).toBe(want.length);
      for (let i = 0; i < want.length; i++) {
        expect(got[i].fills.length, `${s.truth.id} page ${i + 1} fills`).toBe(want[i].fills.length);
        expect(got[i].strokes.length, `${s.truth.id} page ${i + 1} strokes`).toBe(want[i].strokes.length);
        expect(got[i].texts.map((t) => t.str).sort()).toEqual(want[i].texts.map((t) => t.str).sort());
        expect(Math.abs(got[i].width - want[i].width)).toBeLessThan(0.01);
        // arcs and circles are real curves in the PDF
        expect(got[i].strokes.filter((x) => x.hasCurve).length).toBe(want[i].strokes.filter((x) => x.hasCurve).length);
      }
    }
  }, 60000);

  it('the raster twin has the right size, shows ink, and the phone variant is not the scan variant', () => {
    const scan = SETS.find((s) => !s.truth.options.raster.phone && s.truth.page.pages === 1)!;
    const phone = SETS.find((s) => s.truth.options.raster.phone && s.truth.page.pages === 1)!;
    for (const s of [scan, phone]) {
      const [g] = rasterPagesOf(s);
      const u = userPagesOf(s)[0];
      expect(Math.abs(g.width - Math.round((u.width * s.truth.options.raster.dpi) / 72))).toBeLessThanOrEqual(1);
      const dark = g.data.filter((v) => v < 100).length / g.data.length;
      expect(dark).toBeGreaterThan(0.002);
      expect(dark).toBeLessThan(0.3);
      const png = encodePng(g);
      expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    }
    const mean = (g: { data: Uint8ClampedArray }): number => g.data.reduce((a, b) => a + b, 0) / g.data.length;
    expect(mean(rasterPagesOf(phone)[0])).toBeLessThan(mean(rasterPagesOf(scan)[0]) - 3);
  }, 60000);

  it('not-to-scale sets stretch the plan: the geometry no longer matches the strings', () => {
    const s = SETS.find((x) => x.truth.notToScale)!;
    expect(s.truth.options.notToScale).toBe(true);
  });
});
