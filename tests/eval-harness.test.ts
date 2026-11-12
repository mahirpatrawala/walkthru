// C12a scoring harness (SPEC 17.11): scored on the 24 fixed synthetic sets, plus tests of the harness itself with an oracle
// and a lying pipeline. Always runs; no real file. The C8 numbers below are regression guards for the importer as it stands.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXED_SEEDS, buildSet, pdfOf } from '../scripts/make-drawing-sets';
import { buildSet as evalSet } from '../scripts/eval/synthetic';
import type { EvalSet } from '../scripts/eval/run';
import { formatReport, loadFolder, merged, runEval, wrongVerified } from '../scripts/eval/run';
import { c8Pipeline, oraclePipeline } from '../scripts/eval/adapters';
import type { Pipeline } from '../scripts/eval/adapters';
import { alignRooms, newScore, scoreSet, summarise } from '../scripts/eval/score';
import type { Prediction, TruthLite } from '../scripts/eval/types';

const SETS: EvalSet[] = FIXED_SEEDS.map((s) => evalSet(s).set);
const truths = new Map(SETS.map((s) => [s.id, s.truth]));
const truthOf = (id: string): TruthLite => truths.get(id)!;
const rate = (rep: Awaited<ReturnType<typeof runEval>>, variant: 'vector' | 'raster', key: string): number | null =>
  summarise(merged(rep.cells, (c) => c.variant === variant), variant).find((r) => r.key === key)!.rate;

describe('the harness on a perfect pipeline', () => {
  it('scores every field at 100% and finds no wrong verified value; planted strings are surfaced', async () => {
    const rep = await runEval(SETS, oraclePipeline(truthOf));
    const rows = summarise(merged(rep.cells, (c) => c.variant === 'vector'), 'vector');
    for (const r of rows) {
      if (r.key === 'wrongVerified') { expect(r.rate).toBe(0); continue; }
      if (r.key === 'brokerShare') { expect(r.rate!).toBeLessThan(0.1); continue; }
      expect(r.rate, r.key).toBe(1);
      expect(r.pass, r.key).toBe(true);
    }
    expect(wrongVerified(rep).n).toBeGreaterThan(1000);
    expect(wrongVerified(rep).wrong).toBe(0);
  }, 120000);
});

describe('the honesty metric catches a lying pipeline', () => {
  it('a pipeline that marks planted wrong strings verified breaks the 0.5% bar and surfaces none', async () => {
    const oracle = oraclePipeline(truthOf);
    const liar: Pipeline = async (i) => {
      const p = (await oracle(i)) as Prediction;
      return { ...p, dimensions: p.dimensions!.map((d) => ({ ...d, status: 'verified' as const })) };
    };
    const rep = await runEval(SETS, liar);
    const wv = wrongVerified(rep);
    expect(wv.wrong).toBeGreaterThan(10);
    expect(wv.rate!).toBeGreaterThan(0.005);
    expect(rate(rep, 'vector', 'conflicts')).toBe(0);
  }, 120000);
  it('a pipeline that reads a wrong number off a room and calls it verified is counted', () => {
    const t = SETS.find((s) => s.truth.rooms!.length > 2)!.truth;
    const rooms = t.rooms!.map((r, i) => ({ label: r.id, roomType: r.roomType, polygon: (i === 0 ? r.polygonM.map(([x, z]): [number, number] => [x * 1.2, z * 1.2]) : r.polygonM), status: 'verified' as const }));
    const sc = scoreSet({ attempted: true, rooms }, t);
    expect(sc.verified.wrong).toBeGreaterThanOrEqual(1);
  });
  it('unverified values are never counted as wrong-verified, and an unattempted field is listed as such', () => {
    const t = SETS[1].truth;
    const sc = scoreSet({ attempted: true, rooms: t.rooms!.map((r) => ({ label: '', roomType: 'other', polygon: r.polygonM.map(([x, z]): [number, number] => [x * 2, z * 2]), status: 'unverified' as const })) }, t);
    expect(sc.verified.n).toBe(0);
    expect(sc.notAttempted).toContain('dimStrings');
  });
});

describe('frame alignment', () => {
  it('recovers a quarter turn and a shift', () => {
    const t = SETS[8].truth.rooms!;
    const turned = t.map((r) => ({ polygon: r.polygonM.map(([x, z]): [number, number] => [-z + 7, x - 3]), roomType: r.roomType }));
    const a = alignRooms(turned, t.map((r) => ({ polygonM: r.polygonM, roomType: r.roomType })))!;
    expect(a.inliers).toBe(t.length);
    expect(a.rot).toBe(270);
  });
});

describe('the C8 importer through the harness on the 24 sets (baseline, SPEC 17.11 bars not met)', () => {
  it('runs, claims nothing as verified, refuses every raster twin, and keeps its baseline', async () => {
    const rep = await runEval(SETS, c8Pipeline);
    // honest: C8 has no statuses, so nothing is verified and the honesty bar is met only vacuously
    const wv = wrongVerified(rep);
    expect(wv.n).toBe(0);
    expect(wv.rate).toBeNull();
    // raster input is refused with the C8 message, on every set
    const raster = rep.perSet.filter((p) => p.variant === 'raster');
    expect(raster.length).toBe(24);
    expect(raster.every((p) => !p.attempted && /raster-plan/.test(p.error ?? ''))).toBe(true);
    // vector: guards for what it does today (any drop is a regression)
    const rows = summarise(merged(rep.cells, (c) => c.variant === 'vector'), 'vector');
    const get = (k: string) => rows.find((r) => r.key === k)!;
    const tally = merged(rep.cells, (c) => c.variant === 'vector').fields;
    expect(tally.rooms.tp).toBeGreaterThanOrEqual(58);
    expect(tally.roomSize.right).toBeGreaterThanOrEqual(52);
    expect(tally.openings.tp).toBeGreaterThanOrEqual(84);
    expect(tally.furniture.tp).toBeGreaterThanOrEqual(25);
    // what it cannot do yet (C12b to C12d): these stay at zero until those chunks land
    for (const k of ['dimStrings', 'fixtures', 'elevLink', 'unitBays', 'hinge', 'conflicts']) expect(get(k).rate, k).toBe(0);
    // and no bar is met except by luck: the report says so
    expect(rows.filter((r) => r.pass === true && r.key !== 'wrongVerified').length).toBe(0);
    const text = formatReport(rep, 'baseline');
    expect(text).toContain('BELOW BAR');
    expect(text).toContain('Refusals and errors');
    expect(text).toContain('raster-plan');
    // the split is reported on both sides
    expect(rep.cells.some((c) => c.split === 'dev')).toBe(true);
    expect(rep.cells.some((c) => c.split === 'held-out')).toBe(true);
  }, 120000);
});

describe('a folder of sets outside the repo', () => {
  it('loads drawing.pdf + truth.json + meta.json, runs the pipeline and scores it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-eval-'));
    try {
      const ids = [4, 6];
      for (const seed of ids) {
        const b = buildSet(seed);
        const d = path.join(dir, `set-${seed}`);
        fs.mkdirSync(d);
        fs.writeFileSync(path.join(d, 'drawing.pdf'), pdfOf(b));
        fs.writeFileSync(path.join(d, 'truth.json'), JSON.stringify(b.truth));
        fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ split: seed === 4 ? 'dev' : 'held-out', firm: `f${seed}` }));
      }
      fs.mkdirSync(path.join(dir, 'no-drawing'));
      const sets = await loadFolder(dir);
      expect(sets.map((s) => s.id)).toEqual(['set-4', 'set-6']);
      expect(sets.map((s) => s.split)).toEqual(['dev', 'held-out']);
      const rep = await runEval(sets, c8Pipeline);
      expect(rep.perSet.every((p) => p.attempted)).toBe(true);
      expect(merged(rep.cells, () => true).fields.rooms.tp).toBeGreaterThan(10);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120000);
  it('a missing folder is no sets, and a set with no truth is run without crashing', async () => {
    expect(await loadFolder(path.join(os.tmpdir(), 'walkthru-no-such-folder'))).toEqual([]);
    const t = newScore();
    expect(Object.values(t.fields).every((f) => f.expected === 0)).toBe(true);
    const sc = scoreSet({ attempted: true, rooms: [] }, {});
    expect(sc.fields.rooms.expected).toBe(0);
  });
});
