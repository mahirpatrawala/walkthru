// Small parts the furniture families share (SPEC 16.13): glass, chrome and ceramic that no pack colours, round legs and posts whose bounding
// box is exact (a round part has a multiple of four sides, so its extremes lie on the axes), cushions and handles.
import * as THREE from 'three';
import { roundedBoxBetween } from '../furniture-parts';
import { softCushion } from './soft';
import type { GenEnv, MatSpec, Parts } from './core';
import { cylinderY, rod } from './geo';

export const GLASS: MatSpec = { key: 'sheer', tint: '#BFD6DD' };
export const MIRROR: MatSpec = { key: 'gloss', tint: '#BFD2DA' };
export const CHROME: MatSpec = { key: 'metal', tint: '#D9DCDE' };
export const CERAMIC: MatSpec = { key: 'gloss', tint: '#F5F3EF' };
export const RUBBER: MatSpec = { key: 'dark', tint: '#2A2A2C' };
export const CANE: MatSpec = { key: 'wood', tint: '#C9A66B' };
export const LEAF: MatSpec = { key: 'weave', tint: '#4F7A47' };
export const SOIL: MatSpec = { key: 'dark', tint: '#3A2C22' };

/** radial sides of a round part: never fewer than 8, so the bounds stay exact */
export const rsides = (env: GenEnv): number => (env.q.sides <= 6 ? 8 : env.q.sides);

/** a vertical round post or leg */
export function post(p: Parts, name: string, mat: MatSpec, cx: number, cz: number, y0: number, y1: number, r: number, taper = 1): void {
  const g = new THREE.CylinderGeometry(r * taper, r, Math.max(0.0005, y1 - y0), rsides(p.env), 1, false);
  g.translate(cx, (y0 + y1) / 2, cz);
  p.put(name, mat, g);
}

/** a round slab (a table top, a tray, a pot) with an exact radius */
export function disc(p: Parts, name: string, mat: MatSpec, cx: number, cz: number, y0: number, y1: number, r: number, o: { sx?: number; sz?: number } = {}): void {
  const g = cylinderY(0, 0, y0, y1, r, rsides(p.env) * 2);
  if (o.sx || o.sz) g.scale(o.sx ?? 1, 1, o.sz ?? 1);
  g.translate(cx, 0, cz);
  p.put(name, mat, g, { uv: 'world' });
}

/** a bar between two points */
export function bar(p: Parts, name: string, mat: MatSpec, a: [number, number, number], b: [number, number, number], r: number): void {
  p.put(name, mat, rod({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }, r, p.env.q.sides <= 6 ? 6 : p.env.q.sides));
}

/** a soft block: a puffed cushion on the tiers that have one, a rounded box on the lowest; it fills exactly x0..x1, y0..y1, z0..z1 */
export function soft(env: GenEnv, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, puff = 0.02): THREE.BufferGeometry {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const grid = env.q.puff > 0;
  const g = grid ? softCushion(w, h, d, { r: Math.min(0.05, h / 2.6), puff: Math.min(puff * 1.4, h / 3), seg: env.q.tier === 'high' ? 3 : 2 }) : roundedBoxBetween(-w / 2, w / 2, -h / 2, h / 2, -d / 2, d / 2, Math.min(0.03, h / 2.5), 1);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** where the plane of a drawer or door front goes so that its handle ends exactly at the front of a box of depth `d` */
export const zfOf = (d: number, handle: HandleStyle): number => d / 2 - (handle === 'groove' ? 0.0025 : 0.016);

/** a flat handle across the top of a front, or a bar, or a knob */
export type HandleStyle = 'groove' | 'knob' | 'bar';
export function frontPanel(p: Parts, name: string, face: MatSpec, hm: MatSpec, x0: number, x1: number, y0: number, y1: number, zf: number, handle: HandleStyle, th = 0.018): void {
  p.box(name, face, x0, x1, y0, y1, zf - th, zf, { c: 0.002 });
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (handle === 'groove') {
    p.put(`${name}-handles`, hm, new THREE.BoxGeometry(Math.min(0.5, (x1 - x0) * 0.6), 0.012, 0.004).translate(cx, y1 - 0.02, zf + 0.0005));
  } else if (handle === 'knob') {
    const g = new THREE.CylinderGeometry(0.012, 0.015, 0.016, 8, 1);
    g.rotateX(Math.PI / 2);
    g.translate(cx, cy, zf + 0.008);
    p.put(`${name}-handles`, hm, g);
  } else {
    const len = Math.min(0.3, (x1 - x0) * 0.55);
    p.put(`${name}-handles`, hm, rod({ x: cx - len / 2, y: cy, z: zf + 0.01 }, { x: cx + len / 2, y: cy, z: zf + 0.01 }, 0.006, 6));
    for (const sx of [-1, 1]) p.put(`${name}-handles`, hm, rod({ x: cx + sx * (len / 2 - 0.02), y: cy, z: zf }, { x: cx + sx * (len / 2 - 0.02), y: cy, z: zf + 0.01 }, 0.0035, 6));
  }
}
