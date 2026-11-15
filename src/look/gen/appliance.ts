// Appliances and fitness: fridges (single door, double door, side by side), washing machines (front and top load), wall water purifier,
// microwave on a stand, geysers (15 and 25 L), exhaust fan, treadmill, ironing board (open), yoga mat, planter box and pot.
// The footprint of a fridge or washer includes the gap it asks for behind it (air, hoses); the generator draws a spacer or hoses to the back
// of that gap, so the bounding box is the box. Wall-mounted pieces stand `liftM` above the floor.
import * as THREE from 'three';
import { roundedBoxBetween } from '../furniture-parts';
import { Parts, role, roleOr } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { prism, roundedRectOutline, rod } from './geo';
import { CHROME, GLASS, LEAF, RUBBER, SOIL, bar, disc, post, rsides } from './kit';

const WHITE: MatSpec = { key: 'gloss', tint: '#E8E8E6' };
const BLACK: MatSpec = { key: 'blackMetal', tint: '#1B1C1E' };
const SCREEN: MatSpec = { key: 'granite', tint: '#101216' };

export const APPLIANCE_VARIANTS = ['fridge-1', 'fridge-2', 'fridge-sbs', 'washer-front', 'washer-top', 'purifier', 'microwave', 'geyser-15', 'geyser-25', 'exhaust'] as const;
export type ApplianceVariant = (typeof APPLIANCE_VARIANTS)[number];
export interface ApplianceParams { variant: ApplianceVariant; liftM: number }
export const APPLIANCE_DEFAULTS: ApplianceParams = { variant: 'fridge-1', liftM: 0 };

export function buildAppliance(env: GenEnv, size: GenSize, p: ApplianceParams, roles: Roles): THREE.Group {
  const { w, d, h: H } = size;
  const v = (APPLIANCE_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'fridge-1';
  const parts = new Parts(env, 'gen:appliance');
  const q = env.q;
  const bodyM = roleOr(roles, WHITE, 'applianceBody');
  const trim = roleOr(roles, CHROME, 'applianceTrim');
  const box = (name: string, m: MatSpec, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c = 0.003): void => parts.box(name, m, x0, x1, y0, y1, z0, z1, { c });

  if (v.startsWith('fridge')) {
    const gap = 0.05;
    const bz0 = -d / 2 + gap, bz1 = d / 2;
    const feet = 0.03;
    const zb = bz1 - 0.05;                       // the body's front; the doors are the last 5 cm, handles end at the box's front
    parts.put('fridge-body', bodyM, roundedBoxBetween(-w / 2, w / 2, feet, H, bz0, zb, 0.012, q.seg));
    box('fridge-feet', BLACK, -w / 2 + 0.03, w / 2 - 0.03, 0, feet + 0.005, bz0 + 0.04, zb - 0.04, 0);
    // rear spacers and the condenser grille: the 5 cm gap the fridge needs to breathe, drawn to the back of the footprint
    for (const s of [-1, 1]) box('fridge-spacers', BLACK, s * (w / 2 - 0.06) - 0.025, s * (w / 2 - 0.06) + 0.025, H - 0.1, H - 0.04, -d / 2, bz0 + 0.002, 0.001);
    box('fridge-spacers', BLACK, -w / 2 + 0.06, w / 2 - 0.06, 0.2, 0.22, -d / 2, bz0 + 0.002, 0.001);
    const zd = bz1 - 0.03, hz = bz1 - 0.012;
    const door = (x0: number, x1: number, y0: number, y1: number): void => parts.put('fridge-doors', bodyM, roundedBoxBetween(x0, x1, y0, y1, zb - 0.002, zd, 0.012, q.seg));
    const handle = (x: number, y0: number, y1: number): void => {
      bar(parts, 'fridge-handles', trim, [x, y0, hz], [x, y1, hz], 0.011);
      for (const y of [y0 + 0.02, y1 - 0.02]) bar(parts, 'fridge-handles', trim, [x, y, zd - 0.001], [x, y, hz], 0.006);
    };
    if (v === 'fridge-1') {
      door(-w / 2 + 0.004, w / 2 - 0.004, feet + 0.01, H - 0.01);
      handle(w / 2 - 0.05, H * 0.35, H * 0.72);
    } else if (v === 'fridge-2') {
      const split = H * 0.64;
      door(-w / 2 + 0.004, w / 2 - 0.004, feet + 0.01, split - 0.004);
      door(-w / 2 + 0.004, w / 2 - 0.004, split + 0.004, H - 0.01);
      handle(w / 2 - 0.05, split + 0.1, H - 0.15);
      handle(w / 2 - 0.05, split - 0.55, split - 0.12);
    } else {
      door(-w / 2 + 0.004, -0.003, feet + 0.01, H - 0.01);
      door(0.003, w / 2 - 0.004, feet + 0.01, H - 0.01);
      for (const x of [-0.04, 0.04]) handle(x, H * 0.35, H * 0.75);
      box('fridge-display', SCREEN, -w / 2 + 0.08, -w / 2 + 0.3, H * 0.62, H * 0.62 + 0.18, zd, zd + 0.004, 0.001);
    }
  } else if (v === 'washer-front') {
    const gap = 0.1;
    const bz0 = -d / 2 + gap, bz1 = d / 2;
    const zb = bz1 - 0.03;
    parts.put('washer-body', bodyM, roundedBoxBetween(-w / 2, w / 2, 0.02, H, bz0, zb, 0.015, q.seg));
    for (const s of [-1, 1]) box('washer-feet', BLACK, s * (w / 2 - 0.06) - 0.025, s * (w / 2 - 0.06) + 0.025, 0, 0.025, bz0 + 0.04, zb - 0.05, 0);
    // door: a chrome ring, dark glass, a gasket
    const cy = 0.42, R = 0.2;
    const ring = new THREE.TorusGeometry(R, 0.015, 8, rsides(env) * 2).translate(0, cy, bz1 - 0.015);
    parts.put('washer-door', trim, ring);
    parts.put('washer-door-glass', GLASS, new THREE.CylinderGeometry(R, R, 0.01, rsides(env) * 2).rotateX(Math.PI / 2).translate(0, cy, bz1 - 0.017));
    parts.put('washer-door-glass', SCREEN, new THREE.CylinderGeometry(R - 0.04, R - 0.04, 0.012, rsides(env) * 2).rotateX(Math.PI / 2).translate(0, cy, zb));
    // control strip with a dial and a display
    box('washer-panel', roleOr(roles, { key: 'blackMetal', tint: '#2A2C30' }, 'appliancePanel'), -w / 2 + 0.02, w / 2 - 0.02, H - 0.13, H - 0.03, zb - 0.002, bz1 - 0.022, 0.001);
    parts.put('washer-dial', trim, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12).rotateX(Math.PI / 2).translate(-w / 2 + 0.1, H - 0.08, bz1 - 0.012));
    box('washer-panel', SCREEN, w / 2 - 0.2, w / 2 - 0.07, H - 0.105, H - 0.055, bz1 - 0.022, bz1 - 0.02, 0);
    // the two hoses and the plug at the back, to the back of the footprint
    for (const s of [-1, 1]) bar(parts, 'washer-hoses', RUBBER, [s * 0.14, 0.7, bz0], [s * 0.14, 0.7, -d / 2 + 0.012], 0.014);
    parts.put('washer-hoses', RUBBER, new THREE.CylinderGeometry(0.02, 0.02, 0.014, 8).rotateX(Math.PI / 2).translate(0, 0.45, -d / 2 + 0.007));
  } else if (v === 'washer-top') {
    const gap = 0.1;
    const bz0 = -d / 2 + gap, bz1 = d / 2;
    const bodyTop = H - 0.1;
    parts.put('washer-body', bodyM, roundedBoxBetween(-w / 2, w / 2, 0.02, bodyTop, bz0, bz1, 0.015, q.seg));
    for (const s of [-1, 1]) box('washer-feet', BLACK, s * (w / 2 - 0.06) - 0.025, s * (w / 2 - 0.06) + 0.025, 0, 0.025, bz0 + 0.04, bz1 - 0.05, 0);
    // the lid, and the control panel raised along the back, which sets the item's height
    parts.put('washer-lid', trim, roundedBoxBetween(-w / 2 + 0.03, w / 2 - 0.03, bodyTop, bodyTop + 0.025, bz0 + 0.15, bz1 - 0.02, 0.008, 1));
    parts.put('washer-lid', GLASS, roundedBoxBetween(-w / 2 + 0.07, w / 2 - 0.07, bodyTop + 0.025, bodyTop + 0.03, bz0 + 0.19, bz1 - 0.06, 0.002, 1));
    parts.put('washer-panel', bodyM, roundedBoxBetween(-w / 2, w / 2, bodyTop, H, bz0, bz0 + 0.14, 0.012, q.seg));
    box('washer-panel', SCREEN, -w / 2 + 0.06, -w / 2 + 0.2, H - 0.06, H - 0.02, bz0 + 0.14 - 0.001, bz0 + 0.14 + 0.002, 0);
    parts.put('washer-dial', trim, new THREE.CylinderGeometry(0.025, 0.025, 0.02, 12).rotateX(Math.PI / 2).translate(w / 2 - 0.12, H - 0.04, bz0 + 0.15));
    for (const s of [-1, 1]) bar(parts, 'washer-hoses', RUBBER, [s * 0.13, 0.6, bz0], [s * 0.13, 0.6, -d / 2 + 0.012], 0.014);
  } else if (v === 'purifier') {
    const y0 = p.liftM;
    parts.put('purifier-body', bodyM, roundedBoxBetween(-w / 2, w / 2, y0, H, -d / 2, d / 2, 0.025, q.seg));
    box('purifier-trim', { key: 'laminate', tint: '#2F6FA8' }, -w / 2 + 0.02, w / 2 - 0.02, y0 + 0.07, y0 + 0.09, d / 2 - 0.001, d / 2 + 0.0, 0);
    parts.put('purifier-display', SCREEN, roundedBoxBetween(-0.05, 0.05, H - 0.13, H - 0.07, d / 2 - 0.004, d / 2 + 0.002, 0.003, 1));
    parts.put('purifier-tap', trim, rod({ x: 0, y: y0 + 0.02, z: d / 2 - 0.05 }, { x: 0, y: y0 + 0.02, z: d / 2 - 0.0 }, 0.012, 8));
  } else if (v === 'microwave') {
    const standH = 0.85;
    const legM = roleOr(roles, BLACK, 'applianceBase');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('stand-legs', legM, sx * (w / 2 - 0.03) - 0.015, sx * (w / 2 - 0.03) + 0.015, 0, standH, sz * (d / 2 - 0.03) - 0.015, sz * (d / 2 - 0.03) + 0.015, 0.001);
    for (const y of [0.25, 0.55]) box('stand-shelves', legM, -w / 2, w / 2, y, y + 0.02, -d / 2, d / 2, 0.002);
    box('stand-shelves', legM, -w / 2, w / 2, standH - 0.03, standH, -d / 2, d / 2, 0.003);
    const mw = 0.5, mx0 = -mw / 2, mz0 = -d / 2 + 0.03, mz1 = d / 2 - 0.05, my0 = standH, my1 = H;
    parts.put('microwave-body', bodyM, roundedBoxBetween(mx0, mx0 + mw, my0, my1, mz0, mz1, 0.012, q.seg));
    box('microwave-door', SCREEN, mx0 + 0.015, mx0 + 0.33, my0 + 0.025, my1 - 0.025, mz1 - 0.001, mz1 + 0.006, 0.001);
    box('microwave-panel', roleOr(roles, { key: 'blackMetal', tint: '#2A2C30' }, 'appliancePanel'), mx0 + 0.35, mx0 + mw - 0.01, my0 + 0.025, my1 - 0.025, mz1 - 0.001, mz1 + 0.004, 0.001);
    bar(parts, 'microwave-handle', trim, [mx0 + 0.335, my0 + 0.05, mz1 + 0.02], [mx0 + 0.335, my1 - 0.05, mz1 + 0.02], 0.007);
    parts.put('microwave-dial', trim, new THREE.CylinderGeometry(0.02, 0.02, 0.016, 10).rotateX(Math.PI / 2).translate(mx0 + 0.42, my0 + 0.14, mz1 + 0.01));
  } else if (v === 'geyser-15' || v === 'geyser-25') {
    const y0 = p.liftM, hb = H - y0;
    const body = new THREE.CylinderGeometry(1, 1, hb - 0.06, rsides(env) * 2).scale(w / 2, 1, d / 2).translate(0, y0 + 0.03 + (hb - 0.06) / 2, 0);
    parts.put('geyser-body', bodyM, body);
    // domed top and bottom caps, a blue light, the two pipes under it
    for (const [yy, sgn] of [[y0 + hb - 0.03, 1], [y0 + 0.03, -1]] as const) {
      const cap = new THREE.SphereGeometry(1, rsides(env) * 2, 4, 0, Math.PI * 2, sgn > 0 ? 0 : Math.PI / 2, Math.PI / 2).scale(w / 2, 0.03, d / 2).translate(0, yy, 0);
      parts.put('geyser-caps', bodyM, cap);
    }
    parts.put('geyser-light', { key: 'lamp', tint: '#6FB7FF' }, new THREE.SphereGeometry(0.012, 8, 6).translate(w * 0.18, y0 + 0.07, d / 2 - 0.005));
    for (const s of [-1, 1]) bar(parts, 'geyser-pipes', trim, [s * w * 0.2, y0 + 0.03, 0], [s * w * 0.2, y0, 0], 0.011);
    box('geyser-bracket', BLACK, -w * 0.3, w * 0.3, y0 + hb * 0.8, y0 + hb * 0.8 + 0.03, -d / 2, -d / 2 + 0.008, 0.001);
  } else {
    // exhaust fan: a square frame to the wall, a round grille, blades
    const y0 = p.liftM;
    parts.put('fan-frame', bodyM, roundedBoxBetween(-w / 2, w / 2, y0, H, -d / 2, d / 2, 0.008, 1));
    const gr = new THREE.CylinderGeometry(w * 0.4, w * 0.4, 0.006, rsides(env) * 2).rotateX(Math.PI / 2).translate(0, (y0 + H) / 2, d / 2 + 0.0);
    parts.put('fan-grille', SCREEN, gr);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const blade = new THREE.BoxGeometry(w * 0.34, 0.03, 0.004).translate(w * 0.17, 0, 0).rotateZ(a).translate(0, (y0 + H) / 2, d / 2 - 0.004);
      parts.put('fan-blades', bodyM, blade);
    }
    parts.put('fan-hub', trim, new THREE.CylinderGeometry(0.02, 0.02, 0.01, 8).rotateX(Math.PI / 2).translate(0, (y0 + H) / 2, d / 2 - 0.004));
  }
  return parts.done();
}

// ---------------------------------------------------------------- fitness and utility

export const FIT_VARIANTS = ['treadmill', 'yoga', 'ironing'] as const;
export type FitVariant = (typeof FIT_VARIANTS)[number];
export interface FitParams { variant: FitVariant }
export const FIT_DEFAULTS: FitParams = { variant: 'treadmill' };

export function buildFit(env: GenEnv, size: GenSize, p: FitParams, roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (FIT_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'treadmill';
  const parts = new Parts(env, 'gen:fit');
  const q = env.q;
  const bodyM = roleOr(roles, { key: 'laminate', tint: '#2B2D31' }, 'applianceBody');
  const trim = roleOr(roles, CHROME, 'applianceTrim');
  if (v === 'treadmill') {
    // the console end is -z (back to the wall): a motor hood, two uprights to the console, hand rails along the sides; the belt runs to +z
    const deckY0 = 0.1, deckY1 = S;
    parts.put('tread-deck', bodyM, roundedBoxBetween(-w / 2, w / 2, deckY0, deckY1 - 0.03, -d / 2 + 0.25, d / 2, 0.02, q.seg));
    parts.box('tread-belt', RUBBER, -w / 2 + 0.1, w / 2 - 0.1, deckY1 - 0.03, deckY1, -d / 2 + 0.3, d / 2 - 0.02, { c: 0.002 });
    for (const s of [-1, 1]) parts.box('tread-side-rails', { key: 'laminate', tint: '#D9D9D6' }, s > 0 ? w / 2 - 0.07 : -w / 2, s > 0 ? w / 2 : -w / 2 + 0.07, deckY0, deckY1, -d / 2 + 0.3, d / 2, { c: 0.003 });
    parts.put('tread-hood', bodyM, roundedBoxBetween(-w / 2, w / 2, 0.02, 0.3, -d / 2, -d / 2 + 0.32, 0.03, q.seg));
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.025);
      bar(parts, 'tread-uprights', trim, [x, 0.25, -d / 2 + 0.12], [x, 1.18, -d / 2 + 0.12], 0.02);
      bar(parts, 'tread-handrails', trim, [x, 1.0, -d / 2 + 0.12], [x, 0.98, -d / 2 + 0.75], 0.018);
    }
    parts.put('tread-console', bodyM, roundedBoxBetween(-w / 2 + 0.1, w / 2 - 0.1, 1.1, H, -d / 2 + 0.05, -d / 2 + 0.2, 0.025, q.seg));
    parts.box('tread-console', SCREEN, -0.15, 0.15, 1.16, H - 0.04, -d / 2 + 0.2 - 0.001, -d / 2 + 0.2 + 0.003, { c: 0 });
    bar(parts, 'tread-handrails', trim, [-w / 2 + 0.025, 1.18, -d / 2 + 0.12], [w / 2 - 0.025, 1.18, -d / 2 + 0.12], 0.018);
  } else if (v === 'yoga') {
    parts.put('yoga-mat', role(roles, 'accent', 'case'), roundedBoxBetween(-w / 2, w / 2, 0, H, -d / 2, d / 2, Math.min(0.0024, H / 2.2), 1), { tile: 0.5 });
  } else {
    // ironing board: a rounded-tip top on a crossed frame, an iron rest at the narrow end
    const topY = S;
    const out = roundedRectOutline(-w / 2, w / 2, -d / 2, d / 2, [d / 2, 0.03, 0.03, d / 2], env.q.tier === 'low' ? 4 : 8);
    parts.put('iron-top', roleOr(roles, { key: 'cotton', tint: '#E8DFD0' }, 'case'), prism(out, topY - 0.035, topY, 0.012), { tile: 0.4 });
    parts.put('iron-top-pad', { key: 'dark', tint: '#6C6F74' }, prism(roundedRectOutline(-w / 2 + 0.01, w / 2 - 0.01, -d / 2 + 0.01, d / 2 - 0.01, [d / 2, 0.03, 0.03, d / 2], 4), topY - 0.05, topY - 0.035, 0));
    const xl = w / 2 - 0.2;
    for (const s of [-1, 1]) {
      const xf = s * (xl - 0.15), xb = s * (xl + 0.15);
      bar(parts, 'iron-legs', trim, [xf, 0.02, -0.14], [xb - s * 0.1, topY - 0.06, 0.14], 0.012);
      bar(parts, 'iron-legs', trim, [xb, 0.02, -0.14], [xf + s * 0.1, topY - 0.06, 0.14], 0.012);
      bar(parts, 'iron-legs', trim, [xf, 0.02, -0.14], [xb, 0.02, -0.14], 0.01);
    }
    bar(parts, 'iron-legs', trim, [-xl, topY - 0.07, 0], [xl, topY - 0.07, 0], 0.008);
    parts.put('iron-rest', trim, roundedBoxBetween(-w / 2 + 0.02, -w / 2 + 0.18, topY - 0.07, topY - 0.05, -0.1, 0.1, 0.005, 1));
  }
  void H; void d;
  return parts.done();
}

// ---------------------------------------------------------------- planters

export const OUTDOOR_VARIANTS = ['box', 'pot'] as const;
export type OutdoorVariant = (typeof OUTDOOR_VARIANTS)[number];
export interface OutdoorParams { variant: OutdoorVariant }
export const OUTDOOR_DEFAULTS: OutdoorParams = { variant: 'box' };

export function buildOutdoor(env: GenEnv, size: GenSize, p: OutdoorParams, roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const parts = new Parts(env, 'gen:outdoor');
  const pot = role(roles, 'case', 'accent');
  const q = env.q;
  const seg = Math.max(8, q.sides);
  const blob = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): void => {
    parts.put('plant-leaves', LEAF, new THREE.SphereGeometry(1, seg, 6).scale(rx, ry, rz).translate(cx, cy, cz), { tile: 0.3 });
  };
  if (p.variant === 'pot') {
    const r = w / 2;
    const g = new THREE.CylinderGeometry(r, r * 0.72, S - 0.02, rsides(env) * 2, 1, false).translate(0, (S - 0.02) / 2 + 0.02, 0);
    parts.put('pot-body', pot, g);
    disc(parts, 'pot-base', pot, 0, 0, 0, 0.02, r * 0.72);
    disc(parts, 'pot-soil', SOIL, 0, 0, S - 0.02, S, r - 0.02);
    // a bushy plant: five blobs, the tallest reaching the item's height
    const top = H;
    blob(0, top - 0.2, 0, 0.17, 0.2, 0.17);
    blob(0.07, S + 0.17, 0.03, 0.12, 0.17, 0.12);
    blob(-0.07, S + 0.19, -0.04, 0.12, 0.19, 0.12);
    blob(0.0, S + 0.12, 0.09, 0.1, 0.12, 0.1);
    blob(-0.03, S + 0.14, -0.1, 0.1, 0.14, 0.1);
    // keep the top blob exactly at the height: it is centred at top - 0.2 with a 0.2 radius
    void roundedBoxBetween;
  } else {
    const lip = 0.02;
    parts.box('planter-box', pot, -w / 2, w / 2, 0.02, S, -d / 2, d / 2, { c: 0.004 });
    parts.box('planter-box', pot, -w / 2 + 0.03, w / 2 - 0.03, 0, 0.02, -d / 2 + 0.03, d / 2 - 0.03, { c: 0.001 });
    parts.box('planter-soil', SOIL, -w / 2 + lip, w / 2 - lip, S - 0.04, S + 0.002, -d / 2 + lip, d / 2 - lip, { c: 0 });
    const n = Math.max(3, Math.round(w / 0.22));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.12 + (i / (n - 1)) * (w - 0.24);
      const hh = (H - S) * (0.55 + 0.45 * (((i * 7) % 5) / 4));
      blob(x, S + hh * 0.55, 0, 0.1, Math.max(0.04, hh * 0.5), d / 2 - 0.035);
    }
    // one blob reaches the item's height exactly
    blob(0, H - 0.07, 0, 0.1, 0.07, d / 2 - 0.035);
  }
  void post;
  return parts.done();
}
