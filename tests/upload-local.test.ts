// The loader indirection (an uploaded home is read from the browser's own store through `fetch`), the tags that mark it everywhere,
// and the one thin edit the buyer page makes for it.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { answerFor, installLocalScene } from '../src/upload/local-fetch';
import { openStore } from '../src/upload/store';
import type { StoredHome } from '../src/upload/store';
import type { HomeData } from '../src/upload/read-core';
import { ORIGIN_TAG, sceneOrigin, sceneTagText } from '../src/buyer/scene-tag';
import { isBuiltIn } from '../src/buyer/my-layout';
import { SAMPLE_UPLOAD_TAG, UPLOAD_TAG } from '../src/upload/tag';
import { compareScenes } from '../src/start/manifest';
import type { SceneEntry } from '../src/start/manifest';

const ID = 'local-abcdefgh12';
const rec: StoredHome = {
  id: ID, createdAt: '2026-01-01', source: 'file',
  data: { property: { id: ID, title: 'Mine' }, extras: { rooms: [] }, designs: { version: 1, source: 'x', items: {} } } as unknown as HomeData,
};

describe('answerFor', () => {
  it('serves the three files the buyer page reads, from the stored home', async () => {
    expect(await answerFor(rec, ID, `/scenes/${ID}/property.json`)!.json()).toEqual({ id: ID, title: 'Mine' });
    expect(await answerFor(rec, ID, `/scenes/${ID}/proposal-extras.json`)!.json()).toEqual({ rooms: [] });
    expect((await answerFor(rec, ID, `/scenes/${ID}/designs.json`)!.json() as { version: number }).version).toBe(1);
  });
  it('answers 404 for the optional files an upload does not have (look, design sheet, baked lighting): the page then uses its standard ones', () => {
    for (const f of ['look.json', 'design.json', 'baked/manifest.json', 'scene.ply']) expect(answerFor(rec, ID, `/scenes/${ID}/${f}`)!.status).toBe(404);
  });
  it('answers 404 for everything when this device does not have the home, and leaves other URLs alone', () => {
    expect(answerFor(null, ID, `/scenes/${ID}/property.json`)!.status).toBe(404);
    expect(answerFor(rec, ID, '/scenes/test-sample-1/property.json')).toBeNull();
    expect(answerFor(rec, ID, '/characters/man.glb')).toBeNull();
  });
});

describe('installLocalScene', () => {
  it('answers the home’s URLs without a network call and passes everything else to the real fetch', async () => {
    const store = openStore(null, null);
    await store.put(rec);
    const calls: string[] = [];
    const target = { fetch: (async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response('real'); }) as typeof fetch };
    const home = await installLocalScene(ID, store, target);
    expect(home?.id).toBe(ID);
    const r = await target.fetch(`/scenes/${ID}/property.json`, { cache: 'no-cache' });
    expect((await r.json() as { title: string }).title).toBe('Mine');
    expect((await target.fetch(`/scenes/${ID}/look.json`)).status).toBe(404);
    expect(await (await target.fetch('/api/photo')).text()).toBe('real');
    expect(calls).toEqual(['/api/photo']);
  });
  it('is a no-op for an id that is not an upload', async () => {
    const target = { fetch: (async () => new Response('real')) as typeof fetch };
    const before = target.fetch;
    expect(await installLocalScene('test-sample-1', openStore(null, null), target)).toBeNull();
    expect(target.fetch).toBe(before);
  });
});

describe('the honesty tags an uploaded home carries', () => {
  it('origin, card tag and in-walk tag', () => {
    expect(sceneOrigin({ id: ID })).toBe('upload');
    expect(sceneOrigin({ id: ID, subtitle: 'Made-up sample plan' })).toBe('upload');
    expect(sceneOrigin({ id: 'test-sample-1' })).toBe('sample');
    expect(ORIGIN_TAG.upload).toBe('Read automatically from your upload · not checked by a person');
    expect(sceneTagText({ id: ID, subtitle: 'Read from an uploaded plan' })).toBe(UPLOAD_TAG);
    expect(sceneTagText({ id: ID, subtitle: 'Made-up sample plan, read in your browser' })).toBe(SAMPLE_UPLOAD_TAG);
  });
  it('an uploaded plan is a real drawing for built-ins: its wardrobes and counters are fixed work, as in any real drawing', () => {
    expect(isBuiltIn({ id: 'w', kind: 'wardrobe', source: 'real' }, { origin: 'upload', designed: new Set() })).toBe(true);
    expect(isBuiltIn({ id: 'w', kind: 'wardrobe', source: 'real' }, { origin: 'sample', designed: new Set() })).toBe(false);
  });
  it('uploads sort after the shipped homes', () => {
    const e = (id: string, origin: SceneEntry['origin']): SceneEntry => ({ id, title: id, origin, layout: {} as SceneEntry['layout'], unverified: {} });
    expect([e('u', 'upload'), e('v', 'video'), e('s', 'sample'), e('r', 'real')].sort(compareScenes).map((x) => x.id)).toEqual(['r', 's', 'v', 'u']);
  });
});

describe('the buyer page edit stays small and in one place', () => {
  const main = fs.readFileSync(path.resolve(import.meta.dirname, '../src/buyer/main.ts'), 'utf8');
  it('installs the loader before any file is fetched, and only for local ids', () => {
    expect(main).toContain("from '../upload/tag'");
    expect(main.match(/installLocalScene\(/g)?.length).toBe(1);
    expect(main.indexOf('installLocalScene(')).toBeLessThan(main.indexOf('fetchDesigns(sceneId)'));
    expect(main.indexOf('installLocalScene(')).toBeLessThan(main.indexOf('fetchProperty(sceneId)'));
  });
  it('never mounts the AI photo (which sends a picture to a server) for an uploaded plan', () => {
    expect(main).toMatch(/if \(!uploaded\) (?:cleanup\.push\()?mountAiPhoto\(/);
  });
  it('the buyer page loads no reader code: only the tag file and two lazy imports', () => {
    expect(main.match(/from '\.\.\/upload\/[^']+'/g)).toEqual(["from '../upload/tag'"]);
    expect([...new Set(main.match(/import\('\.\.\/upload\/[^']+'\)/g))].sort()).toEqual(["import('../upload/local-fetch')", "import('../upload/notes-panel')"]);
  });
});
