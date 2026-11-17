// What a space leaves behind when it is taken down, as far as it can be seen without a GPU: no listeners, no timers, no elements,
// and every geometry, material and texture of a scene graph disposed. (The page-level check is a headless Chrome run, see SPEC 18.10.)
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disposeTree } from '../src/building/dispose';

class FakeNode { children: FakeNode[] = []; dataset: Record<string, string> = {}; parent: FakeNode | null = null; remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
class FakeTarget { l = new Map<string, Set<unknown>>(); addEventListener(t: string, f: unknown): void { (this.l.get(t) ?? this.l.set(t, new Set()).get(t)!).add(f); } removeEventListener(t: string, f: unknown): void { this.l.get(t)?.delete(f); } count(): number { let n = 0; for (const s of this.l.values()) n += s.size; return n; } }

/** a fresh copy of the module: it captures the page's own functions when it loads */
async function freshGuard(): Promise<typeof import('../src/building/guard')> {
  vi.resetModules();
  return import('../src/building/guard');
}

describe('the guard that takes a space down', () => {
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  let win: FakeTarget & Record<string, unknown>;
  let doc: FakeTarget & { body: FakeNode };
  let timeouts: Set<number>, intervals: Set<number>, nextId: number;

  beforeEach(() => {
    for (const k of ['window', 'document', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame']) saved[k] = g[k];
    timeouts = new Set(); intervals = new Set(); nextId = 1;
    win = Object.assign(new FakeTarget(), {
      setTimeout: (_f: unknown) => { const id = nextId++; timeouts.add(id); return id; }, clearTimeout: (id: number) => { timeouts.delete(id); },
      setInterval: (_f: unknown) => { const id = nextId++; intervals.add(id); return id; }, clearInterval: (id: number) => { intervals.delete(id); },
      requestAnimationFrame: (_f: unknown) => nextId++, cancelAnimationFrame: () => {},
    }) as never;
    const body = new FakeNode();
    doc = Object.assign(new FakeTarget(), { body: Object.assign(body, { children: [] as FakeNode[] }) }) as never;
    (doc as unknown as { body: { children: FakeNode[] } }).body.children = [];
    g.window = win; g.document = doc;
    for (const k of ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame']) g[k] = win[k];
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v; } });

  it('removes the listeners, timers and elements a space added, and keeps what was there before and what is marked kept', async () => {
    const { beginGuard, exempt } = await freshGuard();
    const before = new FakeNode(); doc.body.children.push(before); before.parent = doc.body;
    const guard = beginGuard();
    const h = (): void => {};
    (win as unknown as { addEventListener(t: string, f: () => void): void }).addEventListener('keydown', h);
    (doc as unknown as { addEventListener(t: string, f: () => void): void }).addEventListener('keyup', h);
    const t = (win.setTimeout as (f: () => void, ms: number) => number)(h, 5000); // the page's window, which the guard has patched
    const i = (win.setInterval as (f: () => void, ms: number) => number)(h, 100);
    const mine = new FakeNode(); doc.body.children.push(mine); mine.parent = doc.body;
    const kept = exempt(() => { const n = new FakeNode(); doc.body.children.push(n); n.parent = doc.body; return n; });
    expect(guard.counts()).toEqual({ listeners: 2, timers: 2, nodes: 1 });
    expect(win.count()).toBe(1); expect(doc.count()).toBe(1);
    guard.release();
    expect(win.count()).toBe(0); expect(doc.count()).toBe(0);
    expect(timeouts.has(t)).toBe(false); expect(intervals.has(i)).toBe(false);
    expect(doc.body.children).toEqual([before, kept]);
    expect(kept.dataset.wtKeep).toBe('1');
    guard.release(); // twice is fine
  });

  it('only one space is recorded at a time', async () => {
    const { beginGuard } = await freshGuard();
    const a = beginGuard();
    expect(() => beginGuard()).toThrow(/not released/);
    a.release();
    expect(() => beginGuard().release()).not.toThrow();
  });
});

describe('disposeTree', () => {
  it('disposes every geometry, material and texture under a root once, and takes the root off its parent', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    scene.add(root);
    const tex = new THREE.Texture();
    const shared = new THREE.MeshStandardMaterial({ map: tex });
    const geo = new THREE.BoxGeometry();
    let gd = 0, md = 0, td = 0;
    geo.addEventListener('dispose', () => gd++); shared.addEventListener('dispose', () => md++); tex.addEventListener('dispose', () => td++);
    for (let i = 0; i < 3; i++) root.add(new THREE.Mesh(geo, shared));
    const other = new THREE.Mesh(new THREE.SphereGeometry(), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    root.add(other);
    const c = disposeTree(root);
    expect([gd, md, td]).toEqual([1, 1, 1]);
    expect(c).toEqual({ geometries: 2, materials: 3, textures: 1 });
    expect(scene.children).toEqual([]);
  });
  it('lets go of a skinned mesh skeleton', () => {
    const bone = new THREE.Bone();
    const skeleton = new THREE.Skeleton([bone]);
    let sd = 0;
    const orig = skeleton.dispose.bind(skeleton);
    skeleton.dispose = () => { sd++; orig(); };
    const m = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    m.add(bone); m.bind(skeleton);
    disposeTree(m);
    expect(sd).toBe(1);
  });
});

// SPEC 16.24: the 2K layer owns promoted materials, probes, mirror targets, overlays and a pane glass; switching a space, a level or the level to 1K must give all of it back.
describe('the 2K layer takes itself down', () => {
  const layout = { rooms: [{ id: 'a', polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], roomType: 'living' }], wallHeightM: 2.7 } as never;
  const renderer = { coordinateSystem: THREE.WebGLCoordinateSystem, getRenderTarget: () => null, shadowMap: { autoUpdate: true }, xr: { enabled: false }, clippingPlanes: [] } as unknown as THREE.WebGLRenderer;
  async function setup(): Promise<{ scene: THREE.Scene; layer: import('../src/look/premium/layer').PremiumLayer; steel: THREE.MeshStandardMaterial; panes: THREE.Mesh; basicPane: THREE.Material; mirrorMesh: THREE.Mesh }> {
    const { PremiumLayer } = await import('../src/look/premium/layer');
    const scene = new THREE.Scene();
    const steel = new THREE.MeshStandardMaterial({ color: '#B8B8B8', roughness: 0.35, metalness: 0.8, name: 'metal' });
    const tap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), steel); tap.name = 'tap';
    scene.add(tap);
    const basicPane = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55 }); basicPane.userData.shared = true;
    const panes = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), basicPane); panes.name = 'panes';
    scene.add(panes);
    // one mirror: a quad facing +z at z = 0
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([1, 1, 0, 1.5, 1, 0, 1.5, 1.7, 0, 1, 1, 0, 1.5, 1.7, 0, 1, 1.7, 0], 3));
    const mirrorMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); mirrorMesh.name = 'kit:mirror';
    scene.add(mirrorMesh);
    const layer = new PremiumLayer({ renderer, scene, layout, outdoor: false, hide: () => [] });
    return { scene, layer, steel, panes, basicPane, mirrorMesh };
  }
  it('promotes while on, and demotes, restores the panes and removes every overlay when it is turned off', async () => {
    const { scene, layer, steel, panes, basicPane } = await setup();
    const before = scene.children.length;
    layer.setEnabled(true);
    expect(steel).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(panes.material).not.toBe(basicPane);
    expect((panes.material as THREE.Material).name).toBe('pane-glass');
    expect(layer.stats().mirrors).toBe(1);
    expect(scene.children.length).toBe(before + 1); // the mirror overlay
    const glass = panes.material as THREE.Material;
    let glassDisposed = 0; glass.addEventListener('dispose', () => glassDisposed++);
    layer.setEnabled(false);
    expect(steel).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(steel.type).toBe('MeshStandardMaterial');
    expect(panes.material).toBe(basicPane);
    expect(glassDisposed).toBe(1);
    expect(scene.children.length).toBe(before);
    expect(layer.stats()).toMatchObject({ promoted: 0, mirrors: 0, probes: 0 });
    expect(layer.probeTexture).toBeNull();
  });
  it('frees the mirror target and the overlay material and geometry', async () => {
    const { scene, layer } = await setup();
    layer.setEnabled(true);
    const overlay = scene.children.find((c) => c.name === 'mirror-overlay') as THREE.Mesh;
    expect(overlay).toBeTruthy();
    const mat = overlay.material as THREE.ShaderMaterial;
    const rt = mat.uniforms.tDiffuse.value as THREE.Texture;
    let n = 0;
    overlay.geometry.addEventListener('dispose', () => n++); mat.addEventListener('dispose', () => n++);
    // the render target's texture is freed through its render target
    const target = (layer as unknown as { mirrors: { mirrors: { rt: THREE.WebGLRenderTarget }[] } }).mirrors.mirrors[0].rt;
    expect(target.texture).toBe(rt);
    target.addEventListener('dispose', () => n++);
    layer.dispose();
    expect(n).toBe(3);
    layer.dispose(); // twice is fine
  });
  it('turning it on and off again leaves the materials as they were, however often', async () => {
    const { layer, steel } = await setup();
    const color = steel.color.getHex(), rough = steel.roughness, metal = steel.metalness;
    for (let i = 0; i < 4; i++) { layer.setEnabled(true); layer.rescan(); layer.setEnabled(false); }
    expect(steel.color.getHex()).toBe(color); expect(steel.roughness).toBe(rough); expect(steel.metalness).toBe(metal);
    expect(steel.type).toBe('MeshStandardMaterial');
  });
});
