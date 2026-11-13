// C12e. SPEC 17.9: the broker's review queue as pure data. From an understanding file and the decisions made so far this builds the
// rows the editor step shows (conflicts first, then unverified values by impact), the one-line "how it was read" sentence, the
// progress counter, and the parser for a typed correction. No DOM, no node, no network: the editor step and the server both use it.
//
// SPEC-GAP: 17.6 defines `UnderstandingFile` and `ReviewFile` but `understand/types.ts` (C12a) has only the status vocabulary, and the
// C12c writers are not there yet. They are declared here with the 17.6 shapes, plus one optional field (`ceiling`, the plan-level
// wall height). C12c can move them into `types.ts`; nothing here depends on where they live.
import { formatArea } from '../core/units';
import type { Extracted, Method, SourceRef, Status } from './types';
import { isFact } from './types';
import { parseLengthLoose, parseSizeLoose } from './units';

// ---------------------------------------------------------------- the file shapes (17.6)
export interface UnitDesign {
  bays: Extracted<number>; bayWidths: Extracted<number>[];
  shuttersPerBay: Extracted<number>[]; hinge: Extracted<'left' | 'right' | 'outer-edges' | 'unknown'>[];
  drawerStrip?: Extracted<number>; baseGap?: Extracted<number>; loft?: Extracted<number>;
  handle?: { y: Extracted<number>; length: Extracted<number> };
}
export type Pt2 = [number, number];
export interface UnderstandingDoc {
  version: 1;
  input: { kind: 'vector-pdf' | 'raster-pdf' | 'image'; pages: number; sha256: string };
  views: { id: string; page: number; kind: string; kindConfidence: number; raster: boolean; scale?: Extracted<number> }[];
  dimensions: { id: string; view: string; a: Pt2; b: Pt2; value: Extracted<number>; chain?: string }[];
  rooms: { id: string; label: Extracted<string>; roomType: Extracted<string>; polygonM: Pt2[]; width: Extracted<number>; length: Extracted<number>; area: Extracted<number> }[];
  openings: { id: string; roomId: string; type: Extracted<string>; width: Extracted<number>; sill?: Extracted<number>; head?: Extracted<number> }[];
  items: { id: string; kind: Extracted<string>; label?: Extracted<string>; box: { cx: number; cz: number; w: Extracted<number>; d: Extracted<number>; yawDeg: number };
           height?: Extracted<number>; surfaceHeight?: Extracted<number>; unit?: UnitDesign; elevationView?: string }[];
  symbols: { id: string; view: string; class: Extracted<string>; bbox: [number, number, number, number]; mappedTo?: string }[];
  elevations?: { view: string; wall?: Extracted<{ roomId: string; edge: number }>; ceiling?: Extracted<number>; levels: Extracted<number>[] }[];
  /** the plan-level wall height (a vector import finds one number; C12c's per-elevation ceilings are in `elevations`) */
  ceiling?: Extracted<number>;
  conflicts: { id: string; field: string; values: string[]; message: string }[];
  warnings: string[];
  cost?: { visionCalls: number; inputTokens: number; outputTokens: number; usd: number; seconds: number };
}
export interface Decision { action: 'confirm' | 'correct' | 'reject'; value?: unknown; at: string }
export interface ReviewFile { version: 1; decisions: Record<string, Decision> }
export const emptyReview = (): ReviewFile => ({ version: 1, decisions: {} });

// ---------------------------------------------------------------- what a row edits
export type RowKind = 'room-size' | 'opening' | 'item-size' | 'unit' | 'height' | 'dimension';
export type InputKind = 'size' | 'length' | 'opening' | 'count' | 'hinge';
export type Target =
  | { kind: 'room'; roomId: string }
  | { kind: 'opening'; openingId: string; prop: 'width' | 'sill' | 'head' }
  | { kind: 'item-size'; itemId: string }
  | { kind: 'item-prop'; itemId: string; prop: 'height' | 'surfaceHeight' }
  | { kind: 'unit'; itemId: string; prop: 'bays' | 'bayWidth' | 'shuttersPerBay' | 'hinge' | 'drawerStrip' | 'baseGap' | 'loft'; index: number }
  | { kind: 'ceiling' }
  | { kind: 'elevation'; view: string; prop: 'ceiling' | 'level'; index: number }
  | { kind: 'dimension'; id: string };

export type RowState = 'verified' | 'conflict' | 'needs' | 'confirmed' | 'corrected' | 'rejected';
export interface RowAlt { display: string; value: unknown; how: string; source?: SourceRef }
export interface ReviewRow {
  /** the primary Extracted id: the key of the decision in review.json */
  id: string;
  /** every Extracted id this row's decision applies to */
  ids: string[];
  kind: RowKind;
  target: Target;
  input: InputKind;
  title: string;
  /** the machine value as the broker reads it: "3.66 × 3.20 m · 12'0" × 10'6"" */
  display: string;
  value: unknown;
  /** what the machine said, before any decision */
  baseStatus: Status;
  state: RowState;
  method: Method;
  confidence: number;
  how: string;
  source: SourceRef;
  alternatives: RowAlt[];
  conflict?: string;
  /** what the main value is, for the two sides of a disagreement: "printed on the drawing" or "measured on the drawing" */
  primaryHow: string;
  decision?: Decision;
  /** 0 conflict, 1 room sizes, 2 doors and windows, 3 built-ins, 4 heights, 5 printed dimensions */
  rank: number;
}

export const RANK_NAMES = ['Disagreements', 'Room sizes', 'Doors and windows', 'Built-in furniture', 'Heights', 'Printed dimensions'];

// ---------------------------------------------------------------- formatting
const M_PER_IN = 0.0254;
/** 9'-6" or 2'-3½": to the nearest half inch, the way drawings print it. */
export const fmtFtIn = (m: number): string => {
  const halves = Math.round(m / (M_PER_IN / 2));
  const inch = Math.floor((halves % 24) / 2), half = halves % 2;
  return `${Math.floor(halves / 24)}'-${inch}${half ? '½' : ''}"`;
};
export const fmtLen = (m: number): string => `${m.toFixed(2)} m · ${fmtFtIn(m)}`;
export const fmtSize = (a: number, b: number): string => `${a.toFixed(2)} × ${b.toFixed(2)} m · ${fmtFtIn(a)} × ${fmtFtIn(b)}`;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The sentence under a value: where it came from and how far to trust it (SPEC 17.9). */
export function howRead(e: Extracted<unknown>): string {
  if (e.status === 'conflict') return 'two readings disagree, so nothing was picked';
  if (e.status === 'verified') return e.method === 'pdf-text' ? 'read from the drawing and matches its scale' : e.method === 'ocr' ? 'read by OCR and matches the drawing\'s scale' : 'read from the drawing\'s lettering and matches its scale';
  if (e.status === 'confirmed') return 'confirmed by the broker';
  if (e.status === 'corrected') return 'typed by the broker';
  switch (e.method) {
    case 'pdf-text': return 'read from the drawing\'s text, not checked against its scale';
    case 'glyph': return 'read from the drawing\'s lettering, not checked';
    case 'ocr': return 'read by OCR, not checked';
    case 'vector': return 'measured from the drawing, no dimension printed';
    case 'vision': return 'read by AI, not checked';
    case 'derived': return e.derivedFrom?.how ? `worked out: ${e.derivedFrom.how}` : 'worked out from other values, not checked';
    case 'broker': return 'typed by the broker';
  }
}

// ---------------------------------------------------------------- walking the file
type Anyx = Extracted<unknown>;
/** Every Extracted value in the file, so statuses can be set by id. */
export function allExtracted(doc: UnderstandingDoc): Anyx[] {
  const out: Anyx[] = [];
  const add = (e: Anyx | undefined): void => { if (e) out.push(e); };
  for (const v of doc.views) add(v.scale);
  for (const d of doc.dimensions) add(d.value);
  for (const r of doc.rooms) { add(r.label); add(r.roomType); add(r.width); add(r.length); add(r.area); }
  for (const o of doc.openings) { add(o.type); add(o.width); add(o.sill); add(o.head); }
  for (const i of doc.items) {
    add(i.kind); add(i.label); add(i.box.w); add(i.box.d); add(i.height); add(i.surfaceHeight);
    const u = i.unit;
    if (u) { add(u.bays); u.bayWidths.forEach(add); u.shuttersPerBay.forEach(add); u.hinge.forEach(add); add(u.drawerStrip); add(u.baseGap); add(u.loft); add(u.handle?.y); add(u.handle?.length); }
  }
  for (const s of doc.symbols) add(s.class);
  for (const e of doc.elevations ?? []) { add(e.wall); add(e.ceiling); e.levels.forEach(add); }
  add(doc.ceiling);
  return out;
}

const minConf = (...xs: (Anyx | undefined)[]): number => Math.min(...xs.filter((x): x is Anyx => !!x).map((x) => x.confidence));
/** The worst status of several: a conflict beats unverified beats a fact. */
const worst = (...xs: (Anyx | undefined)[]): Status => {
  const s = xs.filter((x): x is Anyx => !!x).map((x) => x.status);
  if (s.includes('conflict')) return 'conflict';
  if (s.includes('unverified')) return 'unverified';
  if (s.every((x) => x === 'verified')) return 'verified';
  return s.find((x) => x === 'confirmed' || x === 'corrected') ?? 'verified';
};
const typeName = (t: string): string => (t === 'door' ? 'Door' : t === 'window' ? 'Window' : t === 'opening' ? 'Opening' : t);
const kindName = (k: string): string => k.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const altsOf = (e: Anyx, fmt: (v: unknown) => string): RowAlt[] => (e.alternatives ?? []).map((a) => ({ display: fmt(a.value), value: a.value, how: a.method === 'vector' ? 'measured on the drawing' : a.method === 'pdf-text' ? 'printed on the drawing' : `read by ${a.method}`, source: a.source }));

interface Base { ids: string[]; kind: RowKind; target: Target; input: InputKind; title: string; display: string; value: unknown; ex: Anyx; status: Status; confidence: number; alternatives?: RowAlt[]; conflict?: string; rank: number }

/** All rows for a file, before decisions: one per thing a broker can check. */
function baseRows(doc: UnderstandingDoc): Base[] {
  const rows: Base[] = [];
  const conflictFor = (field: string): string | undefined => doc.conflicts.find((c) => c.field === field)?.message;
  const roomLabel = new Map(doc.rooms.map((r) => [r.id, r.label.value || 'Room']));
  for (const r of doc.rooms) {
    const status = worst(r.width, r.length);
    const w = r.width.value, l = r.length.value;
    rows.push({
      ids: [r.width.id, r.length.id, r.area.id], kind: 'room-size', target: { kind: 'room', roomId: r.id }, input: 'size',
      title: `${r.label.value || 'Room'} · size`, display: `${fmtSize(w, l)} · ${formatArea(r.area.value).text}`, value: [w, l], ex: r.width, status,
      confidence: minConf(r.width, r.length), rank: 1,
      alternatives: (() => {
        const aw = r.width.alternatives?.[0], al = r.length.alternatives?.[0];
        if (aw && al && num(aw.value) && num(al.value)) return [{ display: fmtSize(aw.value, al.value), value: [aw.value, al.value], how: 'printed in the room label', source: aw.source }];
        // a picture's reader keeps the printed size as the source text of the measured one: offer it as the other side of a disagreement
        const printed = status === 'conflict' && r.width.source.text ? parseSizeLoose(r.width.source.text) : null;
        return printed ? [{ display: fmtSize(printed.w, printed.l), value: [printed.w, printed.l], how: 'printed in the room label', source: r.width.source }] : [];
      })(),
      conflict: conflictFor(`rooms.${r.id}.size`),
    });
  }
  for (const o of doc.openings) {
    const room = roomLabel.get(o.roomId) ?? 'Room';
    rows.push({
      ids: [o.width.id, o.type.id], kind: 'opening', target: { kind: 'opening', openingId: o.id, prop: 'width' }, input: 'opening',
      title: `${typeName(o.type.value)} · ${room} · width`, display: fmtLen(o.width.value), value: o.width.value, ex: o.width, status: worst(o.width, o.type),
      confidence: minConf(o.width, o.type), rank: 2, alternatives: altsOf(o.width, (v) => (num(v) ? fmtLen(v) : String(v))),
    });
    // a window or door's own sill and head, when the drawing gave them
    for (const [prop, e] of [['sill', o.sill], ['head', o.head]] as const) if (e) {
      rows.push({
        ids: [e.id], kind: 'opening', target: { kind: 'opening', openingId: o.id, prop }, input: 'length', title: `${typeName(o.type.value)} · ${room} · ${prop}`,
        display: fmtLen(e.value), value: e.value, ex: e, status: e.status, confidence: e.confidence, rank: 4,
      });
    }
  }
  for (const it of doc.items) {
    const name = it.label?.value || kindName(it.kind.value);
    rows.push({
      ids: [it.box.w.id, it.box.d.id, it.kind.id, ...(it.label ? [it.label.id] : [])], kind: 'item-size', target: { kind: 'item-size', itemId: it.id }, input: 'size',
      title: `${name} · size`, display: fmtSize(it.box.w.value, it.box.d.value), value: [it.box.w.value, it.box.d.value], ex: it.box.w, status: worst(it.box.w, it.box.d, it.kind),
      confidence: minConf(it.box.w, it.box.d, it.kind), rank: 3, alternatives: altsOf(it.box.w, (v) => (num(v) ? fmtLen(v) : String(v))),
    });
    for (const [prop, e, label] of [['height', it.height, 'height'], ['surfaceHeight', it.surfaceHeight, 'surface height']] as const) if (e) {
      rows.push({ ids: [e.id], kind: 'height', target: { kind: 'item-prop', itemId: it.id, prop }, input: 'length', title: `${name} · ${label}`, display: fmtLen(e.value), value: e.value, ex: e, status: e.status, confidence: e.confidence, rank: 4 });
    }
    const u = it.unit;
    if (u) {
      const add = (e: Anyx, prop: 'bays' | 'bayWidth' | 'shuttersPerBay' | 'hinge' | 'drawerStrip' | 'baseGap' | 'loft', index: number, title: string, input: InputKind, display: string): void => {
        rows.push({ ids: [e.id], kind: 'unit', target: { kind: 'unit', itemId: it.id, prop, index }, input, title: `${name} · ${title}`, display, value: e.value, ex: e, status: e.status, confidence: e.confidence, rank: 3, alternatives: altsOf(e, (v) => (num(v) ? (input === 'count' ? String(v) : fmtLen(v)) : String(v))) });
      };
      add(u.bays, 'bays', 0, 'number of bays', 'count', String(u.bays.value));
      u.bayWidths.forEach((e, i) => add(e, 'bayWidth', i, `bay ${i + 1} width`, 'length', fmtLen(e.value)));
      u.shuttersPerBay.forEach((e, i) => add(e, 'shuttersPerBay', i, `bay ${i + 1} shutters`, 'count', String(e.value)));
      u.hinge.forEach((e, i) => add(e, 'hinge', i, `bay ${i + 1} hinge side`, 'hinge', String(e.value)));
      if (u.drawerStrip) add(u.drawerStrip, 'drawerStrip', 0, 'drawer strip height', 'length', fmtLen(u.drawerStrip.value));
      if (u.baseGap) add(u.baseGap, 'baseGap', 0, 'base gap', 'length', fmtLen(u.baseGap.value));
      if (u.loft) add(u.loft, 'loft', 0, 'loft height', 'length', fmtLen(u.loft.value));
    }
  }
  for (const e of doc.elevations ?? []) {
    if (e.ceiling) rows.push({ ids: [e.ceiling.id], kind: 'height', target: { kind: 'elevation', view: e.view, prop: 'ceiling', index: 0 }, input: 'length', title: 'Elevation · ceiling height', display: fmtLen(e.ceiling.value), value: e.ceiling.value, ex: e.ceiling, status: e.ceiling.status, confidence: e.ceiling.confidence, rank: 4 });
    e.levels.forEach((l, i) => rows.push({ ids: [l.id], kind: 'height', target: { kind: 'elevation', view: e.view, prop: 'level', index: i }, input: 'length', title: `Elevation · level ${i + 1}`, display: fmtLen(l.value), value: l.value, ex: l, status: l.status, confidence: l.confidence, rank: 4 }));
  }
  if (doc.ceiling) {
    const c = doc.ceiling;
    rows.push({ ids: [c.id], kind: 'height', target: { kind: 'ceiling' }, input: 'length', title: 'Ceiling height', display: fmtLen(c.value), value: c.value, ex: c, status: c.status, confidence: c.confidence, rank: 4 });
  }
  for (const d of doc.dimensions) {
    const text = d.value.source.text ?? fmtFtIn(d.value.value);
    const alt = altsOf(d.value, (v) => (num(v) ? fmtLen(v) : String(v)));
    rows.push({
      ids: [d.value.id], kind: 'dimension', target: { kind: 'dimension', id: d.id }, input: 'length', title: `Printed dimension · ${text}`,
      display: `${text} · ${fmtLen(d.value.value)}`, value: d.value.value, ex: d.value, status: d.value.status, confidence: d.value.confidence, rank: 5, alternatives: alt,
      conflict: d.value.status === 'conflict' ? (conflictFor(`dimensions.${d.id}`) ?? (alt[0] ? `The drawing says ${text}, but it measures ${alt[0].display}.` : undefined)) : undefined,
    });
  }
  return rows;
}

/** The queue, in the order the broker works through it. */
export function buildRows(doc: UnderstandingDoc, review: ReviewFile = emptyReview()): ReviewRow[] {
  const rows = baseRows(doc).map((b): ReviewRow => {
    const d = review.decisions[b.ids[0]];
    const state: RowState = d ? (d.action === 'confirm' ? 'confirmed' : d.action === 'correct' ? 'corrected' : 'rejected')
      : b.status === 'conflict' ? 'conflict' : isFact(b.status) ? 'verified' : 'needs';
    return {
      id: b.ids[0], ids: b.ids, kind: b.kind, target: b.target, input: b.input, title: b.title, display: b.display, value: b.value,
      baseStatus: b.status === 'confirmed' || b.status === 'corrected' ? 'verified' : b.status, state, method: b.ex.method, confidence: b.confidence,
      how: howRead(b.ex), source: b.ex.source, alternatives: b.alternatives ?? [], ...(d ? { decision: d } : {}),
      primaryHow: b.kind === 'dimension' ? 'printed on the drawing' : b.ex.method === 'vector' || b.ex.method === 'derived' || b.alternatives?.some((a) => /printed/.test(a.how)) ? 'measured on the drawing' : 'read from the drawing',
      ...(b.conflict ? { conflict: b.conflict } : b.status === 'conflict' && b.alternatives?.[0] ? { conflict: `Two readings: ${b.display.split(' · ')[0]} (${b.kind === 'dimension' ? 'printed' : 'measured'}) and ${b.alternatives[0].display.split(' · ')[0]} (${b.alternatives[0].how}).` } : {}),
      rank: b.status === 'conflict' ? 0 : b.rank,
    };
  });
  // the same id twice would make a decision apply to two rows: keep the first
  const seen = new Set<string>();
  const uniq = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  return uniq.sort((a, b) => a.rank - b.rank || a.confidence - b.confidence || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
}

/** Rows a broker has to look at: not already verified against the drawing. */
export const needsLook = (r: ReviewRow): boolean => r.baseStatus !== 'verified';
export interface Progress { total: number; checked: number; open: number; conflicts: number; verified: number }
export function progressOf(rows: ReviewRow[]): Progress {
  const need = rows.filter(needsLook);
  const checked = need.filter((r) => r.decision).length;
  return { total: need.length, checked, open: need.length - checked, conflicts: need.filter((r) => r.baseStatus === 'conflict' && !r.decision).length, verified: rows.length - need.length };
}
/** SPEC 17.9: the step is done when no conflict remains. Unverified values may stay; they stay out of what the buyer is told. */
export const reviewDone = (rows: ReviewRow[]): boolean => rows.length > 0 && progressOf(rows).conflicts === 0;
export const progressText = (p: Progress): string => `${p.checked} of ${p.total} checked`;

// ---------------------------------------------------------------- typed corrections
export type ParsedCorrection = { ok: true; value: unknown; display: string } | { ok: false; error: string };
const RANGE: Record<string, [number, number]> = { length: [0.01, 40], height: [0.2, 4.5], opening: [0.3, 5] };
const HINGES = ['left', 'right', 'outer-edges'];

/** What a typed correction means for this row. Feet and inches or metric, through the C12a unit parsers. */
export function parseCorrection(row: Pick<ReviewRow, 'input' | 'kind' | 'target'>, text: string): ParsedCorrection {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Type a value first.' };
  const lengthMsg = 'Could not read that as a length. Try 9\'6", 2.9 m or 2900.';
  switch (row.input) {
    case 'size': {
      const s = parseSizeLoose(t);
      if (!s) return { ok: false, error: 'Type both sides, like 12\'0" x 10\'6" or 3.6 x 3.2 m.' };
      if (s.w < 0.1 || s.l < 0.1 || s.w > 40 || s.l > 40) return { ok: false, error: 'That size is outside what a room or fixture could be.' };
      return { ok: true, value: [s.w, s.l], display: fmtSize(s.w, s.l) };
    }
    case 'length': {
      const p = parseLengthLoose(t);
      if (!p) return { ok: false, error: lengthMsg };
      const [lo, hi] = row.kind === 'height' ? RANGE.height : RANGE.length;
      if (p.m < lo || p.m > hi) return { ok: false, error: `That is ${fmtLen(p.m)}. Expected between ${lo} and ${hi} m.` };
      return { ok: true, value: p.m, display: fmtLen(p.m) };
    }
    case 'opening': {
      const m = /^(sliding door|archway|opening|door|window)\b\s*/i.exec(t);
      const word = m ? m[1].toLowerCase() : '';
      const kind = !m ? undefined : word === 'door' ? 'door' : word === 'window' ? 'window' : 'opening';
      const rest = m ? t.slice(m[0].length).trim() : t;
      if (!rest) return kind ? { ok: true, value: { type: kind }, display: typeName(kind) } : { ok: false, error: lengthMsg };
      const p = parseLengthLoose(rest);
      if (!p) return { ok: false, error: lengthMsg };
      if (p.m < RANGE.opening[0] || p.m > RANGE.opening[1]) return { ok: false, error: `That is ${fmtLen(p.m)}. Doors and windows are 0.3 to 5 m wide.` };
      return { ok: true, value: { ...(kind ? { type: kind } : {}), widthM: p.m }, display: `${kind ? `${typeName(kind)} ` : ''}${fmtLen(p.m)}` };
    }
    case 'count': {
      const n = Number(t);
      if (!Number.isInteger(n) || n < 1 || n > 12) return { ok: false, error: 'Type a whole number from 1 to 12.' };
      return { ok: true, value: n, display: String(n) };
    }
    case 'hinge': {
      const v = t.toLowerCase().replace(/\s+/g, '-');
      if (!HINGES.includes(v)) return { ok: false, error: 'Type left, right or outer-edges.' };
      return { ok: true, value: v, display: v };
    }
  }
}

/** A decision's value as the broker typed it, for showing in the row after the fact. */
export function describeDecision(row: ReviewRow): string {
  const d = row.decision;
  if (!d) return '';
  if (d.action === 'confirm') return 'Confirmed by you';
  if (d.action === 'reject') return 'Marked as not in the drawing';
  const p = parseCorrectionValue(row, d.value);
  return `Corrected by you to ${p}`;
}
function parseCorrectionValue(row: ReviewRow, v: unknown): string {
  if (Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1])) return fmtSize(v[0], v[1]);
  if (num(v)) return row.input === 'count' ? String(v) : fmtLen(v);
  if (v && typeof v === 'object') { const o = v as { type?: string; widthM?: number }; return `${o.type ? typeName(o.type) : ''}${o.type && o.widthM ? ' ' : ''}${num(o.widthM) ? fmtLen(o.widthM) : ''}`; }
  return String(v);
}

// ---------------------------------------------------------------- what the server accepts back
const isDecision = (v: unknown): v is Decision => !!v && typeof v === 'object' && ['confirm', 'correct', 'reject'].includes((v as Decision).action) && typeof (v as Decision).at === 'string';
function valueOk(row: ReviewRow, v: unknown): boolean {
  switch (row.input) {
    case 'size': return Array.isArray(v) && v.length === 2 && v.every((x) => num(x) && x > 0.05 && x < 60);
    case 'length': return num(v) && v > 0.005 && v < 60;
    case 'count': return num(v) && Number.isInteger(v) && v >= 1 && v <= 12;
    case 'hinge': return typeof v === 'string' && HINGES.includes(v);
    case 'opening': {
      if (num(v)) return v > 0.05 && v < 60;
      if (!v || typeof v !== 'object') return false;
      const o = v as { type?: unknown; widthM?: unknown };
      return (o.type === undefined || ['door', 'window', 'opening'].includes(String(o.type))) && (o.widthM === undefined || (num(o.widthM) && o.widthM >= 0.3 && o.widthM <= 5)) && (o.type !== undefined || o.widthM !== undefined);
    }
  }
}
/** A review file from outside is trusted for nothing: every key must be a row of this file and every typed value must have the row's shape. */
export function validateReview(doc: UnderstandingDoc, body: unknown): { ok: true; review: ReviewFile } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || (body as ReviewFile).version !== 1 || typeof (body as ReviewFile).decisions !== 'object' || !(body as ReviewFile).decisions) return { ok: false, error: 'That is not a review file.' };
  const rows = new Map(buildRows(doc).map((r) => [r.id, r]));
  const decisions: ReviewFile['decisions'] = {};
  for (const [id, d] of Object.entries((body as ReviewFile).decisions)) {
    const row = rows.get(id);
    if (!row) return { ok: false, error: `Unknown value ${id.slice(0, 12)}.` };
    if (!isDecision(d)) return { ok: false, error: `The decision for "${row.title}" is not valid.` };
    if (d.action === 'correct' && !valueOk(row, d.value)) return { ok: false, error: `The corrected value for "${row.title}" is not valid.` };
    decisions[id] = d.action === 'correct' ? { action: 'correct', value: d.value, at: d.at } : { action: d.action, at: d.at };
  }
  return { ok: true, review: { version: 1, decisions } };
}
