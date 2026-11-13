// C12c. The whole vector pipeline as one call: import (walls of any style, rooms with or without labels), text and dimensions
// (C12b), plan symbols, elevation linking and reading, reconciliation. The writers (write.ts) and the evaluation adapter both
// start from the `Understood` it returns. Pure TypeScript; no network.
import type { ImportResult, VectorPage } from '../import/types';
import { proposeWithTrace } from '../import/propose';
import type { ProposeTrace } from '../import/propose';
import { analyseTrace } from './text-dims';
import type { Analysis } from './text-dims';
import { readPlan } from './plan-read';
import type { PlanRead } from './plan-read';
import { understandElevations } from './elevations';
import type { ElevationUnderstanding } from './elevations';

export interface Understood {
  result: ImportResult; trace: ProposeTrace; analysis: Analysis; plan: PlanRead; elev: ElevationUnderstanding;
}

export function understandPages(pages: VectorPage[], sourceFile = 'input', sceneId = 'scene'): Understood {
  const { result, trace } = proposeWithTrace(pages, sourceFile, sceneId);
  const analysis = analyseTrace(result, trace);
  const plan = readPlan(result, trace);
  const elev = understandElevations(result, trace, analysis, plan);
  return { result, trace, analysis, plan, elev };
}
