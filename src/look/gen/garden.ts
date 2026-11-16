// Garden pieces (SPEC 19.4): park bench, senior bench, pergola with a bench, lamp post and bollard (lit from evening), slide, swing set, see-saw,
// climbing frame, rubber safety surfacing, jogging track, yoga deck and a water feature. Each is exactly the item's footprint and height.
import * as THREE from 'three';
import { Parts } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { CHROME, GLASS, RUBBER, bar, disc, post } from './kit';
import { fitToBox } from './outdoor-fit';
import { NAVY, SIGN_RED, TEAK, WHITE_PAINT } from './pool';

export const GARDEN_VARIANTS = ['bench', 'senior-bench', 'pergola', 'lamp-post', 'bollard', 'slide', 'swingset', 'seesaw', 'climber', 'rubber-mat', 'track', 'yoga-deck', 'fountain'] as const;
export type GardenVariant = (typeof GARDEN_VARIANTS)[number];
export interface GardenParams { variant: GardenVariant; colour: string }
export const GARDEN_DEFAULTS: GardenParams = { variant: 'bench', colour: '#B5483A' };

const IRON: MatSpec = { key: 'blackMetal', tint: '#25292D' };
const STONE: MatSpec = { key: 'laminate', tint: '#C9BFAE' };
const POLE: MatSpec = { key: 'blackMetal', tint: '#2E3338' };
const YELLOW: MatSpec = { key: 'paint', tint: '#E8B02C' };
const BLUE: MatSpec = { key: 'paint', tint: '#2F78B5' };
const GREEN: MatSpec = { key: 'paint', tint: '#3E9A4E' };
const LAMP: MatSpec = { key: 'lamp', tint: '#FFF1CF' };

export function buildGarden(env: GenEnv, size: GenSize, p: GardenParams, _roles: Roles): THREE.Group {
  const parts = new Parts(env, `gen:garden-${p.variant}`);
  switch (p.variant) {
    case 'bench': bench(parts, size, false); break;
    case 'senior-bench': bench(parts, size, true); break;
    case 'pergola': pergola(parts, size); break;
    case 'lamp-post': lampPost(parts, size); break;
    case 'bollard': bollard(parts, size); break;
    case 'slide': slide(parts, size); break;
    case 'swingset': swingset(parts, size); break;
    case 'seesaw': seesaw(parts, size); break;
    case 'climber': climber(parts, size); break;
    case 'rubber-mat': rubberMat(parts, size, p.colour); break;
    case 'track': track(parts, size); break;
    case 'yoga-deck': yogaDeck(parts, size); break;
    case 'fountain': fountain(parts, size); break;
  }
  const g = fitToBox(parts.done(), size, 0, null);
  // the lit parts follow the time of day (SPEC 16.12): off in daylight, on from the evening
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.walkthruPart === 'glow') o.userData.walkthruLight = 'lamp'; });
  return g;
}

/** a bench: slatted seat and back on cast-iron ends; the senior one is higher with arm rests and a firmer back */
function bench(P: Parts, { w, d, h, s }: GenSize, senior: boolean): void {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  for (const x of [x0 + 0.08, x1 - 0.08]) {
    P.box('ends', IRON, x - 0.025, x + 0.025, 0, s - 0.04, z0 + 0.1, z1 - 0.06, { c: 0.004 });
    P.box('ends', IRON, x - 0.025, x + 0.025, s - 0.04, h - 0.02, z0 + 0.04, z0 + 0.1, { c: 0.004 });
    if (senior) P.box('arms', IRON, x - 0.03, x + 0.03, s + 0.2, s + 0.24, z0 + 0.08, z1 - 0.04, { c: 0.004 });
    if (senior) post(P, 'arms', IRON, x, z1 - 0.07, s - 0.04, s + 0.22, 0.02);
  }
  const slat = 0.07;
  for (let z = z0 + 0.12; z + slat <= z1 - 0.02; z += slat + 0.012) P.box('seat', TEAK, x0 + 0.02, x1 - 0.02, s - 0.05, s - 0.015, z, z + slat, { c: 0.003 });
  const backZ = z0 + 0.04;
  const n = senior ? 5 : 4;
  for (let i = 0; i < n; i++) { const y0 = s + 0.06 + i * ((h - s - 0.1) / n); P.box('back', TEAK, x0 + 0.02, x1 - 0.02, y0, y0 + (h - s - 0.1) / n - 0.012, backZ, backZ + 0.03, { c: 0.003 }); }
}

/** four posts, a slatted roof with two cross beams, a bench inside against the back */
function pergola(P: Parts, { w, d, h }: GenSize): void {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const pr = 0.07;
  for (const [x, z] of [[x0 + pr, z0 + pr], [x1 - pr, z0 + pr], [x0 + pr, z1 - pr], [x1 - pr, z1 - pr]] as const) P.box('posts', WHITE_PAINT, x - pr, x + pr, 0, h - 0.2, z - pr, z + pr, { c: 0.006 });
  for (const z of [z0 + 0.05, z1 - 0.05]) P.box('beams', WHITE_PAINT, x0, x1, h - 0.2, h - 0.08, z - 0.05, z + 0.05, { c: 0.005 });
  for (let x = x0 + 0.1; x <= x1 - 0.05; x += 0.22) P.box('slats', TEAK, x - 0.03, x + 0.03, h - 0.08, h, z0, z1, { c: 0.003 });
  // the bench
  const s = 0.45, bx0 = x0 + 0.25, bx1 = x1 - 0.25;
  P.box('bench', TEAK, bx0, bx1, s - 0.05, s, z0 + 0.2, z1 - 0.18, { c: 0.004 });
  P.box('bench', TEAK, bx0, bx1, s + 0.12, s + 0.45, z0 + 0.12, z0 + 0.17, { c: 0.004 });
  for (const x of [bx0 + 0.04, bx1 - 0.04]) P.box('bench-legs', TEAK, x - 0.03, x + 0.03, 0, s - 0.05, z0 + 0.22, z1 - 0.22, { c: 0.003 });
}

/** a tapered steel pole on a plinth with a glass lantern; the lantern glows from the evening */
function lampPost(P: Parts, { w, d, h }: GenSize): void {
  const r = Math.min(w, d) / 2;
  P.box('plinth', IRON, -r, r, 0, 0.18, -r, r, { c: 0.01 });
  post(P, 'pole', POLE, 0, 0, 0.18, h - 0.42, 0.045, 0.62);
  disc(P, 'collar', POLE, 0, 0, h - 0.5, h - 0.44, 0.07);
  // the lantern: a glass box with a lit core, a cap and a finial
  P.box('lantern-glass', GLASS, -0.13, 0.13, h - 0.44, h - 0.14, -0.13, 0.13, { c: 0.004 });
  P.box('glow', LAMP, -0.09, 0.09, h - 0.4, h - 0.2, -0.09, 0.09, { c: 0.004 });
  const cap = new THREE.ConeGeometry(0.19, 0.12, 4, 1).rotateY(Math.PI / 4).translate(0, h - 0.08, 0);
  P.put('cap', POLE, cap);
  P.put('cap', POLE, new THREE.SphereGeometry(0.03, 8, 6).translate(0, h - 0.01, 0));
}

function bollard(P: Parts, { w, d, h }: GenSize): void {
  const r = Math.min(w, d) / 2;
  disc(P, 'body', POLE, 0, 0, 0, h - 0.06, r - 0.01);
  disc(P, 'cap', POLE, 0, 0, h - 0.06, h, r);
  // a lit band under the cap, a slit window
  disc(P, 'glow', LAMP, 0, 0, h - 0.24, h - 0.14, r - 0.006);
}

/** a ladder, a railed platform at `s`, and a curved chute out of the front (+z) */
function slide(P: Parts, { w, d, h, s }: GenSize): void {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2;
  const plat = 0.8; // the platform is 80 cm deep
  const pz1 = z0 + plat;
  for (const [x, z] of [[x0 + 0.04, z0 + 0.04], [x1 - 0.04, z0 + 0.04], [x0 + 0.04, pz1 - 0.04], [x1 - 0.04, pz1 - 0.04]] as const) post(P, 'posts', YELLOW, x, z, 0, h - 0.1, 0.04);
  P.box('platform', TEAK, x0, x1, s - 0.04, s, z0, pz1, { c: 0.004 });
  // a roof over the platform
  P.box('roof', BLUE, x0, x1, h - 0.08, h, z0, pz1, { c: 0.01 });
  // guard rails: back and sides to 70 cm above the platform
  for (const x of [x0 + 0.04, x1 - 0.04]) P.box('rails', YELLOW, x - 0.015, x + 0.015, s + 0.35, s + 0.38, z0 + 0.04, pz1 - 0.04, { c: 0.003 });
  P.box('rails', YELLOW, x0 + 0.04, x1 - 0.04, s + 0.35, s + 0.38, z0 + 0.04, z0 + 0.07, { c: 0.003 });
  // the chute: a curved trough from the platform edge down to 30 cm at the front
  const steps = 14, L = d - plat - 0.04, drop = s - 0.3;
  const trough: THREE.BufferGeometry[] = [];
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const f = (t: number): number => s - drop * (t * t * (1.2 - 0.2 * t) * 0.35 + t * 0.65);
    const za = pz1 + L * t0, zb = pz1 + L * t1, ya = f(t0), yb = f(t1);
    const len = Math.hypot(zb - za, yb - ya), ang = Math.atan2(ya - yb, zb - za);
    trough.push(new THREE.BoxGeometry(w - 0.1, 0.025, len + 0.005).rotateX(ang).translate(0, (ya + yb) / 2 - 0.0, (za + zb) / 2));
    for (const x of [x0 + 0.06, x1 - 0.06]) trough.push(new THREE.BoxGeometry(0.03, 0.1, len).rotateX(ang).translate(x, (ya + yb) / 2 + 0.04, (za + zb) / 2));
  }
  for (const g of trough) P.put('chute', { key: 'metal', tint: '#D5D9DC' }, g);
  // the ladder at the back: two rails, rungs
  for (const x of [-0.18, 0.18]) bar(P, 'ladder', YELLOW, [x, 0, z0 + 0.03], [x, s, z0 + 0.12], 0.02);
  for (let y = 0.25; y < s - 0.05; y += 0.25) bar(P, 'ladder', YELLOW, [-0.18, y, z0 + 0.12 * (y / s)], [0.18, y, z0 + 0.12 * (y / s)], 0.015);
}

/** an A-frame at each end and a top bar, with two seats on chains (a seat is a rubber slab, so it cannot hurt) */
function swingset(P: Parts, { w, d, h }: GenSize): void {
  const x0 = -w / 2, x1 = w / 2;
  const topY = h - 0.1;
  for (const x of [x0 + 0.05, x1 - 0.05]) {
    bar(P, 'frame', YELLOW, [x, topY, 0], [x, 0.04, -d / 2 + 0.06], 0.045);
    bar(P, 'frame', YELLOW, [x, topY, 0], [x, 0.04, d / 2 - 0.06], 0.045);
    bar(P, 'frame', YELLOW, [x, 0.7, -d / 2 * (0.7 / topY * 0 + 1) * 0.6], [x, 0.7, d / 2 * 0.6], 0.02);
  }
  bar(P, 'topbar', YELLOW, [x0 + 0.02, topY, 0], [x1 - 0.02, topY, 0], 0.05);
  for (const cx of [-w * 0.22, w * 0.22]) {
    const seatY = 0.55;
    for (const dx of [-0.17, 0.17]) bar(P, 'chains', CHROME, [cx + dx, topY, 0], [cx + dx, seatY + 0.03, 0], 0.007);
    P.box('seats', RUBBER, cx - 0.2, cx + 0.2, seatY, seatY + 0.04, -0.09, 0.09, { c: 0.012 });
  }
}

function seesaw(P: Parts, { w, d, h, s }: GenSize): void {
  const x0 = -w / 2, x1 = w / 2;
  // the plank is level in this model (the pivot is at 40 cm); two seats, two handles; an A-shaped pivot stand
  P.box('plank', GREEN, x0, x1, s - 0.12, s - 0.06, -d / 2 + 0.04, d / 2 - 0.04, { c: 0.008 });
  for (const x of [x0 + 0.35, x1 - 0.35]) { P.box('seats', YELLOW, x - 0.2, x + 0.2, s - 0.06, s - 0.02, -d / 2 + 0.02, d / 2 - 0.02, { c: 0.008 }); bar(P, 'handles', CHROME, [x * 0.96, s - 0.02, -d / 2 + 0.06], [x * 0.96, h, -d / 2 + 0.06], 0.012); bar(P, 'handles', CHROME, [x * 0.96, h, -d / 2 + 0.06], [x * 0.96, h, d / 2 - 0.06], 0.012); bar(P, 'handles', CHROME, [x * 0.96, h, d / 2 - 0.06], [x * 0.96, s - 0.02, d / 2 - 0.06], 0.012); }
  bar(P, 'pivot', IRON, [0, s - 0.12, 0], [0, 0, -d / 2 + 0.04], 0.03);
  bar(P, 'pivot', IRON, [0, s - 0.12, 0], [0, 0, d / 2 - 0.04], 0.03);
  for (const x of [x0 + 0.14, x1 - 0.14]) P.box('stops', RUBBER, x - 0.12, x + 0.12, 0, 0.12, -d / 2, d / 2, { c: 0.02 });
}

/** a frame of posts with two platforms, a rope net up one side, a ladder up another, monkey bars across the top */
function climber(P: Parts, { w, d, h, s }: GenSize): void {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const c = 0.06;
  for (const [x, z] of [[x0 + c, z0 + c], [x1 - c, z0 + c], [x0 + c, z1 - c], [x1 - c, z1 - c]] as const) post(P, 'posts', BLUE, x, z, 0, h, 0.05);
  P.box('platform', TEAK, x0, x0 + w * 0.5, s - 0.04, s, z0, z0 + d * 0.5, { c: 0.004 });
  P.box('platform', TEAK, x1 - w * 0.5, x1, h - 0.6, h - 0.56, z1 - d * 0.5, z1, { c: 0.004 });
  // top rails
  for (const z of [z0 + c, z1 - c]) bar(P, 'top', BLUE, [x0 + c, h - 0.04, z], [x1 - c, h - 0.04, z], 0.04);
  for (const x of [x0 + c, x1 - c]) bar(P, 'top', BLUE, [x, h - 0.04, z0 + c], [x, h - 0.04, z1 - c], 0.04);
  // monkey bars along the front
  for (let x = x0 + 0.2; x < x1 - 0.1; x += 0.25) bar(P, 'bars', CHROME, [x, h - 0.15, z1 - c], [x, h - 0.15, z1 - c - 0.0], 0.001);
  for (let x = x0 + 0.25; x < x1 - 0.2; x += 0.22) bar(P, 'rungs', CHROME, [x, h - 0.2, z0 + c], [x, h - 0.2, z1 - c], 0.012);
  // a rope net on the left face and a ladder on the back
  for (let y = 0.2; y < h - 0.2; y += 0.28) bar(P, 'net', { key: 'cotton', tint: '#C9822E' }, [x0 + c, y, z0 + c], [x0 + c, y, z1 - c], 0.01);
  for (let z = z0 + 0.3; z < z1 - 0.2; z += 0.3) bar(P, 'net', { key: 'cotton', tint: '#C9822E' }, [x0 + c, 0.05, z], [x0 + c, h - 0.1, z], 0.01);
  for (const x of [0.25, 0.65]) bar(P, 'ladder', YELLOW, [x - w / 2, 0, z0 - 0.0 + 0.01], [x - w / 2, s - 0.04, z0 + 0.12], 0.02);
  for (let y = 0.25; y < s - 0.1; y += 0.25) bar(P, 'ladder', YELLOW, [0.25 - w / 2, y, z0 + 0.03], [0.65 - w / 2, y, z0 + 0.03], 0.014);
}

/** 2 cm rubber tiles, a lighter border, a joint line every half metre */
function rubberMat(P: Parts, { w, d, h }: GenSize, colour: string): void {
  const m: MatSpec = { key: 'dark', tint: colour };
  P.box('mat', m, -w / 2, w / 2, 0, h, -d / 2, d / 2, { c: 0.003 });
  for (let x = -w / 2 + 0.5; x < w / 2 - 0.01; x += 0.5) P.box('joints', RUBBER, x - 0.004, x + 0.004, h - 0.001, h + 0.0005, -d / 2, d / 2, { c: 0 });
  for (let z = -d / 2 + 0.5; z < d / 2 - 0.01; z += 0.5) P.box('joints', RUBBER, -w / 2, w / 2, h - 0.001, h + 0.0005, z - 0.004, z + 0.004, { c: 0 });
}

function track(P: Parts, { w, d, h }: GenSize): void {
  P.box('track', { key: 'dark', tint: '#A8453A' }, -w / 2, w / 2, 0, h, -d / 2, d / 2, { c: 0.003 });
  for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) P.box('lines', WHITE_PAINT, -w / 2, w / 2, h - 0.001, h + 0.0005, z - 0.02, z + 0.02, { c: 0 });
  // a dashed centre line
  for (let x = -w / 2 + 0.3; x < w / 2 - 0.5; x += 0.9) P.box('lines', WHITE_PAINT, x, x + 0.45, h - 0.001, h + 0.0005, -0.015, 0.015, { c: 0 });
}

/** a low timber platform with four mats laid on it, a little apart */
function yogaDeck(P: Parts, { w, d, h }: GenSize): void {
  P.box('deck', TEAK, -w / 2, w / 2, 0, h, -d / 2, d / 2, { c: 0.004 });
  for (let x = -w / 2 + 0.2; x < w / 2 - 0.1; x += 0.17) P.box('gaps', RUBBER, x, x + 0.004, h - 0.001, h + 0.0005, -d / 2, d / 2, { c: 0 });
  const cols = ['#2E4A6E', '#7A3F6C', '#3E7A52', '#B5483A'];
  cols.forEach((c, i) => {
    const cx = -w / 2 + w * (0.17 + 0.222 * i);
    P.box('mats', { key: 'dark', tint: c }, cx - 0.305, cx + 0.305, h, h + 0.006, -0.9, 0.9, { c: 0.002 });
  });
}

/** a stone bowl on a pedestal with a rim, a still pool in it and a column of water (static) up to the jet at 110 cm */
function fountain(P: Parts, { w, d, h, s }: GenSize): void {
  const r = Math.min(w, d) / 2;
  disc(P, 'bowl', STONE, 0, 0, 0, 0.12, r);
  disc(P, 'bowl', STONE, 0, 0, 0.12, s, r * 0.97);
  disc(P, 'bowl-inner', { key: 'laminate', tint: '#9C9488' }, 0, 0, s - 0.01, s, r * 0.9);
  const w1 = new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.005, 24).translate(0, s - 0.06, 0);
  P.put('water', { key: 'gloss', tint: '#3C8FA6' }, w1);
  post(P, 'pedestal', STONE, 0, 0, s - 0.06, h - 0.35, 0.12, 1.4);
  disc(P, 'basin', STONE, 0, 0, h - 0.4, h - 0.32, 0.3);
  // the jet: a thin pale column that fans at the top
  post(P, 'jet', { key: 'sheer', tint: '#DDEFF3' }, 0, 0, h - 0.32, h, 0.016, 0.5);
  P.put('jet', { key: 'sheer', tint: '#DDEFF3' }, new THREE.SphereGeometry(0.1, 8, 6).scale(1, 0.55, 1).translate(0, h - 0.06, 0));
  void NAVY; void SIGN_RED;
}
