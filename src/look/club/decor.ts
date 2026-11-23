// Sample decor of a building's shared spaces (SPEC 16.17.3): ceiling light fittings, framed wall art and a games room's dartboard, so a
// clubhouse room does not read as an empty box. None of it is on the plan, so it is labelled (CLUB_DECOR_LABEL, the rooms sheet's decor note,
// SPEC 16.2 rule 4), it is never in the walking grid, no ray can hit it (no measurement, no click), and it never moves a piece of furniture.
//
// The plan is a pure function of the layout, the pieces and the space's kind (planClubDecor). The fittings that are downloaded models (a globe
// pendant, a chandelier, the dartboard: Poly Haven, CC0) are swapped in when they arrive; until then, and with `?models=off`, a simple drawn
// fitting stands in. A gym's linear lights are drawn here. The wall art is a framed reproduction of a public-domain painting (SPEC 16.17.4:
// The Met's Open Access images, CC0, public/look/club/art, listed in art.lock.json), fitted inside its mount; until the picture arrives, if
// it cannot be had, or under Node, a generated colour field stands in.
import * as THREE from 'three';
import type { FurnitureItem, Layout, RoomTag, Vec2 } from '../../types';
import type { Tier } from '../types';
import { loadProp, propInfo } from '../gym/props';
import type { PropGeo, PropKind } from '../gym/props';
import { modelsEnabled } from '../models/library';
import { boxCorners } from '../../core/geometry';

/** SPEC 16.2 rule 4: the fixed label of this decor, shown in the rooms sheet while it is up */
export const CLUB_DECOR_LABEL = 'Ceiling lights and wall art are sample decor, not from the plan.';
/** the label where the space's design sheet also gives a sample wall finish (the changing rooms' glazed wall tile, SPEC 16.17.4) */
export const CLUB_DECOR_TILE_LABEL = 'Ceiling lights and wall tiles are sample decor, not from the plan.';

/** SPEC 16.17.4: the pictures (public/look/club/art, CC0 reproductions from The Met's Open Access, credited in art/art.lock.json) and their aspect */
export const CLUB_ART: { id: string; aspect: number }[] = [
  { id: 'olive-trees', aspect: 1.2533 },
  { id: 'pool-jas-de-bouffan', aspect: 1.2459 },
  { id: 'oleanders', aspect: 1.2179 },
  { id: 'wheat-field', aspect: 1.2636 },
  { id: 'forest-pontaubert', aspect: 0.7983 },
  { id: 'cypresses', aspect: 0.7931 },
];
export const clubArtUrl = (id: string, tier: Tier): string => `/look/club/art/${id}${tier === 'low' ? '.low' : ''}.webp`;

export type ClubDecorKind = 'pendant' | 'chandelier' | 'batten' | 'art' | 'dartboard';
export interface ClubDecorPiece {
  kind: ClubDecorKind;
  /** centre, world metres: x, z on the floor plan; y is the fitting's top (ceiling pieces) or the centre (wall pieces) */
  x: number; y: number; z: number;
  /** ceiling pieces: along which axis a long fitting runs; wall pieces: the heading the face looks along (into the room) */
  yawDeg: number;
  /** wall pieces: width and height of the picture; a batten's length */
  w: number; h: number;
  seed: number;
  /** a picture: which of CLUB_ART hangs in the frame (landscape in a landscape frame, portrait in a portrait one) */
  art?: string;
}

/** the shared kinds that get decor: a gym (lights only), a games room, a hall or lounge, a lobby, a corridor or foyer */
const KINDS = new Set(['gym', 'games', 'hall', 'lobby', 'corridor']);

// ---------------------------------------------------------------- geometry of a room

function inside(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}
/** distance from p to the polygon's nearest edge */
function edgeDist(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)));
  }
  return best;
}
const boundsOf = (poly: Vec2[]): { x0: number; x1: number; z0: number; z1: number } => ({
  x0: Math.min(...poly.map((p) => p.x)), x1: Math.max(...poly.map((p) => p.x)), z0: Math.min(...poly.map((p) => p.z)), z1: Math.max(...poly.map((p) => p.z)),
});
/** a piece's footprint corners */
const corners = (f: FurnitureItem): Vec2[] => boxCorners(f.box);
const near = (f: FurnitureItem, p: Vec2, r: number): boolean => corners(f).some((q) => Math.hypot(q.x - p.x, q.z - p.z) < r) || Math.hypot(f.box.cx - p.x, f.box.cz - p.z) < r + Math.max(f.box.w, f.box.d) / 2;

/** points on a grid over the room, `step` apart, at least `inset` from every wall */
function grid(poly: Vec2[], step: number, inset: number): Vec2[] {
  const b = boundsOf(poly);
  const nx = Math.max(1, Math.round((b.x1 - b.x0 - 2 * inset) / step) + 1), nz = Math.max(1, Math.round((b.z1 - b.z0 - 2 * inset) / step) + 1);
  const sx = nx > 1 ? (b.x1 - b.x0 - 2 * inset) / (nx - 1) : 0, sz = nz > 1 ? (b.z1 - b.z0 - 2 * inset) / (nz - 1) : 0;
  const out: Vec2[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const p = { x: nx > 1 ? b.x0 + inset + i * sx : (b.x0 + b.x1) / 2, z: nz > 1 ? b.z0 + inset + j * sz : (b.z0 + b.z1) / 2 };
    if (inside(p, poly) && edgeDist(p, poly) >= inset * 0.8) out.push(p);
  }
  return out;
}

/** the free runs of one wall (inside face): clear of its openings by `margin` and of tall pieces standing against it */
function freeRuns(room: RoomTag, edge: number, layout: Layout, furniture: FurnitureItem[], margin: number): { a: Vec2; dir: Vec2; inward: Vec2; t0: number; t1: number }[] {
  const a = room.polygon[edge], b = room.polygon[(edge + 1) % room.polygon.length];
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  if (L < 0.5) return [];
  const dir = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
  let inward = { x: -dir.z, z: dir.x };
  const mid = { x: (a.x + b.x) / 2 + inward.x * 0.05, z: (a.z + b.z) / 2 + inward.z * 0.05 };
  if (!inside(mid, room.polygon)) inward = { x: dir.z, z: -dir.x };
  const blocked: [number, number][] = [];
  for (const o of layout.openings) if (o.roomId === room.id && o.edge === edge) blocked.push([o.centreM - o.widthM / 2 - margin, o.centreM + o.widthM / 2 + margin]);
  // a piece that stands against this wall and reaches the picture's height (a mirror, lockers, a screen, a notice board) takes its run
  for (const f of furniture) {
    if (f.heightM < 1.1) continue;
    const cs = corners(f);
    const off = cs.map((q) => (q.x - a.x) * inward.x + (q.z - a.z) * inward.z);
    if (Math.min(...off) > 0.7) continue;
    const ts = cs.map((q) => (q.x - a.x) * dir.x + (q.z - a.z) * dir.z);
    blocked.push([Math.min(...ts) - 0.2, Math.max(...ts) + 0.2]);
  }
  blocked.sort((p, q) => p[0] - q[0]);
  const runs: { a: Vec2; dir: Vec2; inward: Vec2; t0: number; t1: number }[] = [];
  let t = 0.3;
  for (const [s, e] of blocked) { if (s > t) runs.push({ a, dir, inward, t0: t, t1: Math.min(s, L - 0.3) }); t = Math.max(t, e); }
  if (L - 0.3 > t) runs.push({ a, dir, inward, t0: t, t1: L - 0.3 });
  return runs.filter((r) => r.t1 - r.t0 > 0.2);
}

// ---------------------------------------------------------------- the plan

/**
 * The decor of one shared space: pure, so the same room always gets the same pieces. `kind` is the space's kind (`gym`, `games`, `hall`,
 * `lobby`, `corridor`); any other kind (a home, an open-air space) gets nothing.
 */
export function planClubDecor(layout: Layout, furniture: FurnitureItem[], kind: string): ClubDecorPiece[] {
  if (!KINDS.has(kind)) return [];
  const ceil = layout.wallHeightM;
  const out: ClubDecorPiece[] = [];
  let seed = 1;
  const hasCafe = furniture.some((f) => f.catalogId === 'hall-cafe-set-2');
  for (const room of layout.rooms) {
    const poly = room.polygon;
    const b = boundsOf(poly);
    const along = b.x1 - b.x0 >= b.z1 - b.z0 ? 90 : 0; // the long axis
    // ---- the ceiling
    if (kind === 'gym') {
      // linear LED fittings in rows down the room's length, 2.4 m apart (a changing room gets its own short row)
      for (const p of grid(poly, 2.4, 1.0)) out.push({ kind: 'batten', x: p.x, y: ceil, z: p.z, yawDeg: along, w: 1.2, h: 0.06, seed: seed++ });
    } else if (kind === 'hall' && !hasCafe) {
      // a banquet hall: chandeliers down the middle, one for about every 30 m2 (the pendant fittings stay 2.8 m clear of the floor)
      const long = Math.max(b.x1 - b.x0, b.z1 - b.z0), n = Math.max(1, Math.round((long * Math.min(b.x1 - b.x0, b.z1 - b.z0)) / 30));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const p = along === 90 ? { x: b.x0 + t * (b.x1 - b.x0), z: (b.z0 + b.z1) / 2 } : { x: (b.x0 + b.x1) / 2, z: b.z0 + t * (b.z1 - b.z0) };
        if (inside(p, poly)) out.push({ kind: 'chandelier', x: p.x, y: ceil, z: p.z, yawDeg: 0, w: 0.75, h: 0.8, seed: seed++ });
      }
    } else {
      // a lounge, games room, lobby or foyer: a globe pendant over each table that has one (a café table, the pool table along its length, the
      // card and chess tables), and a grid of them elsewhere where nothing is under them
      const tables = furniture.filter((f) => /^(hall-cafe-set|games-card-set|games-chess-set|games-carrom-set|hall-carrom|hall-pool-table|coffee|lobby-visitor-set|lobby-desk)/.test(f.catalogId ?? '') && inside({ x: f.box.cx, z: f.box.cz }, poly));
      const spots: Vec2[] = [];
      for (const f of tables) {
        if (f.catalogId === 'hall-pool-table') {
          const a = (f.box.yawDeg * Math.PI) / 180;
          for (const s of [-0.55, 0.55]) spots.push({ x: f.box.cx + Math.cos(a) * s, z: f.box.cz - Math.sin(a) * s });
        } else spots.push({ x: f.box.cx, z: f.box.cz });
      }
      // a room with tables is lit over them; a room without (a lobby's empty half) gets a sparse grid, 3.6 m apart; a corridor or foyer gets
      // a row down the middle of each of its runs, 3.2 m apart (the points of a fine grid farthest from the walls, taken greedily)
      if (spots.length === 0 && kind === 'corridor') {
        const fine = grid(poly, 0.25, 0.3).map((p) => ({ p, e: edgeDist(p, poly) })).filter((c) => c.e >= 0.9).sort((a, b) => b.e - a.e || a.p.x - b.p.x || a.p.z - b.p.z);
        for (const c of fine) if (!spots.some((q) => Math.hypot(q.x - c.p.x, q.z - c.p.z) < 3.2)) spots.push(c.p);
      } else if (spots.length === 0) for (const p of grid(poly, 3.6, 1.4)) spots.push(p);
      for (const p of spots) out.push({ kind: 'pendant', x: p.x, y: ceil, z: p.z, yawDeg: 0, w: 0.43, h: 0.95, seed: seed++ });
    }
    // ---- the walls (not a gym's: its walls carry mirrors and a gym is not decorated with pictures; not a lobby's: its design already
    // has a feature wall and the plan's art panel, which a print beside them would clutter)
    if (kind === 'gym' || kind === 'lobby') continue;
    const runs = room.polygon.flatMap((_, e) => freeRuns(room, e, layout, furniture, 0.35)).sort((p, q) => (q.t1 - q.t0) - (p.t1 - p.t0));
    let dart = kind === 'games';
    let pictures = 0, artN = 0;
    const maxPictures = Math.max(1, Math.min(4, Math.round((b.x1 - b.x0 + b.z1 - b.z0) / 7)));
    for (const r of runs) {
      const len = r.t1 - r.t0;
      const mid = (r.t0 + r.t1) / 2;
      const at = (t: number, off = 0.0): Vec2 => ({ x: r.a.x + r.dir.x * t + r.inward.x * off, z: r.a.z + r.dir.z * t + r.inward.z * off });
      const yaw = (Math.atan2(r.inward.x, r.inward.z) * 180) / Math.PI;
      if (dart && len >= 1.2) {
        // a dartboard with its centre 1.73 m up and 2.37 m of clear floor in front of it to the throwing line
        const c = at(mid);
        const lane = furniture.some((f) => near(f, at(mid, 1.3), 1.3));
        if (!lane) { out.push({ kind: 'dartboard', x: c.x, y: 1.73, z: c.z, yawDeg: yaw, w: 0.45, h: 0.45, seed: seed++ }); dart = false; continue; }
      }
      if (pictures >= maxPictures || len < 1.4) continue;
      // one framed print, or a pair on a long run, its middle at 1.55 m; landscape on a long run, portrait on a short one
      const pair = len >= 3.4;
      const w = len >= 2.2 ? 1.0 : 0.6, h = len >= 2.2 ? 0.7 : 0.8;
      for (const t of pair ? [mid - 0.62, mid + 0.62] : [mid]) {
        const c = at(t);
        // the picture: the room's next one of the frame's orientation, starting at a place the room's name gives (so two rooms differ)
        const pool = CLUB_ART.filter((a) => (a.aspect >= 1) === (w >= h));
        const art = pool[(hashOf(room.id) + artN++) % pool.length].id;
        out.push({ kind: 'art', x: c.x, y: 1.55, z: c.z, yawDeg: yaw, w, h, seed: seed++, art });
      }
      pictures++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- building it

const mats = {
  alu: () => new THREE.MeshStandardMaterial({ color: '#D9DADC', roughness: 0.45, metalness: 0.6 }),
  /** a white powder-coated fitting body (bare aluminium mirrors a dim room and reads dark) */
  housing: () => new THREE.MeshStandardMaterial({ color: '#EDEDEB', roughness: 0.5, metalness: 0 }),
  diffuser: () => new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.6, emissive: '#FFF4E2', emissiveIntensity: 1.6 }),
  frame: (dark: boolean) => new THREE.MeshStandardMaterial({ color: dark ? '#26272A' : '#B48A5C', roughness: dark ? 0.5 : 0.62, metalness: 0 }),
  mount: () => new THREE.MeshStandardMaterial({ color: '#F3F0EA', roughness: 0.9 }),
  paint: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  opal: () => new THREE.MeshStandardMaterial({ color: '#F6F3EC', roughness: 0.35, emissive: '#FFEBD0', emissiveIntensity: 0.6 }),
  brass: () => new THREE.MeshStandardMaterial({ color: '#B8955A', roughness: 0.35, metalness: 0.8 }),
};
/** muted modern palettes for the prints (an abstract colour-field picture, generated: no artwork of anyone's is copied) */
const PALETTES = [
  ['#E9E0D0', '#C9734F', '#D9B26F', '#2E3A45'],
  ['#ECE6DA', '#3F6F6A', '#A9B7A0', '#C9A27A'],
  ['#EFE9DF', '#B85C4A', '#E0C9A6', '#5B6770'],
  ['#E6E2D8', '#7A8B99', '#D7B98E', '#33363B'],
];
const hashOf = (s: string): number => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
function rand(seed: number): () => number { let s = (seed * 2654435761) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** an abstract print: a ground and three or four soft colour fields and an arc, as vertex-coloured quads (in the picture's own frame, facing +z) */
function painting(w: number, h: number, seed: number): THREE.BufferGeometry {
  const r = rand(seed), pal = PALETTES[seed % PALETTES.length];
  const pos: number[] = [], col: number[] = [];
  const quad = (x0: number, y0: number, x1: number, y1: number, z: number, hex: string): void => {
    const c = new THREE.Color(hex);
    pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
    for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
  };
  quad(-w / 2, -h / 2, w / 2, h / 2, 0, pal[0]);
  const n = 3 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const cw = w * (0.2 + r() * 0.45), ch = h * (0.15 + r() * 0.5);
    const cx = -w / 2 + cw / 2 + r() * (w - cw), cy = -h / 2 + ch / 2 + r() * (h - ch);
    quad(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2, 0.0004 * (i + 1), pal[1 + (i % 3)]);
  }
  // an arc: a half disc in the last colour
  const ar = Math.min(w, h) * (0.18 + r() * 0.12), ax = (r() - 0.5) * w * 0.5, ay = -h / 2;
  const c = new THREE.Color(pal[1 + ((n + 1) % 3)]);
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI, a1 = ((i + 1) / 16) * Math.PI;
    pos.push(ax, ay, 0.003, ax + Math.cos(a0) * ar, ay + Math.sin(a0) * ar, 0.003, ax + Math.cos(a1) * ar, ay + Math.sin(a1) * ar, 0.003);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** the picture's width and height in a frame: the mount's window less nothing, at the artwork's aspect (contain) */
export function artSize(p: ClubDecorPiece): [number, number] {
  const mount = Math.min(p.w, p.h) * 0.09;
  const ww = p.w - 2 * mount, wh = p.h - 2 * mount;
  const a = CLUB_ART.find((x) => x.id === p.art)?.aspect ?? ww / wh;
  const pw = Math.min(ww, wh * a);
  return [pw, pw / a];
}

/** puts a loaded picture in place of a frame's stand-in colour field */
function hangPicture(g: THREE.Group, tex: THREE.Texture): void {
  const old = g.getObjectByName('art-print') as THREE.Mesh | undefined;
  if (!old) return;
  const { w, h, z } = old.userData.picture as { w: number; h: number; z: number };
  g.remove(old); old.geometry.dispose(); (old.material as THREE.Material).dispose();
  // a matt print behind glass: the paper's own colours, a faint sheen
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0 });
  const m = decorMesh(new THREE.PlaneGeometry(w, h).translate(0, 0, z), mat, 'art-print');
  m.userData.picture = { w, h, z };
  g.add(m);
}

function decorMesh(g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.name = name;
  mesh.userData.clubDecor = true;
  mesh.raycast = () => {}; // never a measurement or a click target
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/** the drawn pieces (art, battens) and drawn stand-ins for the model fittings; the returned list says which model each stand-in waits for */
function drawPiece(p: ClubDecorPiece, tier: Tier): THREE.Object3D {
  const o = new THREE.Group();
  o.name = `club-decor:${p.kind}`;
  o.position.set(p.x, p.y, p.z);
  o.rotation.y = (p.yawDeg * Math.PI) / 180;
  if (p.kind === 'batten') {
    // a surface-mounted linear LED fitting: an aluminium body and an opal diffuser underneath (lit: the gym's lights are on)
    const body = new THREE.BoxGeometry(0.075, 0.05, p.w).translate(0, -0.025, 0);
    o.add(decorMesh(body, mats.housing(), 'batten-body'));
    o.add(decorMesh(new THREE.BoxGeometry(0.06, 0.006, p.w - 0.02).translate(0, -0.053, 0), mats.diffuser(), 'batten-diffuser'));
  } else if (p.kind === 'art') {
    const dark = p.seed % 2 === 0, fw = 0.025, depth = 0.03;
    const f = mats.frame(dark);
    // the frame: four bars around the mount, standing `depth` off the wall
    for (const [x0, y0, x1, y1] of [[-p.w / 2 - fw, p.h / 2, p.w / 2 + fw, p.h / 2 + fw], [-p.w / 2 - fw, -p.h / 2 - fw, p.w / 2 + fw, -p.h / 2], [-p.w / 2 - fw, -p.h / 2, -p.w / 2, p.h / 2], [p.w / 2, -p.h / 2, p.w / 2 + fw, p.h / 2]])
      o.add(decorMesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, depth).translate((x0 + x1) / 2, (y0 + y1) / 2, depth / 2), f, 'art-frame'));
    o.add(decorMesh(new THREE.BoxGeometry(p.w, p.h, 0.004).translate(0, 0, depth - 0.012), mats.mount(), 'art-mount'));
    // the picture fits inside the mount's window at its own aspect (the mount shows wider where the shapes differ, as a framer cuts it)
    const [pw, ph] = artSize(p);
    const pic = painting(pw, ph, p.seed).translate(0, 0, depth - 0.0095);
    const m = decorMesh(pic, mats.paint(), 'art-print');
    m.userData.picture = { w: pw, h: ph, z: depth - 0.0095 };
    o.add(m);
  } else if (p.kind === 'pendant') {
    // stand-in until the model arrives: a cord, a cap and an opal globe, 0.95 m drop
    const seg = tier === 'low' ? 10 : 18;
    o.add(decorMesh(new THREE.CylinderGeometry(0.003, 0.003, 0.6, 4).translate(0, -0.3, 0), mats.alu(), 'pendant-cord'));
    o.add(decorMesh(new THREE.SphereGeometry(0.2, seg, seg / 2).translate(0, -0.73, 0), mats.opal(), 'pendant-globe'));
  } else if (p.kind === 'chandelier') {
    o.add(decorMesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 6).translate(0, -0.2, 0), mats.brass(), 'chandelier-rod'));
    o.add(decorMesh(new THREE.TorusGeometry(0.3, 0.012, 6, 24).rotateX(Math.PI / 2).translate(0, -0.6, 0), mats.brass(), 'chandelier-ring'));
  } else if (p.kind === 'dartboard') {
    o.add(decorMesh(new THREE.CylinderGeometry(p.w / 2, p.w / 2, 0.04, 24).rotateX(Math.PI / 2).translate(0, 0, 0.02), mats.frame(true), 'dartboard-disc'));
  }
  return o;
}

/** where a model goes in a piece's frame: a ceiling fitting hangs with its top on the ceiling, the dartboard's back on the wall */
function modelInto(o: THREE.Group, p: ClubDecorPiece, geo: PropGeo, kind: PropKind): void {
  const d = propInfo(kind).dims;
  for (const c of [...o.children]) { o.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
  const k = p.kind === 'dartboard' ? p.w / d.w : 1;
  for (const m of geo.meshes ?? []) {
    const g = m.geometry.clone().scale(k, k, k);
    if (p.kind === 'dartboard') g.translate(0, -d.h * k / 2, -0.0 + (d.d * k) / 2); else g.translate(0, -d.h, 0);
    const mat = m.material.clone();
    // a fitting's globe or shades (named so in the source) glow softly: these lights are on, like the gym's
    if (p.kind !== 'dartboard' && /globe|glass|lamps|shade/i.test(mat.name)) { mat.emissive.set('#FFE9CC'); mat.emissiveMap = null; mat.emissiveIntensity = 0.9; mat.metalness = 0; mat.metalnessMap = null; }
    else if (p.kind === 'chandelier') {
      // the chandelier's shades share the brass's map: lit, the whole fitting glows a little through its own colours, and its brass is
      // toned down from a mirror (a mirror of a dim hall reads black)
      mat.metalness = Math.min(mat.metalness, 0.35); mat.emissive.set('#FFFFFF'); mat.emissiveMap = mat.map; mat.emissiveIntensity = 0.35;
    }
    o.add(decorMesh(g, mat, `${p.kind}-model`));
  }
}

export interface ClubDecorHandle { group: THREE.Group; pieces: ClubDecorPiece[]; label: string | null; dispose(): void }

/** builds the decor of a shared space under `parent` and swaps the model fittings in when they arrive */
export function mountClubDecor(o: { parent: THREE.Object3D; layout: Layout; furniture: FurnitureItem[]; kind: string; tier: Tier; /** the design sheet tiles the walls (a sample finish, said in the label) */ wallTiles?: boolean }): ClubDecorHandle {
  const group = new THREE.Group();
  group.name = 'club-decor';
  group.userData.decor = true;
  const pieces = planClubDecor(o.layout, o.furniture, o.kind);
  const waiting = new Map<PropKind, { g: THREE.Group; p: ClubDecorPiece }[]>();
  for (const p of pieces) {
    const g = drawPiece(p, o.tier) as THREE.Group;
    group.add(g);
    if (p.kind === 'pendant' || p.kind === 'chandelier' || p.kind === 'dartboard') {
      const list = waiting.get(p.kind) ?? [];
      list.push({ g, p });
      waiting.set(p.kind, list);
    }
  }
  o.parent.add(group);
  let live = true;
  if (modelsEnabled()) for (const [kind, list] of waiting) {
    void loadProp(kind, o.tier).then((geo) => { if (!live || !geo) return; for (const { g, p } of list) modelInto(g, p, geo, kind); });
  }
  // the pictures: each file once, hung in every frame that shows it; a failed load keeps the colour field
  const textures: THREE.Texture[] = [];
  if (modelsEnabled() && typeof document !== 'undefined') {
    const byArt = new Map<string, THREE.Group[]>();
    group.children.forEach((g, i) => { const a = pieces[i]?.art; if (pieces[i]?.kind === 'art' && a) byArt.set(a, [...(byArt.get(a) ?? []), g as THREE.Group]); });
    for (const [art, frames] of byArt) {
      new THREE.TextureLoader().load(clubArtUrl(art, o.tier), (tex) => {
        if (!live) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        textures.push(tex);
        for (const g of frames) hangPicture(g, tex);
      }, undefined, () => { /* the colour field stays */ });
    }
  }
  return {
    group, pieces, label: pieces.length ? (o.wallTiles ? CLUB_DECOR_TILE_LABEL : CLUB_DECOR_LABEL) : null,
    dispose() {
      live = false;
      o.parent.remove(group);
      group.traverse((x) => { const m = x as THREE.Mesh; if (!m.isMesh) return; m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
      for (const t of textures) t.dispose();
    },
  };
}
