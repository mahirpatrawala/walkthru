// Which catalogue pieces belong where (SPEC 16.17). A home shows furniture; a gym shows equipment; a lobby shows reception furniture; a hall shows
// seating, tables and a stage. Pure. A piece already in a scene always renders: this only decides what the tray, the search and the Replace
// list OFFER, and which pieces already in a scene are flagged ("not usually put in this kind of space"), never dropped.
import type { CatalogItem, SpaceKind } from '../types';
import { CATALOG } from './catalog';
import { CATEGORIES, categoryOf } from './pieces';
import type { PieceCategory } from './pieces';

export const SPACE_KINDS: SpaceKind[] = ['home', 'lobby', 'corridor', 'gym', 'hall', 'pool', 'garden', 'other'];
export const isSpaceKind = (v: unknown): v is SpaceKind => typeof v === 'string' && (SPACE_KINDS as string[]).includes(v);

/** The kind of space a scene is: its `spaceKind`, or a home when it names none. `?spaceKind=gym` is the debug override (checks, and a builder trying a catalogue). */
export function spaceKindOf(property: { spaceKind?: SpaceKind } | null | undefined, search: string = ''): SpaceKind {
  try {
    const q = new URLSearchParams(search).get('spaceKind');
    if (isSpaceKind(q)) return q;
  } catch { /* no query */ }
  return property?.spaceKind && isSpaceKind(property.spaceKind) ? property.spaceKind : 'home';
}

const rowOf = (id: string): CatalogItem | undefined => CATALOG.find((c) => c.id === id);

/** Where a piece is offered. An unknown id (a real drawn item) is a home piece. */
export function placesOf(id: string | null | undefined): SpaceKind[] {
  const r = id ? rowOf(id) : undefined;
  return r?.places ?? ['home'];
}

/** Is this catalogue piece offered in a space of this kind? A space of kind `other` is not a judgement: it offers everything. */
export function allowedIn(id: string | null | undefined, kind: SpaceKind | undefined): boolean {
  const k = kind ?? 'home';
  if (k === 'other') return true;
  return placesOf(id).includes(k);
}

/** Catalogue rows offered in a space of this kind, in catalogue order. */
export function rowsFor(kind: SpaceKind | undefined, rows: readonly CatalogItem[] = CATALOG): CatalogItem[] {
  return rows.filter((r) => allowedIn(r.id, kind));
}

/** The tray categories of a kind of space, in the order the selector shows them. A home never shows the shared-space ones, nor does a gym show a bed. */
const HOME_CATS: PieceCategory[] = ['seating', 'beds', 'storage', 'tables', 'kitchen', 'bathroom', 'kids', 'balcony', 'fitness', 'swing'];
const CATS: Record<SpaceKind, PieceCategory[] | null> = {
  home: HOME_CATS,
  gym: ['cardio', 'strength', 'freeweights', 'studio', 'amenities'],
  lobby: ['reception', 'seating', 'tables', 'storage', 'decor'],
  corridor: ['seating', 'reception', 'decor', 'amenities'],
  hall: ['seating', 'tables', 'stage', 'games', 'decor'],
  pool: ['amenities', 'decor', 'seating'],
  garden: ['decor', 'seating', 'amenities'],
  other: null,
};
export function categoriesFor(kind: SpaceKind | undefined): { id: PieceCategory; label: string }[] {
  const ids = CATS[kind ?? 'home'];
  return ids ? ids.map((id) => CATEGORIES.find((c) => c.id === id)!) : [...CATEGORIES];
}

/** A few pieces sit under another tray category in a lobby or a hall (a planter is "Plants & decor" there, "Balcony" in a home). */
const CAT_IN: Partial<Record<SpaceKind, Record<string, PieceCategory>>> = {
  lobby: { 'planter-pot': 'decor', 'planter-box': 'decor', sideboard: 'storage', 'bookshelf-wide': 'storage', 'office-chair': 'seating', 'bar-stool': 'seating' },
  corridor: { 'planter-pot': 'decor', 'planter-box': 'decor' },
  hall: { 'planter-pot': 'decor', 'planter-box': 'decor', sideboard: 'tables', 'dining-4': 'tables', 'bar-stool': 'seating' },
  pool: { 'planter-pot': 'decor', 'planter-box': 'decor', 'balcony-chair': 'seating', 'balcony-set': 'seating' },
  garden: { 'planter-pot': 'decor', 'planter-box': 'decor', 'balcony-chair': 'seating', 'balcony-set': 'seating' },
};
export function categoryIn(id: string, kind: SpaceKind | undefined): PieceCategory {
  return CAT_IN[kind ?? 'home']?.[id] ?? categoryOf(id);
}

/** The words of the selector's first option and the tray's heading for a kind of space. */
export function trayWords(kind: SpaceKind | undefined): { all: string; title: string; noun: string } {
  switch (kind ?? 'home') {
    case 'gym': return { all: 'All equipment', title: 'Add equipment', noun: 'equipment' };
    case 'lobby': return { all: 'All lobby pieces', title: 'Add to the lobby', noun: 'lobby piece' };
    case 'hall': return { all: 'All hall pieces', title: 'Add to the hall', noun: 'hall piece' };
    case 'corridor': return { all: 'All corridor pieces', title: 'Add to the corridor', noun: 'corridor piece' };
    case 'pool': return { all: 'All pool-side pieces', title: 'Add pool-side pieces', noun: 'pool-side piece' };
    case 'garden': return { all: 'All garden pieces', title: 'Add to the garden', noun: 'garden piece' };
    case 'other': return { all: 'All pieces', title: 'Add a piece', noun: 'piece' };
    default: return { all: 'All furniture', title: 'Add furniture', noun: 'furniture' };
  }
}

const KIND_WORDS: Record<SpaceKind, string> = { home: 'a home', lobby: 'a lobby', corridor: 'a corridor', gym: 'a gym', hall: 'a hall', pool: 'a pool area', garden: 'a garden', other: 'this space' };

/**
 * The note for a piece that is in a scene it is not offered in (it arrived by a share link or a stored layout, or the scene's kind changed).
 * It is kept and drawn as it is; this only says so. Null when the piece belongs here.
 */
export function notHereNote(id: string | null | undefined, name: string, kind: SpaceKind | undefined): string | null {
  if (!id || allowedIn(id, kind)) return null;
  const mine = placesOf(id).filter((k) => k !== 'other');
  const where = mine.length > 0 ? KIND_WORDS[mine[0]] : 'another kind of space';
  return `${name} is made for ${where}, not ${KIND_WORDS[kind ?? 'home']}. It stays in your layout; check it belongs here.`;
}
