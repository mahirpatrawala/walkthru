// Cardio machines at commercial size (SPEC 16.17): treadmill, cross trainer, upright bike, spin bike, recumbent bike, rower, stair climber.
// Every machine has its BACK (the console, the mast, the flywheel) at -z and its open end, where you step on, at +z. The footprint and height
// are exactly the item's. The treadmill's belt ribs are their own mesh (`tread-belt-ribs`) so a walker on it can run them
// (`group.userData.motion`, src/buyer/machine-motion.ts); at rest they sit still like any part.
import * as THREE from 'three';
import { Parts } from './core';
import type { GenEnv, GenSize, Roles } from './core';
import { ACCENT_RED, CHROME, CONSOLE, FRAME, FRAME_GREY, PAD_BLACK, RUBBER, SCREEN_GLASS, SHROUD, SHROUD_LIGHT, cylX, cylY, cylZ, grip, pad, slab, tube, tubes } from './gymkit';

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
      // deck frame, two foot rails, the belt and its ribs; the motor hood and console stand at the back
      const deckT = 0.1, deckB = S - 0.05;
      slab(parts, 'tread-frame', FRAME, -x1, x1, 0.06, 0.12, z0 + 0.52, z1);
      for (const s of [-1, 1]) {
        const xa = s > 0 ? 0.285 : -x1, xb = s > 0 ? x1 : -0.285;
        parts.box('tread-rails', SHROUD, xa, xb, deckT, S, z0 + 0.5, z1, { c: 0.006 });
      }
      parts.box('tread-belt', RUBBER, -0.285, 0.285, deckT + 0.04, S - 0.015, z0 + 0.5, z1 - 0.04, { c: 0.002 });
      // belt ribs: lighter transverse bars that slide when the belt runs; none within one pitch of the ends so the slide stays inside the deck
      const pitch = 0.12;
      const zr0 = z0 + 0.62, zr1 = z1 - 0.2;
      const nRib = Math.floor((zr1 - zr0) / pitch);
      for (let i = 0; i < nRib; i++) {
        const z = zr0 + i * pitch;
        parts.put('tread-belt-ribs', { key: 'laminate', tint: '#505459' }, new THREE.BoxGeometry(0.5, 0.004, 0.028).translate(0, S - 0.013, z));
      }
      // the rear roller cover and the end rail
      parts.box('tread-rails', SHROUD, -x1, x1, deckT, S, z1 - 0.06, z1, { c: 0.006 });
      slab(parts, 'tread-feet', RUBBER, -x1, -x1 + 0.1, 0, 0.06, z1 - 0.22, z1);
      slab(parts, 'tread-feet', RUBBER, x1 - 0.1, x1, 0, 0.06, z1 - 0.22, z1);
      slab(parts, 'tread-feet', RUBBER, -x1, -x1 + 0.1, 0, 0.06, z0, z0 + 0.4);
      slab(parts, 'tread-feet', RUBBER, x1 - 0.1, x1, 0, 0.06, z0, z0 + 0.4);
      // motor hood: a deep casing across the whole width at the back, its top sloping down toward the belt
      parts.box('tread-hood', SHROUD, -x1, x1, 0.06, 0.42, z0, z0 + 0.5, { c: 0.01 });
      parts.box('tread-hood', SHROUD_LIGHT, -x1 + 0.04, x1 - 0.04, 0.42, 0.5, z0 + 0.04, z0 + 0.44, { c: 0.006 });
      // uprights lean toward the walker; the console is carried on them
      for (const s of [-1, 1]) {
        const x = s * (x1 - 0.06);
        tube(parts, 'tread-uprights', FRAME_GREY, [x, 0.42, z0 + 0.16], [x, H - 0.34, z0 + 0.1], 0.026, true);
        tubes(parts, 'tread-handrails', FRAME_GREY, [[x, 1.02, z0 + 0.14], [x, 1.0, z0 + 0.5], [x, 0.98, z0 + 0.78], [x, 0.96, z0 + 0.82]], 0.019);
        grip(parts, [x, 1.0, z0 + 0.5], [x, 0.98, z0 + 0.78], 0.024);
      }
      tube(parts, 'tread-handrails', FRAME_GREY, [-x1 + 0.06, 1.2, z0 + 0.1], [x1 - 0.06, 1.2, z0 + 0.1], 0.02);
      // console: a wide housing with a screen, key pad and a tray for a phone
      const cy0 = H - 0.4;
      parts.box('tread-console', CONSOLE, -x1 + 0.06, x1 - 0.06, cy0, H, z0, z0 + 0.3, { c: 0.012 });
      slab(parts, 'tread-screen', SCREEN_GLASS, -0.19, 0.19, cy0 + 0.1, H - 0.05, z0 + 0.3, z0 + 0.304);
      slab(parts, 'tread-keys', SHROUD_LIGHT, -0.19, 0.19, cy0 + 0.02, cy0 + 0.08, z0 + 0.3, z0 + 0.304);
      for (const s of [-1, 1]) cylX(parts, 'tread-bottle-holders', SHROUD_LIGHT, s * 0.27 - 0.03, s * 0.27 + 0.03, cy0 - 0.02, z0 + 0.18, 0.045);
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
      // a studio bike: a big flywheel at the front, a single sloping frame, saddle and handlebars both adjustable
      slab(parts, 'spin-feet', FRAME, -x1, x1, 0.0, 0.045, z0, z0 + 0.06);
      slab(parts, 'spin-feet', FRAME, -x1, x1, 0.0, 0.045, z1 - 0.06, z1);
      cylX(parts, 'spin-flywheel', ACCENT_RED, -0.025, 0.025, 0.36, z0 + 0.34, 0.27, Math.max(12, q.sides * 3));
      parts.box('spin-guard', SHROUD, -0.045, 0.045, 0.1, 0.62, z0 + 0.1, z0 + 0.56, { c: 0.01 });
      tube(parts, 'spin-frame', FRAME, [0, 0.05, z0 + 0.04], [0, 0.62, z0 + 0.3], 0.034);
      tube(parts, 'spin-frame', FRAME, [0, 0.62, z0 + 0.3], [0, 0.6, z1 - 0.42], 0.032);
      tube(parts, 'spin-frame', FRAME, [0, 0.05, z1 - 0.04], [0, 0.6, z1 - 0.42], 0.03);
      tube(parts, 'spin-seatpost', CHROME, [0, 0.62, z1 - 0.42], [0, S - 0.05, z1 - 0.36], 0.019, true);
      pad(parts, 'spin-saddle', PAD_BLACK, -0.075, 0.075, S - 0.07, S, z1 - 0.58, z1 - 0.18, 0.03);
      tube(parts, 'spin-stem', CHROME, [0, 0.62, z0 + 0.3], [0, H - 0.1, z0 + 0.2], 0.02, true);
      tubes(parts, 'spin-handlebar', FRAME_GREY, [[-0.19, H - 0.12, z0 + 0.3], [-0.19, H - 0.017, z0 + 0.14], [0.19, H - 0.017, z0 + 0.14], [0.19, H - 0.12, z0 + 0.3]], 0.017);
      tube(parts, 'spin-handlebar', FRAME_GREY, [0, H - 0.017, z0 + 0.14], [0, H - 0.1, z0 + 0.2], 0.017);
      grip(parts, [-0.19, H - 0.1, z0 + 0.24], [-0.19, H - 0.14, z0 + 0.3], 0.02);
      grip(parts, [0.19, H - 0.1, z0 + 0.24], [0.19, H - 0.14, z0 + 0.3], 0.02);
      cylX(parts, 'spin-crank', CHROME, -0.12, 0.12, 0.3, z0 + 0.44, 0.022, 8);
      for (const s of [-1, 1]) {
        tube(parts, 'spin-crank-arms', CHROME, [s * 0.12, 0.3, z0 + 0.44], [s * 0.12, 0.3 + 0.17 * s, z0 + 0.44 - 0.04 * s], 0.012);
        parts.box('spin-pedals', FRAME_GREY, s > 0 ? 0.1 : -0.2, s > 0 ? 0.2 : -0.1, 0.3 + 0.17 * s - 0.02, 0.3 + 0.17 * s + 0.02, z0 + 0.4 - 0.04 * s, z0 + 0.56 - 0.04 * s, { c: 0.004 });
      }
    },

    recumbent: () => {
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
      // a step mill: a tall base housing, two large pedals on arms, a mast with the console, side rails
      parts.box('stair-base', SHROUD, -x1, x1, 0.0, 0.22, z0, z1, { c: 0.012 });
      parts.box('stair-base-top', SHROUD_LIGHT, -x1 + 0.1, x1 - 0.1, 0.22, 0.3, z0 + 0.2, z1 - 0.1, { c: 0.01 });
      for (const [i, s] of [-1, 1].entries()) {
        const up = i === 0 ? 0.0 : 0.17;
        parts.box('stair-pedals', FRAME, s * 0.205 - 0.17, s * 0.205 + 0.17, S - 0.03 + up, S + up, z0 + 0.7, z1 - 0.05, { c: 0.01 });
        slab(parts, 'stair-pedal-pads', RUBBER, s * 0.205 - 0.15, s * 0.205 + 0.15, S + up, S + up + 0.008, z0 + 0.74, z1 - 0.09);
      }
      for (const s of [-1, 1]) {
        tube(parts, 'stair-uprights', FRAME_GREY, [s * (x1 - 0.08), 0.28, z0 + 0.14], [s * (x1 - 0.08), 1.25, z0 + 0.14], 0.03, true);
        tubes(parts, 'stair-handrails', FRAME_GREY, [[s * (x1 - 0.08), 1.2, z0 + 0.14], [s * (x1 - 0.08), 1.14, z0 + 0.7], [s * (x1 - 0.08), 1.0, z0 + 0.95]], 0.02);
        grip(parts, [s * (x1 - 0.08), 1.14, z0 + 0.5], [s * (x1 - 0.08), 1.05, z0 + 0.88], 0.024);
      }
      tube(parts, 'stair-mast', FRAME_GREY, [0, 0.28, z0 + 0.2], [0, H - 0.3, z0 + 0.14], 0.045, true);
      parts.box('stair-console', CONSOLE, -0.27, 0.27, H - 0.36, H, z0, z0 + 0.3, { c: 0.012 });
      slab(parts, 'stair-screen', SCREEN_GLASS, -0.22, 0.22, H - 0.32, H - 0.06, z0 + 0.3, z0 + 0.304);
      slab(parts, 'stair-keys', SHROUD_LIGHT, -0.22, 0.22, H - 0.05, H - 0.01, z0 + 0.14, z0 + 0.3);
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
