// C8 drawing import. SPEC 13.4. Imports from ../types, exports nothing back into it.
import type { Vec2, Px, LayoutProposal, FurnitureItem, RoomType } from '../types';

/** Page units: PDF points after normalisation. x right, y DOWN, text reads left to right. */
export interface VFill { color: string; /** closed rings, first is the outer */ rings: Px[][]; area: number; bbox: [number, number, number, number] }
export interface VStroke { color: string; width: number; /** polyline; curves flattened to <= 0.5 pt error */ points: Px[]; closed: boolean; hasCurve: boolean }
export interface VText { str: string; x: number; y: number; width: number; size: number; /** degrees, 0 after normalisation for the dominant direction */ angle: number }
export interface VectorPage {
  index: number; width: number; height: number;
  fills: VFill[]; strokes: VStroke[]; texts: VText[];
  /** fraction of the page covered by raster images */ imageCoverage: number;
}
export type PageKind = 'plan' | 'elevation' | 'raster' | 'other';

export interface ScaleVote { source: string; ptPerM: number }
export interface RoomFinding {
  id: string; label: string; roomType: RoomType; method: 'walls' | 'walls+strokes' | 'label-rect';
  confidence: number; labelDims?: { w: number; l: number }; labelAreaM2?: number; areaM2: number;
}
export interface CeilingFinding {
  heightM: number; method: 'text' | 'geometry' | 'default'; page: number | null;
  candidatesM: number[]; confidence: number;
}

/** Sidecar for everything LayoutProposal cannot carry. File: public/scenes/<id>/proposal-extras.json */
export interface ProposalExtras {
  version: 1;
  sourceFile: string;                 // file name only, never a path
  planPage: number;
  scale: { ptPerM: number; votes: ScaleVote[]; agreeing: number; disagreementPct: number };
  rooms: RoomFinding[];
  ceiling: CeilingFinding;
  /** designed furniture found on the plan, world metres */
  furniture: FurnitureItem[];
  /** labels we recognised but could not turn into a box */
  unmapped: { label: string; sizeM?: { w: number; l: number }; at: Vec2; reason: string }[];
  windowHeights?: { openingId: string; sillM: number; headM: number }[];
  spawn: { x: number; z: number; yawDeg: number } | null;
  warnings: string[];
}
export interface ImportResult { proposal: LayoutProposal; extras: ProposalExtras }

export type ImportErrorCode = 'no-plan-page' | 'raster-plan' | 'pdfjs-shape' | 'vision-not-configured';
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ImportError';
    this.code = code;
  }
}
