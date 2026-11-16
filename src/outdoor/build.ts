// The built parts of an outdoor space (SPEC 19.1, 19.2): ground finishes, boundaries, roofs and the building's face. three only.
// Everything is merged by material, so a whole garden is a handful of draw calls. All of it is decor under SPEC 16.2: no ray of the walk
// hits it for a measurement, and the walls that stop the walker are the layout's own.
import * as THREE from 'three';
import { computeEdgeFrames } from '../core/layout-geom';
import type { EdgeFrame, Layout, Vec2 } from '../types';
import type { Tier } from '../look/types';
import { boxGeometry, flatGeometry, mergeAndFree, segmentBox, tube } from './geo';
import { GROUND, OutdoorMaterials, patchGround } from './materials';
import type { GroundKind } from './materials';
import type { HedgeSeg } from './plants';
import type { Boundary, GroundArea, GroundFinish, OutdoorFile, Roof } from './types';

/** the height of each finish above the deck: a thin lift so a finish drawn over another never fights it in the depth buffer */
export const FINISH_Y: Record<GroundFinish, number> = { lawn: 0, bed: 0, paving: 0.002, deck: 0.004, gravel: 0.008, path: 0.01, track: 0.012, rubber: 0.02 };
export const DEFAULT_COMPOUND_M = 2.1;
export const DEFAULT_PARAPET_M = 1.1;
export const DEFAULT_HEDGE_M = 1.8;
export const DEFAULT_GLASS_M = 1.1;
/** the building's storeys, for the windows on its face: the clubhouse podium, then flats a typical 3.1 m apart (typical figures, not a drawing) */
export const PODIUM_M = 4.2;
export const STOREY_M = 3.1;
const PAINT = '#E6D9BF';

export interface BuildCtx { layout: Layout; file: OutdoorFile; mats: OutdoorMaterials; tier: Tier }

const frameMap = (layout: Layout): Map<string, EdgeFrame> => new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, f]));
const pt = (f: EdgeFrame, u: number, o: number): Vec2 => ({ x: f.a.x + f.dir.x * u + f.out.x * o, z: f.a.z + f.dir.z * u + f.out.z * o });

function tag(m: THREE.Mesh, name: string, cast: boolean, receive: boolean): THREE.Mesh {
  m.name = name; m.castShadow = cast; m.receiveShadow = receive; m.userData.outdoor = name;
  return m;
}

// ---------------------------------------------------------------- ground

/** A kerb along a polygon's edge (a bed's raised border, a path's edging): a box 0.1 m wide on each edge. */
function kerbGeos(poly: Vec2[], height: number, y0: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < poly.length; i++) out.push(segmentBox(poly[i], poly[(i + 1) % poly.length], 0.1, y0, y0 + height, 0, 0.5));
  return out;
}

export function buildGround(ctx: BuildCtx): THREE.Group {
  const group = new THREE.Group();
  group.name = 'outdoor-ground';
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const kerbs: THREE.BufferGeometry[] = [];
  const seen = new Map<GroundFinish, number>();
  for (const a of ctx.file.areas) {
    const kind: GroundKind = a.finish;
    const spec = GROUND[kind];
    // two areas of one finish that overlap (an island of coloured rubber on a rubber field) must not fight: each later one sits 1.5 mm higher
    const nth = seen.get(a.finish) ?? 0;
    seen.set(a.finish, nth + 1);
    const lift = (a.finish === 'bed' && a.edgingM ? a.edgingM * 0.7 : FINISH_Y[a.finish]) + nth * 0.0015;
    const mat = ctx.mats.ground(kind, { colour: a.colour, stripes: a.stripes });
    const list = byMat.get(mat) ?? [];
    list.push(flatGeometry(a.polygon, a.holes, lift, spec.tile));
    byMat.set(mat, list);
    if (a.edgingM) { kerbs.push(...kerbGeos(a.polygon, a.edgingM, 0)); for (const h of a.holes ?? []) kerbs.push(...kerbGeos(h, a.edgingM, 0)); }
  }
  for (const [mat, list] of byMat) {
    const g = mergeAndFree(list);
    if (g) group.add(tag(new THREE.Mesh(g, mat), `ground:${(mat as THREE.MeshStandardMaterial).userData.finish ?? 'finish'}`, false, true));
  }
  const kg = mergeAndFree(kerbs);
  if (kg) group.add(tag(new THREE.Mesh(kg, ctx.mats.ground('soil-kerb')), 'kerbs', true, true));
  return group;
}

// ---------------------------------------------------------------- boundaries

const wallPaint = (ctx: BuildCtx, colour: string): THREE.MeshStandardMaterial => ctx.mats.plain(`paint:${colour}`, () => {
  const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95, metalness: 0 });
  patchGround(m, { mean: 1, strength: 0, noise: 0.07, dry: 0, stripes: false, lumps: false });
  return m;
});
// powder-coated mid-grey, part diffuse: a dark steel rail with high metalness and no environment to reflect reads as a black pole against the bright deck
const metal = (ctx: BuildCtx, colour = '#8C9296'): THREE.MeshStandardMaterial => ctx.mats.plain(`metal:${colour}`, () => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45, metalness: 0.25 }));
const glassMat = (ctx: BuildCtx): THREE.MeshStandardMaterial => ctx.mats.plain('glass', () => new THREE.MeshStandardMaterial({ color: '#BFE0E3', roughness: 0.04, metalness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));

export interface BoundaryBuild { group: THREE.Group; hedges: HedgeSeg[] }

export function buildBoundaries(ctx: BuildCtx): BoundaryBuild {
  const group = new THREE.Group();
  group.name = 'outdoor-boundary';
  const frames = frameMap(ctx.layout);
  const hedges: HedgeSeg[] = [];
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const put = (mat: THREE.Material, g: THREE.BufferGeometry): void => { const l = buckets.get(mat) ?? []; l.push(g); buckets.set(mat, l); };
  for (const b of ctx.file.boundary) {
    const f = frames.get(`${b.room}:${b.edge}`);
    if (!f || b.kind === 'facade') continue;
    if (b.kind === 'compound') compound(ctx, f, b, put);
    else if (b.kind === 'parapet') parapet(ctx, f, b, put);
    else if (b.kind === 'glass') glassRail(ctx, f, b, put);
    else if (b.kind === 'hedge') {
      const a = pt(f, 0, 0.45), z = pt(f, f.length, 0.45);
      const dx = z.x - a.x, dz = z.z - a.z;
      const n = Math.max(1, Math.round(f.length));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        hedges.push({ x: a.x + dx * t, z: a.z + dz * t, yawDeg: (Math.atan2(dx, dz) * 180) / Math.PI, lenM: (f.length / n) * 1.08, widthM: 0.9, heightM: b.heightM ?? DEFAULT_HEDGE_M, species: 'ficus', id: `boundary-${b.room}-${b.edge}` });
      }
    }
  }
  for (const [mat, list] of buckets) {
    const g = mergeAndFree(list);
    if (g) {
      const m = tag(new THREE.Mesh(g, mat), 'boundary', mat !== glassMat(ctx), true);
      if (mat === glassMat(ctx)) m.renderOrder = 3;
      group.add(m);
    }
  }
  return { group, hedges };
}

type Put = (mat: THREE.Material, g: THREE.BufferGeometry) => void;

function compound(ctx: BuildCtx, f: EdgeFrame, b: Boundary, put: Put): void {
  const H = b.heightM ?? DEFAULT_COMPOUND_M;
  const paint = wallPaint(ctx, b.colour ?? PAINT);
  put(paint, segmentBox(pt(f, -0.02, 0.115), pt(f, f.length + 0.02, 0.115), 0.23, 0, H, 0, 1));
  put(paint, segmentBox(pt(f, -0.05, 0.115), pt(f, f.length + 0.05, 0.115), 0.31, H, H + 0.07, 0, 1)); // the cap
  // piers every 3.5 m, a little proud on the room's side, with a flat cap
  const n = Math.max(1, Math.round(f.length / 3.5));
  for (let i = 0; i <= n; i++) {
    const u = Math.min(f.length - 0.1, Math.max(0.1, (i / n) * f.length));
    put(paint, segmentBox(pt(f, u - 0.2, 0.1), pt(f, u + 0.2, 0.1), 0.4, 0, H + 0.12, 0, 1));
    put(paint, segmentBox(pt(f, u - 0.26, 0.1), pt(f, u + 0.26, 0.1), 0.46, H + 0.12, H + 0.18, 0, 1));
  }
}

function parapet(ctx: BuildCtx, f: EdgeFrame, b: Boundary, put: Put): void {
  const H = b.heightM ?? DEFAULT_PARAPET_M;
  const paint = wallPaint(ctx, b.colour ?? PAINT);
  const steel = metal(ctx);
  const base = Math.min(0.5, H * 0.45);
  put(paint, segmentBox(pt(f, -0.02, 0.1), pt(f, f.length + 0.02, 0.1), 0.2, 0, base, 0, 1));
  put(paint, segmentBox(pt(f, -0.04, 0.1), pt(f, f.length + 0.04, 0.1), 0.26, base, base + 0.05, 0, 1));
  const n = Math.max(1, Math.round(f.length / 1.4));
  for (let i = 0; i <= n; i++) { const p = pt(f, (i / n) * f.length, 0.1); put(steel, tube(p.x, p.z, base + 0.05, H, 0.022, 8)); }
  for (const y of [H - 0.03, base + (H - base) * 0.45]) put(steel, segmentBox(pt(f, 0, 0.1), pt(f, f.length, 0.1), 0.045, y - 0.02, y + 0.02, 0, 1));
}

function glassRail(ctx: BuildCtx, f: EdgeFrame, b: Boundary, put: Put): void {
  const H = b.heightM ?? DEFAULT_GLASS_M;
  const steel = metal(ctx, '#9FA6AC');
  const glass = glassMat(ctx);
  const paint = wallPaint(ctx, b.colour ?? PAINT);
  put(paint, segmentBox(pt(f, -0.02, 0.09), pt(f, f.length + 0.02, 0.09), 0.18, 0, 0.1, 0, 1));
  const n = Math.max(1, Math.round(f.length / 1.5));
  for (let i = 0; i <= n; i++) {
    const p = pt(f, (i / n) * f.length, 0.09);
    put(steel, tube(p.x, p.z, 0.1, H, 0.025, 8));
    if (i < n) put(glass, segmentBox(pt(f, (i / n) * f.length + 0.04, 0.09), pt(f, ((i + 1) / n) * f.length - 0.04, 0.09), 0.012, 0.14, H - 0.04, 0, 1));
  }
  put(steel, segmentBox(pt(f, 0, 0.09), pt(f, f.length, 0.09), 0.05, H - 0.02, H + 0.025, 0, 1));
}

// ---------------------------------------------------------------- roofs (semi-outdoor)

export function buildRoofs(ctx: BuildCtx): THREE.Group {
  const group = new THREE.Group();
  group.name = 'outdoor-roofs';
  for (const r of ctx.file.roofs) group.add(roofMesh(ctx, r));
  return group;
}

function roofMesh(ctx: BuildCtx, r: Roof): THREE.Group {
  const g = new THREE.Group();
  g.name = `roof:${r.id}`;
  const paint = wallPaint(ctx, r.colour ?? '#EDE4D0');
  const geos: THREE.BufferGeometry[] = [];
  const t = r.thicknessM ?? 0.22;
  const R = r.rect;
  if (r.kind === 'slab') {
    geos.push(boxGeometry(R.x0, R.x1, r.heightM - t, r.heightM, R.z0, R.z1, 1));
    // a drip edge round the slab
    geos.push(boxGeometry(R.x0 - 0.04, R.x1 + 0.04, r.heightM - 0.04, r.heightM + 0.05, R.z0 - 0.04, R.z1 + 0.04, 1));
  } else {
    const slat = 0.07;
    for (let x = R.x0; x <= R.x1 + 1e-6; x += 0.28) geos.push(boxGeometry(x - slat / 2, x + slat / 2, r.heightM - 0.16, r.heightM, R.z0, R.z1, 1));
    for (const z of [R.z0, R.z1, (R.z0 + R.z1) / 2]) geos.push(boxGeometry(R.x0, R.x1, r.heightM - 0.3, r.heightM - 0.16, z - 0.05, z + 0.05, 1));
  }
  for (const c of r.columns) {
    geos.push(boxGeometry(c.x - 0.16, c.x + 0.16, 0, r.heightM - t, c.z - 0.16, c.z + 0.16, 1));
    geos.push(boxGeometry(c.x - 0.21, c.x + 0.21, 0, 0.12, c.z - 0.21, c.z + 0.21, 1));
  }
  const m = mergeAndFree(geos);
  if (m) g.add(tag(new THREE.Mesh(m, r.kind === 'pergola' ? ctx.mats.plain('pergola', () => new THREE.MeshStandardMaterial({ color: '#6B4A32', roughness: 0.75 })) : paint), 'roof', true, true));
  return g;
}

// ---------------------------------------------------------------- the building's face

/**
 * The facade is drawn by the shell (a wall with the door in it). This adds what makes it a building: a cornice at the top of the podium, a
 * band of glazing for the clubhouse and rows of windows for the flats above. All of it is on the room's side of the wall and decorative.
 */
export function buildFacadeDecor(ctx: BuildCtx): THREE.Group {
  const group = new THREE.Group();
  group.name = 'outdoor-facade';
  const frames = frameMap(ctx.layout);
  const H = ctx.layout.wallHeightM;
  const glass = ctx.mats.plain('facade-glass', () => new THREE.MeshStandardMaterial({ color: '#5E8296', roughness: 0.12, metalness: 0.25 }));
  const frame = metal(ctx, '#D8D8D4');
  const paint = wallPaint(ctx, '#F1EADB');
  const gl: THREE.BufferGeometry[] = [], fr: THREE.BufferGeometry[] = [], pn: THREE.BufferGeometry[] = [];
  for (const b of ctx.file.boundary) {
    if (b.kind !== 'facade') continue;
    const f = frames.get(`${b.room}:${b.edge}`);
    if (!f) continue;
    // the room's side of the wall is at o = 0 going inwards (negative o)
    const openings = ctx.layout.openings.filter((o) => o.roomId === b.room && o.edge === b.edge).map((o) => [o.centreM - o.widthM / 2 - 0.5, o.centreM + o.widthM / 2 + 0.5] as const);
    const clear = (u0: number, u1: number): boolean => openings.every(([a, c]) => u1 < a || u0 > c);
    const win = (u0: number, u1: number, y0: number, y1: number): void => {
      if (!clear(u0, u1)) return;
      const t = 0.05;
      gl.push(segmentBox(pt(f, u0, -0.012), pt(f, u1, -0.012), 0.02, y0, y1, 0, 1));
      for (const [a, c, ya, yb] of [[u0 - t, u1 + t, y1, y1 + t], [u0 - t, u1 + t, y0 - t, y0], [u0 - t, u0, y0 - t, y1 + t], [u1, u1 + t, y0 - t, y1 + t]] as const) fr.push(segmentBox(pt(f, a, -0.03), pt(f, c, -0.03), 0.06, ya, yb, 0, 1));
      // a mullion down the middle of a wide window
      if (u1 - u0 > 1.4) fr.push(segmentBox(pt(f, (u0 + u1) / 2 - 0.025, -0.03), pt(f, (u0 + u1) / 2 + 0.025, -0.03), 0.06, y0, y1, 0, 1));
    };
    // clubhouse glazing: tall panels between the door and the ends
    for (let u = 1.4; u + 2.4 < f.length; u += 3.2) win(u, u + 2.4, 0.25, 3.3);
    // the podium's cornice, and a slab edge at every storey above
    pn.push(segmentBox(pt(f, 0, -0.14), pt(f, f.length, -0.14), 0.28, PODIUM_M - 0.34, PODIUM_M, 0, 1));
    for (let y = PODIUM_M + STOREY_M; y < H - 0.2; y += STOREY_M) pn.push(segmentBox(pt(f, 0, -0.05), pt(f, f.length, -0.05), 0.1, y - 0.18, y, 0, 1));
    // flats' windows: two to a bay, 1.5 m wide, sill 0.9 m, head 2.1 m above each floor
    for (let y = PODIUM_M; y + STOREY_M <= H + 0.3; y += STOREY_M) for (let u = 1.2; u + 1.5 < f.length; u += 3.0) win(u, u + 1.5, y + 0.9, y + 2.1);
    // the top of the face
    pn.push(segmentBox(pt(f, 0, -0.18), pt(f, f.length, -0.18), 0.36, H - 0.12, H + 0.1, 0, 1));
  }
  const add = (list: THREE.BufferGeometry[], mat: THREE.Material, name: string, cast: boolean): void => { const g = mergeAndFree(list); if (g) group.add(tag(new THREE.Mesh(g, mat), name, cast, true)); };
  add(gl, glass, 'facade-glass', false);
  add(fr, frame, 'facade-frames', true);
  add(pn, paint, 'facade-bands', true);
  return group;
}

/** Everything the module draws that is not a plant or the water: ground, boundaries, roofs, the facade's decor. */
export function buildStructure(ctx: BuildCtx): { group: THREE.Group; hedges: HedgeSeg[] } {
  const group = new THREE.Group();
  group.name = 'outdoor-structure';
  group.add(buildGround(ctx));
  const b = buildBoundaries(ctx);
  group.add(b.group);
  group.add(buildRoofs(ctx));
  group.add(buildFacadeDecor(ctx));
  return { group, hedges: b.hedges };
}
