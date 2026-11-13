// C12c: elevation linking, reading, reconciling and the files they feed, on the synthetic drawing sets (SPEC 17.12 items 7, 9, 10, 11).
// No real drawing and no network: every set is drawn by scripts/drawing-sets from its seed, with its truth beside it.
import { describe, expect, it } from 'vitest';
import { buildSet, vectorPagesOf } from '../scripts/make-drawing-sets';
import { understandPages } from '../src/understand/pipeline';
import { understandVector } from '../src/understand/vector-adapter';
import { applyReview } from '../src/understand/review-apply';
import { emptyReview } from '../src/understand/review-model';
import { predictionOf } from '../scripts/eval/adapters';
import { scoreSet } from '../scripts/eval/score';
import { summarise } from '../scripts/eval/score';
import type { TruthLite } from '../scripts/eval/types';
import { captionOf } from '../src/understand/lexicon';
import { parseDesigns } from '../src/look/designs';
import type { OpenableDesign } from '../src/look/designs';
import { intrusionM, specFromDesign, swingNeedCm } from '../src/buyer/wardrobe-swing';
import type { FurnitureItem } from '../src/types';
import { ceilingTrustFromExtras } from '../src/core/room-trust';

const WITH_ELEVATIONS = [1, 4, 7, 8, 9, 10, 12, 13, 14, 16, 18, 19, 20, 23, 24];

describe('captions', () => {
  it('reads the tag after a caption word, in every style the sets use, and tells an internal view from its parent', () => {
    expect(captionOf('ELEVATION-3')).toMatchObject({ tag: '3', internal: false });
    expect(captionOf('ELEV. B')).toMatchObject({ tag: 'B' });
    expect(captionOf('Wall 4A (INTERNAL)')).toMatchObject({ tag: '4A', parentTag: '4', internal: true });
    expect(captionOf('Elevation-aa (internal)')).toMatchObject({ tag: 'AA', parentTag: 'A', internal: true });
    expect(captionOf('MASTER BEDROOM')).toBeNull();
  });
});

describe('elevations over the 24 synthetic sets', () => {
  const total = new Map<string, { right: number; expected: number }>();
  let wrong = 0, verified = 0;
  it('links, heights, units, hinges and the honesty metric meet the bars of SPEC 17.11', () => {
    for (const seed of WITH_ELEVATIONS) {
      const b = buildSet(seed);
      const u = understandPages(vectorPagesOf(b), 'x', 'y');
      const sc = scoreSet(predictionOf(u, 0), b.truth as unknown as TruthLite);
      for (const k of ['elevLink', 'heights', 'unitBays', 'hinge', 'unitParts']) {
        const t = total.get(k) ?? { right: 0, expected: 0 };
        t.right += sc.fields[k].right; t.expected += sc.fields[k].expected; total.set(k, t);
      }
      wrong += sc.verified.wrong; verified += sc.verified.n;
    }
    const rate = (k: string): number => total.get(k)!.right / total.get(k)!.expected;
    expect(rate('elevLink')).toBeGreaterThanOrEqual(0.9);
    expect(rate('heights')).toBeGreaterThanOrEqual(0.9);
    expect(rate('unitBays')).toBeGreaterThanOrEqual(0.85);
    expect(rate('hinge')).toBeGreaterThanOrEqual(0.85);
    expect(rate('unitParts')).toBeGreaterThanOrEqual(0.85);
    // the honesty bar outranks every other
    expect(verified).toBeGreaterThan(50);
    expect(wrong / verified).toBeLessThanOrEqual(0.005);
    void summarise;
  }, 240_000);
});

describe('hinge side from the handle and the opening mark', () => {
  const read = (signals: 'both' | 'handle' | 'mark' | 'neither' | 'disagree', shutters: number) => {
    const b = buildSet(23, { unitPin: { bays: 3, shutters, signals }, plantWrong: 0, roundShare: 0 });
    const u = understandPages(vectorPagesOf(b), 'x', 'y');
    const unit = u.elev.reads.flatMap((r) => r.units)[0];
    const truth = b.truth.elevations.flatMap((e) => e.units)[0];
    return { unit, truth };
  };
  it('right where a handle or a mark is drawn, verified only when both agree', () => {
    for (const shutters of [1, 2]) {
      const both = read('both', shutters);
      both.unit.design.hinge.forEach((h, i) => { expect(h.value).toBe(both.truth.hinge[i]); expect(h.status).toBe('verified'); });
      for (const one of ['handle', 'mark'] as const) {
        const r = read(one, shutters);
        r.unit.design.hinge.forEach((h, i) => { expect(h.value).toBe(r.truth.hinge[i]); expect(h.status).toBe('unverified'); });
      }
    }
  }, 60_000);
  it('unknown when neither is drawn, conflict when they disagree', () => {
    const none = read('neither', 2);
    none.unit.design.hinge.forEach((h) => { expect(h.value).toBe('unknown'); expect(h.status).not.toBe('verified'); });
    const dis = read('disagree', 2);
    dis.unit.design.hinge.forEach((h) => { expect(h.status).toBe('conflict'); expect((h.alternatives ?? []).length).toBeGreaterThanOrEqual(2); });
  }, 60_000);
});

describe('designs.json from a three-bay wardrobe (SPEC 17.12 item 11)', () => {
  for (const seed of [18, 23]) {
    it(`set ${seed}: loads through parseDesigns, drives the open-wardrobe code, and the swing equals the truth within 1 cm`, () => {
      const b = buildSet(seed, { unitPin: { bays: 3, shutters: 2, signals: 'both' }, plantWrong: 0, roundShare: 0, chains: true });
      const truth = b.truth.elevations.flatMap((e) => e.units)[0];
      const run = understandVector(vectorPagesOf(b), { sceneId: 'test-elev', sha256: 'x' });
      const applied = applyReview(run.base, run.doc, emptyReview());
      const designs = parseDesigns(JSON.parse(JSON.stringify(applied.designs)))!;
      expect(designs).not.toBeNull();
      const entry = Object.entries(designs.items).find(([, d]) => d.openable);
      expect(entry).toBeTruthy();
      const [id, d] = entry!;
      expect(d.wardrobe!.bays).toBe(3);
      expect(d.wardrobe!.shuttersPerBay).toBe(2);
      const item = applied.extras.furniture.find((f) => f.id === id) as FurnitureItem;
      const spec = specFromDesign(item, d.openable!);
      expect(spec.shutters).toHaveLength(6);
      // the truth's own spec, from the drawn bay widths
      const widths = truth.bayWidthsM;
      const pitch = widths.reduce((a, c) => a + c, 0) / widths.length;
      let x = Math.max(0, (item.box.w - widths.reduce((a, c) => a + c, 0)) / 2);
      const centres = widths.map((w) => { const c = x + w / 2; x += w; return c; });
      const truthOpen: OpenableDesign = { bayPitchM: pitch, shutterWidthM: Math.max(...widths) / 2, bayCentresFromLeftM: centres, maxAngleDeg: 90, gaps: [], conflicts: [], notInDrawing: [] };
      const truthSpec = specFromDesign(item, truthOpen);
      spec.shutters.forEach((s, i) => {
        expect(Math.abs(intrusionM(s) - intrusionM(truthSpec.shutters[i]))).toBeLessThan(0.01);
        expect(Math.abs(s.hingeU - truthSpec.shutters[i].hingeU)).toBeLessThan(0.01);
      });
      // an obstacle across the wardrobe's front: the clearance the card quotes
      const front = { cx: item.box.cx + Math.sin((item.box.yawDeg * Math.PI) / 180) * (item.box.d / 2 + 0.25), cz: item.box.cz + Math.cos((item.box.yawDeg * Math.PI) / 180) * (item.box.d / 2 + 0.25), w: item.box.w, d: 0.3, yawDeg: item.box.yawDeg };
      const a = swingNeedCm(spec, item.box, front), t = swingNeedCm(truthSpec, item.box, front);
      expect(a).not.toBeNull();
      expect(Math.abs((a ?? 0) - (t ?? 0))).toBeLessThanOrEqual(1);
    }, 60_000);
  }
});

describe('nothing unverified lands in designs.json as a fact (SPEC 17.12 item 7)', () => {
  it('a unit whose hinge is unknown, in conflict or only half-drawn does not open; no value of it is written unless it is a fact', () => {
    for (const signals of ['neither', 'disagree', 'handle'] as const) {
      const b = buildSet(23, { unitPin: { bays: 3, shutters: 2, signals }, plantWrong: 0, roundShare: 0, chains: true });
      const run = understandVector(vectorPagesOf(b), { sceneId: 'test-elev', sha256: 'x' });
      const applied = applyReview(run.base, run.doc, emptyReview());
      for (const d of Object.values(applied.designs.items)) expect(d.openable).toBeUndefined();
      // every wardrobe value written has a source that names where it was read
      for (const [id, d] of Object.entries(applied.designs.items)) if (d.wardrobe) expect(d.sources?.bays, id).toBeTruthy();
    }
  }, 120_000);
  it('a planted wrong string ends as a conflict and its value is not written', () => {
    for (const seed of [1, 4, 9]) {
      const b = buildSet(seed);
      const u = understandPages(vectorPagesOf(b), 'x', 'y');
      for (const d of u.analysis.dims) expect(d.status === 'verified' && b.truth.dimensions.some((t) => t.planted && t.string === d.string && t.view !== 'plan' && Math.abs(t.shownM - t.valueM) > 0.0635)).toBe(false);
    }
  }, 120_000);
});

describe('the ceiling carries its source (and a guessed one is never printed as fact)', () => {
  it('a printed ceiling that agrees with the elevation is verified, with its sheet and page', () => {
    const b = buildSet(23, { plantWrong: 0, roundShare: 0, chains: true });
    const run = understandVector(vectorPagesOf(b), { sceneId: 'test-elev', sha256: 'x' });
    const a = applyReview(run.base, run.doc, emptyReview());
    expect(a.extras.ceiling.verified).toBe(true);
    expect(a.extras.ceiling.heightM).toBeCloseTo(b.truth.ceilingM, 2);
    expect(a.extras.ceiling.source?.page).toBeGreaterThan(0);
    expect(ceilingTrustFromExtras(JSON.parse(JSON.stringify(a.extras))).known).toBe(true);
  }, 60_000);
  it('a ceiling no printed dimension checked is unverified, so the buyer verdict leaves the number out', () => {
    const extras = { ceiling: { heightM: 2.68, method: 'geometry', confidence: 0.5 } };
    expect(ceilingTrustFromExtras(extras).known).toBe(false);
    expect(ceilingTrustFromExtras({ ceiling: { heightM: 2.6, verified: true } }).known).toBe(true);
    expect(ceilingTrustFromExtras({ ceiling: { heightM: 2.6, provenance: 'confirmed by broker' } }).known).toBe(true);
    expect(ceilingTrustFromExtras(null).known).toBe(true);
  });
  it('the too-tall verdict says the ceiling is not confirmed instead of quoting it', async () => {
    const { placementMessage } = await import('../src/core/placement');
    const spec = { name: 'Wardrobe', sideWords: { front: 'in front', left: 'to the left', right: 'to the right', back: 'behind' } } as never;
    const partial = { verdict: 'blocked', reason: 'too-tall', clearanceM: { front: 1, left: 1, right: 1, back: 0 }, tone: 'bad' } as never;
    expect(placementMessage(spec, partial, 2.59, true)).toContain('2.59');
    const said = placementMessage(spec, partial, 2.59, false);
    expect(said).not.toContain('2.59');
    expect(said).toMatch(/not confirmed/);
  });
});
