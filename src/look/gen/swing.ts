// Swings (jhoola): a wooden plank seat with arms and a slatted back on four chains from the ceiling (two and three seater), the same seat in a
// free-standing steel frame, and a single hanging chair (a basket on one chain from a ceiling hook, or on a stand). The seat, the arms and the
// back are exactly the item's footprint and height; the chains and the ceiling hooks go up to the ceiling the home has (src/look/gen/ceiling.ts),
// which is why a hung swing's bounding box is taller than its `heightM` (the part a person can bump into).
//
// The moving parts are their own groups so a seated walker can rock them (src/buyer/swing-motion.ts):
//   benches  'swing-seat' (the plank, arms and back: it only moves, never turns) and 'swing-chains-front' / 'swing-chains-back' (each turns
//            about its hook line, so the four chains stay parallel: a parallelogram)
//   chairs   'swing-rig' (chain and basket turn together about the hook)
// At rest every one of them has the identity transform, so a bake of the home sees an ordinary still piece. `userData.swingRig` says how to move them.
import * as THREE from 'three';
import { Parts, role, roleOr } from './core';
import type { GenEnv, GenSize, Roles } from './core';
import { genCeiling } from './ceiling';
import { CANE, CHROME, bar, disc, soft } from './kit';

export const SWING_VARIANTS = ['hung-2', 'hung-3', 'frame-2', 'frame-3', 'chair-hook', 'chair-stand'] as const;
export type SwingVariant = (typeof SWING_VARIANTS)[number];
export interface SwingParams { variant: SwingVariant; cushion: boolean }
export const SWING_DEFAULTS: SwingParams = { variant: 'hung-2', cushion: true };

/** how a swing's moving parts are driven: `parallel` (a seat that translates on parallel chains) or `rigid` (a basket that turns with its chain) */
export interface SwingRig {
  mode: 'parallel' | 'rigid';
  hookY: number;
  /** pivot depth of a rigid rig, or the depth of the front and back chain lines */
  pivotZ: number;
  chainZ: [number, number];
  /** pendulum length: hook to where the chains meet the seat, metres */
  lengthM: number;
}

const ATTACH_Y = 0.62;
const SEAT_TOP = 0.45;
const BASKET_TOP_BENCH = 0.95;

function seatDims(v: SwingVariant): { seatW: number; plankD: number; backT: number } {
  return v === 'hung-3' || v === 'frame-3' ? { seatW: 1.52, plankD: 0.56, backT: 0.06 } : { seatW: 1.22, plankD: 0.51, backT: 0.07 };
}

/** the plank, the arms, the slatted back and the cushions, in the swing's frame (the seat is at 0.45), as a group that only translates */
function benchSeat(env: GenEnv, size: GenSize, roles: Roles, v: SwingVariant, cushion: boolean): THREE.Group {
  const { seatW, plankD, backT } = seatDims(v);
  const D = plankD + backT, W = seatW + 0.08;
  const q = env.q;
  const wood = roleOr(roles, role(roles, 'case'), 'swingWood');
  const cush = role(roles, 'cushion', 'fabric', 'accent');
  const p = new Parts(env, 'swing-seat');
  const zb0 = -D / 2, zp0 = -D / 2 + backT, zp1 = D / 2;
  // plank, with a deeper board under it along the sides
  p.box('swing-seat-plank', wood, -seatW / 2, seatW / 2, 0.39, 0.42, zp0, zp1, { c: 0.004, grain: 'x' });
  for (const s of [-1, 1]) p.box('swing-seat-plank', wood, s * (seatW / 2 - 0.02) - 0.02, s * (seatW / 2 - 0.02) + 0.02, 0.33, 0.39, zp0 + 0.03, zp1 - 0.03, { c: 0.003 });
  if (cushion) {
    p.put('swing-seat-cushion', cush, soft(env, -seatW / 2 + 0.01, seatW / 2 - 0.01, 0.42, SEAT_TOP, zp0 + 0.09, zp1 - 0.01, 0.012), { tile: 0.34 });
    p.put('swing-back-cushion', cush, soft(env, -seatW / 2 + 0.04, seatW / 2 - 0.04, SEAT_TOP, 0.82, zp0 + 0.0, zp0 + 0.1, 0.02), { tile: 0.34 });
  } else {
    p.box('swing-seat-plank', wood, -seatW / 2, seatW / 2, 0.42, SEAT_TOP, zp0, zp1, { c: 0.004, grain: 'x' });
  }
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? seatW / 2 : -W / 2, x1 = s > 0 ? W / 2 : -seatW / 2;
    // arm board rising to a rounded rest at the front, a back post to the top
    p.box('swing-arms', wood, x0, x1, 0.39, ATTACH_Y, zp0, zp1, { c: 0.004 });
    p.box('swing-back-frame', wood, x0, x1, ATTACH_Y, BASKET_TOP_BENCH, zb0, zp0, { c: 0.004 });
  }
  // top rail and slats across the back
  p.box('swing-back-frame', wood, -W / 2, W / 2, 0.87, BASKET_TOP_BENCH, zb0, zp0, { c: 0.004, grain: 'x' });
  for (const [y0, y1] of [[0.5, 0.55], [0.63, 0.68], [0.75, 0.8]] as const) p.box('swing-back-slats', wood, -seatW / 2, seatW / 2, y0, y1, zb0 + 0.01, zp0 - 0.015, { c: 0.002, grain: 'x' });
  // eyes where the chains meet the arms and the back posts
  const chain = roleOr(roles, CHROME, 'chain');
  for (const s of [-1, 1]) for (const z of [zp1 - 0.02, zb0 + 0.035]) p.put('swing-eyes', chain, new THREE.TorusGeometry(0.014, 0.004, 5, Math.max(8, q.sides)).rotateY(Math.PI / 2).translate(s * (W / 2 - 0.02), ATTACH_Y + 0.004, z));
  void size;
  return p.done();
}

/** a pair of chains (or rods) from y = 0 (the hook line) down `len`, at x = ±cx, as a group the caller places at the hook */
function chainPair(env: GenEnv, roles: Roles, name: string, cx: number, len: number): THREE.Group {
  const mat = roleOr(roles, CHROME, 'chain');
  const p = new Parts(env, name);
  for (const s of [-1, 1]) {
    bar(p, name, mat, [s * cx, 0, 0], [s * cx, -len, 0], 0.0055);
    // a link every 8 cm, as a short sleeve
    if (env.q.tier !== 'low') for (let y = -0.08; y > -len + 0.04; y -= 0.16) bar(p, name, mat, [s * cx, y, 0], [s * cx, y - 0.03, 0], 0.0085);
  }
  return p.done();
}

/** ceiling plates with an eye bolt each, at (x, hookY, z): the hooks a hung swing needs */
function hooks(env: GenEnv, roles: Roles, pts: [number, number][], hookY: number): THREE.Group {
  const mat = roleOr(roles, CHROME, 'chain');
  const p = new Parts(env, 'swing-hooks');
  for (const [x, z] of pts) {
    disc(p, 'swing-hooks', mat, x, z, hookY - 0.01, hookY, 0.045);
    bar(p, 'swing-hooks', mat, [x, hookY - 0.01, z], [x, hookY - 0.045, z], 0.006);
    p.put('swing-hooks', mat, new THREE.TorusGeometry(0.013, 0.004, 5, Math.max(8, env.q.sides)).rotateY(Math.PI / 2).translate(x, hookY - 0.052, z));
  }
  p.group.userData.ceilingHooks = pts.map(([x, z]) => ({ x, z }));
  return p.done();
}

export function buildSwing(env: GenEnv, size: GenSize, p: SwingParams, roles: Roles): THREE.Group {
  const v = (SWING_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'hung-2';
  const out = new THREE.Group();
  out.name = 'gen:swing';
  if (v === 'chair-hook' || v === 'chair-stand') return buildChair(env, size, v, p, roles, out);
  const { w, d, h } = size;
  const hung = v.startsWith('hung');
  const hookY = hung ? genCeiling() : 1.88;
  const seat = benchSeat(env, size, roles, v, p.cushion);
  seat.name = 'swing-seat';
  const { seatW, plankD, backT } = seatDims(v);
  const D = plankD + backT, W = seatW + 0.08;
  const cx = W / 2 - 0.02;
  const zf = D / 2 - 0.02, zb = -D / 2 + 0.035;
  const len = hookY - ATTACH_Y;
  out.add(seat);
  for (const [name, z] of [['swing-chains-front', zf], ['swing-chains-back', zb]] as const) {
    const g = chainPair(env, roles, name, cx, len);
    g.name = name;
    g.position.set(0, hookY, z);
    out.add(g);
  }
  const pts: [number, number][] = [[-cx, zf], [cx, zf], [-cx, zb], [cx, zb]];
  if (hung) {
    // the hooks sit at the ceiling at the chains' spacing: 4 plates, the same rectangle as the chain feet
    for (const c of [...hooks(env, roles, pts, hookY).children]) out.add(c);
  } else {
    const wood = roleOr(roles, role(roles, 'case'), 'swingWood');
    const steel = roleOr(roles, CHROME, 'chain');
    const fr = new Parts(env, 'swing-frame');
    const xe = w / 2 - 0.025;
    for (const s of [-1, 1]) {
      // two legs at each end, leaning in to the beams, and a base rail along the floor
      for (const z of [-1, 1]) bar(fr, 'swing-frame', steel, [s * xe, 0.02, z * (d / 2 - 0.03)], [s * xe, 1.92, z > 0 ? zf : zb], 0.022);
      fr.box('swing-frame-feet', wood, s > 0 ? w / 2 - 0.05 : -w / 2, s > 0 ? w / 2 : -w / 2 + 0.05, 0, 0.04, -d / 2, d / 2, { c: 0.004, grain: 'z' });
      bar(fr, 'swing-frame', steel, [s * xe, 0.45, -(d / 2 - 0.03) + 0.45 * (d / 2 - 0.03 + zb) / 1.9], [s * xe, 0.45, (d / 2 - 0.03) - 0.45 * (d / 2 - 0.03 - zf) / 1.9], 0.014);
    }
    // the two beams the chains hang from, one over each chain line
    for (const z of [zf, zb]) fr.box('swing-beam', wood, -w / 2, w / 2, 1.9, 1.95, z - 0.03, z + 0.03, { c: 0.004, grain: 'x' });
    for (const c of [...fr.done().children]) out.add(c);
    // eye bolts under the beam
    const eb = new Parts(env, 'swing-hooks');
    for (const [x, z] of pts) {
      bar(eb, 'swing-hooks', steel, [x, 1.9, z], [x, 1.884, z], 0.006);
      eb.put('swing-hooks', steel, new THREE.TorusGeometry(0.013, 0.004, 5, Math.max(8, env.q.sides)).rotateY(Math.PI / 2).translate(x, 1.878, z));
    }
    for (const c of [...eb.done().children]) out.add(c);
  }
  out.userData.swingRig = { mode: 'parallel', hookY, pivotZ: 0, chainZ: [zf, zb], lengthM: len } satisfies SwingRig;
  void h;
  return out;
}

function buildChair(env: GenEnv, size: GenSize, v: 'chair-hook' | 'chair-stand', p: SwingParams, roles: Roles, out: THREE.Group): THREE.Group {
  const { w, d, h } = size;
  const hook = v === 'chair-hook';
  const hookY = hook ? genCeiling() : 1.88;
  const rx = hook ? w / 2 - 0.006 : 0.4, rz = hook ? d / 2 : 0.36, ry = hook ? (h - 0.2) / 2 : 0.42;
  const zc = hook ? 0 : 0.05;
  const yc = hook ? h - ry : 0.62;
  const basket = roleOr(roles, CANE, 'basket', 'swingWood');
  const cush = role(roles, 'cushion', 'fabric', 'accent');
  const chainM = roleOr(roles, CHROME, 'chain');
  const rig = new THREE.Group();
  rig.name = 'swing-rig';
  const b = new Parts(env, 'swing-basket');
  const seg = Math.max(16, env.q.sides * 2);
  const shell = new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg / 2)), Math.PI, Math.PI, 0, 2.3);
  shell.scale(rx, ry, rz);
  shell.translate(0, yc, zc);
  b.put('swing-basket', basket, shell, { double: true });
  // a rim ring round the opening: two thin tori at the front edge of the shell
  b.put('swing-basket-rim', basket, new THREE.TorusGeometry(1, 0.012, 5, seg * 2, 4.6).rotateZ(Math.PI / 2 - 2.3).scale(rx, ry, 1).translate(0, yc, zc));
  if (p.cushion) {
    disc(b, 'swing-seat-cushion', cush, 0, zc, 0.405, SEAT_TOP, 1, { sx: rx - 0.01, sz: rz - 0.005 });
    b.put('swing-back-cushion', cush, soft(env, -rx * 0.62, rx * 0.62, SEAT_TOP, yc + ry * 0.55, zc - rz + 0.04, zc - rz + 0.17, 0.025), { tile: 0.34 });
  } else {
    disc(b, 'swing-seat-cushion', basket, 0, zc, 0.405, SEAT_TOP, 1, { sx: rx - 0.01, sz: rz - 0.005 });
  }
  bar(b, 'swing-chains-rig', chainM, [0, yc + ry - 0.01, zc], [0, hookY, zc], 0.007);
  for (let y = yc + ry + 0.05; y < hookY - 0.05; y += 0.16) bar(b, 'swing-chains-rig', chainM, [0, y, zc], [0, y + 0.03, zc], 0.011);
  for (const m of [...b.done().children]) { m.position.set(0, -hookY, -zc); rig.add(m); }
  rig.position.set(0, hookY, zc);
  out.add(rig);
  if (hook) {
    for (const c of [...hooks(env, roles, [[0, zc]], hookY).children]) out.add(c);
  } else {
    const steel = roleOr(roles, CHROME, 'chain');
    const wood = roleOr(roles, role(roles, 'case'), 'swingWood');
    const fr = new Parts(env, 'swing-frame');
    for (const s of [-1, 1]) fr.box('swing-frame-feet', wood, s > 0 ? w / 2 - 0.04 : -w / 2, s > 0 ? w / 2 : -w / 2 + 0.04, 0, 0.04, -d / 2, d / 2, { c: 0.004, grain: 'z' });
    fr.box('swing-frame-feet', wood, -w / 2, w / 2, 0, 0.04, -d / 2, -d / 2 + 0.08, { c: 0.004, grain: 'x' });
    const pz = -d / 2 + 0.07;
    bar(fr, 'swing-frame', steel, [0, 0.04, pz], [0, 1.72, pz], 0.03);
    bar(fr, 'swing-frame', steel, [0, 1.72, pz], [0, 1.9, pz + 0.22], 0.026);
    bar(fr, 'swing-frame', steel, [0, 1.9, pz + 0.22], [0, 1.925, zc], 0.025);
    for (const c of [...fr.done().children]) out.add(c);
    const eb = new Parts(env, 'swing-hooks');
    bar(eb, 'swing-hooks', steel, [0, 1.9, zc], [0, 1.89, zc], 0.007);
    eb.put('swing-hooks', steel, new THREE.TorusGeometry(0.013, 0.004, 5, Math.max(8, env.q.sides)).rotateY(Math.PI / 2).translate(0, 1.878, zc));
    for (const c of [...eb.done().children]) out.add(c);
  }
  out.userData.swingRig = { mode: 'rigid', hookY, pivotZ: zc, chainZ: [zc, zc], lengthM: hookY - 0.7 } satisfies SwingRig;
  return out;
}
