// SPEC 19.13 (22 Nov 2026): the downloaded models of the open-air spaces and what lies under and beyond a space that is up on a building.
// What can be checked without a GPU: every model file is the one the lock names, comes from a raw file with a licence (CC0 or CC-BY 4.0 only),
// an author, a page and a SHA-256, and every CC-BY one is credited; every candidate looked at has a verdict and a reason; each tier is lighter
// than the one above and a phone's files stay small; every piece drawn by a model is still exactly its catalogue box (the parasol's canopy is
// its canopy across); the storeys' face and the bridge are where the plan's edges say; the plain ground is decor that no ray hits.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_FACTS, OUTDOOR_MODELS } from '../src/outdoor/real';
import { SPECIES } from '../src/outdoor/species';
import { parseOutdoor } from '../src/outdoor/types';
import type { OutdoorFile } from '../src/outdoor/types';
import { basinBottomM, buildSurround, surroundSegments } from '../src/outdoor/surround';
import { mountSkyDome, siteGroundColour } from '../src/outdoor/sky-dome';
import { gradeAt } from '../src/look/grade';
import { PIECE_CREDITS, clearPieces, loadPiece, pieceModelIds, pieceNote, primePiece, setPieceFetcher } from '../src/look/gen/outdoor-models';
import type { PieceGeo, PieceModelId } from '../src/look/gen/outdoor-models';
import { buildPool, POOL_DEFAULTS, POOL_MODELS } from '../src/look/gen/pool';
import { GEN_QUALITY } from '../src/look/gen/core';
import { createFurnitureKit, furnitureKit } from '../src/look/furniture-materials';
import { buildRealFurniture } from '../src/look/furniture-real';
import { setStyle, resetStyle } from '../src/look/style';
import { setModelsEnabled } from '../src/look/models/library';
import { itemFromCatalog } from '../src/core/catalog';
import type { Layout } from '../src/types';
import type { Tier } from '../src/look/types';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public/look/outdoor');
const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const TIERS: Tier[] = ['low', 'medium', 'high'];
const picks = readJson<Record<string, { src?: string }>>(path.join(ROOT, 'tools/outdoor-model-picks.json'));

afterEach(() => { resetStyle(); setModelsEnabled(true); clearPieces(); setPieceFetcher(null); });

describe('the model files, their sources and their credits', () => {
  const files = readJson<{ files: Record<string, { bytes: number; sha256: string }> }>(path.join(OUT, 'files.lock.json')).files;
  const sources = readJson<{ files: Record<string, { source: string; page: string; title?: string; author: string; licence: string; licencePage: string; licenceSource?: string; sha256: string; bytes: number }>; candidates: { piece: string; title: string; author: string; url: string; licence: string; verdict: string; why: string }[] }>(path.join(OUT, 'sources.lock.json'));
  const licence = fs.readFileSync(path.join(OUT, 'LICENCE.txt'), 'utf8');

  it('every tier of every model is shipped and is the file the lock names', () => {
    expect(Object.keys(MODEL_FACTS).sort()).toEqual(Object.keys(picks).filter((k) => !k.startsWith('_')).sort());
    for (const [id, f] of Object.entries(MODEL_FACTS)) for (const t of TIERS) {
      const rel = f.tiers[t].file;
      expect(files[rel], `${id} ${t}`).toBeTruthy();
      const b = fs.readFileSync(path.join(OUT, rel));
      expect(b.length, rel).toBe(files[rel].bytes);
      expect(createHash('sha256').update(b).digest('hex'), rel).toBe(files[rel].sha256);
    }
  });

  it('every model comes from a locked raw file: CC0 or CC-BY 4.0 only, with its page, author, licence page and SHA-256; every CC-BY one is credited', () => {
    for (const [id, p] of Object.entries(picks)) {
      if (id.startsWith('_')) continue;
      const s = sources.files[p.src!];
      expect(s, `${id}: ${p.src} is not in sources.lock.json`).toBeTruthy();
      expect(['CC0 1.0', 'CC-BY 4.0'], id).toContain(s.licence);
      expect(s.page, id).toMatch(/^https:\/\//);
      expect(s.licencePage, id).toMatch(/^https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/|polyhaven|ambientcg/);
      expect(s.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      expect(s.source, id).toMatch(/^https:\/\/huggingface\.co\/datasets\/allenai\/objaverse\/resolve\/main\/glbs\//);
      if (s.licence === 'CC-BY 4.0') {
        expect(s.licenceSource, id).toMatch(/"license": "by"/);
        expect(licence, id).toContain(s.page);
        expect(licence, id).toContain(`"${s.title}"`);
      }
    }
  });

  it('every candidate looked at is recorded with a licence, a verdict and a reason; none used is NC, ND, SA or unknown', () => {
    expect(sources.candidates.length).toBeGreaterThan(30);
    for (const c of sources.candidates) {
      expect(c.url, c.title).toMatch(/^https:\/\//);
      expect(['used', 'rejected'], c.title).toContain(c.verdict);
      expect(c.why.length, c.title).toBeGreaterThan(10);
      expect(['CC0 1.0', 'CC-BY 4.0'], c.title).toContain(c.licence);
    }
    const used = sources.candidates.filter((c) => c.verdict === 'used');
    for (const [id, p] of Object.entries(picks)) {
      if (id.startsWith('_')) continue;
      const uid = path.basename(p.src!, '.glb');
      expect(used.some((c) => c.url.includes(uid)), `${id} is not a used candidate`).toBe(true);
    }
    // a seller's or a brand's name never reaches a shipped model or a credit
    for (const c of sources.candidates.filter((x) => /brand|maker|retailer/.test(x.why))) expect(c.verdict).toBe('rejected');
  });

  it('the credit of every model piece names its source as LICENCE.txt does', () => {
    for (const id of pieceModelIds()) {
      const credit = PIECE_CREDITS[id];
      const title = credit.match(/"([^"]+)"/)![1];
      expect(licence, id).toContain(`"${title}"`);
      expect(credit, id).toMatch(/CC BY 4\.0|CC0/);
    }
  });
});

describe('budgets per tier', () => {
  const files = readJson<{ files: Record<string, { bytes: number }> }>(path.join(OUT, 'files.lock.json')).files;
  it('each tier is lighter than the one above; a tree is at most 16k triangles on high, 7k on medium, 3k on a phone; a piece 6k, 3k, 2k', () => {
    for (const [id, f] of Object.entries(MODEL_FACTS)) {
      expect(f.tiers.low.tris, id).toBeLessThanOrEqual(f.tiers.medium.tris);
      expect(f.tiers.medium.tris, id).toBeLessThanOrEqual(f.tiers.high.tris);
      expect(f.tiers.low.bytes, id).toBeLessThanOrEqual(f.tiers.high.bytes);
      const [hi, med, lo] = f.kind === 'plant' ? [16_000, 7_000, 3_000] : [6_000, 3_000, 2_000];
      expect(f.tiers.high.tris, id).toBeLessThanOrEqual(hi);
      expect(f.tiers.medium.tris, id).toBeLessThanOrEqual(med);
      expect(f.tiers.low.tris, id).toBeLessThanOrEqual(lo);
    }
  });
  it('a phone fetches under 0.6 MB of models for the pool wing (neem, coconut palm, lounger, chair), each file under 200 KB', () => {
    const low = [OUTDOOR_MODELS.neem.file('low'), OUTDOOR_MODELS['coconut-palm'].file('low'), `outdoor/${MODEL_FACTS.lounger.tiers.low.file}`, `outdoor/${MODEL_FACTS['pool-chair'].tiers.low.file}`];
    const bytes = low.map((f) => files[f.replace(/^outdoor\//, '')].bytes);
    for (const b of bytes) expect(b).toBeLessThan(200_000);
    expect(bytes.reduce((a, b) => a + b, 0)).toBeLessThan(600_000);
    for (const id of Object.keys(MODEL_FACTS)) expect(files[MODEL_FACTS[id].tiers.low.file].bytes, id).toBeLessThan(200_000);
  });
  it('the species drawn by a model have a model of the right height range', () => {
    for (const sp of Object.values(SPECIES)) {
      if (!sp.model) continue;
      const m = OUTDOOR_MODELS[sp.model];
      expect(m.heightM, sp.id).toBeGreaterThan(1);
      for (const t of TIERS) expect(m.file(t), sp.id).toMatch(/^outdoor\/models\/.+\.glb$/);
    }
    expect(SPECIES.neem.model).toBe('neem');
    expect(SPECIES['areca-palm'].model).toBe('areca-palm');
    expect(SPECIES['royal-palm'].model).toBe('royal-palm');
  });
});

function bounds(g: THREE.Object3D, skip: RegExp | null = null): THREE.Box3 {
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3();
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(skip && skip.test(m.name))) bb.union(new THREE.Box3().setFromObject(m)); });
  return bb;
}
/** stand-in geometry of a model's measured size, one box a part (a parasol: its base, a pole and a canopy as wide as the model's) */
function standIn(id: PieceModelId): PieceGeo {
  const f = MODEL_FACTS[id];
  const [x0, y0, z0] = f.min, [x1, y1, z1] = f.max;
  const box = (a: number[], b: number[]): THREE.BufferGeometry => new THREE.BoxGeometry(b[0] - a[0], b[1] - a[1], b[2] - a[2]).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  const mat = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  if (id === 'parasol') return { id, meshes: [
    { part: 'base', geometry: box([-0.25, 0, -0.25], [0.25, 0.1, 0.25]), material: mat() },
    { part: 'pole', geometry: box([-0.02, 0, -0.02], [0.02, y1, 0.02]), material: mat() },
    { part: 'canopy', geometry: box([x0, y1 - 0.5, z0], [x1, y1 - 0.05, z1]), material: mat() },
  ] };
  return { id, meshes: f.parts.map((part, i) => ({ part, geometry: box([x0, y0, z0 + (i * (z1 - z0)) / f.parts.length], [x1, y1, z0 + ((i + 1) * (z1 - z0)) / f.parts.length]), material: mat() })) };
}

describe('pieces drawn by a model are exactly their catalogue box', () => {
  const CASES: [string, PieceModelId][] = [['pool-lounger', 'lounger'], ['pool-chair', 'pool-chair'], ['pool-table', 'patio-table'], ['pool-umbrella', 'parasol'], ['garden-bench', 'bench']];
  it('the generator draws the piece and asks for its model; with the model the piece is the model, fitted to the same box, and its card credits it', () => {
    setStyle({ packId: 'light-scandinavian' });
    for (const tier of ['low', 'high'] as Tier[]) {
      for (const [id, mid] of CASES) {
        clearPieces();
        const row = itemFromCatalog(id, { cx: 0, cz: 0, w: 1, d: 1, yawDeg: 0 }, 'virtual');
        const item = itemFromCatalog(id, { cx: 0, cz: 0, w: row.box.w, d: row.box.d, yawDeg: 0 }, 'virtual');
        // before the model is here the generator's piece stands (and its card has no credit)
        const g0 = new THREE.Group();
        buildRealFurniture(g0, item, tier, createFurnitureKit());
        expect(pieceNote(item.id), id).toBe('');
        primePiece(mid, tier, standIn(mid));
        const g = new THREE.Group();
        buildRealFurniture(g, item, tier, createFurnitureKit());
        expect(pieceNote(item.id), id).toContain(PIECE_CREDITS[mid]);
        const skip = id === 'pool-umbrella' ? /^umbrella-/ : null;
        const bb = bounds(g, skip);
        expect(bb.max.x - bb.min.x, `${id} ${tier} width`).toBeCloseTo(item.box.w, 2);
        expect(bb.max.z - bb.min.z, `${id} ${tier} depth`).toBeCloseTo(item.box.d, 2);
        expect(bb.max.y - bb.min.y, `${id} ${tier} height`).toBeCloseTo(item.heightM, 2);
        expect(bb.min.y, id).toBeCloseTo(0, 3);
        if (id === 'pool-umbrella') {
          const c = bounds(g.children.find((m) => m.name === 'umbrella-canopy')!);
          expect(Math.max(c.max.x - c.min.x, c.max.z - c.min.z)).toBeCloseTo(2.5, 2);
        }
      }
    }
    expect(Object.values(POOL_MODELS).every((m) => pieceModelIds().includes(m!))).toBe(true);
  });
  it('the shipped files hold the parts the pieces use', () => {
    expect(MODEL_FACTS.parasol.parts).toEqual(['base', 'canopy', 'pole']);
    expect(MODEL_FACTS.lounger.parts).toEqual(['cushion', 'frame']);
    expect(MODEL_FACTS.bench.parts).toEqual(['frame', 'wood']);
  });
  it('with models off, or with no file, the generator draws the piece as before', async () => {
    setModelsEnabled(false);
    const r = itemFromCatalog('pool-lounger', { cx: 0, cz: 0, w: 0.7, d: 2, yawDeg: 0 }, 'virtual');
    const g = buildPool({ kit: furnitureKit, q: GEN_QUALITY.high }, { w: r.box.w, d: r.box.d, h: r.heightM, s: 0.38 } as never, { ...POOL_DEFAULTS, variant: 'lounger' }, {} as never);
    expect(g.userData.outdoorModelUsed).toBeUndefined();
    expect(await loadPiece('lounger', 'high')).toBeNull();
    setModelsEnabled(true);
    setPieceFetcher(async () => { throw new Error('offline'); });
    expect(await loadPiece('lounger', 'high')).toBeNull();
    expect(pieceNote('nothing')).toBe('');
  });
});

// ------------------------------------------------------------------ what lies under and beyond (the pool view's grey slab)

const scene = (id: string): { file: OutdoorFile; layout: Layout } => ({
  file: parseOutdoor(readJson(path.join(ROOT, `public/scenes/${id}/outdoor.json`))),
  layout: readJson<{ layout: Layout }>(path.join(ROOT, `public/scenes/${id}/property.json`)).layout,
});

describe('the storeys under a space and the plain ground', () => {
  it('the sample open-air spaces say how high they are (the Ground level under the clubhouse level) and the bridge is marked as one', () => {
    for (const id of ['test-tower-club-pool', 'test-tower-club-aqua', 'test-tower-club-deck', 'test-tower-empty-club-pool']) expect(scene(id).file.aboveGroundM, id).toBe(4.2);
    const pool = scene('test-tower-club-pool').file;
    expect(pool.areas.filter((a) => a.bridge).map((a) => a.id)).toEqual(['bridge']);
    expect(() => parseOutdoor({ version: 1, seed: 1, aboveGroundM: -1 })).toThrow(/aboveGroundM/);
  });
  it('every open edge drops the storeys to the ground; the bridge has only a slab edge on its sides and the wing face continues under its end', () => {
    const { file, layout } = scene('test-tower-club-pool');
    const segs = surroundSegments(layout, file);
    const bridgeSides = segs.filter((s) => s.kind === 'bridge-edge');
    expect(bridgeSides.length).toBe(2);
    for (const s of bridgeSides) expect(Math.abs(s.a.z - s.b.z)).toBeLessThan(0.01); // the two long sides, along x
    // the room's ten edges, plus the bridge's end where it meets the wing (x = 17.13, not an edge of the room)
    expect(segs.length).toBe(layout.rooms[0].polygon.length + 1);
    const end = segs[segs.length - 1];
    expect(end.kind).toBe('storeys');
    expect(Math.abs(end.a.x - end.b.x)).toBeLessThan(0.01);
    expect(basinBottomM(file)).toBeLessThan(4.2);
  });
  it('the build: the storeys, the slab edge and the plinth, down to the ground, that no ray hits', () => {
    const { file, layout } = scene('test-tower-club-pool');
    const s = buildSurround(layout, file, 'medium')!;
    expect(s.group.children.map((c) => c.name).sort()).toEqual(['surround:plinth', 'surround:slab-edge', 'surround:storeys']);
    const hits: THREE.Intersection[] = [];
    const ray = new THREE.Raycaster(new THREE.Vector3(5, 2, 5), new THREE.Vector3(0, -1, 0));
    s.group.updateMatrixWorld(true);
    for (const c of s.group.children) c.raycast(ray, hits);
    expect(hits.length).toBe(0);
    const storeys = s.group.children.find((c) => c.name === 'surround:storeys') as THREE.Mesh;
    const bb = new THREE.Box3().setFromObject(storeys);
    expect(bb.min.y).toBeCloseTo(-4.22, 1);
    expect(bb.max.y).toBeLessThanOrEqual(0);
    s.dispose();
    expect(s.group.parent).toBeNull();
    // no height in the file: nothing is drawn (a space built before SPEC 19.13 keeps its look); a space at ground level has no storeys
    expect(buildSurround(layout, { ...file, aboveGroundM: undefined }, 'medium')).toBeNull();
    const flat = buildSurround(layout, { ...file, aboveGroundM: 0 }, 'low')!;
    expect(flat.group.children.length).toBe(0);
    flat.dispose();
  });
  it('the plain ground is drawn by the sky dome under the horizon, on the whole sphere, only when the space says how high it is; its colour follows the hour', () => {
    const on = mountSkyDome(null, 'medium', { groundBelowM: 4.2 });
    const off = mountSkyDome(null, 'medium');
    const u = (d: typeof on): Record<string, { value: unknown }> => (d.mesh.material as THREE.ShaderMaterial).uniforms as Record<string, { value: unknown }>;
    expect(u(on).uGroundOn.value).toBe(1);
    expect(u(on).uGroundY.value).toBeCloseTo(-4.2, 5);
    expect(u(off).uGroundOn.value).toBe(0);
    expect((on.mesh.material as THREE.ShaderMaterial).fragmentShader).toContain('owSiteGround');
    const params = (on.mesh.geometry as THREE.SphereGeometry).parameters;
    expect(params.thetaLength).toBeCloseTo(Math.PI, 5);
    expect((off.mesh.geometry as THREE.SphereGeometry).parameters.thetaLength).toBeLessThan(Math.PI * 0.6);
    const lum = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const day = siteGroundColour(gradeAt(15), [0, 0.8, 0.6]);
    const night = siteGroundColour(gradeAt(22), [0, -0.5, 0.8]);
    expect(lum(night)).toBeLessThan(lum(day) * 0.5);
    expect(on.mesh.raycast).toBeTypeOf('function');
    on.dispose(); off.dispose();
  });
});
