// Seating generators: sofa (2, 3 seats or an L with a chaise), window seat / storage bench (rectangular or with a curved end),
// and the dining set (a table with chairs tucked in). Footprint and heights are exactly the item's.
import * as THREE from 'three';
import { roundedBoxBetween } from '../furniture-parts';
import { softCushion } from './soft';
import { Parts, boxGeo, role, shade } from './core';
import type { GenEnv, GenSize, Roles } from './core';
import { prism, roundedRectOutline, rod, taperedLeg } from './geo';
import { crownedPad, padCord, pinchCorners } from './ultra-seat';

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
  /** loose cushions, one at each arm: 0, 1 or 2 (never more) */
  cushions: number;
  /** a woollen throw folded over one arm (SPEC 16.15.2), hanging down the arm's inner face above the seat: never on the seat */
  throw: SofaThrow;
}
export const SOFA_THROWS = ['left', 'right', 'none'] as const;
export type SofaThrow = (typeof SOFA_THROWS)[number];
/** a sofa carries at most this many loose cushions, pushed to its arms */
export const SOFA_MAX_CUSHIONS = 2;
const SOFA_CUSHION_M = 0.38;
export const SOFA_DEFAULTS: SofaParams = { seats: 0, arms: 'round', legs: 'wood', chaise: 'auto', cushions: 2, throw: 'left' };

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
  // the base and the frame under the cushions one step darker than the cushions: the seat and back read as separate pads even under flat light
  const frameM = shade(fab, 0.86);
  parts.put('sofa-frame', frameM, roundedBoxBetween(sx0, sx1, legH, frameTop, zb0, zb1, 0.03, q.seg));
  if (chaise !== 'none') {
    const cx0 = chaise === 'left' ? -w / 2 : w / 2 - cwChaise, cx1 = cx0 + cwChaise;
    parts.put('sofa-frame', frameM, roundedBoxBetween(cx0, cx1, legH, frameTop, zb0, d / 2, 0.03, q.seg));
  }
  const armTop = Math.min(S + 0.2, H - 0.02);
  // a box arm still has an upholstered edge: 4 cm round, not a sharp block (SPEC 16.15.2)
  const armR = p.arms === 'round' ? 0.075 : 0.04;
  const left = chaise === 'left' ? 0 : 1, right = chaise === 'right' ? 0 : 1;
  if (p.arms !== 'none') {
    // 2K: the arm is a body under a soft crowned pad of its own (the top of the pad is the arm's height, as before)
    const armBody = q.ultra ? armTop - 0.045 : armTop;
    if (left) parts.put('sofa-body', fab, roundedBoxBetween(sx0, sx0 + aw, legH, armBody, zb0, zb1, q.ultra ? 0.03 : armR, q.seg));
    if (right) parts.put('sofa-body', fab, roundedBoxBetween(sx1 - aw, sx1, legH, armBody, zb0, zb1, q.ultra ? 0.03 : armR, q.seg));
    if (q.ultra) {
      for (const [ax0, on] of [[sx0, left], [sx1 - aw, right]] as const) {
        if (!on) continue;
        const pad = crownedPad(aw, 0.07, zb1 - zb0, Math.min(0.06, aw / 2.4), 0.02);
        pad.translate(ax0 + aw / 2, armTop - 0.035, (zb0 + zb1) / 2);
        parts.put('sofa-body', fab, pad, { grain: 'x' });
      }
    }
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
    q.ultra ? crownedPad(cwid, ch, cdep, rad ?? Math.min(0.06, ch / 2.4), Math.max(puff * 2.6, 0.036)) :
    q.tier === 'low' ? roundedBoxBetween(-cwid / 2, cwid / 2, -ch / 2, ch / 2, -cdep / 2, cdep / 2, Math.min(0.04, ch / 2.5), 1)
      : softCushion(cwid, ch, cdep, { r: rad ?? Math.min(0.055, ch / 2.6), puff, seg: q.ultra ? 4 : q.tier === 'high' && n <= 2 && chaise === 'none' ? 3 : 2 });
  for (let i = 0; i < n; i++) {
    const x = inner0 + cw * (i + 0.5);
    const g = cush(cw - (q.ultra ? 0.018 : 0.01), seatH, cd, 0.014);
    g.translate(x, frameTop + seatH / 2, zb1 - cd / 2);
    parts.put('sofa-seat', fab, g, { grain: 'x' });
    // 2K: a cord round the top edge of each pad (front and both sides) instead of the one front rod
    if (q.ultra) padCord(parts, fab, x, cw - 0.018, frameTop + seatH, zb1 - cd, zb1);
    // piping along the front edge of each seat pad, and a seam line where the pads meet
    else if (q.tier !== 'low') {
      const pipe = shade(fab, 0.74);
      parts.put('sofa-piping', pipe, rod({ x: x - (cw - 0.03) / 2, y: frameTop + seatH - 0.012, z: zb1 - 0.0045 }, { x: x + (cw - 0.03) / 2, y: frameTop + seatH - 0.012, z: zb1 - 0.0045 }, 0.0045, 6), { noShadow: true });
    }
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
    const g = cush(wid - (q.ultra ? 0.008 : 0), len, 0.17, 0.016, 0.06);
    g.rotateX(-lean);
    g.computeBoundingBox();
    g.translate(x, H - g.boundingBox!.max.y, zb0 + 0.2 + 0.07);
    parts.put('sofa-back', fab, g, { grain: 'x' });
    if (q.ultra) {
      // a cord along the top of each back pad
      g.computeBoundingBox();
      const bb = g.boundingBox!, zc = (bb.min.z + bb.max.z) / 2;
      const cord = shade(fab, 0.78), yy = bb.max.y - 0.016;
      parts.put('sofa-piping', cord, rod({ x: x - wid / 2 + 0.03, y: yy, z: zc }, { x: x + wid / 2 - 0.03, y: yy, z: zc }, 0.0055, 12), { noShadow: true });
    }
  }
  // loose cushions: at most two, one at each arm, standing against the back pad (thin, leaning with it). They stay behind the line of a
  // sitter's hips (core/poses.ts seats them 0.30 m from the front edge), so a person sits in front of one and is never under it
  // the two ends of the whole back: an arm's inner face, or the outer edge of a chaise (its back runs on behind it)
  const o0 = chaise === 'left' ? -w / 2 + 0.04 : inner0, o1 = chaise === 'right' ? w / 2 - 0.04 : inner1;
  const nA = Math.max(0, Math.min(SOFA_MAX_CUSHIONS, Math.round(p.cushions)));
  for (let i = 0; i < nA; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * ((o1 - o0) / 2 - SOFA_CUSHION_M / 2 - 0.02) + (o0 + o1) / 2;
    const g = q.ultra ? pinchCorners(crownedPad(SOFA_CUSHION_M, SOFA_CUSHION_M, 0.1, 0.04, 0.06), SOFA_CUSHION_M, SOFA_CUSHION_M, 0.1) : cush(SOFA_CUSHION_M, SOFA_CUSHION_M, 0.1, 0.03, 0.045);
    g.rotateX(-0.2);
    g.rotateY(side * 0.12);
    g.translate(x, S + 0.03 + SOFA_CUSHION_M / 2 - 0.005, zb0 + 0.2 + 0.2);
    parts.put('sofa-cushions', acc, g, { tile: 0.34 });
  }
  // a throw folded over one arm: it lies on the arm and hangs down the arm's inner face, its hem above the seat cushions, so a person
  // sits beside it, never on it. One arm only, not on an arm a chaise replaces, and only on a sofa of two seats or more (not an armchair).
  const throwSide = p.throw === 'left' ? -1 : p.throw === 'right' ? 1 : 0;
  if (throwSide !== 0 && w >= 1.4 && p.arms !== 'none' && (throwSide < 0 ? left : right)) {
    const armOuter = throwSide < 0 ? sx0 : sx1, armInner = throwSide < 0 ? sx0 + aw : sx1 - aw;
    const g = armThrow(q.tier, Math.abs(armInner - armOuter), armTop, S + 0.075, Math.min(0.46, sd - 0.36), armR);
    if (throwSide > 0) { g.scale(-1, 1, 1); flipWinding(g); }
    g.translate(armOuter, 0, zb1 - 0.04 - Math.min(0.46, sd - 0.36) / 2);
    parts.put('sofa-throw', throwTone(role(roles, 'accent', 'cushion', 'fabric'), fab), g, { grain: 'x', tile: 0.3 });
  }
  return parts.done();
}

/** the throw's colour: the room's accent (the cushions take the warm one), unless it is the sofa's own fabric (then a deeper shade of it) */
function throwTone(acc: ReturnType<typeof role>, fab: ReturnType<typeof role>): ReturnType<typeof role> {
  const base = acc.tint && acc.tint !== fab.tint ? acc : shade(fab, 0.72);
  return { key: base.key === 'weave' || base.key === 'quilt' ? base.key : 'weave', tint: base.tint };
}

/** reverses the triangles of an indexed or plain geometry (after a mirror) */
function flipWinding(g: THREE.BufferGeometry): void {
  const idx = g.index;
  if (idx) { for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); } idx.needsUpdate = true; }
  else {
    for (const attr of Object.values(g.attributes) as THREE.BufferAttribute[]) {
      const n = attr.itemSize;
      for (let i = 0; i + 2 < attr.count; i += 3) for (let k = 0; k < n; k++) { const a = attr.array[(i + 1) * n + k]; attr.array[(i + 1) * n + k] = attr.array[(i + 2) * n + k]; attr.array[(i + 2) * n + k] = a; }
      attr.needsUpdate = true;
    }
  }
  g.computeVertexNormals();
}

/**
 * A folded throw over a sofa arm, in the arm's frame: x from the arm's outer face (0) inwards, the arm `armW` wide with its top at `armTop`;
 * the cloth lies across the top, rolls over the inner edge and hangs down the inner face to `hemY`. `width` along z, centred on z = 0.
 * Thickness 12 mm, soft ripples on the hanging part; the whole cloth stays between x = 0 and the arm's inner face plus its thickness.
 */
function armThrow(tier: 'low' | 'medium' | 'high', armW: number, armTop: number, hemY: number, width: number, armR: number): THREE.BufferGeometry {
  const t = 0.012, r = Math.max(0.02, Math.min(armR, 0.05)) + t / 2;
  // the centreline of the cloth: across the top, round the inner edge, down the face
  const cx = armW - r + t / 2, cy = armTop - r + t / 2; // centre of the roll
  const pts: [number, number][] = [[0.025, armTop + t / 2]];
  const nb = tier === 'low' ? 2 : 6;
  for (let i = 0; i <= nb; i++) { const a = (Math.PI / 2) * (i / nb); pts.push([cx + Math.sin(a) * r, cy + Math.cos(a) * r]); }
  pts.push([armW + t / 2, hemY]);
  // the outline: the centreline offset half the thickness each side, outward then back
  const off = (sgn: number): [number, number][] => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [p[0] + (dy / l) * (t / 2) * sgn, p[1] - (dx / l) * (t / 2) * sgn];
  });
  const outer = off(1), inner = off(-1).reverse();
  const shape = new THREE.Shape();
  shape.moveTo(outer[0][0], outer[0][1]);
  for (const q of [...outer.slice(1), ...inner]) shape.lineTo(q[0], q[1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, steps: tier === 'low' ? 1 : 10, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -width / 2);
  // soft ripples on the hanging part and a hem that is not ruler straight; never past the arm's inner face plus the cloth
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), z = pos.getZ(i);
    const below = Math.max(0, Math.min(1, (cy - y) / Math.max(0.05, cy - hemY)));
    if (below <= 0) continue;
    const wave = Math.sin((z / width) * Math.PI * 3.2 + 0.7) * 0.5 + 0.5; // 0..1
    pos.setX(i, pos.getX(i) - wave * 0.006 * below);
    pos.setY(i, y + Math.sin((z / width) * Math.PI * 2.1) * 0.008 * below);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
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

// ---------------------------------------------------------------- ottoman / pouf (SPEC 16.15.2)

export interface OttomanParams {
  /** short legs under the upholstered body, or none (the body stands on the floor) */
  legs: 'wood' | 'metal' | 'none';
  /** buttons on the top cushion */
  top: 'tufted' | 'plain';
}
export const OTTOMAN_DEFAULTS: OttomanParams = { legs: 'wood', top: 'tufted' };

/** the buttons of a diamond-tufted top w x d: rows about 15 cm apart, every other row offset by half a step with one button fewer, 11 cm or
 *  more in from the edge (the rolled edge stays smooth) */
export function tuftButtons(w: number, d: number): { x: number; z: number }[] {
  const mx = Math.min(0.12, w * 0.19), mz = Math.min(0.12, d * 0.19);
  const uw = w - 2 * mx, ud = d - 2 * mz;
  const nx = Math.max(2, Math.round(uw / 0.17) + 1), nz = Math.max(2, Math.round(ud / 0.15) + 1);
  const sx = uw / (nx - 1), sz = ud / (nz - 1);
  const out: { x: number; z: number }[] = [];
  for (let j = 0; j < nz; j++) {
    const odd = j % 2 === 1;
    for (let i = 0; i < (odd ? nx - 1 : nx); i++) out.push({ x: -uw / 2 + (i + (odd ? 0.5 : 0)) * sx, z: -ud / 2 + j * sz });
  }
  return out;
}

const smoothstep = (e0: number, e1: number, x: number): number => { const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

/**
 * Sinks a top cushion (built centred on the origin, `t` thick) into diamond tufting: a dimple at each button and a shallow crease along the
 * diamond between neighbouring buttons, faded out toward the rolled edge and below the crown. It only ever pushes down, so the cushion stays
 * inside its box. Returns the height of the surface over each button (where the button sits), in the cushion's frame.
 */
function tuftTop(g: THREE.BufferGeometry, t: number, buttons: { x: number; z: number }[], depth: number, sigma: number, crease: number, edge: number, w: number, d: number): number[] {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  // the diamond's edges: each button to its neighbours in the next row
  const links: [number, number][] = [];
  for (let a = 0; a < buttons.length; a++) for (let b = a + 1; b < buttons.length; b++) {
    const dx = buttons[b].x - buttons[a].x, dz = buttons[b].z - buttons[a].z;
    if (Math.abs(dz) > 1e-6 && Math.abs(dx) > 1e-6 && Math.hypot(dx, dz) < 0.26) links.push([a, b]);
  }
  const s2 = 2 * sigma * sigma, c2 = 2 * crease * crease;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const up = smoothstep(0, t * 0.5, y);
    if (up <= 0) continue;
    const fade = smoothstep(edge * 0.5, edge * 1.4, Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z)));
    if (fade <= 0) continue;
    let dimple = 0;
    for (const b of buttons) dimple += Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / s2);
    let fold = 0;
    for (const [a, b] of links) {
      const A = buttons[a], B = buttons[b];
      const ux = B.x - A.x, uz = B.z - A.z;
      const k = Math.max(0, Math.min(1, ((x - A.x) * ux + (z - A.z) * uz) / (ux * ux + uz * uz)));
      const ex = A.x + k * ux - x, ez = A.z + k * uz - z;
      fold = Math.max(fold, Math.exp(-(ex * ex + ez * ez) / c2));
    }
    pos.setY(i, y - depth * Math.min(1, dimple + 0.4 * fold) * up * fade);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  // the surface over each button: the top's vertex nearest to it (the underside's vertices are still in the buffer, below the middle)
  return buttons.map((b) => {
    let best = Infinity, y = t / 2 - depth;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) <= 0) continue;
      const dist = Math.hypot(pos.getX(i) - b.x, pos.getZ(i) - b.z);
      if (dist < best) { best = dist; y = pos.getY(i); }
    }
    return y;
  });
}

/**
 * Drops the triangles of a closed pad's underside, inside its rolled edge (hidden where it sits on its body, which is inset by less than the
 * edge), so a fine grid costs only on the faces that show. `below`: the height under which a vertex belongs to the underside.
 */
function dropUnderside(g: THREE.BufferGeometry, below: number, hw: number, hd: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.getIndex();
  if (!idx) return;
  const under = (v: number): boolean => pos.getY(v) < below && Math.abs(pos.getX(v)) < hw && Math.abs(pos.getZ(v)) < hd;
  const keep: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (under(a) && under(b) && under(c)) continue;
    keep.push(a, b, c);
  }
  g.setIndex(keep);
}

/**
 * An upholstered footstool: a loose crowned top cushion with piping round its seam, an upholstered body a little inside it, and four short
 * tapered legs. The top cushion is the box's full footprint and its crown reaches the item's height; nothing leaves the box. A tufted top
 * (the default) is sunk into diamond tufting on medium and high: a dimple and a fabric-covered button at each tuft, shallow creases between
 * them, the rolled edge left smooth, so it reads as a stitched cushion rather than a padded slab.
 */
export function buildOttoman(env: GenEnv, size: GenSize, p: OttomanParams, roles: Roles): THREE.Group {
  const { w, d } = size;
  const H = Math.max(size.h, size.s);
  const q = env.q;
  const parts = new Parts(env, 'gen:ottoman');
  const fab = role(roles, 'accent', 'fabric'), legM = role(roles, 'legs', 'case', 'handle');
  const legH = p.legs === 'none' ? 0 : Math.min(0.08, H * 0.2);
  const topT = Math.min(0.11, Math.max(0.05, (H - legH) * 0.34));
  const inset = Math.min(0.014, w * 0.03, d * 0.03);
  const seg = q.tier === 'low' ? 1 : q.ultra ? 4 : q.tier === 'high' ? 3 : 2;
  const pad = (pw: number, ph: number, pd: number, r: number, puff: number): THREE.BufferGeometry =>
    q.tier === 'low' ? roundedBoxBetween(-pw / 2, pw / 2, -ph / 2, ph / 2, -pd / 2, pd / 2, Math.min(r, ph / 2.5), 1) : softCushion(pw, ph, pd, { r, puff, seg });
  // the body: from the legs to just inside the top cushion (it overlaps, so no gap shows at the seam)
  const by0 = legH, by1 = H - topT + 0.012;
  const body = pad(w - 2 * inset, by1 - by0, d - 2 * inset, Math.min(0.035, (by1 - by0) / 2.4), 0.006);
  body.translate(0, (by0 + by1) / 2, 0);
  parts.put('ottoman-body', shade(fab, 0.94), body, { grain: 'x' });
  const tufted = p.top === 'tufted' && q.tier !== 'low';
  const rTop = Math.min(0.045, topT / 2.2);
  const buttons = tufted ? tuftButtons(w, d) : [];
  let top: THREE.BufferGeometry;
  let buttonY: number[] = [];
  if (tufted) {
    // a fine grid over the top (cells of 2.5 cm on medium, 1.8 cm on high, 1.1 cm at 2K) so the dimples and creases are real relief
    const cell = q.ultra ? 0.011 : q.tier === 'high' ? 0.018 : 0.025;
    top = softCushion(w, topT, d, { r: rTop, puff: 0.012, seg, cells: [Math.max(4, Math.round((w - 2 * rTop) / cell)), 2, Math.max(4, Math.round((d - 2 * rTop) / cell))] });
    dropUnderside(top, -topT / 2 + 0.02, w / 2 - rTop, d / 2 - rTop);
    buttonY = tuftTop(top, topT, buttons, Math.min(0.02, topT * 0.22), Math.max(0.016, cell * 0.75), Math.max(0.006, cell * 0.55), rTop, w, d);
  } else {
    top = pad(w, topT, d, rTop, 0.016);
  }
  top.translate(0, H - topT / 2, 0);
  parts.put('ottoman-top', fab, top, { grain: 'x' });
  if (q.tier !== 'low') {
    // piping along the seam under the top cushion, one shade darker
    const y = H - topT + 0.006, e = 0.004, x0 = -w / 2 + e + 0.02, x1 = w / 2 - e - 0.02, z0 = -d / 2 + e + 0.02, z1 = d / 2 - e - 0.02;
    const pipe = shade(fab, 0.76);
    const rr = 0.0045, sides = 6;
    parts.put('ottoman-piping', pipe, rod({ x: x0, y, z: z1 + 0.012 }, { x: x1, y, z: z1 + 0.012 }, rr, sides), { noShadow: true });
    parts.put('ottoman-piping', pipe, rod({ x: x0, y, z: z0 - 0.012 }, { x: x1, y, z: z0 - 0.012 }, rr, sides), { noShadow: true });
    parts.put('ottoman-piping', pipe, rod({ x: x0 - 0.012, y, z: z0 }, { x: x0 - 0.012, y, z: z1 }, rr, sides), { noShadow: true });
    parts.put('ottoman-piping', pipe, rod({ x: x1 + 0.012, y, z: z0 }, { x: x1 + 0.012, y, z: z1 }, rr, sides), { noShadow: true });
    // fabric-covered buttons at the bottom of each dimple, a shade darker than the cover (the dimple's own shadow does the rest)
    buttons.forEach((b, i) => {
      const r = 0.009;
      const g = new THREE.SphereGeometry(r, q.ultra ? 10 : q.tier === 'high' ? 8 : 6, 4);
      g.scale(1, 0.5, 1);
      g.translate(b.x, H - topT / 2 + buttonY[i] + r * 0.2, b.z);
      parts.put('ottoman-buttons', shade(fab, 0.8), g, { noShadow: true });
    });
  }
  if (p.legs !== 'none') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.07), z = sz * (d / 2 - 0.07);
      if (p.legs === 'metal') parts.put('ottoman-legs', legM, rod({ x, y: 0, z }, { x, y: legH + 0.01, z }, 0.011, q.sides));
      else parts.put('ottoman-legs', legM, taperedLeg(x, z, legH + 0.01, 0.022, 0.014, q.sides));
    }
  }
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
    q.seg > 1 ? roundedBoxBetween(x0, x1, y0, y1, z0, z1, r, q.ultra ? 3 : 1) : boxGeo(x0, x1, y0, y1, z0, z1, 0);
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
