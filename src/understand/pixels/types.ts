// C12d. What the raster path produces. The field names follow SPEC 17.6's UnderstandingFile for the parts a picture can fill
// (views, dimensions, rooms, openings, items, symbols, conflicts, warnings, cost), so the integrator can fold it into that file.
import type { Extracted } from '../types';
import type { ImportResult } from '../../import/types';
import type { DesignsFile } from '../../look/designs';

export type Pt = [number, number];
export interface RunCost { visionCalls: number; inputTokens: number; outputTokens: number; usd: number; seconds: number; wallSeconds: number }
export interface StageTime { stage: string; ms: number }
/** One thing sent to a model: what, from where, how big. The audit trail for the privacy rule. */
export interface SentRecord { kind: 'thumb' | 'view' | 'crop'; page: string; /** uploaded-page pixels */ rect: [number, number, number, number]; w: number; h: number; bytes: number; purpose: string }

export interface RasterUnderstanding {
  version: 1;
  input: { kind: 'image'; pages: number; sha256: string };
  views: { id: string; page: number; kind: string; kindConfidence: number; raster: true; scale?: Extracted<number>; steps: string[]; /** quarter turn (degrees clockwise) applied so the title block sits at the bottom right */ turnedCw: number }[];
  dimensions: { id: string; view: string; a: Pt; b: Pt; value: Extracted<number>; chain?: string }[];
  rooms: { id: string; label: Extracted<string>; roomType: Extracted<string>; polygonM: Pt[]; width: Extracted<number>; length: Extracted<number>; area: Extracted<number> }[];
  openings: { id: string; roomId: string; type: Extracted<string>; width: Extracted<number> }[];
  items: { id: string; kind: Extracted<string>; label?: Extracted<string>; box: { cx: number; cz: number; w: Extracted<number>; d: Extracted<number>; yawDeg: number } }[];
  symbols: { id: string; view: string; class: Extracted<string>; bbox: [number, number, number, number]; centreM: Pt; mappedTo?: string }[];
  conflicts: { id: string; field: string; values: string[]; message: string }[];
  warnings: string[];
  cost?: RunCost;
}

export interface RasterRun {
  /** 'refused' = nothing could be produced; `reason` says why in words a broker can act on */
  status: 'ok' | 'refused';
  reason?: string;
  understanding: RasterUnderstanding;
  result?: ImportResult;
  designs: DesignsFile;
  sent: SentRecord[];
  stages: StageTime[];
  cost: RunCost;
  notice: string;
}
