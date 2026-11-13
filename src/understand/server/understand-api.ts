// C12e. SPEC 17.9 "Server": the dev API for "Check the drawing", as a Vite plugin. Node only. Modelled on src/media/server/media-api.ts.
//
//   POST /api/scenes/:id/understand?name=...        one file of the set, streamed to .cache (PDF, PNG, JPG, WebP; checked by its first bytes)
//   POST /api/scenes/:id/understand/run             { uploadIds, vision?, noticeAccepted? } -> { jobId }
//   GET  /api/scenes/:id/understand/status          ?job=&since= -> the job, and whether there is anything to review
//   GET  /api/scenes/:id/understand/review          { doc, pages, review, visionAvailable } (everything the step needs)
//   GET  /api/scenes/:id/understand/outputs         proposal, extras and designs as the writer makes them now
//   PUT  /api/scenes/:id/understand/review          the decisions; writes review.json and re-runs the writer; answers with the new outputs
//   GET  /api/scenes/:id/understand/page/:n.png     the page render, from .cache
//   GET  /api/scenes/:id/understand/crop?page=&rect=&w=   a rectangle of it (render pixels)
//   DELETE /api/scenes/:id/understand/jobs/:job     cancel
//
// Vision is used only when `vision` is true AND `noticeAccepted` is true AND a key exists. Nothing is ever read from public/.
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildRows, progressOf, validateReview } from '../review-model';
import { applyReview } from '../review-apply';
import { CropService } from './crops';
import { UnderstandJobs, newUploadId } from './jobs';
import { defaultVisionAvailable } from './run';
import { SCENE_ID_RE, hasUnderstanding, loadStored, saveReview, writeOutputs } from './store';
import type { UnderstandPaths } from './store';

export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
export const MAX_FILES = 40;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
type Next = (err?: unknown) => void;
export type UnderstandMiddleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void | Promise<void>;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
function sendPng(res: ServerResponse, bytes: Uint8Array | null): void {
  if (!bytes) return send(res, 404, { error: 'no such picture' });
  res.statusCode = 200;
  res.setHeader('content-type', 'image/png');
  res.setHeader('cache-control', 'no-store');
  res.end(Buffer.from(bytes));
}
function readJson(req: IncomingMessage, limit = MAX_JSON_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { reject(new Error('body is not valid JSON')); } });
    req.on('error', reject);
  });
}

/** What a file is, from its first bytes: the extension is not trusted. */
export function sniff(head: Buffer): { kind: 'pdf' | 'image'; ext: 'pdf' | 'png' | 'jpg' | 'webp' } | null {
  if (head.length >= 5 && head.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', ext: 'pdf' };
  if (head.length >= 4 && head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return { kind: 'image', ext: 'png' };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'image', ext: 'jpg' };
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', ext: 'webp' };
  return null;
}

export function createUnderstandMiddleware(jobs: UnderstandJobs, paths: UnderstandPaths, opts: { visionAvailable?: () => Promise<boolean> | boolean } = {}): UnderstandMiddleware {
  jobs.recover();
  const crops = new CropService(paths);
  const visionAvailable = opts.visionAvailable ?? defaultVisionAvailable;

  async function upload(req: IncomingMessage, res: ServerResponse, sceneId: string): Promise<void> {
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > MAX_UPLOAD_BYTES) { req.resume(); return send(res, 413, { error: 'That file is over 80 MB.' }); }
    const dir = jobs.uploadsDir(sceneId);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.readdirSync(dir).length >= MAX_FILES) { req.resume(); return send(res, 400, { error: `A set can have at most ${MAX_FILES} files.` }); }
    const uploadId = newUploadId();
    const tmp = path.join(dir, `${uploadId}.part`);
    const out = fs.createWriteStream(tmp);
    let bytes = 0; let head = Buffer.alloc(0); let tooBig = false;
    await new Promise<void>((resolve) => {
      req.on('data', (c: Buffer) => {
        if (tooBig) return;
        bytes += c.length;
        if (head.length < 16) head = Buffer.concat([head, c.subarray(0, 16 - head.length)]);
        if (bytes > MAX_UPLOAD_BYTES) { tooBig = true; req.unpipe(out); out.destroy(); req.resume(); return; }
        if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()); }
      });
      req.on('end', () => { if (!tooBig) out.end(); resolve(); });
      req.on('error', () => { out.destroy(); resolve(); });
      req.on('aborted', () => { out.destroy(); resolve(); });
    });
    if (tooBig) { fs.rmSync(tmp, { force: true }); return send(res, 413, { error: 'That file is over 80 MB.' }); }
    await new Promise<void>((resolve) => { if (out.writableFinished || out.destroyed) resolve(); else out.once('close', () => resolve()); });
    const kind = bytes > 0 ? sniff(head) : null;
    if (!kind) { fs.rmSync(tmp, { force: true }); return send(res, 415, { error: 'Only PDF, JPG, PNG and WebP drawings can be read.' }); }
    // the stored name is the id and the sniffed extension: whatever the file was called is not kept
    fs.renameSync(tmp, path.join(dir, `${uploadId}.${kind.ext}`));
    send(res, 200, { uploadId, kind: kind.kind, bytes });
  }

  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
    if (parts[0] !== 'api' || parts[1] !== 'scenes' || parts.length < 4 || parts[3] !== 'understand') return next();
    const sceneId = parts[2];
    const method = req.method ?? 'GET';
    const rest = parts.slice(4);
    try {
      if (!SCENE_ID_RE.test(sceneId)) return send(res, 400, { error: 'bad scene id' });

      if (rest.length === 0 && method === 'POST') return await upload(req, res, sceneId);

      if (rest.length === 1 && rest[0] === 'run' && method === 'POST') {
        const body = (await readJson(req)) as { uploadIds?: unknown; vision?: unknown; noticeAccepted?: unknown } | null;
        if (!body || !Array.isArray(body.uploadIds) || body.uploadIds.length === 0 || body.uploadIds.length > MAX_FILES) return send(res, 400, { error: 'uploadIds must be a non-empty list' });
        const inputs = [];
        for (const id of body.uploadIds) {
          const found = typeof id === 'string' ? jobs.resolveUpload(sceneId, id) : null;
          if (!found) return send(res, 400, { error: `unknown upload ${String(id).slice(0, 20)}` });
          inputs.push(found);
        }
        // SPEC 17.16 item 10: the broker is told drawings go to a model provider; no tick, no vision
        if (body.vision === true && body.noticeAccepted !== true) return send(res, 400, { error: 'Tick the notice that drawings are sent to an AI service, or turn vision off.' });
        const st = jobs.create(sceneId, inputs, { vision: body.vision === true && body.noticeAccepted === true });
        return send(res, 200, { jobId: st.jobId });
      }

      if (rest.length === 1 && rest[0] === 'status' && method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? 0);
        const jobId = url.searchParams.get('job');
        const job = jobId ? jobs.get(sceneId, jobId, Number.isFinite(since) ? since : 0) : jobs.latest(sceneId, Number.isFinite(since) ? since : 0);
        const stored = hasUnderstanding(paths, sceneId) ? loadStored(paths, sceneId) : null;
        const progress = stored ? progressOf(buildRows(stored.doc, stored.review)) : null;
        return send(res, 200, { hasUnderstanding: !!stored, visionAvailable: await visionAvailable(), job, progress });
      }

      if (rest.length === 1 && rest[0] === 'review' && method === 'GET') {
        const stored = loadStored(paths, sceneId);
        if (!stored) return send(res, 404, { error: 'Nothing has been read for this scene yet. Upload the drawing set first.' });
        return send(res, 200, { doc: stored.doc, pages: stored.pages, review: stored.review, visionAvailable: await visionAvailable() });
      }
      if (rest.length === 1 && rest[0] === 'outputs' && method === 'GET') {
        // the three buyer files as the writer would produce them now, straight from the cache (the static server can lag a new file)
        const stored = loadStored(paths, sceneId);
        if (!stored) return send(res, 404, { error: 'Nothing has been read for this scene yet.' });
        const applied = applyReview(stored.base, stored.doc, stored.review);
        return send(res, 200, { proposal: applied.proposal, extras: applied.extras, designs: applied.designs });
      }
      if (rest.length === 1 && rest[0] === 'review' && method === 'PUT') {
        const stored = loadStored(paths, sceneId);
        if (!stored) return send(res, 404, { error: 'Nothing has been read for this scene yet.' });
        let body: unknown;
        try { body = await readJson(req); } catch (e) { return send(res, 400, { error: (e as Error).message }); }
        const v = validateReview(stored.doc, body);
        if (!v.ok) return send(res, 400, { error: v.error });
        stored.review = v.review;
        saveReview(paths, sceneId, v.review);
        const applied = writeOutputs(paths, sceneId, stored);
        return send(res, 200, { ok: true, changed: applied.changed, proposal: applied.proposal, extras: applied.extras, designs: applied.designs, progress: progressOf(buildRows(stored.doc, stored.review)) });
      }

      if (rest.length === 2 && rest[0] === 'page' && method === 'GET') {
        const n = Number(/^(\d+)\.png$/.exec(rest[1])?.[1]);
        if (!Number.isInteger(n) || n < 1) return send(res, 400, { error: 'bad page' });
        return sendPng(res, crops.page(sceneId, n, clampW(url.searchParams.get('w'), 1600), turnOfQuery(url.searchParams.get('turn'))));
      }
      if (rest.length === 1 && rest[0] === 'crop' && method === 'GET') {
        const n = Number(url.searchParams.get('page'));
        const rect = (url.searchParams.get('rect') ?? '').split(',').map(Number);
        if (!Number.isInteger(n) || n < 1 || rect.length !== 4 || rect.some((x) => !Number.isFinite(x))) return send(res, 400, { error: 'bad crop' });
        return sendPng(res, crops.crop(sceneId, n, rect as [number, number, number, number], clampW(url.searchParams.get('w'), 640), turnOfQuery(url.searchParams.get('turn'))));
      }
      if (rest.length === 2 && rest[0] === 'jobs' && method === 'DELETE') {
        return jobs.cancel(sceneId, rest[1]) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'no such running job' });
      }
      return next();
    } catch (err) {
      if (!res.headersSent) return send(res, 500, { error: String((err as Error).message ?? err) });
    }
  };
}
const turnOfQuery = (v: string | null): 0 | 90 | 180 | 270 => (v === '90' ? 90 : v === '180' ? 180 : v === '270' ? 270 : 0);
const clampW = (v: string | null, def: number): number => { const n = Number(v); return Number.isFinite(n) && n >= 64 && n <= 3000 ? Math.round(n) : def; };
