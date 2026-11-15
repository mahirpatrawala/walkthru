// The loader indirection for uploaded homes. The buyer page reads a home as files under /scenes/<id>/ (property.json, proposal-extras.json,
// designs.json, and a few optional ones). For an id like `local-k3m9x2bq7t` those files are in the browser's own store, so this answers those
// URLs from there and nothing else: no request leaves the device for them. Every other URL goes to the real `fetch`. Files an upload does not
// have (look.json, a baked-lighting manifest, a design sheet) answer 404, which the page already treats as "not there, use the standard one".
import { isLocalId, openStore } from './store';
import type { HomeStore, StoredHome } from './store';

const json = (v: unknown): Response => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
const notFound = (): Response => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });

/** The answer for one URL path, or null when it is not under this home's folder. Pure, for tests. */
export function answerFor(home: StoredHome | null, id: string, pathname: string): Response | null {
  const prefix = `/scenes/${id}/`;
  if (!pathname.startsWith(prefix)) return null;
  if (!home) return notFound();
  switch (pathname.slice(prefix.length)) {
    case 'property.json': return json(home.data.property);
    case 'proposal-extras.json': return json(home.data.extras);
    case 'designs.json': return json(home.data.designs);
    default: return notFound();
  }
}

/** Looks the home up, then makes `fetch` answer for it. Returns the home (null when this device does not have it). */
export async function installLocalScene(id: string, store: HomeStore = openStore(), target: { fetch: typeof fetch } = globalThis): Promise<StoredHome | null> {
  if (!isLocalId(id)) return null;
  let home: StoredHome | null = null;
  try { home = await store.get(id); } catch { home = null; }
  const real = target.fetch.bind(globalThis);
  target.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(raw, typeof location === 'undefined' ? 'http://localhost/' : location.href);
      if (typeof location === 'undefined' || u.origin === location.origin) {
        const hit = answerFor(home, id, u.pathname);
        if (hit) return Promise.resolve(hit);
      }
    } catch { /* not a URL we understand: the real fetch decides */ }
    return real(input, init);
  }) as typeof fetch;
  return home;
}
