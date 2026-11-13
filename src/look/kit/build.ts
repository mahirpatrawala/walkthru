// Owned by C11 look-kit. Turns a KitPlan (rules.ts) into low-poly three meshes: one merged mesh per material, so the whole kit is about a
// dozen draw calls. Everything is decor: the meshes are not under the shell or the furniture root, cannot be hit by a ray, and nothing
// reads their size. World coordinates (the layout's frame), no transforms.
import * as THREE from 'three';
import type { EdgeFrame, Layout, Vec2 } from '../../types';
import { computeEdgeFrames } from '../../core/layout-geom';
import type { BoardSite, CoveSite, FanSite, KitPlan, SkirtingRun, TubeSite, WindowSite } from './rules';
import { PLATE_H_M, PLATE_W_M, SKIRTING_H_M, SKIRTING_T_M } from './rules';
import type { WallPiece } from '../../types';

type V3 = [number, number, number];

/** A bucket of triangles that share one material. */
export class Acc {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  get empty(): boolean { return this.pos.length === 0; }
  get triangles(): number { return this.pos.length / 9; }

  /** A quad (loop v0..v3), wound so its front faces along n. uv defaults to a planar (x + z, y) map. */
  quad(v: [V3, V3, V3, V3], n: V3, uv?: [number, number][]): void {
    const e1: V3 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
    const e2: V3 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    const g = e1[1] * e2[2] - e1[2] * e2[1], h = e1[2] * e2[0] - e1[0] * e2[2], k = e1[0] * e2[1] - e1[1] * e2[0];
    const flip = g * n[0] + h * n[1] + k * n[2] < 0;
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const i of order) {
      this.pos.push(...v[i]);
      this.nor.push(...n);
      const t = uv ? uv[i] : [v[i][0] + v[i][2], v[i][1]];
      this.uv.push(t[0], t[1]);
    }
  }

  /** A box from a centre, three orthonormal axes and half sizes. */
  box(c: V3, ax: V3, ay: V3, az: V3, hx: number, hy: number, hz: number): void {
    const axes: [V3, number][] = [[ax, hx], [ay, hy], [az, hz]];
    for (let i = 0; i < 3; i++) {
      const [a, ha] = axes[i];
      const [b, hb] = axes[(i + 1) % 3];
      const [d, hd] = axes[(i + 2) % 3];
      for (const s of [1, -1]) {
        const n: V3 = [a[0] * s, a[1] * s, a[2] * s];
        const o: V3 = [c[0] + n[0] * ha, c[1] + n[1] * ha, c[2] + n[2] * ha];
        const p = (sb: number, sd: number): V3 => [o[0] + b[0] * hb * sb + d[0] * hd * sd, o[1] + b[1] * hb * sb + d[1] * hd * sd, o[2] + b[2] * hb * sb + d[2] * hd * sd];
        this.quad([p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)], n);
      }
    }
  }

  /** An upright cylinder (axis y) from y0 to y1 with caps. */
  cylY(cx: number, cz: number, y0: number, y1: number, r: number, sides = 12, caps: { top?: boolean; bottom?: boolean } = { top: true, bottom: true }): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const p0: [number, number] = [Math.cos(a0), Math.sin(a0)], p1: [number, number] = [Math.cos(a1), Math.sin(a1)];
      const am = (a0 + a1) / 2;
      this.quad([[cx + p0[0] * r, y0, cz + p0[1] * r], [cx + p1[0] * r, y0, cz + p1[1] * r], [cx + p1[0] * r, y1, cz + p1[1] * r], [cx + p0[0] * r, y1, cz + p0[1] * r]], [Math.cos(am), 0, Math.sin(am)]);
      if (caps.top) this.tri([cx, y1, cz], [cx + p0[0] * r, y1, cz + p0[1] * r], [cx + p1[0] * r, y1, cz + p1[1] * r], [0, 1, 0]);
      if (caps.bottom) this.tri([cx, y0, cz], [cx + p0[0] * r, y0, cz + p0[1] * r], [cx + p1[0] * r, y0, cz + p1[1] * r], [0, -1, 0]);
    }
  }

  /** A cylinder whose axis is the horizontal direction `dir` (a socket face, a screw head), from o0 to o1 along it. */
  cylAxis(c: V3, dir: V3, o0: number, o1: number, r: number, sides = 10): void {
    const up: V3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const b: V3 = norm(cross(dir, up));
    const d: V3 = cross(dir, b);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const ring = (a: number, o: number): V3 => [c[0] + dir[0] * o + (b[0] * Math.cos(a) + d[0] * Math.sin(a)) * r, c[1] + dir[1] * o + (b[1] * Math.cos(a) + d[1] * Math.sin(a)) * r, c[2] + dir[2] * o + (b[2] * Math.cos(a) + d[2] * Math.sin(a)) * r];
      const am = (a0 + a1) / 2;
      const n: V3 = [b[0] * Math.cos(am) + d[0] * Math.sin(am), b[1] * Math.cos(am) + d[1] * Math.sin(am), b[2] * Math.cos(am) + d[2] * Math.sin(am)];
      this.quad([ring(a0, o0), ring(a1, o0), ring(a1, o1), ring(a0, o1)], n);
      this.tri([c[0] + dir[0] * o1, c[1] + dir[1] * o1, c[2] + dir[2] * o1], ring(a0, o1), ring(a1, o1), dir);
    }
  }

  tri(a: V3, b: V3, c: V3, n: V3): void {
    const g = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const h = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const k = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const vs = g * n[0] + h * n[1] + k * n[2] >= 0 ? [a, b, c] : [a, c, b];
    for (const v of vs) { this.pos.push(...v); this.nor.push(...n); this.uv.push(v[0] + v[2], v[1]); }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const UP: V3 = [0, 1, 0];

/** A wall edge as a local frame: u along the wall, o out of the room through the wall (so the room is at o < 0), y up. */
class Wall {
  readonly dir: V3;
  readonly out: V3;
  constructor(readonly f: EdgeFrame) {
    this.dir = [f.dir.x, 0, f.dir.z];
    this.out = [f.out.x, 0, f.out.z];
  }
  pt(u: number, o: number, y: number): V3 { return [this.f.a.x + this.dir[0] * u + this.out[0] * o, y, this.f.a.z + this.dir[2] * u + this.out[2] * o]; }
  /** a box from u0..u1, o0..o1, y0..y1 in the wall's frame */
  box(acc: Acc, u0: number, u1: number, o0: number, o1: number, y0: number, y1: number): void {
    acc.box(this.pt((u0 + u1) / 2, (o0 + o1) / 2, (y0 + y1) / 2), this.dir, UP, this.out, Math.abs(u1 - u0) / 2, Math.abs(y1 - y0) / 2, Math.abs(o1 - o0) / 2);
  }
}

export interface KitBuckets {
  skirting: Acc;
  grill: Acc; meshFrame: Acc; meshVeil: Acc;
  railing: Acc;
  tubeBody: Acc; tubeLens: Acc;
  plate: Acc; bezel: Acc; rocker: Acc; socket: Acc;
  fanStatic: Acc; fanLight: Acc;
  cove: Acc; coveLed: Acc;
}
export const newBuckets = (): KitBuckets => ({
  skirting: new Acc(), grill: new Acc(), meshFrame: new Acc(), meshVeil: new Acc(), railing: new Acc(), tubeBody: new Acc(), tubeLens: new Acc(),
  plate: new Acc(), bezel: new Acc(), rocker: new Acc(), socket: new Acc(), fanStatic: new Acc(), fanLight: new Acc(), cove: new Acc(), coveLed: new Acc(),
});

const wallsOf = (layout: Layout): Map<string, Wall> => new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, new Wall(f)]));

// ---------------------------------------------------------------- pieces

export function addSkirting(b: KitBuckets, walls: Map<string, Wall>, runs: SkirtingRun[]): void {
  for (const r of runs) {
    const w = walls.get(`${r.roomId}:${r.edge}`);
    if (w) w.box(b.skirting, r.u0, r.u1, -SKIRTING_T_M, 0, 0, SKIRTING_H_M);
  }
}

/** MS grill: a flat frame, round-ish square bars every ~11 cm, one or two cross bars. Sits just behind the mesh shutter, inside the hole. */
export function addWindow(b: KitBuckets, walls: Map<string, Wall>, s: WindowSite): void {
  const w = walls.get(`${s.roomId}:${s.edge}`);
  if (!w) return;
  const d = Math.max(0.04, s.depthM);
  const k = Math.min(1, d / 0.12);
  const u0 = s.u0, u1 = s.u1, y0 = s.sillM, y1 = s.headM;
  // mosquito-mesh shutter: aluminium frame flush with the room face, a middle stile, and a fine mesh veil
  const fo0 = 0, fo1 = 0.028 * k, fw = 0.03;
  w.box(b.meshFrame, u0, u1, fo0, fo1, y0, y0 + fw);
  w.box(b.meshFrame, u0, u1, fo0, fo1, y1 - fw, y1);
  w.box(b.meshFrame, u0, u0 + fw, fo0, fo1, y0, y1);
  w.box(b.meshFrame, u1 - fw, u1, fo0, fo1, y0, y1);
  if (u1 - u0 > 0.8) { const m = (u0 + u1) / 2; w.box(b.meshFrame, m - 0.02, m + 0.02, fo0, fo1, y0, y1); }
  const vo = fo0 + 0.012 * k;
  const q = (u: number, y: number): V3 => w.pt(u, vo, y);
  const m = 0.018;
  b.meshVeil.quad([q(u0 + fw, y0 + fw), q(u1 - fw, y0 + fw), q(u1 - fw, y1 - fw), q(u0 + fw, y1 - fw)], [-w.out[0], 0, -w.out[2]],
    [[(u0 + fw) / m, (y0 + fw) / m], [(u1 - fw) / m, (y0 + fw) / m], [(u1 - fw) / m, (y1 - fw) / m], [(u0 + fw) / m, (y1 - fw) / m]]);
  // the grill proper, behind the mesh frame and in front of the glass
  const go0 = fo1 + 0.006 * k, go1 = go0 + 0.014 * k;
  const gy0 = y0 + 0.02, gy1 = y1 - 0.02, gu0 = u0 + 0.02, gu1 = u1 - 0.02;
  const flat = 0.024;
  w.box(b.grill, gu0, gu1, go0, go1, gy0, gy0 + flat);
  w.box(b.grill, gu0, gu1, go0, go1, gy1 - flat, gy1);
  w.box(b.grill, gu0, gu0 + flat, go0, go1, gy0, gy1);
  w.box(b.grill, gu1 - flat, gu1, go0, go1, gy0, gy1);
  const inner0 = gu0 + flat, inner1 = gu1 - flat;
  const n = Math.max(1, Math.round((inner1 - inner0) / 0.11));
  const bar = 0.012;
  for (let i = 1; i < n; i++) {
    const u = inner0 + ((inner1 - inner0) * i) / n;
    w.box(b.grill, u - bar / 2, u + bar / 2, go0 + 0.001, go1 - 0.001, gy0 + flat, gy1 - flat);
  }
  const rails = gy1 - gy0 > 1.15 ? 2 : 1;
  for (let i = 1; i <= rails; i++) {
    const y = gy0 + ((gy1 - gy0) * i) / (rails + 1);
    w.box(b.grill, inner0, inner1, go0, go1, y - 0.008, y + 0.008);
  }
}

/** An MS balcony railing inside the footprint of the shell's solid railing piece: kerb, balusters, top rail. */
export function addRailing(b: KitBuckets, walls: Map<string, Wall>, p: WallPiece): void {
  const w = walls.get(`${p.roomId}:${p.edge}`);
  if (!w) return;
  const t = p.thickness;
  const H = p.y1;
  w.box(b.railing, p.u0, p.u1, 0, t, p.y0, p.y0 + 0.1);
  w.box(b.railing, p.u0, p.u1, 0, t, H - 0.05, H);
  w.box(b.railing, p.u0, p.u1, t * 0.2, t * 0.8, p.y0 + 0.28, p.y0 + 0.31);
  const len = p.u1 - p.u0;
  const n = Math.max(1, Math.round(len / 0.12));
  const bar = Math.min(0.018, t * 0.45);
  for (let i = 0; i <= n; i++) {
    const u = p.u0 + (len * i) / n;
    const uu = Math.min(p.u1 - bar / 2, Math.max(p.u0 + bar / 2, u));
    w.box(b.railing, uu - bar / 2, uu + bar / 2, t / 2 - bar / 2, t / 2 + bar / 2, p.y0 + 0.1, H - 0.05);
  }
}

/** A 4 ft LED batten: a white body on the wall and a diffuser strip along its face (the strip is the part that lights). */
export function addTube(b: KitBuckets, walls: Map<string, Wall>, s: TubeSite): void {
  const w = walls.get(`${s.roomId}:${s.edge}`);
  if (!w) return;
  const h = s.lengthM / 2;
  w.box(b.tubeBody, s.u - h, s.u + h, -0.034, 0, s.y - 0.034, s.y + 0.034);
  w.box(b.tubeLens, s.u - h + 0.025, s.u + h - 0.025, -0.0375, -0.033, s.y - 0.022, s.y + 0.022);
}

/** A modular plate: white plate, four rockers on dark bezels, and a 3-pin socket below. */
export function addBoard(b: KitBuckets, walls: Map<string, Wall>, s: BoardSite): void {
  const w = walls.get(`${s.roomId}:${s.edge}`);
  if (!w) return;
  const hw = PLATE_W_M / 2, hh = PLATE_H_M / 2;
  w.box(b.plate, s.u - hw, s.u + hw, -0.011, 0, s.y - hh, s.y + hh);
  for (const dx of [-0.027, 0.027]) for (const dy of [0.066, 0.012]) {
    w.box(b.bezel, s.u + dx - 0.022, s.u + dx + 0.022, -0.0135, -0.011, s.y + dy - 0.027, s.y + dy + 0.027);
    w.box(b.rocker, s.u + dx - 0.0185, s.u + dx + 0.0185, -0.0185, -0.0135, s.y + dy - 0.0225, s.y + dy + 0.0225);
  }
  const into: V3 = [-w.out[0], 0, -w.out[2]];
  b.bezel.cylAxis(w.pt(s.u, -0.0115, s.y - 0.062), into, 0, 0.003, 0.034, 12);
  b.plate.cylAxis(w.pt(s.u, -0.0145, s.y - 0.062), into, 0, 0.002, 0.029, 12);
  for (const [dx, dy] of [[0, 0.014], [-0.012, -0.008], [0.012, -0.008]] as const) {
    w.box(b.socket, s.u + dx - 0.0025, s.u + dx + 0.0025, -0.0175, -0.0145, s.y - 0.062 + dy - 0.007, s.y - 0.062 + dy + 0.007);
  }
}

// ---------------------------------------------------------------- fan

/** The parts of a fan that do not turn: canopy, down-rod, motor housing and the light cup. Built at a site's x, z. */
export function addFanStatic(b: KitBuckets, s: FanSite): void {
  const H = s.wallHeightM;
  b.fanStatic.cylY(s.x, s.z, H - 0.045, H, 0.06, 14, { bottom: true });
  b.fanStatic.cylY(s.x, s.z, H - 0.17, H - 0.045, 0.011, 8, { top: false, bottom: false });
  b.fanStatic.cylY(s.x, s.z, H - 0.245, H - 0.17, 0.095, 16, { top: true, bottom: true });
  b.fanStatic.cylY(s.x, s.z, H - 0.285, H - 0.245, 0.062, 14, { top: false, bottom: true });
  b.fanLight.quad([[s.x - 0.05, H - 0.2855, s.z - 0.05], [s.x + 0.05, H - 0.2855, s.z - 0.05], [s.x + 0.05, H - 0.2855, s.z + 0.05], [s.x - 0.05, H - 0.2855, s.z + 0.05]], [0, -1, 0]);
}

/** Three blades and a hub, around the origin, at the height of the motor. Instanced once per fan and turned each frame. */
export function fanRotorGeometry(wallHeightM: number, radiusM: number): THREE.BufferGeometry {
  const acc = new Acc();
  const y = wallHeightM - 0.205;
  acc.cylY(0, 0, y - 0.012, y + 0.012, 0.085, 14);
  const r0 = 0.1;
  const pitch = (11 * Math.PI) / 180;
  for (let i = 0; i < 3; i++) {
    const th = (i * Math.PI * 2) / 3;
    const along: V3 = [Math.cos(th), 0, Math.sin(th)];
    const across: V3 = [-Math.sin(th), 0, Math.cos(th)];
    const w: V3 = [across[0] * Math.cos(pitch), Math.sin(pitch), across[2] * Math.cos(pitch)];
    const t: V3 = [-across[0] * Math.sin(pitch), Math.cos(pitch), -across[2] * Math.sin(pitch)];
    const mid = (r0 + radiusM) / 2;
    acc.box([along[0] * mid, y, along[2] * mid], along, t, w, (radiusM - r0) / 2, 0.006, 0.062);
    // a short flat bracket from the hub to the blade
    acc.box([along[0] * 0.14, y + 0.012, along[2] * 0.14], along, UP, across, 0.07, 0.003, 0.02);
  }
  return acc.geometry();
}

// ---------------------------------------------------------------- cove

export function addCove(b: KitBuckets, s: CoveSite): void {
  const H = s.wallHeightM, yLow = H - s.dropM;
  const n = s.outer.length;
  const at = (p: Vec2, y: number): V3 => [p.x, y, p.z];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = s.outer[i], o1 = s.outer[j], i0 = s.inner[i], i1 = s.inner[j];
    b.cove.quad([at(o0, yLow), at(o1, yLow), at(i1, yLow), at(i0, yLow)], [0, -1, 0]);
    // the fascia: from the soffit up to 7 cm short of the ceiling, facing the room
    const dx = i1.x - i0.x, dz = i1.z - i0.z, l = Math.hypot(dx, dz) || 1;
    const nIn: V3 = [-dz / l, 0, dx / l];
    b.cove.quad([at(i0, yLow), at(i1, yLow), at(i1, H - 0.07), at(i0, H - 0.07)], nIn);
    // the LED strip lies on the real ceiling just behind the fascia: seen through the slot, never directly
    const back = (p: Vec2, d: number): V3 => [p.x - nIn[0] * d, H - 0.004, p.z - nIn[2] * d];
    b.coveLed.quad([back(i0, 0.02), back(i1, 0.02), back(i1, 0.07), back(i0, 0.07)], [0, -1, 0]);
  }
}

// ---------------------------------------------------------------- the whole kit

export interface BuiltKit {
  buckets: KitBuckets;
  walls: Map<string, Wall>;
  /** the turning parts: one geometry per blade radius (rounded to 5 cm), instanced for the fans of that radius */
  rotors: { radiusM: number; sites: FanSite[]; geometry: THREE.BufferGeometry }[];
}

export function buildBuckets(layout: Layout, plan: KitPlan): BuiltKit {
  const b = newBuckets();
  const walls = wallsOf(layout);
  addSkirting(b, walls, plan.skirting);
  for (const s of plan.windows) addWindow(b, walls, s);
  for (const p of plan.railings) addRailing(b, walls, p);
  for (const s of plan.tubes) addTube(b, walls, s);
  for (const s of plan.boards) addBoard(b, walls, s);
  for (const s of plan.fans) addFanStatic(b, s);
  for (const s of plan.coves) addCove(b, s);
  const byR = new Map<number, FanSite[]>();
  for (const f of plan.fans) { const r = Math.round(f.radiusM / 0.05) * 0.05; byR.set(r, [...(byR.get(r) ?? []), f]); }
  const rotors = [...byR].map(([radiusM, sites]) => ({ radiusM, sites, geometry: fanRotorGeometry(layout.wallHeightM, radiusM) }));
  return { buckets: b, walls, rotors };
}
