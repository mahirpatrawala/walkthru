// Text blocks the importer grouped on the plan of one seed, and what each parsed as.   tsx scripts/eval/probe-labels.ts 102
import { buildSet, vectorPagesOf } from '../make-drawing-sets';
import { proposeWithTrace } from '../../src/import/propose';
import { groupTextBlocks, parseBlock, splitStray } from '../../src/import/labels';
const seed = Number(process.argv[2]);
const b = buildSet(seed);
const { trace } = proposeWithTrace(vectorPagesOf(b), 'x', 'probe');
const plan = trace.plan ?? trace.pages[trace.planIdx];
console.log('truth labels:', b.truth.rooms.map((r) => r.labelString).join(' | '));
for (const blk of groupTextBlocks(plan.texts).flatMap(splitStray)) {
  const p = parseBlock(blk);
  console.log(JSON.stringify(blk.lines.map((l) => l.text)), '->', p ? `${p.kind} ${p.kind === 'room' ? p.name + ' ' + p.roomType : p.key}` : 'none');
}
