// Free weights at commercial size (SPEC 16.17): flat, incline and adjustable benches, an Olympic bench press, a power rack, a two-tier dumbbell
// rack with ten pairs from 2.5 to 25 kg (every dumbbell drawn, its head sized by its weight), a plate tree, a kettlebell rack and a preacher
// curl. A bench's head end is its back, like a bed. The bar of a rack or a bench press is the full 2.2 m of an Olympic bar and is part of the footprint.
import * as THREE from 'three';
import { Parts } from './core';
import type { GenEnv, GenSize, Roles } from './core';
import { ACCENT_RED, CHROME, FRAME, FRAME_GREY, IRON, LABEL, PAD_BLACK, RUBBER, SHROUD, WOOD_ASH, cylX, dumbbell, dumbbellLength, dumbbellRadius, grip, kettlebell, knob, noteProp, pad, plateDisc, rtube, slab, tube, tubes } from './gymkit';
import { propGeo } from '../gym/props';

export const FREEW_VARIANTS = ['bench-flat', 'bench-incline', 'bench-adjust', 'bench-press', 'rack', 'dumbbells', 'plate-tree', 'kettlebells', 'preacher'] as const;
export type FreeWVariant = (typeof FREEW_VARIANTS)[number];
export interface FreeWParams { variant: FreeWVariant }
export const FREEW_DEFAULTS: FreeWParams = { variant: 'bench-flat' };

/** the ten pairs of a commercial rack, 2.5 to 25 kg in 2.5 kg steps */
export const DUMBBELL_PAIRS_KG = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25] as const;
/** a kettlebell rack's eight bells */
export const KETTLEBELLS_KG = [4, 8, 12, 16, 20, 24, 28, 32] as const;

const kbRadius = (kg: number): number => 0.075 + 0.0015 * kg;
/** a kettlebell's height by its weight (a 16 kg competition bell is about 24 cm tall) */
const kbHeight = (kg: number): number => 2.4 * kbRadius(kg);

export function buildFreeWeights(env: GenEnv, size: GenSize, p: FreeWParams, _roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (FREEW_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'bench-flat';
  const parts = new Parts(env, `gen:freew`);
  const x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const q = env.q;

  /** a flat bench's frame and pad: two cross feet, a central beam, uprights; the pad top at `top` */
  const benchBase = (zA: number, zB: number, top: number, feetW: number): void => {
    for (const z of [zA + 0.06, zB - 0.06]) {
      slab(parts, 'bench-feet', FRAME, -feetW, feetW, 0, 0.05, z - 0.04, z + 0.04);
      tube(parts, 'bench-posts', FRAME, [0, 0.05, z], [0, top - 0.09, z], 0.03);
    }
    slab(parts, 'bench-beam', FRAME, -0.04, 0.04, top - 0.13, top - 0.09, zA + 0.02, zB - 0.02);
  };

  const build: Record<string, () => void> = {
    'bench-flat': () => {
      benchBase(z0, z1, S, x1);
      pad(parts, 'bench-pad', PAD_BLACK, -0.15, 0.15, S - 0.08, S, z0, z1, 0.035);
      // the pad's underside plate
      slab(parts, 'bench-beam', FRAME, -0.13, 0.13, S - 0.1, S - 0.08, z0 + 0.03, z1 - 0.03);
    },
    'bench-incline': () => {
      // a fixed 30 degree back rest rising toward the back, a seat that tilts up at the front; a foot rest roller at the front
      const zs = z0 + 0.62;
      pad(parts, 'bench-seat', PAD_BLACK, -0.15, 0.15, S - 0.08, S, zs, z1 - 0.1, 0.035);
      const back = new THREE.BoxGeometry(0.3, 0.08, 0.78);
      back.rotateX(0.52);
      back.translate(0, S + 0.28, z0 + 0.4);
      parts.put('bench-back', PAD_BLACK, back, { tile: 0.4 });
      slab(parts, 'bench-feet', FRAME, -x1, x1, 0, 0.05, z0, z0 + 0.08);
      slab(parts, 'bench-feet', FRAME, -x1, x1, 0, 0.05, z1 - 0.08, z1);
      tube(parts, 'bench-posts', FRAME, [0, 0.05, z1 - 0.2], [0, S - 0.09, z1 - 0.2], 0.03);
      tube(parts, 'bench-posts', FRAME, [0, 0.05, z0 + 0.04], [0, H - 0.004, z0 + 0.1], 0.03);
      tube(parts, 'bench-posts', FRAME, [0, 0.05, z0 + 0.9], [0, S - 0.09, z0 + 0.9], 0.03);
      slab(parts, 'bench-beam', FRAME, -0.04, 0.04, S - 0.13, S - 0.09, zs - 0.1, z1 - 0.1);
      for (const s of [-1, 1]) tube(parts, 'bench-foot-rest', FRAME_GREY, [s * 0.2, S - 0.06, z1 - 0.2], [s * 0.2, 0.28, z1 - 0.06], 0.017);
    },
    'bench-adjust': () => {
      // an adjustable bench: a tilted back on a ratchet, a seat that steps, transport wheels at the back
      const zs = z0 + 0.6;
      pad(parts, 'bench-seat', PAD_BLACK, -0.16, 0.16, S - 0.08, S, zs, z1 - 0.1, 0.035);
      const back = new THREE.BoxGeometry(0.32, 0.08, 0.85);
      back.rotateX(0.78);
      back.translate(0, S + 0.34, z0 + 0.34);
      parts.put('bench-back', PAD_BLACK, back, { tile: 0.4 });
      slab(parts, 'bench-feet', FRAME, -x1, x1, 0, 0.05, z0, z0 + 0.08);
      slab(parts, 'bench-feet', FRAME, -x1, x1, 0, 0.05, z1 - 0.08, z1);
      tube(parts, 'bench-posts', FRAME, [0, 0.05, z1 - 0.2], [0, S - 0.09, z1 - 0.2], 0.03);
      tube(parts, 'bench-posts', FRAME, [0, 0.05, z0 + 0.04], [0, H - 0.004, z0 + 0.12], 0.03);
      slab(parts, 'bench-beam', FRAME, -0.04, 0.04, S - 0.13, S - 0.09, zs - 0.15, z1 - 0.1);
      // the ratchet bar under the back rest, with its notches
      tube(parts, 'bench-ratchet', FRAME_GREY, [0, S - 0.1, z0 + 0.55], [0, S + 0.3, z0 + 0.25], 0.014);
      for (let i = 0; i < 5; i++) slab(parts, 'bench-ratchet', ACCENT_RED, -0.012, 0.012, S + 0.02 + i * 0.05, S + 0.03 + i * 0.05, z0 + 0.5 - i * 0.05, z0 + 0.53 - i * 0.05);
      for (const s of [-1, 1]) cylX(parts, 'bench-wheels', FRAME_GREY, s * (x1 - 0.1) - 0.02, s * (x1 - 0.1) + 0.02, 0.04, z0 + 0.09, 0.04, 8);
      for (const s of [-1, 1]) tube(parts, 'bench-foot-rest', FRAME_GREY, [s * 0.2, S - 0.06, z1 - 0.2], [s * 0.2, 0.28, z1 - 0.06], 0.017);
    },
    'bench-press': () => {
      // Olympic flat bench with the uprights at the head end: J hooks, a 2.2 m bar, two 20 kg plates a side, a safety catch each side, an extended foot
      const ux = 0.55;
      const benchZ0 = z0 + 0.12;
      pad(parts, 'bp-pad', PAD_BLACK, -0.15, 0.15, S - 0.08, S, benchZ0, z1 - 0.1, 0.035);
      slab(parts, 'bp-frame', FRAME, -0.06, 0.06, S - 0.15, S - 0.08, benchZ0, z1 - 0.1);
      // base: a wide foot at the head under the uprights, a wide foot at the bench's end
      slab(parts, 'bp-feet', FRAME, -0.5, 0.5, 0, 0.06, z0, z0 + 0.1);
      slab(parts, 'bp-feet', FRAME, -0.35, 0.35, 0, 0.06, z1 - 0.1, z1);
      slab(parts, 'bp-feet', FRAME, -0.04, 0.04, 0, 0.06, z0 + 0.1, z1 - 0.1);
      tube(parts, 'bp-posts', FRAME, [0, 0.06, z1 - 0.25], [0, S - 0.15, z1 - 0.25], 0.035);
      for (const s of [-1, 1]) {
        slab(parts, 'bp-uprights', FRAME, s * ux - 0.04, s * ux + 0.04, 0.06, H, z0 + 0.04, z0 + 0.12);
        slab(parts, 'bp-uprights', FRAME, s * ux - 0.04, s * ux + 0.04, 0, 0.06, z0 + 0.12, z0 + 0.3);
        slab(parts, 'bp-hooks', FRAME_GREY, s * ux - 0.035, s * ux + 0.035, 1.07, 1.09, z0 + 0.12, z0 + 0.5);
        slab(parts, 'bp-hooks', FRAME_GREY, s * ux - 0.035, s * ux + 0.035, 1.07, 1.14, z0 + 0.45, z0 + 0.5);
        // safety catches at chest height
        slab(parts, 'bp-safeties', ACCENT_RED, s * ux - 0.03, s * ux + 0.03, 0.62, 0.65, z0 + 0.12, z0 + 0.8);
        slab(parts, 'bp-safeties', ACCENT_RED, s * ux - 0.03, s * ux + 0.03, 0.62, 0.9, z0 + 0.77, z0 + 0.8);
      }
      slab(parts, 'bp-crossbar', FRAME, -ux, ux, H - 0.1, H, z0 + 0.04, z0 + 0.12);
      // the bar, 2.2 m with sleeves and collars, and two 20 kg plates a side
      const bz = z0 + 0.475, by = 1.12;
      tube(parts, 'bp-bar', CHROME, [-x1, by, bz], [x1, by, bz], 0.014, true);
      for (const s of [-1, 1]) {
        cylX(parts, 'bp-sleeves', CHROME, s > 0 ? 0.62 : -x1, s > 0 ? x1 : -0.62, by, bz, 0.025, 10);
        for (let i = 0; i < 2; i++) plateDisc(parts, s * (0.72 + i * 0.05), by, bz, 0.225, 0.045);
        cylX(parts, 'bp-collars', ACCENT_RED, s * 0.88 - 0.015, s * 0.88 + 0.015, by, bz, 0.04, 8);
      }
      grip(parts, [-0.45, by, bz], [-0.25, by, bz], 0.016);
      grip(parts, [0.25, by, bz], [0.45, by, bz], 0.016);
    },
    rack: () => {
      // power rack: four uprights, a top frame with a pull-up bar, J hooks, a 2.2 m bar, two plates a side, safety bars, plate horns on the uprights
      const ux = 0.62, uzF = z1 - 0.225, uzB = z0 + 0.045, uz = uzF;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const zc = sz > 0 ? uzF : uzB;
        slab(parts, 'rack-uprights', FRAME, sx * ux - 0.045, sx * ux + 0.045, 0, H - 0.0, zc - 0.045, zc + 0.045);
        // holes down the front uprights
        if (sz > 0) for (let y = 0.3; y < 2.1; y += 0.14) slab(parts, 'rack-holes', FRAME_GREY, sx * ux - 0.02, sx * ux + 0.02, y, y + 0.025, zc + 0.045, zc + 0.048);
      }
      for (const sx of [-1, 1]) { slab(parts, 'rack-rails', FRAME, sx * ux - 0.04, sx * ux + 0.04, 0, 0.1, uzB, uzF); slab(parts, 'rack-rails', FRAME, sx * ux - 0.04, sx * ux + 0.04, H - 0.12, H, uzB, uzF); }
      for (const zc of [uzB, uzF]) slab(parts, 'rack-rails', FRAME, -ux, ux, H - 0.12, H, zc - 0.04, zc + 0.04);
      slab(parts, 'rack-rails', FRAME, -ux, ux, 0, 0.1, uzB - 0.04, uzB + 0.04);
      // pull-up bar across the front, and the bar on its hooks
      tube(parts, 'rack-pullup', CHROME, [-ux, H - 0.2, uzF], [ux, H - 0.2, uzF], 0.018);
      const by = 1.3, bz = uzF + 0.0;
      for (const s of [-1, 1]) {
        slab(parts, 'rack-hooks', ACCENT_RED, s * ux - 0.04, s * ux + 0.04, by - 0.03, by, uzF - 0.14, uzF);
        slab(parts, 'rack-hooks', ACCENT_RED, s * ux - 0.04, s * ux + 0.04, by - 0.03, by + 0.05, uzF - 0.14, uzF - 0.1);
        slab(parts, 'rack-safeties', FRAME_GREY, s * ux - 0.03, s * ux + 0.03, 0.62, 0.66, uzB, uzF);
      }
      tube(parts, 'rack-bar', CHROME, [-x1, by + 0.02, bz], [x1, by + 0.02, bz], 0.014, true);
      for (const s of [-1, 1]) {
        cylX(parts, 'rack-sleeves', CHROME, s > 0 ? 0.62 : -x1, s > 0 ? x1 : -0.62, by + 0.02, bz, 0.025, 10);
        for (let i = 0; i < 2; i++) plateDisc(parts, s * (0.7 + i * 0.05), by + 0.02, bz, 0.225, 0.045);
        // plate horns on the outside of the rear uprights, with a plate each
        tube(parts, 'rack-horns', FRAME_GREY, [s * (ux + 0.04), 0.7, uzB + 0.3], [s * (ux + 0.2), 0.7, uzB + 0.3], 0.022);
        plateDisc(parts, s * (ux + 0.1), 0.7, uzB + 0.3, 0.2, 0.04);
      }
    },
    dumbbells: () => {
      // a commercial two-tier saddle rack: charcoal end frames and a middle frame of rectangular tube, each tier two rails with a moulded tray between
      // them, tilted a little toward the walker; ten pairs of hex dumbbells (the downloaded model when it is here), the heavy ones below
      const model = propGeo('dumbbell', q.tier);
      noteProp(parts, 'dumbbell', !!model);
      const tiers: { y: number; kgs: readonly number[] }[] = [{ y: 0.3, kgs: DUMBBELL_PAIRS_KG.slice(5) }, { y: S, kgs: DUMBBELL_PAIRS_KG.slice(0, 5) }];
      const tilt = 0.06; // the back rail of a tier stands this much higher than the front
      for (const fx of [-x1 + 0.035, 0, x1 - 0.035]) {
        rtube(parts, 'dbrack-frame', FRAME, [fx, 0.03, z0 + 0.03], [fx, 0.03, z1 - 0.03], 0.07, 0.06, 0.012);
        rtube(parts, 'dbrack-frame', FRAME, [fx, 0.04, z1 - 0.09], [fx, S - 0.04, z1 - 0.1], 0.07, 0.05, 0.012);
        rtube(parts, 'dbrack-frame', FRAME, [fx, 0.04, z0 + 0.07], [fx, H - 0.06, z0 + 0.07], 0.07, 0.05, 0.012);
        for (const t of tiers) rtube(parts, 'dbrack-frame', FRAME, [fx, t.y - 0.05, z1 - 0.1], [fx, t.y - 0.05 + tilt, z0 + 0.07], 0.07, 0.05, 0.012);
        for (const zz of [z0 + 0.03, z1 - 0.03]) parts.box('dbrack-feet', RUBBER, fx - 0.035, fx + 0.035, 0, 0.006, zz - 0.03, zz + 0.03, { c: 0.002 });
      }
      rtube(parts, 'dbrack-top', FRAME, [-x1 + 0.005, H - 0.03, z0 + 0.07], [x1 - 0.005, H - 0.03, z0 + 0.07], 0.07, 0.06, 0.012);
      const spacing = (w - 0.2) / 10;
      for (const t of tiers) {
        for (const [zz, dy] of [[z1 - 0.1, 0], [z0 + 0.1, tilt * 0.92]] as const) rtube(parts, 'dbrack-rails', FRAME, [-x1 + 0.005, t.y - 0.02 + dy, zz], [x1 - 0.005, t.y - 0.02 + dy, zz], 0.05, 0.04, 0.01);
        // the moulded tray the heads rest in, between the rails
        const tray = new THREE.BoxGeometry(w - 0.1, 0.012, d - 0.22);
        tray.rotateX(-Math.atan2(tilt * 0.92, d - 0.2));
        tray.translate(0, t.y - 0.01 + tilt * 0.46, 0);
        parts.put('dbrack-trays', SHROUD, tray);
        let i = 0;
        for (const kg of t.kgs) for (let k = 0; k < 2; k++) {
          const x = -x1 + 0.1 + spacing * (i + 0.5);
          dumbbell(parts, x, t.y + dumbbellRadius(kg) + tilt * 0.46, 0, kg, 'z', 'dumbbells', model);
          i++;
        }
        // a white weight label under each pair, on the front rail
        t.kgs.forEach((_, j) => { const x = -x1 + 0.1 + spacing * (j * 2 + 1); slab(parts, 'dbrack-labels', LABEL, x - 0.03, x + 0.03, t.y - 0.035, t.y - 0.012, z1 - 0.075, z1 - 0.073); });
      }
      void dumbbellLength;
    },
    'plate-tree': () => {
      // a central column with two rows of horns, a plate on most of them (45, 25, 20, 10, 5 and 2.5 lb sizes: here 20, 15, 10, 5, 2.5 kg)
      const r0 = 0.45 / 2;
      slab(parts, 'tree-base', FRAME, -x1, x1, 0, 0.06, z0, z1);
      tube(parts, 'tree-column', FRAME, [0, 0.06, 0], [0, H - 0.03, 0], 0.05, true);
      const horns: [number, number, number, number][] = [
        [-1, 0.3, 0.225, 0.045], [1, 0.3, 0.225, 0.045], [-1, 0.62, 0.18, 0.035], [1, 0.62, 0.15, 0.03], [-1, 0.92, 0.13, 0.025], [1, 0.92, 0.1, 0.02], [-1, 1.2, 0.09, 0.02],
      ];
      for (const [s, y, r, th] of horns) {
        tube(parts, 'tree-horns', FRAME_GREY, [s * 0.04, y, 0], [s * (x1 - 0.02), y, 0], 0.022);
        for (let i = 0; i < 3 && y < 1.0; i++) plateDisc(parts, s * (0.22 + i * (th + 0.003)), y, 0, r, th);
        if (y >= 1.0) plateDisc(parts, s * 0.22, y, 0, r, th);
      }
      slab(parts, 'tree-cap', FRAME_GREY, -0.06, 0.06, H - 0.04, H, -0.06, 0.06);
      void r0;
    },
    kettlebells: () => {
      // two tiers, four bells each, 4 to 32 kg (the downloaded bell when it is here), the heavy ones at the bottom
      const model = propGeo('kettlebell', q.tier);
      noteProp(parts, 'kettlebell', !!model);
      for (const zz of [z0 + 0.03, z1 - 0.03]) rtube(parts, 'kb-feet', FRAME, [-x1 + 0.005, 0.025, zz], [x1 - 0.005, 0.025, zz], 0.06, 0.05, 0.012);
      for (const sx of [-1, 1]) for (const z of [z0 + 0.03, z1 - 0.03]) rtube(parts, 'kb-legs', FRAME, [sx * (x1 - 0.03), 0.05, z], [sx * (x1 - 0.03), H, z], 0.05, 0.05, 0.01);
      const tiers: [number, readonly number[]][] = [[0.34, KETTLEBELLS_KG.slice(4)], [S, KETTLEBELLS_KG.slice(0, 4)]];
      for (const [y, kgs] of tiers) {
        parts.box('kb-shelf', WOOD_ASH, -x1 + 0.02, x1 - 0.02, y - 0.03, y, z0 + 0.03, z1 - 0.03, { c: 0.004 });
        kgs.forEach((kg, i) => {
          const x = -x1 + 0.17 + i * ((w - 0.34) / 3);
          kettlebell(parts, x, y, 0, kbHeight(kg), model, kg >= 24 ? ACCENT_RED : kg >= 16 ? { key: 'plastic', tint: '#D9A82B' } : { key: 'plastic', tint: '#3E7D4F' });
        });
      }
      rtube(parts, 'kb-top', FRAME, [-x1 + 0.005, H - 0.025, z0 + 0.03], [x1 - 0.005, H - 0.025, z0 + 0.03], 0.05, 0.05, 0.01);
    },
    preacher: () => {
      // an angled arm pad rising toward the back, a seat on a post, a foot rest at the front
      const padA = new THREE.BoxGeometry(0.4, 0.08, 0.62);
      padA.rotateX(0.95);
      padA.translate(0, H - 0.3, z0 + 0.33);
      parts.put('pc-arm-pad', PAD_BLACK, padA, { tile: 0.4 });
      slab(parts, 'pc-feet', FRAME, -x1, x1, 0, 0.06, z0, z0 + 0.1);
      slab(parts, 'pc-feet', FRAME, -x1 + 0.05, x1 - 0.05, 0, 0.06, z1 - 0.1, z1);
      slab(parts, 'pc-feet', FRAME, -0.04, 0.04, 0, 0.06, z0 + 0.1, z1 - 0.1);
      tube(parts, 'pc-post', FRAME, [0, 0.06, z0 + 0.08], [0, H - 0.005, z0 + 0.1], 0.04);
      tubes(parts, 'pc-pad-support', FRAME, [[0, 0.7, z0 + 0.1], [0, H - 0.35, z0 + 0.35]], 0.03);
      pad(parts, 'pc-seat', PAD_BLACK, -0.17, 0.17, S - 0.08, S, z1 - 0.55, z1 - 0.2, 0.035);
      tube(parts, 'pc-seat-post', FRAME, [0, 0.06, z1 - 0.38], [0, S - 0.08, z1 - 0.38], 0.03);
      // a curl bar resting in the cradle on top of the post
      tube(parts, 'pc-cradle', FRAME_GREY, [-0.14, H - 0.022, z0 + 0.08], [0.14, H - 0.022, z0 + 0.08], 0.02);
      void SHROUD;
    },
  };
  build[v]();
  return parts.done();
}
