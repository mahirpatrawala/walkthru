// Strength machines at commercial size (SPEC 16.17): a four-station multi-gym, lat pulldown, seated row, chest press, shoulder press, pec fly, leg press
// (45 degrees, plate loaded), leg extension, leg curl, cable crossover and Smith machine. The BACK (the weight stack, the frame) is at -z; the front is
// where you get in. Footprint and height are exactly the item's. Weight stacks have real plates (a stack is 18 plates of about 5 cm).
import * as THREE from 'three';
import { Parts } from './core';
import type { GenEnv, GenSize, Roles } from './core';
import { ACCENT_BLUE, ACCENT_RED, CHROME, CONSOLE, FRAME, FRAME_GREY, IRON, PAD_BLACK, RUBBER, SHROUD, SHROUD_LIGHT, cable, cylX, cylZ, grip, pad, plateDisc, pulley, slab, tube, tubes, weightStack } from './gymkit';

export const STRENGTH_VARIANTS = ['multi', 'lat', 'row', 'chest', 'shoulder', 'fly', 'legpress', 'legext', 'legcurl', 'cable', 'smith'] as const;
export type StrengthVariant = (typeof STRENGTH_VARIANTS)[number];
export interface StrengthParams { variant: StrengthVariant }
export const STRENGTH_DEFAULTS: StrengthParams = { variant: 'chest' };

type V3 = [number, number, number];

/** two side rails and a cross foot at each end, flat on the floor */
function floorFrame(p: Parts, x0: number, x1: number, z0: number, z1: number): void {
  slab(p, 'frame-base', FRAME, x0, x1, 0.0, 0.07, z0, z0 + 0.07);
  slab(p, 'frame-base', FRAME, x0, x1, 0.0, 0.07, z1 - 0.07, z1);
  for (const s of [-1, 1]) slab(p, 'frame-base', FRAME, s > 0 ? x1 - 0.07 : x0, s > 0 ? x1 : x0 + 0.07, 0.0, 0.07, z0, z1);
}

/** a stack of `n` plates with its shroud, centred at x = cx, from the back wall forward by `depth` */
function stack(p: Parts, cx: number, z0: number, depth: number, width: number, topY: number, n = 18): void {
  weightStack(p, cx - width / 2, cx + width / 2, z0 + 0.04, z0 + 0.04 + depth, 0.1, topY, n);
}

export function buildStrength(env: GenEnv, size: GenSize, p: StrengthParams, _roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (STRENGTH_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'chest';
  const parts = new Parts(env, `gen:strength`);
  const x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const q = env.q;
  const build: Record<string, () => void> = {
    chest: () => {
      // stack behind the back pad, two press arms that pivot behind the walker's shoulders and reach forward to the grips
      floorFrame(parts, -x1, x1, z0, z1);
      stack(parts, 0, z0, 0.42, 0.4, 1.1);
      for (const s of [-1, 1]) tube(parts, 'press-uprights', FRAME_GREY, [s * 0.36, 0.07, z0 + 0.3], [s * 0.36, H - 0.06, z0 + 0.3], 0.036, true);
      slab(parts, 'press-top', SHROUD, -0.42, 0.42, H - 0.12, H, z0 + 0.1, z0 + 0.5);
      tube(parts, 'press-frame', FRAME, [0, 0.07, z0 + 0.5], [0, S - 0.06, z0 + 0.74], 0.04);
      pad(parts, 'press-seat', PAD_BLACK, -0.21, 0.21, S - 0.09, S, z0 + 0.58, z0 + 1.0, 0.04);
      pad(parts, 'press-back', PAD_BLACK, -0.2, 0.2, S + 0.05, S + 0.62, z0 + 0.46, z0 + 0.56, 0.04);
      for (const s of [-1, 1]) {
        tubes(parts, 'press-arms', FRAME_GREY, [[s * 0.38, 1.02, z0 + 0.3], [s * 0.4, 1.0, z0 + 0.8], [s * 0.34, 0.98, z0 + 1.0]], 0.024);
        tube(parts, 'press-arms', FRAME_GREY, [s * 0.38, 1.02, z0 + 0.3], [s * 0.38, 0.62, z0 + 0.3], 0.024);
        grip(parts, [s * 0.34, 0.98, z0 + 0.9], [s * 0.34, 0.98, z0 + 1.08], 0.022);
      }
      tubes(parts, 'press-footrest', FRAME_GREY, [[-0.3, 0.07, z1 - 0.3], [-0.3, 0.3, z1 - 0.5], [0.3, 0.3, z1 - 0.5], [0.3, 0.07, z1 - 0.3]], 0.02);
      slab(parts, 'press-footplate', RUBBER, -0.3, 0.3, 0.07, 0.1, z1 - 0.45, z1 - 0.15);
    },

    shoulder: () => {
      floorFrame(parts, -x1, x1, z0, z1);
      stack(parts, 0, z0, 0.42, 0.4, 1.1);
      for (const s of [-1, 1]) tube(parts, 'press-uprights', FRAME_GREY, [s * 0.36, 0.07, z0 + 0.3], [s * 0.36, H - 0.06, z0 + 0.3], 0.036, true);
      slab(parts, 'press-top', SHROUD, -0.42, 0.42, H - 0.12, H, z0 + 0.1, z0 + 0.5);
      tube(parts, 'press-frame', FRAME, [0, 0.07, z0 + 0.5], [0, S - 0.06, z0 + 0.74], 0.04);
      pad(parts, 'press-seat', PAD_BLACK, -0.21, 0.21, S - 0.09, S, z0 + 0.6, z0 + 1.0, 0.04);
      pad(parts, 'press-back', PAD_BLACK, -0.2, 0.2, S + 0.05, S + 0.78, z0 + 0.46, z0 + 0.56, 0.04);
      for (const s of [-1, 1]) {
        tubes(parts, 'press-arms', FRAME_GREY, [[s * 0.4, 1.28, z0 + 0.3], [s * 0.4, 1.4, z0 + 0.6], [s * 0.34, 1.4, z0 + 0.84]], 0.024);
        tube(parts, 'press-arms', FRAME_GREY, [s * 0.4, 1.28, z0 + 0.3], [s * 0.4, 0.9, z0 + 0.3], 0.024);
        grip(parts, [s * 0.34, 1.4, z0 + 0.74], [s * 0.34, 1.4, z0 + 0.92], 0.022);
      }
      slab(parts, 'press-footplate', RUBBER, -0.3, 0.3, 0.07, 0.1, z1 - 0.45, z1 - 0.15);
    },

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
      // the stack and its tower at the back, an overhead beam to the pulley, the lat bar hanging from it, a seat facing the stack with thigh pads
      floorFrame(parts, -x1, x1, z0, z1);
      stack(parts, 0, z0, 0.46, 0.4, 1.3);
      for (const s of [-1, 1]) tube(parts, 'lat-uprights', FRAME_GREY, [s * 0.36, 0.07, z0 + 0.3], [s * 0.36, H - 0.05, z0 + 0.3], 0.04, true);
      slab(parts, 'lat-top', SHROUD, -0.42, 0.42, H - 0.1, H, z0 + 0.08, z0 + 0.5);
      for (const s of [-1, 1]) tube(parts, 'lat-beam', FRAME_GREY, [s * 0.36, H - 0.1, z0 + 0.3], [s * 0.36, H - 0.14, z0 + 0.95], 0.035);
      slab(parts, 'lat-beam', FRAME_GREY, -0.4, 0.4, H - 0.18, H - 0.1, z0 + 0.9, z0 + 0.98);
      pulley(parts, -0.22, H - 0.2, z0 + 0.88, 0.06);
      pulley(parts, 0.22, H - 0.2, z0 + 0.88, 0.06);
      // the bar: a long wide-grip bar hanging at the height a walker reaches, with two cables
      const barY = H - 0.55;
      tubes(parts, 'lat-bar', CHROME, [[-0.55, barY - 0.1, z0 + 0.9], [-0.4, barY, z0 + 0.9], [0.4, barY, z0 + 0.9], [0.55, barY - 0.1, z0 + 0.9]], 0.016);
      grip(parts, [-0.52, barY - 0.07, z0 + 0.9], [-0.4, barY, z0 + 0.9], 0.02);
      grip(parts, [0.52, barY - 0.07, z0 + 0.9], [0.4, barY, z0 + 0.9], 0.02);
      cable(parts, [[-0.22, H - 0.2, z0 + 0.88], [-0.3, barY, z0 + 0.9]]);
      cable(parts, [[0.22, H - 0.2, z0 + 0.88], [0.3, barY, z0 + 0.9]]);
      // seat and the knee pads, which sit over the thighs
      pad(parts, 'lat-seat', PAD_BLACK, -0.17, 0.17, S - 0.09, S, z0 + 0.82, z0 + 1.15, 0.04);
      tube(parts, 'lat-seat-frame', FRAME, [0, 0.07, z0 + 0.95], [0, S - 0.09, z0 + 1.0], 0.04);
      tube(parts, 'lat-seat-frame', FRAME, [0, 0.07, z0 + 0.95], [0, 0.07, z0 + 0.4], 0.04);
      for (const s of [-1, 1]) {
        tubes(parts, 'lat-knee-arms', FRAME_GREY, [[s * 0.22, S - 0.04, z0 + 1.15], [s * 0.22, S + 0.22, z0 + 0.86]], 0.022);
        cylZ(parts, 'lat-knee-pads', PAD_BLACK, z0 + 0.7, z0 + 0.92, s * 0.2, S + 0.22, 0.05, 10);
      }
      slab(parts, 'lat-footplate', RUBBER, -0.25, 0.25, 0.07, 0.1, z0 + 0.5, z0 + 0.8);
    },

    row: () => {
      // seated row: stack at the back, a chest pad ahead of the walker, a low cable from the stack to the handle, foot plates, a seat that faces the stack
      floorFrame(parts, -x1, x1, z0, z1);
      stack(parts, 0, z0, 0.42, 0.4, 1.05);
      for (const s of [-1, 1]) tube(parts, 'row-uprights', FRAME_GREY, [s * 0.32, 0.07, z0 + 0.3], [s * 0.32, H - 0.08, z0 + 0.3], 0.034, true);
      slab(parts, 'row-top', SHROUD, -0.38, 0.38, H - 0.1, H, z0 + 0.1, z0 + 0.5);
      // the chest pad on an angled post
      tube(parts, 'row-pad-post', FRAME_GREY, [0, 0.4, z0 + 0.6], [0, 1.15, z0 + 0.66], 0.04);
      pad(parts, 'row-chest-pad', PAD_BLACK, -0.2, 0.2, 0.72, 1.18, z0 + 0.64, z0 + 0.74, 0.04);
      // the cable at handle height, with two grips on a T handle
      cable(parts, [[0, 0.62, z0 + 0.46], [0, 0.62, z0 + 0.8]]);
      tubes(parts, 'row-handle', CHROME, [[0, 0.62, z0 + 0.8], [-0.2, 0.62, z0 + 0.94], [-0.2, 0.62, z0 + 1.02]], 0.014);
      tubes(parts, 'row-handle', CHROME, [[0, 0.62, z0 + 0.8], [0.2, 0.62, z0 + 0.94], [0.2, 0.62, z0 + 1.02]], 0.014);
      // seat on a rail, foot plate
      tube(parts, 'row-rail', FRAME, [0, 0.12, z0 + 0.5], [0, 0.12, z1 - 0.05], 0.045);
      pad(parts, 'row-seat', PAD_BLACK, -0.17, 0.17, S - 0.09, S, z1 - 0.48, z1 - 0.1, 0.04);
      tube(parts, 'row-seat-post', FRAME, [0, 0.12, z1 - 0.3], [0, S - 0.09, z1 - 0.3], 0.035);
      const plate = new THREE.BoxGeometry(0.5, 0.03, 0.34);
      plate.rotateX(0.5);
      plate.translate(0, 0.28, z0 + 0.95);
      parts.put('row-footplate', RUBBER, plate);
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
      void ACCENT_BLUE; void ACCENT_RED; void IRON; void CONSOLE; void SHROUD_LIGHT; void tubes; void q;
    },
  };
  build[v]();
  return parts.done();
}
