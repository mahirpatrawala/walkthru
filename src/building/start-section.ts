// The start page's two building screens: the list of buildings above the homes, and a building's map page (`/?building=<id>`).
import './building.css';
import { BRAND_MARK } from '../brand/mark';
import { NotFound, fetchBuilding } from './load';
import { mountBuildingMap } from './map';
import { mountInventoryPicker } from './inventory-picker';
import { amenityLine, flatKindsLine, purposeLine } from './index-entry';
import { buildingUrl } from './url';
import type { BuildingIndex, BuildingIndexEntry } from './types';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** A small side elevation of the tower, drawn from the level count alone (no page data in it). */
function towerArt(levels: number): string {
  const lh = Math.min(26, 126 / levels);
  const body = Array.from({ length: levels }, (_, i) => {
    const y = 140 - (i + 1) * lh;
    const podium = i === 1; // the clubhouse level is wider than the tower above it
    const x = podium ? 22 : 38, w = podium ? 116 : 84;
    const wins = Array.from({ length: podium ? 6 : 4 }, (_, k) => `<rect x="${x + 10 + k * (w - 20) / (podium ? 6 : 4)}" y="${y + lh * 0.3}" width="${(w - 20) / (podium ? 6 : 4) - 5}" height="${lh * 0.4}" rx="1.5" fill="#fff" stroke="#2E8A93" stroke-width="1.2"/>`).join('');
    return `<rect x="${x}" y="${y}" width="${w}" height="${lh - 1.5}" rx="3" fill="${i === 0 ? '#EBDDC8' : '#FFFDF8'}" stroke="#2B211C" stroke-width="2"/>${wins}`;
  }).join('');
  return `<svg viewBox="0 0 160 150" aria-hidden="true" focusable="false">${body}<path d="M6 141.5H154" stroke="#2B211C" stroke-width="3" stroke-linecap="round"/></svg>`;
}

/** The "Buildings" section of the start page: one card per building. Nothing is drawn when there are none. */
export function renderBuildingList(root: HTMLElement, index: BuildingIndex, go: (url: string) => void): void {
  if (index.buildings.length === 0) return;
  const section = h('div', 'ws-section', undefined, root);
  section.id = 'buildings';
  h('h2', undefined, 'Pick a building', section);
  h('p', undefined, 'Walk a whole project: the lobby, the lift, the corridor, any flat and the clubhouse.', section);
  const grid = h('div', 'wb-grid', undefined, root);
  grid.dataset.testid = 'buildings';
  for (const b of index.buildings) card(grid, b, go);
}

function card(grid: HTMLElement, b: BuildingIndexEntry, go: (url: string) => void): void {
  const a = h('a', 'wb-card', undefined, grid);
  a.href = buildingUrl({ building: b.id, space: null });
  a.dataset.building = b.id;
  const art = h('div', 'wb-art', undefined, a);
  art.innerHTML = towerArt(b.levels); // a fixed drawing from numbers, no page text
  const body = h('div', 'wb-body', undefined, a);
  h('h3', undefined, b.name, body);
  h('p', 'wb-purpose', purposeLine(b), body);
  if (b.sample) h('p', 'wb-quiet', 'Sample building. Plans follow a published brochure.', body);
  const kinds = flatKindsLine(b.flatTypes);
  h('p', 'wb-meta', `${b.levels} levels · ${b.flats} flats${kinds ? ` · ${kinds}` : ''}`, body);
  if (b.amenities.length) h('p', 'wb-meta', `Clubhouse: ${amenityLine(b.amenities, 3)}`, body);
  h('span', 'wb-open', 'Open the building', body);
  a.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(a.getAttribute('href') ?? '/');
  });
}

/** `/?building=<id>`: the building's map, with "Start here" on the space picked. */
export async function renderBuildingPage(root: HTMLElement, id: string, go: (url: string) => void): Promise<void> {
  const top = h('div', 'ws-top', undefined, root);
  const brand = h('span', 'wt-brand', undefined, top);
  brand.innerHTML = `${BRAND_MARK}<span>walkthru</span>`;
  const holder = h('div', undefined, undefined, root);
  let b;
  try {
    b = await fetchBuilding(id);
  } catch (err) {
    const box = h('div', 'ws-empty', undefined, holder);
    h('h1', undefined, err instanceof NotFound ? 'This building is not available.' : 'Could not open this building.', box);
    h('p', undefined, err instanceof NotFound ? `There is no building called "${id}" here.` : (err instanceof Error ? err.message : String(err)), box);
    const back = h('a', 'ws-cta', 'All homes', box);
    back.href = '/';
    back.addEventListener('click', (e) => { e.preventDefault(); go('/'); });
    return;
  }
  document.title = b.brand ? `${b.name} · ${b.brand.name}` : `${b.name} · walkthru`;
  if (b.brand) top.remove();
  mountBuildingMap(holder, {
    building: b, actionLabel: 'Walk in',
    back: { label: '← All homes', href: '/', onClick: () => go('/') },
    // a walk is its own page load: the lazy chunk with three.js
    onAction: (spaceId) => { location.assign(buildingUrl({ building: b.id, space: spaceId }, location.search)); },
  });
  // a building with units also offers the flats a buyer can be sold: the tower and the floor list (SPEC 22.3), right under the building's name, above the map
  const picker = mountInventoryPicker(holder, { building: b, onWalk: (spaceId, unit) => { location.assign(buildingUrl({ building: b.id, space: spaceId, unit }, location.search)); } });
  if (picker) {
    holder.querySelector('.bm-head')?.after(picker.root);
    (window as unknown as { __walkthruInventory?: unknown }).__walkthruInventory = picker.debug; // debug hook, like window.__walkthru
  }
}
