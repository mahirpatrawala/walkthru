// Pick a flat (SPEC 22.3): a floor-by-floor list and the 3D tower, a toggle that colours the units by status (available or sold), a card for the unit picked
// with "Walk this flat". Statuses come from /api/inventory; with no service they are simply not there ("Status unavailable"), never invented. Sold flats stay
// walkable and say Sold. No prices, no enquiry form.
import './inventory.css';
import { DIR_WORDS } from '../core/north';
import { DEMO_TAG, fetchInventory, statusWord, tally } from '../inventory/client';
import type { InventoryOk, UnitStatus } from '../inventory/types';
import { fetchScene } from './load';
import type { SceneInfo } from './load';
import { shortType, towerGeometry } from './tower-model';
import type { TowerView } from './tower-view';
import { unitArea, unitFacing } from './unit-info';
import type { BuildingFile } from './types';
import { byFloor, findUnit, unitsOf, walkTargetOf } from './units';
import type { Unit } from './units';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export interface PickerOptions {
  building: BuildingFile;
  /** "Walk this flat": the space the unit's flat type is modelled in, and the unit */
  onWalk(spaceId: string, unitId: string): void;
  loadScene?: (sceneId: string) => Promise<SceneInfo>;
  /** the statuses (tests pass their own; the page asks the service) */
  loadInventory?: () => Promise<InventoryOk | null>;
}

export interface InventoryPicker {
  /** the section, so a page can place it */
  root: HTMLElement;
  select(unitId: string | null): void;
  setByStatus(on: boolean): void;
  destroy(): void;
  debug: { tower(): TowerView | null; selected(): string | null; inventory(): InventoryOk | null; ready(): Promise<void> };
}

/** The unit named by a `#flat-1204` address fragment. */
export const unitFromHash = (hash: string): string | null => /^#flat-(\d{3,6})$/.exec(hash)?.[1] ?? null;

export function mountInventoryPicker(host: HTMLElement, o: PickerOptions): InventoryPicker | null {
  const b = o.building;
  const units = unitsOf(b);
  if (units.length === 0) return null;
  const load = o.loadScene ?? fetchScene;
  let inv: InventoryOk | null = null;
  let invLoaded = false;
  let byStatus = true;
  let selected: string | null = null;
  let tower = null as TowerView | null;
  let destroyed = false;
  let seq = 0;

  const root = h('section', 'bi', undefined, host);
  root.id = 'flats';
  root.dataset.testid = 'inventory';
  root.setAttribute('aria-label', 'Pick a flat');
  const head = h('div', 'bi-head', undefined, root);
  const titles = h('div', 'bi-titles', undefined, head);
  h('h2', undefined, 'Pick a flat', titles);
  const floors = byFloor(units);
  h('p', 'bi-sub', `${floors.length} floors · ${units.length} flats. Tap a flat in the tower or in the list.`, titles);
  const tools = h('div', 'bi-tools', undefined, head);
  const tallyEl = h('p', 'bi-tally', 'Checking availability…', tools);
  tallyEl.dataset.testid = 'inventory-tally';
  tallyEl.setAttribute('aria-live', 'polite');
  const toggle = h('button', 'bi-switch', undefined, tools);
  toggle.type = 'button'; toggle.setAttribute('role', 'switch'); toggle.dataset.testid = 'colour-toggle';
  h('span', 'bi-switch-knob', undefined, toggle);
  h('span', 'bi-switch-label', 'Colour the tower by status', toggle);

  const body = h('div', 'bi-body', undefined, root);
  const left = h('div', 'bi-left', undefined, body);
  const stage = h('div', 'bi-stage', undefined, left);
  stage.dataset.testid = 'tower';
  const legend = h('div', 'bi-legend', undefined, left);
  legend.hidden = true;
  for (const [cls, word] of [['is-available', 'Available'], ['is-sold', 'Sold']] as const) { const l = h('span', 'bi-key', undefined, legend); h('i', `bi-dot ${cls}`, undefined, l); h('span', undefined, word, l); }
  const card = h('div', 'bi-card', undefined, left);
  card.dataset.testid = 'unit-card';
  const list = h('div', 'bi-list', undefined, body);
  list.dataset.testid = 'floor-list';
  h('p', 'bi-fine', `${b.sample ? 'Sample building: ' : ''}the plans of flats on floors the walk does not model are the plans of the same type on the floors it does. Areas are as stated by the builder.`, root);

  // ---- the floor list
  const unitButtons = new Map<string, HTMLButtonElement>();
  for (const f of floors) {
    const row = h('div', 'bi-floor', undefined, list);
    row.dataset.floor = String(f.floor);
    h('span', 'bi-floor-n', `Floor ${f.floor}`, row);
    const cells = h('div', 'bi-units', undefined, row);
    for (const u of f.units) {
      const btn = h('button', 'bi-unit', undefined, cells);
      btn.type = 'button';
      btn.dataset.unit = u.id;
      h('span', 'bi-unit-id', u.id, btn);
      h('span', 'bi-unit-type', shortType(b.flatTypes[u.type]?.name ?? u.type), btn);
      h('span', 'bi-unit-status', '', btn);
      btn.addEventListener('click', () => select(u.id, true));
      unitButtons.set(u.id, btn);
    }
  }

  const statusOf = (id: string): UnitStatus | undefined => inv?.units[id];
  function paintList(): void {
    for (const [id, btn] of unitButtons) {
      const s = statusOf(id), u = findUnit(b, id)!;
      btn.classList.toggle('is-available', byStatus && s === 'available');
      btn.classList.toggle('is-sold', byStatus && s === 'sold');
      btn.classList.toggle('is-on', id === selected);
      btn.setAttribute('aria-pressed', String(id === selected));
      const word = invLoaded ? statusWord(s) : '';
      (btn.querySelector('.bi-unit-status') as HTMLElement).textContent = invLoaded && s ? word : '';
      btn.setAttribute('aria-label', `Unit ${id}, floor ${u.floor}, ${shortType(b.flatTypes[u.type]?.name ?? u.type)}${invLoaded ? `, ${word}` : ''}`);
    }
  }
  function paintHeader(): void {
    toggle.setAttribute('aria-checked', String(byStatus && !!inv));
    toggle.classList.toggle('is-on', byStatus && !!inv);
    toggle.disabled = !inv;
    legend.hidden = !(inv && byStatus);
    if (!invLoaded) return;
    if (!inv) { tallyEl.textContent = 'Status unavailable'; return; }
    const t = tally(units.map((u) => u.id), inv.units);
    tallyEl.textContent = `${t.available} available · ${t.sold} sold${t.unknown ? ` · ${t.unknown} not set` : ''}`;
    if (inv.settings.demo) h('span', 'bi-demo', DEMO_TAG, tallyEl).dataset.testid = 'demo-tag';
  }

  // ---- the card
  function renderCard(): void {
    card.replaceChildren();
    const u = selected ? findUnit(b, selected) : null;
    if (!u) { h('p', 'bi-hint', 'Pick a flat to see its number, its type, its area and whether it is available.', card); return; }
    const mine = ++seq;
    const type = b.flatTypes[u.type];
    const target = walkTargetOf(b, u);
    const s = statusOf(u.id);
    const top = h('div', 'bi-card-top', undefined, card);
    h('span', 'bi-card-kind', `Floor ${u.floor}`, top);
    const badge = h('span', `bi-badge${s ? ` is-${s}` : ' is-none'}`, invLoaded ? statusWord(s) : 'Checking…', top);
    badge.dataset.testid = 'unit-status';
    if (s && inv?.settings.demo) h('span', 'bi-demo', DEMO_TAG, top).dataset.testid = 'unit-demo';
    h('h3', undefined, `Flat ${u.id}`, card).dataset.testid = 'unit-number';
    h('p', 'bi-type', type?.name ?? u.type, card);
    const facts = h('dl', 'bi-facts', undefined, card);
    const fact = (k: string, v: string, id?: string): HTMLElement => { h('dt', undefined, k, facts); const dd = h('dd', undefined, v, facts); if (id) dd.dataset.testid = id; return dd; };
    const area = unitArea(b, u, target);
    if (area) { const dd = fact('Area', area.text, 'unit-area'); h('small', 'bi-source', area.source, dd); }
    fact('Status', invLoaded ? statusWord(s) + (s && inv?.settings.demo ? ` (${DEMO_TAG.toLowerCase()})` : '') : 'Checking…');
    const facing = b.north ? fact('Faces', '…', 'unit-facing') : null;
    if (facing) {
      void unitFacing(b, u, load).then((f) => {
        if (destroyed || mine !== seq) return;
        if (!f) { facing.parentElement?.removeChild(facing.previousElementSibling as Element); facing.remove(); return; }
        const parts = [f.door ? `main door ${DIR_WORDS[f.door]}` : null, f.balconies.length ? `balcony ${f.balconies.map((d) => DIR_WORDS[d]).join(' and ')}` : null].filter(Boolean);
        facing.textContent = parts.join(', ') || 'not known';
        if (b.sample) h('small', 'bi-source', 'Sample building: the orientation is a demonstration value.', facing);
      });
    }
    const go = h('button', 'ws-go', 'Walk this flat', card);
    go.type = 'button'; go.dataset.testid = 'walk-unit';
    if (!target) { go.disabled = true; h('p', 'bi-note', 'This flat type is not modelled in the walk yet.', card); }
    else {
      go.addEventListener('click', () => o.onWalk(target.space.id, u.id));
      if (!target.exact) h('p', 'bi-note', `The walk shows the ${shortType(type?.name ?? u.type)} plan as built for ${target.space.name.split(' · ')[0]}: every floor of this type has the same plan.`, card);
      if (s === 'sold') h('p', 'bi-note', 'Sold flats can still be walked.', card);
    }
  }

  function select(id: string | null, user = false): void {
    if (id && !findUnit(b, id)) id = null;
    selected = id;
    tower?.select(id);
    paintList();
    renderCard();
    if (id) {
      unitButtons.get(id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      if (user) { try { history.replaceState(history.state, '', `${location.pathname}${location.search}#flat-${id}`); } catch { /* a sandboxed frame */ } }
    }
  }

  toggle.addEventListener('click', () => setByStatus(!byStatus));
  function setByStatus(on: boolean): void { byStatus = on; tower?.setByStatus(on && !!inv); paintList(); paintHeader(); }

  // ---- the tower: three.js is fetched only now, and the list works without it
  const geometry = towerGeometry(units, { floorH: b.floorToFloorM, firstFloor: b.units?.firstFloor });
  void import('./tower-view').then((m) => {
    if (destroyed) return;
    tower = m.mountTowerView(stage, { geometry, onPick: (id) => select(id, true), statuses: inv?.units ?? null, byStatus: byStatus && !!inv, selected });
    if (!tower) { stage.classList.add('is-empty'); h('p', 'bi-hint', 'The 3D tower needs WebGL, which this browser does not offer. The list does the same.', stage); }
  });

  paintList(); paintHeader(); renderCard();
  const ready = (async () => {
    inv = await (o.loadInventory ? o.loadInventory() : fetchInventory(b.id));
    invLoaded = true;
    if (destroyed) return;
    tower?.setStatuses(inv?.units ?? null);
    tower?.setByStatus(byStatus && !!inv);
    paintList(); paintHeader(); renderCard();
  })();
  const fromHash = unitFromHash(location.hash);
  if (fromHash) select(fromHash);

  return {
    root,
    select: (id) => select(id),
    setByStatus,
    destroy() { destroyed = true; tower?.destroy(); tower = null; root.remove(); },
    debug: { tower: () => tower, selected: () => selected, inventory: () => inv, ready: () => ready },
  };
}
