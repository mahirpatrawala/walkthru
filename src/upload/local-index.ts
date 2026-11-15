// "Your uploads" on the start page: the homes in this browser, as the same entries the gallery draws for the shipped homes.
import { sceneEntry } from '../start/manifest';
import type { SceneEntry } from '../start/manifest';
import { openStore } from './store';
import type { HomeStore } from './store';

/** One entry per stored home, newest first. A record that no longer validates is left out; it never throws. */
export async function loadLocalEntries(store: HomeStore = openStore()): Promise<SceneEntry[]> {
  let homes;
  try { homes = await store.list(); } catch { return []; }
  const out: SceneEntry[] = [];
  for (const h of homes) {
    try {
      const { entry } = sceneEntry({ id: h.id, property: h.data.property, extras: h.data.extras });
      if (entry) out.push(entry);
    } catch { /* skip */ }
  }
  return out;
}

export async function deleteLocal(id: string, store: HomeStore = openStore()): Promise<void> {
  try { await store.remove(id); } catch { /* nothing more to do */ }
  // what the visitor placed or chose in this home goes with it (every key the buyer page wrote carries the id)
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('walkthru:') && k.includes(id)) localStorage.removeItem(k); } catch { /* ignore */ }
}
