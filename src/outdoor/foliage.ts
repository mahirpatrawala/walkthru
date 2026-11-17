// Plants (SPEC 19.4): procedural, instanced, wind-animated and tiered. A tree is a trunk (a tapered tube with a few branches) and clumps of leaf
// cards (alpha-tested quads carrying a painted leaf spray, with normals pointing out from the clump so a crown is lit like a soft ball and not like
// a pile of flat cards); a palm is a ringed trunk and arching fronds; a shrub is a dome of clumps from the ground; a hedge is a clipped, leafy
// rounded block. Every species is built once as geometry and drawn as ONE instanced mesh (two with a trunk), so a garden of two hundred plants is a
// few draw calls. The leaf sprays are painted on a canvas when the page has one (Node, in the tests, has none: flat colours then).
import * as THREE from 'three';
import type { Tier } from '../look/types';
import { VEG_TIER, rng } from './plants';
import type { HedgeSeg } from './plants';
import { SPECIES, speciesOf } from './species';
import type { Species } from './species';
import type { PlantSpot, SpeciesId } from './types';

const hasDom = (): boolean => typeof document !== 'undefined';

// ---------------------------------------------------------------- painted leaves

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (!hasDom()) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}
const toTex = (c: HTMLCanvasElement): THREE.Texture => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };

function leaf(g: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, ang: number, base: string, lite: string): void {
  g.save();
  g.translate(x, y); g.rotate(ang);
  const grad = g.createLinearGradient(0, 0, 0, -len);
  grad.addColorStop(0, base); grad.addColorStop(1, lite);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(wid, -len * 0.25, wid * 0.9, -len * 0.75, 0, -len);
  g.bezierCurveTo(-wid * 0.9, -len * 0.75, -wid, -len * 0.25, 0, 0);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = Math.max(1, len * 0.03);
  g.beginPath(); g.moveTo(0, -len * 0.05); g.lineTo(0, -len * 0.92); g.stroke();
  g.restore();
}

const LEAF_SCALE: Partial<Record<SpeciesId, number>> = { neem: 0.34, gulmohar: 0.3, ficus: 0.55, bougainvillea: 0.55, hibiscus: 0.7, croton: 0.85, frangipani: 1.05 };

/** a spray of leaves from the bottom centre, with flower heads among them for the species that flower */
export function sprayTexture(sp: Species, seed: number): THREE.Texture | null {
  const cv = canvas(256, 256);
  if (!cv) return null;
  const { c, g } = cv;
  const r = rng(seed);
  g.clearRect(0, 0, 256, 256);
  const [mid, lite, dark] = sp.leaf;
  // small-leaved trees (neem, gulmohar) get many small leaflets, big-leaved plants (frangipani, croton) a few large leaves
  const ls = LEAF_SCALE[sp.id] ?? 1;
  const n = Math.round((sp.form === 'bush' ? 9 : 16) / (ls * ls) * (ls < 0.7 ? 0.8 : 1));
  for (let i = 0; i < n; i++) {
    const a = (r() - 0.5) * (sp.form === 'bush' ? 2.2 : 2.6);
    const len = (80 + r() * 90) * ls, wid = ((sp.form === 'bush' ? 26 : 20) + r() * 14) * ls;
    leaf(g, 128 + (r() - 0.5) * 50, 246 - r() * 20, len, wid, a, r() > 0.5 ? mid : dark, r() > 0.4 ? lite : mid);
  }
  if (sp.flower && sp.flowerAmount > 0) {
    const m = Math.round(8 + sp.flowerAmount * 36);
    for (let i = 0; i < m; i++) {
      const x = 40 + r() * 176, y = 30 + r() * 170, rr = 7 + r() * 7;
      g.fillStyle = sp.flower;
      if (sp.id === 'frangipani') { // five-petal blooms, cream with a yellow eye
        for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(x + Math.cos(k * 1.256) * rr * 0.7, y + Math.sin(k * 1.256) * rr * 0.7, rr * 0.7, rr * 0.4, k * 1.256, 0, 6.283); g.fill(); }
        g.fillStyle = '#F2C94C'; g.beginPath(); g.arc(x, y, rr * 0.32, 0, 6.283); g.fill();
      } else if (sp.id === 'bougainvillea') { // papery bracts in clusters of three
        for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(x + (k - 1) * rr * 0.9, y + (k % 2) * rr * 0.5, rr * 0.8, rr * 1.0, (k - 1) * 0.5, 0, 6.283); g.fill(); }
      } else { g.beginPath(); g.arc(x, y, rr, 0, 6.283); g.fill(); }
    }
  }
  return toTex(c);
}

/** a pinnate frond up the page: a rib and leaflets that sweep up and out along it, longer in the middle */
export function frondTexture(sp: Species): THREE.Texture | null {
  const cv = canvas(128, 512);
  if (!cv) return null;
  const { c, g } = cv;
  g.clearRect(0, 0, 128, 512);
  const [mid, lite] = sp.leaf;
  g.strokeStyle = lite; g.lineWidth = 3; g.beginPath(); g.moveTo(64, 510); g.lineTo(64, 6); g.stroke();
  for (let y = 490; y > 14; y -= 7) {
    const t = (510 - y) / 500;
    const L = 58 * Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.95));
    for (const s of [-1, 1]) {
      g.strokeStyle = (Math.round(y) % 14 === 0) ? mid : lite; g.lineWidth = 3.2;
      g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 + s * L * 0.6, y - L * 0.35, 64 + s * L, y - L * 0.55); g.stroke();
    }
  }
  return toTex(c);
}

/** a dense mat of leaves for a clipped hedge: opaque, tiles */
export function hedgeTexture(sp: Species, seed: number): THREE.Texture | null {
  const cv = canvas(256, 256);
  if (!cv) return null;
  const { c, g } = cv;
  const r = rng(seed);
  g.fillStyle = sp.leaf[2]; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 520; i++) leaf(g, r() * 256, r() * 256 + 20, 20 + r() * 18, 7 + r() * 5, r() * 6.283, r() > 0.5 ? sp.leaf[0] : sp.leaf[2], sp.leaf[r() > 0.5 ? 1 : 0]);
  const t = toTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- geometry

interface Buf { pos: number[]; nor: number[]; uv: number[]; col: number[]; idx: number[] }
const newBuf = (): Buf => ({ pos: [], nor: [], uv: [], col: [], idx: [] });
function toGeo(b: Buf): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.idx);
  return g;
}

/** a card (a quad of `w` by `h`, bottom-centre at `at`) turned to face `yaw` and tipped `tilt` back, normals pushed out from `centre` */
function card(b: Buf, at: THREE.Vector3, w: number, h: number, yaw: number, tilt: number, centre: THREE.Vector3, shade: number, upBias = 0.35): void {
  const o = b.pos.length / 3;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, yaw, 0, 'YXZ'));
  const corners: [number, number][] = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
  const mid = new THREE.Vector3(0, h / 2, 0).applyQuaternion(q).add(at);
  const nrm = mid.clone().sub(centre).normalize().lerp(new THREE.Vector3(0, 1, 0), upBias).normalize();
  corners.forEach(([x, y], i) => {
    const p = new THREE.Vector3(x, y, 0).applyQuaternion(q).add(at);
    b.pos.push(p.x, p.y, p.z);
    b.nor.push(nrm.x, nrm.y, nrm.z);
    b.uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
    const s = shade * (0.78 + 0.3 * Math.min(1, Math.max(0, (p.y - centre.y) / (h * 1.4) + 0.5)));
    b.col.push(s, s, s);
  });
  b.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
}

/** a tube from a to b of radius ra at a and rb at b (sides facets), with its colour banded for bark */
function tubeBetween(b: Buf, a: THREE.Vector3, c: THREE.Vector3, ra: number, rb: number, sides: number, col: THREE.Color, rings = 0): void {
  const dir = c.clone().sub(a);
  const len = dir.length();
  const up = dir.clone().normalize();
  const side = Math.abs(up.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(up).normalize();
  const fwd = up.clone().cross(side).normalize();
  const seg = Math.max(1, rings);
  const o = b.pos.length / 3;
  for (let k = 0; k <= seg; k++) {
    const t = k / seg, r = ra + (rb - ra) * t;
    const centre = a.clone().addScaledVector(up, len * t);
    const band = rings > 0 ? (k % 2 === 0 ? 1 : 0.86) : 1;
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(ang)).addScaledVector(fwd, Math.sin(ang));
      const p = centre.clone().addScaledVector(n, r);
      b.pos.push(p.x, p.y, p.z); b.nor.push(n.x, n.y, n.z); b.uv.push(i / sides, t);
      b.col.push(col.r * band, col.g * band, col.b * band);
    }
  }
  for (let k = 0; k < seg; k++) for (let i = 0; i < sides; i++) {
    const i2 = (i + 1) % sides;
    const p0 = o + k * sides + i, p1 = o + k * sides + i2, p2 = o + (k + 1) * sides + i2, p3 = o + (k + 1) * sides + i;
    b.idx.push(p0, p2, p1, p0, p3, p2);
  }
}

export interface SpeciesGeometry { leaves: THREE.BufferGeometry; trunk: THREE.BufferGeometry | null; heightM: number; kind: 'spray' | 'frond' }

/** One clump of cards around `c`, radius `r`, `n` cards. */
function clump(b: Buf, c: THREE.Vector3, r: number, n: number, cardW: number, cardH: number, shade: number, rnd: () => number, centre: THREE.Vector3): void {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, e = (rnd() - 0.35) * 1.6, rr = r * Math.sqrt(rnd());
    const at = new THREE.Vector3(c.x + Math.cos(a) * rr * Math.cos(e), c.y + Math.sin(e) * rr * 0.8, c.z + Math.sin(a) * rr * Math.cos(e));
    card(b, at, cardW * (0.8 + rnd() * 0.5), cardH * (0.8 + rnd() * 0.5), rnd() * Math.PI * 2, 0.2 + rnd() * 0.9, centre, shade * (0.88 + rnd() * 0.2));
  }
}

/** A frond: a strip of `segs` quads along an arc that rises then droops, `len` long and `w` wide, turned `yaw`, from `at`. */
function frond(b: Buf, at: THREE.Vector3, len: number, w: number, yaw: number, rise: number, droop: number, segs: number, shade: number): void {
  const o = b.pos.length / 3;
  const dirx = Math.sin(yaw), dirz = Math.cos(yaw);
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    const out = len * t, up = rise * len * t - droop * len * t * t;
    const cx = at.x + dirx * out, cy = at.y + up, cz = at.z + dirz * out;
    // the strip's width runs across the frond; its normal tips with the arc
    const tx = dirx * len + 0, ty = rise * len - 2 * droop * len * t;
    const tl = Math.hypot(Math.hypot(dirx * len, dirz * len), ty);
    const nx = -ty / tl * dirx, ny = Math.hypot(dirx * len, dirz * len) / tl, nz = -ty / tl * dirz;
    void tx;
    for (const s of [-1, 1]) {
      b.pos.push(cx + dirz * w * 0.5 * s * (1 - t * 0.25), cy, cz - dirx * w * 0.5 * s * (1 - t * 0.25));
      b.nor.push(nx, ny, nz);
      b.uv.push(s < 0 ? 0 : 1, t);
      const v = shade * (0.8 + 0.25 * t);
      b.col.push(v, v, v);
    }
  }
  for (let k = 0; k < segs; k++) { const i = o + k * 2; b.idx.push(i, i + 1, i + 3, i, i + 3, i + 2); }
}

export function buildSpecies(id: SpeciesId, tier: Tier): SpeciesGeometry {
  const sp = speciesOf(id);
  const t = VEG_TIER[tier];
  const rnd = rng(Array.from(id).reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) + (tier === 'high' ? 3 : tier === 'low' ? 1 : 2));
  const H = (sp.heightM[0] + sp.heightM[1]) / 2;
  const leaves = newBuf(), trunk = newBuf();
  const bark = new THREE.Color(sp.trunk);
  const sides = tier === 'low' ? 5 : 8;
  let kind: 'spray' | 'frond' = 'spray';
  if (sp.form === 'palm') {
    kind = 'frond';
    const crownY = H - 0.4;
    tubeBetween(trunk, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.12, crownY * 0.96, 0.05), sp.trunkR * 1.25, sp.trunkR * 0.82, sides + 2, bark, Math.round(crownY / 0.28));
    tubeBetween(trunk, new THREE.Vector3(0.12, crownY * 0.96, 0.05), new THREE.Vector3(0.14, crownY + 0.6, 0.06), sp.trunkR * 0.8, sp.trunkR * 0.6, sides, new THREE.Color('#6FA14A'), 1);
    const n = Math.round(t.cardsPerClump * 1.9);
    for (let i = 0; i < n; i++) {
      const yaw = (i / n) * Math.PI * 2 + rnd() * 0.3, hi = i % 3 === 0;
      frond(leaves, new THREE.Vector3(0.14, crownY + 0.5, 0.06), 2.6 + rnd() * 0.7, 1.15, yaw, hi ? 0.95 : 0.55 - (i % 2) * 0.12, hi ? 0.55 : 0.8, 5, 0.9 + rnd() * 0.2);
    }
  } else if (sp.form === 'clumping-palm') {
    kind = 'frond';
    const stems = 5 + Math.round(rnd() * 2);
    for (let s = 0; s < stems; s++) {
      const a = (s / stems) * Math.PI * 2 + rnd(), lean = 0.12 + rnd() * 0.18, h = H * (0.62 + rnd() * 0.45);
      const base = new THREE.Vector3(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1), top = new THREE.Vector3(Math.cos(a) * (0.1 + lean * h), h, Math.sin(a) * (0.1 + lean * h));
      tubeBetween(trunk, base, top, sp.trunkR * 1.5, sp.trunkR, 5, bark, 5);
      const nf = Math.max(4, Math.round(t.cardsPerClump * 0.55));
      for (let i = 0; i < nf; i++) frond(leaves, top, 1.2 + rnd() * 0.5, 0.55, (i / nf) * Math.PI * 2 + rnd() * 0.5, 0.5 + rnd() * 0.4, 0.5 + rnd() * 0.3, 4, 0.9 + rnd() * 0.2);
    }
  } else if (sp.form === 'crown' || sp.form === 'umbrella') {
    const umbrella = sp.form === 'umbrella';
    const trunkTop = H * (umbrella ? 0.5 : 0.45);
    const lean = new THREE.Vector3((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4);
    const top = new THREE.Vector3(lean.x, trunkTop, lean.z);
    tubeBetween(trunk, new THREE.Vector3(0, 0, 0), top, sp.trunkR * 1.35, sp.trunkR * 0.85, sides, bark, 3);
    const nClump = t.clumpsPerTree;
    const centres: THREE.Vector3[] = [];
    const branches = umbrella ? 5 : 4;
    for (let i = 0; i < nClump; i++) {
      const a = (i / nClump) * Math.PI * 2 * 2.4 + rnd();
      const ring = umbrella ? 0.3 + 0.7 * Math.sqrt((i % 7) / 6 + 0.1) : 0.35 + rnd() * 0.65;
      const rad = sp.crownR * ring * 0.82;
      const y = umbrella ? H * 0.62 + (1 - ring) * H * 0.28 + rnd() * 0.5 : trunkTop + 0.3 + rnd() * (H - trunkTop) * 0.9;
      centres.push(new THREE.Vector3(top.x + Math.cos(a) * rad, y, top.z + Math.sin(a) * rad));
    }
    const crownCentre = new THREE.Vector3(top.x, umbrella ? H * 0.72 : (trunkTop + H) / 2, top.z);
    centres.forEach((c, i) => {
      if (i < branches * (umbrella ? 1 : 1)) tubeBetween(trunk, new THREE.Vector3(top.x, trunkTop * 0.9, top.z), c.clone().setY(c.y - 0.5), sp.trunkR * 0.5, sp.trunkR * 0.2, 5, bark, 2);
      clump(leaves, c, sp.crownR * (umbrella ? 0.5 : 0.45), t.cardsPerClump, sp.crownR * 0.3, sp.crownR * 0.34, 1, rnd, crownCentre);
    });
  } else {
    // a shrub or a bush: a dome of clumps from the ground
    const n = sp.form === 'shrub' ? 3 : 2;
    const centre = new THREE.Vector3(0, H * 0.5, 0);
    for (let i = 0; i < n * 3; i++) {
      const a = rnd() * Math.PI * 2, rad = sp.crownR * (i === 0 ? 0 : 0.35 + rnd() * 0.45);
      clump(leaves, new THREE.Vector3(Math.cos(a) * rad, H * (0.35 + rnd() * 0.4), Math.sin(a) * rad), sp.crownR * 0.45, Math.max(3, Math.round(t.cardsPerClump * (sp.form === 'shrub' ? 0.33 : 0.18))), sp.crownR * 0.42, sp.crownR * 0.46, 1, rnd, centre);
    }
    if (sp.form === 'shrub') for (let i = 0; i < 3; i++) { const a = rnd() * 6.283; tubeBetween(trunk, new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.1, H * 0.45, Math.sin(a) * 0.1), sp.trunkR, sp.trunkR * 0.6, 4, bark, 1); }
  }
  return { leaves: toGeo(leaves), trunk: trunk.pos.length ? toGeo(trunk) : null, heightM: H, kind };
}

const triCache = new Map<string, number>();
/** the exact triangles of one plant of a species at a tier (leaves and trunk), from the geometry itself */
export function speciesTriangles(id: SpeciesId, tier: Tier): number {
  const k = `${id}|${tier}`;
  let n = triCache.get(k);
  if (n === undefined) {
    const g = buildSpecies(id, tier);
    const t = (x: THREE.BufferGeometry | null): number => (x ? (x.index ? x.index.count : x.attributes.position.count) / 3 : 0);
    n = t(g.leaves) + t(g.trunk);
    g.leaves.dispose(); g.trunk?.dispose();
    triCache.set(k, n);
  }
  return n;
}

/** a rounded, slightly lumpy block of unit size (1 x 1 x 1 about the base centre) for a clipped hedge; UV repeats the leaf mat */
/** facets of a hedge block by tier: low 5 x 4 x 3 (188 triangles), medium 8 x 6 x 4 (416), high 10 x 8 x 6 (752) */
export const HEDGE_SEGS: Record<Tier, [number, number, number]> = { low: [5, 4, 3], medium: [8, 6, 4], high: [10, 8, 6] };
export const hedgeBlockTriangles = (tier: Tier): number => { const [a, b, c] = HEDGE_SEGS[tier]; return 4 * (a * b + a * c + b * c); };
export function hedgeBlock(tier: Tier = 'high'): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, ...HEDGE_SEGS[tier]);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // a superellipsoid: scale each point so its 4-norm equals its max-norm, which rounds every edge and corner; the bottom stays flat
    const m = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    const n4 = Math.pow(v.x ** 4 + v.y ** 4 + v.z ** 4, 0.25) || 1;
    v.multiplyScalar(m / n4);
    if (v.y < 0) v.y = Math.max(v.y, -0.5);
    const n = Math.sin(v.x * 21.1 + v.y * 11.7 + v.z * 5.3) * Math.cos(v.z * 17.3 + v.x * 7.7);
    v.multiplyScalar(1 + n * 0.03);
    p.setXYZ(i, v.x, v.y + 0.5, v.z);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.2, uv.getY(i) * 1.6);
  return g;
}

// ---------------------------------------------------------------- instanced drawing

export interface FoliageHandle {
  group: THREE.Group;
  /** the wind and the clock: call every frame */
  update(dt: number): void;
  /** drawn plants, hedge blocks, instanced meshes */
  counts: { plants: number; hedges: number; instanced: number };
  dispose(): void;
}

/** Wind sway in the vertex shader: bends a plant more the higher the vertex is, out of step from plant to plant. Shadows (static) do not move. */
function withWind(mat: THREE.MeshStandardMaterial, uTime: { value: number }, amp: number, height: number): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uAmp = { value: amp };
    sh.uniforms.uH = { value: height };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uAmp; uniform float uH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float wPh = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7;
  float wK = clamp(transformed.y / uH, 0.0, 1.5);
  float wS = sin(uTime * 1.6 + wPh + transformed.y * 0.6) + 0.5 * sin(uTime * 2.7 + wPh * 1.7);
  transformed.x += wS * uAmp * wK * wK;
  transformed.z += cos(uTime * 1.3 + wPh) * uAmp * 0.6 * wK * wK;
#endif`);
  };
  mat.customProgramCacheKey = () => 'ow-wind';
}

export function mountFoliage(spots: PlantSpot[], hedges: HedgeSeg[], tier: Tier, seed: number): FoliageHandle {
  const group = new THREE.Group();
  group.name = 'outdoor-plants';
  const disposables: { dispose(): void }[] = [];
  const clock = { value: 0 };
  const windOn = VEG_TIER[tier].wind;
  const r = rng(seed * 977 + 5);
  const bySpecies = new Map<SpeciesId, PlantSpot[]>();
  for (const s of spots) { const l = bySpecies.get(s.species) ?? []; l.push(s); bySpecies.set(s.species, l); }
  let instanced = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
  for (const [id, list] of bySpecies) {
    const sp = SPECIES[id];
    const geo = buildSpecies(id, tier);
    const tex = geo.kind === 'frond' ? frondTexture(sp) : sprayTexture(sp, seed + id.length * 13);
    const leafMat = new THREE.MeshStandardMaterial({ map: tex ?? undefined, color: tex ? '#ffffff' : sp.leaf[0], alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.82, metalness: 0, emissive: new THREE.Color(sp.leaf[2]).multiplyScalar(0.5), emissiveIntensity: 0.55 }); // the emissive is a minimum ambient: from the doll house's high angle the cards face the sky and used to go near black
    // palm fronds are long cards that lie nearly flat and face the sky from above: a constant dark emissive left them black in the doll house (round 5),
    // so a frond lights itself with its own texture colour, as a leaf lit through would
    if (tex && geo.kind === 'frond') { leafMat.emissiveMap = tex; leafMat.emissive = new THREE.Color('#ffffff'); leafMat.emissiveIntensity = 0.7; }
    if (windOn) withWind(leafMat, clock, geo.kind === 'frond' ? 0.07 : 0.045, Math.max(1, geo.heightM));
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(g, m, list.length);
      im.name = name; im.userData.outdoor = name; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      list.forEach((s, i) => {
        const k = (s.scale ?? 1) * (sp.heightM[0] + (sp.heightM[1] - sp.heightM[0]) * (0.35 + 0.3 * r())) / geo.heightM;
        e.set(0, ((s.rotDeg ?? r() * 360) * Math.PI) / 180, 0);
        q.setFromEuler(e); sc.set(k, k, k); pos.set(s.x, 0, s.z);
        m4.compose(pos, q, sc); im.setMatrixAt(i, m4);
        const tint = 0.9 + r() * 0.2;
        im.setColorAt(i, col.setRGB(tint, tint * (0.96 + r() * 0.08), tint * (0.92 + r() * 0.1)));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      group.add(im); instanced++;
      return im;
    };
    mk(geo.leaves, leafMat, `plants:${id}:leaves`);
    disposables.push(geo.leaves, leafMat);
    if (tex) disposables.push(tex);
    if (geo.trunk) {
      const tm = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.95 });
      if (windOn) withWind(tm, clock, 0.03, Math.max(1, geo.heightM));
      mk(geo.trunk, tm, `plants:${id}:trunk`);
      disposables.push(geo.trunk, tm);
    }
  }
  // clipped hedges: one instanced block per species
  const hByS = new Map<SpeciesId, HedgeSeg[]>();
  for (const h of hedges) { const l = hByS.get(h.species) ?? []; l.push(h); hByS.set(h.species, l); }
  for (const [id, list] of hByS) {
    const sp = SPECIES[id];
    const tex = hedgeTexture(sp, seed + 31);
    const mat = new THREE.MeshStandardMaterial({ map: tex ?? undefined, color: tex ? '#ffffff' : sp.leaf[2], roughness: 0.9 });
    const g = hedgeBlock(tier);
    const im = new THREE.InstancedMesh(g, mat, list.length);
    im.name = `hedge:${id}`; im.userData.outdoor = im.name; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    list.forEach((h, i) => {
      e.set(0, (h.yawDeg * Math.PI) / 180 - Math.PI / 2 + Math.PI / 2, 0);
      // the block's length runs along its local z (yaw 0 faces +z), so a hedge that runs along `yawDeg` needs no extra turn
      q.setFromEuler(e); sc.set(h.widthM, h.heightM, h.lenM); pos.set(h.x, 0, h.z);
      m4.compose(pos, q, sc); im.setMatrixAt(i, m4);
      const tint = 0.92 + r() * 0.16; im.setColorAt(i, col.setRGB(tint, tint, tint));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    group.add(im); instanced++;
    disposables.push(g, mat); if (tex) disposables.push(tex);
  }
  return {
    group, counts: { plants: spots.length, hedges: hedges.length, instanced },
    update(dt) { clock.value += dt; },
    dispose() { for (const d of disposables) d.dispose(); group.removeFromParent(); },
  };
}
