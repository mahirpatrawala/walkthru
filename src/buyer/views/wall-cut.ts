// The three side of cutting the near walls down (rules in wall-cut-core.ts, pure and tested). Made when the doll house is entered, `release()` puts
// everything back exactly. What it moves:
//   * the shell's own wall meshes (`walls:<room>`): the top vertices of each wall box are lowered in place, so every attribute the look's wall shader
//     reads stays as it was (corner shading, UVs, normals); the height eases over about 250 ms as the camera orbits and a wall turns toward it
//   * the wall caps: one neutral cap on top of every wall box, built from the same footprints, riding the top of its box (this replaces stage.ts's old fixed caps)
//   * what is fixed to a cut wall above the cut: the shell's frames and panes and the kit's grills and meshes are drawn through a shorter index (a copy of the
//     geometry; the original is never touched), the door leaves on that edge and wall-hung decor (a painting, a clock, an air conditioner) are hidden
import * as THREE from 'three';
import { resolveDoors } from '../../core/doors';
import type { Layout } from '../../types';
import { CUT_HEIGHT_M, collapses, cutEdges, cutPieces, cutTop, keepUncutInto, ownerOf, triangleOwners } from './wall-cut-core';
import type { CutPiece } from './wall-cut-core';

export const CAP_COLOUR = '#474C54';
const CAP_LIFT = 0.004;
const VERTS_PER_BOX = 36;
/** meshes whose triangles sit on walls: windows, door frames, grills, the window nets */
const FILTERED = new Set(['frames', 'panes', 'kit:grill', 'kit:mesh-frame', 'kit:mesh']);
/** how fast a wall rises or drops (per second, exponential): about 250 ms to settle */
const RATE = 14;

export interface WallCut {
  /** each frame the doll house is on: `strength` 0..1 (0 = every wall as built), `cam` the horizontal unit direction from the target toward the camera */
  update(dt: number, strength: number, cam: { x: number; z: number }): void;
  release(): void;
  readonly cutCount: number;
  stats(): { pieces: number; wallMeshes: number; filtered: number; hiddenObjects: number; cutEdges: number };
}

interface WallMesh { mesh: THREE.Mesh; pos: THREE.BufferAttribute; orig: Float32Array; pieces: CutPiece[] }
interface Filtered { mesh: THREE.Mesh; orig: THREE.BufferGeometry; tmp: THREE.BufferGeometry; owner: Int32Array; y: Float32Array; src: ArrayLike<number> | null; index: THREE.BufferAttribute }
interface Fixed { obj: THREE.Object3D; was: boolean; key: string }

export function createWallCut(o: { scene: THREE.Scene; shell: THREE.Object3D; layout: Layout; skipEdges?: ReadonlySet<string>; furnitureRoot?: THREE.Object3D | null; renderer?: THREE.WebGLRenderer }): WallCut {
  const { layout } = o;
  const wallH = layout.wallHeightM;
  const cutH = Math.min(CUT_HEIGHT_M, wallH * 0.5);
  const pieces = cutPieces(layout, o.skipEdges);
  const byIndex = pieces;

  // ---- the shell's wall meshes: which 36 vertices belong to which box
  const walls: WallMesh[] = [];
  const pieceLoc = new Map<number, { w: WallMesh; slot: number }>();
  const byRoom = new Map<string, CutPiece[]>();
  for (const p of pieces) { const l = byRoom.get(p.roomId) ?? []; l.push(p); byRoom.set(p.roomId, l); }
  for (const [roomId, list] of byRoom) {
    const mesh = o.shell.getObjectByName(`walls:${roomId}`) as THREE.Mesh | undefined;
    const pos = mesh?.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!mesh || !pos || pos.count !== list.length * VERTS_PER_BOX) continue; // not built the way this expects: that room's walls are left as they are
    const orig = new Float32Array(pos.count);
    for (let v = 0; v < pos.count; v++) orig[v] = pos.getY(v);
    const w: WallMesh = { mesh, pos, orig, pieces: list };
    walls.push(w);
    list.forEach((p, slot) => pieceLoc.set(p.i, { w, slot }));
  }

  // ---- the caps: 6 vertices a piece, riding the top
  const capPos = new Float32Array(byIndex.length * 18);
  const capGeo = new THREE.BufferGeometry();
  const capAttr = new THREE.BufferAttribute(capPos, 3);
  capGeo.setAttribute('position', capAttr);
  const nor = new Float32Array(capPos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  capGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const capMat = new THREE.MeshBasicMaterial({ color: CAP_COLOUR, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const caps = new THREE.Mesh(capGeo, capMat);
  caps.name = 'dollhouse-wall-caps';
  caps.frustumCulled = false;
  caps.raycast = () => {};
  const writeCap = (p: CutPiece, y: number, visible: boolean): void => {
    const q = p.rect;
    const area = (q[1].x - q[0].x) * (q[2].z - q[0].z) - (q[1].z - q[0].z) * (q[2].x - q[0].x);
    const c = area >= 0 ? [q[0], q[2], q[1], q[0], q[3], q[2]] : [q[0], q[1], q[2], q[0], q[2], q[3]];
    let n = p.i * 18;
    for (const v of c) { capPos[n++] = v.x; capPos[n++] = visible ? y + CAP_LIFT : -100; capPos[n++] = v.z; }
  };
  const showCap = (p: CutPiece, a: number): boolean => (a < 0.5 ? p.y1 >= wallH - 1e-6 : !collapses(p.y0, cutH));
  for (const p of pieces) writeCap(p, p.y1, showCap(p, 0));
  capAttr.needsUpdate = true;
  o.scene.add(caps);

  // ---- what is fixed to a wall
  const fixed: Fixed[] = [];
  const doorEdge = new Map(resolveDoors(layout).map((d) => [d.id, `${d.roomId}:${d.edge}`]));
  o.scene.children.forEach((c) => { const id = c.userData?.doorId; if (typeof id === 'string' && doorEdge.has(id)) fixed.push({ obj: c, was: c.visible, key: doorEdge.get(id) as string }); });
  if (o.furnitureRoot) {
    const box = new THREE.Box3();
    const consider = (n: THREE.Object3D): boolean => {
      box.setFromObject(n);
      if (box.isEmpty() || box.min.y < 0.9 || box.max.y - box.min.y > 1.6) return false;
      const i = ownerOf(pieces, (box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2, 0.4);
      if (i < 0) return false;
      fixed.push({ obj: n, was: n.visible, key: pieces[i].key });
      return true;
    };
    for (const a of o.furnitureRoot.children) if (!consider(a)) for (const b of a.children) consider(b);
  }

  // ---- merged meshes with parts on walls: drawn through a shorter index
  const filtered: Filtered[] = [];
  o.scene.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh || !FILTERED.has(m.name)) return;
    const g = m.geometry;
    const pos = g.getAttribute('position');
    if (!pos || pos.count > 400000) return;
    m.updateWorldMatrix(true, false);
    const e = m.matrixWorld.elements;
    if (Math.abs(e[0] - 1) > 1e-6 || Math.abs(e[5] - 1) > 1e-6 || Math.abs(e[10] - 1) > 1e-6 || Math.abs(e[12]) > 1e-6 || Math.abs(e[13]) > 1e-6 || Math.abs(e[14]) > 1e-6) return;
    const idx = g.getIndex();
    const { owner, y } = triangleOwners(pieces, pos.array as ArrayLike<number>, idx ? (idx.array as ArrayLike<number>) : null);
    if (!owner.some((v) => v >= 0)) return;
    // the copy has its own buffers and one index of full length that is rewritten in place (a new index buffer for each change would be left on the GPU)
    const tmp = g.clone();
    const index = new THREE.BufferAttribute(new Uint32Array(owner.length * 3), 1);
    tmp.setIndex(index);
    filtered.push({ mesh: m, orig: g, tmp, owner, y, src: idx ? (idx.array as ArrayLike<number>) : null, index });
  });

  // ---- state
  const amount = new Map<string, number>();
  for (const p of pieces) amount.set(p.key, 0);
  let flagged: Set<string> = new Set();
  let discrete: Set<string> = new Set();
  let released = false;
  let usingTmp = false;

  const writePiece = (p: CutPiece, a: number): void => {
    const loc = pieceLoc.get(p.i);
    if (loc) {
      const top = cutTop(p.y0, p.y1, cutH, a);
      const base = loc.slot * VERTS_PER_BOX;
      for (let k = 0; k < VERTS_PER_BOX; k++) {
        const v = base + k, y = loc.w.orig[v];
        loc.w.pos.setY(v, Math.abs(y - p.y1) < 1e-6 && p.y1 - p.y0 > 1e-6 ? top : y);
      }
      loc.w.pos.needsUpdate = true;
    }
    writeCap(p, cutTop(p.y0, p.y1, cutH, a), showCap(p, a));
  };

  const applyDiscrete = (): void => {
    for (const f of filtered) {
      const n = keepUncutInto(f.owner, f.y, byIndex, discrete, cutH, f.src, f.index.array as Uint32Array);
      f.index.needsUpdate = true;
      f.tmp.setDrawRange(0, n);
      if (discrete.size && !usingTmp) f.mesh.geometry = f.tmp;
    }
    usingTmp = discrete.size > 0;
    if (!usingTmp) for (const f of filtered) f.mesh.geometry = f.orig;
    for (const x of fixed) x.obj.visible = discrete.has(x.key) ? false : x.was;
    if (o.renderer) o.renderer.shadowMap.needsUpdate = true; // a one-shot shadow map (the medium tier) is drawn again
  };

  return {
    update(dt, strength, cam) {
      if (released) return;
      flagged = cutEdges(pieces, cam, flagged);
      const k = 1 - Math.exp(-RATE * Math.max(0, dt));
      const moved = new Set<string>();
      for (const [key, a] of amount) {
        const target = flagged.has(key) ? strength : 0;
        let next = a + (target - a) * k;
        if (Math.abs(target - next) < 0.004) next = target;
        if (next !== a) { amount.set(key, next); moved.add(key); }
      }
      if (moved.size) {
        for (const p of pieces) if (moved.has(p.key)) writePiece(p, amount.get(p.key) as number);
        capAttr.needsUpdate = true;
      }
      const nowCut = new Set<string>();
      for (const [key, a] of amount) if (a > 0.5) nowCut.add(key);
      if (nowCut.size !== discrete.size || [...nowCut].some((x) => !discrete.has(x))) { discrete = nowCut; applyDiscrete(); }
    },
    release() {
      if (released) return;
      released = true;
      for (const w of walls) {
        for (let v = 0; v < w.orig.length; v++) w.pos.setY(v, w.orig[v]);
        w.pos.needsUpdate = true;
      }
      for (const f of filtered) { f.mesh.geometry = f.orig; f.tmp.dispose(); }
      for (const x of fixed) x.obj.visible = x.was;
      o.scene.remove(caps);
      capGeo.dispose(); capMat.dispose();
      if (o.renderer) o.renderer.shadowMap.needsUpdate = true;
    },
    get cutCount() { return discrete.size; },
    stats: () => ({ pieces: pieces.length, wallMeshes: walls.length, filtered: filtered.length, hiddenObjects: fixed.filter((x) => !x.obj.visible).length, cutEdges: discrete.size }),
  };
}
