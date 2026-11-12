// Owned by C9. SPEC 14.7: the dev API for the media pipeline, as a Vite plugin. Node only.
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { emptyPins, sanitiseFileName, validatePinsFile } from '../pins';
import type { MediaOptions } from '../types';
import { JobManager, kindFromName, newUploadId } from './jobs';
import { SCENE_ID_RE, makePaths } from './pipeline';
import type { MediaPaths, PipelineConfig } from './pipeline';
import type { ReconstructionBackend } from '../types';

export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

type Next = (err?: unknown) => void;
export type MediaMiddleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void | Promise<void>;

export interface MediaApiOptions {
  /** the project root (default: the Vite root, else the process working directory) */
  root?: string;
  manager?: JobManager;
  pipeline?: PipelineConfig;
  backendFor?: (name: MediaOptions['backend']) => ReconstructionBackend | null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage, limit = MAX_JSON_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { reject(new Error('body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

/** The first bytes of a file say whether it is what its extension claims. */
export function magicMatches(kind: 'video' | 'photo', ext: string, head: Buffer): boolean {
  const ascii = (a: number, b: number): string => head.subarray(a, b).toString('latin1');
  if (kind === 'video') {
    if (ext === 'webm') return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(ascii(4, 8));
  }
  switch (ext) {
    case 'jpg': case 'jpeg': return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'png': return head.length >= 4 && head[0] === 0x89 && ascii(1, 4) === 'PNG';
    case 'webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'heic': return ascii(4, 8) === 'ftyp';
  }
  return false;
}

/** The middleware, independent of Vite so a test can mount it on a bare node:http server. */
export function createMediaMiddleware(manager: JobManager, paths: MediaPaths): MediaMiddleware {
  manager.recover();

  async function upload(req: IncomingMessage, res: ServerResponse, sceneId: string, name: string): Promise<void> {
    const clean = sanitiseFileName(name);
    const kind = kindFromName(clean);
    if (!kind) return send(res, 415, { error: 'Only mp4, mov, m4v, webm videos and jpg, png, webp, heic photos can be used.' });
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > MAX_UPLOAD_BYTES) { req.resume(); return send(res, 413, { error: 'That file is over 300 MB.' }); }
    const dir = manager.uploadsDir(sceneId);
    fs.mkdirSync(dir, { recursive: true });
    const uploadId = newUploadId();
    const dest = path.join(dir, `${uploadId}-${clean}`);
    const out = fs.createWriteStream(dest);
    let bytes = 0;
    let head = Buffer.alloc(0);
    let tooBig = false;
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
    if (tooBig) { fs.rmSync(dest, { force: true }); return send(res, 413, { error: 'That file is over 300 MB.' }); }
    await new Promise<void>((resolve) => { if (out.writableFinished || out.destroyed) resolve(); else out.once('close', () => resolve()); });
    const ext = /\.([A-Za-z0-9]+)$/.exec(clean)?.[1]?.toLowerCase() ?? '';
    if (bytes === 0 || !magicMatches(kind, ext, head)) {
      fs.rmSync(dest, { force: true });
      return send(res, 415, { error: `That file does not look like a ${kind === 'video' ? 'video' : 'photo'}.` });
    }
    send(res, 200, { uploadId, kind, bytes });
  }

  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
    if (parts[0] !== 'api' || parts[1] !== 'scenes' || parts.length < 4) return next();
    const sceneId = parts[2];
    const what = parts[3];
    if (what !== 'media' && what !== 'jobs' && what !== 'pins') return next();
    const method = req.method ?? 'GET';
    try {
      // route table (anything else falls through)
      const isMedia = what === 'media' && parts.length === 4 && method === 'POST';
      const isJobsRoot = what === 'jobs' && parts.length === 4 && (method === 'POST' || method === 'GET');
      const isJob = what === 'jobs' && parts.length === 5 && (method === 'GET' || method === 'DELETE');
      const isPins = what === 'pins' && parts.length === 4 && (method === 'GET' || method === 'PUT');
      if (!isMedia && !isJobsRoot && !isJob && !isPins) return next();
      if (!SCENE_ID_RE.test(sceneId)) return send(res, 400, { error: 'bad scene id' });

      if (isMedia) return await upload(req, res, sceneId, url.searchParams.get('name') ?? '');

      if (isJobsRoot && method === 'GET') return send(res, 200, manager.list(sceneId));
      if (isJobsRoot) {
        const body = (await readJson(req)) as { uploadIds?: unknown; options?: Record<string, unknown> } | null;
        if (!body || !Array.isArray(body.uploadIds) || body.uploadIds.length === 0 || body.uploadIds.length > 100) {
          return send(res, 400, { error: 'uploadIds must be a non-empty list' });
        }
        const inputs = [];
        for (const id of body.uploadIds) {
          const found = typeof id === 'string' ? manager.resolveUpload(sceneId, id) : null;
          if (!found) return send(res, 400, { error: `unknown upload ${String(id).slice(0, 20)}` });
          inputs.push(found);
        }
        const o = body.options ?? {};
        const options: Partial<MediaOptions> = {};
        if (o.mode === 'full' || o.mode === 'tiny') options.mode = o.mode;
        if (o.backend === 'local' || o.backend === 'cloud' || o.backend === 'fake' || o.backend === 'none') options.backend = o.backend;
        if (typeof o.trainExtraFragmentsMin === 'number' && o.trainExtraFragmentsMin >= 0) options.trainExtraFragmentsMin = Math.floor(o.trainExtraFragmentsMin);
        if (typeof o.patchProperty === 'boolean') options.patchProperty = o.patchProperty;
        if (typeof o.skipTraining === 'boolean') options.skipTraining = o.skipTraining;
        const st = manager.create(sceneId, inputs, options);
        return send(res, 200, { jobId: st.jobId });
      }
      if (isJob) {
        const jobId = parts[4];
        if (method === 'DELETE') {
          const ok = manager.cancel(sceneId, jobId);
          return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'no such running job' });
        }
        const since = Number(url.searchParams.get('since') ?? 0);
        const st = manager.get(sceneId, jobId, Number.isFinite(since) ? since : 0);
        return st ? send(res, 200, st) : send(res, 404, { error: 'unknown job' });
      }
      // pins
      const pinsPath = path.join(paths.scenesDir, sceneId, 'photo-pins.json');
      if (method === 'GET') {
        if (!fs.existsSync(pinsPath)) return send(res, 200, emptyPins());
        try { return send(res, 200, validatePinsFile(JSON.parse(fs.readFileSync(pinsPath, 'utf8')))); } catch { return send(res, 200, emptyPins()); }
      }
      let pins;
      try { pins = validatePinsFile(await readJson(req)); } catch (e) { return send(res, 400, { error: (e as Error).message }); }
      fs.mkdirSync(path.dirname(pinsPath), { recursive: true });
      fs.writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + '\n');
      return send(res, 200, { ok: true });
    } catch (err) {
      if (!res.headersSent) return send(res, 500, { error: String((err as Error).message ?? err) });
    }
  };
}

/**
 * Vite plugin. Must come BEFORE the existing scene middleware in `plugins`, because that one answers 404 for
 * /api/scenes/... routes it does not know. Routes that are not ours call next().
 */
export function walkthruMediaApi(opts: MediaApiOptions = {}): Plugin {
  return {
    name: 'walkthru-media-api',
    apply: 'serve',
    configureServer(server) {
      const paths = makePaths(opts.root ?? server.config.root ?? process.cwd());
      const manager = opts.manager ?? new JobManager({ paths, pipeline: opts.pipeline, backendFor: opts.backendFor });
      server.middlewares.use(createMediaMiddleware(manager, paths));
    },
  };
}
