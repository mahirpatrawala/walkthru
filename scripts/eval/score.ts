// C12a scoring harness: compare one Prediction with one truth and return counters per field (SPEC 17.11).
// Counters add up across sets; rates and the bar check come from `summarise`.
import { isFact } from '../../src/understand/types';
import type { Status } from '../../src/understand/types';
import type { Prediction, Pt, TruthLite } from './types';
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

export interface Align { rot: 0 | 90 | 180 | 270; dx: number; dz: number; inliers: number }
/** Find the rotation (quarter turns only) and shift that bring the predicted rooms onto the truth rooms. */
export function alignRooms(pred: { polygon: Pt[]; roomType: string }[], truth: { polygonM: Pt[]; roomType: string }[]): Align | null {
  let best: Align | null = null;
  for (const r of [0, 90, 180, 270] as const) {
    const P = pred.map((q) => ({ poly: q.polygon.map((p) => rot(p, r)), type: q.roomType }));
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
        if (!best || inl > best.inliers || (inl === best.inliers && r === 0 && best.rot !== 0)) best = { rot: r, dx, dz, inliers: inl };
      }
    }
  }
  return best;
}
const apply = (a: Align, p: Pt): Pt => { const q = rot(p, a.rot); return [q[0] + a.dx, q[1] + a.dz]; };

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
  const verifiedCheck = (status: Status, ok: boolean): void => { if (status === 'verified' || status === 'confirmed' || status === 'corrected') { S.verified.n++; if (!ok) S.verified.wrong++; } };
  const credit = (status: Status, ok: boolean): void => { if (ok && isFact(status)) S.values.facts++; };

  // ---- rooms
  const pr = pred.rooms ?? [];
  const al = pr.length && trRooms.length ? alignRooms(pr, trRooms.map((r) => ({ polygonM: r.polygonM, roomType: r.roomType }))) : null;
  S.aligned = !!al && al.inliers > 0;
  const A = (p: Pt): Pt => (al ? apply(al, p) : p);
  const roomHit = new Map<number, number>(); // pred index -> truth index
  if (al) {
    const used = new Set<number>();
    pr.forEach((q, i) => {
      const poly = q.polygon.map(A); const c = centroid(poly);
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
    const at = A(q.at);
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
    const c = A([q.box.cx, q.box.cz]);
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
    const at = A(q.at);
    const k = trFix.findIndex((t, i) => !usedS.has(i) && t.cls === q.cls && near(at, [(t.bboxM[0] + t.bboxM[2]) / 2, (t.bboxM[1] + t.bboxM[3]) / 2], 0.5));
    if (k >= 0) { usedS.add(k); S.fields.fixtures.tp++; S.fields.fixtures.right++; }
    verifiedCheck(q.status, k >= 0);
  }

  // ---- dimension strings
  const pd = pred.dimensions ?? [];
  const usedD = new Set<number>();
  trDims.forEach((t) => {
    const mid: Pt = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2];
    const k = pd.findIndex((q, i) => !usedD.has(i) && q.string === t.string && (t.view === 'plan' ? q.view === 'plan' && near(A([(q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2]), mid, 0.5) : q.view === 'elevation'));
    if (k < 0) return;
    usedD.add(k);
    S.fields.dimStrings.right++;
    const geometryOk = Math.abs(t.shownM - t.valueM) <= Math.max(0.02 * t.valueM, 0.0254);
    verifiedCheck(pd[k].status, geometryOk);
    credit(pd[k].status, geometryOk);
    if (t.planted && pd[k].status === 'conflict') S.fields.conflicts.right++;
  });
  pd.forEach((q, i) => { if (!usedD.has(i)) verifiedCheck(q.status, false); });

  // ---- elevations
  const pe = pred.elevations ?? [];
  trElev.forEach((t) => {
    const q = pe.find((x) => norm(x.caption) === norm(t.caption) || norm(x.caption) === norm(t.tag));
    if (!q) return;
    if (t.wall && q.wall) {
      const room = trRooms.find((r) => r.id === t.wall!.roomId);
      if (room) {
        const p = room.polygonM, e = t.wall.edge;
        const m: Pt = [(p[e][0] + p[(e + 1) % p.length][0]) / 2, (p[e][1] + p[(e + 1) % p.length][1]) / 2];
        if (near(A(q.wall.at), m, 0.35)) S.fields.elevLink.right++;
      }
    }
    q.units?.forEach((u, k) => {
      const tu = t.units[k];
      if (!tu) return;
      const ok = u.bays === tu.bays && u.shuttersPerBay.join() === tu.shuttersPerBay.join();
      if (ok) S.fields.unitBays.right++;
      verifiedCheck(u.status, ok); credit(u.status, ok);
      u.hinge.forEach((h, j) => { if (h === tu.hinge[j]) S.fields.hinge.right++; });
    });
    for (const h of q.heights ?? []) {
      if (h.kind === 'ceiling') continue; // counted once per set below
      const truthV = h.kind === 'ceiling' ? t.ceilingM : h.kind === 'bed-base' ? t.bed?.baseTopM : h.kind === 'mattress-top' ? t.bed?.mattressTopM : h.kind === 'headboard-top' ? t.bed?.headboardTopM : t.levels.find((l) => l.kind === h.kind)?.heightM;
      const ok = truthV !== undefined && Math.abs(h.v - truthV) <= 0.02;
      if (ok) S.fields.heights.right++;
      verifiedCheck(h.status, ok); credit(h.status, ok);
    }
  });
  // the ceiling: the set-level value, or the best of those read off the elevations; counted once
  const ceilings = [...(pred.ceiling ? [pred.ceiling] : []), ...pe.flatMap((q) => (q.heights ?? []).filter((h) => h.kind === 'ceiling').map((h) => ({ v: h.v, status: h.status })))];
  if (trElev.length && ceilings.length) {
    const hit = ceilings.find((c) => Math.abs(c.v - T.ceilingM!) <= 0.02);
    if (hit) S.fields.heights.right++;
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
