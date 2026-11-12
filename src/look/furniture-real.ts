// Owned by C11b. SPEC 16.6.5: furniture that looks like furniture, at the exact catalogue or imported size. Everything is
// procedural and built from the item's Box, heightM, surfaceHeightM and inner, so the group's bounding box is the box (within
// 1 cm) and nothing sticks out of it. Runs under Node (no canvas): materials are created without textures there.
import * as THREE from 'three';
import type { FurnitureItem } from '../types';
import type { Tier } from './types';
import {
  barBetween, boxBetween, dropFacing, foldedCloth, mergeAll, piping, puffedCushion, roundedBoxBetween, worldUV,
} from './furniture-parts';
import { furnitureKit } from './furniture-materials';
import type { FurnitureKit, MatKey } from './furniture-materials';

export type FurnitureLookName = 'bed' | 'sofa' | 'wardrobe' | 'study' | 'side' | 'counter' | 'dining';

/** SPEC 16.6.5: the look is chosen by kind, and for a counter by its label. */
export function furnitureLook(item: Pick<FurnitureItem, 'kind' | 'label'>): FurnitureLookName {
  switch (item.kind) {
    case 'bed': return 'bed';
    case 'sofa': return 'sofa';
    case 'wardrobe': return 'wardrobe';
    case 'dining': return 'dining';
    default: {
      const l = item.label ?? '';
      if (/study|desk/i.test(l)) return 'study';
      if (/side|bedside|night/i.test(l)) return 'side';
      return 'counter';
    }
  }
}

/** What a tier buys: segment counts and which details exist. */
interface Quality {
  /** RoundedBoxGeometry segments (1 = 108 triangles a box) */
  seg: number;
  /** puffed cushion grid, 0 = a rounded box */
  puff: number;
  /** sofa cushion grid (a sofa has up to six) */
  puffSofa: number;
  /** bedcover grid, 0 = a rounded box */
  cloth: number;
  piping: boolean;
  channels: boolean;
  /** cylinders for handles, legs and slats instead of boxes */
  round: boolean;
}
export const QUALITY: Record<Tier, Quality> = {
  low: { seg: 1, puff: 0, puffSofa: 0, cloth: 0, piping: false, channels: false, round: false },
  medium: { seg: 2, puff: 8, puffSofa: 6, cloth: 16, piping: false, channels: true, round: true },
  high: { seg: 3, puff: 12, puffSofa: 8, cloth: 32, piping: true, channels: true, round: true },
};

/**
 * Per-item parameters taken from a drawing (SPEC 16.6 addendum: son-bedroom designs.json). Registered by item id; a generic
 * catalogue item has none and keeps the 16.6 looks. Sizes of the box never come from here, only finish details.
 */
export interface WardrobeDesign {
  /** equal bays across the front, each with its own shutter pair and footwear drawer */
  bays: number;
  shuttersPerBay: number;
  /** height of the footwear drawer strip along the base of each bay, 0 = none */
  drawerStripM: number;
  /** gap under the carcass (a plinth recess) */
  baseGapM: number;
  /** one laminate colour on every shutter and drawer front (the drawing's), instead of alternating wood and white */
  frontColor: string;
  handleColor: string;
  /** centre height and length of the vertical bar handles, a pair either side of each bay's centre gap */
  handleYM: number;
  handleLenM: number;
}
export interface BedDesign {
  /** top of the wooden base, so the mattress is surfaceHeightM - baseTopM thick */
  baseTopM: number;
}
export interface ItemDesign { wardrobe?: WardrobeDesign; bed?: BedDesign }
const designs = new Map<string, ItemDesign>();
export function setItemDesigns(map: Map<string, ItemDesign> | null): void {
  designs.clear();
  if (map) for (const [k, v] of map) designs.set(k, v);
}

class Build {
  readonly group = new THREE.Group();
  constructor(readonly kit: FurnitureKit, readonly q: Quality) {}
  add(name: string, key: MatKey, geo: THREE.BufferGeometry, tint?: string): THREE.Mesh {
    worldUV(geo, this.kit.tile(key));
    const mesh = new THREE.Mesh(geo, this.kit.material(key, tint));
    mesh.name = name;
    this.group.add(mesh);
    return mesh;
  }
  /** one mesh from several geometries of the same material (legs, handles, slats) */
  merged(name: string, key: MatKey, geos: THREE.BufferGeometry[], tint?: string): THREE.Mesh | null {
    if (geos.length === 0) return null;
    for (const g of geos) worldUV(g, this.kit.tile(key));
    return this.add(name, key, mergeAll(geos), tint);
  }
  /** a rounded box (corner radius `r`) or a plain one when the tier has no rounding to spare */
  rbox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number): THREE.BufferGeometry {
    return roundedBoxBetween(x0, x1, y0, y1, z0, z1, r, this.q.seg);
  }
  /** a shutter or drawer front: a plain slab on the low tier, lightly rounded above it */
  door(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number): THREE.BufferGeometry {
    return this.q.seg <= 1 ? boxBetween(x0, x1, y0, y1, z0, z1) : roundedBoxBetween(x0, x1, y0, y1, z0, z1, r, 1);
  }
  /** a handle bar between two points: a cylinder, or a box when the tier is low */
  bar(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, radius: number): THREE.BufferGeometry {
    if (this.q.round) return barBetween(x0, y0, z0, x1, y1, z1, radius, 8);
    // the box grows by the radius only across the bar, never past its ends
    const ex = Math.abs(x1 - x0) < 1e-6 ? radius : 0, ey = Math.abs(y1 - y0) < 1e-6 ? radius : 0, ez = Math.abs(z1 - z0) < 1e-6 ? radius : 0;
    return boxBetween(Math.min(x0, x1) - ex, Math.max(x0, x1) + ex, Math.min(y0, y1) - ey, Math.max(y0, y1) + ey, Math.min(z0, z1) - ez, Math.max(z0, z1) + ez);
  }
  cushion(w: number, h: number, d: number, puff: number, sofa = false): THREE.BufferGeometry {
    const n = sofa ? this.q.puffSofa : this.q.puff;
    if (n === 0) return roundedBoxAt(w, h, d, Math.min(0.04, h / 2.5));
    return puffedCushion(w, h, d, puff, n);
  }
}

function roundedBoxAt(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  return roundedBoxBetween(-w / 2, w / 2, -h / 2, h / 2, -d / 2, d / 2, r, 1);
}

// ---------------------------------------------------------------- bed

function buildBed(b: Build, item: FurnitureItem): void {
  const { w, d } = item.box;
  const S = item.surfaceHeightM;
  const H = Math.max(item.heightM, S + 0.02);
  // an imported bed's mattress can be a little larger than its drawn frame: the box is the truth, so clamp to it
  const m = item.inner ? { w: Math.min(item.inner.w, w - 0.01), d: Math.min(item.inner.d, d - 0.01) } : { w: w - 0.03, d: d - 0.03 };
  const baseTop = designs.get(item.id)?.bed?.baseTopM ?? Math.max(0.12, Math.min(0.3, S - 0.1));
  const plinthTop = Math.min(0.08, baseTop - 0.04);
  const q = b.q;

  // recessed plinth and the wooden storage base, with a dark shadow line at mid height
  b.add('plinth', 'dark', boxBetween(-(w - 0.1) / 2, (w - 0.1) / 2, 0, plinthTop, -(d - 0.1) / 2, (d - 0.1) / 2));
  const mid = (plinthTop + baseTop) / 2;
  b.add('frame-lower', 'walnut', b.rbox(-w / 2, w / 2, plinthTop, mid - 0.0015, -d / 2, d / 2, 0.015));
  b.add('frame-core', 'dark', boxBetween(-w / 2 + 0.01, w / 2 - 0.01, mid - 0.0016, mid + 0.0016, -d / 2 + 0.01, d / 2 - 0.01));
  b.add('frame-upper', 'walnut', b.rbox(-w / 2, w / 2, mid + 0.0015, baseTop, -d / 2, d / 2, 0.015));

  // upholstered headboard in a wooden surround, across the back
  const hz0 = -d / 2, hz1 = -d / 2 + 0.05;
  const post = 0.04;
  b.merged('headboard-frame', 'walnut', [
    boxBetween(-w / 2, -w / 2 + post, baseTop, H, hz0, hz1),
    boxBetween(w / 2 - post, w / 2, baseTop, H, hz0, hz1),
    boxBetween(-w / 2 + post, w / 2 - post, H - post, H, hz0, hz1),
  ]);
  b.add('headboard', 'headboard', b.rbox(-w / 2 + post, w / 2 - post, baseTop, H - post, hz0 + 0.006, hz1 - 0.006, 0.01));
  if (q.channels && H - post - baseTop > 0.12) {
    const px0 = -w / 2 + post, pw = w - 2 * post;
    b.merged('headboard-channels', 'dark', [1, 2, 3].map((i) => {
      const x = px0 + (pw * i) / 4;
      return boxBetween(x - 0.004, x + 0.004, baseTop + 0.03, H - post - 0.03, hz1 - 0.0075, hz1 - 0.0055);
    }));
  }

  // the mattress with the fitted sheet, kept clear of the headboard
  const mz0 = Math.max(-m.d / 2, hz1), mz1 = m.d / 2;
  const mh = S - baseTop;
  b.add('mattress', 'cotton', roundedBoxBetween(-m.w / 2, m.w / 2, baseTop, S, mz0, mz1, Math.min(0.05, mh / 2.2), Math.max(2, q.seg)));
  if (q.piping) {
    const inset = 0.012;
    const geos = [S - 0.018, baseTop + 0.018].map((y) => piping(0, (mz0 + mz1) / 2, m.w - 2 * inset, mz1 - mz0 - 2 * inset, y, 0.006, 0.05, 6, 4));
    b.merged('mattress-piping', 'cotton', geos);
  }

  // bedcover over the foot end, folded back at its head edge
  const cw = Math.min(m.w + 0.06, w - 0.01);
  const clen = 0.6 * (mz1 - mz0);
  const cz1 = mz1, cz0 = mz1 - clen;
  const cTop = Math.min(S + 0.025, H);
  if (q.cloth > 0) {
    const g = foldedCloth(cw, clen, cTop - (S - 0.002), 7, q.cloth);
    g.translate(0, (cTop + S - 0.002) / 2, (cz0 + cz1) / 2);
    b.add('bedcover', 'cover', g);
  } else {
    b.add('bedcover', 'cover', b.rbox(-cw / 2, cw / 2, S - 0.002, cTop, cz0, cz1, 0.008));
  }
  const bandTop = Math.min(S + 0.038, H);
  b.add('bedcover-fold', 'cover', b.rbox(-cw / 2, cw / 2, S - 0.002, bandTop, cz0, Math.min(cz0 + 0.25, cz1), 0.015), '#B9A58D');

  // pillows: two side by side on anything 1.2 m wide or more, one centred otherwise
  const two = m.w >= 1.2;
  const pw = Math.min(0.65, two ? m.w / 2 - 0.02 : m.w - 0.06);
  const pd = 0.42, ph = 0.14;
  const pTop = Math.min(S + ph, H);
  const pz = Math.max(mz0, hz1) + 0.04 + pd / 2;
  (two ? [-m.w / 4, m.w / 4] : [0]).forEach((x, i) => {
    const g = b.cushion(pw, ph, pd, 0.025);
    g.translate(x, pTop - ph / 2, pz);
    b.add(`pillow${i}`, 'cotton', g, '#FFFFFF');
  });
}

// ---------------------------------------------------------------- sofa

function buildSofa(b: Build, item: FurnitureItem): void {
  const { w, d } = item.box;
  const S = item.surfaceHeightM;
  const H = Math.max(item.heightM, S + 0.2);
  const q = b.q;
  const legs: THREE.BufferGeometry[] = [];
  const xs = w < 1.6 ? [-1, 1] : [-1, 0, 1];
  for (const sx of xs) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - 0.07), z = sz * (d / 2 - 0.07);
    legs.push(boxBetween(x - 0.02, x + 0.02, 0, 0.1, z - 0.02, z + 0.02));
  }
  b.merged('legs', 'walnut', legs);
  b.add('frame', 'sofa', b.rbox(-w / 2, w / 2, 0.1, 0.26, -d / 2, d / 2, 0.02));
  const aw = 0.16;
  const armTop = Math.min(S + 0.19, H - 0.02);
  b.add('arm-left', 'sofa', b.rbox(-w / 2, -w / 2 + aw, 0.1, armTop, -d / 2, d / 2, 0.06));
  b.add('arm-right', 'sofa', b.rbox(w / 2 - aw, w / 2, 0.1, armTop, -d / 2, d / 2, 0.06));
  b.add('backrest', 'sofa', b.rbox(-w / 2 + aw, w / 2 - aw, 0.1, H - 0.02, -d / 2, -d / 2 + 0.2, 0.05));

  const n = Math.max(1, Math.round((w - 0.32) / 0.6));
  const cw = (w - 0.32) / n;
  const x0 = -w / 2 + aw;
  const seatH = S + 0.03 - 0.26;
  const cd = d - 0.2;
  for (let i = 0; i < n; i++) {
    const x = x0 + cw * (i + 0.5);
    const g = b.cushion(cw - 0.004, seatH, cd, 0.03, true);
    g.translate(x, 0.26 + seatH / 2, d / 2 - cd / 2);
    b.add(`seat-cushion${i}`, 'sofa', g);
  }
  // back cushions lean 8 degrees; shifted so the top reaches H
  const len = (H - S) / Math.cos((8 * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const x = x0 + cw * (i + 0.5);
    const g = b.cushion(cw - 0.004, len, 0.16, 0.02, true);
    g.rotateX((-8 * Math.PI) / 180);
    g.computeBoundingBox();
    g.translate(x, H - g.boundingBox!.max.y, -d / 2 + 0.2 + 0.08 - 0.01);
    b.add(`back-cushion${i}`, 'sofa', g);
  }
  void q;
}

// ---------------------------------------------------------------- wardrobe

/** doors across a front: alternating wood and white, bar handles on the edge where shutters meet in pairs */
function shutters(
  b: Build, name: string, w: number, zFront: number, y0: number, y1: number, n: number, firstWood: boolean,
  handle: 'vertical' | 'horizontal', handleY: number,
): void {
  const gap = 0.003, th = 0.018;
  const sw = (w - gap * (n + 1)) / n;
  const wood: THREE.BufferGeometry[] = [], white: THREE.BufferGeometry[] = [], bars: THREE.BufferGeometry[] = [];
  const zBack = zFront - th;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + gap + i * (sw + gap), x1 = x0 + sw;
    const isWood = (i % 2 === 0) === firstWood;
    (isWood ? wood : white).push(b.door(x0, x1, y0, y1, zBack, zFront, 0.002));
    // handles: pairs share a gap, the handles sit either side of it; an odd last door has its handle on the left edge
    const paired = i % 2 === 0 ? i + 1 < n : true;
    const side = i % 2 === 0 ? (paired ? 1 : -1) : -1;
    const hx = side > 0 ? x1 - 0.035 : x0 + 0.035;
    if (handle === 'vertical') bars.push(b.bar(hx, handleY - 0.15, zFront + 0.012, hx, handleY + 0.15, zFront + 0.012, 0.006));
    else bars.push(b.bar(x0 + sw / 2 - 0.075, handleY, zFront + 0.012, x0 + sw / 2 + 0.075, handleY, zFront + 0.012, 0.006));
  }
  b.merged(`${name}-wood`, 'walnut', wood);
  b.merged(`${name}-white`, 'shutterWhite', white);
  b.merged(`${name}-handles`, 'metal', bars);
}

/**
 * A drawn wardrobe: `bays` equal bays, each with `shuttersPerBay` shutters, a footwear drawer strip along the base and bar
 * handles either side of the bay's centre gap, all in one laminate colour. Parametric so any drawing can use it.
 */
function parametricWardrobe(b: Build, item: FurnitureItem, p: WardrobeDesign): void {
  const { w, d } = item.box;
  const H = item.heightM;
  const gap = 0.003, th = 0.018;
  const strip = Math.max(0, p.drawerStripM);
  const y0 = p.baseGapM;
  b.add('plinth', 'dark', boxBetween(-w / 2 + 0.03, w / 2 - 0.03, 0, y0 + 0.004, -d / 2 + 0.03, d / 2 - 0.03));
  b.add('carcass', 'shutterWhite', boxBetween(-w / 2, w / 2, y0, H, -d / 2, d / 2 - 0.03), '#CFC3B5');
  const zf = d / 2 - 0.012 - 0.006;
  const zb = zf - th;
  const bw = (w - gap * (p.bays + 1)) / p.bays;
  const shutters: THREE.BufferGeometry[] = [], drawers: THREE.BufferGeometry[] = [], bars: THREE.BufferGeometry[] = [];
  const top = H - 0.003;
  const sy0 = y0 + strip + (strip > 0 ? gap : 0);
  for (let k = 0; k < p.bays; k++) {
    const bx0 = -w / 2 + gap + k * (bw + gap);
    if (strip > 0) drawers.push(b.door(bx0, bx0 + bw, y0 + gap, y0 + strip, zb, zf, 0.002));
    const sw = (bw - gap * (p.shuttersPerBay - 1)) / p.shuttersPerBay;
    for (let j = 0; j < p.shuttersPerBay; j++) {
      const x0 = bx0 + j * (sw + gap);
      shutters.push(b.door(x0, x0 + sw, sy0, top, zb, zf, 0.002));
    }
    // two vertical bars either side of the bay's centre gap (a pair of doors); other counts put one at each meeting edge
    const edges: number[] = [];
    for (let j = 0; j + 1 < p.shuttersPerBay; j++) edges.push(bx0 + (j + 1) * sw + j * gap + gap / 2);
    for (const ex of edges) for (const sgn of [-1, 1]) {
      const x = ex + sgn * 0.025;
      bars.push(b.bar(x, p.handleYM - p.handleLenM / 2, zf + 0.012, x, p.handleYM + p.handleLenM / 2, zf + 0.012, 0.006));
    }
  }
  b.merged('shutters', 'shutterWhite', shutters, p.frontColor);
  b.merged('drawer-fronts', 'shutterWhite', drawers, p.frontColor);
  b.merged('handles', 'dark', bars, p.handleColor);
}

function buildWardrobe(b: Build, item: FurnitureItem): void {
  const drawn = designs.get(item.id)?.wardrobe;
  if (drawn) { parametricWardrobe(b, item, drawn); return; }
  const { w, d } = item.box;
  const H = item.heightM;
  b.add('plinth', 'dark', boxBetween(-w / 2 + 0.03, w / 2 - 0.03, 0, 0.08, -d / 2 + 0.03, d / 2 - 0.03));
  // carcass: the front is recessed 3 cm so the shutters and handles stay inside the box
  b.add('carcass', 'walnut', boxBetween(-w / 2, w / 2, 0.08, H, -d / 2, d / 2 - 0.03));
  const n = Math.max(2, Math.round(w / 0.45));
  const zShutterFront = d / 2 - 0.012 - 0.006;
  if (H > 2.25) {
    shutters(b, 'shutter', w, zShutterFront, 0.083, 2.1, n, true, 'vertical', 1.05);
    shutters(b, 'loft', w, zShutterFront, 2.103, H - 0.003, n, false, 'vertical', 2.2);
  } else {
    shutters(b, 'shutter', w, zShutterFront, 0.083, H - 0.003, n, true, 'vertical', Math.min(1.05, H / 2));
  }
}

// ---------------------------------------------------------------- tables and counters

function upstand(b: Build, item: FurnitureItem, y0: number): void {
  const { w, d } = item.box;
  if (item.heightM > y0 + 0.01) b.add('upstand', 'walnut', boxBetween(-w / 2, w / 2, y0, item.heightM, -d / 2, -d / 2 + 0.018));
}

function buildStudy(b: Build, item: FurnitureItem): void {
  const { w, d } = item.box;
  const S = item.surfaceHeightM;
  const topT = 0.025;
  b.add('top', 'walnut', b.rbox(-w / 2, w / 2, S - topT, S, -d / 2, d / 2, 0.003));
  const ped = Math.min(0.4, w * 0.45);
  const px0 = w / 2 - ped;
  const body = S - topT;
  b.add('pedestal', 'white', boxBetween(px0, w / 2, 0, body, -d / 2 + 0.018, d / 2 - 0.03));
  const fh = (body - 0.04 - 0.003 * 4) / 3;
  const fronts: THREE.BufferGeometry[] = [], knobs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const y1 = body - 0.02 - i * (fh + 0.003), y0 = y1 - fh;
    fronts.push(b.door(px0 + 0.004, w / 2 - 0.004, y0, y1, d / 2 - 0.03, d / 2 - 0.012, 0.002));
    knobs.push(b.bar((px0 + w / 2) / 2, (y0 + y1) / 2, d / 2 - 0.012, (px0 + w / 2) / 2, (y0 + y1) / 2, d / 2 - 0.0035, 0.012));
  }
  b.merged('drawer-fronts', 'shutterWhite', fronts);
  b.merged('knobs', 'metal', knobs);
  b.add('side-panel', 'walnut', boxBetween(-w / 2, -w / 2 + 0.018, 0, body, -d / 2, d / 2 - 0.02));
  b.add('back-panel', 'walnut', boxBetween(-w / 2 + 0.018, px0, 0.3, body, -d / 2, -d / 2 + 0.018));
  upstand(b, item, S);
}

function buildSide(b: Build, item: FurnitureItem): void {
  const { w, d } = item.box;
  const H = item.heightM;
  const topT = 0.02;
  b.add('top', 'walnut', b.rbox(-w / 2, w / 2, H - topT, H, -d / 2, d / 2, 0.003));
  const legs: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - 0.0175), z = sz * (d / 2 - 0.0175);
    legs.push(boxBetween(x - 0.015, x + 0.015, 0, H - topT, z - 0.015, z + 0.015));
  }
  b.merged('legs', 'walnut', legs);
  const dh = Math.min(0.14, H - topT - 0.2);
  const dy1 = H - topT, dy0 = dy1 - dh;
  b.add('drawer-box', 'white', boxBetween(-w / 2 + 0.035, w / 2 - 0.035, dy0, dy1, -d / 2 + 0.035, d / 2 - 0.03));
  b.add('drawer-front', 'shutterWhite', b.door(-w / 2 + 0.03, w / 2 - 0.03, dy0 + 0.003, dy1 - 0.003, d / 2 - 0.03, d / 2 - 0.014, 0.002));
  b.add('knob', 'metal', b.bar(0, (dy0 + dy1) / 2, d / 2 - 0.014, 0, (dy0 + dy1) / 2, d / 2 - 0.0025, 0.011));
  b.add('shelf', 'walnut', boxBetween(-w / 2 + 0.03, w / 2 - 0.03, 0.12, 0.135, -d / 2 + 0.03, d / 2 - 0.03));
}

function buildCounter(b: Build, item: FurnitureItem): void {
  const { w, d } = item.box;
  const S = item.surfaceHeightM;
  b.add('plinth', 'dark', boxBetween(-w / 2 + 0.05, w / 2 - 0.05, 0, 0.1, -d / 2 + 0.05, d / 2 - 0.05));
  const cabTop = S - 0.04;
  b.add('cabinets', 'shutterWhite', boxBetween(-w / 2, w / 2, 0.1, cabTop, -d / 2, d / 2 - 0.035));
  const n = Math.max(1, Math.round(w / 0.5));
  const gap = 0.003, sw = (w - gap * (n + 1)) / n;
  const doors: THREE.BufferGeometry[] = [], bars: THREE.BufferGeometry[] = [];
  const zf = d / 2 - 0.02;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + gap + i * (sw + gap), x1 = x0 + sw;
    doors.push(b.door(x0, x1, 0.103, cabTop - 0.003, zf - 0.018, zf, 0.002));
    bars.push(b.bar((x0 + x1) / 2 - 0.075, cabTop - 0.04, zf + 0.012, (x0 + x1) / 2 + 0.075, cabTop - 0.04, zf + 0.012, 0.006));
  }
  b.merged('doors', 'shutterWhite', doors);
  b.merged('handles', 'metal', bars);
  b.add('top', 'granite', b.rbox(-w / 2, w / 2, S - 0.04, S, -d / 2, d / 2, 0.004));
  upstand(b, item, S);
}

// ---------------------------------------------------------------- dining set

function chair(b: Build, item: FurnitureItem, x: number, side: 1 | -1, i: number): void {
  const { d } = item.box;
  const H = item.heightM;
  const seatW = 0.42, seatD = 0.42;
  const outer = d / 2; // the seat's outer edge is the footprint edge
  const zc = side * (outer - seatD / 2);
  const wood: THREE.BufferGeometry[] = [], pad: THREE.BufferGeometry[] = [];
  wood.push(boxBetween(x - seatW / 2, x + seatW / 2, 0.43, 0.45, zc - seatD / 2, zc + seatD / 2));
  pad.push(roundedBoxBetween(x - seatW / 2 + 0.01, x + seatW / 2 - 0.01, 0.45, 0.5, zc - seatD / 2 + 0.01, zc + seatD / 2 - 0.01, 0.015, b.q.seg));
  // the pad is 0.05 thick on a 0.45 seat: it is part of the seat height, the bar below stays at 0.43..0.45
  for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
    const lxp = x + lx * (seatW / 2 - 0.0175), lzp = zc + lz * (seatD / 2 - 0.0175);
    wood.push(b.q.round ? barBetween(lxp, 0, lzp, lxp, 0.43, lzp, 0.0175, 8) : boxBetween(lxp - 0.0175, lxp + 0.0175, 0, 0.43, lzp - 0.0175, lzp + 0.0175));
  }
  // back: slats between two posts and a curved top rail, tilted 6 degrees away from the sitter
  const tilt = (6 * Math.PI) / 180;
  const base = 0.45;
  const len = (H - base) / Math.cos(tilt);
  const lean = len * Math.sin(tilt);
  const zb = zc + side * (seatD / 2 - 0.02 - lean) ; // the base of the back, so its top stays inside the footprint
  const backParts: THREE.BufferGeometry[] = [];
  for (const lx of [-1, 1]) backParts.push(boxBetween(x + lx * (seatW / 2 - 0.0125) - 0.0125, x + lx * (seatW / 2 - 0.0125) + 0.0125, 0, len, -0.01, 0.01));
  backParts.push(boxBetween(x - seatW / 2, x + seatW / 2, len - 0.06, len, -0.011, 0.011));
  for (const sx of [-1, 0, 1]) backParts.push(boxBetween(x + sx * 0.09 - 0.02, x + sx * 0.09 + 0.02, 0.1, len - 0.07, -0.006, 0.006));
  const backGeo = mergeAll(backParts.map((g, k) => { if (k < 2) g.translate(0, 0, 0); return g; }));
  backGeo.rotateX(side * tilt);
  backGeo.translate(0, base, zb);
  wood.push(backGeo);
  b.merged(`chair${i}-wood`, 'walnut', wood);
  b.merged(`chair${i}-pad`, 'pad', pad);
}

function buildDining(b: Build, item: FurnitureItem): void {
  const { w, d } = item.box;
  const S = item.surfaceHeightM;
  const tableD = Math.max(0.5, d - 0.8);
  const topT = 0.03;
  b.add('top', 'walnut', b.rbox(-w / 2, w / 2, S - topT, S, -tableD / 2, tableD / 2, 0.004));
  const legs: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - 0.08 - 0.03), z = sz * (tableD / 2 - 0.08 - 0.03);
    legs.push(boxBetween(x - 0.03, x + 0.03, 0, S - topT, z - 0.03, z + 0.03));
  }
  b.merged('legs', 'walnut', legs);
  const ax0 = w / 2 - 0.11, az0 = tableD / 2 - 0.11;
  b.merged('apron', 'walnut', [
    boxBetween(-ax0, ax0, S - topT - 0.08, S - topT, -az0 - 0.01, -az0 + 0.01),
    boxBetween(-ax0, ax0, S - topT - 0.08, S - topT, az0 - 0.01, az0 + 0.01),
    boxBetween(-ax0 - 0.01, -ax0 + 0.01, S - topT - 0.08, S - topT, -az0, az0),
    boxBetween(ax0 - 0.01, ax0 + 0.01, S - topT - 0.08, S - topT, -az0, az0),
  ]);
  let i = 0;
  for (const side of [-1, 1] as const) for (const k of [-0.6, 0, 0.6]) chair(b, item, k * (w / 1.8), side, i++);
}

const BUILDERS: Record<FurnitureLookName, (b: Build, item: FurnitureItem) => void> = {
  bed: buildBed, sofa: buildSofa, wardrobe: buildWardrobe, study: buildStudy, side: buildSide, counter: buildCounter, dining: buildDining,
};

/**
 * Fills `group` (origin at the footprint centre on the floor, local +Z = front) with the real look of `item` for `tier`.
 * Does not touch the group's position or rotation.
 */
export function buildRealFurniture(group: THREE.Group, item: FurnitureItem, tier: Tier, kit: FurnitureKit = furnitureKit): void {
  const b = new Build(kit, QUALITY[tier]);
  BUILDERS[furnitureLook(item)](b, item);
  for (const c of [...b.group.children]) group.add(c);
}

/** Triangles in a group. */
export function groupTriangles(g: THREE.Object3D): number {
  let n = 0;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry;
    n += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  });
  return n;
}
void dropFacing;

// ---------------------------------------------------------------- decorative study chair

/** Footprint and seat height of the swivel study chair (SPEC addendum: drawn at the study table, ~0.5 x 0.5 m, seat ~0.45 m). */
export const STUDY_CHAIR = { w: 0.5, d: 0.5, seatM: 0.45 } as const;

/**
 * A swivel study chair: five-star base on casters, gas column, padded seat and backrest, two armrests. Origin on the floor
 * under the column, it faces local +Z. Decorative: it is not part of any item's box and does not block the walk grid.
 */
export function buildStudyChair(tier: Tier, kit: FurnitureKit = furnitureKit): THREE.Group {
  const b = new Build(kit, QUALITY[tier]);
  const sides = tier === 'low' ? 5 : 8;
  const legs: THREE.BufferGeometry[] = [], casters: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5 + Math.PI / 5;
    const x = Math.sin(a) * 0.225, z = Math.cos(a) * 0.225;
    legs.push(barBetween(0, 0.075, 0, x, 0.06, z, 0.016, sides));
    casters.push(barBetween(x, 0.0, z, x, 0.05, z, 0.022, sides));
  }
  b.merged('base', 'dark', legs);
  b.merged('casters', 'dark', casters);
  b.add('column', 'metal', barBetween(0, 0.07, 0, 0, 0.38, 0, 0.025, sides));
  b.add('seat', 'pad', roundedBoxBetween(-0.24, 0.24, 0.37, STUDY_CHAIR.seatM, -0.23, 0.23, 0.03, QUALITY[tier].seg), '#3A3F47');
  const back = roundedBoxBetween(-0.21, 0.21, 0.0, 0.44, -0.03, 0.03, 0.025, QUALITY[tier].seg);
  back.rotateX((-8 * Math.PI) / 180);
  back.translate(0, 0.53, -0.215);
  b.add('backrest', 'pad', back, '#3A3F47');
  b.add('back-support', 'dark', barBetween(0, 0.45, -0.19, 0, 0.56, -0.215, 0.012, sides));
  b.merged('arms', 'dark', [-1, 1].map((s) => boxBetween(s * 0.235 - 0.015, s * 0.235 + 0.015, 0.6, 0.625, -0.19, 0.06)).concat(
    [-1, 1].map((s) => boxBetween(s * 0.235 - 0.008, s * 0.235 + 0.008, STUDY_CHAIR.seatM, 0.6, -0.1, -0.075))));
  const g = b.group;
  g.name = 'decor:chair';
  return g;
}
