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

/** A resin sun lounger: a frame on four legs, slatted base, a back that rises at 40 degrees, a navy cushion over both. Head at -z, feet at +z. */
function lounger(P: Parts, { w, d, h, s }: GenSize): void {
  const x0 = -w / 2, x1 = w / 2;
  const hinge = -d / 2 + d * 0.38; // where the back meets the seat
  for (const x of [x0 + 0.03, x1 - 0.03]) {
    P.box('frame', RESIN, x - 0.02, x + 0.02, s - 0.1, s - 0.04, hinge, d / 2 - 0.02, { c: 0.004 });
    P.box('frame', RESIN, x - 0.02, x + 0.02, 0.0, s - 0.1, hinge + 0.04, hinge + 0.1, { c: 0.004 });
    P.box('frame', RESIN, x - 0.02, x + 0.02, 0.0, s - 0.1, d / 2 - 0.1, d / 2 - 0.04, { c: 0.004 });
  }
  for (let z = hinge + 0.03; z < d / 2 - 0.05; z += 0.07) P.box('slats', RESIN, x0 + 0.03, x1 - 0.03, s - 0.07, s - 0.04, z, z + 0.05, { c: 0.002 });
  // the back: a frame and slats from the hinge up and back to the head, which is at height h
  const back = hinge - (-d / 2); // how far the back runs along the floor
  const rise = h - s;
  const len = Math.hypot(back, rise);
  const ang = Math.atan2(rise, back);
  const at = (t: number): { y: number; z: number } => ({ y: s + t * Math.sin(ang), z: hinge - t * Math.cos(ang) });
  for (const x of [x0 + 0.03, x1 - 0.03]) {
    const m = at(len / 2);
    const g = P.env.q.ultra ? roundedBoxBetween(-0.02, 0.02, -0.02, 0.02, -len / 2, len / 2, 0.008, 3).rotateX(ang) : new THREE.BoxGeometry(0.04, 0.04, len).rotateX(ang);
    g.translate(x, m.y - 0.04, m.z);
    P.put('frame', RESIN, g);
  }
  for (let t = 0.04; t < len - 0.03; t += 0.07) {
    const m = at(t);
    P.put('slats', RESIN, P.env.q.ultra ? roundedBoxBetween(-(w - 0.06) / 2, (w - 0.06) / 2, -0.015, 0.015, -0.025, 0.025, 0.007, 2).rotateX(ang).translate(0, m.y - 0.045, m.z) : new THREE.BoxGeometry(w - 0.06, 0.03, 0.05).rotateX(ang).translate(0, m.y - 0.045, m.z));
  }
  // legs
  for (const [x, z] of [[x0 + 0.05, hinge + 0.07], [x1 - 0.05, hinge + 0.07], [x0 + 0.05, d / 2 - 0.07], [x1 - 0.05, d / 2 - 0.07]] as const) post(P, 'legs', RESIN, x, z, 0, s - 0.1, 0.018);
  // the cushion lies on the seat and follows the back
  P.put('cushion', NAVY, soft(P.env, x0 + 0.04, x1 - 0.04, s - 0.04, s + 0.03, hinge, d / 2 - 0.05, 0.012));
  const mid = at(len / 2);
  P.put('cushion', NAVY, P.env.q.ultra
    ? softCushion(w - 0.1, 0.05, len - 0.04, { r: 0.02, puff: 0.012, seg: softSeg(P.env.q) }).rotateX(ang).translate(0, mid.y - 0.01, mid.z)
    : new THREE.BoxGeometry(w - 0.1, 0.05, len - 0.04).rotateX(ang).translate(0, mid.y - 0.01, mid.z));
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

function chair(P: Parts, { w, d, h, s }: GenSize): void {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const L = 0.035;
  for (const [x, z] of [[x0 + L, z0 + L], [x1 - L, z0 + L], [x0 + L, z1 - L], [x1 - L, z1 - L]] as const) post(P, 'legs', RESIN, x, z, 0, s - 0.04, 0.026);
  P.box('seat', RESIN, x0, x1, s - 0.05, s, z0 + 0.0, z1, { c: 0.006 });
  // back slats leaning a little
  P.box('back', RESIN, x0 + 0.02, x1 - 0.02, s, h, z0, z0 + 0.04, { c: 0.004 });
  for (const x of [x0 + 0.015, x1 - 0.015]) P.box('arms', RESIN, x - 0.015, x + 0.015, s + 0.15, s + 0.19, z0 + 0.05, z1 - 0.12, { c: 0.004 });
  for (const x of [x0 + 0.015, x1 - 0.015]) post(P, 'arms', RESIN, x, z1 - 0.13, s - 0.05, s + 0.17, 0.014);
  P.put('cushion', CANVAS, soft(P.env, x0 + 0.04, x1 - 0.04, s, s + 0.045, z0 + 0.06, z1 - 0.04, 0.012));
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

/** A water-play tower: four posts, a deck at 1.2 m with a roof of blue panels, a spiral-less straight slide down one end into the water, a spray nozzle on the roof. Slide end at +x. */
function aquaTower(P: Parts, { w, d, h }: GenSize): void {
  const deck = 1.2, tw = Math.min(1.6, d), x0 = -w / 2, tx1 = x0 + tw;
  const z0 = -d / 2, z1 = d / 2;
  for (const x of [x0 + 0.06, tx1 - 0.06]) for (const z of [z0 + 0.06, z1 - 0.06]) post(P, 'posts', PLAY_GREY, x, z, 0, h - 0.12, 0.05);
  P.box('deck', PLAY_GREY, x0, tx1, deck - 0.06, deck, z0, z1, { c: 0.01 });
  P.box('rails', PLAY_RED, x0, tx1, deck, deck + 0.55, z0, z0 + 0.04, { c: 0.004 });
  P.box('rails', PLAY_RED, x0, tx1, deck, deck + 0.55, z1 - 0.04, z1, { c: 0.004 });
  P.box('roof', PLAY_BLUE, x0 - 0.0, tx1, h - 0.12, h, z0, z1, { c: 0.02 });
  // the slide: a sloped chute from the deck's +x edge down to the water, 0.5 m wide
  const run = w - tw, drop = deck - 0.2, len = Math.hypot(run, drop), ang = Math.atan2(drop, run);
  const chute = new THREE.BoxGeometry(len, 0.05, 0.5).rotateZ(-ang);
  chute.translate(tx1 + run / 2, deck - drop / 2 - 0.02, 0);
  P.put('slide', PLAY_YELLOW, chute);
  for (const s of [-1, 1]) { const side = new THREE.BoxGeometry(len, 0.14, 0.04).rotateZ(-ang); side.translate(tx1 + run / 2, deck - drop / 2 + 0.04, s * 0.27); P.put('slide-sides', PLAY_YELLOW, side); }
  post(P, 'nozzle', CHROME, (x0 + tx1) / 2, 0, h - 0.12, h - 0.02, 0.025);
}

/** A sun-shaped spray feature: a low round pad, a post, a red disc and yellow rays round it. */
function aquaSun(P: Parts, { w, h }: GenSize): void {
  const r = w / 2;
  disc(P, 'pad', PLAY_GREY, 0, 0, 0, 0.06, r * 0.5);
  post(P, 'post', CHROME, 0, 0, 0.06, h - 0.2, 0.05);
  disc(P, 'sun', PLAY_RED, 0, 0, h - 0.5, h - 0.2, r * 0.55);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const ray = new THREE.BoxGeometry(r * 0.4, 0.04, 0.1).translate(r * 0.55 + r * 0.2 - 0.0, 0, 0).rotateY(-a);
    ray.translate(0, h - 0.36, 0);
    P.put('rays', PLAY_YELLOW, ray);
  }
  disc(P, 'nozzle', CHROME, 0, 0, h - 0.2, h, 0.06);
}

/** A water mushroom: a post and a wide yellow dome that rains round its rim. */
function aquaMushroom(P: Parts, { w, h }: GenSize): void {
  const r = w / 2;
  disc(P, 'pad', PLAY_GREY, 0, 0, 0, 0.05, 0.22);
  post(P, 'stem', PLAY_BLUE, 0, 0, 0.05, h - 0.25, 0.07);
  const dome = new THREE.SphereGeometry(r, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3 / r, 1);
  dome.translate(0, h - 0.32, 0);
  P.put('dome', PLAY_YELLOW, dome, { double: true });
  disc(P, 'rim', PLAY_YELLOW, 0, 0, h - 0.34, h - 0.32, r);
  disc(P, 'cap', CHROME, 0, 0, h - 0.02, h, 0.05);
}

/** A row of ground spray jets in a stainless bar, nine nozzles along it. */
function aquaJets(P: Parts, { w, d, h }: GenSize): void {
  P.box('bar', CHROME, -w / 2, w / 2, 0, h * 0.5, -d / 2, d / 2, { c: 0.004 });
  const n = 9;
  for (let i = 0; i < n; i++) { const x = -w / 2 + 0.2 + (i * (w - 0.4)) / (n - 1); post(P, 'jets', WHITE_PAINT, x, 0, h * 0.5, h, 0.045, 0.7); }
}
