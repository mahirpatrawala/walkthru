// SPEC 16.17.1 (22 Nov 2026): the gym's real models and photographed maps. The downloaded dumbbell and kettlebell are swapped into the generated
// racks without changing a box, the files on disk are the ones the lock records, every CC BY model is credited, and the tower's gym has its
// mirror wall and rubber flooring with every piece still where it fits.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { itemFromCatalog } from '../src/core/catalog';
import { buildRealFurniture } from '../src/look/furniture-real';
import { createFurnitureKit, DEFS } from '../src/look/furniture-materials';
import { resetStyle, setStyle } from '../src/look/style';
import { setModelsEnabled } from '../src/look/models/library';
import { PROP_CREDITS, attachProps, clearProps, loadProp, primeProp, propGeo, propInfo, propNote, setPropFetcher } from '../src/look/gym/props';
import type { Tier } from '../src/look/types';

const ROOT = path.resolve(__dirname, '..');
const GYM = path.join(ROOT, 'public/look/gym');
const fromDisk = async (url: string): Promise<ArrayBuffer> => { const b = fs.readFileSync(path.join(ROOT, 'public', url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

afterEach(() => { resetStyle(); setModelsEnabled(true); clearProps(); setPropFetcher(null); });

function bounds(g: THREE.Object3D): THREE.Box3 {
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3();
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) bb.union(new THREE.Box3().setFromObject(o)); });
  return bb;
}
const build = (id: string, tier: Tier): { g: THREE.Group; item: ReturnType<typeof itemFromCatalog> } => {
  setStyle({ packId: 'light-scandinavian' });
  const row = itemFromCatalog(id, { cx: 0, cz: 0, w: 1, d: 1, yawDeg: 0 }, 'virtual');
  const item = itemFromCatalog(id, { cx: 0, cz: 0, w: row.box.w, d: row.box.d, yawDeg: 0 }, 'virtual');
  const g = new THREE.Group();
  buildRealFurniture(g, item, tier, createFurnitureKit());
  return { g, item };
};
const near = (a: THREE.Box3, b: THREE.Box3, tol = 0.012): void => {
  for (const k of ['x', 'y', 'z'] as const) { expect(Math.abs(a.min[k] - b.min[k])).toBeLessThan(tol); expect(Math.abs(a.max[k] - b.max[k])).toBeLessThan(tol); }
};

describe('the downloaded props', () => {
  it('load from the shipped files (both tiers) with the parts the generators use', async () => {
    setPropFetcher(fromDisk);
    for (const tier of ['low', 'high'] as Tier[]) {
      const db = await loadProp('dumbbell', tier);
      expect(db, `dumbbell ${tier}`).toBeTruthy();
      expect(Object.keys(db!.parts).sort()).toEqual(['handle', 'head']);
      const kb = await loadProp('kettlebell', tier);
      expect(Object.keys(kb!.parts).sort()).toEqual(['band', 'body']);
      // the kettlebell is normalised to 1 m high, its foot on y = 0
      const bb = new THREE.Box3();
      for (const g of Object.values(kb!.parts)) { g.computeBoundingBox(); bb.union(g.boundingBox!); }
      expect(bb.min.y).toBeGreaterThan(-0.01);
      expect(bb.max.y).toBeGreaterThan(0.98);
      expect(bb.max.y).toBeLessThan(1.01);
    }
  });

  it('a rack without its props draws generated weights and asks for the model; with the props in, the box is the same to the millimetre', async () => {
    setPropFetcher(fromDisk);
    for (const [id, kind] of [['gym-dumbbell-rack', 'dumbbell'], ['gym-kettlebell-rack', 'kettlebell']] as const) {
      for (const tier of ['low', 'medium', 'high'] as Tier[]) {
        clearProps();
        const { g, item } = build(id, tier);
        expect(propNote(item.id)).toBe('');
        const before = bounds(g);
        // the generator drew its own weights and asked for the model: the swap happens in place
        const names = new Set<string>(); g.traverse((o) => { if ((o as THREE.Mesh).isMesh) names.add(o.name); });
        const ok = await attachProps(g, item.id, [kind], tier, () => { const r = new THREE.Group(); buildRealFurniture(r, item, tier, createFurnitureKit()); return r; });
        expect(ok, `${id} ${tier}`).toBe(true);
        expect(propGeo(kind, tier)).toBeTruthy();
        const after = bounds(g);
        near(after, before);
        expect(after.max.x - after.min.x).toBeCloseTo(item.box.w, 1);
        expect(after.max.z - after.min.z).toBeCloseTo(item.box.d, 1);
        expect(Math.abs(after.max.y - item.heightM)).toBeLessThan(0.012);
        // the same part names (the bake and the colour pass know them), every mesh with UVs and normals
        const names2 = new Set<string>(); g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; names2.add(m.name); expect(m.geometry.attributes.uv, m.name).toBeDefined(); expect(m.geometry.attributes.normal).toBeDefined(); });
        expect([...names2].sort()).toEqual([...names].sort());
        expect(propNote(item.id)).toContain('CC BY 4.0');
        expect(g.userData.gymProps).toEqual([kind]);
      }
    }
  });

  it('a rack built after the props arrived uses them directly and says so', async () => {
    const heads = (g: THREE.Group): number => { let n = 0; g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name === 'dumbbells') n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return n; };
    setPropFetcher(async () => { throw new Error('offline'); });
    const generated = heads(build('gym-dumbbell-rack', 'high').g);
    clearProps(); // the failed fetch the build started is forgotten
    setPropFetcher(fromDisk);
    await loadProp('dumbbell', 'high');
    const { g, item } = build('gym-dumbbell-rack', 'high');
    // the model's bevelled hex heads are more triangles than a generated six-sided head, and the card credits the author
    expect(heads(g)).toBeGreaterThan(generated);
    expect(propNote(item.id)).toContain('Tytan');
  });

  it('?models=off keeps the generated weights, and a failed fetch keeps them too', async () => {
    setModelsEnabled(false);
    setPropFetcher(fromDisk);
    const { g, item } = build('gym-dumbbell-rack', 'high');
    expect(await attachProps(g, item.id, ['dumbbell'], 'high', () => new THREE.Group())).toBe(false);
    setModelsEnabled(true);
    setPropFetcher(async () => { throw new Error('offline'); });
    const b = build('gym-dumbbell-rack', 'high');
    const kids = b.g.children.length;
    expect(await attachProps(b.g, b.item.id, ['dumbbell'], 'high', () => new THREE.Group())).toBe(false);
    expect(b.g.children.length).toBe(kids);
  });

  it('a late answer for a rebuilt piece is dropped', async () => {
    setPropFetcher(fromDisk);
    const { g, item } = build('gym-dumbbell-rack', 'high');
    const p = attachProps(g, item.id, ['dumbbell'], 'high', () => new THREE.Group());
    g.userData.modelToken = {}; // the piece was rebuilt meanwhile
    expect(await p).toBe(false);
  });
});

describe('the chess set on the games-room chess table (SPEC 16.17.2)', () => {
  it('the shipped file is a textured glTF (WebP colour maps; the phone file has colour maps only)', () => {
    for (const t of ['full', 'low'] as const) {
      const buf = fs.readFileSync(path.join(GYM, propInfo('chess').files[t].file));
      const len = buf.readUInt32LE(12);
      const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { materials: { pbrMetallicRoughness?: { baseColorTexture?: unknown }; normalTexture?: unknown }[]; images: { mimeType: string }[] };
      expect(json.materials.every((m) => m.pbrMetallicRoughness?.baseColorTexture), t).toBe(true);
      expect(json.images.every((i) => i.mimeType === 'image/webp'), t).toBe(true);
      if (t === 'low') expect(json.materials.some((m) => m.normalTexture)).toBe(false);
    }
  });
  it('a chess table with the set in stays inside its box, keeps the maps of the model, and the card says where it is from', () => {
    // node cannot decode WebP, so the test hands in a small textured stand-in (src/look/models/load.ts does the same for the library)
    for (const tier of ['low', 'high'] as Tier[]) {
      clearProps();
      const g0 = new THREE.BoxGeometry(propInfo('chess').dims.w, propInfo('chess').dims.h, propInfo('chess').dims.d).translate(0, propInfo('chess').dims.h / 2, 0);
      primeProp('chess', tier, { kind: 'chess', parts: {}, meshes: [{ geometry: g0, material: new THREE.MeshStandardMaterial({ map: new THREE.Texture() }) }] });
      const { g, item } = build('games-chess-set', tier);
      const bb = bounds(g);
      expect(bb.max.y).toBeLessThanOrEqual(item.heightM + 0.012);
      expect(bb.max.x - bb.min.x).toBeLessThan(item.box.w + 0.012);
      expect(bb.max.z - bb.min.z).toBeLessThan(item.box.d + 0.012);
      let n = 0;
      g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name === 'chess-set-model') { n++; expect((m.material as THREE.MeshStandardMaterial).map).toBeTruthy(); expect(m.userData.walkthruPart).toBe('chess-set-model'); } });
      expect(n).toBe(1);
      expect(propNote(item.id)).toContain('Riley Queen');
    }
  });
});

describe('files, lock and credits', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(GYM, 'gym.lock.json'), 'utf8')) as {
    assets: Record<string, { licence: string; licenceUrl: string; licenceWords: string; licenceRead: string; authors: string[]; page: string; files: { url: string; sha256: string }[] }>;
    outputs: Record<string, { bytes: number; sha256: string }>;
    rejected: { what: string; why: string }[];
  };
  it('every shipped file is the one the lock records', () => {
    expect(Object.keys(lock.outputs).length).toBeGreaterThanOrEqual(7);
    for (const [rel, o] of Object.entries(lock.outputs)) {
      const buf = fs.readFileSync(path.join(GYM, rel));
      expect(buf.length, rel).toBe(o.bytes);
      expect(crypto.createHash('sha256').update(buf).digest('hex'), rel).toBe(o.sha256);
    }
  });
  it('only CC0 and CC BY 4.0, each with an author, a page, the licence wording and the date it was read; every CC BY author is credited', () => {
    const licence = fs.readFileSync(path.join(GYM, 'LICENCE.txt'), 'utf8');
    for (const [id, a] of Object.entries(lock.assets)) {
      expect(['CC0 1.0', 'CC BY 4.0'], id).toContain(a.licence);
      expect(a.authors.length, id).toBeGreaterThan(0);
      expect(a.page, id).toMatch(/^https:\/\//);
      expect(a.licenceWords.length, id).toBeGreaterThan(10);
      expect(a.licenceRead).toBe('2026-11-22');
      for (const f of a.files) expect(f.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      if (a.licence === 'CC BY 4.0') {
        expect(a.licenceUrl).toContain('creativecommons.org/licenses/by/4.0');
        for (const au of a.authors) expect(licence, au).toContain(au);
        expect(licence).toContain(a.page);
      }
    }
    expect(PROP_CREDITS.dumbbell).toContain('Tytan');
    expect(PROP_CREDITS.kettlebell).toContain('anesbe89');
    expect(lock.rejected.length).toBeGreaterThan(3);
  });
  it('phone files are small and the full files modest; the manifest is what is on disk', () => {
    for (const kind of ['dumbbell', 'kettlebell', 'chess'] as const) {
      const info = propInfo(kind);
      for (const t of ['full', 'low'] as const) {
        const f = path.join(GYM, info.files[t].file);
        expect(fs.statSync(f).size, `${kind} ${t}`).toBe(info.files[t].bytes);
        // the chess set keeps its photographed maps (WebP); the weights are geometry only
        expect(info.files[t].bytes, `${kind} ${t}`).toBeLessThan(kind === 'chess' ? (t === 'low' ? 150_000 : 500_000) : t === 'low' ? 20_000 : 60_000);
      }
      expect(info.tris.low).toBeLessThan(info.tris.full);
    }
  });
  it('the gym materials point at maps that exist', () => {
    for (const k of ['vinyl', 'rubber', 'rubberFloor'] as const) {
      const d = DEFS[k] as { nor?: string; diff?: string };
      for (const p of [d.nor, d.diff].filter(Boolean) as string[]) expect(fs.existsSync(path.join(ROOT, 'public/look', p)), p).toBe(true);
    }
  });
});

describe('the tower gym', () => {
  const prop = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes/test-tower-club-gym/property.json'), 'utf8')) as { furniture: { catalogId: string; box: { cx: number; cz: number; w: number; d: number; yawDeg: number } }[]; layout: { rooms: { polygon: { x: number; z: number }[] }[] } };
  it('has a mirror wall and rubber flooring inside the room (the pieces of the plan are unchanged)', () => {
    const count = (id: string): number => prop.furniture.filter((f) => f.catalogId === id).length;
    expect(count('gym-mirror')).toBe(12);
    expect(count('gym-floor-4x2') + count('gym-floor-2x2')).toBe(12);
    expect(count('gym-treadmill')).toBe(6);
    expect(count('gym-spin-bike')).toBe(4);
    const xs = prop.layout.rooms[0].polygon.map((p) => p.x), zs = prop.layout.rooms[0].polygon.map((p) => p.z);
    for (const f of prop.furniture) {
      const turned = Math.abs(((f.box.yawDeg % 180) + 180) % 180 - 90) < 1;
      const hw = (turned ? f.box.d : f.box.w) / 2, hd = (turned ? f.box.w : f.box.d) / 2;
      expect(f.box.cx - hw, f.catalogId).toBeGreaterThanOrEqual(Math.min(...xs) - 0.001);
      expect(f.box.cx + hw, f.catalogId).toBeLessThanOrEqual(Math.max(...xs) + 0.001);
      expect(f.box.cz - hd, f.catalogId).toBeGreaterThanOrEqual(Math.min(...zs) - 0.001);
      expect(f.box.cz + hd, f.catalogId).toBeLessThanOrEqual(Math.max(...zs) + 0.001);
    }
    // no yoga mat lies on the rubber flooring (a 5 mm mat under 15 mm tiles would vanish)
    const floors = prop.furniture.filter((f) => /gym-floor/.test(f.catalogId));
    for (const m of prop.furniture.filter((f) => f.catalogId === 'yoga-mat')) {
      for (const fl of floors) {
        const ox = Math.abs(m.box.cx - fl.box.cx) < (m.box.w + fl.box.w) / 2, oz = Math.abs(m.box.cz - fl.box.cz) < (m.box.d + fl.box.d) / 2;
        expect(ox && oz).toBe(false);
      }
    }
  });
});
