// The flat landing page of the VR page: works in any browser. A preview of the home behind a large Enter VR button, the list of homes, and a plain message
// with a link to the normal site wherever a headset is not available. It only reads the app's state and calls its methods; it draws no 3D itself.
import { mainSiteBase, mainSiteUrl } from './config';
import type { AppState, VrApp } from './app';
import type { HomeEntry } from './catalogue';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface Landing {
  /** the element the 3D preview goes in (hand it to the app before the app is built) */
  preview: HTMLElement;
  attach(app: VrApp): void;
  dispose(): void;
}

export function mountLanding(root: HTMLElement, homes: HomeEntry[], opts: { debug: boolean }): Landing {
  root.textContent = '';
  const wrap = h('div', 'xl');
  const top = h('header', 'xl-top');
  top.append(h('span', 'xl-mark', 'walkthru'), h('span', 'xl-tag', 'VR'));
  const stage = h('section', 'xl-stage');
  const preview = h('div', 'xl-preview');
  const overlay = h('div', 'xl-overlay');
  const title = h('h1', 'xl-title');
  const sub = h('p', 'xl-sub');
  const bar = h('div', 'xl-bar'); bar.append(h('i'));
  const row = h('div', 'xl-row');
  const enter = h('button', 'xl-enter');
  enter.type = 'button';
  enter.dataset.testid = 'enter-vr';
  const link = h('a', 'xl-link', 'Open the normal site');
  link.dataset.testid = 'main-site-link';
  row.append(enter, link);
  const note = h('p', 'xl-note');
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');
  note.dataset.testid = 'vr-note';
  overlay.append(title, sub, bar, row, note);
  stage.append(preview, overlay);
  const homesSec = h('section', 'xl-homes');
  homesSec.append(h('h2', undefined, 'Homes'));
  const list = h('ul', 'xl-list');
  list.dataset.testid = 'home-list';
  homesSec.append(list);
  wrap.append(top, stage, homesSec);
  root.append(wrap);
  document.title = 'walkthru VR';

  const base = mainSiteBase();
  const buttons = new Map<string, HTMLButtonElement>();
  if (homes.length === 0) list.append(Object.assign(h('li', 'xl-empty', 'No homes are listed on this site yet.')));
  for (const e of homes) {
    const li = h('li');
    const b = h('button', 'xl-home');
    b.type = 'button';
    b.dataset.key = e.key;
    b.append(h('b', undefined, e.label), h('span', undefined, e.sub));
    li.append(b);
    list.append(li);
    buttons.set(e.key, b);
  }
  let dbg: HTMLElement | null = null;
  if (opts.debug) { dbg = h('pre', 'xl-debug'); dbg.dataset.testid = 'debug-overlay'; document.body.append(dbg); }

  let app: VrApp | null = null;
  const offs: Array<() => void> = [];
  const on = (el: EventTarget, type: string, fn: EventListener): void => { el.addEventListener(type, fn); offs.push(() => el.removeEventListener(type, fn)); };

  function render(s: AppState): void {
    const e = homes.find((x) => x.key === s.homeKey);
    for (const [k, b] of buttons) { if (k === s.homeKey) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
    link.href = mainSiteUrl(base, s.target);
    const hasHome = !!s.target;
    stage.classList.toggle('xl-none', !hasHome);
    title.textContent = hasHome ? (e?.label || s.title || 'Opening a home') : 'Walk through a home in VR';
    sub.textContent = hasHome ? (s.subtitle ?? e?.sub ?? '') : 'Choose a home below, then put on your headset.';
    const loading = s.phase === 'loading';
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round(s.progress * 100)}%`;
    bar.hidden = !loading;
    note.classList.remove('is-warn');
    enter.hidden = false;
    enter.disabled = true;
    if (s.xr === 'no') {
      enter.hidden = true;
      note.textContent = 'This browser cannot show VR. Open this page in the Meta Quest Browser on a Quest 3 or 3S, or walk the home on the normal site.';
      note.classList.add('is-warn');
    } else if (s.phase === 'presenting') {
      enter.textContent = 'In VR';
      note.textContent = 'You are in VR. Press B or Y to open the panel, and choose Exit VR to come back here.';
    } else if (s.phase === 'error') {
      enter.textContent = 'Enter VR';
      note.textContent = s.message ?? 'Something went wrong.';
      note.classList.add('is-warn');
    } else if (s.xr === 'unknown' || s.phase === 'boot') {
      enter.textContent = 'Checking for a headset';
      note.textContent = '';
    } else if (loading) {
      enter.textContent = 'Loading the home';
      note.textContent = s.progressText ? `${s.progressText}…` : '';
    } else if (s.phase === 'ready') {
      enter.textContent = 'Enter VR';
      enter.disabled = false;
      note.textContent = s.message ?? (s.waitingForGesture ? 'Tap anywhere, or press any key, to enter VR.' : 'Trigger to teleport or open a door. B or Y opens the panel.');
    } else {
      enter.textContent = 'Choose a home';
      note.textContent = s.message ?? '';
    }
  }

  return {
    preview,
    attach(a) {
      app = a;
      offs.push(a.onState(render));
      on(enter, 'click', () => { void a.enter(); });
      for (const [k, b] of buttons) on(b, 'click', () => { const e = homes.find((x) => x.key === k); if (e) void a.openHome(e.target); });
      const t = window.setInterval(() => { if (dbg && app) dbg.textContent = app.debugLinesNow().join('\n'); }, 500);
      offs.push(() => window.clearInterval(t));
    },
    dispose() {
      for (const f of offs.splice(0)) f();
      dbg?.remove();
      root.textContent = '';
    },
  };
}
