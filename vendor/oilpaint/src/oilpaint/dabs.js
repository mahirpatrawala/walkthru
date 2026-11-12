// A dab is one touch of the brush, pinned to a point of the world, turned to lie along a direction of the world (a
// trunk's grain, the fall of a cloak), in one mixed colour. Everything in the picture is made of them. Because each
// is pinned to the world, the paint stays on things as the eye moves.
//
// There are two ways a dab sits. Most are cards that face the eye: leaves, bark, cloth, anything with no one face.
// A dab on the ground lies flat on it instead (`lie`), a real patch of the surface: it is foreshortened like the
// ground it is on, it never turns as the eye moves, and where two overlap the one laid higher is on top from every
// side. Seen nearly edge on, a lying dab is stood up just enough to stay a stroke and not a hair.
//
// A thing that wants dabs gives `makeDab`, GLSL that fills in a Dab for this instance. Sizes are in metres but are
// kept between a least and a most size on the canvas, so far things are painted with fewer, larger touches.
import * as THREE from 'three';
import { COMMON } from './common.js';
import { BRUSH_COLS, BRUSH_ROWS } from './brush.js';

const VERT = (head, body) => /* glsl */ `
${COMMON}
uniform vec2 uMinPx;
uniform vec2 uMaxPx;
uniform vec2 uCells; // first cell of the brush sheet and how many to choose from
out vec2 vUv;
out vec3 vC1;
out vec3 vC2;
out vec4 vAxis;
out vec4 vGlaze;
struct Dab {
  vec3 pos;    // where it is pinned
  vec3 dir;    // the way the stroke runs, in the world
  vec2 size;   // across and along, metres
  vec3 c1;     // its colour
  vec3 c2;     // the colour streaked into it
  float seed;
  float alive; // 0 gone .. 1 whole (it grows in)
  float lift;  // how far it stands off its surface toward the eye, in its own sizes
  float base;  // 1: pinned by its foot instead of its middle
  float spin;  // a turn on the canvas, radians
  float turnabout; // 1: laid with either end first
  float cell;  // which mark of the brush sheet, or -1 to let it choose
  float lie;   // 1: lies flat on its surface (nrm) instead of facing the eye
  vec3 nrm;    // the surface it lies on
  float height; // how far above the surface it is laid, metres: higher is on top
  float glaze; // 1: the wanderer's shadow passes over it as a glaze, pixel by pixel
};
${head}
void makeDab(inout Dab d);
${body}
void main() {
  Dab d;
  d.pos = vec3(0.0); d.dir = vec3(0.0, 1.0, 0.0); d.size = vec2(0.1, 0.2);
  d.c1 = vec3(0.5); d.c2 = vec3(0.5); d.seed = float(gl_InstanceID); d.alive = 1.0; d.lift = 0.6; d.base = 0.0; d.spin = 0.0; d.turnabout = 0.0; d.cell = -1.0;
  d.lie = 0.0; d.nrm = vec3(0.0, 1.0, 0.0); d.height = 0.0; d.glaze = 0.0;
  makeDab(d);
  vec4 r = hash4(d.seed * 1.37 + 5.1);
  vec2 across, along;
  vec4 vc;
  vGlaze = vec4(0.0);
  if (d.lie > 0.5) {
    vec3 Nn = normalize(d.nrm);
    vec3 A = d.dir - Nn * dot(d.dir, Nn);
    A = dot(A, A) > 1e-8 ? normalize(A) : normalize(cross(Nn, vec3(1.0, 0.0, 0.0)));
    vec3 B = cross(Nn, A);
    vec3 P = d.pos + Nn * d.height;
    vc = viewMatrix * vec4(P, 1.0);
    float dist = -vc.z;
    if (d.alive < 0.004 || dist < 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec2 half_ = d.size * 0.5 * d.alive;
    vec3 world = P + A * position.y * half_.y + B * position.x * half_.x;
    if (d.glaze > 0.5) vGlaze = vec4((uFigShadeMat * vec4(world, 1.0)).xyz, 1.0);
    vec3 a = mat3(viewMatrix) * A * half_.y;
    vec3 b = mat3(viewMatrix) * B * half_.x;
    // on the canvas the patch is a slanted box; if its thin way is under the least size, stand it up to that
    float la = length(a.xy), lb = length(b.xy);
    float thin = abs(a.x * b.y - a.y * b.x) / max(max(la, lb), 1e-6);
    float need = uMinPx.x * 0.5 * dist * uPixel * d.alive;
    if (thin < need) {
      if (la > lb) {
        vec2 perp = vec2(-a.y, a.x) / max(la, 1e-6);
        b.xy += perp * (dot(b.xy, perp) < 0.0 ? -1.0 : 1.0) * (need - thin);
      } else {
        vec2 perp = vec2(-b.y, b.x) / max(lb, 1e-6);
        a.xy += perp * (dot(a.xy, perp) < 0.0 ? -1.0 : 1.0) * (need - thin);
      }
    }
    vc.xyz += a * position.y + b * position.x;
    along = normalize(a.xy + 1e-6);
    across = normalize(b.xy + 1e-6);
  } else {
    vc = viewMatrix * vec4(d.pos, 1.0);
    float dist = -vc.z;
    if (d.alive < 0.004 || dist < 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 vd = mat3(viewMatrix) * normalize(d.dir);
    float flatness = length(vd.xy);
    float a0 = r.x * TAU;
    along = flatness > 1e-4 ? vd.xy / flatness : vec2(0.0, 1.0);
    // a stroke that points at the eye has no direction on the canvas: give it its own
    along = normalize(mix(vec2(cos(a0), sin(a0)), along, smoothstep(0.08, 0.4, flatness)));
    float cs = cos(d.spin), sn = sin(d.spin);
    along = vec2(along.x * cs - along.y * sn, along.x * sn + along.y * cs);
    across = vec2(along.y, -along.x);
    float px = dist * uPixel;
    vec2 half_ = clamp(d.size, uMinPx * px, uMaxPx * px) * 0.5 * d.alive;
    float lift = d.lift * max(half_.x, half_.y) * (0.6 + 0.8 * r.y);
    vc.xyz *= 1.0 - min(lift / dist, 0.3);
    float t = mix(position.y, position.y + 1.0, d.base);
    vc.xy += across * position.x * half_.x + along * t * half_.y;
  }
  gl_Position = projectionMatrix * vc;
  float cell = d.cell >= 0.0 ? d.cell : uCells.x + floor(r.z * uCells.y * 0.999);
  float flip = r.w > 0.5 ? -1.0 : 1.0;
  float end_ = d.turnabout > 0.5 && fract(r.x * 7.13) > 0.5 ? -1.0 : 1.0;
  vec2 q = vec2(position.x * flip, position.y * end_) * 0.5 + 0.5;
  vUv = (vec2(mod(cell, ${BRUSH_COLS}.0), floor(cell / ${BRUSH_COLS}.0)) + q) / vec2(${BRUSH_COLS}.0, ${BRUSH_ROWS}.0);
  vC1 = d.c1;
  vC2 = d.c2;
  vAxis = vec4(across * flip, along * end_);
}
`;

const FRAG = /* glsl */ `
${COMMON}
in vec2 vUv;
in vec3 vC1;
in vec3 vC2;
in vec4 vAxis;
in vec4 vGlaze;
layout(location = 0) out vec4 outC;
void main() {
  vec4 t = texture(tBrush, vUv);
  if (t.g < 0.3) discard;
  vec2 e = vec2(1.5 / 512.0, 0.0);
  float hu = texture(tBrush, vUv + e.xy).r - texture(tBrush, vUv - e.xy).r;
  float hv = texture(tBrush, vUv + e.yx).r - texture(tBrush, vUv - e.yx).r;
  // the paint stands up off the canvas and the room's light, from the upper left, rakes across it
  vec2 g = vAxis.xy * hu + vAxis.zw * hv;
  float rake = 0.5 * g.x - 0.7 * g.y;
  vec3 col = mix(vC1, vC2, smoothstep(0.52, 0.78, t.b));
  if (vGlaze.w > 0.5) {
    // the wanderer's shadow: a soft plum glaze that slides over the paint and follows its streaks a little
    float lit = figSunSoft(vGlaze.xyz + vec3((t.b - 0.5) * 0.012, (t.r - 0.5) * 0.012, 0.0));
    col = mix(col * uGlazeMul + uGlazeAdd, col, lit);
  }
  col *= mix(0.95, 1.04, t.r);
  col *= 1.0 + rake * 1.25 * uImpasto;
  col += vec3(1.0, 0.97, 0.9) * pow(max(rake, 0.0), 2.0) * 1.2 * uImpasto;
  outC = vec4(col, smoothstep(0.3, 0.62, t.g));
}
`;

export function dabMaterial(shared, { head = '', body, uniforms = {}, minPx = [5, 9], maxPx = [400, 700], cells = [0, 8], depthTest = true, depthWrite = true } = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT(head, body),
    fragmentShader: FRAG,
    uniforms: {
      ...shared,
      uMinPx: { value: new THREE.Vector2(...minPx) },
      uMaxPx: { value: new THREE.Vector2(...maxPx) },
      uCells: { value: new THREE.Vector2(...cells) },
      ...uniforms,
    },
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    depthTest,
    depthWrite,
  });
}

/** The card every dab is drawn with, `count` times; `attributes` are per dab: { name: [Float32Array, itemSize] }. */
export function dabGeometry(count, attributes = {}, dynamic = false) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, [array, size]] of Object.entries(attributes)) {
    const a = new THREE.InstancedBufferAttribute(array, size);
    if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
  }
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export function dabMesh(geometry, material, order = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.frustumCulled = false;
  m.matrixAutoUpdate = false;
  m.renderOrder = order;
  return m;
}
