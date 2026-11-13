// Text reads (real text and stroke-glyph reads) on the plan page of one seed.   tsx scripts/eval/probe-reads.ts 116
import { buildSet, vectorPagesOf } from '../make-drawing-sets';
import { proposeWithTrace } from '../../src/import/propose';
const seed = Number(process.argv[2]);
const b = buildSet(seed);
const { trace } = proposeWithTrace(vectorPagesOf(b), 'x', 'probe');
console.log(b.truth.options.font, b.truth.options.textMode, b.truth.options.slantDeg, b.truth.options.widthScale);
for (const r of trace.reads[trace.planIdx]) console.log(r.method, JSON.stringify(r.str), r.confidence?.toFixed?.(2), JSON.stringify(r.bbox?.map((v: number) => +v.toFixed(0))));
