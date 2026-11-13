// Owned by C11b. SPEC 16.6.4: who is walking. Pure helpers (storage is injected), so they run under Node.
import { HEIGHT_MAX_CM, HEIGHT_MIN_CM, HEIGHT_TINTS } from '../types';
import { DEFAULT_TONE, SKIN_TONES, clampTone } from '../look/people-materials';
import { HEIGHT_KEY, storageGet, storageSet } from './store';
import type { StorageLike } from './store';
import { PERSON_BODIES } from '../look/people';
import type { PersonBody } from '../look/people';

export const PERSON_KEY = 'walkthru:person';
export type PersonBodyChoice = PersonBody;
export interface PersonState { body: PersonBodyChoice; tone: number; heightCm: number }

/** What each person is called in the picker, and how tall they start. */
export const PERSON_LABELS: Record<PersonBodyChoice, string> = { man: 'Man', woman: 'Woman', elder: 'Elder', child: 'Child' };
export const BODY_DEFAULT_CM: Record<PersonBodyChoice, number> = { man: 175, woman: 160, elder: 150, child: 120 };
/** The stepper's range for each person. The proportions stay human at every height in it. */
export const BODY_RANGE_CM: Record<PersonBodyChoice, readonly [number, number]> = { man: [150, 200], woman: [140, 190], elder: [135, 180], child: [90, 150] };
/** The three quick heights for each person; their tints are HEIGHT_TINTS in order (teal, orange, violet). */
export const BODY_CHIPS_CM: Record<PersonBodyChoice, readonly [number, number, number]> = {
  man: [160, 175, 190], woman: [160, 168, 176], elder: [150, 158, 166], child: [105, 120, 135],
};

export const DEFAULT_PERSON: PersonState = { body: 'man', tone: DEFAULT_TONE, heightCm: BODY_DEFAULT_CM.man };

/** 'male' and 'female' are what version 1 of the picker stored. */
export function bodyFrom(v: unknown): PersonBodyChoice {
  if (v === 'male') return 'man';
  if (v === 'female') return 'woman';
  return (PERSON_BODIES as readonly unknown[]).includes(v) ? (v as PersonBodyChoice) : 'man';
}

/** Whole centimetres inside the person's own range. Not a number gives the person's default height. */
export function clampPersonHeight(body: PersonBodyChoice, cm: unknown): number {
  const n = typeof cm === 'number' ? cm : Number(cm);
  if (!Number.isFinite(n)) return BODY_DEFAULT_CM[body];
  const [lo, hi] = BODY_RANGE_CM[body];
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** The tint of the top (kurta, kameez, blouse) for a height: that of the nearest of the person's three quick heights. */
export function tintForPerson(body: PersonBodyChoice, cm: number): string {
  const chips = BODY_CHIPS_CM[body];
  let best = 0;
  chips.forEach((c, i) => { if (Math.abs(c - cm) < Math.abs(chips[best] - cm)) best = i; });
  return HEIGHT_TINTS[best];
}

/** Any input to a valid state: a bad body falls back to the man, the tone and the height are clamped. */
export function normalisePerson(v: unknown): PersonState {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const body = bodyFrom(o.body);
  return {
    body,
    tone: clampTone(typeof o.tone === 'number' ? Math.min(SKIN_TONES.length - 1, Math.max(0, o.tone)) : DEFAULT_TONE),
    heightCm: clampPersonHeight(body, o.heightCm),
  };
}

/**
 * Reads `walkthru:person`. When it is absent the old `walkthru:height` is read once as a migration:
 * { man, tone 2, that height }. Nothing stored gives the defaults.
 */
export function loadPerson(storage: StorageLike | null): PersonState {
  const raw = storageGet(storage, PERSON_KEY);
  if (raw !== null) {
    try { return normalisePerson(JSON.parse(raw)); } catch { /* fall through to the migration */ }
  }
  const old = storageGet(storage, HEIGHT_KEY);
  if (old !== null) {
    const n = Number(old);
    if (Number.isFinite(n) && n >= BODY_RANGE_CM.man[0] - 10 && n <= HEIGHT_MAX_CM && n >= HEIGHT_MIN_CM) return { ...DEFAULT_PERSON, heightCm: clampPersonHeight('man', n) };
  }
  return { ...DEFAULT_PERSON };
}

export function savePerson(storage: StorageLike | null, p: PersonState): void {
  const n = normalisePerson(p);
  storageSet(storage, PERSON_KEY, JSON.stringify({ body: n.body, tone: n.tone, heightCm: n.heightCm }));
}
