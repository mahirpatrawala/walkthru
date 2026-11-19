// The inventory endpoint (SPEC 22.3): auth, validation, the unconfigured admin, the store (against a mocked database), the seed, the schema and the
// boundary that keeps the server code and the passcode out of the browser.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BUILDING_ID_RE as APP_BUILDING_ID_RE } from '../src/building/parse';
import { generateUnits } from '../src/building/units';
import { MAX_BODY_BYTES, BUILDING_ID_RE, createFailureThrottle, handleInventory, safeEqual } from '../src/inventory/server/handler';
import type { InventoryDeps, InventoryRequest } from '../src/inventory/server/handler';
import { SQL, memoryStore, neonStore } from '../src/inventory/server/store';
import { fileUnitsLoader, unitIdsOf } from '../src/inventory/server/units-file';
import { splitSql } from '../src/inventory/server/sql';
import { seedStatus, seedStatuses } from '../src/inventory/seed';
import type { InventoryChanged, InventoryErr, InventoryOk } from '../src/inventory/types';

const PASS = 'correct horse battery staple'; // a test value, not a real passcode
const UNITS = ['201', '202', '301', '302'];
const deps = (over: Partial<InventoryDeps> = {}): InventoryDeps => ({
  store: memoryStore({ units: { 'sample-tower': { '201': 'sold', '202': 'available' }, other: { '999': 'sold' } }, settings: { 'sample-tower': { demo: true } } }),
  passcode: PASS,
  unitsOf: async (b) => (b === 'sample-tower' ? UNITS : null),
  throttle: createFailureThrottle(),
  now: () => 1_000_000,
  ...over,
});
const get = (search: string): InventoryRequest => ({ method: 'GET', search, headers: {}, body: null });
const post = (body: unknown, headers: Record<string, string | undefined> = { 'x-admin-passcode': PASS }, search = ''): InventoryRequest => ({ method: 'POST', search, headers, body: typeof body === 'string' ? body : JSON.stringify(body), client: 'c1' });
const err = (r: { body: unknown }): InventoryErr => r.body as InventoryErr;

describe('GET', () => {
  it('answers the statuses of this building\'s units and its settings, with a short cache', async () => {
    const r = await handleInventory(get('building=sample-tower'), deps());
    expect(r.status).toBe(200);
    const b = r.body as InventoryOk;
    expect(b).toEqual({ ok: true, building: 'sample-tower', units: { '201': 'sold', '202': 'available' }, settings: { vastuEnabled: false, demo: true } });
    expect(r.headers?.['cache-control']).toMatch(/s-maxage=15/);
  });
  it('leaves out a row for a unit the building does not have', async () => {
    const d = deps({ store: memoryStore({ units: { 'sample-tower': { '201': 'sold', '777': 'sold' } } }) });
    expect(((await handleInventory(get('building=sample-tower'), d)).body as InventoryOk).units).toEqual({ '201': 'sold' });
  });
  it('refuses a missing or malformed building, and an unknown one', async () => {
    expect((await handleInventory(get(''), deps())).status).toBe(400);
    expect((await handleInventory(get('building=../etc'), deps())).status).toBe(400);
    expect((await handleInventory(get('building=UPPER'), deps())).status).toBe(400);
    const r = await handleInventory(get('building=nobody'), deps());
    expect(r.status).toBe(404); expect(err(r).error).toBe('unknown-building');
  });
  it('says so when no database is configured (the pages then show "Status unavailable")', async () => {
    const r = await handleInventory(get('building=sample-tower'), deps({ store: null }));
    expect(r.status).toBe(503); expect(err(r).error).toBe('not-configured');
    expect(r.headers?.['cache-control']).toBe('no-store');
  });
  it('a database that throws is a 500 that names no connection', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = { read: async () => { throw new Error('connect ECONNREFUSED postgres://user:secret@host/db'); }, setStatus: async () => true, setVastu: async () => {} };
    const r = await handleInventory(get('building=sample-tower'), deps({ store: boom }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/secret|postgres/);
    spy.mockRestore();
  });
  it('other methods are refused', async () => {
    expect((await handleInventory({ method: 'DELETE', search: '', headers: {}, body: null }, deps())).status).toBe(405);
  });
});

describe('POST: the admin passcode', () => {
  it('with no passcode set on the server every write is "admin not configured", whatever is sent', async () => {
    for (const passcode of [null, '']) {
      for (const headers of [{}, { 'x-admin-passcode': PASS }, { 'x-admin-passcode': '' }]) {
        const r = await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'sold' }, headers), deps({ passcode }));
        expect(r.status).toBe(503); expect(err(r).error).toBe('admin-not-configured');
        expect(err(r).message).toMatch(/not configured/i);
      }
    }
  });
  it('an unconfigured admin writes nothing', async () => {
    const store = memoryStore();
    await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'sold' }), deps({ passcode: null, store }));
    expect((await store.read('sample-tower')).units).toEqual({});
  });
  it('refuses a missing, empty, wrong or oversized passcode with 401 and writes nothing', async () => {
    const store = memoryStore();
    for (const headers of [{}, { 'x-admin-passcode': '' }, { 'x-admin-passcode': 'wrong' }, { 'x-admin-passcode': PASS + ' ' }, { 'x-admin-passcode': 'x'.repeat(500) }]) {
      const r = await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'sold' }, headers), deps({ store, throttle: createFailureThrottle(1000) }));
      expect(r.status).toBe(401); expect(err(r).error).toBe('unauthorized');
    }
    expect((await store.read('sample-tower')).units).toEqual({});
  });
  it('never reads the passcode from the address', async () => {
    const r = await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'sold' }, {}, `passcode=${PASS}&x-admin-passcode=${PASS}`), deps());
    expect(r.status).toBe(401);
  });
  it('compares in constant time on equal-length digests (a short wrong value and a long one take the same path)', () => {
    expect(safeEqual(PASS, PASS)).toBe(true);
    expect(safeEqual(PASS, 'a')).toBe(false);
    expect(safeEqual('a', PASS)).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
  it('five wrong passcodes in a minute lock that client out for a while, even for the right one', async () => {
    const throttle = createFailureThrottle(5, 60_000);
    let t = 1_000_000;
    const d = deps({ throttle, now: () => t });
    for (let i = 0; i < 5; i++) expect((await handleInventory(post({}, { 'x-admin-passcode': 'bad' }), d)).status).toBe(401);
    const locked = await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'sold' }), d);
    expect(locked.status).toBe(429); expect(locked.headers?.['retry-after']).toBe('60');
    t += 61_000;
    expect((await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'sold' }), d)).status).toBe(200);
  });
  it('another client is not locked by the first one\'s failures', async () => {
    const throttle = createFailureThrottle(2, 60_000);
    const d = deps({ throttle });
    for (let i = 0; i < 2; i++) await handleInventory({ ...post({}, { 'x-admin-passcode': 'bad' }), client: 'attacker' }, d);
    expect((await handleInventory({ ...post({ building: 'sample-tower', unit: '201', status: 'sold' }), client: 'owner' }, d)).status).toBe(200);
  });
  it('the right passcode clears earlier failures', async () => {
    const throttle = createFailureThrottle(3, 60_000);
    const d = deps({ throttle });
    for (let i = 0; i < 2; i++) await handleInventory(post({}, { 'x-admin-passcode': 'bad' }), d);
    await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'sold' }), d);
    for (let i = 0; i < 2; i++) expect((await handleInventory(post({}, { 'x-admin-passcode': 'bad' }), d)).status).toBe(401);
  });
});

describe('POST: validation against the building\'s own unit list', () => {
  const ok = (b: unknown) => handleInventory(post(b), deps());
  it('flips a unit and says what changed', async () => {
    const store = memoryStore({ units: { 'sample-tower': { '201': 'sold' } } });
    const r = await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'available' }), deps({ store }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, building: 'sample-tower', changed: true, unit: '201', status: 'available' } satisfies InventoryChanged);
    expect((await store.read('sample-tower')).units['201']).toBe('available');
    expect(r.headers?.['cache-control']).toBe('no-store');
  });
  it('a write that changes nothing says so and logs nothing', async () => {
    const store = memoryStore({ units: { 'sample-tower': { '201': 'sold' } } });
    const r = await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'sold' }), deps({ store }));
    expect((r.body as InventoryChanged).changed).toBe(false);
    expect(store.log).toEqual([]);
  });
  it('logs each change, appending (old status, new status)', async () => {
    const store = memoryStore({ units: { 'sample-tower': { '201': 'sold' } } });
    await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'available' }), deps({ store }));
    await handleInventory(post({ building: 'sample-tower', unit: '202', status: 'sold' }), deps({ store }));
    expect(store.log).toEqual([{ building: 'sample-tower', unit: '201', old: 'sold', next: 'available' }, { building: 'sample-tower', unit: '202', old: null, next: 'sold' }]);
  });
  it('rejects a unit that is not in the building\'s list, however it is written', async () => {
    for (const unit of ['999', '2010', '20', ' 201', '201 ', '0201', '', '201;DROP', '../201', 201, null, ['201']]) {
      const r = await ok({ building: 'sample-tower', unit, status: 'sold' });
      expect(r.status, JSON.stringify(unit)).toBe(400);
      expect(['unknown-unit', 'bad-request']).toContain(err(r).error);
    }
  });
  it('rejects a building that is not valid or has no units', async () => {
    expect((await ok({ building: 'nobody', unit: '201', status: 'sold' })).status).toBe(404);
    expect((await ok({ building: '../x', unit: '201', status: 'sold' })).status).toBe(400);
    expect((await ok({ unit: '201', status: 'sold' })).status).toBe(400);
    expect((await ok({ building: 7, unit: '201', status: 'sold' })).status).toBe(400);
  });
  it('rejects a status that is not available or sold', async () => {
    for (const status of ['reserved', 'Sold', '', null, 1, undefined]) expect((await ok({ building: 'sample-tower', unit: '201', status })).status).toBe(400);
  });
  it('rejects unknown fields (no price, no enquiry)', async () => {
    const r = await ok({ building: 'sample-tower', unit: '201', status: 'sold', price: 1 });
    expect(r.status).toBe(400); expect(err(r).message).toMatch(/Unknown field "price"/);
  });
  it('one change at a time', async () => {
    expect((await ok({ building: 'sample-tower' })).status).toBe(400);
    expect((await ok({ building: 'sample-tower', unit: '201', status: 'sold', vastuEnabled: true })).status).toBe(400);
    expect((await ok({ building: 'sample-tower', unit: '201' })).status).toBe(400);
  });
  it('rejects a body that is not JSON, not an object, or too large', async () => {
    expect((await handleInventory(post('{nope'), deps())).status).toBe(400);
    expect((await handleInventory(post('[1]'), deps())).status).toBe(400);
    expect((await handleInventory(post('null'), deps())).status).toBe(400);
    expect((await handleInventory({ ...post({}), body: null }, deps())).status).toBe(400);
    expect((await handleInventory(post(JSON.stringify({ building: 'sample-tower', pad: 'x'.repeat(MAX_BODY_BYTES) })), deps())).status).toBe(400);
  });
  it('switches the Vastu checklist on and off, and only with a boolean', async () => {
    const store = memoryStore({ settings: { 'sample-tower': { demo: true } } });
    const r = await handleInventory(post({ building: 'sample-tower', vastuEnabled: true }), deps({ store }));
    expect(r.body).toEqual({ ok: true, building: 'sample-tower', changed: true, vastuEnabled: true });
    expect((await store.read('sample-tower')).settings).toEqual({ vastuEnabled: true, demo: true });
    for (const v of ['true', 1, null, 'yes']) expect((await handleInventory(post({ building: 'sample-tower', vastuEnabled: v }), deps({ store }))).status).toBe(400);
    expect((await handleInventory(post({ building: 'sample-tower', vastuEnabled: false }), deps({ store }))).status).toBe(200);
    expect((await store.read('sample-tower')).settings.vastuEnabled).toBe(false);
  });
  it('a check changes nothing and needs the right passcode and a real building', async () => {
    const store = memoryStore();
    const r = await handleInventory(post({ building: 'sample-tower', check: true }), deps({ store }));
    expect(r.status).toBe(200); expect((r.body as InventoryChanged).changed).toBe(false);
    expect(store.log).toEqual([]);
    expect((await handleInventory(post({ building: 'sample-tower', check: true }, { 'x-admin-passcode': 'wrong' }), deps({ store }))).status).toBe(401);
    expect((await handleInventory(post({ building: 'nobody', check: true }), deps({ store }))).status).toBe(404);
    expect((await handleInventory(post({ building: 'sample-tower', check: true }), deps({ store, passcode: null }))).status).toBe(503);
    expect((await handleInventory(post({ building: 'sample-tower', check: true, unit: '201', status: 'sold' }), deps({ store }))).status).toBe(400);
  });
  it('the demo flag cannot be set over the API', async () => {
    expect((await ok({ building: 'sample-tower', demo: false })).status).toBe(400);
  });
  it('no database: a valid, authorised write says "not configured"', async () => {
    const r = await handleInventory(post({ building: 'sample-tower', unit: '201', status: 'sold' }), deps({ store: null }));
    expect(r.status).toBe(503); expect(err(r).error).toBe('not-configured');
  });
  it('the building id rule is the app\'s own', () => {
    expect(BUILDING_ID_RE.source).toBe(APP_BUILDING_ID_RE.source);
  });
});

describe('the Postgres store, against a mocked database', () => {
  it('reads the units and the settings with the building as a parameter, never in the text', async () => {
    const query = vi.fn(async (text: string) => (text.includes('FROM units ') ? [{ unit_id: '201', status: 'sold' }, { unit_id: '202', status: 'weird' }] : [{ vastu_enabled: true, demo: true }]));
    const r = await neonStore(query).read("x'; DROP TABLE units; --");
    expect(r).toEqual({ units: { '201': 'sold' }, settings: { vastuEnabled: true, demo: true } });
    for (const [text, params] of query.mock.calls as unknown as [string, unknown[]][]) { expect(text).not.toMatch(/DROP/); expect(params).toEqual(["x'; DROP TABLE units; --"]); }
  });
  it('no settings row reads as off and not demo', async () => {
    const r = await neonStore(async () => []).read('b');
    expect(r).toEqual({ units: {}, settings: { vastuEnabled: false, demo: false } });
  });
  it('a status write is one statement that logs only when it changed the row', async () => {
    const query = vi.fn(async () => [{ new_status: 'sold' }]);
    expect(await neonStore(query).setStatus('b', '201', 'sold')).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(SQL.setStatus, ['b', '201', 'sold']);
    expect(SQL.setStatus).toMatch(/INSERT INTO units_log/);
    expect(SQL.setStatus).toMatch(/IS DISTINCT FROM/);
    expect(await neonStore(async () => []).setStatus('b', '201', 'sold')).toBe(false);
  });
  it('the vastu write is an upsert that touches nothing else', async () => {
    const query = vi.fn(async () => []);
    await neonStore(query).setVastu('b', true);
    expect(query).toHaveBeenCalledWith(SQL.setVastu, ['b', true]);
    expect(SQL.setVastu).not.toMatch(/demo/);
  });
  it('the log is never updated or deleted by any statement the store knows', () => {
    for (const s of Object.values(SQL)) expect(s).not.toMatch(/(UPDATE|DELETE FROM)\s+units_log/i);
  });
});

describe('the unit list the endpoint trusts', () => {
  it('is the building file\'s own units, read the same way the app generates them', () => {
    const json = JSON.parse(fs.readFileSync('public/buildings/sample-tower/building.json', 'utf8')) as { units: Parameters<typeof generateUnits>[0] };
    const ids = unitIdsOf(json)!;
    expect(ids).toEqual(generateUnits(json.units).map((u) => u.id));
    expect(ids).toHaveLength(80);
    expect(ids).toContain('1204');
  });
  it('a building without units, or with a bad block, has none', () => {
    expect(unitIdsOf({})).toBeNull();
    expect(unitIdsOf({ units: { firstFloor: 0, floors: 1, perFloor: [{ number: 1, type: 'a' }] } })).toBeNull();
    expect(unitIdsOf({ units: { firstFloor: 1, floors: 1, perFloor: [] } })).toBeNull();
    expect(unitIdsOf({ units: { firstFloor: 1, floors: 1, perFloor: [{ number: 100, type: 'a' }] } })).toBeNull();
    expect(unitIdsOf(null)).toBeNull();
    expect(unitIdsOf({ units: { firstFloor: 1, floors: 200, perFloor: Array.from({ length: 20 }, (_, i) => ({ number: i + 1, type: 'a' })) } })).toBeNull();
  });
  it('the loader reads the repo\'s buildings and refuses anything that is not a plain building id', async () => {
    const load = fileUnitsLoader(path.resolve(import.meta.dirname, '..'));
    expect((await load('sample-tower'))!.length).toBe(80);
    expect(await load('sample-tower-empty')).toBeNull(); // the twin has no units
    expect(await load('no-such-building')).toBeNull();
    expect(await load('../../etc')).toBeNull();
    expect(await load('')).toBeNull();
  });
});

describe('the seed, the schema and the setup script', () => {
  const units = generateUnits({ firstFloor: 2, floors: 20, perFloor: [1, 2, 3, 4].map((n) => ({ number: n, type: 'a' })) });
  it('is deterministic: the same ids always give the same statuses', () => {
    expect(seedStatuses('sample-tower', units)).toEqual(seedStatuses('sample-tower', units));
    expect(seedStatus('sample-tower', '1204', 0.5)).toBe(seedStatus('sample-tower', '1204', 0.5));
  });
  it('sells some and leaves some, more at the bottom than at the top', () => {
    const s = seedStatuses('sample-tower', units);
    const sold = s.filter((x) => x.status === 'sold').length;
    expect(sold).toBeGreaterThan(10); expect(sold).toBeLessThan(60);
    const low = s.slice(0, 40).filter((x) => x.status === 'sold').length, high = s.slice(40).filter((x) => x.status === 'sold').length;
    expect(low).toBeGreaterThan(high);
  });
  it('neighbours are not clumped: units of one floor do not all share a status', () => {
    const s = seedStatuses('sample-tower', units);
    const mixed = Array.from({ length: 20 }, (_, f) => new Set(s.slice(f * 4, f * 4 + 4).map((x) => x.status)).size > 1).filter(Boolean).length;
    expect(mixed).toBeGreaterThanOrEqual(8); // plain FNV gave whole floors of one status
  });
  it('a different building gets different statuses (the seed is the building id too)', () => {
    expect(JSON.stringify(seedStatuses('a', units))).not.toBe(JSON.stringify(seedStatuses('b', units)));
  });
  it('the schema is a checked-in file with the three tables and every statement idempotent', () => {
    const text = fs.readFileSync('db/schema.sql', 'utf8');
    const st = splitSql(text);
    expect(st).toHaveLength(4);
    for (const s of st) expect(s).toMatch(/IF NOT EXISTS/);
    expect(text).toMatch(/CREATE TABLE IF NOT EXISTS units \(/);
    expect(text).toMatch(/PRIMARY KEY \(building_id, unit_id\)/);
    expect(text).toMatch(/CHECK \(status IN \('available', 'sold'\)\)/);
    expect(text).toMatch(/vastu_enabled boolean NOT NULL DEFAULT false/);
    expect(text).toMatch(/demo\s+boolean NOT NULL DEFAULT false/);
    expect(text).toMatch(/CREATE TABLE IF NOT EXISTS units_log/);
    expect(text).toMatch(/old_status\s+text,/);
  });
  it('splits SQL on semicolons outside quotes and drops comments', () => {
    expect(splitSql("-- a; b\nSELECT 'x;y'; SELECT 2;\n-- end")).toEqual(["SELECT 'x;y'", 'SELECT 2']);
  });
  it('the setup script is wired to npm and needs no secret in the repo', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string>; dependencies: Record<string, string> };
    expect(pkg.scripts['db:setup']).toBe('tsx scripts/db-setup.ts');
    expect(pkg.dependencies['@neondatabase/serverless']).toMatch(/^\d+\.\d+\.\d+$/); // pinned exactly
    expect(fs.readFileSync('.gitignore', 'utf8')).toMatch(/^\.env\*/m);
  });
});

describe('the server code stays on the server', () => {
  const root = path.resolve(import.meta.dirname, '..');
  function* walk(dir: string): Generator<string> {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (/\.(ts|css)$/.test(p)) yield p;
    }
  }
  it('no file under src/ outside src/inventory/server imports the server code', () => {
    const offenders: string[] = [];
    for (const f of walk(path.join(root, 'src'))) {
      if (f.includes(`${path.sep}inventory${path.sep}server${path.sep}`)) continue;
      if (/inventory\/server|neondatabase/.test(fs.readFileSync(f, 'utf8'))) offenders.push(path.relative(root, f));
    }
    expect(offenders).toEqual([]);
  });
  it('the browser files never name the passcode variable or the connection variables', () => {
    for (const f of [...walk(path.join(root, 'src/inventory')), path.join(root, 'admin.html')].filter((x) => !x.includes(`${path.sep}server${path.sep}`) && fs.existsSync(x))) {
      const text = fs.readFileSync(f, 'utf8').replace(/^\s*(\/\/|\/\*|\*).*$/gm, '');
      for (const bad of ['WALKTHRU_ADMIN_PASSCODE', 'DATABASE_URL', 'process.env', 'neondatabase']) expect(text.includes(bad), `${path.basename(f)} mentions ${bad}`).toBe(false);
    }
  });
  it('the function and the handler carry no passcode of their own', () => {
    for (const f of ['api/inventory.ts', 'src/inventory/server/handler.ts', 'src/inventory/server/plugin.ts', 'scripts/db-setup.ts']) {
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      expect(text).not.toMatch(/passcode\s*[:=]\s*['"`][^'"`]{3,}['"`]/i);
    }
  });
  it('the vercel config ships the building files with the function and serves /admin', () => {
    const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as { functions: Record<string, { includeFiles?: string }>; rewrites: { source: string; destination: string }[] };
    expect(v.functions['api/inventory.ts'].includeFiles).toBe('public/buildings/*/building.json');
    expect(v.rewrites).toContainEqual({ source: '/admin', destination: '/admin.html' });
  });
});
