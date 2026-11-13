// The scene manifest behind the start page: public/scenes/index.json, one entry per public/scenes/<id>/property.json.
// Pure (no fs, no DOM): scripts/make-scene-index.ts and the Vite plugin read the files and hand them here.
import { validateProperty } from '../core/layout-validate';
import { unverifiedRoomsFromExtras } from '../core/room-trust';
import { sceneOrigin } from '../buyer/scene-tag';
import type { SceneOrigin } from '../buyer/scene-tag';
import type { Layout, PropertyFile } from '../types';

export const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;

/** Just the geometry a floor-plan picture needs; no finishes, no furniture, nothing that identifies a client. */
export type PlanLayout = Pick<Layout, 'wallHeightM' | 'wallThicknessM' | 'railingHeightM' | 'rooms' | 'openings'>;

export interface SceneEntry {
  id: string;
  title: string;
  subtitle?: string;
  origin: SceneOrigin;
  layout: PlanLayout;
  /** room id -> why its size was not measured (from proposal-extras.json) */
  unverified: Record<string, string>;
}

export interface SceneIndex { version: 1; scenes: SceneEntry[] }

export interface SceneFiles {
  id: string;
  /** parsed property.json */
  property: unknown;
  /** parsed proposal-extras.json, when the scene has one */
  extras?: unknown;
}

/** One scene's entry, or null with a reason when its property.json is not usable. */
export function sceneEntry(f: SceneFiles): { entry: SceneEntry | null; problem?: string } {
  if (!SCENE_ID_RE.test(f.id)) return { entry: null, problem: 'folder name is not a valid scene id' };
  let property: PropertyFile;
  try {
    property = validateProperty(f.property);
  } catch (err) {
    return { entry: null, problem: err instanceof Error ? err.message : String(err) };
  }
  if (property.layout.rooms.length === 0) return { entry: null, problem: 'the layout has no rooms' };
  // validateProperty normalises room winding; the raw file is the source of `partial` whatever the parser keeps
  const rawRooms = (f.property as { layout?: { rooms?: { id?: unknown; partial?: unknown }[] } }).layout?.rooms ?? [];
  const partialById = new Map<string, { reason: string }>();
  for (const r of rawRooms) {
    const p = r?.partial as { reason?: unknown } | undefined;
    if (typeof r?.id === 'string' && p && typeof p === 'object') partialById.set(r.id, { reason: typeof p.reason === 'string' ? p.reason : '' });
  }
  const lay = property.layout;
  const rooms = lay.rooms.map((r) => (partialById.has(r.id) ? { ...r, partial: partialById.get(r.id)! } : r));
  const hasSplat = !!(f.property as { splat?: unknown }).splat;
  return {
    entry: {
      id: f.id,
      title: property.title || f.id,
      ...(property.subtitle ? { subtitle: property.subtitle } : {}),
      origin: sceneOrigin({ id: f.id, subtitle: property.subtitle, hasSplat }),
      layout: { wallHeightM: lay.wallHeightM, wallThicknessM: lay.wallThicknessM, railingHeightM: lay.railingHeightM, rooms, openings: lay.openings },
      unverified: f.extras === undefined ? {} : unverifiedRoomsFromExtras(f.extras),
    },
  };
}

const ORIGIN_RANK: Record<SceneOrigin, number> = { real: 0, sample: 1, video: 2 };

/** Real drawings first, then the sample homes (test-sample-* before the older test flats), then phone-video scenes. */
export function compareScenes(a: SceneEntry, b: SceneEntry): number {
  if (a.origin !== b.origin) return ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
  const sample = (s: SceneEntry): number => (/^test-sample-/.test(s.id) ? 0 : 1);
  if (sample(a) !== sample(b)) return sample(a) - sample(b);
  return a.id.localeCompare(b.id, 'en', { numeric: true });
}

/** The whole manifest. Folders whose property.json is unusable are left out; `warn` hears why. */
export function buildSceneIndex(files: SceneFiles[], warn: (msg: string) => void = () => {}): SceneIndex {
  const scenes: SceneEntry[] = [];
  for (const f of files) {
    const { entry, problem } = sceneEntry(f);
    if (entry) scenes.push(entry);
    else warn(`scene index: skipped "${f.id}" (${problem})`);
  }
  scenes.sort(compareScenes);
  return { version: 1, scenes };
}
