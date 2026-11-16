// Seating generators: sofa (2, 3 seats or an L with a chaise), window seat / storage bench (rectangular or with a curved end),
// and the dining set (a table with chairs tucked in). Footprint and heights are exactly the item's.
import * as THREE from 'three';
import { roundedBoxBetween } from '../furniture-parts';
import { softCushion } from './soft';
import { Parts, boxGeo, role } from './core';
import type { GenEnv, GenSize, Roles } from './core';
import { prism, roundedRectOutline, rod, taperedLeg } from './geo';

// ---------------------------------------------------------------- sofa

export type SofaArms = 'round' | 'box' | 'none';
export type SofaLegs = 'wood' | 'metal' | 'plinth';
export interface SofaParams {
  /** seats across, 0 = from the width */
  seats: number;
  arms: SofaArms;
  legs: SofaLegs;
  /** an L: a chaise at one end, only when the box is deep and wide enough */
  chaise: 'auto' | 'none' | 'left' | 'right';
  /** accent cushions at the ends */
  cushions: number;
}
export const SOFA_DEFAULTS: SofaParams = { seats: 0, arms: 'round', legs: 'wood', chaise: 'auto', cushions: 2 };

export function buildSofa(env: GenEnv, size: GenSize, p: SofaParams, roles: Roles): THREE.Group {
  const { w, d, h: Hh, s: S } = size;
  const q = env.q;
  const H = Math.max(Hh, S + 0.2);
  const parts = new Parts(env, 'gen:sofa');
  const fab = role(roles, 'fabric'), legM = role(roles, 'legs', 'case', 'handle'), acc = role(roles, 'cushion', 'accent', 'fabric');
  const legH = p.legs === 'plinth' ? 0.05 : 0.11;
  const frameTop = 0.27;
  // 'auto': a box this deep and wide is an L-shaped sofa with a chaise at its right end
  const chaiseWanted = p.chaise === 'auto' ? 'right' : p.chaise;
  const chaise: 'none' | 'left' | 'right' = chaiseWanted !== 'none' && d >= 1.3 && w >= 2.2 ? chaiseWanted : 'none';
  const sd = chaise === 'none' ? d : Math.min(d, 0.95);            // depth of the straight part
  const cwChaise = chaise === 'none' ? 0 : 0.85;
  const aw = p.arms === 'none' ? 0.04 : 0.17;
  // the straight part runs along the back (z = -d/2 .. -d/2 + sd); the chaise block runs the full depth at one end
  const zb0 = -d / 2, zb1 = -d / 2 + sd;
  const sx0 = chaise === 'left' ? -w / 2 + cwChaise : -w / 2;
  const sx1 = chaise === 'right' ? w / 2 - cwChaise : w / 2;

  // legs
  const xs = w < 1.6 ? [-1, 1] : [-1, 0, 1];
  if (p.legs === 'plinth') {
    parts.box('sofa-legs', legM, -w / 2 + 0.05, w / 2 - 0.05, 0, legH, -d / 2 + 0.05, d / 2 - 0.05, { c: 0 });
  } else {
    for (const sx of xs) for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.08), z = sz * (d / 2 - 0.08);
      if (p.legs === 'metal') parts.put('sofa-legs', legM, rod({ x, y: 0, z }, { x, y: legH + 0.01, z }, 0.012, q.sides));
      else parts.put('sofa-legs', legM, taperedLeg(x, z, legH + 0.01, 0.027, 0.016, q.sides));
    }
  }
  // frame, arms and back
  parts.put('sofa-frame', fab, roundedBoxBetween(sx0, sx1, legH, frameTop, zb0, zb1, 0.03, q.seg));
  if (chaise !== 'none') {
    const cx0 = chaise === 'left' ? -w / 2 : w / 2 - cwChaise, cx1 = cx0 + cwChaise;
    parts.put('sofa-frame', fab, roundedBoxBetween(cx0, cx1, legH, frameTop, zb0, d / 2, 0.03, q.seg));
  }
  const armTop = Math.min(S + 0.2, H - 0.02);
  const armR = p.arms === 'round' ? 0.075 : 0.025;
  const left = chaise === 'left' ? 0 : 1, right = chaise === 'right' ? 0 : 1;
  if (p.arms !== 'none') {
    if (left) parts.put('sofa-body', fab, roundedBoxBetween(sx0, sx0 + aw, legH, armTop, zb0, zb1, armR, q.seg));
    if (right) parts.put('sofa-body', fab, roundedBoxBetween(sx1 - aw, sx1, legH, armTop, zb0, zb1, armR, q.seg));
  }
  parts.put('sofa-body', fab, roundedBoxBetween(sx0, sx1, legH, H - 0.02, zb0, zb0 + 0.2, 0.05, q.seg));
  if (chaise !== 'none') {
    const cx0 = chaise === 'left' ? -w / 2 : w / 2 - cwChaise;
    parts.put('sofa-body', fab, roundedBoxBetween(cx0, cx0 + cwChaise, legH, H - 0.02, zb0, zb0 + 0.2, 0.05, q.seg));
  }

  // cushions
  const inner0 = sx0 + (left && p.arms !== 'none' ? aw : 0), inner1 = sx1 - (right && p.arms !== 'none' ? aw : 0);
  const n = p.seats > 0 ? Math.round(p.seats) : Math.max(1, Math.round((inner1 - inner0) / 0.62));
  const cw = (inner1 - inner0) / n;
  const seatH = S + 0.03 - frameTop;
  const cd = sd - 0.2;
  // one welded soft pad per cushion (src/look/gen/soft.ts): plump, rounded, no creases; the lowest tier draws a plain rounded box
  const cush = (cwid: number, ch: number, cdep: number, puff: number, rad?: number): THREE.BufferGeometry =>
    q.tier === 'low' ? roundedBoxBetween(-cwid / 2, cwid / 2, -ch / 2, ch / 2, -cdep / 2, cdep / 2, Math.min(0.04, ch / 2.5), 1)
      : softCushion(cwid, ch, cdep, { r: rad ?? Math.min(0.055, ch / 2.6), puff, seg: q.tier === 'high' && n <= 3 && chaise === 'none' ? 3 : 2 });
  for (let i = 0; i < n; i++) {
    const x = inner0 + cw * (i + 0.5);
    const g = cush(cw - 0.01, seatH, cd, 0.014);
    g.translate(x, frameTop + seatH / 2, zb1 - cd / 2);
    parts.put('sofa-seat', fab, g, { grain: 'x' });
  }
  if (chaise !== 'none') {
    const cx = chaise === 'left' ? -w / 2 + cwChaise / 2 : w / 2 - cwChaise / 2;
    const g = cush(cwChaise - 0.01, seatH, d - 0.2, 0.014);
    g.translate(cx, frameTop + seatH / 2, d / 2 - (d - 0.2) / 2);
    parts.put('sofa-seat', fab, g, { grain: 'x' });
  }
  const lean = (8 * Math.PI) / 180;
  const len = (H - S) / Math.cos(lean);
  const backCount = n + (chaise !== 'none' ? 1 : 0);
  for (let i = 0; i < backCount; i++) {
    const isChaise = i === n;
    const x = isChaise ? (chaise === 'left' ? -w / 2 + cwChaise / 2 : w / 2 - cwChaise / 2) : inner0 + cw * (i + 0.5);
    const wid = isChaise ? cwChaise - 0.01 : cw - 0.01;
    const g = cush(wid, len, 0.17, 0.016, 0.06);
    g.rotateX(-lean);
    g.computeBoundingBox();
    g.translate(x, H - g.boundingBox!.max.y, zb0 + 0.2 + 0.07);
    parts.put('sofa-back', fab, g, { grain: 'x' });
  }
  // accent cushions at the ends of the seat
  const nA = Math.max(0, Math.min(4, Math.round(p.cushions)));
  for (let i = 0; i < nA; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * ((inner1 - inner0) / 2 - 0.26) + (inner0 + inner1) / 2;
    const g = cush(0.42, 0.42, 0.14, 0.035, 0.07);
    g.rotateX(-0.34);
    g.rotateY(side * 0.2);
    g.translate(x, S + 0.18, zb0 + 0.2 + 0.2);
    parts.put('sofa-cushions', acc, g, { tile: 0.34 });
  }
  return parts.done();
}

// ---------------------------------------------------------------- window seat / storage bench

export type BenchShape = 'rect' | 'curved-end' | 'curved-both';
export interface BenchParams {
  shape: BenchShape;
  /** the seat pad */
  cushion: boolean;
  /** radius of the rounded end(s), 0 = from the depth */
  radiusM: number;
  /** which end is curved */
  curveSide: 'left' | 'right';
}
export const BENCH_DEFAULTS: BenchParams = { shape: 'curved-end', cushion: true, radiusM: 0, curveSide: 'right' };

export function buildBench(env: GenEnv, size: GenSize, p: BenchParams, roles: Roles): THREE.Group {
  const { w, d, s: S } = size;
  const H = Math.max(size.h, S);
  const q = env.q;
  const parts = new Parts(env, 'gen:bench');
  const body = role(roles, 'case'), pad = role(roles, 'accent', 'fabric'), dark = role(roles, 'plinth', 'handle');
  const r = p.radiusM > 0 ? Math.min(p.radiusM, d, w / 2) : Math.min(d * 0.95, 0.5, w / 2);
  const rc: [number, number, number, number] = p.shape === 'rect' ? [0, 0, 0, 0]
    : p.shape === 'curved-both' ? [r, r, r, r]
      : p.curveSide === 'right' ? [0, r, r, 0] : [r, 0, 0, r];
  const seg = q.tier === 'low' ? 4 : 8;
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const padT = p.cushion ? 0.1 : 0;
  const plinth = 0.06;
  // dark recessed plinth under a wooden body
  parts.put('bench-plinth', dark, prism(roundedRectOutline(x0 + 0.04, x1 - 0.04, z0 + 0.04, z1 - 0.04, rc.map((v) => Math.max(0, v - 0.04)) as [number, number, number, number], seg), 0, plinth + 0.002, 0));
  parts.put('bench-body', body, prism(roundedRectOutline(x0, x1, z0, z1, rc, seg), plinth, S - padT, 0.006), { grain: 'x' });
  if (p.cushion) {
    const o = 0.006;
    parts.put('bench-pad', pad, prism(roundedRectOutline(x0 + o, x1 - o, z0 + o, z1 - o, rc.map((v) => Math.max(0, v - o)) as [number, number, number, number], seg), S - padT, S, 0.03));
  }
  void H;
  return parts.done();
}

// ---------------------------------------------------------------- dining set

export interface DiningParams {
  chairs: number;
  /** chair back style */
  chair: 'padded' | 'slat';
  legs: 'tapered' | 'square';
}
export const DINING_DEFAULTS: DiningParams = { chairs: 6, chair: 'padded', legs: 'tapered' };

function diningChair(parts: Parts, size: GenSize, x: number, side: 1 | -1, wood: ReturnType<typeof role>, fab: ReturnType<typeof role>, p: DiningParams): void {
  const q = parts.env.q;
  const H = size.h;
  const seatW = 0.44, seatD = 0.43, seatY = 0.45;
  const zc = side * (size.d / 2 - seatD / 2);
  const rb = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number): THREE.BufferGeometry =>
    q.seg > 1 ? roundedBoxBetween(x0, x1, y0, y1, z0, z1, r, 1) : boxGeo(x0, x1, y0, y1, z0, z1, 0);
  parts.put('chair-seats', fab, rb(x - seatW / 2, x + seatW / 2, seatY - 0.045, seatY + 0.005, zc - seatD / 2, zc + seatD / 2, 0.02), { grain: 'x' });
  const lh = seatY - 0.045;
  for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
    const px = x + lx * (seatW / 2 - 0.03), pz = zc + lz * (seatD / 2 - 0.03);
    parts.put('chair-legs', wood, rod({ x: px, y: 0, z: pz }, { x: px + lx * 0.012, y: lh, z: pz + lz * 0.012 }, 0.0175, q.sides));
  }
  // back: a curved top rail on two posts, with a padded panel or slats
  const tilt = (7 * Math.PI) / 180;
  const base = seatY;
  const len = (H - base) / Math.cos(tilt);
  const zb = zc + side * (seatD / 2 - 0.02 - len * Math.sin(tilt));
  const mk = (geo: THREE.BufferGeometry, name: string, mat: ReturnType<typeof role>, opts = {}): void => {
    geo.rotateX(side * tilt);
    geo.translate(0, base, zb);
    parts.put(name, mat, geo, opts);
  };
  for (const lx of [-1, 1]) mk(rb(x + lx * (seatW / 2 - 0.02) - 0.014, x + lx * (seatW / 2 - 0.02) + 0.014, 0, len, -0.011, 0.011, 0.005), 'chair-legs', wood);
  mk(rb(x - seatW / 2, x + seatW / 2, len - 0.07, len, -0.014, 0.014, 0.012), 'chair-legs', wood);
  if (p.chair === 'padded') mk(rb(x - seatW / 2 + 0.035, x + seatW / 2 - 0.035, len - 0.3, len - 0.09, -0.02, 0.014, 0.02), 'chair-seats', fab, { grain: 'x' });
  else for (const sx of [-1, 0, 1]) mk(rb(x + sx * 0.1 - 0.02, x + sx * 0.1 + 0.02, 0.08, len - 0.08, -0.007, 0.007, 0.003), 'chair-legs', wood);
}

/** where the chairs of a dining set stand, in the set's own frame (turned when the box is deeper than wide): x along the long side, which side of the table */
export function diningChairLayout(size: GenSize, p: DiningParams): { turned: boolean; w: number; d: number; slots: { x: number; side: 1 | -1 }[] } {
  const turned = size.d > size.w * 1.25;
  const w = turned ? size.d : size.w, d = turned ? size.w : size.d;
  // only as many chairs a side as the table's length holds, and none past its ends
  const nSide = Math.max(1, Math.min(Math.round(p.chairs / 2), Math.floor(w / 0.5)));
  const reach = Math.max(0, w / 2 - 0.22 - 0.02);
  const slots: { x: number; side: 1 | -1 }[] = [];
  for (const side of [-1, 1] as const) for (let i = 0; i < nSide; i++) {
    const k = nSide === 1 ? 0 : (i / (nSide - 1) - 0.5) * 2;
    slots.push({ x: k * Math.min(reach, w / 1.8 * 0.6), side });
  }
  return { turned, w, d, slots };
}

/** `chairs: false` builds the table alone (the model library puts its own chairs round it) */
export function buildDining(env: GenEnv, size: GenSize, p: DiningParams, roles: Roles, opts: { chairs?: boolean } = {}): THREE.Group {
  // the chairs line the long sides: a box drawn deeper than wide is built turned a quarter, so nothing leaves the drawn footprint
  if (size.d > size.w * 1.25) {
    const g = buildDining(env, { ...size, w: size.d, d: size.w }, p, roles, opts);
    const turned = new THREE.Group();
    g.rotation.y = Math.PI / 2;
    turned.add(g);
    turned.userData = { ...g.userData };
    return turned;
  }
  const { w, d, s: S } = size;
  const q = env.q;
  const parts = new Parts(env, 'gen:dining');
  const wood = role(roles, 'case'), top = role(roles, 'top', 'case'), fab = role(roles, 'fabric', 'accent');
  const tableD = Math.max(0.5, d - 0.8);
  const topT = 0.03;
  parts.box('table-top', top, -w / 2, w / 2, S - topT, S, -tableD / 2, tableD / 2, { c: 0.006, grain: 'x' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - 0.11), z = sz * (tableD / 2 - 0.11);
    if (p.legs === 'tapered') parts.put('table-legs', wood, rod({ x, y: 0, z }, { x: x * 0.985, y: S - topT, z }, 0.032, q.sides));
    else parts.box('table-legs', wood, x - 0.03, x + 0.03, 0, S - topT, z - 0.03, z + 0.03, { c: 0.003 });
  }
  const ax0 = w / 2 - 0.14, az0 = tableD / 2 - 0.12;
  parts.box('table-apron', wood, -ax0, ax0, S - topT - 0.07, S - topT, -az0 - 0.01, -az0 + 0.01, { c: 0.002, grain: 'x' });
  parts.box('table-apron', wood, -ax0, ax0, S - topT - 0.07, S - topT, az0 - 0.01, az0 + 0.01, { c: 0.002, grain: 'x' });
  if (opts.chairs !== false) for (const c of diningChairLayout(size, p).slots) diningChair(parts, size, c.x, c.side, wood, fab, p);
  return parts.done();
}
