// The screen between two spaces. Through a door it is the walk's own loading screen (the plan drawing itself, the progress bar)
// named for where you are going; in a lift the steel doors close, the floor display counts the levels passed, and they open on the
// new level. Either stands in for the space being built behind it, so the walk never shows a blank or half-built view.
import { createLoadingScreen } from '../buyer/loading';
import type { LoadingScreen } from '../buyer/loading';
import { bypass, exempt } from './guard';
import { CREDIT_TEXT, brandMarkEl } from '../brand/builder-brand';
import type { ShownBrand } from '../brand/builder-brand';

export interface CurtainOptions {
  kind: 'lift';
  title: string;
  sub?: string;
  /** a lift: the buttons of the level left, the ones passed, and the one reached (in travel order) */
  floors?: string[];
  /** the shortest time a lift ride takes, ms */
  rideMs?: number;
  /** the builder's brand, shown small at the foot of the ride */
  brand?: ShownBrand | null;
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
  if (o.brand) {
    const row = el('div', 'wb-curtain-brand', root);
    row.dataset.testid = 'curtain-brand';
    row.appendChild(brandMarkEl(document, o.brand, 'wb-curtain-logo'));
    el('span', '', row, o.brand.name);
    if (o.brand.credit) el('small', '', row, CREDIT_TEXT);
  }
  const cap = el('div', 'wb-cap', root);
  el('b', '', cap, o.title);
  const sub = el('span', '', cap, o.sub ?? '');
  sub.hidden = !o.sub;
  const bar = el('div', 'wb-bar', cap);
  const fill = el('i', '', bar);
  const coverMs = 520;
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
    const ride = Math.max(0, rideMs - (performance.now() - coveredAt));
    await new Promise<void>((r) => bypass.setTimeout(r, ride + 120));
    if (tick !== null) bypass.clearInterval(tick);
    if (display && floors) { display.textContent = ''; const s = document.createElement('span'); s.textContent = floors[floors.length - 1]; display.append(s); }
    await new Promise<void>((r) => bypass.setTimeout(r, 260));
    root.classList.add('is-out');
    await new Promise<void>((r) => bypass.setTimeout(r, 520));
    root.remove();
  };

  let errorScreen: LoadingScreen | null = null;
  const screen: LoadingScreen = {
    setTitle() { /* the curtain names where you are going */ },
    setBrand() { /* the curtain carries the brand itself */ },
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

/**
 * The loading screen of the walk (src/buyer/loading.ts) for a door: made now, over the space still standing, kept past that space's
 * clean-up, named `title` whatever the scene calls itself, and taken off the page after it fades.
 */
export function createLoadingCurtain(title: string, sub?: string, brand: ShownBrand | null = null): Curtain {
  let node: HTMLElement | null = null;
  const inner = exempt(() => { const s = createLoadingScreen(document.body); node = document.body.lastElementChild as HTMLElement; return s; });
  inner.setBrand(brand);
  inner.setTitle(title, sub);
  // the screen fades in over the standing space (a quarter of a second); only then is that space taken down, so the cut is never seen
  (node as HTMLElement | null)?.classList.add('is-curtain');
  const covered = new Promise<void>((res) => { requestAnimationFrame(() => requestAnimationFrame(() => { bypass.setTimeout(res, 300); })); });
  const screen: LoadingScreen = {
    ...inner,
    setTitle() { /* the walk names the scene; the building names the place */ },
    hide() {
      inner.hide();
      bypass.setTimeout(() => { node?.remove(); }, 700);
    },
  };
  return { screen, covered };
}
