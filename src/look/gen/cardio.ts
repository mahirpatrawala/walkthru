// Cardio machines at commercial size (SPEC 16.17): treadmill, cross trainer, upright bike, spin bike, recumbent bike, rower, stair climber.
// Every machine has its BACK (the console, the mast, the flywheel) at -z and its open end, where you step on, at +z. The footprint and height
// are exactly the item's. The treadmill's belt ribs are their own mesh (`tread-belt-ribs`) so a walker on it can run them
// (`group.userData.motion`, src/buyer/machine-motion.ts); at rest they sit still like any part.
import * as THREE from 'three';
import { Parts } from './core';
import type { GenEnv, GenSize, Roles } from './core';
import { ACCENT_RED, CHROME, CONSOLE, FRAME, FRAME_GREY, PAD_BLACK, RUBBER, SCREEN_GLASS, SHROUD, SHROUD_LIGHT, consoleUnit, cylX, cylY, cylZ, grip, knob, pad, rtube, slab, tube, tubes, wholeModel } from './gymkit';
import { softCushion } from './soft';

export const CARDIO_VARIANTS = ['treadmill', 'cross', 'upright', 'spin', 'recumbent', 'rower', 'stair'] as const;
export type CardioVariant = (typeof CARDIO_VARIANTS)[number];
export interface CardioParams { variant: CardioVariant }
export const CARDIO_DEFAULTS: CardioParams = { variant: 'treadmill' };

/** how a machine's moving part is driven: ribs that slide along an axis and wrap every `pitchM` */
export interface MachineMotion { kind: 'belt'; mesh: string; pitchM: number; axis: 'z'; speedMps: number }

export function buildCardio(env: GenEnv, size: GenSize, p: CardioParams, _roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (CARDIO_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'treadmill';
  const parts = new Parts(env, `gen:cardio`);
  const z0 = -d / 2, z1 = d / 2, x1 = w / 2;
  const q = env.q;
  const build: Record<string, () => void> = {
    treadmill: () => {
      // a commercial treadmill: aluminium side rails with rubber foot strips, the belt on its deck, a sculpted motor hood at the console end,
      // two oval uprights leaning to the console, side handrails with foam grips, a front grab bar, and a tilted console with its screen
      const zd0 = z0 + 0.46; // where the deck starts, behind the hood
      // deck body and the belt
      parts.box('tread-deck', SHROUD, -x1 + 0.03, x1 - 0.03, 0.04, S - 0.07, zd0, z1 - 0.05, { c: 0.01 });
      parts.box('tread-belt', RUBBER, -0.28, 0.28, S - 0.032, S - 0.014, zd0 + 0.04, z1 - 0.07, { c: 0.003 });
      // belt ribs: lighter transverse bars that slide when the belt runs; none within one pitch of the ends so the slide stays inside the deck
      const pitch = 0.12;
      const zr0 = zd0 + 0.14, zr1 = z1 - 0.2;
      const nRib = Math.floor((zr1 - zr0) / pitch);
      for (let i = 0; i < nRib; i++) parts.put('tread-belt-ribs', { key: 'rubber', tint: '#34363A' }, new THREE.BoxGeometry(0.54, 0.002, 0.012).translate(0, S - 0.013, zr0 + i * pitch));
      // side rails: aluminium extrusion with a grey rubber foot strip on top
      for (const s2 of [-1, 1]) {
        const xr = s2 * (x1 - 0.065);
        rtube(parts, 'tread-rails', FRAME_GREY, [xr, S - 0.05, zd0 - 0.02], [xr, S - 0.05, z1 - 0.01], 0.13, 0.1, 0.02);
        parts.box('tread-rail-strips', RUBBER, xr - 0.05, xr + 0.05, S, S + 0.004, zd0 + 0.02, z1 - 0.05, { c: 0.002 });
      }
      // rear roller cover across the end, rubber feet at the corners
      rtube(parts, 'tread-end-cap', SHROUD, [-x1 + 0.004, S - 0.06, z1 - 0.035], [x1 - 0.004, S - 0.06, z1 - 0.035], 0.07, 0.08, 0.025);
      for (const s2 of [-1, 1]) for (const zz of [z1 - 0.12, zd0 + 0.1]) parts.box('tread-feet', RUBBER, s2 * (x1 - 0.1) - 0.05, s2 * (x1 - 0.1) + 0.05, 0, 0.04, zz - 0.06, zz + 0.06, { c: 0.008 });
      // the motor hood: one rounded moulding across the console end, a darker vent band on its top
      const hood = q.tier === 'low' ? new THREE.BoxGeometry(w - 0.02, 0.36, zd0 - z0 + 0.06) : softCushion(w - 0.02, 0.36, zd0 - z0 + 0.06, { r: 0.07, puff: 0.004, seg: 3 });
      hood.translate(0, 0.22, (z0 + zd0 + 0.06) / 2);
      parts.put('tread-hood', SHROUD, hood);
      parts.box('tread-hood-vent', CONSOLE, -x1 + 0.12, x1 - 0.12, 0.4, 0.405, z0 + 0.12, zd0 - 0.04, { c: 0.002 });
      parts.box('tread-base', FRAME, -x1 + 0.02, x1 - 0.02, 0, 0.05, z0, zd0 + 0.04, { c: 0.008 });
      // oval uprights leaning to the console, and the bar between them under it
      for (const s2 of [-1, 1]) {
        const x = s2 * (x1 - 0.075);
        rtube(parts, 'tread-uprights', FRAME_GREY, [x, 0.3, z0 + 0.34], [x, H - 0.24, z0 + 0.14], 0.055, 0.11, 0.025);
        // side handrail from the upright toward the walker, foam where the hand goes
        tubes(parts, 'tread-handrails', FRAME_GREY, [[x, H - 0.27, z0 + 0.16], [x + s2 * 0.01, 1.08, z0 + 0.5], [x + s2 * 0.01, 1.04, z0 + 0.86], [x + s2 * 0.01, 0.98, z0 + 0.92]], 0.019);
        grip(parts, [x + s2 * 0.01, 1.075, z0 + 0.54], [x + s2 * 0.01, 1.045, z0 + 0.84], 0.024);
      }
      tube(parts, 'tread-handrails', FRAME_GREY, [-x1 + 0.09, 1.16, z0 + 0.3], [x1 - 0.09, 1.16, z0 + 0.3], 0.018);
      grip(parts, [-0.2, 1.16, z0 + 0.3], [0.2, 1.16, z0 + 0.3], 0.022);
      rtube(parts, 'tread-console-arm', SHROUD, [-x1 + 0.08, H - 0.25, z0 + 0.13], [x1 - 0.08, H - 0.25, z0 + 0.13], 0.09, 0.07, 0.03);
      // the console: tilted toward the walker, a large screen, keys; bottle holders at its sides and the red safety key
      consoleUnit(parts, 0, H - 0.15, z0 + 0.2, 0.62, 0.27, 0.1, 0.36, 'tread', H);
      for (const s2 of [-1, 1]) cylY(parts, 'tread-bottle-holders', SHROUD, s2 * 0.36, z0 + 0.2, H - 0.36, H - 0.24, 0.04);
      knob(parts, [0.24, H - 0.3, z0 + 0.25], [0, 0.3, 1]);
    },

    cross: () => {
      // a long floor frame, the drive housing and the mast at the back, two moving arms, two pedals on rails, a pair of fixed grips
      slab(parts, 'cross-frame', FRAME, -x1, x1, 0.0, 0.05, z0, z0 + 0.12);
      slab(parts, 'cross-frame', FRAME, -x1, x1, 0.0, 0.05, z1 - 0.12, z1);
      for (const s of [-1, 1]) tube(parts, 'cross-rails', FRAME, [s * (x1 - 0.08), 0.09, z0 + 0.06], [s * (x1 - 0.08), 0.09, z1 - 0.06], 0.026);
      parts.box('cross-housing', SHROUD, -x1 + 0.04, x1 - 0.04, 0.05, 0.5, z0, z0 + 0.62, { c: 0.01 });
      parts.box('cross-housing-top', SHROUD_LIGHT, -x1 + 0.1, x1 - 0.1, 0.5, 0.58, z0 + 0.1, z0 + 0.5, { c: 0.006 });
      // the mast, with the console at its head
      tube(parts, 'cross-mast', FRAME_GREY, [0, 0.55, z0 + 0.28], [0, H - 0.2, z0 + 0.2], 0.05, true);
      parts.box('cross-console', CONSOLE, -0.22, 0.22, H - 0.28, H, z0 + 0.04, z0 + 0.34, { c: 0.012 });
      slab(parts, 'cross-screen', SCREEN_GLASS, -0.17, 0.17, H - 0.24, H - 0.05, z0 + 0.34, z0 + 0.344);
      // fixed grips, a bent bar from the console down toward the walker
      for (const s of [-1, 1]) tubes(parts, 'cross-fixed-grips', FRAME_GREY, [[s * 0.17, H - 0.3, z0 + 0.2], [s * 0.3, H - 0.38, z0 + 0.3], [s * 0.3, 1.2, z0 + 0.5], [s * 0.3, 1.1, z0 + 0.52]], 0.017);
      // moving arms: from a pivot on the mast down to the pedal links; set to the middle of their swing
      for (const s of [-1, 1]) {
        tube(parts, 'cross-arms', FRAME_GREY, [s * (x1 - 0.04), H - 0.22, z0 + 0.22], [s * (x1 - 0.04), 1.05, z0 + 0.62], 0.022);
        grip(parts, [s * (x1 - 0.04), 1.13, z0 + 0.5], [s * (x1 - 0.04), 1.5, z0 + 0.34], 0.022);
        tube(parts, 'cross-arms', FRAME_GREY, [s * (x1 - 0.04), 1.05, z0 + 0.62], [s * (x1 - 0.04), 0.3, z0 + 1.15], 0.022);
        tube(parts, 'cross-pedal-arms', FRAME_GREY, [s * (x1 - 0.1), 0.3, z0 + 1.15], [s * (x1 - 0.1), S, z1 - 0.3], 0.022);
        parts.box('cross-pedals', SHROUD, s > 0 ? 0.12 : -x1 + 0.02, s > 0 ? x1 - 0.02 : -0.12, S - 0.04, S, z0 + 1.2, z0 + 1.62, { c: 0.008 });
        slab(parts, 'cross-pedal-pads', RUBBER, s > 0 ? 0.13 : -x1 + 0.03, s > 0 ? x1 - 0.03 : -0.13, S, S + 0.008, z0 + 1.22, z0 + 1.6);
      }
    },

    upright: () => {
      // two stabiliser feet, a frame that runs up to the saddle at the back and to the handlebar at the front, a flywheel shroud, pedals
      slab(parts, 'bike-feet', FRAME, -x1, x1, 0.0, 0.05, z0, z0 + 0.07);
      slab(parts, 'bike-feet', FRAME, -x1 + 0.03, x1 - 0.03, 0.0, 0.05, z1 - 0.07, z1);
      tube(parts, 'bike-frame', FRAME, [0, 0.07, z0 + 0.04], [0, 0.4, z0 + 0.45], 0.04);
      tube(parts, 'bike-frame', FRAME, [0, 0.4, z0 + 0.45], [0, S - 0.2, z1 - 0.28], 0.032);
      tube(parts, 'bike-frame', FRAME, [0, 0.07, z1 - 0.04], [0, 0.45, z1 - 0.28], 0.03);
      parts.box('bike-shroud', SHROUD, -0.1, 0.1, 0.16, 0.46, z0 + 0.22, z0 + 0.58, { c: 0.008 });
      tube(parts, 'bike-mast', FRAME_GREY, [0, 0.4, z0 + 0.3], [0, H - 0.2, z0 + 0.14], 0.032, true);
      parts.box('bike-console', CONSOLE, -0.17, 0.17, H - 0.22, H, z0, z0 + 0.22, { c: 0.01 });
      slab(parts, 'bike-screen', SCREEN_GLASS, -0.13, 0.13, H - 0.19, H - 0.04, z0 + 0.22, z0 + 0.224);
      tubes(parts, 'bike-handlebar', FRAME_GREY, [[-0.22, H - 0.4, z0 + 0.38], [-0.22, H - 0.26, z0 + 0.14], [0.22, H - 0.26, z0 + 0.14], [0.22, H - 0.4, z0 + 0.38]], 0.017);
      grip(parts, [-0.22, H - 0.3, z0 + 0.3], [-0.22, H - 0.4, z0 + 0.38], 0.02);
      grip(parts, [0.22, H - 0.3, z0 + 0.3], [0.22, H - 0.4, z0 + 0.38], 0.02);
      // seat post and saddle
      tube(parts, 'bike-seatpost', CHROME, [0, S - 0.22, z1 - 0.3], [0, S - 0.04, z1 - 0.3], 0.017, true);
      pad(parts, 'bike-saddle', PAD_BLACK, -0.14, 0.14, S - 0.09, S, z1 - 0.52, z1 - 0.14, 0.04);
      // cranks and pedals
      cylX(parts, 'bike-crank', CHROME, -0.14, 0.14, 0.34, z0 + 0.52, 0.025, 8);
      for (const s of [-1, 1]) {
        tube(parts, 'bike-crank-arms', CHROME, [s * 0.14, 0.34, z0 + 0.52], [s * 0.14, 0.2 - 0.05 * s, z0 + 0.52 + 0.04 * s], 0.012);
        parts.box('bike-pedals', RUBBER, s > 0 ? 0.12 : -0.2, s > 0 ? 0.2 : -0.12, 0.14 + 0.06 * (s > 0 ? 1 : 0), 0.17 + 0.06 * (s > 0 ? 1 : 0), z0 + 0.46 + 0.04 * s, z0 + 0.62 + 0.04 * s, { c: 0.004 });
      }
    },

    spin: () => {
      // an indoor cycle: oval stabiliser feet with rubber caps, a charcoal frame of oval tube, a polished flywheel at the front under a black
      // guard, a silver handlebar post with a multi-position bar and a small console, a slider seat post with its red pop pins, a narrow saddle
      for (const zz of [z0 + 0.04, z1 - 0.04]) {
        rtube(parts, 'spin-feet', FRAME, [-x1 + 0.03, 0.035, zz], [x1 - 0.03, 0.035, zz], 0.06, 0.07, 0.02);
        for (const s2 of [-1, 1]) parts.box('spin-feet-caps', RUBBER, s2 > 0 ? x1 - 0.05 : -x1, s2 > 0 ? x1 : -x1 + 0.05, 0, 0.06, zz - 0.035, zz + 0.035, { c: 0.008 });
      }
      const bb: [number, number, number] = [0, 0.33, z0 + 0.62]; // the bottom bracket (crank axle)
      const hp: [number, number, number] = [0, 0.74, z0 + 0.36]; // where the handlebar post meets the frame
      const sp: [number, number, number] = [0, 0.66, z1 - 0.42]; // the seat tube's top
      rtube(parts, 'spin-frame', FRAME, [0, 0.06, z0 + 0.06], hp, 0.06, 0.09, 0.025);
      rtube(parts, 'spin-frame', FRAME, [0, 0.06, z1 - 0.08], bb, 0.06, 0.08, 0.025);
      rtube(parts, 'spin-frame', FRAME, bb, sp, 0.055, 0.08, 0.025);
      rtube(parts, 'spin-frame', FRAME, hp, [0, 0.62, z0 + 0.62], 0.055, 0.08, 0.025);
      rtube(parts, 'spin-frame', FRAME, [0, 0.62, z0 + 0.62], bb, 0.055, 0.08, 0.025);
      // flywheel: a polished steel disc with a hub, under a black guard over its top half
      const fc: [number, number, number] = [0, 0.31, z0 + 0.3];
      const fr = 0.235;
      cylX(parts, 'spin-flywheel', CHROME, -0.022, 0.022, fc[1], fc[2], fr, Math.max(16, q.sides * 3));
      cylX(parts, 'spin-flywheel-hub', FRAME, -0.035, 0.035, fc[1], fc[2], 0.045, 12);
      const guard = new THREE.CylinderGeometry(fr + 0.02, fr + 0.02, 0.08, Math.max(12, q.sides * 2), 1, false, 0, Math.PI);
      guard.rotateZ(Math.PI / 2); guard.rotateX(Math.PI / 2 + 0.25); guard.translate(fc[0], fc[1], fc[2]);
      parts.put('spin-guard', SHROUD, guard);
      // chain guard from the crank to the flywheel, on the right
      rtube(parts, 'spin-chain-guard', SHROUD, [0.055, fc[1] + 0.01, fc[2] + 0.04], [0.055, bb[1], bb[2]], 0.02, 0.13, 0.04);
      // the handlebar post (silver insert in a charcoal sleeve), the bar, grips and the console
      rtube(parts, 'spin-post', FRAME_GREY, hp, [0, H - 0.07, z0 + 0.27], 0.045, 0.045, 0.012);
      knob(parts, [0, 0.86, z0 + 0.36], [0, 0.2, 1]);
      const by = H - 0.019;
      tubes(parts, 'spin-handlebar', FRAME, [[-0.2, by, z0 + 0.44], [-0.21, by, z0 + 0.24], [-0.12, by - 0.05, z0 + 0.17], [0.12, by - 0.05, z0 + 0.17], [0.21, by, z0 + 0.24], [0.2, by, z0 + 0.44]], 0.0145);
      for (const s2 of [-1, 1]) grip(parts, [s2 * 0.2, by, z0 + 0.43], [s2 * 0.208, by, z0 + 0.26], 0.018);
      grip(parts, [-0.11, by - 0.05, z0 + 0.17], [0.11, by - 0.05, z0 + 0.17], 0.017);
      consoleUnit(parts, 0, H - 0.075, z0 + 0.11, 0.14, 0.085, 0.03, 0.5, 'spin', H - 0.012);
      // resistance knob on the top tube, ahead of the rider
      cylY(parts, 'spin-resistance', ACCENT_RED, 0, z0 + 0.5, 0.72, 0.77, 0.028, 12);
      // seat post with a slider and the saddle
      rtube(parts, 'spin-seatpost', FRAME_GREY, sp, [0, S - 0.085, z1 - 0.4], 0.04, 0.04, 0.01);
      knob(parts, [0, 0.62, z1 - 0.38], [0, 0, 1]);
      rtube(parts, 'spin-slider', FRAME, [0, S - 0.075, z1 - 0.5], [0, S - 0.075, z1 - 0.3], 0.035, 0.03, 0.008);
      const sad = q.tier === 'low' ? new THREE.BoxGeometry(0.16, 0.06, 0.27) : softCushion(0.16, 0.06, 0.27, { r: 0.025, puff: 0.006, seg: q.tier === 'high' ? 3 : 2 });
      // narrow the nose: the front 60 % of the saddle tapers to a third of its width
      const sp2 = sad.getAttribute('position');
      for (let i = 0; i < sp2.count; i++) { const zz = sp2.getZ(i); const t = Math.max(0, Math.min(1, (-zz + 0.03) / 0.165)); sp2.setX(i, sp2.getX(i) * (1 - 0.62 * t)); }
      sad.computeVertexNormals();
      sad.translate(0, S - 0.03, z1 - 0.36);
      parts.put('spin-saddle', PAD_BLACK, sad, { tile: 0.22 });
      // cranks and pedals with toe cages
      cylX(parts, 'spin-crank', FRAME_GREY, -0.07, 0.07, bb[1], bb[2], 0.05, 16);
      const cr = 0.17, ang = 0.6;
      for (const s2 of [-1, 1]) {
        const ex = s2 * 0.1, ey = bb[1] + s2 * cr * Math.cos(ang), ez = bb[2] - s2 * cr * Math.sin(ang);
        rtube(parts, 'spin-crank-arms', FRAME, [s2 * 0.085, bb[1], bb[2]], [s2 * 0.085, ey, ez], 0.02, 0.035, 0.008, [1, 0, 0]);
        parts.box('spin-pedals', FRAME, s2 > 0 ? ex : ex - 0.1, s2 > 0 ? ex + 0.1 : ex, ey - 0.012, ey + 0.012, ez - 0.055, ez + 0.055, { c: 0.004 });
        tubes(parts, 'spin-toe-cages', RUBBER, [[ex + s2 * 0.01, ey + 0.01, ez - 0.04], [ex + s2 * 0.01, ey + 0.05, ez - 0.07], [ex + s2 * 0.09, ey + 0.05, ez - 0.07], [ex + s2 * 0.09, ey + 0.01, ez - 0.04]], 0.006);
      }
      // a bottle in its cage on the post
      cylY(parts, 'spin-bottle', { key: 'plastic', tint: '#D8DCE0' }, 0, z0 + 0.42, 0.8, 0.98, 0.035, 12);
    },

    recumbent: () => {
      // SPEC 16.17.3: the downloaded recumbent bike when it is here and fits the box
      if (wholeModel(parts, 'recumbent', { w, h: H, d })) return;
      // a low step-through frame, a bucket seat with a mesh back at the rear, pedals ahead of the walker, the console on a mast at the front
      slab(parts, 'rec-feet', FRAME, -x1, x1, 0.0, 0.05, z0, z0 + 0.08);
      slab(parts, 'rec-feet', FRAME, -x1, x1, 0.0, 0.05, z1 - 0.08, z1);
      tube(parts, 'rec-frame', FRAME, [0, 0.12, z0 + 0.04], [0, 0.12, z1 - 0.04], 0.04);
      parts.box('rec-shroud', SHROUD, -0.12, 0.12, 0.08, 0.44, z0 + 0.06, z0 + 0.46, { c: 0.01 });
      tube(parts, 'rec-mast', FRAME_GREY, [0, 0.4, z0 + 0.3], [0, H - 0.25, z0 + 0.2], 0.034, true);
      parts.box('rec-console', CONSOLE, -0.19, 0.19, H - 0.28, H, z0 + 0.04, z0 + 0.34, { c: 0.01 });
      slab(parts, 'rec-screen', SCREEN_GLASS, -0.15, 0.15, H - 0.24, H - 0.05, z0 + 0.34, z0 + 0.344);
      // the seat: a base pad and a tall back, on a rail that slides
      pad(parts, 'rec-seat', PAD_BLACK, -0.24, 0.24, S - 0.09, S, z1 - 0.7, z1 - 0.32, 0.04);
      const back = new THREE.BoxGeometry(0.46, 0.5, 0.07);
      back.rotateX(-0.28);
      back.translate(0, S + 0.2, z1 - 0.2);
      parts.put('rec-seat-back', PAD_BLACK, back);
      tube(parts, 'rec-seat-frame', FRAME, [0, 0.12, z1 - 0.45], [0, S - 0.09, z1 - 0.5], 0.03);
      // side arms with a grip each, and cranks at the front
      for (const s of [-1, 1]) {
        tubes(parts, 'rec-arms', FRAME_GREY, [[s * 0.3, S - 0.02, z1 - 0.42], [s * 0.3, S + 0.2, z1 - 0.6], [s * 0.3, S + 0.2, z1 - 0.8]], 0.019);
        grip(parts, [s * 0.3, S + 0.2, z1 - 0.64], [s * 0.3, S + 0.2, z1 - 0.78], 0.022);
        tube(parts, 'rec-crank-arms', CHROME, [s * 0.16, 0.36, z0 + 0.5], [s * 0.16, 0.36 + 0.17 * s, z0 + 0.5 - 0.05 * s], 0.012);
        parts.box('rec-pedals', RUBBER, s > 0 ? 0.14 : -0.24, s > 0 ? 0.24 : -0.14, 0.36 + 0.17 * s - 0.02, 0.36 + 0.17 * s + 0.02, z0 + 0.4 - 0.05 * s, z0 + 0.6 - 0.05 * s, { c: 0.004 });
      }
      cylX(parts, 'rec-crank', CHROME, -0.16, 0.16, 0.36, z0 + 0.5, 0.025, 8);
    },

    rower: () => {
      // an air rower: a flywheel cage at the back, a long monorail on legs, the seat on the rail, foot boards and the handle on its chain
      const rail = 0.05;
      parts.box('rower-rail', FRAME_GREY, -rail, rail, 0.26, 0.34, z0 + 0.34, z1, { c: 0.008 });
      for (const [zz, ww] of [[z0 + 0.5, x1], [z1 - 0.1, x1 - 0.04]] as const) {
        slab(parts, 'rower-feet', FRAME, -ww, ww, 0.0, 0.05, zz - 0.05, zz + 0.05);
        for (const s of [-1, 1]) tube(parts, 'rower-legs', FRAME, [s * ww * 0.9, 0.04, zz], [s * rail * 1.1, 0.3, zz], 0.022);
      }
      // the flywheel and its cage (the fan the rower is named for), then the monitor on an arm
      cylX(parts, 'rower-cage', FRAME, -0.095, 0.095, 0.3, z0 + 0.22, 0.22, Math.max(12, q.sides * 3));
      cylX(parts, 'rower-cage-rim', SHROUD, -0.1, 0.1, 0.3, z0 + 0.22, 0.2, Math.max(12, q.sides * 3));
      parts.box('rower-housing', SHROUD, -0.085, 0.085, 0.08, 0.3, z0 + 0.04, z0 + 0.42, { c: 0.008 });
      tube(parts, 'rower-monitor-arm', FRAME_GREY, [0, 0.4, z0 + 0.34], [0, H - 0.1, z0 + 0.2], 0.022, true);
      parts.box('rower-monitor', CONSOLE, -0.1, 0.1, H - 0.2, H, z0 + 0.06, z0 + 0.32, { c: 0.008 });
      slab(parts, 'rower-screen', SCREEN_GLASS, -0.08, 0.08, H - 0.17, H - 0.04, z0 + 0.32, z0 + 0.324);
      // foot boards, tilted, with straps
      for (const s of [-1, 1]) {
        const board = new THREE.BoxGeometry(0.14, 0.02, 0.3);
        board.rotateX(0.7);
        board.translate(s * 0.15, 0.32, z0 + 0.68);
        parts.put('rower-footboards', SHROUD, board);
        tube(parts, 'rower-straps', RUBBER, [s * 0.15 - 0.06, 0.4, z0 + 0.64], [s * 0.15 + 0.06, 0.4, z0 + 0.64], 0.01);
      }
      // the seat on its rail, pulled back to the catch; wheels run on the rail
      pad(parts, 'rower-seat', PAD_BLACK, -0.15, 0.15, S - 0.045, S, z1 - 1.0, z1 - 0.62, 0.025);
      slab(parts, 'rower-seat-carriage', FRAME, -0.09, 0.09, 0.3, S - 0.045, z1 - 0.95, z1 - 0.68);
      // the handle and its chain, taut to the flywheel
      cable(parts, [[0, 0.3, z0 + 0.44], [0, 0.34, z1 - 1.5]]);
      tube(parts, 'rower-handle', CHROME, [-0.22, 0.36, z1 - 1.5], [0.22, 0.36, z1 - 1.5], 0.014);
      grip(parts, [-0.17, 0.36, z1 - 1.5], [0.17, 0.36, z1 - 1.5], 0.017);
    },

    stair: () => {
      // a step mill: a low base plate, a tall rear housing that carries the console, two big step platforms on arms that reach out from it (one up, one down
      // in the stride), side handrails that sweep back to the housing
      slab(parts, 'stair-base', FRAME, -x1, x1, 0.0, 0.08, z0, z1);
      parts.box('stair-feet', RUBBER, -x1, x1, 0.0, 0.03, z1 - 0.12, z1, { c: 0.004 });
      parts.box('stair-housing', SHROUD, -x1 + 0.1, x1 - 0.1, 0.08, 1.3, z0, z0 + 0.62, { c: 0.012 });
      parts.box('stair-housing-top', SHROUD_LIGHT, -x1 + 0.16, x1 - 0.16, 1.3, 1.42, z0 + 0.04, z0 + 0.56, { c: 0.008 });
      slab(parts, 'stair-vent', FRAME, -0.2, 0.2, 0.3, 0.9, z0 + 0.62, z0 + 0.625);
      tube(parts, 'stair-mast', FRAME_GREY, [0, 1.4, z0 + 0.3], [0, H - 0.2, z0 + 0.24], 0.05, true);
      parts.box('stair-console', CONSOLE, -0.27, 0.27, H - 0.36, H, z0, z0 + 0.3, { c: 0.012 });
      slab(parts, 'stair-screen', SCREEN_GLASS, -0.22, 0.22, H - 0.32, H - 0.06, z0 + 0.3, z0 + 0.304);
      slab(parts, 'stair-keys', SHROUD_LIGHT, -0.22, 0.22, H - 0.05, H - 0.01, z0 + 0.14, z0 + 0.3);
      // the two step arms, one high and one low, each ending in a platform
      for (const [i, s] of [-1, 1].entries()) {
        const py = i === 0 ? 0.34 : 0.52;
        const px = s * 0.2;
        for (const e of [-1, 1]) tube(parts, 'stair-arms', FRAME_GREY, [px + e * 0.12, py + 0.1, z0 + 0.55], [px + e * 0.12, py, z1 - 0.62], 0.024);
        parts.box('stair-pedals', FRAME, px - 0.19, px + 0.19, py - 0.035, py + 0.02, z1 - 0.7, z1 - 0.12, { c: 0.01 });
        slab(parts, 'stair-pedal-pads', RUBBER, px - 0.17, px + 0.17, py + 0.02, py + 0.028, z1 - 0.68, z1 - 0.14);
      }
      for (const s of [-1, 1]) {
        tubes(parts, 'stair-handrails', FRAME_GREY, [[s * (x1 - 0.06), 0.9, z0 + 0.5], [s * (x1 - 0.06), 1.08, z0 + 0.95], [s * (x1 - 0.06), 1.1, z1 - 0.55]], 0.02);
        tube(parts, 'stair-uprights', FRAME_GREY, [s * (x1 - 0.06), 0.08, z1 - 0.5], [s * (x1 - 0.06), 1.1, z1 - 0.55], 0.024, true);
        grip(parts, [s * (x1 - 0.06), 1.1, z1 - 0.9], [s * (x1 - 0.06), 1.1, z1 - 0.55], 0.024);
      }
      tube(parts, 'stair-handrails', FRAME_GREY, [-(x1 - 0.06), 1.1, z1 - 0.55], [x1 - 0.06, 1.1, z1 - 0.55], 0.02);
    },
  };
  build[v]();
  const g = parts.done();
  if (v === 'treadmill') {
    const motion: MachineMotion = { kind: 'belt', mesh: 'tread-belt-ribs', pitchM: 0.12, axis: 'z', speedMps: 1.0 };
    g.userData.motion = motion;
  }
  void ACCENT_RED; void cylY; void cylZ;
  return g;
}

function cable(p: Parts, pts: [number, number, number][]): void {
  for (let i = 0; i + 1 < pts.length; i++) tube(p, 'rower-chain', CHROME, pts[i], pts[i + 1], 0.005);
}
