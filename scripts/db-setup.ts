// SPEC 22.3: `npm run db:setup`. Creates the inventory tables (db/schema.sql: every statement is IF NOT EXISTS, so running it again changes nothing) and seeds
// each SAMPLE building that has units with deterministic made-up statuses and `demo = true`. Rows that already exist are never overwritten (an owner's edits
// stay), and the demo flag is only ever turned ON here. Prints row counts; never prints the connection string.
//
// The connection comes from DATABASE_URL_UNPOOLED (else DATABASE_URL) in the environment or in .env.local (`npx -y vercel@latest env pull .env.local`;
// .env* is gitignored). Run it from the repo root.
import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { generateUnits } from '../src/building/units';
import { seedStatuses } from '../src/inventory/seed';
import { splitSql } from '../src/inventory/server/sql';
import { unitIdsOf } from '../src/inventory/server/units-file';

const ROOT = path.resolve(import.meta.dirname, '..');
for (const f of ['.env.local', '.env']) { const p = path.join(ROOT, f); if (fs.existsSync(p)) { try { process.loadEnvFile(p); } catch { /* an unreadable env file: the check below says what is missing */ } } }

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('No DATABASE_URL_UNPOOLED or DATABASE_URL: run `npx -y vercel@latest env pull .env.local` first (the file is gitignored).');
  process.exit(1);
}
const sql = neon(url);
const q = (text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => sql.query(text, params) as Promise<Record<string, unknown>[]>;

const statements = splitSql(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));
for (const s of statements) await q(s);
console.log(`schema: ${statements.length} statements applied (db/schema.sql)`);

const dir = path.join(ROOT, 'public', 'buildings');
let seeded = 0;
for (const id of fs.readdirSync(dir).sort()) {
  const file = path.join(dir, id, 'building.json');
  if (!fs.existsSync(file)) continue;
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { sample?: boolean; units?: Parameters<typeof generateUnits>[0] };
  if (json.sample !== true || !json.units || !unitIdsOf(json)) continue;
  const rows = seedStatuses(id, generateUnits(json.units));
  // one statement for the whole building: unnest the ids and statuses; a unit that already has a status keeps it
  const res = await q(
    'INSERT INTO units (building_id, unit_id, status, updated_at) SELECT $1::text, u, s, now() FROM unnest($2::text[], $3::text[]) AS t(u, s) ON CONFLICT (building_id, unit_id) DO NOTHING RETURNING unit_id',
    [id, rows.map((r) => r.unitId), rows.map((r) => r.status)],
  );
  await q('INSERT INTO building_settings (building_id, vastu_enabled, demo, updated_at) VALUES ($1, false, true, now()) ON CONFLICT (building_id) DO UPDATE SET demo = true', [id]);
  console.log(`seed ${id}: ${res.length} new of ${rows.length} units`);
  seeded++;
}
if (!seeded) console.log('seed: no sample building with units found');

for (const t of ['units', 'building_settings', 'units_log']) {
  const n = await q(`SELECT count(*)::int AS n FROM ${t}`);
  console.log(`${t}: ${n[0].n} rows`);
}
const by = await q('SELECT building_id, status, count(*)::int AS n FROM units GROUP BY building_id, status ORDER BY building_id, status');
for (const r of by) console.log(`  ${String(r.building_id)} ${String(r.status)}: ${String(r.n)}`);
