// C12c. The elevation stage as one call: find the views, read the key, link each view to a wall, choose each view's scale, read it.
// Pure TypeScript. The pipeline (pipeline.ts) calls this after the plan symbols; reconcile.ts merges what it finds with the plan.
import type { ImportResult } from '../import/types';
import type { ProposeTrace } from '../import/propose';
import type { Analysis } from './text-dims';
import type { PlanRead } from './plan-read';
import { discoverViews, findKeyMarker, linkViews, planItems, wallsOf } from './elevation-link';
import type { ElevView, KeyMarker, LinkResult, PlanItem, WallRef } from './elevation-link';
import { evaluateDims, fitDelta, readView } from './elevation-read';
import type { DimEval, ReadScale, ViewRead } from './elevation-read';

export interface ElevationUnderstanding {
  key: KeyMarker | null;
  views: ElevView[];
  links: LinkResult[];
  reads: ViewRead[];
  /** the dimension verdicts each view's scale allowed (the second chance a dimension gets against the linked wall) */
  dimEvals: Map<string, Map<string, DimEval>>;
  walls: WallRef[];
  items: PlanItem[];
  /** link confidence under which a link is only a question to the broker */
  warnings: string[];
}

export const LINK_MIN = 0.6;
/** The wall's length is as good as the plan's room: a verified room's walls are a ruler the elevation does not own. */
const WALL_DELTA_TRUSTED = 0.006, WALL_DELTA_UNTRUSTED = 0.06;

export function scaleFor(view: ElevView, link: LinkResult | undefined, wallTrusted: boolean): ReadScale | null {
  const wallRuler = ((): { ptPerM: number; delta: number } | null => {
    if (!view.st || !link?.wall || link.confidence < LINK_MIN) return null;
    const W = view.st.right - view.st.left;
    if (W <= 0 || link.wall.length <= 0) return null;
    return { ptPerM: W / link.wall.length, delta: wallTrusted ? WALL_DELTA_TRUSTED : WALL_DELTA_UNTRUSTED };
  })();
  if (view.fit && !view.fit.notToScale) {
    // a view's own scale and the wall's agree to a couple of percent, or the link is doubted and only the view's own is used
    const agrees = wallRuler && Math.abs(wallRuler.ptPerM / view.fit.ptPerM - 1) <= 0.03;
    return { ptPerM: view.fit.ptPerM, source: 'dimensions', delta: fitDelta(view.fit.weight, view.fit.spread), trusted: true, ...(agrees && wallRuler && wallTrusted ? { wall: wallRuler } : {}) };
  }
  return wallRuler ? { ptPerM: wallRuler.ptPerM, source: 'wall', delta: wallRuler.delta, trusted: wallTrusted } : null;
}

export function understandElevations(result: ImportResult, trace: ProposeTrace, analysis: Analysis, plan: PlanRead): ElevationUnderstanding {
  const warnings: string[] = [];
  const empty: ElevationUnderstanding = { key: null, views: [], links: [], reads: [], dimEvals: new Map(), walls: [], items: [], warnings };
  if (!result.proposal.rooms.length || !trace.frame) return empty;
  const { views } = discoverViews(result, trace, analysis.pages);
  if (!views.length) return empty;
  const walls = wallsOf(result);
  const items = planItems(result, plan);
  const key = findKeyMarker(result, trace);
  const planTrusted = result.extras.scale.agreeing >= 3;
  const links = linkViews(views, walls, result, items, key, { planScaleOk: planTrusted });
  const reads: ViewRead[] = [];
  const dimEvals = new Map<string, Map<string, DimEval>>();
  // a view with a scale of its own that lands on its linked wall within a percent confirms the plan's scale for the others
  const confirms = new Set<string>();
  for (const v of views) {
    const l = links.find((x) => x.view === v.id);
    if (!v.st || !v.fit || v.fit.notToScale || !l?.wall || l.confidence < LINK_MIN || l.planScale) continue;
    if (Math.abs((v.st.right - v.st.left) / v.fit.ptPerM / l.wall.length - 1) <= 0.012) confirms.add(v.id);
  }
  for (const v of views) {
    const link = links.find((l) => l.view === v.id);
    const roomVerified = !!link?.wall && analysis.roomStatus.get(link.wall.roomId) === 'verified';
    const others = [...confirms].filter((id) => id !== v.id).length;
    const wallTrusted = !link?.planScale && (roomVerified || planTrusted || others >= 1);
    const scale = scaleFor(v, link, wallTrusted);
    const ev = evaluateDims(v, scale);
    dimEvals.set(v.id, ev);
    reads.push(readView(v, scale, ev, trace.reads[v.page], v.caption?.text ?? ''));
    if (link && link.confidence < LINK_MIN && v.st) warnings.push(`Which wall does ${v.caption?.text ?? 'an elevation'} show? The drawing does not say clearly.`);
    if (link?.planScale) warnings.push(`The elevations say the walls are ${(1 / link.planScale).toFixed(2)} times as long as the plan has them. Check the plan's scale.`);
  }
  return { key, views, links, reads, dimEvals, walls, items, warnings };
}
