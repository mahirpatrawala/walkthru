// C9 acceptance 15 and 16: the dev API on a bare node:http server, and nothing written outside the two scene folders.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLavfiVideo, buildTestPhotos } from '../scripts/make-test-video';
import { FakeBackend } from '../src/media/server/backends/fake';
import { JobManager } from '../src/media/server/jobs';
import { createMediaMiddleware } from '../src/media/server/media-api';
import { makePaths } from '../src/media/server/pipeline';
import { findTool } from '../src/media/server/tools';
import type { JobStatus, PhotoPinsFile } from '../src/media/types';

const hasFfmpeg = !!findTool('ffmpeg') && !!findTool('ffprobe');

describe.skipIf(!hasFfmpeg)('C9 dev API', () => {
  let tmp = '';
  let root = '';
  let server: http.Server;
  let base = '';
  let video = '';
  let photos: string[] = [];

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-api-test-'));
    root = path.join(tmp, 'root');
    fs.mkdirSync(root);
    video = path.join(tmp, 'v.mp4');
    await buildLavfiVideo(video, { seconds: 3 });
    photos = await buildTestPhotos(path.join(tmp, 'ph'), 1);
    const paths = makePaths(root);
    const manager = new JobManager({ paths, backendFor: () => new FakeBackend() });
    const mw = createMediaMiddleware(manager, paths);
    server = http.createServer((req, res) => {
      void mw(req, res, () => { res.statusCode = 404; res.setHeader('x-fell-through', '1'); res.end('next'); });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const post = (p: string, body: BodyInit, headers: Record<string, string> = {}): Promise<Response> => fetch(base + p, { method: 'POST', body, headers });

  it('15. upload, 415, 413, bad id, job status with since, pins round trip, unknown routes fall through', async () => {
    const bytes = fs.readFileSync(video);
    const up = await post('/api/scenes/api-scene/media?name=walk.mp4', bytes);
    expect(up.status).toBe(200);
    const upBody = (await up.json()) as { uploadId: string; kind: string; bytes: number };
    expect(upBody.kind).toBe('video');
    expect(upBody.uploadId).toMatch(/^u-[0-9a-f]{8}$/);
    expect(upBody.bytes).toBe(bytes.length);
    // stored under .cache, never under public/
    expect(fs.readdirSync(path.join(root, '.cache/media/api-scene/uploads'))[0]).toBe(`${upBody.uploadId}-walk.mp4`);
    expect(fs.existsSync(path.join(root, 'public'))).toBe(false);

    expect((await post('/api/scenes/api-scene/media?name=evil.exe', Buffer.alloc(1024, 7))).status).toBe(415);
    // right extension, wrong content
    expect((await post('/api/scenes/api-scene/media?name=fake.mp4', Buffer.alloc(1024, 7))).status).toBe(415);
    expect((await post('/api/scenes/Bad_Scene/media?name=walk.mp4', bytes)).status).toBe(400);

    // 413: the declared length is over the limit
    const status413 = await new Promise<number>((resolve, reject) => {
      const u = new URL(base + '/api/scenes/api-scene/media?name=big.mp4');
      const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers: { 'content-length': String(400 * 1024 * 1024) } },
        (res) => { resolve(res.statusCode ?? 0); res.resume(); req.destroy(); });
      req.on('error', (e) => reject(e));
      req.write('x');
    });
    expect(status413).toBe(413);

    // jobs
    expect((await post('/api/scenes/api-scene/jobs', JSON.stringify({ uploadIds: ['u-00000000'] }))).status).toBe(400);
    const started = await post('/api/scenes/api-scene/jobs', JSON.stringify({ uploadIds: [upBody.uploadId], options: { backend: 'fake', mode: 'tiny' } }));
    expect(started.status).toBe(200);
    const { jobId } = (await started.json()) as { jobId: string };
    let st: JobStatus;
    for (let i = 0; ; i++) {
      st = (await (await fetch(`${base}/api/scenes/api-scene/jobs/${jobId}`)).json()) as JobStatus;
      if (st.state === 'done' || st.state === 'failed') break;
      if (i > 300) throw new Error('job did not finish');
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(st.state).toBe('done');
    expect(st.options.patchProperty).toBe(false); // the API never patches property.json unless asked
    const later = (await (await fetch(`${base}/api/scenes/api-scene/jobs/${jobId}?since=4`)).json()) as JobStatus;
    expect(later.events.length).toBe(st.events.length - 4);
    expect(later.events.every((e) => e.seq > 4)).toBe(true);
    expect((await fetch(`${base}/api/scenes/api-scene/jobs/j-00000000`)).status).toBe(404);
    const list = (await (await fetch(`${base}/api/scenes/api-scene/jobs`)).json()) as { jobId: string; state: string }[];
    expect(list[0].jobId).toBe(jobId);
    expect(list[0].state).toBe('done');
    // DELETE on a finished job is a 404, not a crash
    expect((await fetch(`${base}/api/scenes/api-scene/jobs/${jobId}`, { method: 'DELETE' })).status).toBe(404);

    // pins
    const empty = (await (await fetch(`${base}/api/scenes/api-scene/pins`)).json()) as PhotoPinsFile;
    expect(empty).toEqual({ version: 1, pins: [] });
    const pin = { id: 'p-001', file: 'media/photos/p-001.jpg', thumb: 'media/photos/p-001.thumb.jpg', width: 10, height: 8, at: { x: 1, z: 2 }, yawDeg: 30, roomId: null, placedBy: 'broker' };
    const file = { version: 1, pins: [pin] };
    const put = await fetch(`${base}/api/scenes/api-scene/pins`, { method: 'PUT', body: JSON.stringify(file) });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true });
    expect(await (await fetch(`${base}/api/scenes/api-scene/pins`)).json()).toEqual(file);
    const dup = await fetch(`${base}/api/scenes/api-scene/pins`, { method: 'PUT', body: JSON.stringify({ version: 1, pins: [pin, pin] }) });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toMatch(/twice/);
    expect((await fetch(`${base}/api/scenes/api-scene/pins`, { method: 'PUT', body: '{not json' })).status).toBe(400);

    // routes that are not ours fall through to next()
    for (const p of ['/api/scenes/api-scene/files', '/api/scenes', '/api/scenes/api-scene/property', '/index.html']) {
      const r = await fetch(base + p);
      expect(r.headers.get('x-fell-through')).toBe('1');
    }
  }, 60_000);

  it('16. a hostile upload name and a photo job write only inside public/scenes/<id> and .cache/media/<id>', async () => {
    const bytes = fs.readFileSync(photos[0]);
    const up = await post(`/api/scenes/safe-scene/media?name=${encodeURIComponent('../../../escape.jpg')}`, bytes);
    expect(up.status).toBe(200);
    const { uploadId } = (await up.json()) as { uploadId: string };
    const jr = await post('/api/scenes/safe-scene/jobs', JSON.stringify({ uploadIds: [uploadId], options: { backend: 'fake' } }));
    const { jobId } = (await jr.json()) as { jobId: string };
    for (let i = 0; i < 300; i++) {
      const st = (await (await fetch(`${base}/api/scenes/safe-scene/jobs/${jobId}`)).json()) as JobStatus;
      if (st.state === 'done') {
        expect(st.result!.photos[0].originalName).toBe('escape.jpg');
        break;
      }
      expect(st.state === 'failed').toBe(false);
      await new Promise((r) => setTimeout(r, 50));
    }
    const allowed = [path.join(root, 'public/scenes/safe-scene'), path.join(root, '.cache/media/safe-scene')];
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const bad = walk(tmp).filter((f) => f.startsWith(root + path.sep) && !allowed.some((a) => f.startsWith(a + path.sep)));
    // the other scene from test 15 is allowed to exist; only paths outside any scene folder count
    const outside = bad.filter((f) => !/\/(public\/scenes|\.cache\/media)\/api-scene\//.test(f));
    expect(outside).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'escape.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'escape.jpg'))).toBe(false);
  }, 60_000);
});
