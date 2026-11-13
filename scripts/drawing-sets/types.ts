// C12a synthetic drawing sets (SPEC 17.10): option and truth types. Truth frame: metres, x right, z down (the design frame of
// an upright sheet). Everything a scorer needs is here; nothing in a set depends on a real drawing.
import type { RoomType } from '../../src/types';

export type WallStyle = 'fill-dark' | 'fill-grey' | 'fill-two-grey' | 'double' | 'hatch';
export type TextMode = 'real' | 'glyph' | 'mixed';
export type Font = 'simplex' | 'duplex' | 'complex' | 'distorted';
export type UnitsOpt = 'ftin' | 'mm' | 'm';
export type FtinFormat = 'dash' | 'tight' | 'space' | 'fraction';
export type LabelStyle = 'brochure' | 'designer' | 'none';
export type Terminator = 'tick' | 'arrow' | 'dot';
export type Template = 'studio' | '1bhk' | '2bhk' | '3bhk' | 'single-bedroom';
export type KeyStyle = 'number' | 'letter' | 'none';
export type CaptionStyle = 'elevation-n' | 'elev-letter' | 'wall-n';
export type SymbolClass =
  | 'bed' | 'sofa' | 'dining' | 'chair' | 'wardrobe' | 'desk' | 'side table' | 'tv unit' | 'counter'
  | 'wc' | 'basin' | 'shower' | 'sink' | 'hob';
export type HingeSignals = 'both' | 'handle' | 'mark' | 'neither' | 'disagree';

export interface SetOptions {
  template: Template;
  wallStyle: WallStyle;
  textMode: TextMode;
  font: Font;
  slantDeg: number;
  widthScale: number;
  upper: boolean;
  units: UnitsOpt;
  ftinFormat: FtinFormat;
  areaUnit: 'sqft' | 'sqm';
  labelStyle: LabelStyle;
  vocab: number;
  terminator: Terminator;
  chains: boolean;
  roundShare: number;
  plantWrong: number;
  symbolVariant: number;
  symbolsLabelled: boolean;
  elevations: number;
  keyStyle: KeyStyle;
  captionStyle: CaptionStyle;
  elevOnPlanPage: boolean;
  internalView: boolean;
  page: 'A4' | 'A3';
  rotation: 0 | 90 | 180 | 270;
  noise: boolean;
  notToScale: boolean;
  raster: { dpi: number; jpegQuality: number; phone: boolean; warpDeg: number };
}

export interface TruthRoom {
  id: string; kind: string; roomType: RoomType;
  /** the string drawn as the room name, null when the set has no room labels */
  labelString: string | null; dimsString: string | null; areaString: string | null;
  polygonM: [number, number][]; widthM: number; lengthM: number; areaM2: number;
  /** the size the label states (can differ from the drawn size by label rounding) */
  labelDimsM: { w: number; l: number } | null;
}
export interface TruthOpening {
  id: string; type: 'door' | 'window' | 'opening'; style: string;
  /** centre of the gap on the wall's middle line */
  at: { x: number; z: number }; axis: 'x' | 'z'; widthM: number; sillM: number; headM: number;
  /** rooms either side (first = the room the swing opens into / the room the window serves) */
  rooms: string[];
}
export interface TruthItem {
  id: string; cls: SymbolClass; kind: string | null; roomId: string;
  box: { cx: number; cz: number; w: number; d: number; yawDeg: number };
  labelString: string | null; sizeString: string | null; runningLengthM?: number;
  variant: number; heightM?: number; surfaceHeightM?: number;
}
export interface TruthSymbol {
  id: string; cls: SymbolClass; variant: number; bboxM: [number, number, number, number]; roomId: string; itemId?: string; labelled: boolean;
  box: { cx: number; cz: number; w: number; d: number; yawDeg: number };
}
export interface TruthDimension {
  id: string; kind: 'chain-member' | 'overall' | 'elev-chain' | 'elev-vertical' | 'elev-overall'; chain: string; view: string;
  /** end points in the view's own metres (plan: truth frame; elevation: x along the wall, z = height) */
  a: [number, number]; b: [number, number];
  valueM: number; shownM: number; string: string; textMode: 'real' | 'glyph';
  /** string differs from geometry by up to 2 inches on purpose (rounding) */
  rounded: boolean;
  /** one string deliberately wrong (a typo or a different number) */
  planted: boolean;
}
export interface UnitTruth {
  id: string; itemId: string; wall: number;
  bays: number; bayWidthsM: number[]; shuttersPerBay: number[];
  hinge: ('left' | 'right' | 'outer-edges' | 'unknown' | 'conflict')[]; hingeSignals: HingeSignals[];
  drawerStripM: number; baseGapM: number; loftM: number; heightM: number;
  handle: { yM: number; lengthM: number };
  widthM: number; notes: string[];
}
export interface TruthElevation {
  id: string; page: number; onPlanPage: boolean; caption: string; tag: string;
  ptPerM: number; wall: { roomId: string; edge: number } | null;
  ceilingM: number; ceilingString: string;
  levels: { kind: string; heightM: number; string: string }[];
  openings: { type: 'window' | 'door'; fromLeftM: number; widthM: number; sillM: number; headM: number }[];
  units: UnitTruth[];
  bed?: { itemId: string; baseTopM: number; mattressTopM: number; headboardTopM: number; widthM: number };
  internal?: { unitId: string; zonesBottomUp: { kind: string; heightM: number; string: string }[][] };
}
export interface SetTruth {
  version: 1;
  id: string; seed: number; firm: string; split: 'dev' | 'held-out';
  options: SetOptions;
  page: { size: 'A4' | 'A3'; widthPt: number; heightPt: number; rotationDeg: number; pages: number };
  planPtPerM: number; planPage: number;
  rooms: TruthRoom[]; openings: TruthOpening[]; items: TruthItem[]; symbols: TruthSymbol[];
  dimensions: TruthDimension[];
  ceilingM: number;
  elevations: TruthElevation[];
  elevationKey: { at: { x: number; z: number }; style: KeyStyle; tags: { tag: string; edge: number }[] } | null;
  /** truth-frame bounding box of the wall fills, metres */
  wallBBoxM: [number, number, number, number];
  /** design-frame point (pt) of a truth-frame point (m) on the plan page: x = ox + X*S, y = oy + Z*S*stretch */
  planFrame: { ox: number; oy: number; S: number; stretch: number };
  /** page 1, design frame (pt, y down): the title block and the notes block, for the privacy checks */
  textBlocksPt: [number, number, number, number][];
  notToScale: boolean;
  /** ids of the dimension strings made wrong on purpose / rounded on purpose */
  plantedWrong: string[]; roundedStrings: string[];
}
