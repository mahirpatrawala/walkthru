// The three side of "clear the view from above": fades the ceiling slabs, hides what hangs from the ceiling (fans, coves, wall tubes, signboards over
// the doors, anything in the furniture tree that starts near the ceiling) and filters the ceiling triangles out of the look kit's one merged fixtures
// mesh. Everything it touches is recorded and put back exactly by `release()`: a mesh's own visibility, a material's transparency and opacity, a
// mesh's own geometry. What it makes (the filtered geometries) is disposed by `release()`. The rules are in hang.ts (pure, tested).
import * as THREE from 'three';
import { HIDE_FROM_RAW, ceilingBandStart, ceilingOpacity, classifyHang, keepBelow } from './hang';

export interface Hanger {
  /** call every frame the doll house is on, with the flight's raw progress 0..1: fades the ceiling, hides the rest once the flight has begun */
  apply(raw: number): void;
  /** looks again for objects that appeared since (a style change rebuilds the kit); cheap, call about twice a second */
  sweep(): void;
  /** puts everything back */
  release(): void;
  /** what it is holding, for the checks */
  stats(): { faded: number; hidden: number; filtered: number; droppedTriangles: number };
}

interface MatState { transparent: boolean; opacity: number; depthWrite: boolean }

export function createHanger(o: { scene: THREE.Scene; wallH: number; furnitureRoot?: THREE.Object3D | null; renderer?: THREE.WebGLRenderer }): Hanger {
  const slabs: THREE.Mesh[] = [];
  const slabVisible = new Map<THREE.Mesh, boolean>();
  const mats = new Map<THREE.Material, MatState>();
  const hung: { obj: THREE.Object3D; was: boolean }[] = [];
  const filtered: { mesh: THREE.Mesh; orig: THREE.BufferGeometry; tmp: THREE.BufferGeometry; dropped: number }[] = [];
  const seen = new WeakSet<THREE.Object3D>();
  const box = new THREE.Box3();
  let hideOn = false;
  let lastRaw = 0;
  let released = false;

  const take = (obj: THREE.Object3D): void => {
    if (seen.has(obj)) return;
    seen.add(obj);
    const mesh = obj as THREE.Mesh;
    const light = typeof obj.userData?.walkthruLight === 'string' ? (obj.userData.walkthruLight as string) : undefined;
    // the height rule is for the pieces that hang as a whole (a top level group of the furniture tree), not for every part of a wardrobe
    let minY: number | null = null;
    const topLevel = !!o.furnitureRoot && obj.parent === o.furnitureRoot;
    if (topLevel) { box.setFromObject(obj); minY = box.isEmpty() ? null : box.min.y; }
    const verdict = classifyHang({ name: obj.name, light, minY, inFurniture: topLevel }, o.wallH);
    if (verdict === 'fade' && mesh.isMesh) {
      slabs.push(mesh);
      slabVisible.set(mesh, mesh.visible);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!mats.has(m)) mats.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
      }
    } else if (verdict === 'hide') {
      hung.push({ obj, was: obj.visible });
      if (hideOn) obj.visible = false;
    } else if (verdict === 'filter' && mesh.isMesh) {
      const g = mesh.geometry;
      const pos = g.getAttribute('position');
      if (!pos) return;
      mesh.updateWorldMatrix(true, false);
      const e = mesh.matrixWorld.elements;
      // a mesh that is turned or scaled would need its corners moved to world height: the kit's meshes sit at the origin, so skip any that do not
      if (Math.abs(e[0] - 1) > 1e-6 || Math.abs(e[5] - 1) > 1e-6 || Math.abs(e[10] - 1) > 1e-6 || Math.abs(e[1]) > 1e-6 || Math.abs(e[4]) > 1e-6 || Math.abs(e[6]) > 1e-6 || Math.abs(e[9]) > 1e-6) return;
      const idx = g.getIndex();
      const r = keepBelow(pos.array as ArrayLike<number>, idx ? (idx.array as ArrayLike<number>) : null, ceilingBandStart(o.wallH), e[13]);
      if (r.dropped === 0) return;
      // a copy with its own buffers (the original keeps its own: disposing the copy must not take them away), drawn through a shorter index
      const tmp = g.clone();
      tmp.setIndex(new THREE.BufferAttribute(r.index, 1));
      filtered.push({ mesh, orig: g, tmp, dropped: r.dropped });
      if (hideOn) mesh.geometry = tmp;
    }
  };

  const scan = (): void => {
    o.scene.traverse((n) => { if (!seen.has(n)) take(n); });
  };

  function refreshShadows(): void {
    // a one-shot shadow map (the medium tier) is drawn again when the ceiling goes or comes back
    if (o.renderer) o.renderer.shadowMap.needsUpdate = true;
  }

  const setHidden = (on: boolean): void => {
    if (on === hideOn) return;
    hideOn = on;
    for (const h of hung) if (on) { h.obj.visible = false; } else h.obj.visible = h.was;
    for (const f of filtered) f.mesh.geometry = on ? f.tmp : f.orig;
    refreshShadows();
  };

  const setSlabs = (raw: number): void => {
    const a = ceilingOpacity(raw);
    const fading = a < 1;
    for (const [m, st] of mats) {
      const nowTransparent = fading ? true : st.transparent;
      if (m.transparent !== nowTransparent) { m.transparent = nowTransparent; m.needsUpdate = true; }
      m.opacity = fading ? st.opacity * a : st.opacity;
      m.depthWrite = fading ? false : st.depthWrite;
    }
    let changed = false;
    for (const s of slabs) {
      const v = a > 0.003 && (slabVisible.get(s) ?? true);
      if (s.visible !== v) { s.visible = v; changed = true; }
    }
    if (changed) refreshShadows();
  };

  scan();

  return {
    apply(raw) {
      if (released) return;
      lastRaw = raw;
      setSlabs(raw);
      setHidden(raw >= HIDE_FROM_RAW);
    },
    sweep() {
      if (released) return;
      scan();
      // objects found late take the state in force now
      if (hideOn) { for (const h of hung) h.obj.visible = false; for (const f of filtered) if (f.mesh.geometry !== f.tmp) f.mesh.geometry = f.tmp; }
      setSlabs(lastRaw);
    },
    release() {
      if (released) return;
      released = true;
      for (const h of hung) h.obj.visible = h.was;
      for (const f of filtered) { f.mesh.geometry = f.orig; f.tmp.dispose(); }
      for (const [m, st] of mats) {
        const retransparent = m.transparent !== st.transparent;
        m.transparent = st.transparent; m.opacity = st.opacity; m.depthWrite = st.depthWrite;
        if (retransparent) m.needsUpdate = true;
      }
      for (const [s, v] of slabVisible) s.visible = v;
      hung.length = 0; filtered.length = 0; slabs.length = 0; slabVisible.clear(); mats.clear();
      refreshShadows();
    },
    stats() {
      return { faded: slabs.length, hidden: hung.length, filtered: filtered.length, droppedTriangles: filtered.reduce((n, f) => n + f.dropped, 0) };
    },
  };
}
