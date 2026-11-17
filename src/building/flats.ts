// The Flats switcher (SPEC 18.14): from inside any space of a building, jump to another flat without going back through the lift. A glass panel
// under the tool bar lists the flats of a level (the type and the carpet area, as the building file states them), the level tabs when more than
// one level has flats, and a tap goes there (`BuildingWalk.go`: the same loading screen, the flat's main door). Pure helpers first, then the DOM.
import './building.css';
import type { BuildingFile, Level, Space } from './types';

export interface FlatRow { id: string; /** "Flat 201" */ title: string; /** "2 BHK · 644 sq ft", or "" */ detail: string }

/** "Flat 201 · 2 BHK · 644 sq ft" -> the flat's own name and what it is. The type's name from `flatTypes` wins when the space names one. */
export function flatRow(b: BuildingFile, s: Space): FlatRow {
  const parts = s.name.split(' · ');
  const title = parts[0] || s.name;
  const typed = s.type ? b.flatTypes[s.type]?.name : undefined;
  return { id: s.id, title, detail: typed ?? parts.slice(1).join(' · ') };
}

/** The levels that have flats, lowest first, with their flats. */
export function flatLevels(b: BuildingFile): { level: Level; flats: FlatRow[] }[] {
  const out: { level: Level; flats: FlatRow[] }[] = [];
  for (const level of b.levels) {
    const flats = level.spaces.filter((s) => s.kind === 'home' && !s.comingNext).map((s) => flatRow(b, s));
    if (flats.length) out.push({ level, flats });
  }
  return out;
}

export interface FlatsPanel { close(): void }

export function openFlatsPanel(parent: HTMLElement, o: { building: BuildingFile; here: string; onChoose(spaceId: string): void; onClose(): void }): FlatsPanel {
  const levels = flatLevels(o.building);
  const hereLevel = o.building.levels.find((l) => l.spaces.some((s) => s.id === o.here))?.id;
  let level = levels.find((l) => l.level.id === hereLevel)?.level.id ?? levels[0]?.level.id ?? '';
  const back = document.createElement('div');
  back.className = 'wb-flats-back';
  back.dataset.ui = '1';
  back.dataset.testid = 'flats-panel';
  const card = document.createElement('div');
  card.className = 'wb-flats';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Flats: choose one to walk into');
  back.appendChild(card);
  const head = document.createElement('div');
  head.className = 'wb-flats-head';
  const h2 = document.createElement('h2');
  h2.textContent = 'Flats';
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'wb-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Close');
  head.append(h2, x);
  card.appendChild(head);
  const tabs = document.createElement('div');
  tabs.className = 'wb-flats-tabs';
  tabs.setAttribute('role', 'tablist');
  card.appendChild(tabs);
  const list = document.createElement('div');
  list.className = 'wb-flats-list';
  card.appendChild(list);

  const render = (): void => {
    tabs.replaceChildren();
    tabs.hidden = levels.length < 2;
    for (const l of levels) {
      const t = document.createElement('button');
      t.type = 'button'; t.className = `wb-flats-tab${l.level.id === level ? ' is-on' : ''}`; t.textContent = l.level.label;
      t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(l.level.id === level));
      t.addEventListener('click', () => { level = l.level.id; render(); });
      tabs.appendChild(t);
    }
    list.replaceChildren();
    const cur = levels.find((l) => l.level.id === level);
    for (const f of cur?.flats ?? []) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `wb-flat${f.id === o.here ? ' is-here' : ''}`; b.dataset.space = f.id;
      const name = document.createElement('span'); name.className = 'wb-flat-name'; name.textContent = f.title;
      const detail = document.createElement('span'); detail.className = 'wb-flat-detail'; detail.textContent = f.detail;
      b.append(name, detail);
      if (f.id === o.here) { b.disabled = true; const here = document.createElement('span'); here.className = 'wb-flat-here'; here.textContent = 'You are here'; b.appendChild(here); }
      b.addEventListener('click', () => { if (f.id !== o.here) { close(); o.onChoose(f.id); } });
      list.appendChild(b);
    }
  };
  render();

  let open = true;
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); o.onClose(); } };
  function close(): void {
    if (!open) return;
    open = false;
    window.removeEventListener('keydown', onKey, true);
    back.remove();
  }
  window.addEventListener('keydown', onKey, true);
  x.addEventListener('click', () => { close(); o.onClose(); });
  back.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  back.addEventListener('click', (e) => { if (e.target === back) { close(); o.onClose(); } });
  parent.appendChild(back);
  (list.querySelector('.wb-flat:not(:disabled)') as HTMLElement | null)?.focus({ preventScroll: true });
  return { close };
}
