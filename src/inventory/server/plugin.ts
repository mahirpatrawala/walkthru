// SPEC 22.3: the dev-server side of /api/inventory, a Vite plugin like the photo and media APIs. Node only; never part of the build.
// The Vite dev server does not run Vercel functions, so this answers the same address with the same handler:
//   - with DATABASE_URL in .env.local (`npx -y vercel@latest env pull .env.local`) it talks to the real database;
//   - with WALKTHRU_INVENTORY_FAKE=1 it keeps a throw-away store in memory, seeded like the sample (nothing is written anywhere);
//   - with neither, the service answers "not configured" and the pages show "Status unavailable", as the static site does without a database.
// Writes need WALKTHRU_ADMIN_PASSCODE in the environment (or .env.local) here too: there is no default.
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { neon } from '@neondatabase/serverless';
import { generateUnits } from '../../building/units.js';
import { seedStatuses } from '../seed.js';
import { MAX_BODY_BYTES, createFailureThrottle, handleInventory } from './handler.js';
import { memoryStore, neonStore } from './store.js';
import type { InventoryStore } from './store.js';
import { fileUnitsLoader, unitIdsOf } from './units-file.js';


function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > MAX_BODY_BYTES) { resolve(null); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/** The sample tower's units with the setup script's own made-up statuses, for the in-memory store. */
function fakeStore(root: string): InventoryStore {
  const seed: Record<string, Record<string, 'available' | 'sold'>> = {};
  const settings: Record<string, { vastuEnabled?: boolean; demo?: boolean }> = {};
  const dir = path.join(root, 'public', 'buildings');
  for (const id of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(dir, id, 'building.json'), 'utf8')) as { units?: Parameters<typeof generateUnits>[0] };
      if (!json.units || !unitIdsOf(json)) continue;
      seed[id] = Object.fromEntries(seedStatuses(id, generateUnits(json.units)).map((s) => [s.unitId, s.status]));
      settings[id] = { demo: true };
    } catch { /* not a building with units */ }
  }
  return memoryStore({ units: seed, settings });
}

export interface InventoryApiOptions { env?: Record<string, string | undefined> }

export function walkthruInventoryApi(opts: InventoryApiOptions = {}): Plugin {
  const throttle = createFailureThrottle();
  let root = process.cwd();
  let env: Record<string, string | undefined> = opts.env ?? process.env;
  let store: InventoryStore | null | undefined;
  let units: ReturnType<typeof fileUnitsLoader>;
  return {
    name: 'walkthru-inventory-api',
    apply: 'serve',
    configResolved(c) {
      root = c.root;
      env = opts.env ?? { ...loadEnv(c.mode, c.root, ''), ...process.env };
      units = fileUnitsLoader(root, 1000);
    },
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== '/api/inventory') return next();
        if (store === undefined) {
          const db = env.DATABASE_URL;
          store = env.WALKTHRU_INVENTORY_FAKE === '1' ? fakeStore(root) : db ? neonStore((text, params) => neon(db).query(text, params) as Promise<Record<string, unknown>[]>) : null;
        }
        const out = await handleInventory(
          { method: req.method ?? 'GET', search: url.search.slice(1), headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])), body: req.method === 'POST' ? await readBody(req) : null, client: req.socket.remoteAddress ?? 'local' },
          { store, passcode: env.WALKTHRU_ADMIN_PASSCODE?.trim() || null, unitsOf: units, throttle },
        );
        res.statusCode = out.status;
        res.setHeader('content-type', 'application/json');
        for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
        res.end(JSON.stringify(out.body));
      });
    },
  };
}
