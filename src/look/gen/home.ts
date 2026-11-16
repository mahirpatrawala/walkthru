// Storage and tables of an Indian home: TV unit with a wall-mounted TV, the cabinet family (shoe rack, pooja unit floor and wall, bookshelf, chest
// of drawers, crockery unit, sideboard, steel almirah, ceiling-height loft) and the table family (centre tables, round dining set, computer
// desk, dressing table with mirror and stool, kids desk). Each is a function of the item's footprint and heights plus a variant name; the bounding
// box is the box and the total height is the item's height (SPEC 16.2 rule 1).
import * as THREE from 'three';
import { Parts, role, roleOr } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { rod } from './geo';
import { CERAMIC, CHROME, GLASS, MIRROR, bar, disc, frontPanel, post, rsides, zfOf } from './kit';
import type { HandleStyle } from './kit';

const GAP = 0.003;

// ---------------------------------------------------------------- TV unit

export interface TvUnitParams { base: 'legs' | 'plinth'; handle: HandleStyle; tvW: number; tvH: number }
export const TVUNIT_DEFAULTS: TvUnitParams = { base: 'legs', handle: 'groove', tvW: 0.95, tvH: 0.54 };

export function buildTvUnit(env: GenEnv, size: GenSize, p: TvUnitParams, roles: Roles): THREE.Group {
  const { w, d, s: S } = size;
  const parts = new Parts(env, 'gen:tvunit');
  const body = role(roles, 'case'), face = role(roles, 'drawerFront', 'case'), hm = role(roles, 'handle'), dark = role(roles, 'plinth', 'handle'), topM = role(roles, 'top', 'case');
  const legH = p.base === 'legs' ? 0.12 : 0.05;
  if (p.base === 'legs') for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.put('tv-legs', body, rod({ x: sx * (w / 2 - 0.05), y: 0, z: sz * (d / 2 - 0.05) }, { x: sx * (w / 2 - 0.045), y: legH + 0.01, z: sz * (d / 2 - 0.045) }, 0.016, env.q.sides));
  else parts.box('tv-plinth', dark, -w / 2 + 0.03, w / 2 - 0.03, 0, legH, -d / 2 + 0.03, d / 2 - 0.04, { c: 0 });
  parts.box('tv-top', topM, -w / 2, w / 2, S - 0.025, S, -d / 2, d / 2, { c: 0.004, grain: 'x' });
  parts.box('tv-carcass', body, -w / 2, w / 2, legH, S - 0.025, -d / 2, zfOf(d, p.handle) - 0.014, { c: 0.002 });
  // two drawers either side of an open media niche
  const zf = zfOf(d, p.handle), y0 = legH + 0.01, y1 = S - 0.03;
  const nw = Math.min(0.5, w * 0.3);
  const dw = (w - nw - 2 * 0.02) / 2;
  frontPanel(parts, 'tv-drawers', face, hm, -w / 2 + 0.01, -w / 2 + 0.01 + dw - GAP, y0, y1, zf, p.handle, 0.016);
  frontPanel(parts, 'tv-drawers', face, hm, w / 2 - 0.01 - dw + GAP, w / 2 - 0.01, y0, y1, zf, p.handle, 0.016);
  parts.box('tv-niche', dark, -nw / 2, nw / 2, y0 + 0.01, y1 - 0.01, d / 2 - 0.2, zf, { c: 0 });
  // set-top box and a soundbar in the niche
  parts.box('tv-niche-kit', roleOr(roles, { key: 'blackMetal' }, 'tvBlack'), -nw / 2 + 0.05, nw / 2 - 0.05, y0 + 0.02, y0 + 0.06, d / 2 - 0.16, d / 2 - 0.05, { c: 0.002 });
  // the TV, on the wall above: a thin panel with a bezel and a slim stand-off from the wall
  const tvY0 = size.h - p.tvH;
  const tvBody: MatSpec = { key: 'blackMetal', tint: '#202225' };
  // a thin bezel (5 mm), a glossy screen that goes from a faint sky reflection at the top to deep blue-black at the bottom (four bands), and a
  // wall bracket behind the panel (its shadow lifts the TV off the wall)
  const bez = 0.005, zf0 = -d / 2 + 0.0455;
  parts.box('tv-panel', tvBody, -p.tvW / 2, p.tvW / 2, tvY0, size.h, -d / 2 + 0.02, -d / 2 + 0.045, { c: 0.003 });
  parts.box('tv-bracket', tvBody, -0.09, 0.09, tvY0 + p.tvH * 0.3, tvY0 + p.tvH * 0.7, -d / 2, -d / 2 + 0.02, { c: 0 });
  const bands = ['#39424D', '#242B34', '#171C23', '#10141A'];
  const x0 = -p.tvW / 2 + bez, x1 = p.tvW / 2 - bez, hh = (p.tvH - 2 * bez) / bands.length;
  bands.forEach((tint, i) => {
    const yb1 = size.h - bez - i * hh;
    parts.box('tv-screen', { key: 'gloss', tint }, x0, x1, yb1 - hh, yb1, zf0, zf0 + 0.0015, { c: 0 });
  });
  return parts.done();
}

// ---------------------------------------------------------------- cabinets

export const CABINET_VARIANTS = ['shoe', 'mandir-floor', 'mandir-wall', 'bookshelf', 'chest', 'crockery', 'sideboard', 'almirah', 'loft'] as const;
export type CabinetVariant = (typeof CABINET_VARIANTS)[number];
export interface CabinetParams { variant: CabinetVariant; handle: HandleStyle; liftM: number }
export const CABINET_DEFAULTS: CabinetParams = { variant: 'chest', handle: 'groove', liftM: 0 };

const STEEL_BODY: MatSpec = { key: 'laminate', tint: '#8E9CA6' };
const BOOKS: MatSpec[] = ['#8A3B3B', '#2F4B6E', '#C9A24B', '#4F6B52', '#D9D2C4', '#5B4A7A', '#B5651D'].map((tint) => ({ key: 'weave' as const, tint }));

/** `n` equal fronts side by side across x0..x1 */
function doors(p: Parts, name: string, face: MatSpec, hm: MatSpec, x0: number, x1: number, y0: number, y1: number, zf: number, n: number, handle: HandleStyle): void {
  const wd = (x1 - x0 - GAP * (n - 1)) / n;
  for (let i = 0; i < n; i++) frontPanel(p, name, face, hm, x0 + i * (wd + GAP), x0 + i * (wd + GAP) + wd, y0, y1, zf, handle, 0.016);
}

function bookRow(p: Parts, x0: number, x1: number, y: number, ymax: number, z0: number, z1: number, seed: number): void {
  let x = x0 + 0.01, k = seed;
  while (x < x1 - 0.05) {
    k = (k * 1103515245 + 12345) & 0x7fffffff;
    const t = 0.02 + (k % 5) * 0.006, hgt = Math.min(ymax - y - 0.03, 0.2 + ((k >> 4) % 6) * 0.02);
    if (x + t > x1 - 0.012) break;
    p.box('books', BOOKS[(k >> 8) % BOOKS.length], x, x + t, y, y + hgt, z0 + 0.02, z1 - 0.02, { c: 0 });
    x += t + 0.002;
    if ((k >> 12) % 9 === 0) x += 0.08;
  }
}

export function buildCabinet(env: GenEnv, size: GenSize, p: CabinetParams, roles: Roles): THREE.Group {
  const { w, d, h: H } = size;
  const v = (CABINET_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'chest';
  const parts = new Parts(env, `gen:cabinet`);
  const body = role(roles, 'case'), face = role(roles, 'drawerFront', 'case'), hm = role(roles, 'handle'), dark = role(roles, 'plinth', 'handle'), topM = role(roles, 'top', 'case');
  const t = 0.018;
  const hd: HandleStyle = v === 'chest' && p.handle === 'groove' ? 'knob' : p.handle;
  const zf = zfOf(d, hd), zc = zf - 0.014;
  const box = (name: string, m: MatSpec, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: { c?: number } = {}): void => parts.box(name, m, x0, x1, y0, y1, z0, z1, { c: o.c ?? 0.002 });

  if (v === 'shoe') {
    box('shoe-plinth', dark, -w / 2 + 0.03, w / 2 - 0.03, 0, 0.07, -d / 2 + 0.02, d / 2 - 0.03, { c: 0 });
    box('shoe-carcass', body, -w / 2, w / 2, 0.07, H, -d / 2, zc);
    const n = 3, fh = (H - 0.1 - 0.02 - GAP * (n - 1)) / n;
    for (let i = 0; i < n; i++) frontPanel(parts, 'shoe-flaps', face, hm, -w / 2 + 0.008, w / 2 - 0.008, 0.08 + i * (fh + GAP), 0.08 + i * (fh + GAP) + fh, zf, hd, 0.016);
  } else if (v === 'mandir-floor' || v === 'mandir-wall') {
    const y0 = v === 'mandir-wall' ? p.liftM : 0;
    const baseH = v === 'mandir-wall' ? 0.12 : 0.85;
    const ac = roleOr(roles, { key: 'brass' }, 'handle');
    if (v === 'mandir-floor') box('mandir-plinth', dark, -w / 2 + 0.02, w / 2 - 0.02, 0, 0.06, -d / 2 + 0.02, d / 2 - 0.03, { c: 0 });
    box('mandir-base', body, -w / 2, w / 2, y0 + (v === 'mandir-floor' ? 0.06 : 0), y0 + baseH, -d / 2, zc);
    if (v === 'mandir-floor') doors(parts, 'mandir-doors', face, hm, -w / 2 + 0.01, w / 2 - 0.01, 0.08, baseH - 0.04, zf, 2, hd);
    box('mandir-shelf', topM, -w / 2 - 0.0, w / 2, y0 + baseH, y0 + baseH + 0.025, -d / 2, d / 2, { c: 0.004 });
    const s0 = y0 + baseH + 0.025;
    // back panel, two pillars and the canopy with stepped roof and finial
    const pillarTop = s0 + (v === 'mandir-floor' ? 0.7 : 0.4);
    box('mandir-back', dark, -w / 2 + 0.03, w / 2 - 0.03, s0, pillarTop, -d / 2, -d / 2 + 0.02);
    for (const s of [-1, 1]) {
      box('mandir-pillars', body, s > 0 ? w / 2 - 0.07 : -w / 2 + 0.02, s > 0 ? w / 2 - 0.02 : -w / 2 + 0.07, s0, pillarTop, d / 2 - 0.1, d / 2 - 0.03);
      box('mandir-pillars', body, s > 0 ? w / 2 - 0.07 : -w / 2 + 0.02, s > 0 ? w / 2 - 0.02 : -w / 2 + 0.07, s0, pillarTop, -d / 2, -d / 2 + 0.07);
    }
    box('mandir-canopy', body, -w / 2, w / 2, pillarTop, pillarTop + 0.08, -d / 2, d / 2);
    const steps = v === 'mandir-floor' ? 3 : 2;
    let y = pillarTop + 0.08, ww = w * 0.86;
    const stepH = (H - 0.09 - y) / steps;
    for (let i = 0; i < steps; i++) { box('mandir-spire', body, -ww / 2, ww / 2, y, y + stepH, -d / 2 + 0.03 * (i + 1), d / 2 - 0.03 * (i + 1)); y += stepH; ww *= 0.65; }
    // brass finial to the exact height
    bar(parts, 'mandir-finial', ac, [0, y, 0], [0, H - 0.03, 0], 0.012);
    parts.put('mandir-finial', ac, new THREE.SphereGeometry(0.03, rsides(env), 6).translate(0, H - 0.03, 0));
    // an idol shelf: a small brass lamp and a bell
    parts.put('mandir-brass', ac, new THREE.CylinderGeometry(0.03, 0.04, 0.05, 8).translate(-w * 0.2, s0 + 0.025, d / 2 - 0.2));
    parts.put('mandir-brass', ac, new THREE.SphereGeometry(0.035, 8, 6).translate(w * 0.18, s0 + 0.035, d / 2 - 0.2));
  } else if (v === 'bookshelf') {
    const shelves = Math.max(3, Math.round((H - 0.06) / 0.34));
    box('shelf-side', body, -w / 2, -w / 2 + t, 0, H, -d / 2, d / 2);
    box('shelf-side', body, w / 2 - t, w / 2, 0, H, -d / 2, d / 2);
    box('shelf-back', dark, -w / 2 + t, w / 2 - t, 0.04, H - 0.02, -d / 2, -d / 2 + 0.01, { c: 0 });
    box('shelf-top', topM, -w / 2, w / 2, H - 0.025, H, -d / 2, d / 2, { c: 0.003 });
    box('shelf-base', body, -w / 2 + t, w / 2 - t, 0.04, 0.07, -d / 2 + 0.01, zc);
    const pitch = (H - 0.07 - 0.025) / shelves;
    for (let i = 0; i < shelves; i++) {
      const y = 0.07 + i * pitch;
      if (i > 0) box('shelf-boards', body, -w / 2 + t, w / 2 - t, y, y + 0.02, -d / 2 + 0.01, d / 2 - 0.005);
      if (env.q.tier !== 'low' || i % 2 === 0) bookRow(parts, -w / 2 + t, w / 2 - t, y + (i > 0 ? 0.02 : 0), y + pitch, -d / 2, d / 2, 7 + i * 31);
    }
  } else if (v === 'chest') {
    const leg = 0.08;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.put('chest-legs', body, rod({ x: sx * (w / 2 - 0.05), y: 0, z: sz * (d / 2 - 0.05) }, { x: sx * (w / 2 - 0.045), y: leg + 0.01, z: sz * (d / 2 - 0.045) }, 0.018, env.q.sides));
    box('chest-top', topM, -w / 2, w / 2, H - 0.025, H, -d / 2, d / 2, { c: 0.004 });
    box('chest-carcass', body, -w / 2 + 0.005, w / 2 - 0.005, leg, H - 0.025, -d / 2 + 0.005, zc);
    const n = 5, fh = (H - 0.025 - leg - 0.02 - GAP * (n - 1)) / n;
    for (let i = 0; i < n; i++) frontPanel(parts, 'chest-drawers', face, hm, -w / 2 + 0.012, w / 2 - 0.012, leg + 0.01 + i * (fh + GAP), leg + 0.01 + i * (fh + GAP) + fh, zf, hd, 0.016);
  } else if (v === 'crockery') {
    const lowH = 0.85, upY = 1.05;
    box('crock-plinth', dark, -w / 2 + 0.03, w / 2 - 0.03, 0, 0.07, -d / 2 + 0.02, d / 2 - 0.03, { c: 0 });
    box('crock-base', body, -w / 2, w / 2, 0.07, lowH, -d / 2, zc);
    doors(parts, 'crock-doors', face, hm, -w / 2 + 0.01, w / 2 - 0.01, 0.08, lowH - 0.02, zf, 2, hd);
    box('crock-counter', topM, -w / 2, w / 2, lowH, lowH + 0.03, -d / 2, d / 2, { c: 0.004 });
    // glass-fronted upper cabinet, a little shallower, with shelves
    const ud = d - 0.1, uz0 = -d / 2, uz1 = -d / 2 + ud;
    box('crock-upper', body, -w / 2, -w / 2 + t, upY, H, uz0, uz1);
    box('crock-upper', body, w / 2 - t, w / 2, upY, H, uz0, uz1);
    box('crock-upper', body, -w / 2, w / 2, H - t, H, uz0, uz1);
    box('crock-upper', body, -w / 2, w / 2, upY, upY + t, uz0, uz1);
    box('crock-upper-back', dark, -w / 2 + t, w / 2 - t, upY + t, H - t, uz0, uz0 + 0.01, { c: 0 });
    for (const y of [upY + 0.3, upY + 0.55]) box('crock-shelves', GLASS, -w / 2 + t, w / 2 - t, y, y + 0.008, uz0 + 0.01, uz1 - 0.02, { c: 0 });
    for (let i = 0; i < 3; i++) parts.put('crock-plates', CERAMIC, new THREE.CylinderGeometry(0.11, 0.11, 0.012, 14).rotateX(Math.PI / 2 - 0.2).translate(-w / 2 + 0.2 + i * 0.12, upY + 0.12, uz0 + 0.1));
    const n = 2, gw = (w - 2 * 0.012 - GAP) / n;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + 0.012 + i * (gw + GAP);
      for (const [a, b] of [[x0, x0 + 0.03], [x0 + gw - 0.03, x0 + gw]]) box('crock-glass-frames', face, a, b, upY + t, H - t, uz1 - 0.02, uz1 - 0.004, { c: 0.001 });
      box('crock-glass-frames', face, x0, x0 + gw, upY + t, upY + t + 0.03, uz1 - 0.02, uz1 - 0.004, { c: 0.001 });
      box('crock-glass-frames', face, x0, x0 + gw, H - t - 0.03, H - t, uz1 - 0.02, uz1 - 0.004, { c: 0.001 });
      box('crock-glass', GLASS, x0 + 0.03, x0 + gw - 0.03, upY + t + 0.03, H - t - 0.03, uz1 - 0.012, uz1 - 0.008, { c: 0 });
    }
  } else if (v === 'sideboard') {
    const leg = 0.12;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.put('side-legs', body, rod({ x: sx * (w / 2 - 0.06), y: 0, z: sz * (d / 2 - 0.06) }, { x: sx * (w / 2 - 0.05), y: leg + 0.01, z: sz * (d / 2 - 0.05) }, 0.02, env.q.sides));
    box('sideboard-top', topM, -w / 2, w / 2, H - 0.025, H, -d / 2, d / 2, { c: 0.004 });
    box('sideboard-carcass', body, -w / 2 + 0.005, w / 2 - 0.005, leg, H - 0.025, -d / 2 + 0.005, zc);
    const cw = w / 4;
    doors(parts, 'sideboard-doors', face, hm, -w / 2 + 0.012, -w / 2 + 0.012 + cw * 1.0 - GAP, leg + 0.01, H - 0.035, zf, 1, hd);
    doors(parts, 'sideboard-doors', face, hm, w / 2 - 0.012 - cw + GAP, w / 2 - 0.012, leg + 0.01, H - 0.035, zf, 1, hd);
    const mid0 = -w / 2 + 0.012 + cw, mid1 = w / 2 - 0.012 - cw;
    const hh = (H - 0.035 - leg - 0.01 - GAP) / 2;
    for (let i = 0; i < 2; i++) frontPanel(parts, 'sideboard-drawers', face, hm, mid0, mid1, leg + 0.01 + i * (hh + GAP), leg + 0.01 + i * (hh + GAP) + hh, zf, hd, 0.016);
  } else if (v === 'almirah') {
    const steel = roleOr(roles, STEEL_BODY, 'almirah');
    const chrome = roleOr(roles, CHROME, 'almirahHandle');
    const zd = d / 2 - 0.045;
    box('almirah-plinth', steel, -w / 2 + 0.01, w / 2 - 0.01, 0, 0.06, -d / 2 + 0.01, zd, { c: 0 });
    box('almirah-carcass', steel, -w / 2, w / 2, 0.06, H, -d / 2, zd);
    // two doors, each with two recessed panels, and a long chrome handle bar at the meeting edge (the bar ends at the box's front)
    const dw = (w - 0.02 - GAP) / 2;
    for (let i = 0; i < 2; i++) {
      const x0 = -w / 2 + 0.01 + i * (dw + GAP);
      box('almirah-doors', steel, x0, x0 + dw, 0.07, H - 0.01, zd, d / 2 - 0.025, { c: 0.002 });
      for (const [a0, b0] of [[0.2, 1.0], [1.05, H - 0.15]] as const) box('almirah-panels', STEEL_BODY, x0 + 0.05, x0 + dw - 0.05, a0, Math.min(b0, H - 0.15), d / 2 - 0.025, d / 2 - 0.021, { c: 0.001 });
      const hx = i === 0 ? x0 + dw - 0.04 : x0 + 0.04;
      parts.put('almirah-handles', chrome, rod({ x: hx, y: 0.85, z: d / 2 - 0.01 }, { x: hx, y: 1.2, z: d / 2 - 0.01 }, 0.008, 6));
      for (const y of [0.87, 1.18]) parts.put('almirah-handles', chrome, rod({ x: hx, y, z: d / 2 - 0.025 }, { x: hx, y, z: d / 2 - 0.01 }, 0.005, 6));
    }
    box('almirah-handles', chrome, -0.02, 0.02, 1.0, 1.06, d / 2 - 0.025, d / 2 - 0.019, { c: 0 });
  } else {
    // loft: a tall wardrobe with a loft row of doors above 1.95 m
    box('loft-plinth', dark, -w / 2 + 0.03, w / 2 - 0.03, 0, 0.07, -d / 2 + 0.02, d / 2 - 0.03, { c: 0 });
    box('loft-carcass', body, -w / 2, w / 2, 0.07, H, -d / 2, zc);
    const split = Math.min(H - 0.3, 1.95);
    doors(parts, 'loft-doors', face, hm, -w / 2 + 0.01, w / 2 - 0.01, 0.08, split - GAP, zf, 2, hd);
    doors(parts, 'loft-upper', face, hm, -w / 2 + 0.01, w / 2 - 0.01, split + GAP, H - 0.012, zf, 2, hd);
  }
  return parts.done();
}

// ---------------------------------------------------------------- tables

export const TABLE_VARIANTS = ['coffee-rect', 'coffee-round', 'dining-round', 'computer', 'dressing', 'kids-desk'] as const;
export type TableVariant = (typeof TABLE_VARIANTS)[number];
export interface TableXParams { variant: TableVariant; legs: 'square' | 'tapered' | 'metal'; handle: HandleStyle }
export const TABLEX_DEFAULTS: TableXParams = { variant: 'coffee-rect', legs: 'tapered', handle: 'groove' };

/** the geometry of one dining chair, centred on the origin on the floor, facing +z, turned `rotY` and moved to (cx, cz) */
function chairGeos(env: GenEnv, rotY: number, cx: number, cz: number, H: number): { wood: THREE.BufferGeometry[]; seat: THREE.BufferGeometry[] } {
  const wood: THREE.BufferGeometry[] = [], seat: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(cx, 0, cz);
  const mv = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.applyMatrix4(m);
  const sw = 0.44, sd = 0.42, sy = 0.45;
  for (const lx of [-1, 1]) for (const lz of [-1, 1]) wood.push(mv(rod({ x: lx * (sw / 2 - 0.03), y: 0, z: lz * (sd / 2 - 0.03) }, { x: lx * (sw / 2 - 0.03), y: sy - 0.04, z: lz * (sd / 2 - 0.03) }, 0.017, env.q.sides)));
  const b = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  seat.push(mv(b(-sw / 2, sw / 2, sy - 0.045, sy, -sd / 2, sd / 2)));
  const zb = -sd / 2 - 0.0;
  for (const lx of [-1, 1]) wood.push(mv(b(lx * (sw / 2 - 0.02) - 0.015, lx * (sw / 2 - 0.02) + 0.015, sy - 0.04, H, zb - 0.0, zb + 0.03)));
  wood.push(mv(b(-sw / 2, sw / 2, H - 0.07, H, zb - 0.0, zb + 0.03)));
  seat.push(mv(b(-sw / 2 + 0.04, sw / 2 - 0.04, sy + 0.12, sy + 0.34, zb + 0.005, zb + 0.025)));
  return { wood, seat };
}

export function buildTableX(env: GenEnv, size: GenSize, p: TableXParams, roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (TABLE_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'coffee-rect';
  const parts = new Parts(env, 'gen:tablex');
  const body = role(roles, 'case'), topM = role(roles, 'top', 'case'), legM = role(roles, 'legs', 'case'), fab = role(roles, 'fabric', 'accent'), hm = role(roles, 'handle'), face = role(roles, 'drawerFront', 'case'), dark = role(roles, 'plinth', 'handle');
  const q = env.q;
  const leg = (x: number, z: number, y1: number, r = 0.02): void => {
    if (p.legs === 'metal') parts.put('table-legs', legM, rod({ x, y: 0, z }, { x, y: y1, z }, r * 0.8, q.sides));
    else if (p.legs === 'tapered') parts.put('table-legs', legM, rod({ x, y: 0, z }, { x: x * 0.97, y: y1, z: z * 0.97 }, r, q.sides));
    else parts.box('table-legs', legM, x - r, x + r, 0, y1, z - r, z + r, { c: 0.002 });
  };

  if (v === 'coffee-rect') {
    parts.box('table-top', topM, -w / 2, w / 2, S - 0.03, S, -d / 2, d / 2, { c: 0.005, grain: 'x' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * (w / 2 - 0.045), sz * (d / 2 - 0.045), S - 0.03, 0.022);
    parts.box('table-shelf', body, -w / 2 + 0.07, w / 2 - 0.07, 0.13, 0.15, -d / 2 + 0.07, d / 2 - 0.07, { c: 0.003, grain: 'x' });
  } else if (v === 'coffee-round') {
    disc(parts, 'table-top', topM, 0, 0, S - 0.03, S, w / 2);
    disc(parts, 'table-shelf', body, 0, 0, 0.12, 0.14, w / 2 * 0.7);
    for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; const r = w / 2 - 0.1; parts.put('table-legs', legM, rod({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r }, { x: Math.cos(a) * (r - 0.05), y: S - 0.03, z: Math.sin(a) * (r - 0.05) }, 0.02, q.sides)); }
  } else if (v === 'dining-round') {
    const R = 0.45;
    disc(parts, 'table-top', topM, 0, 0, S - 0.03, S, R);
    post(parts, 'table-pedestal', legM, 0, 0, 0.03, S - 0.03, 0.07);
    disc(parts, 'table-pedestal', legM, 0, 0, 0, 0.03, 0.26);
    for (let i = 0; i < 4; i++) {
      const rot = i * (Math.PI / 2);
      const r = w / 2 - 0.21;
      // a chair at each quarter: back outward, seat tucked under the top; turned so its front faces the table
      const g = chairGeos(env, rot, Math.sin(rot) * -r, Math.cos(rot) * -r, H);
      for (const x of g.wood) parts.put('chair-wood', legM, x);
      for (const x of g.seat) parts.put('chair-pad', fab, x, { tile: 0.34 });
    }
  } else if (v === 'computer') {
    const topT = 0.03, cw = 0.4;
    parts.box('desk-top', topM, -w / 2, w / 2, S - topT, S, -d / 2, d / 2, { c: 0.004, grain: 'x' });
    // a drawer pedestal on the right, a panel on the left, a keyboard tray under the top
    parts.box('desk-carcass', body, w / 2 - cw, w / 2, 0.02, S - topT, -d / 2 + 0.02, d / 2 - 0.02, { c: 0.002 });
    for (let i = 0; i < 3; i++) frontPanel(parts, 'desk-drawers', face, hm, w / 2 - cw + 0.006, w / 2 - 0.006, 0.04 + i * 0.22, 0.04 + i * 0.22 + 0.2, zfOf(d, p.handle), p.handle, 0.016);
    parts.box('desk-carcass', body, -w / 2, -w / 2 + 0.02, 0, S - topT, -d / 2 + 0.02, d / 2 - 0.02, { c: 0.002 });
    parts.box('desk-tray', dark, -w / 2 + 0.05, w / 2 - cw - 0.03, S - topT - 0.06, S - topT - 0.04, -d / 2 + 0.12, d / 2 - 0.04, { c: 0.002 });
    parts.box('desk-carcass', body, -w / 2 + 0.02, w / 2 - cw, 0.3, S - topT, -d / 2 + 0.02, -d / 2 + 0.04, { c: 0.002 });
    // hutch: two uprights, a middle shelf and a top shelf
    for (const x of [-w / 2, w / 2 - 0.02]) parts.box('desk-hutch', body, x, x + 0.02, S, H, -d / 2, -d / 2 + 0.22, { c: 0.002 });
    parts.box('desk-hutch', body, -w / 2, w / 2, S + 0.27, S + 0.29, -d / 2, -d / 2 + 0.22, { c: 0.002 });
    parts.box('desk-hutch', topM, -w / 2, w / 2, H - 0.02, H, -d / 2, -d / 2 + 0.24, { c: 0.002 });
    parts.box('desk-hutch', body, -w / 2 + 0.02, w / 2 - 0.02, S, H - 0.02, -d / 2, -d / 2 + 0.01, { c: 0 });
  } else if (v === 'dressing') {
    const topT = 0.03, pw = 0.3;
    parts.box('table-top', topM, -w / 2, w / 2, S - topT, S, -d / 2, d / 2, { c: 0.004, grain: 'x' });
    for (const s of [-1, 1]) {
      const x0 = s > 0 ? w / 2 - pw : -w / 2, x1 = s > 0 ? w / 2 : -w / 2 + pw;
      parts.box('table-carcass', body, x0, x1, 0.05, S - topT, -d / 2 + 0.02, d / 2 - 0.02, { c: 0.002 });
      for (let i = 0; i < 3; i++) frontPanel(parts, 'table-drawers', face, hm, x0 + 0.006, x1 - 0.006, 0.07 + i * 0.2, 0.07 + i * 0.2 + 0.19, zfOf(d, 'knob'), 'knob', 0.016);
      parts.box('table-feet', dark, x0 + 0.02, x1 - 0.02, 0, 0.05, -d / 2 + 0.04, d / 2 - 0.04, { c: 0 });
    }
    parts.box('table-carcass', body, -w / 2 + pw, w / 2 - pw, S - topT - 0.1, S - topT, -d / 2 + 0.02, -d / 2 + 0.04, { c: 0.002 });
    // mirror: a frame and glass on the wall side, up to the item's height
    const mw = Math.min(0.8, w - 0.2), my0 = S + 0.2;
    parts.box('mirror-frame', body, -mw / 2 - 0.025, mw / 2 + 0.025, my0 - 0.025, H, -d / 2, -d / 2 + 0.03, { c: 0.002 });
    parts.box('mirror-glass', MIRROR, -mw / 2, mw / 2, my0, H - 0.025, -d / 2 + 0.03, -d / 2 + 0.034, { c: 0 });
    // the stool tucked in the knee space: four legs and a round pad
    const sy = 0.44;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.put('stool-legs', legM, rod({ x: sx * 0.11, y: 0, z: 0.02 + sz * 0.11 }, { x: sx * 0.12, y: sy - 0.06, z: 0.02 + sz * 0.12 }, 0.014, q.sides));
    disc(parts, 'stool-pad', fab, 0, 0.02, sy - 0.07, sy, 0.17);
  } else {
    // kids desk: desk top, two panels, a drawer, a hutch shelf with a rail
    const topT = 0.025;
    parts.box('desk-top', topM, -w / 2, w / 2, S - topT, S, -d / 2, d / 2, { c: 0.004, grain: 'x' });
    for (const s of [-1, 1]) parts.box('desk-carcass', body, s > 0 ? w / 2 - 0.02 : -w / 2, s > 0 ? w / 2 : -w / 2 + 0.02, 0, S - topT, -d / 2 + 0.02, d / 2 - 0.02, { c: 0.002 });
    parts.box('desk-carcass', body, -w / 2 + 0.02, w / 2 - 0.02, 0.28, S - topT, -d / 2 + 0.02, -d / 2 + 0.04, { c: 0.002 });
    frontPanel(parts, 'desk-drawers', face, hm, w / 2 - 0.4, w / 2 - 0.022, S - topT - 0.16, S - topT - 0.01, zfOf(d, 'knob'), 'knob', 0.016);
    parts.box('desk-carcass', body, w / 2 - 0.4, w / 2 - 0.02, 0.02, S - topT - 0.17, -d / 2 + 0.04, d / 2 - 0.03, { c: 0.002 });
    for (const x of [-w / 2, w / 2 - 0.02]) parts.box('desk-hutch', body, x, x + 0.02, S, H, -d / 2, -d / 2 + 0.2, { c: 0.002 });
    parts.box('desk-hutch', topM, -w / 2, w / 2, H - 0.02, H, -d / 2, -d / 2 + 0.2, { c: 0.002 });
    parts.box('desk-hutch', body, -w / 2 + 0.02, w / 2 - 0.02, S + 0.22, S + 0.24, -d / 2, -d / 2 + 0.2, { c: 0.002 });
    parts.box('desk-hutch', dark, -w / 2 + 0.02, w / 2 - 0.02, S, H - 0.02, -d / 2, -d / 2 + 0.008, { c: 0 });
  }
  return parts.done();
}
