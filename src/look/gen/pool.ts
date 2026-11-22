// Pool-side pieces (SPEC 19.3): lounger, parasol, chair, table, shower post, towel rack, lifeguard chair, life-ring post, depth sign, changing-room
// marker and a deck planter. Each is exactly the item's footprint and height (the parasol's canopy is the one part that reaches beyond its base, and
// it says so in its card). Outdoor materials: teak, white resin, stainless steel, canvas.
import * as THREE from 'three';
import { Parts } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { cylinderY } from './geo';
import { roundedBoxBetween } from '../furniture-parts';
import { softCushion } from './soft';
import { softSeg } from './core';
import { CHROME, LEAF, RUBBER, SOIL, bar, disc, post, soft } from './kit';
import { fitToBox } from './outdoor-fit';

export const POOL_VARIANTS = ['lounger', 'umbrella', 'chair', 'table', 'shower', 'towel', 'lifeguard', 'life-ring', 'depth-sign', 'changing-sign', 'planter', 'aqua-tower', 'aqua-sun', 'aqua-mushroom', 'aqua-jets'] as const;
export type PoolVariant = (typeof POOL_VARIANTS)[number];
export interface PoolParams { variant: PoolVariant; canopyM: number; text: string; liftM: number }
export const POOL_DEFAULTS: PoolParams = { variant: 'lounger', canopyM: 2.5, text: '1.2 m', liftM: 0 };

export const TEAK: MatSpec = { key: 'wood', tint: '#A66F3A' };
export const RESIN: MatSpec = { key: 'laminate', tint: '#F1EFE9' };
export const CANVAS: MatSpec = { key: 'cotton', tint: '#E9E2D2' };
export const NAVY: MatSpec = { key: 'cotton', tint: '#3D6291' };
export const POOL_BLUE: MatSpec = { key: 'paint', tint: '#1E73A8' };
export const SIGN_RED: MatSpec = { key: 'paint', tint: '#C93A2E' };
export const WHITE_PAINT: MatSpec = { key: 'paint', tint: '#F2F2EE' };

export function buildPool(env: GenEnv, size: GenSize, p: PoolParams, _roles: Roles): THREE.Group {
  const parts = new Parts(env, `gen:pool-${p.variant}`);
  switch (p.variant) {
    case 'lounger': lounger(parts, size); break;
    case 'umbrella': umbrella(parts, size, p.canopyM); break;
    case 'chair': chair(parts, size); break;
    case 'table': table(parts, size); break;
    case 'shower': shower(parts, size); break;
    case 'towel': towel(parts, size); break;
    case 'lifeguard': lifeguard(parts, size); break;
    case 'life-ring': lifeRing(parts, size); break;
    case 'depth-sign': depthSign(parts, size, p.text); break;
    case 'changing-sign': changingSign(parts, size, p.liftM); break;
    case 'planter': planter(parts, size); break;
    case 'aqua-tower': aquaTower(parts, size); break;
    case 'aqua-sun': aquaSun(parts, size); break;
    case 'aqua-mushroom': aquaMushroom(parts, size); break;
    case 'aqua-jets': aquaJets(parts, size); break;
  }
  return fitToBox(parts.done(), size, p.variant === 'changing-sign' ? p.liftM : 0, p.variant === 'umbrella' ? /^umbrella-/ : null);
}

/** SPEC 19.12: an outdoor cushion of a resort lounger, ecru solution-dyed canvas */
export const ECRU: MatSpec = { key: 'cotton', tint: '#E6DFD0' };
/** SPEC 19.12: weathered, oiled teak of resort pool furniture (a shade darker and less orange than the table's) */
export const OILED_TEAK: MatSpec = { key: 'wood', tint: '#8E6440' };

/**
 * A resort sun lounger (SPEC 19.12, was a white resin frame with a navy pad): an oiled teak frame on four square legs with two small wheels at
 * the head, a slatted bed, a back that rises at the hinge to the full height, and a thick ecru cushion over both with a rolled head pillow.
 * Head at -z, feet at +z. Every part is inside the footprint and the height; the seat top is at `s`.
 */
function lounger(P: Parts, { w, d, h, s }: GenSize): void {
  const x0 = -w / 2, x1 = w / 2;
  const hinge = -d / 2 + d * 0.36; // where the back meets the seat
  const pad = 0.075; // the cushion's thickness
  const bed = s - pad; // the slats' top
  const rail = 0.045, c = P.env.q.ultra ? 0.006 : 0.004;
  // the frame: two side rails from the head to the foot, an end rail at the foot, cross rails under the slats
  for (const x of [x0 + rail / 2, x1 - rail / 2]) P.box('frame', OILED_TEAK, x - rail / 2, x + rail / 2, bed - 0.075, bed - 0.012, -d / 2 + 0.06, d / 2, { c });
  P.box('frame', OILED_TEAK, x0, x1, bed - 0.075, bed - 0.012, d / 2 - rail, d / 2, { c });
  for (const z of [hinge + 0.05, (hinge + d / 2) / 2, d / 2 - 0.12]) P.box('frame', OILED_TEAK, x0 + rail, x1 - rail, bed - 0.06, bed - 0.035, z - 0.025, z + 0.025, { c: 0.003 });
  // slats across the bed, a finger's gap apart
  for (let z = hinge + 0.02; z < d / 2 - rail - 0.04; z += 0.085) P.box('slats', OILED_TEAK, x0 + rail + 0.005, x1 - rail - 0.005, bed - 0.03, bed, z, z + 0.07, { c: 0.003 });
  // legs: square teak, a little in from the rails; the head end rolls on two wheels
  const lw = 0.05;
  for (const [x, z] of [[x0 + 0.03, d / 2 - 0.08], [x1 - 0.03, d / 2 - 0.08], [x0 + 0.03, hinge + 0.04], [x1 - 0.03, hinge + 0.04]] as const) P.box('legs', OILED_TEAK, x - lw / 2, x + lw / 2, 0, bed - 0.07, z - lw / 2, z + lw / 2, { c: 0.004 });
  for (const x of [x0 + 0.03, x1 - 0.03]) {
    const wheel = new THREE.CylinderGeometry(0.075, 0.075, 0.035, P.env.q.sides >= 12 ? 20 : 12).rotateZ(Math.PI / 2);
    wheel.translate(x, 0.075, -d / 2 + 0.13);
    P.put('wheels', RUBBER, wheel);
    P.box('legs', OILED_TEAK, x - lw / 2, x + lw / 2, 0.075, bed - 0.07, -d / 2 + 0.1, -d / 2 + 0.16, { c: 0.004 });
  }
  // the back: rails and slats from the hinge up and back to the head
  const back = hinge - (-d / 2 + 0.02);
  const rise = h - s - 0.03; // the back's slats stop under the cushion that tops it
  const len = Math.hypot(back, rise);
  const ang = Math.atan2(rise, back);
  const at = (t: number, lift = 0): { y: number; z: number } => ({ y: bed + t * Math.sin(ang) + lift * Math.cos(ang), z: hinge - t * Math.cos(ang) + lift * Math.sin(ang) });
  for (const x of [x0 + rail / 2, x1 - rail / 2]) {
    const m = at(len / 2, -0.03);
    const g = P.env.q.ultra ? roundedBoxBetween(-rail / 2, rail / 2, -0.03, 0.03, -len / 2, len / 2, 0.008, 3).rotateX(ang) : new THREE.BoxGeometry(rail, 0.06, len).rotateX(ang);
    g.translate(x, m.y, m.z);
    P.put('frame', OILED_TEAK, g);
  }
  for (let t = 0.05; t < len - 0.04; t += 0.085) {
    const m = at(t, -0.012);
    P.put('slats', OILED_TEAK, P.env.q.ultra ? roundedBoxBetween(-(w - 2 * rail - 0.01) / 2, (w - 2 * rail - 0.01) / 2, -0.012, 0.012, -0.035, 0.035, 0.005, 2).rotateX(ang).translate(0, m.y, m.z) : new THREE.BoxGeometry(w - 2 * rail - 0.01, 0.024, 0.07).rotateX(ang).translate(0, m.y, m.z));
  }
  // the cushion: a thick pad on the bed and one up the back, with a rolled pillow at the head
  P.put('cushion', ECRU, soft(P.env, x0 + 0.03, x1 - 0.03, bed, s, hinge - 0.005, d / 2 - 0.035, 0.016));
  const mid = at(len / 2, pad / 2);
  P.put('cushion', ECRU, P.env.q.puff > 0
    ? softCushion(w - 0.06, pad, len - 0.03, { r: 0.028, puff: 0.016, seg: softSeg(P.env.q) }).rotateX(ang).translate(0, mid.y, mid.z)
    : roundedBoxBetween(-(w - 0.06) / 2, (w - 0.06) / 2, -pad / 2, pad / 2, -(len - 0.03) / 2, (len - 0.03) / 2, 0.025, 1).rotateX(ang).translate(0, mid.y, mid.z));
  const top = at(len - 0.11, pad + 0.03);
  const pillow = new THREE.CylinderGeometry(0.065, 0.065, w - 0.16, P.env.q.sides >= 12 ? 16 : 10).rotateZ(Math.PI / 2);
  pillow.translate(0, Math.min(h - 0.066, top.y), top.z);
  P.put('cushion', ECRU, pillow);
}

/** A square-base parasol: weighted base, steel pole, an eight-gore canopy reaching `canopyM` across (beyond the base: it is drawn, not counted as floor). */
function umbrella(P: Parts, { w, d, h }: GenSize, canopyM: number): void {
  const r = canopyM / 2;
  const topY = h - 0.045, rimY = Math.min(h - 0.28, 2.1);
  P.box('base', WHITE_PAINT, -w / 2, w / 2, 0, 0.1, -d / 2, d / 2, { c: 0.01 });
  P.box('base', WHITE_PAINT, -w / 2 + 0.06, w / 2 - 0.06, 0.1, 0.16, -d / 2 + 0.06, d / 2 - 0.06, { c: 0.008 });
  post(P, 'pole', CHROME, 0, 0, 0.16, topY, 0.022);
  // 2K: a domed canopy of sixteen gores (a curved profile, not a cone), the valance with the same sixteen
  const gores = P.env.q.ultra ? 16 : 8;
  let cone: THREE.BufferGeometry;
  if (P.env.q.ultra) {
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 14; i++) { const t = i / 14, rr = r * t; prof.push(new THREE.Vector2(rr, rimY + (topY + 0.02 - rimY) * (1 - Math.pow(t, 1.7)))); }
    cone = new THREE.LatheGeometry(prof.reverse(), gores * 2);
  } else {
    cone = new THREE.ConeGeometry(r, topY - rimY + 0.02, 8, 1, true);
    cone.translate(0, rimY + (topY - rimY) / 2, 0);
  }
  P.put('umbrella-canopy', { key: 'cotton', tint: '#D9C7A4' }, cone, { double: true, noShadow: false });
  // a valance round the rim
  const rim = new THREE.CylinderGeometry(r, r, 0.16, gores * (P.env.q.ultra ? 2 : 1), 1, true);
  rim.translate(0, rimY - 0.07, 0);
  P.put('umbrella-canopy', { key: 'cotton', tint: '#D9C7A4' }, rim, { double: true });
  for (let i = 0; i < gores; i++) { const a = (i / gores) * Math.PI * 2; bar(P, 'umbrella-ribs', CHROME, [0, topY - 0.02, 0], [Math.sin(a) * r * 0.97, rimY - 0.02, Math.cos(a) * r * 0.97], 0.008); }
  const cap = new THREE.SphereGeometry(0.035, 8, 6); cap.translate(0, topY + 0.01, 0); P.put('umbrella-cap', CHROME, cap);
}

/** SPEC 19.12: a teak pool-side armchair (was white resin): square legs, a slatted back, flat arms, an ecru seat cushion. Back at -z. */
function chair(P: Parts, { w, d, h, s }: GenSize): void {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const L = 0.045, c = 0.004;
  for (const [x, z] of [[x0 + L / 2, z0 + L / 2], [x1 - L / 2, z0 + L / 2], [x0 + L / 2, z1 - L / 2], [x1 - L / 2, z1 - L / 2]] as const) P.box('legs', OILED_TEAK, x - L / 2, x + L / 2, 0, s - 0.06, z - L / 2, z + L / 2, { c });
  // the seat frame and its slats
  P.box('frame', OILED_TEAK, x0, x1, s - 0.1, s - 0.06, z0, z0 + 0.04, { c }); P.box('frame', OILED_TEAK, x0, x1, s - 0.1, s - 0.06, z1 - 0.04, z1, { c });
  for (const x of [x0, x1 - 0.04]) P.box('frame', OILED_TEAK, x, x + 0.04, s - 0.1, s - 0.06, z0, z1, { c });
  for (let z = z0 + 0.06; z < z1 - 0.06; z += 0.07) P.box('slats', OILED_TEAK, x0 + 0.04, x1 - 0.04, s - 0.085, s - 0.06, z, z + 0.055, { c: 0.002 });
  // the back: two stiles leaning a little and five horizontal slats
  for (const x of [x0 + L / 2, x1 - L / 2]) P.box('frame', OILED_TEAK, x - L / 2, x + L / 2, s - 0.06, h, z0, z0 + 0.045, { c });
  for (let y = s + 0.08; y < h - 0.02; y += 0.075) P.box('slats', OILED_TEAK, x0 + L, x1 - L, y, y + 0.055, z0 + 0.008, z0 + 0.03, { c: 0.002 });
  // flat arms on short posts
  for (const x of [x0, x1 - 0.05]) { P.box('arms', OILED_TEAK, x, x + 0.05, s + 0.17, s + 0.2, z0 + 0.03, z1 - 0.02, { c }); P.box('arms', OILED_TEAK, x + 0.01, x + 0.04, s - 0.06, s + 0.17, z1 - 0.06, z1 - 0.03, { c }); }
  P.put('cushion', ECRU, soft(P.env, x0 + 0.05, x1 - 0.05, s - 0.06, s, z0 + 0.05, z1 - 0.02, 0.012));
}

function table(P: Parts, { w, d, h, s }: GenSize): void {
  const r = Math.min(w, d) / 2;
  disc(P, 'top', TEAK, 0, 0, s - 0.04, s, r);
  disc(P, 'rim', RESIN, 0, 0, s - 0.06, s - 0.04, r - 0.01);
  post(P, 'pedestal', RESIN, 0, 0, 0.04, s - 0.06, 0.04);
  disc(P, 'foot', RESIN, 0, 0, 0, 0.04, r * 0.5);
  void h;
}

/** A stainless post with a rain head on an arm, a tap and a foot-wash at the base, on a tray with a drain slot. */
function shower(P: Parts, { w, d, h }: GenSize): void {
  P.box('tray', RESIN, -w / 2, w / 2, 0, 0.06, -d / 2, d / 2, { c: 0.01 });
  P.box('drain', RUBBER, -w / 2 + 0.06, w / 2 - 0.06, 0.06, 0.065, 0.02, 0.05, { c: 0 });
  post(P, 'post', CHROME, 0, -d / 2 + 0.08, 0.06, h - 0.1, 0.028);
  bar(P, 'arm', CHROME, [0, h - 0.1, -d / 2 + 0.08], [0, h - 0.06, 0.02], 0.014);
  disc(P, 'head', CHROME, 0, 0.02, h - 0.075, h - 0.06, 0.1);
  // the tap and foot wash
  bar(P, 'tap', CHROME, [0, 0.9, -d / 2 + 0.08], [0, 0.9, -d / 2 + 0.2], 0.012);
  bar(P, 'tap', CHROME, [0, 0.13, -d / 2 + 0.08], [0, 0.13, -d / 2 + 0.2], 0.012);
  P.box('lever', CHROME, -0.04, 0.04, 0.88, 0.92, -d / 2 + 0.17, -d / 2 + 0.2, { c: 0.004 });
}

function towel(P: Parts, { w, d, h }: GenSize): void {
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) {
    bar(P, 'frame', CHROME, [x, 0, -d / 2 + 0.03], [x, h, -d / 2 + 0.03], 0.016);
    bar(P, 'frame', CHROME, [x, 0, d / 2 - 0.03], [x, h, d / 2 - 0.03], 0.016);
    bar(P, 'frame', CHROME, [x, 0.05, -d / 2 + 0.03], [x, 0.05, d / 2 - 0.03], 0.014);
  }
  for (const y of [h - 0.03, h - 0.28, h - 0.53]) bar(P, 'rails', CHROME, [-w / 2 + 0.03, y, -d / 2 + 0.03], [w / 2 - 0.03, y, -d / 2 + 0.03], 0.014);
  // towels over the rails
  const cols = ['#E9E2D2', '#2E7E96', '#EDE6D8'];
  [h - 0.03, h - 0.28, h - 0.53].forEach((y, i) => {
    const wide = (w - 0.2) * (i === 1 ? 0.7 : 0.85);
    P.put('towels', { key: 'cotton', tint: cols[i] }, new THREE.BoxGeometry(wide, 0.34, 0.03).translate(i === 1 ? 0.1 : 0, y - 0.15, -d / 2 + 0.03));
  });
}

/** A lifeguard chair: a high seat on four splayed legs, a back and arms, a canopy, a ladder at the back. */
function lifeguard(P: Parts, { w, d, h, s }: GenSize): void {
  const x0 = -w / 2 + 0.05, x1 = w / 2 - 0.05, zf = d / 2 - 0.1, zb = -d / 2 + 0.1;
  for (const [xt, zt, xb, zb2] of [[x0 + 0.06, zf - 0.06, x0, zf + 0.02], [x1 - 0.06, zf - 0.06, x1, zf + 0.02], [x0 + 0.06, zb + 0.06, x0, zb - 0.02], [x1 - 0.06, zb + 0.06, x1, zb - 0.02]] as const) bar(P, 'legs', WHITE_PAINT, [xt, s, zt], [xb, 0, zb2], 0.032);
  for (const y of [0.55, 1.0]) { bar(P, 'braces', WHITE_PAINT, [x0 - 0.0, y, zf], [x1 + 0.0, y, zf], 0.015); bar(P, 'braces', WHITE_PAINT, [x0, y, zb], [x1, y, zb], 0.015); }
  P.box('seat', TEAK, x0, x1, s - 0.05, s, zb - 0.02, zf + 0.04, { c: 0.006 });
  P.box('back', TEAK, x0, x1, s, s + 0.55, zb - 0.02, zb + 0.03, { c: 0.006 });
  for (const x of [x0, x1]) P.box('arms', TEAK, x - 0.02, x + 0.02, s + 0.22, s + 0.26, zb, zf + 0.04, { c: 0.004 });
  // canopy on two posts, a little over the seat
  for (const x of [x0 + 0.04, x1 - 0.04]) post(P, 'canopy-posts', WHITE_PAINT, x, zb, s, h - 0.05, 0.02);
  P.box('canopy', SIGN_RED, x0 - 0.05, x1 + 0.05, h - 0.07, h, zb - 0.1, zf + 0.1, { c: 0.01 });
  // the ladder at the back
  for (const x of [-0.18, 0.18]) bar(P, 'ladder', WHITE_PAINT, [x, 0, d / 2 - 0.03], [x, s - 0.02, zf], 0.02);
  for (let y = 0.3; y < s - 0.1; y += 0.3) { const zz = d / 2 - 0.03 - (d / 2 - 0.03 - zf) * (y / s); bar(P, 'ladder', WHITE_PAINT, [-0.18, y, zz], [0.18, y, zz], 0.014); }
}

/** A post with a red and white life ring on a hook and a coiled line. */
function lifeRing(P: Parts, { w, d, h }: GenSize): void {
  P.box('base', WHITE_PAINT, -w / 2, w / 2, 0, 0.05, -d / 2, d / 2, { c: 0.008 });
  post(P, 'post', WHITE_PAINT, 0, 0, 0.05, h, 0.04);
  bar(P, 'arm', WHITE_PAINT, [0, h - 0.12, 0], [0, h - 0.12, d / 2 - 0.02], 0.02);
  const R = Math.min(0.27, w / 2 - 0.01);
  const ring = (a0: number, a1: number, mat: MatSpec): void => P.put('ring', mat, new THREE.TorusGeometry(R - 0.05, 0.05, 6, 10, a1 - a0).rotateZ(a0).translate(0, h - 0.5, d / 2 - 0.05));
  for (let i = 0; i < 4; i++) ring((i / 4) * Math.PI * 2, ((i + 1) / 4) * Math.PI * 2 - 0.02, i % 2 === 0 ? SIGN_RED : WHITE_PAINT);
  bar(P, 'line', { key: 'cotton', tint: '#D8D2C4' }, [0, h - 0.5 + R - 0.05, d / 2 - 0.03], [0, h - 0.12, d / 2 - 0.02], 0.006);
}

/** a plate on a post with the depth as a numeral (drawn when the page has a canvas), "NO DIVING" band underneath */
function depthSign(P: Parts, { w, d, h }: GenSize, text: string): void {
  post(P, 'post', CHROME, 0, 0, 0, h - 0.34, 0.022);
  P.box('plate', POOL_BLUE, -w / 2, w / 2, h - 0.38, h, -d / 2, d / 2, { c: 0.006 });
  const face = signTexture(text);
  const plate = new THREE.PlaneGeometry(w - 0.04, 0.3);
  plate.translate(0, h - 0.19, d / 2 + 0.002);
  if (face) { const m = new THREE.Mesh(plate, new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 })); m.name = 'sign-face'; m.userData.walkthruPart = 'sign-face'; m.userData.ownsMaterial = true; P.group.add(m); }
  else P.put('face', WHITE_PAINT, plate);
  P.box('base', CHROME, -0.09, 0.09, 0, 0.03, -d / 2, d / 2, { c: 0.004 });
}

/** one texture a numeral, kept for the session (a disposed texture is simply uploaded again when it is next drawn): a piece that is rebuilt does not orphan a canvas */
const signCache = new Map<string, THREE.Texture>();
function signTexture(text: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const hit = signCache.get(text);
  if (hit) return hit;
  const t = paintSign(text);
  if (t && signCache.size < 16) signCache.set(text, t);
  return t;
}
function paintSign(text: string): THREE.Texture | null {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 600; // 4x the 256 x 150 design: a depth sign is read from a metre away (SPEC 16.18)
  const g = c.getContext('2d');
  if (!g) return null;
  g.scale(4, 4);
  g.fillStyle = '#1E73A8'; g.fillRect(0, 0, 256, 150);
  g.fillStyle = '#FFFFFF'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 76px sans-serif'; g.fillText(text, 128, 62);
  g.font = 'bold 26px sans-serif'; g.fillText('NO DIVING', 128, 122);
  g.strokeStyle = '#FFFFFF'; g.lineWidth = 4; g.strokeRect(8, 8, 240, 134);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function changingSign(P: Parts, { w, d, h }: GenSize, lift: number): void {
  const t = d - 0.01, ph = h - lift;
  P.box('plate', POOL_BLUE, -w / 2, w / 2, lift, h, -d / 2, -d / 2 + t, { c: 0.006 });
  const zf = -d / 2 + t;
  // two simple figures in white: a flat head and a body block (a cone for the skirt), thin enough to stay inside the plate's depth
  for (const [cx, skirt] of [[-0.1, false], [0.1, true]] as const) {
    P.put('figure', WHITE_PAINT, new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1, 0.12).translate(cx, lift + ph * 0.72, zf));
    P.put('figure', WHITE_PAINT, skirt ? new THREE.ConeGeometry(0.06, 0.16, 6).scale(1, 1, 0.12).translate(cx, lift + ph * 0.46, zf) : new THREE.BoxGeometry(0.07, 0.17, 0.006).translate(cx, lift + ph * 0.46, zf - 0.003));
  }
  P.box('band', WHITE_PAINT, -w / 2 + 0.03, w / 2 - 0.03, lift + ph * 0.12, lift + ph * 0.17, zf - 0.004, zf, { c: 0 });
}

/** A tapered terracotta-glazed pot with soil and a small areca palm. */
function planter(P: Parts, { w, d, h, s }: GenSize): void {
  const r = Math.min(w, d) / 2 - 0.015;
  const g = new THREE.CylinderGeometry(r, r * 0.74, s - 0.02, 16, 1, false).translate(0, (s - 0.02) / 2 + 0.02, 0);
  P.put('pot', { key: 'gloss', tint: '#8E5B3E' }, g);
  disc(P, 'rim', { key: 'gloss', tint: '#8E5B3E' }, 0, 0, s - 0.05, s, r + 0.015);
  disc(P, 'soil', SOIL, 0, 0, s - 0.06, s - 0.02, r - 0.03);
  // five fronds of three elongated blobs each, the tallest reaching `h`
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2, lean = 0.28 + (i % 3) * 0.1;
    const top = h - (i % 2) * 0.18;
    const base = new THREE.Vector3(Math.sin(a) * 0.05, s - 0.03, Math.cos(a) * 0.05);
    const tip = new THREE.Vector3(Math.sin(a) * r * 0.55 * lean * 2, top - 0.04, Math.cos(a) * r * 0.55 * lean * 2);
    const len = base.distanceTo(tip);
    const blob = new THREE.SphereGeometry(1, 6, 4).scale(0.07, len * 0.5, 0.025);
    blob.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(base).normalize()));
    blob.translate((base.x + tip.x) / 2, (base.y + tip.y) / 2, (base.z + tip.z) / 2);
    P.put('fronds', LEAF, blob);
  }
  P.put('fronds', LEAF, new THREE.SphereGeometry(1, 8, 6).scale(0.15, 0.17, 0.15).translate(0, h - 0.17, 0));
  void cylinderY;
}

// ---------------------------------------------------------------- aqua play (a shallow children's water area)

export const PLAY_RED: MatSpec = { key: 'paint', tint: '#C9372C' };
export const PLAY_YELLOW: MatSpec = { key: 'paint', tint: '#E3B02A' };
export const PLAY_BLUE: MatSpec = { key: 'paint', tint: '#2F6FB0' };
export const PLAY_GREY: MatSpec = { key: 'dark', tint: '#3A3D42' };

/** SPEC 19.12: running water (white with air in it), drawn where the play feature sends it, inside the feature's own footprint and height */
export const SPRAY: MatSpec = { key: 'sheer', tint: '#E3F1F5' };

/** a stream of water: a thin tube along a parabola from `a`, leaving at `v` (m/s, x up z), for `t` seconds */
function stream(P: Parts, name: string, a: [number, number, number], v: [number, number, number], t: number, r: number): void {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) { const s = (i / 10) * t; pts.push(new THREE.Vector3(a[0] + v[0] * s, a[1] + v[1] * s - 4.9 * s * s, a[2] + v[2] * s)); }
  const fine = P.env.q.sides >= 12;
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), fine ? 12 : 7, r, fine ? 5 : 3, false);
  P.put(name, SPRAY, g, { noShadow: true, double: true });
}

/**
 * A water-play tower (SPEC 19.12: was boxes on four poles): four round powder-coated posts, an anti-slip deck at 1.2 m with tubular guard rails and
 * balusters on three sides, a ladder up the -x end, a four-sided hip roof, and a yellow trough slide (a half pipe) from the deck's +x edge down to the
 * water. Slide end at +x.
 */
function aquaTower(P: Parts, { w, d, h }: GenSize): void {
  const deck = 1.2, tw = Math.min(1.6, d), x0 = -w / 2, tx1 = x0 + tw;
  const z0 = -d / 2, z1 = d / 2, pr = 0.055;
  const px = [x0 + pr, tx1 - pr], pz = [z0 + pr, z1 - pr];
  for (const x of px) for (const z of pz) post(P, 'posts', PLAY_BLUE, x, z, 0, h - 0.4, pr);
  P.box('deck', PLAY_GREY, x0 + 0.02, tx1 - 0.02, deck - 0.06, deck, z0 + 0.02, z1 - 0.02, { c: 0.01 });
  // guard rails: a top and a mid tube on the long sides and the ladder end (open where the slide leaves), balusters between
  const rail = (a: [number, number, number], b: [number, number, number]): void => bar(P, 'rails', PLAY_RED, a, b, 0.024);
  for (const z of pz) for (const y of [deck + 0.45, deck + 0.9]) rail([px[0], y, z], [px[1], y, z]);
  for (const y of [deck + 0.45, deck + 0.9]) rail([px[0], y, pz[0]], [px[0], y, pz[0] + (pz[1] - pz[0]) * 0.3]);
  for (const z of pz) for (let x = px[0] + 0.12; x < px[1] - 0.05; x += 0.12) bar(P, 'balusters', PLAY_RED, [x, deck, z], [x, deck + 0.9, z], 0.012);
  // the ladder: two stringers and five rungs on the -x end, beside the opening
  const lz0 = pz[0] + (pz[1] - pz[0]) * 0.38, lz1 = pz[1] - 0.05;
  for (const z of [lz0, lz1]) bar(P, 'ladder', PLAY_BLUE, [x0 + 0.03, 0, z], [x0 + 0.03, deck + 0.85, z], 0.025);
  for (let y = 0.25; y < deck; y += 0.24) bar(P, 'ladder', PLAY_YELLOW, [x0 + 0.03, y, lz0], [x0 + 0.03, y, lz1], 0.022);
  // a hip roof over the deck, a finial on top
  const roofH = 0.4, cx = (x0 + tx1) / 2;
  const roof = new THREE.ConeGeometry(Math.hypot(tw, d) / 2, roofH, 4, 1, true).rotateY(Math.PI / 4);
  roof.scale(1, 1, d / tw);
  roof.translate(cx, h - roofH / 2 - 0.06, 0);
  P.put('roof', PLAY_YELLOW, roof, { double: true });
  disc(P, 'finial', PLAY_RED, cx, 0, h - 0.07, h, 0.05);
  // the slide: a half pipe along the slope, flattening into a run-out at the water
  const run = w - tw, drop = deck - 0.18, rr = 0.26;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; const e = t < 0.85 ? t / 0.85 : 1; pts.push(new THREE.Vector3(tx1 + run * t - 0.02, deck - drop * (e * e * (3 - 2 * e)) + 0.02, 0)); }
  const path = new THREE.CatmullRomCurve3(pts);
  const segs = P.env.q.sides >= 12 ? 24 : 14;
  const pos: number[] = [], idx: number[] = [], ring = 9;
  for (let i = 0; i <= segs; i++) {
    const p = path.getPointAt(i / segs), tng = path.getTangentAt(i / segs);
    const side = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3().crossVectors(side, tng).normalize();
    for (let k = 0; k <= ring; k++) { const a = Math.PI * (k / ring); const q = p.clone().addScaledVector(side, Math.cos(a) * rr).addScaledVector(up, -Math.sin(a) * rr * 0.55 + rr * 0.55); pos.push(q.x, q.y, q.z); }
  }
  for (let i = 0; i < segs; i++) for (let k = 0; k < ring; k++) { const a = i * (ring + 1) + k, b = a + ring + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const trough = new THREE.BufferGeometry();
  trough.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); trough.setIndex(idx); trough.computeVertexNormals();
  P.put('slide', PLAY_YELLOW, trough.toNonIndexed(), { double: true });
  // the posts that carry the slide's foot
  post(P, 'slide-legs', PLAY_BLUE, tx1 + run * 0.62, 0, 0, deck - drop * 0.9, 0.035);
}

/** A sun-shaped spray feature: a low round pad, a post, a red disc with yellow rays, and water arcing from the ray tips down to the pad's rim. */
function aquaSun(P: Parts, { w, h }: GenSize): void {
  const r = w / 2;
  disc(P, 'pad', PLAY_GREY, 0, 0, 0, 0.06, r * 0.5);
  post(P, 'post', CHROME, 0, 0, 0.06, h - 0.2, 0.05);
  disc(P, 'sun', PLAY_RED, 0, 0, h - 0.5, h - 0.2, r * 0.55);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const ray = new THREE.CylinderGeometry(0.035, 0.05, r * 0.38, 8).rotateZ(Math.PI / 2).translate(r * 0.72, 0, 0).rotateY(-a);
    ray.translate(0, h - 0.36, 0);
    P.put('rays', PLAY_YELLOW, ray);
    // a stream from the tip, out and down to the edge of the feature's footprint
    const tip: [number, number, number] = [Math.cos(a) * r * 0.9, h - 0.36, -Math.sin(a) * r * 0.9];
    const tt = Math.sqrt((2 * (h - 0.36)) / 9.8);
    stream(P, 'spray', tip, [Math.cos(a) * (r * 0.08) / tt, 0, -Math.sin(a) * (r * 0.08) / tt], tt * 0.98, 0.012);
  }
  disc(P, 'nozzle', CHROME, 0, 0, h - 0.2, h, 0.06);
}

/** A water mushroom: a post, a wide yellow dome, and the curtain of water that falls from its rim to the pad. */
function aquaMushroom(P: Parts, { w, h }: GenSize): void {
  const r = w / 2;
  disc(P, 'pad', PLAY_GREY, 0, 0, 0, 0.05, 0.22);
  post(P, 'stem', PLAY_BLUE, 0, 0, 0.05, h - 0.25, 0.07);
  const dome = new THREE.SphereGeometry(r, P.env.q.sides >= 12 ? 32 : 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3 / r, 1);
  dome.translate(0, h - 0.32, 0);
  P.put('dome', PLAY_YELLOW, dome, { double: true });
  disc(P, 'rim', PLAY_YELLOW, 0, 0, h - 0.34, h - 0.32, r);
  disc(P, 'cap', CHROME, 0, 0, h - 0.02, h, 0.05);
  // the curtain, a little inside the rim, thinning (narrowing) as it falls
  const curtain = new THREE.CylinderGeometry(r * 0.97, r * 0.94, h - 0.36, P.env.q.sides >= 12 ? 36 : 20, 1, true);
  curtain.translate(0, (h - 0.36) / 2, 0);
  P.put('spray', SPRAY, curtain, { noShadow: true, double: true });
}

/** A row of ground spray jets in a stainless bar, nine nozzles along it. (Their water rises far above the 12 cm the row is: not drawn, the piece is the hardware.) */
function aquaJets(P: Parts, { w, d, h }: GenSize): void {
  P.box('bar', CHROME, -w / 2, w / 2, 0, h * 0.5, -d / 2, d / 2, { c: 0.004 });
  const n = 9;
  for (let i = 0; i < n; i++) { const x = -w / 2 + 0.2 + (i * (w - 0.4)) / (n - 1); post(P, 'jets', WHITE_PAINT, x, 0, h * 0.5, h, 0.045, 0.7); }
}
