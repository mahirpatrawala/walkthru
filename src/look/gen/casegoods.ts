// Case goods: study table with a drawer pedestal, bedside table, low dresser / TV unit, kitchen counter. Each is a pure function of
// the item's footprint and heights plus a few style params; the footprint and total height are exactly the item's.
import * as THREE from 'three';
import { Parts, role } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { rod } from './geo';
import { addLeaf } from './wardrobe';
import type { ShutterStyle } from './wardrobe';

type Handle = 'groove' | 'knob' | 'bar';
const GAP = 0.003;

/** a drawer or door front at (x0..x1, y0..y1) on the plane z = zf, with its handle */
function front(p: Parts, name: string, face: MatSpec, hm: MatSpec, x0: number, x1: number, y0: number, y1: number, zf: number, handle: Handle, th = 0.018): void {
  p.box(name, face, x0, x1, y0, y1, zf - th, zf, { c: 0.002 });
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (handle === 'groove') {
    // a dark finger groove along the top edge
    p.put(`${name}-handles`, hm, new THREE.BoxGeometry(Math.min(0.5, (x1 - x0) * 0.7), 0.012, 0.004).translate(cx, y1 - 0.02, zf + 0.0005));
  } else if (handle === 'knob') {
    const g = new THREE.CylinderGeometry(0.012, 0.015, 0.02, 8, 1);
    g.rotateX(Math.PI / 2);
    g.translate(cx, cy, zf + 0.01);
    p.put(`${name}-handles`, hm, g);
  } else {
    const len = Math.min(0.3, (x1 - x0) * 0.6);
    p.put(`${name}-handles`, hm, rod({ x: cx - len / 2, y: cy, z: zf + 0.014 }, { x: cx + len / 2, y: cy, z: zf + 0.014 }, 0.006, p.env.q.sides));
    for (const sx of [-1, 1]) p.put(`${name}-handles`, hm, rod({ x: cx + sx * (len / 2 - 0.02), y: cy, z: zf }, { x: cx + sx * (len / 2 - 0.02), y: cy, z: zf + 0.014 }, 0.0035, 6));
  }
}

// ---------------------------------------------------------------- study table

export interface StudyParams {
  top: 'slab' | 'thick';
  pedestal: 'right' | 'left' | 'none';
  drawers: number;
  handle: Handle;
}
export const STUDY_DEFAULTS: StudyParams = { top: 'slab', pedestal: 'right', drawers: 3, handle: 'groove' };

export function buildStudy(env: GenEnv, size: GenSize, p: StudyParams, roles: Roles): THREE.Group {
  const { w, d, s: S, h: Hh } = size;
  const parts = new Parts(env, 'gen:study');
  const body = role(roles, 'case'), topM = role(roles, 'top', 'case'), drawerM = role(roles, 'drawerFront', 'case'), hm = role(roles, 'handle');
  const topT = p.top === 'thick' ? 0.04 : 0.025;
  parts.box('desk-top', topM, -w / 2, w / 2, S - topT, S, -d / 2, d / 2, { c: 0.004, grain: 'x' });
  const bodyH = S - topT;
  const ped = p.pedestal === 'none' ? 0 : Math.min(0.42, w * 0.45);
  const side = p.pedestal === 'left' ? -1 : 1;
  const px0 = side > 0 ? w / 2 - ped : -w / 2, px1 = side > 0 ? w / 2 : -w / 2 + ped;
  const t = 0.018;
  if (ped > 0) {
    parts.box('desk-carcass', body, px0, px1, 0, bodyH, -d / 2 + 0.02, d / 2 - 0.03, { c: 0.002 });
    const n = Math.max(1, Math.round(p.drawers));
    const fh = (bodyH - 0.1 - GAP * (n + 1)) / n;
    for (let i = 0; i < n; i++) {
      const y1 = bodyH - 0.02 - GAP - i * (fh + GAP), y0 = y1 - fh;
      front(parts, 'desk-drawers', drawerM, hm, px0 + 0.004, px1 - 0.004, y0, y1, d / 2 - 0.012, p.handle);
    }
    // the open end: an end panel and a modesty back
    const ox0 = side > 0 ? -w / 2 : px1, ox1 = side > 0 ? px0 : w / 2;
    const endX = side > 0 ? -w / 2 : w / 2 - t;
    parts.box('desk-carcass', body, endX, endX + t, 0, bodyH, -d / 2 + 0.02, d / 2 - 0.02, { c: 0.002 });
    parts.box('desk-carcass', body, Math.min(ox0, ox1), Math.max(ox0, ox1), 0.35, bodyH, -d / 2 + 0.02, -d / 2 + 0.02 + t, { c: 0.002 });
  } else {
    for (const sx of [-1, 1]) parts.box('desk-carcass', body, sx > 0 ? w / 2 - t : -w / 2, sx > 0 ? w / 2 : -w / 2 + t, 0, bodyH, -d / 2 + 0.03, d / 2 - 0.03, { c: 0.002 });
    parts.box('desk-carcass', body, -w / 2 + t, w / 2 - t, 0.35, bodyH, -d / 2 + 0.03, -d / 2 + 0.03 + t, { c: 0.002 });
  }
  if (Hh > S + 0.01) parts.box('desk-upstand', body, -w / 2, w / 2, S, Hh, -d / 2, -d / 2 + 0.018, { c: 0.002 });
  return parts.done();
}

// ---------------------------------------------------------------- bedside table

export interface SideParams {
  style: 'drawer' | 'open' | 'legs';
  handle: Handle;
}
export const SIDE_DEFAULTS: SideParams = { style: 'drawer', handle: 'groove' };

export function buildSide(env: GenEnv, size: GenSize, p: SideParams, roles: Roles): THREE.Group {
  const { w, d, h: H } = size;
  const parts = new Parts(env, 'gen:side');
  const body = role(roles, 'case'), topM = role(roles, 'top', 'case'), drawerM = role(roles, 'drawerFront', 'case'), hm = role(roles, 'handle'), dark = role(roles, 'plinth', 'handle');
  const topT = 0.025;
  parts.box('side-top', topM, -w / 2, w / 2, H - topT, H, -d / 2, d / 2, { c: 0.004, grain: 'x' });
  if (p.style === 'legs') {
    const q = env.q;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.03), z = sz * (d / 2 - 0.03);
      parts.put('side-legs', body, rod({ x, y: 0, z }, { x: x * 0.97, y: H - topT, z: z * 0.97 }, 0.014, q.sides));
    }
    const dh = Math.min(0.15, H - topT - 0.25);
    parts.box('side-carcass', body, -w / 2 + 0.03, w / 2 - 0.03, H - topT - dh, H - topT, -d / 2 + 0.03, d / 2 - 0.03, { c: 0.002 });
    front(parts, 'side-drawer', drawerM, hm, -w / 2 + 0.03, w / 2 - 0.03, H - topT - dh + 0.003, H - topT - 0.003, d / 2 - 0.028, p.handle, 0.016);
    return parts.done();
  }
  const t = 0.018;
  const plinth = 0.07;
  parts.box('side-plinth', dark, -w / 2 + 0.03, w / 2 - 0.03, 0, plinth, -d / 2 + 0.03, d / 2 - 0.04, { c: 0 });
  parts.box('side-carcass', body, -w / 2, w / 2, plinth, H - topT, -d / 2, d / 2 - 0.02, { c: 0.002 });
  const zf = d / 2 - 0.006;
  if (p.style === 'drawer') {
    const dh = Math.min(0.17, (H - topT - plinth) * 0.45);
    front(parts, 'side-drawer', drawerM, hm, -w / 2 + 0.004, w / 2 - 0.004, H - topT - dh - 0.004, H - topT - 0.004, zf, p.handle, 0.016);
    // open niche below the drawer, dark inside
    const ny1 = H - topT - dh - 0.01;
    parts.box('side-niche', dark, -w / 2 + t, w / 2 - t, plinth + t, ny1 - t, d / 2 - 0.1, zf, { c: 0 });
  } else {
    const ny1 = H - topT - 0.03;
    const mid = (plinth + ny1) / 2;
    parts.box('side-niche', dark, -w / 2 + t, w / 2 - t, plinth + t, mid - t / 2, d / 2 - 0.12, zf, { c: 0 });
    parts.box('side-niche', dark, -w / 2 + t, w / 2 - t, mid + t / 2, ny1 - t, d / 2 - 0.12, zf, { c: 0 });
    parts.box('side-shelf', body, -w / 2 + t, w / 2 - t, mid - t / 2, mid + t / 2, -d / 2, zf, { c: 0.002 });
  }
  return parts.done();
}

// ---------------------------------------------------------------- low dresser / TV unit

export interface DresserParams {
  /** doors or drawer fronts across */
  fronts: number;
  /** an open niche at one end, 0 = none */
  nicheM: number;
  base: 'plinth' | 'legs';
  handle: Handle;
}
export const DRESSER_DEFAULTS: DresserParams = { fronts: 0, nicheM: 0, base: 'legs', handle: 'groove' };

export function buildDresser(env: GenEnv, size: GenSize, p: DresserParams, roles: Roles): THREE.Group {
  const { w, d, s: S } = size;
  const H = Math.max(size.h, S);
  const q = env.q;
  const parts = new Parts(env, 'gen:dresser');
  const body = role(roles, 'case'), topM = role(roles, 'top', 'case'), fm = role(roles, 'drawerFront', 'case'), hm = role(roles, 'handle'), dark = role(roles, 'plinth', 'handle');
  const topT = 0.03;
  const legH = p.base === 'legs' ? 0.12 : 0.07;
  parts.box('unit-top', topM, -w / 2, w / 2, H - topT, H, -d / 2, d / 2, { c: 0.004, grain: 'x' });
  if (p.base === 'legs') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.06), z = sz * (d / 2 - 0.06);
      parts.put('unit-legs', body, rod({ x, y: 0, z }, { x: x * 0.985, y: legH + 0.01, z: z * 0.985 }, 0.016, q.sides));
    }
  } else parts.box('unit-plinth', dark, -w / 2 + 0.03, w / 2 - 0.03, 0, legH, -d / 2 + 0.03, d / 2 - 0.04, { c: 0 });
  parts.box('unit-carcass', body, -w / 2, w / 2, legH, H - topT, -d / 2, d / 2 - 0.02, { c: 0.002 });
  const niche = Math.min(p.nicheM, w * 0.5);
  const fx0 = -w / 2 + 0.004, fx1 = w / 2 - niche - 0.004;
  const n = p.fronts > 0 ? Math.round(p.fronts) : Math.max(1, Math.round((fx1 - fx0) / 0.45));
  const fw = (fx1 - fx0 - GAP * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const x0 = fx0 + i * (fw + GAP);
    front(parts, 'unit-fronts', fm, hm, x0, x0 + fw, legH + 0.004, H - topT - 0.004, d / 2 - 0.006, p.handle, 0.016);
  }
  if (niche > 0.1) {
    const t = 0.018;
    parts.box('unit-niche', dark, w / 2 - niche + t, w / 2 - t, legH + t, H - topT - t, d / 2 - 0.2, d / 2 - 0.004, { c: 0 });
  }
  return parts.done();
}

// ---------------------------------------------------------------- kitchen counter

export interface CounterParams {
  shutterStyle: ShutterStyle;
  handle: 'bar' | 'groove' | 'knob';
}
export const COUNTER_DEFAULTS: CounterParams = { shutterStyle: 'framed', handle: 'bar' };

export function buildCounter(env: GenEnv, size: GenSize, p: CounterParams, roles: Roles): THREE.Group {
  const { w, d, s: S } = size;
  const parts = new Parts(env, 'gen:counter');
  const face = role(roles, 'case'), top = role(roles, 'top', 'case'), hm = role(roles, 'handle'), dark = role(roles, 'plinth', 'handle');
  parts.box('counter-plinth', dark, -w / 2 + 0.05, w / 2 - 0.05, 0, 0.1, -d / 2 + 0.05, d / 2 - 0.05, { c: 0 });
  const cabTop = S - 0.04;
  parts.box('counter-carcass', face, -w / 2, w / 2, 0.1, cabTop, -d / 2, d / 2 - 0.04, { c: 0.002 });
  const n = Math.max(1, Math.round(w / 0.5));
  const sw = (w - GAP * (n + 1)) / n;
  const zf = d / 2 - 0.022;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + GAP + i * (sw + GAP);
    if (p.shutterStyle === 'flat') {
      parts.box('counter-fronts', face, x0, x0 + sw, 0.103, cabTop - GAP, zf - 0.018, zf, { c: 0.002 });
    } else {
      addLeaf(parts, {
        hingeX: x0, dir: 1, widthM: sw + GAP, y0: 0.103, y1: cabTop - GAP, zFront: zf, style: p.shutterStyle === 'louvred' ? 'framed' : p.shutterStyle,
        handle: 'groove', handleYM: 0, handleLenM: 0, fluteBand: [0.4, 0.6], handleOnFree: false, names: { face: 'counter-fronts' },
      }, face, hm, face);
    }
    const cx = x0 + sw / 2;
    if (p.handle === 'bar') {
      const y = cabTop - 0.05;
      parts.put('counter-handles', hm, rod({ x: cx - 0.075, y, z: zf + 0.014 }, { x: cx + 0.075, y, z: zf + 0.014 }, 0.006, env.q.sides));
      for (const sx of [-1, 1]) parts.put('counter-handles', hm, rod({ x: cx + sx * 0.06, y, z: zf }, { x: cx + sx * 0.06, y, z: zf + 0.014 }, 0.0035, 6));
    } else if (p.handle === 'knob') {
      const g = new THREE.CylinderGeometry(0.012, 0.015, 0.02, 8, 1);
      g.rotateX(Math.PI / 2);
      g.translate(cx, cabTop - 0.06, zf + 0.01);
      parts.put('counter-handles', hm, g);
    } else parts.put('counter-handles', hm, new THREE.BoxGeometry(0.2, 0.012, 0.004).translate(cx, cabTop - 0.03, zf + 0.0005));
  }
  parts.box('counter-top', top, -w / 2, w / 2, S - 0.04, S, -d / 2, d / 2, { c: 0.005 });
  if (size.h > S + 0.01) parts.box('counter-upstand', top, -w / 2, w / 2, S, size.h, -d / 2, -d / 2 + 0.018, { c: 0.002 });
  return parts.done();
}
