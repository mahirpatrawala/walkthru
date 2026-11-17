// Decor generators: things that make a room read as designed but are not facts about the property (SPEC 16.13). Curtains and their
// track, a rug, a split AC, recessed downlights, brass bowl wall lights, wall panelling with fine grooves, a slatted feature wall and a
// ceiling band. Every one is built in a WALL FRAME (x along the wall from its start, y up from the floor, z out of the wall into the
// room) or a FLOOR FRAME (rug); the mount code places the frame. All of it is decor: no collision, no measurement, no ray.
import * as THREE from 'three';
import { Parts, role, shade } from './core';
import type { GenEnv, Roles } from './core';
import { roundedBoxBetween } from '../furniture-parts';
import { prism, roundedRectOutline, rod } from './geo';

/** a wall-frame fixture kind and the light tag it carries, if any */
export type LightTag = 'lamp';

// ---------------------------------------------------------------- curtains

export interface CurtainParams {
  /** the width the curtains cover (a window plus margin each side) */
  widthM: number;
  /** floor to track */
  heightM: number;
  /** height of the track above the floor */
  trackYM: number;
  /** a sheer behind the drape */
  sheer: boolean;
  /** the sheer hangs closed across the whole window (the old look); default false: drawn open, gathered at the sides */
  sheerClosed?: boolean;
  /** drape panels: at both ends of the track, one end, or none */
  drape: 'sides' | 'left' | 'right' | 'none';
  /** how much of the track each drape panel covers when drawn back */
  drapeWidthM: number;
  /** the fold period of the cloth */
  foldM: number;
}
export const CURTAIN_DEFAULTS: CurtainParams = { widthM: 2, heightM: 2.5, trackYM: 2.55, sheer: true, drape: 'sides', drapeWidthM: 0.55, foldM: 0.13 };

/** a curtain panel: cloth from x0 to x1, y0 to y1, folded in waves of `amp` / `fold`, standing at z */
function clothPanel(x0: number, x1: number, y0: number, y1: number, z: number, amp: number, fold: number, nx: number, phase: number): THREE.BufferGeometry {
  const cols = Math.max(4, Math.round(((x1 - x0) / fold) * nx));
  const rows = 6;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [], col: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const ty = j / rows;
    const y = y0 + ty * (y1 - y0);
    for (let i = 0; i <= cols; i++) {
      const x = x0 + (i / cols) * (x1 - x0);
      const a = ((x - x0) / fold) * Math.PI * 2 + phase;
      // folds fall deeper toward the hem and ripple a little along the height
      const k = amp * (0.75 + 0.25 * (1 - ty)) * (1 + 0.06 * Math.sin(ty * 7 + phase));
      pos.push(x, y, z + k * Math.sin(a));
      const slope = (k * Math.cos(a) * Math.PI * 2) / fold;
      const l = Math.hypot(slope, 1);
      nor.push(-slope / l, 0, 1 / l);
      uv.push(x, y);
      // the troughs of the folds are darker than the crests: shading painted into the vertices, so it reads under flat light too
      const sh = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(a)) - 0.06 * ty;
      col.push(sh, sh, sh);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** the pleat period and depth of a gathered sheer, and how many vertices one pleat gets per tier (two is a crisp zigzag: crest, trough) */
export const SHEER_PLEAT_M = 0.048;
export const SHEER_PLEAT_DEPTH_M = 0.014;
const SHEER_SAMPLES: Record<string, number> = { low: 2, medium: 6, high: 8 };

/**
 * A gathered sheer (round 5): a panel of fine pleats, floor to track, that reads as thin cloth and not as a column. What makes it cloth:
 * the pleats are sampled finely enough to be pleats (the old panel put fewer than one vertex on a 7 cm fold, so a 50 cm stack came out as
 * two or three fat flutes); the cloth is see-through, more where it faces you and less on the flanks of a pleat, where you look along it;
 * its shading is nearly flat (light goes through a sheer, so a pleat has no dark side); and its free edge thins out over the last pleat
 * instead of ending in a hard line. `free` is the edge that hangs loose towards the glass.
 */
function sheerPanel(x0: number, x1: number, y0: number, y1: number, z: number, tier: string, free: 'left' | 'right' | 'none', phase: number): THREE.BufferGeometry {
  const per = SHEER_SAMPLES[tier] ?? 6;
  const pleats = Math.max(3, Math.round((x1 - x0) / SHEER_PLEAT_M));
  const cols = pleats * per;
  const rows = tier === 'low' ? 2 : 5;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [], col: number[] = [];
  const W = x1 - x0;
  const smooth = (t: number): number => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
  for (let j = 0; j <= rows; j++) {
    const ty = j / rows;
    const y = y0 + ty * (y1 - y0);
    for (let i = 0; i <= cols; i++) {
      const tx = i / cols;
      const x = x0 + tx * W;
      // a quarter turn in, so the two-vertex pleat of the low tier lands on crest and trough
      const a = (i / per) * Math.PI * 2 + Math.PI / 2;
      // how far this point is from the free edge, in metres (the loose edge hangs flatter and thinner)
      const edge = free === 'left' ? x - x0 : free === 'right' ? x1 - x : Infinity;
      const loose = smooth(edge / (SHEER_PLEAT_M * 1.5));
      // pleats are pinched at the track and open a little towards the hem; a slow sway keeps the hem from being a ruled line
      const k = SHEER_PLEAT_DEPTH_M * (0.7 + 0.3 * (1 - ty)) * (0.45 + 0.55 * loose);
      const sway = 0.006 * (1 - ty) * Math.sin(x * 3.1 + phase);
      pos.push(x, y, z + k * Math.sin(a) + sway);
      const slope = (k * Math.cos(a) * Math.PI * 2) / SHEER_PLEAT_M;
      // light passes through a sheer: the shading normal leans only a third of the way into the pleat
      const nx = -slope * 0.33, l = Math.hypot(nx, 1);
      nor.push(nx / l, 0, 1 / l);
      uv.push(x, y);
      const flank = Math.abs(Math.cos(a));
      // a faint tone in the troughs, and the cloth a touch denser at the gathered top
      const sh = 0.95 + 0.05 * (0.5 + 0.5 * Math.sin(a));
      const alpha = (0.7 + 0.2 * flank + 0.06 * ty) * (0.3 + 0.7 * loose);
      col.push(sh, sh, sh, Math.min(1, alpha));
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** how wide each gathered sheer stack is on a track of this width (the track runs 25 cm past the window each side) */
export function sheerGatherM(trackWidthM: number): number {
  return Math.min(trackWidthM / 2 - 0.1, Math.max(0.32, 0.25 + 0.14 * Math.max(0, trackWidthM - 0.5)));
}

export function buildCurtain(env: GenEnv, p: CurtainParams, roles: Roles): THREE.Group {
  const parts = new Parts(env, 'gen:curtain');
  const q = env.q;
  const sheer = role(roles, 'curtainSheer'), drape = role(roles, 'curtainDrape'), track = role(roles, 'handle');
  const y0 = 0.02, y1 = p.trackYM - 0.04;
  // vertices per fold: a fold needs at least four to be a fold (below two per fold the wave aliases into a few fat flutes)
  const density = q.tier === 'low' ? 4 : q.tier === 'medium' ? 6 : 8;
  parts.put('curtain-track', track, rod({ x: -0.03, y: p.trackYM, z: 0.05 }, { x: p.widthM + 0.03, y: p.trackYM, z: 0.05 }, 0.012, 6), { noShadow: true });
  if (p.sheer && p.sheerClosed) {
    parts.put('curtain-sheer', sheer, clothPanel(0, p.widthM, y0, y1, 0.07, 0.045, p.foldM * 0.8, density, 0.3), { uv: 'keep', noShadow: true });
  } else if (p.sheer) {
    // drawn open: two finely pleated panels gathered at the sides of the window, the glass between them clear. The track runs 25 cm past
    // the window each side (design-mount), so a stack covers that margin and the edge of the glass.
    const gather = sheerGatherM(p.widthM);
    if (p.drape !== 'right') parts.put('curtain-sheer', sheer, sheerPanel(0, gather, y0, y1, 0.06, q.tier, 'right', 0.3), { uv: 'keep', noShadow: true });
    if (p.drape !== 'left') parts.put('curtain-sheer', sheer, sheerPanel(p.widthM - gather, p.widthM, y0, y1, 0.06, q.tier, 'left', 1.9), { uv: 'keep', noShadow: true });
  }
  const dw = Math.min(p.drapeWidthM, p.widthM / 2 - 0.05);
  if (p.drape !== 'none' && dw > 0.1) {
    if (p.drape === 'sides' || p.drape === 'left') parts.put('curtain-drape', drape, clothPanel(0, dw, y0, y1, 0.12, 0.06, p.foldM, density, 0), { uv: 'keep', noShadow: true });
    if (p.drape === 'sides' || p.drape === 'right') parts.put('curtain-drape', drape, clothPanel(p.widthM - dw, p.widthM, y0, y1, 0.12, 0.06, p.foldM, density, 1.1), { uv: 'keep', noShadow: true });
  }
  if (q.ultra) {
    // 2K: the heading: a ring on the track every 9 cm along each gathered panel, brass-dark like the track, so the cloth hangs from something
    const ringAt = (x0: number, x1: number): void => {
      for (let x = x0 + 0.03; x <= x1 - 0.02; x += 0.09) parts.put('curtain-track', track, new THREE.TorusGeometry(0.017, 0.0028, 8, 20).rotateY(Math.PI / 2).translate(x, p.trackYM, 0.05), { noShadow: true });
    };
    if (p.drape !== 'none' && dw > 0.1) {
      if (p.drape === 'sides' || p.drape === 'left') ringAt(0, dw);
      if (p.drape === 'sides' || p.drape === 'right') ringAt(p.widthM - dw, p.widthM);
    }
  }
  const g = parts.done();
  // drawn after the kit's window mesh veil (renderOrder 3), so a sheer closes the window over the grill instead of under it
  // a sheer is light, not mass: the bake neither shades it with an AO of its own (which painted every pleat dark) nor lets it shade the room
  g.traverse((o) => { if (o.name === 'curtain-sheer') { o.renderOrder = 5; o.userData.walkthruBake = 'skip'; } });
  return g;
}

// ---------------------------------------------------------------- rug

export interface RugParams {
  widthM: number;
  depthM: number;
  /** pile height */
  pileM: number;
  /** corner radius */
  radiusM: number;
}
export const RUG_DEFAULTS: RugParams = { widthM: 2, depthM: 1.6, pileM: 0.025, radiusM: 0.06 };

/** a rug lying on the floor, centred on its origin; its top is `pileM` above the floor */
export function buildRug(env: GenEnv, p: RugParams, roles: Roles): THREE.Group {
  const parts = new Parts(env, 'gen:rug');
  const named = role(roles, 'rug');
  const rug = named.key === 'weave' ? { ...named, key: 'rug' as const } : named; // a woven rug is a finer, deeper pile than upholstery
  const w = p.widthM, d = p.depthM;
  const seg = env.q.tier === 'low' ? 3 : 6;
  // a bordered rug: a darker outer band and the field inset 7 cm and 3 mm proud of it
  const bordered = w > 1.0 && d > 0.9 && !!rug.tint;
  parts.put('rug', bordered ? shade(rug, 0.8) : rug, prism(roundedRectOutline(-w / 2, w / 2, -d / 2, d / 2, [p.radiusM, p.radiusM, p.radiusM, p.radiusM], seg), 0, p.pileM, Math.min(0.012, p.pileM * 0.5)), { noShadow: true });
  if (bordered) {
    const m = 0.07, r2 = Math.max(0.02, p.radiusM - 0.03);
    parts.put('rug-field', rug, prism(roundedRectOutline(-w / 2 + m, w / 2 - m, -d / 2 + m, d / 2 - m, [r2, r2, r2, r2], seg), 0, p.pileM + 0.003, Math.min(0.01, p.pileM * 0.4)), { noShadow: true });
  }
  return parts.done();
}

// ---------------------------------------------------------------- split AC

export function buildAc(env: GenEnv, roles: Roles): THREE.Group {
  const parts = new Parts(env, 'gen:ac');
  const white = role(roles, 'acBody'), dark = role(roles, 'plinth', 'handle');
  const w = 0.9, h = 0.29, d = 0.2;
  // origin at the middle of the unit's back, on the wall
  parts.put('ac-body', white, roundedBoxGeo(-w / 2, w / 2, -h / 2, h / 2, 0, d, 0.05));
  // the louvre slot along the underside and the front, and a small display
  parts.box('ac-vent', dark, -w / 2 + 0.05, w / 2 - 0.05, -h / 2 + 0.012, -h / 2 + 0.04, d - 0.03, d + 0.001, { c: 0 });
  parts.box('ac-vent', dark, w / 2 - 0.12, w / 2 - 0.08, h / 2 - 0.1, h / 2 - 0.085, d - 0.004, d + 0.001, { c: 0 });
  return parts.done();
}
function roundedBoxGeo(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number): THREE.BufferGeometry {
  return roundedBoxBetween(x0, x1, y0, y1, z0, z1, r, 2);
}

// ---------------------------------------------------------------- downlights and bowl lights

/** recessed downlights flush with a ceiling at `yCeil`: a white trim ring and a glowing lens (tagged for the look) at each point */
export function buildDownlights(env: GenEnv, points: [number, number][], yCeil: number, roles: Roles): THREE.Group {
  const parts = new Parts(env, 'gen:downlights');
  const trim = role(roles, 'acBody'), lens = role(roles, 'lamp');
  const sides = env.q.tier === 'low' ? 8 : 16;
  for (const [x, z] of points) {
    const ring = new THREE.CylinderGeometry(0.056, 0.056, 0.006, sides, 1);
    ring.translate(x, yCeil - 0.003, z);
    parts.put('downlight-trim', trim, ring, { noShadow: true });
    const disc = new THREE.CylinderGeometry(0.043, 0.043, 0.004, sides, 1);
    disc.translate(x, yCeil - 0.007, z);
    parts.put('downlight-lens', lens, disc, { noShadow: true });
  }
  const g = parts.done();
  g.traverse((o) => { if (o.name === 'downlight-lens') o.userData.walkthruLight = 'lamp'; });
  g.userData.walkthruLight = 'lamp';
  return g;
}

/** brass bowl wall lights, `xs` along the wall at height `y`: a bowl open to the room with a glowing disc inside */
export function buildBowlLights(env: GenEnv, xs: number[], y: number, roles: Roles): THREE.Group {
  const parts = new Parts(env, 'gen:bowl-lights');
  const brass = role(roles, 'lampMetal'), lens = role(roles, 'lamp');
  const R = 0.1, depth = 0.07;
  const prof: THREE.Vector2[] = [];
  const steps = env.q.tier === 'low' ? 4 : 8;
  // a shallow bowl: from the rim in to the centre of the back, thickness 4 mm
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * (Math.PI / 2); prof.push(new THREE.Vector2(R * Math.cos(a) + 0.004, depth * (1 - Math.sin(a)))); }
  for (let i = steps; i >= 0; i--) { const a = (i / steps) * (Math.PI / 2); prof.push(new THREE.Vector2(R * Math.cos(a), depth * (1 - Math.sin(a)) + 0.004 * 0)); }
  for (const x of xs) {
    const lathe = new THREE.LatheGeometry(prof, env.q.tier === 'low' ? 10 : 20);
    // lathe axis is y; turn it so the bowl's opening faces +z (into the room), its back toward the wall
    lathe.rotateX(Math.PI / 2);
    lathe.translate(x, y, depth + 0.012);
    parts.put('bowl-shell', brass, lathe, { noShadow: true, double: true });
    const disc = new THREE.CylinderGeometry(R * 0.72, R * 0.72, 0.004, 16, 1);
    disc.rotateX(Math.PI / 2);
    disc.translate(x, y, depth * 0.55 + 0.012);
    parts.put('bowl-lens', lens, disc, { noShadow: true });
  }
  const g = parts.done();
  g.traverse((o) => { if (o.name === 'bowl-lens') o.userData.walkthruLight = 'lamp'; });
  g.userData.walkthruLight = 'lamp';
  return g;
}

// ---------------------------------------------------------------- wall treatments

export interface PanellingParams {
  widthM: number;
  y0M: number;
  y1M: number;
  /** distance between the groove lines */
  pitchM: number;
  /** width of each groove */
  grooveM: number;
  /** panel height of each tier, 0 = one tier */
  tierM: number;
}
export const PANELLING_DEFAULTS: PanellingParams = { widthM: 3, y0M: 0.1, y1M: 2.4, pitchM: 0.6, grooveM: 0.012, tierM: 0 };

/** wall panelling: raised boards with fine grooves between them, in the paint finish. z = 0 is the wall face, boards stand 14 mm out. */
export function buildPanelling(env: GenEnv, p: PanellingParams, roles: Roles): THREE.Group {
  const parts = new Parts(env, 'gen:panelling');
  const paint = role(roles, 'wallPanel', 'wall');
  const n = Math.max(1, Math.round(p.widthM / p.pitchM));
  const bw = p.widthM / n;
  const t = 0.014;
  const tiers = p.tierM > 0.3 ? Math.max(1, Math.round((p.y1M - p.y0M) / p.tierM)) : 1;
  const th = (p.y1M - p.y0M) / tiers;
  for (let r = 0; r < tiers; r++) {
    const ya = p.y0M + r * th, yb = ya + th;
    for (let i = 0; i < n; i++) {
      const xa = i * bw + p.grooveM / 2, xb = (i + 1) * bw - p.grooveM / 2;
      parts.box('wall-panels', paint, xa, xb, ya + (r ? p.grooveM / 2 : 0), yb - (r < tiers - 1 ? p.grooveM / 2 : 0), 0, t, { c: 0.0025, noShadow: true });
    }
  }
  return parts.done();
}

export interface SlatWallParams {
  widthM: number;
  y0M: number;
  y1M: number;
  pitchM: number;
  /** slat width (face) and depth (out of the wall) */
  slatM: number;
  depthM: number;
}
export const SLAT_WALL_DEFAULTS: SlatWallParams = { widthM: 2.5, y0M: 0, y1M: 2.6, pitchM: 0.045, slatM: 0.03, depthM: 0.024 };

/** a slatted feature wall: vertical slats over a dark backing, so the gaps read as shadow lines. z = 0 is the wall face. */
export function buildSlatWall(env: GenEnv, p: SlatWallParams, roles: Roles): THREE.Group {
  const parts = new Parts(env, 'gen:slat-wall');
  const wood = role(roles, 'slats', 'case'), back = role(roles, 'slatBack', 'handle');
  parts.box('slat-backing', back, 0, p.widthM, p.y0M, p.y1M, 0, 0.012, { c: 0, noShadow: true });
  const n = Math.max(1, Math.floor(p.widthM / p.pitchM));
  const off = (p.widthM - n * p.pitchM) / 2 + (p.pitchM - p.slatM) / 2;
  for (let i = 0; i < n; i++) {
    const x = off + i * p.pitchM;
    parts.box('wall-slats', wood, x, x + p.slatM, p.y0M, p.y1M, 0.012, 0.012 + p.depthM, { c: 0.002 });
  }
  return parts.done();
}

export interface CeilingBandParams { widthM: number; depthM: number; dropM: number }
/** a slab hung `dropM` below the ceiling (wood): x 0..widthM, z 0..depthM seen from above, y down from the ceiling at y = 0 */
export function buildCeilingBand(env: GenEnv, p: CeilingBandParams, roles: Roles): THREE.Group {
  const parts = new Parts(env, 'gen:ceiling-band');
  const wood = role(roles, 'slats', 'case');
  parts.box('ceiling-band', wood, 0, p.widthM, -p.dropM, 0, 0, p.depthM, { c: 0.004, grain: 'x', noShadow: true });
  return parts.done();
}
