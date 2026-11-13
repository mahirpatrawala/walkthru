// Scoring against "label-v1" truth: rooms read off the printed labels of a real drawing (name, type, printed size). The truth carries
// no geometry, so rooms are paired by size and label instead of by position, and the honesty check judges only values that can be
// compared with a printed label. Nothing here knows any file, firm or project.
import type { Status } from '../../src/understand/types';

export interface LabelTruthRoom { name: string; roomType: string; widthM?: number; lengthM?: number; areaM2?: number; printed: string[]; note?: string }
export interface LabelTruth { schema: 'label-v1'; rooms: LabelTruthRoom[]; dimStrings?: string[]; conflicts?: { what: string; kind: string }[] }
export interface LabelPredRoom { label: string; roomType: string; sides: [number, number]; areaM2: number; status: Status; labelDims?: { w: number; l: number }; /** how the room's outline was found: 'walls', 'walls+strokes' or 'label-rect' (a rectangle of the printed size, so its size is the label, not a measurement) */ method?: string }
export interface LabelPrediction { attempted: boolean; error?: string; rooms: LabelPredRoom[]; seconds?: number }

export interface LabelScore {
  attempted: boolean; error?: string;
  truthRooms: number; truthSized: number; predRooms: number;
  matched: number; typed: number; sizeRight: number; areaRight: number;
  /** paired rooms whose outline came from drawn walls (not a rectangle made from the label), and how many of those have the right size */
  wallMatched: number; wallSizeRight: number;
  /** printed sizes the reader parsed from the label (labelDims) and got right, out of truth rooms with a printed size */
  labelRead: number;
  /** verified (or confirmed or corrected) rooms: matched and wrong, matched and right, and not comparable with any printed label */
  verified: { right: number; wrong: number; unjudged: number };
  /** verified values counting an unmatched verified room as wrong (the strict reading) */
  verifiedStrict: { n: number; wrong: number };
  /** rooms whose drawn size differs from the printed label by more than 5%: how the reader treated them */
  disagree: { n: number; conflict: number; verified: number; unverified: number };
  /** value counts for the broker share: three per truth room, and how many were produced right as a fact */
  values: { n: number; facts: number };
  wrongDetail: string[]; missedDetail: string[]; wrongTypeDetail: string[];
}

export const norm = (s: string): string => s.toUpperCase().replace(/\(.*?\)/g, '').replace(/[^A-Z]/g, '');
const isFact = (s: Status): boolean => s === 'verified' || s === 'confirmed' || s === 'corrected';
const rel = (a: number, b: number): number => Math.abs(a / b - 1);

export function scoreLabelSet(pred: LabelPrediction, truth: LabelTruth): LabelScore {
  const tr = truth.rooms;
  const S: LabelScore = {
    attempted: pred.attempted, error: pred.error, truthRooms: tr.length, truthSized: tr.filter((r) => r.widthM && r.lengthM).length, predRooms: pred.rooms.length,
    matched: 0, typed: 0, sizeRight: 0, areaRight: 0, wallMatched: 0, wallSizeRight: 0, labelRead: 0, verified: { right: 0, wrong: 0, unjudged: 0 }, verifiedStrict: { n: 0, wrong: 0 },
    disagree: { n: 0, conflict: 0, verified: 0, unverified: 0 }, values: { n: tr.filter((r) => r.widthM).length * 3 + tr.filter((r) => !r.widthM).length, facts: 0 }, wrongDetail: [], missedDetail: [], wrongTypeDetail: [],
  };
  if (!pred.attempted) { S.missedDetail = tr.map((r) => r.name); return S; }
  const sorted = (r: LabelTruthRoom): [number, number] => [Math.min(r.widthM!, r.lengthM!), Math.max(r.widthM!, r.lengthM!)];
  // pairing: label equal and size within 25%, then size alone within 15%; closest first
  const pairs: { p: number; t: number; d: number; pass: number }[] = [];
  pred.rooms.forEach((q, p) => tr.forEach((t, ti) => {
    const sameLabel = norm(q.label) !== '' && norm(q.label) === norm(t.name);
    if (t.widthM && t.lengthM) {
      const ts = sorted(t); const d = Math.max(rel(q.sides[0], ts[0]), rel(q.sides[1], ts[1]));
      if (sameLabel && d < 0.25) pairs.push({ p, t: ti, d, pass: 0 });
      else if (d < 0.15) pairs.push({ p, t: ti, d, pass: 1 });
    } else if (sameLabel) pairs.push({ p, t: ti, d: 0, pass: 0 });
  }));
  pairs.sort((a, b) => a.pass - b.pass || a.d - b.d);
  const usedP = new Set<number>(), usedT = new Set<number>(); const hit = new Map<number, number>();
  for (const c of pairs) { if (usedP.has(c.p) || usedT.has(c.t)) continue; usedP.add(c.p); usedT.add(c.t); hit.set(c.p, c.t); }
  pred.rooms.forEach((q, p) => {
    const ti = hit.get(p);
    if (isFact(q.status)) S.verifiedStrict.n++;
    if (ti === undefined) { if (isFact(q.status)) { S.verifiedStrict.wrong++; S.verified.unjudged++; } return; }
    const t = tr[ti]; S.matched++;
    const typed = q.roomType === t.roomType;
    if (typed) S.typed++; else S.wrongTypeDetail.push(`${t.name}: read as ${q.roomType}, printed type ${t.roomType}`);
    let sizeOk = true, areaOk = true;
    if (t.widthM && t.lengthM) {
      const ts = sorted(t);
      sizeOk = rel(q.sides[0], ts[0]) <= 0.02 && rel(q.sides[1], ts[1]) <= 0.02;
      areaOk = rel(q.areaM2, t.widthM * t.lengthM) <= 0.03;
      if (sizeOk) S.sizeRight++; if (areaOk) S.areaRight++;
      if (q.method && q.method !== 'label-rect') { S.wallMatched++; if (sizeOk) S.wallSizeRight++; }
      if (!sizeOk) S.wrongDetail.push(`${t.name}: drawn ${q.sides[0].toFixed(2)}x${q.sides[1].toFixed(2)} m, printed ${ts[0].toFixed(2)}x${ts[1].toFixed(2)} m [${q.status}]`);
      if (q.labelDims) {
        const ld = [Math.min(q.labelDims.w, q.labelDims.l), Math.max(q.labelDims.w, q.labelDims.l)];
        if (rel(ld[0], ts[0]) <= 0.02 && rel(ld[1], ts[1]) <= 0.02) S.labelRead++;
      }
      const off = Math.max(rel(q.sides[0], ts[0]), rel(q.sides[1], ts[1])) > 0.05;
      if (off) { S.disagree.n++; if (q.status === 'conflict') S.disagree.conflict++; else if (isFact(q.status)) S.disagree.verified++; else S.disagree.unverified++; }
      if (sizeOk && areaOk && isFact(q.status)) S.values.facts += 2;
    }
    if (typed && isFact(q.status)) S.values.facts += 1;
    if (isFact(q.status)) {
      const ok = sizeOk && areaOk;
      if (t.widthM && t.lengthM) { if (ok) S.verified.right++; else { S.verified.wrong++; S.verifiedStrict.wrong++; } } else S.verified.unjudged++;
    }
  });
  tr.forEach((t, ti) => { if (!usedT.has(ti)) S.missedDetail.push(`${t.name}${t.widthM ? ` ${t.widthM.toFixed(2)}x${t.lengthM!.toFixed(2)}` : ''}`); });
  return S;
}

export function addLabel(into: LabelScore, s: LabelScore): void {
  for (const k of ['truthRooms', 'truthSized', 'predRooms', 'matched', 'typed', 'sizeRight', 'areaRight', 'wallMatched', 'wallSizeRight', 'labelRead'] as const) into[k] += s[k];
  for (const k of ['right', 'wrong', 'unjudged'] as const) into.verified[k] += s.verified[k];
  into.verifiedStrict.n += s.verifiedStrict.n; into.verifiedStrict.wrong += s.verifiedStrict.wrong;
  for (const k of ['n', 'conflict', 'verified', 'unverified'] as const) into.disagree[k] += s.disagree[k];
  into.values.n += s.values.n; into.values.facts += s.values.facts;
}
export const blankLabel = (): LabelScore => ({ attempted: true, truthRooms: 0, truthSized: 0, predRooms: 0, matched: 0, typed: 0, sizeRight: 0, areaRight: 0, wallMatched: 0, wallSizeRight: 0, labelRead: 0, verified: { right: 0, wrong: 0, unjudged: 0 }, verifiedStrict: { n: 0, wrong: 0 }, disagree: { n: 0, conflict: 0, verified: 0, unverified: 0 }, values: { n: 0, facts: 0 }, wrongDetail: [], missedDetail: [], wrongTypeDetail: [] });

const f1 = (tp: number, pred: number, truth: number): number | null => (!truth ? null : !pred || !tp ? 0 : (2 * (tp / pred) * (tp / truth)) / (tp / pred + tp / truth));
const pct = (x: number | null, d = 0): string => (x === null ? 'n/a' : `${(x * 100).toFixed(d)}%`);
/** Rows of the SPEC 17.11 table that a label truth can score, for one group of sets. */
export function summariseLabel(t: LabelScore): { key: string; label: string; value: string; detail: string; bar: string }[] {
  const wvRate = t.verified.right + t.verified.wrong ? t.verified.wrong / (t.verified.right + t.verified.wrong) : null;
  const strictRate = t.verifiedStrict.n ? t.verifiedStrict.wrong / t.verifiedStrict.n : null;
  return [
    { key: 'rooms', label: 'Rooms found and typed (F1)', value: pct(f1(t.typed, t.predRooms, t.truthRooms)), detail: `typed tp ${t.typed}, found ${t.predRooms}, truth ${t.truthRooms}; paired ${t.matched}`, bar: '>=92% vec / 80% ras' },
    { key: 'roomSize', label: 'Room width and length vs printed (2%)', value: pct(t.truthSized ? t.sizeRight / t.truthSized : null), detail: `${t.sizeRight} of ${t.truthSized} printed sizes`, bar: '>=90% / 70%' },
    { key: 'roomArea', label: 'Room area vs printed (3%)', value: pct(t.truthSized ? t.areaRight / t.truthSized : null), detail: `${t.areaRight} of ${t.truthSized}`, bar: '>=90% / 70%' },
    { key: 'wallSize', label: 'Of those, rooms outlined by drawn walls: size right', value: pct(t.wallMatched ? t.wallSizeRight / t.wallMatched : null), detail: `${t.wallSizeRight} of ${t.wallMatched} paired rooms came from walls; the other ${t.matched - t.wallMatched} are rectangles made from the label`, bar: 'n/a (shows how much of the size score is a label echo)' },
    { key: 'labelRead', label: 'Printed room size read from the label (2%)', value: pct(t.truthSized ? t.labelRead / t.truthSized : null), detail: `${t.labelRead} of ${t.truthSized}`, bar: 'none (dimension strings >=95% / 85%)' },
    { key: 'wrongVerified', label: 'Verified values that are wrong', value: pct(wvRate, 1), detail: `${t.verified.wrong} wrong of ${t.verified.right + t.verified.wrong} verified rooms that could be compared (${t.verified.unjudged} verified rooms not in truth). Strict, counting those as wrong: ${t.verifiedStrict.wrong} of ${t.verifiedStrict.n} = ${pct(strictRate, 1)}`, bar: '<=0.5%' },
    { key: 'conflicts', label: 'Drawn size vs printed label off by >5%: flagged conflict', value: pct(t.disagree.n ? t.disagree.conflict / t.disagree.n : null), detail: `${t.disagree.conflict} flagged, ${t.disagree.unverified} left unverified, ${t.disagree.verified} marked verified, of ${t.disagree.n}`, bar: '>=95% / 80%' },
    { key: 'brokerShare', label: 'Share of room values the broker must look at', value: pct(t.values.n ? 1 - t.values.facts / t.values.n : null), detail: `${t.values.n - t.values.facts} of ${t.values.n}`, bar: '<=30% / 100%' },
  ];
}
