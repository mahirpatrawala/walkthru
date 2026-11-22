// SPEC 16.24 "2K top quality": the lived-in pieces drawn as products, not as stacked cylinders. Everything here is built only while the 2K level is on (build.ts reads
// `ultraDetail()`), at the same footprint and height as the piece it replaces (decor never changes a number: 16.2 rule 4). Round things are lathed from a profile with a
// rolled rim and a foot ring, a pot has a lid, a rim, a valve and handles, a hob has its glass, its grates and its knobs, a lamp its turned base and a drum shade.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PbrClass } from '../premium/pbr';
import type { DecorPiece } from './plan';

export interface UOpts { emissive?: string; shadow?: boolean; side?: THREE.Side; cls?: PbrClass }
export interface UParts { add(geo: THREE.BufferGeometry, hex: string, rough?: number, metal?: number, opts?: UOpts): void }
export type UBuilder = (p: DecorPiece, parts: UParts) => void;

const STEEL = '#B9BDC2';
const BRASS = '#C79A3C';
const BLACK = '#25272A';

/**
 * SPEC 16.15.3: the product builders also draw the kitchen's and the bedside's pieces on the medium and high tiers (they read as products, the stacked
 * cylinders did not), with the round parts at a share of the 2K segment count. 1 at 2K.
 */
let segShare = 1;
export function withSegShare<T>(k: number, fn: () => T): T {
  const was = segShare;
  segShare = k;
  try { return fn(); } finally { segShare = was; }
}
const sides = (n: number, min = 8): number => Math.max(min, Math.round(n * segShare));
/** the kinds drawn by the product builders below on the medium and high tiers too (the rest only at 2K) */
export const PRODUCT_KINDS = new Set<DecorPiece['kind']>(['cooker', 'dabbas', 'hob', 'lamp', 'nightstand', 'jug']);

/** a lathed solid from a profile of [radius, y] points (bottom to top), `seg` sides; the profile's corners are smoothed by the lathe's own normals, so a rolled rim is round */
function lathe(profile: [number, number][], seg: number, cx = 0, cz = 0, y0 = 0): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), sides(seg, 10));
  g.translate(cx, y0, cz);
  return g;
}
/** the points of a rounded corner from (r0, y0) to (r1, y1) bulging out through (rc, yc): a quarter-ish arc of `n` steps */
function arc(from: [number, number], via: [number, number], to: [number, number], n = 5): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    out.push([a * from[0] + b * via[0] + c * to[0], a * from[1] + b * via[1] + c * to[1]]);
  }
  return out;
}
function roundedBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number, seg = 3): THREE.BufferGeometry {
  const w = Math.max(0.001, x1 - x0), h = Math.max(0.001, y1 - y0), d = Math.max(0.001, z1 - z0);
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.max(0.0005, Math.min(r, Math.min(w, h, d) / 2 - 0.0003)));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
function torus(R: number, r: number, y: number, seg = 48, x = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(R, r, sides(14, 6), sides(seg, 12));
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
/** a half-loop handle: part of a torus standing in the xy plane, from angle a0 to a1 */
function loop(R: number, r: number, a0: number, a1: number, cx: number, cy: number, cz: number, seg = 28): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(R, r, sides(12, 6), sides(seg, 10), a1 - a0);
  g.rotateZ(a0);
  g.translate(cx, cy, cz);
  return g;
}

export const ULTRA_BUILD: Partial<Record<DecorPiece['kind'], UBuilder>> = {
  cooker(_p, parts) {
    // a stainless pressure cooker: rounded foot, a straight body with a rolled rim, a domed lid with a locking rim, a weight valve, a vent and two bakelite handles
    const r = 0.105, H = 0.17;
    const body: [number, number][] = [[0, 0.0005], ...arc([r * 0.86, 0.0005], [r, 0.0005], [r, 0.014], 5), [r + 0.0008, H - 0.012], ...arc([r + 0.001, H - 0.012], [r + 0.006, H - 0.002], [r - 0.002, H - 0.001], 4)];
    parts.add(lathe(body, 64), STEEL, 0.3, 0.9, { cls: 'steel' });
    // the lid: a locking rim, then a shallow dome
    const lid: [number, number][] = [[r + 0.009, H - 0.003], [r + 0.011, H + 0.006], ...arc([r + 0.011, H + 0.006], [r + 0.011, H + 0.014], [r - 0.008, H + 0.014], 4), ...arc([r - 0.008, H + 0.014], [r * 0.5, H + 0.03], [0.02, H + 0.032], 7), [0, H + 0.032]];
    parts.add(lathe(lid, 64), STEEL, 0.28, 0.9, { cls: 'steel' });
    // weight valve (a turned pin with a cap) and the vent plug
    parts.add(lathe([[0.009, H + 0.031], [0.009, H + 0.05], [0.016, H + 0.05], [0.016, H + 0.062], [0.012, H + 0.066], [0, H + 0.066]], 24), '#2A2724', 0.5, 0, { cls: 'plastic' });
    parts.add(lathe([[0.007, H + 0.026], [0.007, H + 0.036], [0.011, H + 0.036], [0.011, H + 0.04], [0, H + 0.04]], 20, 0.055, -0.03), '#2A2724', 0.5, 0, { cls: 'plastic' });
    // the long handle (cooking side) and the short helper, bakelite, rounded
    parts.add(roundedBox(r + 0.004, r + 0.092, H - 0.006, H + 0.016, -0.018, 0.018, 0.006), '#2A2724', 0.45, 0, { cls: 'plastic' });
    parts.add(roundedBox(-r - 0.056, -r - 0.004, H - 0.006, H + 0.012, -0.016, 0.016, 0.006), '#2A2724', 0.45, 0, { cls: 'plastic' });
    for (const sx of [-1, 1]) parts.add(roundedBox(sx * (r - 0.004) - 0.011, sx * (r - 0.004) + 0.011, H - 0.012, H + 0.002, -0.014, 0.014, 0.004), STEEL, 0.3, 0.9, { cls: 'steel' });
  },
  dabbas(_p, parts) {
    // a three-tier tiffin: each tin has a rolled rim and a seat for the next, a carrying handle and two clips on a frame
    const radii = [0.095, 0.085, 0.075], hs = [0.09, 0.085, 0.07];
    let y = 0;
    radii.forEach((r, i) => {
      const prof: [number, number][] = [[0, 0.0005], ...arc([r * 0.9, 0.0005], [r, 0.0005], [r, 0.01], 4), [r, hs[i] - 0.014], ...arc([r, hs[i] - 0.014], [r + 0.007, hs[i] - 0.002], [r - 0.004, hs[i]], 4)];
      parts.add(lathe(prof, 56, 0, 0, y), STEEL, 0.3, 0.9, { cls: 'steel' });
      parts.add(torus(r + 0.002, 0.0016, y + hs[i] * 0.55, 56), STEEL, 0.28, 0.9, { cls: 'steel' });
      y += hs[i];
    });
    // the lid, a dome and its knob
    parts.add(lathe([[0.0, y], [radii[2] + 0.005, y], ...arc([radii[2] + 0.005, y], [radii[2] + 0.005, y + 0.022], [radii[2] - 0.02, y + 0.024], 5), ...arc([radii[2] - 0.02, y + 0.024], [0.03, y + 0.034], [0.012, y + 0.036], 5), [0, y + 0.036]], 56), STEEL, 0.28, 0.9, { cls: 'steel' });
    parts.add(lathe([[0.011, y + 0.034], [0.011, y + 0.044], [0.019, y + 0.047], [0.019, y + 0.054], [0.0, y + 0.056]], 28), '#2A2724', 0.5, 0, { cls: 'plastic' });
    // the frame: two uprights up the back of the stack and a bent-wire handle across the top
    for (const sx of [-1, 1]) parts.add(roundedBox(sx * 0.082 - 0.004, sx * 0.082 + 0.004, 0.01, y + 0.012, -0.006, 0.006, 0.0025), STEEL, 0.3, 0.9, { cls: 'steel' });
    parts.add(loop(0.082, 0.0042, 0, Math.PI, 0, y + 0.012, 0, 32), STEEL, 0.28, 0.9, { cls: 'steel' });
  },
  jug(_p, parts) {
    // a steel water jug: a flared foot, a swelling body, a pouring lip and a riveted strap handle
    const body: [number, number][] = [[0, 0.0005], ...arc([0.052, 0.0005], [0.064, 0.0005], [0.063, 0.014], 4), ...arc([0.063, 0.014], [0.061, 0.1], [0.05, 0.19], 6), ...arc([0.05, 0.19], [0.056, 0.206], [0.052, 0.211], 4), [0.044, 0.209]];
    parts.add(lathe(body, 56), STEEL, 0.3, 0.9, { cls: 'steel' });
    parts.add(loop(0.052, 0.0055, -Math.PI * 0.42, Math.PI * 0.42, 0.045, 0.13, 0, 24).scale(0.75, 1.0, 0.9), STEEL, 0.3, 0.9, { cls: 'steel' });
    parts.add(lathe([[0.0, 0.205], [0.047, 0.205], [0.047, 0.21], [0, 0.222]], 40), '#2A2724', 0.5, 0, { cls: 'plastic' });
  },
  hob(p, parts) {
    // a four-burner gas hob: a black glass top with rounded corners, brass burner caps in steel rings, cast-iron pan supports and chrome knobs on the front edge
    const w = p.w, d = p.d;
    parts.add(roundedBox(-w / 2, w / 2, 0, 0.022, -d / 2, d / 2, 0.0035, 3), BLACK, 0.12, 0, { cls: 'screen' });
    parts.add(roundedBox(-w / 2 + 0.004, w / 2 - 0.004, 0.0215, 0.0235, -d / 2 + 0.004, d / 2 - 0.004, 0.0008, 2), '#15161A', 0.1, 0, { cls: 'screen', shadow: false });
    const burners: [number, number, number][] = [[-0.14, -0.1, 0.06], [0.14, -0.1, 0.045], [-0.14, 0.11, 0.045], [0.14, 0.11, 0.06]];
    for (const [bx, bz, r] of burners) {
      parts.add(lathe([[r * 1.0, 0.022], [r * 1.0, 0.027], [r * 0.9, 0.0285], [r * 0.9, 0.022]], 48, bx, bz), STEEL, 0.28, 0.95, { cls: 'steel' });
      parts.add(lathe([[0, 0.0285], [r * 0.62, 0.0285], [r * 0.62, 0.034], [r * 0.5, 0.037], [0, 0.038]], 48, bx, bz), BRASS, 0.32, 0.95, { cls: 'brass' });
      parts.add(torus(r * 0.68, 0.0035, 0.03, 36, bx, bz), '#1A1B1D', 0.5, 0.3, { cls: 'darkMetal' });
    }
    // the pan supports: a frame of flat bars over the two halves, each bar 8 mm wide
    for (const sx of [-1, 1]) {
      const cx = sx * 0.14, hw = 0.1, hd = 0.2;
      for (const sz of [-1, 1]) parts.add(roundedBox(cx - hw, cx + hw, 0.026, 0.036, sz * hd / 2 - 0.004, sz * hd / 2 + 0.004, 0.0015, 2), '#1A1B1D', 0.55, 0.4, { cls: 'darkMetal' });
      for (const dx of [-1, 1]) parts.add(roundedBox(cx + dx * hw - 0.004, cx + dx * hw + 0.004, 0.026, 0.036, -hd / 2, hd / 2, 0.0015, 2), '#1A1B1D', 0.55, 0.4, { cls: 'darkMetal' });
      parts.add(roundedBox(cx - 0.004, cx + 0.004, 0.026, 0.036, -hd / 2, hd / 2, 0.0015, 2), '#1A1B1D', 0.55, 0.4, { cls: 'darkMetal' });
      parts.add(roundedBox(cx - hw, cx + hw, 0.026, 0.036, -0.004, 0.004, 0.0015, 2), '#1A1B1D', 0.55, 0.4, { cls: 'darkMetal' });
    }
    for (let i = 0; i < 4; i++) parts.add(lathe([[0, 0.022], [0.0125, 0.022], [0.0125, 0.03], [0.0105, 0.033], [0, 0.033]], 32, -0.2 + i * 0.133, d / 2 - 0.022), STEEL, 0.25, 1, { cls: 'chrome' });
  },
  fruit(p, parts) {
    // a glazed ceramic bowl on a foot ring, with its fruit
    const r = Math.min(0.15, p.w / 2);
    const prof: [number, number][] = [[0, 0.0], [r * 0.38, 0.0], [r * 0.4, 0.012], ...arc([r * 0.4, 0.012], [r * 0.9, 0.03], [r, r * 0.55 - 0.012], 8), ...arc([r, r * 0.55 - 0.012], [r + 0.004, r * 0.55], [r - 0.006, r * 0.55], 3), ...arc([r - 0.006, r * 0.55], [r - 0.012, r * 0.55 - 0.02], [r * 0.82, r * 0.3], 5), [r * 0.4, 0.02], [0, 0.02]];
    parts.add(lathe(prof, 56), '#B5573A', 0.12, 0, { cls: 'ceramic', side: THREE.DoubleSide });
    const cols = ['#E8793A', '#D9A23F', '#6BA84F', '#C94B3A', '#E8793A'];
    const rr = (i: number): number => ((Math.sin(p.seed * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rr(i), rad = i === 5 ? 0 : r * 0.5;
      const g = new THREE.SphereGeometry(0.038, 32, 20);
      g.scale(1, 0.92, 1);
      g.translate(Math.cos(a) * rad, r * 0.3 + (i === 5 ? 0.06 : 0.032), Math.sin(a) * rad);
      parts.add(g, cols[i % cols.length], 0.4, 0);
      // a stalk dimple's worth of stem
      parts.add(lathe([[0.002, 0], [0.003, 0.014], [0.0015, 0.016]], 8, Math.cos(a) * rad, Math.sin(a) * rad, r * 0.3 + (i === 5 ? 0.06 : 0.032) + 0.03), '#4C3A22', 0.9, 0);
    }
  },
  lamp(p, parts) {
    // a table lamp: a turned brass foot and stem, a drum shade of white linen that glows
    const k = p.height / 0.34;
    parts.add(lathe([[0, 0], [0.065 * k, 0], [0.066 * k, 0.006 * k], ...arc([0.066 * k, 0.006 * k], [0.05 * k, 0.03 * k], [0.02 * k, 0.04 * k], 4), [0.012 * k, 0.05 * k], [0.011 * k, 0.2 * k], [0.016 * k, 0.205 * k], [0, 0.21 * k]], 48), BRASS, 0.3, 0.95, { cls: 'brass' });
    parts.add(lathe([[0.11 * k, 0.19 * k], [0.07 * k, 0.34 * k]], 64), '#F3E4C4', 0.95, 0, { cls: 'shade', emissive: '#FFD9A0', side: THREE.DoubleSide, shadow: false });
  },
  nightstand(p, parts) {
    // a bedside table: a white carcass on a short plinth, an oak top with a soft edge, a drawer with a turned knob, and a lamp with a glowing drum shade
    const w = p.w, d = p.d;
    parts.add(roundedBox(-w / 2 + 0.03, w / 2 - 0.03, 0, 0.07, -d / 2 + 0.03, d / 2 - 0.03, 0.002, 2), '#6E5438', 0.6, 0, { cls: 'satin' });
    parts.add(roundedBox(-w / 2, w / 2, 0.07, 0.5, -d / 2, d / 2, 0.003, 3), '#EFEADF', 0.55, 0, { cls: 'satin' });
    parts.add(roundedBox(-w / 2 - 0.006, w / 2 + 0.006, 0.5, 0.522, -d / 2 - 0.006, d / 2 + 0.012, 0.007, 3), '#C9A77C', 0.5, 0, { cls: 'veneer' });
    parts.add(roundedBox(-w / 2 + 0.03, w / 2 - 0.03, 0.29, 0.296, d / 2, d / 2 + 0.002, 0.0008, 2), '#B7AE9E', 0.7, 0);
    parts.add(new THREE.SphereGeometry(0.014, 28, 18).translate(0, 0.4, d / 2 + 0.012), BRASS, 0.3, 0.95, { cls: 'brass' });
    parts.add(lathe([[0, 0], [0.058, 0], [0.058, 0.006], ...arc([0.058, 0.006], [0.044, 0.026], [0.018, 0.03], 4), [0.012, 0.04], [0.011, 0.148], [0.015, 0.152], [0, 0.158]], 48, 0, 0, 0.522), BRASS, 0.3, 0.95, { cls: 'brass' });
    parts.add(lathe([[0.125, 0.69], [0.0855, 0.86]], 64), '#F6E8CB', 0.95, 0, { cls: 'shade', emissive: '#FFD9A0', side: THREE.DoubleSide, shadow: false });
  },
  plant(p, parts) {
    // the pot only is lathed here (a glazed pot with a rolled rim, a saucer and soil); the foliage stays as it is (the caller adds it after)
    const pot = ['#B5573A', '#EFE3CD', '#2E7D84'][p.tone % 3];
    parts.add(lathe([[0, 0.012], [0.08, 0.012], ...arc([0.08, 0.012], [0.1, 0.012], [0.102, 0.03], 3), ...arc([0.102, 0.03], [0.13, 0.12], [0.15, 0.21], 8), ...arc([0.15, 0.21], [0.162, 0.222], [0.15, 0.228], 4), [0.13, 0.226], [0.13, 0.2], [0, 0.2]], 56), pot, 0.14, 0, { cls: 'ceramic', side: THREE.DoubleSide });
    parts.add(lathe([[0, 0], [0.11, 0], [0.12, 0.006], [0.132, 0.016], [0.126, 0.016], [0.116, 0.01], [0, 0.01]], 56), pot, 0.14, 0, { cls: 'ceramic' });
    parts.add(lathe([[0, 0.2], [0.128, 0.2], [0.128, 0.224], [0, 0.226]], 40), '#3B2B20', 1, 0);
  },
};

/** the pieces the 2K builder replaces entirely; a piece not here keeps its builder, with finer round parts (build.ts `seg`) */
export const ULTRA_REPLACES = new Set<DecorPiece['kind']>(['cooker', 'dabbas', 'jug', 'hob', 'fruit', 'lamp', 'nightstand']);
/** the plant's pot is lathed here, its leaves are the plain builder's: build.ts calls this in place of the pot's cylinders */
export const ULTRA_POT = ULTRA_BUILD.plant as UBuilder;
