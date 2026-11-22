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
import { dressBedUltra } from './ultra-bed';
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
    // slats held in a frame, as a joiner makes one: two posts at the sides and a capping rail along the top (rounded over), the slats between
    // them standing a few millimetres back from the frame's face; behind them a dark back panel
    const post = Math.min(0.05, w * 0.05), cap = 0.04;
    parts.box('bed-headboard-back', dark, -w / 2 + post, w / 2 - post, hy0, H - cap, hz0, hz0 + 0.012, { c: 0 });
    for (const sx of [-1, 1]) parts.box('bed-headboard', head, sx < 0 ? -w / 2 : w / 2 - post, sx < 0 ? -w / 2 + post : w / 2, hy0, H, hz0, hz1, { c: 0.006 });
    parts.box('bed-headboard', head, -w / 2, w / 2, H - cap, H, hz0, hz1, { c: 0.008, grain: 'x' });
    const inner = w - 2 * post;
    const pitch = 0.05, n = Math.max(2, Math.round(inner / pitch));
    const sw = pitch * 0.62;
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + (i + 0.5) * (inner / n);
      parts.box('bed-headboard', head, x - sw / 2, x + sw / 2, hy0, H - cap, hz0 + 0.012, hz1 - 0.004, { c: 0.003 });
    }
  }

  // ---- mattress, kept clear of the headboard
  const mz0 = Math.max(-m.d / 2, hz1), mz1 = m.d / 2;
  const mh = S - baseTop;
  if (q.ultra) {
    // 2K: the mattress, a duvet with thickness and pleats, a turned-down band and two piped pillows (src/look/gen/ultra-bed.ts)
    dressBedUltra(parts, { w, d, H, S, baseTop, m, mz0, mz1, lay: bedLayout({ w, d }, size.inner), sheet, duvet: duvetM, pillow: pillowM, quilted: p.duvet === 'quilted' || duvetM.key === 'quilt', hasDuvet: p.duvet !== 'none' });
    return parts.done();
  }
  parts.put('mattress', sheet, roundedBoxBetween(-m.w / 2, m.w / 2, baseTop, S, mz0, mz1, Math.min(0.05, mh / 2.2), Math.max(2, q.seg)), { grain: 'x' });

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
    g.translate(pl.x, S + PILLOW_HEIGHT_M / 2, pz);
    parts.put('pillows', pillowM, fitTop(g, H - 0.004), { grain: 'x' });
  }
  void H;
  return parts.done();
}
