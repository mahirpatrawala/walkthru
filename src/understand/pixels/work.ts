// C12d. Working records the raster path passes between its steps.
import type { Extracted, Status } from '../types';
import type { Pt, Rect } from './image';

export interface Frame { toPage: (p: Pt) => Pt; /** processed-image rect -> uploaded-page bounding rect */ rectToPage: (r: Rect) => Rect }
export interface DimWork {
  id: string; box: Rect; cands: { text: string; via: 'crop' | 'view' }[]; line?: [Pt, Pt]; endsOk: boolean;
  axis?: 'x' | 'y'; px?: number; m?: number; chosen?: string; agreeTwo: boolean;
  status: Status; checks: Extracted<number>['checks']; chain?: string; conflictNote?: string;
  /** |pixels read as metres - printed value| on a scale fitted without this dimension, and what the pixels can resolve */
  geoErrM?: number; slackM?: number;
}
export interface RoomWork {
  id: string; name: string; nameVia: 'crop' | 'view' | 'none'; sizeText?: string; areaText?: string; size?: { w: number; l: number }; areaM2?: number;
  poly: Pt[]; bboxPx: Rect; agreeTwo: boolean; labelBox?: Rect;
  status: Status; checks: Extracted<number>['checks']; backed: boolean; conflictNote?: string;
}
