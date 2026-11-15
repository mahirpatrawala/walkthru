// The screen between two spaces. Going through a door it is a quick dark fade with the name of where you are going; in a lift the steel
// doors close, the floor display counts, and they open on the new level. It stands in for the loading screen while the next space is
// built behind it (it implements the same interface), so the walk never shows a blank or half-built view.
import { createLoadingScreen } from '../buyer/loading';
import type { LoadingScreen } from '../buyer/loading';
import { bypass, exempt } from './guard';

export interface CurtainOptions {
  kind: 'door' | 'lift';
  title: string;
  sub?: string;
  /** a lift: the buttons of the level left, the ones passed, and the one reached (in travel order) */
  floors?: string[];
  /** the shortest time a lift ride takes, ms */
  rideMs?: number;
}

export interface Curtain { screen: LoadingScreen; /** resolves once the curtain covers the view */ covered: Promise<void> }

function el(tag: string, cls: string, parent: HTMLElement, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export function createCurtain(o: CurtainOptions): Curtain {
  const root = exempt(() => el('div', `wb-curtain is-${o.kind}`, document.body));
  root.dataset.testid = 'curtain';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  let display: HTMLElement | null = null;
  if (o.kind === 'lift') { el('div', 'wb-lift-door l', root); el('div', 'wb-lift-door r', root); display = el('div', 'wb-display', root); }
  const cap = el('div', 'wb-cap', root);
  el('b', '', cap, o.title);
  const sub = el('span', '', cap, o.sub ?? '');
  sub.hidden = !o.sub;
  const bar = el('div', 'wb-bar', cap);
  const fill = el('i', '', bar);
  const coverMs = o.kind === 'lift' ? 520 : 200;
  let coveredAt = 0;
  const covered = new Promise<void>((res) => {
    // two frames: the element must paint uncovered first, or there is nothing to transition from
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add('is-in');
      bypass.setTimeout(() => { coveredAt = performance.now(); res(); }, coverMs);
    }));
  });
  let tick: number | null = null;
  const floors = o.floors && o.floors.length > 1 ? o.floors : null;
  const rideMs = o.rideMs ?? 1300;
  if (display && floors) {
    const show = (i: number): void => { display!.textContent = ''; const s = document.createElement('span'); s.textContent = floors[i]; const a = document.createElement('small'); a.textContent = floorArrow(floors, i); display!.append(a, s); };
    let i = 0;
    show(0);
    const step = rideMs / Math.max(1, floors.length - 1);
    void covered.then(() => {
      tick = bypass.setInterval(() => { if (i < floors.length - 1) { i += 1; show(i); } }, step);
    });
  } else if (display) display.textContent = o.title;
  let finished = false;

  const finish = async (): Promise<void> => {
    if (finished) return;
    finished = true;
    await covered;
    if (o.kind === 'lift') {
      const ride = Math.max(0, rideMs - (performance.now() - coveredAt));
      await new Promise<void>((r) => bypass.setTimeout(r, ride + 120));
      if (tick !== null) bypass.clearInterval(tick);
      if (display && floors) { display.textContent = ''; const s = document.createElement('span'); s.textContent = floors[floors.length - 1]; display.append(s); }
      await new Promise<void>((r) => bypass.setTimeout(r, 260));
    } else {
      // a door is not instant either: the fade is at least a beat
      await new Promise<void>((r) => bypass.setTimeout(r, Math.max(0, 240 - (performance.now() - coveredAt))));
    }
    root.classList.add('is-out');
    await new Promise<void>((r) => bypass.setTimeout(r, o.kind === 'lift' ? 520 : 280));
    root.remove();
  };

  let errorScreen: LoadingScreen | null = null;
  const screen: LoadingScreen = {
    setTitle() { /* the curtain names where you are going */ },
    setNote() { /* nothing */ },
    setProgress(f) { fill.style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`; },
    showNotSetUp(sceneId) {
      finished = true;
      if (tick !== null) bypass.clearInterval(tick);
      errorScreen = exempt(() => createLoadingScreen(document.body));
      errorScreen.showNotSetUp(sceneId);
      root.remove();
    },
    showError(t, m) {
      finished = true;
      if (tick !== null) bypass.clearInterval(tick);
      errorScreen = exempt(() => createLoadingScreen(document.body));
      errorScreen.showError(t, m);
      root.remove();
    },
    hide() { void finish(); },
    isShowingError: () => errorScreen?.isShowingError() ?? false,
  };
  return { screen, covered };
}

/** ▲ going up, ▼ going down, nothing at the start. Floors are the buttons in travel order, so it reads the direction off their order in the building. */
function floorArrow(floors: string[], i: number): string {
  if (i === 0) return '';
  const a = Number.parseInt(floors[i - 1], 10), b = Number.parseInt(floors[i], 10);
  const va = Number.isNaN(a) ? 0 : a, vb = Number.isNaN(b) ? 0 : b;
  return vb >= va ? '▲' : '▼';
}
