// C12f acceptance (SPEC 17.14): no Gemini key and no key-reading code in the built client bundle.
// Usage: WALKTHRU_GEMINI_KEY=sentinel-... npx vite build && node scripts/check-photo-bundle.mjs [dist-dir]
// Greps every file under dist/ for the key (when the environment holds one), the env name, the key file, the Gemini host and the
// key header. Exits 1 and lists the files when any of them is there.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
if (!fs.existsSync(dist)) { console.error(`no ${dist}: run "npx vite build" first`); process.exit(2); }

const needles = ['WALKTHRU_GEMINI_KEY', 'WALKTHRU_PHOTO_ENABLED', 'WALKTHRU_PHOTO_FAKE', '.gemini-key', 'walkthru-tools', 'generativelanguage.googleapis.com', 'x-goog-api-key', 'readDevKey'];
const key = process.env.WALKTHRU_GEMINI_KEY;
if (key && key.length >= 8) needles.push(key);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const hits = [];
let files = 0;
// the code is dist/*.html and dist/assets/**; scene data copied from public/ is content (one scene report names a tools folder)
const DATA = /^(scenes|characters|look)\//;
for (const f of walk(dist)) {
  if (DATA.test(path.relative(dist, f))) continue;
  if (!/\.(js|mjs|css|html|json|map|txt)$/.test(f)) continue;
  files++;
  const text = fs.readFileSync(f, 'latin1');
  for (const n of needles) if (text.includes(n)) hits.push(`${path.relative(dist, f)} contains ${n === key ? '[the key]' : JSON.stringify(n)}`);
}
// the client side of the feature must really be in the bundle, or this check proves nothing
let hasClient = false;
for (const f of walk(dist)) if (/\.js$/.test(f) && fs.readFileSync(f, 'latin1').includes('Could not make a faithful photo of this view.')) hasClient = true;

if (!hasClient) { console.error('FAIL: the AI photo client code is not in dist/ (wrong dist, or the feature is not built in)'); process.exit(2); }
if (hits.length) { console.error(`FAIL: ${hits.length} hit(s) in ${files} files\n${hits.join('\n')}`); process.exit(1); }
console.log(`OK: ${files} files in ${dist} checked, none contains a key, a key reader, the Gemini host or the key header${key ? ' (and the sentinel key is absent)' : ''}.`);
