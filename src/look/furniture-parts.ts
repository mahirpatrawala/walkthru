// Owned by C11b. SPEC 16.6.5 shared parts. All sizes in metres. Every function returns geometry in the item's frame with
// world-scale UVs (u, v in metres / tile), so a texture keeps its scale on any size of box.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function triangles(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

/** A box spanning x0..x1, y0..y1, z0..z1 (item frame). 12 triangles. */
export function boxBetween(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const w = Math.max(0.001, x1 - x0), h = Math.max(0.001, y1 - y0), d = Math.max(0.001, z1 - z0);
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/**
 * A box with rounded edges. `segments` 1 gives 108 triangles, 2 gives 300, 3 gives 588. The radius is clamped to half the
 * smallest side, so a thin slab never inverts.
 */
export function roundedBox(w: number, h: number, d: number, radius: number, segments = 1): THREE.BufferGeometry {
  const r = Math.max(0.0005, Math.min(radius, Math.min(w, h, d) / 2 - 0.0005));
  const g = new RoundedBoxGeometry(Math.max(0.001, w), Math.max(0.001, h), Math.max(0.001, d), segments, r);
  return g;
}

export function roundedBoxBetween(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, radius: number, segments = 1): THREE.BufferGeometry {
  const g = roundedBox(x1 - x0, y1 - y0, z1 - z0, radius, segments);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/**
 * A stuffed cushion of exactly w x h x d (centred on the origin). Each face bulges outward on a cosine profile (its middle
 * reaches the bound, its edges are `puff` inside it) and the corners pinch in by 15 %, so it reads as filled, not as a block.
 */
export function puffedCushion(w: number, h: number, d: number, puff: number, segments = 8): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, segments, segments, segments);
  const p = g.attributes.position as THREE.BufferAttribute;
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const half = Math.PI / 2;
  for (let i = 0; i < p.count; i++) {
    let u = p.getX(i) / hx, v = p.getY(i) / hy, t = p.getZ(i) / hz;
    const au = Math.abs(u), av = Math.abs(v), at = Math.abs(t);
    const pinch = 1 - 0.15 * au * av * at;
    // pull the face inward toward its edges (the dominant axis is the face the vertex is on)
    if (au >= av && au >= at) u = Math.sign(u) * (1 - (puff / hx) * (1 - Math.cos(half * v) * Math.cos(half * t)));
    else if (av >= at) v = Math.sign(v) * (1 - (puff / hy) * (1 - Math.cos(half * u) * Math.cos(half * t)));
    else t = Math.sign(t) * (1 - (puff / hz) * (1 - Math.cos(half * u) * Math.cos(half * v)));
    p.setXYZ(i, u * hx * pinch, v * hy * pinch, t * hz * pinch);
  }
  g.computeVertexNormals();
  return g;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A slab w x thickness x d (centred on the origin) with low ripples on its top (at most 1 cm deep, never above the top
 * plane) and one fold ridge across it. `n` x `n` quads on top; the underside is left out (nobody sees it).
 */
export function foldedCloth(w: number, d: number, thickness: number, seed: number, n = 16): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, thickness, d, n, 1, n);
  const rnd = mulberry(seed);
  const a1 = 0.4 + rnd() * 0.6, a2 = 0.4 + rnd() * 0.6;
  const f1 = 2 + rnd() * 2, f2 = 2 + rnd() * 2, p1 = rnd() * 6.28, p2 = rnd() * 6.28;
  const fold = (rnd() - 0.5) * 0.4; // fold ridge position along z, as a fraction of d
  const pos = g.attributes.position as THREE.BufferAttribute;
  const amp = Math.min(0.01, thickness * 0.4);
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) <= 0) continue;
    const x = pos.getX(i) / w, z = pos.getZ(i) / d;
    const ripple = 0.5 + 0.25 * (a1 * Math.sin(f1 * 6.28 * x + p1) + a2 * Math.sin(f2 * 6.28 * z + p2));
    const ridge = Math.exp(-Math.pow((z - fold) / 0.03, 2)) * 0.6;
    pos.setY(i, thickness / 2 - amp * Math.max(0, Math.min(1, 1 - ridge) * ripple));
  }
  g.computeVertexNormals();
  return dropFacing(g, 0, -1);
}

/** Removes the triangles whose face normal points along (axis, sign), e.g. the underside of a slab. */
export function dropFacing(g: THREE.BufferGeometry, axis: 0 | 1 | 2, sign: 1 | -1): THREE.BufferGeometry {
  const idx = g.index;
  if (!idx) return g;
  const p = g.attributes.position as THREE.BufferAttribute;
  const keep: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i)); b.fromBufferAttribute(p, idx.getX(i + 1)); c.fromBufferAttribute(p, idx.getX(i + 2));
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    if (sign * n.getComponent(axis) > 0.99) continue;
    keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }
  g.setIndex(keep);
  return g;
}

/**
 * A thin tube following a rounded rectangle in the XZ plane at height y (the piping on a mattress). `radial` sides,
 * 4 straight runs and 4 corner arcs of `arc` segments each.
 */
export function piping(cx: number, cz: number, w: number, d: number, y: number, tube: number, cornerR: number, radial = 6, arc = 3): THREE.BufferGeometry {
  const r = Math.min(cornerR, w / 2 - 0.001, d / 2 - 0.001);
  const pts: THREE.Vector3[] = [];
  const corners: [number, number, number][] = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, 1], [-w / 2 + r, -d / 2 + r, 2], [w / 2 - r, -d / 2 + r, 3]];
  for (const [ox, oz, q] of corners) {
    for (let k = 0; k <= arc; k++) {
      const ang = (q * Math.PI) / 2 + (k / arc) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + ox + r * Math.cos(ang), y, cz + oz + r * Math.sin(ang)));
    }
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  return new THREE.TubeGeometry(curve, pts.length * 3, tube, radial, true);
}

/** A cylinder between two points of the item frame (handles, legs). `sides` radial segments; no caps when `caps` is false. */
export function barBetween(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, radius: number, sides = 8): THREE.BufferGeometry {
  const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(radius, radius, len, sides, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/**
 * Replaces the UVs with world-scale planar ones. The projection is picked per vertex from its normal: tops and bottoms use
 * (x, z), sides facing x use (z, y), sides facing z use (x, y). The grain of a texture runs along v, so wood on a door
 * runs up and down. `tile` is the metres one texture repeat covers.
 */
export function worldUV(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ny >= nx && ny >= nz) { u = p.getX(i); v = p.getZ(i); }
    else if (nx >= nz) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Merges geometries that share a material into one (same attributes, all indexed). */
export function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0, idx = 0;
  for (const g of list) { verts += g.attributes.position.count; idx += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
  const ind = new Uint32Array(idx);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], (vo + i) * 3);
      if (n) nor.set([n.getX(i), n.getY(i), n.getZ(i)], (vo + i) * 3);
      if (u) uv.set([u.getX(i), u.getY(i)], (vo + i) * 2);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) ind[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) ind[io++] = vo + i;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  return out;
}
