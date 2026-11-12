// C8. SPEC 13.9: raster plans, interface only. Nothing here calls a model, handles a key or touches the network.
import { ImportError } from './types';
import type { ImportResult } from './types';

export interface PlanVisionInput {
  image: Uint8Array; mime: 'image/png' | 'image/jpeg' | 'image/webp';
  hints?: { knownDimensions?: { label: string; lengthM: number }[]; ceilingM?: number };
}
export interface PlanVisionProvider {
  readonly name: string;
  /** must return the same shapes the vector path returns, in world metres */
  propose(input: PlanVisionInput): Promise<ImportResult>;
}
export class VisionNotConfigured implements PlanVisionProvider {
  readonly name = 'none';
  async propose(_input: PlanVisionInput): Promise<ImportResult> {
    throw new ImportError('vision-not-configured', 'No vision provider is configured. Trace the plan in the editor.');
  }
}
