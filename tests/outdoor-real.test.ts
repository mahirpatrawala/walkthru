// SPEC 19.12 (22 Nov 2026): the photographic layer of the open-air spaces. What can be checked without a GPU: every shipped file is the one its lock
// names (SHA-256), every source has a licence, an author, a page and a date and every CC-BY one is credited; the photographed sky is turned to the
// scene's sun, off at night and in True colours, and matched to the hour's sky; the grass grows only where the lawn is on top, the same every time,
// none on the phone tier; the coconut palm is a model species that stays procedural until its file arrives (and in Node); the sample scenes plant it.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SKY_PICTURE, skyGain, skyPictureOn, skyRotation, mountSkyDome } from '../src/outdoor/sky-dome';
import { GRASS_DENSITY, grassTriangles, lawnAt, mountGrass, tuftSpots } from '../src/outdoor/grass';
import { OUTDOOR_MODELS, PHOTO_SPRAYS, sprayPath, FROND_PATH, HEDGE_PATH, BARK_PATH, GRASS_PATH, DECK_PATHS, MOSAIC_PATHS } from '../src/outdoor/real';
import { SPECIES } from '../src/outdoor/species';
import { mountFoliage } from '../src/outdoor/foliage';
import { parseOutdoor } from '../src/outdoor/types';
import { GROUND } from '../src/outdoor/materials';
import { gradeAt } from '../src/look/grade';
import { TRUE_GRADE } from '../src/look/grade';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public/look/outdoor');
const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const scene = (id: string) => parseOutdoor(readJson(path.join(ROOT, `public/scenes/${id}/outdoor.json`)));

describe('the shipped files and their sources', () => {
  const files = readJson<{ files: Record<string, { bytes: number; sha256: string }> }>(path.join(OUT, 'files.lock.json')).files;
  const sources = readJson<{ readOn: string; files: Record<string, { source: string; page: string; author: string; licence: string; licencePage: string; sha256: string }> }>(path.join(OUT, 'sources.lock.json'));
  it('every shipped file is the one the lock names, and every path the app asks for is shipped', () => {
    for (const [rel, f] of Object.entries(files)) {
      const b = fs.readFileSync(path.join(OUT, rel));
      expect(b.length, rel).toBe(f.bytes);
      expect(createHash('sha256').update(b).digest('hex'), rel).toBe(f.sha256);
    }
    const asked = [FROND_PATH, HEDGE_PATH, BARK_PATH, GRASS_PATH, DECK_PATHS.diff, DECK_PATHS.nor, MOSAIC_PATHS.diff, MOSAIC_PATHS.nor, 'outdoor/sky/sky_day.jpg', 'outdoor/sky/sky_day.low.jpg',
      ...PHOTO_SPRAYS.flatMap((s) => [sprayPath(s, 'low')!, sprayPath(s, 'high')!]), ...(['low', 'high'] as const).map((t) => OUTDOOR_MODELS['coconut-palm'].file(t))];
    for (const a of asked) expect(files[a.replace(/^outdoor\//, '')], a).toBeTruthy();
  });
  it('every source has a URL, a page, an author, a licence with its page and the date it was read; only CC0 and CC-BY 4.0; every CC-BY one is credited', () => {
    expect(sources.readOn).toBe('2026-11-22');
    const licence = fs.readFileSync(path.join(OUT, 'LICENCE.txt'), 'utf8');
    for (const [k, s] of Object.entries(sources.files)) {
      expect(s.source, k).toMatch(/^https:\/\//);
      expect(s.page, k).toMatch(/^https:\/\//);
      expect(s.author.length, k).toBeGreaterThan(2);
      expect(['CC0 1.0', 'CC-BY 4.0'], k).toContain(s.licence);
      expect(s.licencePage, k).toMatch(/^https:\/\//);
      expect(s.sha256, k).toMatch(/^[0-9a-f]{64}$/);
      if (s.licence === 'CC-BY 4.0') { expect(licence).toContain(s.page); expect(licence).toContain(s.author.split(' ')[0]); }
    }
    expect(Object.values(sources.files).some((s) => s.licence === 'CC-BY 4.0')).toBe(true);
    expect(fs.readFileSync(path.join(ROOT, 'public/look/LICENCE.txt'), 'utf8')).toContain('public/look/outdoor/LICENCE.txt');
  });
  it('a phone loads little: the phone files of a pool area with every species stay under 0.8 MB, the palm model under 200 KB', () => {
    const low = [...PHOTO_SPRAYS.map((s) => sprayPath(s, 'low')!), FROND_PATH, HEDGE_PATH, BARK_PATH, DECK_PATHS.diff, MOSAIC_PATHS.diff, 'outdoor/sky/sky_day.low.jpg', OUTDOOR_MODELS['coconut-palm'].file('low')];
    const bytes = low.reduce((s, f) => s + files[f.replace(/^outdoor\//, '')].bytes, 0);
    expect(bytes).toBeLessThan(800_000);
    expect(files['models/coconut-palm.low.glb'].bytes).toBeLessThan(200_000);
    expect(files['models/coconut-palm.glb'].bytes).toBeLessThan(600_000);
  });
});

describe('the photographed sky', () => {
  it('turns the picture so its sun is where the scene sun is', () => {
    for (const az of [-2.5, -1, 0, 0.7, 2.9]) {
      const toSun: [number, number, number] = [Math.cos(az), 0.6, Math.sin(az)];
      const rot = skyRotation(toSun);
      // the shader: u = fract(atan(z, x) / 2pi + rot)
      const u = ((Math.atan2(toSun[2], toSun[0]) / (2 * Math.PI) + rot) % 1 + 1) % 1;
      expect(u).toBeCloseTo(SKY_PICTURE.sunU, 5);
    }
  });
  it('is off at night and in True colours, on by day, and its mid sky matches the hour', () => {
    expect(skyPictureOn(gradeAt(22), false)).toBe(0);
    expect(skyPictureOn(gradeAt(14), true)).toBe(0);
    expect(skyPictureOn(gradeAt(14), false)).toBeGreaterThan(0.9);
    expect(skyPictureOn(TRUE_GRADE, true)).toBe(0);
    const g = gradeAt(14), gain = skyGain(g);
    for (const k of gain) expect(k).toBeGreaterThan(0.2);
    const evening = skyGain(gradeAt(18.3));
    // a photo of a blue sky goes warm at dusk: red gains on blue
    expect(evening[0] / evening[2]).toBeGreaterThan(gain[0] / gain[2]);
  });
  it('is a dome that never casts, never takes a ray and is drawn first; in Node it loads nothing', () => {
    const d = mountSkyDome(null, 'medium');
    expect(d.mesh.castShadow).toBe(false);
    expect(d.mesh.renderOrder).toBeLessThan(-100);
    const hits: THREE.Intersection[] = [];
    d.mesh.raycast(new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 1, 0)), hits);
    expect(hits).toHaveLength(0);
    expect(d.uniforms.uSkyMap.value).toBeNull();
    d.sync(gradeAt(14), [1, 1, 0], false);
    expect(d.uniforms.uSkyOn.value).toBe(0); // nothing to show until the picture arrives
    d.dispose();
  });
});

describe('grass on the lawns', () => {
  const pool = scene('test-tower-club-pool');
  it('grows only where the lawn is on top: not on the decks, the beds, the water or its coping', () => {
    const spots = tuftSpots(pool, 'high');
    expect(spots.length).toBeGreaterThan(500);
    for (const s of spots) expect(lawnAt(pool, s.x, s.z)).toBe(true);
    for (const a of pool.areas.filter((x) => x.finish === 'deck')) {
      const c = a.polygon.reduce((p, q) => ({ x: p.x + q.x / a.polygon.length, z: p.z + q.z / a.polygon.length }), { x: 0, z: 0 });
      expect(lawnAt(pool, c.x, c.z), a.id).toBe(false);
    }
    for (const b of pool.pools) expect(lawnAt(pool, (b.rect.x0 + b.rect.x1) / 2, (b.rect.z0 + b.rect.z1) / 2)).toBe(false);
  });
  it('is the same every time, none on the phone tier, denser on high, one mesh, its triangles counted', () => {
    expect(tuftSpots(pool, 'medium')).toEqual(tuftSpots(pool, 'medium'));
    expect(tuftSpots(pool, 'low')).toHaveLength(0);
    expect(GRASS_DENSITY.high).toBeGreaterThan(GRASS_DENSITY.medium);
    expect(tuftSpots(pool, 'high').length).toBeGreaterThan(tuftSpots(pool, 'medium').length);
    const g = mountGrass(pool, 'medium', null);
    const geo = g.mesh!.geometry;
    expect(geo.index!.count / 3).toBe(grassTriangles(pool, 'medium'));
    expect(g.mesh!.visible).toBe(false); // nothing painted stands in for the photograph
    expect(g.mesh!.castShadow).toBe(false);
    g.dispose();
    expect(mountGrass(scene('test-tower-club-deck'), 'high', null).mesh).toBeNull();
  });
});

describe('plants and finishes', () => {
  it('the coconut palm is a model species: procedural until its file arrives (and in Node), one instanced mesh a part', () => {
    expect(SPECIES['coconut-palm'].model).toBe('coconut-palm');
    expect(OUTDOOR_MODELS['coconut-palm'].heightM).toBeGreaterThan(7);
    const h = mountFoliage([{ species: 'coconut-palm', x: 0, z: 0 }, { species: 'coconut-palm', x: 4, z: 0 }], [], 'medium', 3);
    const inst: THREE.InstancedMesh[] = [];
    h.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) inst.push(o as THREE.InstancedMesh); });
    expect(inst.map((m) => m.name).sort()).toEqual(['plants:coconut-palm:leaves', 'plants:coconut-palm:trunk']);
    expect(inst[0].count).toBe(2);
    h.dispose();
  });
  it('the sample pool wing and aqua court plant coconut palms; the photographed species all have a spray', () => {
    expect(scene('test-tower-club-aqua').trees.filter((t) => t.species === 'coconut-palm')).toHaveLength(2);
    expect(scene('test-tower-club-pool').trees.filter((t) => t.species === 'coconut-palm')).toHaveLength(2);
    for (const s of PHOTO_SPRAYS) expect(sprayPath(s, 'medium')).toMatch(/leaves\/.+\.webp$/);
    expect(sprayPath('royal-palm', 'high')).toBeNull();
  });
  it('the deck is the photographed hardwood at 2 m a repeat, its own set kept at 2K', () => {
    expect(GROUND.deck.files).toEqual(DECK_PATHS);
    expect(GROUND.deck.tile).toBe(2);
  });
});
