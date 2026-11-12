// C12a. Loaders and matchers for the generic lexicons in ./lexicon/*.json (SPEC 17.4).
// Pure TypeScript. Adding a word is a data change; no code names a drawing, a firm or a person.
import type { RoomType } from '../types';
import R from './lexicon/rooms.json';
import F from './lexicon/furniture.json';
import X from './lexicon/fixtures.json';
import E from './lexicon/elevation.json';

/** Lower case, punctuation ignored (m.bed = m bed), letters and digits split (bedroom1 -> bedroom 1). */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9À-ɏ]+/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean);
}
const keyOf = (entry: string): string => tokens(entry).join(' ');
const compactOf = (entry: string): string => tokens(entry).join('');

interface Entry<T> { key: string; compact: string; n: number; tag: T }
class Index<T> {
  private byKey = new Map<string, Entry<T>>();
  private byCompact = new Map<string, Entry<T>>();
  maxN = 1;
  add(entry: string, tag: T): void {
    const key = keyOf(entry);
    if (!key) return;
    const e: Entry<T> = { key, compact: compactOf(entry), n: key.split(' ').length, tag };
    if (!this.byKey.has(key)) this.byKey.set(key, e);
    if (!this.byCompact.has(e.compact)) this.byCompact.set(e.compact, e);
    this.maxN = Math.max(this.maxN, e.n);
  }
  /** Entry matching exactly the tokens toks[i .. i+n) (spaced, or run together: "bed room" = "bedroom"). */
  at(toks: string[], i: number, n: number): Entry<T> | undefined {
    const span = toks.slice(i, i + n);
    if (span.length < n) return undefined;
    return this.byKey.get(span.join(' ')) ?? this.byCompact.get(span.join(''));
  }
  /** Non-overlapping matches, scanning left to right, longest first at each position. */
  scan(toks: string[]): { start: number; end: number; tag: T; n: number }[] {
    const out: { start: number; end: number; tag: T; n: number }[] = [];
    for (let i = 0; i < toks.length;) {
      let hit: { e: Entry<T>; n: number } | null = null;
      for (let n = Math.min(this.maxN + 1, toks.length - i); n >= 1; n--) {
        const e = this.at(toks, i, n);
        if (e) { hit = { e, n }; break; }
      }
      if (hit) { out.push({ start: i, end: i + hit.n, tag: hit.e.tag, n: hit.n }); i += hit.n; } else i++;
    }
    return out;
  }
}

// ---------------------------------------------------------------- rooms
const ROOM_TYPES = ['bedroom', 'living', 'kitchen', 'bathroom', 'balcony', 'other'] as const satisfies readonly RoomType[];
const roomIndex = new Index<RoomType>();
for (const t of ROOM_TYPES) for (const w of (R.types as Record<string, string[]>)[t] ?? []) roomIndex.add(w, t);
const roomWordSet = new Set(R.roomWords.flatMap(tokens));
const nonBedroomQualifiers = new Set(R.nonBedroomQualifiers.flatMap(tokens));
const qualifierStop = new Set(R.qualifierStopWords.flatMap(tokens));
const nonRoomWords = new Set(R.nonRoomWords.flatMap(tokens));

/** Typed room words in a label, in reading order. */
function roomMatches(toks: string[]): { type: RoomType; start: number; end: number }[] {
  return roomIndex.scan(toks).map((m) => ({ type: m.tag, start: m.start, end: m.end }));
}

/**
 * The room type of a label (SPEC 17.2 row 1). The last typed word decides ("MASTER TOILET" is a toilet). A label that is
 * "<qualifier> ROOM" with a qualifier no lexicon knows is a bedroom (SON ROOM, SPARE ROOM), unless the qualifier is a
 * known non-bedroom word (STORE, POOJA, STUDY, MEDIA...).
 */
export function roomTypeOf(text: string): RoomType {
  const toks = tokens(text);
  const typed = roomMatches(toks);
  if (typed.length) return typed[typed.length - 1].type;
  const at = toks.findIndex((t) => roomWordSet.has(t));
  if (at > 0) {
    const quals = toks.slice(0, at).filter((t) => !/^\d+$/.test(t) && !qualifierStop.has(t));
    if (quals.length && !quals.some((q) => nonBedroomQualifiers.has(q))) return 'bedroom';
  }
  return 'other';
}

/** True when the label names a room: it holds a room word or a generic ROOM, and no duct / shaft / lift word. */
export function isRoomLabel(text: string): boolean {
  const toks = tokens(text);
  if (!toks.length || toks.some((t) => nonRoomWords.has(t))) return false;
  return roomMatches(toks).length > 0 || toks.some((t) => roomWordSet.has(t));
}

// ---------------------------------------------------------------- furniture
export interface FurnitureEntry {
  key: string; kind: string | null; heightM?: number; surfaceHeightM?: number; displayName?: string;
  /** a second label of this kind may reuse an outline another label took (a pair of equal side tables) */
  sharesOutline?: boolean; words: string[];
}
export const FURNITURE: FurnitureEntry[] = F.items as FurnitureEntry[];
const furnIndex = new Index<FurnitureEntry>();
for (const f of FURNITURE) for (const w of f.words) furnIndex.add(w, f);

/**
 * The furniture word a label starts with, longest entry first. A furniture word followed by ROOM or AREA is a room
 * (BED ROOM, STUDY ROOM, DRESSING AREA), and "BED 2" with no size is a bedroom number, not a bed.
 */
export function furnitureOf(head: string, hasSize = false): { entry: FurnitureEntry; rest: string[] } | null {
  const toks = tokens(head);
  if (!toks.length) return null;
  let hit: { e: Entry<FurnitureEntry>; n: number } | null = null;
  for (let n = Math.min(furnIndex.maxN + 1, toks.length); n >= 1; n--) {
    const e = furnIndex.at(toks, 0, n);
    if (e) { hit = { e, n }; break; }
  }
  if (!hit) return null;
  const rest = toks.slice(hit.n);
  const entry = hit.e.tag;
  if (rest.length && ['room', 'rm', 'area'].includes(rest[0])) return null;
  if (entry.key === 'bed' && !hasSize && rest.length === 1 && /^\d+$/.test(rest[0])) return null;
  return { entry, rest };
}
/** The lexicon entry for a furniture key. */
export function furnitureEntry(key: string): FurnitureEntry | undefined { return FURNITURE.find((f) => f.key === key); }
/** Furniture entries that are built into the wall (wardrobe, closet), by key. */
export function isBuiltInKey(key: string): boolean {
  const e = FURNITURE.find((f) => f.key === key);
  return !!e && e.words.some((w) => F.builtInWords.includes(w));
}

// ---------------------------------------------------------------- fixtures
const fixIndex = new Index<string>();
for (const [cls, words] of Object.entries(X.classes as Record<string, string[]>)) for (const w of words) fixIndex.add(w, cls);
/** The sanitary / kitchen / services class a word names ("W.C." -> wc, "HOB" -> hob), or null. */
export function fixtureClassOf(text: string): string | null {
  const m = fixIndex.scan(tokens(text));
  return m.length ? m[0].tag : null;
}

// ---------------------------------------------------------------- page and unit words
const kindIndex = new Index<{ kind: string; weak: boolean }>();
const weakWords = new Set(E.weakKindWords.map(keyOf));
for (const [k, words] of Object.entries(E.kinds as Record<string, string[]>)) for (const w of words) kindIndex.add(w, { kind: k, weak: weakWords.has(keyOf(w)) });
/**
 * Caption / title-block kind words found in a string, e.g. ["elevation"] for "ELEVATION-1". `strong` drops words that
 * also turn up in ordinary labels (VIEW, LAYOUT, INTERNAL): page classification uses strong words only.
 */
export function pageKindWords(text: string, strong = true): string[] {
  return kindIndex.scan(tokens(text)).filter((m) => !(strong && m.tag.weak)).map((m) => m.tag.kind);
}
const unitNoteIndex = new Index<string>();
for (const [k, words] of Object.entries(E.unitNotes as Record<string, string[]>)) for (const w of words) unitNoteIndex.add(w, k);
/** Built-in unit notes in a string: "2 SHUTTER OPENABLE" -> ["openable"]. */
export function unitNotesOf(text: string): string[] { return [...new Set(unitNoteIndex.scan(tokens(text)).map((m) => m.tag))]; }
const notToScale = new Index<true>();
for (const w of E.notToScale) notToScale.add(w, true);
export function isNotToScale(text: string): boolean { return notToScale.scan(tokens(text)).length > 0; }

/** All lexicon words, for the lint and the harness. */
export function allLexiconWords(): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
  };
  for (const j of [R, F, X, E]) for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
    if (k.startsWith('_')) continue;
    if (k === 'items') for (const it of v as FurnitureEntry[]) walk(it.words);
    else if (k === 'runningLength') for (const g of (v as typeof F.runningLength).markers) walk(g.words);
    else if (v && typeof v === 'object' && !Array.isArray(v)) for (const vv of Object.values(v as Record<string, unknown>)) {
      if (Array.isArray(vv)) walk(vv);
      else if (vv && typeof vv === 'object') for (const g of Object.values(vv as Record<string, unknown>)) walk(g);
    } else walk(v);
  }
  return out;
}
