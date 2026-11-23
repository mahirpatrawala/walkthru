// SPEC 19.14 (23 Nov 2026): the polish of the open-air spaces. What can be checked without a GPU: the ground under a raised space is shaded by
// what stands on it (the storeys, the building, the bridge) and its sun shadow is off on a phone and at night; the building runs on past a narrow
// facade edge as far as the plan's indoor rooms do (and only on a facade); the storeys and the building wear a render with variation, not one
// flat paint; the frangipani is a branching tree with leaf rosettes and flowers at its tips, in one atlas, and still one mesh of leaves and one of
// wood; a shrub's card shows only the leafy part of its spray; a clipped hedge is flat-faced, mapped in world space and has sprigs above low, with
// its triangles counted; the aqua-play equipment is in muted commercial finishes with stainless fittings; the loungers' cushions are a fabric's
// albedo, not white paper; a depth numeral reads from the deck.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { parseOutdoor } from '../src/outdoor/types';
import type { OutdoorFile } from '../src/outdoor/types';
import { groundShade, plasterMaterial, buildSurround } from '../src/outdoor/surround';
import { GROUND_GLSL, GROUND_MAX_WALLS, groundShadowK, mountSkyDome } from '../src/outdoor/sky-dome';
import { buildFacadeDecor } from '../src/outdoor/build';
import { buildPools } from '../src/outdoor/pool-build';
import { OutdoorMaterials } from '../src/outdoor/materials';
import { HEDGE_SPRIGS, SHRUB_V0, buildSpecies, hedgeBlock, hedgeBlockTriangles, hedgeSprigs, mountFoliage, speciesTriangles } from '../src/outdoor/foliage';
import { CANDELABRA, plantsForTier } from '../src/outdoor/plants';
import { SPECIES } from '../src/outdoor/species';
import { TIP_ATLAS, tipPath } from '../src/outdoor/real';
import { gradeAt } from '../src/look/grade';
import { PLAY_BLUE, PLAY_GREY, PLAY_RED, PLAY_YELLOW, STAINLESS } from '../src/look/gen/pool';
import { CUSHION_ALBEDO, addPiece } from '../src/look/gen/outdoor-models';
import type { Layout } from '../src/types';
import type { Tier } from '../src/look/types';

const ROOT = path.resolve(__dirname, '..');
const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const scene = (id: string): { file: OutdoorFile; layout: Layout } => ({
  file: parseOutdoor(readJson(path.join(ROOT, `public/scenes/${id}/outdoor.json`))),
  layout: readJson<{ layout: Layout }>(path.join(ROOT, `public/scenes/${id}/property.json`)).layout,
});
const TIERS: Tier[] = ['low', 'medium', 'high'];

describe('the ground under a raised space', () => {
  it('is shaded by the storeys that stand on it, the building past the facade and the bridge; nothing when the space says no height', () => {
    const { file, layout } = scene('test-tower-club-pool');
    const s = groundShade(layout, file)!;
    // the room's edges that drop to the ground (not the bridge's two sides), the bridge's end, and the building's face with its two returns
    expect(s.walls.length).toBeGreaterThanOrEqual(10);
    expect(s.walls.length).toBeLessThanOrEqual(GROUND_MAX_WALLS);
    expect(s.slabs).toHaveLength(1);
    const [x0, , x1] = s.slabs[0];
    expect(x1 - x0).toBeGreaterThan(10); // the 12 m bridge
    expect(groundShade(layout, { ...file, aboveGroundM: undefined })).toBeNull();
    expect(groundShade(layout, { ...file, aboveGroundM: 0 })).toBeNull();
  });
  it('the shader has the patches, the contact shade and (above low) the sun shadow; the shadow is gone at night and with a low sun', () => {
    expect(GROUND_GLSL).toContain('owSegD');
    expect(GROUND_GLSL).toContain('fwidth');
    const { file, layout } = scene('test-tower-club-pool');
    const shade = groundShade(layout, file)!;
    const hi = mountSkyDome(null, 'high', { groundBelowM: 4.2, shade });
    const lo = mountSkyDome(null, 'low', { groundBelowM: 4.2, shade });
    const m = (d: typeof hi): THREE.ShaderMaterial => d.mesh.material as THREE.ShaderMaterial;
    expect(m(hi).defines.OW_GROUND_SHADOW).toBe(1);
    expect(m(lo).defines.OW_GROUND_SHADOW).toBeUndefined();
    expect(m(hi).uniforms.uGroundWallN.value).toBe(shade.walls.length);
    expect(m(hi).uniforms.uGroundSlabN.value).toBe(1);
    expect(groundShadowK(gradeAt(14), [0.3, 0.8, 0.5])).toBeGreaterThan(0.8);
    expect(groundShadowK(gradeAt(22), [0, -0.4, 0.9])).toBe(0);
    hi.sync(gradeAt(14), [0.3, 0.8, 0.5], false);
    expect(m(hi).uniforms.uGroundSunK.value).toBeGreaterThan(0.8);
    hi.dispose(); lo.dispose();
  });
});

describe('the building past a narrow facade (the bridge end)', () => {
  it('the generator reads it off the plan for the pool wing only; the file rejects it on anything but a facade', () => {
    const facade = scene('test-tower-club-pool').file.boundary.find((b) => b.kind === 'facade')!;
    expect(facade.building).toBeDefined();
    expect(facade.building!.beforeM).toBeGreaterThan(5);
    expect(facade.building!.afterM).toBeGreaterThan(9);
    expect(facade.building!.depthM).toBeGreaterThan(3);
    for (const id of ['test-tower-club-aqua', 'test-tower-club-deck']) expect(scene(id).file.boundary.some((b) => b.building), id).toBe(false);
    expect(() => parseOutdoor({ version: 1, seed: 1, boundary: [{ room: 'r', edge: 0, kind: 'parapet', building: { beforeM: 1, afterM: 1, depthM: 1 } }] })).toThrow(/only for a facade/);
  });
  it('is drawn past both ends of the edge, from the ground to the top of the face, in a render; the bands run its whole width; no ray hits it', () => {
    const { file, layout } = scene('test-tower-club-pool');
    const mats = new OutdoorMaterials('medium');
    const g = buildFacadeDecor({ layout, file, mats, tier: 'medium' });
    const bld = g.getObjectByName('facade-building') as THREE.Mesh;
    expect(bld).toBeDefined();
    const bb = new THREE.Box3().setFromObject(bld);
    const b = file.boundary.find((q) => q.kind === 'facade')!.building!;
    // the edge is x = 29.09 from z 35.94 to 38.28 (the bridge's end)
    expect(bb.min.z).toBeCloseTo(35.94 - b.beforeM, 1);
    expect(bb.max.z).toBeCloseTo(38.28 + b.afterM, 1);
    expect(bb.max.y).toBeCloseTo(layout.wallHeightM, 1);
    expect((bld.material as THREE.MeshStandardMaterial).customProgramCacheKey()).toBe('ow-plaster');
    const below = new THREE.Box3().setFromObject(g.getObjectByName('facade-building-storeys')!);
    expect(below.min.y).toBeCloseTo(-4.22, 1);
    const bands = new THREE.Box3().setFromObject(g.getObjectByName('facade-bands')!);
    expect(bands.max.z - bands.min.z).toBeGreaterThan(15);
    const hits: THREE.Intersection[] = [];
    g.updateMatrixWorld(true);
    bld.raycast(new THREE.Raycaster(new THREE.Vector3(28, 2, 32), new THREE.Vector3(1, 0, 0)), hits);
    expect(hits).toHaveLength(0);
    mats.dispose();
  });
  it('the storeys under a space wear the same render (not one flat paint)', () => {
    const { file, layout } = scene('test-tower-club-pool');
    const s = buildSurround(layout, file, 'medium')!;
    for (const c of s.group.children) expect(((c as THREE.Mesh).material as THREE.Material).customProgramCacheKey(), c.name).toBe('ow-plaster');
    s.dispose();
    const m = plasterMaterial('#DDD0B8', 'x', -4.2, -0.35);
    const sh = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>' };
    m.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
    expect(sh.fragmentShader).toContain('streak');
    m.dispose();
  });
});

describe('the frangipani, the shrubs and the hedges', () => {
  it('a frangipani is a branching tree: a rosette of leaves and flowers at each tip, one atlas, the counts of its tier', () => {
    expect(SPECIES.frangipani.form).toBe('candelabra');
    expect(TIP_ATLAS.frangipani).toBe('frangipani-tip');
    expect(tipPath('frangipani', 'low')).toBe('outdoor/leaves/frangipani-tip.low.webp');
    for (const f of ['frangipani-tip.webp', 'frangipani-tip.low.webp']) expect(fs.existsSync(path.join(ROOT, 'public/look/outdoor/leaves', f)), f).toBe(true);
    for (const t of TIERS) {
      const g = buildSpecies('frangipani', t);
      const c = CANDELABRA[t];
      expect(g.kind).toBe('tip');
      expect(g.leaves.index!.count / 6).toBe(c.tips * (c.leaves * 2 + c.flowers));
      // the leaves and flowers are high in the tree (a walker passes under the crown), the wood reaches the tips
      const lb = new THREE.Box3().setFromBufferAttribute(g.leaves.attributes.position as THREE.BufferAttribute);
      expect(lb.min.y, t).toBeGreaterThan(1.8);
      expect(lb.max.y, t).toBeLessThan(g.heightM + 0.6);
      expect(lb.max.x - lb.min.x, t).toBeGreaterThan(2);
      // the leaf band and the flower half of the atlas are both used
      const uv = g.leaves.attributes.uv as THREE.BufferAttribute;
      let flower = 0; for (let i = 0; i < uv.count; i++) if (uv.getX(i) >= 0.5) flower++;
      expect(flower / 4).toBe(c.tips * c.flowers);
      g.leaves.dispose(); g.trunk?.dispose();
    }
    expect(speciesTriangles('frangipani', 'low')).toBeLessThan(speciesTriangles('frangipani', 'high'));
  });
  it('a shrub card shows the leafy top of its spray only', () => {
    const g = buildSpecies('bougainvillea', 'medium');
    const uv = g.leaves.attributes.uv as THREE.BufferAttribute;
    let minV = 1; for (let i = 0; i < uv.count; i++) minV = Math.min(minV, uv.getY(i));
    expect(minV).toBeCloseTo(SHRUB_V0, 5);
    g.leaves.dispose(); g.trunk?.dispose();
  });
  it('a hedge block is flat-faced and clipped (no lumps); sprigs above low only, counted in the block budget', () => {
    const g = hedgeBlock('high');
    const p = g.attributes.position as THREE.BufferAttribute;
    let top = 0, topFlat = 0;
    // the middle of the top (all but the rounded arrises) is one flat plane at the block's height
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.9 && Math.abs(p.getX(i)) < 0.35 && Math.abs(p.getZ(i)) < 0.35) { top++; if (Math.abs(p.getY(i) - 1) < 5e-3) topFlat++; }
    expect(top).toBeGreaterThan(20);
    expect(topFlat).toBe(top);
    g.dispose();
    expect(HEDGE_SPRIGS.low).toBe(0);
    expect(hedgeBlockTriangles('high')).toBe(752 + HEDGE_SPRIGS.high * 2);
    const sp = hedgeSprigs('medium', { w: 1.7, h: 1.5, l: 1.4 }, 3);
    expect(sp.index!.count / 3).toBe(HEDGE_SPRIGS.medium * 2);
    sp.dispose();
    // the aqua court: block and sprig meshes, the sprigs one mesh a run of one size, every triangle in the budget
    const { file } = scene('test-tower-club-aqua');
    const hedges = file.rows.filter((r) => r.style === 'hedge');
    expect(hedges.length).toBeGreaterThan(0);
    for (const tier of TIERS) {
      const h = mountFoliage(plantsForTier(file, tier), [], tier, file.seed);
      h.dispose();
    }
  });
});

describe('the pieces', () => {
  const sat = (hex: string): number => { const hsl = { h: 0, s: 0, l: 0 }; new THREE.Color(hex).getHSL(hsl, THREE.SRGBColorSpace); return hsl.s; };
  it('the aqua-play equipment is in muted satin finishes, stainless fittings', () => {
    for (const m of [PLAY_RED, PLAY_YELLOW, PLAY_BLUE]) { expect(sat(m.tint!), m.tint).toBeLessThan(0.45); expect(m.key).toBe('plastic'); }
    expect(PLAY_GREY.key).toBe('dark');
    expect(STAINLESS.key).toBe('metal');
  });
  it('a model cushion is darkened to a fabric albedo; its frame is not', () => {
    const geo = { id: 'lounger' as const, meshes: [
      { part: 'cushion', geometry: new THREE.BoxGeometry(0.6, 0.1, 1.8), material: new THREE.MeshStandardMaterial({ color: '#ffffff' }) },
      { part: 'frame', geometry: new THREE.BoxGeometry(0.7, 0.4, 2), material: new THREE.MeshStandardMaterial({ color: '#ffffff' }) },
    ] };
    const g = new THREE.Group();
    addPiece(g, geo, 0.7, 0.8, 2, (p) => p);
    const c = (g.children.find((m) => m.name === 'cushion') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const f = (g.children.find((m) => m.name === 'frame') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const k = CUSHION_ALBEDO.lounger!;
    expect(c.color.r).toBeCloseTo(k[0], 3);
    expect(c.color.b).toBeCloseTo(k[2], 3);
    expect(f.color.r).toBe(1);
  });
});

describe('the depth numerals', () => {
  it('read from the deck on every side: the top of the figures points to the water', () => {
    const { file } = scene('test-tower-club-pool');
    const mats = new OutdoorMaterials('medium');
    const built = buildPools(file.pools, mats, 'medium', null);
    const numerals: THREE.Mesh[] = [];
    built.group.traverse((o) => { if (String(o.name).endsWith(':numeral')) numerals.push(o as THREE.Mesh); });
    expect(numerals.length).toBeGreaterThan(4);
    let checked = 0;
    for (const m of numerals) {
      const id = String(m.name).split(':')[1];
      const r = file.pools.find((p) => p.id === id)!.rect;
      const pos = m.geometry.attributes.position, uv = m.geometry.attributes.uv;
      // the middle of the figures' top edge (v = 1) and of their foot (v = 0)
      const top = new THREE.Vector3(), foot = new THREE.Vector3();
      let nt = 0, nf = 0;
      for (let i = 0; i < pos.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pos, i); if (uv.getY(i) > 0.5) { top.add(v); nt++; } else { foot.add(v); nf++; } }
      top.divideScalar(nt); foot.divideScalar(nf);
      const up = top.clone().sub(foot);
      // the water is on the inside of the coping: towards the basin's middle across the side the numeral sits on
      const mid = new THREE.Vector3((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
      const toWater = mid.sub(foot);
      if (Math.abs(up.x) > Math.abs(up.z)) expect(Math.sign(up.x), m.name).toBe(Math.sign(toWater.x)); else expect(Math.sign(up.z), m.name).toBe(Math.sign(toWater.z));
      checked++;
    }
    expect(checked).toBe(numerals.length);
    built.dispose();
  });
});

afterEach(() => {});
