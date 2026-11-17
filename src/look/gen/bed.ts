// Bed generator: a base (platform, storage box or frame on legs), a headboard (panel, upholstered, slatted or none), a mattress with
// a fitted sheet, a flat quilt that follows the mattress and sleeping pillows (two, or one on a single: src/core/bed-layout.ts, which
// also places the head of a person lying on the bed). Nothing else lies on a bed: no accent cushions, bolster, throw or turned-down roll.
// The footprint, the total height and the mattress top are exactly the item's (the bounding box is the box), and every soft part stays inside them.
import * as THREE from 'three';
import { roundedBoxBetween } from '../furniture-parts';
import { softCushion } from './soft';
import { Parts, role, shade, softSeg } from './core';
import type { GenEnv, GenSize, Roles } from './core';
import { rod } from './geo';
import { PILLOW_HEIGHT_M, QUILT_PROUD_M, bedLayout } from '../../core/bed-layout';

export type BedBase = 'platform' | 'box' | 'legs';
export type BedHeadboard = 'panel' | 'upholstered' | 'slatted' | 'none';
export const BED_BASES: BedBase[] = ['platform', 'box', 'legs'];
export const BED_HEADBOARDS: BedHeadboard[] = ['panel', 'upholstered', 'slatted', 'none'];

export interface BedParams {
  base: BedBase;
  headboard: BedHeadboard;
  /** top of the base, 0 = from the surface height */
  baseTopM: number;
  duvet: 'quilted' | 'plain' | 'none';
}
export const BED_DEFAULTS: BedParams = { base: 'platform', headboard: 'panel', baseTopM: 0, duvet: 'quilted' };

/** 2K: gentle folds in a quilt and a dent in a pillow, only ever downward, so the top of the cover stays at the proud height the layout gives it (16.23) and nobody lying on it is inside it */
function settle(g: THREE.BufferGeometry, kind: 'quilt' | 'pillow', seed: number): THREE.BufferGeometry {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, hx = (b.max.x - b.min.x) / 2, hz = (b.max.z - b.min.z) / 2, h = b.max.y - b.min.y;
  const ph = seed * 1.7;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // only the upper skin moves: a vertex within a third of the thickness of the top, weighted so the edge stays put
    const up = Math.max(0, (y - (b.max.y - h * 0.34)) / (h * 0.34));
    if (up <= 0) continue;
    const x = pos.getX(i) - cx, z = pos.getZ(i) - cz;
    const ex = Math.min(1, (1 - Math.abs(x) / hx) * 6), ez = Math.min(1, (1 - Math.abs(z) / hz) * 6);
    const edge = Math.max(0, Math.min(ex, ez));
    let dy = 0;
    if (kind === 'quilt') {
      // long soft ridges across the width and a few diagonal creases, 1 to 4 mm deep, with a sag over the middle of the mattress
      dy = 0.0021 * (0.5 + 0.5 * Math.sin(z * 11 + Math.sin(x * 2.6 + ph) * 1.4 + ph)) + 0.0014 * (0.5 + 0.5 * Math.sin(x * 7.5 - z * 4.2 + ph * 2)) + 0.0012 * Math.max(0, 1 - Math.abs(x) / (hx * 0.9));
    } else {
      // a hollow where a head rests, and the case drawn a little tight at the corners
      dy = 0.011 * Math.exp(-((x / (hx * 0.55)) ** 2 + (z / (hz * 0.55)) ** 2)) + 0.0016 * (0.5 + 0.5 * Math.sin(x * 23 + z * 17 + ph));
    }
    pos.setY(i, y - dy * up * edge);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** moves a soft part down if its top would rise above `top` (a pillow on a low bed stays inside the item's height) */
function fitTop(g: THREE.BufferGeometry, top: number): THREE.BufferGeometry {
  g.computeBoundingBox();
  const over = g.boundingBox!.max.y - top;
  if (over > 0) g.translate(0, -over, 0);
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

  // 2K: the sheet is piped along the top and bottom edge of the mattress, a darker cord 5 mm thick
  if (q.ultra) {
    const cord = shade(sheet, 0.9), inset = Math.min(0.05, mh / 2.2) * 0.29 + 0.0012; // on the rounded edge at 45 degrees
    for (const y of [S - inset, baseTop + inset]) {
      for (const sx of [-1, 1]) parts.put('mattress-piping', cord, rod({ x: sx * (m.w / 2 - inset), y, z: mz0 + inset }, { x: sx * (m.w / 2 - inset), y, z: mz1 - inset }, 0.0045, 10), { noShadow: true });
      parts.put('mattress-piping', cord, rod({ x: -(m.w / 2 - inset), y, z: mz1 - inset }, { x: m.w / 2 - inset, y, z: mz1 - inset }, 0.0045, 10), { noShadow: true });
    }
  }

  // ---- quilt: one flat cover that follows the mattress from just below the pillows to the foot, its sides and foot hanging past the mattress.
  // Its top stands QUILT_PROUD_M above the mattress top and no more: a person lies on it, it never reaches into them
  const lay = bedLayout({ w, d }, size.inner);
  if (p.duvet !== 'none') {
    const zA = Math.max(mz0, lay.quiltZ0), zB = Math.min(d / 2 - 0.003, mz1 + 0.02);
    const cw = Math.min(m.w + 0.07, w - 0.012);
    const top = Math.min(S + QUILT_PROUD_M, H - 0.004);
    const bottom = S - Math.min(0.14, S - baseTop - 0.01);
    const duvetMat = p.duvet === 'quilted' ? duvetM : { key: 'cotton' as const, tint: duvetM.tint };
    const body = q.puff > 0 ? softCushion(cw, top - bottom, zB - zA, { r: 0.03, seg: softSeg(q) }) : roundedBoxBetween(-cw / 2, cw / 2, -(top - bottom) / 2, (top - bottom) / 2, -(zB - zA) / 2, (zB - zA) / 2, 0.03, 1);
    body.translate(0, (top + bottom) / 2, (zA + zB) / 2);
    if (q.ultra) settle(body, 'quilt', w * 3 + d);
    parts.put('duvet', duvetMat, body, { grain: 'x' });
    if (p.duvet === 'quilted') {
      // quilting channels across the quilt, as thin darker bands standing 1 mm proud of its top
      const seam = shade(duvetM, 0.88);
      for (let z = zA + 0.22; z < zB - 0.1; z += 0.22) parts.box('duvet-seams', seam, -cw / 2 + 0.05, cw / 2 - 0.05, top - 0.0015, top + 0.001, z - 0.0025, z + 0.0025, { c: 0 });
    }
  }

  // ---- sleeping pillows, flat on the mattress at the head, where a person lying on the bed rests their head
  for (const pl of lay.pillows) {
    const pz = Math.max(pl.z, mz0 + 0.01 + pl.d / 2);
    const g = q.puff > 0 ? softCushion(pl.w, PILLOW_HEIGHT_M, pl.d, { r: 0.045, puff: 0.03, seg: softSeg(q) }) : roundedBoxBetween(-pl.w / 2, pl.w / 2, -PILLOW_HEIGHT_M / 2, PILLOW_HEIGHT_M / 2, -pl.d / 2, pl.d / 2, 0.04, 1);
    if (q.ultra) settle(g, 'pillow', pl.x * 5 + 2);
    g.translate(pl.x, S + PILLOW_HEIGHT_M / 2, pz);
    parts.put('pillows', pillowM, fitTop(g, H - 0.004), { grain: 'x' });
  }
  void H;
  return parts.done();
}
