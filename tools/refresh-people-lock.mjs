// Re-hashes the files listed in public/characters/people.lock.json after a rebuild (tools/make_family.py, tools/optimise-people.mjs):
//   node tools/refresh-people-lock.mjs "<one line for the lock's route field, appended>"
// scripts/fetch-people.ts then verifies the result.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../public/characters');
const file = path.join(DIR, 'people.lock.json');
const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const name of Object.keys(lock.files)) {
  const buf = fs.readFileSync(path.join(DIR, name));
  lock.files[name] = { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}
lock.version += 1;
lock.built = new Date().toISOString().slice(0, 10);
if (process.argv[2]) lock.route += '; ' + process.argv[2];
fs.writeFileSync(file, JSON.stringify(lock, null, 2) + '\n');
console.log('lock version', lock.version, Object.keys(lock.files).length, 'files');
