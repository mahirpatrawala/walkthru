// C12a: furniture and fixture symbols for the plan: where they go (truth) and how they are drawn (three variants each).
import type { SetOptions, SymbolClass, TruthItem, TruthSymbol } from './types';
import type { Layout, LRoom, Rect, Rng } from './layout';
import { snapDim } from './layout';
import type { Canvas } from './draw';

const FT = 0.3048;
export type Side = 'N' | 'S' | 'W' | 'E';
const YAW: Record<Side, number> = { N: 0, S: 180, W: 90, E: 270 };

export interface Furnished { items: TruthItem[]; symbols: TruthSymbol[]; zones: Map<string, Rect[]> }

const rectOverlap = (a: Rect, b: Rect, m = 0): boolean => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;
const inside = (a: Rect, b: Rect, m = 0): boolean => a.x0 >= b.x0 + m - 1e-6 && a.x1 <= b.x1 - m + 1e-6 && a.z0 >= b.z0 + m - 1e-6 && a.z1 <= b.z1 - m + 1e-6;

function doorZones(L: Layout): Map<string, Rect[]> {
  const zones = new Map<string, Rect[]>();
  for (const d of L.openings) {
    if (d.type !== 'door') continue;
    const run = L.runs.find((r) => r.id === d.run)!;
    const t = run.axis === 'h' ? run.rect.z1 - run.rect.z0 : run.rect.x1 - run.rect.x0;
    const mid = run.axis === 'h' ? (run.rect.z0 + run.rect.z1) / 2 : (run.rect.x0 + run.rect.x1) / 2;
    const lo = d.centre - d.width / 2, hi = d.centre + d.width / 2;
    const swing = d.swingSide === 1 ? [mid + t / 2, mid + t / 2 + d.width] : [mid - t / 2 - d.width, mid - t / 2];
    const clear = d.swingSide === 1 ? [mid - t / 2 - 0.45, mid - t / 2] : [mid + t / 2, mid + t / 2 + 0.45];
    const mk = (z: number[]): Rect => (run.axis === 'h' ? { x0: lo, x1: hi, z0: z[0], z1: z[1] } : { z0: lo, z1: hi, x0: z[0], x1: z[1] });
    // the room the swing opens into gets the swing square, the other side a clear strip
    const into = d.rooms[0];
    for (const rid of d.rooms) {
      const list = zones.get(rid) ?? [];
      list.push(rid === into ? mk(swing) : mk(clear));
      zones.set(rid, list);
    }
  }
  return zones;
}

class Placer {
  occ: Rect[] = [];
  items: TruthItem[] = []; symbols: TruthSymbol[] = [];
  counts: Record<string, number> = {};
  constructor(readonly L: Layout, readonly o: SetOptions, readonly rng: Rng, readonly zones: Map<string, Rect[]>) {}
  windowSpans(room: LRoom, side: Side): [number, number][] {
    const out: [number, number][] = [];
    for (const q of this.L.openings) {
      if (q.type !== 'window' || !q.rooms.includes(room.id)) continue;
      const run = this.L.runs.find((r) => r.id === q.run)!;
      const onSide = side === 'N' ? run.axis === 'h' && Math.abs(run.rect.z1 - room.rect.z0) < 0.3 : side === 'S' ? run.axis === 'h' && Math.abs(run.rect.z0 - room.rect.z1) < 0.3
        : side === 'W' ? run.axis === 'v' && Math.abs(run.rect.x1 - room.rect.x0) < 0.3 : run.axis === 'v' && Math.abs(run.rect.x0 - room.rect.x1) < 0.3;
      if (onSide) out.push([q.centre - q.width / 2, q.centre + q.width / 2]);
    }
    return out;
  }
  rectFor(room: LRoom, side: Side, w: number, d: number, c: number): Rect {
    const R = room.rect;
    if (side === 'N') return { x0: c - w / 2, x1: c + w / 2, z0: R.z0, z1: R.z0 + d };
    if (side === 'S') return { x0: c - w / 2, x1: c + w / 2, z0: R.z1 - d, z1: R.z1 };
    if (side === 'W') return { z0: c - w / 2, z1: c + w / 2, x0: R.x0, x1: R.x0 + d };
    return { z0: c - w / 2, z1: c + w / 2, x0: R.x1 - d, x1: R.x1 };
  }
  alongRange(room: LRoom, side: Side): [number, number] { const R = room.rect; return side === 'N' || side === 'S' ? [R.x0, R.x1] : [R.z0, R.z1]; }
  /** Try positions along one wall; returns the rect or null. */
  tryWall(room: LRoom, side: Side, w: number, d: number, pos: 'centre' | 'start' | 'end' | 'any', opts: { windows?: boolean; gap?: number } = {}): Rect | null {
    const [lo, hi] = this.alongRange(room, side);
    if (hi - lo < w + 0.1) return null;
    const cands: number[] = [];
    const m = 0.05;
    if (pos === 'centre' || pos === 'any') cands.push((lo + hi) / 2);
    if (pos === 'start' || pos === 'any') cands.push(lo + m + w / 2);
    if (pos === 'end' || pos === 'any') cands.push(hi - m - w / 2);
    if (pos === 'any') for (let i = 0; i < 6; i++) cands.push(lo + m + w / 2 + this.rng() * (hi - lo - w - 2 * m));
    for (const c0 of cands) {
      const c = Math.round(c0 / 0.025) * 0.025;
      const r = this.rectFor(room, side, w, d, c);
      if (!inside(r, room.rect, 0)) continue;
      if (this.occ.some((q) => rectOverlap(r, q, opts.gap ?? 0.04))) continue;
      if ((this.zones.get(room.id) ?? []).some((z) => rectOverlap(r, z, 0.02))) continue;
      if (opts.windows && this.windowSpans(room, side).some(([a, b]) => c + w / 2 > a - 0.1 && c - w / 2 < b + 0.1)) continue;
      return r;
    }
    return null;
  }
  free(r: Rect, room: LRoom, gap = 0.04): boolean {
    return inside(r, room.rect, 0) && !this.occ.some((q) => rectOverlap(r, q, gap)) && !(this.zones.get(room.id) ?? []).some((z) => rectOverlap(r, z, 0.02));
  }
  add(room: LRoom, cls: SymbolClass, r: Rect, yawDeg: number, w: number, d: number, kind: string | null, variant: number, item: boolean, extra: Partial<TruthItem> = {}, reserve = true): TruthItem | null {
    const n = (this.counts[cls] = (this.counts[cls] ?? 0) + 1);
    const id = `${cls.replace(/ /g, '-')}-${n}`;
    // a set draws a symbol in all three variants (a chair's variant is its kind: 0 side chair, 1 swivel)
    if (cls !== 'chair') variant = (variant + n - 1 + this.L.rooms.findIndex((r) => r.id === room.id)) % 3;
    if (reserve) this.occ.push(r);
    const box = { cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, w, d, yawDeg };
    this.symbols.push({ id, cls, variant, bboxM: [r.x0, r.z0, r.x1, r.z1], roomId: room.id, itemId: item ? id : undefined, labelled: false, box });
    if (!item) return null;
    const it: TruthItem = { id, cls, kind, roomId: room.id, box, labelString: null, sizeString: null, variant, ...extra };
    this.items.push(it);
    return it;
  }
}
const sides: Side[] = ['N', 'S', 'W', 'E'];
const opposite = (s: Side): Side => ({ N: 'S', S: 'N', W: 'E', E: 'W' } as const)[s];

/** The yaw box for an item against a side, and its rotated rect of the actual size. */
const yawOf = (s: Side): number => YAW[s];

export function furnish(L: Layout, o: SetOptions, rng: Rng): Furnished {
  const zones = doorZones(L);
  const P = new Placer(L, o, rng, zones);
  const v = o.symbolVariant;
  const dim = (ft: number): number => snapDim(ft * FT, o);
  for (const room of L.rooms) {
    const R = room.rect; const W = R.x1 - R.x0, Dz = R.z1 - R.z0;
    const orderSides = (): Side[] => [...sides].sort((a, b) => (b === 'N' || b === 'S' ? W : Dz) - (a === 'N' || a === 'S' ? W : Dz) + (rng() - 0.5) * 0.4);
    if (room.kind === 'master' || room.kind === 'bedroom' || room.kind === 'kids') {
      const king = room.kind === 'master' && W > 3.4 && Dz > 3.6;
      const bw = king ? dim(6) : room.kind === 'kids' ? dim(3.5) : dim(5), bd = king ? dim(6.5) : dim(6);
      let bedSide: Side | null = null; let bedRect: Rect | null = null;
      for (const s of orderSides()) {
        const r = P.tryWall(room, s, bw, bd, 'centre', { gap: 0.3 });
        if (r) { bedSide = s; bedRect = r; break; }
      }
      if (bedSide && bedRect) {
        const it = P.add(room, 'bed', bedRect, yawOf(bedSide), bw, bd, 'bed', v % 3, true, { heightM: 0.9, surfaceHeightM: 0.5 });
        void it;
        // side tables either side of the bed head
        if (rng.chance(0.75)) {
          const sw = dim(1.5);
          for (const sign of [-1, 1]) {
            const c = (bedSide === 'N' || bedSide === 'S' ? (bedRect.x0 + bedRect.x1) / 2 : (bedRect.z0 + bedRect.z1) / 2) + sign * (bw / 2 + sw / 2 + 0.03);
            const r = P.rectFor(room, bedSide, sw, sw, c);
            if (P.free(r, room, 0.01)) P.add(room, 'side table', r, yawOf(bedSide), sw, sw, 'counter', v % 3, true, { heightM: 0.55, surfaceHeightM: 0.55 });
          }
        }
        // a wardrobe on another wall
        const wl = dim(rng.pick([6, 7.5, 9]));
        const wsides = orderSides().filter((s) => s !== bedSide);
        for (const s of wsides) {
          const r = P.tryWall(room, s, wl, dim(2), s === opposite(bedSide) ? 'centre' : 'any', { windows: true, gap: 0.1 });
          if (r) { P.add(room, 'wardrobe', r, yawOf(s), wl, dim(2), 'wardrobe', v % 3, true, { heightM: 2.13, surfaceHeightM: 2.13, runningLengthM: wl }); break; }
        }
        // a study table and chair
        if (room.kind !== 'master' || rng.chance(0.4)) {
          const dw = dim(4), dd = dim(2);
          for (const s of wsides) {
            const r = P.tryWall(room, s, dw, dd, 'any', { windows: false, gap: 0.5 });
            if (r) {
              const it2 = P.add(room, 'desk', r, yawOf(s), dw, dd, 'counter', v % 3, true, { heightM: 0.75, surfaceHeightM: 0.75 });
              void it2;
              // chair on the room side of the table, centre 0.35 m out of its front
              const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
              const f = { x: Math.sin((yawOf(s) * Math.PI) / 180), z: Math.cos((yawOf(s) * Math.PI) / 180) };
              const cc = { x: cx + f.x * (dd / 2 + 0.3), z: cz + f.z * (dd / 2 + 0.3) };
              const cr: Rect = { x0: cc.x - 0.25, x1: cc.x + 0.25, z0: cc.z - 0.25, z1: cc.z + 0.25 };
              if (inside(cr, room.rect, 0) && !P.occ.some((q) => rectOverlap(cr, q, 0))) P.add(room, 'chair', cr, (yawOf(s) + 180) % 360, 0.5, 0.5, null, 1, false, {}, false);
              break;
            }
          }
        }
      }
    } else if (room.kind === 'living' || room.kind === 'dining') {
      const sl = dim(6.5), sd = dim(3);
      for (const s of orderSides()) {
        const r = P.tryWall(room, s, sl, sd, 'centre', { gap: 0.2 });
        if (r) {
          P.add(room, 'sofa', r, yawOf(s), sl, sd, 'sofa', v % 3, true, { heightM: 0.85, surfaceHeightM: 0.43 });
          const tl = dim(4), td = dim(1.5);
          const r2 = P.tryWall(room, opposite(s), tl, td, 'any', { gap: 0.15 });
          if (r2) P.add(room, 'tv unit', r2, yawOf(opposite(s)), tl, td, null, v % 3, true, { heightM: 0.5, surfaceHeightM: 0.5 });
          break;
        }
      }
      if (W > 3.6 && Dz > 3.6 && room.kind === 'living') {
        const tw = dim(5), td = dim(2.75);
        // the table sits clear of the walls, near a corner of the room
        for (let k = 0; k < 14; k++) {
          const cx = R.x0 + 1.0 + tw / 2 + rng() * Math.max(0, W - tw - 2.0), cz = R.z0 + 1.0 + td / 2 + rng() * Math.max(0, Dz - td - 2.0);
          const r: Rect = { x0: cx - tw / 2, x1: cx + tw / 2, z0: cz - td / 2, z1: cz + td / 2 };
          const pad: Rect = { x0: r.x0 - 0.55, x1: r.x1 + 0.55, z0: r.z0 - 0.55, z1: r.z1 + 0.55 };
          if (!inside(pad, room.rect, 0) || P.occ.some((q) => rectOverlap(pad, q, 0)) || (zones.get(room.id) ?? []).some((z) => rectOverlap(pad, z, 0))) continue;
          P.add(room, 'dining', r, 0, tw, td, 'dining', v % 3, true, { heightM: 0.95, surfaceHeightM: 0.75 });
          const per = rng.chance(0.5) ? 3 : 2;
          for (let i = 0; i < per; i++) for (const sgn of [-1, 1]) {
            const px = cx - tw / 2 + ((i + 0.5) * tw) / per;
            const pz = cz + sgn * (td / 2 + 0.22);
            P.add(room, 'chair', { x0: px - 0.22, x1: px + 0.22, z0: pz - 0.22, z1: pz + 0.22 }, sgn < 0 ? 180 : 0, 0.45, 0.45, null, 0, false, {}, false);
          }
          break;
        }
      }
    } else if (room.kind === 'kitchen') {
      const cd = dim(2);
      let placed: { r: Rect; side: Side; cl: number } | null = null;
      for (const side of orderSides()) {
        const span = side === 'N' || side === 'S' ? W : Dz;
        for (const len of [9, 8, 7, 6, 5]) {
          const cl = Math.min(dim(len), span - 0.15);
          const r = P.tryWall(room, side, cl, cd, 'any', { gap: 0.1 });
          if (r) { placed = { r, side, cl }; break; }
        }
        if (placed) break;
      }
      if (placed) {
        const { r, side, cl } = placed;
        P.add(room, 'counter', r, yawOf(side), cl, cd, 'counter', v % 3, true, { heightM: 0.85, surfaceHeightM: 0.85 });
        const along = (u: number): { cx: number; cz: number } => (side === 'N' || side === 'S' ? { cx: (r.x0 + r.x1) / 2 + u, cz: (r.z0 + r.z1) / 2 } : { cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2 + u });
        const mk = (cls: SymbolClass, u: number, w: number, d: number): void => {
          const c = along(u); const hw = (side === 'N' || side === 'S' ? w : d) / 2, hd = (side === 'N' || side === 'S' ? d : w) / 2;
          P.add(room, cls, { x0: c.cx - hw, x1: c.cx + hw, z0: c.cz - hd, z1: c.cz + hd }, yawOf(side), w, d, null, v % 3, false, {}, false);
        };
        const sw = Math.min(0.9, cl * 0.4), hw2 = Math.min(0.6, cl * 0.3);
        mk('sink', -cl / 4, sw, 0.45); mk('hob', cl / 4, hw2, 0.5);
      }
    } else if (room.kind === 'toilet') {
      const back = orderSides()[0];
      const w = 0.4, d = 0.7;
      const r = P.tryWall(room, back, w, d, 'centre', { gap: 0.05 });
      if (r) P.add(room, 'wc', r, yawOf(back), w, d, null, v % 3, false);
      const s2 = sides.find((s) => s !== back && s !== opposite(back)) ?? back;
      const rb = P.tryWall(room, s2, 0.5, 0.4, 'any', { gap: 0.1 });
      if (rb) P.add(room, 'basin', rb, yawOf(s2), 0.5, 0.4, null, v % 3, false);
      if (W > 1.4 && Dz > 2.0 && room.kind === 'toilet' && rng.chance(0.55)) {
        for (const s of sides) {
          const rs = P.tryWall(room, s, 0.9, 0.9, 'end', { gap: 0.05 });
          if (rs) { P.add(room, 'shower', rs, yawOf(s), 0.9, 0.9, null, v % 3, false); break; }
        }
      }
    }
  }
  return { items: P.items, symbols: P.symbols, zones };
}

// ---------------------------------------------------------------- drawing
export type ToPt = (x: number, z: number) => [number, number];
const BLACK = '#000000';

/** Draws one symbol. `box` centre and yaw place it; local a runs along the width, b out of the front (the back is b = -d/2). */
export function drawSymbol(cv: Canvas, toPt: ToPt, cls: SymbolClass, variant: number, box: { cx: number; cz: number; w: number; d: number; yawDeg: number }): void {
  const y = (box.yawDeg * Math.PI) / 180;
  const r = { x: Math.cos(y), z: -Math.sin(y) }, f = { x: Math.sin(y), z: Math.cos(y) };
  const P = (a: number, b: number): [number, number] => toPt(box.cx + a * r.x + b * f.x, box.cz + a * r.z + b * f.z);
  const hw = box.w / 2, hd = box.d / 2;
  const line = (a0: number, b0: number, a1: number, b1: number, w = 0.2): void => cv.line(BLACK, w, P(a0, b0), P(a1, b1));
  const rect = (a0: number, b0: number, a1: number, b1: number, w = 0.25): void => cv.poly(BLACK, w, [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)], true);
  const ell = (ca: number, cb: number, ra: number, rb: number, w = 0.25): void => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 20; i++) { const t = (i * 2 * Math.PI) / 20; pts.push(P(ca + ra * Math.cos(t), cb + rb * Math.sin(t))); }
    cv.prims.push({ t: 'stroke', color: BLACK, width: w, pts, closed: true, curve: true });
  };
  const circ = (ca: number, cb: number, rad: number, w = 0.2): void => ell(ca, cb, rad, rad, w);
  switch (cls) {
    case 'bed': {
      rect(-hw, -hd, hw, hd, 0.4);
      const pw = Math.min(0.6, hw * 0.8);
      const two = box.w > 1.2;
      for (const a of two ? [-hw / 2, hw / 2] : [0]) rect(a - pw / 2, -hd + 0.06, a + pw / 2, -hd + 0.4, 0.2);
      if (variant === 0) line(-hw, -hd + 0.65, hw, -hd + 0.65);
      else if (variant === 1) { rect(-hw + 0.05, -hd + 0.5, hw - 0.05, hd - 0.05, 0.15); line(-hw + 0.05, -hd + 0.5, hw - 0.05, -hd + 0.75); }
      else { rect(-hw - 0.0, -hd, hw, -hd + 0.07, 0.4); line(-hw, -hd + 0.7, hw, -hd + 0.7); line(0, -hd + 0.7, 0, hd); }
      break;
    }
    case 'sofa': {
      rect(-hw, -hd, hw, hd, 0.4);
      line(-hw, -hd + 0.22, hw, -hd + 0.22);
      if (variant !== 2) { line(-hw + 0.18, -hd + 0.22, -hw + 0.18, hd); line(hw - 0.18, -hd + 0.22, hw - 0.18, hd); }
      const seats = box.w > 1.7 ? 3 : 2;
      for (let i = 1; i < seats; i++) { const a = -hw + 0.18 + ((box.w - 0.36) * i) / seats; line(a, -hd + 0.22, a, hd); }
      if (variant === 1) rect(-hw + 0.18, -hd + 0.22, hw - 0.18, hd - 0.05, 0.12);
      break;
    }
    case 'dining': {
      if (variant === 2) ell(0, 0, hw, hd, 0.4); else rect(-hw, -hd, hw, hd, 0.4);
      if (variant === 1) rect(-hw + 0.06, -hd + 0.06, hw - 0.06, hd - 0.06, 0.12);
      break;
    }
    case 'chair': {
      if (variant === 1) { circ(0, 0, hw * 0.85, 0.3); for (let i = 0; i < 5; i++) { const t = (i * 2 * Math.PI) / 5; line(0, 0, hw * 0.85 * Math.cos(t), hw * 0.85 * Math.sin(t), 0.15); } circ(0, 0, 0.04, 0.2); }
      else { rect(-hw, -hd, hw, hd, 0.3); rect(-hw, -hd, hw, -hd + 0.07, 0.35); }
      break;
    }
    case 'wardrobe': {
      rect(-hw, -hd, hw, hd, 0.4);
      if (variant === 0 || variant === 2) {
        const n = Math.max(6, Math.round(box.w / 0.14));
        for (let i = 0; i < n; i++) { const a = -hw + ((i + 0.5) * box.w) / n; line(a, -hd + 0.1, a, hd - 0.1, 0.12); }
        if (variant === 2) { line(-hw, -hd, hw, hd, 0.12); }
      } else {
        const sh = Math.max(2, Math.round(box.w / 0.45));
        for (let i = 0; i < sh; i++) {
          const a0 = -hw + (i * box.w) / sh, a1 = -hw + ((i + 1) * box.w) / sh;
          if (i > 0) line(a0, -hd, a0, hd, 0.2);
          // shutter swing mark: two thin lines meeting at the hinge edge on the front face
          const hinge = i % 2 === 0 ? a0 : a1, free = i % 2 === 0 ? a1 : a0;
          line(hinge, hd, free, hd - 0.2, 0.08);
        }
        for (let i = 0; i < 8; i++) { const a = -hw + ((i + 0.5) * box.w) / 8; line(a, -hd + 0.1, a, -hd + 0.25, 0.1); }
      }
      break;
    }
    case 'desk': { rect(-hw, -hd, hw, hd, 0.35); if (variant === 1) line(-hw + 0.04, -hd + 0.04, hw - 0.04, -hd + 0.04, 0.1); break; }
    case 'side table': { rect(-hw, -hd, hw, hd, 0.3); if (variant === 1) circ(0, 0, hw * 0.4, 0.15); else line(-hw, -hd, hw, hd, 0.1); break; }
    case 'tv unit': { rect(-hw, -hd, hw, hd, 0.3); line(-hw + 0.1, 0, hw - 0.1, 0, 0.1); break; }
    case 'counter': { rect(-hw, -hd, hw, hd, 0.4); if (variant === 1) rect(-hw + 0.03, -hd + 0.03, hw - 0.03, hd - 0.03, 0.1); break; }
    case 'sink': {
      const two = variant !== 1;
      const bw = two ? hw / 2 - 0.03 : hw - 0.06;
      for (const a of two ? [-hw / 2, hw / 2] : [0]) { rect(a - bw, -hd + 0.04, a + bw, hd - 0.04, 0.2); circ(a, 0, 0.03, 0.15); }
      break;
    }
    case 'hob': {
      rect(-hw, -hd, hw, hd, 0.25);
      const n = variant === 0 ? 4 : variant === 1 ? 2 : 3;
      const pos = n === 4 ? [[-0.15, -0.12], [0.15, -0.12], [-0.15, 0.12], [0.15, 0.12]] : n === 2 ? [[-0.15, 0], [0.15, 0]] : [[-0.17, -0.1], [0.17, -0.1], [0, 0.12]];
      for (const [a, b] of pos) circ(a, b, 0.075, 0.18);
      break;
    }
    case 'wc': {
      rect(-hw, -hd, hw, -hd + 0.2, 0.3);
      ell(0, -hd + 0.2 + (box.d - 0.2) / 2, hw * 0.9, (box.d - 0.2) / 2 * 0.95, 0.3);
      if (variant === 1) ell(0, -hd + 0.2 + (box.d - 0.2) / 2, hw * 0.6, (box.d - 0.2) / 2 * 0.6, 0.12);
      break;
    }
    case 'basin': {
      rect(-hw, -hd, hw, hd, 0.25);
      ell(0, 0.02, hw * 0.7, hd * 0.65, 0.2);
      circ(0, -hd + 0.07, 0.025, 0.15);
      break;
    }
    case 'shower': {
      rect(-hw, -hd, hw, hd, 0.3);
      line(-hw, -hd, hw, hd, 0.12); line(-hw, hd, hw, -hd, 0.12);
      if (variant === 1) circ(0, 0, 0.18, 0.12);
      break;
    }
  }
}
