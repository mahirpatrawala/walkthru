// Owned by C11b. SPEC 16.6.4: who is walking. Pure helpers (storage is injected), so they run under Node.
import { HEIGHT_MAX_CM, HEIGHT_MIN_CM } from '../types';
import { DEFAULT_TONE, SKIN_TONES, clampTone } from '../look/people-materials';
import { DEFAULT_HEIGHT_CM, HEIGHT_KEY, clampHeightCm, storageGet, storageSet } from './store';
import type { StorageLike } from './store';

export const PERSON_KEY = 'walkthru:person';
export type PersonBodyChoice = 'male' | 'female';
export interface PersonState { body: PersonBodyChoice; tone: number; heightCm: number }

export const DEFAULT_PERSON: PersonState = { body: 'male', tone: DEFAULT_TONE, heightCm: DEFAULT_HEIGHT_CM };

/** Any input to a valid state: a bad body falls back to male, the tone and the height are clamped. */
export function normalisePerson(v: unknown): PersonState {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const body: PersonBodyChoice = o.body === 'female' ? 'female' : 'male';
  const h = typeof o.heightCm === 'number' ? o.heightCm : Number(o.heightCm);
  return {
    body,
    tone: clampTone(typeof o.tone === 'number' ? Math.min(SKIN_TONES.length - 1, Math.max(0, o.tone)) : DEFAULT_TONE),
    heightCm: Number.isFinite(h) ? Math.min(HEIGHT_MAX_CM, Math.max(HEIGHT_MIN_CM, Math.round(h))) : DEFAULT_PERSON.heightCm,
  };
}

/**
 * Reads `walkthru:person`. When it is absent the old `walkthru:height` is read once as a migration:
 * { male, tone 2, that height }. Nothing stored gives the defaults.
 */
export function loadPerson(storage: StorageLike | null): PersonState {
  const raw = storageGet(storage, PERSON_KEY);
  if (raw !== null) {
    try { return normalisePerson(JSON.parse(raw)); } catch { /* fall through to the migration */ }
  }
  const old = storageGet(storage, HEIGHT_KEY);
  if (old !== null) {
    const n = Number(old);
    if (Number.isFinite(n) && n >= HEIGHT_MIN_CM && n <= HEIGHT_MAX_CM) return { ...DEFAULT_PERSON, heightCm: Math.round(n) };
  }
  return { ...DEFAULT_PERSON };
}

export function savePerson(storage: StorageLike | null, p: PersonState): void {
  storageSet(storage, PERSON_KEY, JSON.stringify({ body: p.body, tone: clampTone(p.tone), heightCm: clampHeightCm(p.heightCm) }));
}
