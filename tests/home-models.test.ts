// SPEC 16.15.4: the flats' CC BY models (public/look/home/). The lock (licence, author, page, SHA-256 of every source and output), the brand
// rule, the files on disk against the manifest, the fit of each model in its catalogue box (to 1 mm, the bake's parity tolerance), the bed
// frame carrying only the generated bedding of SPEC 16.23, the decor's sizing, and the "3D model credits" reader over every lock of the build.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { catalogItem, itemFromCatalog } from '../src/core/catalog';
import { buildRealFurniture, resolveItemLook } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { attachModel, modelNote } from '../src/look/models/apply';
import { attachDecorModel, stretchUp } from '../src/look/models/decor';
import { FIT_TOL } from '../src/look/models/fit';
import { DECOR_MODELS, FURNITURE_MODELS, MATTRESS_M, allModelIds, decorChoice, modelInfo, modelUrl, planFurniture, setModelsEnabled } from '../src/look/models/library';
import { HOME_DECOR, HOME_FURNITURE } from '../src/look/models/home';
import { clearModelCache, primeModel } from '../src/look/models/load';
import type { Template } from '../src/look/models/load';
import { getPack } from '../src/look/packs';
import { resetStyle, setStyle, getStyle } from '../src/look/style';
import { PARITY_TOLERANCE_M } from '../src/look/baked/parity';
import { creditsFromLock, isAttribution, isForbiddenLicence, lockPaths, mergeCredits, loadCredits } from '../src/look/credits';
import type { FurnitureItem } from '../src/types';
import type { Tier } from '../src/look/types';

const ROOT = path.resolve(__dirname, '..');
const HOME = path.join(ROOT, 'public/look/home');
const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');
const lock = JSON.parse(fs.readFileSync(path.join(HOME, 'home.lock.json'), 'utf8')) as {
  read: string;
  assets: Record<string, { id: string; uid: string; name: string; authors: string[]; page: string; licence: string; licenceUrl: string; licenceWords: string; licenceRead: string; files: { url: string; size: number; sha256: string }[] }>;
  rejected: { what: string; url: string; why: string }[];
  outputs: Record<string, { bytes: number; sha256: string }>;
};
const HOME_IDS = allModelIds().filter((id) => modelInfo(id)!.dir === 'home/models');

afterEach(() => { resetStyle(); setModelsEnabled(true); clearModelCache(); });

// ------------------------------------------------------------------ the lock and the files
describe('the lock: every shipped model is CC BY 4.0, credited, with a page and a hash', () => {
  it('every model of the library has a lock entry, and nothing else is shipped', () => {
    const libIds = [...HOME_FURNITURE, ...HOME_DECOR].map((m) => m.id).sort();
    expect(HOME_IDS.sort()).toEqual(libIds);
    expect(Object.keys(lock.assets).sort()).toEqual(libIds);
  });
  for (const [id, a] of Object.entries(lock.assets)) {
    it(`${id}: licence, author, page, date read, archive SHA-256`, () => {
      expect(a.licence).toBe('CC BY 4.0');
      expect(a.licenceUrl).toMatch(/creativecommons\.org\/licenses\/by\/4\.0/);
      expect(a.licenceWords).toMatch(/license "by"/);
      expect(isForbiddenLicence(a.licence)).toBe(false);
      expect(a.authors.length).toBeGreaterThan(0);
      expect(a.page).toBe(`https://sketchfab.com/3d-models/${a.uid}`);
      expect(a.licenceRead).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.files[0].url).toMatch(/^https:\/\/huggingface\.co\/datasets\/allenai\/objaverse\/resolve\/main\/glbs\//);
      expect(a.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    });
  }
  it('every candidate that was looked at and refused says why', () => {
    expect(lock.rejected.length).toBeGreaterThanOrEqual(15);
    for (const r of lock.rejected) { expect(r.why.length).toBeGreaterThan(20); expect(r.url).toMatch(/^https:\/\//); }
  });
  it('LICENCE.txt credits every model by title and author', () => {
    const txt = fs.readFileSync(path.join(HOME, 'LICENCE.txt'), 'utf8');
    for (const a of Object.values(lock.assets)) { expect(txt).toContain(`"${a.name}" by ${a.authors.join(', ')}`); expect(txt).toContain(a.page); }
  });
  it('no brand or maker name in what ships or in the code that uses it', () => {
    const BRANDS = /\b(ikea|vitra|bosch|frigidaire|viking|ele?trolux|globalo|qualitas|grohe|kraus|smeg|whirlpool|samsung|lg|godrej|hindware|jaquar|cera|kohler|duravit|hafele|faber|elica|prestige)\b/i;
    const texts = [
      fs.readFileSync(path.join(ROOT, 'src/look/models/home.ts'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'src/look/models/home-manifest.json'), 'utf8'),
      fs.readFileSync(path.join(HOME, 'home.lock.json'), 'utf8'),
      fs.readFileSync(path.join(HOME, 'LICENCE.txt'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'scripts/fetch-home-models.ts'), 'utf8'),
    ];
    for (const t of texts) expect(t.match(BRANDS)?.[0] ?? null).toBeNull();
  });
});

/** the box of a GLB's geometry, from its own JSON (accessor bounds under each node's transform): no image decoding needed */
function glbBox(buf: Buffer): THREE.Box3 {
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    nodes: { mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { min?: number[]; max?: number[]; normalized?: boolean; componentType: number }[];
  };
  const box = new THREE.Box3();
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    const m = new THREE.Matrix4();
    if (n.matrix) m.fromArray(n.matrix);
    else m.compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
    for (const p of json.meshes[n.mesh].primitives) {
      const a = json.accessors[p.attributes.POSITION];
      // a normalised integer attribute stores [-1, 1] or [0, 1]: its min/max are the integers, scaled here
      const k = a.normalized ? ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 } as Record<number, number>)[a.componentType] ?? 1 : 1;
      const lo = new THREE.Vector3(...a.min!.map((v) => v / k)), hi = new THREE.Vector3(...a.max!.map((v) => v / k));
      box.union(new THREE.Box3(lo, hi).applyMatrix4(m));
    }
  }
  return box;
}

describe('the shipped files: on disk, hashed in the lock, the size the manifest says, small enough', () => {
  for (const id of HOME_IDS) {
    it(id, () => {
      const info = modelInfo(id)!;
      expect(info.files.full).toBeTruthy();
      for (const tier of ['full', 'low'] as const) {
        const f = info.files[tier];
        if (!f) continue;
        const buf = fs.readFileSync(path.join(HOME, 'models', f.file));
        expect(buf.subarray(0, 4).toString()).toBe('glTF');
        expect(buf.length).toBe(f.bytes);
        expect(lock.outputs[`models/${f.file}`]?.sha256).toBe(sha(buf));
        expect(modelUrl(id, tier)).toBe(`/look/home/models/${f.file}`);
        // the URL the browser fetches is the file on disk (a wrong folder answers the dev server's index page)
        expect(fs.existsSync(path.join(ROOT, 'public', modelUrl(id, tier)!))).toBe(true);
        // never past the measured box (the fit decisions use it), and not visibly smaller either
        const b = glbBox(buf), s = b.getSize(new THREE.Vector3());
        expect(b.min.x).toBeGreaterThan(-info.dims.w / 2 - 0.002); expect(b.max.x).toBeLessThan(info.dims.w / 2 + 0.002);
        expect(b.min.z).toBeGreaterThan(-info.dims.d / 2 - 0.002); expect(b.max.z).toBeLessThan(info.dims.d / 2 + 0.002);
        expect(b.min.y).toBeGreaterThan(-0.002); expect(b.max.y).toBeLessThan(info.dims.h + 0.002);
        expect(s.x).toBeGreaterThan(info.dims.w * 0.97); expect(s.y).toBeGreaterThan(info.dims.h * 0.97);
        // budgets: a phone file under 80 KB, a full file under 600 KB
        expect(f.bytes).toBeLessThan(tier === 'low' ? 80_000 : 600_000);
      }
    });
  }
  it('every file in the folder is in the manifest and the lock', () => {
    const known = new Set(HOME_IDS.flatMap((id) => Object.values(modelInfo(id)!.files).map((f) => f!.file)));
    for (const f of fs.readdirSync(path.join(HOME, 'models'))) { expect(known.has(f), f).toBe(true); expect(lock.outputs[`models/${f}`], f).toBeTruthy(); }
  });
});

// ------------------------------------------------------------------ the fit in the catalogue boxes
/** a template of the model's measured size: each part a box of the full size, centred on the footprint (as the manifest promises) */
function fakeTemplate(id: string, tier: 'full' | 'low' = 'full'): Template {
  const info = modelInfo(id)!;
  const { w, h, d } = info.dims;
  return {
    id, tier,
    parts: Object.keys(info.parts).map((name) => ({ name, geometry: new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), material: new THREE.MeshStandardMaterial({ name }) })),
  };
}
const primeHome = (): void => { for (const id of HOME_IDS) { primeModel(id, 'medium', fakeTemplate(id)); primeModel(id, 'low', fakeTemplate(id, 'low')); } };
const at0 = (it: FurnitureItem): FurnitureItem => ({ ...it, box: { ...it.box, cx: 0, cz: 0, yawDeg: 0 } });
const cat = (id: string): FurnitureItem => { const c = catalogItem(id)!; return at0(itemFromCatalog(id, { cx: 0, cz: 0, w: c.footprint.w, d: c.footprint.d, yawDeg: 0 }, 'virtual')); };
const over = (g: THREE.Object3D, it: FurnitureItem): number => {
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g);
  return Math.max(-it.box.w / 2 - b.min.x, b.max.x - it.box.w / 2, -it.box.d / 2 - b.min.z, b.max.z - it.box.d / 2, b.max.y - Math.max(it.heightM, it.surfaceHeightM), -b.min.y);
};

/** which catalogue pieces each model must stand in for under a pack that allows models, and which it must not */
const EXPECT: { piece: string; model: string | null }[] = [
  { piece: 'sofa-3', model: 'sofa_3s_midcentury' },
  { piece: 'sofa-2', model: 'sofa_2s_grey' },
  { piece: 'armchair', model: 'armchair_tub' },
  { piece: 'bed-queen', model: 'bed_frame_soho' },
  { piece: 'bed-king', model: 'bed_frame_soho' },
  { piece: 'bed-single', model: null },
  { piece: 'bed-double', model: null },
  { piece: 'sofa-l', model: null },
  { piece: 'wc-western', model: 'wc_floor' },
  { piece: 'basin-wall', model: 'basin_wall' },
  { piece: 'basin-pedestal', model: null },
  { piece: 'fridge-1', model: null },
  { piece: 'shower-over', model: null },
];

describe('each model stands in its catalogue box: 12 % at most on any axis, the seat or rim within 3 cm, inside the box to 1 mm', () => {
  for (const e of EXPECT) {
    it(`${e.piece} -> ${e.model ?? 'the generated piece'}`, () => {
      setStyle({ packId: 'clean-contrast' });
      const it = cat(e.piece);
      const look = resolveItemLook(it);
      const plan = planFurniture(it, look, getStyle().pack.models ?? {});
      expect(plan?.model.id ?? null).toBe(e.model);
      if (!plan) return;
      expect(plan.fit.worst).toBeLessThanOrEqual(FIT_TOL + 1e-9);
      for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(plan.fit.scale[k] - 1)).toBeLessThanOrEqual(FIT_TOL + 1e-9);
      if (plan.model.use === 'frame') {
        const mattress = it.surfaceHeightM - (plan.deckM ?? 0);
        expect(mattress).toBeGreaterThanOrEqual(MATTRESS_M.min); expect(mattress).toBeLessThanOrEqual(MATTRESS_M.max);
      } else if (plan.info.surfaceM !== undefined) {
        expect(Math.abs((plan.offset?.y ?? 0) + plan.info.surfaceM * plan.fit.scale.y - it.surfaceHeightM)).toBeLessThanOrEqual(0.03 + 1e-9);
      }
    });
  }
  for (const tier of ['low', 'medium', 'high'] as Tier[]) {
    it(`swapped in at ${tier}: the group stays inside the box to ${PARITY_TOLERANCE_M * 1000} mm, the item untouched`, async () => {
      setStyle({ packId: 'clean-contrast' });
      primeHome();
      for (const e of EXPECT.filter((x) => x.model)) {
        const it = cat(e.piece);
        const before = JSON.stringify(it);
        const g = new THREE.Group();
        buildRealFurniture(g, it, tier, createFurnitureKit());
        const plan = planFurniture(it, resolveItemLook(it), getStyle().pack.models ?? {})!;
        expect(await attachModel(g, it, resolveItemLook(it)!, plan, tier, createFurnitureKit())).toBe(true);
        expect(g.userData.model?.id).toBe(e.model);
        expect(over(g, it), `${e.piece} at ${tier}`).toBeLessThanOrEqual(PARITY_TOLERANCE_M);
        expect(JSON.stringify(it)).toBe(before);
        expect(modelNote(it.id)).toMatch(/CC BY 4\.0, adapted/);
      }
    });
  }
  it('the Classic look, a pack that says "generator", ?models=off and a shape from the drawing keep the generated piece', () => {
    const it = cat('sofa-3');
    setStyle({ packId: 'classic' });
    expect(planFurniture(it, resolveItemLook(it), getStyle().pack.models ?? null)).toBeNull();
    setStyle({ packId: 'warm-oak-navy' });
    expect(planFurniture(it, resolveItemLook(it), getPack('warm-oak-navy')?.models ?? null)).toBeNull();
    setStyle({ packId: 'clean-contrast' });
    setModelsEnabled(false);
    expect(planFurniture(it, resolveItemLook(it), getStyle().pack.models ?? {})).toBeNull();
    setModelsEnabled(true);
    const look = resolveItemLook(it)!;
    expect(planFurniture(it, { ...look, prov: { ...look.prov, 'param:seats': 'drawing' } }, {})).toBeNull();
  });
  it('a model is only for its own catalogue variant: a WC model is never a basin, a basin never a sink', () => {
    setStyle({ packId: 'clean-contrast' });
    for (const id of ['sink-single', 'health-faucet', 'geyser-15', 'vanity-60', 'wc-wallhung']) {
      const it = cat(id);
      expect(planFurniture(it, resolveItemLook(it), {})?.model.id ?? null, id).toBeNull();
    }
  });
});

describe('a bed on a model frame carries the generated bedding of SPEC 16.23, and nothing else', () => {
  for (const tier of ['medium', 'high'] as Tier[]) {
    it(tier, async () => {
      setStyle({ packId: 'clean-contrast' });
      primeHome();
      const it = cat('bed-queen');
      const g = new THREE.Group();
      buildRealFurniture(g, it, tier, createFurnitureKit());
      const look = resolveItemLook(it)!;
      expect(await attachModel(g, it, look, planFurniture(it, look, {})!, tier, createFurnitureKit())).toBe(true);
      const names = g.children.map((c) => c.name);
      expect(names).toContain('frame');
      expect(names.some((n) => /^mattress/.test(n))).toBe(true);
      for (const n of names) expect(n, n).toMatch(/^(frame|mattress|duvet|pillow)/);
      expect(names.filter((n) => /^pillows?$/.test(n)).length).toBeLessThanOrEqual(1);
      // the sleeping surface is the item's: the mattress top at surfaceHeightM, within the quilt's 1.2 cm and a pillow's 10 cm
      const mat = g.children.find((c) => c.name === 'mattress')!;
      const mb = new THREE.Box3().setFromObject(mat);
      expect(Math.abs(mb.max.y - it.surfaceHeightM)).toBeLessThan(0.006);
      expect(over(g, it)).toBeLessThanOrEqual(PARITY_TOLERANCE_M);
    });
  }
});

describe('decor: the hob and the hood', () => {
  it('the hob takes the planner footprint, the hood its width, and only under a pack that allows models', () => {
    expect(decorChoice('hob', { w: 0.6, d: 0.52, height: 0.03, seed: 1 }, {})?.model.id).toBe('hob_4_glass');
    const hob = decorChoice('hob', { w: 0.6, d: 0.52, height: 0.03, seed: 1 }, {})!;
    expect(hob.info.dims.w * hob.scale).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(hob.info.dims.d * hob.scale).toBeLessThanOrEqual(0.52 + 1e-9);
    const hood = decorChoice('hood', { w: 0.62, d: 0.46, height: 1.0, seed: 3, wall: true }, {})!;
    expect(hood.model.id).toBe('hood_chimney');
    expect(hood.info.dims.w * hood.scale).toBeCloseTo(0.62, 6);
    expect(decorChoice('hob', { w: 0.6, d: 0.52, height: 0.03, seed: 1 }, null)).toBeNull();
    expect(DECOR_MODELS.filter((m) => m.family === 'hob' || m.family === 'hood').length).toBe(2);
  });
  it('the phone keeps the generated hob (its file would be too heavy)', () => {
    expect(modelUrl('hob_4_glass', 'low')).toBeNull();
    expect(modelUrl('hob_4_glass', 'full')).toBe('/look/home/models/hob_4_glass.glb');
  });
  it('the hood flue is stretched up to the planner height, the canopy is not', () => {
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.4).translate(0, 0.1, 0)); canopy.userData.walkthruPart = 'canopy';
    const flue = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2).translate(0, 0.4, 0)); flue.userData.walkthruPart = 'flue';
    g.add(canopy, flue);
    stretchUp(g, ['flue'], 1.1);
    flue.geometry.computeBoundingBox(); canopy.geometry.computeBoundingBox();
    expect(flue.geometry.boundingBox!.max.y).toBeCloseTo(1.1, 6);
    expect(flue.geometry.boundingBox!.min.y).toBeCloseTo(0.2, 6);
    expect(canopy.geometry.boundingBox!.max.y).toBeCloseTo(0.2, 6);
  });
  it('a hob decor piece swaps to the model and stays out of rays', async () => {
    primeHome();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.52)));
    expect(await attachDecorModel(g, { kind: 'hob', w: 0.6, d: 0.52, height: 0.03, seed: 2, place: 'surface' }, 'medium', {})).toBe(true);
    expect(g.userData.model).toBe('hob_4_glass');
    const rc = new THREE.Raycaster(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0));
    expect(rc.intersectObject(g, true).length).toBe(0);
  });
  it('every furniture model is listed after the CC0 ones only by its own families', () => {
    for (const m of HOME_FURNITURE) expect(FURNITURE_MODELS).toContain(m);
  });
});

// ------------------------------------------------------------------ credits
describe('"3D model credits": every CC BY asset of every lock file', () => {
  const readLock = (p: string): unknown => { const f = path.join(ROOT, 'public', p); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  it('finds the lock files of the build (the flats, the gym, the outdoor sources) by a glob, so a new one needs no code', () => {
    const ps = lockPaths();
    for (const p of ['/look/home/home.lock.json', '/look/gym/gym.lock.json', '/look/outdoor/sources.lock.json', '/look/models/models.lock.json']) expect(ps).toContain(p);
    for (const p of ps) expect(p).toMatch(/^\/look\/.+\.lock\.json$/);
  });
  it('lists each home model with title, author, page and licence, and the gym\'s CC BY models', async () => {
    const list = await loadCredits(async (p) => readLock(p));
    for (const a of Object.values(lock.assets)) {
      const c = list.find((x) => x.url === a.page);
      expect(c, a.id).toBeTruthy();
      expect(c!.title).toBe(a.name);
      expect(c!.author).toBe(a.authors.join(', '));
      expect(isAttribution(c!.licence)).toBe(true);
    }
    const gym = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/look/gym/gym.lock.json'), 'utf8')) as { assets: Record<string, { licence: string; page: string }> };
    for (const a of Object.values(gym.assets).filter((x) => /BY/.test(x.licence))) expect(list.some((c) => c.url === a.page), a.page).toBe(true);
    // CC BY first, nothing forbidden, no rejected candidate credited as if shipped
    const firstCc0 = list.findIndex((c) => !isAttribution(c.licence));
    expect(list.slice(0, firstCc0 < 0 ? list.length : firstCc0).every((c) => isAttribution(c.licence))).toBe(true);
    for (const c of list) expect(isForbiddenLicence(c.licence), `${c.title} ${c.licence}`).toBe(false);
    // a lock keyed by file path still gives a readable title (the asset's page name), never a file path
    for (const c of list) expect(c.title, c.url).not.toMatch(/\.(jpe?g|png|webp|glb|gltf|hdr)$/i);
    for (const r of lock.rejected) expect(list.some((c) => c.url === r.url && /CC BY/.test(c.licence) && c.lock.includes('home')), r.url).toBe(false);
  });
  it('is tolerant: a missing file, a broken one, an unknown shape and new fields are skipped or read, never thrown', async () => {
    const list = await loadCredits(async (p) => {
      if (p.includes('missing')) throw new Error('404');
      if (p.includes('broken')) return 'not json';
      if (p.includes('new')) return { generatedBy: 'x', packs: [{ deep: { title: 'Lounge chair', creator: 'Someone', sourceUrl: 'https://example.org/a', license: 'CC-BY-4.0', extra: { nested: 1 } } }], rejected: [{ what: 'x', url: 'https://example.org/r', licence: 'CC BY', why: 'no' }] };
      return null;
    }, ['/look/missing.lock.json', '/look/broken.lock.json', '/look/club/new.lock.json', '/look/empty.lock.json']);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Lounge chair', author: 'Someone', url: 'https://example.org/a', licence: 'CC-BY-4.0' });
    expect(list[0].licenceUrl).toMatch(/licenses\/by\/4\.0/);
  });
  it('one line per asset: a page listed by two locks or by several files is credited once', () => {
    const a = { assets: { x: { name: 'Thing', authors: ['A'], page: 'https://example.org/t', licence: 'CC BY 4.0' } } };
    const b = { files: { 'f1.jpg': { page: 'https://example.org/t/', author: 'A', licence: 'CC BY 4.0' }, 'f2.jpg': { page: 'https://example.org/t', author: 'A', licence: 'CC BY 4.0' } } };
    expect(mergeCredits([{ path: '/a', json: a }, { path: '/b', json: b }])).toHaveLength(1);
    expect(creditsFromLock(b, '/b')).toHaveLength(2);
  });
});
