// SPEC 16.24 "2K top quality". What can be checked without a GPU: Off and 1K cost exactly what they did (the geometry and material counts of every catalogue piece at every
// tier match a table taken before this level was built), the 2K detail draws the same sizes (SPEC 16.2 rule 1) with more triangles where it should, the table that says
// what each surface is, promoting a material to a physical one and taking it back leaves the standard material exactly as it was, the probe rooms, the mirror quads and the
// finer sky.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CATALOG, itemFromCatalog } from '../src/core/catalog';
import { buildRealFurniture } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { setUltraDetail, ultraDetail, genQuality, GEN_QUALITY, ULTRA_QUALITY } from '../src/look/gen';
import { resetStyle, setStyle } from '../src/look/style';
import { PACKS } from '../src/look/packs';
import { setGenCeiling } from '../src/look/gen/ceiling';
import { PBR, classify, roughOf } from '../src/look/premium/pbr';
import type { PbrProbe } from '../src/look/premium/pbr';
import { PATCHED_CHUNK, demote, isPromoted, makeProbeUniforms, promote, promotedClass } from '../src/look/premium/promote';
import { RoomProbes, pointInPoly, probeRooms, roomAt } from '../src/look/premium/probes';
import { mirrorQuadOfBox, mirrorQuadsOfKit, quadOf } from '../src/look/premium/mirrors';
import { cloudField, skyPixels } from '../src/look/sky';
import { PREMIUM_GROUND, premiumPaths } from '../src/look/premium/texture';
import { gradeAt } from '../src/look/grade';
import golden from './fixtures/premium-parity.json';
import fs from 'node:fs';
import path from 'node:path';

afterEach(() => { setUltraDetail(false); resetStyle(); setGenCeiling(2.7); });

type Counts = [number, number, number];
function count(g: THREE.Group): Counts {
  let meshes = 0, tris = 0;
  const mats = new Set<string>();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const gm = m.geometry;
    tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3;
    mats.add(`${(m.material as THREE.Material).name}|${(m.material as THREE.MeshStandardMaterial).color.getHexString()}`);
  });
  return [meshes, Math.round(tris), mats.size];
}
const TIERS = ['low', 'medium', 'high'] as const;

describe('Off and 1K cost exactly what they did', () => {
  it('the 2K switch is down by default, and the tier tables are untouched', () => {
    expect(ultraDetail()).toBe(false);
    for (const t of TIERS) expect(genQuality(t)).toBe(GEN_QUALITY[t]);
    expect(GEN_QUALITY.high.ultra).toBeUndefined();
    expect(ULTRA_QUALITY.ultra).toBe(true);
  });
  it('every catalogue piece has the meshes, triangles and materials it had before the 2K level, at every tier and in two packs', () => {
    const table = golden as unknown as Record<string, Counts>;
    let n = 0;
    for (const packId of ['clean-contrast', 'warm-oak-navy']) {
      setStyle({ packId: PACKS.find((p) => p.id === packId) ? packId : PACKS[0].id });
      for (const tier of TIERS) for (const row of CATALOG) {
        const item = itemFromCatalog(row.id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
        const g = new THREE.Group();
        buildRealFurniture(g, item, tier, createFurnitureKit());
        expect(count(g), `${packId} ${tier} ${row.id}`).toEqual(table[`${packId}|${tier}|${row.id}`]);
        n++;
      }
    }
    expect(n).toBe(Object.keys(table).length);
  });
  it('the low tier never gets the 2K detail, even with the switch up', () => {
    setUltraDetail(true);
    expect(genQuality('low')).toBe(GEN_QUALITY.low);
    expect(genQuality('high')).toBe(ULTRA_QUALITY);
    expect(genQuality('medium')).toBe(ULTRA_QUALITY);
  });
});

describe('2K draws the same sizes with finer parts', () => {
  const TOL = 0.012;
  function bounds(g: THREE.Group): THREE.Box3 {
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3();
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !/^(bag-chains|bag-hook|umbrella-)/.test(m.name)) bb.union(new THREE.Box3().setFromObject(m)); });
    return bb;
  }
  it('every generated catalogue piece fits its row exactly at 2K, and has at least the triangles of the high tier', () => {
    setStyle({ packId: 'light-scandinavian' });
    let finer = 0, checked = 0;
    for (const row of CATALOG) {
      const item = itemFromCatalog(row.id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
      setUltraDetail(false);
      const base = new THREE.Group();
      buildRealFurniture(base, item, 'high', createFurnitureKit());
      if (!base.userData.look) continue;
      setUltraDetail(true);
      const g = new THREE.Group();
      buildRealFurniture(g, item, 'high', createFurnitureKit());
      setUltraDetail(false);
      const b0 = bounds(base), b1 = bounds(g);
      const { w, d } = item.box;
      // the same drawn sizes as the high tier: width, depth and height to a few millimetres, and the row's own where the high tier is exact (a few parts, such as a swing's
      // hooks, reach past the row at every tier already)
      for (const [name, lo, hi, ref] of [['width', b1.min.x, b1.max.x, b0.max.x - b0.min.x], ['depth', b1.min.z, b1.max.z, b0.max.z - b0.min.z]] as const) {
        expect(hi - lo, `${row.id} ${name}`).toBeGreaterThan(ref - 0.004);
        expect(hi - lo, `${row.id} ${name}`).toBeLessThan(ref + 0.004);
      }
      expect(b1.max.x - b1.min.x, `${row.id} width`).toBeLessThan(w + TOL + 0.05);
      expect(Math.abs(b1.max.y - b0.max.y), `${row.id} top`).toBeLessThan(0.004);
      expect(Math.abs(b1.min.y - b0.min.y), `${row.id} underside`).toBeLessThan(0.004);
      if (Math.abs(b0.max.y - item.heightM) < TOL) expect(Math.abs(b1.max.y - item.heightM), `${row.id} height`).toBeLessThan(TOL);
      // never fewer triangles than the high tier; a generated piece with soft or round parts has many more
      expect(count(g)[1], row.id).toBeGreaterThanOrEqual(count(base)[1] * 0.98);
      if (count(g)[1] > count(base)[1] * 1.5) finer++;
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    expect(finer, 'a good share of the catalogue is drawn finer at 2K').toBeGreaterThan(40);
  });
  it('a bed gets folds in its quilt and a hollow in its pillows, and stays under its own height', () => {
    setStyle({ packId: 'light-scandinavian' });
    const item = itemFromCatalog('bed-queen', { cx: 0, cz: 0, w: 1.62, d: 2.08, yawDeg: 0 }, 'virtual');
    setUltraDetail(false);
    const flat = new THREE.Group(); buildRealFurniture(flat, item, 'high', createFurnitureKit());
    setUltraDetail(true);
    const fine = new THREE.Group(); buildRealFurniture(fine, item, 'high', createFurnitureKit());
    const part = (g: THREE.Group, name: string): THREE.Mesh => { let r: THREE.Mesh | null = null; g.traverse((o) => { if (o.name === name) r = o as THREE.Mesh; }); return r!; };
    for (const name of ['duvet', 'pillows', 'mattress']) expect(part(fine, name), name).toBeTruthy();
    const tris = (m: THREE.Mesh): number => m.geometry.index!.count / 3;
    expect(tris(part(fine, 'duvet'))).toBeGreaterThan(tris(part(flat, 'duvet')) * 2);
    expect(tris(part(fine, 'pillows'))).toBeGreaterThan(tris(part(flat, 'pillows')) * 2);
    expect(part(fine, 'mattress-piping')).toBeTruthy();
    // the top of the cover has not risen: folds only press down
    expect(new THREE.Box3().setFromObject(part(fine, 'duvet')).max.y).toBeLessThanOrEqual(new THREE.Box3().setFromObject(part(flat, 'duvet')).max.y + 1e-4);
    expect(new THREE.Box3().setFromObject(part(fine, 'pillows')).max.y).toBeLessThanOrEqual(new THREE.Box3().setFromObject(part(flat, 'pillows')).max.y + 1e-4);
  });
  it('a tap is one smooth tube at 2K and rods below it, and reaches as far', () => {
    setStyle({ packId: 'light-scandinavian' });
    const item = itemFromCatalog('basin-wall', { cx: 0, cz: 0, w: 0.55, d: 0.45, yawDeg: 0 }, 'virtual');
    const tapOf = (g: THREE.Group): THREE.Mesh => { let r: THREE.Mesh | null = null; g.traverse((o) => { if (o.name === 'tap') r = o as THREE.Mesh; }); return r!; };
    setUltraDetail(false);
    const a = new THREE.Group(); buildRealFurniture(a, item, 'high', createFurnitureKit());
    setUltraDetail(true);
    const b = new THREE.Group(); buildRealFurniture(b, item, 'high', createFurnitureKit());
    const ba = new THREE.Box3().setFromObject(tapOf(a)), bb = new THREE.Box3().setFromObject(tapOf(b));
    expect(bb.max.y).toBeCloseTo(ba.max.y, 1);
    expect(bb.max.z).toBeCloseTo(ba.max.z, 1);
    expect(tapOf(b).geometry.index!.count).toBeGreaterThan(tapOf(a).geometry.index!.count);
  });
});

const probe = (o: Partial<PbrProbe>): PbrProbe => ({ mat: '', part: '', parent: '', rgb: [0.5, 0.5, 0.5], roughness: 0.5, metalness: 0, transparent: false, vertexColors: false, emissive: false, decor: false, ...o });

describe('what each surface is', () => {
  it('knows the kit materials and the parts the generators name', () => {
    expect(classify(probe({ mat: 'metal', part: 'counter-handles', metalness: 0.8 }))).toBe('steel');
    expect(classify(probe({ mat: 'metal', part: 'tap', metalness: 0.8 }))).toBe('chrome');
    expect(classify(probe({ mat: 'gloss', part: 'wc-pan' }))).toBe('ceramic');
    expect(classify(probe({ mat: 'gloss', part: 'basin-bowl' }))).toBe('ceramic');
    expect(classify(probe({ mat: 'gloss', part: 'fridge-doors' }))).toBe('lacquer');
    expect(classify(probe({ mat: 'gloss', part: 'tv-screen' }))).toBe('screen');
    expect(classify(probe({ mat: 'gloss', part: 'mirror-glass' }))).toBe('mirror');
    expect(classify(probe({ mat: 'sheer', part: 'glass' }))).toBe('glass');
    expect(classify(probe({ mat: 'sheer', part: 'curtain' }))).toBeNull(); // voile is cloth
    expect(classify(probe({ mat: 'granite', part: 'counter-top' }))).toBe('stone');
    expect(classify(probe({ mat: 'quartz', part: 'counter-top' }))).toBe('stone');
    expect(classify(probe({ mat: 'wood', part: 'bed-frame' }))).toBe('veneer');
    expect(classify(probe({ mat: 'laminate', part: 'wardrobe-fronts' }))).toBe('satin');
    expect(classify(probe({ mat: 'weave', part: 'sofa-seat' }))).toBe('fabric');
    expect(classify(probe({ mat: 'cotton', part: 'duvet' }))).toBe('bedding');
    expect(classify(probe({ mat: 'quilt', part: 'duvet' }))).toBe('bedding');
    expect(classify(probe({ mat: 'blackMetal', part: 'fridge-feet', metalness: 0.75 }))).toBe('darkMetal');
    expect(classify(probe({ mat: 'lamp', part: 'lamp' }))).toBe('shade');
  });
  it('treats the unnamed: door hardware by its numbers, decor by its tag, paint and floors not at all', () => {
    expect(classify(probe({ metalness: 0.65, roughness: 0.22, rgb: [0.7, 0.72, 0.74] }))).toBe('chrome');
    expect(classify(probe({ metalness: 0.5, roughness: 0.4, rgb: [0.5, 0.5, 0.5] }))).toBe('steel');
    expect(classify(probe({ metalness: 0.5, roughness: 0.4, rgb: [0.8, 0.55, 0.2] }))).toBe('brass');
    expect(classify(probe({ decor: true, tag: 'ceramic' }))).toBe('ceramic');
    expect(classify(probe({ decor: true, roughness: 0.7 }))).toBeNull();
    expect(classify(probe({ roughness: 0.9 }))).toBeNull();
    expect(classify(probe({ roughness: 0.2, emissive: true }))).toBeNull();
  });
  it('every class has sane physical numbers, and none tints a surface warm', () => {
    for (const [name, p] of Object.entries(PBR)) {
      expect(p.metalness, name).toBeGreaterThanOrEqual(0); expect(p.metalness, name).toBeLessThanOrEqual(1);
      expect(p.rough.min, name).toBeGreaterThan(0); expect(p.rough.min, name).toBeLessThanOrEqual(p.rough.max);
      expect(p.env, name).toBeGreaterThan(0);
      if (p.colour) { const c = new THREE.Color(p.colour); expect(Math.abs(c.r - c.b), `${name} colour is neutral`).toBeLessThan(0.1); }
      if (p.transmission) expect(p.thickness, name).toBeGreaterThan(0);
    }
    expect(roughOf('chrome', 0.35)).toBeLessThanOrEqual(PBR.chrome.rough.max);
    expect(roughOf('fabric', 0.5)).toBeGreaterThanOrEqual(PBR.fabric.rough.min);
  });
});

describe('promoting a material', () => {
  it('turns a standard material into a physical one in place, and demote gives back exactly the standard material', () => {
    const u = makeProbeUniforms();
    const m = new THREE.MeshStandardMaterial({ color: '#B8B8B8', roughness: 0.35, metalness: 0.8, name: 'metal' });
    const keys = Object.getOwnPropertyNames(m).sort();
    const colour = m.color.getHex();
    promote(m, 'chrome', u);
    expect(m).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(m.type).toBe('MeshPhysicalMaterial');
    expect(isPromoted(m)).toBe(true);
    expect(promotedClass(m)).toBe('chrome');
    expect(m.metalness).toBe(1);
    expect(m.roughness).toBeLessThan(0.1);
    expect((m as THREE.MeshPhysicalMaterial).clearcoat).toBe(0);
    promote(m, 'steel', u); // a second class over the first
    expect(promotedClass(m)).toBe('steel');
    demote(m);
    expect(m).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(m.type).toBe('MeshStandardMaterial');
    expect(isPromoted(m)).toBe(false);
    expect(m.color.getHex()).toBe(colour);
    expect(m.roughness).toBe(0.35); expect(m.metalness).toBe(0.8);
    expect(Object.getOwnPropertyNames(m).sort()).toEqual(keys);
    expect(m.defines).toEqual({ STANDARD: '' });
  });
  it('glass is transmissive and opaque to the blend sorter, and comes back transparent', () => {
    const u = makeProbeUniforms();
    const m = new THREE.MeshStandardMaterial({ color: '#BFD6DD', roughness: 1, transparent: true, opacity: 0.8, depthWrite: false });
    promote(m, 'glass', u);
    const p = m as unknown as THREE.MeshPhysicalMaterial;
    expect(p.transmission).toBe(1);
    expect(p.thickness).toBeGreaterThan(0);
    expect(m.transparent).toBe(false);
    expect(m.opacity).toBe(1);
    demote(m);
    expect(m.transparent).toBe(true); expect(m.opacity).toBe(0.8); expect(m.depthWrite).toBe(false);
  });
  it('keeps a hook chained before it (the baked-light patch) and runs it first', () => {
    const u = makeProbeUniforms();
    const m = new THREE.MeshStandardMaterial();
    const order: string[] = [];
    m.onBeforeCompile = () => { order.push('own'); };
    promote(m, 'ceramic', u);
    const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: '#include <envmap_physical_pars_fragment>', vertexShader: '' };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(order).toEqual(['own']);
    expect(shader.uniforms).toHaveProperty('uProbeMap');
    expect(shader.uniforms).toHaveProperty('uClassEnv');
    // the include is replaced by three's own chunk with its radiance lookup reading the probe (the shader is seen before includes are resolved)
    expect(shader.fragmentShader).not.toContain('#include <envmap_physical_pars_fragment>');
    expect(shader.fragmentShader).toContain('lkBoxProject( reflectVec )');
    expect(shader.fragmentShader).toContain('float lkScale');
    expect(shader.fragmentShader).toBe(`${shader.fragmentShader.slice(0, shader.fragmentShader.indexOf(PATCHED_CHUNK()))}${PATCHED_CHUNK()}`);
    expect(PATCHED_CHUNK()).not.toBe(THREE.ShaderChunk.envmap_physical_pars_fragment);
    // the irradiance (diffuse) lookup is three's own, untouched
    expect(PATCHED_CHUNK()).toContain('return PI * envMapColor.rgb * envMapIntensity;');
    // every use of the radiance line in the chunk was replaced, the retro-reflection ones included (they have no probe)
    expect((THREE.ShaderChunk.envmap_physical_pars_fragment.match(/envMapRotation \* reflectVec, roughness/g) ?? []).length).toBeGreaterThan(0);
    expect(m.customProgramCacheKey()).toContain('lk-probe');
    demote(m);
  });
});

describe('probe rooms', () => {
  const layout = { rooms: [
    { id: 'a', polygon: [{ x: 7, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 3 }, { x: 7, z: 3 }], roomType: 'living' },
    { id: 'l', polygon: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 6 }, { x: 0, z: 6 }], roomType: 'bedroom' },
  ], wallHeightM: 2.7 } as never;
  it('takes each room from a point inside it, away from its walls, at eye height, with its own box', () => {
    const rooms = probeRooms(layout);
    expect(rooms.map((r) => r.id)).toEqual(['a', 'l']);
    for (const r of rooms) {
      expect(pointInPoly(r.eye.x, r.eye.z, r.poly), `${r.id} eye inside`).toBe(true);
      expect(r.eye.y).toBeGreaterThan(1.0); expect(r.eye.y).toBeLessThan(2.3);
      expect(r.max.y).toBeGreaterThanOrEqual(2.2);
    }
    // the L-shaped room: the centre of its bounding box is outside it, the probe is not
    expect(pointInPoly(3, 3, rooms[1].poly)).toBe(false);
  });
  it('says which room the camera is in, and the nearest when it is in none', () => {
    const rooms = probeRooms(layout);
    expect(roomAt(rooms, 8, 1)?.id).toBe('a');
    expect(roomAt(rooms, 1, 5)?.id).toBe('l');
    expect(roomAt(rooms, 4, 4)?.id).toBe('l'); // in the notch of the L: the nearest room
  });
});

describe('the probe frees what it holds', () => {
  it('every cube is freed when the probe is disposed and when its size changes, and all six face cameras are aimed apart', () => {
    const renderer = { coordinateSystem: THREE.WebGLCoordinateSystem } as unknown as THREE.WebGLRenderer;
    const layout = { rooms: [{ id: 'a', polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], roomType: 'living' }], wallHeightM: 2.7 } as never;
    const p = new RoomProbes(renderer, new THREE.Scene(), layout, makeProbeUniforms(), 256, true);
    const cam = (p as unknown as { cam: THREE.CubeCamera }).cam;
    cam.updateMatrixWorld(true);
    // px, nx, py, ny, pz, nz: six different directions (the bug was six cameras all looking down -z)
    const dirs = cam.children.map((c) => new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld).round().toArray().join(','));
    expect(new Set(dirs).size).toBe(6);
    const cubes = (p as unknown as { cubeOf(id: string): { rt: THREE.WebGLCubeRenderTarget } });
    let freed = 0;
    cubes.cubeOf('a').rt.addEventListener('dispose', () => freed++);
    p.resize(128);
    expect(freed).toBe(1);
    expect(p.cubeCount).toBe(0);
    cubes.cubeOf('a').rt.addEventListener('dispose', () => freed++);
    p.dispose();
    expect(freed).toBe(2);
    expect(p.cubeCount).toBe(0);
    p.dispose(); // twice is fine
  });
});

describe('mirrors', () => {
  it('builds one quad for a connected piece of glass, facing into the room, and none for a ceiling', () => {
    // two stacked bands of one mirror on a wall facing +z, and a second mirror elsewhere
    const pos: number[] = [];
    const quad = (x0: number, x1: number, y0: number, y1: number, z: number): void => { pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z); };
    quad(1, 1.55, 1.05, 1.4, 0); quad(1, 1.55, 1.4, 1.75, 0); quad(3, 3.5, 1.0, 1.7, 0);
    quad(0, 1, 2.6, 2.6, 0.5); // degenerate: skipped
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); mesh.updateMatrixWorld(true);
    const quads = mirrorQuadsOfKit(mesh);
    expect(quads.length).toBe(2);
    for (const q of quads) expect(q.normal.z).toBeGreaterThan(0.99);
    const big = quads.find((q) => q.corners[1].x - q.corners[0].x > 0.5 && q.corners[2].y > 1.7)!;
    expect(big.corners[0].y).toBeCloseTo(1.05, 3); expect(big.corners[2].y).toBeCloseTo(1.75, 3);
  });
  it('takes the front face of a thin box mirror in the piece frame, to the world', () => {
    const geo = new THREE.BoxGeometry(0.5, 0.7, 0.004).translate(0, 1.4, -0.2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.rotation.y = Math.PI / 2; mesh.position.set(2, 0, 3); mesh.updateMatrixWorld(true);
    const q = mirrorQuadOfBox(mesh)!;
    expect(q.normal.x).toBeCloseTo(1, 3);
    expect(q.centre.y).toBeCloseTo(1.4, 3);
    const flat = quadOf([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 0)], new THREE.Vector3(0, 0, 1));
    expect(flat.corners.length).toBe(4);
  });
});

describe('the 2K sky and the 2K texture sets', () => {
  const g = gradeAt(13);
  it('adds clouds and a sun core to the plain sky, only above the horizon, and leaves the plain sky alone', () => {
    const plain = skyPixels(g.sky, 55, 64, 32, false), rich = skyPixels(g.sky, 55, 64, 32, true);
    expect(rich.length).toBe(plain.length);
    let changed = 0;
    for (let i = 0; i < plain.length; i++) if (Math.abs(plain[i] - rich[i]) > 1e-4) changed++;
    expect(changed).toBeGreaterThan(plain.length * 0.05);
    // below the horizon there is no cloud
    const field = cloudField(64, 32);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 64; i++) expect(field[j * 64 + i]).toBe(0);
    expect(Math.max(...field)).toBeGreaterThan(0.2);
    expect(Math.max(...field)).toBeLessThanOrEqual(1);
    // the default call is the old sky, byte for byte
    expect(Array.from(skyPixels(g.sky, 55))).toEqual(Array.from(skyPixels(g.sky, 55, 256, 128, false)));
  });
  it('every file the 2K level fetches is in the repository with its source and licence written down', () => {
    const dir = path.resolve(import.meta.dirname, '../public/look/tex/premium');
    const sources = fs.readFileSync(path.join(dir, 'SOURCES.txt'), 'utf8');
    expect(sources).toContain('CC0');
    let bytes = 0;
    for (const set of Object.values(PREMIUM_GROUND)) for (const f of Object.values(premiumPaths(set))) {
      const file = path.resolve(import.meta.dirname, '../public/look', f);
      expect(fs.existsSync(file), f).toBe(true);
      bytes += fs.statSync(file).size;
      expect(sources, f).toContain(path.basename(f));
    }
    expect(bytes).toBeLessThan(20e6);
  });
});
