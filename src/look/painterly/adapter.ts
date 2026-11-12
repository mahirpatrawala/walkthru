// Owned by C11c. SPEC 16.7 adapter.ts: our shell and furniture drawn as thick oil paint with blendi's oil-paint renderer
// (vendor/oilpaint, MIT, unmodified). It never touches a size: strokes are laid ON the existing triangles, so every wall, floor,
// ceiling and furniture face is exactly where the walk-through has it. Colours are the sampled ones (palettes.ts).
//
// How it maps onto the kit (read from vendor/oilpaint/src/night/kit.js and src/oilpaint/*):
//   shell triangles   -> kit.tri(a, b, c, palette, { grain })   one palette per sampled colour, grain along a wall's length or the tile grid
//   furniture meshes  -> kit.add(geometry, matrix, palette, { smooth, grain })   grain along the mesh's long axis
//   sun               -> createShade(...) draws the still world once from the sun into a depth picture the strokes read
//   window glass      -> a glowing "sky" palette, plain: the view outside is illustrative
//   canvas            -> createFrame(...) (weave and varnish)
import * as THREE from 'three';
import { createBrushSheet, createFrame, createShade, createShared } from '../../../vendor/oilpaint/src/oilpaint/index.js';
import { createKit } from '../../../vendor/oilpaint/src/night/kit.js';
import type { KitPalette } from '../../../vendor/oilpaint/src/night/kit.js';
import { computeEdgeFrames } from '../../core/layout-geom';
import type { Layout } from '../../types';
import type { SunState } from '../sun';
import { PaletteSet, hexToRgb, rgbToHex } from './palettes';
import { paintPerson } from './person';
import type { PaintedPerson } from './person';

export interface PaintingParts {
  shell: THREE.Object3D;
  /** the parent of every furniture mesh (people are not in it) */
  furnitureRoot: THREE.Object3D;
  layout: Layout;
  /** the walking figure (its skinned meshes are painted too); left out, the person is not in the painting */
  character?: { object: THREE.Object3D; tone: number };
}

export interface PaintingOptions {
  sun: SunState;
  /** MSAA samples of the painter's canvas (4 is what the painter was made with) */
  samples?: number;
  /** side of the square picture of the sun's shade */
  shadeSize?: number;
  /** paint the walking figure too (default true when `parts.character` is given) */
  person?: boolean;
  /** multiplies the number of strokes (1 = a stroke every ~12 cm across, ~8 per square foot) */
  density?: number;
}

export interface PaintingStats { person: { pins: number; meshes: string[] } | null; strokes: number; palettes: number; furnitureMeshes: number; shellTriangles: number; buildMs: number }

export interface Painting {
  /** draws one frame of the painting into the default framebuffer (the viewer's canvas) */
  render(camera: THREE.PerspectiveCamera, dt?: number): void;
  /** call after the canvas was resized */
  resize(): void;
  readonly stats: PaintingStats;
  /** the canvas colour outside the flat, for the caption strip */
  readonly background: string;
  dispose(): void;
}

const MAX_WINDOWS = 8;
/** The painter brightens its own strokes (a streak is 1.22 x its colour), so paint is laid a little under the sampled colour to land on it. */
const TONE = 0.9;

/** The painter's light, for the kit: sun through the shade picture, window skylight, a little ambient. Written against kit.js's contract:
 *  `kitPaint(P, Nn, k, tone, r)` with PAL_L/M/S/G and COMMON's paint3, sunAt and the uniforms. */
const LIGHT = /* glsl */ `
uniform vec4 uWin[${MAX_WINDOWS}];
uniform vec3 uSunTint;
uniform vec3 uSkyTint;
uniform vec3 uAmbient;
// how much sky the openings send to a spot that faces n
float windowLight(vec3 P, vec3 Nn) {
  float f = 0.0;
  for (int i = 0; i < ${MAX_WINDOWS}; i++) {
    if (uWin[i].w <= 0.0) continue;
    vec3 to = uWin[i].xyz - P;
    float d2 = dot(to, to);
    f += uWin[i].w * clamp(dot(Nn, to) * inversesqrt(d2 + 1e-4) * 0.75 + 0.35, 0.0, 1.0) / (1.0 + d2 * 0.1);
  }
  return f;
}
vec3 kitPaint(vec3 P, vec3 Nn, int k, float tone, float r) {
  float facing = clamp(dot(Nn, uSunDir) * 1.15 + 0.08, 0.0, 1.0);
  float sun = facing > 0.0 ? sunAt(P + Nn * 0.035) * facing : 0.0;
  float sky = windowLight(P, Nn);
  float x = uAmbient.x + uAmbient.y * (0.5 + 0.5 * Nn.y) + 0.42 * sky + 0.65 * sun;
  // a wall is a little darker where it meets the floor (the corner takes less light)
  x -= 0.1 * (1.0 - smoothstep(0.0, 0.5, P.y)) * (1.0 - abs(Nn.y));
  x = clamp(x, 0.0, 1.0);
  vec3 c = paint3(PAL_L[k], PAL_M[k], PAL_S[k], x, r) * tone;
  // the sun's light is warm, the shade is cool: the shifts a painter makes to keep white from going to grey
  c = mix(c, c * uSunTint, smoothstep(0.5, 0.75, x) * sun);
  c = mix(c, c * uSkyTint, (1.0 - sun) * (1.0 - smoothstep(0.3, 0.62, x)) * 0.9);
  return PAL_G[k] > 0.5 ? PAL_L[k] * tone : c;
}`;

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Window centres and strengths, for the sky fill. */
export function windowLights(layout: Layout): THREE.Vector4[] {
  const frames = computeEdgeFrames(layout);
  const out: { v: THREE.Vector4; size: number }[] = [];
  for (const o of layout.openings) {
    if (o.type !== 'window') continue;
    const f = frames.find((x) => x.roomId === o.roomId && x.edge === o.edge);
    if (!f) continue;
    const h = Math.max(0.1, o.headM - o.sillM);
    const x = f.a.x + f.dir.x * o.centreM;
    const z = f.a.z + f.dir.z * o.centreM;
    const size = o.widthM * h;
    out.push({ v: new THREE.Vector4(x - f.out.x * 0.05, o.sillM + h / 2, z - f.out.z * 0.05, Math.min(1.3, 0.35 + size * 0.55)), size });
  }
  out.sort((a, b) => b.size - a.size);
  const list = out.slice(0, MAX_WINDOWS).map((e) => e.v);
  while (list.length < MAX_WINDOWS) list.push(new THREE.Vector4(0, 0, 0, 0));
  return list;
}

function eachTriangle(mesh: THREE.Mesh, cb: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void): void {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  if (!pos) return;
  const idx = g.getIndex();
  const count = idx ? idx.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i + 2 < count; i += 3) {
    const [i0, i1, i2] = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
    a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
    cb(a, b, c);
  }
}

const arr = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];

/** The kit puts at most 3,000 strokes on one triangle, so a 10 square metre floor triangle would be starved of paint. Large triangles are cut
 *  into four similar triangles (at the edge midpoints, so none is a sliver) until none is over `maxArea`; the cuts lie exactly on the face. */
export function splitTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, maxArea: number, out: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = []): [THREE.Vector3, THREE.Vector3, THREE.Vector3][] {
  const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
  if (area <= maxArea) { out.push([a.clone(), b.clone(), c.clone()]); return out; }
  const ab = a.clone().lerp(b, 0.5), bc = b.clone().lerp(c, 0.5), ca = c.clone().lerp(a, 0.5);
  splitTriangle(a, ab, ca, maxArea, out);
  splitTriangle(ab, b, bc, maxArea, out);
  splitTriangle(ca, bc, c, maxArea, out);
  splitTriangle(ab, bc, ca, maxArea, out);
  return out;
}

function inPolygon(poly: { x: number; z: number }[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function hexOfMaterial(mat: THREE.Material): string | null {
  const m = mat as THREE.MeshStandardMaterial;
  if (!m.color) return null;
  const base = m.userData?.baseColor;
  return typeof base === 'number' ? '#' + base.toString(16).padStart(6, '0') : '#' + m.color.getHexString();
}

export function createPainting(renderer: THREE.WebGLRenderer, parts: PaintingParts, opts: PaintingOptions): Painting {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const { layout } = parts;
  const fin = layout.finishes;
  const density = opts.density ?? 1;
  const sun = opts.sun;

  const shared = createShared();
  shared.tBrush.value = createBrushSheet();
  const toSun = V(...sun.toSun).normalize();
  (shared.uSunDir.value as THREE.Vector3).copy(toSun);
  // indoors there is no haze and no wind to speak of
  shared.uHazeDensity.value = 0;
  shared.uShadeBias.value = 0.0012;
  shared.uImpasto.value = 1.0;
  // the sun's colour as a tint on lit paint (display values: the painter does not tone-map): white at noon, a warm cast late in the day
  shared.uSunTint = { value: V(Math.sqrt(sun.colour[0]), Math.sqrt(sun.colour[1]), Math.sqrt(sun.colour[2])).multiplyScalar(1.04) };
  shared.uSkyTint = { value: V(0.92, 0.95, 1.03) };
  shared.uAmbient = { value: V(0.2, 0.12, 0) };
  shared.uWin = { value: windowLights(layout) };

  const palettes = new PaletteSet();
  const skyHex = rgbToHex([0.6 + 0.3 * sun.warmth, 0.79 - 0.06 * sun.warmth, 0.95 - 0.3 * sun.warmth]);
  palettes.glow('sky', skyHex);

  // ---- collect the faces. The kit takes palettes up front, so everything is gathered first and given to it in one go.
  parts.shell.updateMatrixWorld(true);
  parts.furnitureRoot.updateMatrixWorld(true);
  type Job = (kit: ReturnType<typeof createKit>) => void;
  const jobs: Job[] = [];
  const casters: number[] = [];
  const pushCaster = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => { casters.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); };
  const roomOf = new Map(layout.rooms.map((r) => [r.id, r]));
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nn = new THREE.Vector3();
  let shellTriangles = 0;
  let furnitureMeshes = 0;
  const bounds = new THREE.Box3();

  parts.shell.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const name = mesh.name;
    const room = roomOf.get(mesh.userData.roomId as string);
    let hex: string;
    let kind: 'floor' | 'ceiling' | 'wall' | 'trim' | 'pane';
    if (name.startsWith('floor:') || name.startsWith('threshold:')) { hex = room?.floorColor ?? fin.floorColor; kind = 'floor'; }
    else if (name.startsWith('ceiling:')) { hex = fin.ceilingColor; kind = 'ceiling'; }
    else if (name.startsWith('walls:')) { hex = room?.wallColor ?? fin.wallColor; kind = 'wall'; }
    else if (name === 'frames') { hex = fin.frameColor; kind = 'trim'; }
    else if (name === 'railings') { hex = fin.railingColor; kind = 'trim'; }
    else if (name === 'panes') { hex = skyHex; kind = 'pane'; }
    else { hex = hexOfMaterial(mesh.material as THREE.Material) ?? fin.wallColor; kind = 'trim'; }
    const pal = kind === 'pane' ? 'sky' : palettes.name(hex);
    const stroke: [number, number] = kind === 'floor' ? [0.05, 0.15] : kind === 'ceiling' ? [0.07, 0.2] : kind === 'wall' ? [0.05, 0.16] : kind === 'pane' ? [0.1, 0.18] : [0.025, 0.07];
    const dens = (kind === 'pane' ? 1.4 : kind === 'ceiling' ? 1.2 : 1.7) * density;
    eachTriangle(mesh, (a, b, c) => {
      shellTriangles++;
      bounds.expandByPoint(a); bounds.expandByPoint(b); bounds.expandByPoint(c);
      if (kind !== 'pane') pushCaster(a, b, c);
      e1.subVectors(b, a); e2.subVectors(c, a); nn.crossVectors(e1, e2).normalize();
      // walls run their strokes along their length, floors and ceilings along the tile grid (the x axis)
      const grain: [number, number, number] = Math.abs(nn.y) > 0.7 ? [1, 0, 0] : [nn.z, 0, -nn.x];
      if (kind === 'floor' || kind === 'ceiling') {
        // a whole room's floor has no holes and strokes that spill a few cm past its edge end up under a wall: the strokes may run free of the
        // triangle (the kit then neither shrinks them to the face nor pulls them inward), and big triangles are cut so none starves
        for (const [p0, p1, p2] of splitTriangle(a, b, c, 0.8)) {
          const A = arr(p0), B = arr(p1), C = arr(p2);
          jobs.push((kit) => kit.tri(A, B, C, pal, { grain, stroke, density: dens, tone: TONE, free: true }));
        }
        return;
      }
      // a wall keeps its strokes inside its face (a window hole must stay clear); a very large face gets larger strokes so it stays under the kit's 3,000 a triangle
      const area = e1.cross(e2).length() / 2;
      const want = (area / (stroke[0] * stroke[1])) * 2.6 * dens;
      const k = want > 2700 ? Math.sqrt(want / 2700) : 1;
      const sized: [number, number] = [stroke[0] * k, stroke[1] * k];
      const A = arr(a), B = arr(b), C = arr(c);
      jobs.push((kit) => kit.tri(A, B, C, pal, { grain, stroke: sized, density: dens, tone: kind === 'pane' ? 1 : TONE }));
    });
  });

  // grout lines: the floor's tile grid, laid as dark strokes just above the floor
  if (fin.tile) {
    const { wM, lM } = fin.tile;
    const groutPal = palettes.name(fin.groutColor);
    for (const room of layout.rooms) {
      const poly = room.polygon;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      const seg = 0.16;
      jobs.push((kit) => {
        const up = V(0, 1, 0);
        // lines of constant x run along z, and the other way round
        for (let x = Math.ceil(x0 / wM) * wM; x < x1; x += wM) {
          for (let z = z0 + seg / 2; z < z1; z += seg * 0.9) if (inPolygon(poly, x, z) && inPolygon(poly, x, z + 0.04)) kit.stroke(V(x, 0, z), up, V(0, 0, 1), 0.012, seg, groutPal, 0.9, 0.003);
        }
        for (let z = Math.ceil(z0 / lM) * lM; z < z1; z += lM) {
          for (let x = x0 + seg / 2; x < x1; x += seg * 0.9) if (inPolygon(poly, x, z) && inPolygon(poly, x + 0.04, z)) kit.stroke(V(x, 0, z), up, V(1, 0, 0), 0.012, seg, groutPal, 0.9, 0.003);
        }
      });
    }
  }

  // furniture: every opaque mesh, in its own palette, strokes along its long axis
  const geo: { g: THREE.BufferGeometry; matrix: THREE.Matrix4; pal: string; grain: THREE.Vector3 }[] = [];
  parts.furnitureRoot.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || !mesh.geometry) return;
    for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (!p.visible) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mat || mat.transparent || mat.opacity < 1 || (mat as THREE.MeshBasicMaterial).wireframe) return;
    const hex = hexOfMaterial(mat);
    if (!hex) return;
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    const ext = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
    const grain = new THREE.Vector3().setFromMatrixColumn(mesh.matrixWorld, axis).normalize();
    geo.push({ g: mesh.geometry, matrix: mesh.matrixWorld.clone(), pal: palettes.name(hex), grain });
    furnitureMeshes++;
    eachTriangle(mesh, (a, b, c) => { pushCaster(a, b, c); bounds.expandByPoint(a); bounds.expandByPoint(b); bounds.expandByPoint(c); });
  });
  for (const f of geo) {
    jobs.push((kit) => kit.add(f.g, f.matrix, f.pal, { smooth: true, grain: f.grain, stroke: [0.03, 0.09], density: density * 1.5, tone: TONE }));
  }

  // ---- the kit: palettes first (they are now known), then every job
  const kit = createKit(shared, { palettes: palettes.palettes() as Record<string, KitPalette>, light: LIGHT, seed: 9101, order: 3 });
  for (const j of jobs) j(kit);
  const built = kit.build();
  const group = built.group;
  group.frustumCulled = false;

  // ---- the shade: the still world drawn once from the sun
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(2, bounds.getSize(new THREE.Vector3()).length() / 2 + 0.3);
  const casterGeo = new THREE.BufferGeometry();
  casterGeo.setAttribute('position', new THREE.Float32BufferAttribute(casters, 3));
  const still = new THREE.Scene();
  const casterMesh = new THREE.Mesh(casterGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  casterMesh.frustumCulled = false;
  still.add(casterMesh);
  const back = radius * 2;
  // createShade and createFrame do not hand back what they make (render targets, the canvas's full-screen quad). A thin wrapper around the
  // renderer notes them, so dispose() can free them and opening the painting twice does not leak.
  const shadeTargets = new Set<THREE.WebGLRenderTarget>();
  const quadScenes = new Set<THREE.Object3D>();
  let worldRef: THREE.Object3D | null = null;
  const noting = new Proxy(renderer, {
    get(target, prop) {
      if (prop === 'setRenderTarget') return (t: THREE.WebGLRenderTarget | null, ...rest: unknown[]) => { if (t) shadeTargets.add(t); return (target.setRenderTarget as (...a: unknown[]) => void)(t, ...rest); };
      if (prop === 'render') return (scene: THREE.Object3D, camera: THREE.Camera) => { if (scene !== worldRef && scene.children.length === 1 && (scene.children[0] as THREE.Mesh).isMesh) quadScenes.add(scene); return target.render(scene as THREE.Scene, camera); };
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  const shade = createShade(noting, shared, still, {
    sun: toSun, size: [opts.shadeSize ?? 2048, opts.shadeSize ?? 2048], box: [radius, radius], centre: [centre.x, centre.y, centre.z],
    back, near: back - radius * 1.1, far: back + radius * 1.1,
  });

  // ---- the canvas
  const frame = createFrame(noting, shared, { samples: opts.samples ?? 4 });
  frame.uniforms.uShafts.value = 0;
  frame.uniforms.uCanvas.value = 1;
  const world = new THREE.Scene();
  worldRef = world;
  world.add(group);
  world.background = new THREE.Color().setRGB(...hexToRgb(skyHex));
  const emptyWorld = new THREE.Scene(); // the figure's own shade picture when there is no figure: nothing on layer 1, so it is all light
  let person: PaintedPerson | null = null;
  if (parts.character && opts.person !== false) {
    try { person = paintPerson(shared, parts.character); } catch (err) { console.warn('[walkthru] the person could not be painted, leaving him out:', err); person = null; }
    if (person) world.add(person.group);
  }
  const personAt = new THREE.Vector3();
  let time = 0;
  const size = new THREE.Vector2();
  const dummy = new THREE.Vector3();
  let disposed = false;

  const painting: Painting = {
    stats: { person: person ? person.stats : null, strokes: built.count, palettes: palettes.size, furnitureMeshes, shellTriangles, buildMs: (typeof performance !== 'undefined' ? performance.now() : 0) - t0 },
    background: skyHex,
    render(camera, dt = 0.016) {
      if (disposed) return;
      time += dt;
      camera.updateMatrixWorld(true);
      renderer.getDrawingBufferSize(size);
      shared.uTime.value = time;
      shared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / size.y;
      if (person) {
        person.update();
        person.position(personAt);
        shade.update(world, personAt);
      } else shade.update(emptyWorld, dummy);
      frame.render(world, camera);
    },
    resize() { if (!disposed) frame.resize(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      person?.dispose();
      frame.target.dispose();
      frame.target.depthTexture?.dispose();
      world.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      casterGeo.dispose();
      for (const t of shadeTargets) { t.depthTexture?.dispose(); t.dispose(); }
      for (const sc of quadScenes) sc.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
      (casterMesh.material as THREE.Material).dispose();
      for (const key of ['tTreeShade', 'tFigShade', 'tBrush', 'tNoise', 'tHeight', 'tLand']) {
        (shared[key]?.value as THREE.Texture | null)?.dispose?.();
      }
    },
  };
  return painting;
}
