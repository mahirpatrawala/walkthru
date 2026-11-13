// C12f acceptance (SPEC 17.14): the endpoint's paths, with the model stubbed and fetch forbidden.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDayCounter, handlePhoto, readPhotoEnv } from '../src/photo/server/handler';
import type { Generate } from '../src/photo/server/handler';
import { API_REVISION, buildInteractionBody, callGemini, extractImage, redact } from '../src/photo/server/gemini';
import { walkthruPhotoApi } from '../src/photo/server/plugin';
import { DEFAULT_MODEL, QUALITY_MODEL, PHOTO_PROMPT } from '../src/photo/config';

// a 1x1 JPEG and PNG, enough for the magic-byte checks
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64').toString('base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');
const body = (o: Record<string, unknown> = {}): string => JSON.stringify({ frame: JPEG, guide: PNG, aspect: '3:2', ...o });
const on = { WALKTHRU_PHOTO_ENABLED: '1' };

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('no network in tests'); }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('env', () => {
  it('is off unless WALKTHRU_PHOTO_ENABLED is set (0 and false count as off)', () => {
    expect(readPhotoEnv({}, 'k').enabled).toBe(false);
    expect(readPhotoEnv({ WALKTHRU_PHOTO_ENABLED: '0' }, 'k').enabled).toBe(false);
    expect(readPhotoEnv({ WALKTHRU_PHOTO_ENABLED: 'false' }, 'k').enabled).toBe(false);
    expect(readPhotoEnv(on, 'k').enabled).toBe(true);
  });
  it('model and daily cap come from env with the spec defaults', () => {
    const d = readPhotoEnv(on, 'k');
    expect(d.model).toBe(DEFAULT_MODEL);
    expect(d.model).toBe('gemini-nano-banana-2.1');
    expect(d.dailyCap).toBe(50);
    const q = readPhotoEnv({ ...on, WALKTHRU_PHOTO_MODEL: QUALITY_MODEL, WALKTHRU_PHOTO_DAILY_CAP: '7' }, 'k');
    expect(q.model).toBe('gemini-3-pro-image');
    expect(q.dailyCap).toBe(7);
    expect(readPhotoEnv({ ...on, WALKTHRU_PHOTO_DAILY_CAP: 'lots' }, 'k').dailyCap).toBe(50);
  });
  it('a blank key is no key', () => {
    expect(readPhotoEnv(on, '  \n').key).toBeNull();
    expect(readPhotoEnv(on, null).key).toBeNull();
  });
});

describe('handlePhoto', () => {
  const echo: Generate = async (i) => ({ data: i.frameB64, mime: 'image/jpeg' });
  const deps = (env: Record<string, string>, key: string | null, generate?: Generate) => ({ env: readPhotoEnv(env, key), counter: createDayCounter(), generate });

  it('GET says disabled when off, not configured when there is no key, ready when both', async () => {
    expect((await handlePhoto('GET', null, deps({}, 'k'))).body).toMatchObject({ enabled: false });
    expect((await handlePhoto('GET', null, deps(on, null))).body).toMatchObject({ enabled: true, configured: false });
    expect((await handlePhoto('GET', null, deps(on, 'k'))).body).toMatchObject({ enabled: true, configured: true, remainingToday: 50 });
  });
  it('POST when off: 404 disabled, and the model is never asked', async () => {
    const gen = vi.fn(echo);
    const r = await handlePhoto('POST', body(), deps({}, 'k', gen));
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ ok: false, error: 'disabled' });
    expect(gen).not.toHaveBeenCalled();
  });
  it('POST when enabled but no key: 503 "not configured", cleanly', async () => {
    const gen = vi.fn(echo);
    const r = await handlePhoto('POST', body(), deps(on, null, gen));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, error: 'not-configured', message: 'AI photo is not configured on this server.' });
    expect(gen).not.toHaveBeenCalled();
  });
  it('rejects bad requests before spending anything', async () => {
    const gen = vi.fn(echo);
    const d = deps(on, 'k', gen);
    for (const b of ['not json', body({ frame: 'AAAA' }), body({ guide: '###' }), body({ aspect: 'wide' }), body({ frame: PNG }), JSON.stringify({})]) {
      const r = await handlePhoto('POST', b, d);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.body).toMatchObject({ ok: false, error: 'bad-request' });
    }
    expect((await handlePhoto('POST', null, d)).status).toBe(413);
    expect((await handlePhoto('PUT', body(), d)).status).toBe(405);
    expect(gen).not.toHaveBeenCalled();
    expect(d.counter.used()).toBe(0);
  });
  it('answers an image with the stubbed model', async () => {
    const r = await handlePhoto('POST', body(), deps(on, 'k', echo));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, image: JPEG, mime: 'image/jpeg' });
  });
  it('passes the configured model, the frame, the guide and the aspect to the model', async () => {
    const gen = vi.fn(echo);
    await handlePhoto('POST', body({ aspect: '16:9' }), deps({ ...on, WALKTHRU_PHOTO_MODEL: QUALITY_MODEL }, 'k', gen));
    expect(gen).toHaveBeenCalledWith({ model: 'gemini-3-pro-image', frameB64: JPEG, frameMime: 'image/jpeg', guideB64: PNG, guideMime: 'image/png', aspect: '16:9' });
  });
  it('the daily cap stops the calls and says so', async () => {
    const d = deps({ ...on, WALKTHRU_PHOTO_DAILY_CAP: '2' }, 'k', echo);
    expect((await handlePhoto('POST', body(), d)).status).toBe(200);
    expect((await handlePhoto('POST', body(), d)).status).toBe(200);
    const r = await handlePhoto('POST', body(), d);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ ok: false, error: 'cap' });
    expect((await handlePhoto('GET', null, d)).body).toMatchObject({ remainingToday: 0 });
  });
  it('the cap rolls over at the next UTC day', () => {
    const c = createDayCounter();
    const d1 = new Date('2026-11-13T23:59:00Z'), d2 = new Date('2026-11-14T00:01:00Z');
    expect(c.take(1, d1)).toBe(true);
    expect(c.take(1, d1)).toBe(false);
    expect(c.take(1, d2)).toBe(true);
  });
  it('a failing model gives a plain message with no detail and no key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await handlePhoto('POST', body(), { env: readPhotoEnv(on, 'SECRET-KEY-123'), counter: createDayCounter() }); // real callGemini, fetch throws
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain('SECRET-KEY-123');
    expect(JSON.stringify(r.body)).not.toContain('no network');
    for (const c of warn.mock.calls) expect(String(c[0])).not.toContain('SECRET-KEY-123');
    warn.mockRestore();
  });
});

describe('Gemini request and response (shapes from Google\'s Interactions API schema)', () => {
  const input = { model: DEFAULT_MODEL, frameB64: 'FRAME', frameMime: 'image/jpeg', guideB64: 'GUIDE', guideMime: 'image/png', aspect: '3:2' };
  it('builds one interaction: prompt, frame, guide, image response format, nothing stored', () => {
    const b = buildInteractionBody(input) as { model: string; input: { type: string; text?: string; data?: string; mime_type?: string }[]; response_format: Record<string, string>; store: boolean };
    expect(b.model).toBe('gemini-nano-banana-2.1');
    expect(b.input.map((x) => x.type)).toEqual(['text', 'image', 'image']);
    expect(b.input[0].text).toBe(PHOTO_PROMPT);
    expect(b.input[1]).toMatchObject({ mime_type: 'image/jpeg', data: 'FRAME' });
    expect(b.input[2]).toMatchObject({ mime_type: 'image/png', data: 'GUIDE' });
    expect(b.response_format).toMatchObject({ type: 'image', aspect_ratio: '3:2', image_size: '1K', delivery: 'inline' });
    expect(b.store).toBe(false);
    expect(PHOTO_PROMPT).toMatch(/do not add or remove furniture/i);
  });
  it('sends the key in a header, never in the URL or the body', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/jpeg', data: 'IMG' }] }] }), { status: 200 }));
    const out = await callGemini('KEY-XYZ', input, f as unknown as typeof fetch);
    expect(out).toEqual({ data: 'IMG', mime: 'image/jpeg' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(url).not.toContain('KEY-XYZ');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY-XYZ');
    expect((init.headers as Record<string, string>)['Api-Revision']).toBe(API_REVISION);
    expect(String(init.body)).not.toContain('KEY-XYZ');
  });
  it('finds the image among thought and text steps; null when there is none', () => {
    const j = { steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: 'here' }, { type: 'image', data: 'D', mime_type: 'image/png' }] }] };
    expect(extractImage(j)).toEqual({ data: 'D', mime: 'image/png' });
    expect(extractImage({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'no' }] }] })).toBeNull();
    expect(extractImage({})).toBeNull();
    expect(extractImage(null)).toBeNull();
  });
  it('redact removes the key', () => { expect(redact('a KEY b KEY', 'KEY')).toBe('a [key] b [key]'); });
});

describe('dev middleware', () => {
  async function run(opts: Parameters<typeof walkthruPhotoApi>[0], req: { method: string; body?: string }): Promise<{ status: number; json: Record<string, unknown> }> {
    const plugin = walkthruPhotoApi(opts);
    const stack: ((rq: http.IncomingMessage, rs: http.ServerResponse, next: () => void) => void)[] = [];
    (plugin.configureServer as (s: unknown) => void)({ middlewares: { use: (fn: never) => stack.push(fn) } });
    const server = http.createServer((rq, rs) => stack[0](rq, rs, () => { rs.statusCode = 404; rs.end('{}'); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch.call(globalThis, `http://127.0.0.1:${port}/api/photo`, { method: req.method, body: req.body }).catch(() => null);
      return { status: res?.status ?? 0, json: res ? await res.json() : {} };
    } finally { server.close(); }
  }
  it('is a clean "not configured" when ~/walkthru-tools/.gemini-key does not exist', async () => {
    // fetch is stubbed to throw in this file, so talk to the server with node:http instead
    vi.unstubAllGlobals();
    const missing = path.join(os.tmpdir(), `no-such-key-${Date.now()}`);
    const get = await run({ keyFile: missing, env: on }, { method: 'GET' });
    expect(get.json).toMatchObject({ enabled: true, configured: false });
    const post = await run({ keyFile: missing, env: on }, { method: 'POST', body: body() });
    expect(post.status).toBe(503);
    expect(post.json).toMatchObject({ error: 'not-configured' });
  });
  it('reads the key file when it exists and reports configured; off stays off', async () => {
    vi.unstubAllGlobals();
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-key-')), '.gemini-key');
    fs.writeFileSync(f, 'dummy-key\n');
    expect((await run({ keyFile: f, env: on }, { method: 'GET' })).json).toMatchObject({ enabled: true, configured: true });
    expect((await run({ keyFile: f, env: {} }, { method: 'GET' })).json).toMatchObject({ enabled: false });
  });
});
