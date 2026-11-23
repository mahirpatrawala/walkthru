// Plants (SPEC 19.4): procedural, instanced, wind-animated and tiered. A tree is a trunk (a tapered tube with a few branches) and clumps of leaf
// cards (alpha-tested quads carrying a painted leaf spray, with normals pointing out from the clump so a crown is lit like a soft ball and not like
// a pile of flat cards); a palm is a ringed trunk and arching fronds; a shrub is a dome of clumps from the ground; a hedge is a clipped, leafy
// rounded block. Every species is built once as geometry and drawn as ONE instanced mesh (two with a trunk), so a garden of two hundred plants is a
// few draw calls. The leaf sprays are painted on a canvas when the page has one (Node, in the tests, has none: flat colours then).
import * as THREE from 'three';
import type { Tier } from '../look/types';
import { CANDELABRA, VEG_TIER, rng } from './plants';
import type { HedgeSeg } from './plants';
import { SPECIES, speciesOf } from './species';
import type { Species } from './species';
import type { PlantSpot, SpeciesId } from './types';
import type { AssetLoader } from '../look/assets';
import { BARK_PATH, BARK_REPEAT_M, FROND_PATH, HEDGE_PATH, HEDGE_REPEAT_M, LEAFY_PARTS, loadOutdoorModel, OUTDOOR_MODELS, photoTexture, sprayPath, tipPath } from './real';

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

/**
 * SPEC 19.14 (23 Nov 2026): a frangipani's tip atlas, painted (the photographic one, leaves/frangipani-tip.webp, replaces it when it arrives):
 * the left half is one long leaf, base at the bottom centre; the right half a cluster of five-petalled cream flowers with a yellow throat.
 */
export function tipTexture(sp: Species, seed: number): THREE.Texture | null {
  const cv = canvas(512, 256);
  if (!cv) return null;
  const { c, g } = cv;
  const r = rng(seed);
  g.clearRect(0, 0, 512, 256);
  leaf(g, 128, 252, 245, 34, 0, sp.leaf[0], sp.leaf[1]);
  for (let i = 0; i < 11; i++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * 80, x = 384 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, rr = 20 + r() * 8, rot = r() * 6.283;
    for (let k = 0; k < 5; k++) {
      const pa = rot + (k / 5) * 6.283;
      const grad = g.createLinearGradient(x, y, x + Math.cos(pa) * rr, y + Math.sin(pa) * rr);
      grad.addColorStop(0, '#F2BE3C'); grad.addColorStop(0.4, sp.flower ?? '#FBF3E0'); grad.addColorStop(1, sp.flower ?? '#FBF3E0');
      g.fillStyle = grad;
      g.beginPath(); g.ellipse(x + Math.cos(pa + 0.3) * rr * 0.5, y + Math.sin(pa + 0.3) * rr * 0.5, rr * 0.55, rr * 0.3, pa + 0.3, 0, 6.283); g.fill();
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
function card(b: Buf, at: THREE.Vector3, w: number, h: number, yaw: number, tilt: number, centre: THREE.Vector3, shade: number, upBias = 0.35, crownR = 0, v0 = 0): void {
  const o = b.pos.length / 3;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, yaw, 0, 'YXZ'));
  const corners: [number, number][] = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
  const mid = new THREE.Vector3(0, h / 2, 0).applyQuaternion(q).add(at);
  const nrm = mid.clone().sub(centre).normalize().lerp(new THREE.Vector3(0, 1, 0), upBias).normalize();
  // SPEC 19.12: the inside of a crown is in its own shade (a card near the middle is darker than one on the skin), so a crown has depth
  if (crownR > 0) { const t = Math.min(1, mid.distanceTo(centre) / crownR); shade *= 0.42 + 0.58 * t * t * (3 - 2 * t); }
  corners.forEach(([x, y], i) => {
    const p = new THREE.Vector3(x, y, 0).applyQuaternion(q).add(at);
    b.pos.push(p.x, p.y, p.z);
    b.nor.push(nrm.x, nrm.y, nrm.z);
    b.uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : v0);
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
      // SPEC 19.12: the bark picture is BARK_REPEAT_M a repeat, round the trunk and along it
      b.pos.push(p.x, p.y, p.z); b.nor.push(n.x, n.y, n.z); b.uv.push((i / sides) * Math.max(1, Math.round((2 * Math.PI * r) / BARK_REPEAT_M)), (t * len) / BARK_REPEAT_M);
      b.col.push(col.r * band, col.g * band, col.b * band);
    }
  }
  for (let k = 0; k < seg; k++) for (let i = 0; i < sides; i++) {
    const i2 = (i + 1) % sides;
    const p0 = o + k * sides + i, p1 = o + k * sides + i2, p2 = o + (k + 1) * sides + i2, p3 = o + (k + 1) * sides + i;
    b.idx.push(p0, p2, p1, p0, p3, p2);
  }
}

export interface SpeciesGeometry { leaves: THREE.BufferGeometry; trunk: THREE.BufferGeometry | null; heightM: number; kind: 'spray' | 'frond' | 'tip' }

/** where the leafy part of a shrub's spray picture starts (the bare twig is below it) */
export const SHRUB_V0 = 0.3;

/** a quad from four corners with one normal, uv from (u0, v0) to (u1, v1), a shade */
function quad(b: Buf, p: THREE.Vector3[], n: THREE.Vector3, u0: number, u1: number, v0: number, v1: number, shade: number): void {
  const o = b.pos.length / 3;
  const uv: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  p.forEach((q, i) => { b.pos.push(q.x, q.y, q.z); b.nor.push(n.x, n.y, n.z); b.uv.push(uv[i][0], uv[i][1]); b.col.push(shade, shade, shade); });
  b.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
}

/** the leaf's band of the tip atlas (left half, the leaf about a quarter of it wide) and the flowers' half */
const TIP_LEAF_U: [number, number] = [0.19, 0.31];
const TIP_FLOWER_U: [number, number] = [0.5, 1];

/**
 * SPEC 19.14 (23 Nov 2026): a frangipani as it grows: a short grey trunk forking into three thick, smooth limbs that fork again (twice, once on low),
 * each turning upward; at every tip a rosette of long leaves spreading up and out and bending down at the ends, and over it a cluster of cream
 * flowers (a flat card seen from above and one tipped up, seen from the side). The leaves and flowers are one atlas (tipTexture) so a plant is
 * still one instanced mesh of leaves and one of wood.
 */
/** how much shorter each fork of a frangipani is than the limb it grows from */
const FORK_K = 0.72;
function candelabra(sp: Species, tier: Tier, H: number, rnd: () => number, leaves: Buf, trunk: Buf, bark: THREE.Color, sides: number): void {
  const c = CANDELABRA[tier];
  const trunkH = H * 0.3;
  const top = new THREE.Vector3((rnd() - 0.5) * 0.12, trunkH, (rnd() - 0.5) * 0.12);
  tubeBetween(trunk, new THREE.Vector3(0, 0, 0), top, sp.trunkR * 1.2, sp.trunkR * 0.95, sides, bark, 3);
  // limb lengths so the tips reach about H - 0.4: the limbs leave the trunk wide (about 35 degrees up) and turn upward at every fork, so the
  // crown is a broad, rounded dome wider than it is tall, as a garden frangipani's is
  const ELEV = [0, 0.62, 0.8, 0.95, 1.05];
  let span = 0, rise = 0;
  for (let l = 1; l <= c.levels; l++) { const k = Math.pow(FORK_K, l - 1); span += k; rise += k * Math.sin(ELEV[l]); }
  const L0 = (H - 0.4 - trunkH) / rise;
  const tips: { p: THREE.Vector3; az: number }[] = [];
  const grow = (from: THREE.Vector3, az: number, el: number, len: number, r0: number, level: number): void => {
    const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    // a limb bows: out first, then up
    const mid = from.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(Math.cos(az), -0.25, Math.sin(az)).multiplyScalar(len * 0.12));
    const to = from.clone().addScaledVector(dir, len);
    tubeBetween(trunk, from, mid, r0, r0 * 0.9, Math.max(5, sides - 2), bark, 1);
    tubeBetween(trunk, mid, to, r0 * 0.9, r0 * 0.78, Math.max(5, sides - 2), bark, 1);
    if (level >= c.levels) { tips.push({ p: to, az }); return; }
    // a frangipani forks in two at its first fork and in three (a whorl) after that
    const n = level === 1 ? 2 : 3;
    for (let k = 0; k < n; k++) grow(to, az + (n === 2 ? (k === 0 ? -1 : 1) * (0.42 + rnd() * 0.3) : (k - 1) * (0.85 + rnd() * 0.3)), ELEV[level + 1] + (rnd() - 0.5) * 0.16, len * FORK_K * (0.85 + rnd() * 0.3), r0 * 0.76, level + 1);
  };
  const az0 = rnd() * Math.PI * 2;
  for (let i = 0; i < 3; i++) grow(top, az0 + (i / 3) * Math.PI * 2 + (rnd() - 0.5) * 0.4, ELEV[1] + (rnd() - 0.5) * 0.1, L0 * (0.9 + rnd() * 0.2), sp.trunkR * 0.55, 1);
  void span;
  const crown = new THREE.Vector3(top.x, H * 0.7, top.z);
  const up = new THREE.Vector3(0, 1, 0);
  for (const t of tips) {
    // the rosette: leaves round the tip, the inner ones nearly upright, the outer ones spreading, each bent down past its middle
    for (let k = 0; k < c.leaves; k++) {
      const a = t.az + (k / c.leaves) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
      const el = 0.15 + rnd() * 0.85, len = 0.46 + rnd() * 0.2, w = len * 0.32;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(w / 2);
      const d1 = out.clone().multiplyScalar(Math.cos(el)).addScaledVector(up, Math.sin(el));
      const el2 = el - 0.55 - rnd() * 0.3;
      const d2 = out.clone().multiplyScalar(Math.cos(el2)).addScaledVector(up, Math.sin(el2));
      const p0 = t.p.clone().addScaledVector(up, 0.03), p1 = p0.clone().addScaledVector(d1, len * 0.55), p2 = p1.clone().addScaledVector(d2, len * 0.45);
      // the leaf faces the sky a little and away from the crown's middle (lit as part of the crown)
      const n = p1.clone().sub(crown).normalize().lerp(up, 0.5).normalize();
      const shade = 0.82 + rnd() * 0.22;
      quad(leaves, [p0.clone().sub(side.clone().multiplyScalar(0.3)), p0.clone().add(side.clone().multiplyScalar(0.3)), p1.clone().add(side), p1.clone().sub(side)], n, TIP_LEAF_U[0], TIP_LEAF_U[1], 0, 0.55, shade);
      quad(leaves, [p1.clone().sub(side), p1.clone().add(side), p2.clone().add(side.clone().multiplyScalar(0.5)), p2.clone().sub(side.clone().multiplyScalar(0.5))], n, TIP_LEAF_U[0], TIP_LEAF_U[1], 0.55, 1, shade * 1.05);
    }
    // the flowers: a flat card over the tip and one tipped up across it
    const fs = 0.4 + rnd() * 0.1, h = 0.34;
    const a = t.az + rnd();
    const ax = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(fs / 2), az = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(fs / 2);
    const fc = t.p.clone().addScaledVector(up, h);
    quad(leaves, [fc.clone().sub(ax).sub(az), fc.clone().add(ax).sub(az), fc.clone().add(ax).add(az), fc.clone().sub(ax).add(az)], up, TIP_FLOWER_U[0], TIP_FLOWER_U[1], 0, 1, 1.12);
    if (c.flowers > 1) {
      const tilt = az.clone().normalize().multiplyScalar(Math.cos(1.0) * fs / 2).addScaledVector(up, Math.sin(1.0) * fs / 2);
      const n2 = new THREE.Vector3().crossVectors(ax, tilt).normalize().lerp(up, 0.4).normalize();
      const fc2 = fc.clone().addScaledVector(up, 0.02);
      quad(leaves, [fc2.clone().sub(ax).sub(tilt), fc2.clone().add(ax).sub(tilt), fc2.clone().add(ax).add(tilt), fc2.clone().sub(ax).add(tilt)], n2, TIP_FLOWER_U[0], TIP_FLOWER_U[1], 0, 1, 1.05);
    }
  }
}

/** One clump of cards around `c`, radius `r`, `n` cards. */
function clump(b: Buf, c: THREE.Vector3, r: number, n: number, cardW: number, cardH: number, shade: number, rnd: () => number, centre: THREE.Vector3, crownR = 0, v0 = 0): void {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, e = (rnd() - 0.35) * 1.6, rr = r * Math.sqrt(rnd());
    const at = new THREE.Vector3(c.x + Math.cos(a) * rr * Math.cos(e), c.y + Math.sin(e) * rr * 0.8, c.z + Math.sin(a) * rr * Math.cos(e));
    card(b, at, cardW * (0.8 + rnd() * 0.5), cardH * (0.8 + rnd() * 0.5), rnd() * Math.PI * 2, 0.2 + rnd() * 0.9, centre, shade * (0.88 + rnd() * 0.2), 0.35, crownR, v0);
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
  let kind: 'spray' | 'frond' | 'tip' = 'spray';
  if (sp.form === 'candelabra') {
    kind = 'tip';
    candelabra(sp, tier, H, rnd, leaves, trunk, bark, sides);
  } else if (sp.form === 'palm') {
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
      clump(leaves, c, sp.crownR * (umbrella ? 0.5 : 0.45), t.cardsPerClump, sp.crownR * 0.3, sp.crownR * 0.34, 1, rnd, crownCentre, sp.crownR * (umbrella ? 1.15 : 1.0));
    });
  } else {
    // a shrub or a bush: a dome of clumps from the ground
    const n = sp.form === 'shrub' ? 3 : 2;
    const centre = new THREE.Vector3(0, H * 0.5, 0);
    for (let i = 0; i < n * 3; i++) {
      const a = rnd() * Math.PI * 2, rad = sp.crownR * (i === 0 ? 0 : 0.35 + rnd() * 0.45);
      // SPEC 19.12: a shrub is leafy down to the ground (no bare sticks under a lollipop), shaded in its middle
      // SPEC 19.14 (23 Nov 2026): a shrub's card shows only the leafy top of its spray (the bare twig at the foot of the picture read as sticks under
      // every shrub, a bed of lollipops), and the clumps sit lower so the leaves reach the soil
      clump(leaves, new THREE.Vector3(Math.cos(a) * rad, H * (0.06 + rnd() * 0.42), Math.sin(a) * rad), sp.crownR * 0.5, Math.max(3, Math.round(t.cardsPerClump * (sp.form === 'shrub' ? 0.33 : 0.18))), sp.crownR * 0.42, sp.crownR * 0.32, 1, rnd, centre, sp.crownR * 1.1, SHRUB_V0);
    }
    if (sp.form === 'shrub') for (let i = 0; i < 3; i++) { const a = rnd() * 6.283; tubeBetween(trunk, new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.1, H * 0.22, Math.sin(a) * 0.1), sp.trunkR, sp.trunkR * 0.6, 4, bark, 1); }
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

/** a clipped block of unit size (1 x 1 x 1 about the base centre) for a hedge: flat clipped faces with rounded arrises (SPEC 19.13, 23 Nov 2026: was a
 *  lumpy superellipsoid that read as a row of boulders); the leaf mat is mapped in world space by the hedge material, not by UV */
/** facets of a hedge block by tier: low 5 x 4 x 3 (188 triangles), medium 8 x 6 x 4 (416), high 10 x 8 x 6 (752) */
export const HEDGE_SEGS: Record<Tier, [number, number, number]> = { low: [5, 4, 3], medium: [8, 6, 4], high: [10, 8, 6] };
/** SPEC 19.14 (23 Nov 2026): sprigs that stand proud of a clipped face (it is never perfectly flat), per block: none on low */
export const HEDGE_SPRIGS: Record<Tier, number> = { low: 0, medium: 14, high: 26 };
export const hedgeBlockTriangles = (tier: Tier): number => { const [a, b, c] = HEDGE_SEGS[tier]; return 4 * (a * b + a * c + b * c) + HEDGE_SPRIGS[tier] * 2; };
export function hedgeBlock(tier: Tier = 'high'): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, ...HEDGE_SEGS[tier]);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // a superellipsoid of a high power: flat faces, the edges and corners rounded over the outer tenth; the bottom stays flat
    const m = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    const n8 = Math.pow(v.x ** 8 + v.y ** 8 + v.z ** 8, 0.125) || 1;
    v.multiplyScalar(m / n8);
    if (v.y < 0) v.y = Math.max(v.y, -0.5);
    // the top is clipped a touch narrower than the foot (a clipped hedge batters in, so light reaches its sides)
    const k = 1 - 0.06 * (v.y + 0.5);
    p.setXYZ(i, v.x * k, v.y + 0.5, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The sprigs of a run of hedge blocks of one size: small leaf cards on the top and the two long faces, their foot inside the block and their
 * leaves standing 5 to 12 cm proud of it, so a clipped hedge has a soft, leafy edge against the sky. Built in the block's unit frame, divided by
 * the block's size so the cards keep their shape when the instance stretches them.
 */
export function hedgeSprigs(tier: Tier, size: { w: number; h: number; l: number }, seed: number): THREE.BufferGeometry {
  const b = newBuf();
  const r = rng(seed);
  const n = HEDGE_SPRIGS[tier];
  const centre = new THREE.Vector3(0, 0.5, 0);
  for (let i = 0; i < n; i++) {
    // on the top (40 %) or a long face (x = +-0.5 in the unit frame)
    const onTop = i % 5 < 2;
    const sx = onTop ? (r() - 0.5) * 0.9 : (i % 2 ? 0.5 : -0.5) * 0.94, sy = onTop ? 1 : 0.25 + r() * 0.72, sz = (r() - 0.5) * 0.98;
    const nrm = onTop ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(Math.sign(sx), 0.25, 0).normalize();
    const lenM = 0.12 + r() * 0.08, wM = lenM * 1.1;
    // the card in metres, then into the unit frame
    const dir = nrm.clone().add(new THREE.Vector3((r() - 0.5) * 0.9, (r() - 0.5) * 0.4, (r() - 0.5) * 0.9)).normalize();
    const across = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize()).normalize().multiplyScalar(wM / 2);
    const foot = new THREE.Vector3(sx * size.w, sy * size.h, sz * size.l).addScaledVector(nrm, -0.05);
    const tip = foot.clone().addScaledVector(dir, lenM);
    const pts = [foot.clone().sub(across), foot.clone().add(across), tip.clone().add(across), tip.clone().sub(across)].map((q) => new THREE.Vector3(q.x / size.w, q.y / size.h, q.z / size.l));
    const nn = pts[2].clone().sub(centre).normalize().lerp(nrm, 0.6).normalize();
    quad(b, pts, nn, 0, 1, 0.45, 1, 0.8 + r() * 0.25);
  }
  return toGeo(b);
}

/**
 * SPEC 19.14 (23 Nov 2026): the hedge's leaf mat in world space (three planar projections blended by the face's normal, a repeat every
 * HEDGE_REPEAT_M), so a stretched block does not stretch its leaves and the blocks of a run carry on into each other; the leaf mat's dark gaps
 * are deepened into shade between the leaves, and the foot and the inside of the hedge are darker (little light reaches them).
 */
function hedgeWorld(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHP; varying vec3 vHN; varying float vHY;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec4 hw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  hw = instanceMatrix * hw;
  vHN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vHN = normalize(mat3(modelMatrix) * objectNormal);
#endif
  hw = modelMatrix * hw; vHP = hw.xyz; vHY = transformed.y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHP; varying vec3 vHN; varying float vHY;')
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec3 hb = pow(abs(normalize(vHN)), vec3(4.0)); hb /= (hb.x + hb.y + hb.z);
  vec3 hq = vHP / ${HEDGE_REPEAT_M.toFixed(2)};
  vec4 hc = texture2D(map, hq.zy) * hb.x + texture2D(map, hq.xz + 0.37) * hb.y + texture2D(map, hq.xy + 0.71) * hb.z;
  float hl = dot(hc.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb *= hc.rgb * mix(0.6, 1.15, smoothstep(0.02, 0.12, hl));
#endif
  diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 0.45, vHY)) * mix(0.9, 1.06, smoothstep(0.85, 1.0, vHY));`);
  };
  mat.customProgramCacheKey = () => 'ow-hedge';
}

// ---------------------------------------------------------------- instanced drawing

function disposeMaterial(m: THREE.MeshStandardMaterial): void {
  for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap, m.aoMap]) t?.dispose();
  m.dispose();
}

export interface FoliageHandle {
  group: THREE.Group;
  /** the wind and the clock: call every frame */
  update(dt: number): void;
  /** drawn plants, hedge blocks, instanced meshes */
  counts: { plants: number; hedges: number; instanced: number };
  dispose(): void;
}

/** Wind sway in the vertex shader: bends a plant more the higher the vertex is, out of step from plant to plant. Shadows (static) do not move. */
/** SPEC 19.12: a card is lit by the normal the crown gave it from both sides (three turns a double-sided face's normal round on its back, which left
 *  half the cards of a crown dark) */
/** 1 / the bark picture's mean linear luminance (0.07): the picture is detail around the species' own bark colour, which stays the mean */
const BARK_GAIN = 1 / 0.0699;

const NO_FLIP = (sh: { fragmentShader: string }): void => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n  normal = normalize( vNormal );\n#endif'); };
function noFlip(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (sh) => NO_FLIP(sh);
  mat.customProgramCacheKey = () => 'ow-leaf';
}

function withWind(mat: THREE.MeshStandardMaterial, uTime: { value: number }, amp: number, height: number): void {
  mat.onBeforeCompile = (sh) => {
    NO_FLIP(sh);
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

export interface FoliageOptions {
  /** SPEC 19.12: the outdoor materials' loader. With it the painted cards give way to photographic ones, trunks take bark, hedges a leaf mat and
   *  a species with a model is redrawn by its model, each as its file arrives; without it (Node, tests) the plants stay as built */
  loader?: AssetLoader;
}

export function mountFoliage(spots: PlantSpot[], hedges: HedgeSeg[], tier: Tier, seed: number, opts: FoliageOptions = {}): FoliageHandle {
  const group = new THREE.Group();
  group.name = 'outdoor-plants';
  const disposables: { dispose(): void }[] = [];
  let disposed = false;
  const clock = { value: 0 };
  const windOn = VEG_TIER[tier].wind;
  const r = rng(seed * 977 + 5);
  const bySpecies = new Map<SpeciesId, PlantSpot[]>();
  for (const s of spots) { const l = bySpecies.get(s.species) ?? []; l.push(s); bySpecies.set(s.species, l); }
  let instanced = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
  /** swaps a material's map for a photographic one when it arrives (the painted canvas it replaces is freed) */
  const swap = (mat: THREE.MeshStandardMaterial, path: string, then?: (t: THREE.Texture) => void): void => {
    if (!opts.loader) return;
    void photoTexture(opts.loader, path).then((t) => {
      if (!t) return;
      if (disposed) return;
      const old = mat.map;
      mat.map = t;
      if (mat.emissiveMap === old) mat.emissiveMap = t;
      then?.(t);
      mat.needsUpdate = true;
      if (old && old !== t) old.dispose();
    });
  };
  for (const [id, list] of bySpecies) {
    const sp = SPECIES[id];
    const geo = buildSpecies(id, tier);
    const tex = geo.kind === 'frond' ? frondTexture(sp) : geo.kind === 'tip' ? tipTexture(sp, seed + 17) : sprayTexture(sp, seed + id.length * 13);
    const leafMat = new THREE.MeshStandardMaterial({ map: tex ?? undefined, color: tex ? '#ffffff' : sp.leaf[0], alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.82, metalness: 0, emissive: new THREE.Color(sp.leaf[2]).multiplyScalar(0.5), emissiveIntensity: 0.55 }); // the emissive is a minimum ambient: from the doll house's high angle the cards face the sky and used to go near black
    // palm fronds are long cards that lie nearly flat and face the sky from above: a constant dark emissive left them black in the doll house (round 5),
    // so a frond lights itself with its own texture colour, as a leaf lit through would
    if (tex && geo.kind === 'frond') { leafMat.emissiveMap = tex; leafMat.emissive = new THREE.Color('#ffffff'); leafMat.emissiveIntensity = 0.7; }
    if (windOn) withWind(leafMat, clock, geo.kind === 'frond' ? 0.07 : 0.045, Math.max(1, geo.heightM));
    else noFlip(leafMat);
    // SPEC 19.12: the photographed card. A photo leaf lights itself a little with its own colour (light through a leaf), not with a flat green
    const photo = geo.kind === 'frond' ? FROND_PATH : geo.kind === 'tip' ? tipPath(id, tier) : sprayPath(id, tier);
    if (photo) swap(leafMat, photo, (t) => { leafMat.emissiveMap = t; leafMat.emissive.setRGB(1, 1, 1); leafMat.emissiveIntensity = geo.kind === 'frond' ? 0.35 : geo.kind === 'tip' ? 0.06 : 0.12; leafMat.alphaTest = geo.kind === 'tip' ? 0.2 : 0.4; leafMat.roughness = 0.7; if (geo.kind === 'tip') leafMat.color.setScalar(0.82); });
    // where each plant stands, how big and how turned: drawn once, shared by the procedural meshes and a model that replaces them
    const place = list.map((s) => {
      const height = (s.scale ?? 1) * (sp.heightM[0] + (sp.heightM[1] - sp.heightM[0]) * (0.35 + 0.3 * r()));
      const yaw = ((s.rotDeg ?? r() * 360) * Math.PI) / 180;
      const tint = 0.9 + r() * 0.2;
      return { x: s.x, z: s.z, height, yaw, tint: [tint, tint * (0.96 + r() * 0.08), tint * (0.92 + r() * 0.1)] as [number, number, number] };
    });
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, name: string, natH = geo.heightM): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(g, m, list.length);
      im.name = name; im.userData.outdoor = name; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      place.forEach((p, i) => {
        const k = p.height / natH;
        e.set(0, p.yaw, 0);
        q.setFromEuler(e); sc.set(k, k, k); pos.set(p.x, 0, p.z);
        m4.compose(pos, q, sc); im.setMatrixAt(i, m4);
        im.setColorAt(i, col.setRGB(...p.tint));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      group.add(im); instanced++;
      return im;
    };
    const drawn: THREE.InstancedMesh[] = [mk(geo.leaves, leafMat, `plants:${id}:leaves`)];
    disposables.push(geo.leaves, leafMat);
    if (tex) disposables.push(tex);
    if (geo.trunk) {
      const tm = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.95 });
      if (windOn) withWind(tm, clock, 0.03, Math.max(1, geo.heightM));
      drawn.push(mk(geo.trunk, tm, `plants:${id}:trunk`));
      disposables.push(geo.trunk, tm);
      // SPEC 19.12: real bark, its light and dark around the species' bark colour (the picture is a mid grey-brown: lifted so the tint holds)
      if (!sp.model) swap(tm, BARK_PATH, () => { if (sp.form === 'candelabra') tm.color.setRGB(BARK_GAIN * 1.12, BARK_GAIN * 1.28, BARK_GAIN * 1.5); else tm.color.setScalar(BARK_GAIN); }); // a frangipani's bark is smooth and grey: the picture's brown is cooled
    }
    // SPEC 19.12: a species drawn by a model. The procedural plant stands until the model has arrived and been built, then gives way to it
    if (sp.model && opts.loader) {
      const model = OUTDOOR_MODELS[sp.model];
      void loadOutdoorModel(sp.model, tier).then((parts) => {
        if (!parts) return;
        if (disposed) { for (const p of parts) { p.geometry.dispose(); disposeMaterial(p.material); } return; }
        for (const p of parts) {
          const leafy = LEAFY_PARTS.has(p.name);
          if (windOn && leafy) withWind(p.material, clock, p.name === 'fronds' ? 0.06 : p.name === 'leaves' || p.name === 'flowers' ? 0.045 : 0.03, model.heightM);
          if (p.name === 'fronds' || p.name === 'leaves' || p.name === 'flowers') { p.material.side = THREE.DoubleSide; p.material.alphaTest = Math.max(0.4, p.material.alphaTest); }
          // SPEC 19.13: a leaf lights itself a little with its own colour (light through a leaf), as the photo cards do: a crown seen against the sky is not black
          if ((p.name === 'leaves' || p.name === 'flowers') && p.material.map) { p.material.emissiveMap = p.material.map; p.material.emissive.setRGB(1, 1, 1); p.material.emissiveIntensity = 0.14; }
          const im = mk(p.geometry, p.material, `plants:${id}:model-${p.name}`, model.heightM);
          im.castShadow = tier !== 'low';
          disposables.push(p.geometry, { dispose: () => disposeMaterial(p.material) });
        }
        for (const d of drawn) { d.removeFromParent(); d.dispose(); instanced--; }
        geo.leaves.dispose(); geo.trunk?.dispose();
      });
    }
  }
  // clipped hedges: one instanced block per species, and (above low) one instanced mesh of sprigs per run of blocks of one size
  const hByS = new Map<SpeciesId, HedgeSeg[]>();
  for (const h of hedges) { const l = hByS.get(h.species) ?? []; l.push(h); hByS.set(h.species, l); }
  const place = (h: HedgeSeg): THREE.Matrix4 => {
    // the block's length runs along its local z (yaw 0 faces +z), so a hedge that runs along `yawDeg` needs no extra turn
    e.set(0, (h.yawDeg * Math.PI) / 180, 0);
    q.setFromEuler(e); sc.set(h.widthM, h.heightM, h.lenM); pos.set(h.x, 0, h.z);
    return m4.compose(pos, q, sc);
  };
  for (const [id, list] of hByS) {
    const sp = SPECIES[id];
    const tex = hedgeTexture(sp, seed + 31);
    if (tex) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ map: tex ?? undefined, color: tex ? '#ffffff' : sp.leaf[2], roughness: 0.9 });
    hedgeWorld(mat);
    // SPEC 19.12: a mat of real leaf photographs (repeat-wrapped)
    swap(mat, HEDGE_PATH, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; });
    const g = hedgeBlock(tier);
    const im = new THREE.InstancedMesh(g, mat, list.length);
    im.name = `hedge:${id}`; im.userData.outdoor = im.name; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    // one clipped mass: the blocks of a hedge differ in tone by a few percent at most (they meet in the middle of a face)
    list.forEach((h, i) => { im.setMatrixAt(i, place(h)); const tint = 0.97 + r() * 0.06; im.setColorAt(i, col.setRGB(tint, tint, tint)); });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    group.add(im); instanced++;
    disposables.push(g, mat); if (tex) disposables.push(tex);
    if (HEDGE_SPRIGS[tier] > 0) {
      const stex = sprayTexture(sp, seed + 53);
      const smat = new THREE.MeshStandardMaterial({ map: stex ?? undefined, color: stex ? '#ffffff' : sp.leaf[0], alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.8, emissive: new THREE.Color(sp.leaf[2]).multiplyScalar(0.5), emissiveIntensity: 0.5 });
      if (windOn) withWind(smat, clock, 0.012, 1.5); else noFlip(smat);
      const sprayP = sprayPath(id, tier);
      if (sprayP) swap(smat, sprayP, (t) => { smat.emissiveMap = t; smat.emissive.setRGB(1, 1, 1); smat.emissiveIntensity = 0.1; smat.alphaTest = 0.4; });
      disposables.push(smat); if (stex) disposables.push(stex);
      const bySize = new Map<string, HedgeSeg[]>();
      for (const h of list) { const k = `${h.widthM.toFixed(2)}|${h.heightM.toFixed(2)}|${h.lenM.toFixed(2)}`; const l = bySize.get(k) ?? []; l.push(h); bySize.set(k, l); }
      let n = 0;
      for (const run of bySize.values()) {
        const h0 = run[0];
        const sg = hedgeSprigs(tier, { w: h0.widthM, h: h0.heightM, l: h0.lenM }, seed + 97 + n++);
        const sm = new THREE.InstancedMesh(sg, smat, run.length);
        sm.name = `hedge:${id}:sprigs`; sm.userData.outdoor = sm.name; sm.castShadow = false; sm.receiveShadow = true; sm.frustumCulled = false;
        run.forEach((h, i) => { sm.setMatrixAt(i, place(h)); sm.setColorAt(i, col.setRGB(1, 1, 1)); });
        sm.instanceMatrix.needsUpdate = true;
        if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
        group.add(sm); instanced++;
        disposables.push(sg);
      }
    }
  }
  const counts = { plants: spots.length, hedges: hedges.length, instanced };
  return {
    group,
    get counts() { counts.instanced = instanced; return counts; },
    update(dt) { clock.value += dt; },
    dispose() {
      disposed = true;
      for (const d of disposables) d.dispose();
      // the photographic maps that replaced the painted ones
      group.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; m?.map?.dispose(); });
      group.removeFromParent();
    },
  };
}
