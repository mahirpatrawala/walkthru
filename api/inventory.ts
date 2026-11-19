// SPEC 22.3: the production /api/inventory, a Vercel function. It reads DATABASE_URL (the Neon connection Vercel provides) and WALKTHRU_ADMIN_PASSCODE
// (set by the owner: with it unset every write answers "admin not configured"). The browser bundle never imports this file or anything under
// src/inventory/server. (Relative imports carry .js because the package is ESM; the TypeScript files resolve from them.)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';
import { MAX_BODY_BYTES, handleInventory } from '../src/inventory/server/handler.js';
import { neonStore } from '../src/inventory/server/store.js';
import { fileUnitsLoader } from '../src/inventory/server/units-file.js';

const unitsOf = fileUnitsLoader(process.cwd());

async function bodyOf(req: IncomingMessage & { body?: unknown }): Promise<string | null> {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > MAX_BODY_BYTES) { resolve(null); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  const url = process.env.DATABASE_URL;
  const store = url ? neonStore((text, params) => neon(url).query(text, params) as Promise<Record<string, unknown>[]>) : null;
  const forwarded = req.headers['x-forwarded-for'];
  const out = await handleInventory(
    {
      method: req.method ?? 'GET',
      search: (req.url ?? '').split('?')[1] ?? '',
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
      body: req.method === 'POST' ? await bodyOf(req) : null,
      client: (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown',
    },
    { store, passcode: process.env.WALKTHRU_ADMIN_PASSCODE?.trim() || null, unitsOf },
  );
  res.statusCode = out.status;
  res.setHeader('content-type', 'application/json');
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
  res.end(JSON.stringify(out.body));
}
