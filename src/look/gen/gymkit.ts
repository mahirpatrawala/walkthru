// Parts the gym generators share (SPEC 16.17): frame tubes, pads, weight stacks, plates, dumbbells, handles and cables. Everything is a plain geometry put
// into a `Parts` bucket, so a machine is a handful of meshes (one per material and part name), every one tagged `walkthruPart` for the bake.
// Sizes are real: a plate is 45 cm across, a dumbbell head follows its weight, a pad is 10 cm thick. The tier decides sides and chamfers, not shapes.
import * as THREE from 'three';
import { roundedBoxBetween } from '../furniture-parts';
import type { MatSpec, Parts } from './core';
import { CHROME, RUBBER } from './kit';

// dark-grey painted steel, not black metal (SPEC 16.20): under the plain sky a high-metalness black reads as a flat silhouette
export const FRAME: MatSpec = { key: 'laminate', tint: '#5A5F67' };
export const FRAME_GREY: MatSpec = { key: 'metal', tint: '#A3A9B0' };
export const SHROUD: MatSpec = { key: 'laminate', tint: '#C7CBD0' };
export const SHROUD_LIGHT: MatSpec = { key: 'laminate', tint: '#EDEFF1' };
export const CONSOLE: MatSpec = { key: 'laminate', tint: '#2D3036' };
export const PAD_BLACK: MatSpec = { key: 'dark', tint: '#3A3D43' };
export const PAD_GREY: MatSpec = { key: 'dark', tint: '#555962' };
export const ACCENT_RED: MatSpec = { key: 'paint', tint: '#B3322B' };
export const ACCENT_BLUE: MatSpec = { key: 'paint', tint: '#2F5F9E' };
export const STACK_STEEL: MatSpec = { key: 'metal', tint: '#B2B7BD' };
export const IRON: MatSpec = { key: 'laminate', tint: '#484B51' };
export const SCREEN_GLASS: MatSpec = { key: 'granite', tint: '#0D1722' };
export const WOOD_ASH: MatSpec = { key: 'wood', tint: '#C8A06B' };
export { CHROME, RUBBER };

type V3 = [number, number, number];

/** a thin round tube between two points: open ended (nobody sees inside a 2 cm tube), so a tube is 2 x sides triangles */
export function tube(p: Parts, name: string, mat: MatSpec, a: V3, b: V3, r: number, caps = false): void {
  const sides = p.env.q.sides <= 6 ? 6 : p.env.q.sides;
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = Math.max(0.0005, va.distanceTo(vb));
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1, !caps);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  p.put(name, mat, g);
}

/** a polyline of tubes (a bent handlebar, a frame) */
export function tubes(p: Parts, name: string, mat: MatSpec, pts: V3[], r: number, caps = false): void {
  for (let i = 0; i + 1 < pts.length; i++) tube(p, name, mat, pts[i], pts[i + 1], r, caps);
}

/** a cylinder along x (a roller, a plate, a dumbbell head, a flywheel disc) */
export function cylX(p: Parts, name: string, mat: MatSpec, x0: number, x1: number, y: number, z: number, r: number, sides?: number): void {
  const n = sides ?? Math.max(8, p.env.q.sides * 2);
  const g = new THREE.CylinderGeometry(r, r, Math.max(0.0005, x1 - x0), n, 1, false);
  g.rotateZ(Math.PI / 2);
  g.translate((x0 + x1) / 2, y, z);
  p.put(name, mat, g);
}

/** a cylinder along z (a pad roll, a barbell sleeve, a punching bag lying down) */
export function cylZ(p: Parts, name: string, mat: MatSpec, z0: number, z1: number, x: number, y: number, r: number, sides?: number): void {
  const n = sides ?? Math.max(8, p.env.q.sides * 2);
  const g = new THREE.CylinderGeometry(r, r, Math.max(0.0005, z1 - z0), n, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, (z0 + z1) / 2);
  p.put(name, mat, g);
}

/** a vertical cylinder */
export function cylY(p: Parts, name: string, mat: MatSpec, cx: number, cz: number, y0: number, y1: number, r: number, sides?: number): void {
  const n = sides ?? Math.max(8, p.env.q.sides * 2);
  const g = new THREE.CylinderGeometry(r, r, Math.max(0.0005, y1 - y0), n, 1, false);
  g.translate(cx, (y0 + y1) / 2, cz);
  p.put(name, mat, g);
}

/** a padded block: rounded edges where the tier has the triangles for it, a plain box on the lowest */
export function pad(p: Parts, name: string, mat: MatSpec, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r = 0.03): void {
  if (p.env.q.chamfer) p.put(name, mat, roundedBoxBetween(x0, x1, y0, y1, z0, z1, Math.min(r, (y1 - y0) / 2.2, (x1 - x0) / 2.2, (z1 - z0) / 2.2), 1), { tile: 0.4 });
  else p.put(name, mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), { tile: 0.4 });
}

/** a box without chamfer (12 triangles): for hidden or plain parts */
export function slab(p: Parts, name: string, mat: MatSpec, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  p.put(name, mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
}

/**
 * A selectorised weight stack: `n` steel plates between two guide rods, a selector pin, a top plate. The stack fills x0..x1, z0..z1, y0..y1.
 * The lowest tier draws it as one block with a few plate lines; the others draw every plate.
 */
export function weightStack(p: Parts, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, n = 18, cover = true): void {
  const th = (y1 - y0) / n;
  if (p.env.q.tier === 'low') {
    slab(p, 'stack-plates', STACK_STEEL, x0 + 0.01, x1 - 0.01, y0, y1, z0 + 0.01, z1 - 0.01);
  } else {
    for (let i = 0; i < n; i++) slab(p, 'stack-plates', STACK_STEEL, x0 + 0.015, x1 - 0.015, y0 + i * th + 0.002, y0 + (i + 1) * th - 0.002, z0 + 0.015, z1 - 0.015);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (const s of [-1, 1]) tube(p, 'stack-rods', CHROME, [x0 + (s > 0 ? (x1 - x0) * 0.86 : (x1 - x0) * 0.14), y0 - 0.02, cz], [x0 + (s > 0 ? (x1 - x0) * 0.86 : (x1 - x0) * 0.14), y1 + 0.1, cz], 0.009);
  slab(p, 'stack-selector', ACCENT_RED, cx - 0.02, cx + 0.02, y0 + th * 5, y0 + th * 5 + 0.03, z1 - 0.01, z1 + 0.035);
  if (cover) {
    // the shroud: three sides and a top, with the front face open as a window (a dark panel with the plates seen through a slot)
    slab(p, 'stack-shroud', SHROUD, x0 - 0.02, x1 + 0.02, y1, y1 + 0.1, z0 - 0.02, z1 + 0.02);
    slab(p, 'stack-shroud', SHROUD, x0 - 0.02, x0 + 0.005, y0 - 0.02, y1, z0 - 0.02, z1 + 0.02);
    slab(p, 'stack-shroud', SHROUD, x1 - 0.005, x1 + 0.02, y0 - 0.02, y1, z0 - 0.02, z1 + 0.02);
    slab(p, 'stack-shroud', SHROUD, x0 - 0.02, x1 + 0.02, y0 - 0.02, y1, z0 - 0.02, z0 + 0.005);
  }
}

/** a barbell plate (axis x): `r` the radius, `th` the thickness, with a hub */
export function plateDisc(p: Parts, cx: number, y: number, z: number, r: number, th: number, mat: MatSpec = IRON): void {
  cylX(p, 'plates', mat, cx - th / 2, cx + th / 2, y, z, r, Math.max(10, p.env.q.sides * 2));
  cylX(p, 'plate-hubs', CHROME, cx - th / 2 - 0.004, cx + th / 2 + 0.004, y, z, 0.03, 8);
}

/** a hex or round dumbbell lying along x (or z, as it sits in a rack), centre (cx, y, cz): head radius and length follow its weight (2.5 to 25 kg) */
export function dumbbell(p: Parts, cx: number, y: number, cz: number, kg: number, axis: 'x' | 'z' = 'x', name = 'dumbbells'): void {
  const t = Math.min(1, Math.max(0, (kg - 2.5) / 22.5));
  const headR = 0.03 + 0.032 * t, headL = 0.05 + 0.065 * t, grip = 0.065;
  const sides = p.env.q.tier === 'low' ? 6 : 8;
  const at = (g: THREE.BufferGeometry, off: number): THREE.BufferGeometry => {
    if (axis === 'x') { g.rotateZ(Math.PI / 2); g.translate(cx + off, y, cz); } else { g.rotateX(Math.PI / 2); g.translate(cx, y, cz + off); }
    return g;
  };
  for (const s of [-1, 1]) p.put(name, IRON, at(new THREE.CylinderGeometry(headR, headR, headL, sides, 1, false), s * (grip + headL / 2)));
  p.put('dumbbell-handles', CHROME, at(new THREE.CylinderGeometry(0.0155, 0.0155, grip * 2 + 0.02, 6, 1, false), 0));
}

/** the overall length of one dumbbell along its handle, metres */
export const dumbbellLength = (kg: number): number => 2 * (0.065 + 0.05 + 0.065 * Math.min(1, Math.max(0, (kg - 2.5) / 22.5)));
/** the radius of its head, metres */
export const dumbbellRadius = (kg: number): number => 0.03 + 0.032 * Math.min(1, Math.max(0, (kg - 2.5) / 22.5));

/** a cable (a thin steel rod) running through points */
export function cable(p: Parts, pts: V3[], r = 0.0035): void {
  for (let i = 0; i + 1 < pts.length; i++) tube(p, 'cables', { key: 'metal', tint: '#6C7075' }, pts[i], pts[i + 1], r);
}

/** a pulley wheel with its bracket (axis x) */
export function pulley(p: Parts, x: number, y: number, z: number, r = 0.055): void {
  cylX(p, 'pulleys', SHROUD_LIGHT, x - 0.014, x + 0.014, y, z, r, 10);
}

/** a rubber hand grip: a short cylinder along an axis given by two points */
export function grip(p: Parts, a: V3, b: V3, r = 0.017): void {
  tube(p, 'grips', RUBBER, a, b, r, true);
}
