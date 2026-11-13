// C12d: the 24 raster twins through the whole raster path with the simulated vision model (SPEC 17.12 item 8, raster half).
// No network, no key. Prints the table; asserts what the chunk can defend: the honesty bar under every kind of model, and the fields
// the path reads well. Fields that miss their SPEC 17.11 bar are listed in the build report, not hidden by a loose assertion.
import { describe, expect, it } from 'vitest';
import { buildTwins, costSummary, evalRate } from '../scripts/eval-raster';
import { errorsAtRate } from '../src/understand/vision/mock';
import { merged } from '../scripts/eval/run';
import { summarise } from '../scripts/eval/score';
import type { EvalReport } from '../scripts/eval/run';

const field = (rep: unknown, key: string): { rate: number | null; detail: string } => {
  const r = summarise(merged((rep as EvalReport).cells, () => true), 'raster').find((x) => x.key === key)!;
  return { rate: r.rate, detail: r.detail };
};

describe('24 raster twins, simulated model', () => {
  it('an exact model: every room, opening, fixture and dimension string comes through, and nothing wrong is verified', async () => {
    const { twins, sets } = buildTwins(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(sets).toHaveLength(24);
    const exact = await evalRate(twins, sets, 'exact model', errorsAtRate(0));
    console.log(exact.report);
    expect(exact.runs.filter((r) => r.run.status !== 'ok')).toHaveLength(0);
    for (const k of ['rooms', 'openings', 'furniture', 'fixtures', 'dimStrings']) expect(field(exact.json, k).rate!, k).toBeGreaterThanOrEqual(0.9);
    for (const k of ['roomSize', 'roomArea']) expect(field(exact.json, k).rate!, k).toBeGreaterThanOrEqual(0.7);
    expect(field(exact.json, 'openingWidth').rate!).toBeGreaterThanOrEqual(0.6);
    expect(exact.verified).toBeGreaterThan(80);
    expect(exact.wrong / exact.verified).toBeLessThanOrEqual(0.005);
    const c = costSummary(exact.runs);
    console.log(`cost per set: ${c.calls.toFixed(1)} calls, $${c.usd.toFixed(3)}, ${c.seconds.toFixed(0)} s on the wire`);
    expect(c.usd).toBeGreaterThan(0.03); expect(c.usd).toBeLessThan(0.3);

    // a model that is right nine times in ten, and the honesty bar still holds
    const noisy = await evalRate(twins, sets, 'error rate 0.1', errorsAtRate(0.1, 11));
    console.log(noisy.report);
    expect(noisy.wrong / Math.max(1, noisy.verified)).toBeLessThanOrEqual(0.005);
    expect(field(noisy.json, 'rooms').rate!).toBeGreaterThanOrEqual(0.7);

    // a model that lies: same wrong digits every time, every number scaled up a quarter
    const liar = await evalRate(twins, sets, 'consistent lie', { ...errorsAtRate(0.1, 11), uniformScale: 1.25, consistent: true, wrongDigits: 0.2 });
    console.log(liar.report);
    expect(liar.wrong / Math.max(1, liar.verified)).toBeLessThanOrEqual(0.005);

    // a model that is wrong the same way every time, without the scaling lie
    const stubborn = await evalRate(twins, sets, 'consistent wrong digits', { ...errorsAtRate(0.2, 13), consistent: true });
    expect(stubborn.wrong / Math.max(1, stubborn.verified)).toBeLessThanOrEqual(0.005);

    // vision off: every picture refused, nothing sent, nothing spent
    const off = await evalRate(twins, sets, 'vision off', null);
    expect(off.runs.every((r) => r.run.status === 'refused' && r.run.sent.length === 0 && r.run.cost.usd === 0)).toBe(true);
  }, 600000);
});
