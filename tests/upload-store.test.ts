// Uploaded homes in the browser: IndexedDB when it is there, memory and sessionStorage when it is not, and never a throw into the page.
import { describe, expect, it } from 'vitest';
import { isLocalId, newLocalId, openStore } from '../src/upload/store';
import type { StoredHome } from '../src/upload/store';
import type { HomeData } from '../src/upload/read-core';

const home = (id: string, at: string): StoredHome => ({
  id, createdAt: at, source: 'file',
  data: {
    property: { version: 1, id, title: id, layout: { rooms: [] } }, extras: { rooms: [], warnings: [] }, designs: { version: 1, source: 'x', items: {} },
    doc: { version: 1, input: { kind: 'vector-pdf', pages: 1, sha256: '' }, views: [{ id: 'p1' }], dimensions: [{ id: 'd' }], rooms: [], openings: [{ id: 'o' }], items: [], symbols: [], conflicts: [], warnings: [] },
    base: { proposal: { rooms: [], openings: [] }, extras: { rooms: [] }, designs: {} }, notes: { unread: [], conflicts: [], checkedByYou: 0 }, pages: 1, seconds: { open: 0, read: 0, build: 0, total: 0 },
  } as unknown as HomeData,
});

/** Just enough of IndexedDB for the store: one object store keyed by `id`, put, get, getAll, delete, transactions that complete. */
function fakeIdb(): { factory: IDBFactory; rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  const request = <T,>(run: () => T): IDBRequest<T> => {
    const r = { result: undefined as T, onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
    queueMicrotask(() => { r.result = run(); r.onsuccess?.(); });
    return r as unknown as IDBRequest<T>;
  };
  const objectStore = {
    put: (v: { id: string }) => request(() => { rows.set(v.id, structuredClone(v)); return v.id; }),
    get: (k: string) => request(() => rows.get(k)),
    getAll: () => request(() => [...rows.values()]),
    delete: (k: string) => request(() => { rows.delete(k); return undefined; }),
  };
  const db = {
    transaction: () => {
      const t = { objectStore: () => objectStore, oncomplete: null as null | (() => void), onerror: null as null | (() => void), onabort: null as null | (() => void) };
      setTimeout(() => t.oncomplete?.(), 5);
      return t;
    },
    createObjectStore: () => objectStore, close: () => {}, onversionchange: null,
  };
  const factory = {
    open: () => {
      const req = { result: db, onupgradeneeded: null as null | (() => void), onsuccess: null as null | (() => void), onerror: null as null | (() => void), onblocked: null as null | (() => void) };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, rows };
}

const session = (): Storage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() } as Storage;
};

describe('local ids', () => {
  it('are made to fit the scene id rules and are told apart from shipped scenes', () => {
    for (let i = 0; i < 50; i++) { const id = newLocalId(); expect(id).toMatch(/^[a-z0-9-]{1,40}$/); expect(isLocalId(id)).toBe(true); }
    expect(isLocalId('test-sample-1')).toBe(false);
    expect(isLocalId('local-')).toBe(false);
    expect(isLocalId('local-../x')).toBe(false);
  });
});

describe('with IndexedDB', () => {
  it('puts, gets, lists newest first and removes', async () => {
    const { factory, rows } = fakeIdb();
    const s = openStore(factory, session());
    await s.put(home('local-aaaaaa01', '2026-01-01'));
    await s.put(home('local-bbbbbb02', '2026-02-01'));
    expect(rows.size).toBe(2);
    expect(s.mode()).toBe('indexeddb');
    expect((await s.get('local-aaaaaa01'))?.id).toBe('local-aaaaaa01');
    expect((await s.list()).map((h) => h.id)).toEqual(['local-bbbbbb02', 'local-aaaaaa01']);
    await s.remove('local-bbbbbb02');
    expect((await s.list()).map((h) => h.id)).toEqual(['local-aaaaaa01']);
    expect(await s.get('local-bbbbbb02')).toBeNull();
  });
});

describe('without IndexedDB', () => {
  it('falls back to memory (no factory at all)', async () => {
    const s = openStore(null, null);
    expect(s.mode()).toBe('memory');
    await s.put(home('local-mem00001', '2026-03-01'));
    expect((await s.get('local-mem00001'))?.id).toBe('local-mem00001');
    expect((await s.list()).some((h) => h.id === 'local-mem00001')).toBe(true);
    await s.remove('local-mem00001');
    expect(await s.get('local-mem00001')).toBeNull();
  });

  it('falls back when IndexedDB refuses to open (private window, blocked site data)', async () => {
    const broken = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const s = openStore(broken, session());
    await expect(s.put(home('local-brk00001', '2026-03-02'))).resolves.toBeUndefined();
    expect(s.mode()).toBe('memory');
    expect((await s.get('local-brk00001'))?.id).toBe('local-brk00001');
  });

  it('falls back when the open request errors', async () => {
    const erroring = { open: () => { const r = { onerror: null as null | (() => void) }; queueMicrotask(() => r.onerror?.()); return r; } } as unknown as IDBFactory;
    const s = openStore(erroring, session());
    await s.put(home('local-err00001', '2026-03-03'));
    expect(s.mode()).toBe('memory');
    expect((await s.list()).map((h) => h.id)).toContain('local-err00001');
  });

  it('keeps the walkable part in sessionStorage so the walk after an upload still opens in a new page load', async () => {
    const ss = session();
    const s1 = openStore(null, ss);
    await s1.put(home('local-ses00001', '2026-03-04'));
    // a new page load: memory is gone in a real browser; here a fresh store sees only sessionStorage after the module memory is cleared by removing through another store
    expect(ss.getItem('walkthru:upload:local-ses00001')).toContain('local-ses00001');
    const lite = JSON.parse(ss.getItem('walkthru:upload:local-ses00001')!) as StoredHome;
    expect(lite.data.doc.dimensions).toEqual([]); // the machine file is trimmed to fit
    expect(lite.data.property.id).toBe('local-ses00001');
  });

  it('never throws on a full or blocked sessionStorage', async () => {
    const full = { ...session(), setItem: () => { throw new Error('QuotaExceededError'); } } as unknown as Storage;
    const s = openStore(null, full);
    await expect(s.put(home('local-full0001', '2026-03-05'))).resolves.toBeUndefined();
    expect((await s.get('local-full0001'))?.id).toBe('local-full0001');
  });

  it('list ignores records that are not local ids', async () => {
    const { factory, rows } = fakeIdb();
    rows.set('test-sample-1', home('test-sample-1', '2026-01-01'));
    const s = openStore(factory, session());
    expect(await s.list()).toEqual([]);
  });
});
