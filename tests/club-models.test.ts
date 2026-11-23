// SPEC 16.17.3 (22 Nov 2026): the clubhouse's downloaded models and sample decor. Every shipped file is the one the lock records, only CC0 and
// CC BY 4.0 with every author credited, no maker's name in what ships, every whole-piece model fits its catalogue box within the 12 % of 16.15
// (so a piece built with it is its box to the centimetre), and the decor of a shared space is planned the same way every time, clear of doors
// and windows, high enough to walk under, labelled, and invisible to rays.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { catalogItem, itemFromCatalog } from '../src/core/catalog';
import { buildRealFurniture } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { resetStyle, setStyle } from '../src/look/style';
import { setModelsEnabled } from '../src/look/models/library';
import { FIT_TOL, fitModel } from '../src/look/models/fit';
import { PROP_CREDITS, PROP_KINDS, clearProps, primeProp, propInfo, propNote, propUrl, setPropFetcher } from '../src/look/gym/props';
import type { PropKind } from '../src/look/gym/props';
import { CLUB_DECOR_LABEL, mountClubDecor, planClubDecor } from '../src/look/club/decor';
import type { Tier } from '../src/look/types';
import type { PropertyFile } from '../src/types';

const ROOT = path.resolve(__dirname, '..');
const CLUB = path.join(ROOT, 'public/look/club');
afterEach(() => { resetStyle(); setModelsEnabled(true); clearProps(); setPropFetcher(null); });

/** the whole-piece models and the catalogue rows they stand in for */
const WHOLE: { kind: PropKind; rows: string[] }[] = [
  { kind: 'power-rack', rows: ['gym-power-rack'] },
  { kind: 'recumbent', rows: ['gym-recumbent'] },
  { kind: 'table-tennis', rows: ['hall-table-tennis'] },
];
const CLUB_KINDS = PROP_KINDS.filter((k) => propInfo(k).dir === 'club');

function bounds(g: THREE.Object3D): THREE.Box3 {
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3();
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) bb.union(new THREE.Box3().setFromObject(o)); });
  return bb;
}
const build = (id: string, tier: Tier): { g: THREE.Group; item: ReturnType<typeof itemFromCatalog> } => {
  setStyle({ packId: 'light-scandinavian' });
  const row = catalogItem(id);
  const item = itemFromCatalog(id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
  const g = new THREE.Group();
  buildRealFurniture(g, item, tier, createFurnitureKit());
  return { g, item };
};
/** node cannot decode the WebP maps, so a test hands in a textured stand-in of the model's measured size (as the chess test does) */
const standIn = (kind: PropKind, tier: Tier): void => {
  const d = propInfo(kind).dims;
  primeProp(kind, tier, { kind, parts: {}, meshes: [{ geometry: new THREE.BoxGeometry(d.w, d.h, d.d).translate(0, d.h / 2, 0), material: new THREE.MeshStandardMaterial({ map: new THREE.Texture() }) }] });
};

describe('files, lock and credits (public/look/club)', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(CLUB, 'club.lock.json'), 'utf8')) as {
    assets: Record<string, { name: string; licence: string; licenceUrl: string; licenceWords: string; licenceRead: string; authors: string[]; page: string; use: string; files: { url: string; sha256: string; size: number }[] }>;
    outputs: Record<string, { bytes: number; sha256: string }>;
    rejected: { what: string; url: string; why: string }[];
  };
  it('every shipped file is the one the lock records, and every model file the manifest names is shipped', () => {
    for (const [rel, o] of Object.entries(lock.outputs)) {
      const buf = fs.readFileSync(path.join(CLUB, rel));
      expect(buf.length, rel).toBe(o.bytes);
      expect(crypto.createHash('sha256').update(buf).digest('hex'), rel).toBe(o.sha256);
    }
    for (const k of CLUB_KINDS) for (const t of ['full', 'mid', 'low'] as const) {
      const f = propInfo(k).files[t]!;
      expect(lock.outputs[f.file], `${k} ${t}`).toBeTruthy();
      expect(fs.statSync(path.join(CLUB, f.file)).size, `${k} ${t}`).toBe(f.bytes);
    }
  });
  it('the same shape as the gym lock (the credits panel reads both): title, authors, page, licence, licence page', () => {
    for (const [id, a] of Object.entries(lock.assets)) {
      expect(a.name.length, id).toBeGreaterThan(0);
      expect(a.authors.length, id).toBeGreaterThan(0);
      expect(a.page, id).toMatch(/^https:\/\//);
      expect(a.licenceUrl, id).toMatch(/^https?:\/\//);
      expect(a.use.length, id).toBeGreaterThan(10);
    }
  });
  it('only CC0 and CC BY 4.0, with the licence wording, the date it was read and the SHA-256 of every source file; every CC BY author is credited', () => {
    const licence = fs.readFileSync(path.join(CLUB, 'LICENCE.txt'), 'utf8');
    for (const [id, a] of Object.entries(lock.assets)) {
      expect(['CC0 1.0', 'CC BY 4.0'], id).toContain(a.licence);
      expect(a.licenceWords.length, id).toBeGreaterThan(10);
      expect(a.licenceRead).toBe('2026-11-22');
      for (const f of a.files) expect(f.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      if (a.licence === 'CC BY 4.0') {
        expect(a.licenceUrl).toContain('creativecommons.org/licenses/by/4.0');
        expect(a.licenceWords).toMatch(/license "by"/);
        for (const au of a.authors) expect(licence, au).toContain(au);
        expect(licence).toContain(a.page);
      }
      // a model of the archive comes from the public Objaverse mirror, nothing needing an account
      for (const f of a.files) expect(f.url, id).toMatch(/^https:\/\/(huggingface\.co\/datasets\/allenai\/objaverse\/|dl\.polyhaven\.org\/)/);
    }
    for (const k of CLUB_KINDS) {
      expect(PROP_CREDITS[k].length, k).toBeGreaterThan(10);
      const srcs = ([] as string[]).concat(propInfo(k).source);
      for (const s of srcs) {
        expect(lock.assets[s], `${k}: ${s}`).toBeTruthy();
        for (const au of lock.assets[s].authors) expect(PROP_CREDITS[k], k).toContain(au.replace(/ \(.*\)$/, ''));
      }
    }
    expect(lock.rejected.length).toBeGreaterThan(10);
    for (const r of lock.rejected) { expect(r.why.length).toBeGreaterThan(10); expect(r.url).toMatch(/^https:\/\//); }
  });
  it('no maker\'s name in what ships: not in the lock, the licence file, the manifest or the names inside the model files', () => {
    const MAKERS = /technogym|life ?fitness|precor|cybex|matrix fitness|body-?solid|eleiko|rogue|concept ?2|stiga|butterfly|cornilleau|fitness ?360|proform|tunturi|nautilus|bowflex|peloton|schwinn|keiser|hammer strength|nordictrack|kettler|donic|joola/i;
    const texts = [fs.readFileSync(path.join(CLUB, 'club.lock.json'), 'utf8'), fs.readFileSync(path.join(CLUB, 'LICENCE.txt'), 'utf8'), fs.readFileSync(path.join(ROOT, 'src/look/club/manifest.json'), 'utf8')];
    for (const t of texts) expect(t.match(MAKERS)?.[0] ?? null).toBe(null);
    for (const f of fs.readdirSync(path.join(CLUB, 'models'))) {
      const buf = fs.readFileSync(path.join(CLUB, 'models', f));
      const len = buf.readUInt32LE(12);
      const json = buf.subarray(20, 20 + len).toString('utf8');
      expect(json.match(MAKERS)?.[0] ?? null, f).toBe(null);
    }
  });
  it('three tiers each, fewer triangles and fewer bytes down the tiers, and a phone payload that stays small', () => {
    let phone = 0;
    for (const k of CLUB_KINDS) {
      const i = propInfo(k);
      expect(i.tris.low, k).toBeLessThanOrEqual(i.tris.mid!);
      expect(i.tris.mid!, k).toBeLessThanOrEqual(i.tris.full);
      expect(i.files.low.bytes, k).toBeLessThan(i.files.full.bytes);
      expect(i.files.low.bytes, k).toBeLessThan(100_000);
      expect(i.files.full.bytes, k).toBeLessThan(700_000);
      expect(i.tris.full, k).toBeLessThan(16_000);
      phone += i.files.low.bytes;
      expect(propUrl(k, 'low')).toBe(`/look/club/${i.files.low.file}`);
      expect(propUrl(k, 'medium')).toBe(`/look/club/${i.files.mid!.file}`);
      expect(propUrl(k, 'high')).toBe(`/look/club/${i.files.full.file}`);
    }
    // every clubhouse model on a phone, all at once, is well under a megabyte
    expect(phone).toBeLessThan(700_000);
  });
});

describe('whole pieces from models fit their catalogue box (SPEC 16.15: the box wins, never stretched past 12 %)', () => {
  it('each model fits each row it stands in for within FIT_TOL on every axis', () => {
    for (const { kind, rows } of WHOLE) for (const id of rows) {
      const row = catalogItem(id);
      const d = propInfo(kind).dims;
      const fit = fitModel({ w: d.w, h: d.h, d: d.d }, { w: row.footprint.w, h: row.heightM, d: row.footprint.d });
      expect(fit.ok, `${kind} in ${id}: worst ${fit.worst.toFixed(3)}`).toBe(true);
      expect(fit.worst).toBeLessThanOrEqual(FIT_TOL);
    }
  });
  it('without the model the generator draws the piece and asks for it; with it the piece is the model, exactly its box, and the card credits it', () => {
    for (const { kind, rows } of WHOLE) for (const id of rows) for (const tier of ['low', 'medium', 'high'] as Tier[]) {
      clearProps();
      setPropFetcher(async () => { throw new Error('offline'); });
      const a = build(id, tier);
      let model = 0;
      a.g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === `model-${kind}`) model++; });
      expect(model, `${id} ${tier} before`).toBe(0);
      standIn(kind, tier);
      const { g, item } = build(id, tier);
      const bb = bounds(g);
      expect(bb.max.x - bb.min.x, `${id} ${tier} w`).toBeCloseTo(item.box.w, 2);
      expect(bb.max.z - bb.min.z, `${id} ${tier} d`).toBeCloseTo(item.box.d, 2);
      expect(bb.max.y, `${id} ${tier} h`).toBeLessThanOrEqual(item.heightM + 0.012);
      expect(bb.min.y).toBeGreaterThan(-0.005);
      let n = 0;
      g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name === `model-${kind}`) { n++; expect((m.material as THREE.MeshStandardMaterial).map).toBeTruthy(); expect(m.userData.walkthruPart).toBe(`model-${kind}`); } });
      expect(n, `${id} ${tier}`).toBeGreaterThan(0);
      expect(propNote(item.id)).toContain(PROP_CREDITS[kind]);
    }
  });
  it('the carrom board sits on the generated stand inside the table\'s box, and ?models=off keeps the drawn board', () => {
    for (const id of ['hall-carrom', 'games-carrom-set']) for (const tier of ['low', 'high'] as Tier[]) {
      clearProps();
      standIn('carrom-board', tier);
      const { g, item } = build(id, tier);
      const bb = bounds(g);
      expect(bb.max.y).toBeLessThanOrEqual(item.heightM + 0.012);
      expect(bb.max.x - bb.min.x).toBeLessThan(item.box.w + 0.012);
      expect(bb.max.z - bb.min.z).toBeLessThan(item.box.d + 0.012);
      let board = 0, drawn = 0;
      g.traverse((o) => { if (!(o as THREE.Mesh).isMesh) return; if (o.name === 'carrom-board-model') board++; if (o.name === 'carrom-frame') drawn++; });
      expect(board).toBe(1); expect(drawn).toBe(0);
      expect(propNote(item.id)).toContain('Karambol');
      setModelsEnabled(false);
      const off = build(id, tier);
      let off2 = 0;
      off.g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === 'carrom-frame') off2++; });
      expect(off2).toBe(1);
      setModelsEnabled(true);
    }
  });
});

describe('sample decor of the shared spaces', () => {
  const scenes = ['test-tower-club-gym', 'test-tower-club-games', 'test-tower-club-lounge', 'test-tower-club-hall-1', 'test-tower-club-hall-2', 'test-tower-club-foyer', 'test-tower-lobby', 'test-tower-club-changing-2', 'test-gym-sample', 'test-hall-sample', 'test-lobby-sample'];
  const load = (id: string): PropertyFile => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', id, 'property.json'), 'utf8')) as PropertyFile;
  it('is the same every time, and a home or an open-air space gets none', () => {
    for (const id of scenes) {
      const p = load(id);
      const a = planClubDecor(p.layout, p.furniture, p.spaceKind!);
      expect(a.length, id).toBeGreaterThan(0);
      expect(planClubDecor(p.layout, p.furniture, p.spaceKind!)).toEqual(a);
      expect(planClubDecor(p.layout, p.furniture, 'home')).toEqual([]);
      expect(planClubDecor(p.layout, p.furniture, 'garden')).toEqual([]);
      expect(planClubDecor(p.layout, p.furniture, 'pool')).toEqual([]);
    }
  });
  it('hangs high enough to walk under, and puts no picture on a gym\'s or a lobby\'s wall', () => {
    for (const id of scenes) {
      const p = load(id);
      for (const d of planClubDecor(p.layout, p.furniture, p.spaceKind!)) {
        if (d.kind === 'pendant' || d.kind === 'chandelier' || d.kind === 'batten') {
          expect(d.y, `${id} ${d.kind}`).toBe(p.layout.wallHeightM);
          const drop = d.kind === 'pendant' ? propInfo('pendant').dims.h : d.kind === 'chandelier' ? propInfo('chandelier').dims.h : 0.06;
          expect(d.y - drop, `${id} ${d.kind} clear height`).toBeGreaterThanOrEqual(2.2);
        }
        if (p.spaceKind === 'gym') expect(d.kind, id).toBe('batten');
        if (p.spaceKind === 'lobby') expect(d.kind, id).toBe('pendant');
      }
    }
  });
  it('keeps pictures and the dartboard off doors and windows, and the dartboard has its throwing lane clear', () => {
    for (const id of scenes) {
      const p = load(id);
      for (const d of planClubDecor(p.layout, p.furniture, p.spaceKind!)) {
        if (d.kind !== 'art' && d.kind !== 'dartboard') continue;
        expect(d.y - d.h / 2, `${id} ${d.kind} bottom`).toBeGreaterThan(1.0);
        for (const room of p.layout.rooms) for (const o of p.layout.openings.filter((x) => x.roomId === room.id)) {
          const a = room.polygon[o.edge], b = room.polygon[(o.edge + 1) % room.polygon.length];
          const L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
          const along = (d.x - a.x) * ux + (d.z - a.z) * uz, off = Math.abs(-(d.x - a.x) * uz + (d.z - a.z) * ux);
          if (off > 0.05) continue; // not on this wall
          const gap = Math.abs(along - o.centreM) - o.widthM / 2 - d.w / 2;
          expect(gap, `${id} ${d.kind} vs ${o.type} ${o.id}`).toBeGreaterThan(0.2);
        }
      }
    }
    const games = load('test-tower-club-games');
    expect(planClubDecor(games.layout, games.furniture, 'games').filter((d) => d.kind === 'dartboard')).toHaveLength(1);
  });
  it('builds under its parent, labelled, never hit by a ray, and leaves nothing behind', () => {
    const p = load('test-tower-club-games');
    const parent = new THREE.Group();
    setModelsEnabled(false);
    const h = mountClubDecor({ parent, layout: p.layout, furniture: p.furniture, kind: 'games', tier: 'medium' });
    expect(h.label).toBe(CLUB_DECOR_LABEL);
    expect(CLUB_DECOR_LABEL).toMatch(/sample decor, not from the plan/);
    expect(parent.children).toContain(h.group);
    const ray = new THREE.Raycaster(new THREE.Vector3(h.pieces[0].x, 0.1, h.pieces[0].z), new THREE.Vector3(0, 1, 0));
    parent.updateMatrixWorld(true);
    expect(ray.intersectObject(parent, true)).toHaveLength(0);
    let meshes = 0;
    h.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBeGreaterThan(h.pieces.length);
    h.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
