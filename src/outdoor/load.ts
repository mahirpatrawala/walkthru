// Reading an outdoor.json (SPEC 19.2) and the one rule the shell needs from it. Pure: no three, so the buyer page can ask without loading the builder.
import type { OutdoorFile } from './types';
import { parseOutdoor } from './types';

/** `room:edge` of every boundary the outdoor module draws itself (all but the facade, which the shell draws with its door in it) */
export function ownedEdges(file: OutdoorFile): Set<string> {
  return new Set(file.boundary.filter((b) => b.kind !== 'facade').map((b) => `${b.room}:${b.edge}`));
}

/** The optional outdoor.json of a scene. Missing, HTML (a dev server's index page) or broken: null, and the scene is an ordinary indoor one. */
export async function fetchOutdoor(sceneId: string): Promise<OutdoorFile | null> {
  try {
    const res = await fetch(`/scenes/${sceneId}/outdoor.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    if (/^\s*</.test(text)) return null;
    return parseOutdoor(JSON.parse(text));
  } catch (e) {
    console.warn('[walkthru] outdoor.json could not be read; the scene opens as an ordinary room.', e);
    return null;
  }
}
