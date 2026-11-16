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
