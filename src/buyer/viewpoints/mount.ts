// The Views (SPEC 2.10): a set of still camera positions for a flat, a tap away. The decisions are pure (compose.ts, model.ts, pano.ts); this file is
// the DOM, the listeners and the three side, and everything it makes goes away with `dispose()` (a building mounts one per space).
//
// - The Views tool opens the room tabs (along the bottom, in place of the room strip) and the views of the chosen tab (a small list at the left;
//   a row above the tabs on a phone), with previous and next. The arrow keys (and Page Up / Page Down, a presenter's clicker) step while it is open.
// - Going to a view glides the camera there in first person (eased; a fade and a short glide in when a wall is between; a cut with reduced motion),
//   then the walker stands there, facing as composed: drag looks round, walking is free.
// - Red rings on the floor at the nearest few other views in sight; a tap glides there. They are not in the walking grid and no raycast sees them;
//   they hide while the walker walks.
// - A dot for every view on the floor plan card and the Plan view (nav/mount.ts, views/plan-view.ts).
// - A view with a 360 degree picture (pano.ts) shows it on arrival, faded in, with "Illustrative render" and "Walk from here"; the first step fades back to
//   the live 3D. Only the current picture is loaded.
// Nothing runs per frame unless the Views are open, the walker stands at a view, or a move is under way.
import * as THREE from 'three';
import type { Grid, Layout } from '../../types';
import { CHARACTER_RADIUS_M } from '../../types';
import { circleFree, nearestFree } from '../../core/grid-query';
import type { BuyerContext } from '../context';
import { el } from '../hud';
import type { MountedNav } from '../nav/mount';
import { listLabel, sightLine, tabsOf } from './compose';
import type { Viewpoint, ViewTab } from './compose';
import { lookPoint, movePlan, planMarks, poseAt, ringRadiusM, ringTargets, stepView } from './model';
import type { Pose } from './model';
import { exportList, panoTurnRad } from './pano';
import type { ExportedView } from './pano';
import './viewpoints.css';

export interface ViewpointsDeps {
  ctx: BuyerContext;
  layout: Layout;
  list: Viewpoint[];
  nav: MountedNav;
  /** the HUD root: everything is mounted in it */
  parent: HTMLElement;
  /** the HUD's tools bar: the Views tool goes in it */
  tools: HTMLElement;
  /** what the walker collides with now (door leaves and people too) */
  liveGrid(): Grid;
  /** a sheet that needs an answer is open: nothing moves */
  blocked(): boolean;
  posed(): boolean;
  getUp(): Promise<unknown>;
  /** forgets the walker's speed (a jump) */
  resetMotion(): void;
  /** the walk's camera to first person (the HUD's switch follows) */
  firstPerson(): void;
  reducedMotion?(): boolean;
}

export interface MountedViewpoints {
  readonly list: readonly Viewpoint[];
  /** goes to a view (`instant`: no glide, for an address that opens on it); false when there is no such view or it cannot be done now */
  go(id: string, opts?: { instant?: boolean }): Promise<boolean>;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** the view the walker stands at, or null once they have walked off it */
  at(): string | null;
  /** for the Plan view's dots */
  marks: { list(): readonly { id: string; x: number; z: number; label: string }[]; current(): string | null; pick(id: string): void };
  dispose(): void;
  debug: {
    list(): ExportedView[];
    tabs(): ViewTab[];
    rings(): string[];
    showRings(on: boolean): void;
    /** a picture for a view, for a check without a render (`url` may be a data: URL) */
    setPano(id: string, pano: Viewpoint['pano'] | null): void;
    panoShown(): boolean;
    moving(): boolean;
    state(): Record<string, unknown>;
  };
}

const SVG = (inner: string): string => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  views: SVG('<path d="M4 8.5h3.2L9 6h6l1.8 2.5H20V19H4z"/><circle cx="12" cy="13.3" r="3.3"/>'),
  prev: SVG('<path d="M15 6l-6 6 6 6"/>'),
  next: SVG('<path d="M9 6l6 6-6 6"/>'),
  close: SVG('<path d="M6 6l12 12M18 6 6 18"/>'),
};
const DEG = Math.PI / 180;
const defaultReduced = (): boolean => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function mountViewpoints(d: ViewpointsDeps): MountedViewpoints {
  const { ctx, parent } = d;
  const ch = ctx.character;
  const cam = ctx.camera;
  const viewer = ctx.viewer;
  const reduced = d.reducedMotion ?? defaultReduced;
  let list = d.list.slice();
  let tabs = tabsOf(list);
  const byId = (id: string | null): Viewpoint | undefined => (id ? list.find((v) => v.id === id) : undefined);
  let disposed = false;
  let isOpenNow = false;
  let tabId: string | null = tabs[0]?.id ?? null;
  /** the view the walker stands at (null once they walk off it) and the last one gone to (next and previous step from it) */
  let atId: string | null = null;
  let lastId: string | null = null;
  /** where the walker was put at that view */
  let atPos: { x: number; z: number } | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number): void => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const sleep = (ms: number): Promise<void> => new Promise((r) => later(r, ms));

  // ---------------------------------------------------------------- the tool

  const tool = el('button', 'wt-btn wt-tool wt-vp-tool');
  tool.type = 'button';
  tool.dataset.ui = '1';
  tool.dataset.btn = 'views';
  tool.dataset.testid = 'views-tool';
  tool.setAttribute('aria-label', 'Views: set views of this home, room by room');
  tool.setAttribute('aria-expanded', 'false');
  tool.innerHTML = ICONS.views;
  el('span', 'wt-tool-label', 'Views', tool);
  tool.hidden = list.length === 0;
  d.tools.appendChild(tool);

  // ---------------------------------------------------------------- the tabs (in the bottom bar, in place of the room strip) and the list

  const navBar = parent.querySelector<HTMLElement>('.wt-nav-bar');
  const host = navBar ?? parent;
  const listEl = el('section', 'wt-vp-list wt-glass');
  listEl.dataset.ui = '1';
  listEl.dataset.testid = 'views-list';
  listEl.setAttribute('aria-label', 'Views');
  listEl.hidden = true;
  const head = el('div', 'wt-vp-head', undefined, listEl);
  const count = el('span', 'wt-vp-count', undefined, head);
  count.setAttribute('aria-live', 'polite');
  const btns = el('div', 'wt-vp-btns', undefined, head);
  const mkBtn = (cls: string, icon: string, label: string, testid: string): HTMLButtonElement => {
    const b = el('button', `wt-vp-btn ${cls}`, undefined, btns);
    b.type = 'button'; b.innerHTML = icon; b.setAttribute('aria-label', label); b.dataset.tip = label; b.dataset.testid = testid;
    return b;
  };
  const prevBtn = mkBtn('is-prev', ICONS.prev, 'Previous view', 'views-prev');
  const nextBtn = mkBtn('is-next', ICONS.next, 'Next view', 'views-next');
  const closeBtn = mkBtn('is-close', ICONS.close, 'Close the views', 'views-close');
  const title = el('div', 'wt-vp-title', undefined, listEl);
  const items = el('div', 'wt-vp-items', undefined, listEl);
  items.setAttribute('role', 'list');
  const tabBar = el('div', 'wt-vp-tabs wt-glass');
  tabBar.dataset.ui = '1';
  tabBar.dataset.testid = 'views-tabs';
  tabBar.setAttribute('role', 'tablist');
  tabBar.setAttribute('aria-label', 'Rooms with views');
  tabBar.hidden = true;
  const tabScroller = el('div', 'wt-vp-tabs-in', undefined, tabBar);
  if (navBar) navBar.insertBefore(tabBar, navBar.querySelector('.wt-nav-row'));
  else host.appendChild(tabBar);
  host.insertBefore(listEl, tabBar);

  const tabEls = new Map<string, HTMLButtonElement>();
  function renderTabs(): void {
    tabScroller.replaceChildren();
    tabEls.clear();
    for (const t of tabs) {
      const b = el('button', 'wt-vp-tab', undefined, tabScroller);
      b.type = 'button'; b.dataset.tab = t.id; b.setAttribute('role', 'tab');
      el('span', 'wt-vp-tab-name', t.label, b);
      el('span', 'wt-vp-tab-n', String(t.viewIds.length), b);
      b.setAttribute('aria-label', `${t.label}, ${t.viewIds.length} ${t.viewIds.length === 1 ? 'view' : 'views'}`);
      b.addEventListener('click', (e) => { e.stopPropagation(); selectTab(t.id, true); b.blur(); });
      tabEls.set(t.id, b);
    }
  }
  function renderList(): void {
    const t = tabs.find((x) => x.id === tabId) ?? tabs[0];
    if (!t) return;
    title.textContent = t.label;
    items.replaceChildren();
    for (const id of t.viewIds) {
      const v = byId(id);
      if (!v) continue;
      const b = el('button', 'wt-vp-item', undefined, items);
      b.type = 'button'; b.dataset.vp = v.id; b.setAttribute('role', 'listitem');
      el('i', 'wt-vp-item-dot', undefined, b);
      el('span', 'wt-vp-item-name', listLabel(v, t), b);
      b.setAttribute('aria-label', `Go to the view ${v.name}`);
      b.addEventListener('click', (e) => { e.stopPropagation(); void go(v.id); });
    }
    syncCurrent();
  }
  function syncCurrent(): void {
    const cur = atId ?? lastId;
    const i = cur ? list.findIndex((v) => v.id === cur) : -1;
    count.textContent = i >= 0 ? `VIEW ${i + 1} OF ${list.length}` : `${list.length} VIEWS`;
    for (const b of items.querySelectorAll<HTMLElement>('.wt-vp-item')) {
      const on = b.dataset.vp === cur;
      b.classList.toggle('is-current', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      // the current view is in sight in its list (a row that scrolls sideways on a phone)
      if (on && !listEl.hidden) { try { b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch { /* old browsers */ } }
    }
    for (const [id, b] of tabEls) {
      b.classList.toggle('is-on', id === tabId);
      b.setAttribute('aria-selected', id === tabId ? 'true' : 'false');
    }
    d.nav.setViewCurrent(atId);
  }
  function selectTab(id: string, goFirst = false): void {
    tabId = id;
    renderList();
    const b = tabEls.get(id);
    if (b) { try { b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch { /* old browsers */ } }
    // a tab's first view, as Navigo does, unless the walker already stands at one of the tab's views
    const t = tabs.find((x) => x.id === id);
    if (goFirst && t && !(atId && t.viewIds.includes(atId))) void go(t.viewIds[0]);
  }

  function open(): void {
    if (disposed || !list.length) return;
    if (ctx.views && ctx.views.mode() !== 'walk') ctx.views.set('walk');
    isOpenNow = true;
    listEl.hidden = false;
    tabBar.hidden = false;
    tool.classList.add('is-active');
    tool.setAttribute('aria-expanded', 'true');
    parent.classList.add('has-views');
    const cur = byId(atId ?? lastId);
    if (cur) tabId = cur.tabId;
    renderList();
    engage();
  }
  function close(): void {
    isOpenNow = false;
    listEl.hidden = true;
    tabBar.hidden = true;
    tool.classList.remove('is-active');
    tool.setAttribute('aria-expanded', 'false');
    parent.classList.remove('has-views');
    engage();
  }
  tool.addEventListener('click', (e) => { e.stopPropagation(); if (isOpenNow) close(); else open(); tool.blur(); });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); step(-1); prevBtn.blur(); });
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); step(1); nextBtn.blur(); });
  function step(dir: 1 | -1): void {
    const v = stepView(list, atId ?? lastId, dir);
    if (v) void go(v.id);
  }

  // ---------------------------------------------------------------- rings in the scene

  const accent = (): THREE.Color => {
    let c = '#E2533D';
    try { c = getComputedStyle(document.documentElement).getPropertyValue('--wt-vp-mark').trim() || c; } catch { /* no DOM style */ }
    return new THREE.Color(c);
  };
  const ringGroup = new THREE.Group();
  ringGroup.name = 'viewpoint-rings';
  const ringGeo = new THREE.RingGeometry(0.74, 1, 56);
  const discGeo = new THREE.CircleGeometry(0.74, 56);
  const ringMat = new THREE.MeshBasicMaterial({ color: accent(), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const discMat = new THREE.MeshBasicMaterial({ color: accent(), transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const noRay = (): void => { /* no raycast ever sees a ring (SPEC 2.10) */ };
  interface Ring { obj: THREE.Group; id: string | null; r: number }
  const rings: Ring[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const a = new THREE.Mesh(ringGeo, ringMat), b = new THREE.Mesh(discGeo, discMat);
    for (const m of [a, b]) { m.rotation.x = -Math.PI / 2; m.raycast = noRay; m.renderOrder = 1000; m.frustumCulled = false; }
    g.add(b, a);
    g.visible = false;
    g.userData.viewpointRing = true;
    ringGroup.add(g);
    rings.push({ obj: g, id: null, r: 0.3 });
  }
  ringGroup.raycast = noRay;
  viewer.scene.add(ringGroup);
  let ringsAllowed = true;
  let ringIds: string[] = [];
  let lastPos = { x: ch.position.x, z: ch.position.z };
  let stillFor = 0;
  function updateRings(dt: number): void {
    const p = ch.position;
    const moved = Math.hypot(p.x - lastPos.x, p.z - lastPos.z) > 0.02;
    lastPos = { x: p.x, z: p.z };
    stillFor = moved ? 0 : stillFor + dt;
    // walked off the view: it is no longer where they stand
    if (atId && atPos && Math.hypot(p.x - atPos.x, p.z - atPos.z) > 0.35 && !moving) { atId = null; syncCurrent(); }
    const show = ringsAllowed && !moving && stillFor >= 0.35 && (isOpenNow || atId !== null) && (ctx.views?.mode() ?? 'walk') === 'walk' && !d.blocked() && (ctx.mode() === 'walk' || ctx.mode() === 'pose');
    const targets = show ? ringTargets(list, p, atId, d.liveGrid()) : [];
    ringIds = targets.map((v) => v.id);
    rings.forEach((r, i) => {
      const v = targets[i];
      r.obj.visible = !!v;
      r.id = v?.id ?? null;
      if (!v) return;
      const dist = Math.hypot(v.x - p.x, v.z - p.z);
      r.r = ringRadiusM(dist);
      r.obj.position.set(v.x, 0.025, v.z);
      r.obj.scale.setScalar(r.r);
    });
    // over a panorama the rings are drawn on top (the picture is a sphere round the eye)
    const over = panoShown;
    ringMat.depthTest = !over; discMat.depthTest = !over;
  }
  const proj = new THREE.Vector3();
  const toScreen = (x: number, y: number, z: number): { x: number; y: number; behind: boolean } => {
    proj.set(x, y, z).project(viewer.camera);
    const r = viewer.canvas.getBoundingClientRect();
    return { x: r.left + ((proj.x + 1) / 2) * r.width, y: r.top + ((1 - proj.y) / 2) * r.height, behind: proj.z > 1 };
  };
  function ringAt(clientX: number, clientY: number): string | null {
    let best: string | null = null, bestD = Infinity;
    for (const r of rings) {
      if (!r.obj.visible || !r.id) continue;
      const v = byId(r.id);
      if (!v) continue;
      const c = toScreen(v.x, 0.025, v.z);
      if (c.behind) continue;
      // the ring's reach on screen: its nearest and farthest edge seen from the camera
      const dx = v.x - viewer.camera.position.x, dz = v.z - viewer.camera.position.z, l = Math.hypot(dx, dz) || 1;
      const e1 = toScreen(v.x - (dx / l) * r.r, 0.025, v.z - (dz / l) * r.r), e2 = toScreen(v.x + (-dz / l) * r.r, 0.025, v.z + (dx / l) * r.r);
      const reach = Math.max(22, 1.25 * Math.max(Math.hypot(e1.x - c.x, e1.y - c.y), Math.hypot(e2.x - c.x, e2.y - c.y)));
      const dd = Math.hypot(clientX - c.x, clientY - c.y);
      if (dd <= reach && dd < bestD) { best = r.id; bestD = dd; }
    }
    return best;
  }
  // a press on a ring is the ring's (the walk's look drag and tap never see it); a tap (short, still) goes there
  const canvas = viewer.canvas;
  let ringPress: { id: string; pid: number; x: number; y: number; t: number } | null = null;
  const onDown = (e: PointerEvent): void => {
    if (!rings.some((r) => r.obj.visible)) return;
    const id = ringAt(e.clientX, e.clientY);
    if (!id) return;
    ringPress = { id, pid: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  const onUp = (e: PointerEvent): void => {
    if (!ringPress || e.pointerId !== ringPress.pid) return;
    const p = ringPress;
    ringPress = null;
    e.stopImmediatePropagation();
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= 12 && performance.now() - p.t < 600) void go(p.id);
  };
  const onHover = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const over = rings.some((r) => r.obj.visible) && ringAt(e.clientX, e.clientY) !== null;
    canvas.classList.toggle('wt-vp-hover', over);
  };
  canvas.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointermove', onHover);

  // ---------------------------------------------------------------- the panorama

  const panoGeo = new THREE.SphereGeometry(30, 64, 32);
  panoGeo.scale(-1, 1, 1);
  const panoMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
  const panoMesh = new THREE.Mesh(panoGeo, panoMat);
  panoMesh.name = 'viewpoint-pano';
  panoMesh.renderOrder = 999;
  panoMesh.frustumCulled = false;
  panoMesh.raycast = noRay;
  panoMesh.visible = false;
  viewer.scene.add(panoMesh);
  let panoTex: THREE.Texture | null = null;
  let panoUrl: string | null = null;
  let panoShown = false;
  let panoTarget = 0;
  let panoAt: { x: number; z: number } | null = null;
  const panoBar = el('div', 'wt-vp-pano wt-glass', undefined, parent);
  panoBar.dataset.ui = '1';
  panoBar.dataset.testid = 'views-pano';
  panoBar.hidden = true;
  el('span', 'wt-vp-pano-note', 'Illustrative render', panoBar);
  const walkBtn = el('button', 'wt-vp-pano-walk', 'Walk from here', panoBar);
  walkBtn.type = 'button';
  walkBtn.dataset.testid = 'views-walk-from-here';
  walkBtn.addEventListener('click', (e) => { e.stopPropagation(); leavePano(); walkBtn.blur(); });
  const loader = new THREE.TextureLoader();
  let panoToken = 0;
  function showPano(v: Viewpoint): void {
    const pano = v.pano;
    if (!pano) { leavePano(); return; }
    const token = ++panoToken;
    const apply = (tex: THREE.Texture): void => {
      if (token !== panoToken || disposed) { if (tex !== panoTex) tex.dispose(); return; }
      if (panoTex && panoTex !== tex) panoTex.dispose(); // only the current picture is kept
      panoTex = tex;
      panoUrl = pano.url;
      tex.colorSpace = THREE.SRGBColorSpace;
      panoMat.map = tex;
      panoMat.needsUpdate = true;
      panoMesh.rotation.y = panoTurnRad(pano.yawDeg);
      panoMesh.visible = true;
      panoShown = true;
      panoTarget = 1;
      panoAt = { x: ch.position.x, z: ch.position.z };
      panoBar.hidden = false;
      if (reduced()) panoMat.opacity = 1;
      engage();
    };
    if (panoTex && panoUrl === pano.url) { apply(panoTex); return; }
    loader.load(pano.url, apply, undefined, () => { if (token === panoToken) console.warn(`[walkthru] the picture of view ${v.id} did not load`); });
  }
  function leavePano(): void {
    panoToken++;
    panoTarget = 0;
    panoBar.hidden = true;
    if (reduced()) panoMat.opacity = 0;
    engage();
  }
  function stepPano(dt: number): void {
    if (!panoMesh.visible) return;
    panoMesh.position.copy(viewer.camera.position);
    const k = reduced() ? 1 : Math.min(1, dt / 0.35);
    panoMat.opacity += (panoTarget - panoMat.opacity) * (panoTarget > panoMat.opacity ? Math.min(1, k * 1.6) : Math.min(1, k * 2.2));
    if (Math.abs(panoTarget - panoMat.opacity) < 0.01) panoMat.opacity = panoTarget;
    if (panoTarget === 0 && panoMat.opacity <= 0) {
      panoMesh.visible = false;
      panoShown = false;
      // the picture is let go once it has faded: only the current one is ever held
      if (panoTex) { panoTex.dispose(); panoTex = null; panoUrl = null; panoMat.map = null; }
    }
    // the first step off the spot is a step into the live 3D
    if (panoTarget === 1 && panoAt && Math.hypot(ch.position.x - panoAt.x, ch.position.z - panoAt.z) > 0.03) leavePano();
  }

  // ---------------------------------------------------------------- going to a view

  const fade = el('div', 'wt-nav-fade wt-vp-fade', undefined, parent);
  fade.setAttribute('aria-hidden', 'true');
  let moving = false;
  let glide: { from: Pose; to: Pose; t: number; dur: number; done: () => void } | null = null;
  let token = 0;

  const camPose = (): Pose => {
    const dir = viewer.camera.getWorldDirection(new THREE.Vector3());
    return { x: viewer.camera.position.x, y: viewer.camera.position.y, z: viewer.camera.position.z, yawDeg: Math.atan2(dir.x, dir.z) / DEG, pitchDeg: -Math.asin(Math.max(-1, Math.min(1, dir.y))) / DEG };
  };
  const eyeY = (): number => 0.93 * ch.heightM;
  const targetPose = (v: Viewpoint): Pose => (v.pano
    ? { x: v.pano.x, y: v.pano.y, z: v.pano.z, yawDeg: v.yawDeg, pitchDeg: v.pitchDeg }
    : { x: v.x, y: eyeY(), z: v.z, yawDeg: v.yawDeg, pitchDeg: v.pitchDeg });
  const drive = (p: Pose, smooth = 0.05): void => { cam.driveTo({ x: p.x, y: p.y, z: p.z }, lookPoint(p), smooth); };

  /** the walker stands at the view, in first person, facing as composed */
  function settle(v: Viewpoint, to: Pose): void {
    const g = d.liveGrid();
    const at = circleFree(g, to.x, to.z, CHARACTER_RADIUS_M) ? { x: to.x, z: to.z } : nearestFree(g, to.x, to.z, CHARACTER_RADIUS_M, 1) ?? { x: to.x, z: to.z };
    d.resetMotion();
    ch.position = at;
    ch.object.position.y = 0;
    ch.yawDeg = to.yawDeg;
    d.firstPerson();
    cam.setView(true, { instant: true });
    cam.yawDeg = to.yawDeg;
    cam.setFirstPersonPitch(to.pitchDeg, true);
    cam.setTarget(at, ch.heightM);
    ch.setLocomotion(0, false, 0);
    atId = v.id; lastId = v.id; atPos = { x: at.x, z: at.z };
    lastPos = { x: at.x, z: at.z };
    stillFor = 0;
    if (tabId !== v.tabId) { tabId = v.tabId; if (isOpenNow) renderList(); }
    syncCurrent();
  }

  async function go(id: string, opts: { instant?: boolean } = {}): Promise<boolean> {
    const v = byId(id);
    // an address that opens on a view is put there under the height picker (it is the picture behind it)
    if (!v || disposed || (!opts.instant && d.blocked())) return false;
    if (ctx.mode() !== 'walk' && ctx.mode() !== 'pose') return false;
    const my = ++token;
    if (d.nav.debug.driver.busy) d.nav.debug.stop();
    if (d.posed()) { await d.getUp(); if (my !== token) return false; }
    if (ctx.views && ctx.views.mode() !== 'walk') {
      ctx.views.set('walk');
      await sleep(1000); // the camera flies back down first
      if (my !== token) return false;
    }
    leavePano();
    const to = targetPose(v);
    const from = camPose();
    const plan = opts.instant ? { mode: 'cut' as const, seconds: 0 } : movePlan(from, to, clearBetween(from, to), reduced());
    moving = true;
    engage();
    cam.setBodyHidden(true);
    try {
      if (plan.mode === 'cut') {
        if (!opts.instant) { fade.classList.add('is-on'); await sleep(120); if (my !== token) return false; }
        settle(v, to);
        drive(to, 0.05);
        if (!opts.instant) { await sleep(90); fade.classList.remove('is-on'); }
      } else if (plan.mode === 'glide') {
        await runGlide(from, to, plan.seconds);
        if (my !== token) return false;
        settle(v, to);
      } else {
        // a wall between: a short fade, then a short glide in from a little way back (the glide reads as arriving, not as a cut)
        fade.classList.add('is-on');
        await sleep(190);
        if (my !== token) return false;
        const back = backOff(to);
        drive(back, 0.05);
        await sleep(160);
        if (my !== token) return false;
        fade.classList.remove('is-on');
        await runGlide(back, to, plan.seconds);
        if (my !== token) return false;
        settle(v, to);
      }
      // hold the composed pose a frame or two while the walker's own first-person view catches up, then hand it back
      await sleep(80);
      if (my !== token) return false;
      cam.releaseDrive(0.25);
      cam.setBodyHidden(null);
      if (v.pano) showPano(v);
      return true;
    } finally {
      if (my === token) { moving = false; engage(); }
    }
  }
  function runGlide(from: Pose, to: Pose, seconds: number): Promise<void> {
    return new Promise((resolve) => {
      glide = { from, to, t: 0, dur: Math.max(0.05, seconds), done: resolve };
      drive(from, 0.05);
      engage();
    });
  }
  function stepGlide(dt: number): void {
    const g = glide;
    if (!g) return;
    g.t = Math.min(g.dur, g.t + Math.min(dt, 0.1));
    drive(poseAt(g.from, g.to, g.t / g.dur), 0.05);
    if (g.t >= g.dur) { glide = null; g.done(); }
  }
  /** can the eye glide straight there: no wall or tall piece between (the live grid: a shut door is a wall) */
  function clearBetween(a: Pose, b: Pose): boolean {
    const dd = Math.hypot(b.x - a.x, b.z - a.z);
    if (dd < 0.05) return true;
    const s = sightLine(d.liveGrid(), { x: a.x, z: a.z }, Math.atan2(b.x - a.x, b.z - a.z) / DEG, dd);
    return !s.outlook && s.d >= dd - 0.05;
  }
  /** a point up to 0.8 m back along the view, in sight of it, to glide in from after a fade */
  function backOff(to: Pose): Pose {
    const yaw = to.yawDeg * DEG;
    const back = sightLine(d.liveGrid(), { x: to.x, z: to.z }, to.yawDeg + 180, 1.2);
    const m = Math.max(0, Math.min(0.8, back.d - 0.35));
    return { ...to, x: to.x - Math.sin(yaw) * m, z: to.z - Math.cos(yaw) * m, yawDeg: to.yawDeg + 12 };
  }

  // ---------------------------------------------------------------- keys

  const onKey = (e: KeyboardEvent): void => {
    if (!isOpenNow || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (d.blocked() || (ctx.mode() !== 'walk' && ctx.mode() !== 'pose')) return;
    let dir: 1 | -1 | 0 = 0;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') dir = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') dir = -1;
    else if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); return; }
    if (!dir) return;
    // the walk's own keys never see it: left and right step through the views while they are open
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!e.repeat) step(dir);
  };
  window.addEventListener('keydown', onKey, true);

  // ---------------------------------------------------------------- the frame (only while it is needed)

  let offFrame: (() => void) | null = null;
  let ringClock = 0;
  function engage(): void {
    const need = !disposed && (isOpenNow || atId !== null || moving || glide !== null || panoMesh.visible);
    if (need && !offFrame) offFrame = viewer.onFrame(frame);
    else if (!need && offFrame) { offFrame(); offFrame = null; for (const r of rings) r.obj.visible = false; ringIds = []; }
  }
  function frame(dt: number): void {
    if (disposed) return;
    stepGlide(dt);
    stepPano(dt);
    ringClock += dt;
    if (ringClock >= 0.1) { updateRings(ringClock); ringClock = 0; }
    // the Views close in Furnish, Measure, the doll house and the plan, or when a tour starts
    if (isOpenNow && (d.nav.debug.driver.touring || (ctx.views?.mode() ?? 'walk') !== 'walk' || (ctx.mode() !== 'walk' && ctx.mode() !== 'pose'))) close();
    engage();
  }

  // ---------------------------------------------------------------- the plans' dots

  const markList = (): { id: string; x: number; z: number; label: string }[] => planMarks(list);
  d.nav.setViewMarks(markList(), (id) => { void go(id); });

  renderTabs();
  renderList();

  return {
    get list() { return list; },
    go,
    open,
    close,
    isOpen: () => isOpenNow,
    at: () => atId,
    marks: { list: markList, current: () => atId, pick: (id) => { void go(id); } },
    dispose() {
      if (disposed) return;
      disposed = true;
      token++;
      offFrame?.(); offFrame = null;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerup', onUp, true);
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onHover);
      canvas.classList.remove('wt-vp-hover');
      if (moving) { cam.releaseDrive(0.2); cam.setBodyHidden(null); }
      d.nav.setViewMarks([], () => { /* gone */ });
      viewer.scene.remove(ringGroup);
      viewer.scene.remove(panoMesh);
      ringGeo.dispose(); discGeo.dispose(); ringMat.dispose(); discMat.dispose();
      panoGeo.dispose(); panoMat.dispose(); panoTex?.dispose();
      parent.classList.remove('has-views');
      tool.remove(); listEl.remove(); tabBar.remove(); panoBar.remove(); fade.remove();
    },
    debug: {
      list: () => exportList(list),
      tabs: () => tabs.map((t) => ({ ...t, roomIds: [...t.roomIds], viewIds: [...t.viewIds] })),
      rings: () => ringIds.slice(),
      showRings: (on) => { ringsAllowed = on; if (!on) for (const r of rings) r.obj.visible = false; },
      setPano: (id, pano) => {
        list = list.map((v) => (v.id === id ? (pano ? { ...v, pano } : (({ pano: _p, ...rest }) => rest)(v)) : v));
        tabs = tabsOf(list);
      },
      panoShown: () => panoShown && panoMat.opacity > 0.99,
      moving: () => moving,
      state: () => ({ atId, lastId, moving, glide: !!glide, stillFor, ringsAllowed, open: isOpenNow, blocked: d.blocked(), mode: ctx.mode(), view: ctx.views?.mode() ?? 'walk', ticking: !!offFrame, pos: ch.position, atPos }),
    },
  };
}
