// C12b local only (SPEC 17.12 "Local only"): the text and dimension stage on the real development drawing. The PDF stays outside the repo
// (WALKTHRU_REAL_DRAWING, default ~/walkthru-tools/drawings/real-dev-1/drawing.pdf) and skips when absent. It asserts only what can be
// asserted without truth: no crash, the importer's rooms unchanged by reading text, and no dimension called a fact without a check.
// What was read is printed to the console, never written to a file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadVectorPages } from '../src/import/pdfjs-adapter';
import { proposeFromPages, proposeWithTrace } from '../src/import/propose';
import type { VectorPage } from '../src/import/types';
import { analyseTrace } from '../src/understand/text-dims';
import type { Analysis } from '../src/understand/text-dims';
import { isFact } from '../src/understand/types';

const file = process.env.WALKTHRU_REAL_DRAWING ?? path.join(os.homedir(), 'walkthru-tools', 'drawings', 'real-dev-1', 'drawing.pdf');

describe.skipIf(!fs.existsSync(file))('real development drawing: text and dimensions (local only)', () => {
  let raw: VectorPage[]; let an: Analysis; let withText: ReturnType<typeof proposeFromPages>; let without: ReturnType<typeof proposeFromPages>;
  beforeAll(async () => {
    raw = await loadVectorPages(new Uint8Array(fs.readFileSync(file)));
    const { result, trace } = proposeWithTrace(raw, 'input', 'real');
    withText = result;
    without = proposeFromPages(raw, 'input', 'real', { understandText: false });
    an = analyseTrace(result, trace);
    const glyph = trace.reads.map((r) => r.filter((x) => x.method === 'glyph').length);
    console.log(`\nreal drawing: glyph reads per page ${glyph.join(',')}; ${an.dims.length} dimension candidates, ${an.dims.filter((d) => isFact(d.status)).length} verified, ${an.dims.filter((d) => d.status === 'conflict').length} in conflict`);
    for (const d of an.dims) console.log(`  page ${d.page + 1} ${d.role} ${d.status} ${JSON.stringify(d.string)} ${d.verdict.message ?? ''}`);
  }, 120000);

  it('reading text does not change the rooms or the scale the importer finds', () => {
    expect(withText.proposal.rooms.map((r) => `${r.label}:${r.roomType}`).sort()).toEqual(without.proposal.rooms.map((r) => `${r.label}:${r.roomType}`).sort());
    expect(Math.abs(withText.extras.scale.ptPerM / without.extras.scale.ptPerM - 1)).toBeLessThan(0.005);
  });
  it('every dimension called a fact carries a check that passed and none that failed', () => {
    for (const d of an.dims.filter((x) => isFact(x.status))) {
      expect(d.verdict.checks.length).toBeGreaterThan(0);
      expect(d.verdict.checks.every((c) => c.ok)).toBe(true);
    }
  });
});
