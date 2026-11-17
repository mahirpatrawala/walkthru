// Geometry helpers of the style generators. Pure three, no DOM, runs under Node (the GLB export of a home runs there).
// Everything takes metres, returns indexed or flat geometry with clean outward normals, and nothing here knows a furniture kind.
import * as THREE from 'three';
import { mergeAll } from '../furniture-parts';

export type Axis = 'x' | 'y' | 'z';

/**
 * A box from (x0, y0, z0) to (x1, y1, z1) with its 12 edges cut at 45 degrees by `c` metres (flat normals, so a light catches
 * every edge). 44 triangles. `c` is clamped to a third of the thinnest side; a `c` of 0 gives a plain 12-triangle box.
 */
export function chamferBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number): THREE.BufferGeometry {
  const hx = Math.max(0.0005, (x1 - x0) / 2), hy = Math.max(0.0005, (y1 - y0) / 2), hz = Math.max(0.0005, (z1 - z0) / 2);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const k = Math.min(c, (Math.min(hx, hy, hz) * 2) / 3);
  if (k < 0.0005) return boxFlat(cx, cy, cz, hx, hy, hz);
  const pos: number[] = [], nor: number[] = [];
  const tri = (a: number[], b: number[], d: number[], n: number[]): void => {
    // wind so the face normal agrees with n
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ad = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const cr = [ab[1] * ad[2] - ab[2] * ad[1], ab[2] * ad[0] - ab[0] * ad[2], ab[0] * ad[1] - ab[1] * ad[0]];
    const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0;
    const [p, q, r] = flip ? [a, d, b] : [a, b, d];
    const l = Math.hypot(n[0], n[1], n[2]);
    for (const v of [p, q, r]) { pos.push(cx + v[0], cy + v[1], cz + v[2]); nor.push(n[0] / l, n[1] / l, n[2] / l); }
  };
  const quad = (a: number[], b: number[], d: number[], e: number[], n: number[]): void => { tri(a, b, d, n); tri(a, d, e, n); };
  const H = [hx, hy, hz];
  // six faces, inset by k from every edge
  for (let ax = 0; ax < 3; ax++) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3;
    for (const s of [-1, 1]) {
      const mk = (su: number, sv: number): number[] => { const p = [0, 0, 0]; p[ax] = s * H[ax]; p[u] = su * (H[u] - k); p[v] = sv * (H[v] - k); return p; };
      const n = [0, 0, 0]; n[ax] = s;
      quad(mk(-1, -1), mk(1, -1), mk(1, 1), mk(-1, 1), n);
    }
  }
  // twelve edge strips: along axis `ax`, at the corner of the other two axes (u, v)
  for (let ax = 0; ax < 3; ax++) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3;
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const mk = (t: number, onU: boolean): number[] => {
        const p = [0, 0, 0];
        p[ax] = t * (H[ax] - k);
        if (onU) { p[u] = su * H[u]; p[v] = sv * (H[v] - k); } else { p[u] = su * (H[u] - k); p[v] = sv * H[v]; }
        return p;
      };
      const n = [0, 0, 0]; n[u] = su; n[v] = sv;
      quad(mk(-1, true), mk(1, true), mk(1, false), mk(-1, false), n);
    }
  }
  // eight corner triangles
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const a = [sx * hx, sy * (hy - k), sz * (hz - k)], b = [sx * (hx - k), sy * hy, sz * (hz - k)], d = [sx * (hx - k), sy * (hy - k), sz * hz];
    tri(a, b, d, [sx, sy, sz]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function boxFlat(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2).toNonIndexed();
  g.translate(cx, cy, cz);
  g.deleteAttribute('uv');
  return g;
}

/** A cylinder along Y from y0 to y1 at (cx, cz), `sides` facets, smooth sides. */
export function cylinderY(cx: number, cz: number, y0: number, y1: number, r: number, sides = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, Math.max(0.0005, y1 - y0), sides, 1, false);
  g.translate(cx, (y0 + y1) / 2, cz);
  return g;
}

/** A cylinder between two points (handles, legs, rails). Uses `sides` radial segments. */
export function rod(a: THREE.Vector3Like, b: THREE.Vector3Like, r: number, sides = 8): THREE.BufferGeometry {
  const va = new THREE.Vector3(a.x, a.y, a.z), vb = new THREE.Vector3(b.x, b.y, b.z);
  const len = Math.max(0.0005, va.distanceTo(vb));
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return g;
}

/**
 * A prism: the polygon `outline` (x, z pairs, counter-clockwise seen from above) from y0 up to y1, its top edge chamfered by
 * `bevel`. Smooth normals along gentle curves, hard ones at corners. Used for the curved window seat and rounded rugs.
 * The bottom is left out (nobody sees it).
 */
export function prism(outline: [number, number][], y0: number, y1: number, bevel: number): THREE.BufferGeometry {
  const n = outline.length;
  const b = Math.max(0, Math.min(bevel, (y1 - y0) * 0.6));
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  // outward normal of edge i (outline[i] -> outline[i+1]) for a counter-clockwise polygon seen from above (x right, z down the screen)
  const edgeN: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = outline[i], c = outline[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1;
    edgeN.push([dz / l, -dx / l]);
  }
  // inset polygon for the top face: move each vertex along the (averaged) inward normal
  const vN: [number, number][] = [];
  const sharp: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const p = edgeN[(i + n - 1) % n], q = edgeN[i];
    const dot = p[0] * q[0] + p[1] * q[1];
    sharp.push(dot < 0.82);
    const mx = p[0] + q[0], mz = p[1] + q[1], ml = Math.hypot(mx, mz) || 1;
    vN.push([mx / ml, mz / ml]);
  }
  const inset = outline.map((o, i) => {
    const [mx, mz] = vN[i];
    const p = edgeN[(i + n - 1) % n];
    const k = 1 / Math.max(0.3, mx * p[0] + mz * p[1]);
    return [o[0] - mx * b * k, o[1] - mz * b * k] as [number, number];
  });
  // side wall and bevel strip per edge (own vertices at each end, so a sharp corner keeps a hard normal)
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => { pos.push(x, y, z); nor.push(nx, ny, nz); return pos.length / 3 - 1; };
  const s = Math.SQRT1_2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ni = sharp[i] ? edgeN[i] : vN[i], nj = sharp[j] ? edgeN[i] : vN[j];
    const a0 = push(outline[i][0], y0, outline[i][1], ni[0], 0, ni[1]);
    const b0 = push(outline[j][0], y0, outline[j][1], nj[0], 0, nj[1]);
    const a1 = push(outline[i][0], y1 - b, outline[i][1], ni[0], 0, ni[1]);
    const b1 = push(outline[j][0], y1 - b, outline[j][1], nj[0], 0, nj[1]);
    idx.push(a0, b1, b0, a0, a1, b1);
    if (b > 0) {
      const c0 = push(outline[i][0], y1 - b, outline[i][1], ni[0] * s, s, ni[1] * s);
      const d0 = push(outline[j][0], y1 - b, outline[j][1], nj[0] * s, s, nj[1] * s);
      const c1 = push(inset[i][0], y1, inset[i][1], ni[0] * s, s, ni[1] * s);
      const d1 = push(inset[j][0], y1, inset[j][1], nj[0] * s, s, nj[1] * s);
      idx.push(c0, d1, d0, c0, c1, d1);
    }
  }
  // top face
  const top = b > 0 ? inset : outline;
  const base = pos.length / 3;
  for (const p of top) push(p[0], y1, p[1], 0, 1, 0);
  const contour = top.map((p) => new THREE.Vector2(p[0], p[1]));
  // ShapeUtils wants counter-clockwise in its own xy plane, and our (x, z) is mirrored once seen from above
  const tris = THREE.ShapeUtils.triangulateShape(contour.slice().reverse(), []);
  const rev = (i: number): number => n - 1 - i;
  for (const t of tris) idx.push(base + rev(t[0]), base + rev(t[2]), base + rev(t[1]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Points of a rounded rectangle (x0..x1, z0..z1) as an outline for `prism`, one corner radius each for top-left, top-right,
 * bottom-right, bottom-left (z0 is the top edge, z grows toward the bottom). Counter-clockwise in the x, z plane (positive area).
 */
export function roundedRectOutline(x0: number, x1: number, z0: number, z1: number, radii: [number, number, number, number], seg = 6): [number, number][] {
  const out: [number, number][] = [];
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, (x1 - x0) / 2, (z1 - z0) / 2)));
  const arc = (cx: number, cz: number, r: number, a0: number): void => {
    if (r < 0.002) { out.push([cx, cz]); return; }
    for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  };
  arc(x0 + tl, z0 + tl, tl, Math.PI);          // left edge up to the top edge
  arc(x1 - tr, z0 + tr, tr, (3 * Math.PI) / 2); // top edge across to the right edge
  arc(x1 - br, z1 - br, br, 0);                // right edge down to the bottom edge
  arc(x0 + bl, z1 - bl, bl, Math.PI / 2);      // bottom edge back to the left edge
  // two arcs that meet (radii that add up to a full side) leave a repeated point: a zero-length edge has no normal
  const clean: [number, number][] = [];
  for (const q of out) {
    const l = clean[clean.length - 1];
    if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-6) clean.push(q);
  }
  while (clean.length > 1 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 1e-6) clean.pop();
  return clean;
}

/**
 * Replaces the UVs with world-scale planar ones, like `worldUV`, but the texture's grain (its v axis) runs along `grain`
 * wherever that axis lies in the face's plane. A shelf's grain runs along its length, a door's up and down.
 * `tile` is the metres one repeat covers. A face the grain is not in (an end face) takes the usual projection.
 */
export function grainUV(g: THREE.BufferGeometry, tile: number, grain: Axis = 'y', offset: [number, number] = [0, 0]): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  const gi = grain === 'x' ? 0 : grain === 'y' ? 1 : 2;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    // the face's own axis (the one its normal points along); the other two span its plane
    const face = ny >= nx && ny >= nz ? 1 : nx >= nz ? 0 : 2;
    const pl = [0, 1, 2].filter((a) => a !== face);
    let a = pl[0], b = pl[1]; // default: u along the first plane axis, v along the second
    if (gi === pl[0]) { a = pl[1]; b = pl[0]; } else if (gi === pl[1]) { a = pl[0]; b = pl[1]; }
    else if (face === 1) { a = 0; b = 2; } else if (face === 0) { a = 2; b = 1; } else { a = 0; b = 1; }
    const P = [p.getX(i), p.getY(i), p.getZ(i)];
    uv[i * 2] = P[a] / tile + offset[0];
    uv[i * 2 + 1] = P[b] / tile + offset[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** a stable pseudo-random UV offset for a board, from where it sits: two boards of one wood never show the same grain side by side, and a rebuild gives the same picture */
export function boardOffset(g: THREE.BufferGeometry): [number, number] {
  g.computeBoundingBox();
  const b = g.boundingBox as THREE.Box3;
  const h = (k: number): number => { const x = Math.sin(((b.min.x + b.max.x) * 12.9898 + (b.min.y + b.max.y) * 78.233 + (b.min.z + b.max.z) * 37.719) * (k + 1)) * 43758.5453; return x - Math.floor(x); };
  return [h(0) * 7, h(1) * 7];
}

/** UVs projected straight onto the xy plane (u = x, v = y, in `tile` metres): a fluted panel keeps one continuous grain over its ribs. */
export function frontUV(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / tile; uv[i * 2 + 1] = p.getY(i) / tile; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * A strip of vertical ribs ("flutes") across `w` x `h`: each rib is a half-round bump of `depth` that fills 62 % of its `pitch`,
 * the rest is a flat valley at z = 0, so the gaps catch shadow. The strip stands in the plane z = 0 and the ribs stand out toward
 * +z. Origin at the bottom-left. Smooth normals across each rib, flat in the valleys. 5 segments a rib.
 */
export function fluteStrip(w: number, h: number, pitch: number, depth: number): THREE.BufferGeometry {
  const ribs = Math.max(1, Math.round(w / pitch));
  const p = w / ribs;
  const fill = 0.62;
  const a = (p * fill) / 2, b = depth;
  const arcSteps = 4;
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let col = 0;
  const addCol = (x: number, z: number, nx: number, nz: number): void => {
    for (const y of [0, h]) { pos.push(x, y, z); nor.push(nx, 0, nz); }
    if (col > 0) { const i = (col - 1) * 2; idx.push(i, i + 2, i + 3, i, i + 3, i + 1); }
    col++;
  };
  for (let r = 0; r < ribs; r++) {
    const x0 = r * p + (p - p * fill) / 2;
    const cx = x0 + a;
    if (r === 0 && x0 > 0) addCol(0, 0, 0, 1);
    for (let k = 0; k <= arcSteps; k++) {
      const th = (k / arcSteps) * Math.PI;
      const nx = -b * Math.cos(th), nz = a * Math.sin(th);
      const l = Math.hypot(nx, nz) || 1;
      addCol(cx - a * Math.cos(th), b * Math.sin(th), k === 0 || k === arcSteps ? (k === 0 ? -1 : 1) * 0.0 : nx / l, k === 0 || k === arcSteps ? 1 : nz / l);
    }
    const next = (r + 1) * p + (p - p * fill) / 2;
    addCol(r === ribs - 1 ? w : next, 0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Triangles in a geometry. */
export function triCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

/** Merges geometries (any mix of indexed and flat, with or without uv) into one indexed geometry that has position, normal and uv. */
export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  const merged = mergeAll(list);
  // keep vertex colours (curtain folds are shaded in the vertices) when every part has them; four components when every part carries an
  // alpha (a sheer thins out at its edge), else three
  if (list.length && list.every((g) => g.attributes.color)) {
    const size = list.every((g) => g.attributes.color.itemSize === 4) ? 4 : 3;
    let n = 0;
    for (const g of list) n += g.attributes.position.count;
    const col = new Float32Array(n * size);
    let o = 0;
    for (const g of list) { const c = g.attributes.color; for (let i = 0; i < c.count; i++) { col[o++] = c.getX(i); col[o++] = c.getY(i); col[o++] = c.getZ(i); if (size === 4) col[o++] = c.getW(i); } }
    merged.setAttribute('color', new THREE.BufferAttribute(col, size));
  }
  return merged;
}

export function boundsOf(g: THREE.Object3D): THREE.Box3 {
  g.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(g);
}

/** A round leg standing on the floor at (cx, cz): `rTop` under the piece, `rFoot` on the floor (a multiple of four sides, so its extremes lie on the axes). */
export function taperedLeg(cx: number, cz: number, height: number, rTop: number, rFoot: number, sides = 8): THREE.BufferGeometry {
  const s = Math.max(8, Math.ceil(sides / 4) * 4);
  const g = new THREE.CylinderGeometry(rTop, rFoot, Math.max(0.001, height), s, 1, false);
  g.translate(cx, height / 2, cz);
  return g;
}

export interface LoftSection {
  y: number;
  /** full width (x) and depth (z) of the section; its centre is at x = 0, z = zc */
  w: number;
  d: number;
  zc: number;
  /** superellipse power: 2 an ellipse, 3 to 4 a rounded rectangle, default 2.6 */
  p?: number;
}

/**
 * A smooth solid lofted through superellipse sections (a toilet bowl, a basin, a pedestal, a bin): the sections are joined ring to ring with
 * averaged normals, the top ring is closed by a flat cap (the bottom is left out). Exact extremes: every section's w and d are its real
 * bounds, since the rings contain the points on both axes (`n` is a multiple of four). Returns the body and the cap as two geometries.
 */
export function loft(sections: LoftSection[], n = 32): { body: THREE.BufferGeometry; cap: THREE.BufferGeometry } {
  const m = Math.max(8, Math.ceil(n / 4) * 4);
  const pos: number[] = [], idx: number[] = [];
  const ring = (s: LoftSection): [number, number][] => {
    const e = 2 / (s.p ?? 2.6), pts: [number, number][] = [];
    for (let i = 0; i < m; i++) {
      const t = (i / m) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
      pts.push([(s.w / 2) * Math.sign(c) * Math.abs(c) ** e, s.zc + (s.d / 2) * Math.sign(sn) * Math.abs(sn) ** e]);
    }
    return pts;
  };
  sections.forEach((s) => { for (const [x, z] of ring(s)) pos.push(x, s.y, z); });
  for (let k = 0; k < sections.length - 1; k++) {
    for (let i = 0; i < m; i++) {
      const a = k * m + i, b = k * m + ((i + 1) % m), c = a + m, d = b + m;
      idx.push(a, c, b, b, c, d);
    }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setIndex(idx);
  body.computeVertexNormals();
  // closed rings share their first and last vertex positions with distinct indices only through the modulo above, so the seam is already smooth
  const top = sections[sections.length - 1];
  const cp: number[] = [], cn: number[] = [], ci: number[] = [];
  const r = ring(top);
  cp.push(0, top.y, top.zc); cn.push(0, 1, 0);
  r.forEach(([x, z]) => { cp.push(x, top.y, z); cn.push(0, 1, 0); });
  for (let i = 0; i < m; i++) ci.push(0, 1 + ((i + 1) % m), 1 + i);
  const cap = new THREE.BufferGeometry();
  cap.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  cap.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
  cap.setIndex(ci);
  return { body, cap };
}
