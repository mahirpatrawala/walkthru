// C12e: the review step's dev API on a bare node:http server, with real synthetic drawing sets (SPEC 17.9 server, 17.12 items 7 and 12,
// 17.16 item 10). A vector set goes through the real pipeline (pdf.js, poppler, the importer, C12b's checks); a raster twin goes through
// the picture path with a simulated model, so no key is needed and no byte leaves the machine.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSet, pdfOf } from '../scripts/make-drawing-sets';
import { buildTwin } from '../scripts/eval/raster-world';
import { unverifiedRoomsFromExtras } from '../src/core/room-trust';
import { encodePng, isPng } from '../src/understand/pixels/image';
import { buildRows, progressOf } from '../src/understand/review-model';
import type { ReviewFile, UnderstandingDoc } from '../src/understand/review-model';
import type { PagesFile } from '../src/understand/page-geometry';
import { cropRegion, turnOf } from '../src/understand/page-geometry';
import { UnderstandJobs } from '../src/understand/server/jobs';
import type { JobStatus } from '../src/understand/server/jobs';
import { makeRunner } from '../src/understand/server/run';
import { createUnderstandMiddleware, sniff } from '../src/understand/server/understand-api';
import { makePaths } from '../src/understand/server/store';
import { MockVisionProvider } from '../src/understand/vision/mock';

const hasPoppler = spawnSync('pdftocairo', ['-v']).status === 0;
const PRIVATE_NAME = 'secret-firm-drawing-name.pdf';
// what the synthetic sheets print in their title blocks and notes (scripts/drawing-sets/sheet.ts)
const TITLE_BLOCK_TEXT = ['TYPICAL RESIDENCE', 'DO NOT SCALE', 'FOR DISCUSSION ONLY', 'ALL DIMENSIONS', 'SCALE NTS', 'A-101'];

describe.skipIf(!hasPoppler)('C12e dev API', () => {
  let tmp = ''; let root = ''; let server: http.Server; let base = '';
  let calls = 0;
  const vectorSet = buildSet(9);
  const picTwin = buildTwin(buildSet(2));
  const pdf = Buffer.from(pdfOf(vectorSet));
  const png = Buffer.from(encodePng(picTwin.pages[0].image));
  let jobs: UnderstandJobs;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-understand-test-'));
    root = path.join(tmp, 'root');
    fs.mkdirSync(root);
    const paths = makePaths(root);
    const runner = makeRunner({ provider: async () => { calls++; return new MockVisionProvider(picTwin.world); }, visionAvailable: () => true });
    jobs = new UnderstandJobs(paths, runner);
    const mw = createUnderstandMiddleware(jobs, paths, { visionAvailable: () => true });
    server = http.createServer((req, res) => { void mw(req, res, () => { res.statusCode = 404; res.setHeader('x-fell-through', '1'); res.end('next'); }); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); fs.rmSync(tmp, { recursive: true, force: true }); });

  const post = (p: string, body: Buffer | string, headers: Record<string, string> = {}): Promise<Response> => fetch(base + p, { method: 'POST', body: typeof body === 'string' ? body : new Blob([new Uint8Array(body)]), headers });
  const json = async <T,>(r: Response): Promise<T> => (await r.json()) as T;
  async function upload(scene: string, bytes: Buffer, name = PRIVATE_NAME): Promise<string> {
    const r = await post(`/api/scenes/${scene}/understand?name=${encodeURIComponent(name)}`, bytes);
    expect(r.status).toBe(200);
    return (await json<{ uploadId: string }>(r)).uploadId;
  }
  async function run(scene: string, ids: string[], body: Record<string, unknown> = {}): Promise<JobStatus> {
    const r = await post(`/api/scenes/${scene}/understand/run`, JSON.stringify({ uploadIds: ids, ...body }), { 'content-type': 'application/json' });
    expect(r.status).toBe(200);
    const { jobId } = await json<{ jobId: string }>(r);
    for (let i = 0; i < 400; i++) {
      const st = await json<{ job: JobStatus }>(await fetch(`${base}/api/scenes/${scene}/understand/status?job=${jobId}`));
      if (!['queued', 'running'].includes(st.job.state)) return st.job;
      await new Promise((res) => setTimeout(res, 150));
    }
    throw new Error('job did not finish');
  }
  const sceneFiles = (scene: string): string[] => ['proposal.json', 'proposal-extras.json', 'designs.json'].map((f) => path.join(root, 'public/scenes', scene, f));

  it('uploads are checked by their first bytes, stored in .cache under an id, and the file name is not kept', async () => {
    const bad = await post('/api/scenes/test-api/understand?name=notes.pdf', Buffer.from('this is not a pdf, whatever the name says'));
    expect(bad.status).toBe(415);
    expect((await json<{ error: string }>(bad)).error).toMatch(/PDF, JPG, PNG/);
    expect((await post('/api/scenes/test-api/understand', Buffer.alloc(0))).status).toBe(415);
    const id = await upload('test-api', pdf);
    expect(id).toMatch(/^u-[0-9a-f]{8}$/);
    const stored = fs.readdirSync(path.join(root, '.cache/understand/test-api/uploads'));
    expect(stored).toEqual([`${id}.pdf`]);
    expect(stored.join()).not.toContain('secret');
    expect(fs.existsSync(path.join(root, 'public'))).toBe(false);
    expect((await post('/api/scenes/Bad_ID/understand', pdf)).status).toBe(400);
    expect(sniff(Buffer.from('%PDF-1.4'))).toMatchObject({ kind: 'pdf' });
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toMatchObject({ kind: 'image', ext: 'png' });
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ kind: 'image', ext: 'jpg' });
  });

  it('routes that are not ours fall through; run needs known uploads', async () => {
    expect((await fetch(`${base}/api/scenes/test-api/files`)).headers.get('x-fell-through')).toBe('1');
    expect((await post('/api/scenes/test-api/understand/run', JSON.stringify({ uploadIds: ['u-00000000'] }))).status).toBe(400);
    expect((await post('/api/scenes/test-api/understand/run', JSON.stringify({ uploadIds: [] }))).status).toBe(400);
    expect((await fetch(`${base}/api/scenes/test-api/understand/review`)).status).toBe(404);
  });

  // these run the whole reader end to end on a generated drawing set: allow for a busy machine
  describe('a vector set, end to end', { timeout: 30_000 }, () => {
    const scene = 'test-vector';
    let job: JobStatus; let doc: UnderstandingDoc; let pages: PagesFile;
    beforeAll(async () => {
      const id = await upload(scene, pdf);
      job = await run(scene, [id], { vision: false });
      const r = await json<{ doc: UnderstandingDoc; pages: PagesFile; review: ReviewFile }>(await fetch(`${base}/api/scenes/${scene}/understand/review`));
      doc = r.doc; pages = r.pages;
    }, 120_000);

    it('runs with progress through four stages and ends done', () => {
      expect(job.state).toBe('done');
      expect(job.stages.map((s) => [s.id, s.state])).toEqual([['read', 'done'], ['render', 'done'], ['understand', 'done'], ['write', 'done']]);
      expect(job.overall).toBe(1);
      expect(job.result).toMatchObject({ path: 'vector', pages: 2 });
      expect(job.result!.rooms).toBeGreaterThan(3);
      expect(job.result!.needLook).toBeGreaterThan(10);
      expect(job.events.some((e) => e.type === 'stage-end')).toBe(true);
    });

    it('writes the three buyer files, every room not confirmed flagged, designs.json empty of unverified numbers', () => {
      for (const f of sceneFiles(scene)) expect(fs.existsSync(f)).toBe(true);
      const extras = JSON.parse(fs.readFileSync(sceneFiles(scene)[1], 'utf8'));
      const flagged = unverifiedRoomsFromExtras(extras);
      expect(Object.keys(flagged).length).toBeGreaterThan(0);
      for (const r of doc.rooms) {
        const fact = r.width.status === 'verified';
        expect(flagged[r.id] === undefined).toBe(fact);
      }
      expect(JSON.parse(fs.readFileSync(sceneFiles(scene)[2], 'utf8'))).toMatchObject({ version: 1, source: 'Imported drawing set, 2 pages', items: {} });
    });

    it('privacy: no file name and no title-block text in any buyer file, status or event; the pages stay in .cache', async () => {
      for (const f of sceneFiles(scene)) {
        const t = fs.readFileSync(f, 'utf8');
        expect(t).not.toContain(PRIVATE_NAME);
        expect(t).not.toContain('secret');
        for (const w of TITLE_BLOCK_TEXT) expect(t.toUpperCase()).not.toContain(w);
      }
      expect(JSON.stringify(job)).not.toContain('secret');
      expect(JSON.parse(fs.readFileSync(sceneFiles(scene)[1], 'utf8')).sourceFile).toBe('drawing set');
      const cache = path.join(root, '.cache/understand', scene);
      expect(fs.existsSync(path.join(cache, 'pages/p1.png'))).toBe(true);
      expect(fs.existsSync(path.join(cache, 'understanding.json'))).toBe(true);
      expect(fs.existsSync(path.join(cache, 'review.json'))).toBe(true);
      // nothing about the drawing is in public/ except the three files
      expect(fs.readdirSync(path.join(root, 'public/scenes', scene)).sort()).toEqual(['designs.json', 'proposal-extras.json', 'proposal.json']);
      expect(fs.readdirSync(path.join(root, 'public/scenes')).length).toBe(1);
      const s = await json<{ visionAvailable: boolean; hasUnderstanding: boolean }>(await fetch(`${base}/api/scenes/${scene}/understand/status`));
      expect(s).toMatchObject({ hasUnderstanding: true, visionAvailable: true });
    });

    it('the page picture and a crop of it come from .cache and are PNGs of the right size', async () => {
      const p = await fetch(`${base}/api/scenes/${scene}/understand/page/1.png?w=800`);
      expect(p.headers.get('content-type')).toBe('image/png');
      const bytes = new Uint8Array(await p.arrayBuffer());
      expect(isPng(bytes)).toBe(true);
      expect(new DataView(bytes.buffer, 16, 8).getUint32(0)).toBe(800);
      const row = buildRows(doc).find((r) => r.kind === 'room-size')!;
      const meta = pages.pages.find((m) => m.n === row.source.page)!;
      const { region, box } = cropRegion(meta, row.source.bbox);
      expect(box).not.toBeNull();
      const c = await fetch(`${base}/api/scenes/${scene}/understand/crop?page=${meta.n}&rect=${region.join(',')}&w=500&turn=${turnOf(meta)}`);
      expect(c.status).toBe(200);
      const cb = new Uint8Array(await c.arrayBuffer());
      expect(isPng(cb)).toBe(true);
      const w = new DataView(cb.buffer, 16, 8).getUint32(0);
      expect(w).toBeLessThanOrEqual(500);
      expect((await fetch(`${base}/api/scenes/${scene}/understand/crop?page=1&rect=1,2,3`)).status).toBe(400);
      expect((await fetch(`${base}/api/scenes/${scene}/understand/page/99.png`)).status).toBe(404);
      expect((await fetch(`${base}/api/scenes/${scene}/understand/crop?page=1&rect=5,5,6,6`)).status).toBe(404);
    });

    it('the crop shows the page where the box says: the room label of the first room row is inside the cropped region', () => {
      // the highlight box must sit inside the region, which must sit inside the page render
      for (const row of buildRows(doc).filter((r) => r.kind === 'room-size' || r.kind === 'opening' || r.kind === 'item-size')) {
        const meta = pages.pages.find((m) => m.n === row.source.page)!;
        const { region, box } = cropRegion(meta, row.source.bbox);
        expect(box).not.toBeNull();
        expect(region[0]).toBeGreaterThanOrEqual(0);
        expect(region[2]).toBeLessThanOrEqual(meta.w);
        expect(box![0]).toBeGreaterThanOrEqual(region[0] - 1);
        expect(box![2]).toBeLessThanOrEqual(region[2] + 1);
        expect(box![1]).toBeGreaterThanOrEqual(region[1] - 1);
        expect(box![3]).toBeLessThanOrEqual(region[3] + 1);
      }
    });

    it('saving the review writes review.json and the three files again: confirm, correct and reject reach the buyer files', async () => {
      const rows = buildRows(doc);
      const room = rows.find((r) => r.kind === 'room-size' && r.baseStatus !== 'verified')!;
      const room2 = rows.find((r) => r.kind === 'room-size' && r.baseStatus !== 'verified' && r.id !== room.id)!;
      const opening = rows.find((r) => r.kind === 'opening')!;
      const at = new Date().toISOString();
      const review: ReviewFile = { version: 1, decisions: { [room.id]: { action: 'confirm', at }, [room2.id]: { action: 'correct', value: [3, 2.5], at }, [opening.id]: { action: 'reject', at } } };
      const before = JSON.parse(fs.readFileSync(sceneFiles(scene)[0], 'utf8')) as { openings: unknown[] };
      const r = await fetch(`${base}/api/scenes/${scene}/understand/review`, { method: 'PUT', body: JSON.stringify(review) });
      expect(r.status).toBe(200);
      const body = await json<{ changed: { rooms: string[]; removedOpenings: string[] }; extras: unknown; progress: { checked: number } }>(r);
      expect(body.progress.checked).toBe(3);
      expect(body.changed.rooms).toEqual([room2.target.kind === 'room' ? room2.target.roomId : '']);
      expect(body.changed.removedOpenings).toHaveLength(1);
      const flagged = unverifiedRoomsFromExtras(JSON.parse(fs.readFileSync(sceneFiles(scene)[1], 'utf8')));
      expect(flagged[room.target.kind === 'room' ? room.target.roomId : '']).toBeUndefined();
      expect(flagged[room2.target.kind === 'room' ? room2.target.roomId : '']).toBeUndefined();
      const after = JSON.parse(fs.readFileSync(sceneFiles(scene)[0], 'utf8')) as { openings: unknown[] };
      expect(after.openings.length).toBe(before.openings.length - 1);
      const saved = JSON.parse(fs.readFileSync(path.join(root, '.cache/understand', scene, 'review.json'), 'utf8')) as ReviewFile;
      expect(Object.keys(saved.decisions).sort()).toEqual([room.id, room2.id, opening.id].sort());
      // the machine file is untouched, so the decisions can be undone
      const again = await json<{ doc: UnderstandingDoc }>(await fetch(`${base}/api/scenes/${scene}/understand/review`));
      expect(JSON.stringify(again.doc)).toBe(JSON.stringify(doc));
      expect(progressOf(buildRows(again.doc, saved)).checked).toBe(3);
      // outputs endpoint agrees with the files
      const out = await json<{ proposal: unknown }>(await fetch(`${base}/api/scenes/${scene}/understand/outputs`));
      expect(JSON.stringify(out.proposal)).toBe(JSON.stringify(JSON.parse(fs.readFileSync(sceneFiles(scene)[0], 'utf8'))));
      // and undoing returns to the machine's flags
      const undo = await fetch(`${base}/api/scenes/${scene}/understand/review`, { method: 'PUT', body: JSON.stringify({ version: 1, decisions: {} }) });
      expect(undo.status).toBe(200);
      expect(Object.keys(unverifiedRoomsFromExtras(JSON.parse(fs.readFileSync(sceneFiles(scene)[1], 'utf8')))).length).toBeGreaterThan(0);
      expect(JSON.parse(fs.readFileSync(sceneFiles(scene)[0], 'utf8')).openings.length).toBe(before.openings.length);
    });

    it('a review file with an unknown value or a bad typed value is refused and writes nothing', async () => {
      const before = fs.readFileSync(path.join(root, '.cache/understand', scene, 'review.json'), 'utf8');
      const at = new Date().toISOString();
      const bad1 = await fetch(`${base}/api/scenes/${scene}/understand/review`, { method: 'PUT', body: JSON.stringify({ version: 1, decisions: { nope: { action: 'confirm', at } } }) });
      expect(bad1.status).toBe(400);
      const room = buildRows(doc).find((r) => r.kind === 'room-size')!;
      const bad2 = await fetch(`${base}/api/scenes/${scene}/understand/review`, { method: 'PUT', body: JSON.stringify({ version: 1, decisions: { [room.id]: { action: 'correct', value: 'wide', at } } }) });
      expect(bad2.status).toBe(400);
      expect((await fetch(`${base}/api/scenes/${scene}/understand/review`, { method: 'PUT', body: '{' })).status).toBe(400);
      expect(fs.readFileSync(path.join(root, '.cache/understand', scene, 'review.json'), 'utf8')).toBe(before);
    });

    it('asking for vision on a vector set sends nothing: the model is never called and the broker is told', async () => {
      const id = await upload('test-vector-v', pdf);
      const calls0 = calls;
      const j = await run('test-vector-v', [id], { vision: true, noticeAccepted: true });
      expect(j.state).toBe('done');
      expect(calls).toBe(calls0);
      expect(j.events.some((e) => e.type === 'warning' && /nothing was sent/.test(e.message ?? ''))).toBe(true);
      expect(j.result!.vision.used).toBe(false);
    });
  });

  describe('a picture of a plan', { timeout: 60_000 }, () => {
    it('with vision off the job fails in words a broker can act on, and nothing is written for the buyer', async () => {
      const id = await upload('test-pic-off', png, 'plan photo.png');
      const j = await run('test-pic-off', [id], { vision: false });
      expect(j.state).toBe('failed');
      expect(j.error).toMatch(/Vision is off/);
      expect(fs.existsSync(path.join(root, 'public/scenes/test-pic-off'))).toBe(false);
    });

    it('vision needs the broker to tick the notice: no tick, no run', async () => {
      const id = await upload('test-pic-notice', png);
      const r = await post('/api/scenes/test-pic-notice/understand/run', JSON.stringify({ uploadIds: [id], vision: true }), { 'content-type': 'application/json' });
      expect(r.status).toBe(400);
      expect((await json<{ error: string }>(r)).error).toMatch(/Tick the notice/);
      expect(calls).toBe(0);
    });

    it('with the notice ticked and a model, the picture is read, everything it said starts unverified, and the audit of what was sent stays in .cache', async () => {
      const scene = 'test-pic-on';
      const id = await upload(scene, png);
      const j = await run(scene, [id], { vision: true, noticeAccepted: true });
      expect(j.error).toBeUndefined();
      expect(j.state).toBe('done');
      expect(j.result).toMatchObject({ path: 'picture' });
      expect(j.result!.vision.used).toBe(true);
      expect(j.result!.vision.calls).toBeGreaterThan(0);
      expect(calls).toBeGreaterThan(0);
      const r = await json<{ doc: UnderstandingDoc }>(await fetch(`${base}/api/scenes/${scene}/understand/review`));
      expect(r.doc.rooms.length).toBeGreaterThan(2);
      // a model's read is never a fact on its own: any room it left unchecked is flagged for the buyer
      const extras = JSON.parse(fs.readFileSync(path.join(root, 'public/scenes', scene, 'proposal-extras.json'), 'utf8'));
      const flagged = unverifiedRoomsFromExtras(extras);
      for (const room of r.doc.rooms) expect(flagged[room.id] === undefined).toBe(room.width.status === 'verified');
      expect(fs.existsSync(path.join(root, '.cache/understand', scene, 'sent.json'))).toBe(true);
      expect(fs.readdirSync(path.join(root, 'public/scenes', scene)).sort()).toEqual(['designs.json', 'proposal-extras.json', 'proposal.json']);
      for (const f of ['proposal.json', 'proposal-extras.json', 'designs.json']) {
        const t = fs.readFileSync(path.join(root, 'public/scenes', scene, f), 'utf8');
        expect(t).not.toContain('secret');
        for (const w of TITLE_BLOCK_TEXT) expect(t.toUpperCase()).not.toContain(w);
      }
      // a crop of the picture comes back turned upright
      const row = buildRows(r.doc).find((x) => x.kind === 'room-size')!;
      const pages = await json<{ pages: PagesFile }>(await fetch(`${base}/api/scenes/${scene}/understand/review`));
      const meta = pages.pages.pages[0];
      expect(meta.kind).toBe('raster');
      const { region } = cropRegion(meta, row.source.bbox);
      const c = await fetch(`${base}/api/scenes/${scene}/understand/crop?page=1&rect=${region.join(',')}&turn=${turnOf(meta)}`);
      expect(isPng(new Uint8Array(await c.arrayBuffer()))).toBe(true);
    }, 120_000);
  });

  it('cancelling a job that has not finished says so, and an unknown job is a 404', async () => {
    expect((await fetch(`${base}/api/scenes/test-api/understand/jobs/j-00000000`, { method: 'DELETE' })).status).toBe(404);
    expect((await fetch(`${base}/api/scenes/test-api/understand/status?job=j-00000000`)).status).toBe(200);
  });

  it('a server that restarts mid-job marks that job failed instead of leaving it running', async () => {
    const dir = path.join(root, '.cache/understand/test-restart/jobs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'j-abcdef01.json'), JSON.stringify({ jobId: 'j-abcdef01', sceneId: 'test-restart', state: 'running', createdAt: new Date().toISOString(), events: [] }));
    expect(jobs.recover()).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'j-abcdef01.json'), 'utf8')).state).toBe('failed');
  });
});
