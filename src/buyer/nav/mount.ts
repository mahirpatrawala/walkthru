// The walk's three navigation aids, mounted in the HUD of every space: a mini floor plan (where you stand, which way you look, the room you are
// in, tap a room to go there), a room bar (one chip per room with its size, the current one lit, tap to go) and a Tour button (an automatic
// walk through the home, room by room). The decisions are in pure modules (nav-model.ts, tour-plan.ts, grid-path.ts, driver.ts); this file
// is the DOM, the listeners and the three-side moves, and everything it makes goes away with `dispose()` (a building mounts one per space).
import { CHARACTER_RADIUS_M } from '../../types';
import type { Grid, Layout, Vec2 } from '../../types';
import { circleFree, nearestFree } from '../../core/grid-query';
import { planSvg } from '../../start/plan-svg';
import type { Doors } from '../doors';
import type { BuyerContext } from '../context';
import { el } from '../hud';
import { storageGet, storageSet } from '../store';
import type { FurnitureStoreImpl, StorageLike, UnverifiedRooms } from '../store';
import { Driver } from './driver';
import type { GoResult, TourState } from './driver';
import { findRoute } from './grid-path';
import { firstCrossing, isOpenEnough, planGridOf } from './door-route';
import { chipCaption, conePath, currentRoomId, liftAbove, roomChips, roomNear } from './nav-model';
import type { Rect, RoomChip } from './nav-model';
import { skippedNote } from './tour-plan';
import './nav.css';

const MAP_KEY = 'walkthru:nav:map-collapsed';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** px: the plan's walker dot, and the length of the view cone */
const DOT_PX = 5, CONE_PX = 30;
/** How far (px) from a tapped point on the plan the nearest room still counts */
const TAP_SNAP_PX = 18;
/** How long the end-of-tour note stays, ms */
const DONE_NOTE_MS = 9000;

export interface NavDeps {
  ctx: BuyerContext;
  layout: Layout;
  store: FurnitureStoreImpl;
  doors: Doors;
  unverified: UnverifiedRooms;
  /** the water of a pool area: drawn on the plan */
  water: { x0: number; z0: number; x1: number; z1: number }[];
  /** a sheet or panel that needs an answer is open (height picker, rooms, lift, people): the tour does not run, the walker does not go */
  blocked(): boolean;
  /** the walker is sitting or lying */
  posed(): boolean;
  getUp(): Promise<unknown>;
  /** forgets the walker's speed (a jump) */
  resetMotion(): void;
  storage: StorageLike | null;
  /** the HUD root: everything is mounted in it */
  parent: HTMLElement;
}

export interface NavAudit { frames: number; bad: number; visited: string[]; samples: Vec2[] }

export interface MountedNav {
  /** called from the frame loop where the keys and the thumb are read: true when the auto-walk moved the walker this frame (they are not read) */
  drive(dt: number): boolean;
  dispose(): void;
  debug: {
    driver: Driver;
    go(roomId: string): Promise<GoResult>;
    startTour(): Promise<TourState>;
    stop(): void;
    chips(): RoomChip[];
    here(): string | null;
    mapOpen(): boolean;
    setMapOpen(open: boolean): void;
    /** why a walk to a room would go the way it does: the route's length, the shut door it meets first, and where every leaf stands */
    plan(roomId: string): { spot: { x: number; z: number; yawDeg: number } | null; lengthM: number | null; door: string | null; leaves: { id: string; pos: number; max: number; open: boolean }[] };
    /** headless checks: runs the doors and the auto-walk for `seconds` of the walker's time in one go (the page's frames are not needed), resolves when done or the time is up */
    simulate(seconds: number, dt?: number): Promise<number>;
    /** records every frame of the auto-walk: where the body was and whether it was ever inside something solid */
    audit(on: boolean): NavAudit;
  };
}

const ICON = (inner: string): string => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  plan: ICON('<path d="M4 4h16v16H4z"/><path d="M4 12h7M11 4v8M15 12v8M11 16h4"/>'),
  close: ICON('<path d="M6 6l12 12M18 6 6 18"/>'),
  play: ICON('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>'),
  pause: ICON('<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>'),
  stop: ICON('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>'),
  chev: ICON('<path d="M6 9l6 6 6-6"/>'),
};

const reducedMotion = (): boolean => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function mountNav(d: NavDeps): MountedNav {
  const { ctx, layout, parent } = d;
  const ch = ctx.character;
  const chips = roomChips(layout, d.unverified);
  const wholeIds = layout.rooms.filter((r) => !r.partial).map((r) => r.id);
  const multi = wholeIds.length >= 2;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number): void => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const sleep = (ms: number): Promise<void> => new Promise((res) => later(res, ms));
  let disposed = false;

  // ---------------------------------------------------------------- the walk grids

  // routes are planned on the grid without any door leaf (the leaves are opened on the way); followers are left out of the plan (they step
  // aside as they follow) but never out of the collision, which uses the live grid
  let memoKey: Grid | null = null;
  let memo: Grid | null = null;
  const staticGrid = (): Grid => {
    const k = d.store.grid();
    if (k !== memoKey || !memo) { memo = d.store.gridExcludingTemporary(['doors']); memoKey = k; }
    return memo;
  };
  const liveGrid = (): Grid => d.store.grid();

  // ---------------------------------------------------------------- the driver

  const place = (to: { x: number; z: number; yawDeg: number }): void => {
    const g = liveGrid();
    const at = circleFree(g, to.x, to.z, CHARACTER_RADIUS_M) ? { x: to.x, z: to.z } : nearestFree(g, to.x, to.z, CHARACTER_RADIUS_M, 2) ?? { x: to.x, z: to.z };
    d.resetMotion();
    ch.position = at;
    ch.object.position.y = 0;
    ch.yawDeg = to.yawDeg;
    ctx.camera.yawDeg = to.yawDeg;
    ctx.camera.setTarget(at, ch.heightM);
    ch.setLocomotion(0, false, 0);
  };

  const fade = el('div', 'wt-nav-fade', undefined, parent);
  fade.setAttribute('aria-hidden', 'true');

  const driver = new Driver({
    layout,
    character: ch,
    camera: ctx.camera,
    staticGrid,
    liveGrid,
    leaves: () => d.doors.route.leaves(),
    openDoor: (id) => d.doors.route.open(id),
    jump: async (to) => {
      if (reducedMotion()) { place(to); return; }
      fade.classList.add('is-on');
      await sleep(200);
      if (disposed) return;
      place(to);
      await sleep(60);
      fade.classList.remove('is-on');
    },
    reducedMotion,
  });

  // ---------------------------------------------------------------- the minimap

  const mapWrap = el('aside', 'wt-nav-map', undefined, parent);
  mapWrap.dataset.ui = '1';
  mapWrap.dataset.testid = 'nav-map';
  mapWrap.setAttribute('aria-label', 'Plan of this space');
  const mapBody = el('div', 'wt-nav-map-body', undefined, mapWrap);
  mapBody.id = `wt-nav-map-${Math.random().toString(36).slice(2, 7)}`;
  const mapToggle = el('button', 'wt-nav-map-toggle', undefined, mapWrap);
  mapToggle.type = 'button';
  mapToggle.dataset.testid = 'nav-map-toggle';
  mapToggle.setAttribute('aria-controls', mapBody.id);
  let mapOpen = storageGet(d.storage, MAP_KEY) !== '1';

  const plan = planSvg(layout, d.unverified, {
    idPrefix: 'wtnav',
    ...(multi ? { selectable: new Set(wholeIds) } : {}),
    selectedId: null,
    title: 'Plan of this space. Your place and the way you look are marked.',
  });
  mapBody.innerHTML = plan.svg; // planSvg escapes every label it writes
  const svg = mapBody.querySelector('svg') as SVGSVGElement;
  svg.classList.add('wt-nav-plan');
  svg.removeAttribute('role');
  svg.setAttribute('focusable', 'false');
  const vb = svg.viewBox.baseVal;
  mapBody.style.setProperty('--wt-nav-aspect', String(plan.aspect));
  // the water of a pool area, under the walls
  for (const w of d.water) {
    const p = document.createElementNS(SVG_NS, 'polygon');
    p.setAttribute('class', 'wt-nav-water');
    p.setAttribute('points', `${w.x0},${w.z0} ${w.x1},${w.z0} ${w.x1},${w.z1} ${w.x0},${w.z1}`);
    const first = svg.querySelector('.plan-wall');
    if (first) first.before(p); else svg.appendChild(p);
  }
  const live = document.createElementNS(SVG_NS, 'g');
  live.setAttribute('class', 'wt-nav-live');
  live.setAttribute('pointer-events', 'none');
  const cone = document.createElementNS(SVG_NS, 'path');
  cone.setAttribute('class', 'wt-nav-cone');
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('class', 'wt-nav-dot');
  live.append(cone, dot);
  svg.appendChild(live);
  const roomGroups = new Map<string, SVGGElement>();
  svg.querySelectorAll<SVGGElement>('g[data-room]').forEach((g) => roomGroups.set(g.dataset.room as string, g));

  const setMapOpen = (open: boolean, remember = true): void => {
    mapOpen = open;
    mapWrap.classList.toggle('is-collapsed', !open);
    mapBody.hidden = !open;
    mapToggle.innerHTML = open ? ICONS.close : ICONS.plan;
    mapToggle.setAttribute('aria-expanded', String(open));
    const name = open ? 'Hide the plan' : 'Show the plan';
    mapToggle.setAttribute('aria-label', name);
    mapToggle.title = name;
    if (remember) storageSet(d.storage, MAP_KEY, open ? '0' : '1');
    lastDrawn = null;
    measure();
  };
  mapToggle.addEventListener('click', (e) => { e.stopPropagation(); setMapOpen(!mapOpen); });

  const planPoint = (e: MouseEvent): Vec2 | null => {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(m.inverse());
    return { x: q.x, z: q.y };
  };
  let pxPerM = 10;
  const measure = (): void => {
    const r = svg.getBoundingClientRect();
    if (r.width > 0 && vb.width > 0) pxPerM = r.width / vb.width;
    dot.setAttribute('r', String(DOT_PX / pxPerM));
    dot.style.strokeWidth = `${1.5 / pxPerM}px`;
  };
  // the HUD is hidden until the walker is chosen and the plan's size changes with the window: measure again whenever it does
  const mapObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { measure(); lastDrawn = null; }) : null;
  mapObserver?.observe(svg);
  if (multi) {
    svg.addEventListener('click', (e) => {
      const g = (e.target as Element).closest?.('g[data-room]') as SVGGElement | null;
      let id = g?.dataset.room ?? null;
      if (!id) {
        const p = planPoint(e);
        id = p ? roomNear(layout, p, TAP_SNAP_PX / pxPerM)?.id ?? null : null;
      }
      if (id) void go(id);
    });
    svg.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const g = (e.target as Element).closest?.('g[data-room]') as SVGGElement | null;
      if (g?.dataset.room) { e.preventDefault(); void go(g.dataset.room); }
    });
  }

  // ---------------------------------------------------------------- the room bar and the tour

  const bar = el('div', 'wt-nav-bar', undefined, parent);
  bar.dataset.ui = '1';
  bar.dataset.testid = 'nav-bar';
  const tourRow = el('div', 'wt-nav-tour', undefined, bar);
  tourRow.dataset.testid = 'nav-tour-row';
  tourRow.hidden = true;
  const tourProg = el('div', 'wt-nav-tour-prog', undefined, tourRow);
  const tourFill = el('i', undefined, undefined, tourProg);
  const tourPause = el('button', 'wt-nav-tour-btn', undefined, tourRow);
  tourPause.type = 'button';
  tourPause.dataset.testid = 'nav-tour-pause';
  const tourText = el('div', 'wt-nav-tour-text', undefined, tourRow);
  tourText.setAttribute('role', 'status');
  tourText.setAttribute('aria-live', 'polite');
  const tourTitle = el('div', 'wt-nav-tour-title', undefined, tourText);
  tourTitle.dataset.testid = 'nav-tour-title';
  const tourSub = el('div', 'wt-nav-tour-sub', undefined, tourText);
  const tourStop = el('button', 'wt-nav-tour-btn is-stop', undefined, tourRow);
  tourStop.type = 'button';
  tourStop.dataset.testid = 'nav-tour-stop';

  const row = el('div', 'wt-nav-row', undefined, bar);
  const tourBtn = el('button', 'wt-nav-tourbtn', undefined, row);
  tourBtn.type = 'button';
  tourBtn.dataset.testid = 'nav-tour-btn';
  tourBtn.innerHTML = `${ICONS.play}<span>Tour</span>`;
  tourBtn.setAttribute('aria-label', 'Take a tour of this home, room by room');
  tourBtn.hidden = !multi;
  const scroller = el('div', 'wt-nav-chips', undefined, row);
  scroller.setAttribute('role', 'group');
  scroller.setAttribute('aria-label', 'Rooms');
  scroller.dataset.testid = 'nav-chips';
  const chipEls = new Map<string, HTMLButtonElement>();
  for (const c of chips) {
    const b = el('button', 'wt-nav-chip', undefined, scroller);
    b.type = 'button';
    b.dataset.room = c.id;
    b.setAttribute('aria-label', c.goable ? `Go to ${c.title}` : `${c.title}. Only partly on the drawing, so you cannot walk there.`);
    el('span', 'wt-nav-chip-name', c.label, b);
    el('span', 'wt-nav-chip-area', c.area, b);
    if (!c.goable) { b.classList.add('is-partial'); b.setAttribute('aria-disabled', 'true'); }
    b.addEventListener('click', (e) => { e.stopPropagation(); if (c.goable) void go(c.id); else d.ctx.hud.toast(`${c.label} is only partly on the drawing, so you cannot walk there.`); });
    chipEls.set(c.id, b);
  }
  bar.hidden = !multi;
  const chipById = new Map(chips.map((c) => [c.id, c]));

  let barPx = 0;
  const barObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncBarHeight()) : null;
  barObserver?.observe(bar);
  function syncBarHeight(): void {
    const px = bar.hidden ? 0 : Math.round(bar.offsetHeight);
    if (px === barPx) return;
    barPx = px;
    parent.style.setProperty('--wt-nav-h', `${px}px`);
    parent.style.setProperty('--wt-nav-pad', px > 0 ? '1' : '0');
  }

  // the end-of-tour note stays a while and then goes
  let noteUntil = 0;
  const renderTour = (): void => {
    const t = driver.tour;
    const shownNote = t && !t.active && t.phase === 'done' && performance.now() < noteUntil;
    const show = !!t && (t.active || shownNote);
    tourRow.hidden = !show;
    tourBtn.disabled = !!t?.active;
    if (!t || !show) { syncBarHeight(); return; }
    const chip = t.roomId ? chipById.get(t.roomId) : null;
    if (t.active) {
      tourTitle.textContent = t.phase === 'looking' && chip ? chipCaption(chip)
        : t.phase === 'returning' ? 'Back to where you started'
          : t.roomLabel ? `On the way to ${t.roomLabel}` : 'Starting the tour';
      tourSub.textContent = t.paused ? `Paused · room ${Math.max(1, t.index)} of ${t.total}` : `Room ${Math.max(1, t.index)} of ${t.total} · tap or press a key to take over`;
      tourPause.innerHTML = t.paused ? ICONS.play : ICONS.pause;
      tourPause.setAttribute('aria-label', t.paused ? 'Resume the tour' : 'Pause the tour');
      tourPause.hidden = false;
      tourStop.innerHTML = ICONS.stop;
      tourStop.setAttribute('aria-label', 'Stop the tour');
    } else {
      tourTitle.textContent = 'Tour finished';
      tourSub.textContent = skippedNote(t.skipped) ?? `You saw ${t.visited.length} ${t.visited.length === 1 ? 'room' : 'rooms'} and you are back where you started.`;
      tourPause.hidden = true;
      tourStop.innerHTML = ICONS.close;
      tourStop.setAttribute('aria-label', 'Close');
    }
    tourFill.style.width = `${t.total > 0 ? Math.min(100, Math.round((100 * (t.phase === 'done' ? t.total : t.visited.length)) / t.total)) : 0}%`;
    syncBarHeight();
  };
  const offDriver = driver.onChange(renderTour);
  tourPause.addEventListener('click', (e) => { e.stopPropagation(); if (driver.tour?.paused) driver.resume(); else driver.pause(); tourPause.blur(); });
  tourStop.addEventListener('click', (e) => {
    e.stopPropagation();
    if (driver.touring) driver.stop(); else { noteUntil = 0; renderTour(); }
    tourStop.blur();
  });
  tourBtn.addEventListener('click', (e) => { e.stopPropagation(); void startTour(); tourBtn.blur(); });

  // ---------------------------------------------------------------- doing things

  const allowed = (): boolean => !disposed && !d.blocked() && (ctx.mode() === 'walk' || ctx.mode() === 'pose');
  async function standUp(): Promise<void> { if (d.posed()) await d.getUp(); }

  async function go(roomId: string): Promise<GoResult> {
    if (!allowed()) return 'cancelled';
    await standUp();
    const r = await driver.goTo(roomId);
    if (r === 'no-spot') d.ctx.hud.toast(`${chipById.get(roomId)?.label ?? 'That room'} is only partly on the drawing, so there is nowhere to stand.`);
    return r;
  }
  async function startTour(): Promise<TourState> {
    if (!allowed() || driver.touring) return driver.tour ?? ({ active: false } as TourState);
    await standUp();
    noteUntil = 0;
    const done = await driver.startTour();
    if (!disposed && done.phase === 'done') { noteUntil = performance.now() + DONE_NOTE_MS; renderTour(); later(renderTour, DONE_NOTE_MS + 50); }
    return done;
  }

  // any input of the buyer's own ends the auto-walk where they stand: a key, a drag or a tap on the 3D view, the wheel
  const interrupt = (): void => { if (driver.busy) driver.stop(); };
  const onKey = (e: KeyboardEvent): void => {
    if (!driver.busy) return;
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Tab') return;
    if ((e.target as Element | null)?.closest?.('.wt-nav-bar, .wt-nav-map')) return; // keys inside the aids are the aids' own
    interrupt();
  };
  window.addEventListener('keydown', onKey, true);
  const canvas = ctx.viewer.canvas;
  canvas.addEventListener('pointerdown', interrupt, true);
  // a press on anything else of the HUD (the Open door pill, the round buttons) is the buyer's own doing too; the aids' own controls are not
  const onHudPress = (e: Event): void => { if (!(e.target as Element | null)?.closest?.('.wt-nav-bar, .wt-nav-map')) interrupt(); };
  parent.addEventListener('pointerdown', onHudPress, true);
  canvas.addEventListener('wheel', interrupt, { capture: true, passive: true });

  // ---------------------------------------------------------------- each frame (about ten a second)

  let clock = 0;
  let here: string | null = null;
  let lastDrawn: { x: number; z: number; yaw: number } | null = null;
  let lastVisible: boolean | null = null;
  let liftClock = 0; // ms
  let lift = 0;
  const AVOID = '.wt-stack .wt-card, .wt-stack .wt-pill, .wto-pill, .wto-card';

  function scrollChipIntoView(id: string): void {
    const b = chipEls.get(id);
    if (!b || bar.hidden) return;
    const want = b.offsetLeft - (scroller.clientWidth - b.offsetWidth) / 2;
    const left = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, want));
    if (Math.abs(left - scroller.scrollLeft) < 2) return;
    try { scroller.scrollTo({ left, behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch { scroller.scrollLeft = left; }
  }
  function setHere(id: string | null): void {
    if (id === here) return;
    if (here) { roomGroups.get(here)?.classList.remove('is-on'); const o = chipEls.get(here); o?.classList.remove('is-here'); o?.removeAttribute('aria-current'); }
    here = id;
    if (id) {
      roomGroups.get(id)?.classList.add('is-on');
      const b = chipEls.get(id);
      b?.classList.add('is-here');
      b?.setAttribute('aria-current', 'location');
      scrollChipIntoView(id);
    }
  }
  function drawMe(): void {
    const p = ch.position;
    const yaw = ctx.camera.viewYawDeg;
    const moved = !lastDrawn || Math.hypot(p.x - lastDrawn.x, p.z - lastDrawn.z) > 0.04 || Math.abs(((yaw - lastDrawn.yaw + 540) % 360) - 180) > 2.5;
    if (!moved) return;
    lastDrawn = { x: p.x, z: p.z, yaw };
    dot.setAttribute('cx', p.x.toFixed(3));
    dot.setAttribute('cy', p.z.toFixed(3));
    cone.setAttribute('d', conePath(p, yaw, CONE_PX / pxPerM));
  }
  function applyVisibility(): void {
    const m = ctx.mode();
    const show = !d.blocked() && (m === 'walk' || m === 'pose');
    if (show === lastVisible) return;
    lastVisible = show;
    mapWrap.hidden = !show;
    bar.hidden = !show || !multi;
    fade.hidden = !show;
    syncBarHeight();
    if (!show && driver.busy) driver.stop();
    if (show) { lastDrawn = null; measure(); }
  }
  function keepClearOfPrompts(): void {
    if (mapWrap.hidden) return;
    const r = mapWrap.getBoundingClientRect();
    if (r.width === 0) return;
    const nat: Rect = { left: r.left, right: r.right, top: r.top + lift, bottom: r.bottom + lift };
    const obstacles: Rect[] = [];
    parent.querySelectorAll<HTMLElement>(AVOID).forEach((o) => {
      if (o.hidden || o.offsetParent === null && getComputedStyle(o).position !== 'fixed') return;
      const b = o.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) obstacles.push({ left: b.left, right: b.right, top: b.top, bottom: b.bottom });
    });
    const next = Math.round(liftAbove(nat, obstacles, 8));
    if (next !== lift) { lift = next; mapWrap.style.setProperty('--wt-nav-lift', `${next}px`); }
  }

  const audit: NavAudit = { frames: 0, bad: 0, visited: [], samples: [] };
  let auditOn = false;
  const drive = (dt: number): boolean => {
    const moved = driver.update(dt);
    if (auditOn && moved) {
      audit.frames++;
      const p = ch.position;
      if (!circleFree(liveGrid(), p.x, p.z, CHARACTER_RADIUS_M - 0.03)) audit.bad++;
      if (audit.samples.length < 20000) audit.samples.push({ x: p.x, z: p.z });
    }
    return moved;
  };

  // the aids keep wall-clock time (a slow device draws few frames, and a prompt must not sit over the plan until it has drawn five)
  const offFrame = ctx.viewer.onFrame(() => {
    const now = performance.now();
    if (now - clock < 100) return;
    clock = now;
    applyVisibility();
    if (driver.touring && (d.blocked() || ctx.mode() !== 'walk')) driver.stop();
    setHere(currentRoomId(layout, ch.position, here));
    if (mapOpen && !mapWrap.hidden) drawMe();
    if (now - liftClock > 250) { liftClock = now; keepClearOfPrompts(); }
  });

  setMapOpen(mapOpen, false);
  syncBarHeight();
  applyVisibility();

  return {
    drive,
    dispose() {
      if (disposed) return;
      disposed = true;
      driver.stop();
      offDriver();
      offFrame();
      barObserver?.disconnect();
      mapObserver?.disconnect();
      window.removeEventListener('keydown', onKey, true);
      canvas.removeEventListener('pointerdown', interrupt, true);
      parent.removeEventListener('pointerdown', onHudPress, true);
      canvas.removeEventListener('wheel', interrupt, true);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      parent.style.removeProperty('--wt-nav-h');
      parent.style.removeProperty('--wt-nav-pad');
      mapWrap.remove(); bar.remove(); fade.remove();
    },
    debug: {
      driver,
      go,
      startTour,
      stop: () => driver.stop(),
      chips: () => chips,
      here: () => here,
      mapOpen: () => mapOpen,
      setMapOpen: (o) => setMapOpen(o),
      plan: (roomId) => {
        const spot = driver.spotIn(roomId);
        const leaves = d.doors.route.leaves();
        const route = spot ? findRoute(planGridOf(staticGrid(), leaves), ch.position, spot) : null;
        const cross = route ? firstCrossing(route.points, leaves.filter((l) => !isOpenEnough(l)).map((l) => l.door)) : null;
        return { spot, lengthM: route ? route.lengthM : null, door: cross?.door.id ?? null, leaves: leaves.map((l) => ({ id: l.door.id, pos: l.pos, max: l.door.maxPos, open: isOpenEnough(l) })) };
      },
      simulate: async (seconds, dt = 1 / 30) => {
        let t = 0;
        for (; t < seconds && !disposed; t += dt) {
          d.doors.update(dt);
          if (!drive(dt) && !driver.busy) break;
          for (let k = 0; k < 4; k++) await Promise.resolve();
        }
        return t;
      },
      audit: (on) => {
        auditOn = on;
        if (on) { audit.frames = 0; audit.bad = 0; audit.samples = []; }
        audit.visited = driver.tour?.visited ?? [];
        return audit;
      },
    },
  };
}
