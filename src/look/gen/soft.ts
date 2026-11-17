// Soft furnishing shapes of the style generators (SPEC 16.15 "crisp furniture"). A cushion, a pillow, a mattress or a seat pad is one welded
// surface: a rounded box whose faces are crowned toward their middle, with normals averaged over the whole surface, so it reads as a plump
// pad with a soft edge and no creases or seams where its faces meet. The box w x h x d is exact (the crown is scaled back to it); the middle
// of every face stands at the bound and the edges are drawn in.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export interface SoftOpts {
  /** edge radius in metres (clamped to half the thinnest side) */
  r?: number;
  /** how far the edges of a face are drawn in below the bound, metres: the crown of the pad */
  puff?: number;
  /** quality: 2 = a pad with a one-cell bevel (300 triangles), 3 = rounder edges and a crown that shows (about 1000) */
  seg?: number;
}

/** the sample positions along one axis of half-length `h`: a bevel of `kc` cells on each side (spaced so the rounded corner is even in angle), `m` cells across the flat middle */
function axisSamples(h: number, r: number, kc: number, m: number): number[] {
  const inner = h - r;
  const off: number[] = [];
  for (let k = 0; k <= kc; k++) off.push(r * Math.tan((k / kc) * (Math.PI / 4)));
  const mid: number[] = [];
  for (let i = 1; i < m; i++) mid.push(-inner + (2 * inner * i) / m);
  const lo = off.map((o) => -inner - o).reverse(); // -h .. -inner
  const hi = off.map((o) => inner + o);            // inner .. h
  return [...lo, ...mid, ...hi];
}

export function softCushion(w: number, h: number, d: number, o: SoftOpts = {}): THREE.BufferGeometry {
  const half = [Math.max(0.001, w) / 2, Math.max(0.001, h) / 2, Math.max(0.001, d) / 2];
  const r = Math.max(0.002, Math.min(o.r ?? 0.04, Math.min(...half) - 0.0005));
  const seg = Math.max(1, Math.round(o.seg ?? 3));
  const kc = seg >= 4 ? 3 : seg >= 3 ? 2 : 1, m = seg >= 5 ? 19 : seg >= 4 ? 9 : seg >= 3 ? 5 : seg >= 2 ? 3 : 2;
  const puff = Math.max(0, o.puff ?? 0);
  const s = half.map((hh) => axisSamples(hh, Math.min(r, hh - 0.0005), kc, m));
  const pos: number[] = [], idx: number[] = [];
  const halfPi = Math.PI / 2;
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3, v = (a + 2) % 3;
    for (const sg of [-1, 1]) {
      const base = pos.length / 3;
      const nu = s[u].length, nv = s[v].length;
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const P = [0, 0, 0];
        P[a] = sg * half[a]; P[u] = s[u][i]; P[v] = s[v][j];
        // the rounded-box surface point under this point of the cube surface
        const inner = P.map((x, k) => Math.max(-(half[k] - r), Math.min(half[k] - r, x)));
        const dir = P.map((x, k) => x - inner[k]);
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        const Q = inner.map((x, k) => x + (dir[k] / len) * r);
        const nrm = dir.map((x) => x / len);
        if (puff > 0) {
          for (let k = 0; k < 3; k++) {
            const wgt = nrm[k] * nrm[k];
            if (wgt < 1e-4) continue;
            const b = (k + 1) % 3, c = (k + 2) % 3;
            // 1 at the edges of this face, 0 in its middle
            const edge = 1 - Math.cos(halfPi * Math.max(-1, Math.min(1, Q[b] / half[b]))) * Math.cos(halfPi * Math.max(-1, Math.min(1, Q[c] / half[c])));
            Q[k] -= Math.sign(nrm[k]) * Math.min(puff, half[k] * 0.6) * edge * wgt;
          }
        }
        pos.push(Q[0], Q[1], Q[2]);
      }
      // wind the quads so the face looks along +/- axis a: (u, v, a) is a right-handed frame
      for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
        const p0 = base + j * nu + i, p1 = p0 + 1, p2 = p0 + nu, p3 = p2 + 1;
        if (sg > 0) idx.push(p0, p1, p3, p0, p3, p2); else idx.push(p0, p3, p1, p0, p2, p3);
      }
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // the crown leaves the box a little small where a face has no vertex at its very middle: stretch it back to exactly w x h x d
  if (puff > 0) {
    g.computeBoundingBox();
    const bb = g.boundingBox as THREE.Box3;
    g.scale((half[0] * 2) / (bb.max.x - bb.min.x), (half[1] * 2) / (bb.max.y - bb.min.y), (half[2] * 2) / (bb.max.z - bb.min.z));
  }
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  return g;
}

/** tier-aware cushion: welded soft pad on medium and high, a plain rounded box on low (a phone) */
export function softPad(tier: 'low' | 'medium' | 'high', w: number, h: number, d: number, o: SoftOpts = {}): THREE.BufferGeometry {
  return softCushion(w, h, d, { ...o, seg: tier === 'low' ? 1 : tier === 'medium' ? 2 : (o.seg ?? 3) });
}
