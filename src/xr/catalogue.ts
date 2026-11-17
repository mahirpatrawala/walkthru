// The homes the VR page offers, from the same two lists the normal start page reads: the gallery of homes (public/scenes/index.json) and the buildings
// (public/buildings/index.json, then each building's own file for its flats). Pure helpers first, then the fetches.
import type { SceneIndex } from '../start/manifest';
import type { BuildingFile, BuildingIndex } from '../building/types';
import { fetchBuilding, fetchBuildingIndex } from '../building/load';
import type { XrTarget } from './url';

export interface HomeEntry {
  /** unique in the list: the scene id, or "building/space" */
  key: string;
  /** the scene that is opened */
  sceneId: string;
  target: XrTarget;
  label: string;
  sub: string;
}

/** The scene a target names: a scene is itself, a space of a building is the scene behind it. */
export function sceneOfTarget(t: XrTarget, buildings: ReadonlyMap<string, BuildingFile>): string | null {
  if (t.kind === 'scene') return t.scene;
  const b = buildings.get(t.building);
  for (const l of b?.levels ?? []) for (const s of l.spaces) if (s.id === t.space) return s.sceneId;
  return null;
}

export const keyOfTarget = (t: XrTarget): string => (t.kind === 'scene' ? t.scene : `${t.building}/${t.space}`);

const ORIGIN_SUB: Record<string, string> = { real: 'Your drawing', brochure: 'Follows a published brochure', sample: 'Made-up sample', video: 'From a phone video', upload: 'Uploaded' };

/** "Flat 201 · 2 BHK · 644 sq ft" -> "Flat 201" and "2 BHK · 644 sq ft" (as the Flats switcher words it) */
function flatWords(b: BuildingFile, s: { name: string; type?: string }): { title: string; detail: string } {
  const parts = s.name.split(' · ');
  const typed = s.type ? b.flatTypes[s.type]?.name : undefined;
  return { title: parts[0] || s.name, detail: typed ?? parts.slice(1).join(' · ') };
}

/**
 * The list: the gallery's homes in the order the start page shows them, then every flat of every building. A flat whose scene is already on the gallery
 * is listed once, as the gallery's entry (the building's name goes in its second line). Open-air spaces are not offered: the VR page does not draw water yet.
 */
export function buildHomeList(index: SceneIndex | null, buildings: readonly BuildingFile[]): HomeEntry[] {
  const out: HomeEntry[] = [];
  const bySceneId = new Map<string, HomeEntry>();
  for (const s of index?.scenes ?? []) {
    const e: HomeEntry = { key: s.id, sceneId: s.id, target: { kind: 'scene', scene: s.id }, label: s.title, sub: s.subtitle ? s.subtitle.split(/\.\s/)[0].slice(0, 60) : ORIGIN_SUB[s.origin] ?? '' };
    out.push(e); bySceneId.set(s.id, e);
  }
  for (const b of buildings) {
    for (const level of b.levels) {
      for (const s of level.spaces) {
        if (s.kind !== 'home' || s.comingNext) continue;
        const w = flatWords(b, s);
        const sub = [w.detail, b.name].filter(Boolean).join(' · ');
        const known = bySceneId.get(s.sceneId);
        if (known) { known.sub = sub; known.target = { kind: 'space', building: b.id, space: s.id }; known.key = `${b.id}/${s.id}`; continue; }
        out.push({ key: `${b.id}/${s.id}`, sceneId: s.sceneId, target: { kind: 'space', building: b.id, space: s.id }, label: w.title, sub });
      }
    }
  }
  return out;
}

/** Fetches both lists. A missing list only means fewer homes; the page still opens a home named in the address. */
export async function fetchHomeList(): Promise<{ homes: HomeEntry[]; buildings: Map<string, BuildingFile> }> {
  let index: SceneIndex | null = null;
  try {
    const res = await fetch('/scenes/index.json', { cache: 'no-cache' });
    const text = res.ok ? await res.text() : '';
    if (text && !/^\s*</.test(text)) { const j = JSON.parse(text) as SceneIndex; if (j && Array.isArray(j.scenes)) index = j; }
  } catch { /* an empty list */ }
  let bIndex: BuildingIndex = { version: 1, buildings: [] };
  try { bIndex = await fetchBuildingIndex(); } catch { /* none */ }
  const buildings = new Map<string, BuildingFile>();
  for (const e of bIndex.buildings) {
    try { buildings.set(e.id, await fetchBuilding(e.id)); } catch (err) { console.warn('[walkthru-vr] a building could not be read', e.id, err); }
  }
  return { homes: buildHomeList(index, [...buildings.values()]), buildings };
}
