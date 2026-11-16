// Catalogue by place (SPEC 16.17): every row says where it is offered, and the tray, the search, the Replace list and the debug override follow the kind of space.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CATALOG } from '../src/core/catalog';
import { CATEGORIES, categoryOf } from '../src/core/pieces';
import { allowedIn, categoriesFor, categoryIn, notHereNote, placesOf, rowsFor, spaceKindOf, trayWords, SPACE_KINDS } from '../src/core/places';
import { categoryCounts, filterCatalog } from '../src/buyer/catalog-tray';
import { replacementChoices } from '../src/buyer/furnish';
import { validateProperty } from '../src/core/layout-validate';
import { catalogueFilterInstalled, setCatalogueFilter } from '../src/building/extension';
import { propertyOf, SPACES, writeScenes } from '../scripts/make-space-scenes';

const HOME_ONLY = ['bed-king', 'wardrobe-2', 'fridge-1', 'wc-western', 'swing-2', 'cot', 'treadmill', 'shoe-rack', 'bathtub'];
const GYM_ONLY = ['gym-treadmill', 'gym-power-rack', 'gym-dumbbell-rack', 'gym-lockers-12', 'gym-mirror'];
const ids = (l: { id: string }[]): string[] => l.map((c) => c.id);

describe('every row names its places', () => {
  it('home pieces stay home pieces, the overlaps are the few the table gives', () => {
    for (const id of HOME_ONLY) { expect(placesOf(id), id).toEqual(['home']); expect(allowedIn(id, 'gym'), id).toBe(false); }
    expect(allowedIn('sofa-3', 'lobby')).toBe(true);
    expect(allowedIn('sofa-3', 'home')).toBe(true);
    expect(allowedIn('sofa-3', 'gym')).toBe(false);
    expect(allowedIn('dining-6', 'hall')).toBe(true);
    expect(allowedIn('planter-pot', 'lobby')).toBe(true);
    expect(allowedIn('yoga-mat', 'gym')).toBe(true);
    expect(allowedIn('yoga-mat', 'home')).toBe(true);
    for (const id of GYM_ONLY) { expect(placesOf(id), id).toContain('gym'); expect(allowedIn(id, 'home'), id).toBe(false); expect(allowedIn(id, undefined), id).toBe(false); }
  });
  it('every kind of space offers something, and a kind with no name offers a home', () => {
    for (const k of SPACE_KINDS) expect(rowsFor(k).length, k).toBeGreaterThan(0);
    expect(rowsFor('other').length).toBe(CATALOG.length);
    expect(ids(rowsFor(undefined))).toEqual(ids(rowsFor('home')));
  });
});

describe('the tray follows the kind of space', () => {
  it('a gym shows Cardio, Strength, Free weights, Studio and Amenities, and a home never shows them', () => {
    expect(categoriesFor('gym').map((c) => c.label)).toEqual(['Cardio', 'Strength', 'Free weights', 'Studio', 'Amenities']);
    const home = categoriesFor('home').map((c) => c.id);
    for (const c of ['cardio', 'strength', 'freeweights', 'studio', 'amenities', 'reception', 'stage', 'games']) expect(home).not.toContain(c);
    expect(categoriesFor('home').map((c) => c.id)).toContain('swing');
    expect(categoriesFor('other').length).toBe(CATEGORIES.length);
  });
  it('the counts add up to what the space offers, per category', () => {
    for (const k of SPACE_KINDS) {
      const c = categoryCounts(CATALOG, k);
      expect(c.all, k).toBe(rowsFor(k).length);
      let sum = 0;
      for (const cat of categoriesFor(k)) sum += c[cat.id];
      expect(sum, `${k}: every offered piece is in a shown category`).toBe(c.all);
    }
  });
  it('filtering by category and by words shows only what belongs', () => {
    expect(ids(filterCatalog('all', '', CATALOG, 'gym')).every((id) => placesOf(id).includes('gym'))).toBe(true);
    expect(ids(filterCatalog('cardio', '', CATALOG, 'gym'))).toEqual(['gym-treadmill', 'gym-cross', 'gym-upright-bike', 'gym-spin-bike', 'gym-recumbent', 'gym-rower', 'gym-stair']);
    expect(filterCatalog('cardio', '', CATALOG, 'home')).toEqual([]);
    expect(ids(filterCatalog('all', 'treadmill', CATALOG, 'home'))).toEqual(['treadmill']);
    expect(ids(filterCatalog('all', 'treadmill', CATALOG, 'gym'))).toEqual(['gym-treadmill']);
    expect(filterCatalog('all', 'bed', CATALOG, 'gym')).toEqual([]);
    expect(ids(filterCatalog('all', '', CATALOG)).includes('gym-treadmill')).toBe(false); // no kind: a home
    expect(ids(filterCatalog('decor', '', CATALOG, 'lobby'))).toEqual(expect.arrayContaining(['planter-pot', 'lobby-planter-large']));
    expect(categoryIn('planter-pot', 'lobby')).toBe('decor');
    expect(categoryIn('planter-pot', 'home')).toBe(categoryOf('planter-pot'));
  });
  it('the Replace list offers what the space offers: a gym swaps a treadmill for a rower, never a sofa', () => {
    const r = replacementChoices({ kind: 'counter', label: 'Treadmill, commercial', catalogId: 'gym-treadmill' }, 'gym');
    expect(ids(r.same)).toEqual(['gym-treadmill', 'gym-cross', 'gym-upright-bike', 'gym-spin-bike', 'gym-recumbent', 'gym-rower', 'gym-stair']);
    for (const c of [...r.same, ...r.other]) expect(placesOf(c.id)).toContain('gym');
    expect(ids(r.other)).not.toContain('sofa-3');
    const home = replacementChoices({ kind: 'bed', label: 'Bed' });
    expect([...home.same, ...home.other].every((c) => placesOf(c.id).includes('home'))).toBe(true);
    expect(ids(home.same).slice(0, 4)).toEqual(['bed-single', 'bed-double', 'bed-queen', 'bed-king']);
  });
  it('the words of the tray name the space', () => {
    expect(trayWords('gym').title).toBe('Add equipment');
    expect(trayWords('home').title).toBe('Add furniture');
    expect(trayWords(undefined).all).toBe('All furniture');
  });
});

describe('the rule a building installs (stage 1\'s setCatalogueFilter)', () => {
  it('the tray follows it while a space is up, and is back to the catalogue\'s own places the moment it is cleared', () => {
    const base = ids(filterCatalog('all', '', CATALOG, 'gym'));
    expect(catalogueFilterInstalled()).toBe(false);
    setCatalogueFilter((kind, item) => allowedIn(item.id, kind));
    expect(catalogueFilterInstalled()).toBe(true);
    expect(ids(filterCatalog('all', '', CATALOG, 'gym'))).toEqual(base);
    // a stricter rule narrows what the tray offers, whatever the rows say
    setCatalogueFilter((kind, item) => allowedIn(item.id, kind) && item.id !== 'gym-treadmill');
    expect(ids(filterCatalog('all', '', CATALOG, 'gym'))).not.toContain('gym-treadmill');
    expect(categoryCounts(CATALOG, 'gym').all).toBe(base.length - 1);
    expect(ids(replacementChoices({ kind: 'counter', label: 'Rower', catalogId: 'gym-rower' }, 'gym').same)).not.toContain('gym-treadmill');
    setCatalogueFilter(null);
    expect(catalogueFilterInstalled()).toBe(false);
    expect(ids(filterCatalog('all', '', CATALOG, 'gym'))).toEqual(base);
  });
});

describe('a piece the space does not offer is kept and flagged, never dropped', () => {
  it('says what it is made for, and says nothing for a piece that belongs', () => {
    expect(notHereNote('gym-treadmill', 'Treadmill, commercial', 'home')).toContain('made for a gym, not a home');
    expect(notHereNote('gym-treadmill', 'Treadmill, commercial', 'home')).toContain('stays in your layout');
    expect(notHereNote('bed-king', 'King bed', 'gym')).toContain('made for a home');
    expect(notHereNote('gym-treadmill', 'Treadmill', 'gym')).toBeNull();
    expect(notHereNote('gym-treadmill', 'Treadmill', 'other')).toBeNull();
    expect(notHereNote(undefined, 'a real chair', 'gym')).toBeNull();
  });
});

describe('the kind of a scene, and the debug override', () => {
  it('is the property\'s spaceKind, a home when it says none, and ?spaceKind= wins', () => {
    expect(spaceKindOf({})).toBe('home');
    expect(spaceKindOf(null)).toBe('home');
    expect(spaceKindOf({ spaceKind: 'gym' })).toBe('gym');
    expect(spaceKindOf({ spaceKind: 'gym' }, '?scene=x&spaceKind=hall')).toBe('hall');
    expect(spaceKindOf({}, '?spaceKind=gym')).toBe('gym');
    expect(spaceKindOf({ spaceKind: 'gym' }, '?spaceKind=nonsense')).toBe('gym');
  });
  it('validateProperty keeps spaceKind and refuses a made-up one', () => {
    const p = propertyOf(SPACES[0], false);
    expect(validateProperty(JSON.parse(JSON.stringify(p))).spaceKind).toBe('gym');
    expect(() => validateProperty({ ...JSON.parse(JSON.stringify(p)), spaceKind: 'moon' })).toThrow(/spaceKind/);
    const { spaceKind, ...rest } = JSON.parse(JSON.stringify(p));
    void spaceKind;
    expect(validateProperty(rest).spaceKind).toBeUndefined();
  });
});

describe('the test scenes', () => {
  it('are written identically on every run, and match what is committed', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-spaces-'));
    const a = writeScenes(tmp);
    expect(a.length).toBe(6);
    for (const name of fs.readdirSync(tmp)) {
      const mine = fs.readFileSync(path.join(tmp, name, 'property.json'), 'utf8');
      const committed = fs.readFileSync(path.join(__dirname, '../public/scenes', name, 'property.json'), 'utf8');
      expect(mine, name).toBe(committed);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it('set their spaceKind, load through validateProperty, and the empty ones are empty', () => {
    for (const s of SPACES) {
      for (const furnished of [false, true]) {
        const p = validateProperty(JSON.parse(JSON.stringify(propertyOf(s, furnished))));
        expect(p.spaceKind).toBe(s.spaceKind);
        expect(p.id).toBe(`test-${s.kind}-${furnished ? 'sample' : 'empty'}`);
        expect(p.furniture.length > 0).toBe(furnished);
        expect(/^test-/.test(p.id)).toBe(true);
      }
    }
  });
});
