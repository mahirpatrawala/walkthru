// Plan: a clean, large 2D floor plan of the current space, filling the view. It reuses the start page's drawing (`planSvg`: floors, walls with the doorways cut out,
// windows, room names with the sizes the scene carries, worded as everywhere: an unmeasured size says "not measured") and adds what a plan reader wants:
// door swings, furniture outlines, overall dimensions where the drawing gives them (never invented), a north arrow when the scene knows north, the walker's
// dot with the way they look, pan and zoom, and a tap on a room to go there. Light and dark follow the chrome (views.css). Pure DOM and SVG: while it covers
// the 3D view the frame loop rests.
import { planSvg } from '../../start/plan-svg';
import { resolveDoors } from '../../core/doors';
import { boxCorners } from '../../core/geometry';
import { formatLength } from '../../core/units';
import { conePath } from '../nav/nav-model';
import type { RoomChip } from '../nav/nav-model';
import type { FurnitureItem, Layout, Vec2 } from '../../types';
import { layoutBounds } from './framing';

const SVG_NS = 'http://www.w3.org/2000/svg';
const n3 = (n: number): string => (Math.round(n * 1000) / 1000).toString();
const pts = (p: readonly Vec2[]): string => p.map((q) => `${n3(q.x)},${n3(q.z)}`).join(' ');

export interface PlanViewDeps {
  /** the plan is added to this element (it covers it) */
  host: HTMLElement;
  layout: Layout;
  /** rooms whose size was not measured: id -> reason */
  unverified: Record<string, string>;
  chips: readonly RoomChip[];
  items(): FurnitureItem[];
  onItemsChange(cb: () => void): () => void;
  walker: { position(): Vec2; headingDeg(): number };
  /** compass bearing of the plan's -z direction, when the scene knows it */
  northDeg: number | undefined;
  /** rectangles of water (a pool area) */
  water: { x0: number; z0: number; x1: number; z1: number }[];
  onRoomTap(roomId: string): void;
  onEscape(): void;
  /** the Views (SPEC 2.10): a dot for every view, the current one ringed; a tap on a dot goes there */
  viewMarks?: { list(): readonly { id: string; x: number; z: number; label: string }[]; current(): string | null; pick(id: string): void };
}

export interface PlanViewApi {
  readonly root: HTMLElement;
  /** 0..1: how far it covers the 3D view (it is also the opacity); at 0 it is out of the way of every pointer */
  setAmount(a: number): void;
  /** the walker moved or turned: redraw their dot (call about ten times a second while shown) */
  update(): void;
  /** fit the whole plan */
  fit(): void;
  debug(): { w: number; cx: number; cz: number; fitW: number; dimensions: boolean; north: boolean; doors: number; furniture: number };
  dispose(): void;
}

/** True when every size in the drawing is the drawing's own: only then are overall dimensions shown. */
export function dimensionsShown(layout: Pick<Layout, 'scaleSource' | 'rooms'>, unverified: Record<string, string>): boolean {
  return layout.scaleSource === 'plan-dimensions' && layout.rooms.length > 0 && !layout.rooms.some((r) => r.partial) && Object.keys(unverified).length === 0;
}

export function createPlanView(d: PlanViewDeps): PlanViewApi {
  const { layout } = d;
  const root = document.createElement('div');
  root.className = 'wt-views-plan';
  root.dataset.testid = 'views-plan';
  root.dataset.ui = '1';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Floor plan');
  root.hidden = true;
  d.host.appendChild(root);

  const goable = new Set(d.chips.filter((c) => c.goable).map((c) => c.id));
  const pic = planSvg(layout, d.unverified, {
    idPrefix: 'wtplanview',
    ...(goable.size >= 2 ? { selectable: goable } : {}),
    selectedId: null,
    title: 'Floor plan of this space. Your place and the way you look are marked. Tap a room to walk there.',
  });
  root.insertAdjacentHTML('beforeend', pic.svg); // planSvg escapes every label it writes
  const svg = root.querySelector('svg') as SVGSVGElement;
  svg.classList.add('wt-views-plan-svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.removeAttribute('role');
  svg.setAttribute('focusable', 'false');
  const vb0 = svg.viewBox.baseVal;
  const plan = { x: vb0.x, z: vb0.y, w: vb0.width, h: vb0.height };
  const bounds = layoutBounds(layout);

  const g = (cls: string): SVGGElement => { const e = document.createElementNS(SVG_NS, 'g'); e.setAttribute('class', cls); return e; };
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent?: Element): SVGElementTagNameMap[K] => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent?.appendChild(e);
    return e;
  };
  const firstWall = svg.querySelector('.plan-wall, .plan-sill, .plan-rail');
  const firstLabel = svg.querySelector('text.plan-label');

  // water of a pool area, under the walls
  for (const w of d.water) {
    const poly = el('polygon', { class: 'wt-views-water', points: pts([{ x: w.x0, z: w.z0 }, { x: w.x1, z: w.z0 }, { x: w.x1, z: w.z1 }, { x: w.x0, z: w.z1 }]) });
    if (firstWall) firstWall.before(poly); else svg.appendChild(poly);
  }

  // furniture outlines, above the floors and under the walls
  const furn = g('wt-views-furn');
  furn.setAttribute('pointer-events', 'none');
  if (firstWall) firstWall.before(furn); else svg.appendChild(furn);
  const drawFurniture = (): number => {
    furn.replaceChildren();
    let n = 0;
    for (const it of d.items()) {
      el('polygon', { class: `wt-views-piece kind-${it.kind}`, points: pts(boxCorners(it.box)) }, furn);
      n++;
    }
    return n;
  };
  let furnCount = drawFurniture();
  const offItems = d.onItemsChange(() => { furnCount = drawFurniture(); });

  // door swings: the leaf at a quarter turn and the arc it sweeps, thin
  const swings = g('wt-views-swings');
  swings.setAttribute('pointer-events', 'none');
  if (firstLabel) firstLabel.before(swings); else svg.appendChild(swings);
  let doorCount = 0;
  for (const door of resolveDoors(layout)) {
    if (door.kind !== 'hinged') continue;
    const h = door.hingeAt, w = door.panelWidthM;
    const closedEnd = { x: h.x + door.closedDir.x * w, z: h.z + door.closedDir.z * w };
    const openEnd = { x: h.x + door.swingNormal.x * w, z: h.z + door.swingNormal.z * w };
    const cross = door.closedDir.x * door.swingNormal.z - door.closedDir.z * door.swingNormal.x;
    el('line', { class: 'wt-views-leaf', x1: n3(h.x), y1: n3(h.z), x2: n3(openEnd.x), y2: n3(openEnd.z) }, swings);
    el('path', { class: 'wt-views-arc', d: `M${n3(closedEnd.x)},${n3(closedEnd.z)}A${n3(w)},${n3(w)} 0 0 ${cross > 0 ? 1 : 0} ${n3(openEnd.x)},${n3(openEnd.z)}` }, swings);
    doorCount++;
  }

  // overall dimensions (only where the drawing gave them) and the north arrow
  const decor = g('wt-views-decor');
  decor.setAttribute('pointer-events', 'none');
  svg.appendChild(decor);
  const showDims = !!bounds && dimensionsShown(layout, d.unverified);
  let dimTexts: SVGTextElement[] = [];
  if (showDims && bounds) {
    const off = 0.55;
    const x0 = bounds.x0 - 0.06, x1 = bounds.x1 + 0.06, z0 = bounds.z0 - 0.06, z1 = bounds.z1 + 0.06;
    const tick = 0.16;
    const line = (a: Vec2, b: Vec2): void => { el('line', { class: 'wt-views-dim', x1: n3(a.x), y1: n3(a.z), x2: n3(b.x), y2: n3(b.z) }, decor); };
    // across the top and down the left side
    line({ x: x0, z: z0 - off }, { x: x1, z: z0 - off }); line({ x: x0, z: z0 - off - tick }, { x: x0, z: z0 - off + tick }); line({ x: x1, z: z0 - off - tick }, { x: x1, z: z0 - off + tick });
    line({ x: x0 - off, z: z0 }, { x: x0 - off, z: z1 }); line({ x: x0 - off - tick, z: z0 }, { x: x0 - off + tick, z: z0 }); line({ x: x0 - off - tick, z: z1 }, { x: x0 - off + tick, z: z1 });
    const fs = Math.max(0.22, Math.min(0.42, Math.max(x1 - x0, z1 - z0) * 0.026));
    const t1 = el('text', { class: 'wt-views-dim-text', x: n3((x0 + x1) / 2), y: n3(z0 - off - 0.12), 'text-anchor': 'middle', 'font-size': n3(fs) }, decor);
    t1.textContent = formatLength(x1 - x0 - 0.12);
    const t2 = el('text', { class: 'wt-views-dim-text', x: n3(x0 - off - 0.12), y: n3((z0 + z1) / 2), 'text-anchor': 'middle', 'font-size': n3(fs), transform: `rotate(-90 ${n3(x0 - off - 0.12)} ${n3((z0 + z1) / 2)})` }, decor);
    t2.textContent = formatLength(z1 - z0 - 0.12);
    dimTexts = [t1, t2];
  }
  const north = el('g', { class: 'wt-views-north' }, undefined);
  svg.appendChild(north);
  const hasNorth = d.northDeg !== undefined && Number.isFinite(d.northDeg);
  el('path', { class: 'wt-views-north-arrow', d: 'M0,-1 L0.42,0.7 L0,0.38 L-0.42,0.7 Z' }, north);
  const nLabel = el('text', { class: 'wt-views-north-n', x: '0', y: '-1.18', 'text-anchor': 'middle' }, north);
  nLabel.textContent = 'N';
  north.setAttribute('visibility', hasNorth ? 'visible' : 'hidden');

  // the walker
  const live = g('wt-views-live');
  live.setAttribute('pointer-events', 'none');
  const cone = el('path', { class: 'wt-views-cone' }, live);
  const dot = el('circle', { class: 'wt-views-dot' }, live);
  const vps = g('wt-views-vps');
  svg.appendChild(vps);
  svg.appendChild(live);
  let vpSig = '';
  function drawVps(): void {
    const list = d.viewMarks?.list() ?? [];
    const cur = d.viewMarks?.current() ?? null;
    const sig = `${list.map((m) => m.id).join(',')}|${cur}|${pxPerM.toFixed(2)}`;
    if (sig === vpSig) return;
    vpSig = sig;
    vps.replaceChildren();
    for (const m of list) {
      const c = el('circle', { class: `wt-views-vp${m.id === cur ? ' is-current' : ''}`, cx: n3(m.x), cy: n3(m.z), r: n3(6 / pxPerM) }, vps);
      c.dataset.vp = m.id;
      c.style.strokeWidth = `${1.6 / pxPerM}px`;
      const t = el('title', {}, c);
      t.textContent = m.label;
    }
  }

  // ---- pan and zoom: the picture's viewBox follows (centre, visible width in metres)
  const view = { cx: plan.x + plan.w / 2, cz: plan.z + plan.h / 2, w: plan.w };
  let fitW = plan.w;
  const box = (): DOMRect => svg.getBoundingClientRect();
  const aspect = (): number => { const r = box(); return r.width > 0 && r.height > 0 ? r.width / r.height : 1.6; };
  const fitView = (): void => {
    const a = aspect();
    // the plan's own box, with room round it for the dimensions, the controls and the bar
    const needW = Math.max(plan.w * 1.04, plan.h * 1.04 * a);
    fitW = needW;
    view.cx = plan.x + plan.w / 2; view.cz = plan.z + plan.h / 2; view.w = needW;
    apply();
  };
  let pxPerM = 10;
  function apply(): void {
    const a = aspect();
    const h = view.w / a;
    svg.setAttribute('viewBox', `${n3(view.cx - view.w / 2)} ${n3(view.cz - h / 2)} ${n3(view.w)} ${n3(h)}`);
    const r = box();
    pxPerM = r.width > 0 ? r.width / view.w : 10;
    // things that keep one size on the screen
    dot.setAttribute('r', n3(7 / pxPerM));
    dot.style.strokeWidth = `${2 / pxPerM}px`;
    lastDrawn = null;
    drawMe();
    drawVps();
    // the north arrow sits in the bottom left corner of what is on screen (the top and the right are the chrome's)
    const s = 22 / pxPerM;
    const rot = hasNorth ? -(d.northDeg as number) : 0;
    north.setAttribute('transform', `translate(${n3(view.cx - view.w / 2 + 52 / pxPerM)} ${n3(view.cz + h / 2 - 84 / pxPerM)}) rotate(${n3(rot)}) scale(${n3(s)})`);
    for (const t of dimTexts) t.style.removeProperty('font-size');
  }
  let lastDrawn: { x: number; z: number; yaw: number } | null = null;
  function drawMe(): void {
    const p = d.walker.position();
    const yaw = d.walker.headingDeg();
    if (lastDrawn && Math.hypot(p.x - lastDrawn.x, p.z - lastDrawn.z) < 0.02 && Math.abs(yaw - lastDrawn.yaw) < 1) return;
    lastDrawn = { x: p.x, z: p.z, yaw };
    dot.setAttribute('cx', n3(p.x));
    dot.setAttribute('cy', n3(p.z));
    cone.setAttribute('d', conePath(p, yaw, 62 / pxPerM, 36));
  }

  const toPlan = (clientX: number, clientY: number): Vec2 => {
    const r = box();
    const h = view.w / aspect();
    return { x: view.cx - view.w / 2 + ((clientX - r.left) / Math.max(1, r.width)) * view.w, z: view.cz - h / 2 + ((clientY - r.top) / Math.max(1, r.height)) * h };
  };
  const clampView = (): void => {
    const minW = Math.max(2, plan.w * 0.07);
    view.w = Math.min(fitW * 1.5, Math.max(minW, view.w));
    const h = view.w / aspect();
    const mx = plan.w * 0.5 + view.w * 0.25, mz = plan.h * 0.5 + h * 0.25;
    view.cx = Math.min(plan.x + plan.w / 2 + mx, Math.max(plan.x + plan.w / 2 - mx, view.cx));
    view.cz = Math.min(plan.z + plan.h / 2 + mz, Math.max(plan.z + plan.h / 2 - mz, view.cz));
  };
  const zoomAt = (clientX: number, clientY: number, factor: number): void => {
    const before = toPlan(clientX, clientY);
    view.w /= factor;
    clampView();
    const after = toPlan(clientX, clientY);
    view.cx += before.x - after.x; view.cz += before.z - after.z;
    clampView();
    apply();
  };

  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t0: number; moved: boolean }>();
  let pinchDist = 0;
  root.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), moved: false });
    try { root.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  root.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > 8) p.moved = true;
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 8 && dist > 8) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinchDist);
      pinchDist = dist;
      return;
    }
    if (!p.moved) return;
    view.cx -= dx / pxPerM; view.cz -= dy / pxPerM;
    clampView();
    apply();
    root.classList.add('is-dragging');
  });
  const end = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    root.classList.remove('is-dragging');
    if (pointers.size < 2) pinchDist = 0;
    if (e.type === 'pointerup' && !p.moved && performance.now() - p.t0 < 500 && pointers.size === 0) tapAt(e);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 100;
    zoomAt(e.clientX, e.clientY, Math.exp((-e.deltaY / unit) * (e.ctrlKey ? 0.3 : 0.14)));
  }, { passive: false });
  root.addEventListener('dblclick', (e) => { if (!(e.target as Element).closest('button')) fitView(); });

  const tapAt = (e: PointerEvent): void => {
    // a View's dot first: the nearest within reach of the finger
    if (d.viewMarks) {
      const at = toPlan(e.clientX, e.clientY);
      let best: string | null = null, bestD = 16 / pxPerM;
      for (const m of d.viewMarks.list()) { const dd = Math.hypot(m.x - at.x, m.z - at.z); if (dd < bestD) { best = m.id; bestD = dd; } }
      if (best) { d.viewMarks.pick(best); return; }
    }
    const hit = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest?.('g[data-room]') as SVGGElement | null;
    const id = hit?.dataset.room ?? null;
    if (id && goable.has(id)) d.onRoomTap(id);
  };

  // ---- zoom buttons and the keys
  const ctl = document.createElement('div');
  ctl.className = 'wt-views-plan-ctl';
  const btn = (label: string, text: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label); b.title = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); b.blur(); });
    ctl.appendChild(b);
    return b;
  };
  const centre = (): { x: number; y: number } => { const r = box(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  btn('Zoom in', '+', () => { const c = centre(); zoomAt(c.x, c.y, 1.4); });
  btn('Zoom out', '−', () => { const c = centre(); zoomAt(c.x, c.y, 1 / 1.4); });
  btn('Fit the whole plan', '⤢', fitView);
  root.appendChild(ctl);
  const hint = document.createElement('div');
  hint.className = 'wt-views-plan-hint';
  hint.textContent = goable.size >= 2 ? 'Tap a room to walk there' : 'Drag to move, scroll to zoom';
  root.appendChild(hint);

  const onKey = (e: KeyboardEvent): void => {
    if (root.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.stopPropagation(); d.onEscape(); return; }
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'e', 'q', 'r', 'm', 'f', 'v', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (!root.hidden) { const keepW = view.w / fitW; fitView(); view.w = fitW * keepW; clampView(); apply(); } }) : null;
  ro?.observe(root);

  return {
    root,
    setAmount(a) {
      const was = root.hidden;
      root.hidden = a <= 0.001;
      root.style.opacity = a >= 0.999 ? '' : a.toFixed(3);
      root.style.pointerEvents = a >= 0.5 ? 'auto' : 'none';
      if (was && !root.hidden) fitView();
    },
    update() { if (!root.hidden) { drawMe(); drawVps(); } },
    fit: fitView,
    debug: () => ({ w: view.w, cx: view.cx, cz: view.cz, fitW, dimensions: showDims, north: hasNorth, doors: doorCount, furniture: furnCount }),
    dispose() {
      offItems();
      ro?.disconnect();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      root.remove();
    },
  };
}
