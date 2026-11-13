// C12f. SPEC 17.14: the production /api/photo, a Vercel function. It reads the key from WALKTHRU_GEMINI_KEY and does nothing
// unless WALKTHRU_PHOTO_ENABLED is set. The browser bundle never imports this file or anything under src/photo/server.
// (Relative imports carry .js because the package is ESM; the TypeScript files resolve from them.)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createDayCounter, handlePhoto, readPhotoEnv, MAX_BODY_BYTES } from '../src/photo/server/handler.js';

const counter = createDayCounter();

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
  const env = readPhotoEnv(process.env, process.env.WALKTHRU_GEMINI_KEY ?? null);
  const body = req.method === 'POST' ? await bodyOf(req) : null;
  const out = await handlePhoto(req.method ?? 'GET', body, { env, counter });
  res.statusCode = out.status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(out.body));
}
