// Wardrobe generator: a floor-standing or built-in wardrobe from its width, depth and height. Bays, shutters per bay, loft,
// plinth, shutter style (flat, framed, fluted strip, louvred) and handle (bar, long bar, knob, groove) are parameters.
// `addLeaf` builds ONE shutter at its hinge, in the item's frame: the closed wardrobe calls it for every shutter, and the
// openable model (src/buyer/wardrobe-model.ts) calls it once per pivot, so a shutter swings with its flutes and handle on it.
import * as THREE from 'three';
import { Parts, boxGeo, role, shade } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { fluteStrip, rod } from './geo';

export type ShutterStyle = 'flat' | 'framed' | 'fluted-strip' | 'louvred';
export type HandleStyle = 'bar' | 'long-bar' | 'knob' | 'groove';
export const SHUTTER_STYLES: ShutterStyle[] = ['flat', 'framed', 'fluted-strip', 'louvred'];
export const HANDLE_STYLES: HandleStyle[] = ['bar', 'long-bar', 'knob', 'groove'];

export interface WardrobeParams {
  /** equal bays across the front; 0 = from the width (about one pair per 0.9 m) */
  bays: number;
  shuttersPerBay: number;
  /** height of the loft row above the shutters, 0 = none */
  loftM: number;
  /** gap under the shutters (a dark recessed plinth) */
  plinthM: number;
  /** footwear drawer strip along the base of each bay, 0 = none */
  drawerStripM: number;
  shutterStyle: ShutterStyle;
  handle: HandleStyle;
  /** centre height of the handles, 0 = auto */
  handleYM: number;
  /** length of a bar handle, 0 = auto */
  handleLenM: number;
  /** fluted strip: the band's lower and upper edge as fractions of the shutter height */
  fluteBand: [number, number];
}
export const WARDROBE_DEFAULTS: WardrobeParams = {
  bays: 0, shuttersPerBay: 2, loftM: 0, plinthM: 0.06, drawerStripM: 0, shutterStyle: 'framed', handle: 'bar', handleYM: 0, handleLenM: 0, fluteBand: [0.4, 0.6],
};

/** the shutter fronts stand this far behind the box front, so a handle stays inside the box */
export const FRONT_RECESS = 0.012;
const GAP = 0.003;
const TH = 0.018;
const FRAME = 0.04;

export interface LeafSpec {
  /** where the hinge is along the item's x, and which way the leaf extends from it */
  hingeX: number;
  dir: 1 | -1;
  widthM: number;
  y0: number;
  y1: number;
  /** z of the front surface, in whatever frame the caller builds in */
  zFront: number;
  style: ShutterStyle;
  handle: HandleStyle;
  handleYM: number;
  handleLenM: number;
  fluteBand: [number, number];
  /** the handle is on this leaf's free edge (false: no handle, the leaf is half of a pair whose partner carries it) */
  handleOnFree: boolean;
  /** an extra part-name suffix, so the openable model gets one set of meshes per pivot */
  suffix?: string;
  /** names of the meshes; default `shutter-face` / `shutter-flutes` / `shutter-handles` */
  names?: { face?: string; flutes?: string; handle?: string; back?: string };
}

/** one shutter, its geometry added to `p`. u is the distance from the hinge along the leaf. */
export function addLeaf(p: Parts, s: LeafSpec, face: MatSpec, handle: MatSpec, flute: MatSpec): void {
  const q = p.env.q;
  const nFace = s.names?.face ?? `shutter-face${s.suffix ?? ''}`;
  const nFlute = s.names?.flutes ?? `shutter-flutes${s.suffix ?? ''}`;
  const nHandle = s.names?.handle ?? `shutter-handles${s.suffix ?? ''}`;
  const nBack = s.names?.back ?? `shutter-flute-back${s.suffix ?? ''}`;
  const w = s.widthM - GAP;
  const u0 = GAP / 2, u1 = u0 + w;
  const X = (u: number): number => s.hingeX + s.dir * u;
  const zF = s.zFront, zB = zF - TH;
  const h = s.y1 - s.y0;
  const bx = (name: string, m: MatSpec, ua: number, ub: number, ya: number, yb: number, za: number, zb: number, c?: number): void => {
    const xa = X(ua), xb = X(ub);
    p.box(name, m, Math.min(xa, xb), Math.max(xa, xb), ya, yb, za, zb, { c });
  };
  const style: ShutterStyle = s.style;
  const recess = 0.006;
  if (style === 'flat' || (style === 'louvred' && !q.slats)) {
    bx(nFace, face, u0, u1, s.y0, s.y1, zB, zF, 0.0025);
  } else if (style === 'framed') {
    // four rails at full thickness and a panel set back by a few mm: the reveal that a designer's shutter shows
    bx(nFace, face, u0, u0 + FRAME, s.y0, s.y1, zB, zF, 0.002);
    bx(nFace, face, u1 - FRAME, u1, s.y0, s.y1, zB, zF, 0.002);
    bx(nFace, face, u0 + FRAME, u1 - FRAME, s.y0, s.y0 + FRAME, zB, zF, 0.002);
    bx(nFace, face, u0 + FRAME, u1 - FRAME, s.y1 - FRAME, s.y1, zB, zF, 0.002);
    bx(nFace, face, u0 + FRAME, u1 - FRAME, s.y0 + FRAME, s.y1 - FRAME, zB, zF - recess, 0.001);
  } else if (style === 'fluted-strip') {
    const b0 = s.y0 + h * s.fluteBand[0], b1 = s.y0 + h * s.fluteBand[1];
    bx(nFace, face, u0, u0 + FRAME, s.y0, s.y1, zB, zF, 0.002);
    bx(nFace, face, u1 - FRAME, u1, s.y0, s.y1, zB, zF, 0.002);
    // lower and upper panels, framed by a rail at the leaf's ends and either side of the band
    bx(nFace, face, u0 + FRAME, u1 - FRAME, s.y0, s.y0 + FRAME, zB, zF, 0.002);
    bx(nFace, face, u0 + FRAME, u1 - FRAME, s.y1 - FRAME, s.y1, zB, zF, 0.002);
    bx(nFace, face, u0 + FRAME, u1 - FRAME, b0 - FRAME / 2, b0, zB, zF, 0.002);
    bx(nFace, face, u0 + FRAME, u1 - FRAME, b1, b1 + FRAME / 2, zB, zF, 0.002);
    bx(nFace, face, u0 + FRAME, u1 - FRAME, s.y0 + FRAME, b0 - FRAME / 2, zB, zF - recess, 0.001);
    bx(nFace, face, u0 + FRAME, u1 - FRAME, b1 + FRAME / 2, s.y1 - FRAME, zB, zF - recess, 0.001);
    // the band: a recessed back with ribs standing out of it
    const bandZ = zF - 0.009;
    bx(nBack, shade(face, 0.72), u0 + FRAME, u1 - FRAME, b0, b1, zB, bandZ, 0.001);
    const fw = w - 2 * FRAME, fh = b1 - b0 - 0.02;
    if (q.flutes && fw > 0.05 && fh > 0.05) {
      const g = fluteStrip(fw, fh, 0.022, 0.0085);
      // the strip stands in the xy plane, x from 0 to fw, toward +z: place it on the band, ribs running up and down
      g.translate(Math.min(X(u0 + FRAME), X(u1 - FRAME)), b0 + 0.01, bandZ);
      p.put(nFlute, flute, g);
    }
  } else {
    // louvred: a frame and slanted slats between the stiles
    bx(nFace, face, u0, u0 + FRAME, s.y0, s.y1, zB, zF, 0.002);
    bx(nFace, face, u1 - FRAME, u1, s.y0, s.y1, zB, zF, 0.002);
    bx(nFace, face, u0 + FRAME, u1 - FRAME, s.y0, s.y0 + FRAME, zB, zF, 0.002);
    bx(nFace, face, u0 + FRAME, u1 - FRAME, s.y1 - FRAME, s.y1, zB, zF, 0.002);
    const pitch = 0.05, n = Math.max(1, Math.floor((h - 2 * FRAME) / pitch));
    const fw = w - 2 * FRAME;
    const x0 = Math.min(X(u0 + FRAME), X(u1 - FRAME));
    for (let i = 0; i < n; i++) {
      const y = s.y0 + FRAME + (i + 0.5) * ((h - 2 * FRAME) / n);
      const g = boxGeo(0, fw, -0.011, 0.011, -0.0045, 0.0045, 0);
      g.rotateX(-0.55);
      g.translate(x0, y, (zB + zF) / 2 - 0.002);
      p.put(nFace, face, g, { grain: 'x' });
    }
  }

  // handle
  if (!s.handleOnFree) return;
  const hu = u1 - 0.035; // centre line of the bar, 3.5 cm in from the free edge
  const hx = X(hu);
  const standoff = 0.014;
  const zh = zF + standoff;
  if (s.handle === 'bar' || s.handle === 'long-bar') {
    const mid = s.handleYM > 0 ? s.handleYM : s.y0 + h * 0.48;
    const long = s.handle === 'long-bar';
    // a long bar is long by style: the drawing's measured length is for a plain bar handle
    const len = long ? Math.min(1.05, h * 0.46) : s.handleLenM > 0 ? s.handleLenM : 0.3;
    const r = long ? 0.0065 : 0.006;
    const y0 = Math.max(s.y0 + 0.05, mid - len / 2), y1 = Math.min(s.y1 - 0.05, mid + len / 2);
    p.put(nHandle, handle, rod({ x: hx, y: y0, z: zh }, { x: hx, y: y1, z: zh }, r, q.sides));
    const posts = long ? 3 : 2;
    for (let i = 0; i < posts; i++) {
      const y = y0 + 0.04 + ((y1 - y0 - 0.08) * i) / (posts - 1);
      p.put(nHandle, handle, rod({ x: hx, y, z: zF }, { x: hx, y, z: zh }, 0.0035, 6));
    }
  } else if (s.handle === 'knob') {
    const y = s.handleYM > 0 ? s.handleYM : s.y0 + h * 0.5;
    const g = new THREE.CylinderGeometry(0.014, 0.017, 0.022, Math.max(8, q.sides + 4), 1);
    g.rotateX(Math.PI / 2);
    g.translate(hx, y, zF + 0.011);
    p.put(nHandle, handle, g);
  } else {
    // groove: a dark finger recess down the free edge, drawn as a slim black strip flush with the face
    const y0 = s.y0 + h * 0.3, y1 = s.y0 + h * 0.7;
    const xg = X(u1 - 0.012);
    p.put(nHandle, handle, boxGeo(xg - 0.006, xg + 0.006, y0, y1, zF - 0.002, zF + 0.0008, 0));
  }
}

/** number of bays: the drawing's, or one pair of shutters per 0.9 m */
export function bayCount(w: number, p: WardrobeParams): number {
  return p.bays > 0 ? Math.round(p.bays) : Math.max(1, Math.round(w / (0.45 * Math.max(1, p.shuttersPerBay))));
}

/** the vertical span of the openable shutters and of the loft, from the height and the params (one place, so the closed wardrobe and the openable model agree) */
export function wardrobeSpans(H: number, p: WardrobeParams): { y0: number; yTop: number; loft: number; plinth: number; strip: number } {
  const plinth = Math.max(0, p.plinthM);
  const loft = H - plinth > 2.2 ? Math.max(0, p.loftM) : 0;
  const strip = Math.max(0, p.drawerStripM);
  return { plinth, strip, loft, y0: plinth + strip + (strip > 0 ? GAP : 0), yTop: H - GAP - loft - (loft > 0 ? GAP : 0) };
}

/** the closed wardrobe, built from the size and the params; the sizes are exactly the box and the heights */
export function buildWardrobe(env: GenEnv, size: GenSize, p: WardrobeParams, roles: Roles): THREE.Group {
  const { w, d, h: H } = size;
  const parts = new Parts(env, 'gen:wardrobe');
  const face = role(roles, 'case'), flute = role(roles, 'flute', 'case'), handle = role(roles, 'handle');
  const dark = role(roles, 'plinth', 'handle');
  const sp = wardrobeSpans(H, p);
  const y0 = sp.plinth, loft = sp.loft, yTop = sp.yTop;
  const zF = d / 2 - FRONT_RECESS;

  parts.box('plinth', dark, -w / 2 + 0.03, w / 2 - 0.03, 0, y0 + 0.004, -d / 2 + 0.03, d / 2 - 0.04, { c: 0 });
  // the carcass: its visible end panels and top share the shutter finish
  parts.box('carcass', face, -w / 2, w / 2, y0, H, -d / 2, zF - TH - 0.002, { c: 0.002 });

  const bays = bayCount(w, p);
  const n = Math.max(1, Math.round(p.shuttersPerBay));
  const bw = (w - GAP * (bays + 1)) / bays;
  const strip = sp.strip;
  const sy0 = sp.y0;
  for (let k = 0; k < bays; k++) {
    const bx0 = -w / 2 + GAP + k * (bw + GAP);
    const sw = (bw - GAP * (n - 1)) / n;
    for (let j = 0; j < n; j++) {
      const lx0 = bx0 + j * (sw + GAP), lx1 = lx0 + sw;
      // hinged at the outer edges of its bay: the first half open from the left, the rest from the right
      const left = j < n / 2;
      addLeaf(parts, {
        hingeX: left ? lx0 - GAP / 2 : lx1 + GAP / 2, dir: left ? 1 : -1, widthM: sw + GAP, y0: sy0, y1: yTop, zFront: zF,
        style: p.shutterStyle, handle: p.handle, handleYM: p.handleYM, handleLenM: p.handleLenM, fluteBand: p.fluteBand,
        handleOnFree: true,
      }, face, handle, flute);
    }
    if (strip > 0) parts.box('drawer-fronts', face, bx0, bx0 + bw, y0 + GAP, y0 + strip, zF - TH, zF, { c: 0.002 });
    if (loft > 0) {
      // the loft: one panel per bay in the same finish, fixed
      const ly0 = yTop + GAP * 2, ly1 = H - GAP;
      parts.box('loft-face', face, bx0, bx0 + bw, ly0, ly1, zF - TH, zF, { c: 0.002 });
      if (p.shutterStyle !== 'flat') parts.box('loft-face', face, bx0 + FRAME, bx0 + bw - FRAME, ly0 + FRAME, ly1 - FRAME, zF - TH, zF + 0.003, { c: 0.002 });
    }
  }
  return parts.done();
}
