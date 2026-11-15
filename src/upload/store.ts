// Uploaded homes live in the visitor's browser, in IndexedDB. Where IndexedDB is not there (some private windows, blocked site data, a quota
// error) a copy is kept in memory for this page and, for the walkable part, in sessionStorage, so the walk that opens right after an upload
// still works. Every call is wrapped: a storage failure never throws into the page and never loses the home the visitor is looking at.
import type { ReviewFile } from '../understand/review-model';
import type { HomeData } from './read-core';

export const LOCAL_PREFIX = 'local-';
export const isLocalId = (id: string): boolean => /^local-[a-z0-9]{6,32}$/.test(id);
export function newLocalId(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(rand() * 31)];
  return `${LOCAL_PREFIX}${s}`;
}

export interface StoredHome {
  id: string;
  createdAt: string;
  /** a plan the visitor chose, or the bundled made-up sample */
  source: 'file' | 'sample';
  data: HomeData;
  /** what the visitor confirmed or corrected in "Check the drawing" */
  review?: ReviewFile;
  /** room names the visitor changed, by room id */
  renames?: Record<string, string>;
}

const DB_NAME = 'walkthru-uploads';
const STORE = 'homes';
const SESSION_KEY = 'walkthru:upload:';

export interface HomeStore {
  readonly mode: () => 'indexeddb' | 'memory';
  put(h: StoredHome): Promise<void>;
  get(id: string): Promise<StoredHome | null>;
  list(): Promise<StoredHome[]>;
  remove(id: string): Promise<void>;
}

const memory = new Map<string, StoredHome>();

/** The part of a home the walk needs, small enough for sessionStorage. The machine file and the review state are left out. */
function lite(h: StoredHome): StoredHome {
  return { ...h, data: { ...h.data, doc: { ...h.data.doc, dimensions: [], items: [], openings: [], symbols: [], views: [] }, base: { ...h.data.base, extras: h.data.base.extras } } };
}

export function openStore(idb: IDBFactory | null | undefined = typeof indexedDB === 'undefined' ? null : indexedDB, session: Storage | null = safeSession()): HomeStore {
  let dbp: Promise<IDBDatabase | null> | null = null;
  let broken = !idb;
  const db = (): Promise<IDBDatabase | null> => {
    if (broken || !idb) return Promise.resolve(null);
    dbp ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = idb.open(DB_NAME, 1);
        req.onupgradeneeded = (): void => { try { req.result.createObjectStore(STORE, { keyPath: 'id' }); } catch { /* an old store of the same name */ } };
        req.onsuccess = (): void => { const d = req.result; d.onversionchange = (): void => d.close(); resolve(d); };
        req.onerror = (): void => { broken = true; resolve(null); };
        req.onblocked = (): void => { broken = true; resolve(null); };
      } catch { broken = true; resolve(null); }
    });
    return dbp;
  };
  const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    const d = await db();
    if (!d) return { ok: false };
    return new Promise((resolve) => {
      try {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        let value: T;
        r.onsuccess = (): void => { value = r.result; };
        t.oncomplete = (): void => resolve({ ok: true, value });
        t.onerror = t.onabort = (): void => resolve({ ok: false });
        r.onerror = (): void => resolve({ ok: false });
      } catch { resolve({ ok: false }); }
    });
  };
  const sessionPut = (h: StoredHome): void => { try { session?.setItem(SESSION_KEY + h.id, JSON.stringify(lite(h))); } catch { /* too big or blocked: the memory copy still serves this page */ } };
  const sessionGet = (id: string): StoredHome | null => { try { const t = session?.getItem(SESSION_KEY + id); return t ? (JSON.parse(t) as StoredHome) : null; } catch { return null; } };
  const sessionIds = (): string[] => { const out: string[] = []; try { for (let i = 0; session && i < session.length; i++) { const k = session.key(i); if (k?.startsWith(SESSION_KEY)) out.push(k.slice(SESSION_KEY.length)); } } catch { /* ignore */ } return out; };

  return {
    mode: () => (broken || !idb ? 'memory' : 'indexeddb'),
    async put(h) {
      memory.set(h.id, h);
      const r = await tx('readwrite', (s) => s.put(h));
      if (!r.ok) sessionPut(h);
    },
    async get(id) {
      const r = await tx<StoredHome | undefined>('readonly', (s) => s.get(id) as IDBRequest<StoredHome | undefined>);
      if (r.ok && r.value) return r.value;
      return memory.get(id) ?? sessionGet(id);
    },
    async list() {
      const r = await tx<StoredHome[]>('readonly', (s) => s.getAll() as IDBRequest<StoredHome[]>);
      const byId = new Map<string, StoredHome>();
      if (r.ok) for (const h of r.value) byId.set(h.id, h);
      else {
        for (const id of sessionIds()) { const h = sessionGet(id); if (h) byId.set(id, h); }
        for (const h of memory.values()) byId.set(h.id, h);
      }
      return [...byId.values()].filter((h) => isLocalId(h.id)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    async remove(id) {
      memory.delete(id);
      try { session?.removeItem(SESSION_KEY + id); } catch { /* ignore */ }
      await tx('readwrite', (s) => s.delete(id));
    },
  };
}

function safeSession(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}
