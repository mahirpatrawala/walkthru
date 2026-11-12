// Owned by C1. SPEC 4.1: wall geometry from rooms.
import type { EdgeFrame, EdgeKind, Layout, RoomTag, Tunnel, Vec2, WallPiece } from '../types';
import { pointInPolygon, polygonArea } from './geometry';

const COS10 = Math.cos((10 * Math.PI) / 180);

interface Partner {
  /** the facing edge of another room */
  frame: EdgeFrame;
  /** gap to it, clamped at 0 */
  g: number;
  /** its projection onto this edge's axis, lo <= hi (not clamped to the edge) */
  lo: number;
  hi: number;
}

interface Analysis {
  frames: EdgeFrame[];
  partners: Partner[][];
  /** `${roomId}:${edge}` -> index into frames */
  index: Map<string, number>;
}

interface Base { a: Vec2; b: Vec2; dir: Vec2; out: Vec2; length: number }

function baseOf(a: Vec2, b: Vec2): Base {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  const dir = length > 1e-12 ? { x: dx / length, z: dz / length } : { x: 1, z: 0 };
  // outward normal (dz, -dx) / length, SPEC 3.1
  return { a, b, dir, out: { x: dir.z, z: -dir.x }, length };
}

/**
 * Is F a partner of E (SPEC 4.1)? Returns the gap and F's projection onto E's axis.
 * // SPEC-GAP: 4.1 does not say the two edges must face each other. We also require opposing outward
 * normals, otherwise a stepped facade (two edges looking the same way, 0.2 m apart) would pair up.
 */
function partnerOf(e: Base, f: Base): { g: number; lo: number; hi: number } | null {
  if (Math.abs(e.dir.x * f.dir.x + e.dir.z * f.dir.z) < COS10) return null;
  if (e.out.x * f.out.x + e.out.z * f.out.z >= 0) return null;
  const da = (f.a.x - e.a.x) * e.out.x + (f.a.z - e.a.z) * e.out.z;
  const db = (f.b.x - e.a.x) * e.out.x + (f.b.z - e.a.z) * e.out.z;
  const g = (da + db) / 2;
  if (g < -0.02 || g > 0.45) return null;
  const pa = (f.a.x - e.a.x) * e.dir.x + (f.a.z - e.a.z) * e.dir.z;
  const pb = (f.b.x - e.a.x) * e.dir.x + (f.b.z - e.a.z) * e.dir.z;
  const lo = Math.min(pa, pb);
  const hi = Math.max(pa, pb);
  const overlap = Math.min(hi, e.length) - Math.max(lo, 0);
  if (overlap <= 0.05) return null;
  return { g: Math.max(0, g), lo, hi };
}

function analyse(layout: Layout): Analysis {
  const frames: EdgeFrame[] = [];
  const index = new Map<string, number>();
  for (const room of layout.rooms) {
    const n = room.polygon.length;
    for (let i = 0; i < n; i++) {
      const b = baseOf(room.polygon[i], room.polygon[(i + 1) % n]);
      index.set(`${room.id}:${i}`, frames.length);
      frames.push({
        roomId: room.id, edge: i, kind: room.edges[i] ?? 'wall',
        a: b.a, b: b.b, dir: b.dir, out: b.out, length: b.length,
        thickness: 0, partnerGap: null,
      });
    }
  }
  const partners: Partner[][] = frames.map(() => []);
  for (let i = 0; i < frames.length; i++) {
    for (let j = 0; j < frames.length; j++) {
      if (frames[i].roomId === frames[j].roomId) continue;
      const p = partnerOf(frames[i], frames[j]);
      if (p) partners[i].push({ frame: frames[j], ...p });
    }
    let gap: number | null = null;
    for (const p of partners[i]) gap = gap === null ? p.g : Math.min(gap, p.g);
    frames[i].partnerGap = gap;
    const f = frames[i];
    if (f.kind === 'wall') {
      f.thickness = gap === null
        ? layout.wallThicknessM
        : Math.min(layout.wallThicknessM, Math.max(0.03, gap / 2));
    } else if (f.kind === 'railing') f.thickness = 0.05;
    else f.thickness = 0;
  }
  return { frames, partners, index };
}

export function computeEdgeFrames(layout: Layout): EdgeFrame[] {
  return analyse(layout).frames;
}

function tunnelsOf(layout: Layout, an: Analysis): Tunnel[] {
  const out: Tunnel[] = [];
  const depthFor = (i: number, u0: number, u1: number, fallback: number): number => {
    const half = (u1 - u0) / 2;
    let best: number | null = null;
    for (const p of an.partners[i]) {
      const ov = Math.min(p.hi, u1) - Math.max(p.lo, u0);
      if (ov >= half - 1e-9 && ov > 0) best = best === null ? p.g : Math.min(best, p.g);
    }
    return best === null ? fallback : best;
  };
  for (const o of layout.openings) {
    const i = an.index.get(`${o.roomId}:${o.edge}`);
    if (i === undefined) continue;
    const f = an.frames[i];
    const u0 = Math.max(0, o.centreM - o.widthM / 2);
    const u1 = Math.min(f.length, o.centreM + o.widthM / 2);
    out.push({
      openingId: o.id, roomId: o.roomId, edge: o.edge, type: o.type,
      u0, u1, depth: depthFor(i, u0, u1, f.thickness),
      sillM: o.sillM, headM: o.headM, passable: o.type !== 'window',
    });
  }
  for (let i = 0; i < an.frames.length; i++) {
    const f = an.frames[i];
    if (f.kind !== 'none') continue;
    out.push({
      openingId: null, roomId: f.roomId, edge: f.edge, type: 'opening',
      u0: 0, u1: f.length, depth: depthFor(i, 0, f.length, 0),
      sillM: 0, headM: layout.wallHeightM, passable: true,
    });
  }
  return out;
}

export function computeTunnels(layout: Layout): Tunnel[] {
  return tunnelsOf(layout, analyse(layout));
}

export function computeWallPieces(layout: Layout): WallPiece[] {
  const an = analyse(layout);
  const tunnels = tunnelsOf(layout, an);
  const byEdge = new Map<number, Tunnel[]>();
  for (const t of tunnels) {
    const i = an.index.get(`${t.roomId}:${t.edge}`);
    if (i === undefined) continue;
    const l = byEdge.get(i) ?? [];
    l.push(t);
    byEdge.set(i, l);
  }
  // convex test per room vertex
  const roomStart = new Map<string, number>();
  const roomLen = new Map<string, number>();
  for (let i = 0; i < an.frames.length; i++) {
    const f = an.frames[i];
    if (!roomStart.has(f.roomId)) roomStart.set(f.roomId, i);
    roomLen.set(f.roomId, (roomLen.get(f.roomId) ?? 0) + 1);
  }
  const convexAt = (fi: number, atStart: boolean): boolean => {
    const f = an.frames[fi];
    const s = roomStart.get(f.roomId)!;
    const n = roomLen.get(f.roomId)!;
    const prev = atStart ? an.frames[s + ((f.edge - 1 + n) % n)] : f;
    const next = atStart ? f : an.frames[s + ((f.edge + 1) % n)];
    return prev.dir.x * next.dir.z - prev.dir.z * next.dir.x > 0;
  };

  const pieces: WallPiece[] = [];
  for (let i = 0; i < an.frames.length; i++) {
    const f = an.frames[i];
    if (f.kind !== 'wall' && f.kind !== 'railing') continue;
    const H = f.kind === 'wall' ? layout.wallHeightM : layout.railingHeightM;
    const base0 = -(convexAt(i, true) ? f.thickness : 0);
    const base1 = f.length + (convexAt(i, false) ? f.thickness : 0);

    const cuts: { u0: number; u1: number; sill: number; head: number }[] = [];
    for (const t of byEdge.get(i) ?? []) cuts.push({ u0: t.u0, u1: t.u1, sill: t.sillM, head: t.headM });
    for (const p of an.partners[i]) {
      const pi = an.index.get(`${p.frame.roomId}:${p.frame.edge}`)!;
      for (const t of byEdge.get(pi) ?? []) {
        const ua = (p.frame.a.x + p.frame.dir.x * t.u0 - f.a.x) * f.dir.x + (p.frame.a.z + p.frame.dir.z * t.u0 - f.a.z) * f.dir.z;
        const ub = (p.frame.a.x + p.frame.dir.x * t.u1 - f.a.x) * f.dir.x + (p.frame.a.z + p.frame.dir.z * t.u1 - f.a.z) * f.dir.z;
        cuts.push({ u0: Math.min(ua, ub), u1: Math.max(ua, ub), sill: t.sillM, head: t.headM });
      }
    }

    const cl = (u: number): number => Math.min(base1, Math.max(base0, u));
    const stops = [base0, base1];
    for (const c of cuts) stops.push(cl(c.u0), cl(c.u1));
    stops.sort((a, b) => a - b);

    const mine: WallPiece[] = [];
    const push = (u0: number, u1: number, y0: number, y1: number): void => {
      if (y1 - y0 < 1e-9) return;
      for (let k = mine.length - 1; k >= 0 && k >= mine.length - 3; k--) {
        const m = mine[k];
        if (Math.abs(m.y0 - y0) < 1e-9 && Math.abs(m.y1 - y1) < 1e-9 && Math.abs(m.u1 - u0) < 1e-6) {
          m.u1 = u1;
          return;
        }
      }
      mine.push({ roomId: f.roomId, edge: f.edge, kind: f.kind as 'wall' | 'railing', u0, u1, y0, y1, thickness: f.thickness });
    };
    for (let k = 0; k + 1 < stops.length; k++) {
      const s0 = stops[k];
      const s1 = stops[k + 1];
      if (s1 - s0 < 1e-6) continue;
      const mid = (s0 + s1) / 2;
      const active = cuts.filter((c) => c.u0 < mid && mid < c.u1);
      if (active.length === 0) {
        push(s0, s1, 0, H);
        continue;
      }
      const sill = Math.min(...active.map((c) => c.sill));
      const head = Math.max(...active.map((c) => c.head));
      if (sill > 1e-9) push(s0, s1, 0, Math.min(sill, H));
      if (head < H - 1e-9) push(s0, s1, Math.max(head, 0), H);
    }
    pieces.push(...mine);
  }
  return pieces;
}

/** Corners (u0,0), (u1,0), (u1,t), (u0,t) of the piece in plan, world XZ. */
export function pieceRect(frame: EdgeFrame, piece: WallPiece): [Vec2, Vec2, Vec2, Vec2] {
  return rectOf(frame, piece.u0, piece.u1, 0, piece.thickness);
}

/** The tunnel's footprint on the edge: u0..u1 by -pad..depth + pad outward. */
export function tunnelRect(frame: EdgeFrame, t: Tunnel, pad = 0): [Vec2, Vec2, Vec2, Vec2] {
  return rectOf(frame, t.u0, t.u1, -pad, t.depth + pad);
}

function rectOf(f: EdgeFrame, u0: number, u1: number, o0: number, o1: number): [Vec2, Vec2, Vec2, Vec2] {
  const at = (u: number, o: number): Vec2 => ({
    x: f.a.x + f.dir.x * u + f.out.x * o,
    z: f.a.z + f.dir.z * u + f.out.z * o,
  });
  return [at(u0, o0), at(u1, o0), at(u1, o1), at(u0, o1)];
}

/** The first room whose polygon contains the point, else null (walls and gaps are null). */
export function roomAt(layout: Layout, pt: Vec2): RoomTag | null {
  for (const r of layout.rooms) if (pointInPolygon(pt, r.polygon)) return r;
  return null;
}

/** rooms except balconies */
export function carpetAreaM2(layout: Layout): number {
  let s = 0;
  for (const r of layout.rooms) if (r.roomType !== 'balcony') s += polygonArea(r.polygon);
  return s;
}

/** the balcony rule in 2.2 E3: every edge is a wall, except a balcony's edges that face no other room, which are railings */
export function defaultEdges(room: RoomTag, others: RoomTag[]): EdgeKind[] {
  const n = room.polygon.length;
  const out: EdgeKind[] = [];
  for (let i = 0; i < n; i++) {
    if (room.roomType !== 'balcony') {
      out.push('wall');
      continue;
    }
    const e = baseOf(room.polygon[i], room.polygon[(i + 1) % n]);
    let faces = false;
    for (const o of others) {
      if (o.id === room.id) continue;
      const m = o.polygon.length;
      for (let j = 0; j < m && !faces; j++) {
        if (partnerOf(e, baseOf(o.polygon[j], o.polygon[(j + 1) % m]))) faces = true;
      }
      if (faces) break;
    }
    out.push(faces ? 'wall' : 'railing');
  }
  return out;
}
