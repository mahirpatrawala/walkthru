// The walk's three navigation aids, mounted in the HUD of every space: a mini floor plan (where you stand, which way you look, the room you are
// in, tap a room to go there), a room bar (one chip per room with its size, the current one lit, tap to go) and a Tour button (an automatic
// walk through the home, room by room). The decisions are in pure modules (nav-model.ts, tour-plan.ts, grid-path.ts, driver.ts); this file
// is the DOM, the listeners and the three-side moves, and everything it makes goes away with `dispose()` (a building mounts one per space).
import { CHARACTER_RADIUS_M } from '../../types';
import type { Grid, Layout, Vec2 } from '../../types';
import { circleFree, nearestFree } from '../../core/grid-query';
import { roomAt } from '../../core/layout-geom';
import { planSvg } from '../../start/plan-svg';
import type { FacingReading } from '../../core/facing';
import type { NorthRef } from '../../core/north';
import { dirWord, edgeMarks, tagAt, zoneWord } from '../directions/model';
import type { Doors } from '../doors';
import type { BuyerContext } from '../context';
import { el } from '../hud';
import { UNITS_EVENT, areaIn } from '../identity';
import { storageGet, storageSet } from '../store';
import type { FurnitureStoreImpl, StorageLike, UnverifiedRooms } from '../store';
import { Driver, TOUR_PITCH_DEG } from './driver';
import type { TourOptions } from './driver';
import type { GoResult, TourState } from './driver';
import { findRoute } from './grid-path';
import { firstCrossing, isOpenEnough, planGridOf } from './door-route';
import { liveMark, chipCaption, conePath, currentRoomId, liftAbove, roomChips, roomNear } from './nav-model';
import type { Rect, RoomChip } from './nav-model';
import { skippedNote } from './tour-plan';
import './nav.css';

const DOTS = ['#F0906F', '#8FBFC4', '#E6C072', '#A7C99B', '#B7A2D6', '#E59AA6'];
const MAP_KEY = 'walkthru:nav:map-collapsed';
/** the plan card comes in small; a press on its corner button makes it large, and the choice is kept */
const MAP_BIG_KEY = 'walkthru:nav:map-big';
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
  /** which way north lies and what faces where (SPEC 22.1): the plan then carries N, E, S and W and the facing of the door and the balconies. Absent: no marks. */
  north?: NorthRef | null;
  facing?: FacingReading | null;
}

export interface NavAudit { frames: number; bad: number; visited: string[]; samples: Vec2[] }

export interface MountedNav {
  /** starts a tour (the idle display's loop: `{ loop: true }`) */
  startTour(opts?: TourOptions): Promise<TourState>;
  /** called from the frame loop where the keys and the thumb are read: true when the auto-walk moved the walker this frame (they are not read) */
  drive(dt: number): boolean;
  dispose(): void;
  debug: {
    driver: Driver;
    go(roomId: string): Promise<GoResult>;
    startTour(opts?: TourOptions): Promise<TourState>;
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
  grow: ICON('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  shrink: ICON('<path d="M19 11h-6V5M5 13h6v6M13 11l7-7M11 13l-7 7"/>'),
  chevUp: ICON('<path d="M6 15l6-6 6 6"/>'),
  next: ICON('<path d="M5 12h14M13 6l6 6-6 6"/>'),
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

  // what a room is about: its bed, else its sofa, table, counter, wardrobe (the first of the best kind), where it stands
  const FOCAL_RANK: Record<string, number> = { bed: 5, sofa: 4, dining: 3, counter: 2, wardrobe: 1 };
  function focalOf(roomId: string): Vec2 | null {
    let best: { rank: number; at: Vec2 } | null = null;
    for (const it of d.store.all()) {
      const rank = FOCAL_RANK[it.kind] ?? 0;
      if (rank === 0 || (best && rank <= best.rank)) continue;
      const at = { x: it.box.cx, z: it.box.cz };
      if (roomAt(layout, at)?.id === roomId) best = { rank, at };
    }
    return best?.at ?? null;
  }

  // the tour's own camera (the camera director of src/engine/camera.ts): at eye height, the body hidden, a 75 degree lens and a few degrees down. It takes over
  // from wherever the camera is by gliding (never a cut) and gives the walker's own view back the same way when the tour ends or is interrupted.
  const camDir = ctx.camera as unknown as {
    driveTo(p: { x: number; y: number; z: number }, look: { x: number; y: number; z: number }, smooth?: number): void;
    releaseDrive(smooth?: number): void; setBodyHidden(h: boolean | null): void; setFov(deg: number | null, smooth?: number): void;
  };
  let presenting = false;
  let presentT = 0;
  function enterPresentation(): void {
    if (presenting) return;
    presenting = true; presentT = 0;
    camDir.setBodyHidden(true);
    camDir.setFov(75, 1.0);
  }
  function exitPresentation(): void {
    if (!presenting) return;
    presenting = false;
    camDir.releaseDrive(0.9);
    camDir.setBodyHidden(null);
    camDir.setFov(null, 0.9);
  }
  /** each frame of a tour: the camera is told where the eyes are and where they look (heading from the glide, a few degrees down) */
  function poseCamera(dt: number): void {
    if (!presenting) return;
    const eye = { x: ch.position.x, y: 0.93 * ch.heightM, z: ch.position.z };
    const yaw = (ctx.camera.yawDeg * Math.PI) / 180, pitch = (TOUR_PITCH_DEG * Math.PI) / 180;
    const look = { x: eye.x + Math.sin(yaw) * Math.cos(pitch) * 5, y: eye.y - Math.sin(pitch) * 5, z: eye.z + Math.cos(yaw) * Math.cos(pitch) * 5 };
    presentT += dt;
    camDir.driveTo(eye, look, presentT < 1.2 ? 0.7 : 0.14); // a slow take-over, then close behind the glide
  }

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
    focal: (roomId) => focalOf(roomId),
    presentation: { enter: enterPresentation, exit: exitPresentation },
  });

  // ---------------------------------------------------------------- the minimap

  const mapWrap = el('aside', 'wt-nav-map', undefined, parent);
  mapWrap.dataset.ui = '1';
  mapWrap.dataset.testid = 'nav-map';
  mapWrap.dataset.zone = 'map';
  mapWrap.setAttribute('aria-label', 'Plan of this space');
  mapWrap.classList.add('wt-glass');
  const mapHead = el('div', 'wt-nav-map-head', undefined, mapWrap);
  el('span', 'wt-nav-map-title', 'Floor plan', mapHead);
  const mapBody = el('div', 'wt-nav-map-body', undefined, mapWrap);
  mapBody.id = `wt-nav-map-${Math.random().toString(36).slice(2, 7)}`;
  const mapToggle = el('button', 'wt-nav-map-toggle', undefined, mapHead);
  mapToggle.type = 'button';
  mapToggle.dataset.testid = 'nav-map-toggle';
  mapToggle.setAttribute('aria-controls', mapBody.id);
  // the card only shows when reached for (src/buyer/chrome.ts), so it always opens with its plan; the corner button sizes it
  let mapOpen = true;
  let mapBig = storageGet(d.storage, MAP_BIG_KEY) === '1';

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
  mapWrap.style.setProperty('--wt-nav-aspect', String(plan.aspect));
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
  const halo = document.createElementNS(SVG_NS, 'circle');
  halo.setAttribute('class', 'wt-nav-halo');
  live.append(cone, halo, dot);
  svg.appendChild(live);
  const roomGroups = new Map<string, SVGGElement>();
  svg.querySelectorAll<SVGGElement>('g[data-room]').forEach((g) => roomGroups.set(g.dataset.room as string, g));

  // which way is which (SPEC 22.1): N, E, S and W on the edge of the plan where they really lie, and the facing of the main door and each balcony.
  // Only with a north. The letters are text at a fixed size on screen (set in `measure`), so the plan itself is untouched.
  const compassTexts: { dir: 'N' | 'E' | 'S' | 'W'; t: SVGTextElement }[] = [];
  const faceTags: { at: Vec2; out: Vec2 | null; t: SVGTextElement }[] = [];
  if (d.north) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'wt-nav-dirs');
    g.setAttribute('pointer-events', 'none');
    g.dataset.testid = 'nav-map-compass';
    for (const dir of ['N', 'E', 'S', 'W'] as const) {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('class', `wt-nav-dir${dir === 'N' ? ' is-n' : ''}`);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
      t.textContent = dir;
      g.appendChild(t); compassTexts.push({ dir, t });
    }
    const f = d.facing;
    if (f?.mainDoor) {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('class', 'wt-nav-face'); t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
      t.textContent = `Door ${f.mainDoor.facing}`;
      g.appendChild(t); faceTags.push({ at: f.mainDoor.at, out: f.mainDoor.out, t });
    }
    for (const r of f?.rooms ?? []) {
      if (r.roomType !== 'balcony' || !r.facing) continue;
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('class', 'wt-nav-face'); t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
      t.textContent = r.facing;
      g.appendChild(t); faceTags.push({ at: r.centre, out: null, t });
    }
    // a room's place in words, for a screen reader and a hover
    for (const r of f?.rooms ?? []) {
      const rg = roomGroups.get(r.roomId);
      if (rg) rg.setAttribute('aria-label', `${rg.getAttribute('aria-label') ?? r.label}. ${r.zone === 'C' ? 'In the centre of the flat' : `In the ${zoneWord(r.zone)} of the flat`}${r.facing ? `, looks ${dirWord(r.facing)}` : ''}`);
    }
    svg.appendChild(g);
  }
  const placeDirections = (): void => {
    if (!d.north) return;
    const fs = Math.min(vb.width, vb.height) * 0.16, px = Math.min(fs, 11 / pxPerM);
    for (const { t } of compassTexts) t.style.fontSize = `${px.toFixed(4)}px`;
    for (const { t } of faceTags) t.style.fontSize = `${(px * 0.82).toFixed(4)}px`;
    const marks = edgeMarks(d.north, { x: vb.x, y: vb.y, width: vb.width, height: vb.height }, px * 0.75);
    for (const m of marks) { const c = compassTexts.find((x) => x.dir === m.dir); if (c) { c.t.setAttribute('x', m.x.toFixed(3)); c.t.setAttribute('y', m.z.toFixed(3)); } }
    for (const f of faceTags) {
      const p = f.out ? tagAt(f.at, f.out, px * 1.6) : f.at;
      f.t.setAttribute('x', p.x.toFixed(3)); f.t.setAttribute('y', p.z.toFixed(3));
    }
  };

  const setMapOpen = (open: boolean, remember = true): void => {
    mapOpen = open;
    mapWrap.classList.toggle('is-collapsed', !open);
    mapBody.hidden = !open;
    if (remember) storageSet(d.storage, MAP_KEY, open ? '0' : '1');
    lastDrawn = null;
    measure();
  };
  const setMapBig = (big: boolean, remember = true): void => {
    mapBig = big;
    mapWrap.classList.toggle('is-big', big);
    mapToggle.innerHTML = big ? ICONS.shrink : ICONS.grow;
    mapToggle.setAttribute('aria-expanded', String(big));
    const name = big ? 'Make the floor plan smaller' : 'Make the floor plan larger';
    mapToggle.setAttribute('aria-label', name);
    mapToggle.title = name;
    if (remember) storageSet(d.storage, MAP_BIG_KEY, big ? '1' : '0');
    lastDrawn = null;
    later(() => measure(), 260);
    measure();
  };
  mapToggle.addEventListener('click', (e) => { e.stopPropagation(); setMapBig(!mapBig); mapToggle.blur(); });

  const planPoint = (e: MouseEvent): Vec2 | null => {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(m.inverse());
    return { x: q.x, z: q.y };
  };
  let pxPerM = 10;
  let coneLen = CONE_PX / 10;
  const measure = (): void => {
    const r = svg.getBoundingClientRect();
    // the layout width, not the box on screen: a card that is mid-way through a scale or fade must not shrink the plan's scale, and a collapsed one has none
    const w = svg.clientWidth || r.width;
    if (w > 0 && vb.width > 0 && vb.height > 0) pxPerM = w / vb.width;
    const m = liveMark(pxPerM, vb.width, vb.height, DOT_PX, CONE_PX);
    dot.setAttribute('r', m.r.toFixed(4));
    halo.setAttribute('r', m.halo.toFixed(4));
    dot.style.strokeWidth = `${m.stroke.toFixed(4)}px`;
    coneLen = m.cone;
    placeDirections();
    lastDrawn = null;
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
      // a press leaves no focus on the plan (keyboard focus keeps its thin stroke; a pointer's click does not need one)
      if (e.detail > 0 && document.activeElement instanceof SVGElement) (document.activeElement as unknown as HTMLElement).blur?.();
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
  const tourRow = el('div', 'wt-nav-tour wt-glass', undefined, bar);
  tourRow.dataset.testid = 'nav-tour-row';
  tourRow.hidden = true;
  const tourTop = el('div', 'wt-nav-tour-top', undefined, tourRow);
  const tourCount = el('span', 'wt-nav-tour-count', undefined, tourTop);
  const tourBtns = el('div', 'wt-nav-tour-btns', undefined, tourTop);
  const tourPause = el('button', 'wt-nav-tour-btn', undefined, tourBtns);
  tourPause.type = 'button';
  tourPause.dataset.testid = 'nav-tour-pause';
  const tourNext = el('button', 'wt-nav-tour-btn', undefined, tourBtns);
  tourNext.type = 'button';
  tourNext.dataset.testid = 'nav-tour-next';
  tourNext.innerHTML = ICONS.next;
  tourNext.setAttribute('aria-label', 'Next room');
  const tourStop = el('button', 'wt-nav-tour-btn is-stop', undefined, tourBtns);
  tourStop.type = 'button';
  tourStop.dataset.testid = 'nav-tour-stop';
  const tourText = el('div', 'wt-nav-tour-text', undefined, tourRow);
  tourText.setAttribute('role', 'status');
  tourText.setAttribute('aria-live', 'polite');
  const tourTitle = el('div', 'wt-nav-tour-title', undefined, tourText);
  tourTitle.dataset.testid = 'nav-tour-title';
  const tourSub = el('div', 'wt-nav-tour-sub', undefined, tourText);
  const tourProg = el('div', 'wt-nav-tour-prog', undefined, tourRow);
  const tourFill = el('i', undefined, undefined, tourProg);

  const row = el('div', 'wt-nav-row', undefined, bar);
  row.dataset.zone = 'bottom';
  // the Tour control lives in the tools bar at the top (first tool); it reads Stop while a tour runs
  const tourBtn = el('button', 'wt-btn wt-tool wt-nav-tourbtn', undefined);
  tourBtn.type = 'button';
  tourBtn.dataset.ui = '1';
  tourBtn.dataset.btn = 'tour';
  tourBtn.dataset.testid = 'nav-tour-btn';
  const tourBtnIcon = el('span', 'wt-nav-tour-ico', undefined, tourBtn);
  const tourBtnLabel = el('span', 'wt-tool-label', 'Tour', tourBtn);
  tourBtnIcon.innerHTML = ICONS.play;
  tourBtn.setAttribute('aria-label', 'Take a tour of this home, room by room');
  tourBtn.hidden = !multi;
  const toolsHost = parent.querySelector<HTMLElement>('.wt-tools');
  if (toolsHost) toolsHost.insertBefore(tourBtn, toolsHost.firstChild); else row.appendChild(tourBtn);
  // the strip: a narrow pill of glass in the centre, about five rooms wide, the room you are in in the middle, the ends fading out
  const strip = el('div', 'wt-nav-strip', undefined, row);
  const scroller = el('div', 'wt-nav-chips', undefined, strip);
  scroller.setAttribute('role', 'group');
  scroller.setAttribute('aria-label', 'Rooms');
  scroller.dataset.testid = 'nav-chips';
  const chipEls = new Map<string, HTMLButtonElement>();
  const areaEls: [HTMLElement, string][] = [];
  // one unit of area at a time (the identity card's switch)
  const onUnits = (): void => { const u = d.ctx.hud.units?.() ?? 'sqft'; for (const [e, text] of areaEls) e.textContent = areaIn(text, u); };
  window.addEventListener(UNITS_EVENT, onUnits);
  for (const c of chips) {
    const b = el('button', 'wt-nav-chip', undefined, scroller);
    b.type = 'button';
    b.dataset.room = c.id;
    b.setAttribute('aria-label', c.goable ? `Go to ${c.title}` : `${c.title}. Only partly on the drawing, so you cannot walk there.`);
    const dotEl = el('span', 'wt-nav-chip-dot', undefined, b);
    dotEl.style.setProperty('--dot', DOTS[chips.indexOf(c) % DOTS.length]);
    el('span', 'wt-nav-chip-name', c.label, b);
    const areaEl = el('span', 'wt-nav-chip-area', areaIn(c.area, d.ctx.hud.units?.() ?? 'sqft'), b);
    areaEls.push([areaEl, c.area]);
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
    tourBtn.classList.toggle('is-running', !!t?.active);
    tourBtnIcon.innerHTML = t?.active ? ICONS.stop : ICONS.play;
    tourBtnLabel.textContent = t?.active ? 'Stop' : 'Tour';
    tourBtn.setAttribute('aria-label', t?.active ? 'Stop the tour' : 'Take a tour of this home, room by room');
    if (!t || !show) { syncBarHeight(); return; }
    const chip = t.roomId ? chipById.get(t.roomId) : null;
    if (t.active) {
      tourCount.textContent = t.total > 0 ? `${Math.max(1, t.index)} OF ${t.total}` : 'TOUR';
      tourTitle.textContent = t.phase === 'looking' && chip ? chip.label
        : t.phase === 'returning' ? 'Back to where you started'
          : t.roomLabel ? t.roomLabel : 'Starting the tour';
      tourSub.textContent = t.paused ? 'Paused' : t.phase === 'looking' && chip ? areaIn(chip.area, d.ctx.hud.units?.() ?? 'sqft') : 'On the way';
      tourPause.innerHTML = t.paused ? ICONS.play : ICONS.pause;
      tourPause.setAttribute('aria-label', t.paused ? 'Resume the tour' : 'Pause the tour');
      tourPause.hidden = false;
      tourNext.hidden = false;
      tourStop.innerHTML = ICONS.close;
      tourStop.setAttribute('aria-label', 'Stop the tour');
    } else {
      tourCount.textContent = 'TOUR';
      tourTitle.textContent = 'Tour finished';
      tourSub.textContent = skippedNote(t.skipped) ?? `You saw ${t.visited.length} ${t.visited.length === 1 ? 'room' : 'rooms'} and you are back where you started.`;
      tourPause.hidden = true;
      tourNext.hidden = true;
      tourStop.innerHTML = ICONS.close;
      tourStop.setAttribute('aria-label', 'Close');
    }
    tourFill.style.width = `${t.phase === 'done' ? 100 : Math.round(100 * driver.dwellProgress)}%`;
    syncBarHeight();
  };
  const offDriver = driver.onChange(renderTour);
  tourPause.addEventListener('click', (e) => { e.stopPropagation(); if (driver.tour?.paused) driver.resume(); else driver.pause(); tourPause.blur(); });
  tourStop.addEventListener('click', (e) => {
    e.stopPropagation();
    if (driver.touring) driver.stop(); else { noteUntil = 0; renderTour(); }
    tourStop.blur();
  });
  tourBtn.addEventListener('click', (e) => { e.stopPropagation(); if (driver.touring) driver.stop(); else void startTour(); tourBtn.blur(); });
  tourNext.addEventListener('click', (e) => { e.stopPropagation(); driver.next(); tourNext.blur(); });

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
  async function startTour(opts: TourOptions = {}): Promise<TourState> {
    if (!allowed() || driver.touring) return driver.tour ?? ({ active: false } as TourState);
    await standUp();
    noteUntil = 0;
    const done = await driver.startTour(opts);
    if (!disposed && done.phase === 'done') { noteUntil = performance.now() + DONE_NOTE_MS; renderTour(); later(renderTour, DONE_NOTE_MS + 50); }
    return done;
  }

  // any input of the buyer's own ends the auto-walk where they stand: a key, a drag or a tap on the 3D view, the wheel
  const interrupt = (): void => { if (driver.busy) driver.stop(); };
  const onKey = (e: KeyboardEvent): void => {
    if (!driver.busy) return;
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Tab') return;
    if ((e.target as Element | null)?.closest?.('.wt-nav-bar, .wt-nav-map, .wt-nav-tourbtn')) return; // keys inside the aids are the aids' own
    interrupt();
  };
  window.addEventListener('keydown', onKey, true);
  const canvas = ctx.viewer.canvas;
  canvas.addEventListener('pointerdown', interrupt, true);
  // a press on anything else of the HUD (the Open door pill, the round buttons) is the buyer's own doing too; the aids' own controls are not
  const onHudPress = (e: Event): void => { if (!(e.target as Element | null)?.closest?.('.wt-nav-bar, .wt-nav-map, .wt-nav-tourbtn')) interrupt(); };
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
    halo.setAttribute('cx', p.x.toFixed(3));
    halo.setAttribute('cy', p.z.toFixed(3));
    cone.setAttribute('d', conePath(p, yaw, coneLen));
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
    poseCamera(dt);
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
    if (driver.touring) renderTour();
    setHere(currentRoomId(layout, ch.position, here));
    if (mapOpen && !mapWrap.hidden) drawMe();
    if (now - liftClock > 250) { liftClock = now; keepClearOfPrompts(); }
  });

  setMapOpen(mapOpen, false);
  setMapBig(mapBig, false);
  syncBarHeight();
  applyVisibility();

  return {
    drive,
    startTour,
    dispose() {
      if (disposed) return;
      disposed = true;
      driver.stop();
      offDriver();
      offFrame();
      barObserver?.disconnect();
      mapObserver?.disconnect();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener(UNITS_EVENT, onUnits);
      canvas.removeEventListener('pointerdown', interrupt, true);
      parent.removeEventListener('pointerdown', onHudPress, true);
      canvas.removeEventListener('wheel', interrupt, true);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      parent.style.removeProperty('--wt-nav-h');
      parent.style.removeProperty('--wt-nav-pad');
      mapWrap.remove(); bar.remove(); fade.remove(); tourBtn.remove();
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
