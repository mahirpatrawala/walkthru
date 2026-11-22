// /admin (SPEC 22.3): the owner's page for a building's inventory. Pick a building, type the passcode (kept in sessionStorage for this tab only), see the
// units as a sheet of floors x unit numbers with totals, tap a unit to flip it between available and sold, and switch the Vastu checklist for buyers on
// or off. The passcode is sent in a request header on each change and never put in an address. Plain, in the product's own look.
import '../brand/brand.css';
import '../start/start.css';
import './admin.css';
import { installScale } from '../brand/scale';
import { BRAND_MARK } from '../brand/mark';
import { parseBuilding } from '../building/parse';
import type { BuildingFile } from '../building/types';
import { unitsOf } from '../building/units';
import type { Unit } from '../building/units';
import { DEMO_TAG, fetchInventory, sendChange, statusWord } from '../inventory/client';
import type { InventoryOk, UnitStatus } from '../inventory/types';
import { problemText, sheetOf, totals } from './model';

installScale();
const KEY = 'walkthru:admin:passcode';
const store = { get: (): string => { try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; } }, set: (v: string): void => { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch { /* private mode: the passcode lasts until the page closes */ } } };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

async function loadBuildings(): Promise<BuildingFile[]> {
  const out: BuildingFile[] = [];
  try {
    const idx = (await (await fetch('/buildings/index.json', { cache: 'no-cache' })).json()) as { buildings?: { id: string }[] };
    for (const e of idx.buildings ?? []) {
      try { const b = parseBuilding(await (await fetch(`/buildings/${e.id}/building.json`, { cache: 'no-cache' })).json()); if (b.units) out.push(b); } catch { /* not a building with units */ }
    }
  } catch { /* no index: nothing to manage */ }
  return out;
}

async function main(): Promise<void> {
  const root = document.getElementById('admin')!;
  root.className = 'ws ad';
  const top = h('div', 'ws-top', undefined, root);
  const brand = h('a', 'wt-brand', undefined, top);
  brand.href = '/';
  brand.innerHTML = `${BRAND_MARK}<span>firstbeam</span>`;
  const page = h('div', 'ad-page', undefined, root);
  h('h1', undefined, 'Availability', page);
  h('p', 'ad-lead', 'Mark each flat available or sold, and choose whether buyers see the Vastu checklist. Buyers see two statuses only.', page);

  const buildings = await loadBuildings();
  if (buildings.length === 0) { h('p', 'ad-note', 'No building with flats to manage was found.', page); return; }
  let b = buildings[0];
  let statuses: InventoryOk | null = null;
  let loadFailed = false;
  let busy = false;

  // ---- the controls row: building and passcode
  const bar = h('div', 'ad-bar', undefined, page);
  const pick = h('label', 'ad-field', undefined, bar);
  h('span', undefined, 'Building', pick);
  const sel = h('select', undefined, undefined, pick);
  sel.dataset.testid = 'admin-building';
  for (const x of buildings) { const o = h('option', undefined, x.name, sel); o.value = x.id; }
  const pw = h('label', 'ad-field', undefined, bar);
  h('span', undefined, 'Passcode', pw);
  const input = h('input', undefined, undefined, pw);
  input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false; input.value = store.get(); input.dataset.testid = 'admin-passcode';
  input.setAttribute('aria-describedby', 'ad-msg');
  const save = h('button', 'ad-btn', 'Unlock', bar);
  save.type = 'button'; save.dataset.testid = 'admin-unlock';
  const msg = h('p', 'ad-msg', undefined, page);
  msg.id = 'ad-msg'; msg.setAttribute('role', 'status'); msg.dataset.testid = 'admin-msg';
  const say = (t: string, bad = false): void => { msg.textContent = t; msg.classList.toggle('is-bad', bad); };

  const sheetBox = h('div', 'ad-sheet', undefined, page);
  const foot = h('p', 'ad-fine', 'Changes take effect for buyers within about fifteen seconds. Every change is logged. The passcode stays in this tab only.', page);
  void foot;

  function render(): void {
    sheetBox.replaceChildren();
    const units = unitsOf(b);
    const t = totals(units, statuses?.units ?? null);
    const head = h('div', 'ad-head', undefined, sheetBox);
    const tl = h('div', 'ad-totals', undefined, head);
    tl.dataset.testid = 'admin-totals';
    if (loadFailed) h('span', 'ad-total', 'Status unavailable', tl);
    else {
      h('span', 'ad-total is-available', `${t.available} available`, tl);
      h('span', 'ad-total is-sold', `${t.sold} sold`, tl);
      if (t.unknown) h('span', 'ad-total', `${t.unknown} not set`, tl);
      h('span', 'ad-total', `${t.total} flats`, tl);
      if (statuses?.settings.demo) h('span', 'ad-demo', DEMO_TAG, tl);
    }
    // the Vastu switch
    const sw = h('button', 'ad-switch', undefined, head);
    sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.dataset.testid = 'admin-vastu';
    const on = statuses?.settings.vastuEnabled === true;
    sw.setAttribute('aria-checked', String(on)); sw.classList.toggle('is-on', on); sw.disabled = !statuses;
    h('span', 'ad-knob', undefined, sw);
    h('span', undefined, 'Show vastu checklist to buyers', sw);
    sw.addEventListener('click', () => { void change({ building: b.id, vastuEnabled: !on }, () => { if (statuses) statuses.settings.vastuEnabled = !on; }); });
    if (!b.north) h('p', 'ad-note', 'This building has no north set, so the checklist would not show even when this is on.', sheetBox);

    const sheet = sheetOf(b.units!, units);
    const table = h('div', 'ad-grid', undefined, sheetBox);
    table.style.setProperty('--cols', String(sheet.columns.length));
    table.setAttribute('role', 'grid');
    table.dataset.testid = 'admin-grid';
    const hr = h('div', 'ad-row ad-row-head', undefined, table);
    h('span', 'ad-floor', 'Floor', hr);
    for (const c of sheet.columns) h('span', 'ad-colh', `Unit ${String(c.number).padStart(2, '0')} · ${b.flatTypes[c.type]?.name.split(' · ')[0] ?? c.type}`, hr);
    for (const r of sheet.rows) {
      const row = h('div', 'ad-row', undefined, table);
      row.dataset.floor = String(r.floor);
      h('span', 'ad-floor', String(r.floor), row);
      for (const u of r.cells) {
        if (!u) { h('span', 'ad-cell is-none', '', row); continue; }
        const s = statuses?.units[u.id];
        const cell = h('button', `ad-cell${s ? ` is-${s}` : ''}`, undefined, row);
        cell.type = 'button'; cell.dataset.unit = u.id; cell.disabled = !statuses || busy;
        h('b', undefined, u.id, cell);
        h('span', undefined, s ? statusWord(s) : 'Not set', cell);
        cell.setAttribute('aria-label', `Unit ${u.id}, ${s ? statusWord(s) : 'status not set'}. Press to make it ${s === 'sold' ? 'available' : 'sold'}.`);
        cell.addEventListener('click', () => { const next: UnitStatus = s === 'sold' ? 'available' : 'sold'; void change({ building: b.id, unit: u.id, status: next }, () => { if (statuses) statuses.units[u.id] = next; }); });
      }
    }
  }

  async function reload(): Promise<void> {
    sheetBox.classList.add('is-loading');
    const s = await fetchInventory(b.id, { fresh: true });
    statuses = s; loadFailed = !s;
    if (!s) say('Status unavailable: the inventory service did not answer for this building.', true);
    sheetBox.classList.remove('is-loading');
    render();
  }

  async function change(c: Parameters<typeof sendChange>[0], apply: () => void): Promise<void> {
    if (busy) return;
    if (!input.value) { say('Type the passcode first.', true); input.focus(); return; }
    busy = true; render();
    const r = await sendChange(c, input.value);
    busy = false;
    if (r.ok) { store.set(input.value); apply(); say(r.body.changed ? 'Saved.' : 'Nothing to change.'); }
    else { say(problemText(r.error), true); if (r.error === 'unauthorized') store.set(''); }
    render();
  }

  sel.addEventListener('change', () => { b = buildings.find((x) => x.id === sel.value) ?? b; say(''); void reload(); });
  save.addEventListener('click', () => {
    void (async () => {
      if (!input.value) { say('Type the passcode first.', true); return; }
      const r = await sendChange({ building: b.id, check: true }, input.value);
      if (r.ok) { store.set(input.value); say('Unlocked. Tap a flat to change it.'); } else { store.set(''); say(problemText(r.error), true); }
    })();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  await reload();
}

void main();
