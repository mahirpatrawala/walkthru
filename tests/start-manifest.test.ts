// The scene manifest (public/scenes/index.json) and the floor-plan picture the start page draws from it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanScenes } from '../scripts/make-scene-index';
import { sceneOrigin } from '../src/buyer/scene-tag';
import { crowdedExtras, crowdedFurniture, crowdedLayout } from './helpers/crowded-flat';
import { buildSceneIndex, sceneEntry } from '../src/start/manifest';
import { planSvg, roomSizeLine } from '../src/start/plan-svg';

const scenesDir = path.resolve('public/scenes');
// a property.json for the generic crowded fixture (no real drawing involved)
const crowdedProperty = (id = 'my-home'): unknown => ({
  version: 1, id, title: 'Crowded flat', layout: crowdedLayout, furniture: crowdedFurniture, spawn: { x: -1.81, z: 1.43, yawDeg: 180 }, updatedAt: '2026-01-01T00:00:00Z',
});
const read = (id: string, f = 'property.json'): unknown => JSON.parse(fs.readFileSync(path.join(scenesDir, id, f), 'utf8'));

describe('sceneOrigin', () => {
  it('tags test scenes as samples, video scenes as video, and drawings as yours', () => {
    expect(sceneOrigin({ id: 'test-flat' })).toBe('sample');
    expect(sceneOrigin({ id: 'test-sample-2bhk', subtitle: undefined })).toBe('sample');
    expect(sceneOrigin({ id: 'video-x', subtitle: 'Synthetic scene with known sizes', hasSplat: true })).toBe('video');
    expect(sceneOrigin({ id: 'my-home', subtitle: 'Synthetic scene' })).toBe('sample');
    expect(sceneOrigin({ id: 'my-home', hasSplat: true })).toBe('video');
    expect(sceneOrigin({ id: 'my-home' })).toBe('real');
  });
});

describe('the manifest', () => {
  it('keeps only plan geometry: no furniture, finishes, designs or the source drawing', () => {
    const { entry } = sceneEntry({ id: 'my-home', property: crowdedProperty(), extras: crowdedExtras });
    expect(entry).not.toBeNull();
    const json = JSON.stringify(entry);
    expect(Object.keys(entry!)).toEqual(['id', 'title', 'origin', 'layout', 'unverified']);
    expect(Object.keys(entry!.layout).sort()).toEqual(['openings', 'railingHeightM', 'rooms', 'wallHeightM', 'wallThicknessM']);
    expect(json).not.toMatch(/sourceFile|furniture|finishes|underlay|"kind"|"wardrobe"/i);
    expect(entry!.origin).toBe('real');
    // the extras say the second bedroom's size is only the label's and the hall runs off the sheet
    expect(entry!.unverified['second']).toBeTruthy();
    expect(entry!.unverified['hall']).toBe('runs off the drawing');
    expect(entry!.unverified['main']).toBeUndefined();
  });

  it('keeps `partial` from the raw file whatever the parser keeps', () => {
    const raw = structuredClone(read('test-flat')) as { layout: { rooms: { id: string; partial?: { reason: string } }[] } };
    raw.layout.rooms.find((r) => r.id === 'passage')!.partial = { reason: 'runs off the sheet' };
    const { entry } = sceneEntry({ id: 'test-flat', property: raw });
    expect(entry!.layout.rooms.find((r) => r.id === 'passage')!.partial).toEqual({ reason: 'runs off the sheet' });
    expect(entry!.layout.rooms.find((r) => r.id === 'bedroom')!.partial).toBeUndefined();
  });

  it('orders real drawings first, then test-sample-* homes, then the older test flats, then phone video', () => {
    const p = read('test-flat') as { id: string };
    const mk = (id: string, extra: Record<string, unknown> = {}) => ({ id, property: { ...(p as object), id, ...extra } });
    const idx = buildSceneIndex([
      mk('video-x'), mk('test-flat'), mk('test-sample-3bhk'),
      { id: 'my-home', property: crowdedProperty() }, mk('test-sample-1bhk'), mk('test-sample-10bhk'), mk('test-sample-2bhk'),
    ]);
    expect(idx.scenes.map((s) => s.id)).toEqual(['my-home', 'test-sample-1bhk', 'test-sample-2bhk', 'test-sample-3bhk', 'test-sample-10bhk', 'test-flat', 'video-x']);
  });

  it('skips an unusable folder and says why, without losing the others', () => {
    const warnings: string[] = [];
    const idx = buildSceneIndex([
      { id: 'good', property: read('test-flat') }, { id: 'broken', property: { version: 1 } }, { id: 'Bad Name', property: read('test-flat') },
    ], (m) => warnings.push(m));
    expect(idx.scenes.map((s) => s.id)).toEqual(['good']);
    expect(warnings).toHaveLength(2);
  });

  it('picks up a new scene folder with no code change', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-scenes-'));
    try {
      const put = (id: string): void => {
        fs.mkdirSync(path.join(dir, id));
        fs.writeFileSync(path.join(dir, id, 'property.json'), JSON.stringify({ ...(read('test-flat') as object), id }));
      };
      put('test-sample-1bhk');
      expect(scanScenes(dir, () => {}).scenes.map((s) => s.id)).toEqual(['test-sample-1bhk']);
      put('test-sample-2bhk');
      fs.mkdirSync(path.join(dir, 'no-property'));
      fs.mkdirSync(path.join(dir, 'bad-json'));
      fs.writeFileSync(path.join(dir, 'bad-json', 'property.json'), '{ nope');
      fs.writeFileSync(path.join(dir, 'index.json'), '{}');
      const ids = scanScenes(dir, () => {}).scenes.map((s) => s.id);
      expect(ids).toEqual(['test-sample-1bhk', 'test-sample-2bhk']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists every real scene folder in the repo', () => {
    const ids = scanScenes(scenesDir, () => {}).scenes.map((s) => s.id);
    for (const d of fs.readdirSync(scenesDir, { withFileTypes: true })) {
      if (d.isDirectory() && fs.existsSync(path.join(scenesDir, d.name, 'property.json'))) expect(ids).toContain(d.name);
    }
  });
});

describe('planSvg', () => {
  const son = sceneEntry({ id: 'my-home', property: crowdedProperty(), extras: crowdedExtras }).entry!;

  it('draws names and sizes, says "not measured" instead of a size, and embeds no picture', () => {
    const { svg } = planSvg(son.layout, son.unverified, { idPrefix: 't', title: 'Plan' });
    expect(svg).toContain('Main Bedroom');
    expect(svg).toContain('137 sq ft');
    expect(svg).toContain('Second Bedroom');
    expect(svg).toMatch(/not measured/);
    expect(svg).not.toMatch(/<image|<img|href=/);
    expect((svg.match(/not measured/g) ?? []).length).toBe(2);
  });

  it('draws a partial room hatched and dashed, with a note and no size', () => {
    const lay = structuredClone(son.layout);
    lay.rooms.find((r) => r.id === 'second')!.partial = { reason: 'runs off the sheet' };
    const { svg } = planSvg(lay, {}, { idPrefix: 't', title: 'Plan' });
    expect(svg).toContain('is-partial');
    expect(svg).toContain('url(#t-hatch)');
    expect(svg).toContain('partly on the drawing');
    expect(roomSizeLine(lay.rooms.find((r) => r.id === 'second')!, {})).toBe('partly on the drawing');
  });

  it('escapes room names and marks only the selectable rooms as tappable', () => {
    const lay = structuredClone(son.layout);
    lay.rooms[0].label = 'A <b>&"room"';
    const { svg } = planSvg(lay, {}, { idPrefix: 't', title: 'Plan', selectable: new Set(['main']), selectedId: 'main' });
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('A &lt;b&gt;&amp;&quot;room&quot;');
    expect((svg.match(/role="button"/g) ?? []).length).toBe(1);
    expect(svg).toContain('is-on');
    expect(svg).toContain('is-dim');
  });

  it('draws a plan for every scene in the repo', () => {
    for (const s of scanScenes(scenesDir, () => {}).scenes) {
      const { svg, aspect } = planSvg(s.layout, s.unverified, { idPrefix: s.id, title: s.title });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(aspect).toBeGreaterThan(0.2);
      for (const r of s.layout.rooms) expect(svg).toContain(r.label.replace(/&/g, '&amp;'));
    }
  });
});
