// One seed through the broker upload job (scripts/make-sample-homes.ts readSet): truth vs what the reader made, room by room.
//   tsx scripts/eval/probe-seed.ts 164 [--warn]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSet } from '../make-sample-homes';
import { validateLayout } from '../../src/core/layout-validate';
import { polygonArea } from '../../src/core/geometry';

const seed = Number(process.argv[2]);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-probe-'));
try {
  const r = await readSet(seed, `probe-${seed}`, scratch);
  const o = r.truth.options;
  const rooms = r.property.layout.rooms;
  console.log(`seed ${seed} ${o.template} wall=${o.wallStyle} text=${o.textMode} units=${o.units} labels=${o.labelStyle} font=${o.font} rot=${o.rotation} truth rooms ${r.truth.rooms.length}, found ${rooms.length}, openings ${r.property.layout.openings.length}/${r.truth.openings.length}`);
  console.log('TRUTH'); for (const t of r.truth.rooms) console.log(`  ${t.id.padEnd(11)} ${String(t.labelString).padEnd(18)} ${String(t.dimsString).padEnd(14)} ${t.areaM2.toFixed(1)} ${t.roomType} ${JSON.stringify(t.polygonM.map((p) => p.map((v) => +v.toFixed(1))))}`);
  console.log('FOUND'); for (const f of rooms) console.log(`  ${f.id.padEnd(14)} "${f.label}" ${f.roomType} ${Math.abs(polygonArea(f.polygon)).toFixed(1)} m2 ${f.partial ? 'PARTIAL ' : ''}${JSON.stringify(f.polygon.map((p) => [+p.x.toFixed(1), +p.z.toFixed(1)]))}`);
  console.log('ERRORS', validateLayout(r.property.layout).errors);
  if (process.argv.includes('--warn')) console.log(r.warnings.join('\n'));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
