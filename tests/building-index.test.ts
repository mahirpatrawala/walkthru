import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanBuildings, writeBuildingIndex } from '../scripts/building/make-building-index';
import { catalogueAllowedIn, contextOf, getSpaceContext, setCatalogueFilter, setSpaceContext } from '../src/building/extension';
import { clone, rawBuilding, readBuilding } from './helpers/sample-building';

let dir = '';
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = ''; setCatalogueFilter(null); setSpaceContext(null); });

const put = (id: string, json: unknown): void => { fs.mkdirSync(path.join(dir, id), { recursive: true }); fs.writeFileSync(path.join(dir, id, 'building.json'), JSON.stringify(json)); };

describe('the list of buildings', () => {
  it('lists the buildings it can read, skips a broken one and says why, and leaves out an unlisted one', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-bi-'));
    put('sample-tower', rawBuilding('sample-tower'));
    put('broken', { version: 1, id: 'broken' });
    const hidden = clone(rawBuilding('sample-tower-empty')) as Record<string, unknown>;
    hidden.unlisted = true;
    put('sample-tower-empty', hidden);
    put('wrong-folder', rawBuilding('sample-tower'));
    const warnings: string[] = [];
    const idx = scanBuildings(dir, (m) => warnings.push(m));
    expect(idx.buildings.map((b) => b.id)).toEqual(['sample-tower']);
    expect(warnings.some((w) => /broken/.test(w))).toBe(true);
    expect(warnings.some((w) => /wrong-folder.*its id is "sample-tower"/.test(w))).toBe(true);
  });
  it('writes index.json, and a missing folder is an empty list', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-bi-'));
    expect(scanBuildings(path.join(dir, 'nope')).buildings).toEqual([]);
    put('sample-tower', rawBuilding('sample-tower'));
    writeBuildingIndex(dir);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).buildings[0].name).toBe('Sample Tower (made-up)');
  });
  it('the committed list is what the generator writes', () => {
    const committed = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/buildings/index.json'), 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(scanBuildings())));
  });
});

describe('extension points', () => {
  it('outside a building every piece is allowed anywhere', () => {
    expect(getSpaceContext()).toBeNull();
    expect(catalogueAllowedIn({ id: 'bed-king', kind: 'bed' })).toBe(true);
  });
  it('a filter by kind of space is asked for the space the walker is in', () => {
    const b = readBuilding('sample-tower');
    const gym = b.levels.flatMap((l) => l.spaces).find((s) => s.kind === 'gym')!;
    setSpaceContext(contextOf(b.id, gym));
    expect(getSpaceContext()).toEqual({ buildingId: 'sample-tower', spaceId: 'gym', kind: 'gym', outdoor: false, pack: null });
    setCatalogueFilter((kind, item) => !(kind === 'gym' && item.kind === 'bed'));
    expect(catalogueAllowedIn({ id: 'bed-king', kind: 'bed' })).toBe(false);
    expect(catalogueAllowedIn({ id: 'sofa-3', kind: 'sofa' })).toBe(true);
    expect(catalogueAllowedIn({ id: 'bed-king', kind: 'bed' }, 'home')).toBe(true);
  });
  it('outdoor and pack are read from building.json', () => {
    const raw = clone(rawBuilding('sample-tower')) as { levels: { spaces: Record<string, unknown>[] }[] };
    raw.levels[1].spaces[4].outdoor = true;
    raw.levels[1].spaces[4].pack = 'classic';
    // parse through the committed parser
    return import('../src/building/parse').then(({ parseBuilding }) => {
      const b = parseBuilding(raw);
      expect(b.levels[1].spaces[4]).toMatchObject({ outdoor: true, pack: 'classic' });
      expect(() => { (raw.levels[1].spaces[4] as Record<string, unknown>).outdoor = 'yes'; parseBuilding(raw); }).toThrow(/outdoor must be true or false/);
    });
  });
});
