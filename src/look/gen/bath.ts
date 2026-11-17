// Sanitary ware and the kitchen sink: western commode (floor-mounted with cistern, wall-hung), Indian squat pan, health faucet, wash basins
// (wall-hung, pedestal), vanities (counter-top basin, with mirror), overhead shower with mixer and arm, hand shower, shower enclosure and glass
// partition, bathtub, towel rail, floor drain and the kitchen sinks (single and double bowl). Ceramic is white gloss, taps are chrome (the
// viewer picks the fittings finish). Footprint and heights are exactly the item's; a wall-mounted piece stands `liftM` above the floor.
import * as THREE from 'three';
import { roundedBoxBetween } from '../furniture-parts';
import { Parts, role, roleOr, shade } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { loft, prism, roundedRectOutline, rod, roundedRun } from './geo';
import type { LoftSection } from './geo';
import { CERAMIC, CHROME, GLASS, MIRROR, bar, disc, frontPanel, rsides, zfOf } from './kit';

export const BATH_VARIANTS = [
  'wc-floor', 'wc-wall', 'wc-indian', 'health', 'basin-wall', 'basin-pedestal', 'vanity-60', 'vanity-mirror',
  'shower-over', 'shower-hand', 'enclosure', 'partition', 'tub', 'towel', 'drain', 'sink-single', 'sink-double',
] as const;
export type BathVariant = (typeof BATH_VARIANTS)[number];
export interface BathParams { variant: BathVariant; liftM: number }
export const BATH_DEFAULTS: BathParams = { variant: 'wc-floor', liftM: 0 };

const DARK_WATER: MatSpec = { key: 'dark', tint: '#4B5258' };
const STEEL: MatSpec = { key: 'metal', tint: '#C9CCCF' };

export function buildBath(env: GenEnv, size: GenSize, p: BathParams, roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (BATH_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'wc-floor';
  const parts = new Parts(env, 'gen:bath');
  const q = env.q;
  const seg = rsides(env) * 2;
  const ceramic = roleOr(roles, CERAMIC, 'ceramic');
  const tap = roleOr(roles, CHROME, 'fittings');
  const lift = p.liftM;
  const rr = (x0: number, x1: number, z0: number, z1: number, r: number): [number, number][] => roundedRectOutline(x0, x1, z0, z1, [r, r, r, r], q.tier === 'low' ? 4 : 8);
  const box = (name: string, m: MatSpec, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c = 0.003): void => parts.box(name, m, x0, x1, y0, y1, z0, z1, { c });
  /** an ellipsoid with exact radii, centre (cx, cy, cz) */
  const ell = (name: string, m: MatSpec, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): void =>
    parts.put(name, m, new THREE.SphereGeometry(1, seg, Math.max(6, seg / 2)).scale(rx, ry, rz).translate(cx, cy, cz));
  /** a run of tap: straight rods of the radii given (the lower tiers), one smooth tube round rounded corners at 2K (the same points, so the reach is the same) */
  const run = (name: string, pts: [number, number, number][], radii: number[]): void => {
    if (q.ultra) { parts.put(name, tap, roundedRun(pts, radii.reduce((a, b) => a + b, 0) / radii.length * 0.96, 0.028, 24)); return; }
    for (let i = 0; i + 1 < pts.length; i++) bar(parts, name, tap, pts[i], pts[i + 1], radii[Math.min(i, radii.length - 1)]);
  };
  const nLoft = q.ultra ? 72 : q.tier === 'low' ? 16 : 32;
  /** a wall tap: a spout from the wall plane out `reach`, at height y, with a lever */
  const faucet = (x: number, y: number, z: number, up: number, reach: number): void => {
    run('tap', [[x, y, z], [x, y + up, z], [x, y + up, z + reach], [x, y + up - 0.03, z + reach]], [0.011, 0.009, 0.008]);
    parts.put('tap-lever', tap, q.ultra ? roundedBoxBetween(x - 0.05, x + 0.05, y + up * 0.55 - 0.007, y + up * 0.55 + 0.007, z - 0.007, z + 0.007, 0.0055, 3) : new THREE.BoxGeometry(0.1, 0.012, 0.012).translate(x, y + up * 0.55, z - 0.0).rotateY(0));
    parts.put('tap-base', tap, new THREE.CylinderGeometry(0.03, 0.036, 0.02, q.ultra ? 36 : 10).translate(x, y + 0.01, z));
  };

  if (v === 'wc-floor') {
    const hw = w / 2;
    const n = q.tier === 'low' ? 16 : 32;
    const put = (name: string, sec: LoftSection[]): void => { const l = loft(sec, q.ultra ? 72 : n); parts.put(name, ceramic, l.body); parts.put(name, ceramic, l.cap); };
    // the pan: one lofted body, a narrow foot widening to the rim; the seat and lid are a second, flatter loft on top, the cistern stands on the back
    const zf = d / 2 - 0.36;
    put('wc-pan', [
      { y: 0, w: 0.2, d: 0.34, zc: zf - 0.02, p: 2.4 },
      { y: 0.12, w: 0.3, d: 0.5, zc: zf + 0.04, p: 2.4 },
      { y: 0.28, w: Math.min(w, 0.37), d: 0.62, zc: zf + 0.05, p: 2.6 },
      { y: S - 0.03, w: Math.min(w, 0.38), d: Math.min(d - 0.06, 0.66), zc: zf + 0.03, p: 2.8 },
    ]);
    put('wc-seat', [
      { y: S - 0.03, w: Math.min(w, 0.38), d: Math.min(d - 0.06, 0.66), zc: zf + 0.03, p: 2.8 },
      { y: S - 0.012, w: Math.min(w, 0.385), d: Math.min(d - 0.055, 0.665), zc: zf + 0.03, p: 2.8 },
      { y: S, w: Math.min(w, 0.34), d: Math.min(d - 0.1, 0.6), zc: zf + 0.03, p: 3 },
    ]);
    parts.put('wc-cistern', ceramic, roundedBoxBetween(-hw + 0.01, hw - 0.01, S - 0.04, H - 0.022, -d / 2, -d / 2 + 0.2, 0.025, q.seg));
    parts.put('wc-cistern-lid', ceramic, roundedBoxBetween(-hw, hw, H - 0.026, H - 0.004, -d / 2, -d / 2 + 0.205, 0.008, 1));
    for (const x of [-0.035, 0.035]) box('wc-flush', tap, x - 0.025, x + 0.025, H - 0.006, H, -d / 2 + 0.085, -d / 2 + 0.115, 0.002);
    for (const sx of [-1, 1]) disc(parts, 'wc-hinge', tap, sx * (hw - 0.07), -d / 2 + 0.215, S, S + 0.014, 0.011);
  } else if (v === 'wc-wall') {
    const hw = w / 2;
    const bz = d / 2 - 0.27;
    ell('wc-pan', ceramic, 0, lift + 0.06, bz, hw - 0.015, 0.06, 0.27);
    parts.put('wc-body', ceramic, roundedBoxBetween(-hw + 0.02, hw - 0.02, lift + 0.03, S - 0.025, -d / 2, d / 2 - 0.12, 0.03, q.seg));
    parts.put('wc-seat', ceramic, prism(rr(-hw, hw, -d / 2 + 0.03, d / 2 - 0.02, 0.17), S - 0.025, S, 0.008));
    // the concealed cistern's flush plate on the wall behind, and two buttons
    box('wc-plate', roleOr(roles, CHROME, 'fittings'), -0.11, 0.11, 0.95, H, -d / 2, -d / 2 + 0.012, 0.002);
    for (const x of [-0.045, 0.045]) box('wc-buttons', ceramic, x - 0.03, x + 0.03, H - 0.09, H - 0.03, -d / 2 + 0.012, -d / 2 + 0.018, 0.001);
  } else if (v === 'wc-indian') {
    parts.put('squat-pan', ceramic, prism(rr(-w / 2, w / 2, -d / 2, d / 2, 0.08), 0, H - 0.01, 0.006));
    parts.put('squat-hole', DARK_WATER, prism(rr(-0.09, 0.09, -d / 2 + 0.06, 0.1, 0.07), H - 0.012, H - 0.002, 0));
    for (const s of [-1, 1]) box('squat-feet', ceramic, s * 0.12 - 0.05, s * 0.12 + 0.05, H - 0.012, H, d / 2 - 0.2, d / 2 - 0.06, 0.003);
  } else if (v === 'health') {
    // a holder on the wall, the spray head in it, the hose looping down
    box('hf-bracket', tap, -w / 2, w / 2, H - 0.07, H, -d / 2, -d / 2 + 0.012, 0.002);
    box('hf-holder', tap, -0.04, 0.04, lift + 0.12, lift + 0.15, -d / 2, d / 2 - 0.0, 0.003);
    parts.put('hf-spray', tap, new THREE.CylinderGeometry(0.014, 0.022, 0.12, 8).translate(0, lift + 0.1, d / 2 - 0.05));
    parts.put('hf-spray-top', ceramic, new THREE.CylinderGeometry(0.022, 0.022, 0.03, 8).translate(0, H - 0.015, -d / 2 + 0.05));
    bar(parts, 'hf-hose', tap, [0, lift + 0.04, d / 2 - 0.05], [0, lift, d / 2 - 0.05], 0.007);
    bar(parts, 'hf-hose', tap, [0, H - 0.05, -d / 2 + 0.05], [0, H - 0.05, -d / 2 + 0.01], 0.006);
  } else if (v === 'basin-wall' || v === 'basin-pedestal') {
    const y0 = v === 'basin-wall' ? lift : 0.7;
    // the bowl: one lofted body from a narrow base to the rim, a darker recess, a low back splash and a deck-mounted tap
    const put = (name: string, sec: LoftSection[]): void => { const l = loft(sec, nLoft); parts.put(name, ceramic, l.body); parts.put(name, ceramic, l.cap); };
    put('basin-bowl', [
      { y: y0, w: w * 0.5, d: d * 0.45, zc: -d * 0.1, p: 2.6 },
      { y: y0 + (S - y0) * 0.45, w: w * 0.88, d: d * 0.86, zc: -d * 0.02, p: 3 },
      { y: S - 0.012, w, d, zc: 0, p: 3.3 },
      { y: S, w: w * 0.985, d: d * 0.985, zc: 0, p: 3.4 },
    ]);
    parts.put('basin-recess', shade(ceramic, 0.82), prism(rr(-w / 2 + 0.07, w / 2 - 0.07, -d / 2 + 0.1, d / 2 - 0.06, 0.13), S + 0.0004, S + 0.0014, 0));
    box('basin-splash', ceramic, -w / 2 + 0.01, w / 2 - 0.01, S - 0.01, S + 0.035, -d / 2, -d / 2 + 0.03, 0.01);
    const tz = -d / 2 + 0.075;
    parts.put('tap-base', tap, new THREE.CylinderGeometry(0.03, 0.034, 0.022, q.ultra ? 36 : 16).translate(0, S + 0.011, tz));
    run('tap', [[0, S + 0.01, tz], [0, S + 0.085, tz], [0, S + 0.085, tz + 0.1], [0, S + 0.06, tz + 0.1]], [0.012, 0.0095, 0.008]);
    parts.put('tap-lever', tap, q.ultra ? roundedBoxBetween(-0.03, 0.03, S + 0.065, S + 0.075, tz - 0.026, tz - 0.014, 0.004, 3) : new THREE.BoxGeometry(0.06, 0.01, 0.012).translate(0, S + 0.07, tz - 0.02));
    disc(parts, 'basin-drain', tap, 0, 0.02, S + 0.0014, S + 0.0024, 0.02);
    if (v === 'basin-pedestal') {
      const zp = -d / 2 + 0.12;
      put('basin-pedestal', [
        { y: 0, w: 0.22, d: 0.24, zc: zp, p: 3 },
        { y: 0.045, w: 0.14, d: 0.14, zc: zp, p: 3 },
        { y: 0.5, w: 0.11, d: 0.12, zc: zp, p: 3 },
        { y: y0 + 0.03, w: 0.2, d: 0.2, zc: zp, p: 3 },
      ]);
    }
  } else if (v === 'vanity-60') {
    const cabH = 0.78, leg = 0.08;
    const wood = role(roles, 'case'), face = role(roles, 'drawerFront', 'case'), hm = role(roles, 'handle'), topM = role(roles, 'top', 'case');
    box('vanity-plinth', role(roles, 'plinth', 'handle'), -w / 2 + 0.03, w / 2 - 0.03, 0, leg, -d / 2 + 0.03, d / 2 - 0.05, 0);
    box('vanity-carcass', wood, -w / 2, w / 2, leg, cabH, -d / 2, zfOf(d, 'bar') - 0.014);
    for (const [x0, x1] of [[-w / 2 + 0.01, -0.002], [0.002, w / 2 - 0.01]]) frontPanel(parts, 'vanity-doors', face, hm, x0, x1, leg + 0.01, cabH - 0.01, zfOf(d, 'bar'), 'bar', 0.016);
    box('vanity-top', topM, -w / 2, w / 2, cabH, cabH + 0.02, -d / 2, d / 2, 0.004);
    // a vessel basin on the counter: an ellipsoid bowl whose rim is the item's `s`
    const bh = S - (cabH + 0.02);
    ell('vessel-bowl', ceramic, 0, cabH + 0.02 + bh / 2, 0.02, 0.21, bh / 2, 0.17);
    ell('vessel-water', shade(ceramic, 0.8), 0, S - 0.001, 0.02, 0.16, 0.002, 0.12);
    const ty = S, tz = -d / 2 + 0.07;
    run('tap', [[0, cabH + 0.02, tz], [0, H - 0.012, tz], [0, H - 0.012, tz + 0.12], [0, H - 0.05, tz + 0.12]], [0.012, 0.01, 0.009]);
    void ty;
  } else if (v === 'vanity-mirror') {
    const cabH = 0.8, leg = 0.1;
    const wood = role(roles, 'case'), face = role(roles, 'drawerFront', 'case'), hm = role(roles, 'handle'), topM = role(roles, 'top', 'case');
    box('vanity-plinth', role(roles, 'plinth', 'handle'), -w / 2 + 0.03, w / 2 - 0.03, 0, leg, -d / 2 + 0.03, d / 2 - 0.05, 0);
    box('vanity-carcass', wood, -w / 2, w / 2, leg, cabH, -d / 2, zfOf(d, 'bar') - 0.014);
    const dw = (w - 0.02 - 0.003) / 2;
    frontPanel(parts, 'vanity-doors', face, hm, -w / 2 + 0.01, -w / 2 + 0.01 + dw, leg + 0.01, cabH - 0.01, zfOf(d, 'bar'), 'bar', 0.016);
    for (let i = 0; i < 2; i++) frontPanel(parts, 'vanity-drawers', face, hm, w / 2 - 0.01 - dw, w / 2 - 0.01, leg + 0.01 + i * ((cabH - leg - 0.02) / 2 + 0.0015), leg + 0.01 + i * ((cabH - leg - 0.02) / 2 + 0.0015) + (cabH - leg - 0.02) / 2 - 0.0015, zfOf(d, 'bar'), 'bar', 0.016);
    box('vanity-top', topM, -w / 2, w / 2, cabH, S, -d / 2, d / 2, 0.004);
    parts.put('vanity-basin', ceramic, prism(rr(-0.2, 0.2, -d / 2 + 0.07, d / 2 - 0.08, 0.1), S - 0.0005, S + 0.0005, 0));
    disc(parts, 'vanity-basin', shade(ceramic, 0.78), 0, 0.0, S + 0.0004, S + 0.0012, 0.14, { sx: 1, sz: 0.85 });
    faucet(0, S, -d / 2 + 0.06, 0.1, 0.1);
    // the mirror on the wall above, with a light bar to the item's height
    const mw = w - 0.12, my0 = 1.05, my1 = H - 0.08;
    box('mirror-frame', role(roles, 'plinth', 'handle'), -mw / 2 - 0.02, mw / 2 + 0.02, my0 - 0.02, my1 + 0.02, -d / 2, -d / 2 + 0.03, 0.002);
    box('mirror-glass', MIRROR, -mw / 2, mw / 2, my0, my1, -d / 2 + 0.03, -d / 2 + 0.034, 0);
    parts.put('mirror-light', { key: 'lamp' }, new THREE.BoxGeometry(mw, 0.035, 0.05).translate(0, H - 0.0175, -d / 2 + 0.03 + 0.0));
    box('mirror-light', role(roles, 'plinth', 'handle'), -mw / 2 - 0.02, mw / 2 + 0.02, H - 0.07, H - 0.067, -d / 2, -d / 2 + 0.06, 0.001);
  } else if (v === 'shower-over') {
    const wall = -d / 2;
    box('shower-plate', tap, -0.06, 0.06, lift, lift + 0.2, wall, wall + 0.016, 0.003);
    parts.put('shower-knob', tap, new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12).rotateX(Math.PI / 2).translate(0, lift + 0.1, wall + 0.03));
    if (q.ultra) run('shower-riser', [[0, lift + 0.2, wall + 0.012], [0, H - 0.01, wall + 0.012], [0, H - 0.01, d / 2 - 0.15]], [0.01]);
    else {
      bar(parts, 'shower-riser', tap, [0, lift + 0.2, wall + 0.012], [0, H - 0.01, wall + 0.012], 0.01);
      bar(parts, 'shower-arm', tap, [0, H - 0.01, wall + 0.012], [0, H - 0.01, d / 2 - 0.15], 0.01);
    }
    disc(parts, 'shower-head', tap, 0, d / 2 - 0.15, H - 0.07, H - 0.04, w / 2);
    disc(parts, 'shower-head', { key: 'dark', tint: '#8A8D90' }, 0, d / 2 - 0.15, H - 0.0705, H - 0.07, w / 2 - 0.02);
    bar(parts, 'shower-arm', tap, [0, H - 0.04, d / 2 - 0.15], [0, H - 0.01, d / 2 - 0.15], 0.012);
  } else if (v === 'shower-hand') {
    bar(parts, 'rail', tap, [0, lift, -d / 2 + 0.02], [0, H, -d / 2 + 0.02], 0.01);
    for (const y of [lift, H - 0.03]) box('rail-brackets', tap, -0.025, 0.025, y, y + 0.03, -d / 2, -d / 2 + 0.04, 0.002);
    parts.put('hand-shower', tap, new THREE.CylinderGeometry(0.022, 0.022, 0.17, 8).translate(0, lift + 0.4, -d / 2 + 0.07));
    parts.put('hand-shower-head', tap, new THREE.CylinderGeometry(0.03, 0.022, 0.03, 10).translate(0, lift + 0.5, -d / 2 + 0.07));
    box('hand-shower-clip', tap, -0.02, 0.02, lift + 0.33, lift + 0.36, -d / 2 + 0.02, -d / 2 + 0.07, 0.001);
    bar(parts, 'hose', tap, [0, lift + 0.32, -d / 2 + 0.07], [0.02, lift + 0.05, -d / 2 + 0.05], 0.006);
  } else if (v === 'enclosure') {
    const frame = roleOr(roles, CHROME, 'fittings');
    const tray = 0.05;
    parts.put('tray', ceramic, prism(rr(-w / 2, w / 2, -d / 2, d / 2, 0.01), 0, tray, 0.004));
    parts.put('tray-drain', DARK_WATER, prism(rr(-0.05, 0.05, -0.05, 0.05, 0.04), tray - 0.0005, tray + 0.0015, 0));
    // glass: the door panel on the front, a fixed panel on the right, and wall channels on the left and back
    const th = 0.008;
    box('frame', frame, -w / 2, w / 2, H - 0.025, H, d / 2 - 0.025, d / 2, 0.001);
    box('frame', frame, w / 2 - 0.025, w / 2, H - 0.025, H, -d / 2, d / 2, 0.001);
    box('frame', frame, -w / 2, -w / 2 + 0.02, tray, H, -d / 2, -d / 2 + 0.02, 0.001);
    box('frame', frame, -w / 2, -w / 2 + 0.02, tray, H, d / 2 - 0.02, d / 2, 0.001);
    box('frame', frame, w / 2 - 0.02, w / 2, tray, H, d / 2 - 0.02, d / 2, 0.001);
    box('frame', frame, w / 2 - 0.02, w / 2, tray, H, -d / 2, -d / 2 + 0.02, 0.001);
    box('glass', GLASS, -w / 2 + 0.02, w / 2 - 0.02, tray, H - 0.025, d / 2 - 0.016, d / 2 - 0.016 + th, 0);
    box('glass', GLASS, w / 2 - 0.016, w / 2 - 0.016 + th, tray, H - 0.025, -d / 2 + 0.02, d / 2 - 0.02, 0);
    bar(parts, 'handle', frame, [-0.05, 0.95, d / 2 + 0.0], [-0.05, 1.25, d / 2 + 0.0], 0.009);
    for (const y of [0.97, 1.23]) bar(parts, 'handle', frame, [-0.05, y, d / 2 - 0.012], [-0.05, y, d / 2], 0.005);
  } else if (v === 'partition') {
    const frame = roleOr(roles, CHROME, 'fittings');
    box('channel', frame, -w / 2, w / 2, 0, 0.02, -d / 2, d / 2, 0.001);
    box('glass', GLASS, -w / 2 + 0.005, w / 2 - 0.005, 0.02, H, -0.004, 0.004, 0);
    box('wall-bar', frame, -w / 2, -w / 2 + 0.02, 0.02, H, -d / 2, d / 2, 0.001);
    bar(parts, 'support', frame, [0, H - 0.01, -0.0], [0, H - 0.01, 0.0], 0.001);
    bar(parts, 'support', frame, [w / 2 - 0.03, H - 0.01, 0], [w / 2 - 0.03, H - 0.01, 0], 0.001);
    box('top-rail', frame, -w / 2, w / 2, H - 0.012, H, -d / 2 + 0.02, d / 2 - 0.02, 0.001);
  } else if (v === 'tub') {
    parts.put('tub-skirt', shade(ceramic, 0.88), prism(rr(-w / 2 + 0.01, w / 2 - 0.01, -d / 2 + 0.01, d / 2 - 0.01, 0.07), 0, 0.1, 0));
    parts.put('tub-shell', ceramic, prism(rr(-w / 2, w / 2, -d / 2, d / 2, 0.1), 0.1, S, 0.015));
    parts.put('tub-inner', shade(ceramic, 0.84), prism(rr(-w / 2 + 0.07, w / 2 - 0.07, -d / 2 + 0.07, d / 2 - 0.07, 0.14), S - 0.0005, S + 0.0005, 0));
    // the tap on the left end, on the rim
    run('tap', [[-w / 2 + 0.12, S, 0], [-w / 2 + 0.12, H - 0.02, 0], [-w / 2 + 0.24, H - 0.02, 0]], [0.014, 0.012]);
    disc(parts, 'tub-drain', tap, w / 2 - 0.2, 0, S, S + 0.002, 0.03);
  } else if (v === 'towel') {
    const y0 = lift;
    for (const s of [-1, 1]) box('rail-ends', tap, s > 0 ? w / 2 - 0.02 : -w / 2, s > 0 ? w / 2 : -w / 2 + 0.02, y0, H, -d / 2, d / 2, 0.002);
    for (const y of [y0 + 0.1, H - 0.1]) bar(parts, 'rail-bars', tap, [-w / 2 + 0.02, y, 0.0], [w / 2 - 0.02, y, 0.0], 0.0105);
    bar(parts, 'rail-bars', tap, [-w / 2 + 0.02, (y0 + H) / 2, 0.0], [w / 2 - 0.02, (y0 + H) / 2, 0.0], 0.0105);
  } else if (v === 'drain') {
    box('drain-plate', tap, -w / 2, w / 2, 0, H, -d / 2, d / 2, 0);
    parts.put('drain-grid', DARK_WATER, prism(rr(-w / 2 + 0.03, w / 2 - 0.03, -d / 2 + 0.03, d / 2 - 0.03, 0.03), H - 0.0005, H + 0.0007, 0));
    for (const x of [-0.025, 0, 0.025]) box('drain-grid-bars', tap, x - 0.003, x + 0.003, H, H + 0.001, -d / 2 + 0.03, d / 2 - 0.03, 0);
  } else {
    // kitchen sink on a base unit: steel top with one or two bowls and a drainboard, a tall tap
    const double = v === 'sink-double';
    const wood = role(roles, 'case'), face = role(roles, 'drawerFront', 'case'), hm = role(roles, 'handle');
    const unitH = 0.8, leg = 0.08;
    box('sink-plinth', role(roles, 'plinth', 'handle'), -w / 2 + 0.03, w / 2 - 0.03, 0, leg, -d / 2 + 0.03, d / 2 - 0.05, 0);
    box('sink-carcass', wood, -w / 2, w / 2, leg, unitH, -d / 2, zfOf(d, 'bar') - 0.014);
    const n = double ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const dw = (w - 0.02 - 0.003 * (n - 1)) / n;
      const x0 = -w / 2 + 0.01 + i * (dw + 0.003);
      frontPanel(parts, 'sink-doors', face, hm, x0, x0 + dw, leg + 0.01, unitH - 0.01, zfOf(d, 'bar'), 'bar', 0.016);
    }
    const bw = 0.42, bd = 0.38;
    const bowls = double ? [-w / 2 + 0.07 + bw / 2, -w / 2 + 0.07 + bw + 0.08 + bw / 2] : [-w / 2 + 0.07 + bw / 2 + 0.0];
    if (q.ultra) {
      // 2K: the top is a slab with the bowls cut out of it (the carcass top is the bowl's floor, 4.8 cm down), steel walls, a drain at the bottom
      let x = -w / 2;
      for (const cx of bowls) { if (cx - bw / 2 > x + 0.001) box('sink-top', STEEL, x, cx - bw / 2, unitH, S, -d / 2, d / 2, 0.003); x = cx + bw / 2; }
      if (w / 2 > x + 0.001) box('sink-top', STEEL, x, w / 2, unitH, S, -d / 2, d / 2, 0.003);
      const fl = unitH + 0.003, wall = 0.003;
      for (const cx of bowls) {
        box('sink-top', STEEL, cx - bw / 2, cx + bw / 2, unitH, S, -d / 2, -bd / 2, 0.003);
        box('sink-top', STEEL, cx - bw / 2, cx + bw / 2, unitH, S, bd / 2, d / 2, 0.003);
        box('sink-bowl-walls', STEEL, cx - bw / 2, cx - bw / 2 + wall, fl, S - 0.001, -bd / 2, bd / 2, 0);
        box('sink-bowl-walls', STEEL, cx + bw / 2 - wall, cx + bw / 2, fl, S - 0.001, -bd / 2, bd / 2, 0);
        box('sink-bowl-walls', STEEL, cx - bw / 2, cx + bw / 2, fl, S - 0.001, -bd / 2, -bd / 2 + wall, 0);
        box('sink-bowl-walls', STEEL, cx - bw / 2, cx + bw / 2, fl, S - 0.001, bd / 2 - wall, bd / 2, 0);
        box('sink-bowl-floor', STEEL, cx - bw / 2, cx + bw / 2, unitH, fl, -bd / 2, bd / 2, 0);
        disc(parts, 'sink-drain', DARK_WATER, cx, 0, fl, fl + 0.0012, 0.03);
        disc(parts, 'sink-drain', STEEL, cx, 0, fl + 0.0012, fl + 0.0026, 0.024);
      }
    } else {
      box('sink-top', STEEL, -w / 2, w / 2, unitH, S, -d / 2, d / 2, 0.003);
      for (const cx of bowls) {
        parts.put('sink-bowl', DARK_WATER, prism(rr(cx - bw / 2, cx + bw / 2, -bd / 2 + 0.0, bd / 2, 0.03), S - 0.0006, S + 0.0006, 0));
        disc(parts, 'sink-drain', STEEL, cx, 0, S + 0.0005, S + 0.0016, 0.025);
      }
    }
    // the drainboard ridges on the right
    const dx0 = bowls[bowls.length - 1] + bw / 2 + 0.06;
    for (let x = dx0; x < w / 2 - 0.05; x += 0.035) box('sink-ridges', { key: 'metal', tint: '#A9ADB1' }, x, x + 0.012, S, S + 0.002, -d / 2 + 0.06, d / 2 - 0.06, 0);
    // tap on the back edge, between the bowls
    const tx = double ? (bowls[0] + bowls[1]) / 2 : bowls[0] + bw / 2 + 0.03, tz = -d / 2 + 0.07;
    run('tap', [[tx, S, tz], [tx, H - 0.014, tz], [tx, H - 0.014, tz + 0.2], [tx, H - 0.06, tz + 0.2]], [0.014, 0.012, 0.011]);
    parts.put('tap-lever', tap, new THREE.BoxGeometry(0.012, 0.012, 0.07).translate(tx + 0.03, S + 0.07, tz));
    parts.put('tap-top', tap, new THREE.SphereGeometry(0.014, 8, 6).translate(tx, H - 0.014, tz));
  }
  void H; void rod; void S; void d;
  return parts.done();
}
