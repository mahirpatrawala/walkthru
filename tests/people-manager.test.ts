// People a buyer adds, with real bodies read from disk and no browser: the cap per tier, posing at each person's size, the walk grid, Become this
// person, tidying up when furniture moves, following, idling, drawing less of what cannot be seen, and My layout (kept, reset).
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildTruthProperty } from '../scripts/make-test-room';
import { catalogItem, itemFromCatalog } from '../src/core/catalog';
import { swingSeatPose } from '../src/core/poses';
import { hostActionOf, hostPose } from '../src/buyer/people/model';
import { cellValue } from '../src/core/grid-codec';
import { rasterizeLayout } from '../src/core/layout-raster';
import { Character } from '../src/engine/character';
import { retargetOnto } from '../src/look/people';
import type { PersonTier } from '../src/look/people';
import { buildSeats } from '../src/buyer/seats';
import { createFurnitureStore } from '../src/buyer/store';
import type { StorageLike } from '../src/buyer/store';
import { createPeople } from '../src/buyer/people/manager';
import type { People, WalkerPort } from '../src/buyer/people/manager';
import { emptyLayout, encodeLayout, mineKey, parseMine, serializeMine } from '../src/buyer/my-layout';
import { emptyFittings } from '../src/look/fittings';
import type { PersonRec } from '../src/buyer/people/rec';
import { shoulderWidthM } from '../src/buyer/people/model';
import { hostSignature } from '../src/buyer/people/model';
import type { Vec2 } from '../src/types';

const DIR = path.resolve(import.meta.dirname, '../public/characters');
const have = ['person-man.glb', 'person-woman.glb', 'person-elder.glb', 'person-child.glb', 'person-man-low.glb', 'person-woman-low.glb', 'person-elder-low.glb', 'person-child-low.glb', 'clips.glb'].every((f) => fs.existsSync(path.join(DIR, f)));

const parsed = new Map<string, Promise<GLTF>>();
function parse(file: string): Promise<GLTF> {
  const buf = fs.readFileSync(path.join(DIR, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  l.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(null) }) as never);
  return new Promise((res, rej) => l.parse(ab, '', res, rej));
}
const clips = (): Promise<GLTF> => { let p = parsed.get('clips'); if (!p) parsed.set('clips', (p = parse('clips.glb'))); return p; };
const loads: { body: string; tier: PersonTier }[] = [];
async function load(who: { body: string; tone: number }, tier: PersonTier): Promise<Character> {
  loads.push({ body: who.body, tier });
  const gltf = await parse(`person-${who.body}${tier === 'low' ? '-low' : ''}.glb`);
  retargetOnto(gltf, await clips());
  return Character.fromGLTF(gltf, { body: who.body as never, tone: who.tone, tier });
}

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k) => (data.has(k) ? data.get(k)! : null), setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

const furnished = buildTruthProperty('furnished');
const empty = buildTruthProperty('empty');
const baseGrid = rasterizeLayout(empty.layout);

interface Rig {
  people: People; store: ReturnType<typeof createFurnitureStore>; scene: THREE.Group; camera: THREE.PerspectiveCamera; storage: ReturnType<typeof fakeStorage>;
  walker: { at: Vec2; yaw: number; body: 'man' | 'woman' | 'elder' | 'child'; swaps: unknown[]; posedOn: string | null };
  toasts: string[]; tier: { v: PersonTier };
}
const rigs: Rig[] = [];
function rig(opts: { tier?: PersonTier; linked?: PersonRec[]; seed?: Record<string, string>; walkerAt?: Vec2; random?: () => number } = {}): Rig {
  const tier = { v: opts.tier ?? 'high' };
  const storage = fakeStorage(opts.seed);
  const scene = new THREE.Group();
  const parent = new THREE.Group();
  const shareCode = opts.linked ? encodeLayout({ ...emptyLayout(), people: opts.linked }) : null;
  const store = createFurnitureStore({ sceneId: 't', baseGrid, initial: furnished.furniture, parent, storage, saveDelayMs: 0, shareCode });
  const seats = buildSeats(null, store.all());
  const toasts: string[] = [];
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 50);
  camera.position.set(2, 1.6, 0.4);
  camera.lookAt(2, 1, 3);
  camera.updateMatrixWorld(true);
  const walker = { at: opts.walkerAt ?? { x: 2.6, z: 0.8 }, yaw: 0, body: 'man' as 'man' | 'woman' | 'elder' | 'child', swaps: [] as unknown[], posedOn: null as string | null };
  const port: WalkerPort = {
    position: () => walker.at, yawDeg: () => walker.yaw, heightCm: () => 175,
    body: () => ({ body: walker.body, tone: 2 }), poseOn: () => walker.posedOn, state: () => 'idle', getUp: async () => {},
    swapTo: async (p) => { walker.swaps.push(p); walker.at = p.at; walker.yaw = p.yawDeg; walker.body = p.body; },
  };
  const people = createPeople({ scene, camera, store, seats, walker: port, sceneId: 't', storage, tier: () => tier.v, toast: (t) => toasts.push(t), load, random: opts.random ?? (() => 0.5) });
  const r: Rig = { people, store, scene, camera, storage, walker, toasts, tier };
  rigs.push(r);
  return r;
}
afterEach(() => { while (rigs.length) rigs.pop()!.people.dispose(); loads.length = 0; });

/** the people kept in this browser: in the same "mine" value as moves and fittings */
const stored = (st: StorageLike) => parseMine(st.getItem(mineKey('t')), new Map(furnished.furniture.map((i) => [i.id, i]))).people ?? [];
const woman = { body: 'woman' as const, tone: 1, heightCm: 160 };
const run = (p: People, seconds: number, dt = 1 / 30): void => { for (let t = 0; t < seconds; t += dt) p.update(dt); };

vi.setConfig({ testTimeout: 10000 });
// the page fetches bodies by URL; under Node the same URLs are answered from public/ (Character.setAppearance, the mannequin-free path)
vi.stubGlobal('fetch', async (url: string) => {
  const f = path.join(path.resolve(import.meta.dirname, '../public'), String(url));
  if (!fs.existsSync(f)) return new Response('missing', { status: 404 });
  return new Response(fs.readFileSync(f));
});
describe.skipIf(!have)('adding people', () => {
  it('a woman standing on free floor is a body in the scene, at her own height, blocking the walk grid', async () => {
    const r = rig();
    const res = await r.people.place(woman, { kind: 'stand', at: { x: 2.6, z: 1.6 } });
    expect(res.ok).toBe(true);
    await r.people.ready();
    expect(r.people.count()).toBe(1);
    const ch = r.people.bodyOf('pe-1')!;
    expect(ch).not.toBeNull();
    expect(r.scene.children).toContain(ch.object);
    ch.update(0);
    expect(Math.abs(ch.measure().heightM - 1.6)).toBeLessThan(0.01);
    expect(cellValue(r.store.grid(), 2.6, 1.6)).toBeGreaterThan(0); // a body in the walk path
    expect(cellValue(r.store.drawnGrid(), 2.6, 1.6)).toBe(0); // the home as drawn is untouched
    expect(r.store.all().map((i) => i.id).sort()).toEqual(['bed-1', 'sofa-1']); // people are not pieces
  });

  it('tells a person where the walker would be too close, and refuses a spot that is not floor', async () => {
    const r = rig();
    const near = await r.people.place(woman, { kind: 'stand', at: { x: 2.65, z: 0.8 } });
    expect(near).toMatchObject({ ok: false });
    const wall = await r.people.place(woman, { kind: 'stand', at: { x: -1, z: 2 } });
    expect(wall.ok).toBe(false);
    expect(r.people.count()).toBe(0);
    expect(cellValue(r.store.grid(), 2.65, 0.8)).toBe(0);
  });

  it('caps by tier: 2 on low, 3 on medium, 5 on high, each loading only its own body', async () => {
    for (const [tier, cap] of [['low', 2], ['medium', 3], ['high', 5]] as const) {
      const r = rig({ tier });
      const spots = [{ x: 0.8, z: 0.6 }, { x: 1.6, z: 0.6 }, { x: 2.0, z: 0.2 }, { x: 3.2, z: 0.6 }, { x: 3.4, z: 1.4 }, { x: 0.8, z: 4.0 }, { x: 2.6, z: 4.4 }];
      let ok = 0;
      let last: { ok: boolean; message?: string } = { ok: true };
      for (const at of spots) { last = await r.people.place({ body: 'child', tone: 2, heightCm: 110 }, { kind: 'stand', at }); if (last.ok) ok++; }
      expect(ok).toBe(cap);
      expect(r.people.count()).toBe(cap);
      expect(last.ok).toBe(false);
      expect((last as { message: string }).message).toMatch(tier === 'high' ? /up to 5 people/ : new RegExp(`up to ${cap} added`));
      await r.people.ready();
      r.people.dispose(); rigs.pop();
    }
  });

  it('low and medium tiers use the light body, high the full one', async () => {
    for (const [tier, want] of [['low', 'low'], ['medium', 'low'], ['high', 'medium']] as const) {
      loads.length = 0;
      const r = rig({ tier });
      await r.people.place(woman, { kind: 'stand', at: { x: 2.6, z: 1.6 } });
      await r.people.ready();
      expect(loads.map((l) => l.tier)).toEqual([want]);
      r.people.dispose(); rigs.pop();
    }
  });

  it('an elder sits and a child lies at their own size: the walker\'s poses, per height', async () => {
    const r = rig();
    const sofa = r.store.all().find((i) => i.id === 'sofa-1')!;
    const bed = r.store.all().find((i) => i.id === 'bed-1')!;
    expect((await r.people.place({ body: 'elder', tone: 3, heightCm: 150 }, { kind: 'host', item: sofa, action: 'sit', approach: { x: 3.55, z: 3.0 } })).ok).toBe(true);
    expect((await r.people.place({ body: 'man', tone: 2, heightCm: 190 }, { kind: 'host', item: sofa, action: 'sit', approach: { x: 3.55, z: 4.0 } })).ok).toBe(true);
    expect((await r.people.place({ body: 'child', tone: 0, heightCm: 120 }, { kind: 'host', item: bed, action: 'lie', approach: { x: 1.0, z: 2.0 } })).ok).toBe(true);
    await r.people.ready();
    run(r.people, 1.5);
    const [grandma, tall, kid] = ['pe-1', 'pe-2', 'pe-3'].map((id) => r.people.bodyOf(id)!);
    expect(grandma.state).toBe('sitting');
    expect(tall.state).toBe('sitting');
    expect(kid.state).toBe('lying');
    // seated, the taller man's head is above the elder's, by less than the 40 cm that separates them standing
    const top = (c: Character): number => c.measure().bboxMax.y;
    expect(top(tall)).toBeGreaterThan(top(grandma));
    // lying: the child's length is their height, along the bed
    expect(Math.abs(kid.measure().headToHeelM - 1.2)).toBeLessThan(0.04);
    // sitting and lying people add no obstacle of their own: the piece they are on already blocks
    expect(cellValue(r.store.gridExcludingTemporary(['people']), 3.55, 3.0)).toBe(cellValue(r.store.grid(), 3.55, 3.0));
  });

  it('a sofa that takes two seats two, and the third finds it full', async () => {
    const r = rig();
    const sofa = r.store.all().find((i) => i.id === 'sofa-1')!;
    const sit = (cm: number) => r.people.place({ body: 'woman', tone: 2, heightCm: cm }, { kind: 'host', item: sofa, action: 'sit', approach: { x: 3.55, z: 3.5 } });
    const first = await sit(160);
    const second = await sit(160);
    expect(first.ok && second.ok).toBe(true);
    const lats = r.people.list().map((p) => p.z);
    expect(Math.abs(lats[0] - lats[1])).toBeGreaterThanOrEqual(0.5 - 1e-9);
    let n = 2;
    for (let i = 0; i < 3; i++) if ((await sit(160)).ok) n++;
    expect(n).toBeLessThanOrEqual(3);
    const full = await sit(160);
    expect(full).toMatchObject({ ok: false });
  });

  it('a bed is for lying and a sofa for sitting', async () => {
    const r = rig();
    const bed = r.store.all().find((i) => i.id === 'bed-1')!;
    const r1 = await r.people.place(woman, { kind: 'host', item: bed, action: 'sit', approach: { x: 1, z: 2 } });
    expect(r1.ok).toBe(false);
  });
});

describe.skipIf(!have)('managing a person', () => {
  it('move, change pose (stand, sit, lie where possible), change person and height, remove', async () => {
    const r = rig();
    await r.people.place(woman, { kind: 'stand', at: { x: 2.6, z: 2.4 } });
    await r.people.ready();
    // nearest sofa within 2 m: sit; then stand again beside it
    expect((await r.people.setPose('pe-1', 'sit')).ok).toBe(true);
    expect(r.people.get('pe-1')).toMatchObject({ pose: 'sit', host: 'sofa-1' });
    run(r.people, 1.2);
    expect(r.people.bodyOf('pe-1')!.state).toBe('sitting');
    const up = await r.people.setPose('pe-1', 'stand');
    expect(up.ok).toBe(true);
    expect(r.people.get('pe-1')!.pose).toBe('stand');
    run(r.people, 2);
    expect(['idle', 'transition']).toContain(r.people.bodyOf('pe-1')!.state);
    // no bed in reach from a far corner
    await r.people.move('pe-1', { kind: 'stand', at: { x: 3.7, z: 0.3 } });
    const none = await r.people.setPose('pe-1', 'lie');
    expect(none.ok).toBe(false);
    expect((none as { message: string }).message).toMatch(/no bed within reach/i);
    // change who they are: another body, another height, same place
    const at = r.people.get('pe-1')!;
    await r.people.change('pe-1', { body: 'elder', heightCm: 148 });
    expect(r.people.get('pe-1')).toMatchObject({ body: 'elder', heightCm: 148, x: at.x, z: at.z });
    const ch = r.people.bodyOf('pe-1')!;
    ch.update(0);
    expect(Math.abs(ch.measure().heightM - 1.48)).toBeLessThan(0.01);
    expect(ch.appearance.body).toBe('elder');
    // the obstacle follows the new, narrower body
    expect(r.people.footprints()[0].box.w).toBeCloseTo(shoulderWidthM('elder', 148), 6);
    r.people.remove('pe-1');
    expect(r.people.count()).toBe(0);
    expect(r.scene.children.filter((c) => c.name.startsWith('person-'))).toHaveLength(0);
    expect(cellValue(r.store.grid(), 3.7, 0.3)).toBe(0);
  });

  it('Become this person: the walker stays where they stood, as an added person, and both positions are kept', async () => {
    const r = rig({ walkerAt: { x: 2.6, z: 0.8 } });
    await r.people.place({ body: 'elder', tone: 3, heightCm: 152 }, { kind: 'stand', at: { x: 2.7, z: 2.2 } });
    await r.people.ready();
    const res = await r.people.become('pe-1');
    expect(res.ok).toBe(true);
    expect(r.walker.swaps).toHaveLength(1);
    const swap = r.walker.swaps[0] as { body: string; heightCm: number; tone: number; at: Vec2 };
    expect(swap).toMatchObject({ body: 'elder', heightCm: 152, tone: 3 });
    expect(swap.at.x).toBeCloseTo(2.7, 2); expect(swap.at.z).toBeCloseTo(2.2, 2);
    expect(r.people.count()).toBe(1);
    const old = r.people.list()[0];
    expect(old).toMatchObject({ body: 'man', heightCm: 175, pose: 'stand' });
    expect(old.x).toBeCloseTo(2.6, 6); expect(old.z).toBeCloseTo(0.8, 6);
    await r.people.ready();
    expect(r.people.bodyOf(old.id)).not.toBeNull();
    // the old walker now blocks the walk like anyone else
    expect(cellValue(r.store.grid(), 2.6, 0.8)).toBeGreaterThan(0);
    expect(cellValue(r.store.grid(), 2.7, 2.2)).toBe(0);
  });

  it('Become on someone seated: the walker stands beside the seat, not inside the sofa', async () => {
    const r = rig();
    const sofa = r.store.all().find((i) => i.id === 'sofa-1')!;
    await r.people.place(woman, { kind: 'host', item: sofa, action: 'sit', approach: { x: 3.55, z: 3.5 } });
    await r.people.ready();
    run(r.people, 1);
    await r.people.become('pe-1');
    const swap = r.walker.swaps[0] as { at: Vec2 };
    expect(cellValue(r.store.gridExcludingTemporary(['people']), swap.at.x, swap.at.z)).toBe(0);
  });
});

describe.skipIf(!have)('people and the furniture around them', () => {
  const settle = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

  it('a bed placed where a person stands moves them aside, and says so', async () => {
    const r = rig();
    await r.people.place({ body: 'man', tone: 2, heightCm: 175 }, { kind: 'stand', at: { x: 2.6, z: 1.6 } });
    await r.people.ready();
    const bed = itemFromCatalog('bed-single', { cx: 2.6, cz: 1.6, w: 0.9, d: 1.9, yawDeg: 0 }, 'virtual');
    r.store.add(bed);
    await settle(450);
    const p = r.people.get('pe-1')!;
    expect(Math.hypot(p.x - 2.6, p.z - 1.6)).toBeGreaterThan(0.2);
    expect(cellValue(r.store.gridExcludingTemporary(['people']), p.x, p.z)).toBe(0);
    expect(r.toasts.join(' ')).toMatch(/stepped aside/);
  });

  it('while furnishing, people do not block placement; after it, anyone caught is moved aside', async () => {
    const r = rig();
    await r.people.place({ body: 'man', tone: 2, heightCm: 175 }, { kind: 'stand', at: { x: 2.6, z: 1.6 } });
    expect(cellValue(r.store.grid(), 2.6, 1.6)).toBeGreaterThan(0);
    r.people.setFurnishing(true);
    expect(cellValue(r.store.grid(), 2.6, 1.6)).toBe(0); // furniture checks ignore added people
    expect(r.people.footprints().length).toBeGreaterThan(0); // they are still there
    r.store.add(itemFromCatalog('bed-single', { cx: 2.6, cz: 1.6, w: 0.9, d: 1.9, yawDeg: 0 }, 'virtual'));
    r.people.setFurnishing(false);
    const p = r.people.get('pe-1')!;
    expect(cellValue(r.store.gridExcludingTemporary(['people']), p.x, p.z)).toBe(0);
    expect(cellValue(r.store.grid(), p.x, p.z)).toBeGreaterThan(0);
  });

  it('a person on a piece that is hidden gets up; on one that is moved, goes with it', async () => {
    const r = rig();
    const sofa = itemFromCatalog('sofa-3', { cx: 1.0, cz: 4.2, w: 1.9, d: 0.9, yawDeg: 180 }, 'virtual');
    r.store.add(sofa);
    const added = r.store.all().find((i) => i.catalogId === 'sofa-3')!;
    await r.people.place(woman, { kind: 'host', item: added, action: 'sit', approach: { x: 1.0, z: 4.2 } });
    await r.people.ready();
    run(r.people, 1);
    const before = r.people.bodyOf('pe-1')!.object.position.clone();
    r.store.update(added.id, { ...added.box, cx: 2.2, cz: 3.0 });
    await settle(450);
    run(r.people, 1);
    const after = r.people.bodyOf('pe-1')!.object.position;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1);
    expect(r.people.get('pe-1')!.pose).toBe('sit');
    expect(hostSignature(r.store.get(added.id)!)).not.toBe('');
    // the piece goes: she gets up where she was
    r.store.remove(added.id);
    await settle(450);
    expect(r.people.get('pe-1')!.pose).toBe('stand');
    expect(r.toasts.join(' ')).toMatch(/got up/);
  });
});

describe.skipIf(!have)('on the second catalogue\'s pieces', () => {
  const settle = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
  function put(r: Rig, catalogId: string, cx: number, cz: number, yawDeg = 0) {
    const spec = catalogItem(catalogId);
    r.store.add(itemFromCatalog(catalogId, { cx, cz, w: spec.footprint.w, d: spec.footprint.d, yawDeg }, 'virtual'));
    return r.store.all().find((i) => i.catalogId === catalogId)!;
  }

  it('sit on a recliner, a bar stool, an office chair and a swing; lie on a diwan, a bunk and the storage beds; a fridge takes nobody', async () => {
    const r = rig();
    const pieces: [string, 'sit' | 'lie'][] = [['recliner', 'sit'], ['bar-stool', 'sit'], ['office-chair', 'sit'], ['swing-2', 'sit'], ['diwan', 'lie'], ['bunk-bed', 'lie'], ['bed-single-storage', 'lie'], ['bed-queen-storage', 'lie']];
    expect(hostActionOf(put(r, 'fridge-1', 3.6, 0.5))).toBeNull();
    for (const [id, action] of pieces) {
      const item = put(r, id, 1.0, 4.5);
      expect(hostActionOf(item)).toBe(action);
      r.store.remove(item.id);
    }
  });

  it('a person on a swing is posed with the swing\'s seat pose, at their own size', async () => {
    const r = rig();
    const sw = put(r, 'swing-2', 1.5, 4.2);
    const first = await r.people.place({ body: 'elder', tone: 2, heightCm: 150 }, { kind: 'host', item: sw, action: 'sit', approach: { x: 1.5, z: 4.2 } });
    expect(first).toMatchObject({ ok: true });
    await r.people.ready();
    run(r.people, 1.2);
    const ch = r.people.bodyOf('pe-1')!;
    expect(ch.state).toBe('sitting');
    const want = hostPose(sw, 'sit', 150, { x: 1.5, z: 4.2 }).sit!;
    expect(want).toEqual(swingSeatPose(sw, 1.5, { x: 1.5, z: 4.2 }));
    // two on a 2-seater, one at each end, and a third finds it full
    expect((await r.people.place({ body: 'child', tone: 2, heightCm: 115 }, { kind: 'host', item: sw, action: 'sit', approach: { x: 1.5, z: 4.2 } })).ok).toBe(true);
    expect(await r.people.place({ body: 'woman', tone: 2, heightCm: 160 }, { kind: 'host', item: sw, action: 'sit', approach: { x: 1.5, z: 4.2 } })).toMatchObject({ ok: false });
  });

  it('they ride a swing as the walker does: the seat rocks and the body goes with it, and the swing rests when they get up', async () => {
    const r = rig();
    const sw = put(r, 'swing-2', 1.5, 4.2);
    const mesh = r.store.mesh(sw.id)!;
    mesh.userData.swingRig = { mode: 'parallel', hookY: 2.7, pivotZ: 0, chainZ: [0.27, -0.25], lengthM: 2.08 };
    for (const n of ['swing-seat', 'swing-chains-front', 'swing-chains-back']) { const o = new THREE.Group(); o.name = n; mesh.add(o); }
    await r.people.place({ body: 'woman', tone: 2, heightCm: 160 }, { kind: 'host', item: sw, action: 'sit', approach: { x: 1.5, z: 4.2 } });
    await r.people.ready();
    run(r.people, 1);
    const ch = r.people.bodyOf('pe-1')!;
    const rest = ch.object.position.clone();
    const seat0 = mesh.getObjectByName('swing-seat')!.position.z;
    run(r.people, 4.2); // about a quarter of the period, with the ease-in
    const seat = mesh.getObjectByName('swing-seat')!;
    expect(Math.abs(seat.position.z - seat0)).toBeGreaterThan(0.02);
    const moved = ch.object.position.clone().sub(rest);
    expect(moved.length()).toBeGreaterThan(0.02);
    // the body keeps up with the seat: it has moved as the seat has, along the swing's front (yaw 0: +z)
    expect(moved.z).toBeCloseTo(seat.position.z - seat0, 2);
    // getting up: the swing is back at rest
    await r.people.setPose('pe-1', 'stand');
    run(r.people, 1.5);
    expect(seat.position.length()).toBeLessThan(1e-9);
    expect(ch.object.position.y).toBeLessThan(0.05);
  });

  it('a person on a piece the viewer moves goes with it; resized, they stay on it; hidden or removed, they get up', async () => {
    const r = rig();
    const bunk = put(r, 'bed-single-storage', 1.0, 4.4, 90);
    await r.people.place(woman, { kind: 'host', item: bunk, action: 'lie', approach: { x: 1.0, z: 4.4 } });
    await r.people.ready();
    run(r.people, 1.5);
    const before = r.people.bodyOf('pe-1')!.object.position.clone();
    r.store.update(bunk.id, { ...bunk.box, cx: 2.6, cz: 4.0 });
    await settle(450);
    run(r.people, 1.5);
    const after = r.people.bodyOf('pe-1')!.object.position;
    expect(after.x - before.x).toBeCloseTo(1.6, 1);
    expect(r.people.get('pe-1')!.pose).toBe('lie');
    // an original of the home, moved and resized in My layout (edit-all's overlay): the person follows
    const sofa = r.store.all().find((i) => i.id === 'sofa-1')!;
    await r.people.place({ body: 'elder', tone: 2, heightCm: 150 }, { kind: 'host', item: sofa, action: 'sit', approach: { x: 3.55, z: 3.5 } });
    await r.people.ready();
    run(r.people, 1.2);
    const at = r.people.bodyOf('pe-2')!.object.position.clone();
    r.store.editOriginal('sofa-1', { cz: sofa.box.cz - 0.6 });
    await settle(450);
    run(r.people, 1.2);
    expect(Math.abs(r.people.bodyOf('pe-2')!.object.position.z - at.z)).toBeGreaterThan(0.4);
    expect(r.people.get('pe-2')!.pose).toBe('sit');
    // hidden in the layout: she gets up
    r.store.hideOriginal('sofa-1');
    await settle(450);
    expect(r.people.get('pe-2')!.pose).toBe('stand');
  });

  it('people are not zones: clearance readings are made in Furnish, where added people are not counted', async () => {
    const r = rig();
    await r.people.place(woman, { kind: 'stand', at: { x: 2.6, z: 1.6 } });
    expect(cellValue(r.store.grid(), 2.6, 1.6)).toBeGreaterThan(0);
    r.people.setFurnishing(true); // what Furnish does on entering
    expect(cellValue(r.store.grid(), 2.6, 1.6)).toBe(0);
  });
});

describe.skipIf(!have)('in My layout', () => {
  it('people are kept per home, listed in the layout, counted as an edit, and cleared by Reset', async () => {
    const r = rig();
    await r.people.place(woman, { kind: 'stand', at: { x: 2.6, z: 1.6 } });
    await r.people.place({ body: 'child', tone: 0, heightCm: 110 }, { kind: 'stand', at: { x: 3.2, z: 1.6 } });
    await r.people.ready();
    expect(r.store.isEdited()).toBe(true);
    expect(r.store.layout().people).toHaveLength(2);
    r.people.dispose(); // flushes the save
    rigs.pop();
    expect(stored(r.storage)).toHaveLength(2);
    // a new visit with the same storage: both are back, standing where they were
    const again = rig({ seed: Object.fromEntries(r.storage.data) });
    await again.people.ready();
    expect(again.people.count()).toBe(2);
    expect(again.people.list()[0]).toMatchObject({ body: 'woman', heightCm: 160 });
    expect(cellValue(again.store.grid(), 2.6, 1.6)).toBeGreaterThan(0);
    again.store.reset();
    expect(again.people.count()).toBe(0);
    expect(again.scene.children.filter((c) => c.name.startsWith('person-'))).toHaveLength(0);
    expect(again.store.isEdited()).toBe(false);
    expect(stored(again.storage)).toHaveLength(0);
    expect(again.storage.data.has(mineKey('t'))).toBe(false); // nothing left behind
  });

  it('a shared link brings its people, replacing the ones in this browser', async () => {
    const linked: PersonRec[] = [{ id: 'x', body: 'man', tone: 2, heightCm: 180, x: 1.5, z: 1.0, yawDeg: 0, pose: 'stand' }];
    const r = rig({ linked, seed: { [mineKey('t')]: serializeMine([], {}, {}, emptyFittings(), [{ id: 'a', body: 'child', tone: 2, heightCm: 110, x: 3, z: 3, yawDeg: 0, pose: 'stand' }, { id: 'b', body: 'child', tone: 2, heightCm: 110, x: 3, z: 2, yawDeg: 0, pose: 'stand' }])! } });
    await r.people.ready();
    expect(r.people.list().map((p) => p.body)).toEqual(['man']);
  });

  it('on a smaller device only the first people are drawn and only they block; the rest stay in the layout', async () => {
    const linked: PersonRec[] = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, body: 'child' as const, tone: 2, heightCm: 110, x: 0.8 + i * 0.7, z: 0.6, yawDeg: 0, pose: 'stand' as const }));
    const r = rig({ linked, tier: 'low' });
    await r.people.ready();
    expect(r.people.count()).toBe(5);
    expect(r.people.shown()).toBe(2);
    expect(r.people.objects()).toHaveLength(2);
    expect(r.store.layout().people).toHaveLength(5);
    expect(cellValue(r.store.grid(), 0.8, 0.6)).toBeGreaterThan(0);
    expect(cellValue(r.store.grid(), 0.8 + 4 * 0.7, 0.6)).toBe(0); // not drawn, so not in the way
    // a bigger tier later: the others come in
    r.tier.v = 'high';
    run(r.people, 1.2);
    await r.people.ready();
    expect(r.people.objects()).toHaveLength(5);
    expect(cellValue(r.store.grid(), 0.8 + 4 * 0.7, 0.6)).toBeGreaterThan(0);
  });
});

describe.skipIf(!have)('how they behave', () => {
  it('a standing person shifts their weight now and then, without moving their place in the layout', async () => {
    const r = rig({ random: () => 0.5 });
    await r.people.place(woman, { kind: 'stand', at: { x: 2.6, z: 2.4 } });
    await r.people.ready();
    const yaw0 = r.people.bodyOf('pe-1')!.yawDeg;
    const rec0 = r.people.get('pe-1')!;
    run(r.people, 40);
    expect(Math.abs(r.people.bodyOf('pe-1')!.yawDeg - yaw0)).toBeGreaterThan(15);
    expect(r.people.get('pe-1')).toEqual(rec0);
  });

  it('Follow me: a companion walks to the walker at their own pace, the elder slower than the man', async () => {
    const dist = async (body: 'man' | 'elder'): Promise<number> => {
      const r = rig({ walkerAt: { x: 2.6, z: 0.8 } });
      await r.people.place({ body, tone: 2, heightCm: body === 'man' ? 175 : 150 }, { kind: 'stand', at: { x: 2.6, z: 4.2 } });
      await r.people.ready();
      r.people.setFollow('pe-1', true);
      run(r.people, 2);
      const p = r.people.bodyOf('pe-1')!.position;
      return 4.2 - p.z;
    };
    const man = await dist('man');
    const elder = await dist('elder');
    expect(man).toBeGreaterThan(1.5);
    expect(elder).toBeGreaterThan(0.5);
    expect(elder).toBeLessThan(man * 0.85);
  });

  it('a follower keeps a body\'s distance from the walker, and is stamped on the walk grid where they are', async () => {
    const r = rig({ walkerAt: { x: 2.6, z: 0.8 } });
    await r.people.place({ body: 'man', tone: 2, heightCm: 175 }, { kind: 'stand', at: { x: 2.6, z: 3.0 } });
    await r.people.ready();
    r.people.setFollow('pe-1', true);
    run(r.people, 8);
    const p = r.people.bodyOf('pe-1')!.position;
    expect(Math.hypot(p.x - 2.6, p.z - 0.8)).toBeGreaterThan(0.6);
    expect(Math.hypot(p.x - 2.6, p.z - 0.8)).toBeLessThan(1.7);
    const g = r.people.walkGrid(r.store.grid());
    expect(cellValue(g, p.x, p.z)).toBeGreaterThan(0);
    // standing again, they stay where they are
    r.people.setFollow('pe-1', false);
    const rec = r.people.get('pe-1')!;
    expect(rec.x).toBeCloseTo(p.x, 6); expect(rec.z).toBeCloseTo(p.z, 6);
    expect(r.people.walkGrid(r.store.grid())).toBe(r.store.grid());
  });

  it('draws and updates less of what the camera cannot see', async () => {
    const r = rig();
    await r.people.place(woman, { kind: 'stand', at: { x: 2.6, z: 2.4 } }); // in front of the camera
    await r.people.place({ body: 'child', tone: 1, heightCm: 110 }, { kind: 'stand', at: { x: 2.0, z: -0.0 } }); // behind it
    await r.people.ready();
    run(r.people, 1);
    expect(r.people.bodyOf('pe-1')!.object.visible).toBe(true);
    expect(r.people.bodyOf('pe-2')!.object.visible).toBe(false);
    const s0 = r.people.stats();
    run(r.people, 2);
    const s1 = r.people.stats();
    const frames = s1.frames - s0.frames;
    // the visible one every frame, the hidden one four times a second
    expect(s1.updated - s0.updated).toBeLessThan(frames * 1.3);
    expect(s1.updated - s0.updated).toBeGreaterThanOrEqual(frames);
  });

  it('the AI photo is taken without people', async () => {
    const r = rig();
    await r.people.place(woman, { kind: 'stand', at: { x: 2.6, z: 2.4 } });
    await r.people.ready();
    run(r.people, 0.5);
    r.people.setSuppressed(true);
    expect(r.people.bodyOf('pe-1')!.object.visible).toBe(false);
    r.people.setSuppressed(false);
    expect(r.people.bodyOf('pe-1')!.object.visible).toBe(true);
  });
});

describe.skipIf(!have)('a narrow place', () => {
  it('shows whether two people can pass when the walker comes up to a person in a passage', async () => {
    const cards: (string | null)[] = [];
    const tier: PersonTier = 'high';
    const storage = fakeStorage();
    const store = createFurnitureStore({ sceneId: 't', baseGrid, initial: [], parent: new THREE.Group(), storage, saveDelayMs: 0 });
    // the passage strip of the test flat is 1.2 m wide: narrow it with a counter 40 cm deep so it is 80 cm
    store.add({ id: 'strip', source: 'virtual', kind: 'counter', label: 'Strip', box: { cx: 2, cz: 5.12 + 0.2, w: 3.8, d: 0.4, yawDeg: 0 }, heightM: 0.9, surfaceHeightM: 0.9 });
    const walker = { at: { x: 1.0, z: 5.9 } as Vec2 };
    const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 50);
    camera.position.set(0.5, 1.6, 5.9); camera.lookAt(3, 1, 5.9); camera.updateMatrixWorld(true);
    const people = createPeople({
      scene: new THREE.Group(), camera, store, seats: buildSeats(null, []), sceneId: 't', storage, tier: () => tier, toast: () => {}, load, random: () => 0.5,
      walker: { position: () => walker.at, yawDeg: () => 90, heightCm: () => 175, body: () => ({ body: 'man', tone: 2 }), poseOn: () => null, state: () => 'idle', getUp: async () => {}, swapTo: async () => {} },
      passCard: (c) => cards.push(c ? `${c.headline} | ${c.lines[0]}` : null),
    });
    rigs.push({ people } as unknown as Rig);
    const res = await people.place({ body: 'woman', tone: 1, heightCm: 160 }, { kind: 'stand', at: { x: 2.2, z: 5.92 } });
    expect(res.ok).toBe(true);
    await people.ready();
    run(people, 0.5);
    expect(cards).toEqual([]); // far away: nothing to say
    walker.at = { x: 1.5, z: 5.9 };
    run(people, 0.5);
    expect(cards.filter((c) => c !== null)).toHaveLength(1);
    expect(cards[0]).toMatch(/^(Tight|Two people)/);
    expect(cards[0]).toMatch(/Passage 8\d cm wide/);
    // standing there does not bring it up again; leaving and coming back does
    run(people, 1);
    expect(cards.filter((c) => c !== null)).toHaveLength(1);
    walker.at = { x: 0.3, z: 5.9 };
    run(people, 0.5);
    walker.at = { x: 1.5, z: 5.9 };
    run(people, 0.5);
    expect(cards.filter((c) => c !== null)).toHaveLength(2);
  });
});
