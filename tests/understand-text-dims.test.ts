// C12b end to end (SPEC 17.12 items 4 to 8, the part C12b owns): the importer reads stroke text, the dimension stage finds, fits
// and judges the strings, and the statuses keep the honesty bar. Always runs on a representative subset of the 24 fixed sets;
// `npm run eval:understand -- --synthetic 24 --pipeline c12b` scores all of them and `--synthetic 300` the sweep.
import { describe, expect, it } from 'vitest';
import { buildSet as evalSet } from '../scripts/eval/synthetic';
import { c12bPipeline, c8Pipeline } from '../scripts/eval/adapters';
import { scoreSet } from '../scripts/eval/score';
import { proposeFromPages } from '../src/import/propose';
import { isFact } from '../src/understand/types';

const SEEDS = [1, 2, 4, 6, 9, 11, 15, 20, 22];
const runs = SEEDS.map(async (seed) => {
  const e = evalSet(seed).set;
  const pages = await e.vector!();
  return { seed, e, pages, c12b: await c12bPipeline({ kind: 'vector', id: e.id, pages }), c8: await c8Pipeline({ kind: 'vector', id: e.id, pages }) };
});

describe('statuses keep the honesty bar', () => {
  it('no value is verified wrongly across the subset, planted wrong strings are never verified, and a good share of the reads are', async () => {
    let n = 0, wrong = 0, verifiedDims = 0, read = 0, planted = 0, plantedVerified = 0;
    for (const r of await Promise.all(runs)) {
      const sc = scoreSet(r.c12b, r.e.truth);
      n += sc.verified.n; wrong += sc.verified.wrong;
      verifiedDims += (r.c12b.dimensions ?? []).filter((d) => isFact(d.status)).length;
      read += sc.fields.dimStrings.right;
      const t = r.e.truth.dimensions ?? [];
      planted += t.filter((d) => d.planted).length;
      for (const d of r.c12b.dimensions ?? []) if (isFact(d.status) && t.some((x) => x.planted && x.string === d.string && !t.some((y) => !y.planted && y.string === d.string))) plantedVerified++;
    }
    expect(n).toBeGreaterThan(60);
    expect(wrong / n, `${wrong} wrong of ${n}`).toBeLessThanOrEqual(0.005);
    expect(plantedVerified).toBe(0);
    expect(planted).toBeGreaterThan(0);
    expect(verifiedDims / read).toBeGreaterThan(0.5);
  }, 120000);
  it('no unverified or conflicting dimension is ever reported as a fact', async () => {
    for (const r of await Promise.all(runs)) for (const d of r.c12b.dimensions ?? []) if (d.status === 'conflict' || d.status === 'unverified') expect(isFact(d.status)).toBe(false);
  }, 120000);
});

describe('the importer reads what C8 could not', () => {
  it('a plan lettered in strokes gives rooms (C8 alone finds none), and a plan with real text is unchanged', async () => {
    const all = await Promise.all(runs);
    const strokeSet = all.find((r) => r.seed === 2)!;
    expect((strokeSet.c8.rooms ?? []).length).toBe(0);
    expect((strokeSet.c12b.rooms ?? []).length).toBeGreaterThanOrEqual(4);
    const realSet = all.find((r) => r.seed === 22)!;
    expect((realSet.c12b.rooms ?? []).length).toBe((realSet.c8.rooms ?? []).length);
  }, 120000);
  it('the dimension lines give the importer an independent scale, and proposeFromPages can switch the whole stage off', async () => {
    const r = (await Promise.all(runs)).find((x) => x.seed === 6)!;
    const on = proposeFromPages(r.pages, 'x', 'y');
    const off = proposeFromPages(r.pages, 'x', 'y', { understandText: false });
    expect(Math.abs(on.extras.scale.ptPerM / (r.e.truth as unknown as { planPtPerM: number }).planPtPerM - 1)).toBeLessThan(0.01);
    expect(off.extras.scale.votes.some((v) => v.source === 'dimension lines')).toBe(false);
    expect(on.extras.scale.votes.some((v) => v.source === 'dimension lines')).toBe(true);
  }, 120000);
  it('rooms are verified only through a label checked against the dimension-fitted scale, never from the label alone', async () => {
    const r = (await Promise.all(runs)).find((x) => x.seed === 6)!;
    const verifiedRooms = (r.c12b.rooms ?? []).filter((x) => x.status === 'verified');
    expect(verifiedRooms.length).toBeGreaterThan(0);
    for (const c of (await Promise.all(runs))) for (const room of c.c8.rooms ?? []) expect(room.status).toBe('unverified'); // C8 alone says nothing it can back
  }, 120000);
});
