// C12c. The plan stage's symbol read, in the importer's world frame: from a finished import and its trace to the furniture and
// fixtures drawn on the plan with no help from a label, and a type for every room that has no label. Pure TypeScript.
import type { Box, Px, RoomType, Vec2 } from '../types';
import type { ImportResult } from '../import/types';
import type { ProposeTrace } from '../import/propose';
import { boxFromOutline } from '../import/furniture';
import { pointInPolygon } from '../core/geometry';
import { withoutReadStrokes } from './text-pdf';
import { parseLengthLoose } from './units';
import { findPlanSymbols, roomTypeFromSymbols, FURNITURE_CLASSES } from './symbols';
import type { FoundSymbol, SymbolCandidate, SymbolClassName } from './symbols';

export interface PlacedSymbol {
  id: string; cls: SymbolClassName; box: Box; bboxM: [number, number, number, number];
  confidence: number; evidence: string; roomId?: string;
  /** a furniture class the importer turns into an item (the rest are recorded as symbols) */
  furniture: boolean;
}
export interface PlacedCandidate { id: string; bboxM: [number, number, number, number]; sizeM: [number, number]; bboxPt: [number, number, number, number] }
export interface PlanRead {
  symbols: PlacedSymbol[]; candidates: PlacedCandidate[];
  /** room id -> the type the symbols inside imply, for rooms that carry no label of their own */
  roomTypes: Map<string, RoomType>;
  warnings: string[];
}

export function readPlan(result: ImportResult, trace: ProposeTrace): PlanRead {
  const warnings: string[] = [];
  if (!trace.frame || !trace.plan || !trace.wallBitmap || !result.proposal.rooms.length) return { symbols: [], candidates: [], roomTypes: new Map(), warnings };
  const { cx, cy, ptPerM } = trace.frame;
  const toWorld = (p: Px): Vec2 => ({ x: (p.x - cx) / ptPerM, z: (p.y - cy) / ptPerM });
  // the strokes that are not stroked lettering
  const plan0 = trace.pages[trace.planIdx];
  // only strokes of reads that are words or lengths leave the symbol stage: a hob's burner circles can read as the digits "00"
  const reads = trace.reads[trace.planIdx].filter((r) => r.method !== 'glyph' || r.str.replace(/\s/g, '').length >= 3 || !!parseLengthLoose(r.str));
  const kept = new Set(withoutReadStrokes(plan0, reads).strokes);
  const dropped = new Set(plan0.strokes.filter((s) => !kept.has(s)));
  const strokes = trace.plan.strokes.filter((s) => !dropped.has(s));
  const found = findPlanSymbols(strokes, ptPerM);
  const placed: PlacedSymbol[] = found.symbols.map((s: FoundSymbol) => {
    const box = boxFromOutline({ ...s.outline, closed: true }, trace.wallBitmap!, ptPerM, toWorld, 0);
    const a = toWorld({ x: s.bbox[0], y: s.bbox[1] }), b = toWorld({ x: s.bbox[2], y: s.bbox[3] });
    const sym: PlacedSymbol = { id: s.id, cls: s.cls, box, bboxM: [a.x, a.z, b.x, b.z], confidence: s.confidence, evidence: s.evidence, furniture: FURNITURE_CLASSES.includes(s.cls) };
    const room = result.proposal.rooms.find((r) => pointInPolygon({ x: box.cx, z: box.cz }, r.polygon));
    if (room) sym.roomId = room.id;
    return sym;
  });
  const candidates: PlacedCandidate[] = found.candidates.map((c: SymbolCandidate) => {
    const a = toWorld({ x: c.bbox[0], y: c.bbox[1] }), b = toWorld({ x: c.bbox[2], y: c.bbox[3] });
    return { id: c.id, bboxM: [a.x, a.z, b.x, b.z], sizeM: c.sizeM, bboxPt: c.bbox };
  });
  const roomTypes = new Map<string, RoomType>();
  for (const r of result.proposal.rooms) {
    const inside = placed.filter((s) => s.roomId === r.id).map((s) => s.cls);
    const t = roomTypeFromSymbols(inside);
    if (t !== 'other') roomTypes.set(r.id, t);
  }
  return { symbols: placed, candidates, roomTypes, warnings };
}
