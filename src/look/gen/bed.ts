// Bed generator: a base (platform, storage box or frame on legs), a headboard (panel, upholstered, slatted or none), a mattress with
// a fitted sheet, a draped quilted duvet with a turned-down fold, pillows and striped cushions. The footprint, the total height
// and the mattress top are exactly the item's (the bounding box is the box), and every soft part stays inside them.
import * as THREE from 'three';
import { puffedCushion, roundedBoxBetween } from '../furniture-parts';
import { Parts, role } from './core';
import type { GenEnv, GenSize, Roles } from './core';
import { rod } from './geo';

export type BedBase = 'platform' | 'box' | 'legs';
export type BedHeadboard = 'panel' | 'upholstered' | 'slatted' | 'none';
export const BED_BASES: BedBase[] = ['platform', 'box', 'legs'];
export const BED_HEADBOARDS: BedHeadboard[] = ['panel', 'upholstered', 'slatted', 'none'];

export interface BedParams {
  base: BedBase;
  headboard: BedHeadboard;
  /** top of the base, 0 = from the surface height */
  baseTopM: number;
  /** pillows, 0 = automatic (two on a bed 1.2 m wide or more) */
  pillows: number;
  /** striped accent cushions in front of the pillows */
  cushions: number;
  duvet: 'quilted' | 'plain' | 'none';
}
export const BED_DEFAULTS: BedParams = { base: 'platform', headboard: 'panel', baseTopM: 0, pillows: 0, cushions: 2, duvet: 'quilted' };

/** moves a soft part down if its top would rise above `top` (a pillow or cushion on a low bed stays inside the item's height) */
function fitTop(g: THREE.BufferGeometry, top: number): THREE.BufferGeometry {
  g.computeBoundingBox();
  const over = g.boundingBox!.max.y - top;
  if (over > 0) g.translate(0, -over, 0);
  return g;
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A draped sheet of cloth over a mattress: a height field over x, z. The top bulges a little, the sides and the foot drop. */
function duvetGeometry(w: number, z0: number, z1: number, y: number, thick: number, matW: number, drop: number, n: number, seed: number): THREE.BufferGeometry {
  const nx = n, nz = Math.max(6, Math.round(n * (z1 - z0) / w * 1.2));
  const pos: number[] = [], idx: number[] = [], uv: number[] = [];
  const ph = seed * 1.7;
  for (let j = 0; j <= nz; j++) {
    const tz = j / nz;
    const z = z0 + tz * (z1 - z0);
    for (let i = 0; i <= nx; i++) {
      const tx = i / nx;
      const x = -w / 2 + tx * w;
      const ax = Math.abs(x);
      const edge = smooth(matW / 2 - 0.035, w / 2, ax);                // the sides roll down
      const foot = smooth(0.78, 1.0, tz);                                 // the foot end rolls down
      const crown = Math.cos((x / (matW / 2)) * Math.PI * 0.5) * 0.35 + 0.65; // a gentle hump across the bed
      const ripple = 0.012 * Math.sin(5.1 * z + ph) * Math.sin(7.3 * x + ph * 0.6) + 0.008 * Math.sin(11 * x + 3 * z + ph);
      const lift = thick * crown * (1 - 0.5 * smooth(0.0, 0.08, 1 - tz)) + ripple;
      const yy = y + lift - drop * Math.max(edge, foot * 0.85 * (0.6 + 0.4 * (1 - edge)));
      pos.push(x, yy, z);
      uv.push(x, z);
    }
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildBed(env: GenEnv, size: GenSize, p: BedParams, roles: Roles): THREE.Group {
  const { w, d, h, s: S } = size;
  const q = env.q;
  const H = Math.max(h, S + 0.02);
  const parts = new Parts(env, 'gen:bed');
  const frame = role(roles, 'bedFrame', 'accent', 'case');
  const head = role(roles, 'headboard', 'bedFrame', 'accent');
  const sheet = role(roles, 'bedding');
  const duvetM = role(roles, 'duvet', 'bedding');
  const pillowM = role(roles, 'pillow', 'bedding');
  const cushionM = role(roles, 'cushion', 'fabric');
  const dark = role(roles, 'plinth', 'handle');
  const legM = role(roles, 'legs', 'case');

  const m = size.inner ? { w: Math.min(size.inner.w, w - 0.01), d: Math.min(size.inner.d, d - 0.01) } : { w: w - 0.03, d: d - 0.03 };
  const baseTop = p.baseTopM > 0 ? p.baseTopM : Math.max(0.12, Math.min(0.3, S - 0.1));
  const hz0 = -d / 2;
  const hzT = p.headboard === 'none' ? 0 : p.headboard === 'slatted' ? 0.045 : p.headboard === 'upholstered' ? 0.075 : 0.06;
  const hz1 = hz0 + hzT;

  // ---- base
  if (p.base === 'legs') {
    const rail = 0.16;
    const y0 = baseTop - rail;
    parts.box('bed-frame', frame, -w / 2, -w / 2 + 0.05, y0, baseTop, -d / 2, d / 2);
    parts.box('bed-frame', frame, w / 2 - 0.05, w / 2, y0, baseTop, -d / 2, d / 2);
    parts.box('bed-frame', frame, -w / 2 + 0.05, w / 2 - 0.05, y0, baseTop, d / 2 - 0.05, d / 2);
    parts.box('bed-frame', frame, -w / 2 + 0.05, w / 2 - 0.05, y0 + 0.04, baseTop - 0.02, -d / 2 + hzT, -d / 2 + hzT + 0.02, { c: 0 });
    parts.box('bed-slats', legM, -w / 2 + 0.05, w / 2 - 0.05, baseTop - 0.045, baseTop - 0.02, -d / 2 + hzT, d / 2 - 0.05, { c: 0 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.045), z = sz * (d / 2 - 0.045);
      parts.put('bed-legs', legM, q.chamfer ? rod({ x, y: 0, z }, { x, y: y0, z }, 0.025, q.sides) : new THREE.BoxGeometry(0.05, y0, 0.05).translate(x, y0 / 2, z));
    }
  } else {
    const plinthTop = p.base === 'platform' ? Math.min(0.07, baseTop - 0.04) : Math.min(0.06, baseTop - 0.04);
    parts.box('bed-plinth', dark, -(w - 0.12) / 2, (w - 0.12) / 2, 0, plinthTop, -(d - 0.12) / 2, (d - 0.12) / 2, { c: 0 });
    if (p.base === 'box') {
      const mid = (plinthTop + baseTop) / 2;
      parts.box('bed-frame', frame, -w / 2, w / 2, plinthTop, mid - 0.0015, -d / 2, d / 2);
      parts.box('bed-frame', frame, -w / 2, w / 2, mid + 0.0015, baseTop, -d / 2, d / 2);
      parts.box('bed-seam', dark, -w / 2 + 0.01, w / 2 - 0.01, mid - 0.0016, mid + 0.0016, -d / 2 + 0.01, d / 2 - 0.01, { c: 0 });
    } else {
      parts.box('bed-frame', frame, -w / 2, w / 2, plinthTop, baseTop, -d / 2, d / 2, { c: 0.01 });
    }
  }

  // ---- headboard
  const hy0 = p.base === 'legs' ? 0.12 : 0.04;
  if (p.headboard === 'panel') {
    parts.box('bed-headboard', head, -w / 2, w / 2, hy0, H, hz0, hz1, { c: 0.012 });
  } else if (p.headboard === 'upholstered') {
    parts.put('bed-headboard', head, roundedBoxBetween(-w / 2, w / 2, hy0, H, hz0, hz1, 0.03, q.seg));
    // vertical channels between the quilted columns
    const cols = Math.max(3, Math.round(w / 0.22));
    for (let i = 1; i < cols; i++) {
      const x = -w / 2 + (w * i) / cols;
      parts.box('bed-channels', dark, x - 0.0035, x + 0.0035, baseTop + 0.02, H - 0.05, hz1 - 0.006, hz1 + 0.0006, { c: 0 });
    }
  } else if (p.headboard === 'slatted') {
    parts.box('bed-headboard-back', dark, -w / 2, w / 2, hy0, H, hz0, hz0 + 0.012, { c: 0 });
    const pitch = 0.05, n = Math.round(w / pitch);
    const sw = pitch * 0.62;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n);
      parts.box('bed-headboard', head, x - sw / 2, x + sw / 2, hy0, H, hz0 + 0.012, hz1, { c: 0.003 });
    }
  }

  // ---- mattress, kept clear of the headboard
  const mz0 = Math.max(-m.d / 2, hz1), mz1 = m.d / 2;
  const mh = S - baseTop;
  parts.put('mattress', sheet, roundedBoxBetween(-m.w / 2, m.w / 2, baseTop, S, mz0, mz1, Math.min(0.05, mh / 2.2), Math.max(2, q.seg)), { grain: 'x' });

  // ---- duvet: draped over the foot end, its top edge turned down in a thick fold
  if (p.duvet !== 'none') {
    const cover = 0.72;
    const zA = mz1 - cover * (mz1 - mz0), zB = mz1 - 0.004;
    const cw = Math.min(m.w + 0.05, w - 0.012);
    const thick = p.duvet === 'quilted' ? 0.055 : 0.04;
    const dropY = Math.min(0.14, S - baseTop - 0.01);
    const g = duvetGeometry(cw, zA, zB, S + 0.004, thick, m.w, dropY, q.cloth, 3);
    parts.put('duvet', p.duvet === 'quilted' ? duvetM : { key: 'cotton', tint: duvetM.tint }, g, { grain: 'x' });
    const fold = roundedBoxBetween(-(cw - 0.03) / 2, (cw - 0.03) / 2, S + 0.0, Math.min(S + thick + 0.05, H - 0.005), zA, zA + 0.2, Math.min(0.045, (Math.min(S + thick + 0.05, H - 0.005) - S) / 2.1), Math.max(2, q.seg));
    parts.put('duvet-fold', p.duvet === 'quilted' ? duvetM : { key: 'cotton', tint: duvetM.tint }, fold, { grain: 'x' });
  }

  // ---- pillows lean against the headboard
  const two = m.w >= 1.2;
  const nPillow = p.pillows > 0 ? p.pillows : two ? 2 : 1;
  const pw = Math.min(0.66, (m.w - 0.06) / nPillow - 0.02), pd = 0.42, ph = 0.15;
  const tilt = 0.26;
  const pz = Math.max(mz0, hz1) + 0.05 + pd / 2 * Math.cos(tilt);
  for (let i = 0; i < nPillow; i++) {
    const x = nPillow === 1 ? 0 : ((i + 0.5) / nPillow - 0.5) * (m.w - 0.06);
    const g = q.puff > 0 ? puffedCushion(pw, ph, pd, 0.03, q.puff) : roundedBoxBetween(-pw / 2, pw / 2, -ph / 2, ph / 2, -pd / 2, pd / 2, 0.04, 1);
    g.rotateX(tilt);
    g.translate(x, S + 0.035 + ph / 2, pz);
    parts.put('pillows', pillowM, fitTop(g, H - 0.004), { grain: 'x' });
  }
  // striped cushions in front of the pillows
  const nC = Math.max(0, Math.min(4, Math.round(p.cushions)));
  for (let i = 0; i < nC; i++) {
    const cwid = 0.46, cth = 0.13;
    const g = q.puff > 0 ? puffedCushion(cwid, cth, cwid, 0.03, q.puff) : roundedBoxBetween(-cwid / 2, cwid / 2, -cth / 2, cth / 2, -cwid / 2, cwid / 2, 0.04, 1);
    g.rotateX(0.9 + 0.1 * (i % 2));
    g.rotateY((i % 2 ? 1 : -1) * 0.12);
    const x = nC === 1 ? 0 : ((i + 0.5) / nC - 0.5) * Math.min(m.w - 0.3, 0.85);
    g.translate(x, S + 0.19, pz + 0.3 + (i % 2) * 0.03);
    parts.put('cushions', cushionM, fitTop(g, H - 0.004), { tile: 0.42 });
  }
  void H;
  return parts.done();
}
