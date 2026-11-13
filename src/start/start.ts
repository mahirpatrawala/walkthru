// The start page (no ?scene=): a gallery of homes drawn as floor plans, then "Where do you want to start?" for the home picked.
// No three.js here on purpose: this page must open fast. The walk itself is the lazy chunk behind `?scene=<id>&room=<id>`.
import './start.css';
import { ORIGIN_TAG } from '../buyer/scene-tag';
import { defaultStartRoom, startableRooms } from '../core/start-rooms';
import { polygonArea } from '../core/geometry';
import { formatArea } from '../core/units';
import { planSvg } from './plan-svg';
import type { SceneEntry, SceneIndex } from './manifest';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Plan markup is built from escaped strings in plan-svg.ts, so it is safe to set as HTML. */
function planBox(cls: string, svg: string): HTMLElement {
  const box = h('div', cls);
  box.innerHTML = svg;
  return box;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function tagEl(entry: SceneEntry): HTMLElement {
  return h('span', `ws-tag is-${entry.origin}`, ORIGIN_TAG[entry.origin]);
}

export function walkUrl(id: string, roomId: string | null): string {
  return `/?scene=${encodeURIComponent(id)}${roomId ? `&room=${encodeURIComponent(roomId)}` : ''}`;
}
const homeUrl = (id: string): string => `/?home=${encodeURIComponent(id)}`;

async function loadIndex(): Promise<SceneIndex> {
  const res = await fetch('/scenes/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`The server answered HTTP ${res.status}.`);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error('The list of homes is missing from this build.');
  const json = JSON.parse(text) as SceneIndex;
  if (!json || !Array.isArray(json.scenes)) throw new Error('The list of homes is not valid.');
  return json;
}

export async function mountStart(): Promise<void> {
  document.getElementById('wt-boot')?.remove();
  const app = document.getElementById('app');
  if (app) app.hidden = true;
  const root = h('main', 'ws');
  root.dataset.testid = 'start';
  document.body.appendChild(root);
  document.title = 'walkthru';

  let index: SceneIndex;
  try {
    index = await loadIndex();
  } catch (err) {
    const box = h('div', 'ws-empty', undefined, root);
    h('h1', undefined, 'Could not load the homes.', box);
    h('p', undefined, err instanceof Error ? err.message : String(err), box);
    const retry = h('button', 'ws-go', 'Try again', box);
    retry.type = 'button';
    retry.addEventListener('click', () => location.reload());
    return;
  }

  const route = (): void => {
    const q = new URLSearchParams(location.search);
    const home = index.scenes.find((s) => s.id === q.get('home'));
    root.replaceChildren();
    root.scrollTop = 0;
    if (home) renderPicker(root, home, q.get('room'), go);
    else renderGallery(root, index, go);
  };
  const go = (url: string): void => { history.pushState(null, '', url); route(); };
  window.addEventListener('popstate', route);
  route();
}

type Go = (url: string) => void;

/** Same-page navigation for a plain left click; modified clicks keep the browser's own behaviour (new tab). */
function link(a: HTMLAnchorElement, go: Go): void {
  a.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(a.getAttribute('href') ?? '/');
  });
}

// ---------------------------------------------------------------- step 1: the gallery

function renderGallery(root: HTMLElement, index: SceneIndex, go: Go): void {
  document.title = 'walkthru';
  const head = h('header', 'ws-head', undefined, root);
  h('h1', undefined, 'walkthru', head);
  h('p', 'ws-lead', 'Pick a home, choose a room to start in, and walk through it in 3D.', head);

  if (index.scenes.length === 0) {
    h('p', 'ws-empty', 'There are no homes here yet.', root);
    return;
  }
  const grid = h('div', 'ws-grid', undefined, root);
  grid.dataset.testid = 'gallery';
  for (const s of index.scenes) {
    const a = h('a', 'ws-card', undefined, grid);
    a.href = homeUrl(s.id);
    a.dataset.scene = s.id;
    const pic = planSvg(s.layout, s.unverified, { idPrefix: `g-${s.id}`, title: `Floor plan of ${s.title}` });
    a.appendChild(planBox('ws-plan', pic.svg));
    const body = h('div', 'ws-body', undefined, a);
    body.appendChild(tagEl(s));
    h('h2', undefined, s.title, body);
    const rooms = s.layout.rooms;
    const partial = rooms.filter((r) => r.partial).length;
    const parts = [plural(rooms.length, 'room', 'rooms')];
    if (partial > 0) parts.push(`${partial} partly on the drawing`);
    h('p', 'ws-meta', parts.join(' · '), body);
    link(a, go);
  }
  h('p', 'ws-fine', 'Plans are redrawn from each home’s layout. Sizes come from the floor plan. Sample drawings are made up to show how it works.', root);
}

// ---------------------------------------------------------------- step 2: where do you want to start?

function renderPicker(root: HTMLElement, s: SceneEntry, requested: string | null, go: Go): void {
  document.title = `${s.title} · walkthru`;
  const layout = s.layout;
  const rooms = startableRooms(layout);
  const ids = new Set(rooms.map((r) => r.id));
  const fallback = defaultStartRoom(layout, s.unverified);
  let selected: string | null = requested && ids.has(requested) ? requested : (fallback?.id ?? null);

  const top = h('div', 'ws-top', undefined, root);
  const back = h('a', 'ws-back', '← All homes', top);
  back.href = '/';
  link(back, go);

  const wrap = h('div', 'ws-pick', undefined, root);
  wrap.dataset.testid = 'start-room';
  const pic = planSvg(layout, s.unverified, { idPrefix: `p-${s.id}`, title: `Floor plan of ${s.title}`, selectable: ids, selectedId: selected });
  const planEl = planBox('ws-pick-plan', pic.svg);
  wrap.appendChild(planEl);

  const side = h('div', 'ws-side', undefined, wrap);
  side.appendChild(tagEl(s));
  h('h1', undefined, s.title, side);
  h('h2', undefined, 'Where do you want to start?', side);
  const chips = h('div', 'ws-rooms', undefined, side);
  const chipFor = new Map<string, HTMLButtonElement>();
  const unmeasured = (id: string): boolean => !!s.unverified[id];
  for (const r of rooms) {
    const b = h('button', 'ws-room', undefined, chips);
    b.type = 'button';
    b.dataset.room = r.id;
    h('span', 'ws-room-name', r.label, b);
    h('span', 'ws-room-size', unmeasured(r.id) ? 'not measured' : formatArea(Math.abs(polygonArea(r.polygon))).text, b);
    b.addEventListener('click', () => select(r.id));
    chipFor.set(r.id, b);
  }
  const partialRooms = layout.rooms.filter((r) => r.partial);
  if (partialRooms.length > 0) {
    h('p', 'ws-note', `Drawn dashed: ${partialRooms.map((r) => r.label).join(', ')} ${partialRooms.length === 1 ? 'is' : 'are'} only partly on the drawing, so you can look into ${partialRooms.length === 1 ? 'it' : 'them'} but not start there.`, side);
  }

  const bar = h('div', 'ws-gobar', undefined, side);
  const goBtn = h('button', 'ws-go', undefined, bar);
  goBtn.type = 'button';
  goBtn.dataset.testid = 'start-walking';
  goBtn.addEventListener('click', () => { location.assign(walkUrl(s.id, selected)); });

  if (rooms.length === 0) {
    h('p', 'ws-note', 'No room in this home is whole on the drawing yet.', side);
  }

  function select(id: string): void {
    selected = id;
    update();
    const url = `/?home=${encodeURIComponent(s.id)}&room=${encodeURIComponent(id)}`;
    history.replaceState(null, '', url);
  }
  function update(): void {
    for (const g of planEl.querySelectorAll<SVGGElement>('[data-room]')) {
      const on = g.dataset.room === selected;
      g.classList.toggle('is-on', on);
      if (g.classList.contains('is-pick')) g.setAttribute('aria-pressed', String(on));
    }
    for (const [id, b] of chipFor) {
      b.classList.toggle('is-on', id === selected);
      b.setAttribute('aria-pressed', String(id === selected));
    }
    const room = layout.rooms.find((r) => r.id === selected);
    goBtn.textContent = room ? `Start walking in ${room.label}` : 'Start walking';
    goBtn.disabled = !room;
  }
  const pick = (t: EventTarget | null): void => {
    const g = (t as Element | null)?.closest?.('[data-room]') as SVGGElement | null;
    if (g && g.classList.contains('is-pick') && g.dataset.room) select(g.dataset.room);
  };
  planEl.addEventListener('click', (e) => pick(e.target));
  planEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target); }
  });
  update();
}
