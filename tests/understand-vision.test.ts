// C12d: the vision providers. Always runs. No test here opens a network socket: global fetch is replaced by a function that throws,
// and each provider is given a stub of its own. No key exists on this machine; every key below is a made-up string.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSet } from '../scripts/make-drawing-sets';
import { buildTwin } from '../scripts/eval/raster-world';
import { runSmoke, smokeKey } from '../scripts/vision-smoke';
import { encodePng, newGray } from '../src/understand/pixels/image';
import { readRasterPages } from '../src/understand/raster';
import { tagImage } from '../src/understand/pixels/lineage';
import { GEMINI_FLASH, GEMINI_PRO, GeminiProvider, geminiSchema } from '../src/understand/vision/gemini';
import { CLAUDE_OPUS, ClaudeProvider, claudeSchema } from '../src/understand/vision/claude';
import { ANTHROPIC_KEY_FILE, GEMINI_KEY_FILE, redact, resolveAnthropicKey, resolveGeminiKey } from '../src/understand/vision/keys';
import { MockVisionProvider, errorsAtRate } from '../src/understand/vision/mock';
import { RecordingProvider, ReplayProvider } from '../src/understand/vision/recorded';
import { PLAN_SCHEMA, LAYOUT_SCHEMA, STRINGS_SCHEMA, boxFromNorm, parseLayout, parsePlanRead } from '../src/understand/vision/prompts';
import { estimateRaster } from '../src/understand/vision/estimate';
import { PRICES, estimateImageTokens, priceOf, usdOf } from '../src/understand/vision/pricing';
import { VisionError } from '../src/understand/vision/provider';

const FAKE = 'AIzaFAKEKEYFORTESTS0000000000000000000';
const png = (w = 64, h = 32): Uint8Array => encodePng(newGray(w, h));
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const geminiAnswer = (obj: unknown, usage = { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 }): Response => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }], usageMetadata: usage });

let realFetch: typeof fetch;
beforeEach(() => { realFetch = globalThis.fetch; vi.stubGlobal('fetch', () => { throw new Error('a test opened the network'); }); });
afterEach(() => { vi.unstubAllGlobals(); globalThis.fetch = realFetch; });

describe('keys', () => {
  const files = (m: Record<string, string>) => (p: string): string | null => (p in m ? m[p] : null);
  it('a key file wins; the environment is read only when allowed, and only the two named variables', () => {
    const home = '/h';
    const f = files({ [GEMINI_KEY_FILE(home)]: ` ${FAKE}\n` });
    expect(resolveGeminiKey({ home, readFile: f, env: { GEMINI_API_KEY: 'other' } })).toEqual({ key: FAKE, from: `file ${GEMINI_KEY_FILE(home)}` });
    expect(resolveGeminiKey({ home, readFile: files({}), env: { GEMINI_API_KEY: 'envkey1' } })?.from).toBe('env GEMINI_API_KEY');
    expect(resolveGeminiKey({ home, readFile: files({}), env: { WALKTHRU_GEMINI_KEY: 'k2', GEMINI_API_KEY: 'k3' } })?.key).toBe('k2');
    expect(resolveGeminiKey({ home, readFile: files({}), env: { GEMINI_API_KEY: 'envkey1' }, allowEnv: false })).toBeNull();
    expect(resolveGeminiKey({ home, readFile: files({}), env: { ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y', GOOGLE_API_KEY: 'z' } })).toBeNull();
  });
  it('the Claude provider refuses to start on the generic ANTHROPIC_API_KEY alone, and says why', () => {
    expect(() => resolveAnthropicKey({ home: '/h', readFile: files({}), env: { ANTHROPIC_API_KEY: 'sk-ant-generic' } })).toThrow(/ANTHROPIC_API_KEY/);
    try { resolveAnthropicKey({ home: '/h', readFile: files({}), env: { ANTHROPIC_API_KEY: 'sk-ant-generic' } }); } catch (e) { expect((e as Error).message).not.toContain('sk-ant-generic'); expect(e).toBeInstanceOf(VisionError); }
    expect(() => resolveAnthropicKey({ home: '/h', readFile: files({}), env: {} })).toThrow(/No Anthropic key/);
    expect(resolveAnthropicKey({ home: '/h', readFile: files({ [ANTHROPIC_KEY_FILE('/h')]: 'sk-own' }), env: { ANTHROPIC_API_KEY: 'sk-ant-generic' } }).key).toBe('sk-own');
    expect(resolveAnthropicKey({ home: '/h', readFile: files({}), env: { WALKTHRU_ANTHROPIC_KEY: 'sk-own2', ANTHROPIC_API_KEY: 'sk-ant-generic' } }).key).toBe('sk-own2');
  });
  it('nothing the browser loads can reach a provider or a key: no client module imports the vision or raster code', () => {
    const root = path.resolve(__dirname, '../src');
    const walk = (d: string, out: string[] = []): string[] => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (p.endsWith('.ts')) out.push(p); } return out; };
    const offenders = walk(root).filter((f) => !f.startsWith(path.join(root, 'understand')) && /understand\/(vision|raster|pixels)/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    expect(fs.readFileSync(path.join(root, 'import/vision.ts'), 'utf8')).not.toMatch(/fetch|process\.env|readFileSync/);
  });
  it('redact removes a key from any text', () => { expect(redact(`bad ${FAKE} here`, FAKE)).toBe('bad [key] here'); });
  it('no source file reads any key but the two named ones: no other variable, and nothing from the GTM folders', () => {
    const walk = (d: string, out: string[] = []): string[] => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (p.endsWith('.ts')) out.push(p); } return out; };
    const files2 = [...walk(path.resolve(__dirname, '../src/understand')), path.resolve(__dirname, '../scripts/vision-smoke.ts'), path.resolve(__dirname, '../scripts/understand-raster.ts')];
    for (const f of files2) {
      const t = fs.readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/Fibr-GTM|GTM Console|\.instantly-key|\.apollo|\.lemlist|\.zerobounce/);
      const envs = [...t.matchAll(/process\.env(?:\.([A-Z_]+)|\[)/g)].map((m) => m[1] ?? '[');
      if (!f.endsWith(path.join('vision', 'keys.ts'))) expect(envs.filter((e) => /KEY|TOKEN|SECRET|GEMINI|ANTHROPIC|GOOGLE|OPENAI/.test(e) || e === '['), `${f} reads a key from the environment`).toEqual([]);
    }
    const keys = fs.readFileSync(path.resolve(__dirname, '../src/understand/vision/keys.ts'), 'utf8');
    const names = new Set([...keys.matchAll(/env\.([A-Z][A-Z0-9_]+)/g), ...keys.matchAll(/'([A-Z][A-Z0-9_]*_(?:KEY|API_KEY))'/g)].map((m) => m[1]));
    expect([...names].sort()).toEqual(['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'WALKTHRU_ANTHROPIC_KEY', 'WALKTHRU_GEMINI_KEY'].sort());
  });
});

describe('Gemini over REST', () => {
  it('builds a request that never carries the key in the URL or the body, and uses the models SPEC 17.8 names', () => {
    const g = new GeminiProvider({ key: FAKE });
    expect([g.model, g.cropModel]).toEqual([GEMINI_PRO, GEMINI_FLASH]);
    const r = (g as unknown as { buildRequest(i: unknown): { url: string; headers: Record<string, string>; body: unknown } }).buildRequest({ system: 's', prompt: 'p', images: [{ label: 'a', png: png() }], schema: STRINGS_SCHEMA, tier: 'crops' });
    expect(r.url).toContain(`/models/${GEMINI_FLASH}:generateContent`);
    expect(r.url).not.toContain(FAKE); expect(JSON.stringify(r.body)).not.toContain(FAKE);
    expect(r.headers['x-goog-api-key']).toBe(FAKE);
    const body = r.body as { generationConfig: { responseSchema: object; responseMimeType: string }; contents: { parts: { inline_data?: { mime_type: string } }[] }[] };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(JSON.stringify(body.generationConfig.responseSchema)).not.toMatch(/\$id|additionalProperties/);
    expect(body.contents[0].parts.some((p) => p.inline_data?.mime_type === 'image/png')).toBe(true);
    expect(geminiSchema({ $id: 'x', type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } })).toEqual({ type: 'object', properties: { a: { type: 'string' } } });
  });
  it('reads crops, drops an answer with no box, and meters tokens and dollars (thinking tokens count as output)', async () => {
    const f = vi.fn(async () => geminiAnswer({ items: [{ id: 'a', text: '2\'-11"', box: [100, 100, 600, 900], confidence: 0.9 }, { id: 'b', text: '3050', box: [], confidence: 0.9 }, { id: 'c', text: '', box: [1, 1, 5, 5], confidence: 1 }] }));
    const g = new GeminiProvider({ key: FAKE, fetch: f as unknown as typeof fetch });
    const out = await g.readStrings([{ id: 'a', png: png(200, 50), hint: 'dimension' }, { id: 'b', png: png(), hint: 'dimension' }, { id: 'c', png: png() }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', text: '2\'-11"' });
    expect(out[0].box).toEqual([20, 5, 180, 30]);
    expect(g.droppedAnswers).toBe(2);
    expect(g.usage()).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 500 });
    expect(g.usage().usd).toBeCloseTo((1000 * 0.75 + 500 * 3.75) / 1e6, 8);
  });
  it('turns a whole-view answer into pixel boxes, and a layout answer too', async () => {
    const view = { rooms: [{ label: 'KITCHEN', size_text: '9\'6"X8\'6"', area_text: '', box: [100, 200, 500, 600], label_box: [] }, { label: 'ghost', size_text: '', area_text: '', box: [], label_box: [] }], dimensions: [{ text: '5\'0"', box: [0, 0, 50, 100], line: [25, 0, 25, 100] }], openings: [{ kind: 'door', box: [0, 0, 100, 100] }], symbols: [{ class: 'bed', label: '', box: [0, 0, 100, 100] }] };
    const g = new GeminiProvider({ key: FAKE, fetch: (async () => geminiAnswer(view)) as unknown as typeof fetch });
    const read = await g.readView(png(1000, 500), 'plan', PLAN_SCHEMA) as ReturnType<typeof parsePlanRead>['read'];
    expect(read.rooms).toHaveLength(1);
    expect(read.rooms[0].box).toEqual([200, 50, 600, 250]);
    expect(read.dimensions[0].line).toEqual([0, 12.5, 100, 12.5]);
    const g2 = new GeminiProvider({ key: FAKE, fetch: (async () => geminiAnswer({ boxes: [{ kind: 'title-block', box: [800, 600, 1000, 1000] }, { kind: 'notes', box: [] }] })) as unknown as typeof fetch });
    const lay = await g2.readView(png(512, 362), 'plan', LAYOUT_SCHEMA) as { boxes: { box: number[] }[] };
    expect(lay.boxes).toHaveLength(1);
    expect(boxFromNorm([0, 0, 500, 500], 100, 100)).toEqual([0, 0, 50, 50]);
    expect(boxFromNorm([10, 10, 5, 5], 100, 100)).toBeNull();
    expect(parseLayout({ boxes: [{ kind: 'x', box: [0, 0, 1000, 1000] }] }, 10, 10)).toHaveLength(1);
  });
  it('retries a busy server, never retries a refusal of the request, and never prints the key', async () => {
    let n = 0;
    const slept: number[] = [];
    const busy = vi.fn(async () => (++n < 3 ? json({ error: 'busy' }, 429) : geminiAnswer({ items: [{ id: 'a', text: '1', box: [0, 0, 10, 10], confidence: 1 }] })));
    const g = new GeminiProvider({ key: FAKE, fetch: busy as unknown as typeof fetch, sleep: async (ms) => { slept.push(ms); } });
    expect(await g.readStrings([{ id: 'a', png: png() }])).toHaveLength(1);
    expect(busy).toHaveBeenCalledTimes(3); expect(slept).toHaveLength(2);
    const bad = vi.fn(async () => json({ error: { message: `bad key ${FAKE}` } }, 403));
    const g2 = new GeminiProvider({ key: FAKE, fetch: bad as unknown as typeof fetch, sleep: async () => undefined });
    const err = await g2.readStrings([{ id: 'a', png: png() }]).catch((e) => e as Error);
    expect(err).toBeInstanceOf(VisionError);
    expect((err as Error).message).toContain('403'); expect((err as Error).message).not.toContain(FAKE);
    expect(bad).toHaveBeenCalledTimes(1);
    const dead = vi.fn(async () => { throw new Error(`socket closed for ${FAKE}`); });
    const g3 = new GeminiProvider({ key: FAKE, fetch: dead as unknown as typeof fetch, sleep: async () => undefined, maxRetries: 1 });
    const e3 = await g3.classify([{ id: 'a', png: png() }], ['plan', 'notes']).catch((e) => e as Error);
    expect((e3 as Error).message).not.toContain(FAKE); expect(dead).toHaveBeenCalledTimes(2);
  });
  it('classifies only into the choices it was given', async () => {
    const g = new GeminiProvider({ key: FAKE, fetch: (async () => geminiAnswer({ items: [{ id: 'a', choice: 'plan', confidence: 0.9 }, { id: 'b', choice: 'banana', confidence: 0.9 }] })) as unknown as typeof fetch });
    const out = await g.classify([{ id: 'a', png: png() }, { id: 'b', png: png() }], ['plan', 'elevation']);
    expect(out.map((o) => o.id)).toEqual(['a']);
  });
});

describe('Claude over REST', () => {
  it('builds a structured-output request with the own key in the header, and refuses a generic one', () => {
    const c = new ClaudeProvider({ key: 'sk-own' });
    expect(c.model).toBe(CLAUDE_OPUS);
    const r = (c as unknown as { buildRequest(i: unknown): { headers: Record<string, string>; body: { output_config: { format: { type: string; schema: object } }; model: string; tool_choice?: unknown; temperature?: unknown } } }).buildRequest({ system: 's', prompt: 'p', images: [{ label: 'plan', png: png() }], schema: PLAN_SCHEMA, tier: 'view' });
    expect(r.headers['x-api-key']).toBe('sk-own'); expect(r.headers['anthropic-version']).toBe('2023-06-01');
    expect(r.body.output_config.format.type).toBe('json_schema');
    expect(JSON.stringify(r.body.output_config.format.schema)).not.toContain('$id');
    expect(r.body.tool_choice).toBeUndefined(); expect(r.body.temperature).toBeUndefined();
    const closed = claudeSchema({ type: 'object', properties: { a: { type: 'object', properties: {} } } }) as { additionalProperties: boolean; properties: { a: { additionalProperties: boolean } } };
    expect(closed.additionalProperties).toBe(false); expect(closed.properties.a.additionalProperties).toBe(false);
    expect(() => resolveAnthropicKey({ home: '/h', readFile: () => null, env: { ANTHROPIC_API_KEY: 'sk-generic' } })).toThrow(VisionError);
  });
  it('reads a whole view and meters it at the Opus price', async () => {
    const f = vi.fn(async () => json({ content: [{ type: 'text', text: JSON.stringify({ rooms: [{ label: 'HALL', size_text: '', area_text: '', box: [0, 0, 500, 500], label_box: [] }], dimensions: [], openings: [], symbols: [] }) }], stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 400 } }));
    const c = new ClaudeProvider({ key: 'sk-own', fetch: f as unknown as typeof fetch });
    const read = await c.readView(png(400, 400), 'plan', PLAN_SCHEMA) as { rooms: { box: number[] }[] };
    expect(read.rooms[0].box).toEqual([0, 0, 200, 200]);
    expect(c.usage().usd).toBeCloseTo((2000 * 4 + 400 * 20) / 1e6, 8);
    const refuse = new ClaudeProvider({ key: 'sk-own', fetch: (async () => json({ content: [], stop_reason: 'refusal' })) as unknown as typeof fetch });
    await expect(refuse.readView(png(), 'plan', PLAN_SCHEMA)).rejects.toMatchObject({ code: 'refused' });
  });
});

describe('prices and estimates', () => {
  it('the table is the 13 Nov 2026 snapshot, with the dates the prices change', () => {
    expect(priceOf('gemini-3.8-flash', new Date('2026-11-13'))).toMatchObject({ inPerM: 0.75, outPerM: 3.75 });
    expect(priceOf('gemini-3.8-flash', new Date('2027-01-02'))).toMatchObject({ inPerM: 1.5, outPerM: 7.5 });
    expect(priceOf('gemini-4-carbon', new Date('2026-11-20'))).toMatchObject({ inPerM: 2, outPerM: 10 });
    expect(priceOf('gemini-4-carbon', new Date('2026-12-02'))).toMatchObject({ inPerM: 4, outPerM: 20 });
    expect(Object.keys(PRICES)).toEqual(expect.arrayContaining(['gemini-3.1-pro-preview', 'claude-opus-5-5']));
    expect(usdOf('claude-opus-5-5', 1e6, 1e6, new Date('2026-11-13'))).toBe(24);
    expect(estimateImageTokens(1400, 2000)).toBe(2 * 3 * 258);
  });
  it('a one page brochure run is estimated inside the SPEC 17.13 range of 10 to 30 cents', () => {
    const e = estimateRaster({ pages: 1 });
    expect(e.calls).toBe(7); // a layout read, the plan question, the plan itself, and four batches of crops
    expect(e.usd).toBeGreaterThan(0.05); expect(e.usd).toBeLessThan(0.3);
    expect(e.lines).toHaveLength(4);
  });
});

describe('the simulated model', () => {
  const twin = buildTwin(buildSet(2));
  const run = (e: Parameters<typeof errorsAtRate>[0] | Record<string, number | boolean>) => readRasterPages(twin.pages, { provider: new MockVisionProvider(twin.world, typeof e === 'number' ? errorsAtRate(e, 3) : e) });
  it('answers from truth and nothing else: an exact model gets every room, opening and dimension string', async () => {
    const r = await run({});
    expect(r.status).toBe('ok');
    expect(r.understanding.rooms).toHaveLength(6); expect(r.understanding.dimensions).toHaveLength(14);
    const want = new Set(twin.truth.dimensions.map((d) => d.string));
    for (const d of r.understanding.dimensions) expect(want.has(d.value.source.text ?? '')).toBe(true);
  }, 60000);
  it('wrong digits make strings differ and never make a wrong value verified', async () => {
    const r = await run({ seed: 5, wrongDigits: 0.5 });
    const want = new Set(twin.truth.dimensions.map((d) => d.string));
    // the two looks disagree on many strings, and the one that agrees with the pixels is kept with the other as an alternative
    expect(r.understanding.dimensions.filter((d) => d.value.alternatives?.length).length).toBeGreaterThan(3);
    for (const d of r.understanding.dimensions) if (!want.has(d.value.source.text ?? '')) expect(d.value.status).not.toBe('verified');
  }, 60000);
  it('missing boxes and dropped items shrink the answer; invented rooms with no wall under them are thrown out', async () => {
    const miss = await run({ seed: 5, missingBoxes: 0.4 });
    expect(miss.understanding.dimensions.length).toBeLessThan(14);
    const drop = await run({ seed: 5, dropped: 0.4 });
    expect(drop.understanding.rooms.length).toBeLessThan(6);
    const fake = await run({ seed: 5, hallucinated: 12 });
    expect(fake.understanding.rooms.length).toBeLessThanOrEqual(8);
    expect(fake.understanding.warnings.join(' ')).toMatch(/no walls under them|dimension line/);
  }, 120000);
  it('swapped labels change a room\'s type but never its size, which comes from the walls', async () => {
    const exact = await run({});
    const swap = await run({ seed: 5, swapped: 1 });
    const sizes = (r: typeof exact): number[] => r.understanding.rooms.map((x) => Math.round(x.area.value * 10) / 10).sort((a, b) => a - b);
    expect(sizes(swap)).toEqual(sizes(exact));
    expect(swap.understanding.rooms.map((x) => x.roomType.value).join()).not.toBe(exact.understanding.rooms.map((x) => x.roomType.value).join());
  }, 120000);
  it('a model that lies the same way every time, and scales every number by 1.25, cannot get a wrong value verified', async () => {
    const r = await run({ seed: 5, uniformScale: 1.25, consistent: true, wrongDigits: 0.3 });
    const verified = [...r.understanding.rooms.flatMap((x) => [x.width, x.length, x.area]), ...r.understanding.dimensions.map((d) => d.value)].filter((v) => v.status === 'verified');
    expect(verified).toHaveLength(0);
  }, 60000);
  it('is metered like a real provider: calls, tokens, dollars and a latency figure', async () => {
    const r = await run({});
    expect(r.cost.visionCalls).toBeGreaterThanOrEqual(4);
    expect(r.cost.inputTokens).toBeGreaterThan(1000); expect(r.cost.outputTokens).toBeGreaterThan(1000);
    expect(r.cost.usd).toBeGreaterThan(0.02); expect(r.cost.usd).toBeLessThan(0.6);
    expect(r.cost.seconds).toBeGreaterThan(30);
    expect(r.understanding.cost).toEqual(r.cost);
  }, 60000);
  it('a picture it was not shown through the pipeline is refused rather than guessed', async () => {
    const m = new MockVisionProvider(twin.world);
    await expect(m.readView(png(), 'plan', PLAN_SCHEMA)).rejects.toThrow(/no record/);
    const p = png(); tagImage(p, { pageId: 'zz', kind: 'crop', fromOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1], rectOriginal: [0, 0, 1, 1], size: { w: 64, h: 32 } });
    await expect(m.readView(p, 'plan', PLAN_SCHEMA)).rejects.toThrow(/no description/);
  });
  it('a recording replays the same run without the model', async () => {
    const rec = new RecordingProvider(new MockVisionProvider(twin.world, errorsAtRate(0.05, 9)));
    const first = await readRasterPages(twin.pages, { provider: rec });
    const replay = await readRasterPages(twin.pages, { provider: new ReplayProvider(JSON.parse(JSON.stringify(rec.recording))) });
    expect(replay.status).toBe('ok');
    expect(JSON.stringify(replay.understanding.rooms)).toBe(JSON.stringify(first.understanding.rooms));
    expect(JSON.stringify(replay.understanding.dimensions)).toBe(JSON.stringify(first.understanding.dimensions));
    expect(replay.cost.usd).toBe(0);
    await expect(readRasterPages([{ id: 'p1', image: newGray(300, 200) }], { provider: new ReplayProvider(rec.recording) })).rejects.toThrow(/Nothing was recorded|no drawing/);
  }, 120000);
});

describe('the live smoke test', () => {
  it('skips, and sends nothing, when the key file is absent', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-nokey-'));
    const lines: string[] = [];
    const never = vi.fn(async () => { throw new Error('network'); });
    const res = await runSmoke({ home, env: { GEMINI_API_KEY: FAKE }, yes: true, log: (s) => lines.push(s), fetch: never as unknown as typeof fetch });
    expect(res.status).toBe('skipped');
    expect(lines.join('\n')).toMatch(/SKIP: no key at .*\.gemini-key/);
    expect(never).not.toHaveBeenCalled();
    expect(smokeKey({ home, env: { GEMINI_API_KEY: FAKE } })).toBeNull(); // the environment is not read without --env-key
    expect(smokeKey({ home, env: { GEMINI_API_KEY: FAKE }, envKey: true })?.from).toBe('env GEMINI_API_KEY');
    expect((await runSmoke({ home, claude: true, env: { ANTHROPIC_API_KEY: 'sk-generic' }, envKey: true, log: () => undefined })).status).toBe('skipped');
  });
  it('with a key it prints the estimate and stops until --yes', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-key-'));
    fs.mkdirSync(path.join(home, 'walkthru-tools'));
    const lines: string[] = [];
    const never = vi.fn(async () => { throw new Error('network'); });
    const res = await runSmoke({ home, log: (s) => lines.push(s), readFile: (p) => (p.endsWith('.gemini-key') ? FAKE : null), fetch: never as unknown as typeof fetch });
    expect(res.status).toBe('estimated');
    expect(lines.join('\n')).toMatch(/Estimated live run/); expect(lines.join('\n')).toMatch(/sent to an AI model provider/);
    expect(lines.join('\n')).not.toContain(FAKE);
    expect(never).not.toHaveBeenCalled();
  }, 60000);
});
