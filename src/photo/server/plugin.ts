// C12f. SPEC 17.14: the dev-server side of /api/photo, a Vite plugin like the media API. Node only; never part of the build.
// The key is read from ~/walkthru-tools/.gemini-key on every request (so adding the file needs no restart). A missing file
// means "not configured" and the page hides its button.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createDayCounter, handlePhoto, readPhotoEnv, MAX_BODY_BYTES } from './handler';
import type { Generate } from './handler';

export const DEV_KEY_FILE = path.join(os.homedir(), 'walkthru-tools', '.gemini-key');

export function readDevKey(file = DEV_KEY_FILE): string | null {
  try { return fs.readFileSync(file, 'utf8').trim() || null; } catch { return null; }
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > MAX_BODY_BYTES) { resolve(null); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/**
 * Stand-ins for the model, for looking at the feature without a key. Dev only (this file is not in the Vercel function):
 *  - `echo`: answers with the frame it was sent, so the size check passes;
 *  - `unrelated`: answers with a different picture, so the check refuses it.
 * WALKTHRU_PHOTO_FAKE_DELAY_MS slows either one down, to look at the waiting state.
 * Either needs WALKTHRU_PHOTO_ENABLED too, and counts as configured.
 */
function fakeGenerate(mode: string, root: string, delayMs: number): Generate | null {
  const wait = (): Promise<void> => (delayMs > 0 ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());
  if (mode === 'echo') return async (i) => { await wait(); return { data: i.frameB64, mime: 'image/jpeg' }; };
  if (mode === 'unrelated') {
    return async () => {
      await wait();
      return { data: fs.readFileSync(path.join(root, 'public/look/hdri/view_day_bg.jpg')).toString('base64'), mime: 'image/jpeg' };
    };
  }
  return null;
}

export interface PhotoApiOptions { keyFile?: string; env?: Record<string, string | undefined> }

export function walkthruPhotoApi(opts: PhotoApiOptions = {}): Plugin {
  const counter = createDayCounter();
  let root = process.cwd();
  return {
    name: 'walkthru-photo-api',
    apply: 'serve',
    configResolved(c) { root = c.root; },
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== '/api/photo') return next();
        const e = opts.env ?? process.env;
        const fake = fakeGenerate(e.WALKTHRU_PHOTO_FAKE ?? '', root, Number(e.WALKTHRU_PHOTO_FAKE_DELAY_MS) || 0);
        const env = readPhotoEnv(e, fake ? 'fake-dev-key' : readDevKey(opts.keyFile));
        const body = req.method === 'POST' ? await readBody(req) : null;
        const out = await handlePhoto(req.method ?? 'GET', body, { env, counter, generate: fake ?? undefined });
        res.statusCode = out.status;
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify(out.body));
      });
    },
  };
}
