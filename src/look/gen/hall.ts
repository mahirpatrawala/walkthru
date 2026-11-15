// Community-hall pieces (SPEC 16.17): a stacking chair, folding banquet tables (rectangular and round), stage platform modules (1.2 × 2.4 m, three heights), a podium,
// a wall projector screen, a PA speaker on a stand, and carrom, table-tennis and pool tables. Sizes are exactly the item's.
import * as THREE from 'three';
import { Parts, role, roleOr } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { CHROME, SOIL, soft } from './kit';
import { ACCENT_BLUE, CONSOLE, FRAME, FRAME_GREY, IRON, SCREEN_GLASS, SHROUD, SHROUD_LIGHT, WOOD_ASH, cylY, pad, slab, tube } from './gymkit';

export const HALL_VARIANTS = ['chair', 'table-rect', 'table-round', 'stage', 'podium', 'screen', 'speaker', 'carrom', 'tt', 'pool'] as const;
export type HallVariant = (typeof HALL_VARIANTS)[number];
export interface HallParams { variant: HallVariant; liftM: number }
export const HALL_DEFAULTS: HallParams = { variant: 'chair', liftM: 0 };

export function buildHall(env: GenEnv, size: GenSize, p: HallParams, roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (HALL_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'chair';
  const parts = new Parts(env, `gen:hall`);
  const x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const q = env.q;
  const lift = p.liftM ?? 0;
  const seg = q.tier === 'low' ? 12 : q.tier === 'medium' ? 20 : 28;
  const wseg = q.tier === 'low' ? 12 : 16;
  const wood = role(roles, 'case', 'accent');
  const build: Record<string, () => void> = {
    chair: () => {
      // a stacking chair: a steel frame (four legs, the back posts), a padded seat and a padded back
      const seatM: MatSpec = roleOr(roles, { key: 'weave', tint: '#2F4A66' }, 'hallChair');
      const lx = x1 - 0.03, lz = z1 - 0.03;
      for (const sx of [-1, 1]) {
        tube(parts, 'chair-legs', FRAME_GREY, [sx * lx, 0, lz], [sx * lx, S - 0.04, lz - 0.02], 0.011);
        tube(parts, 'chair-legs', FRAME_GREY, [sx * lx, 0, z0 + 0.07], [sx * lx, S - 0.04, z0 + 0.06], 0.011);
        tube(parts, 'chair-back-posts', FRAME_GREY, [sx * lx, S - 0.04, z0 + 0.06], [sx * (lx - 0.01), H - 0.04, z0 + 0.025], 0.011);
        tube(parts, 'chair-rails', FRAME_GREY, [sx * lx, S - 0.05, z0 + 0.06], [sx * lx, S - 0.05, lz - 0.02], 0.009);
      }
      tube(parts, 'chair-rails', FRAME_GREY, [-lx, 0.2, lz], [lx, 0.2, lz], 0.008);
      pad(parts, 'chair-seat', seatM, -x1, x1, S - 0.05, S, z0 + 0.05, z1, 0.02);
      pad(parts, 'chair-back', seatM, -x1 + 0.03, x1 - 0.03, H - 0.24, H, z0, z0 + 0.04, 0.018);
    },
    'table-rect': () => {
      // a folding table: a 4 cm laminate top on a steel apron, two folding leg frames
      parts.box('table-top', roleOr(roles, { key: 'laminate', tint: '#E9E6DF' }, 'top'), -x1, x1, S - 0.04, S, z0, z1, { c: 0.004 });
      slab(parts, 'table-apron', FRAME, -x1 + 0.04, x1 - 0.04, S - 0.07, S - 0.04, z0 + 0.04, z1 - 0.04);
      for (const sx of [-1, 1]) {
        const x = sx * (x1 - 0.18);
        tube(parts, 'table-legs', FRAME_GREY, [x, 0, z0 + 0.06], [x, S - 0.07, z0 + 0.06], 0.014);
        tube(parts, 'table-legs', FRAME_GREY, [x, 0, z1 - 0.06], [x, S - 0.07, z1 - 0.06], 0.014);
        tube(parts, 'table-legs', FRAME_GREY, [x, 0.12, z0 + 0.06], [x, 0.12, z1 - 0.06], 0.01);
      }
    },
    'table-round': () => {
      const r = w / 2;
      cylY(parts, 'table-top', roleOr(roles, { key: 'laminate', tint: '#E9E6DF' }, 'top'), 0, 0, S - 0.04, S, r, seg * 2);
      cylY(parts, 'table-apron', FRAME, 0, 0, S - 0.07, S - 0.04, r - 0.08, 16);
      for (const s of [-1, 1]) {
        tube(parts, 'table-legs', FRAME_GREY, [s * (r * 0.62), 0, -r * 0.2], [s * (r * 0.62), S - 0.07, -r * 0.2], 0.014);
        tube(parts, 'table-legs', FRAME_GREY, [s * (r * 0.62), 0, r * 0.2], [s * (r * 0.62), S - 0.07, r * 0.2], 0.014);
        tube(parts, 'table-legs', FRAME_GREY, [s * (r * 0.62), 0.12, -r * 0.2], [s * (r * 0.62), 0.12, r * 0.2], 0.01);
      }
    },
    stage: () => {
      // a 1.2 × 2.4 m platform deck: a carpeted top, a steel frame skirt, four corner posts with feet, and a side rail clamp
      parts.box('stage-deck', { key: 'laminate', tint: '#2D2F36' }, -x1, x1, H - 0.04, H, z0, z1, { c: 0.004 });
      parts.box('stage-skirt', FRAME, -x1 + 0.01, x1 - 0.01, 0.03, H - 0.04, z0 + 0.01, z1 - 0.01, { c: 0.004 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) slab(parts, 'stage-feet', FRAME_GREY, sx * (x1 - 0.06) - 0.05, sx * (x1 - 0.06) + 0.05, 0, 0.03, sz * (z1 - 0.06) - 0.05, sz * (z1 - 0.06) + 0.05);
      for (const sx of [-1, 1]) slab(parts, 'stage-trim', ACCENT_BLUE, sx * x1 - 0.006 + (sx > 0 ? 0.006 : -0.006) * 0, sx * x1, H - 0.05, H - 0.04, z0, z1);
    },
    podium: () => {
      // a lectern: a wooden body, a sloped reading top with a lip, a gooseneck microphone, a base plinth
      parts.box('podium-body', wood, -x1 + 0.03, x1 - 0.03, 0.06, S - 0.06, z0 + 0.04, z1 - 0.03, { c: 0.006, grain: 'y' });
      parts.box('podium-plinth', FRAME, -x1, x1, 0, 0.06, z0, z1, { c: 0.004 });
      const top = new THREE.BoxGeometry(w, 0.04, d - 0.04);
      top.rotateX(0.16);
      top.translate(0, S - 0.02, 0.0);
      parts.put('podium-top', wood, top);
      slab(parts, 'podium-lip', wood, -x1, x1, S - 0.04, S + 0.025, z1 - 0.06, z1 - 0.02);
      tube(parts, 'podium-mic', CHROME, [0, S, z0 + 0.15], [0, H - 0.02, z0 + 0.12], 0.007);
      tube(parts, 'podium-mic', CHROME, [0, H - 0.02, z0 + 0.12], [0, H - 0.02, z0 + 0.0], 0.007);
      parts.put('podium-mic', IRON, new THREE.SphereGeometry(0.02, 8, 6).translate(0, H - 0.02, z0 + 0.02));
      slab(parts, 'podium-sign', { key: 'brass', tint: '#C9A24E' }, -0.08, 0.08, 0.5, 0.58, z1 - 0.03, z1 - 0.025);
    },
    screen: () => {
      // a wall-mounted electric screen: a roller casing at the top, the white viewing surface hanging from it down to the underside
      parts.box('screen-case', SHROUD_LIGHT, -x1, x1, H - 0.12, H, z0, z1, { c: 0.01 });
      slab(parts, 'screen-surface', { key: 'cotton', tint: '#F4F4F0' }, -x1 + 0.04, x1 - 0.04, lift + 0.04, H - 0.12, z0 + 0.04, z0 + 0.05);
      slab(parts, 'screen-border', IRON, -x1 + 0.02, -x1 + 0.04, lift + 0.02, H - 0.12, z0 + 0.04, z0 + 0.05);
      slab(parts, 'screen-border', IRON, x1 - 0.04, x1 - 0.02, lift + 0.02, H - 0.12, z0 + 0.04, z0 + 0.05);
      slab(parts, 'screen-border', IRON, -x1 + 0.02, x1 - 0.02, lift, lift + 0.04, z0 + 0.035, z1 - 0.01);
    },
    speaker: () => {
      // a PA speaker cabinet on a tripod stand: three legs, a pole, a cabinet with a horn and a woofer, reaching the item's height exactly
      const cabH = 0.62, cabY0 = H - cabH;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        tube(parts, 'speaker-legs', FRAME, [0, 0.9, 0], [sx * (w / 2 - 0.02), 0.02, sz * (d / 2 - 0.02)], 0.012);
        cylY(parts, 'speaker-feet', IRON, sx * (w / 2 - 0.02), sz * (d / 2 - 0.02), 0, 0.03, 0.018, 8);
      }
      tube(parts, 'speaker-pole', CHROME, [0, 0.85, 0], [0, cabY0 + 0.02, 0], 0.017);
      parts.box('speaker-cabinet', CONSOLE, -0.19, 0.19, cabY0, H, -0.18, 0.18, { c: 0.012 });
      parts.put('speaker-woofer', IRON, new THREE.CylinderGeometry(0.13, 0.13, 0.02, 16).rotateX(Math.PI / 2).translate(0, cabY0 + 0.18, 0.185));
      slab(parts, 'speaker-horn', IRON, -0.12, 0.12, H - 0.19, H - 0.07, 0.18, 0.192);
    },
    carrom: () => {
      // a carrom board in its wooden frame on a table: the playing surface 74 cm, four pockets, the circles and the baselines; a stand with four legs
      const bt = S;
      parts.box('carrom-frame', WOOD_ASH, -x1, x1, bt - 0.05, bt, z0, z1, { c: 0.006 });
      slab(parts, 'carrom-surface', { key: 'laminate', tint: '#D9B97A' }, -0.37, 0.37, bt, bt + 0.0005, -0.37, 0.37);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        cylY(parts, 'carrom-pockets', IRON, sx * 0.345, sz * 0.345, bt - 0.0005, bt + 0.0015, 0.032, 12);
        slab(parts, 'carrom-legs', WOOD_ASH, sx * (x1 - 0.05) - 0.03, sx * (x1 - 0.05) + 0.03, 0, bt - 0.05, sz * (z1 - 0.05) - 0.03, sz * (z1 - 0.05) + 0.03);
      }
      parts.put('carrom-circle', { key: 'laminate', tint: '#8A5A33' }, new THREE.RingGeometry(0.1, 0.103, 28).rotateX(-Math.PI / 2).translate(0, bt + 0.0016, 0));
      parts.put('carrom-circle', { key: 'laminate', tint: '#8A5A33' }, new THREE.RingGeometry(0.014, 0.017, 16).rotateX(-Math.PI / 2).translate(0, bt + 0.0016, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) void [sx, sz];
      // coins: nine white, nine black and the red queen, in the centre ring
      for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; cylY(parts, 'carrom-coins', i % 2 ? IRON : { key: 'laminate', tint: '#F1E8D0' }, Math.cos(a) * 0.04, Math.sin(a) * 0.04, bt + 0.0005, bt + 0.007, 0.016, 10); }
      cylY(parts, 'carrom-coins', { key: 'paint', tint: '#B3322B' }, 0, 0, bt + 0.0005, bt + 0.007, 0.016, 10);
      slab(parts, 'carrom-rails', FRAME_GREY, -x1 + 0.02, x1 - 0.02, S - 0.09, S - 0.06, z0 + 0.04, z0 + 0.06);
      slab(parts, 'carrom-rails', FRAME_GREY, -x1 + 0.02, x1 - 0.02, S - 0.09, S - 0.06, z1 - 0.06, z1 - 0.04);
    },
    tt: () => {
      // a table-tennis table: a 76 cm high blue top 274 × 152.5 with white lines, a net on two posts, and two folding leg frames
      slab(parts, 'tt-top', { key: 'paint', tint: '#1E4D8C' }, -x1, x1, S - 0.03, S, z0, z1);
      slab(parts, 'tt-edge', { key: 'laminate', tint: '#F4F4F0' }, -x1, x1, S - 0.0, S + 0.0005, z0, z0 + 0.02);
      slab(parts, 'tt-edge', { key: 'laminate', tint: '#F4F4F0' }, -x1, x1, S - 0.0, S + 0.0005, z1 - 0.02, z1);
      slab(parts, 'tt-edge', { key: 'laminate', tint: '#F4F4F0' }, -x1, -x1 + 0.02, S - 0.0, S + 0.0005, z0, z1);
      slab(parts, 'tt-edge', { key: 'laminate', tint: '#F4F4F0' }, x1 - 0.02, x1, S - 0.0, S + 0.0005, z0, z1);
      slab(parts, 'tt-edge', { key: 'laminate', tint: '#F4F4F0' }, -0.0025, 0.0025, S - 0.0, S + 0.0005, z0, z1);
      slab(parts, 'tt-frame', FRAME, -x1 + 0.1, x1 - 0.1, S - 0.07, S - 0.03, z0 + 0.1, z1 - 0.1);
      for (const sx of [-1, 1]) {
        const x = sx * (x1 - 0.35);
        for (const sz of [-1, 1]) tube(parts, 'tt-legs', FRAME_GREY, [x, 0.06, sz * (z1 - 0.12)], [x, S - 0.07, sz * (z1 - 0.08)], 0.02);
        tube(parts, 'tt-legs', FRAME_GREY, [x, 0.06, -(z1 - 0.12)], [x, 0.06, z1 - 0.12], 0.02);
        for (const sz of [-1, 1]) cylY(parts, 'tt-wheels', IRON, x, sz * (z1 - 0.12), 0, 0.06, 0.03, 8);
      }
      // net: 15.25 cm high above the top, posts at each side
      for (const sz of [-1, 1]) tube(parts, 'tt-net-posts', CHROME, [0, S, sz * (z1 - 0.007)], [0, H, sz * (z1 - 0.007)], 0.007);
      slab(parts, 'tt-net', { key: 'sheer', tint: '#E8E8E8' }, -0.004, 0.004, S, H - 0.012, z0 + 0.005, z1 - 0.005);
      slab(parts, 'tt-net-tape', { key: 'laminate', tint: '#F4F4F0' }, -0.005, 0.005, H - 0.012, H, z0, z1);
    },
    pool: () => {
      // a pool table: a wooden body with six pockets, cloth in green, cushion rails, four turned legs; fifteen balls racked at one end and the cue ball
      const bt = S, rail = 0.1;
      parts.box('pool-body', wood, -x1, x1, bt - 0.2, bt - 0.0, z0, z1, { c: 0.01 });
      slab(parts, 'pool-cloth', { key: 'weave', tint: '#1F6B46' }, -x1 + rail, x1 - rail, bt - 0.0, bt + 0.0006, z0 + rail, z1 - rail);
      for (const [x, z, l, dd] of [[0, z0 + rail / 2, w - 2 * rail, rail], [0, z1 - rail / 2, w - 2 * rail, rail], [-x1 + rail / 2, 0, rail, d - 2 * rail], [x1 - rail / 2, 0, rail, d - 2 * rail]] as const)
        parts.box('pool-cushions', { key: 'weave', tint: '#17573A' }, x - l / 2, x + l / 2, bt, bt + 0.06, z - dd / 2, z + dd / 2, { c: 0.01 });
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]] as const) cylY(parts, 'pool-pockets', IRON, cx * (x1 - rail * 0.6), cz * (z1 - rail * 0.6), bt - 0.0, bt + 0.045, 0.045, 12);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        cylY(parts, 'pool-legs', wood, sx * (x1 - 0.17), sz * (z1 - 0.17), 0, bt - 0.2, 0.08, 10);
        cylY(parts, 'pool-feet', IRON, sx * (x1 - 0.17), sz * (z1 - 0.17), 0, 0.03, 0.095, 10);
      }
      if (q.tier !== 'low') {
        const br = 0.0285;
        let n = 0;
        for (let r = 0; r < 5; r++) for (let c = 0; c <= r; c++) {
          const bx = x1 * 0.45 + r * br * 1.76, bz = (c - r / 2) * br * 2.02;
          parts.put('pool-balls', { key: 'gloss', tint: ['#D5C13A', '#2F5FA8', '#C03B30', '#4B2E83', '#E27A2D'][n % 5] }, new THREE.SphereGeometry(br, 8, 6).translate(bx, bt + br + 0.0006, bz));
          n++;
        }
        parts.put('pool-balls', { key: 'gloss', tint: '#F4F2EC' }, new THREE.SphereGeometry(br, 8, 6).translate(-x1 * 0.45, bt + br + 0.0006, 0));
      }
      void SOIL; void SHROUD; void SCREEN_GLASS;
    },
  };
  build[v]();
  void H; void d; void soft;
  return parts.done();
}
