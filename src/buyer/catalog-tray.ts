// The tray's catalogue picker: a category selector and a search box over the whole catalogue (about 85 pieces), and the cards that match.
// `filterCatalog` is pure and tested; `mountCatalogPicker` builds the two controls above the card row and keeps the row in step. It works on a
// 390 px phone: one row (a native select and a search box), the cards scroll sideways as before.
import { CATALOG } from '../core/catalog';
import { categoryLabel, categoryOf, pieceRule } from '../core/pieces';
import type { PieceCategory } from '../core/pieces';
import { allowedIn, categoriesFor, categoryIn, trayWords } from '../core/places';
import type { CatalogItem, SpaceKind } from '../types';
import { catalogueAllowedIn } from '../building/extension';

/** offered in this kind of space: the catalogue's own places, and the rule a building installs while a space is up (src/building/walk.ts; none outside a building) */
export const offeredIn = (c: CatalogItem, kind: SpaceKind | undefined): boolean => allowedIn(c.id, kind) && catalogueAllowedIn(c, kind ?? 'home');

export type CategoryChoice = PieceCategory | 'all';

/** the words a piece can be found by: its name, size label, category, and its own keywords */
export function searchText(spec: CatalogItem): string {
  const rule = pieceRule(spec.id);
  return `${spec.name} ${spec.sizeLabel} ${categoryLabel(categoryOf(spec.id))} ${rule?.keywords.join(' ') ?? ''} ${spec.id.replace(/-/g, ' ')}`.toLowerCase();
}

/**
 * Catalogue rows offered in a space of kind `kind` (a home when absent), in `category` (or all), whose text holds every word of `query`.
 * Order is the catalogue's. A search finds only what the space offers: "treadmill" in a flat finds the home treadmill, never the gym one.
 */
export function filterCatalog(category: CategoryChoice, query: string, rows: readonly CatalogItem[] = CATALOG, kind?: SpaceKind): CatalogItem[] {
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return rows.filter((c) => offeredIn(c, kind) && (category === 'all' || categoryIn(c.id, kind) === category) && words.every((w) => searchText(c).includes(w)));
}

/** how many pieces each category holds in a space of this kind (for the selector's labels) */
export function categoryCounts(rows: readonly CatalogItem[] = CATALOG, kind?: SpaceKind): Record<CategoryChoice, number> {
  const here = rows.filter((r) => offeredIn(r, kind));
  const out = { all: here.length } as Record<CategoryChoice, number>;
  for (const c of categoriesFor(kind)) out[c.id] = here.filter((r) => categoryIn(r.id, kind) === c.id).length;
  return out;
}

const ICONS: Record<PieceCategory, string> = {
  seating: '<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M3.5 12.5a2 2 0 0 1 4 0V15h9v-2.5a2 2 0 0 1 4 0V18h-17z"/><path d="M6 18v2M18 18v2"/>',
  beds: '<path d="M3 18V7M3 14h18v4M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5"/><circle cx="7" cy="11" r="1.6"/>',
  storage: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M12 3.5v17M10 12v1.6M14 12v1.6"/>',
  tables: '<path d="M4 9h16M7 9v10M17 9v10"/><path d="M8 5h8"/>',
  kitchen: '<rect x="6.5" y="3" width="11" height="18" rx="1.6"/><path d="M6.5 10h11M9 6v2M9 13v3"/>',
  bathroom: '<path d="M4 12h16v2.5a4.5 4.5 0 0 1-4.5 4.5h-7A4.5 4.5 0 0 1 4 14.5z"/><path d="M6 12V6.5A2.5 2.5 0 0 1 8.5 4M8 19l-1 2M16 19l1 2"/>',
  kids: '<path d="M5 20V8M19 20V8M5 11h14M5 16h14M9 8v12M15 8v12M5 8h14"/>',
  balcony: '<path d="M12 21v-8"/><path d="M12 13c-4 0-6-3-6-7 4 0 6 3 6 7zM12 15c4 0 6-3 6-6-4 0-6 2-6 6z"/><path d="M8 21h8"/>',
  fitness: '<path d="M6 8v8M3.5 10v4M18 8v8M20.5 10v4M6 12h12"/>',
  cardio: '<path d="M3 12h4l2.2-5.5 3.4 11 2.4-5.5H21"/>',
  strength: '<path d="M6 4v16M6 6.5h9.5M15.5 6.5V12h4v8M6 20h13.5M9 10h4M9 14h4"/>',
  freeweights: '<path d="M2.5 12h19M5 8.5v7M8 6v12M16 6v12M19 8.5v7"/>',
  studio: '<rect x="3.5" y="9" width="17" height="6.5" rx="3.2"/><circle cx="7" cy="12.2" r="1.3"/><path d="M11 12.2h6"/>',
  amenities: '<path d="M12 3s6 6.4 6 10.4a6 6 0 0 1-12 0C6 9.4 12 3 12 3z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>',
  reception: '<path d="M3 10.5h18V14H3zM5 14v6M19 14v6M8.5 10.5V6h7v4.5"/>',
  decor: '<path d="M12 21v-8"/><path d="M12 13c-4 0-6-3-6-7 4 0 6 3 6 7zM12 15c4 0 6-3 6-6-4 0-6 2-6 6z"/><path d="M8 21h8"/>',
  stage: '<path d="M3 17.5h18M5 17.5V10h14v7.5M9.5 10V5.5h5V10"/>',
  games: '<rect x="3.5" y="6.5" width="17" height="11" rx="2"/><path d="M12 6.5v11M3.5 12h17"/>',
  swing: '<path d="M7 3v9M17 3v9M4.5 3h15"/><path d="M5 12h14v3H5z"/><path d="M5 15v1.5M19 15v1.5"/>',
};
export const catalogIcon = (spec: CatalogItem): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[categoryOf(spec.id)]}</svg>`;

export interface CatalogPicker {
  /** the controls' row, placed before the cards */
  bar: HTMLElement;
  /** show or hide the controls and the cards together */
  setHidden(hidden: boolean): void;
  /** the current choice (for tests and the debug hooks) */
  state(): { category: CategoryChoice; query: string; ids: string[] };
  set(category: CategoryChoice, query: string): void;
}

/**
 * Builds the controls before `cards` inside `tray` and fills `cards` with `renderCard(parent, spec)` for each match. Typing or choosing
 * refills the row and scrolls it back to the start.
 */
export function mountCatalogPicker(tray: HTMLElement, cards: HTMLElement, renderCard: (parent: HTMLElement, spec: CatalogItem) => void, spaceKind?: SpaceKind): CatalogPicker {
  const bar = document.createElement('div');
  bar.className = 'wtf-picker';
  bar.dataset.ui = '1';
  bar.dataset.testid = 'furnish-picker';
  const select = document.createElement('select');
  select.className = 'wtf-picker-cat';
  select.dataset.ui = '1';
  select.dataset.act = 'category';
  select.setAttribute('aria-label', 'Category');
  const counts = categoryCounts(CATALOG, spaceKind);
  const words = trayWords(spaceKind);
  for (const [id, label] of [['all', words.all], ...categoriesFor(spaceKind).map((c) => [c.id, c.label] as const)] as [CategoryChoice, string][]) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `${label} (${counts[id]})`;
    select.appendChild(o);
  }
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'wtf-picker-search';
  search.dataset.ui = '1';
  search.dataset.act = 'search';
  search.placeholder = spaceKind && spaceKind !== 'home' ? `Search ${words.noun}` : 'Search: swing, fridge, mandir';
  search.setAttribute('aria-label', 'Search the catalogue');
  search.autocomplete = 'off';
  search.spellcheck = false;
  const empty = document.createElement('div');
  empty.className = 'wtf-picker-empty';
  empty.textContent = 'Nothing matches. Try a shorter word.';
  empty.hidden = true;
  bar.append(select, search);
  tray.insertBefore(bar, cards);
  tray.insertBefore(empty, cards);
  let ids: string[] = [];
  const refill = (): void => {
    const rows = filterCatalog(select.value as CategoryChoice, search.value, CATALOG, spaceKind);
    ids = rows.map((r) => r.id);
    cards.textContent = '';
    for (const spec of rows) renderCard(cards, spec);
    cards.scrollLeft = 0;
    empty.hidden = rows.length > 0 || bar.hidden;
  };
  select.addEventListener('change', () => { refill(); select.blur(); });
  search.addEventListener('input', refill);
  // the keys of the search box are typing, not the walker's controls
  for (const ev of ['keydown', 'keyup', 'keypress'] as const) search.addEventListener(ev, (e) => { e.stopPropagation(); });
  refill();
  return {
    bar,
    setHidden(hidden) { bar.hidden = hidden; empty.hidden = hidden || ids.length > 0; },
    state: () => ({ category: select.value as CategoryChoice, query: search.value, ids: [...ids] }),
    set(category, query) { select.value = category; search.value = query; refill(); },
  };
}
