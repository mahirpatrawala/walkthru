// Community-hall pieces (SPEC 16.17): a stacking chair, folding banquet tables (rectangular and round), stage platform modules (1.2 × 2.4 m, three heights), a podium,
// a wall projector screen, a PA speaker on a stand, and carrom, table-tennis and pool tables. Sizes are exactly the item's.
import * as THREE from 'three';
import { Parts, role, roleOr } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { CHROME, SOIL, soft } from './kit';
import { softCushion } from './soft';
import { addTextured, propGeo, propInfo } from '../gym/props';
import { fitModel } from '../models/fit';
import { ACCENT_BLUE, ACCENT_RED, CONSOLE, FRAME, FRAME_GREY, IRON, SCREEN_GLASS, SHROUD, SHROUD_LIGHT, WOOD_ASH, cylX, cylY, cylZ, noteProp, pad, rtube, slab, tube, wholeModel } from './gymkit';

export const HALL_VARIANTS = ['chair', 'table-rect', 'table-round', 'stage', 'podium', 'screen', 'speaker', 'carrom', 'tt', 'pool', 'foosball', 'chess-set', 'card-set', 'carrom-set', 'banquet-set', 'cafe-set'] as const;
export type HallVariant = (typeof HALL_VARIANTS)[number];
export interface HallParams { variant: HallVariant; liftM: number }
/** a banquet table's cloth: white cotton unless a pack names a `tablecloth` role */
const CLOTH: MatSpec = { key: 'cotton', tint: '#F3F0EA' };
/** a pool table's timber is a walnut whatever the pack's case colour (a white pool table reads as a toy); SPEC 16.17.4: a mid walnut, the
 * dark one read as a black mass in the games room */
const POOL_WOOD: MatSpec = { key: 'wood', tint: '#8A6A4E' };
/** a pool table's cloth: a tournament green worsted (the photographed fine nap of the `felt` key) */
const POOL_CLOTH: MatSpec = { key: 'felt', tint: '#1F6B46' };
/** SPEC 16.17.4: the upholstery of the banquet, card and chess chairs and the carrom stools: a warm taupe woven fabric (the navy read black
 * under a hall's light) on the brushed steel frame */
const SEAT_FABRIC: MatSpec = { key: 'weave', tint: '#9C8770' };
export const HALL_DEFAULTS: HallParams = { variant: 'chair', liftM: 0 };
/** the pool-table model's materials (as named in the source file) and the part each one is: the cloth, the six pocket cups, the leg pads; the rest is timber */
const POOL_PARTS: Record<string, 'cloth' | 'pockets' | 'feet'> = { aiStandardSurface1: 'cloth', aiStandardSurface4: 'pockets', aiStandardSurface3: 'feet' };

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
  // fifteen balls racked at the foot spot, the cue ball at the head (on the generated table or on the model's cloth)
  const racked = (bt: number): void => {
    const br = 0.0285, bs = q.tier === 'high' ? 12 : 8;
    // a ball stands taller than a rail: on a model whose rails are lower than that above its cloth the balls would leave the box, so none are racked
    if (q.tier !== 'low' && bt + 2 * br <= H + 0.001) {
      const COL = ['#E2C230', '#2F5FA8', '#C03B30', '#4B2E83', '#E27A2D', '#2B7A3F', '#7A2A22', '#1A1A1A'];
      let n = 0;
      for (let r = 0; r < 5; r++) for (let c = 0; c <= r; c++) {
        const bx = x1 * 0.45 + r * br * 1.76, bz = (c - r / 2) * br * 2.02;
        parts.put('pool-balls', { key: 'gloss', tint: COL[n % 8] }, new THREE.SphereGeometry(br, bs, bs * 0.75).translate(bx, bt + br + 0.0006, bz));
        n++;
      }
      parts.put('pool-balls', { key: 'gloss', tint: '#F4F2EC' }, new THREE.SphereGeometry(br, bs, bs * 0.75).translate(-x1 * 0.45, bt + br + 0.0006, 0));
    }
  };
  /**
   * The board of a carrom table, `t` from the middle to the frame's edge, its top at `bt`; returns where the stand's legs end. SPEC 16.17.3: the
   * downloaded board (frame, printed surface, coins) scaled to the frame when it is here; else the generated frame, surface, pockets and coins.
   */
  const carromBoard = (t: number, bt: number, innerRing = false): number => {
    const model = propGeo('carrom-board', q.tier);
    noteProp(parts, 'carrom-board', !!model);
    if (model) {
      const info = propInfo('carrom-board');
      const k = (2 * t) / Math.max(info.dims.w, info.dims.d);
      addTextured(parts.group, model, 'carrom-board-model', k, [0, bt - info.dims.h * k, 0]);
      return bt - info.dims.h * k;
    }
    parts.box('carrom-frame', WOOD_ASH, -t, t, bt - 0.05, bt, -t, t, { c: 0.006 });
    slab(parts, 'carrom-surface', { key: 'laminate', tint: '#D9B97A' }, -0.37, 0.37, bt, bt + 0.0005, -0.37, 0.37);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylY(parts, 'carrom-pockets', IRON, sx * 0.345, sz * 0.345, bt - 0.0005, bt + 0.0015, 0.032, 12);
    parts.put('carrom-circle', { key: 'laminate', tint: '#8A5A33' }, new THREE.RingGeometry(0.1, 0.103, 28).rotateX(-Math.PI / 2).translate(0, bt + 0.0016, 0));
    if (innerRing) parts.put('carrom-circle', { key: 'laminate', tint: '#8A5A33' }, new THREE.RingGeometry(0.014, 0.017, 16).rotateX(-Math.PI / 2).translate(0, bt + 0.0016, 0));
    // coins: white, black and the red queen, in the centre ring
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; cylY(parts, 'carrom-coins', i % 2 ? IRON : { key: 'laminate', tint: '#F1E8D0' }, Math.cos(a) * 0.04, Math.sin(a) * 0.04, bt + 0.0005, bt + 0.007, 0.016, 10); }
    cylY(parts, 'carrom-coins', { key: 'paint', tint: '#B3322B' }, 0, 0, bt + 0.0005, bt + 0.007, 0.016, 10);
    return bt - 0.05;
  };
  /**
   * SPEC 16.17.4: the pool-table model's shapes in the app's materials. Each of its four materials is one kind of part (the cabinet, rails and
   * legs; the cloth; the pocket cups; the leg pads): every part is scaled into the box like a whole model (16.17.3) and takes the matching
   * finish with world-space grain. False when the model is not here (asked for, swapped in when it lands), does not fit, or models are off.
   */
  const poolModel = (): boolean => {
    const info = propInfo('pool-table');
    if (!info || !fitModel({ w: info.dims.w, h: info.dims.h, d: info.dims.d }, { w, h: H, d }).ok) return false;
    const geo = propGeo('pool-table', q.tier);
    noteProp(parts, 'pool-table', !!geo);
    if (!geo?.meshes) return false;
    const sx = w / info.dims.w, sy = H / info.dims.h, sz = d / info.dims.d;
    for (const m of geo.meshes) {
      const g = m.geometry.clone().scale(sx, sy, sz);
      g.computeVertexNormals();
      const which = POOL_PARTS[m.material.name] ?? 'body';
      if (which === 'cloth') parts.put('pool-cloth', POOL_CLOTH, g);
      else if (which === 'pockets') parts.put('pool-pockets', { key: 'vinyl', tint: '#2E2622' }, g);
      else if (which === 'feet') parts.put('pool-feet', { key: 'rubber', tint: '#2A2B2E' }, g);
      else parts.put('pool-body', POOL_WOOD, g, { grain: 'x' });
    }
    return true;
  };
  const build: Record<string, () => void> = {
    chair: () => {
      // a stacking chair: a steel frame (four legs, the back posts), a padded seat and a padded back
      const seatM: MatSpec = roleOr(roles, SEAT_FABRIC, 'hallChair');
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
      // dressed with a white cloth: a round top in cotton and a skirt hanging to 25 cm, as a banquet table is set
      cylY(parts, 'table-top', roleOr(roles, CLOTH, 'tablecloth'), 0, 0, S - 0.04, S, r, seg * 2);
      cylY(parts, 'table-cloth-skirt', roleOr(roles, CLOTH, 'tablecloth'), 0, 0, 0.25, S - 0.04, r - 0.004, seg * 2);
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
      // SPEC 16.17.3: the downloaded board (its frame, printed playing surface and coins) when it is here, on the generated stand
      const top = carromBoard(x1, bt, true);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) slab(parts, 'carrom-legs', WOOD_ASH, sx * (x1 - 0.05) - 0.03, sx * (x1 - 0.05) + 0.03, 0, top, sz * (z1 - 0.05) - 0.03, sz * (z1 - 0.05) + 0.03);
      slab(parts, 'carrom-rails', FRAME_GREY, -x1 + 0.02, x1 - 0.02, S - 0.09, S - 0.06, z0 + 0.04, z0 + 0.06);
      slab(parts, 'carrom-rails', FRAME_GREY, -x1 + 0.02, x1 - 0.02, S - 0.09, S - 0.06, z1 - 0.06, z1 - 0.04);
    },
    tt: () => {
      // SPEC 16.17.3: the downloaded table (blue top with its lines, black A-frame legs, net) when it is here and fits the box
      if (wholeModel(parts, 'table-tennis', { w, h: H, d })) return;
      // a table-tennis table: a 76 cm high blue top 274 × 152.5 with white lines, a net on two posts, and two folding leg frames
      parts.box('tt-top', { key: 'paint', tint: '#1C477F' }, -x1, x1, S - 0.025, S, z0, z1, { c: 0.004 });
      slab(parts, 'tt-edge', { key: 'laminate', tint: '#F4F4F0' }, -x1, x1, S - 0.0, S + 0.0005, z0, z0 + 0.02);
      slab(parts, 'tt-edge', { key: 'laminate', tint: '#F4F4F0' }, -x1, x1, S - 0.0, S + 0.0005, z1 - 0.02, z1);
      slab(parts, 'tt-edge', { key: 'laminate', tint: '#F4F4F0' }, -x1, -x1 + 0.02, S - 0.0, S + 0.0005, z0, z1);
      slab(parts, 'tt-edge', { key: 'laminate', tint: '#F4F4F0' }, x1 - 0.02, x1, S - 0.0, S + 0.0005, z0, z1);
      slab(parts, 'tt-edge', { key: 'laminate', tint: '#F4F4F0' }, -0.0025, 0.0025, S - 0.0, S + 0.0005, z0, z1);
      // SPEC 16.17.2: a steel apron under each half, two rolling undercarriages of square tube with a cross brace, rubber-tyred castors
      for (const sx of [-1, 1]) {
        rtube(parts, 'tt-frame', FRAME, [sx * 0.06, S - 0.05, z0 + 0.08], [sx * (x1 - 0.08), S - 0.05, z0 + 0.08], 0.03, 0.04, 0.006);
        rtube(parts, 'tt-frame', FRAME, [sx * 0.06, S - 0.05, z1 - 0.08], [sx * (x1 - 0.08), S - 0.05, z1 - 0.08], 0.03, 0.04, 0.006);
        for (const xx of [sx * 0.06, sx * (x1 - 0.08)]) rtube(parts, 'tt-frame', FRAME, [xx, S - 0.05, z0 + 0.08], [xx, S - 0.05, z1 - 0.08], 0.03, 0.04, 0.006);
        const x = sx * (x1 - 0.42);
        for (const sz of [-1, 1]) rtube(parts, 'tt-legs', FRAME_GREY, [x, 0.08, sz * (z1 - 0.16)], [x, S - 0.07, sz * (z1 - 0.2)], 0.04, 0.04, 0.008);
        rtube(parts, 'tt-legs', FRAME_GREY, [x, 0.08, -(z1 - 0.16)], [x, 0.08, z1 - 0.16], 0.04, 0.04, 0.008);
        rtube(parts, 'tt-legs', FRAME_GREY, [x, 0.12, 0], [sx * 0.12, S - 0.07, 0], 0.03, 0.03, 0.006);
        for (const sz of [-1, 1]) { cylX(parts, 'tt-wheels', { key: 'rubber', tint: '#2A2B2E' }, x - 0.015, x + 0.015, 0.035, sz * (z1 - 0.16), 0.035, 12); slab(parts, 'tt-castors', FRAME, x - 0.02, x + 0.02, 0.035, 0.08, sz * (z1 - 0.16) - 0.02, sz * (z1 - 0.16) + 0.02); }
      }
      // net: 15.25 cm high above the top, posts at each side
      for (const sz of [-1, 1]) tube(parts, 'tt-net-posts', CHROME, [0, S, sz * (z1 - 0.007)], [0, H, sz * (z1 - 0.007)], 0.007);
      slab(parts, 'tt-net', { key: 'sheer', tint: '#E8E8E8' }, -0.004, 0.004, S, H - 0.012, z0 + 0.005, z1 - 0.005);
      slab(parts, 'tt-net-tape', { key: 'laminate', tint: '#F4F4F0' }, -0.005, 0.005, H - 0.012, H, z0, z1);
    },
    pool: () => {
      // SPEC 16.17.3: the downloaded table (moulded cabinet, rails, pockets, legs) when it is here and fits the box. SPEC 16.17.4: its shapes
      // only, in the app's own photographed walnut veneer and cloth (its own maps were a dark, drawn wood grain and a lime cloth); no balls,
      // since a ball on its cloth would stand above the box
      if (poolModel()) return;
      // an 8 ft pool table (SPEC 16.17.2): a walnut cabinet with a moulded apron, wood top rails with inlaid sights, green cushions and cloth, six
      // leather pocket cups, four turned legs on levelling feet; fifteen balls racked at the foot spot, the cue ball at the head
      const bt = S, rail = 0.12;
      const body = q.tier === 'low' ? new THREE.BoxGeometry(w, 0.2, d) : softCushion(w, 0.2, d, { r: 0.03, puff: 0.002, seg: 2 });
      body.translate(0, bt - 0.1, 0);
      parts.put('pool-body', POOL_WOOD, body, { grain: 'x' });
      parts.box('pool-apron', { key: 'wood', tint: '#5A4634' }, -x1 + 0.03, x1 - 0.03, bt - 0.26, bt - 0.19, z0 + 0.03, z1 - 0.03, { c: 0.012, grain: 'x' });
      slab(parts, 'pool-cloth', POOL_CLOTH, -x1 + rail, x1 - rail, bt - 0.004, bt + 0.0006, z0 + rail, z1 - rail);
      // top rails (wood) and the cushions inside them (felt), H at the rails' top
      const rt = H;
      for (const [x, z, l, dd] of [[0, z0 + rail * 0.35, w, rail * 0.7], [0, z1 - rail * 0.35, w, rail * 0.7], [-x1 + rail * 0.35, 0, rail * 0.7, d], [x1 - rail * 0.35, 0, rail * 0.7, d]] as const)
        parts.box('pool-rails', POOL_WOOD, x - l / 2, x + l / 2, bt + 0.005, rt, z - dd / 2, z + dd / 2, { c: 0.012, grain: x === 0 ? 'x' : 'z' });
      for (const [x, z, l, dd] of [[0, z0 + rail * 0.85, w - 2 * rail, rail * 0.3], [0, z1 - rail * 0.85, w - 2 * rail, rail * 0.3], [-x1 + rail * 0.85, 0, rail * 0.3, d - 2 * rail], [x1 - rail * 0.85, 0, rail * 0.3, d - 2 * rail]] as const)
        parts.box('pool-cushions', { key: 'felt', tint: '#17573A' }, x - l / 2, x + l / 2, bt, rt - 0.012, z - dd / 2, z + dd / 2, { c: 0.012 });
      // sights: small pearl diamonds on the rails, three a section
      if (q.tier !== 'low') {
        for (const k of [1, 2, 3, 5, 6, 7]) for (const zz of [z0 + rail * 0.35, z1 - rail * 0.35]) cylY(parts, 'pool-sights', { key: 'white' }, -x1 + (k * w) / 8, zz, rt - 0.001, rt + 0.0008, 0.007, 8);
        for (const k of [1, 2, 3]) for (const xx of [-x1 + rail * 0.35, x1 - rail * 0.35]) cylY(parts, 'pool-sights', { key: 'white' }, xx, z0 + (k * d) / 4, rt - 0.001, rt + 0.0008, 0.007, 8);
      }
      // pockets: black leather cups at the corners and the middle of the long sides, a dark hole in the bed
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]] as const) {
        const px = cx * (x1 - rail * 0.75), pz = cz * (z1 - rail * 0.75);
        cylY(parts, 'pool-pockets', { key: 'vinyl', tint: '#1B1A19' }, px, pz, bt - 0.12, rt + 0.002, 0.06, 16);
        cylY(parts, 'pool-pocket-holes', { key: 'dark', tint: '#0C0C0C' }, px, pz, rt + 0.002, rt + 0.003, 0.045, 16);
      }
      // turned legs
      const prof = [[0, 0], [0.09, 0], [0.09, 0.03], [0.07, 0.05], [0.06, 0.18], [0.085, 0.3], [0.09, 0.38], [0.065, 0.46], [0.07, bt - 0.26], [0, bt - 0.26]].map(([r0, y0]) => new THREE.Vector2(r0, y0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const lg = new THREE.LatheGeometry(prof, q.tier === 'low' ? 8 : 16);
        lg.translate(sx * (x1 - 0.2), 0, sz * (z1 - 0.2));
        parts.put('pool-legs', POOL_WOOD, lg);
      }
      racked(bt);
      void SOIL; void SHROUD; void SCREEN_GLASS;
    },
    foosball: () => {
      // a foosball table: a cabinet 140 x 76 cm on four legs, a green field, eight rods running across (the handles stand out past the sides: the footprint is 120 cm across with them)
      const bodyZ = 0.38;
      // a dark walnut cabinet on black legs, whatever the pack's case colour (a white foosball table reads as a toy, as a white pool table does)
      parts.box('foos-cabinet', POOL_WOOD, -x1, x1, S - 0.2, S + 0.03, -bodyZ, bodyZ, { c: 0.008, grain: 'x' });
      slab(parts, 'foos-field', { key: 'weave', tint: '#2F7A3E' }, -x1 + 0.06, x1 - 0.06, S + 0.0, S + 0.001, -bodyZ + 0.06, bodyZ - 0.06);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) slab(parts, 'foos-legs', { key: 'powder', tint: '#2B2D31' }, sx * (x1 - 0.1) - 0.04, sx * (x1 - 0.1) + 0.04, 0, S - 0.2, sz * (bodyZ - 0.06) - 0.04, sz * (bodyZ - 0.06) + 0.04);
      for (let i = 0; i < 8; i++) {
        const x = -0.55 + i * (1.1 / 7);
        tube(parts, 'foos-rods', CHROME, [x, S + 0.08, -z1 + 0.14], [x, S + 0.08, z1 - 0.14], 0.008);
        for (const sz of [-1, 1]) cylZ(parts, 'foos-handles', IRON, Math.min(sz * (z1 - 0.12), sz * z1), Math.max(sz * (z1 - 0.12), sz * z1), x, S + 0.08, 0.017, 8);
        const men = i % 4 === 0 ? 1 : i % 4 === 3 ? 3 : i % 4 === 1 ? 2 : 3;
        for (let m = 0; m < men; m++) {
          const mz = (m - (men - 1) / 2) * 0.17;
          // a player: legs and a foot to kick with, a shirt over the rod, a head (SPEC 16.17.2)
          const team: MatSpec = i % 2 === 0 ? ACCENT_RED : ACCENT_BLUE;
          parts.box('foos-men', team, x - 0.011, x + 0.011, S + 0.006, S + 0.05, mz - 0.016, mz + 0.016, { c: 0.003 });
          parts.box('foos-men', team, x - 0.014, x + 0.014, S + 0.048, S + 0.086, mz - 0.022, mz + 0.022, { c: 0.006 });
          if (q.tier !== 'low') parts.put('foos-heads', { key: 'plastic', tint: '#E9C9A4' }, new THREE.SphereGeometry(0.011, 8, 5).translate(x, S + 0.088, mz));
        }
      }
      parts.put('foos-ball', { key: 'gloss', tint: '#F4F2EC' }, new THREE.SphereGeometry(0.017, 12, 8).translate(0.07, S + 0.018, 0.05));
      // the white centre line and circle on the field, the goal mouths at the ends
      slab(parts, 'foos-lines', { key: 'white' }, -0.003, 0.003, S + 0.001, S + 0.0016, -bodyZ + 0.07, bodyZ - 0.07);
      parts.put('foos-lines', { key: 'white' }, new THREE.RingGeometry(0.075, 0.081, 32).rotateX(-Math.PI / 2).translate(0, S + 0.0016, 0));
      for (const sx of [-1, 1]) slab(parts, 'foos-goals', { key: 'dark', tint: '#141414' }, sx > 0 ? x1 - 0.002 : -x1 - 0.0, sx > 0 ? x1 : -x1 + 0.002, S - 0.08, S - 0.01, -0.1, 0.1);
    },
    'chess-set': () => {
      // a chess table: a 60 cm square top with the 8 x 8 board let in, a four-tube frame, and a chair at each end facing it
      const board = 0.46, sq = board / 8, t = 0.3;
      slab(parts, 'chess-top', wood, -t, t, S - 0.035, S, -t, t);
      // SPEC 16.17.2: the board and men are the Poly Haven chess set (CC0) when it is here, scaled so the king stands inside the piece's height
      const model = propGeo('chess', q.tier);
      noteProp(parts, 'chess', !!model);
      if (model) {
        const info = propInfo('chess');
        const k = Math.min(0.5 / info.dims.w, (H - S - 0.002) / info.dims.h);
        addTextured(parts.group, model, 'chess-set-model', k, [0, S, 0]);
      } else {
      slab(parts, 'chess-light', { key: 'laminate', tint: '#E8D9B5' }, -board / 2, board / 2, S, S + 0.0006, -board / 2, board / 2);
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) slab(parts, 'chess-dark', { key: 'laminate', tint: '#6B4A2B' }, -board / 2 + c * sq, -board / 2 + (c + 1) * sq, S, S + 0.0012, -board / 2 + r * sq, -board / 2 + (r + 1) * sq);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) tube(parts, 'chess-legs', FRAME_GREY, [sx * (t - 0.04), 0, sz * (t - 0.04)], [sx * (t - 0.04), S - 0.035, sz * (t - 0.04)], 0.016);
      for (let c = 0; c < 8; c++) for (const sz of [-1, 1]) cylY(parts, 'chess-men', sz < 0 ? { key: 'laminate', tint: '#2A1D12' } : { key: 'laminate', tint: '#F1E6CC' }, -board / 2 + (c + 0.5) * sq, sz * (board / 2 - sq * 0.5), S, S + 0.03, 0.017, 8);
      }
      const c0 = z1 - 0.26;
      chairAt(parts, roles, 0, c0, 0, 0.82);
      chairAt(parts, roles, 0, -c0, Math.PI, 0.82);
    },
    'card-set': () => {
      // a square folding card table (green baize on a steel apron, four folding legs) with a chair on each side, set in under the top
      const t = 0.425, c0 = x1 - 0.26;
      slab(parts, 'card-top', { key: 'laminate', tint: '#3B3F45' }, -t, t, S - 0.04, S, -t, t);
      slab(parts, 'card-baize', { key: 'weave', tint: '#2C6B4B' }, -t + 0.03, t - 0.03, S, S + 0.0008, -t + 0.03, t - 0.03);
      slab(parts, 'card-apron', FRAME, -t + 0.05, t - 0.05, S - 0.07, S - 0.04, -t + 0.05, t - 0.05);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) tube(parts, 'card-legs', FRAME_GREY, [sx * (t - 0.06), 0, sz * (t - 0.06)], [sx * (t - 0.06), S - 0.07, sz * (t - 0.06)], 0.013);
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; chairAt(parts, roles, c0 * Math.sin(a), c0 * Math.cos(a), a, 0.82); }
    },
    'carrom-set': () => {
      // a carrom board in its wooden frame (85 cm, the playing surface 74 cm, four pockets, the circles) on a four-leg stand, and a round stool at each side
      const t = 0.425, bt = S, c0 = x1 - 0.17;
      const top = carromBoard(t, bt);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) slab(parts, 'carrom-legs', WOOD_ASH, sx * (t - 0.05) - 0.03, sx * (t - 0.05) + 0.03, 0, top, sz * (t - 0.05) - 0.03, sz * (t - 0.05) + 0.03);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2, sx = c0 * Math.sin(a), sz = c0 * Math.cos(a);
        cylY(parts, 'stool-seat', roleOr(roles, SEAT_FABRIC, 'hallChair'), sx, sz, 0.41, 0.46, 0.17, seg);
        for (let k = 0; k < 3; k++) { const b = (k * 2 * Math.PI) / 3 + a; tube(parts, 'stool-legs', FRAME_GREY, [sx + Math.cos(b) * 0.13, 0, sz + Math.sin(b) * 0.13], [sx + Math.cos(b) * 0.11, 0.41, sz + Math.sin(b) * 0.11], 0.011); }
      }
    },
    'banquet-set': () => {
      // a 120 cm round banquet table with four stacking chairs set in at the diagonals, each facing the table (the symbol a plan draws)
      const tr = 0.6;
      cylY(parts, 'table-top', roleOr(roles, CLOTH, 'tablecloth'), 0, 0, 0.7, S, tr, seg * 2);
      cylY(parts, 'table-cloth-skirt', roleOr(roles, CLOTH, 'tablecloth'), 0, 0, 0.25, 0.7, tr - 0.004, seg * 2);
      cylY(parts, 'table-apron', FRAME, 0, 0, 0.67, 0.7, tr - 0.08, 16);
      tube(parts, 'table-legs', FRAME_GREY, [0, 0, 0], [0, 0.67, 0], 0.03);
      cylY(parts, 'table-legs', FRAME_GREY, 0, 0, 0, 0.02, 0.28, 12);
      const R = (w / 2 - 0.346) / Math.SQRT1_2 + 0.0184;
      for (let i = 0; i < 4; i++) chairAt(parts, roles, R * Math.sin((i * Math.PI) / 2 + Math.PI / 4), R * Math.cos((i * Math.PI) / 2 + Math.PI / 4), (i * Math.PI) / 2 + Math.PI / 4, H);
    },
    'cafe-set': () => {
      // a 70 cm round café table with two chairs at its two ends (along x), each facing it
      cylY(parts, 'table-top', roleOr(roles, { key: 'laminate', tint: '#E9E6DF' }, 'top'), 0, 0, S - 0.03, S, 0.35, seg);
      tube(parts, 'table-legs', FRAME_GREY, [0, 0, 0], [0, S - 0.03, 0], 0.025);
      cylY(parts, 'table-legs', FRAME_GREY, 0, 0, 0, 0.02, 0.22, 12);
      const cx = w / 2 - 0.26;
      for (const sgn of [-1, 1]) chairAt(parts, roles, sgn * cx, 0, sgn > 0 ? Math.PI / 2 : -Math.PI / 2, H, true);
    },
  };
  build[v]();
  void H; void d; void soft;
  return parts.done();
}

/**
 * A banquet chair at (x, z) turned `a` radians about the vertical, its back at -z before the turn (so the seat faces the point it is turned
 * towards) (SPEC 16.17.2, 22 Nov 2026): a brushed steel tube frame (four legs, back posts bent into the back frame, side rails), an upholstered
 * seat cushion and a padded back. `plain` (the café sets): a black steel bistro chair with a slatted back and no upholstery.
 */
function chairAt(parts: Parts, roles: Roles, x: number, z: number, a: number, H: number, plain = false): void {
  const yaw = a + Math.PI;
  const q = parts.env.q;
  const seatM: MatSpec = plain ? { key: 'powder', tint: '#2B2D31' } : roleOr(roles, SEAT_FABRIC, 'hallChair');
  const frame: MatSpec = plain ? { key: 'powder', tint: '#2B2D31' } : { key: 'metal', tint: '#B9BDC2' };
  const S = 0.46;
  const out: [string, MatSpec, THREE.BufferGeometry][] = [];
  const sides = q.tier === 'high' ? 8 : 6;
  const rod = (name: string, A: [number, number, number], B: [number, number, number], r: number): void => {
    const va = new THREE.Vector3(...A), vb = new THREE.Vector3(...B);
    const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), sides, 1, false);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
    g.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
    out.push([name, frame, g]);
  };
  const cushion = (name: string, w: number, h: number, d: number, cx: number, cy: number, cz: number, tilt = 0): void => {
    const g = q.tier === 'low' ? new THREE.BoxGeometry(w, h, d) : softCushion(w, h, d, { r: Math.min(0.02, h / 2.2), puff: 0.004, seg: 2 });
    if (tilt) g.rotateX(tilt);
    g.translate(cx, cy, cz);
    out.push([name, seatM, g]);
  };
  const r = 0.0105, lx = 0.2;
  for (const sx of [-1, 1]) {
    rod('chair-legs', [sx * lx, 0, 0.22], [sx * (lx - 0.005), S - 0.05, 0.2], r);
    rod('chair-legs', [sx * lx, 0, -0.23], [sx * (lx - 0.005), S - 0.05, -0.2], r);
    rod('chair-rails', [sx * (lx - 0.005), S - 0.055, -0.2], [sx * (lx - 0.005), S - 0.055, 0.2], r * 0.85);
    // the back post leans back a little and runs up to the top rail
    rod('chair-back-posts', [sx * (lx - 0.005), S - 0.05, -0.2], [sx * lx, H - 0.0105, -0.2495], r);
  }
  rod('chair-rails', [-lx, H - 0.0105, -0.2495], [lx, H - 0.0105, -0.2495], r);
  rod('chair-rails', [-(lx - 0.005), 0.16, 0.21], [lx - 0.005, 0.16, 0.21], r * 0.8);
  if (plain) {
    // a bistro seat pan and three back slats
    out.push(['chair-seat', seatM, (q.tier === 'low' ? new THREE.BoxGeometry(0.46, 0.02, 0.46) : softCushion(0.46, 0.02, 0.46, { r: 0.008, puff: 0.001, seg: 2 })).translate(0, S - 0.01, 0.03)]);
    for (let i = 0; i < 3; i++) { const y = H - 0.08 - i * 0.07; rod('chair-back-slats', [-(lx - 0.012), y, -0.25 + i * 0.006], [lx - 0.012, y, -0.25 + i * 0.006], 0.008); }
  } else {
    cushion('chair-seat', 0.46, 0.06, 0.46, 0, S - 0.03, 0.03);
    cushion('chair-back', 0.38, 0.24, 0.045, 0, H - 0.15, -0.225, 0.1);
  }
  for (const [n, m, g] of out) { g.rotateY(yaw); g.translate(x, 0, z); parts.put(n, m, g, { tile: 0.4 }); }
}
