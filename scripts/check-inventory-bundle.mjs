// SPEC 22.3 acceptance: nothing the browser loads names the admin passcode variable, the database connection variables or the Postgres driver.
// Usage: npx vite build && node scripts/check-inventory-bundle.mjs [dist-dir]
// Greps every code file under dist/ (js, css, html, map). Exits 1 and lists the files when any needle is there.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
if (!fs.existsSync(dist)) { console.error(`no ${dist}: run "npx vite build" first`); process.exit(2); }
const needles = ['WALKTHRU_ADMIN_PASSCODE', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', '@neondatabase', 'neon.tech', 'WALKTHRU_INVENTORY_FAKE', 'timingSafeEqual'];
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const DATA = /^(scenes|characters|look|buildings)\//;
const hits = [];
let files = 0, hasClient = false;
for (const f of walk(dist)) {
  const rel = path.relative(dist, f);
  if (DATA.test(rel) || !/\.(js|mjs|css|html|map)$/.test(f)) continue;
  files++;
  const text = fs.readFileSync(f, 'latin1');
  if (text.includes('x-admin-passcode')) hasClient = true; // the admin page's client code is really in the build
  for (const n of needles) if (text.includes(n)) hits.push(`${rel} contains ${JSON.stringify(n)}`);
}
if (!hasClient) { console.error('FAIL: the inventory client is not in dist/ (wrong dist, or the feature is not built in)'); process.exit(2); }
if (hits.length) { console.error(`FAIL: ${hits.length} hit(s) in ${files} files\n${hits.join('\n')}`); process.exit(1); }
console.log(`OK: ${files} files in ${dist} checked, none names the passcode variable, the connection variables or the driver.`);
