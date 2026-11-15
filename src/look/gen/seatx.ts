// More seating and beds: recliner, bean bag, sofa-cum-bed (closed), bar stool, office chair, balcony chair and set; bunk bed, diwan, baby cot.
// Footprint and heights are exactly the item's.
import * as THREE from 'three';
import { puffedCushion, roundedBoxBetween } from '../furniture-parts';
import { Parts, role, roleOr } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { buildSofa } from './seating';
import { rod } from './geo';
import { CANE, CHROME, bar, disc, post, rsides, soft } from './kit';

// ---------------------------------------------------------------- seats

export const SEATX_VARIANTS = ['recliner', 'beanbag', 'sofabed', 'barstool', 'office', 'balcony-chair', 'balcony-set'] as const;
export type SeatXVariant = (typeof SEATX_VARIANTS)[number];
export interface SeatXParams { variant: SeatXVariant; legs: 'wood' | 'metal' }
export const SEATX_DEFAULTS: SeatXParams = { variant: 'recliner', legs: 'wood' };

/** a small chair of the balcony set, centred at (cx, cz) turned `rot`; fills a 0.5 x 0.45 footprint */
function caneChair(p: Parts, cx: number, cz: number, rot: number, H: number, frame: MatSpec, cane: MatSpec, pad: MatSpec, wd: number, dp: number, S: number): void {
  const m = new THREE.Matrix4().makeRotationY(rot).setPosition(cx, 0, cz);
  const put = (name: string, mat: MatSpec, g: THREE.BufferGeometry, o = {}): void => p.put(name, mat, g.applyMatrix4(m), o);
  const b = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const q = p.env.q;
  for (const lx of [-1, 1]) for (const lz of [-1, 1]) put('chair-legs', frame, rod({ x: lx * (wd / 2 - 0.02), y: 0, z: lz * (dp / 2 - 0.02) }, { x: lx * (wd / 2 - 0.02), y: S - 0.05, z: lz * (dp / 2 - 0.02) }, 0.016, q.sides));
  put('chair-seat', cane, b(-wd / 2, wd / 2, S - 0.05, S - 0.02, -dp / 2, dp / 2));
  put('chair-pad', pad, soft(p.env, -wd / 2 + 0.02, wd / 2 - 0.02, S - 0.02, S, -dp / 2 + 0.02, dp / 2 - 0.02, 0.01), { tile: 0.34 });
  for (const lx of [-1, 1]) put('chair-legs', frame, b(lx * (wd / 2 - 0.02) - 0.015, lx * (wd / 2 - 0.02) + 0.015, S - 0.05, H, -dp / 2, -dp / 2 + 0.03));
  put('chair-legs', frame, b(-wd / 2, wd / 2, H - 0.05, H, -dp / 2, -dp / 2 + 0.03));
  for (const y of [S + 0.12, S + 0.24, S + 0.36]) put('chair-back', cane, b(-wd / 2 + 0.04, wd / 2 - 0.04, y, y + 0.05, -dp / 2 + 0.005, -dp / 2 + 0.022));
}

export function buildSeatX(env: GenEnv, size: GenSize, p: SeatXParams, roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (SEATX_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'recliner';
  const q = env.q;
  const fab = role(roles, 'fabric', 'accent'), legM = role(roles, 'legs', 'case', 'handle'), acc = role(roles, 'cushion', 'accent', 'fabric'), body = role(roles, 'case');

  if (v === 'sofabed') {
    const g = buildSofa(env, size, { seats: 3, arms: 'box', legs: p.legs, chaise: 'none', cushions: 2 }, roles);
    g.name = 'gen:sofabed';
    return g;
  }
  const parts = new Parts(env, `gen:seatx`);
  if (v === 'recliner') {
    const legH = 0.1;
    const armW = 0.14;
    // a metal base, the seat and the arms, a leaning back with a head roll, and the footrest folded under the front
    for (const sx of [-1, 1]) parts.box('recliner-base', roleOr(roles, { key: 'blackMetal' }, 'reclinerBase'), sx * (w / 2 - 0.08) - 0.03, sx * (w / 2 - 0.08) + 0.03, 0, legH, -d / 2 + 0.1, d / 2 - 0.1, { c: 0.003 });
    parts.put('recliner-frame', fab, roundedBoxBetween(-w / 2, w / 2, legH, 0.3, -d / 2, d / 2, 0.04, q.seg));
    for (const sx of [-1, 1]) parts.put('recliner-arms', fab, roundedBoxBetween(sx > 0 ? w / 2 - armW : -w / 2, sx > 0 ? w / 2 : -w / 2 + armW, legH, 0.64, -d / 2 + 0.05, d / 2 - 0.1, 0.06, q.seg));
    parts.put('recliner-seat', fab, soft(env, -w / 2 + armW + 0.005, w / 2 - armW - 0.005, 0.3, S, -d / 2 + 0.28, d / 2 - 0.05, 0.03), { grain: 'x' });
    const lean = (14 * Math.PI) / 180;
    const back = soft(env, -w / 2 + armW + 0.005, w / 2 - armW - 0.005, 0, (H - 0.3) / Math.cos(lean) - 0.04, -0.09, 0.09, 0.03);
    back.rotateX(-lean);
    back.translate(0, 0.3, -d / 2 + 0.2);
    back.computeBoundingBox();
    back.translate(0, H - back.boundingBox!.max.y, -d / 2 - back.boundingBox!.min.z);
    parts.put('recliner-back', fab, back, { grain: 'x' });
    // the back's lower edge must reach the rear of the box
    parts.put('recliner-frame', fab, roundedBoxBetween(-w / 2 + armW, w / 2 - armW, 0.3, 0.62, -d / 2, -d / 2 + 0.12, 0.04, q.seg));
    parts.put('recliner-lever', roleOr(roles, { key: 'blackMetal' }, 'reclinerBase'), rod({ x: w / 2 - 0.04, y: 0.52, z: d / 2 - 0.3 }, { x: w / 2 - 0.04, y: 0.46, z: d / 2 - 0.2 }, 0.012, 6));
    // the footrest, closed: a padded panel across the front under the seat, to the front of the box
    parts.put('recliner-footrest', fab, roundedBoxBetween(-w / 2 + armW, w / 2 - armW, 0.12, 0.3, d / 2 - 0.1, d / 2, 0.03, q.seg));
  } else if (v === 'beanbag') {
    const seg = Math.max(12, q.sides * 2);
    const seat = new THREE.SphereGeometry(1, seg, Math.max(8, seg / 2));
    seat.scale(w / 2, S / 2, d / 2);
    seat.translate(0, S / 2, 0);
    parts.put('bean-body', fab, seat, { tile: 0.4 });
    const lump = new THREE.SphereGeometry(1, seg, Math.max(8, seg / 2));
    lump.scale(w / 2 - 0.08, H / 2, 0.25);
    lump.translate(0, H / 2, -d / 2 + 0.25);
    parts.put('bean-body', fab, lump, { tile: 0.4 });
    // the seam across the top of the back
    parts.put('bean-seam', acc, new THREE.TorusGeometry(0.22, 0.008, 5, 12, Math.PI).rotateX(Math.PI / 2).translate(0, H * 0.78, -d / 2 + 0.25));
  } else if (v === 'barstool') {
    const r = w / 2;
    const seg = rsides(env);
    disc(parts, 'stool-seat', acc, 0, 0, S - 0.05, S, r);
    disc(parts, 'stool-seat', legM, 0, 0, S - 0.065, S - 0.05, r - 0.03);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const fx = Math.cos(a) * (r - 0.03), fz = Math.sin(a) * (r - 0.03);
      parts.put('stool-legs', legM, rod({ x: fx, y: 0, z: fz }, { x: Math.cos(a) * (r - 0.06), y: S - 0.06, z: Math.sin(a) * (r - 0.06) }, 0.013, seg));
    }
    parts.put('stool-ring', legM, new THREE.TorusGeometry(r - 0.065, 0.008, 5, seg * 2).rotateX(Math.PI / 2).translate(0, 0.28, 0));
    // a low curved back on two posts behind the seat
    for (const sx of [-1, 1]) parts.put('stool-back', legM, rod({ x: sx * (r - 0.05), y: S - 0.05, z: -r + 0.04 }, { x: sx * (r - 0.05), y: H, z: -r + 0.04 }, 0.01, seg));
    parts.put('stool-back', acc, roundedBoxBetween(-r + 0.04, r - 0.04, H - 0.14, H, -r + 0.01, -r + 0.05, 0.01, 1));
  } else if (v === 'office') {
    const R = d / 2 - 0.025;
    const metal = roleOr(roles, { key: 'blackMetal' }, 'officeBase');
    // five-star base on casters (one leg to the back), gas column, seat and back with two arms: the arm pads reach the box's width
    for (let k = 0; k < 5; k++) {
      const a = (k * 2 * Math.PI) / 5 + Math.PI;
      const x = Math.sin(a) * R, z = Math.cos(a) * R;
      parts.put('office-base', metal, rod({ x: 0, y: 0.09, z: 0 }, { x, y: 0.07, z }, 0.016, 6));
      parts.put('office-casters', metal, new THREE.CylinderGeometry(0.025, 0.025, 0.05, 8).translate(x, 0.025, z));
    }
    parts.put('office-column', CHROME, rod({ x: 0, y: 0.08, z: 0 }, { x: 0, y: 0.4, z: 0 }, 0.025, 8));
    parts.put('office-seat', fab, roundedBoxBetween(-0.26, 0.26, 0.4, S, -0.2, d / 2, 0.04, q.seg), { grain: 'x' });
    const lean = (8 * Math.PI) / 180;
    const back = roundedBoxBetween(-0.22, 0.22, 0, H - S - 0.08, -0.03, 0.03, 0.03, q.seg);
    back.rotateX(-lean);
    back.translate(0, S + 0.08, -0.22);
    back.computeBoundingBox();
    back.translate(0, H - back.boundingBox!.max.y, 0);
    parts.put('office-back', fab, back, { grain: 'x' });
    parts.put('office-back-support', metal, rod({ x: 0, y: S, z: -0.1 }, { x: 0, y: S + 0.14, z: -0.22 }, 0.012, 6));
    for (const sx of [-1, 1]) {
      parts.put('office-arms', metal, rod({ x: sx * (w / 2 - 0.03), y: S, z: -0.05 }, { x: sx * (w / 2 - 0.03), y: S + 0.2, z: -0.05 }, 0.011, 6));
      parts.put('office-arms', fab, roundedBoxBetween(sx * (w / 2 - 0.03) - 0.03, sx * (w / 2 - 0.03) + 0.03, S + 0.2, S + 0.225, -0.2, 0.1, 0.01, 1));
    }
  } else if (v === 'balcony-chair') {
    caneChair(parts, 0, 0, 0, H, legM, roleOr(roles, CANE, 'cane'), acc, w, d, S);
  } else {
    // balcony set: a round table in the middle and a chair at each end facing it
    const R = d / 2;
    const tableH = 0.5;
    disc(parts, 'table-top', role(roles, 'top', 'case'), 0, 0, tableH - 0.03, tableH, R);
    post(parts, 'table-legs', legM, 0, 0, 0, tableH - 0.03, 0.025);
    disc(parts, 'table-legs', legM, 0, 0, 0, 0.02, 0.17);
    const cd = 0.45, wd = 0.5;
    for (const s of [-1, 1]) caneChair(parts, s * (w / 2 - cd / 2), 0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.85, legM, roleOr(roles, CANE, 'cane'), acc, wd, cd, S);
    void body;
  }
  return parts.done();
}

// ---------------------------------------------------------------- beds

export const BEDX_VARIANTS = ['bunk', 'diwan', 'cot'] as const;
export type BedXVariant = (typeof BEDX_VARIANTS)[number];
export interface BedXParams { variant: BedXVariant }
export const BEDX_DEFAULTS: BedXParams = { variant: 'bunk' };

export function buildBedX(env: GenEnv, size: GenSize, p: BedXParams, roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (BEDX_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'bunk';
  const parts = new Parts(env, 'gen:bedx');
  const q = env.q;
  const wood = role(roles, 'bedFrame', 'case'), sheet = role(roles, 'bedding', 'duvet', 'fabric'), fab = role(roles, 'fabric', 'accent'), pil = role(roles, 'pillow', 'bedding');
  const mat: MatSpec = role(roles, 'bedding', 'fabric');
  const inner = size.inner ?? { w: w - 0.1, d: d - 0.1 };

  if (v === 'bunk') {
    const fw = w - 0.09;                     // the frame; the ladder takes the rest on the right
    const x0 = -w / 2, x1 = x0 + fw, xc = (x0 + x1) / 2;
    const pz = d / 2 - 0.025;
    // four posts to the top, and a rail round each deck
    for (const sx of [x0 + 0.025, x1 - 0.025]) for (const sz of [-pz, pz]) parts.box('bunk-posts', wood, sx - 0.025, sx + 0.025, 0, H, sz - 0.025, sz + 0.025, { c: 0.003 });
    const deck = (y0: number, y1: number, name: string): void => {
      for (const sz of [-1, 1]) parts.box(name, wood, x0, x1, y0, y1, sz > 0 ? d / 2 - 0.05 : -d / 2, sz > 0 ? d / 2 : -d / 2 + 0.05, { c: 0.003 });
      for (const sx of [-1, 1]) parts.box(name, wood, sx > 0 ? x1 - 0.05 : x0, sx > 0 ? x1 : x0 + 0.05, y0, y1, -d / 2, d / 2, { c: 0.003 });
      parts.box('bunk-slats', wood, x0 + 0.05, x1 - 0.05, y0 + 0.02, y0 + 0.04, -d / 2 + 0.05, d / 2 - 0.05, { c: 0 });
    };
    deck(0.3, 0.38, 'bunk-lower-frame');
    const upY = S + 0.85;
    deck(upY - 0.12, upY - 0.04, 'bunk-upper-frame');
    for (const [y, tag] of [[0.38, 'lower'], [upY - 0.04, 'upper']] as const) {
      const top = tag === 'lower' ? S : upY + 0.01;
      parts.put(`bunk-${tag}-mattress`, mat, soft(env, xc - inner.w / 2, xc + inner.w / 2, y, top, -inner.d / 2, inner.d / 2, 0.015), { tile: 0.5 });
      parts.put(`bunk-${tag}-pillow`, pil, soft(env, xc - 0.22, xc + 0.22, top, top + 0.1, -inner.d / 2 + 0.05, -inner.d / 2 + 0.35, 0.03), { tile: 0.4 });
    }
    // guard rails along the open long side and the head of the upper bunk, to the full height
    parts.box('bunk-guard', wood, x0, x1, H - 0.08, H, -d / 2, -d / 2 + 0.04, { c: 0.003 });
    parts.box('bunk-guard', wood, x0, x0 + 0.04, H - 0.08, H, -d / 2, d / 2, { c: 0.003 });
    parts.box('bunk-guard', wood, x0, x0 + 0.04, upY, upY + 0.04, -d / 2, d / 2, { c: 0.003 });
    for (let z = -d / 2 + 0.2; z < d / 2 - 0.1; z += 0.22) parts.box('bunk-guard', wood, x0, x0 + 0.03, upY + 0.04, H - 0.08, z, z + 0.03, { c: 0.002 });
    parts.box('bunk-guard', wood, x0, x1, upY + 0.04, H - 0.08, -d / 2, -d / 2 + 0.03, { c: 0.002 });
    // the ladder on the right side: two rails and five rungs
    const lx0 = x1 + 0.005, lx1 = w / 2;
    for (const z of [-0.2, 0.14]) parts.box('bunk-ladder', wood, lx0, lx1, 0.05, upY, z, z + 0.035, { c: 0.002 });
    for (let i = 0; i < 5; i++) { const y = 0.25 + i * 0.25; parts.box('bunk-ladder', wood, lx0, lx1, y, y + 0.035, -0.2, 0.175, { c: 0.002 }); }
  } else if (v === 'diwan') {
    const legH = 0.12;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.put('diwan-legs', wood, rod({ x: sx * (w / 2 - 0.06), y: 0, z: sz * (d / 2 - 0.06) }, { x: sx * (w / 2 - 0.055), y: legH + 0.01, z: sz * (d / 2 - 0.055) }, 0.025, q.sides));
    parts.box('diwan-base', wood, -w / 2, w / 2, legH, 0.33, -d / 2, d / 2, { c: 0.004 });
    parts.put('diwan-mattress', mat, soft(env, -inner.w / 2, inner.w / 2, 0.33, S, -inner.d / 2, inner.d / 2, 0.02), { tile: 0.5 });
    // the back (head) panel up to the item's height, and a round bolster across the head
    parts.box('diwan-back', wood, -w / 2, w / 2, 0.33, H, -d / 2, -d / 2 + 0.05, { c: 0.004 });
    parts.put('diwan-back-pad', fab, soft(env, -w / 2 + 0.05, w / 2 - 0.05, S, H - 0.06, -d / 2 + 0.05, -d / 2 + 0.17, 0.03), { tile: 0.4 });
    for (const sx of [-1, 1]) parts.put('diwan-bolsters', pil, new THREE.CylinderGeometry(0.075, 0.075, 0.3, 12).rotateZ(Math.PI / 2).translate(sx * (inner.w / 2 - 0.2), S + 0.075, d / 2 - 0.18));
  } else {
    // cot: four posts, vertical bars on all sides, a top rail, a mattress at the lower position
    const pz = d / 2 - 0.02, px = w / 2 - 0.02;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.box('cot-posts', wood, sx * px - 0.02, sx * px + 0.02, 0, H, sz * pz - 0.02, sz * pz + 0.02, { c: 0.003 });
    for (const sz of [-1, 1]) parts.box('cot-rails', wood, -w / 2, w / 2, H - 0.06, H, sz > 0 ? d / 2 - 0.04 : -d / 2, sz > 0 ? d / 2 : -d / 2 + 0.04, { c: 0.003 });
    for (const sx of [-1, 1]) parts.box('cot-rails', wood, sx > 0 ? w / 2 - 0.04 : -w / 2, sx > 0 ? w / 2 : -w / 2 + 0.04, H - 0.06, H, -d / 2, d / 2, { c: 0.003 });
    parts.box('cot-rails', wood, -w / 2, w / 2, 0.28, 0.34, -d / 2, d / 2, { c: 0.003 });
    for (const sx of [-1, 1]) parts.box('cot-rails', wood, sx > 0 ? w / 2 - 0.04 : -w / 2, sx > 0 ? w / 2 : -w / 2 + 0.04, 0.28, 0.34, -d / 2, d / 2, { c: 0.003 });
    const barGeo = (x: number, z: number): void => parts.box('cot-bars', wood, x - 0.007, x + 0.007, 0.34, H - 0.06, z - 0.007, z + 0.007, { c: 0 });
    for (let x = -px + 0.07; x < px - 0.03; x += 0.07) for (const sz of [-1, 1]) barGeo(x, sz * (d / 2 - 0.02));
    for (let z = -pz + 0.07; z < pz - 0.03; z += 0.07) for (const sx of [-1, 1]) barGeo(sx * (w / 2 - 0.02), z);
    parts.put('cot-mattress', mat, soft(env, -inner.w / 2, inner.w / 2, 0.34, S, -inner.d / 2, inner.d / 2, 0.012), { tile: 0.5 });
    parts.put('cot-pillow', pil, soft(env, -0.16, 0.16, S, S + 0.05, -inner.d / 2 + 0.05, -inner.d / 2 + 0.3, 0.015), { tile: 0.4 });
  }
  void sheet; void puffedCushion; void bar;
  return parts.done();
}
