// C12a scoring harness: compare one Prediction with one truth and return counters per field (SPEC 17.11).
// Counters add up across sets; rates and the bar check come from `summarise`.
import { isFact } from '../../src/understand/types';
import type { Status } from '../../src/understand/types';
import type { PredElevation, Prediction, Pt, TruthLite } from './types';
import { FIELDS } from './bars';
import type { Variant } from './bars';

export interface Tally { right: number; expected: number; tp: number; pred: number }
export interface SetScore {
  fields: Record<string, Tally>;
  /** values the pipeline marked verified (or confirmed/corrected), and how many of them are wrong */
  verified: { n: number; wrong: number };
  /** truth values in scope, and how many were produced right AND as a fact */
  values: { n: number; facts: number };
  notAttempted: string[];
  aligned: boolean;
  /** shown only: how the alignment was found */
  note: string[];
}
const blank = (): Tally => ({ right: 0, expected: 0, tp: 0, pred: 0 });
export const newScore = (): SetScore => ({ fields: Object.fromEntries(FIELDS.map((f) => [f.key, blank()])), verified: { n: 0, wrong: 0 }, values: { n: 0, facts: 0 }, notAttempted: [], aligned: false, note: [] });

// ---------------------------------------------------------------- geometry helpers
const centroid = (p: Pt[]): Pt => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
const bbox = (p: Pt[]): [number, number, number, number] => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
const sides = (p: Pt[]): [number, number] => { const b = bbox(p); const w = b[2] - b[0], l = b[3] - b[1]; return [Math.min(w, l), Math.max(w, l)]; };
const polyArea = (p: Pt[]): number => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };
const near = (a: Pt, b: Pt, d: number): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) <= d;
const within = (v: number, t: number, rel: number, abs = 0): boolean => Math.abs(v - t) <= Math.max(rel * Math.abs(t), abs);
const rot = (p: Pt, r: number): Pt => (r === 0 ? p : r === 90 ? [-p[1], p[0]] : r === 180 ? [-p[0], -p[1]] : [p[1], -p[0]]);

export interface Align { rot: 0 | 90 | 180 | 270; dx: number; dz: number; inliers: number; scale?: number }
/** Find the rotation (quarter turns only) and shift that bring the predicted rooms onto the truth rooms. */
export function alignRooms(pred: { polygon: Pt[]; roomType: string }[], truth: { polygonM: Pt[]; roomType: string }[], scale = 1): Align | null {
  let best: Align | null = null;
  for (const r of [0, 90, 180, 270] as const) {
    const P = pred.map((q) => ({ poly: q.polygon.map((p) => { const t = rot(p, r); return [t[0] * scale, t[1] * scale] as Pt; }), type: q.roomType }));
    for (const p of P) {
      const ps = sides(p.poly), pc = centroid(p.poly);
      for (const t of truth) {
        const ts = sides(t.polygonM);
        if (Math.abs(ps[0] / ts[0] - 1) > 0.15 || Math.abs(ps[1] / ts[1] - 1) > 0.15) continue;
        const tc = centroid(t.polygonM);
        const dx = tc[0] - pc[0], dz = tc[1] - pc[1];
        let inl = 0;
        const used = new Set<number>();
        for (const q of P) {
          const c = centroid(q.poly); const qs = sides(q.poly);
          const k = truth.findIndex((u, i) => !used.has(i) && near([c[0] + dx, c[1] + dz], centroid(u.polygonM), 0.45) && Math.abs(qs[1] / sides(u.polygonM)[1] - 1) < 0.2);
          if (k >= 0) { used.add(k); inl++; }
        }
        if (!best || inl > best.inliers || (inl === best.inliers && r === 0 && best.rot !== 0)) best = { rot: r, dx, dz, inliers: inl, scale };
      }
    }
  }
  return best;
}
const apply = (a: Align, p: Pt): Pt => { const q = rot(p, a.rot); const k = a.scale ?? 1; return [q[0] * k + a.dx, q[1] * k + a.dz]; };

/**
 * C12b: when no room was found there is nothing to align the predicted frame with, and every plan dimension would count as a
 * miss (and a wrong verified value) however well it was read. The dimension lines carry the frame too: a shift that brings at
 * least three predicted plan strings onto truth strings of the same text is the shift. Quarter turns are not searched here
 * (a sheet is turned upright by its own text before dimensions are read). Rooms still need `alignRooms`.
 */
export function alignByDimensions(pred: { string: string; a: Pt; b: Pt; view: string }[], truth: { string: string; a: [number, number]; b: [number, number]; view: string }[]): Align | null {
  const P = pred.filter((q) => q.view === 'plan'), T = truth.filter((t) => t.view === 'plan');
  let best: Align | null = null;
  for (const r of [0, 90, 180, 270] as const) {
    const mids = P.map((q) => rot([(q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2], r));
    for (let i = 0; i < P.length; i++) for (const t of T) {
      if (P[i].string !== t.string) continue;
      const dx = (t.a[0] + t.b[0]) / 2 - mids[i][0], dz = (t.a[1] + t.b[1]) / 2 - mids[i][1];
      const used = new Set<number>();
      let n = 0;
      for (let j = 0; j < P.length; j++) {
        const k = T.findIndex((t2, q) => !used.has(q) && t2.string === P[j].string && near([mids[j][0] + dx, mids[j][1] + dz], [(t2.a[0] + t2.b[0]) / 2, (t2.a[1] + t2.b[1]) / 2], 0.3));
        if (k >= 0) { used.add(k); n++; }
      }
      if (!best || n > best.inliers || (n === best.inliers && r === 0 && best.rot !== 0)) best = { rot: r, dx, dz, inliers: n };
    }
  }
  return best && best.inliers >= 3 ? best : null;
}

// ---------------------------------------------------------------- scoring
const F1 = (t: Tally): number => (t.pred === 0 || t.expected === 0 || t.tp === 0 ? 0 : (2 * (t.tp / t.pred) * (t.tp / t.expected)) / ((t.tp / t.pred) + (t.tp / t.expected)));
export const F1_FIELDS = new Set(['rooms', 'openings', 'furniture', 'fixtures']);
const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function scoreSet(pred: Prediction, truth: TruthLite): SetScore {
  const S = newScore();
  const count = (key: string, n: number): void => { S.fields[key].expected += n; };
  // expected counts come from the truth alone, so a refused input still owes them
  const T = truth;
  const trRooms = T.rooms ?? [];
  const fixtureClasses = ['wc', 'basin', 'shower', 'sink', 'hob', 'chair'];
  const trFix = (T.symbols ?? []).filter((s) => fixtureClasses.includes(s.cls));
  const trDims = T.dimensions ?? [];
  const trElev = T.elevations ?? [];
  count('rooms', trRooms.length); count('roomSize', trRooms.length); count('roomArea', trRooms.length);
  count('openings', (T.openings ?? []).length); count('openingWidth', (T.openings ?? []).length);
  count('dimStrings', trDims.length);
  count('furniture', (T.items ?? []).length); count('furnitureSize', (T.items ?? []).length);
  count('fixtures', trFix.length);
  count('elevLink', trElev.filter((e) => e.wall).length);
  // heights: the ceiling once per set (when a sheet shows it), then each elevation's sills, heads and bed levels
  const heightTruth = (trElev.length ? [{ kind: 'ceiling', v: T.ceilingM! }] : []).concat(
    trElev.flatMap((e) => [...e.levels.filter((l) => l.kind === 'sill' || l.kind === 'head').map((l) => ({ kind: l.kind, v: l.heightM })), ...(e.bed ? [{ kind: 'bed-base', v: e.bed.baseTopM }, { kind: 'mattress-top', v: e.bed.mattressTopM }, { kind: 'headboard-top', v: e.bed.headboardTopM }] : [])]),
  );
  count('heights', heightTruth.length);
  count('unitBays', trElev.reduce((a, e) => a + e.units.length, 0));
  count('hinge', trElev.reduce((a, e) => a + e.units.reduce((b, u) => b + u.hinge.length, 0), 0));
  count('unitParts', trElev.reduce((a, e) => a + e.units.length * 4, 0));
  count('conflicts', trDims.filter((d) => d.planted).length);
  // everything the walk-through needs from the drawing, for the broker-share count
  const needed = trRooms.length * 3 + (T.openings ?? []).length + (T.items ?? []).length + trDims.length + heightTruth.length + trElev.reduce((a, e) => a + e.units.length, 0);
  S.values.n = needed;
  const notAttempted = (key: string, got: unknown): void => { if (got === undefined && S.fields[key].expected > 0) S.notAttempted.push(key); };
  if (!pred.attempted) { S.notAttempted = FIELDS.map((f) => f.key).filter((k) => S.fields[k].expected > 0); S.note.push(pred.error ?? 'not attempted'); return S; }
  notAttempted('rooms', pred.rooms); notAttempted('openings', pred.openings); notAttempted('dimStrings', pred.dimensions);
  notAttempted('furniture', pred.items); notAttempted('fixtures', pred.symbols); notAttempted('elevLink', pred.elevations);
  notAttempted('heights', pred.elevations ?? pred.ceiling); notAttempted('unitBays', pred.elevations?.some((e) => e.units) ? pred.elevations : undefined);
  notAttempted('hinge', pred.elevations?.some((e) => e.units) ? pred.elevations : undefined);
  notAttempted('unitParts', pred.elevations?.some((e) => e.units) ? pred.elevations : undefined);
  let dbg = '';
  const verifiedCheck = (status: Status, ok: boolean): void => { if (status === 'verified' || status === 'confirmed' || status === 'corrected') { S.verified.n++; if (!ok) { S.verified.wrong++; if (process.env.SCORE_DEBUG) console.log('  WRONG VERIFIED', dbg); } } };
  const credit = (status: Status, ok: boolean): void => { if (ok && isFact(status)) S.values.facts++; };

  // ---- rooms
  const pr = pred.rooms ?? [];
  const al = pr.length && trRooms.length ? alignRooms(pr, trRooms.map((r) => ({ polygonM: r.polygonM, roomType: r.roomType }))) : null;
  S.aligned = !!al && al.inliers > 0;
  // rooms give the frame when there are any; failing that, the dimension lines do (the alignment is used for positions only)
  // the link only needs the right room and the right side: a plan drawn at the wrong scale may still be lined up by a uniform factor for that
  let alLink = al && al.inliers > 0 ? al : null;
  if (!alLink && pr.length && trRooms.length) {
    const sizes = pr.map((q) => sides(q.polygon)[1]).sort((a, b) => a - b), tsz = trRooms.map((r) => r.lengthM).sort((a, b) => a - b);
    const k = tsz[tsz.length - 1] / sizes[sizes.length - 1];
    if (k > 0.4 && k < 2.5) { const a2 = alignRooms(pr, trRooms.map((r) => ({ polygonM: r.polygonM, roomType: r.roomType })), k); if (a2 && a2.inliers > 0) alLink = a2; }
  }
  const alDim = alignByDimensions(pred.dimensions ?? [], trDims);
  const alUse = alDim ?? (al && al.inliers > 0 ? al : null);
  const A = (p: Pt): Pt => (alUse ? apply(alUse, p) : p);
  // everything but dimensions keeps the room alignment
  const AR = (p: Pt): Pt => (al ? apply(al, p) : p);
  const roomHit = new Map<number, number>(); // pred index -> truth index
  if (al) {
    const used = new Set<number>();
    pr.forEach((q, i) => {
      const poly = q.polygon.map(AR); const c = centroid(poly);
      let bestK = -1, bestD = 0.6;
      trRooms.forEach((t, k) => { if (used.has(k)) return; const d = Math.hypot(c[0] - centroid(t.polygonM)[0], c[1] - centroid(t.polygonM)[1]); if (d < bestD) { bestD = d; bestK = k; } });
      if (bestK >= 0) { used.add(bestK); roomHit.set(i, bestK); }
    });
  }
  S.fields.rooms.pred += pr.length;
  pr.forEach((q, i) => {
    const k = roomHit.get(i);
    if (k === undefined) { verifiedCheck(q.status, false); return; }
    const t = trRooms[k];
    const typed = q.roomType === t.roomType;
    if (typed) { S.fields.rooms.tp++; S.fields.rooms.right++; }
    const [qs, ql] = sides(q.polygon); const area = polyArea(q.polygon);
    const sizeOk = within(qs, t.widthM, 0.02) && within(ql, t.lengthM, 0.02);
    const areaOk = within(area, t.areaM2, 0.03);
    if (sizeOk) S.fields.roomSize.right++;
    if (areaOk) S.fields.roomArea.right++;
    verifiedCheck(q.status, sizeOk && areaOk);
    credit(q.status, sizeOk); credit(q.status, areaOk); credit(q.status, typed);
  });

  // ---- openings
  const po = pred.openings ?? [];
  S.fields.openings.pred += po.length;
  const usedO = new Set<number>();
  for (const q of po) {
    const at = AR(q.at);
    const k = (T.openings ?? []).findIndex((t, i) => !usedO.has(i) && t.type === q.type && near(at, [t.at.x, t.at.z], 0.45));
    if (k < 0) { verifiedCheck(q.status, false); continue; }
    usedO.add(k);
    S.fields.openings.tp++; S.fields.openings.right++;
    const ok = Math.abs(q.widthM - T.openings![k].widthM) <= 0.05;
    if (ok) S.fields.openingWidth.right++;
    verifiedCheck(q.status, ok); credit(q.status, ok);
  }

  // ---- furniture and fixtures
  const pi = pred.items ?? [];
  S.fields.furniture.pred += pi.length;
  const usedI = new Set<number>();
  for (const q of pi) {
    const c = AR([q.box.cx, q.box.cz]);
    const k = (T.items ?? []).findIndex((t, i) => !usedI.has(i) && t.cls === q.cls && near(c, [t.box.cx, t.box.cz], 0.5));
    if (k < 0) { verifiedCheck(q.status, false); continue; }
    usedI.add(k);
    S.fields.furniture.tp++; S.fields.furniture.right++;
    const t = T.items![k];
    const a = [q.box.w, q.box.d].sort((x, y) => x - y), b = [t.box.w, t.box.d].sort((x, y) => x - y);
    const ok = Math.abs(a[0] - b[0]) <= 0.05 && Math.abs(a[1] - b[1]) <= 0.05;
    if (ok) S.fields.furnitureSize.right++;
    verifiedCheck(q.status, ok); credit(q.status, ok);
  }
  const ps = (pred.symbols ?? []).filter((q) => fixtureClasses.includes(q.cls));
  S.fields.fixtures.pred += ps.length;
  const usedS = new Set<number>();
  for (const q of ps) {
    const at = AR(q.at);
    const k = trFix.findIndex((t, i) => !usedS.has(i) && t.cls === q.cls && near(at, [(t.bboxM[0] + t.bboxM[2]) / 2, (t.bboxM[1] + t.bboxM[3]) / 2], 0.5));
    if (k >= 0) { usedS.add(k); S.fields.fixtures.tp++; S.fields.fixtures.right++; }
    verifiedCheck(q.status, k >= 0);
  }

  // ---- dimension strings
  const pd = pred.dimensions ?? [];
  const usedD = new Set<number>();
  // Pairing: a predicted dimension may fit several truth dimensions that print the same string (three "3' 2\"" in one elevation, one of
  // them printed 2 inches off). The pairs are made globally, closest length first, so a string is judged against the dimension it
  // was measured on and not against whichever twin comes first in the list.
  type Cand = { ti: number; pi: number; gap: number };
  const cands: Cand[] = [];
  const lenOf = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
  trDims.forEach((t, ti) => {
    const mid: Pt = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2];
    pd.forEach((q, pi) => {
      if (q.string !== t.string) return;
      if (t.view === 'plan' ? !(q.view === 'plan' && near(A([(q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2]), mid, 0.5)) : q.view !== 'elevation') return;
      cands.push({ ti, pi, gap: Math.abs(lenOf(q.a, q.b) - lenOf(t.a as Pt, t.b as Pt)) });
    });
  });
  cands.sort((x, y) => x.gap - y.gap);
  const usedT = new Set<number>();
  for (const c of cands) {
    if (usedT.has(c.ti) || usedD.has(c.pi)) continue;
    usedT.add(c.ti); usedD.add(c.pi);
    const t = trDims[c.ti]; const k = c.pi;
    S.fields.dimStrings.right++;
    const geometryOk = Math.abs(t.shownM - t.valueM) <= Math.max(0.02 * t.valueM, 0.0254);
    if (process.env.SCORE_DEBUG && !geometryOk && (pd[k].status === 'verified')) console.log('  verified but geometry off', JSON.stringify(t.string), 'shown', t.shownM, 'value', t.valueM, 'planted', t.planted);
    verifiedCheck(pd[k].status, geometryOk);
    credit(pd[k].status, geometryOk);
    if (t.planted && pd[k].status === 'conflict') S.fields.conflicts.right++;
  }
  pd.forEach((q, i) => { if (!usedD.has(i)) { if (process.env.SCORE_DEBUG && (q.status === 'verified' || q.status === 'confirmed' || q.status === 'corrected')) console.log('  unmatched verified dim', q.view, JSON.stringify(q.string), q.a.map((v) => v.toFixed(2)).join(','), 'cands', trDims.filter((t) => t.string === q.string).map((t) => `${t.view}@${((t.a[0] + t.b[0]) / 2).toFixed(2)},${((t.a[1] + t.b[1]) / 2).toFixed(2)}`).join(' ')); verifiedCheck(q.status, false); } });

  // ---- elevations
  const pe = pred.elevations ?? [];
  const matchedE = new Set<PredElevation>();
  // pairing: by caption; a view whose caption could not be read is paired with the truth view on the same page, top to bottom
  const pairOf = new Map<(typeof trElev)[number], PredElevation>();
  for (const t of trElev) {
    const q = pe.find((x) => !matchedE.has(x) && x.caption && (norm(x.caption) === norm(t.caption) || norm(x.caption) === norm(t.tag)));
    if (q) { matchedE.add(q); pairOf.set(t, q); }
  }
  const pages = [...new Set(trElev.map((t) => t.page))];
  for (const pg of pages) {
    const tl = trElev.filter((t) => t.page === pg && !pairOf.has(t));
    const ql = pe.filter((x) => !x.caption && !matchedE.has(x) && x.page !== undefined && x.page + 1 === pg).sort((a, b) => (a.top ?? 0) - (b.top ?? 0));
    tl.forEach((t, i) => { if (ql[i]) { matchedE.add(ql[i]); pairOf.set(t, ql[i]); } });
  }
  trElev.forEach((t) => {
    const q = pairOf.get(t);
    if (!q) return;
    if (t.wall && q.wall) {
      const room = trRooms.find((r) => r.id === t.wall!.roomId);
      if (room) {
        const p = room.polygonM, e = t.wall.edge;
        const m: Pt = [(p[e][0] + p[(e + 1) % p.length][0]) / 2, (p[e][1] + p[(e + 1) % p.length][1]) / 2];
        let ok = near(AR(q.wall.at), m, 0.35);
        // The wall is the right one when it is in the right room and looks the same way. (A sheet stretched along one axis, or a plan
        // that is not to scale, moves a wall's middle by more than a position check allows without changing which wall it is.)
        if (!ok && alLink && q.wall.normal && q.wall.roomAt) {
          const n = rot(q.wall.normal, alLink.rot);
          const [tx, tz] = [p[(e + 1) % p.length][0] - p[e][0], p[(e + 1) % p.length][1] - p[e][1]];
          const tl = Math.hypot(tx, tz) || 1;
          const tn: Pt = [tz / tl, -tx / tl];
          const c = apply(alLink, q.wall.roomAt);
          const nearest = trRooms.reduce((a, b) => (Math.hypot(centroid(b.polygonM)[0] - c[0], centroid(b.polygonM)[1] - c[1]) < Math.hypot(centroid(a.polygonM)[0] - c[0], centroid(a.polygonM)[1] - c[1]) ? b : a));
          ok = nearest.id === room.id && n[0] * tn[0] + n[1] * tn[1] > 0.9;
        }
        if (ok) S.fields.elevLink.right++;
      }
    }
    q.units?.forEach((u, k) => {
      const tu = t.units[k];
      dbg = `${t.id} ${t.caption} unit`;
      if (!tu) { verifiedCheck(u.status, false); return; }
      const ok = u.bays === tu.bays && u.shuttersPerBay.join() === tu.shuttersPerBay.join();
      if (ok) S.fields.unitBays.right++;
      verifiedCheck(u.status, ok); credit(u.status, ok);
      u.hinge.forEach((h, j) => {
        const hok = h === tu.hinge[j];
        if (hok) S.fields.hinge.right++;
        // a side marked verified must be the right side (the honesty bar): unknown and conflict are never claims
        dbg = `${t.id} ${t.caption} hinge ${j} ${h} vs ${tu.hinge[j]}`;
        const hs = u.hingeStatus?.[j];
        if (hs && h !== 'unknown' && h !== 'conflict') verifiedCheck(hs, hok);
      });
      const parts: [keyof NonNullable<typeof u.partStatus>, number | undefined, number | undefined][] = [
        ['drawerStripM', u.drawerStripM, tu.drawerStripM], ['baseGapM', u.baseGapM, tu.baseGapM], ['loftM', u.loftM, tu.loftM], ['heightM', u.heightM, tu.heightM],
      ];
      for (const [name, got, want] of parts) {
        const pok = got !== undefined && want !== undefined && Math.abs(got - want) <= 0.02;
        if (pok) S.fields.unitParts.right++;
        dbg = `${t.id} ${t.caption} part ${name} ${got} vs ${want}`;
        const ps = u.partStatus?.[name];
        if (ps && got !== undefined) verifiedCheck(ps, pok);
      }
    });
    // heights: each predicted level is paired with the nearest unused truth level of its kind (a wall can hold two windows)
    const truthLevels: { kind: string; v: number }[] = [
      ...t.levels.filter((l) => l.kind === 'sill' || l.kind === 'head').map((l) => ({ kind: l.kind, v: l.heightM })),
      ...(t.bed ? [{ kind: 'bed-base', v: t.bed.baseTopM }, { kind: 'mattress-top', v: t.bed.mattressTopM }, { kind: 'headboard-top', v: t.bed.headboardTopM }] : []),
    ];
    const usedL = new Set<number>();
    for (const h of q.heights ?? []) {
      if (h.kind === 'ceiling') continue; // counted once per set below
      dbg = `${t.id} ${t.caption} height ${h.kind} ${h.v.toFixed(3)}`;
      let bestK = -1, bestD = Infinity;
      truthLevels.forEach((l, i) => { if (usedL.has(i) || l.kind !== h.kind) return; const d = Math.abs(l.v - h.v); if (d < bestD) { bestD = d; bestK = i; } });
      const ok = bestK >= 0 && bestD <= 0.02;
      if (bestK >= 0) usedL.add(bestK);
      if (ok) S.fields.heights.right++;
      verifiedCheck(h.status, ok); credit(h.status, ok);
    }
  });
  // a view that matches no elevation of the truth (a misread caption, a block taken for a view): whatever it claims as a fact is wrong
  for (const q of pe) {
    if (matchedE.has(q)) continue;
    for (const h of q.heights ?? []) if (h.kind !== 'ceiling') verifiedCheck(h.status, false);
    for (const u of q.units ?? []) verifiedCheck(u.status, false);
  }
  // the ceiling: the set-level value, or the best of those read off the elevations; counted once
  const ceilings = [...(pred.ceiling ? [pred.ceiling] : []), ...pe.flatMap((q) => (q.heights ?? []).filter((h) => h.kind === 'ceiling').map((h) => ({ v: h.v, status: h.status })))];
  if (trElev.length && ceilings.length) {
    const hit = ceilings.find((c) => Math.abs(c.v - T.ceilingM!) <= 0.02);
    if (hit) S.fields.heights.right++;
    dbg = 'ceiling';
    for (const c of ceilings) { const ok = Math.abs(c.v - T.ceilingM!) <= 0.02; verifiedCheck(c.status, ok); if (hit && c === hit) credit(c.status, ok); }
  } else for (const c of ceilings) verifiedCheck(c.status, false);
  return S;
}

// ---------------------------------------------------------------- aggregate and report
export function addScores(into: SetScore, s: SetScore): void {
  for (const k of Object.keys(s.fields)) for (const f of ['right', 'expected', 'tp', 'pred'] as const) into.fields[k][f] += s.fields[k][f];
  into.verified.n += s.verified.n; into.verified.wrong += s.verified.wrong;
  into.values.n += s.values.n; into.values.facts += s.values.facts;
  for (const k of s.notAttempted) if (!into.notAttempted.includes(k)) into.notAttempted.push(k);
}
export interface FieldResult { key: string; rate: number | null; detail: string; bar: number | null; pass: boolean | null; notAttempted: boolean }
export function summarise(total: SetScore, variant: Variant, allowed: Set<string> | null = null): FieldResult[] {
  return FIELDS.filter((f) => !allowed || allowed.has(f.key)).map((f) => {
    const bar = variant === 'vector' ? f.vector : f.raster;
    const t = total.fields[f.key];
    let rate: number | null; let detail: string;
    if (f.key === 'wrongVerified') { rate = total.verified.n ? total.verified.wrong / total.verified.n : null; detail = `${total.verified.wrong} of ${total.verified.n} verified values`; }
    else if (f.key === 'brokerShare') { rate = total.values.n ? 1 - total.values.facts / total.values.n : null; detail = `${total.values.n - total.values.facts} of ${total.values.n} values`; }
    else if (F1_FIELDS.has(f.key)) { rate = t.expected ? F1(t) : null; detail = `tp ${t.tp}, found ${t.pred}, truth ${t.expected}`; }
    else { rate = t.expected ? t.right / t.expected : null; detail = `${t.right} of ${t.expected}`; }
    const na = total.notAttempted.includes(f.key);
    const pass = rate === null || bar === null ? null : f.dir === 'min' ? rate >= bar : rate <= bar;
    return { key: f.key, rate, detail, bar, pass, notAttempted: na };
  });
}
