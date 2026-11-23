// Which views a flat has (SPEC 2.10): an authored list when the scene or the building's space gives one, else the generated views; then any
// pictures attached by id. Pure and deterministic: the page and `scripts/export-viewpoints.ts` call this with the same inputs (the scene file's own
// layout and furniture, as drawn), so a renderer gets the very points the page shows.
import type { FurnitureItem, Layout } from '../../types';
import { rasterizeLayout, stampFurniture } from '../../core/layout-raster';
import { composeViewpoints } from './compose';
import type { Viewpoint } from './compose';
import { viewpointsFromSpec } from './override';
import { attachPanos } from './pano';

export interface ResolveInput {
  layout: Layout;
  /** the scene file's furniture, as drawn (not a viewer's own layout) */
  furniture: readonly FurnitureItem[];
  /** `viewpoints` of the building's space, else of the scene file: an authored list replaces the generated one */
  override?: unknown;
  /** `viewpointPanos` (view id -> picture) */
  panos?: unknown;
  /** the scene folder, for picture addresses relative to it ("/scenes/<id>/") */
  sceneBase?: string | null;
}

export function resolveViewpoints(i: ResolveInput): { views: Viewpoint[]; source: 'generated' | 'authored'; warnings: string[] } {
  const authored = viewpointsFromSpec(i.override, i.layout, i.sceneBase ?? null);
  const base = authored ? authored.views : composeViewpoints({ layout: i.layout, furniture: i.furniture, grid: stampFurniture(rasterizeLayout(i.layout), [...i.furniture]) });
  return { views: attachPanos(base, i.panos, i.sceneBase ?? null), source: authored ? 'authored' : 'generated', warnings: authored?.warnings ?? [] };
}
