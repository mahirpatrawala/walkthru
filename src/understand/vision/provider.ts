// C12d. SPEC 17.8: the vision interface. It extends C8's PlanVisionProvider (whole raster plan in, ImportResult out) with the
// crop-level calls the pipeline uses to ask small, cheap questions. Boxes are in the pixels of the image that was sent.
// Every answer must carry a box; an answer without one is dropped by the provider, never guessed at.
import type { PlanVisionProvider } from '../../import/vision';

export type Box = [number, number, number, number]; // x0, y0, x1, y1
export interface CropIn { id: string; png: Uint8Array; hint?: 'dimension' | 'label' | 'note' }
export interface StringRead { id: string; text: string; box?: Box; confidence: number }
export interface ClassRead { id: string; choice: string; confidence: number }
export interface VisionUsage { calls: number; inputTokens: number; outputTokens: number; usd: number }

/** What a whole-view read returns once boxes are turned into pixels of the image sent. */
export interface PlanRead {
  rooms: { label: string; sizeText?: string; areaText?: string; box: Box; labelBox?: Box; polygon?: [number, number][] }[];
  dimensions: { text: string; box: Box; line?: Box }[];
  openings: { kind: 'door' | 'window' | 'opening'; box: Box }[];
  symbols: { cls: string; label?: string; box: Box }[];
}

/** What a layout read returns: areas that are title block, notes, legend or schedule, boxed in pixels of the picture sent. */
export interface LayoutRead { boxes: { kind: string; box: Box }[] }

export interface VisionProvider extends PlanVisionProvider {
  readonly name: string;
  /** the model for whole-view reads */
  readonly model: string;
  /** the model for crop reads and classification */
  readonly cropModel: string;
  readStrings(crops: CropIn[]): Promise<StringRead[]>;
  classify(crops: { id: string; png: Uint8Array }[], choices: string[]): Promise<ClassRead[]>;
  /** whole page or view: rooms, labels, dimensions, symbols, each with a box in image pixels. The schema names the shape. */
  readView(png: Uint8Array, kind: 'plan' | 'elevation', schema: object): Promise<PlanRead | LayoutRead | unknown>;
  usage(): VisionUsage;
}

export class VisionError extends Error {
  readonly code: 'no-key' | 'http' | 'bad-answer' | 'refused' | 'network';
  constructor(code: VisionError['code'], message: string) { super(message); this.name = 'VisionError'; this.code = code; }
}
