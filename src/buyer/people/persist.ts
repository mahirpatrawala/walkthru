// The people a viewer added, in this browser: one small value per home, next to "My layout"'s own (`walkthru:<scene>:mine`).
// Storage is injected, so this runs under Node. Anything malformed reads as no people.
import { storageGet, storageSet } from '../store';
import type { StorageLike } from '../store';
import { cloneRec, sanitizeRecs } from './rec';
import type { PersonRec } from './rec';

export const peopleKey = (sceneId: string): string => `walkthru:${sceneId}:people`;

export function parsePeople(raw: string | null): PersonRec[] {
  if (!raw) return [];
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return []; }
  const list = Array.isArray(json) ? json : (json && typeof json === 'object' ? (json as { people?: unknown }).people : null);
  return sanitizeRecs(list);
}

export function loadPeople(storage: StorageLike | null, sceneId: string): PersonRec[] {
  return parsePeople(storageGet(storage, peopleKey(sceneId)));
}

/** Writes the list; an empty list removes the key, so a home with no people leaves nothing behind. */
export function savePeople(storage: StorageLike | null, sceneId: string, list: readonly PersonRec[]): void {
  if (!storage) return;
  try {
    if (list.length === 0) storage.removeItem(peopleKey(sceneId));
    else storageSet(storage, peopleKey(sceneId), JSON.stringify({ version: 1, people: list.map(cloneRec) }));
  } catch { /* storage blocked: the people last for this visit */ }
}
