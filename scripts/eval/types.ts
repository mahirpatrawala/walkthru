// C12a scoring harness: the shape any pipeline's output is reduced to (SPEC 17.11), and the truth it is scored against.
// A field a pipeline does not produce is left undefined: that scores as zero recall and is listed as "not attempted".
import type { Status } from '../../src/understand/types';

export type Pt = [number, number];
export interface PredRoom { label: string; roomType: string; polygon: Pt[]; status: Status }
export interface PredOpening { type: string; at: Pt; widthM: number; status: Status }
export interface PredItem { cls: string; box: { cx: number; cz: number; w: number; d: number }; status: Status }
export interface PredSymbol { cls: string; at: Pt; status: Status }
export interface PredDim { string: string; a: Pt; b: Pt; view: 'plan' | 'elevation'; status: Status }
export interface PredElevation {
  /** the caption or tag read from the sheet, e.g. "ELEVATION-3" */ caption: string;
  wall?: { at: Pt }; ceilingM?: { v: number; status: Status };
  heights?: { kind: string; v: number; status: Status }[];
  units?: { bays: number; shuttersPerBay: number[]; hinge: string[]; status: Status; drawerStripM?: number; loftM?: number; baseGapM?: number; heightM?: number; hingeStatus?: Status[]; partStatus?: { drawerStripM?: Status; loftM?: Status; baseGapM?: Status; heightM?: Status } }[];
  /** the link's own confidence (for the report) */
  linkConfidence?: number;
  /** page (0-based) and top edge of the view on it: a view whose caption could not be read is paired with the truth view on the same page, top to bottom */
  page?: number; top?: number;
}
export interface Prediction {
  /** false when the pipeline refused or failed on this input */
  attempted: boolean; error?: string;
  rooms?: PredRoom[]; openings?: PredOpening[]; items?: PredItem[]; symbols?: PredSymbol[]; dimensions?: PredDim[];
  ceiling?: { v: number; status: Status };
  elevations?: PredElevation[];
  /** how many values the pipeline asks the broker to check, out of how many it produced */
  seconds?: number;
}

/** Truth: the generator's SetTruth, or a partial one from a real set (only the fields present are scored). */
export interface TruthRoomLite { id: string; roomType: string; polygonM: [number, number][]; widthM: number; lengthM: number; areaM2: number }
export interface TruthLite {
  rooms?: TruthRoomLite[];
  openings?: { type: string; at: { x: number; z: number }; widthM: number }[];
  items?: { cls: string; box: { cx: number; cz: number; w: number; d: number } }[];
  symbols?: { cls: string; bboxM: [number, number, number, number] }[];
  dimensions?: { string: string; valueM: number; shownM: number; planted: boolean; view: string; a: [number, number]; b: [number, number] }[];
  ceilingM?: number;
  elevations?: {
    page?: number; caption: string; tag: string; wall: { roomId: string; edge: number } | null; ceilingM: number;
    levels: { kind: string; heightM: number }[]; units: { bays: number; shuttersPerBay: number[]; hinge: string[]; drawerStripM?: number; loftM?: number; baseGapM?: number; heightM?: number }[];
    bed?: { baseTopM: number; mattressTopM: number; headboardTopM: number };
  }[];
}
