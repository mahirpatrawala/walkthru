// SPEC 16.13 step 2: lightmap UVs for any mesh, made in code from the dumped geometry (no per-scene work, no Blender unwrap).
// Triangles are grouped into charts (connected, nearly the same normal), each chart is projected flat on its average normal, rotated
// to the tightest rectangle, scaled to a texel density and packed into one square atlas. Pure and deterministic.
import { packSmallest } from './pack';
import type { PackRect } from './pack';

type V3 = [number, number, number];

export interface UnwrapMesh {
  key: string;
  /** world-space positions, x y z per vertex */
  positions: Float32Array;
  normals: Float32Array;
  index?: Uint32Array;
  /** texels per metre for this mesh (the surface tier, 16.13) */
  texelsPerM: number;
  /** how far a triangle's normal may lean from its chart's average, degrees */
  maxLeanDeg: number;
  /** optional per-chart density factor (1 = the mesh's texelsPerM): surfaces nobody can see get a small one */
  densityOf?: (c: { centroid: V3; normal: V3; areaM2: number }) => number;
}

export interface UnwrapResult {
  key: string;
  /** u v per output vertex, 0..1 over the atlas, v counted from the top row of the picture */
  uv: Float32Array;
  /** the output vertex count (>= source vertices when charts shared a vertex) */
  uvCount: number;
  /** vertices appended after the source ones: the source vertex each copies */
  remap?: Uint32Array;
  /** the triangle list over the output vertices (only when `remap` is set) */
  index?: Uint32Array;
  charts: number;
  /** [x, y, w, h] in texels of every chart's rectangle in the atlas, padding included */
  rects: [number, number, number, number][];
}

export interface UnwrapOptions {
  /** texel margin around each chart for the bake's dilation */
  pad: number;
  minSize: number;
  maxSize: number;
}

interface Chart { mesh: number; tris: number[]; n: V3; u: V3; v: V3; minU: number; minV: number; wM: number; hM: number; centroid: V3; areaM2: number; factor: number }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const posKey = (p: Float32Array, i: number): string => `${Math.round(p[i * 3] * 5000)},${Math.round(p[i * 3 + 1] * 5000)},${Math.round(p[i * 3 + 2] * 5000)}`;

/** Triangle corners as vertex indices. */
function triangles(m: UnwrapMesh): Uint32Array {
  if (m.index) return m.index;
  const n = m.positions.length / 3;
  const t = new Uint32Array(n - (n % 3));
  for (let i = 0; i < t.length; i++) t[i] = i;
  return t;
}

/** Charts of one mesh: connected triangles whose normals stay within `maxLeanDeg` of the chart average. */
export function buildCharts(m: UnwrapMesh, meshIndex = 0): Chart[] {
  const tri = triangles(m);
  const nt = tri.length / 3;
  const P = (i: number): V3 => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
  const tn: V3[] = new Array(nt);
  const ta = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = P(tri[t * 3]), b = P(tri[t * 3 + 1]), c = P(tri[t * 3 + 2]);
    const g = cross(sub(b, a), sub(c, a));
    ta[t] = len(g) / 2;
    tn[t] = ta[t] > 1e-14 ? norm(g) : [0, 1, 0];
  }
  // neighbours across shared edges (positions, not indices, so split vertices still connect)
  const vkey = new Map<number, string>();
  const keyOf = (i: number): string => { let k = vkey.get(i); if (!k) { k = posKey(m.positions, i); vkey.set(i, k); } return k; };
  const edges = new Map<string, number[]>();
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const a = keyOf(tri[t * 3 + e]), b = keyOf(tri[t * 3 + ((e + 1) % 3)]);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const l = edges.get(k);
      if (l) l.push(t); else edges.set(k, [t]);
    }
  }
  const nb: number[][] = Array.from({ length: nt }, () => []);
  for (const l of edges.values()) for (const a of l) for (const b of l) if (a !== b) nb[a].push(b);

  const cosLean = Math.cos((m.maxLeanDeg * Math.PI) / 180);
  const cosSeed = Math.cos(Math.min(80, m.maxLeanDeg * 2) * Math.PI / 180);
  const chartOf = new Int32Array(nt).fill(-1);
  const charts: Chart[] = [];
  for (let s = 0; s < nt; s++) {
    if (chartOf[s] >= 0) continue;
    const id = charts.length;
    const tris = [s];
    chartOf[s] = id;
    const sum: V3 = [tn[s][0] * ta[s], tn[s][1] * ta[s], tn[s][2] * ta[s]];
    for (let q = 0; q < tris.length; q++) {
      for (const u of nb[tris[q]]) {
        if (chartOf[u] >= 0) continue;
        const avg = norm(sum);
        if (dot(tn[u], avg) < cosLean || dot(tn[u], tn[s]) < cosSeed) continue;
        chartOf[u] = id;
        tris.push(u);
        sum[0] += tn[u][0] * ta[u]; sum[1] += tn[u][1] * ta[u]; sum[2] += tn[u][2] * ta[u];
      }
    }
    const n = norm(sum);
    let cx = 0, cy = 0, cz = 0, area = 0;
    for (const t of tris) {
      const a = P(tri[t * 3]), b = P(tri[t * 3 + 1]), c = P(tri[t * 3 + 2]);
      cx += ((a[0] + b[0] + c[0]) / 3) * ta[t]; cy += ((a[1] + b[1] + c[1]) / 3) * ta[t]; cz += ((a[2] + b[2] + c[2]) / 3) * ta[t];
      area += ta[t];
    }
    const centroid: V3 = area > 0 ? [cx / area, cy / area, cz / area] : P(tri[tris[0] * 3]);
    charts.push({ mesh: meshIndex, tris, n, u: [1, 0, 0], v: [0, 1, 0], minU: 0, minV: 0, wM: 0, hM: 0, centroid, areaM2: area, factor: m.densityOf ? m.densityOf({ centroid, normal: n, areaM2: area }) : 1 });
  }
  // project: tightest rectangle over a few in-plane rotations
  for (const c of charts) {
    const n = c.n;
    const horizontal = Math.abs(n[1]) > 0.9;
    let u0: V3 = horizontal ? sub([1, 0, 0], [n[0] * n[0], n[1] * n[0], n[2] * n[0]]) : cross([0, 1, 0], n);
    if (len(u0) < 1e-6) u0 = [1, 0, 0];
    u0 = norm(u0);
    const v0 = norm(cross(n, u0));
    const verts = new Set<number>();
    for (const t of c.tris) for (let k = 0; k < 3; k++) verts.add(tri[t * 3 + k]);
    const pts = [...verts].map(P);
    let best = { area: Infinity, a: 0, minU: 0, minV: 0, w: 0, h: 0 };
    const angles = horizontal || m.maxLeanDeg > 40 ? 18 : 1;
    for (let k = 0; k < angles; k++) {
      const a = (k * Math.PI) / 2 / angles;
      const ca = Math.cos(a), sa = Math.sin(a);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        const pu = dot(p, u0), pv = dot(p, v0);
        const x = pu * ca + pv * sa, y = -pu * sa + pv * ca;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const area = (x1 - x0) * (y1 - y0);
      if (area < best.area - 1e-9) best = { area, a, minU: x0, minV: y0, w: x1 - x0, h: y1 - y0 };
    }
    const ca = Math.cos(best.a), sa = Math.sin(best.a);
    c.u = [u0[0] * ca + v0[0] * sa, u0[1] * ca + v0[1] * sa, u0[2] * ca + v0[2] * sa];
    c.v = [-u0[0] * sa + v0[0] * ca, -u0[1] * sa + v0[1] * ca, -u0[2] * sa + v0[2] * ca];
    c.minU = best.minU; c.minV = best.minV; c.wM = best.w; c.hM = best.h;
  }
  return charts;
}

/** Unwraps a set of meshes into ONE atlas. Lowers the density by 15 % steps until everything fits in `maxSize`. */
export function unwrapAtlas(meshes: UnwrapMesh[], opts: UnwrapOptions): { size: number; scale: number; results: UnwrapResult[]; texelsUsed: number } {
  const allCharts = meshes.map((m, i) => buildCharts(m, i));
  let scale = 1;
  for (let attempt = 0; attempt < 40; attempt++, scale *= 0.85) {
    const rects: PackRect[] = [];
    const dims: { w: number; h: number }[] = [];
    let id = 0;
    for (let mi = 0; mi < meshes.length; mi++) {
      for (const c of allCharts[mi]) {
        const d = meshes[mi].texelsPerM * scale * c.factor;
        const w = Math.max(2, Math.ceil(c.wM * d)) + 2 * opts.pad;
        const h = Math.max(2, Math.ceil(c.hM * d)) + 2 * opts.pad;
        dims.push({ w, h });
        rects.push({ id: id++, w, h });
      }
    }
    const packed = packSmallest(rects, opts.minSize, opts.maxSize);
    if (!packed) continue;
    const at = new Map(packed.placed.map((p) => [p.id, p]));
    const N = packed.size;
    const results: UnwrapResult[] = [];
    let cid = 0;
    let used = 0;
    for (let mi = 0; mi < meshes.length; mi++) {
      const m = meshes[mi];
      const tri = triangles(m);
      const nv = m.positions.length / 3;
      const rects: [number, number, number, number][] = [];
      // each (chart, source vertex) gets one output vertex; the first chart to use a vertex keeps its slot
      const owner = new Int32Array(nv).fill(-1);
      const uvList: number[] = new Array(nv * 2).fill(0);
      const extraSrc: number[] = [];
      const extraUv: number[] = [];
      const dupe = new Map<string, number>();
      const newIndex = new Uint32Array(tri.length);
      let split = false;
      const charts = allCharts[mi];
      charts.forEach((c, ci) => {
        const p = at.get(cid + ci)!;
        const dm = dims[cid + ci];
        used += dm.w * dm.h;
        const ox = p.x + opts.pad, oy = p.y + opts.pad;
        const d = m.texelsPerM * scale * c.factor;
        rects.push([p.x, p.y, p.w, p.h]);
        for (const t of c.tris) {
          for (let k = 0; k < 3; k++) {
            const vi = tri[t * 3 + k];
            const x = m.positions[vi * 3], y = m.positions[vi * 3 + 1], z = m.positions[vi * 3 + 2];
            const pu = x * c.u[0] + y * c.u[1] + z * c.u[2] - c.minU;
            const pv = x * c.v[0] + y * c.v[1] + z * c.v[2] - c.minV;
            const uu = Math.min(N - 0.5, Math.max(0.5, ox + pu * d)) / N;
            const vv = Math.min(N - 0.5, Math.max(0.5, oy + pv * d)) / N;
            let out: number;
            if (owner[vi] === -1 || owner[vi] === ci) {
              owner[vi] = ci; out = vi;
              uvList[vi * 2] = uu; uvList[vi * 2 + 1] = vv;
            } else {
              const dk = `${ci}:${vi}`;
              let e = dupe.get(dk);
              if (e === undefined) { e = nv + extraSrc.length; extraSrc.push(vi); extraUv.push(uu, vv); dupe.set(dk, e); split = true; }
              out = e;
            }
            newIndex[t * 3 + k] = out;
          }
        }
      });
      cid += charts.length;
      const uvCount = nv + extraSrc.length;
      const uv = new Float32Array(uvCount * 2);
      uv.set(uvList);
      uv.set(extraUv, nv * 2);
      const r: UnwrapResult = { key: m.key, uv, uvCount, charts: charts.length, rects };
      if (split) { r.remap = Uint32Array.from(extraSrc); r.index = newIndex; }
      results.push(r);
    }
    return { size: N, scale, results, texelsUsed: used };
  }
  throw new Error('the lightmap atlas does not fit even at a very low density');
}

/**
 * Meshes made of thousands of tiny faces (window bars, railings, switch plates) cost an atlas chart each and gain nothing from a lightmap:
 * the bake leaves them to the hemisphere, the sun and the lamps, as before. They still shade and bounce in the bake as geometry.
 */
export const FINE_MIN_CHARTS = 120;
export const FINE_MEAN_CHART_M2 = 0.035;
export function isFineDetail(m: UnwrapMesh): boolean {
  const charts = buildCharts(m);
  if (charts.length < FINE_MIN_CHARTS) return false;
  const area = charts.reduce((s, c) => s + c.areaM2, 0);
  return area / charts.length < FINE_MEAN_CHART_M2;
}
