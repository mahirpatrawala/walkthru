// SPEC 16.15.5 (23 Nov 2026): the flats polished. The Soho bed frame wears the kit's photographed linen weave over box-projected UVs; the WC's
// own lid is turned down onto its seat; the ottoman's top is diamond-tufted relief; the TV unit's niche is an open shelf; a single-door fridge
// shows its door seam and base grille; a slatted headboard stands in a frame. Every piece stays inside its drawn box (the bake's 1 mm), and
// the candidates looked at and refused are in the lock with the reason.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { catalogItem, itemFromCatalog } from '../src/core/catalog';
import { buildRealFurniture, resolveItemLook } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { attachModel } from '../src/look/models/apply';
import { pickFabric } from '../src/look/models/instance';
import { modelInfo, planFurniture, setModelsEnabled } from '../src/look/models/library';
import { HOME_FURNITURE } from '../src/look/models/home';
import { clearModelCache, primeModel } from '../src/look/models/load';
import type { Template } from '../src/look/models/load';
import { GENERATORS, genQuality } from '../src/look/gen';
import type { GenSize, Roles } from '../src/look/gen';
import { tuftButtons } from '../src/look/gen/seating';
import { resetStyle, setStyle } from '../src/look/style';
import { PARITY_TOLERANCE_M } from '../src/look/baked/parity';
import type { FurnitureItem } from '../src/types';
import type { Tier } from '../src/look/types';

const ROOT = path.resolve(__dirname, '..');
const HOME = path.join(ROOT, 'public/look/home');
const lock = JSON.parse(fs.readFileSync(path.join(HOME, 'home.lock.json'), 'utf8')) as { assets: Record<string, { uid: string }>; rejected: { what: string; url: string; why: string }[] };

afterEach(() => { resetStyle(); setModelsEnabled(true); clearModelCache(); });

const cat = (id: string): FurnitureItem => { const c = catalogItem(id)!; return itemFromCatalog(id, { cx: 0, cz: 0, w: c.footprint.w, d: c.footprint.d, yawDeg: 0 }, 'virtual'); };

interface GlbJson {
  nodes: { name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { min?: number[]; max?: number[]; normalized?: boolean; componentType: number }[];
}
const glbJson = (file: string): GlbJson => { const buf = fs.readFileSync(path.join(HOME, 'models', file)); return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as GlbJson; };
/** each named node's box, from the accessor bounds under the node's transform (meshopt quantisation puts a scale on the node) */
function nodeBoxes(j: GlbJson): Map<string, THREE.Box3> {
  const out = new Map<string, THREE.Box3>();
  for (const n of j.nodes) {
    if (n.mesh === undefined) continue;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
    const box = new THREE.Box3();
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      const k = a.normalized ? ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 } as Record<number, number>)[a.componentType] ?? 1 : 1;
      box.union(new THREE.Box3(new THREE.Vector3(...a.min!.map((v) => v / k)), new THREE.Vector3(...a.max!.map((v) => v / k))).applyMatrix4(m));
    }
    out.set(n.name ?? '', box);
  }
  return out;
}

// ------------------------------------------------------------------ the bed frame
describe('the Soho bed frame wears the kit\'s fabric weave', () => {
  it('is upholstered: the first fabric among its roles, never the pack\'s oak headboard', () => {
    const frame = HOME_FURNITURE.find((m) => m.id === 'bed_frame_soho')!;
    expect(frame.parts.frame.fabric).toBe(true);
    setStyle({ packId: 'clean-contrast' });
    const roles = resolveItemLook(cat('bed-queen'))!.roles;
    expect(roles.headboard.key).toBe('wood');
    const spec = pickFabric(roles, frame.parts.frame.role);
    expect(spec?.key).toBe('weave');
    expect(spec).toEqual(roles.fabric);
    // no cloth among the roles: the model keeps the ordinary finish path
    expect(pickFabric({ headboard: { key: 'wood' }, case: { key: 'laminate' } } as Roles, ['headboard', 'case'])).toBeNull();
  });
  it('ships UVs in metres on the full file only (the phone shows plain colours)', () => {
    expect(modelInfo('bed_frame_soho')!.parts.frame.uvMetres).toBe(4);
    const full = glbJson(modelInfo('bed_frame_soho')!.files.full!.file), low = glbJson(modelInfo('bed_frame_soho')!.files.low!.file);
    expect(full.meshes.every((m) => m.primitives.every((p) => 'TEXCOORD_0' in p.attributes))).toBe(true);
    expect(low.meshes.some((m) => m.primitives.some((p) => 'TEXCOORD_0' in p.attributes))).toBe(false);
  });
  for (const tier of ['medium', 'high'] as Tier[]) {
    it(`swapped in at ${tier}: the frame is the kit's weave in the room's fabric colour, its UVs at the weave's tile, inside the box`, async () => {
      setStyle({ packId: 'clean-contrast' });
      const info = modelInfo('bed_frame_soho')!;
      const tpl: Template = { id: 'bed_frame_soho', tier: 'full', parts: [{ name: 'frame', geometry: new THREE.BoxGeometry(info.dims.w, info.dims.h, info.dims.d).translate(0, info.dims.h / 2, 0), material: new THREE.MeshStandardMaterial() }] };
      primeModel('bed_frame_soho', tier, tpl);
      const it0 = cat('bed-queen');
      const kit = createFurnitureKit();
      const g = new THREE.Group();
      buildRealFurniture(g, it0, tier, kit);
      const look = resolveItemLook(it0)!;
      expect(await attachModel(g, it0, look, planFurniture(it0, look, {})!, tier, kit)).toBe(true);
      const frame = g.children.find((c) => c.name === 'frame') as THREE.Mesh;
      const mat = frame.material as THREE.MeshStandardMaterial;
      expect(mat.color.getHex()).toBe(new THREE.Color(look.roles.fabric.tint).getHex());
      expect(mat.userData.baseColor).toBe(mat.color.getHex());
      const uv = frame.geometry.getAttribute('uv') as THREE.BufferAttribute;
      let max = 0;
      for (let i = 0; i < uv.count; i++) max = Math.max(max, uv.getX(i), uv.getY(i));
      expect(max).toBeCloseTo(info.parts.frame.uvMetres! / kit.tile('weave'), 5);
      g.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(g);
      expect(Math.max(b.max.x - it0.box.w / 2, -it0.box.w / 2 - b.min.x, b.max.z - it0.box.d / 2, -it0.box.d / 2 - b.min.z, b.max.y - it0.heightM)).toBeLessThanOrEqual(PARITY_TOLERANCE_M);
    });
  }
});

// ------------------------------------------------------------------ the WC
describe('the WC shows its own lid, closed on the seat', () => {
  it('has a lid part, in the library, the manifest and both files', () => {
    expect(Object.keys(HOME_FURNITURE.find((m) => m.id === 'wc_floor')!.parts)).toContain('lid');
    expect(Object.keys(modelInfo('wc_floor')!.parts)).toContain('lid');
    for (const tier of ['full', 'low'] as const) expect([...nodeBoxes(glbJson(modelInfo('wc_floor')!.files[tier]!.file)).keys()].sort()).toEqual(['lid', 'pan', 'seat']);
  });
  for (const tier of ['full', 'low'] as const) {
    it(`${tier}: the lid lies flat on the seat, over it, below the cistern, inside the measured box`, () => {
      const info = modelInfo('wc_floor')!;
      const boxes = nodeBoxes(glbJson(info.files[tier]!.file));
      const lid = boxes.get('lid')!, seat = boxes.get('seat')!, pan = boxes.get('pan')!;
      // the seat part also holds the four floor caps: its top is the ring's
      expect(Math.abs(lid.min.y - seat.max.y)).toBeLessThan(0.004);
      expect(lid.max.y - lid.min.y).toBeLessThan(0.06);
      expect(lid.max.y).toBeLessThan(pan.max.y - 0.2);
      expect(lid.min.x).toBeGreaterThan(-info.dims.w / 2 - 0.002); expect(lid.max.x).toBeLessThan(info.dims.w / 2 + 0.002);
      expect(lid.min.z).toBeGreaterThan(-info.dims.d / 2 - 0.002); expect(lid.max.z).toBeLessThan(info.dims.d / 2 + 0.002);
      // it covers the bowl: from behind the seat ring's middle to near its front
      expect(lid.max.z).toBeGreaterThan(seat.max.z - 0.03);
    });
  }
  it('the seat height is measured on the ring a person sits on, under the lid, and still lands within 3 cm of the drawn seat', () => {
    setStyle({ packId: 'clean-contrast' });
    const it0 = cat('wc-western');
    const plan = planFurniture(it0, resolveItemLook(it0), {})!;
    expect(plan.model.id).toBe('wc_floor');
    expect(Math.abs(plan.info.surfaceM! * plan.fit.scale.y - it0.surfaceHeightM)).toBeLessThanOrEqual(0.03);
  });
});

// ------------------------------------------------------------------ the lock
describe('the candidates looked at on 23 Nov 2026 are refused in the lock with the reason', () => {
  for (const uid of ['9a8b2caf923e408bb67dbca4aaa248fc', '7b28aac59e8e44869bee3a2ff6185e72', '12087c690ee24ac799d4f2ee26dc4f04', 'fd1836d9ebb14e4eb8f2e2572b9074d1']) {
    it(uid, () => {
      const r = lock.rejected.find((x) => x.url.endsWith(uid));
      expect(r).toBeTruthy();
      expect(r!.why).toMatch(/\d+ %/);
      expect(Object.values(lock.assets).some((a) => a.uid === uid)).toBe(false);
    });
  }
});

// ------------------------------------------------------------------ generated pieces
const build = (kind: keyof typeof GENERATORS, size: GenSize, tier: Tier, params: Record<string, unknown> = {}, roles: Roles = {}): THREE.Group => {
  const spec = GENERATORS[kind];
  const g = spec.build({ kit: createFurnitureKit(), q: genQuality(tier) }, size, { ...spec.defaults, ...params }, roles);
  g.updateMatrixWorld(true);
  return g;
};
const overBox = (g: THREE.Object3D, s: GenSize): number => {
  const b = new THREE.Box3().setFromObject(g);
  return Math.max(b.max.x - s.w / 2, -s.w / 2 - b.min.x, b.max.z - s.d / 2, -s.d / 2 - b.min.z, b.max.y - Math.max(s.h, s.s), -b.min.y);
};
const tris = (g: THREE.Object3D): number => { let n = 0; g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return n; };
const part = (g: THREE.Object3D, name: string): THREE.Mesh | undefined => g.children.find((c) => c.name === name) as THREE.Mesh | undefined;

describe('the ottoman\'s top is diamond-tufted', () => {
  for (const [w, d] of [[0.58, 0.55], [0.7, 0.66], [0.71, 0.7]]) {
    const size: GenSize = { w, d, h: 0.4, s: 0.4 };
    for (const tier of ['medium', 'high'] as Tier[]) {
      it(`${w} x ${d} at ${tier}: dimples a centimetre and more deep with a button in each, inside the box, within budget`, () => {
        const g = build('ottoman', size, tier);
        expect(overBox(g, size)).toBeLessThanOrEqual(PARITY_TOLERANCE_M);
        const top = part(g, 'ottoman-top')!;
        const pos = top.geometry.getAttribute('position') as THREE.BufferAttribute;
        let crown = -Infinity;
        for (let i = 0; i < pos.count; i++) crown = Math.max(crown, pos.getY(i));
        const buttons = tuftButtons(w, d);
        expect(buttons.length).toBeGreaterThanOrEqual(5);
        for (const b of buttons) {
          // the top's vertex nearest the button (the underside lies below the crown by the cushion's thickness)
          let near = Infinity, over = crown;
          for (let i = 0; i < pos.count; i++) {
            if (pos.getY(i) < crown - 0.05) continue;
            const dist = Math.hypot(pos.getX(i) - b.x, pos.getZ(i) - b.z);
            if (dist < near) { near = dist; over = pos.getY(i); }
          }
          expect(near).toBeLessThan(0.02);
          expect(crown - over).toBeGreaterThan(0.01);
        }
        const btn = part(g, 'ottoman-buttons')!;
        btn.geometry.computeBoundingBox();
        expect(btn.geometry.boundingBox!.max.y).toBeLessThan(crown - 0.005);
        expect(tris(g)).toBeLessThan(tier === 'high' ? 8000 : 4000);
      });
    }
  }
  it('the phone keeps the plain crowned top (no relief, no buttons)', () => {
    const g = build('ottoman', { w: 0.58, d: 0.55, h: 0.4, s: 0.4 }, 'low');
    expect(part(g, 'ottoman-buttons')).toBeUndefined();
    expect(tris(g)).toBeLessThan(1000);
  });
});

describe('the TV unit\'s niche is an open shelf, the fridge has a door seam and a base grille, a slatted headboard has a frame', () => {
  it('a ray into the niche reaches its back, 18 cm in, not a panel at the front', () => {
    const size: GenSize = { w: 1.8, d: 0.4, h: 1.62, s: 0.45 };
    for (const tier of ['low', 'medium', 'high'] as Tier[]) {
      const g = build('tvunit', size, tier);
      expect(overBox(g, size)).toBeLessThanOrEqual(PARITY_TOLERANCE_M);
      const hit = new THREE.Raycaster(new THREE.Vector3(0.15, 0.3, 1), new THREE.Vector3(0, 0, -1)).intersectObject(g, true)[0];
      expect(hit.object.name).toBe('tv-niche');
      expect(hit.point.z).toBeLessThan(0.2 - 0.17);
    }
  });
  it('a single-door fridge on medium and high has its gasket and a grille under the door; a phone keeps the plain door', () => {
    const size: GenSize = { w: 0.58, d: 0.67, h: 1.45, s: 1.45 };
    for (const tier of ['medium', 'high'] as Tier[]) {
      const g = build('appliance', size, tier, { variant: 'fridge-1' });
      expect(overBox(g, size)).toBeLessThanOrEqual(PARITY_TOLERANCE_M);
      expect(part(g, 'fridge-gasket')).toBeTruthy();
      const grille = part(g, 'fridge-grille')!, door = part(g, 'fridge-doors')!;
      grille.geometry.computeBoundingBox(); door.geometry.computeBoundingBox();
      expect(door.geometry.boundingBox!.min.y).toBeGreaterThan(grille.geometry.boundingBox!.max.y - 0.005);
      expect(part(g, 'fridge-recess')).toBeUndefined();
    }
    const low = build('appliance', size, 'low', { variant: 'fridge-1' });
    expect(part(low, 'fridge-grille')).toBeUndefined();
    expect(part(low, 'fridge-gasket')).toBeUndefined();
  });
  it('a slatted headboard is held by two posts and a capping rail, the full width and height of the bed', () => {
    for (const [w, d] of [[1.01, 1.93], [1.32, 1.93]]) {
      const size: GenSize = { w, d, h: 0.9, s: 0.5 };
      for (const tier of ['low', 'medium', 'high'] as Tier[]) {
        const g = build('bed', size, tier, { base: 'legs', headboard: 'slatted' });
        expect(overBox(g, size)).toBeLessThanOrEqual(PARITY_TOLERANCE_M);
        const hb = part(g, 'bed-headboard')!;
        hb.geometry.computeBoundingBox();
        const b = hb.geometry.boundingBox!;
        expect(b.min.x).toBeCloseTo(-w / 2, 3); expect(b.max.x).toBeCloseTo(w / 2, 3); expect(b.max.y).toBeCloseTo(0.9, 3);
        // the back panel stops under the capping rail and between the posts
        const back = part(g, 'bed-headboard-back')!;
        back.geometry.computeBoundingBox();
        expect(back.geometry.boundingBox!.max.y).toBeLessThan(0.9 - 0.03);
        expect(back.geometry.boundingBox!.min.x).toBeGreaterThan(-w / 2 + 0.03);
      }
    }
  });
});
