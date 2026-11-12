// A kit for painting solid, made things: walls, boards, furniture, pots. A thing is given as flat faces or as any
// three.js geometry, with the name of a palette; the kit keeps the faces as an underpainting and lays strokes on
// them that lie flat on the surface and run along its grain. Everything is seen from its outer side only, so a
// room can be looked into through the backs of its near walls.
//
// How a palette is lit is left to whoever uses the kit: `light` is GLSL for
//   vec3 kitPaint(vec3 P, vec3 Nn, int k, float tone, float r)
// with PAL_L, PAL_M, PAL_S (the three mixes), PAL_O (the thing's own colour, for a lamp) and PAL_G (1: it glows of
// itself; 2: and steadily, where 1 flickers like a flame) to read from.
import * as THREE from 'three';
import { COMMON } from '../oilpaint/common.js';
import { dabMaterial, dabGeometry, dabMesh } from '../oilpaint/dabs.js';
import { rng } from '../world/noise.js';

export function createKit(shared, { palettes, head = '', light, origin = [0, 0, 0], seed = 1, haze = false, order = 3 }) {
  const rand = rng(seed);
  const names = Object.keys(palettes);
  const index = (name) => { const i = names.indexOf(name); if (i < 0) throw new Error(`no palette ${name}`); return i; };
  const O = new THREE.Vector3(...origin);
  const mesh = { pos: [], nrm: [], pal: [], tone: [] };
  const dab = { pos: [], nrm: [], dir: [], data: [], more: [] };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3(), d = new THREE.Vector3();

  /** One stroke, put exactly: where, the surface's normal, the way it runs, its size, palette, tone, and how high it is laid. */
  function stroke(at, normal, run, across, along, pal, tone = 1, height = 0) {
    dab.pos.push(at.x + O.x, at.y + O.y, at.z + O.z);
    dab.nrm.push(normal.x, normal.y, normal.z);
    dab.dir.push(run.x, run.y, run.z);
    dab.data.push(rand() * 1000, across, along, index(pal));
    dab.more.push(tone, height);
  }
  function triangle(pa, pb, pc, na, nb, nc, pal, tone) {
    for (const [v, nn] of [[pa, na], [pb, nb], [pc, nc]]) { mesh.pos.push(v.x + O.x, v.y + O.y, v.z + O.z); mesh.nrm.push(nn.x, nn.y, nn.z); mesh.pal.push(index(pal)); mesh.tone.push(tone); }
  }
  /** Strokes scattered evenly over a triangle. grain: the way they run (a vector), or null for along its first edge. */
  function scatter(pa, pb, pc, na, nb, nc, pal, { grain = null, stroke: size = [0.07, 0.2], density = 1, tone = 1, free = false, lift = 0 }) {
    e1.subVectors(pb, pa); e2.subVectors(pc, pa);
    n.crossVectors(e1, e2);
    const area = n.length() / 2;
    n.normalize();
    // a stroke is never larger than the face it is on (a window bar is painted with small touches, not planks),
    // unless the face is one of many that make a single surface (free: a roof of snow), where strokes cross them
    const g = new THREE.Vector3().copy(grain ?? e1);
    g.addScaledVector(n, -g.dot(n));
    if (g.lengthSq() < 1e-8) g.copy(e1);
    g.normalize();
    const x = new THREE.Vector3().crossVectors(n, g), e3 = new THREE.Vector3().subVectors(e2, e1);
    const long = Math.max(Math.abs(e1.dot(g)), Math.abs(e2.dot(g)), Math.abs(e3.dot(g))), wide = Math.max(Math.abs(e1.dot(x)), Math.abs(e2.dot(x)), Math.abs(e3.dot(x)));
    if (!free) size = [Math.max(0.012, Math.min(size[0], wide * 1.05)), Math.max(0.02, Math.min(size[1], long * 1.05))];
    const centre = new THREE.Vector3().copy(pa).add(pb).add(pc).divideScalar(3);
    const pull = free ? 0 : 0.7 * Math.min(1, Math.max(size[0] / Math.max(wide, 1e-4), size[1] / Math.max(long, 1e-4)));
    const want = (area / (size[0] * size[1])) * 2.6 * density;
    const count = Math.min(3000, Math.floor(want + rand()));
    for (let i = 0; i < count; i++) {
      let s = rand(), t = rand();
      if (s + t > 1) { s = 1 - s; t = 1 - t; }
      p.copy(pa).addScaledVector(e1, s).addScaledVector(e2, t).lerp(centre, pull);
      const nn = new THREE.Vector3().copy(na).multiplyScalar(1 - s - t).addScaledVector(nb, s).addScaledVector(nc, t).normalize();
      d.copy(grain ?? e1);
      d.addScaledVector(nn, -d.dot(nn));
      if (d.lengthSq() < 1e-6) d.copy(e1);
      d.normalize().addScaledVector(new THREE.Vector3().crossVectors(nn, d), (rand() - 0.5) * 0.35);
      stroke(p, nn, d, size[0] * (0.8 + 0.4 * rand()), size[1] * (0.75 + 0.5 * rand()), pal, tone * (0.88 + 0.24 * rand()), lift * (0.4 + 1.2 * rand()));
    }
  }

  /** Any geometry, placed by a matrix. smooth: round things keep their rounded normals. */
  function add(geometry, matrix, pal, opts = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const P = g.attributes.position, N = g.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < P.count; i += 3) {
      a.fromBufferAttribute(P, i).applyMatrix4(matrix); b.fromBufferAttribute(P, i + 1).applyMatrix4(matrix); c.fromBufferAttribute(P, i + 2).applyMatrix4(matrix);
      const flat = new THREE.Vector3().crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
      const na = opts.smooth ? new THREE.Vector3().fromBufferAttribute(N, i).applyMatrix3(nm).normalize() : flat;
      const nb = opts.smooth ? new THREE.Vector3().fromBufferAttribute(N, i + 1).applyMatrix3(nm).normalize() : flat;
      const nc = opts.smooth ? new THREE.Vector3().fromBufferAttribute(N, i + 2).applyMatrix3(nm).normalize() : flat;
      triangle(a, b, c, na, nb, nc, pal, opts.tone ?? 1);
      scatter(a.clone(), b.clone(), c.clone(), na, nb, nc, pal, opts);
    }
  }
  const place = (x, y, z, rotY = 0, scale = [1, 1, 1]) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(...scale));
  /** A box by its middle and size. grain: 'x', 'y' or 'z', the way its strokes run. */
  function box(x, y, z, sx, sy, sz, pal, opts = {}) {
    const grain = opts.grain ? new THREE.Vector3(opts.grain === 'x' ? 1 : 0, opts.grain === 'y' ? 1 : 0, opts.grain === 'z' ? 1 : 0) : null;
    if (grain && opts.rotY) grain.applyAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotY);
    add(new THREE.BoxGeometry(sx, sy, sz), place(x, y, z, opts.rotY ?? 0), pal, { ...opts, grain });
  }
  /** A round thing standing upright: a post, a jar, a log on end. */
  function round(x, y, z, r, h, pal, opts = {}) {
    add(new THREE.CylinderGeometry(opts.top ?? r, r, h, opts.sides ?? 9), place(x, y, z, 0).multiply(opts.turn ?? new THREE.Matrix4()), pal, { smooth: true, grain: opts.grain ?? new THREE.Vector3(0, 1, 0), ...opts });
  }

  /**
   * A flat four-cornered face: o, and its two edges u and v; it faces the way u x v points. holes: [a0, a1, b0, b1]
   * as shares of u and v. rows: laid in courses this high (logs, planks) with a dark seam between, running along u.
   */
  function quad(o, u, v, pal, { grain = 'u', stroke: size = [0.07, 0.2], density = 1, rows = 0, holes = [], tone = 1, detail = false } = {}) {
    o = new THREE.Vector3(...o); u = new THREE.Vector3(...u); v = new THREE.Vector3(...v);
    const nn = new THREE.Vector3().crossVectors(u, v).normalize();
    const at = (s, t) => new THREE.Vector3().copy(o).addScaledVector(u, s).addScaledVector(v, t);
    const holed = (s, t) => holes.some((h) => s > h[0] && s < h[1] && t > h[2] && t < h[3]);
    // the face, cut into plain rectangles round its holes
    const rects = [];
    let cursor = 0;
    for (const h of [...holes].sort((p1, p2) => p1[0] - p2[0])) {
      if (h[0] > cursor) rects.push([cursor, h[0], 0, 1]);
      if (h[2] > 0) rects.push([h[0], h[1], 0, h[2]]);
      if (h[3] < 1) rects.push([h[0], h[1], h[3], 1]);
      cursor = h[1];
    }
    if (cursor < 1) rects.push([cursor, 1, 0, 1]);
    const U = u.length(), V = v.length();
    for (const [s0, s1, t0, t1] of rects) {
      const p00 = at(s0, t0), p10 = at(s1, t0), p11 = at(s1, t1), p01 = at(s0, t1);
      triangle(p00, p10, p11, nn, nn, nn, pal, tone);
      triangle(p00, p11, p01, nn, nn, nn, pal, tone);
      if (rows) continue;
      const g = grain === 'u' ? u : v;
      const opts = { grain: g, stroke: size, density, tone };
      scatter(p00, p10, p11, nn, nn, nn, pal, opts);
      scatter(p00, p11, p01, nn, nn, nn, pal, opts);
    }
    if (!rows) return;
    const dirU = u.clone().normalize();
    // a log stops at a window: no stroke may reach into a hole, at its middle or at either end
    const clear = (mid, t, len) => mid > 0.01 && mid < 0.99 && !holed(mid, t) && !holed(mid - len / 2 / U, t) && !holed(mid + len / 2 / U, t);
    const courses = Math.max(1, Math.round(V / rows)), high = V / courses;
    for (let j = 0; j < courses; j++) {
      const shade = tone * (0.78 + 0.44 * rand());
      for (let pass = 0; pass < 2; pass++) {
        for (let s = -rand() * size[1]; s < U;) {
          const len = size[1] * (0.7 + 0.7 * rand());
          const mid = (s + len / 2) / U, t = (j + 0.5 + (pass ? (rand() - 0.5) * 0.3 : 0)) / courses;
          let reach = Math.min(len * 1.15, U);
          if (!clear(mid, t, reach)) reach = len * 0.35;
          if (clear(mid, t, reach)) stroke(at(mid, t), nn, dirU, high * 1.12, reach, pal, shade * (0.9 + 0.2 * rand()), pass * 0.002);
          s += len * 0.9;
        }
      }
      if (detail) {
        // the round of a log (the wear of a board) catches the light: thin pale streaks along it; and here and there a knot
        for (let s = rand() * size[1]; s < U;) {
          const len = size[1] * (0.35 + 0.6 * rand()), mid = (s + len / 2) / U, t = (j + 0.66 + 0.16 * rand()) / courses;
          if (clear(mid, t, len) && rand() < 0.7) stroke(at(mid, t), nn, dirU, high * 0.16, len, pal, shade * 1.3, 0.008);
          s += len * (1.1 + rand());
        }
        for (let s = rand() * 1.6; s < U; s += 0.9 + 2.4 * rand()) {
          const mid = s / U, t = (j + 0.3 + 0.4 * rand()) / courses;
          if (!clear(mid, t, 0.14)) continue;
          stroke(at(mid, t), nn, dirU, high * 0.34, high * 0.52, pal, shade * 0.5, 0.009);
          stroke(at(mid, t), nn, dirU, high * 0.14, high * 0.2, pal, shade * 0.28, 0.011);
        }
      }
      // the seam under the course
      if (j > 0) for (let s = 0; s < U;) {
        const len = size[1] * (0.6 + 0.6 * rand()), mid = (s + len / 2) / U, t = j / courses;
        if (clear(mid, t, len) && rand() < 0.85) stroke(at(mid, t), nn, dirU, high * 0.2, len, pal, tone * 0.32, 0.006);
        s += len * 0.95;
      }
    }
  }
  /** A flat three-cornered face (a gable). */
  function tri(pa, pb, pc, pal, opts = {}) {
    a.set(...pa); b.set(...pb); c.set(...pc);
    const nn = new THREE.Vector3().crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    triangle(a, b, c, nn, nn, nn, pal, opts.tone ?? 1);
    scatter(a.clone(), b.clone(), c.clone(), nn, nn, nn, pal, { ...opts, grain: opts.grain ? new THREE.Vector3(...opts.grain) : null });
  }

  /** Makes the two things to draw: the underpainting and the strokes. */
  function build() {
    const list = (k, fallback) => names.map((name) => `vec3(${(palettes[name][k] ?? palettes[name][fallback]).map((x) => x.toFixed(3))})`).join(', ');
    const count = names.length;
    const PAL = /* glsl */ `
      const vec3 PAL_L[${count}] = vec3[${count}](${list('l', 'l')});
      const vec3 PAL_M[${count}] = vec3[${count}](${list('m', 'l')});
      const vec3 PAL_S[${count}] = vec3[${count}](${list('s', 'l')});
      const vec3 PAL_O[${count}] = vec3[${count}](${list('own', 'l')});
      const float PAL_G[${count}] = float[${count}](${names.map((name) => (palettes[name].glow === 2 ? '2.0' : palettes[name].glow ? '1.0' : '0.0')).join(', ')});
      ${head}
      ${light}`;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.nrm, 3));
    geometry.setAttribute('aPal', new THREE.Float32BufferAttribute(mesh.pal, 1));
    geometry.setAttribute('aTone', new THREE.Float32BufferAttribute(mesh.tone, 1));
    const under = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: shared,
      vertexShader: /* glsl */ `
        in float aPal; in float aTone;
        out vec3 vWorld; out vec3 vN; out float vPal; out float vTone;
        void main() { vWorld = position; vN = normal; vPal = aPal; vTone = aTone; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        ${PAL}
        in vec3 vWorld; in vec3 vN; in float vPal; in float vTone;
        layout(location = 0) out vec4 outC;
        void main() {
          float r = texture(tNoise, (vWorld.xz + vWorld.y) * 0.9).r;
          vec3 c = kitPaint(vWorld, normalize(vN), int(vPal + 0.5), vTone, r) * 0.82;
          outC = vec4(${haze ? 'hazed(c, vWorld)' : 'c'}, 1.0);
        }`,
    }));
    under.frustumCulled = false;
    const strokes = dabMesh(dabGeometry(dab.data.length / 4, {
      aPos: [new Float32Array(dab.pos), 3], aNrm: [new Float32Array(dab.nrm), 3], aDir: [new Float32Array(dab.dir), 3], aData: [new Float32Array(dab.data), 4], aMore: [new Float32Array(dab.more), 2],
    }), dabMaterial(shared, {
      head: /* glsl */ `in vec3 aPos; in vec3 aNrm; in vec3 aDir; in vec4 aData; in vec2 aMore;` + PAL,
      body: /* glsl */ `
        void makeDab(inout Dab d) {
          vec3 Nn = normalize(aNrm);
          // seen from its outer side only
          if (dot(Nn, cameraPosition - aPos) < 0.0) { d.alive = 0.0; return; }
          vec4 r = hash4(aData.x);
          int k = int(aData.w + 0.5);
          vec3 c = kitPaint(aPos, Nn, k, aMore.x, r.y);
          float wild = PAL_G[k] > 0.5 ? 0.12 : 0.3;
          vec3 c1 = jitter(c, r.wzy, wild), c2 = c * 1.22 + vec3(0.012, 0.008, 0.004);
          d.pos = aPos;
          d.dir = aDir;
          d.size = aData.yz;
          d.c1 = ${haze ? 'hazed(c1, aPos)' : 'c1'};
          d.c2 = ${haze ? 'hazed(c2, aPos)' : 'c2'};
          d.seed = aData.x;
          d.turnabout = 1.0;
          d.lie = 1.0;
          d.nrm = Nn;
          d.height = 0.004 + aMore.y + 0.01 * r.z;
        }`,
      minPx: [1.5, 3], maxPx: [4000, 4000], cells: [0, 8],
    }), order);
    const group = new THREE.Group();
    group.add(under, strokes);
    return { group, under, strokes, count: dab.data.length / 4 };
  }
  return { stroke, add, box, round, quad, tri, place, build, rand };
}
