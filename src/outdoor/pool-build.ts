// The swimming pool as built things (SPEC 19.3): a basin cut into the deck, not a blue rectangle. Coping round it, waterline tiles, a floor that
// follows the depth profile, steps with a slip band on each nosing, ladders with stainless handrails, depth numerals on the coping, optional lane
// lines, pool lights for the night, and the water over all of it (src/outdoor/water.ts). Merged by material: a pool is about ten draw calls.
import * as THREE from 'three';
import type { Look } from '../look/look';
import type { Tier } from '../look/types';
import { boxGeometry, flatGeometry, mergeAndFree, segmentBox, tube } from './geo';
import { OutdoorMaterials } from './materials';
import { copingRects, exposureOf, isExposedAt, markerStations, profileDepth, stepRects, waterLevelY } from './pool';
import type { PoolBasin, Rect, Side } from './types';
import { cubeUvDefines, makeUnderwater, makeWaterSurface, makeWaterUniforms, syncWaterUniforms } from './water';
import type { WaterUniforms } from './water';

const TILE_M = 0.1;
const BAND_M = 0.3;
const hasDom = (): boolean => typeof document !== 'undefined';

/** a 4 x 4 mosaic of small tiles with grout, in the pool's colour, one repeat per 10 cm */
function tileTexture(base: string, grout: string, seed: number): THREE.Texture | null {
  if (!hasDom()) return null;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = grout; g.fillRect(0, 0, 128, 128);
  const col = new THREE.Color(base);
  let s = seed;
  const r = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const k = 0.9 + r() * 0.2;
    g.fillStyle = `rgb(${Math.min(255, col.r * 255 * k)},${Math.min(255, col.g * 255 * k)},${Math.min(255, col.b * 255 * k)})`;
    g.fillRect(i * 32 + 2, j * 32 + 2, 28, 28);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(i * 32 + 2, j * 32 + 2, 28, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function numeralTexture(text: string): THREE.Texture | null {
  if (!hasDom()) return null;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192; // 4x the 128 x 48 design (SPEC 16.18)
  const g = c.getContext('2d');
  if (!g) return null;
  g.scale(4, 4);
  g.fillStyle = '#1E5F8C'; g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#FFFFFF'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = SRGB; t.anisotropy = 16;
  return t;
}
const SRGB = THREE.SRGBColorSpace;

const TILE_COL: Record<PoolBasin['tile'], { main: string; band: string; floor: string }> = {
  blue: { main: '#3F8FC4', band: '#1F5F8E', floor: '#4A9AD0' },
  turquoise: { main: '#4EC1CB', band: '#2A8FA0', floor: '#5ACAD2' },
  white: { main: '#E8EEF0', band: '#7FA9BD', floor: '#EEF3F4' },
};

export interface PoolBuild {
  group: THREE.Group;
  /** once a frame: the water's clock */
  update(dt: number): void;
  /** the look's hour, sky and sun changed */
  sync(look: Look | null): void;
  waters: THREE.Mesh[];
  dispose(): void;
}

export function buildPools(pools: readonly PoolBasin[], mats: OutdoorMaterials, tier: Tier, look: Look | null, ultra = false): PoolBuild {
  const group = new THREE.Group();
  group.name = 'outdoor-pools';
  const free: { dispose(): void }[] = [];
  const uniforms: WaterUniforms[] = [];
  const waters: THREE.Mesh[] = [];
  const surfaces: THREE.ShaderMaterial[] = [];
  const lights: THREE.Mesh[] = [];
  for (const b of pools) {
    const wl = waterLevelY(b);
    const u = makeWaterUniforms(wl, b.tile);
    uniforms.push(u);
    const col = TILE_COL[b.tile];
    const mk = (hex: string, seed: number, rough: number): THREE.MeshStandardMaterial => {
      const tex = tileTexture(hex, '#D9DFE2', seed);
      const m = new THREE.MeshStandardMaterial({ color: tex ? '#ffffff' : hex, map: tex ?? undefined, roughness: rough, metalness: 0 });
      free.push(m); if (tex) free.push(tex);
      return makeUnderwater(m, u, tier, ultra);
    };
    const wallMat = mk(col.main, 3, 0.35), bandMat = mk(col.band, 5, 0.3), floorMat = mk(col.floor, 7, 0.4);
    const slipMat = (() => { const m = new THREE.MeshStandardMaterial({ color: '#EAF0F2', roughness: 0.6 }); free.push(m); return makeUnderwater(m, u, tier, ultra); })();
    const R = b.rect;
    const deepest = Math.max(...b.profile.map((p) => p[1]));
    const floorY = (d: number): number => wl - d;
    const wallG: THREE.BufferGeometry[] = [], bandG: THREE.BufferGeometry[] = [], floorG: THREE.BufferGeometry[] = [], slipG: THREE.BufferGeometry[] = [];

    // the floor: a strip per piece of the profile, from the shallow end to the deep end, uv from the plan so the mosaic is one size everywhere
    const along = (u: number): number => (b.shallowEnd === 'W' ? R.x0 + u * (R.x1 - R.x0) : b.shallowEnd === 'E' ? R.x1 - u * (R.x1 - R.x0) : b.shallowEnd === 'N' ? R.z0 + u * (R.z1 - R.z0) : R.z1 - u * (R.z1 - R.z0));
    const alongX = b.shallowEnd === 'W' || b.shallowEnd === 'E';
    const pt = (u: number, t: number): { x: number; z: number } => (alongX ? { x: along(u), z: R.z0 + t * (R.z1 - R.z0) } : { x: R.x0 + t * (R.x1 - R.x0), z: along(u) });
    const quad = (a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uv: (p: THREE.Vector3) => [number, number]): THREE.BufferGeometry => {
      const pos = [a, bb, c, a, c, d].flatMap((p) => [p.x, p.y, p.z]);
      const uvs = [a, bb, c, a, c, d].flatMap((p) => uv(p));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      return g;
    };
    const ups: number[] = [...new Set(b.profile.map((p) => p[0]))];
    for (let i = 1; i < ups.length; i++) {
      const u0 = ups[i - 1], u1 = ups[i];
      const p00 = pt(u0, 0), p01 = pt(u0, 1), p10 = pt(u1, 0), p11 = pt(u1, 1);
      const a = new THREE.Vector3(p00.x, floorY(profileDepth(b, u0)), p00.z), bb = new THREE.Vector3(p01.x, floorY(profileDepth(b, u0)), p01.z);
      const c = new THREE.Vector3(p11.x, floorY(profileDepth(b, u1)), p11.z), d = new THREE.Vector3(p10.x, floorY(profileDepth(b, u1)), p10.z);
      let g = quad(a, bb, c, d, (p) => [p.x / TILE_M, p.z / TILE_M]);
      if (g.attributes.normal.getY(0) < 0) { g.dispose(); g = quad(a, d, c, bb, (p) => [p.x / TILE_M, p.z / TILE_M]); }
      floorG.push(g);
    }
    // lane lines: dark stripes down the floor, a cross mark at each end
    for (let l = 1; l <= b.lanes + 1 && b.lanes > 0; l++) {
      const t = (l - 0.5) / (b.lanes + 1) * 1.0;
      const half = 0.07 / ((alongX ? R.z1 - R.z0 : R.x1 - R.x0));
      for (let i = 1; i < ups.length; i++) {
        const a = pt(ups[i - 1], t - half), bb = pt(ups[i - 1], t + half), c = pt(ups[i], t + half), d = pt(ups[i], t - half);
        const y0 = floorY(profileDepth(b, ups[i - 1])) + 0.004, y1 = floorY(profileDepth(b, ups[i])) + 0.004;
        let g = quad(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(bb.x, y0, bb.z), new THREE.Vector3(c.x, y1, c.z), new THREE.Vector3(d.x, y1, d.z), () => [0, 0]);
        if (g.attributes.normal.getY(0) < 0) { g.dispose(); g = quad(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(d.x, y1, d.z), new THREE.Vector3(c.x, y1, c.z), new THREE.Vector3(bb.x, y0, bb.z), () => [0, 0]); }
        slipG.push(g); // drawn dark by the lane material below
      }
    }
    const laneGeos = slipG.splice(0, slipG.length);

    // the walls: an upper band at the waterline, the tiles below it down to the floor, each side cut to the depth profile where it runs along the slope
    const wallPanel = (a: { x: number; z: number }, c: { x: number; z: number }, y0: number, y1: number, into: THREE.BufferGeometry[]): void => {
      const dx = c.x - a.x, dz = c.z - a.z, len = Math.hypot(dx, dz);
      const nx = -dz / len, nz = dx / len; // either side: the material is double-sided via two quads
      void nx; void nz;
      const g1 = quad(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(c.x, y0, c.z), new THREE.Vector3(c.x, y1, c.z), new THREE.Vector3(a.x, y1, a.z), (p) => [(Math.abs(dx) > Math.abs(dz) ? p.x : p.z) / TILE_M, p.y / TILE_M]);
      const g2 = quad(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(a.x, y1, a.z), new THREE.Vector3(c.x, y1, c.z), new THREE.Vector3(c.x, y0, c.z), (p) => [(Math.abs(dx) > Math.abs(dz) ? p.x : p.z) / TILE_M, p.y / TILE_M]);
      into.push(g1, g2);
    };
    const bandTop = 0.0, bandBot = -BAND_M - b.waterBelowDeckM * 0 - 0.0;
    const ex = exposureOf(b, pools);
    // a side as a run from its start: N and S from x0, E and W from z0 (the order of the steps and the walkway)
    const SIDE: Record<Side, { a: { x: number; z: number }; dir: { x: number; z: number } }> = {
      N: { a: { x: R.x0, z: R.z0 }, dir: { x: 1, z: 0 } }, S: { a: { x: R.x0, z: R.z1 }, dir: { x: 1, z: 0 } },
      W: { a: { x: R.x0, z: R.z0 }, dir: { x: 0, z: 1 } }, E: { a: { x: R.x1, z: R.z0 }, dir: { x: 0, z: 1 } },
    };
    const at = (s: Side, t: number): { x: number; z: number } => ({ x: SIDE[s].a.x + SIDE[s].dir.x * t, z: SIDE[s].a.z + SIDE[s].dir.z * t });
    for (const side of ['N', 'E', 'S', 'W'] as Side[]) for (const [t0, t1] of ex.exposed[side]) {
      wallPanel(at(side, t0), at(side, t1), bandBot, bandTop, bandG);
      // the lower wall follows the floor: split into short pieces
      const len = t1 - t0, n = Math.max(1, Math.round(len / 0.5));
      for (let i = 0; i < n; i++) {
        const a = at(side, t0 + (len * i) / n), c = at(side, t0 + (len * (i + 1)) / n);
        const ua = alongU(b, a), uc = alongU(b, c);
        const yb = Math.min(floorY(profileDepth(b, ua)), floorY(profileDepth(b, uc))) - 0.02;
        wallPanel(a, c, yb, bandBot, wallG);
      }
    }
    // where this basin is shallower than the water it touches, a step wall from its floor down to the other's (a ledge's riser)
    for (const m of ex.seams) {
      const len = m.toM - m.fromM, n = Math.max(1, Math.round(len / 0.25));
      for (let i = 0; i < n; i++) {
        const a = at(m.side, m.fromM + (len * i) / n), c = at(m.side, m.fromM + (len * (i + 1)) / n);
        const mid = { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2 };
        const mine = profileDepth(b, alongU(b, mid)), theirs = profileDepth(m.other, alongU(m.other, mid));
        if (theirs > mine + 0.01) wallPanel(a, c, floorY(theirs), floorY(mine), wallG);
      }
    }
    void deepest;

    // steps: a block per tread to the floor, a lighter slip band along each nosing
    for (const s of stepRects(b)) {
      const top = wl - s.depthM;
      const bottom = wl - Math.max(...b.profile.map((p) => p[1])) - 0.05;
      const r = s.rect;
      const gTop = boxGeometry(r.x0, r.x1, bottom, top, r.z0, r.z1, TILE_M);
      wallG.push(gTop);
    }
    for (const fl of b.steps) {
      void fl;
    }
    for (const s of stepRects(b)) {
      const top = wl - s.depthM, r = s.rect, edge = b.steps[s.flight].edge;
      const nose = 0.05;
      const sb = edge === 'W' ? { x0: r.x1 - nose, x1: r.x1, z0: r.z0, z1: r.z1 } : edge === 'E' ? { x0: r.x0, x1: r.x0 + nose, z0: r.z0, z1: r.z1 } : edge === 'N' ? { x0: r.x0, x1: r.x1, z0: r.z1 - nose, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z0 + nose };
      slipG.push(boxGeometry(sb.x0, sb.x1, top - 0.003, top + 0.004, sb.z0, sb.z1, TILE_M));
    }

    const add = (list: THREE.BufferGeometry[], m: THREE.Material, name: string, cast = false): THREE.Mesh | null => {
      const g = mergeAndFree(list);
      if (!g) return null;
      const mesh = new THREE.Mesh(g, m);
      mesh.name = name; mesh.userData.outdoor = name; mesh.castShadow = cast; mesh.receiveShadow = true;
      group.add(mesh); free.push(g);
      return mesh;
    };
    add(floorG, floorMat, `pool:${b.id}:floor`);
    add(wallG, wallMat, `pool:${b.id}:walls`);
    add(bandG, bandMat, `pool:${b.id}:band`);
    add(slipG, slipMat, `pool:${b.id}:slip`);
    if (laneGeos.length) { const lm = new THREE.MeshStandardMaterial({ color: '#1E2F44', roughness: 0.5 }); free.push(lm); add(laneGeos, makeUnderwater(lm, u, tier, ultra), `pool:${b.id}:lanes`); }

    // coping: a stone ring round the basin, a little proud of the deck, with the numerals of the depth let into it
    const cm = b.copingM;
    const stone = mats.ground('paving', { colour: '#DDD2BC' });
    const cop: THREE.BufferGeometry[] = [];
    for (const r of copingRects(b, ex)) cop.push(boxGeometry(r.x0, r.x1, 0, 0.03, r.z0, r.z1, 1.2));
    add(cop, stone, `pool:${b.id}:coping`, true);
    if (b.markers) {
      const stations = markerStations(b);
      // numerals sit in the coping of the long sides (the two that run along the depth axis), where that stretch meets the deck
      const longSides: Side[] = alongX ? ['N', 'S'] : ['W', 'E'];
      for (const st of stations) {
        const tex = numeralTexture(st.label);
        for (const side of longSides) {
          const p = pt(st.u, side === 'N' || side === 'W' ? 0 : 1);
          const t = alongX ? p.x - R.x0 : p.z - R.z0;
          if (!isExposedAt(ex, side, t)) continue;
          const q = alongX ? { x: p.x, z: p.z + (side === 'N' ? -cm / 2 : cm / 2) } : { x: p.x + (side === 'W' ? -cm / 2 : cm / 2), z: p.z };
          const plane = new THREE.PlaneGeometry(0.34, 0.13).rotateX(-Math.PI / 2);
          if (!alongX) plane.rotateY(Math.PI / 2);
          plane.translate(q.x, 0.032, q.z);
          const m = new THREE.MeshStandardMaterial({ map: tex ?? undefined, color: tex ? '#ffffff' : '#1E5F8C', roughness: 0.6 });
          free.push(m, plane); if (tex) free.push(tex);
          const mesh = new THREE.Mesh(plane, m); mesh.name = `pool:${b.id}:numeral`; mesh.userData.outdoor = mesh.name; mesh.receiveShadow = true;
          group.add(mesh);
        }
      }
    }

    // ladders: two stainless rails curving over the coping, two rungs under the water
    const chrome = new THREE.MeshStandardMaterial({ color: '#D2D6D9', roughness: 0.28, metalness: 0.85, name: 'outdoor-chrome' });
    free.push(chrome);
    const rails: THREE.BufferGeometry[] = [];
    for (const l of b.ladders) rails.push(...ladderGeos(b, l.edge, l.atM, wl, ultra));
    add(rails, chrome, `pool:${b.id}:ladders`, true);

    // pool lights: a pale lamp in each long wall every 3 m, lit at night (driven in sync(), not tagged for the look's pooled lamps)
    const lampMat = new THREE.MeshStandardMaterial({ color: '#6F98A6', emissive: '#7FE0F0', emissiveIntensity: 0, roughness: 0.5 });
    free.push(lampMat);
    const lg: THREE.BufferGeometry[] = [];
    const nl = Math.max(1, Math.round(((alongX ? R.x1 - R.x0 : R.z1 - R.z0)) / 3.2));
    for (let i = 0; i < nl && !b.kids; i++) {
      const u = (i + 0.5) / nl;
      const p = pt(u, 0);
      const q = pt(u, 1);
      // lamps are let into the two long walls, on the stretches that meet the deck (the lamp faces are on the z walls of an x-run pool)
      const sideA: Side = alongX ? 'N' : 'W', sideB: Side = alongX ? 'S' : 'E';
      if (alongX && isExposedAt(ex, sideA, p.x - R.x0)) lg.push(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10).rotateX(Math.PI / 2).translate(p.x, wl - 0.55, p.z + 0.015));
      if (alongX && isExposedAt(ex, sideB, q.x - R.x0)) lg.push(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10).rotateX(Math.PI / 2).translate(q.x, wl - 0.55, q.z - 0.015));
      if (!alongX && isExposedAt(ex, sideA, p.z - R.z0)) lg.push(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10).rotateZ(Math.PI / 2).translate(p.x + 0.015, wl - 0.55, p.z));
      if (!alongX && isExposedAt(ex, sideB, q.z - R.z0)) lg.push(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10).rotateZ(Math.PI / 2).translate(q.x - 0.015, wl - 0.55, q.z));
    }
    const lampMesh = add(lg, lampMat, `pool:${b.id}:lights`);
    if (lampMesh) lights.push(lampMesh);

    // the water: a plane over the basin at the water level
    const wsurf = makeWaterSurface(u, tier, ultra);
    surfaces.push(wsurf);
    free.push(wsurf);
    const wgeo = flatGeometry([{ x: R.x0, z: R.z0 }, { x: R.x1, z: R.z0 }, { x: R.x1, z: R.z1 }, { x: R.x0, z: R.z1 }], undefined, wl, 1);
    free.push(wgeo);
    const water = new THREE.Mesh(wgeo, wsurf);
    water.name = `pool:${b.id}:water`; water.userData.outdoor = water.name; water.renderOrder = 2; water.castShadow = false; water.receiveShadow = false;
    group.add(water); waters.push(water);
  }
  /** 2K: the water mirrors the room probe's picture (the surroundings with the sky and its clouds), with the cube-UV constants of that texture */
  const syncProbe = (lk: Look | null): void => {
    if (!ultra || !lk) return;
    const probe = lk.premiumProbe();
    const h = (probe as (THREE.Texture & { image?: { height?: number } }) | null)?.image?.height;
    for (const u of uniforms) { u.uProbeMap.value = probe; u.uProbeOn.value = probe && h ? 1 : 0; }
    if (probe && h) for (const m of surfaces) { const d = cubeUvDefines(h); if (m.defines.CUBEUV_MAX_MIP !== d.CUBEUV_MAX_MIP) { m.defines = d; m.needsUpdate = true; } }
  };
  let clock = 0;
  return {
    group, waters,
    update(dt) { clock += dt; for (const u of uniforms) u.uTime.value = clock; syncProbe(look); },
    sync(lk) {
      if (!lk) return;
      const g = lk.grade();
      const lamp = lk.trueColours ? 0 : Math.max(g.interior.tube, g.interior.cove);
      for (const u of uniforms) syncWaterUniforms(u, g, lk.sun(), lamp);
      syncProbe(lk);
      for (const l of lights) (l.material as THREE.MeshStandardMaterial).emissiveIntensity = lamp * 2.2;
    },
    dispose() { for (const f of free) f.dispose(); group.removeFromParent(); },
  };
}

function expand(r: Rect, m: number): Rect { return { x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m }; }
function alongU(b: PoolBasin, p: { x: number; z: number }): number {
  const r = b.rect;
  switch (b.shallowEnd) {
    case 'W': return (p.x - r.x0) / (r.x1 - r.x0);
    case 'E': return (r.x1 - p.x) / (r.x1 - r.x0);
    case 'N': return (p.z - r.z0) / (r.z1 - r.z0);
    case 'S': return (r.z1 - p.z) / (r.z1 - r.z0);
  }
}

/** two handrails (each a path of tubes: up from the deck, over the coping, down into the water) and two rungs */
function ladderGeos(b: PoolBasin, edge: Side, at: number, wl: number, ultra = false): THREE.BufferGeometry[] {
  const R = b.rect;
  const out: THREE.BufferGeometry[] = [];
  const inw = edge === 'N' ? { x: 0, z: 1 } : edge === 'S' ? { x: 0, z: -1 } : edge === 'W' ? { x: 1, z: 0 } : { x: -1, z: 0 };
  const base = edge === 'N' ? { x: R.x0 + at, z: R.z0 } : edge === 'S' ? { x: R.x0 + at, z: R.z1 } : edge === 'W' ? { x: R.x0, z: R.z0 + at } : { x: R.x1, z: R.z0 + at };
  const tang = { x: -inw.z, z: inw.x };
  const half = 0.28;
  const P = (o: number, s: number, y: number): THREE.Vector3 => new THREE.Vector3(base.x + inw.x * o + tang.x * s, y, base.z + inw.z * o + tang.z * s);
  const path: [number, number][] = [[-b.copingM - 0.1, 0.0], [-b.copingM - 0.1, 0.55], [-0.1, 0.62], [0.12, 0.45], [0.2, wl - 0.0 - 0.55 + 0.0]];
  for (const s of [-half, half]) {
    if (ultra) {
      // 2K: each handrail is one smooth stainless tube (up from the deck, over the coping, down into the water), not five rods with open corners
      const pts = path.map((q) => P(q[0], s, q[1]));
      out.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 48, 0.022, 20, false).toNonIndexed());
      continue;
    }
    for (let i = 1; i < path.length; i++) {
      const a = P(path[i - 1][0], s, path[i - 1][1] + (i === path.length - 1 ? 0 : 0)), c = P(path[i][0], s, path[i][1]);
      const dir = c.clone().sub(a);
      const len = dir.length();
      const g = new THREE.CylinderGeometry(0.022, 0.022, len, 8).toNonIndexed();
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
      g.translate((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2);
      out.push(g);
    }
  }
  for (const y of [wl - 0.22, wl - 0.52]) out.push(segmentBox({ x: P(0.2, -half, 0).x, z: P(0.2, -half, 0).z }, { x: P(0.2, half, 0).x, z: P(0.2, half, 0).z }, 0.12, y - 0.015, y + 0.015, 0, 1));
  void tube;
  return out;
}
