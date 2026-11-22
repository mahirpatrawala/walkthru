// Strength machines at commercial size (SPEC 16.17): a four-station multi-gym, lat pulldown, seated row, chest press, shoulder press, pec fly, leg press
// (45 degrees, plate loaded), leg extension, leg curl, cable crossover and Smith machine. The BACK (the weight stack, the frame) is at -z; the front is
// where you get in. Footprint and height are exactly the item's. Weight stacks have real plates (a stack is 18 plates of about 5 cm).
import * as THREE from 'three';
import { Parts } from './core';
import type { GenEnv, GenSize, Roles } from './core';
import { ACCENT_BLUE, ACCENT_RED, CHROME, CONSOLE, FRAME, FRAME_GREY, IRON, LABEL, PAD_BLACK, RUBBER, SHROUD, SHROUD_LIGHT, cable, cylX, cylY, cylZ, grip, knob, pad, plateDisc, pulley, rtube, rtubes, slab, stackTop, tube, tubes, weightStack } from './gymkit';

export const STRENGTH_VARIANTS = ['multi', 'lat', 'row', 'chest', 'shoulder', 'fly', 'legpress', 'legext', 'legcurl', 'cable', 'smith'] as const;
export type StrengthVariant = (typeof STRENGTH_VARIANTS)[number];
export interface StrengthParams { variant: StrengthVariant }
export const STRENGTH_DEFAULTS: StrengthParams = { variant: 'chest' };

type V3 = [number, number, number];

/** the floor frame: two rails along z and a cross foot at each end, charcoal rectangular tube on rubber feet */
function floorFrame(p: Parts, x0: number, x1: number, z0: number, z1: number): void {
  rtube(p, 'frame-base', FRAME, [x0 + 0.04, 0.03, z0 + 0.04], [x1 - 0.04, 0.03, z0 + 0.04], 0.08, 0.06, 0.012);
  rtube(p, 'frame-base', FRAME, [x0 + 0.04, 0.03, z1 - 0.04], [x1 - 0.04, 0.03, z1 - 0.04], 0.08, 0.06, 0.012);
  for (const x of [x0 + 0.04, x1 - 0.04]) rtube(p, 'frame-base', FRAME, [x, 0.03, z0], [x, 0.03, z1], 0.08, 0.06, 0.012);
  for (const x of [x0 + 0.04, x1 - 0.04]) for (const z of [z0 + 0.04, z1 - 0.04]) p.box('frame-feet', RUBBER, x - 0.045, x + 0.045, 0, 0.008, z - 0.045, z + 0.045, { c: 0.002 });
}

/** a stack of `n` plates with its shroud, centred at x = cx, from the back (z0) forward by `depth` */
function stack(p: Parts, cx: number, z0: number, depth: number, width: number, topY: number, n = 18): void {
  weightStack(p, cx - width / 2, cx + width / 2, z0 + 0.02, z0 + 0.02 + depth, 0.06, topY, n);
}

/**
 * The tower of a selectorised machine: the stack in its shroud at the back, two oval uprights beside it up to a top beam at H, a pulley over the
 * stack and the cable from the top plate up to it. Returns the stack's x half-width and the pulley point.
 */
function tower(p: Parts, z0: number, H: number, topY: number, width = 0.4, depth = 0.32, n = 18): { cz: number; pulleyY: number; ux: number } {
  stack(p, 0, z0, depth, width, topY, n);
  const cz = z0 + 0.02 + depth / 2, ux = width / 2 + 0.055;
  for (const s of [-1, 1]) rtube(p, 'tower-uprights', FRAME, [s * ux, 0.04, cz], [s * ux, H - 0.05, cz], 0.07, 0.12, 0.02);
  rtube(p, 'tower-beam', FRAME, [-ux - 0.035, H - 0.045, cz], [ux + 0.035, H - 0.045, cz], 0.12, 0.09, 0.02);
  const pulleyY = H - 0.16;
  pulley(p, 0, pulleyY, cz, 0.06);
  cable(p, [[0, stackTop(topY), cz], [0, pulleyY - 0.06, cz]]);
  return { cz, pulleyY, ux };
}

export function buildStrength(env: GenEnv, size: GenSize, p: StrengthParams, _roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (STRENGTH_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'chest';
  const parts = new Parts(env, `gen:strength`);
  const x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const q = env.q;

  /** a press: the tower behind, a seat and a back pad facing +z, two oval arms swinging from a pivot at the tower's head to grips at `gy`, `gz` */
  const press = (prefix: string, backTop: number, gy: number, gz: number, topY: number): void => {
    floorFrame(parts, -x1, x1, z0, z1);
    const t = tower(parts, z0, H, topY);
    rtube(parts, `${prefix}-spine`, FRAME, [0, 0.05, t.cz + 0.12], [0, 0.05, z1 - 0.05], 0.1, 0.07, 0.02);
    // seat on a sleeve and an adjustable post, its pop pin at the front
    rtube(parts, `${prefix}-seat-post`, FRAME, [0, 0.06, z0 + 0.74], [0, 0.3, z0 + 0.74], 0.085, 0.085, 0.015);
    rtube(parts, `${prefix}-seat-post`, FRAME_GREY, [0, 0.28, z0 + 0.74], [0, S - 0.09, z0 + 0.74], 0.06, 0.06, 0.01);
    knob(parts, [0, 0.24, z0 + 0.785], [0, 0, 1]);
    pad(parts, `${prefix}-seat`, PAD_BLACK, -0.22, 0.22, S - 0.09, S, z0 + 0.56, z0 + 0.98, 0.035);
    // the back pad on its frame, leaning back a little
    rtube(parts, `${prefix}-back-frame`, FRAME, [0, 0.05, z0 + 0.46], [0, backTop - 0.1, z0 + 0.42], 0.08, 0.06, 0.015);
    pad(parts, `${prefix}-back`, PAD_BLACK, -0.2, 0.2, S + 0.04, backTop, z0 + 0.42, z0 + 0.52, 0.035, { rotX: -0.1, board: 'behind' });
    // the arms: from a pivot at the tower's head, out and forward to a grip each side; a cam and the cable at the pivot
    for (const s2 of [-1, 1]) {
      const piv: V3 = [s2 * (t.ux + 0.07), H - 0.2, t.cz + 0.08];
      cylX(parts, `${prefix}-pivots`, SHROUD, s2 > 0 ? piv[0] - 0.035 : piv[0] - 0.035, piv[0] + 0.035, piv[1], piv[2], 0.05, 16);
      rtubes(parts, `${prefix}-arms`, FRAME_GREY, [piv, [s2 * (x1 - 0.03), gy + 0.12, z0 + 0.5], [s2 * (x1 - 0.06), gy, gz - 0.08]], 0.055, 0.035, 0.012, [0, 0, 1]);
      tube(parts, `${prefix}-handles`, FRAME, [s2 * (x1 - 0.06), gy - 0.1, gz], [s2 * (x1 - 0.06), gy + 0.1, gz], 0.015);
      tube(parts, `${prefix}-handles`, FRAME, [s2 * (x1 - 0.06), gy, gz - 0.1], [s2 * (x1 - 0.06), gy, gz], 0.015);
      grip(parts, [s2 * (x1 - 0.06), gy - 0.09, gz], [s2 * (x1 - 0.06), gy + 0.09, gz], 0.02);
    }
    cable(parts, [[0, t.pulleyY + 0.055, t.cz + 0.02], [0, H - 0.2, t.cz + 0.1]]);
    // a foot bar and plate, the instruction placard on the tower
    tubes(parts, `${prefix}-footbar`, FRAME, [[-0.22, 0.06, z1 - 0.12], [-0.22, 0.24, z1 - 0.34], [0.22, 0.24, z1 - 0.34], [0.22, 0.06, z1 - 0.12]], 0.016);
    parts.box(`${prefix}-footplate`, RUBBER, -0.2, 0.2, 0.235, 0.255, z1 - 0.4, z1 - 0.28, { c: 0.004 });
    slab(parts, 'placard', LABEL, t.ux + 0.035, t.ux + 0.038, 0.95, 1.2, t.cz - 0.08, t.cz + 0.08);
  };
  const build: Record<string, () => void> = {
    chest: () => press('press', S + 0.68, 1.06, z0 + 0.8, 1.18),

    shoulder: () => press('press', S + 0.82, 1.38, z0 + 0.64, 1.3),

    fly: () => {
      // pec fly: two long padded arms hinged on a central head, swung in front of the chest
      floorFrame(parts, -x1, x1, z0, z1);
      stack(parts, 0, z0, 0.42, 0.4, 1.1);
      tube(parts, 'fly-column', FRAME_GREY, [0, 0.07, z0 + 0.5], [0, H - 0.1, z0 + 0.5], 0.05, true);
      slab(parts, 'fly-head', SHROUD, -0.14, 0.14, H - 0.2, H, z0 + 0.36, z0 + 0.64);
      pad(parts, 'fly-seat', PAD_BLACK, -0.21, 0.21, S - 0.09, S, z0 + 0.62, z0 + 1.0, 0.04);
      pad(parts, 'fly-back', PAD_BLACK, -0.2, 0.2, S + 0.05, S + 0.65, z0 + 0.5, z0 + 0.6, 0.04);
      for (const s of [-1, 1]) {
        tubes(parts, 'fly-arms', FRAME_GREY, [[s * 0.08, H - 0.1, z0 + 0.5], [s * 0.5, H - 0.2, z0 + 0.55], [s * 0.53, 1.0, z0 + 0.85]], 0.026);
        tube(parts, 'fly-arms', FRAME_GREY, [s * 0.53, 1.0, z0 + 0.85], [s * 0.5, 0.82, z0 + 0.9], 0.026);
        pad(parts, 'fly-arm-pads', PAD_BLACK, s * 0.5 - 0.045, s * 0.5 + 0.045, 0.82, 1.25, z0 + 0.82, z0 + 0.92, 0.03);
        grip(parts, [s * 0.5, 1.12, z0 + 0.92], [s * 0.5, 1.12, z0 + 1.02], 0.02);
      }
      slab(parts, 'fly-footplate', RUBBER, -0.3, 0.3, 0.07, 0.1, z1 - 0.4, z1 - 0.12);
    },

    legext: () => {
      floorFrame(parts, -x1, x1, z0, z1);
      stack(parts, 0, z0, 0.42, 0.38, 1.05);
      tube(parts, 'leg-frame', FRAME, [0, 0.07, z0 + 0.5], [0, S - 0.07, z0 + 0.6], 0.045);
      pad(parts, 'leg-seat', PAD_BLACK, -0.21, 0.21, S - 0.09, S, z0 + 0.52, z0 + 0.95, 0.04);
      const back = new THREE.BoxGeometry(0.4, 0.55, 0.09);
      back.rotateX(-0.22);
      back.translate(0, S + 0.28, z0 + 0.52);
      parts.put('leg-back', PAD_BLACK, back, { tile: 0.4 });
      tube(parts, 'leg-uprights', FRAME_GREY, [-0.3, 0.07, z0 + 0.3], [-0.3, H - 0.1, z0 + 0.3], 0.034, true);
      tube(parts, 'leg-uprights', FRAME_GREY, [0.3, 0.07, z0 + 0.3], [0.3, H - 0.1, z0 + 0.3], 0.034, true);
      slab(parts, 'leg-top', SHROUD, -0.36, 0.36, H - 0.1, H, z0 + 0.14, z0 + 0.5);
      // the lever with the ankle roller, hinged at the seat front
      for (const s of [-1, 1]) tubes(parts, 'leg-lever', FRAME_GREY, [[s * 0.2, S - 0.02, z0 + 0.95], [s * 0.2, 0.18, z1 - 0.18]], 0.026);
      cylX(parts, 'leg-roller', PAD_BLACK, -0.24, 0.24, 0.2, z1 - 0.14, 0.055, 10);
      for (const s of [-1, 1]) tube(parts, 'leg-handles', FRAME_GREY, [s * 0.28, S + 0.02, z0 + 0.62], [s * 0.28, S + 0.18, z0 + 0.82], 0.016);
    },

    legcurl: () => {
      floorFrame(parts, -x1, x1, z0, z1);
      stack(parts, 0, z0, 0.42, 0.38, 1.05);
      tube(parts, 'leg-frame', FRAME, [0, 0.07, z0 + 0.5], [0, S - 0.07, z0 + 0.6], 0.045);
      pad(parts, 'leg-seat', PAD_BLACK, -0.21, 0.21, S - 0.09, S, z0 + 0.52, z0 + 0.95, 0.04);
      const back = new THREE.BoxGeometry(0.4, 0.55, 0.09);
      back.rotateX(-0.22);
      back.translate(0, S + 0.28, z0 + 0.52);
      parts.put('leg-back', PAD_BLACK, back, { tile: 0.4 });
      tube(parts, 'leg-uprights', FRAME_GREY, [-0.3, 0.07, z0 + 0.3], [-0.3, H - 0.1, z0 + 0.3], 0.034, true);
      tube(parts, 'leg-uprights', FRAME_GREY, [0.3, 0.07, z0 + 0.3], [0.3, H - 0.1, z0 + 0.3], 0.034, true);
      slab(parts, 'leg-top', SHROUD, -0.36, 0.36, H - 0.1, H, z0 + 0.14, z0 + 0.5);
      // thigh hold-down on top and the ankle roller under the heel, at the end of a long lever from the seat front
      tube(parts, 'leg-holddown', FRAME_GREY, [0, H - 0.1, z0 + 0.35], [0, S + 0.22, z0 + 1.0], 0.03);
      cylX(parts, 'leg-holddown-pad', PAD_BLACK, -0.2, 0.2, S + 0.18, z0 + 1.02, 0.05, 10);
      for (const s of [-1, 1]) tubes(parts, 'leg-lever', FRAME_GREY, [[s * 0.2, S - 0.04, z0 + 0.96], [s * 0.2, S - 0.28, z1 - 0.12]], 0.026);
      cylX(parts, 'leg-roller', PAD_BLACK, -0.24, 0.24, S - 0.25, z1 - 0.12, 0.05, 10);
    },

    lat: () => {
      // the tower at the back, an overhead beam forward to the front pulley, the wide bar hanging on its cable, a seat facing the stack with knee pads
      floorFrame(parts, -x1, x1, z0, z1);
      const t = tower(parts, z0, H, 1.52);
      const bz = z0 + 0.92;
      rtube(parts, 'lat-beam', FRAME, [0, H - 0.045, t.cz], [0, H - 0.045, bz + 0.06], 0.1, 0.09, 0.02);
      rtube(parts, 'lat-brace', FRAME, [0, H - 0.5, t.cz + 0.06], [0, H - 0.09, z0 + 0.62], 0.07, 0.05, 0.015);
      pulley(parts, 0, H - 0.16, bz, 0.06);
      cable(parts, [[0, H - 0.1, t.cz + 0.06], [0, H - 0.1, bz - 0.06]]);
      const barY = H - 0.64;
      cable(parts, [[0, H - 0.22, bz], [0, barY + 0.03, bz]]);
      tubes(parts, 'lat-bar', CHROME, [[-(x1 - 0.022), barY - 0.13, bz], [-0.44, barY, bz], [0.44, barY, bz], [x1 - 0.022, barY - 0.13, bz]], 0.0135);
      for (const s2 of [-1, 1]) grip(parts, [s2 * 0.47, barY - 0.015, bz], [s2 * (x1 - 0.03), barY - 0.115, bz], 0.019);
      cylY(parts, 'lat-bar-clip', SHROUD, 0, bz, barY + 0.005, barY + 0.05, 0.016, 10);
      // the seat on its post, facing the stack, and the knee pads over the thighs
      rtube(parts, 'lat-spine', FRAME, [0, 0.05, t.cz + 0.12], [0, 0.05, z1 - 0.05], 0.1, 0.07, 0.02);
      rtube(parts, 'lat-seat-post', FRAME, [0, 0.06, z0 + 1.04], [0, S - 0.09, z0 + 1.04], 0.08, 0.08, 0.015);
      pad(parts, 'lat-seat', PAD_BLACK, -0.21, 0.21, S - 0.09, S, z0 + 0.86, z0 + 1.22, 0.035);
      rtube(parts, 'lat-knee-post', FRAME_GREY, [0, 0.06, z0 + 0.82], [0, S + 0.2, z0 + 0.82], 0.055, 0.055, 0.01);
      knob(parts, [0, S + 0.06, z0 + 0.79], [0, 0, -1]);
      tube(parts, 'lat-knee-bar', FRAME_GREY, [-0.21, S + 0.2, z0 + 0.82], [0.21, S + 0.2, z0 + 0.82], 0.016);
      for (const s2 of [-1, 1]) cylX(parts, 'lat-knee-pads', PAD_BLACK, s2 > 0 ? 0.035 : -0.23, s2 > 0 ? 0.23 : -0.035, S + 0.2, z0 + 0.82, 0.05, q.tier === 'low' ? 8 : 20);
      slab(parts, 'placard', LABEL, t.ux + 0.035, t.ux + 0.038, 0.95, 1.2, t.cz - 0.08, t.cz + 0.08);
    },

    row: () => {
      // the tower at the back, a chest pad on its post ahead of the seat, two arms hanging from the tower's head to handles beside the pad, a foot rest
      floorFrame(parts, -x1, x1, z0, z1);
      const t = tower(parts, z0, H, 1.28);
      rtube(parts, 'row-spine', FRAME, [0, 0.05, t.cz + 0.12], [0, 0.05, z1 - 0.05], 0.1, 0.07, 0.02);
      rtube(parts, 'row-pad-post', FRAME, [0, 0.06, z0 + 0.78], [0, 0.5, z0 + 0.8], 0.085, 0.085, 0.015);
      rtube(parts, 'row-pad-post', FRAME_GREY, [0, 0.48, z0 + 0.8], [0, 0.98, z0 + 0.8], 0.06, 0.06, 0.01);
      knob(parts, [0, 0.44, z0 + 0.845], [0, 0, 1]);
      pad(parts, 'row-chest-pad', PAD_BLACK, -0.19, 0.19, 0.74, 1.2, z0 + 0.8, z0 + 0.9, 0.035, { board: 'behind' });
      // seat on its own post, facing the stack
      rtube(parts, 'row-seat-post', FRAME, [0, 0.06, z0 + 1.18], [0, S - 0.09, z0 + 1.18], 0.08, 0.08, 0.015);
      pad(parts, 'row-seat', PAD_BLACK, -0.2, 0.2, S - 0.09, S, z0 + 1.0, z0 + 1.36, 0.035);
      // the arms, from the tower's head to vertical handles either side of the chest pad
      for (const s2 of [-1, 1]) {
        const piv: V3 = [s2 * (t.ux + 0.07), H - 0.2, t.cz + 0.08];
        cylX(parts, 'row-pivots', SHROUD, piv[0] - 0.035, piv[0] + 0.035, piv[1], piv[2], 0.05, 16);
        rtubes(parts, 'row-arms', FRAME_GREY, [piv, [s2 * (x1 - 0.04), 1.1, z0 + 0.5], [s2 * (x1 - 0.06), 0.98, z0 + 0.6]], 0.055, 0.035, 0.012, [0, 0, 1]);
        tube(parts, 'row-handles', FRAME, [s2 * (x1 - 0.06), 0.86, z0 + 0.62], [s2 * (x1 - 0.06), 1.06, z0 + 0.62], 0.015);
        grip(parts, [s2 * (x1 - 0.06), 0.87, z0 + 0.62], [s2 * (x1 - 0.06), 1.05, z0 + 0.62], 0.02);
      }
      cable(parts, [[0, t.pulleyY + 0.055, t.cz + 0.02], [0, H - 0.2, t.cz + 0.1]]);
      // the foot rest under the chest pad
      const plate = new THREE.BoxGeometry(0.46, 0.025, 0.24);
      plate.rotateX(0.6);
      plate.translate(0, 0.28, z0 + 0.98);
      parts.put('row-footplate', RUBBER, plate);
      tube(parts, 'row-footplate-post', FRAME, [0, 0.06, z0 + 1.0], [0, 0.26, z0 + 0.99], 0.025);
      slab(parts, 'placard', LABEL, t.ux + 0.035, t.ux + 0.038, 0.85, 1.1, t.cz - 0.08, t.cz + 0.08);
    },

    legpress: () => {
      // 45 degree plate-loaded: two rails rise toward the back, the sled with its foot plate runs up them, plates sit on two horns; the seat leans back at the low end
      const baseW = x1 - 0.05;
      for (const s of [-1, 1]) slab(parts, 'lp-feet', FRAME, s * baseW - 0.05, s * baseW + 0.05, 0, 0.06, z0, z1 - 0.1);
      slab(parts, 'lp-feet', FRAME, -x1, x1, 0, 0.06, z0, z0 + 0.1);
      slab(parts, 'lp-feet', FRAME, -x1, x1, 0, 0.06, z1 - 0.2, z1 - 0.1);
      const railLo: V3 = [0, 0.3, z1 - 0.7], railHi: V3 = [0, H - 0.125, z0 + 0.3];
      for (const s of [-1, 1]) {
        const x = s * 0.4;
        tube(parts, 'lp-rails', FRAME, [x, railLo[1], railLo[2]], [x, railHi[1], railHi[2]], 0.04);
        tube(parts, 'lp-legs', FRAME, [x, 0.06, z0 + 0.2], [x, railHi[1], z0 + 0.3], 0.04);
        tube(parts, 'lp-legs', FRAME, [x, 0.06, z1 - 0.7], [x, railLo[1], z1 - 0.7], 0.04);
      }
      // the sled: a carriage across the rails, a foot plate, two plate horns
      const t = 0.62;
      const sled: V3 = [0, railLo[1] + (railHi[1] - railLo[1]) * t, railLo[2] + (railHi[2] - railLo[2]) * t];
      const ang = Math.atan2(railHi[1] - railLo[1], railLo[2] - railHi[2]);
      slab(parts, 'lp-sled', FRAME_GREY, -0.5, 0.5, sled[1] - 0.05, sled[1] + 0.05, sled[2] - 0.09, sled[2] + 0.09);
      const fp = new THREE.BoxGeometry(0.72, 0.05, 0.5);
      fp.rotateX(ang + Math.PI / 2);
      fp.translate(0, sled[1] + 0.25, sled[2] - 0.1);
      parts.put('lp-footplate', SHROUD, fp);
      for (const s of [-1, 1]) {
        tube(parts, 'lp-horns', FRAME_GREY, [s * 0.5, sled[1], sled[2]], [s * 0.7, sled[1], sled[2]], 0.025);
        for (let i = 0; i < 3; i++) plateDisc(parts, s * (0.54 + i * 0.07), sled[1], sled[2], 0.225, 0.045);
      }
      // seat pad and back pad at the low end; the back leans away from the sled
      pad(parts, 'lp-seat', PAD_BLACK, -0.24, 0.24, railLo[1] + 0.08, railLo[1] + 0.17, z1 - 0.85, z1 - 0.4, 0.04);
      const back = new THREE.BoxGeometry(0.5, 0.78, 0.1);
      back.rotateX(0.82);
      back.translate(0, railLo[1] + 0.45, z1 - 0.319);
      parts.put('lp-back', PAD_BLACK, back, { tile: 0.4 });
      for (const s of [-1, 1]) tube(parts, 'lp-back-frame', FRAME, [s * 0.3, railLo[1], z1 - 0.62], [s * 0.3, railLo[1] + 0.7, z1 - 0.24], 0.03);
      for (const s of [-1, 1]) tube(parts, 'lp-handles', FRAME_GREY, [s * 0.3, railLo[1] + 0.2, z1 - 0.62], [s * 0.3, railLo[1] + 0.34, z1 - 0.7], 0.016);
    },

    cable: () => {
      // two towers, each a stack behind its pulley track, joined by a top beam: the walker stands in the middle and pulls either arm across
      const tx = x1 - 0.3;
      floorFrame(parts, -x1, x1, z0, z0 + 0.8);
      for (const s of [-1, 1]) {
        stack(parts, s * tx, z0, 0.5, 0.42, 1.55, 16);
        for (const t of [-1, 1]) tube(parts, 'cx-uprights', FRAME_GREY, [s * tx + t * 0.19, 0.07, z0 + 0.62], [s * tx + t * 0.19, H - 0.03, z0 + 0.62], 0.035, true);
        slab(parts, 'cx-top', SHROUD, s * tx - 0.26, s * tx + 0.26, H - 0.1, H, z0 + 0.04, z0 + 0.7);
        // the vertical rail the pulley slides on, and the pulley and its handle
        tube(parts, 'cx-track', CHROME, [s * tx, 0.3, z0 + 0.68], [s * tx, H - 0.1, z0 + 0.68], 0.016);
        pulley(parts, s * tx, 2.0, z0 + 0.72, 0.055);
        cable(parts, [[s * tx, 2.0, z0 + 0.72], [s * tx - s * 0.12, 1.2, z0 + 0.82]]);
        grip(parts, [s * tx - s * 0.2, 1.2, z0 + 0.82], [s * tx - s * 0.06, 1.2, z0 + 0.82], 0.02);
        cable(parts, [[s * tx, 0.45, z0 + 0.72], [s * tx - s * 0.1, 0.35, z0 + 0.82]]);
        pulley(parts, s * tx, 0.45, z0 + 0.72, 0.055);
      }
      slab(parts, 'cx-beam', FRAME, -x1 + 0.1, x1 - 0.1, H - 0.2, H - 0.08, z0 + 0.5, z0 + 0.74);
      slab(parts, 'cx-pullup', FRAME_GREY, -0.4, 0.4, H - 0.2, H - 0.14, z0 + 0.74, z0 + 0.84);
      // a pull-up bar over the middle
      tube(parts, 'cx-pullup-bar', CHROME, [-0.45, H - 0.25, z0 + 0.8], [0.45, H - 0.25, z0 + 0.8], 0.017);
      slab(parts, 'cx-footplate', RUBBER, -0.4, 0.4, 0.0, 0.015, z0 + 0.8, z1);
    },

    smith: () => {
      // two vertical guide rods at the back, the bar running on them with a plate stack each end, a top beam, hooks and safety stops, a base with feet
      const ux = 0.66;
      for (const s of [-1, 1]) {
        slab(parts, 'sm-base', FRAME, s * ux - 0.06, s * ux + 0.06, 0, 0.08, z0, z1);
        slab(parts, 'sm-base', FRAME, s > 0 ? s * ux - 0.45 : -x1, s > 0 ? x1 : s * ux + 0.45, 0, 0.08, z0, z0 + 0.15);
        slab(parts, 'sm-base', FRAME, s > 0 ? s * ux - 0.3 : -s * ux * 0 - ux - 0.3, s > 0 ? ux + 0.3 : -ux + 0.3, 0, 0.08, z1 - 0.15, z1);
        tube(parts, 'sm-uprights', FRAME, [s * ux, 0.08, z0 + 0.25], [s * ux, H - 0.04, z0 + 0.25], 0.045, true);
        tube(parts, 'sm-rods', CHROME, [s * (ux - 0.075), 0.2, z0 + 0.25], [s * (ux - 0.075), H - 0.1, z0 + 0.25], 0.013);
        for (const y of [0.35, 0.55, 0.75, 0.95, 1.15, 1.35, 1.55, 1.75, 1.95]) slab(parts, 'sm-holes', FRAME_GREY, s * ux - 0.015, s * ux + 0.015, y, y + 0.025, z0 + 0.296, z0 + 0.3);
      }
      slab(parts, 'sm-top', FRAME, -ux, ux, H - 0.1, H, z0 + 0.2, z0 + 0.3);
      slab(parts, 'sm-top', FRAME, -ux, ux, H - 0.2, H - 0.1, z0 + 0.27, z0 + 0.3);
      // the bar: 2.15 m, plates at each end, carriages on the rods
      const by = 1.25;
      tube(parts, 'sm-bar', CHROME, [-x1, by, z0 + 0.4], [x1, by, z0 + 0.4], 0.0145, true);
      for (const s of [-1, 1]) {
        slab(parts, 'sm-carriage', FRAME_GREY, s * ux - 0.075, s * ux + 0.075, by - 0.06, by + 0.06, z0 + 0.3, z0 + 0.45);
        for (let i = 0; i < 3; i++) plateDisc(parts, s * (ux + 0.2 + i * 0.065), by, z0 + 0.4, 0.225, 0.055);
        tube(parts, 'sm-stops', FRAME_GREY, [s * (ux - 0.05), 0.7, z0 + 0.33], [s * (ux - 0.05), 0.7, z0 + 0.62], 0.02);
      }
    },

    multi: () => {
      // four stacks at the corners of a rectangle, joined by a top frame; a lat bar over the middle, a bench, low and high pulleys with handles
      const sx = x1 - 0.24, sz = d / 2 - 0.26;
      for (const [cx, cz] of [[-sx, -sz], [sx, -sz], [-sx, sz], [sx, sz]] as const) {
        weightStack(parts, cx - 0.2, cx + 0.2, cz - 0.22, cz + 0.22, 0.1, 1.55, 16);
        for (const [a, b] of [[-0.2, -0.22], [0.2, -0.22], [-0.2, 0.22], [0.2, 0.22]] as const) tube(parts, 'mg-posts', FRAME_GREY, [cx + a, 0.05, cz + b], [cx + a, H - 0.02, cz + b], 0.032, true);
        slab(parts, 'mg-feet', FRAME, cx - 0.24, cx + 0.24, 0, 0.06, cz - 0.26, cz + 0.26);
      }
      for (const z of [-sz, sz]) { slab(parts, 'mg-beams', FRAME, -sx - 0.2, sx + 0.2, H - 0.12, H, z - 0.05, z + 0.05); slab(parts, 'mg-base-beams', FRAME, -sx - 0.2, sx + 0.2, 0.0, 0.06, z - 0.05, z + 0.05); }
      for (const x of [-sx, sx]) { slab(parts, 'mg-beams', FRAME, x - 0.05, x + 0.05, H - 0.12, H, -sz, sz); slab(parts, 'mg-base-beams', FRAME, x - 0.05, x + 0.05, 0, 0.06, -sz, sz); }
      slab(parts, 'mg-beams', FRAME, -0.05, 0.05, H - 0.12, H, -sz, sz);
      // lat bar and its cable
      pulley(parts, -0.2, H - 0.16, 0, 0.06); pulley(parts, 0.2, H - 0.16, 0, 0.06);
      tubes(parts, 'mg-lat-bar', CHROME, [[-0.6, H - 0.7, 0.0], [-0.42, H - 0.6, 0.0], [0.42, H - 0.6, 0.0], [0.6, H - 0.7, 0.0]], 0.016);
      cable(parts, [[-0.2, H - 0.16, 0], [-0.3, H - 0.6, 0]]); cable(parts, [[0.2, H - 0.16, 0], [0.3, H - 0.6, 0]]);
      // a seat with a back pad between the front stacks, a chest-press handle each side, and a leg-extension roller under it
      pad(parts, 'mg-seat', PAD_BLACK, -0.2, 0.2, 0.42, 0.5, 0.15, 0.58, 0.04);
      pad(parts, 'mg-back', PAD_BLACK, -0.2, 0.2, 0.55, 1.15, 0.5, 0.6, 0.04);
      tube(parts, 'mg-seat-post', FRAME, [0, 0.06, 0.35], [0, 0.42, 0.35], 0.04);
      for (const s of [-1, 1]) {
        tubes(parts, 'mg-press-arms', FRAME_GREY, [[s * sx, 1.1, -sz + 0.22], [s * 0.42, 1.05, 0.2], [s * 0.38, 1.0, -0.05]], 0.022);
        grip(parts, [s * 0.38, 1.0, -0.05], [s * 0.38, 1.0, 0.1], 0.021);
        cable(parts, [[s * sx, 0.3, sz], [s * sx, 0.3, sz - 0.3]]);
        grip(parts, [s * sx, 0.3, sz - 0.3], [s * sx - s * 0.15, 0.3, sz - 0.3], 0.02);
      }
      cylX(parts, 'mg-roller', PAD_BLACK, -0.22, 0.22, 0.25, 0.7, 0.05, 10);
      // two more stations in the cavity either side of the lat seat: a seat and back pad each, a leg-extension roller on a lever, and an accent panel on every stack
      for (const sgn of [-1, 1]) {
        const cx = sgn * 0.88;
        pad(parts, 'mg-seat', PAD_BLACK, cx - 0.2, cx + 0.2, 0.42, 0.5, -0.1, 0.32, 0.04);
        pad(parts, 'mg-back', PAD_BLACK, cx - 0.2, cx + 0.2, 0.55, 1.1, -0.26, -0.16, 0.04);
        tube(parts, 'mg-seat-post', FRAME, [cx, 0.06, 0.12], [cx, 0.42, 0.12], 0.04);
        tubes(parts, 'mg-lever', FRAME_GREY, [[cx - 0.16, 0.45, 0.3], [cx - 0.16, 0.22, 0.56]], 0.022);
        tubes(parts, 'mg-lever', FRAME_GREY, [[cx + 0.16, 0.45, 0.3], [cx + 0.16, 0.22, 0.56]], 0.022);
        cylX(parts, 'mg-roller', PAD_BLACK, cx - 0.2, cx + 0.2, 0.22, 0.58, 0.05, 10);
      }
      for (const [cx, cz] of [[-sx, -sz], [sx, -sz], [-sx, sz], [sx, sz]] as const) slab(parts, 'mg-accent', ACCENT_RED, cx - 0.2, cx + 0.2, 1.1, 1.4, cz + (cz > 0 ? 0.2 : -0.225), cz + (cz > 0 ? 0.225 : -0.2));
      void ACCENT_BLUE; void IRON; void CONSOLE; void SHROUD_LIGHT; void tubes; void q;
    },
  };
  build[v]();
  return parts.done();
}
