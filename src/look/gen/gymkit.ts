// Parts the gym generators share (SPEC 16.17, rebuilt 22 Nov 2026 in 16.17.1): the materials of a commercial clubhouse gym (powder-coated
// charcoal steel, brushed silver shrouds, chrome rods, black vinyl upholstery with a photographed leather grain, rubber), and the shapes it is
// built from: oval and rectangular steel tube with rounded corners, bent round tube, upholstered pads on backing boards, a weight stack of real
// plates with guide rods, a selector pin and its cable, grooved pulleys, foam grips, pop-pin knobs and console screens.
// Everything is a plain geometry put into a `Parts` bucket, so a machine is a handful of meshes (one per material and part name), each tagged
// `walkthruPart` for the bake. Sizes are real: a plate is 45 cm across, a dumbbell head follows its weight, a pad is 6 to 10 cm thick.
import * as THREE from 'three';
import type { MatSpec, Parts } from './core';
import { CHROME } from './kit';
import { softCushion } from './soft';

import type { PropGeo } from '../gym/props';

// ---------------------------------------------------------------- materials
/** powder-coated graphite steel: the frames (a commercial graphite grey: in a windowless gym lit by its downlights a black frame is only a silhouette, SPEC 16.20) */
export const FRAME: MatSpec = { key: 'powder', tint: '#60656D' };
/** brushed titanium-silver steel: uprights, arms, handlebars of the cardio machines */
export const FRAME_GREY: MatSpec = { key: 'metal', tint: '#A7ACB2' };
/** moulded charcoal plastic: motor hoods, covers, consoles' backs */
export const SHROUD: MatSpec = { key: 'plastic', tint: '#6A6F77' };
/** brushed silver sheet: the side shrouds of a weight stack, trim */
export const SHROUD_LIGHT: MatSpec = { key: 'metal', tint: '#C3C7CC' };
/** the console's face around a screen */
export const CONSOLE: MatSpec = { key: 'plastic', tint: '#41454C' };
/** black vinyl upholstery (a leather-grain normal on medium and high) */
export const PAD_BLACK: MatSpec = { key: 'vinyl' };
export const PAD_GREY: MatSpec = { key: 'vinyl', tint: '#4B4F56' };
/** the one accent colour: pop-pin knobs, selector pins, a stripe */
export const ACCENT_RED: MatSpec = { key: 'plastic', tint: '#C2342C' };
export const ACCENT_BLUE: MatSpec = { key: 'plastic', tint: '#2F5F9E' };
/** the plates of a weight stack: black powder-coated steel */
export const STACK_STEEL: MatSpec = { key: 'powder', tint: '#50545A' };
/** cast iron of a barbell plate, a kettlebell */
export const IRON: MatSpec = { key: 'powder', tint: '#50545A' };
/** a console's screen: dark glass */
export const SCREEN_GLASS: MatSpec = { key: 'granite', tint: '#121820' };
/** a screen's picture: the blue of a workout display at rest (not emissive: a glowing panel would be the brightest thing in the room) */
export const SCREEN_LIT: MatSpec = { key: 'gloss', tint: '#29507A' };
export const WOOD_ASH: MatSpec = { key: 'wood', tint: '#C8A06B' };
/** black rubber: feet, belts, grips, dumbbell heads */
export const RUBBER: MatSpec = { key: 'rubber' };
/** steel cable */
export const CABLE: MatSpec = { key: 'metal', tint: '#4A4D52' };
/** white print: plate numbers, labels */
export const LABEL: MatSpec = { key: 'white' };
export { CHROME };

type V3 = [number, number, number];

/** sides of a round tube at this tier */
const roundSides = (p: Parts, min = 6): number => Math.max(min, p.env.q.tier === 'low' ? 6 : p.env.q.tier === 'medium' ? 10 : 16);

// ---------------------------------------------------------------- round tube

/** a round tube between two points; closed ends unless `caps` is false */
export function tube(p: Parts, name: string, mat: MatSpec, a: V3, b: V3, r: number, caps = true): void {
  const sides = roundSides(p, 6);
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = Math.max(0.0005, va.distanceTo(vb));
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1, !caps);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  p.put(name, mat, g);
}

/** a bent round tube through `pts`, each corner an arc of `k` steps (a lighter cousin of geo.ts roundedRun: a handlebar needs no 24-step bends) */
function bentRun(pts: V3[], r: number, corner: number, radial: number, k: number): THREE.BufferGeometry {
  const v = pts.map((q) => new THREE.Vector3(...q));
  const path = new THREE.CurvePath<THREE.Vector3>();
  let from = v[0].clone();
  let segs = 0;
  for (let i = 1; i < v.length - 1; i++) {
    const a = v[i - 1], b = v[i], c = v[i + 1];
    const rc = Math.min(corner, a.distanceTo(b) * 0.5, b.distanceTo(c) * 0.5);
    const p0 = b.clone().add(a.clone().sub(b).setLength(rc)), p1 = b.clone().add(c.clone().sub(b).setLength(rc));
    path.add(new THREE.LineCurve3(from, p0)); path.add(new THREE.QuadraticBezierCurve3(p0, b, p1));
    from = p1; segs += 1 + k;
  }
  path.add(new THREE.LineCurve3(from, v[v.length - 1])); segs += 1;
  // sample the path at its own points (a straight leg is one step, a bend `k`)
  const samples: THREE.Vector3[] = [];
  for (const cu of path.curves) { const n = cu instanceof THREE.LineCurve3 ? 1 : k; for (let j = samples.length ? 1 : 0; j <= n; j++) samples.push(cu.getPoint(j / n)); }
  const curve = new THREE.CatmullRomCurve3(samples, false, 'centripetal', 0);
  return new THREE.TubeGeometry(curve, Math.max(segs, samples.length - 1), r, radial, false);
}

/** a polyline of tubes; on medium and high the corners are bent (a real handlebar is one bent tube, not welded rods) */
export function tubes(p: Parts, name: string, mat: MatSpec, pts: V3[], r: number, caps = true): void {
  if (p.env.q.tier !== 'low' && pts.length > 2) {
    const g = bentRun(pts, r, Math.max(r * 3, 0.05), r < 0.01 ? 6 : roundSides(p, 8), p.env.q.tier === 'high' ? 5 : 3);
    p.put(name, mat, g);
    if (caps) for (const end of [pts[0], pts[pts.length - 1]]) p.put(name, mat, new THREE.SphereGeometry(r, roundSides(p, 6), 4).translate(...end));
    return;
  }
  for (let i = 0; i + 1 < pts.length; i++) tube(p, name, mat, pts[i], pts[i + 1], r, caps);
}

/** a cylinder along x (a roller, a plate, a flywheel disc) */
export function cylX(p: Parts, name: string, mat: MatSpec, x0: number, x1: number, y: number, z: number, r: number, sides?: number): void {
  const n = sides ?? Math.max(8, roundSides(p) * 2);
  const g = new THREE.CylinderGeometry(r, r, Math.max(0.0005, x1 - x0), n, 1, false);
  g.rotateZ(Math.PI / 2);
  g.translate((x0 + x1) / 2, y, z);
  p.put(name, mat, g);
}

/** a cylinder along z (a pad roll, a barbell sleeve) */
export function cylZ(p: Parts, name: string, mat: MatSpec, z0: number, z1: number, x: number, y: number, r: number, sides?: number): void {
  const n = sides ?? Math.max(8, roundSides(p) * 2);
  const g = new THREE.CylinderGeometry(r, r, Math.max(0.0005, z1 - z0), n, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, (z0 + z1) / 2);
  p.put(name, mat, g);
}

/** a vertical cylinder */
export function cylY(p: Parts, name: string, mat: MatSpec, cx: number, cz: number, y0: number, y1: number, r: number, sides?: number): void {
  const n = sides ?? Math.max(8, roundSides(p) * 2);
  const g = new THREE.CylinderGeometry(r, r, Math.max(0.0005, y1 - y0), n, 1, false);
  g.translate(cx, (y0 + y1) / 2, cz);
  p.put(name, mat, g);
}

// ---------------------------------------------------------------- oval / rectangular steel tube

/** the outline of a rounded rectangle w x h (corner radius r), counter-clockwise, with the outward normal of every point */
function rrProfile(w: number, h: number, r: number, seg: number): { pts: [number, number][]; nor: [number, number][] } {
  const pts: [number, number][] = [], nor: [number, number][] = [];
  const rr = Math.min(r, w / 2, h / 2);
  const cs: [number, number, number][] = [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, Math.PI / 2], [-w / 2 + rr, -h / 2 + rr, Math.PI], [w / 2 - rr, -h / 2 + rr, (3 * Math.PI) / 2]];
  for (const [cx, cy, a0] of cs) {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (k / Math.max(1, seg)) * (Math.PI / 2);
      const c = Math.cos(a), s = Math.sin(a);
      pts.push([cx + rr * c, cy + rr * s]); nor.push([c, s]);
    }
  }
  return { pts, nor };
}

/**
 * A steel section (w across, h deep, corners rounded by r) swept straight from a to b, capped: the oval and rectangular tube that commercial
 * machines are welded from. `up` says which way the section's h runs (default: as close to world y as it can be, or z for an upright).
 */
export function rtube(p: Parts, name: string, mat: MatSpec, a: V3, b: V3, w: number, h: number, r = Math.min(w, h) * 0.3, up?: V3): void {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A); const len = dir.length();
  if (len < 1e-5) return;
  dir.normalize();
  let u = new THREE.Vector3(...(up ?? (Math.abs(dir.y) > 0.9 ? [0, 0, 1] : [0, 1, 0])));
  u.sub(dir.clone().multiplyScalar(u.dot(dir)));
  if (u.lengthSq() < 1e-8) u = new THREE.Vector3(1, 0, 0).sub(dir.clone().multiplyScalar(dir.x));
  u.normalize();
  const sideV = new THREE.Vector3().crossVectors(u, dir).normalize();
  const seg = p.env.q.tier === 'low' ? 0 : p.env.q.tier === 'medium' ? 2 : 3;
  const { pts, nor } = rrProfile(w, h, seg === 0 ? 0 : r, Math.max(1, seg));
  const n = pts.length;
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const at = (P: THREE.Vector3, x: number, y: number): THREE.Vector3 => P.clone().addScaledVector(sideV, x).addScaledVector(u, y);
  for (const P of [A, B]) for (let i = 0; i < n; i++) {
    const v = at(P, pts[i][0], pts[i][1]); pos.push(v.x, v.y, v.z);
    const nn = sideV.clone().multiplyScalar(nor[i][0]).addScaledVector(u, nor[i][1]); nrm.push(nn.x, nn.y, nn.z);
  }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, j, n + i, j, n + j, n + i); }
  // caps: a fan from the centre of each end
  for (const [P, s] of [[A, -1], [B, 1]] as const) {
    const base = pos.length / 3;
    pos.push(P.x, P.y, P.z); nrm.push(dir.x * s, dir.y * s, dir.z * s);
    for (let i = 0; i < n; i++) { const v = at(P, pts[i][0], pts[i][1]); pos.push(v.x, v.y, v.z); nrm.push(dir.x * s, dir.y * s, dir.z * s); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (s > 0) idx.push(base, base + 1 + i, base + 1 + j); else idx.push(base, base + 1 + j, base + 1 + i); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  // the side faces' winding follows the profile's direction: make sure they face out
  const tri = new THREE.Triangle(at(A, pts[0][0], pts[0][1]), at(A, pts[1 % n][0], pts[1 % n][1]), at(B, pts[0][0], pts[0][1]));
  const fn = tri.getNormal(new THREE.Vector3());
  const out = sideV.clone().multiplyScalar(nor[0][0]).addScaledVector(u, nor[0][1]);
  if (fn.dot(out) < 0) { const ix = g.getIndex()!; for (let t = 0; t < n * 6; t += 3) { const k = ix.getX(t + 1); ix.setX(t + 1, ix.getX(t + 2)); ix.setX(t + 2, k); } }
  p.put(name, mat, g);
}

/** a run of rectangular tube through points (welded corners: each leg overlaps the next by its own size) */
export function rtubes(p: Parts, name: string, mat: MatSpec, pts: V3[], w: number, h: number, r?: number, up?: V3): void {
  for (let i = 0; i + 1 < pts.length; i++) rtube(p, name, mat, pts[i], pts[i + 1], w, h, r, up);
}

/** a box between two corners, chamfered where the tier allows */
export function slab(p: Parts, name: string, mat: MatSpec, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  p.box(name, mat, x0, x1, y0, y1, z0, z1, { c: Math.min(0.004, (x1 - x0) / 4, (y1 - y0) / 4, (z1 - z0) / 4) });
}

// ---------------------------------------------------------------- upholstery

/**
 * An upholstered pad: a welded soft vinyl cushion with rounded edges and a slight crown, on a thin black backing board, filling the box.
 * `rotX` tilts it about x through the box's centre (a back pad leaning back); the box is then the pad's own w x h x d before the tilt.
 */
export function pad(p: Parts, name: string, mat: MatSpec, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r = 0.03, o: { rotX?: number; board?: 'below' | 'behind' | 'none' } = {}): void {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const q = p.env.q;
  const board = o.board ?? (h < d ? 'below' : 'behind');
  const bt = Math.min(0.018, (board === 'below' ? h : d) * 0.22);
  // the cushion is the box less its board
  const cw = w, ch = board === 'below' ? h - bt : h, cd = board === 'behind' ? d - bt : d;
  const rr = Math.min(r, ch / 2.1, cw / 2.1, cd / 2.1);
  const seg = q.tier === 'low' ? 1 : q.ultra ? 4 : q.tier === 'high' ? 3 : 2;
  const cushion = seg === 1 ? new THREE.BoxGeometry(cw, ch, cd) : softCushion(cw, ch, cd, { r: rr, puff: Math.min(0.006, Math.min(ch, cd) * 0.08), seg });
  cushion.translate(0, board === 'below' ? bt / 2 : 0, board === 'behind' ? bt / 2 : 0);
  const pieces: [THREE.BufferGeometry, string, MatSpec][] = [[cushion, name, mat]];
  if (board !== 'none' && q.tier !== 'low') {
    const bw = cw - 2 * rr * 0.6, bd = board === 'below' ? cd - 2 * rr * 0.6 : bt, bh = board === 'below' ? bt : ch - 2 * rr * 0.6;
    const bg = new THREE.BoxGeometry(bw, bh, bd);
    bg.translate(0, board === 'below' ? -h / 2 + bt / 2 : 0, board === 'behind' ? -d / 2 + bt / 2 : 0);
    pieces.push([bg, 'pad-boards', SHROUD]);
  }
  for (const [g, n, m] of pieces) {
    if (o.rotX) g.rotateX(o.rotX);
    g.translate(cx, cy, cz);
    p.put(n, m, g, { tile: 0.22 });
  }
}

// ---------------------------------------------------------------- the weight stack

/**
 * A selectorised weight stack between x0..x1, z0..z1, y0..y1: `n` black plates with white numbers, a silver top plate, two chrome guide rods,
 * the selector stem and a red pin in the stack, the cable rising from the top plate, rubber bumpers under it, and (with `cover`) a brushed
 * silver shroud on three sides with the front open so the plates show, as on a commercial machine.
 */
export function weightStack(p: Parts, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, n = 18, cover = true): void {
  const low = p.env.q.tier === 'low';
  const top = 0.035, bump = 0.04;
  const py0 = y0 + bump, py1 = y1 - top - 0.12; // the plates; the space above them is where the top plate rises
  const th = (py1 - py0) / n;
  const pw0 = x0 + 0.03, pw1 = x1 - 0.03, pd0 = z0 + 0.03, pd1 = z1 - 0.03;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // rubber bumpers on a base plate
  slab(p, 'stack-base', STACK_STEEL, pw0, pw1, y0, y0 + 0.012, pd0, pd1);
  for (const s of [-1, 1]) cylY(p, 'stack-bumpers', RUBBER, cx + s * (pw1 - pw0) * 0.3, cz, y0 + 0.012, py0, 0.03, low ? 6 : 12);
  if (low) {
    slab(p, 'stack-plates', STACK_STEEL, pw0, pw1, py0, py1, pd0, pd1);
  } else {
    for (let i = 0; i < n; i++) p.box('stack-plates', STACK_STEEL, pw0, pw1, py0 + i * th + 0.0018, py0 + (i + 1) * th - 0.0018, pd0, pd1, { c: 0.003 });
    // the numbers: a small white print at the front right of every plate
    for (let i = 0; i < n; i++) slab(p, 'stack-labels', LABEL, pw1 - 0.07, pw1 - 0.02, py0 + i * th + th * 0.3, py0 + i * th + th * 0.7, pd1, pd1 + 0.0015);
  }
  // the top plate (silver), its stem through the stack and the selector pin
  p.box('stack-top', SHROUD_LIGHT, pw0, pw1, py1 + 0.004, py1 + 0.004 + top, pd0, pd1, { c: 0.004 });
  tube(p, 'stack-stem', CHROME, [cx, py1 + top, cz], [cx, py1 + top + 0.06, cz], 0.012);
  const pinY = py0 + th * (Math.floor(n * 0.62) + 0.5);
  tube(p, 'stack-pin', CHROME, [cx, pinY, pd1 - 0.06], [cx, pinY, pd1 + 0.03], 0.005);
  p.put('stack-pin-knob', ACCENT_RED, new THREE.SphereGeometry(0.016, low ? 6 : 12, low ? 4 : 8).scale(1, 1, 1.3).translate(cx, pinY, pd1 + 0.04));
  // guide rods, from the base to the top frame
  for (const s of [-1, 1]) tube(p, 'stack-rods', CHROME, [cx + s * (pw1 - pw0) * 0.36, y0 + 0.012, cz], [cx + s * (pw1 - pw0) * 0.36, y1 - 0.02, cz], 0.0095);
  if (cover) {
    const t = 0.006;
    // side shrouds (brushed silver), a back panel, a charcoal top cap; the front is open
    for (const s of [-1, 1]) p.box('stack-shroud', SHROUD_LIGHT, s > 0 ? x1 - t : x0, s > 0 ? x1 : x0 + t, y0, y1 - 0.02, z0, z1, { c: 0.002 });
    p.box('stack-shroud', SHROUD_LIGHT, x0, x1, y0, y1 - 0.02, z0, z0 + t, { c: 0.002 });
    p.box('stack-cap', SHROUD, x0 - 0.005, x1 + 0.005, y1 - 0.025, y1, z0 - 0.005, z1 + 0.005, { c: 0.006 });
    // a narrow front trim each side, as the shroud's lip
    for (const s of [-1, 1]) slab(p, 'stack-shroud', SHROUD_LIGHT, s > 0 ? x1 - 0.035 : x0, s > 0 ? x1 : x0 + 0.035, y0, y1 - 0.02, z1 - t, z1);
  }
}

/** the point where a stack's cable leaves its top plate (for `cable`) */
export const stackTop = (y1: number): number => y1 - 0.12 + 0.07;

// ---------------------------------------------------------------- barbell plates, dumbbells

/** a barbell plate (axis x): `r` the radius, `th` the thickness; a raised rim and a chrome hub on medium and high */
export function plateDisc(p: Parts, cx: number, y: number, z: number, r: number, th: number, mat: MatSpec = IRON): void {
  const low = p.env.q.tier === 'low';
  const n = low ? 12 : p.env.q.tier === 'medium' ? 16 : 24;
  cylX(p, 'plates', mat, cx - th / 2, cx + th / 2, y, z, low ? r : r * 0.92, n);
  if (!low) {
    const rim = new THREE.TorusGeometry(r - th * 0.28, th * 0.28, 4, n);
    rim.rotateY(Math.PI / 2); rim.translate(cx, y, z);
    p.put('plates', mat, rim);
  }
  cylX(p, 'plate-hubs', CHROME, cx - th / 2 - 0.004, cx + th / 2 + 0.004, y, z, 0.03, 10);
}

/** head radius of a dumbbell by its weight (2.5 to 25 kg), metres */
export const dumbbellRadius = (kg: number): number => 0.03 + 0.032 * Math.min(1, Math.max(0, (kg - 2.5) / 22.5));
/** head length of a dumbbell by its weight */
const headLen = (kg: number): number => 0.05 + 0.065 * Math.min(1, Math.max(0, (kg - 2.5) / 22.5));
/** half the grip between the heads */
const GRIP = 0.065;
/** the overall length of one dumbbell along its handle, metres */
export const dumbbellLength = (kg: number): number => 2 * (GRIP + headLen(kg));

/**
 * A hex dumbbell lying along x (or z, as it sits in a rack), centre (cx, y, cz), sized by its weight. With `model` (the downloaded hex dumbbell,
 * src/look/gym/props.ts) each head and the handle are the model's own shapes, scaled to the weight; without it, generated hex heads.
 */
export function dumbbell(p: Parts, cx: number, y: number, cz: number, kg: number, axis: 'x' | 'z' = 'x', name = 'dumbbells', model: PropGeo | null = null): void {
  const R = dumbbellRadius(kg), L = headLen(kg);
  const place = (g: THREE.BufferGeometry): THREE.BufferGeometry => { if (axis === 'z') g.rotateY(-Math.PI / 2); g.translate(cx, y, cz); return g; };
  if (model) {
    const head = model.parts.head, handle = model.parts.handle;
    head.computeBoundingBox(); handle.computeBoundingBox();
    const hb = head.boundingBox!, gb = handle.boundingBox!;
    const R0 = (hb.max.y - hb.min.y) / 2;
    // the right head of the model runs from its inner face a to its end b; the left is its mirror
    const b = hb.max.x, a = gb.max.x; const L0 = b - a;
    for (const s of [-1, 1]) {
      const g = head.clone();
      // keep this side's head only: move it to the origin, scale to the weight, set it at its place
      const keep = new THREE.BufferGeometry();
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), ix = g.getIndex()!;
      const P: number[] = [], N: number[] = [], I: number[] = [], map = new Map<number, number>();
      for (let t = 0; t < ix.count; t += 3) {
        const tri = [ix.getX(t), ix.getX(t + 1), ix.getX(t + 2)];
        if (tri.some((v) => Math.sign(pos.getX(v)) !== s)) continue;
        for (const v of tri) {
          if (!map.has(v)) { map.set(v, P.length / 3); P.push(pos.getX(v), pos.getY(v), pos.getZ(v)); N.push(nor.getX(v), nor.getY(v), nor.getZ(v)); }
          I.push(map.get(v)!);
        }
      }
      keep.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      keep.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      keep.setIndex(I);
      keep.translate(-s * a, 0, 0);
      keep.scale(L / L0, R / R0, R / R0);
      keep.translate(s * GRIP, 0, 0);
      p.put(name, RUBBER, place(keep));
      g.dispose();
    }
    const hg = handle.clone();
    hg.scale(GRIP / a, 0.0165 / ((gb.max.y - gb.min.y) / 2), 0.0165 / ((gb.max.y - gb.min.y) / 2));
    p.put('dumbbell-handles', CHROME, place(hg));
    return;
  }
  const low = p.env.q.tier === 'low';
  for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(R, R, L, 6, 1, false);
    g.rotateY(Math.PI / 6); g.rotateZ(Math.PI / 2); g.translate(s * (GRIP + L / 2), 0, 0);
    p.put(name, RUBBER, place(g));
    if (!low) { const c = new THREE.CylinderGeometry(0.024, 0.024, 0.012, 10); c.rotateZ(Math.PI / 2); c.translate(s * (GRIP - 0.004), 0, 0); p.put('dumbbell-handles', CHROME, place(c)); }
  }
  const h = new THREE.CylinderGeometry(0.0165, 0.0165, GRIP * 2, low ? 6 : 10, 1, true);
  h.rotateZ(Math.PI / 2);
  p.put('dumbbell-handles', CHROME, place(h));
}

/** a kettlebell standing on (x, y, z), `h` tall: the downloaded bell (scaled) or a generated one */
export function kettlebell(p: Parts, x: number, y: number, z: number, h: number, model: PropGeo | null, accent: MatSpec = ACCENT_RED): void {
  if (model) {
    const body = model.parts.body.clone().scale(h, h, h).translate(x, y, z);
    const band = model.parts.band.clone().scale(h, h, h).translate(x, y, z);
    p.put('kettlebells', IRON, body);
    p.put('kettlebell-bands', accent, band);
    return;
  }
  const q = p.env.q;
  const r = h * 0.42;
  const body = new THREE.SphereGeometry(r, q.tier === 'low' ? 8 : q.tier === 'medium' ? 12 : 16, q.tier === 'low' ? 6 : q.tier === 'medium' ? 8 : 12);
  body.scale(1, 0.95, 1); body.translate(x, y + r * 0.95, z);
  p.put('kettlebells', IRON, body);
  const arch = new THREE.TorusGeometry(r * 0.5, h * 0.06, q.tier === 'low' ? 4 : 6, q.tier === 'low' ? 8 : 12, Math.PI);
  arch.translate(x, y + h - r * 0.5 - h * 0.06, z);
  p.put('kettlebells', IRON, arch);
  for (const s of [-1, 1]) {
    tube(p, 'kettlebells', IRON, [x + s * r * 0.5, y + h - r * 0.5 - h * 0.06, z], [x + s * r * 0.55, y + r * 1.5, z], h * 0.06);
    // the coloured band of a competition bell, where the handle meets the body (the same part the model has)
    tube(p, 'kettlebell-bands', accent, [x + s * r * 0.52, y + r * 1.62, z], [x + s * r * 0.54, y + r * 1.52, z], h * 0.066);
  }
}

// ---------------------------------------------------------------- cables, pulleys, grips, knobs, screens

/** a steel cable running through points */
export function cable(p: Parts, pts: V3[], r = 0.003): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const va = new THREE.Vector3(...pts[i]), vb = new THREE.Vector3(...pts[i + 1]);
    const g = new THREE.CylinderGeometry(r, r, Math.max(0.0005, va.distanceTo(vb)), 5, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
    g.translate((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2, (pts[i][2] + pts[i + 1][2]) / 2);
    p.put('cables', CABLE, g);
  }
}

/** a grooved pulley (axis x) in its bracket: a charcoal wheel with a groove, two side plates and an axle bolt */
export function pulley(p: Parts, x: number, y: number, z: number, r = 0.055): void {
  const n = Math.max(12, roundSides(p) * 2);
  if (p.env.q.tier === 'low') { cylX(p, 'pulleys', SHROUD, x - 0.014, x + 0.014, y, z, r, 10); return; }
  // the wheel's profile: rim, groove, rim, hub (a lathe about x)
  const prof = [[0.012, -0.014], [r, -0.014], [r, -0.009], [r - 0.012, -0.003], [r - 0.012, 0.003], [r, 0.009], [r, 0.014], [0.012, 0.014]].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(prof, n);
  g.rotateZ(Math.PI / 2); g.translate(x, y, z);
  p.put('pulleys', SHROUD, g);
  for (const s of [-1, 1]) slab(p, 'pulley-brackets', FRAME, x + s * 0.019 - 0.003, x + s * 0.019 + 0.003, y - r * 0.6, y + r * 0.9, z - r * 0.55, z + r * 0.55);
  cylX(p, 'pulley-bolts', CHROME, x - 0.026, x + 0.026, y, z, 0.007, 8);
}

/** a foam grip on a bar between two points: thicker than the bar, rounded at both ends */
export function grip(p: Parts, a: V3, b: V3, r = 0.017): void {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  if (p.env.q.tier === 'low') { tube(p, 'grips', RUBBER, a, b, r, true); return; }
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r * 0.6), 3, roundSides(p, 8));
  g.scale(1, (len) / (len - 2 * r * 0.6 + 2 * r), 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  p.put('grips', RUBBER, g);
}

/** a pop-pin adjustment knob pointing along `dir` from (x, y, z) */
export function knob(p: Parts, at: V3, dir: V3, mat: MatSpec = ACCENT_RED): void {
  const d = new THREE.Vector3(...dir).normalize();
  const tip: V3 = [at[0] + d.x * 0.03, at[1] + d.y * 0.03, at[2] + d.z * 0.03];
  tube(p, 'knob-pins', CHROME, at, tip, 0.006);
  const g = new THREE.CylinderGeometry(0.017, 0.014, 0.03, roundSides(p, 8));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
  g.translate(tip[0] + d.x * 0.015, tip[1] + d.y * 0.015, tip[2] + d.z * 0.015);
  p.put('knobs', mat, g);
}

/**
 * A console: a housing w x h x d centred at (cx, cy, cz), tilted back by `tilt` radians, its face toward +z, with a dark glass screen showing a
 * dim lit picture (on medium and high), a keypad strip under it. The whole stays inside the housing's box before the tilt.
 */
export function consoleUnit(p: Parts, cx: number, cy: number, cz: number, w: number, h: number, d: number, tilt: number, prefix: string, topAt?: number): void {
  const q = p.env.q;
  const geos: [string, MatSpec, THREE.BufferGeometry][] = [];
  const rb = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const housing = q.tier === 'low' ? rb(-w / 2, w / 2, -h / 2, h / 2, -d / 2, d / 2) : softCushion(w, h, d, { r: Math.min(0.02, d / 3), puff: 0.002, seg: 2 });
  geos.push([`${prefix}-console`, CONSOLE, housing]);
  const sw = w * 0.72, sh = h * 0.62;
  geos.push([`${prefix}-screen`, SCREEN_GLASS, rb(-sw / 2, sw / 2, h / 2 - 0.02 - sh, h / 2 - 0.02, d / 2 - 0.004, d / 2 + 0.002)]);
  if (q.tier !== 'low') {
    // the lit picture: a few dim panels of a workout screen (a graph band and two readouts), a hair in front of the glass
    geos.push([`${prefix}-screen-lit`, SCREEN_LIT, rb(-sw / 2 + 0.015, sw / 2 - 0.015, h / 2 - 0.02 - sh * 0.55, h / 2 - 0.02 - sh * 0.35, d / 2 + 0.002, d / 2 + 0.0026)]);
    geos.push([`${prefix}-screen-lit`, SCREEN_LIT, rb(-sw / 2 + 0.015, -0.01, h / 2 - 0.02 - sh * 0.25, h / 2 - 0.035, d / 2 + 0.002, d / 2 + 0.0026)]);
    geos.push([`${prefix}-keys`, SHROUD, rb(-sw / 2, sw / 2, -h / 2 + 0.012, h / 2 - 0.03 - sh, d / 2 - 0.004, d / 2 + 0.003)]);
    for (let i = 0; i < 6; i++) { const x = -sw / 2 + 0.03 + i * ((sw - 0.06) / 5); geos.push([`${prefix}-buttons`, LABEL, rb(x - 0.009, x + 0.009, -h / 2 + 0.02, -h / 2 + 0.032, d / 2 + 0.003, d / 2 + 0.005)]); }
  }
  for (const [, , g] of geos) { g.rotateX(-tilt); g.translate(cx, cy, cz); }
  // `topAt`: the housing's highest point lands exactly there (its rounded corner sits a little below a sharp box's)
  if (topAt !== undefined) { geos[0][2].computeBoundingBox(); const dy = topAt - geos[0][2].boundingBox!.max.y; for (const [, , g] of geos) g.translate(0, dy, 0); }
  for (const [n, m, g] of geos) p.put(n, m, g);
}

/** marks the group as having wanted a model prop that was not loaded yet (src/look/gym/props.ts swaps it in) or used one */
export function noteProp(p: Parts, kind: 'dumbbell' | 'kettlebell' | 'chess', used: boolean): void {
  const k = used ? 'gymPropsUsed' : 'gymPropsWanted';
  const list = (p.group.userData[k] as string[] | undefined) ?? [];
  if (!list.includes(kind)) list.push(kind);
  p.group.userData[k] = list;
}
