// Owned by C1. SPEC 5: the clean shell (floors, walls, ceilings, frames, panes). three only; runs under Node.
import * as THREE from 'three';
import type { EdgeFrame, Layout, RoomTag, Vec2 } from '../types';
import { computeEdgeFrames, computeTunnels, computeWallPieces, pieceRect } from '../core/layout-geom';

// ---------------------------------------------------------------- small geometry builder

interface Buf { pos: number[]; nor: number[]; uv: number[] }
type V3 = [number, number, number];

const newBuf = (): Buf => ({ pos: [], nor: [], uv: [] });

/** A quad v0..v3 (a loop). Wound so its front faces along `n`. */
function addQuad(b: Buf, v: [V3, V3, V3, V3], n: V3, uv?: [number, number][]): void {
  const e1: V3 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
  const e2: V3 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
  const g: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const flip = g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0;
  const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
  for (const k of order) {
    b.pos.push(...v[k]);
    b.nor.push(...n);
    const t = uv ? uv[k] : [v[k][0] + v[k][2], v[k][1]];
    b.uv.push(t[0], t[1]);
  }
}

/** Box over a plan rectangle (4 corners in loop order) from y0 to y1. */
function addBox(b: Buf, c: [Vec2, Vec2, Vec2, Vec2], y0: number, y1: number): void {
  const at = (p: Vec2, y: number): V3 => [p.x, y, p.z];
  addQuad(b, [at(c[0], y1), at(c[1], y1), at(c[2], y1), at(c[3], y1)], [0, 1, 0]);
  addQuad(b, [at(c[0], y0), at(c[1], y0), at(c[2], y0), at(c[3], y0)], [0, -1, 0]);
  const cx = (c[0].x + c[1].x + c[2].x + c[3].x) / 4;
  const cz = (c[0].z + c[1].z + c[2].z + c[3].z) / 4;
  for (let i = 0; i < 4; i++) {
    const p = c[i];
    const q = c[(i + 1) % 4];
    let nx = q.z - p.z;
    let nz = -(q.x - p.x);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    if (nx * ((p.x + q.x) / 2 - cx) + nz * ((p.z + q.z) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
    addQuad(b, [at(p, y0), at(q, y0), at(q, y1), at(p, y1)], [nx, 0, nz]);
  }
}

function toGeometry(b: Buf): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  return g;
}

/** local (u along the edge, o outward) to plan */
function planPt(f: EdgeFrame, u: number, o: number): Vec2 {
  return { x: f.a.x + f.dir.x * u + f.out.x * o, z: f.a.z + f.dir.z * u + f.out.z * o };
}

function localRect(f: EdgeFrame, u0: number, u1: number, o0: number, o1: number): [Vec2, Vec2, Vec2, Vec2] {
  return [planPt(f, u0, o0), planPt(f, u1, o0), planPt(f, u1, o1), planPt(f, u0, o1)];
}

// ---------------------------------------------------------------- materials

const hasDom = (): boolean => typeof document !== 'undefined';

function makeTileTexture(floorColor: string, groutColor: string): THREE.Texture | null {
  if (!hasDom()) return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = floorColor;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = groutColor;
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- build

function polygonFace(room: RoomTag, y: number, up: boolean, uvOf: (p: Vec2) => [number, number]): Buf {
  const b = newBuf();
  const contour = room.polygon.map((p) => new THREE.Vector2(p.x, p.z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const n: V3 = up ? [0, 1, 0] : [0, -1, 0];
  for (const t of tris) {
    const p = t.map((i) => room.polygon[i]);
    addQuadTri(b, p, y, n, uvOf);
  }
  return b;
}

function addQuadTri(b: Buf, p: Vec2[], y: number, n: V3, uvOf: (p: Vec2) => [number, number]): void {
  const v = p.map((q): V3 => [q.x, y, q.z]);
  const cy = (v[1][2] - v[0][2]) * (v[2][0] - v[0][0]) - (v[1][0] - v[0][0]) * (v[2][2] - v[0][2]);
  // y-component of (B-A) x (C-A) is (Bz-Az)(Cx-Ax) - (Bx-Ax)(Cz-Az)
  const order = cy * n[1] >= 0 ? [0, 1, 2] : [0, 2, 1];
  for (const k of order) {
    b.pos.push(...v[k]);
    b.nor.push(...n);
    const t = uvOf(p[k]);
    b.uv.push(t[0], t[1]);
  }
}

export function buildShell(layout: Layout): THREE.Group {
  const group = new THREE.Group();
  group.name = 'shell';
  const fin = layout.finishes;
  const frames = computeEdgeFrames(layout);
  const frameOf = new Map<string, EdgeFrame>();
  for (const f of frames) frameOf.set(`${f.roomId}:${f.edge}`, f);
  const tunnels = computeTunnels(layout);
  const pieces = computeWallPieces(layout);

  const uvOf = (p: Vec2): [number, number] => (fin.tile ? [p.x / fin.tile.wM, p.z / fin.tile.lM] : [p.x, p.z]);
  const textures = new Map<string, THREE.Texture | null>();
  const floorMats = new Map<string, THREE.MeshStandardMaterial>();
  const floorMat = (room: RoomTag): THREE.MeshStandardMaterial => {
    const color = room.floorColor ?? fin.floorColor;
    let m = floorMats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
      if (fin.tile) {
        if (!textures.has(color)) textures.set(color, makeTileTexture(color, fin.groutColor));
        const tex = textures.get(color);
        if (tex) {
          m.map = tex;
          m.color.set('#ffffff');
        }
      }
      floorMats.set(color, m);
    }
    return m;
  };

  for (const room of layout.rooms) {
    if (room.polygon.length < 3) continue;
    const floor = new THREE.Mesh(toGeometry(polygonFace(room, 0, true, uvOf)), floorMat(room));
    floor.name = `floor:${room.id}`;
    floor.userData.roomId = room.id;
    group.add(floor);

    if (room.roomType !== 'balcony') {
      const ceil = new THREE.Mesh(
        toGeometry(polygonFace(room, layout.wallHeightM, false, uvOf)),
        new THREE.MeshStandardMaterial({ color: fin.ceilingColor, roughness: 0.95 }),
      );
      ceil.name = `ceiling:${room.id}`;
      ceil.userData.roomId = room.id;
      group.add(ceil);
    }
  }

  // thresholds: the floor under every passable hole
  tunnels.forEach((t, n) => {
    if (!t.passable || t.depth < 0.005) return;
    const f = frameOf.get(`${t.roomId}:${t.edge}`);
    const room = layout.rooms.find((r) => r.id === t.roomId);
    if (!f || !room) return;
    const b = newBuf();
    const c = localRect(f, t.u0, t.u1, 0, t.depth);
    addQuad(b, [[c[0].x, 0, c[0].z], [c[1].x, 0, c[1].z], [c[2].x, 0, c[2].z], [c[3].x, 0, c[3].z]], [0, 1, 0],
      c.map((p) => uvOf(p)));
    const mesh = new THREE.Mesh(toGeometry(b), floorMat(room));
    mesh.name = `threshold:${n}`;
    mesh.userData.roomId = t.roomId;
    group.add(mesh);
  });

  // walls per room, railings together
  const wallBufs = new Map<string, Buf>();
  const rail = newBuf();
  for (const p of pieces) {
    const f = frameOf.get(`${p.roomId}:${p.edge}`);
    if (!f) continue;
    if (p.kind === 'railing') {
      addBox(rail, pieceRect(f, p), p.y0, p.y1);
    } else {
      let b = wallBufs.get(p.roomId);
      if (!b) { b = newBuf(); wallBufs.set(p.roomId, b); }
      addBox(b, pieceRect(f, p), p.y0, p.y1);
    }
  }
  for (const room of layout.rooms) {
    const b = wallBufs.get(room.id);
    if (!b || b.pos.length === 0) continue;
    const m = new THREE.Mesh(
      toGeometry(b),
      new THREE.MeshStandardMaterial({ color: room.wallColor ?? fin.wallColor, roughness: 0.9 }),
    );
    m.name = `walls:${room.id}`;
    m.userData.roomId = room.id;
    group.add(m);
  }
  if (rail.pos.length > 0) {
    const m = new THREE.Mesh(toGeometry(rail), new THREE.MeshStandardMaterial({ color: fin.railingColor, roughness: 0.6 }));
    m.name = 'railings';
    group.add(m);
  }

  // door frames (linings inside the hole, 0.02 proud on the room side) and window panes
  const fr = newBuf();
  const pane = newBuf();
  for (const t of tunnels) {
    if (t.openingId === null) continue;
    const f = frameOf.get(`${t.roomId}:${t.edge}`);
    if (!f) continue;
    if (t.type === 'door') {
      const w = Math.min(0.05, (t.u1 - t.u0) / 2);
      const o0 = -0.02;
      const o1 = Math.max(t.depth, 0.02);
      addBox(fr, localRect(f, t.u0, t.u0 + w, o0, o1), 0, t.headM);
      addBox(fr, localRect(f, t.u1 - w, t.u1, o0, o1), 0, t.headM);
      addBox(fr, localRect(f, t.u0, t.u1, o0, o1), Math.max(0, t.headM - 0.05), t.headM);
    } else if (t.type === 'window') {
      const c = localRect(f, t.u0, t.u1, t.depth / 2, t.depth / 2);
      const n: V3 = [-f.out.x, 0, -f.out.z];
      addQuad(pane, [[c[0].x, t.sillM, c[0].z], [c[1].x, t.sillM, c[1].z], [c[1].x, t.headM, c[1].z], [c[0].x, t.headM, c[0].z]], n);
    }
  }
  if (fr.pos.length > 0) {
    const m = new THREE.Mesh(toGeometry(fr), new THREE.MeshStandardMaterial({ color: fin.frameColor, roughness: 0.7 }));
    m.name = 'frames';
    group.add(m);
  }
  if (pane.pos.length > 0) {
    const m = new THREE.Mesh(toGeometry(pane), new THREE.MeshBasicMaterial({ color: '#CFE8FF', side: THREE.DoubleSide }));
    m.name = 'panes';
    group.add(m);
  }
  return group;
}

// ---------------------------------------------------------------- dispose, stats

export function disposeShell(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      std.map?.dispose();
      mat.dispose();
    }
  });
}

function triangleAreaSum(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position');
  if (!pos) return 0;
  const idx = g.getIndex();
  const count = idx ? idx.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let s = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const [i0, i1, i2] = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    s += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return s;
}

/**
 * floorAreaM2: summed triangle area of each `floor:<roomId>` child (thresholds are not counted).
 * wallFaceAreaM2: summed triangle area of the `walls:<roomId>` children (all faces of the merged boxes; railings excluded).
 * // SPEC-GAP: 5 does not define "wall face area"; this is the simplest sum that a test can predict.
 */
export function shellStats(group: THREE.Group): { floorAreaM2: Record<string, number>; wallFaceAreaM2: number } {
  const floorAreaM2: Record<string, number> = {};
  let wallFaceAreaM2 = 0;
  for (const ch of group.children) {
    const m = ch as THREE.Mesh;
    if (!m.isMesh) continue;
    if (ch.name.startsWith('floor:')) {
      const id = ch.name.slice('floor:'.length);
      floorAreaM2[id] = (floorAreaM2[id] ?? 0) + triangleAreaSum(m.geometry);
    } else if (ch.name.startsWith('walls:')) {
      wallFaceAreaM2 += triangleAreaSum(m.geometry);
    }
  }
  return { floorAreaM2, wallFaceAreaM2 };
}
