// "Lived-in" decor: the low-poly objects themselves. Procedural (no downloaded assets, so nothing to license): boxes, cylinders,
// spheres, merged per material into a few meshes per piece. Every piece is built in its own frame, origin at the centre of its base
// (the point on the wall for a wall piece), +Z its front, then placed from a DecorPiece (see plan.ts).
//
// Two honesty rules live here as code, not as comments:
//   - every mesh has its raycast switched off, so the measure tool, the furnish picker and every other ray ignore decor;
//   - decor is never added to the walking grid, only to the scene (index.ts).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/geometry';
import { getStyle } from '../style';
import type { DecorPiece } from './plan';
import { attachDecorModel } from '../models/decor';
import { ultraDetail } from '../gen/ultra';
import { softCushion } from '../gen/soft';
import type { PbrClass } from '../premium/pbr';
import { ULTRA_BUILD, ULTRA_POT, ULTRA_REPLACES } from './ultra';
import type { ModelPolicy } from '../models/library';

const DEG = Math.PI / 180;

/** The warm palette (ochre, terracotta, teal, indigo, sage, rani pink, cream, saffron): cushions, throws, curtains, pots. */
const WARM_TONES = ['#C4623F', '#D9A23F', '#2E7D84', '#3A4A7A', '#7E9A78', '#B84B72', '#EFE3CD', '#E88B2A'] as const;
/** the clean packs' calm palette (SPEC 16.19): muted terracotta and ochre as the one warm accent, blue-greys and sage-greys, cream at index 6 as before */
const CALM_TONES = ['#B97A62', '#C9A86A', '#8C98A6', '#7D8CA0', '#9AA593', '#B3A39A', '#EFE8DC', '#C58E6B'] as const;
export const tones = (): readonly string[] => (getStyle().pack.id.startsWith('clean-contrast') ? CALM_TONES : WARM_TONES);
export const TONES = WARM_TONES;
/** the warm palette's index 6 is cream, which a cushion or a throw may not be (it would vanish on a sofa); the calm palette's cream is wanted (one neutral cushion beside the accent pair) */
const noCream = (): boolean => tones() === WARM_TONES;
const CREAM = '#F1E6D2';
const STEEL = '#B9BDC2';
const BRASS = '#C79A3C';
const WOOD = '#9A5E34';
const LEAF = ['#3F7D3A', '#5A9A47', '#2F6A35', '#6BA84F'] as const;
/** curtains read as fabric, so they come from the softer half of the palette */
const CURTAIN_TONES = ['#E6D6BC', '#9DB39A', '#D79A7C', '#7FA3A6', '#E8C887', '#C9A0A9'] as const;

const noRaycast: THREE.Object3D['raycast'] = () => { /* decor is never hit by a ray */ };

interface MatDef { hex: string; rough: number; metal: number; emissive?: string; side?: THREE.Side; cls?: PbrClass }

/** One set of materials shared by every piece of one home's decor; `dispose` frees them all. */
export class DecorKit {
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly textures: THREE.Texture[] = [];
  mat(d: MatDef): THREE.MeshStandardMaterial {
    const key = `${d.hex}|${d.rough}|${d.metal}|${d.emissive ?? ''}|${d.side ?? 0}|${d.cls ?? ''}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: d.hex, roughness: d.rough, metalness: d.metal, side: d.side ?? THREE.FrontSide });
      if (d.emissive) { m.emissive = new THREE.Color(d.emissive); m.emissiveIntensity = 1.1; }
      m.userData.decor = true;
      if (d.cls) m.userData.pbr = d.cls;
      this.mats.set(key, m);
    }
    return m;
  }
  texturedMat(tex: THREE.Texture, rough: number): THREE.MeshStandardMaterial {
    this.textures.push(tex);
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, roughness: rough, metalness: 0 });
    m.userData.decor = true;
    this.mats.set(`tex${this.textures.length}`, m);
    return m;
  }
  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    for (const t of this.textures) t.dispose();
    this.mats.clear();
    this.textures.length = 0;
  }
}

/** Collects geometry per material and merges it, so a piece is a handful of meshes however many bits it has. */
class Parts {
  private readonly byKey = new Map<string, { def: MatDef; geos: THREE.BufferGeometry[]; shadow: boolean }>();
  readonly group = new THREE.Group();
  constructor(private readonly kit: DecorKit) {}
  add(geo: THREE.BufferGeometry, hex: string, rough = 0.85, metal = 0, opts: { emissive?: string; shadow?: boolean; side?: THREE.Side; cls?: PbrClass } = {}): void {
    const def: MatDef = { hex, rough, metal, ...(opts.emissive ? { emissive: opts.emissive } : {}), ...(opts.side ? { side: opts.side } : {}), ...(opts.cls ? { cls: opts.cls } : {}) };
    const key = `${hex}|${rough}|${metal}|${opts.emissive ?? ''}|${opts.side ?? 0}|${opts.cls ?? ''}|${opts.shadow === false ? 0 : 1}`;
    let e = this.byKey.get(key);
    if (!e) { e = { def, geos: [], shadow: opts.shadow !== false }; this.byKey.set(key, e); }
    e.geos.push(geo.index ? geo.toNonIndexed() : geo);
  }
  mesh(geo: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.raycast = noRaycast;
    this.group.add(m);
    return m;
  }
  finish(): THREE.Group {
    for (const { def, geos, shadow } of this.byKey.values()) {
      for (const g of geos) { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2)); }
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      this.mesh(merged, this.kit.mat(def), shadow);
    }
    this.byKey.clear();
    return this.group;
  }
}

// ---------------------------------------------------------------- geometry helpers (all in the piece's frame, metres)

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.max(0.001, x1 - x0), Math.max(0.001, y1 - y0), Math.max(0.001, z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
/** an upright cylinder (or frustum) standing on y0 */
function cyl(rTop: number, rBot: number, y0: number, h: number, seg: number, x = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
  g.translate(x, y0 + h / 2, z);
  return g;
}
function ball(r: number, seg: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.7)));
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}
function rotY(g: THREE.BufferGeometry, deg: number, cx = 0, cz = 0): THREE.BufferGeometry {
  g.translate(-cx, 0, -cz);
  g.rotateY(deg * DEG);
  g.translate(cx, 0, cz);
  return g;
}

/** A stuffed square cushion: w wide, h tall, t thick, standing on y = 0, corners pinched and the middle bulged. */
function pillow(w: number, h: number, t: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, t, seg, seg, 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / (w / 2), v = p.getY(i) / (h / 2);
    const pinch = 1 - 0.1 * Math.abs(u) * Math.abs(v);
    const bulge = (1 - u * u) * (1 - v * v) * 0.03;
    p.setXYZ(i, p.getX(i) * pinch, p.getY(i) * pinch, p.getZ(i) + Math.sign(p.getZ(i) || 1) * bulge);
  }
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  return g;
}

// ---------------------------------------------------------------- textures (need a canvas; a flat colour stands in where there is none)

const hasCanvas = (): boolean => typeof document !== 'undefined' && typeof document.createElement === 'function';

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture | null {
  if (!hasCanvas()) return null;
  try {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    if (!c) return null;
    draw(c, w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  } catch { return null; }
}

/** A flat-woven dhurrie: a border, bands and rows of diamonds in the palette. */
function rugTexture(tone: number, seed: number): THREE.Texture | null {
  const rnd = mulberry32(seed);
  const main = tones()[tone % tones().length] === tones()[6] ? '#C4623F' : tones()[tone % tones().length];
  const accent = tones()[(tone + 2 + Math.floor(rnd() * 3)) % tones().length];
  return canvasTexture(256, 384, (c, w, h) => {
    c.fillStyle = '#EFE3CD'; c.fillRect(0, 0, w, h);
    c.fillStyle = main; c.fillRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#EFE3CD'; c.fillRect(24, 24, w - 48, h - 48);
    c.fillStyle = accent; c.fillRect(32, 32, w - 64, h - 64);
    c.fillStyle = '#EFE3CD';
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const cy = 32 + ((h - 64) * (r + 0.5)) / rows;
      for (let k = 0; k < 3; k++) {
        const cx = 32 + ((w - 64) * (k + 0.5)) / 3;
        c.beginPath(); c.moveTo(cx, cy - 22); c.lineTo(cx + 18, cy); c.lineTo(cx, cy + 22); c.lineTo(cx - 18, cy); c.closePath(); c.fill();
        c.fillStyle = main; c.beginPath(); c.arc(cx, cy, 5, 0, Math.PI * 2); c.fill(); c.fillStyle = '#EFE3CD';
      }
    }
    for (let i = 0; i < 18; i++) { c.fillStyle = `rgba(0,0,0,${0.015 + rnd() * 0.02})`; c.fillRect(0, rnd() * h, w, 1 + rnd() * 2); }
    fibre(c, w, h, rnd, 5000, 0.05);
  });
}

/** fibre: many short light and dark strokes across the whole canvas, so a flat weave reads as yarn and not as a printed board */
function fibre(c: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, len = 2 + rnd() * 5;
    c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${alpha * (0.5 + rnd())})` : `rgba(40,30,20,${alpha * (0.5 + rnd())})`;
    if (rnd() < 0.5) c.fillRect(x, y, len, 1); else c.fillRect(x, y, 1, len);
  }
}

/** The clean packs' rug (SPEC 16.15.2): a cream flat weave with a soft taupe lattice, a thin border in the room's accent and yarn texture. */
function calmRugTexture(tone: number, seed: number): THREE.Texture | null {
  const rnd = mulberry32(seed);
  const accent = tones()[tone % tones().length] === tones()[6] ? tones()[0] : tones()[tone % tones().length];
  return canvasTexture(768, 512, (c, w, h) => {
    c.fillStyle = '#E9E1D3'; c.fillRect(0, 0, w, h);
    // a slow cloud of tone, as yarn lots differ
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '255,250,240' : '120,100,80'},0.035)`; c.beginPath(); c.arc(rnd() * w, rnd() * h, 30 + rnd() * 90, 0, Math.PI * 2); c.fill(); }
    // border: a band of the accent between two thin taupe lines
    c.strokeStyle = '#B9AC98'; c.lineWidth = 3; c.strokeRect(22, 22, w - 44, h - 44);
    c.strokeStyle = accent; c.lineWidth = 9; c.strokeRect(34, 34, w - 68, h - 68);
    c.strokeStyle = '#B9AC98'; c.lineWidth = 2; c.strokeRect(46, 46, w - 92, h - 92);
    // the field: an open diamond lattice in a soft taupe
    c.save(); c.beginPath(); c.rect(54, 54, w - 108, h - 108); c.clip();
    c.strokeStyle = 'rgba(150,132,110,0.55)'; c.lineWidth = 3;
    const step = 64;
    for (let k = -h; k < w + h; k += step) {
      c.beginPath(); c.moveTo(k, 0); c.lineTo(k + h, h); c.stroke();
      c.beginPath(); c.moveTo(k, h); c.lineTo(k + h, 0); c.stroke();
    }
    c.restore();
    fibre(c, w, h, rnd, 14000, 0.06);
  });
}

/** the fringe of a rug's short end: cream strands with gaps between them (alpha), lying on the floor */
function fringeTexture(): THREE.Texture | null {
  return canvasTexture(256, 16, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    for (let x = 1; x < w; x += 4) { c.fillStyle = x % 8 === 1 ? '#EFE6D6' : '#E3D8C4'; c.fillRect(x, 0, 2, h - (x % 12 === 5 ? 3 : 0)); }
  });
}

/** A small warm landscape for the framed picture: a sun low over layered hills. */
function artTexture(tone: number): THREE.Texture | null {
  const hills = [tones()[(tone + 1) % 8], tones()[(tone + 2) % 8], '#3D5A5E'];
  return canvasTexture(192, 144, (c, w, h) => {
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#F3C58B'); sky.addColorStop(0.7, '#F7E2B8'); sky.addColorStop(1, '#FBEFD6');
    c.fillStyle = sky; c.fillRect(0, 0, w, h);
    c.fillStyle = '#E8793A'; c.beginPath(); c.arc(w * 0.68, h * 0.46, h * 0.16, 0, Math.PI * 2); c.fill();
    hills.forEach((col, i) => {
      c.fillStyle = col;
      c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) c.lineTo(x, h * (0.62 + i * 0.12) + Math.sin(x * 0.045 + i * 1.9) * (7 - i * 1.5));
      c.lineTo(w, h); c.closePath(); c.fill();
    });
  });
}

// ---------------------------------------------------------------- the pieces

type Seg = { s: number };
type Builder = (p: DecorPiece, parts: Parts, kit: DecorKit, seg: Seg) => void;

const tone = (p: DecorPiece, shift = 0): string => tones()[(p.tone + shift) % tones().length];

const BUILD: Record<DecorPiece['kind'], Builder> = {
  cushion(p, parts, _kit, seg) {
    const main = (noCream() && tone(p) === tones()[6] ? tone(p, 1) : tone(p));
    const g = seg.s > 32 ? softCushion(p.w, p.height, p.d, { r: Math.min(0.06, p.height / 2.6), puff: 0.028, seg: 4 }).translate(0, p.height / 2, 0) : pillow(p.w, p.height, p.d, seg.s > 8 ? 8 : 5);
    // the cushion leans back against the pillow or backrest, pivoting on its bottom edge
    g.rotateX(-(p.tiltDeg ?? 0) * DEG);
    parts.add(g, main, 0.95);
    const patch = box(-0.05, 0.05, 0, 0.1, -0.003, 0.003);
    patch.rotateZ(45 * DEG);
    patch.translate(0, p.height * 0.52, p.d / 2 + 0.028);
    patch.rotateX(-(p.tiltDeg ?? 0) * DEG);
    parts.add(patch, CREAM, 0.95);
  },
  throw(p, parts) {
    // a folded woollen throw: a thick body in one colour, a cream and a second stripe near each end, and a short fringe
    const main = (noCream() && tone(p) === tones()[6] ? tone(p, 1) : tone(p));
    const second = (noCream() && tone(p, 3) === tones()[6] ? tone(p, 4) : tone(p, 3));
    const h = Math.max(0.035, p.height);
    parts.add(box(-p.w / 2, p.w / 2, 0, h, -p.d / 2, p.d / 2), main, 0.98);
    for (const sx of [-1, 1]) {
      const x = sx * (p.w / 2 - 0.07);
      parts.add(box(x - 0.015, x + 0.015, 0, h + 0.003, -p.d / 2 - 0.001, p.d / 2 + 0.001), CREAM, 0.98);
      parts.add(box(x - 0.015 - sx * 0.04, x + 0.015 - sx * 0.04, 0, h + 0.003, -p.d / 2 - 0.001, p.d / 2 + 0.001), second, 0.98);
      for (let k = 0; k < 9; k++) {
        const z = -p.d / 2 + 0.02 + (k * (p.d - 0.04)) / 8;
        parts.add(box(sx * p.w / 2, sx * (p.w / 2 + 0.035), 0.004, h * 0.55, z - 0.003, z + 0.003), CREAM, 0.98);
      }
    }
    // the fold: a slightly narrower layer on top
    parts.add(box(-p.w / 2 + 0.03, p.w / 2 - 0.03, h, h + 0.014, -p.d / 2 + 0.02, p.d / 2 - 0.02), main, 0.98);
  },
  books(p, parts) {
    const rnd = mulberry32(p.seed);
    const cols = ['#3A4A7A', '#B5573A', '#EFE3CD', '#2E7D84', '#D9A23F'];
    let y = 0;
    const n = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const bw = 0.2 + rnd() * 0.04, bd = 0.14 + rnd() * 0.03, th = 0.025 + rnd() * 0.012;
      const g = rotY(box(-bw / 2, bw / 2, y, y + th, -bd / 2, bd / 2), (rnd() - 0.5) * 22);
      parts.add(g, cols[(p.tone + i) % cols.length], 0.8);
      parts.add(rotY(box(-bw / 2 + 0.004, bw / 2 - 0.004, y + 0.004, y + th - 0.004, bd / 2 - 0.002, bd / 2 + 0.002), (rnd() - 0.5) * 22), '#F4EDE0', 0.9);
      y += th;
    }
    // a notebook and a pen on the side
    parts.add(box(0.13, 0.25, 0, 0.012, -0.06, 0.08), '#E7DCC6', 0.9);
  },
  lamp(p, parts, _kit, seg) {
    const k = p.height / 0.34;
    parts.add(cyl(0.055 * k, 0.065 * k, 0, 0.03 * k, seg.s), BRASS, 0.4, 0.5);
    parts.add(cyl(0.012 * k, 0.012 * k, 0.03 * k, 0.17 * k, 6), BRASS, 0.4, 0.5);
    parts.add(cyl(0.07 * k, 0.11 * k, 0.19 * k, 0.15 * k, seg.s), '#F3E4C4', 0.95, 0, { emissive: '#FFD9A0' });
  },
  nightstand(p, parts, _kit, seg) {
    // a bedside table: white carcass on a short plinth, an oak top, a drawer with a knob, and a lamp whose shade glows
    const w = p.w, d = p.d;
    parts.add(box(-w / 2 + 0.03, w / 2 - 0.03, 0, 0.07, -d / 2 + 0.03, d / 2 - 0.03), '#6E5438', 0.6);
    parts.add(box(-w / 2, w / 2, 0.07, 0.5, -d / 2, d / 2), '#EFEADF', 0.55);
    parts.add(box(-w / 2 - 0.006, w / 2 + 0.006, 0.5, 0.522, -d / 2 - 0.006, d / 2 + 0.012), '#C9A77C', 0.5);
    parts.add(box(-w / 2 + 0.03, w / 2 - 0.03, 0.29, 0.296, d / 2, d / 2 + 0.002), '#B7AE9E', 0.7);
    parts.add(ball(0.013, 6, 0, 0.4, d / 2 + 0.012), BRASS, 0.4, 0.5);
    parts.add(cyl(0.05, 0.058, 0.522, 0.022, seg.s), BRASS, 0.4, 0.5);
    parts.add(cyl(0.011, 0.011, 0.544, 0.15, 6), BRASS, 0.4, 0.5);
    parts.add(cyl(0.085, 0.125, 0.69, 0.17, seg.s), '#F6E8CB', 0.95, 0, { emissive: '#FFD9A0', shadow: false });
  },
  sink(p, parts, _kit, seg) {
    // a stainless steel sink set into the worktop: a drainboard rim, a deep bowl (dark, with its drain) and a swan-neck tap at the back
    const w = p.w, d = p.d;
    parts.add(box(-w / 2, w / 2, 0, 0.012, -d / 2, d / 2), STEEL, 0.32, 0.65);
    const bx0 = -w / 2 + 0.03, bx1 = w / 2 - 0.2, bz0 = -d / 2 + 0.07, bz1 = d / 2 - 0.045;
    parts.add(box(bx0, bx1, 0.0121, 0.0135, bz0, bz1), '#4B5258', 0.45, 0.5);
    parts.add(box(bx0 + 0.012, bx1 - 0.012, 0.0135, 0.0145, bz0 + 0.012, bz1 - 0.012), '#2F3438', 0.6, 0.3);
    parts.add(cyl(0.024, 0.024, 0.0145, 0.002, seg.s, (bx0 + bx1) / 2, (bz0 + bz1) / 2), '#B9BDC2', 0.35, 0.7);
    // the drainboard's ribs
    for (let x = bx1 + 0.03; x < w / 2 - 0.03; x += 0.026) parts.add(box(x, x + 0.01, 0.012, 0.0138, -d / 2 + 0.05, d / 2 - 0.05), '#9DA2A8', 0.4, 0.6, { shadow: false });
    // the tap: a chrome base, a stem, an arch over the bowl and a short spout, with a lever
    const tx = (bx0 + bx1) / 2, tz = -d / 2 + 0.035;
    parts.add(cyl(0.022, 0.026, 0.012, 0.02, seg.s, tx, tz), '#D5D8DB', 0.2, 0.9);
    parts.add(cyl(0.012, 0.014, 0.032, 0.17, seg.s, tx, tz), '#D5D8DB', 0.2, 0.9);
    parts.add(ball(0.018, 8, tx, 0.205, tz + 0.012), '#D5D8DB', 0.2, 0.9);
    parts.add(box(tx - 0.012, tx + 0.012, 0.195, 0.218, tz + 0.012, tz + 0.2), '#D5D8DB', 0.2, 0.9);
    parts.add(cyl(0.011, 0.011, 0.165, 0.032, seg.s, tx, tz + 0.2), '#D5D8DB', 0.2, 0.9);
    parts.add(box(tx + 0.016, tx + 0.07, 0.17, 0.182, tz - 0.004, tz + 0.012), '#D5D8DB', 0.2, 0.9);
  },
  console(p, parts, _kit, seg) {
    // a slim shoe cabinet: a dark plinth, an oak carcass with two tilt-out fronts, an oak top, and on it a key bowl, a small vase of leaves and a tray
    const w = p.w, d = p.d, top = 0.8;
    parts.add(box(-w / 2 + 0.03, w / 2 - 0.03, 0, 0.08, -d / 2 + 0.03, d / 2 - 0.04), '#4A3A2C', 0.6);
    parts.add(box(-w / 2, w / 2, 0.08, top, -d / 2, d / 2), '#D8C7A8', 0.55);
    for (const sx of [-1, 1]) {
      const x0 = sx < 0 ? -w / 2 + 0.012 : 0.004, x1 = sx < 0 ? -0.004 : w / 2 - 0.012;
      parts.add(box(x0, x1, 0.4, top - 0.012, d / 2, d / 2 + 0.014), '#E9DFC9', 0.5);
      parts.add(box(x0, x1, 0.095, 0.388, d / 2, d / 2 + 0.014), '#E9DFC9', 0.5);
      const px = sx < 0 ? -0.05 : 0.05;
      parts.add(box(px - 0.1, px + 0.1, 0.385, 0.397, d / 2 + 0.006, d / 2 + 0.03), '#9FA4A9', 0.35, 0.6);
    }
    parts.add(box(-w / 2 - 0.008, w / 2 + 0.008, top, top + 0.025, -d / 2 - 0.008, d / 2 + 0.014), '#B98F5E', 0.45);
    const y = top + 0.025;
    parts.add(cyl(0.085, 0.05, y, 0.045, seg.s, -w / 2 + 0.2, 0.0), BRASS, 0.35, 0.6);
    parts.add(box(w / 2 - 0.34, w / 2 - 0.06, y, y + 0.012, -0.1, 0.1), '#7A5A3A', 0.5);
    parts.add(cyl(0.032, 0.045, y, 0.2, seg.s, w / 2 - 0.12, -0.04), '#C9B79A', 0.4);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      parts.add(ball(0.05, 6, w / 2 - 0.12 + Math.cos(a) * 0.04, y + 0.27 + (i % 2) * 0.04, -0.04 + Math.sin(a) * 0.04, 1, 1.3, 0.35), LEAF[i % LEAF.length], 0.8);
    }
  },
  mirror(p, parts, _kit, seg) {
    // a round mirror in a slim brass ring on a short cord; the glass is a pale sky-grey disc (the scene's reflections are not drawn on it)
    const r = p.height / 2;
    const ring = new THREE.CylinderGeometry(r, r, 0.035, seg.s * 3);
    ring.rotateX(Math.PI / 2); ring.translate(0, r, 0.025);
    parts.add(ring, BRASS, 0.3, 0.7);
    const glass = new THREE.CylinderGeometry(r - 0.016, r - 0.016, 0.01, seg.s * 3);
    glass.rotateX(Math.PI / 2); glass.translate(0, r, 0.044);
    parts.add(glass, '#C6D3D8', 0.06, 0.75);
    parts.add(ball(0.012, 6, 0, p.height + 0.01, 0.02), BRASS, 0.4, 0.6);
  },
  mat(p, parts) {
    // a coir doormat with a dark border
    const w = p.w, d = p.d;
    parts.add(box(-w / 2, w / 2, 0, 0.012, -d / 2, d / 2), '#3E3329', 0.98);
    parts.add(box(-w / 2 + 0.035, w / 2 - 0.035, 0.012, 0.0135, -d / 2 + 0.035, d / 2 - 0.035), '#8C7656', 0.98, 0, { shadow: false });
  },
  hob(p, parts, _kit, seg) {
    // a four-burner gas hob under a black glass top: burner rings, caps and a row of control knobs on the front edge
    const w = p.w, d = p.d;
    parts.add(box(-w / 2, w / 2, 0, 0.026, -d / 2, d / 2), '#25272A', 0.25, 0.1);
    for (const [bx, bz, r] of [[-0.14, -0.1, 0.06], [0.14, -0.1, 0.045], [-0.14, 0.11, 0.045], [0.14, 0.11, 0.06]] as const) {
      parts.add(cyl(r, r, 0.026, 0.006, seg.s, bx, bz), '#B9BDC2', 0.4, 0.6);
      parts.add(cyl(r * 0.55, r * 0.6, 0.032, 0.008, seg.s, bx, bz), '#1A1B1D', 0.5, 0.3);
    }
    for (let i = 0; i < 4; i++) parts.add(cyl(0.012, 0.012, 0.026, 0.01, 8, -0.2 + i * 0.133, d / 2 - 0.02), '#B9BDC2', 0.4, 0.6);
  },
  hood(p, parts) {
    // a chimney hood: a sloped steel canopy 12 cm deep and a flue to the ceiling
    const w = p.w, d = p.d, H = p.height;
    parts.add(box(-w / 2, w / 2, 0, 0.1, 0.02, d), '#C4C8CC', 0.35, 0.5);
    parts.add(box(-w / 2 + 0.03, w / 2 - 0.03, 0.1, 0.16, 0.06, d - 0.06), '#B1B6BB', 0.4, 0.5);
    parts.add(box(-0.13, 0.13, 0.16, H, 0.02, 0.26), '#C4C8CC', 0.35, 0.5);
    parts.add(box(-w / 2 + 0.05, w / 2 - 0.05, -0.002, 0.004, d * 0.2, d * 0.8), '#2A2C2E', 0.6);
  },
  wallcab(p, parts) {
    // a wall unit: white carcass, two flush doors with a hairline gap and slim steel pulls
    const w = p.w, h = p.height, d = p.d;
    parts.add(box(-w / 2, w / 2, 0, h, 0, d), '#E9E3D6', 0.6);
    const dw = w / 2 - 0.006;
    for (const sx of [-1, 1]) {
      const x0 = sx < 0 ? -w / 2 + 0.003 : 0.003, x1 = sx < 0 ? -0.003 : w / 2 - 0.003;
      parts.add(box(x0, x1, 0.004, h - 0.004, d, d + 0.018), '#F4F0E6', 0.5);
      const px = sx < 0 ? -0.025 : 0.025;
      parts.add(box(px - 0.005, px + 0.005, 0.06, 0.06 + Math.min(0.3, h * 0.45), d + 0.018, d + 0.03), '#9FA4A9', 0.35, 0.6);
    }
    void dw;
  },
  dado(p, parts) {
    // a glazed ceramic backsplash, 30 x 15 cm tiles with hairline joints
    const w = p.w, h = p.height;
    parts.add(box(-w / 2, w / 2, 0, h, 0, 0.012), '#F3F0E8', 0.22);
    const jy = Math.round(h / 0.15);
    for (let i = 1; i < jy; i++) parts.add(box(-w / 2, w / 2, i * 0.15 - 0.001, i * 0.15 + 0.001, 0.0118, 0.0126), '#C9C1B1', 0.8, 0, { shadow: false });
    for (let x = -w / 2 + 0.3; x < w / 2 - 0.02; x += 0.3) parts.add(box(x - 0.001, x + 0.001, 0, h, 0.0118, 0.0126), '#C9C1B1', 0.8, 0, { shadow: false });
  },
  cooker(p, parts, _kit, seg) {
    const r = 0.105;
    parts.add(cyl(r, r, 0, 0.17, seg.s), STEEL, 0.4, 0.45);
    parts.add(cyl(r + 0.008, r + 0.008, 0.17, 0.03, seg.s), STEEL, 0.35, 0.5);
    parts.add(cyl(0.022, 0.022, 0.2, 0.014, 8), '#2A2724', 0.7);
    parts.add(cyl(0.011, 0.011, 0.214, 0.018, 8), '#2A2724', 0.7);
    parts.add(box(r, r + 0.075, 0.17, 0.188, -0.018, 0.018), '#2A2724', 0.7);
    parts.add(box(-r - 0.075, -r, 0.17, 0.188, -0.018, 0.018), '#2A2724', 0.7);
  },
  dabbas(p, parts, _kit, seg) {
    const radii = [0.095, 0.085, 0.075], hs = [0.09, 0.085, 0.07];
    let y = 0;
    radii.forEach((r, i) => {
      parts.add(cyl(r, r, y, hs[i], seg.s), STEEL, 0.38, 0.5);
      parts.add(cyl(r + 0.006, r + 0.006, y + hs[i] - 0.012, 0.012, seg.s), STEEL, 0.35, 0.5);
      y += hs[i];
    });
    parts.add(cyl(0.014, 0.018, y, 0.03, 8), STEEL, 0.35, 0.5);
  },
  fruit(p, parts, _kit, seg) {
    const r = Math.min(0.15, p.w / 2);
    const bowl = new THREE.SphereGeometry(r, seg.s, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    bowl.scale(1, 0.55, 1);
    bowl.translate(0, r * 0.55, 0);
    parts.add(bowl, '#B5573A', 0.7, 0, { side: THREE.DoubleSide });
    parts.add(cyl(r * 0.4, r * 0.45, 0, 0.012, seg.s), '#B5573A', 0.7);
    const rnd = mulberry32(p.seed);
    const cols = ['#E8793A', '#D9A23F', '#6BA84F', '#C94B3A', '#E8793A'];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd(), rr = i === 5 ? 0 : r * 0.5;
      parts.add(ball(0.036, 8, Math.cos(a) * rr, r * 0.55 + (i === 5 ? 0.05 : 0.02), Math.sin(a) * rr), cols[i % cols.length], 0.55);
    }
  },
  jug(p, parts, _kit, seg) {
    parts.add(cyl(0.05, 0.062, 0, 0.2, seg.s), STEEL, 0.35, 0.5);
    parts.add(cyl(0.052, 0.05, 0.2, 0.02, seg.s), STEEL, 0.35, 0.5);
    parts.add(box(0.05, 0.075, 0.07, 0.19, -0.008, 0.008), STEEL, 0.35, 0.5);
    parts.add(cyl(0.012, 0.012, 0.22, 0.02, 6), '#2A2724', 0.7);
  },
  plant(p, parts, _kit, seg) {
    const rnd = mulberry32(p.seed);
    const pot = ['#B5573A', '#EFE3CD', '#2E7D84'][p.tone % 3];
    if (ultraDetail()) ULTRA_POT(p, parts);
    else {
      parts.add(cyl(0.15, 0.1, 0, 0.22, seg.s), pot, 0.8);
      parts.add(cyl(0.16, 0.16, 0.2, 0.03, seg.s), pot, 0.8);
      parts.add(cyl(0.13, 0.13, 0.226, 0.006, seg.s), '#3B2B20', 1);
    }
    // a bushy tulsi / money plant: a cloud of flattened leaf clumps rising from the pot
    const n = 11;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = rnd() * Math.PI * 2, rr = 0.03 + rnd() * 0.12 * (1 - t * 0.35);
      const g = new THREE.IcosahedronGeometry(0.075 + rnd() * 0.045, 1);
      g.scale(1.1, 0.7, 1.1);
      g.translate(Math.cos(a) * rr, 0.3 + t * (p.height - 0.42) + rnd() * 0.04, Math.sin(a) * rr);
      parts.add(g, LEAF[i % LEAF.length], 0.8);
    }
    parts.add(cyl(0.008, 0.012, 0.22, 0.2, 5), '#4C6A34', 0.9);
  },
  rug(p, parts, kit) {
    // SPEC 16.15.2: a woven rug with yarn texture (a calm flat weave in the clean packs, the dhurrie otherwise) and a fringe at each
    // short end; the fringe lies inside the planned footprint, the woven body 4 cm short of each end
    const calm = tones() === CALM_TONES;
    const tex = calm ? calmRugTexture(p.tone, p.seed) : rugTexture(p.tone, p.seed);
    const fr = Math.min(0.04, p.w * 0.04);
    const geo = new THREE.BoxGeometry(p.w - 2 * fr, p.height, p.d);
    geo.translate(0, p.height / 2 - 0.004, 0);
    if (tex) {
      const side = kit.mat({ hex: calm ? '#DDD3C2' : '#E9DDC6', rough: 1, metal: 0 });
      const top = kit.texturedMat(tex, 1);
      // the yarn in relief: the same picture as a fine bump, so light grazing the rug picks out the weave
      top.bumpMap = tex;
      top.bumpScale = 0.6;
      parts.mesh(geo, [side, side, top, side, side, side], false);
      const ft = fringeTexture();
      if (ft) {
        ft.wrapS = THREE.RepeatWrapping;
        ft.repeat.set(p.d / 0.25, 1);
        const fm = kit.texturedMat(ft, 1);
        fm.transparent = false;
        fm.alphaTest = 0.5;
        fm.side = THREE.DoubleSide;
        for (const sx of [-1, 1]) {
          const q = new THREE.PlaneGeometry(fr, p.d);
          q.rotateX(-Math.PI / 2);
          q.rotateY(sx > 0 ? 0 : Math.PI);
          // the strands run along x (the texture's v): turn the uv so the canvas's strands point out of the rug
          const uv = q.attributes.uv as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); }
          q.translate(sx * (p.w / 2 - fr / 2), 0.002, 0);
          parts.mesh(q, fm, false);
        }
      }
    } else {
      parts.mesh(geo, kit.mat({ hex: calm ? '#E4DACA' : tones()[p.tone % 8] === tones()[6] ? '#C4623F' : tones()[p.tone % 8], rough: 1, metal: 0 }), false);
    }
  },
  shoes(p, parts) {
    const rnd = mulberry32(p.seed);
    // toes point along +Z (to the wall); a pair of sports shoes and a pair of chappals
    const shoe = (x: number, yaw: number, upper: string, sole: string): void => {
      const g: THREE.BufferGeometry[] = [];
      parts.add(rotY(box(x - 0.045, x + 0.045, 0, 0.022, -0.13, 0.14), yaw, x, 0), sole, 0.8);
      parts.add(rotY(box(x - 0.042, x + 0.042, 0.022, 0.07, -0.12, 0.0), yaw, x, 0), upper, 0.85);
      parts.add(rotY(box(x - 0.04, x + 0.04, 0.022, 0.045, 0.0, 0.13), yaw, x, 0), upper, 0.85);
      void g;
    };
    const chappal = (x: number, yaw: number, strap: string): void => {
      parts.add(rotY(box(x - 0.04, x + 0.04, 0, 0.016, -0.12, 0.13), yaw, x, 0), '#C9A06A', 0.9);
      parts.add(rotY(box(x - 0.04, x + 0.04, 0.016, 0.034, 0.02, 0.07), yaw, x, 0), strap, 0.85);
    };
    const j = (): number => (rnd() - 0.5) * 8;
    shoe(-0.2, j(), '#6A7C9E', '#EFE9DC'); shoe(-0.09, j(), '#6A7C9E', '#EFE9DC');
    chappal(0.11, j(), tone(p)); chappal(0.2, j(), tone(p));
  },
  curtain(p, parts, kit, seg) {
    const rnd = mulberry32(p.seed);
    const hex = CURTAIN_TONES[p.tone % CURTAIN_TONES.length];
    const top = p.height;
    const pw = Math.min(0.36, (p.w - 0.25) / 2);
    const zc = 0.065;
    parts.add(box(-p.w / 2 + 0.02, p.w / 2 - 0.02, top - 0.012, top + 0.012, 0.075, 0.1).rotateX(0), '#4A3528', 0.5, 0.2);
    for (const s of [-1, 1]) parts.add(ball(0.03, 8, s * (p.w / 2 - 0.02), top, 0.0875), BRASS, 0.4, 0.6);
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(pw, top - 0.05, 0.02, seg.s > 8 ? 14 : 8, 4, 1);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const phase = rnd() * 6;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + Math.sin(pos.getX(i) * 62 + phase) * 0.018);
      g.computeVertexNormals();
      g.translate(s * (p.w / 2 - 0.02 - pw / 2), (top - 0.05) / 2 + 0.0, zc);
      parts.add(g, hex, 0.97);
      parts.add(box(s * (p.w / 2 - 0.02 - pw / 2) - 0.005, s * (p.w / 2 - 0.02 - pw / 2) + 0.005, 0.5 * top, 0.5 * top + 0.09, zc - 0.002, zc + 0.002), BRASS, 0.5, 0.4);
    }
    void kit;
  },
  clock(p, parts, _kit, seg) {
    const r = p.height / 2;
    const rim = new THREE.CylinderGeometry(r, r, 0.03, seg.s * 2);
    rim.rotateX(Math.PI / 2); rim.translate(0, r, 0.02);
    parts.add(rim, '#3B2A20', 0.6);
    const face = new THREE.CylinderGeometry(r - 0.012, r - 0.012, 0.012, seg.s * 2);
    face.rotateX(Math.PI / 2); face.translate(0, r, 0.036);
    parts.add(face, '#F6F1E7', 0.85);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, big = i % 3 === 0;
      const t = box(-0.004, 0.004, r - r * 0.9, r - r * (big ? 0.72 : 0.8), -0.002, 0.002);
      t.translate(0, 0, 0.044);
      const m = new THREE.Matrix4().makeRotationZ(a); m.setPosition(0, r, 0);
      t.translate(0, -r, 0); t.applyMatrix4(m);
      parts.add(t, '#2A2724', 0.7);
    }
    const hand = (len: number, deg: number, w: number): THREE.BufferGeometry => {
      const g = box(-w / 2, w / 2, 0, len, -0.002, 0.002);
      g.translate(0, 0, 0.048);
      g.rotateZ(-deg * DEG);
      g.translate(0, r, 0);
      return g;
    };
    parts.add(hand(r * 0.55, 305, 0.011), '#2A2724', 0.7);
    parts.add(hand(r * 0.8, 60, 0.007), '#2A2724', 0.7);
    parts.add(ball(0.008, 6, 0, r, 0.05), '#B5573A', 0.6);
  },
  frame(p, parts, kit) {
    const w = p.w, h = p.height, t = 0.03, f = 0.035;
    parts.add(box(-w / 2, w / 2, 0, f, 0, t), '#7A4B2A', 0.55);
    parts.add(box(-w / 2, w / 2, h - f, h, 0, t), '#7A4B2A', 0.55);
    parts.add(box(-w / 2, -w / 2 + f, f, h - f, 0, t), '#7A4B2A', 0.55);
    parts.add(box(w / 2 - f, w / 2, f, h - f, 0, t), '#7A4B2A', 0.55);
    parts.add(box(-w / 2 + f, w / 2 - f, f, h - f, 0.004, 0.012), '#F4EDE0', 0.9);
    const m = 0.045;
    const art = new THREE.PlaneGeometry(w - 2 * (f + m), h - 2 * (f + m));
    art.translate(0, h / 2, 0.0135);
    const tex = artTexture(p.tone);
    if (tex) parts.mesh(art, kit.texturedMat(tex, 0.8), false);
    else parts.add(art, '#E8A860', 0.8);
  },
  pooja(p, parts, _kit, seg) {
    const w = p.w, h = p.height, d = p.d;
    parts.add(box(-w / 2, w / 2, 0, h - 0.14, 0, 0.02), '#EBCB8E', 0.8);
    parts.add(box(-w / 2, -w / 2 + 0.025, 0, h - 0.14, 0, d), WOOD, 0.6);
    parts.add(box(w / 2 - 0.025, w / 2, 0, h - 0.14, 0, d), WOOD, 0.6);
    parts.add(box(-w / 2, w / 2, 0.06, 0.09, 0, d), '#B8793F', 0.55);
    parts.add(box(-w / 2, w / 2, h - 0.16, h - 0.14, 0, d), WOOD, 0.6);
    // a small temple roof
    const roof = new THREE.ConeGeometry(0.5, 0.14, 4, 1);
    roof.rotateY(Math.PI / 4); roof.scale(w * 0.78, 1, d * 1.18); roof.translate(0, h - 0.14 + 0.07, d / 2);
    parts.add(roof, '#B5573A', 0.6);
    parts.add(cyl(0.004, 0.004, h - 0.01, 0.025, 5, 0, d / 2), BRASS, 0.4, 0.6);
    const shelf = 0.09;
    // brass diya with its small flame, a kalash and a hanging bell
    parts.add(cyl(0.04, 0.026, shelf, 0.02, seg.s, -0.18, d * 0.55), BRASS, 0.35, 0.65);
    parts.add(ball(0.009, 6, -0.18, shelf + 0.034, d * 0.55, 0.8, 1.7, 0.8), '#FFB04A', 0.4, 0, { emissive: '#FF9A2B', shadow: false });
    parts.add(ball(0.05, seg.s, 0.08, shelf + 0.055, d * 0.5, 1, 0.95, 1), BRASS, 0.35, 0.65);
    parts.add(cyl(0.022, 0.03, shelf + 0.09, 0.05, seg.s, 0.08, d * 0.5), BRASS, 0.35, 0.65);
    parts.add(ball(0.03, 8, 0.08, shelf + 0.165, d * 0.5, 1, 0.9, 1), '#7A5A2A', 0.8);
    parts.add(cyl(0.004, 0.004, h - 0.3, 0.14, 4, 0.24, d * 0.3), BRASS, 0.4, 0.6);
    parts.add(cyl(0.012, 0.03, h - 0.37, 0.07, seg.s, 0.24, d * 0.3), BRASS, 0.35, 0.65);
    // a marigold string along the front of the roof
    const n = 13;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), x = -w / 2 + 0.03 + u * (w - 0.06);
      const y = h - 0.19 - Math.sin(u * Math.PI) * 0.045;
      parts.add(ball(0.019, 6, x, y, d - 0.01), i % 2 ? '#E8A33D' : '#E8793A', 0.7);
    }
  },
};

// ---------------------------------------------------------------- assembly

export interface BuiltDecor {
  group: THREE.Group;
  /** piece id -> its object, so a piece can be hidden */
  byId: Map<string, THREE.Object3D>;
  dispose(): void;
}

/**
 * Builds every piece into one group. `tier` thins out the round parts and picks the model file. With a `models` policy (the active style
 * pack's, SPEC 16.15) a piece may be a free CC0 model instead: the generated piece is built first and the model replaces it when it arrives.
 */
export function buildDecorGroup(pieces: DecorPiece[], tier: 'low' | 'medium' | 'high' = 'medium', models: ModelPolicy | null = null): BuiltDecor {
  const kit = new DecorKit();
  const root = new THREE.Group();
  root.name = 'lived-in';
  root.userData.livedIn = true;
  const byId = new Map<string, THREE.Object3D>();
  const ultra = ultraDetail() && tier !== 'low';
  const seg: Seg = { s: ultra ? 48 : tier === 'low' ? 8 : tier === 'medium' ? 12 : 16 };
  let disposed = false;
  for (const p of pieces) {
    const parts = new Parts(kit);
    if (ultra && ULTRA_REPLACES.has(p.kind)) ULTRA_BUILD[p.kind]!(p, parts);
    else BUILD[p.kind](p, parts, kit, seg);
    const g = parts.finish();
    g.name = `decor:${p.id}`;
    g.userData.pieceId = p.id;
    g.userData.livedIn = true;
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yawDeg * DEG;
    root.add(g);
    byId.set(p.id, g);
    if (models && !disposed) void attachDecorModel(g, p, tier, models, () => !disposed);
  }
  // a belt and braces pass: no mesh anywhere under the root can be hit by a ray
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).raycast = noRaycast; });
  return {
    group: root,
    byId,
    dispose() {
      disposed = true;
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      kit.dispose();
      root.removeFromParent();
    },
  };
}
