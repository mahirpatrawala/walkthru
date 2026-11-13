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
import { applyDimUpgrades } from './reconcile';
import { labelGeometry } from './label-geometry';
import { applyLabelGeometry, needsRescale } from './label-apply';
import { applyUnits } from './flat-units';

export interface Understood {
  result: ImportResult; trace: ProposeTrace; analysis: Analysis; plan: PlanRead; elev: ElevationUnderstanding;
}

export function understandPages(pages: VectorPage[], sourceFile = 'input', sceneId = 'scene'): Understood {
  let { result, trace } = proposeWithTrace(pages, sourceFile, sceneId);
  // printed room sizes against the walls drawn around them: a scale where the importer had none, and honest statuses (SPEC 17.5, label area)
  let lg = labelGeometry(result, trace);
  if (needsRescale(result, lg)) { ({ result, trace } = proposeWithTrace(pages, sourceFile, sceneId, { ptPerM: lg.ptPerM! })); lg = labelGeometry(result, trace); }
  const analysis = analyseTrace(result, trace);
  applyLabelGeometry(result, analysis, lg);
  applyUnits(result);
  const plan = readPlan(result, trace);
  const elev = understandElevations(result, trace, analysis, plan);
  applyDimUpgrades(analysis, elev, trace.frame ? { cx: trace.frame.cx, cy: trace.frame.cy } : null);
  return { result, trace, analysis, plan, elev };
}
