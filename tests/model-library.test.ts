// The CC0 model library (SPEC 16.15), headless: the fit rule, the fall back to the generator, sizes and surface heights unchanged with a
// model in, the recolour mapping, the manifest and the lock, decor out of collision, and what the baked-lighting dump sees.
// The real GLBs need a browser to decode their WebP textures, so the pieces below are built from templates made by hand at the MEASURED sizes
// of the manifest (the browser check in SPEC 16.15 loads the real files and compares their size with the manifest).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { itemFromCatalog } from '../src/core/catalog';
import { cellValue } from '../src/core/grid-codec';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { buildFurnitureMesh, setFurnitureDefaults } from '../src/engine/furniture';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { buildRealFurniture, resolveItemLook } from '../src/look/furniture-real';
import { exportScene } from '../src/look/baked/export';
import { buildDecorGroup } from '../src/look/lived-in/build';
import { planLivedIn } from '../src/look/lived-in/plan';
import { PACKS, getPack, loadPack } from '../src/look/packs';
import { getStyle, resetStyle, setStyle } from '../src/look/style';
import { attachModel, modelNote } from '../src/look/models/apply';
import { attachDecorModel } from '../src/look/models/decor';
import { FIT_TOL, SURFACE_TOL_M, decorScale, fitModel, surfaceMatches } from '../src/look/models/fit';
import { applyFinishToModelMaterial, instantiate } from '../src/look/models/instance';
import {
  CHAIR_SLOT, DECOR_MODELS, FRUIT_IDS, FURNITURE_MODELS, allModelIds, decorChoice, libModel, modelInfo, modelUrl, planFurniture, setModelsEnabled,
} from '../src/look/models/library';
import { clearModelCache, loadModel, modelStats, primeModel, setModelFetcher } from '../src/look/models/load';
import type { Template } from '../src/look/models/load';
import type { FurnitureItem } from '../src/types';
import { livedInFurniture, livedInLayout } from './helpers/lived-in-flat';

const ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'public/look/models');
const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

/** a template of the model's measured size: each part a box of the full size on the origin the manifest promises (floor: centred, wall: back on z = 0) */
function fakeTemplate(id: string): Template {
  const info = modelInfo(id)!;
  const tex = new THREE.DataTexture(new Uint8Array([180, 160, 140, 255]), 1, 1);
  tex.needsUpdate = true;
  const { w, h, d } = info.dims;
  const parts = Object.keys(info.parts).map((name) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(0, h / 2, info.place === 'wall' ? d / 2 : 0);
    return { name, geometry, material: new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, name }) };
  });
  return { id, tier: 'full', parts };
}
const primeAll = (): void => { for (const id of allModelIds()) { primeModel(id, 'medium', fakeTemplate(id)); primeModel(id, 'low', { ...fakeTemplate(id), tier: 'low' }); } };

const base = (over: Partial<FurnitureItem>): FurnitureItem => ({
  id: 'x-1', source: 'real', kind: 'counter', label: 'Side table', box: { cx: 0, cz: 0, w: 0.53, d: 0.41, yawDeg: 0 }, heightM: 0.55, surfaceHeightM: 0.55, ...over,
});
const dining = (w: number, d: number, h = 0.95): FurnitureItem => base({ id: 'dining-1', kind: 'dining', label: 'Dining table', box: { cx: 0, cz: 0, w, d, yawDeg: 0 }, heightM: h, surfaceHeightM: 0.75 });
const cabinet = (w: number): FurnitureItem => base({ id: 'tv-1', label: 'TV unit', box: { cx: 0, cz: 0, w, d: 0.52, yawDeg: 0 }, heightM: 0.68, surfaceHeightM: 0.68 });

beforeEach(() => { setModelsEnabled(true); setStyle({ packId: 'light-scandinavian' }); });
afterEach(() => { resetStyle(); setModelsEnabled(true); clearModelCache(); setModelFetcher(null); });

const worldBox = (g: THREE.Object3D): THREE.Box3 => { g.updateMatrixWorld(true); return new THREE.Box3().setFromObject(g); };
const meshes = (g: THREE.Object3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };

describe('the fit rule: sizes come from the home, never from the model', () => {
  const m = { w: 0.55, h: 0.55, d: 0.45 };
  it('takes a model within 12 % on every axis and says how much to scale', () => {
    const r = fitModel(m, { w: 0.55 * 1.12, h: 0.55 * 0.88, d: 0.45 });
    expect(r.ok).toBe(true);
    expect(r.scale.x).toBeCloseTo(1.12, 6);
    expect(r.scale.y).toBeCloseTo(0.88, 6);
    expect(r.worst).toBeLessThanOrEqual(FIT_TOL + 1e-9);
  });
  it('refuses a model that would be stretched more than 12 % on any one axis', () => {
    expect(fitModel(m, { w: 0.55 * 1.13, h: 0.55, d: 0.45 }).ok).toBe(false);
    expect(fitModel(m, { w: 0.55, h: 0.55 * 0.87, d: 0.45 }).ok).toBe(false);
    expect(fitModel(m, { w: 0.55, h: 0.55, d: 0.45 * 1.2 }).ok).toBe(false);
    expect(fitModel(m, { w: 0, h: 0.55, d: 0.45 }).ok).toBe(false);
  });
  it('turns a squarish piece a quarter when that fits better, and a front-facing one never', () => {
    const slot = { w: 0.45, h: 0.55, d: 0.55 };
    expect(fitModel(m, slot).ok).toBe(false);
    const t = fitModel(m, slot, FIT_TOL, true);
    expect(t.ok).toBe(true);
    expect(t.turned).toBe(true);
    expect(t.scale.x).toBeCloseTo(1, 6);
    expect(t.scale.z).toBeCloseTo(1, 6);
  });
  it('checks the seat or top height against the item\'s own surface height, to 3 cm', () => {
    expect(surfaceMatches(0.45, 1, 0.45 + SURFACE_TOL_M)).toBe(true);
    expect(surfaceMatches(0.45, 1, 0.45 + SURFACE_TOL_M + 0.005)).toBe(false);
    expect(surfaceMatches(0.45, 1.1, 0.495)).toBe(true);
    expect(surfaceMatches(undefined, 1, 0.9)).toBe(true);
  });
  it('scales decor uniformly, never past the piece\'s height or 1.25 times its footprint', () => {
    const s = decorScale({ w: 0.7, h: 0.84, d: 0.66 }, { w: 0.36, d: 0.36, height: 0.78 });
    expect(s).toBeCloseTo((1.25 * 0.36) / 0.7, 6);
    expect(decorScale({ w: 0.3, h: 0.3, d: 0.3 }, { w: 0.5, d: 0.5, height: 0.1 })).toBeCloseTo(0.35, 6);
  });
});

describe('which pieces get a model', () => {
  const plan = (it: FurnitureItem, packId = 'light-scandinavian') => { setStyle({ packId }); return planFurniture(it, resolveItemLook(it), getStyle().pack.models ?? null); };
  it('a side table of the model\'s own size does, a catalogue one that is 18 % narrower does not', () => {
    const p = plan(base({}));
    expect(p?.model.id).toBe('side_table_01');
    expect(p!.fit.worst).toBeLessThanOrEqual(FIT_TOL);
    expect(plan(base({ box: { cx: 0, cz: 0, w: 0.45, d: 0.45, yawDeg: 0 } }))).toBeNull();
  });
  it('a height or a surface that does not match keeps the generator', () => {
    expect(plan(base({ heightM: 0.45, surfaceHeightM: 0.45 }))).toBeNull();
    expect(plan(base({ surfaceHeightM: 0.5 }))).toBeNull();
  });
  it('a TV unit takes the cabinet only near its length', () => {
    expect(plan(cabinet(2.4))?.model.id).toBe('modern_wooden_cabinet');
    expect(plan(cabinet(1.8))).toBeNull();
  });
  it('dining chairs need the chair slot to fit the item\'s height and both rows to leave the middle of the table clear', () => {
    expect(plan(dining(1.8, 1.7))?.model.id).toBe('dining_chair_02');
    expect(plan(dining(1.52, 0.91))).toBeNull(); // 0.91 deep: two rows of 0.58 deep chairs would meet under the table
    expect(plan(dining(1.8, 1.7, 0.7))).toBeNull(); // a chair of 0.97 would have to be squashed 28 %
    expect(plan(dining(0.79, 1.4))).toBeNull(); // built turned: 0.79 across
    expect(CHAIR_SLOT.w).toBeCloseTo(0.44, 6);
  });
  it('families with no free model (bed, sofa, wardrobe, study, counter) stay generated', () => {
    for (const [kind, label] of [['bed', 'Bed'], ['sofa', 'Sofa'], ['wardrobe', 'Wardrobe'], ['counter', 'Study'], ['counter', '']] as const) {
      const it = base({ kind, label, box: { cx: 0, cz: 0, w: 1.6, d: 0.7, yawDeg: 0 }, heightM: 0.85, surfaceHeightM: 0.45 });
      expect(plan(it)).toBeNull();
    }
    expect(FURNITURE_MODELS.map((f) => f.family).sort()).toEqual(['dining', 'dresser', 'side']);
  });
  it('anything the drawing, the design sheet or the viewer chose about the shape keeps the generator, a recolour does not', () => {
    const styled = base({ finish: { style: 'storage' } });
    expect(plan(styled)).toBeNull();
    expect(plan(base({ finish: { primary: 'wood-walnut' } }))?.model.id).toBe('side_table_01');
    // a design sheet that sets a param of this piece
    const it = base({ id: 'side-9' });
    setStyle({ packId: 'light-scandinavian', sheet: { version: 1, pack: 'light-scandinavian', source: 'typical', items: { 'side-9': { params: { style: 'drawer' } } }, rooms: {}, fixtures: [] } });
    expect(planFurniture(it, resolveItemLook(it), getStyle().pack.models ?? null)).toBeNull();
  });
  it('the Classic look, a pack that says generator, and ?models=off never use a model', () => {
    expect(plan(base({}), 'classic')).toBeNull();
    expect(plan(base({}), 'warm-oak-navy')).toBeNull(); // the designer pack keeps its generated pieces
    setModelsEnabled(false);
    expect(plan(base({}))).toBeNull();
  });
});

describe('the generated piece stays until a model arrives, and stays if none does', () => {
  it('a failed fetch leaves the generated meshes, the finish flag and the item untouched', async () => {
    setModelFetcher(async () => { throw new Error('offline'); });
    const it = base({});
    const g = new THREE.Group();
    const kit = createFurnitureKit();
    buildRealFurniture(g, it, 'medium', kit);
    const names = meshes(g).map((m) => m.name).sort();
    expect(names.length).toBeGreaterThan(0);
    await loadModel('side_table_01', 'medium');
    expect(modelStats.failed.length).toBeGreaterThan(0);
    expect(meshes(g).map((m) => m.name).sort()).toEqual(names);
    expect(g.userData.model).toBeUndefined();
    expect(g.userData.finishApplied).toBe(true);
    expect(modelNote(it.id)).toBe('');
  });
  it('the first build shows generated meshes; the model replaces them in place and an item card says so', async () => {
    primeAll();
    const it = base({});
    const g = new THREE.Group();
    const kit = createFurnitureKit();
    buildRealFurniture(g, it, 'medium', kit);
    const gen = meshes(g);
    expect(gen.length).toBeGreaterThan(0);
    expect(gen.every((m) => !m.userData.model)).toBe(true);
    await attachModel(g, it, resolveItemLook(it)!, planFurniture(it, resolveItemLook(it), getStyle().pack.models!)!, 'medium', kit);
    expect(g.userData.model.id).toBe('side_table_01');
    expect(meshes(g).every((m) => m.userData.model === 'side_table_01')).toBe(true);
    expect(modelNote(it.id)).toContain('stock 3D model');
    expect(modelNote(it.id)).toContain('typical styling');
  });
  it('a rebuild before the model arrives drops the late answer', async () => {
    primeAll();
    const it = base({});
    const g = new THREE.Group();
    const kit = createFurnitureKit();
    buildRealFurniture(g, it, 'medium', kit);
    const late = attachModel(g, it, resolveItemLook(it)!, planFurniture(it, resolveItemLook(it), getStyle().pack.models!)!, 'medium', kit);
    buildRealFurniture(g, { ...it, box: { ...it.box, w: 0.2 } }, 'medium', kit); // a new build starts a new token (and has no model: too small)
    expect(await late).toBe(false);
  });
});

describe('sizes and surface heights do not move with a model in', () => {
  const tiers = ['low', 'medium'] as const;
  const cases: [string, FurnitureItem][] = [
    ['side table', base({})],
    ['side table, turned', base({ box: { cx: 0, cz: 0, w: 0.45, d: 0.55, yawDeg: 0 }, surfaceHeightM: 0.55 })],
    ['TV unit', cabinet(2.4)],
    ['dining set', dining(1.8, 1.7)],
    ['dining set, turned', dining(1.7, 1.8)],
  ];
  for (const [name, it] of cases) {
    for (const tier of tiers) {
      it_(`${name} (${tier})`, it, tier);
    }
  }
  function it_(name: string, item: FurnitureItem, tier: 'low' | 'medium'): void {
    it(`${name} stays inside its drawn box and height, same item, same surface`, async () => {
      primeAll();
      const before = JSON.stringify(item);
      const g = new THREE.Group();
      const kit = createFurnitureKit();
      const gen = (() => { const c = new THREE.Group(); setModelsEnabled(false); buildRealFurniture(c, item, tier, kit); setModelsEnabled(true); return worldBox(c); })();
      buildRealFurniture(g, item, tier, kit);
      const look = resolveItemLook(item)!;
      const plan = planFurniture(item, look, getStyle().pack.models!);
      expect(plan, `${name} should get a model`).toBeTruthy();
      if (!plan) return;
      await attachModel(g, item, look, plan, tier, kit);
      expect(g.userData.model).toBeTruthy();
      const box = worldBox(g);
      const sz = box.getSize(new THREE.Vector3());
      const s = gen.getSize(new THREE.Vector3());
      // the model's extent is the drawn one to the fit tolerance; it never leaves the drawn box by more than a centimetre
      expect(box.max.x).toBeLessThanOrEqual(item.box.w / 2 + 0.01);
      expect(box.min.x).toBeGreaterThanOrEqual(-item.box.w / 2 - 0.01);
      expect(box.max.z).toBeLessThanOrEqual(item.box.d / 2 + 0.01);
      expect(box.min.z).toBeGreaterThanOrEqual(-item.box.d / 2 - 0.01);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.005);
      expect(box.max.y).toBeLessThanOrEqual(item.heightM + 0.01);
      expect(sz.y).toBeGreaterThan(0.5 * s.y);
      // the data every check reads is the item's, untouched
      expect(JSON.stringify(item)).toBe(before);
      const surface = plan.info.surfaceM !== undefined ? plan.info.surfaceM * plan.fit.scale.y : undefined;
      if (plan.model.use === 'whole' && surface !== undefined) expect(Math.abs(surface - item.surfaceHeightM)).toBeLessThanOrEqual(SURFACE_TOL_M + 1e-9);
      if (plan.model.use === 'chairs') expect(Math.abs(plan.info.surfaceM! * plan.fit.scale.y - 0.45)).toBeLessThanOrEqual(SURFACE_TOL_M + 1e-9);
    });
  }
  it('a turned side table is the model turned a quarter and still inside the box', async () => {
    primeAll();
    const item = base({ box: { cx: 0, cz: 0, w: 0.45, d: 0.55, yawDeg: 0 } });
    const look = resolveItemLook(item)!;
    const plan = planFurniture(item, look, getStyle().pack.models!)!;
    expect(plan.fit.turned).toBe(true);
    const g = new THREE.Group();
    buildRealFurniture(g, item, 'medium', createFurnitureKit());
    await attachModel(g, item, look, plan, 'medium', createFurnitureKit());
    const box = worldBox(g).getSize(new THREE.Vector3());
    expect(box.x).toBeCloseTo(0.45, 2);
    expect(box.z).toBeCloseTo(0.55, 2);
  });
  it('a dining set swaps only its chairs: the table top is where the item says', async () => {
    primeAll();
    const item = dining(1.8, 1.7);
    const kit = createFurnitureKit();
    const look = resolveItemLook(item)!;
    const g = new THREE.Group();
    buildRealFurniture(g, item, 'medium', kit);
    const topGen = worldBox(meshes(g).find((m) => m.name === 'table-top')!);
    await attachModel(g, item, look, planFurniture(item, look, getStyle().pack.models!)!, 'medium', kit);
    const top = worldBox(meshes(g).find((m) => m.name === 'table-top')!);
    expect(top.max.y).toBeCloseTo(item.surfaceHeightM, 6);
    expect(top.max.y).toBeCloseTo(topGen.max.y, 6);
    const chairs = meshes(g).filter((m) => m.name.startsWith('chair-'));
    expect(chairs.map((m) => m.name).sort()).toEqual(['chair-legs', 'chair-seats']);
    // two rows of three, the near row facing the far one: none of them past the middle of the table
    const seats = worldBox(chairs.find((m) => m.name === 'chair-seats')!);
    expect(seats.max.z).toBeLessThanOrEqual(item.box.d / 2 + 0.01);
    expect(seats.min.z).toBeGreaterThanOrEqual(-item.box.d / 2 - 0.01);
  });
});

describe('recolour through the finish palette', () => {
  const tpl = (): Template => fakeTemplate('dining_chair_02');
  it('maps each part to the first role the look defines, and leaves unmapped parts alone', () => {
    const lm = libModel('dining_chair_02')!;
    const g = instantiate(tpl(), [{ x: 0, y: 0, z: 0, yawDeg: 0, scale: { x: 1, y: 1, z: 1 } }], {
      partUse: lm.parts, roles: { fabric: { key: 'weave', tint: '#2F7F82' }, case: { key: 'wood', tint: '#A87C56' } },
    });
    const fab = meshes(g).find((m) => m.name === 'fabric')!.material as THREE.MeshStandardMaterial;
    const legs = meshes(g).find((m) => m.name === 'legs')!.material as THREE.MeshStandardMaterial;
    expect(`#${fab.color.getHexString()}`.toLowerCase()).toBe('#2f7f82');
    expect(`#${legs.color.getHexString()}`.toLowerCase()).toBe('#a87c56');
    // the finish keeps the model's own light and dark as detail (the same shader patch the generators' wood and weave use)
    expect(fab.map).toBeTruthy();
    expect(fab.customProgramCacheKey()).toContain('walkthru-furniture-detail');
    expect(fab.userData.baseColor).toBe(fab.color.getHex());
    const none = instantiate(tpl(), [{ x: 0, y: 0, z: 0, yawDeg: 0, scale: { x: 1, y: 1, z: 1 } }], { partUse: lm.parts, roles: {} });
    const keep = meshes(none).find((m) => m.name === 'fabric')!.material as THREE.MeshStandardMaterial;
    expect(`#${keep.color.getHexString()}`).toBe('#ffffff');
  });
  it('a laminate or a metal is a plain colour with its own roughness and metalness; the verdict tint can lerp from baseColor', () => {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: fakeTemplate('side_table_01').parts[0].material.map });
    applyFinishToModelMaterial(mat, { key: 'blackMetal', tint: '#1D1D1F' }, 0.2);
    expect(mat.map).toBeNull();
    expect(mat.metalness).toBeGreaterThan(0.5);
    expect(mat.userData.flatFinish).toBe(true);
    expect(mat.userData.baseColor).toBe(mat.color.getHex());
  });
  it('the viewer\'s own finish (Change look) reaches the model: roles come from item.finish, so a recolour changes the model\'s colour', async () => {
    primeAll();
    const plain = base({});
    const painted = base({ finish: { primary: 'lam-navy' } });
    const kit = createFurnitureKit();
    const colourOf = async (it: FurnitureItem): Promise<string> => {
      const g = new THREE.Group();
      buildRealFurniture(g, it, 'medium', kit);
      const look = resolveItemLook(it)!;
      await attachModel(g, it, look, planFurniture(it, look, getStyle().pack.models!)!, 'medium', kit);
      expect(g.userData.finishApplied).toBe(true);
      return `#${(meshes(g)[0].material as THREE.MeshStandardMaterial).color.getHexString()}`;
    };
    const a = await colourOf(plain), b = await colourOf(painted);
    expect(a).not.toBe(b);
    expect(b.toLowerCase()).toBe('#2d3d5c');
  });
});

describe('decor models are out of collision, measurement and rays', () => {
  const pieces = planLivedIn({ layout: livedInLayout, items: livedInFurniture, grid: stampFurniture(rasterizeLayout(livedInLayout), livedInFurniture) });
  it('the plan, and the walking grid it was made on, do not know the models exist', () => {
    const grid = stampFurniture(rasterizeLayout(livedInLayout), livedInFurniture);
    const before = new Uint8Array(grid.cells);
    const again = planLivedIn({ layout: livedInLayout, items: livedInFurniture, grid });
    expect(again.map((p) => [p.kind, p.x, p.z, p.w, p.d, p.height])).toEqual(pieces.map((p) => [p.kind, p.x, p.z, p.w, p.d, p.height]));
    expect(Array.from(grid.cells)).toEqual(Array.from(before));
    for (const p of pieces.filter((q) => q.place === 'floor')) expect(cellValue(grid, p.x, p.z)).toBe(0);
  });
  it('a built piece replaced by a model is not hit by any ray and is tagged decor', async () => {
    primeAll();
    const built = buildDecorGroup(pieces, 'medium', getStyle().pack.models ?? null);
    await new Promise((r) => setTimeout(r, 20));
    const swapped = [...built.byId.values()].filter((g) => g.userData.model);
    expect(swapped.length).toBeGreaterThan(0);
    const kinds = new Set(pieces.filter((p) => built.byId.get(p.id)?.userData.model).map((p) => p.kind));
    for (const k of ['plant', 'clock']) expect(kinds.has(k as never)).toBe(true);
    for (const g of swapped) for (const m of meshes(g)) {
      expect(m.userData.decor).toBe(true);
      const rc = new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0));
      m.updateMatrixWorld(true);
      expect(rc.intersectObject(m, false)).toEqual([]);
      expect(m.geometry.getAttribute('normal')).toBeTruthy();
    }
    built.dispose();
  });
  it('decor model sizes follow the planner\'s piece, never the other way round', () => {
    for (const p of pieces) {
      const c = decorChoice(p.kind, { w: p.w, d: p.d, height: p.height, seed: p.seed, wall: p.place === 'wall' }, getStyle().pack.models ?? null);
      if (!c || p.kind === 'fruit') continue;
      expect(c.info.dims.h * c.scale).toBeLessThanOrEqual(p.height + 1e-6);
      expect(c.info.dims.w * c.scale).toBeLessThanOrEqual(1.25 * p.w + 1e-6);
    }
  });
  it('the Classic look and ?models=off build only generated decor', () => {
    resetStyle();
    const built = buildDecorGroup(pieces, 'medium', null);
    expect([...built.byId.values()].some((g) => g.userData.model)).toBe(false);
    built.dispose();
  });
  it('attachDecorModel gives up quietly when the model is missing', async () => {
    setModelFetcher(async () => { throw new Error('offline'); });
    const g = new THREE.Group();
    const p = pieces.find((q) => q.kind === 'plant')!;
    expect(await attachDecorModel(g, p, 'medium', getStyle().pack.models ?? null)).toBe(false);
  });
});

describe('what the baked-lighting dump sees', () => {
  it('model-backed furniture is ordinary movable meshes: stable unique names, normals, UVs, standard materials', async () => {
    primeAll();
    setFurnitureDefaults({ style: 'real', tier: 'medium' });
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.name = 'furniture';
    scene.add(root);
    const items = [base({}), dining(1.8, 1.7), cabinet(2.4)];
    const groups = items.map((it, i) => { const g = buildFurnitureMesh({ ...it, id: `${it.id}-${i}`, box: { ...it.box, cx: i * 3 } }); root.add(g); return g; });
    await new Promise((r) => setTimeout(r, 30));
    expect(groups.every((g) => g.userData.model)).toBe(true);
    for (const m of meshes(root)) {
      expect(m.userData.walkthruPart).toBe(m.name);
      expect(m.geometry.getAttribute('normal')).toBeTruthy();
      expect(m.geometry.getAttribute('uv')).toBeTruthy();
      expect((m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    }
    const { dump } = exportScene({ scene, sceneId: 'test', wallHeightM: 2.6 });
    const keys = dump.meshes.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(dump.meshes.length).toBe(meshes(root).filter((m) => m.userData.walkthruBake !== 'skip').length);
    expect(dump.meshes.every((m) => m.cls === 'dyn' && m.verts > 0)).toBe(true);
    expect(dump.meshes.every((m) => m.key.startsWith('furniture/furniture:'))).toBe(true);
    setFurnitureDefaults({ style: 'plain', tier: 'medium' });
  });
});

describe('parts that would swamp the bake atlas are left out of it', () => {
  it('leaves and slats carry walkthruBake skip, every other part does not, and the dump leaves them out', () => {
    primeAll();
    const plant = decorChoice('plant', { w: 0.36, d: 0.36, height: 0.78, seed: 0 }, getStyle().pack.models!)!;
    const g = instantiate(fakeTemplate(plant.model.id), [{ x: 0, y: 0, z: 0, yawDeg: 0, scale: { x: 1, y: 1, z: 1 } }], { partUse: plant.model.parts });
    const skipped = meshes(g).filter((m) => m.userData.walkthruBake === 'skip').map((m) => m.name);
    expect(skipped).toEqual(['leaves']);
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.name = 'furniture';
    root.add(g);
    scene.add(root);
    const { dump } = exportScene({ scene, sceneId: 'test', wallHeightM: 2.6 });
    expect(dump.meshes.map((m) => m.key.split('/').pop())).toEqual(['pot']);
  });
});

describe('style packs choose models', () => {
  it('the shipped packs: Classic has none, the designer pack keeps every furniture family generated, the others take what fits', () => {
    expect(getPack('classic')!.models).toBeUndefined();
    const warm = getPack('warm-oak-navy')!.models!;
    for (const f of ['bed', 'sofa', 'side', 'dresser', 'dining'] as const) expect(warm[f]).toBe('generator');
    expect(getPack('light-scandinavian')!.models).toBeTruthy();
    expect(getPack('walnut-white')!.models).toBeTruthy();
    expect(PACKS.length).toBe(6);
  });
  it('loadPack drops a family it does not know and a model that is not for the family, and keeps "generator"', () => {
    const { pack, dropped } = loadPack({ id: 'x-pack', name: 'X', models: { plant: ['potted_plant_01', 'dining_chair_02'], sofa: 'generator', nonsense: ['a'], jug: 'yes' } });
    expect(pack!.models!.plant).toEqual(['potted_plant_01']);
    expect(pack!.models!.sofa).toBe('generator');
    expect(pack!.models!.jug).toBeUndefined();
    expect(dropped.join('|')).toContain('nonsense');
    expect(dropped.join('|')).toContain('dining_chair_02');
  });
  it('a pack\'s order of preference picks the decor model', () => {
    const pol = { jug: ['ceramic_vase_04', 'jug_01'] } as const;
    const c = decorChoice('jug', { w: 0.13, d: 0.13, height: 0.22, seed: 0 }, pol as never);
    expect(c!.model.id).toBe('ceramic_vase_04');
    expect(decorChoice('jug', { w: 0.13, d: 0.13, height: 0.22, seed: 1 }, { jug: 'generator' })).toBeNull();
    expect(decorChoice('lamp', { w: 0.2, d: 0.2, height: 0.3, seed: 1 }, {})).toBeNull();
    // looked at and rejected (SPEC 16.15): a pot on the counter and a picture frame stay the generated pieces
    for (const k of ['cooker', 'frame', 'cushion', 'rug']) expect(decorChoice(k, { w: 0.3, d: 0.3, height: 0.3, seed: 1 }, {})).toBeNull();
  });
});

describe('the manifest, the files and the lock agree', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, 'models.lock.json'), 'utf8')) as {
    licence: string; licenceUrl: string;
    models: Record<string, { id: string; page: string; licence: string; licenceUrl: string; licenceVerified: string; fetched: string; authors: string[]; sources: { path: string; url: string; size: number; md5: string; sha256: string }[]; outputs: Record<string, { bytes: number; sha256: string }> }>;
  };
  const licenceText = fs.readFileSync(path.join(MODELS_DIR, 'LICENCE.txt'), 'utf8');
  it('every model has both files on disk, the size and SHA-256 of the manifest and of the lock', () => {
    expect(allModelIds().length).toBeGreaterThanOrEqual(14);
    for (const id of allModelIds()) {
      const info = modelInfo(id)!;
      for (const tier of ['low', 'full'] as const) {
        const f = info.files[tier];
        const buf = fs.readFileSync(path.join(MODELS_DIR, f.file));
        expect(buf.length, `${f.file} bytes`).toBe(f.bytes);
        expect(sha(buf), `${f.file} sha256`).toBe(lock.models[id].outputs[f.file].sha256);
        expect(buf.subarray(0, 4).toString(), `${f.file} is a GLB`).toBe('glTF');
        expect(lock.models[id].outputs[f.file].bytes, `${f.file} in the lock`).toBe(f.bytes);
        expect(modelUrl(id, tier)).toBe(`/look/models/${f.file}`);
      }
    }
  });
  it('every file in the folder is accounted for', () => {
    const known = new Set(allModelIds().flatMap((id) => Object.values(modelInfo(id)!.files).map((f) => f.file)));
    const old = new Set(['dining_chair_02', 'sofa_02', 'LICENCE.txt', 'models.lock.json']);
    for (const f of fs.readdirSync(MODELS_DIR)) expect(known.has(f) || old.has(f), `${f} is unaccounted for`).toBe(true);
  });
  it('the phone file of every model is within the 150 KB budget, the full file within 500 KB', () => {
    for (const id of allModelIds()) {
      const info = modelInfo(id)!;
      expect(info.files.low.bytes, `${id} low`).toBeLessThanOrEqual(150 * 1024);
      expect(info.files.full.bytes, `${id} full`).toBeLessThanOrEqual(500 * 1024);
      expect(info.files.low.bytes).toBeLessThanOrEqual(info.files.full.bytes);
    }
  });
  it('every source is CC0 from Poly Haven with its page, its author, the date the licence was read and a checked MD5', () => {
    expect(lock.licence).toContain('CC0');
    expect(lock.licenceUrl).toBe('https://polyhaven.com/license');
    for (const id of allModelIds()) {
      const m = lock.models[id];
      expect(m, id).toBeTruthy();
      expect(m.licence).toBe('CC0 1.0');
      expect(m.page).toBe(`https://polyhaven.com/a/${id}`);
      expect(m.authors.length).toBeGreaterThan(0);
      expect(m.licenceVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.sources.length).toBeGreaterThanOrEqual(3);
      for (const s of m.sources) { expect(s.url.startsWith('https://dl.polyhaven.org/file/ph-assets/')).toBe(true); expect(s.md5).toMatch(/^[0-9a-f]{32}$/); expect(s.sha256).toMatch(/^[0-9a-f]{64}$/); expect(s.size).toBeGreaterThan(0); }
      expect(licenceText).toContain(`(${id})`);
    }
    expect(licenceText).toContain('CC0');
  });
  it('the sources looked at for better models are recorded with a URL, the licence wording relied on and the result; nothing unlicensed is shipped', () => {
    const routes = (lock as unknown as { routes: { read: string; summary: string; sources: { name: string; url: string; licence: string; result: string }[] } }).routes;
    expect(routes.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(routes.sources.length).toBeGreaterThanOrEqual(6);
    for (const x of routes.sources) {
      expect(x.url.startsWith('https://'), x.name).toBe(true);
      expect(x.licence.length, x.name).toBeGreaterThan(2);
      expect(x.result.length, x.name).toBeGreaterThan(20);
      expect(licenceText, x.name).toContain(x.name);
    }
    // the generators whose stack is not MIT or Apache end to end are recorded as not used, and no shipped file comes from any route but Poly Haven
    const trellis = routes.sources.find((x) => x.name.startsWith('TRELLIS'))!;
    expect(trellis.result.startsWith('NOT USED')).toBe(true);
    expect(trellis.result).toContain('non-commercially');
    expect(routes.sources.find((x) => x.name.startsWith('Hi3DGen'))!.licence).toContain('commercially');
    for (const id of allModelIds()) expect(lock.models[id].page.startsWith('https://polyhaven.com/a/')).toBe(true);
  });
  it('the library and the manifest name the same parts and the same models', () => {
    const lib = new Set([...FURNITURE_MODELS, ...DECOR_MODELS].map((m) => m.id));
    for (const id of lib) expect(modelInfo(id), `${id} is in the library but not shipped`).toBeTruthy();
    for (const id of FRUIT_IDS) expect(modelInfo(id), `${id} fruit is not shipped`).toBeTruthy();
    for (const id of allModelIds()) expect(lib.has(id) || FRUIT_IDS.includes(id), `${id} is shipped but unused`).toBe(true);
    for (const m of [...FURNITURE_MODELS, ...DECOR_MODELS]) expect(Object.keys(m.parts).sort(), m.id).toEqual(Object.keys(modelInfo(m.id)!.parts).sort());
  });
  it('sizes are positive metres in a sane range, the origin convention is declared, a seat or top height lies inside the model', () => {
    for (const id of allModelIds()) {
      const i = modelInfo(id)!;
      for (const v of [i.dims.w, i.dims.h, i.dims.d]) { expect(v).toBeGreaterThan(0.02); expect(v).toBeLessThan(3); }
      expect(['floor', 'wall']).toContain(i.place);
      if (i.surfaceM !== undefined) expect(i.surfaceM).toBeLessThanOrEqual(i.dims.h + 1e-6);
    }
  });
});
