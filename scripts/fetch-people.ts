// SPEC 16.6.2. The person bodies are built by tools/make_family.py (MPFB2 in headless Blender) and committed under
// public/characters/. This script checks that what is on disk is what public/characters/people.lock.json says, so a broken
// checkout or a stray edit is caught before it ships:   npx tsx scripts/fetch-people.ts
//
// Route B (a fallback for the man only) would be the oil-paint starter man: clone https://git.patch.gg/blendi/oil-paint.git at
// 804c65fa3a6c6fcdc732ed1bde450fd140cfb4e9, `git lfs pull`, and check public/figure/starter-man.glb has SHA-256
// 450089ce3fd70c1a30e775cb1454a987cbaf3ff71ca53cf8581e74f9163e637e. It is not needed while route A files are present.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../public/characters');
const lock = JSON.parse(fs.readFileSync(path.join(DIR, 'people.lock.json'), 'utf8')) as { files: Record<string, { bytes: number; sha256: string }> };
let bad = 0;
for (const [name, want] of Object.entries(lock.files)) {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) { console.error(`MISSING  ${name}`); bad++; continue; }
  const buf = fs.readFileSync(p);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const ok = buf.length === want.bytes && sha === want.sha256;
  console.log(`${ok ? 'ok      ' : 'MISMATCH'} ${name} ${buf.length} bytes`);
  if (!ok) bad++;
}
if (bad > 0) { console.error(`${bad} file(s) differ from people.lock.json. Rebuild with tools/make_family.py and tools/optimise-people.mjs, then refresh the lock.`); process.exit(1); }
