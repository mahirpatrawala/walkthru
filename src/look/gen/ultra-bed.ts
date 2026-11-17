// SPEC 16.24, second pass: what lies on a bed at 2K. A made bed as a furniture catalogue photographs it: a duvet cover with real thickness that hangs over the mattress with
// pleats and a rounded hem, a turned-down band at the head (the lining shows, a strip of fitted sheet between it and the pillows), two plump pillows with a hollow, a seam
// round their edge and a flat cloth weave, a piped mattress. Everything stays inside the limits of 16.23: the top of any cover is at most QUILT_PROUD_M (12 mm) above the
// mattress top, the pillows are PILLOW_HEIGHT_M high and exactly two (one on a single), nothing is wider or longer than the bed's box. No colour is painted into the vertices:
// the folds are geometry, the quilting is the material's normal map.
import * as THREE from 'three';
import { roundedBoxBetween } from '../furniture-parts';
import { QUILT_PROUD_M, PILLOW_HEIGHT_M } from '../../core/bed-layout';
import type { BedLayout } from '../../core/bed-layout';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { softCushion } from './soft';
import { shade } from './core';
import type { MatSpec, Parts } from './core';
import { rod } from './geo';

export interface BedDress {
  w: number; d: number; H: number; S: number; baseTop: number;
  m: { w: number; d: number }; mz0: number; mz1: number;
  lay: BedLayout;
  sheet: MatSpec; duvet: MatSpec; pillow: MatSpec; quilted: boolean; hasDuvet: boolean;
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** a pillow is a lens: two domed faces that meet at the seam round its edge (the plan is a squared-off oval), plump in the middle, a flat Oxford flange near the edge, a hollow on the top where a head rests */
const NU = 56, NV = 40;
const lens = (u: number, v: number): number => Math.pow(Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 4), 0.25); // 0 in the middle, 1 on the seam
const dome = (r: number): number => Math.pow(Math.max(0, 1 - Math.pow(r, 2.4)), 0.62);
function pillowGeo(w: number, d: number, seed: number): THREE.BufferGeometry {
  const hx = w / 2, hz = d / 2, H = PILLOW_HEIGHT_M, ph = seed * 1.7;
  const pos: number[] = [], idx: number[] = [];
  const grid = (sign: 1 | -1): void => {
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      let u = (i / NU) * 2 - 1, v = (j / NV) * 2 - 1;
      const r = lens(u, v);
      if (r > 1) { u /= r; v /= r; }
      const rr = Math.min(1, r);
      let f = dome(rr) * (H / 2);
      if (sign > 0) {
        const hollow = 0.014 * Math.exp(-((u / 0.5) ** 2 + (v / 0.46) ** 2));
        const wrinkle = 0.0016 * (0.5 + 0.5 * Math.sin(u * hx * 38 + v * hz * 30 + ph)) * smooth(0.5, 0.95, rr);
        f = Math.max(0, f - (hollow + wrinkle) * smooth(0, 0.35, f / (H / 2)));
      }
      pos.push(u * hx, sign * f, v * hz);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 1, e = c + 1;
      if (sign > 0) idx.push(a, c, b, b, c, e); else idx.push(a, b, c, b, e, c);
    }
  };
  grid(1); grid(-1);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g = mergeVertices(g, 1e-6);
  g.computeVertexNormals();
  return g;
}

/** a cord or a line of thread on a pillow at `k` of the way from its middle to its seam (1 = the seam); on the top face when `top` is true, else the seam's own height */
function pillowLine(w: number, d: number, k: number, top: boolean, cx: number, cy: number, cz: number, rad: number): THREE.BufferGeometry {
  const hx = w / 2, hz = d / 2, pts: THREE.Vector3[] = [];
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const u = Math.sign(c) * Math.pow(Math.abs(c), 0.5) * k, v = Math.sign(s) * Math.pow(Math.abs(s), 0.5) * k;
    const y = top ? dome(Math.min(1, lens(u, v))) * (PILLOW_HEIGHT_M / 2) : 0;
    pts.push(new THREE.Vector3(cx + u * hx, cy + y + (top ? 0.0008 : 0), cz + v * hz));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), 144, rad, 6, true);
}

/** how far the top of the cover is pressed down at (x, z), metres, 0 to about 9 mm: soft broad folds, the cloth drawn down toward its edge, and quilting channels (the stitched seam is the valley) */
function topDy(x: number, z: number, hx: number, ph: number, chZ0: number, quilted: boolean): number {
  const broad = 0.0026 * (0.5 + 0.5 * Math.sin(z * 8.5 + Math.sin(x * 2.4 + ph) * 1.3 + ph)) + 0.0016 * (0.5 + 0.5 * Math.sin(x * 11 - z * 5.5 + ph * 2));
  const edge = smooth(0.55, 1, Math.abs(x) / hx) * 0.003;
  const channel = quilted ? 0.0042 * (0.5 + 0.5 * Math.cos(((z - chZ0) / CHANNEL_M) * Math.PI * 2)) : 0;
  return broad + edge + channel;
}
/** the pitch of the quilting channels across the bed, and of their seams (lines of thread) */
const CHANNEL_M = 0.22;

/** the duvet cover: a thick cover over the mattress that hangs down its sides and foot with soft pleats and a rounded hem. Pleats only go inward (the cover stays inside the bed's box) */
function duvetGeo(cw: number, yTop: number, yBottom: number, zA: number, zB: number, seed: number, chZ0: number, quilted: boolean): THREE.BufferGeometry {
  const g = softCushion(cw, yTop - yBottom, zB - zA, { r: 0.05, puff: 0, seg: 5 });
  g.translate(0, (yTop + yBottom) / 2, (zA + zB) / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const hx = cw / 2, ph = seed * 1.3;
  const zc = (zA + zB) / 2, hz = (zB - zA) / 2;
  const hang = yTop - yBottom;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const depth = Math.max(0, (yTop - 0.03 - y) / (hang - 0.03)); // 0 on the top, 1 at the hem
    // the sides and the foot hang in pleats that deepen toward the hem (inward only, at most 9 mm)
    const onSide = smooth(hx - 0.03, hx - 0.004, Math.abs(x));
    const onFoot = smooth(hz - 0.03, hz - 0.004, z - zc);
    const pleatSide = 0.5 + 0.5 * Math.sin(z * 15 + Math.sin(y * 9 + ph) * 0.7 + ph);
    const pleatFoot = 0.5 + 0.5 * Math.sin(x * 13 + Math.sin(y * 8 - ph) * 0.7 + ph * 2);
    x -= Math.sign(x) * 0.009 * pleatSide * onSide * depth;
    z -= 0.009 * pleatFoot * onFoot * depth;
    const top = smooth(yTop - 0.035, yTop, y);
    if (top > 0) y -= topDy(pos.getX(i), pos.getZ(i), hx, ph, chZ0, quilted) * top;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** the lines of thread: across every channel seam and once round the cover 4.5 cm in from its edge, lying on the surface (the same function that shapes it says where the surface is) */
function stitching(cw: number, yTop: number, zA: number, zB: number, seed: number, chZ0: number, quilted: boolean): THREE.BufferGeometry[] {
  const hx = cw / 2, ph = seed * 1.3, out: THREE.BufferGeometry[] = [];
  const line = (pts: [number, number][]): void => {
    const v = pts.map(([x, z]) => new THREE.Vector3(x, yTop - topDy(x, z, hx, ph, chZ0, quilted) + 0.0004, z));
    out.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v, false, 'catmullrom', 0.2), Math.max(8, v.length * 2), 0.0014, 6, false));
  };
  const xi = hx - 0.06, zi = zB - 0.06;
  const along = (x0: number, x1: number, z: number): [number, number][] => { const n = Math.max(2, Math.ceil(Math.abs(x1 - x0) / 0.04)); return Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, z] as [number, number]); };
  if (quilted) for (let z = chZ0; z < zi - 0.05; z += CHANNEL_M) if (z > zA + 0.05) line(along(-xi, xi, z));
  // the border seam: down one side, across the foot, up the other
  const side = (x: number): [number, number][] => { const n = Math.ceil((zi - zA) / 0.05); return Array.from({ length: n + 1 }, (_, i) => [x, zA + 0.12 + ((zi - zA - 0.12) * i) / n] as [number, number]); };
  line([...side(-xi), ...along(-xi, xi, zi).slice(1, -1), ...side(xi).reverse()]);
  return out;
}

/** Adds the mattress, its piping, the duvet, the turned-down band, the fitted-sheet strip and the pillows. */
export function dressBedUltra(parts: Parts, c: BedDress): void {
  const { S, H, baseTop, m, mz0, mz1, lay } = c;
  const mh = S - baseTop;
  const rad = Math.min(0.05, mh / 2.2);
  parts.put('mattress', c.sheet, roundedBoxBetween(-m.w / 2, m.w / 2, baseTop, S, mz0, mz1, rad, 4), { grain: 'x' });
  // the sheet is piped along the top and bottom edge of the mattress, a darker cord 5 mm thick, sitting on the rounded edge at 45 degrees
  const cord = shade(c.sheet, 0.9), inset = rad * 0.29 + 0.0012;
  for (const y of [S - inset, baseTop + inset]) {
    for (const sx of [-1, 1]) parts.put('mattress-piping', cord, rod({ x: sx * (m.w / 2 - inset), y, z: mz0 + inset }, { x: sx * (m.w / 2 - inset), y, z: mz1 - inset }, 0.0045, 10), { noShadow: true });
    parts.put('mattress-piping', cord, rod({ x: -(m.w / 2 - inset), y, z: mz1 - inset }, { x: m.w / 2 - inset, y, z: mz1 - inset }, 0.0045, 10), { noShadow: true });
  }
  if (c.hasDuvet) {
    const cw = Math.min(m.w + 0.07, c.w - 0.012);
    const zA = Math.max(mz0, lay.quiltZ0 + 0.1), zB = Math.min(c.d / 2 - 0.003, mz1 + 0.02);
    const top = Math.min(S + QUILT_PROUD_M - 0.002, H - 0.004);
    const bottom = S - Math.min(0.15, S - baseTop - 0.01);
    const mat = c.quilted ? c.duvet : { key: 'cotton' as const, tint: c.duvet.tint };
    const seed = c.w * 3 + c.d, chZ0 = zA + 0.14;
    parts.put('duvet', mat, duvetGeo(cw, top, bottom, zA, zB, seed, chZ0, c.quilted), { grain: 'x' });
    // the stitching, a darker thread (quilted) or a flat-felled seam (plain), as geometry on the surface
    for (const t of stitching(cw, top, zA, zB, seed, chZ0, c.quilted)) parts.put('duvet-stitching', shade(c.duvet, 0.8), t, { noShadow: true });
    // the turned-down band: the cover folded back at the head, its lining (the sheet's white) showing, a rounded fold toward the pillows, stitched along its hem;
    // 10 mm thick, its top at the same 12 mm limit, a strip of fitted sheet left bare between it and the pillows
    const foldZ0 = lay.quiltZ0 + 0.04, foldZ1 = lay.quiltZ0 + 0.26;
    const bandTop = Math.min(S + QUILT_PROUD_M - 0.0013, H - 0.004);
    const band = softCushion(cw - 0.012, 0.0095, foldZ1 - foldZ0, { r: 0.0046, puff: 0.0012, seg: 4 });
    band.translate(0, bandTop - 0.00475, (foldZ0 + foldZ1) / 2);
    parts.put('duvet-fold', shade(c.sheet, 0.985), band, { grain: 'x', noShadow: true });
    parts.put('duvet-fold', shade(c.sheet, 0.88), new THREE.BoxGeometry(cw - 0.05, 0.0011, 0.0035).translate(0, bandTop + 0.0006 - 0.0004, foldZ1 - 0.02), { noShadow: true });
  }
  // two plump pillows (one on a single bed): crowned, hollowed, a seam round the edge, flat weave
  const seam = shade(c.pillow, 0.9);
  for (const pl of lay.pillows) {
    const pz = Math.max(pl.z, mz0 + 0.01 + pl.d / 2);
    const g = pillowGeo(pl.w, pl.d, pl.x * 5 + 2);
    g.translate(pl.x, S + PILLOW_HEIGHT_M / 2, pz);
    g.computeBoundingBox();
    const over = g.boundingBox!.max.y - (H - 0.004);
    const dy = over > 0 ? -over : 0;
    if (dy) g.translate(0, dy, 0);
    parts.put('pillows', c.pillow, g, { grain: 'x' });
    // the seam cord round the edge, and the Oxford flange stitch 5 cm in
    parts.put('pillow-seams', seam, pillowLine(pl.w, pl.d, 1, false, pl.x, S + PILLOW_HEIGHT_M / 2 + dy, pz, 0.0034), { noShadow: true });
    parts.put('pillow-seams', shade(c.pillow, 0.82), pillowLine(pl.w, pl.d, 0.8, true, pl.x, S + PILLOW_HEIGHT_M / 2 + dy, pz, 0.0014), { noShadow: true });
  }
}
