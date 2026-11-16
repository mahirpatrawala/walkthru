// The building map: the project's name, a side elevation of its levels, the plan of the level chosen (spaces outlined, flats named with
// type and area, amenities named), and a card for the space picked with a button to start there. The same screen is the building's entry
// page and, opened from the walk's "Building map" button, the in-walk map with "You are here". No three.js.
import '../start/start.css';
import './building.css';
import { levelPlan } from './level-plan';
import { fetchScene } from './load';
import type { SceneInfo } from './load';
import type { BuildingFile, Level, Space } from './types';
import type { Vec2 } from '../types';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export const KIND_NAME: Record<Space['kind'], string> = { home: 'Flat', lobby: 'Lobby', corridor: 'Corridor', gym: 'Gym', hall: 'Hall', games: 'Games room', pool: 'Pool', garden: 'Garden', other: 'Space' };

export interface MapOptions {
  building: BuildingFile;
  /** the level shown first (default: where the walker is, else the start space's) */
  levelId?: string;
  /** the walker is in this space (the in-walk map) */
  here?: { spaceId: string; point?: Vec2 } | null;
  /** the button on the card of a picked space */
  actionLabel: string;
  onAction(spaceId: string): void;
  /** the screen's back control: a link home on the page, a close button over the walk */
  back: { label: string; href?: string; onClick?: () => void };
  /** fetches a scene (tests and the walk can share a cache) */
  loadScene?: (sceneId: string) => Promise<SceneInfo>;
}

export interface BuildingMap { destroy(): void; showLevel(id: string): void; select(spaceId: string | null): void }

export function levelOf(b: BuildingFile, spaceId: string): Level | undefined {
  return b.levels.find((l) => l.spaces.some((s) => s.id === spaceId));
}

export function mountBuildingMap(host: HTMLElement, o: MapOptions): BuildingMap {
  const b = o.building;
  const load = o.loadScene ?? fetchScene;
  const here = o.here ?? null;
  let levelId = o.levelId ?? (here ? levelOf(b, here.spaceId)?.id : undefined) ?? levelOf(b, b.startSpace ?? b.levels[0].spaces[0].id)?.id ?? b.levels[0].id;
  let selected: string | null = null;
  let seq = 0;

  const root = h('section', 'bm', undefined, host);
  root.dataset.testid = 'building-map';
  const top = h('div', 'bm-top', undefined, root);
  const back = o.back.href ? h('a', 'ws-back', o.back.label, top) : h('button', 'ws-back', o.back.label, top);
  if (o.back.href) (back as HTMLAnchorElement).href = o.back.href;
  else (back as HTMLButtonElement).type = 'button';
  back.dataset.testid = 'map-back';
  if (o.back.onClick) back.addEventListener('click', (e) => { e.preventDefault(); o.back.onClick!(); });

  const head = h('div', 'bm-head', undefined, root);
  h('span', `ws-tag ${b.sample ? 'is-sample' : ''}`, b.sample ? 'Sample building · made-up' : 'Building', head);
  h('h1', undefined, b.name, head);
  if (b.subtitle) h('p', 'bm-sub-line', b.subtitle, head);

  const body = h('div', 'bm-body', undefined, root);
  const stack = h('nav', 'bm-stack', undefined, body);
  stack.setAttribute('aria-label', 'Levels');
  stack.dataset.testid = 'level-stack';
  const main = h('div', 'bm-main', undefined, body);
  const planCard = h('div', 'bm-plan-card', undefined, main);
  const planHead = h('div', 'bm-plan-head', undefined, planCard);
  const planTitle = h('h2', undefined, '', planHead);
  const planSum = h('p', undefined, '', planHead);
  const planBox = h('div', 'bm-plan', undefined, planCard);
  planBox.dataset.testid = 'level-plan';
  const side = h('aside', 'bm-side', undefined, body);
  const pickCard = h('div', 'bm-pick', undefined, side);
  pickCard.dataset.testid = 'space-card';
  const list = h('div', 'bm-list', undefined, side);
  list.dataset.testid = 'space-list';
  h('p', 'bm-fine', `${b.note || 'Sample layout for demonstration'}. Areas come from each space's own plan, and anything a drawing does not show is marked not measured.`, root);

  // ---- the stack of levels: top level first, each as tall as its floor to floor height
  const levelButtons = new Map<string, HTMLButtonElement>();
  for (const lv of [...b.levels].reverse()) {
    const btn = h('button', 'bm-lv', undefined, stack);
    btn.type = 'button';
    btn.dataset.level = lv.id;
    btn.style.setProperty('--lv-h', `${Math.round((lv.floorToFloorM ?? b.floorToFloorM) * 15)}px`);
    h('span', 'bm-lv-short', lv.short, btn);
    const txt = h('span', 'bm-lv-text', undefined, btn);
    const nameRow = h('span', 'bm-lv-row', undefined, txt);
    h('span', 'bm-lv-name', lv.label, nameRow);
    if (here && levelOf(b, here.spaceId)?.id === lv.id) h('span', 'bm-lv-here', 'You are here', nameRow);
    h('span', 'bm-lv-sum', lv.summary, txt);
    btn.addEventListener('click', () => showLevel(lv.id));
    levelButtons.set(lv.id, btn);
  }

  function pickDefault(lv: Level): string {
    if (here && lv.spaces.some((s) => s.id === here.spaceId)) return here.spaceId;
    const start = b.startSpace ? lv.spaces.find((s) => s.id === b.startSpace) : undefined;
    return (start ?? lv.spaces.find((s) => s.kind === 'home') ?? lv.spaces[0]).id;
  }

  async function draw(): Promise<void> {
    const mine = ++seq;
    const lv = b.levels.find((l) => l.id === levelId)!;
    planTitle.textContent = lv.label;
    planSum.textContent = lv.summary;
    for (const [id, btn] of levelButtons) { btn.classList.toggle('is-on', id === levelId); btn.setAttribute('aria-current', id === levelId ? 'true' : 'false'); }
    if (planBox.childElementCount === 0) planBox.textContent = 'Drawing the plan…';
    const scenes = new Map<string, SceneInfo>();
    try {
      await Promise.all([...new Set(lv.spaces.map((s) => s.sceneId))].map(async (id) => { scenes.set(id, await load(id)); }));
    } catch (err) {
      if (mine !== seq) return;
      planBox.textContent = `This level's plan could not be loaded. ${err instanceof Error ? err.message : ''}`;
      return;
    }
    if (mine !== seq) return;
    const sel = selected && lv.spaces.some((s) => s.id === selected) ? selected : pickDefault(lv);
    selected = sel;
    const pic = levelPlan(b, lv, scenes, { idPrefix: `bm-${lv.id}`, selected: sel, here });
    planBox.innerHTML = pic.svg; // built from escaped strings in level-plan.ts and plan-svg.ts
    planBox.style.setProperty('--plan-aspect', String(pic.aspect));
    const pick = (t: EventTarget | null): void => {
      const g = (t as Element | null)?.closest?.('[data-space]') as SVGGElement | null;
      if (g?.dataset.space) select(g.dataset.space, scenes);
    };
    planBox.onclick = (e) => pick(e.target);
    planBox.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target); } };
    renderSide(lv, scenes, pic.boxes.map((x) => [x.spaceId, x.area.text] as const));
  }

  function renderSide(lv: Level, scenes: Map<string, SceneInfo>, areas: (readonly [string, string])[]): void {
    const areaOf = new Map(areas);
    list.replaceChildren();
    h('h3', undefined, 'In this level', list);
    for (const s of lv.spaces) {
      const row = h('button', `bm-row${s.id === selected ? ' is-on' : ''}`, undefined, list);
      row.type = 'button';
      row.dataset.space = s.id;
      row.dataset.area = areaOf.get(s.id) ?? '';
      h('span', 'bm-row-name', s.name, row);
      h('span', 'bm-row-meta', s.comingNext ? 'Coming in the next stage' : areaOf.get(s.id) ?? '', row);
      row.addEventListener('click', () => select(s.id, scenes));
    }
    renderCard(lv, scenes, areaOf);
  }

  function renderCard(lv: Level, scenes: Map<string, SceneInfo>, areaOf: Map<string, string>): void {
    void scenes;
    pickCard.replaceChildren();
    const s = lv.spaces.find((x) => x.id === selected);
    if (!s) { h('p', 'bm-hint', 'Tap a space on the plan.', pickCard); return; }
    h('span', 'bm-kind', KIND_NAME[s.kind], pickCard);
    h('h3', undefined, s.name, pickCard);
    h('p', 'bm-area', s.comingNext ? `${areaOf.get(s.id) ?? ''}` : areaOf.get(s.id) ?? '', pickCard);
    if (s.comingNext) h('p', 'bm-soon', 'Coming in the next stage. You can walk into it now as an empty room.', pickCard);
    for (const n of s.notes ?? []) h('p', 'bm-note', n, pickCard);
    const isHere = here?.spaceId === s.id;
    const go = h('button', 'ws-go', isHere ? 'You are here' : o.actionLabel, pickCard);
    go.type = 'button';
    go.dataset.testid = 'map-action';
    go.disabled = isHere;
    go.addEventListener('click', () => o.onAction(s.id));
  }

  function select(id: string | null, scenes?: Map<string, SceneInfo>): void {
    selected = id;
    const lv = b.levels.find((l) => l.id === levelId)!;
    for (const g of planBox.querySelectorAll<SVGGElement>('[data-space]')) {
      const on = g.dataset.space === id;
      g.classList.toggle('is-on', on);
      g.setAttribute('aria-pressed', String(on));
    }
    const areaOf = new Map<string, string>();
    for (const row of list.querySelectorAll<HTMLElement>('.bm-row')) {
      row.classList.toggle('is-on', row.dataset.space === id);
      areaOf.set(row.dataset.space ?? '', row.dataset.area ?? '');
    }
    renderCard(lv, scenes ?? new Map(), areaOf);
  }

  function showLevel(id: string): void {
    if (!b.levels.some((l) => l.id === id)) return;
    levelId = id;
    selected = null;
    void draw();
  }

  void draw();
  return { destroy: () => { seq++; root.remove(); }, showLevel, select: (id) => select(id) };
}
