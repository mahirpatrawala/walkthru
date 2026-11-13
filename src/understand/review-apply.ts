// C12e. SPEC 17.6 "Outputs" and 17.9: the machine's outputs plus the broker's decisions become the three files the buyer reads.
// This is write.ts's job in the spec, done here through a thin adapter because the C12c writers are not there yet:
//   - a decision never touches a value it was not made on
//   - a room, opening or furniture value that is verified, confirmed or corrected is stated to the buyer; any other is flagged
//     `verified: false` in proposal-extras.json so the buyer says "Not measured" instead of the number (room-trust.ts)
//   - designs.json is written ONLY from verified, confirmed and corrected values (SPEC 17.1), with the source's page and text
//   - a confirmed or corrected value carries "confirmed by broker" / "corrected by broker" provenance in proposal-extras.json
// Pure: no files, no DOM. The server persists the result; the editor patches its draft from `changed`.
import { polygonArea } from '../core/geometry';
import type { FurnitureItem, LayoutProposal, Opening, RoomTag } from '../types';
import type { ProposalExtras, RoomFinding } from '../import/types';
import type { DesignSource, DesignsFile, ItemDesignFile, OpenableDesign } from '../look/designs';
import type { WardrobeDesign } from '../look/furniture-real';
import type { Extracted } from './types';
import { isFact } from './types';
import { allExtracted, buildRows, emptyReview } from './review-model';
import type { Decision, ReviewFile, ReviewRow, UnderstandingDoc } from './review-model';

export interface BaseOutputs { proposal: LayoutProposal; extras: ProposalExtras; designs: DesignsFile }
/** The extras file as written: C8's shape plus per-room flags and the broker provenance list (extra keys are ignored by every reader). */
export type RoomOut = RoomFinding & { verified?: boolean; note?: string; provenance?: string };
export interface ProvenanceEntry { kind: 'room' | 'opening' | 'item' | 'height' | 'dimension' | 'unit'; id: string; field: string; status: 'confirmed' | 'corrected' | 'rejected'; by: 'broker' }
export type ExtrasOut = Omit<ProposalExtras, 'rooms'> & {
  rooms: RoomOut[];
  review?: { by: 'broker'; confirmed: number; corrected: number; rejected: number; fields: ProvenanceEntry[] };
  ceiling: ProposalExtras['ceiling'] & { provenance?: string };
};
export interface Changes { rooms: string[]; openings: string[]; items: string[]; removedOpenings: string[]; removedItems: string[]; wallHeight: boolean }
export interface Applied {
  doc: UnderstandingDoc;
  proposal: LayoutProposal;
  extras: ExtrasOut;
  designs: DesignsFile;
  changed: Changes;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
export const NOTE_UNCONFIRMED = 'size not confirmed yet';
export const NOTE_CONFLICT = 'drawing and label disagree';
export const NOTE_REJECTED = 'size not in the drawing';

// ---------------------------------------------------------------- geometry of a corrected room
const bbox = (poly: { x: number; z: number }[]): { x0: number; z0: number; dx: number; dz: number } => {
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  return { x0: Math.min(...xs), z0: Math.min(...zs), dx: Math.max(...xs) - Math.min(...xs), dz: Math.max(...zs) - Math.min(...zs) };
};
/** The room resized to a typed size about its top-left corner (the editor's own rule for a typed size, SPEC 2.2 E3). The longer typed side goes along the longer side of the room. */
export function resizeRoom(room: RoomTag, a: number, b: number): RoomTag {
  const bb = bbox(room.polygon);
  const long = Math.max(a, b), short = Math.min(a, b);
  // a room that is nearly square has no long side to follow: the first number typed runs along x, as in the editor's own size field
  const square = Math.abs(bb.dx - bb.dz) <= 0.02 * Math.max(bb.dx, bb.dz);
  const [nx, nz] = square ? [a, b] : bb.dx > bb.dz ? [long, short] : [short, long];
  const fx = bb.dx > 0 ? nx / bb.dx : 1, fz = bb.dz > 0 ? nz / bb.dz : 1;
  return { ...room, polygon: room.polygon.map((p) => ({ x: round3(bb.x0 + (p.x - bb.x0) * fx), z: round3(bb.z0 + (p.z - bb.z0) * fz) })) };
}
const edgeLen = (room: RoomTag, e: number): number => { const p = room.polygon[e], q = room.polygon[(e + 1) % room.polygon.length]; return Math.hypot(q.x - p.x, q.z - p.z); };
/** After a room changed size, an opening on one of its edges must still fit on the edge. */
function refit(o: Opening, room: RoomTag): Opening {
  const L = edgeLen(room, o.edge);
  const w = Math.max(0.3, Math.min(o.widthM, Math.max(0.3, L - 0.1)));
  const c = Math.max(w / 2, Math.min(L - w / 2, o.centreM));
  return { ...o, widthM: round3(w), centreM: round3(c) };
}

// ---------------------------------------------------------------- designs.json (only from facts)
const GENERIC_SHEET = /^(plan|elevation|section|detail|wall|view)\b[\w\s.-]{0,24}$/i;
const srcOf = (e: Extracted<unknown>): DesignSource => ({ page: e.source.page, sheet: GENERIC_SHEET.test(e.source.sheet) ? e.source.sheet : '', text: e.source.text ?? '' });
const fact = <T,>(e: Extracted<T> | undefined): e is Extracted<T> => !!e && isFact(e.status);
const DEFAULT_FRONT = '#d9d4ca', DEFAULT_HANDLE = '#8c8c8c';

type Item = UnderstandingDoc['items'][number];
/** What the drawing says about one item, as `designs.json` keeps it. Null when no value of it is a fact. */
export function designForItem(it: Item, conflicts: UnderstandingDoc['conflicts']): ItemDesignFile | null {
  const out: ItemDesignFile = {};
  const sources: Record<string, DesignSource | DesignSource[] | string> = {};
  if (fact(it.height)) { out.heightM = it.height.value; sources.heightM = srcOf(it.height); }
  if (fact(it.surfaceHeight)) { out.surfaceHeightM = it.surfaceHeight.value; sources.surfaceHeightM = srcOf(it.surfaceHeight); }
  const u = it.unit;
  if (u && fact(u.bays) && u.bayWidths.length === u.bays.value && u.bayWidths.every((e) => fact(e)) && u.shuttersPerBay.length >= 1 && u.shuttersPerBay.every((e) => fact(e))) {
    const bays = u.bays.value;
    const per = u.shuttersPerBay.map((e) => e.value);
    const sameShutters = per.every((n) => n === per[0]);
    const widths = u.bayWidths.map((e) => e.value);
    const pitch = widths.reduce((s, v) => s + v, 0) / widths.length;
    const notInDrawing: string[] = ['shutter thickness', 'handle projection', 'hinge opening angle'];
    const conflictsOut: string[] = [];
    const tied = conflicts.filter((c) => c.field.startsWith(`items.${it.id}`));
    const handleOk = fact(u.handle?.y) && fact(u.handle?.length);
    const wardrobe: WardrobeDesign = {
      bays, shuttersPerBay: sameShutters ? per[0] : Math.max(...per),
      drawerStripM: fact(u.drawerStrip) ? u.drawerStrip.value : 0, baseGapM: fact(u.baseGap) ? u.baseGap.value : 0,
      frontColor: DEFAULT_FRONT, handleColor: DEFAULT_HANDLE,
      handleYM: handleOk ? u.handle!.y.value : 1.0, handleLenM: handleOk ? u.handle!.length.value : 0.3,
    };
    if (!handleOk) notInDrawing.push('handle height and length');
    notInDrawing.push('shutter colour');
    out.wardrobe = wardrobe;
    sources.bays = srcOf(u.bays);
    sources.bayWidths = u.bayWidths.map(srcOf);
    // the swing: every shutter must open, so a unit whose hinge side is not a fact is shown closed
    const hingesKnown = u.hinge.length === bays && u.hinge.every((h) => fact(h) && h.value === 'outer-edges');
    if (hingesKnown && sameShutters && per[0] === 2) {
      const total = widths.reduce((s, v) => s + v, 0);
      const boxW = it.box.w.value;
      let x = Math.max(0, (boxW - total) / 2);
      const centres = widths.map((w) => { const c = x + w / 2; x += w; return round3(c); });
      if (Math.max(...widths) - Math.min(...widths) > 0.01) conflictsOut.push('The bays are not all the same width; the clearance uses the widest shutter.');
      const open: OpenableDesign = {
        bayPitchM: round3(pitch), shutterWidthM: round3(Math.max(...widths) / per[0]), bayCentresFromLeftM: centres, maxAngleDeg: 90,
        gaps: [], conflicts: [...conflictsOut, ...tied.map((c) => c.message)], notInDrawing,
        ...(tied[0] ? { cardConflict: tied[0].message } : {}),
        sources: { bayWidths: u.bayWidths.map(srcOf), hinge: u.hinge.map(srcOf) },
      };
      out.openable = open;
    }
    out.sources = { ...sources, shutterColour: 'default look, not read from the drawing' };
  } else if (Object.keys(sources).length) out.sources = sources;
  return out.heightM !== undefined || out.surfaceHeightM !== undefined || out.wardrobe || out.openable ? out : null;
}

// ---------------------------------------------------------------- applying decisions
/** Writes a typed value into the Extracted values it belongs to; returns the ids it changed. */
const valueFields = (row: ReviewRow, d: Decision, doc: UnderstandingDoc, ix: Map<string, Extracted<unknown>>): Set<string> => {
  const changedIds = new Set<string>();
  const set = (id: string | undefined, v: unknown): void => { const e = id ? ix.get(id) : undefined; if (e) { (e.alternatives ??= []).push({ value: e.value, method: e.method, source: e.source }); e.value = v; changedIds.add(e.id); } };
  const t = row.target;
  const v = d.value;
  if (t.kind === 'room' && Array.isArray(v)) {
    const r = doc.rooms.find((x) => x.id === t.roomId); if (!r) return changedIds;
    const [a, b] = v as [number, number];
    set(r.width.id, Math.min(a, b)); set(r.length.id, Math.max(a, b)); set(r.area.id, a * b);
  } else if (t.kind === 'opening') {
    const o = doc.openings.find((x) => x.id === t.openingId); if (!o) return changedIds;
    const val = v as { type?: string; widthM?: number } | number;
    if (typeof val === 'number') set(t.prop === 'sill' ? o.sill?.id : t.prop === 'head' ? o.head?.id : o.width.id, val);
    else { if (num(val.widthM)) set(o.width.id, val.widthM); if (val.type) set(o.type.id, val.type); }
  } else if (t.kind === 'item-size' && Array.isArray(v)) {
    const it = doc.items.find((x) => x.id === t.itemId); if (!it) return changedIds;
    set(it.box.w.id, (v as [number, number])[0]); set(it.box.d.id, (v as [number, number])[1]);
  } else if (t.kind === 'item-prop' && num(v)) {
    const it = doc.items.find((x) => x.id === t.itemId); if (!it) return changedIds;
    set((t.prop === 'height' ? it.height : it.surfaceHeight)?.id, v);
  } else if (t.kind === 'unit') {
    const u = doc.items.find((x) => x.id === t.itemId)?.unit; if (!u) return changedIds;
    const e = t.prop === 'bays' ? u.bays : t.prop === 'bayWidth' ? u.bayWidths[t.index] : t.prop === 'shuttersPerBay' ? u.shuttersPerBay[t.index] : t.prop === 'hinge' ? u.hinge[t.index] : t.prop === 'drawerStrip' ? u.drawerStrip : t.prop === 'baseGap' ? u.baseGap : u.loft;
    set(e?.id, v);
  } else if (t.kind === 'ceiling') set(doc.ceiling?.id, v);
  else if (t.kind === 'elevation') { const e = doc.elevations?.find((x) => x.view === t.view); set(t.prop === 'ceiling' ? e?.ceiling?.id : e?.levels[t.index]?.id, v); }
  else if (t.kind === 'dimension') set(doc.dimensions.find((x) => x.id === t.id)?.value.id, v);
  return changedIds;
};

export function applyReview(base: BaseOutputs, docIn: UnderstandingDoc, review: ReviewFile = emptyReview()): Applied {
  const doc = clone(docIn);
  const proposal = clone(base.proposal);
  const extras = clone(base.extras) as unknown as ExtrasOut;
  const rowsBefore = buildRows(doc, review);
  const ix = new Map(allExtracted(doc).map((e) => [e.id, e]));
  const changed: Changes = { rooms: [], openings: [], items: [], removedOpenings: [], removedItems: [], wallHeight: false };
  const prov: ProvenanceEntry[] = [];
  const decided = new Map<string, Decision>();
  const baseNotes = new Map(extras.rooms.map((f) => [f.id, f.note]));

  for (const row of rowsBefore) {
    const d = row.decision;
    if (!d) continue;
    const t = row.target;
    const entryKind: ProvenanceEntry['kind'] = t.kind === 'room' ? 'room' : t.kind === 'opening' ? 'opening' : t.kind === 'item-size' ? 'item' : t.kind === 'dimension' ? 'dimension' : t.kind === 'unit' ? 'unit' : 'height';
    const entryId = t.kind === 'room' ? t.roomId : t.kind === 'opening' ? t.openingId : t.kind === 'item-size' || t.kind === 'item-prop' || t.kind === 'unit' ? t.itemId : t.kind === 'dimension' ? t.id : 'wall-height';
    if (d.action === 'reject') {
      if (entryKind !== 'dimension') prov.push({ kind: entryKind, id: entryId, field: row.title, status: 'rejected', by: 'broker' });
      decided.set(row.id, d);
      if (t.kind === 'opening' && t.prop === 'width') { proposal.openings = proposal.openings.filter((o) => o.id !== t.openingId); changed.removedOpenings.push(t.openingId); }
      if (t.kind === 'item-size') { extras.furniture = extras.furniture.filter((f) => f.id !== t.itemId); changed.removedItems.push(t.itemId); }
      continue;
    }
    const touched = d.action === 'correct' ? valueFields(row, d, doc, ix) : new Set<string>();
    for (const id of row.ids) {
      const e = ix.get(id); if (!e) continue;
      // a typed value is the broker's; the rest of the group (an opening's type, say) was looked at and accepted
      if (touched.has(id)) { e.status = 'corrected'; e.method = 'broker'; e.confidence = 1; }
      else { e.status = 'confirmed'; e.confidence = Math.max(e.confidence, 0.99); }
    }
    decided.set(row.id, d);
    if (entryKind !== 'dimension') prov.push({ kind: entryKind, id: entryId, field: row.title, status: d.action === 'confirm' ? 'confirmed' : 'corrected', by: 'broker' });
    // the conflict is answered
    if (t.kind === 'dimension') doc.conflicts = doc.conflicts.filter((c) => c.field !== `dimensions.${t.id}`);
    if (t.kind === 'room') doc.conflicts = doc.conflicts.filter((c) => c.field !== `rooms.${t.roomId}.size`);
    if (d.action !== 'correct') continue;

    // ---- the correction reaches the outputs
    if (t.kind === 'room' && Array.isArray(d.value)) {
      const k = proposal.rooms.findIndex((r) => r.id === t.roomId); if (k < 0) continue;
      const [a, b] = d.value as [number, number];
      const room = resizeRoom(proposal.rooms[k], a, b);
      proposal.rooms[k] = room;
      proposal.openings = proposal.openings.map((o) => (o.roomId === room.id ? refit(o, room) : o));
      const f = extras.rooms.find((r) => r.id === t.roomId);
      if (f) f.areaM2 = round3(polygonArea(room.polygon));
      changed.rooms.push(room.id);
    } else if (t.kind === 'opening') {
      const o = proposal.openings.find((x) => x.id === t.openingId); if (!o) continue;
      const room = proposal.rooms.find((r) => r.id === o.roomId);
      const val = d.value as { type?: Opening['type']; widthM?: number } | number;
      if (typeof val === 'number') { if (t.prop === 'sill') o.sillM = val; else if (t.prop === 'head') o.headM = val; else o.widthM = val; }
      else { if (num(val.widthM)) o.widthM = val.widthM; if (val.type) o.type = val.type; }
      if (room) Object.assign(o, refit(o, room));
      if (t.prop === 'sill' || t.prop === 'head') extras.windowHeights = (extras.windowHeights ?? []).filter((w) => w.openingId !== o.id).concat([{ openingId: o.id, sillM: o.sillM, headM: o.headM }]);
      changed.openings.push(o.id);
    } else if (t.kind === 'item-size' && Array.isArray(d.value)) {
      const f = extras.furniture.find((x) => x.id === t.itemId); if (!f) continue;
      f.box = { ...f.box, w: (d.value as number[])[0], d: (d.value as number[])[1] };
      changed.items.push(f.id);
    } else if (t.kind === 'item-prop' && num(d.value)) {
      const f = extras.furniture.find((x) => x.id === t.itemId); if (!f) continue;
      if (t.prop === 'height') f.heightM = d.value; else f.surfaceHeightM = d.value;
      changed.items.push(f.id);
    } else if (t.kind === 'ceiling' && num(d.value)) {
      proposal.wallHeightM = d.value; extras.ceiling.heightM = d.value; changed.wallHeight = true;
    }
  }

  // a confirmed room, opening or ceiling is a fact: say so in the extras
  const factOf = (e: Extracted<unknown>): boolean => isFact(e.status);
  for (const r of doc.rooms) {
    const f = extras.rooms.find((x) => x.id === r.id); if (!f) continue;
    const ok = factOf(r.width) && factOf(r.length);
    const rejected = [...decided.entries()].some(([id, d]) => d.action === 'reject' && id === r.width.id);
    if (ok) {
      f.verified = true; delete f.note;
      const how = r.width.status === 'confirmed' ? 'confirmed by broker' : r.width.status === 'corrected' || r.length.status === 'corrected' ? 'corrected by broker' : undefined;
      if (how) f.provenance = how; else delete f.provenance;
    } else {
      f.verified = false; delete f.provenance;
      f.note = rejected ? NOTE_REJECTED : r.width.status === 'conflict' || r.length.status === 'conflict' ? NOTE_CONFLICT : (baseNotes.get(r.id) ?? NOTE_UNCONFIRMED);
    }
  }
  if (doc.ceiling && factOf(doc.ceiling)) {
    extras.ceiling.confidence = 1; extras.ceiling.provenance = doc.ceiling.status === 'confirmed' ? 'confirmed by broker' : 'corrected by broker';
    const drop = (s: string): boolean => /^Ceiling|ceiling height/i.test(s);
    proposal.notes = (proposal.notes ?? []).filter((s) => !drop(s)); extras.warnings = extras.warnings.filter((s) => !drop(s));
  }
  if (prov.length) {
    extras.review = { by: 'broker', confirmed: prov.filter((p) => p.status === 'confirmed').length, corrected: prov.filter((p) => p.status === 'corrected').length, rejected: prov.filter((p) => p.status === 'rejected').length, fields: prov };
  } else delete extras.review;

  // designs.json: only facts, from the doc after the decisions
  const designs: DesignsFile = { version: 1, source: base.designs.source, items: { ...base.designs.items } };
  if (base.designs.decor) designs.decor = base.designs.decor;
  for (const it of doc.items) {
    if (changed.removedItems.includes(it.id)) { delete designs.items[it.id]; continue; }
    const des = designForItem(it, doc.conflicts);
    if (des) designs.items[it.id] = { ...(base.designs.items[it.id] ?? {}), ...des };
  }
  return { doc, proposal, extras, designs, changed };
}
