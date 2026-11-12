// Owned by C5. The plan canvas (SPEC 2.2): a true top-down 2D view of the draft with pan (right drag, middle drag, space
// + drag, two fingers) and zoom (wheel, pinch). Draws the underlay image, the metric grid, rooms by type, wall thickness
// from computeWallPieces, edges by kind, openings, furniture boxes and the spawn arrow. Tools get pointer events in world
// metres; steps add their own drawing through addLayer.
import type { Px, PropertyFile, RoomType, Vec2 } from '../types';
import { boxCorners, polygonArea } from '../core/geometry';
import { computeEdgeFrames, computeWallPieces, pieceRect } from '../core/layout-geom';
import { formatArea } from '../core/units';
import type { PlanCanvas, PlanTool, Selection } from './context';
import { edgePoint, edgeLength } from './plan-helpers';

export interface UnderlayPlacement { pxPerM: number; originPx: Px; opacity?: number }

export interface PlanCanvasImpl extends PlanCanvas {
  readonly el: HTMLCanvasElement;
  /** schedule a repaint without recomputing anything else (cheap enough to call on every pointer move) */
  redraw(): void;
  /** frame the plan image, else the rooms, else a 12 m square */
  fit(): void;
  setUnderlayPlacement(placement: UnderlayPlacement | null): void;
  /** layers added between begin and end are removed at end, so a step cannot leak drawing into the next one */
  beginSession(): void;
  endSession(): void;
  view(): { scale: number; ox: number; oz: number };
  destroy(): void;
}

const ROOM_FILL: Record<RoomType, string> = {
  bedroom: '#9ec5f0', living: '#f2c38b', kitchen: '#f0a8a8', bathroom: '#8fd9c0', balcony: '#b7e08a', other: '#cfcfd8',
};
const MIN_SCALE = 4;
const MAX_SCALE = 3000;

export function createPlanCanvas(
  container: HTMLElement,
  getDraft: () => PropertyFile,
  getSelection: () => Selection,
): PlanCanvasImpl {
  const el = document.createElement('canvas');
  el.className = 'plan-canvas';
  el.style.touchAction = 'none';
  el.tabIndex = 0;
  container.appendChild(el);
  const g = el.getContext('2d')!;

  let scale = 60;
  let ox = 40;
  let oz = 40;
  let tool: PlanTool | null = null;
  let img: CanvasImageSource | null = null;
  let placement: UnderlayPlacement | null = null;
  const layers = new Set<(g: CanvasRenderingContext2D, c: PlanCanvas) => void>();
  let session: Set<(g: CanvasRenderingContext2D, c: PlanCanvas) => void> | null = null;
  let raf = 0;
  let cssW = 1;
  let cssH = 1;

  // ---------------------------------------------------------------- sizing and transforms

  const resize = (): void => {
    const r = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cssW = Math.max(1, r.width);
    cssH = Math.max(1, r.height);
    el.style.width = `${cssW}px`;
    el.style.height = `${cssH}px`;
    el.width = Math.round(cssW * dpr);
    el.height = Math.round(cssH * dpr);
    api.redraw();
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(container);

  const toScreen = (v: Vec2): Px => ({ x: ox + v.x * scale, y: oz + v.z * scale });
  const toWorld = (cx: number, cy: number): Vec2 => {
    const r = el.getBoundingClientRect();
    return { x: (cx - r.left - ox) / scale, z: (cy - r.top - oz) / scale };
  };

  // ---------------------------------------------------------------- drawing

  function drawGrid(): void {
    const major = scale; // 1 m
    if (major < 6) return;
    const x0 = -ox / scale;
    const z0 = -oz / scale;
    const x1 = (cssW - ox) / scale;
    const z1 = (cssH - oz) / scale;
    const line = (a: Px, b: Px): void => { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); };
    if (scale >= 24) {
      g.beginPath();
      g.strokeStyle = 'rgba(120,130,150,0.18)';
      g.lineWidth = 1;
      for (let x = Math.floor(x0 * 2) / 2; x <= x1; x += 0.5) line(toScreen({ x, z: z0 }), toScreen({ x, z: z1 }));
      for (let z = Math.floor(z0 * 2) / 2; z <= z1; z += 0.5) line(toScreen({ x: x0, z }), toScreen({ x: x1, z }));
      g.stroke();
    }
    g.beginPath();
    g.strokeStyle = 'rgba(90,100,125,0.38)';
    g.lineWidth = 1;
    for (let x = Math.floor(x0); x <= x1; x += 1) line(toScreen({ x, z: z0 }), toScreen({ x, z: z1 }));
    for (let z = Math.floor(z0); z <= z1; z += 1) line(toScreen({ x: x0, z }), toScreen({ x: x1, z }));
    g.stroke();
    // origin cross
    g.beginPath();
    g.strokeStyle = 'rgba(214,69,69,0.55)';
    line(toScreen({ x: 0, z: z0 }), toScreen({ x: 0, z: z1 }));
    line(toScreen({ x: x0, z: 0 }), toScreen({ x: x1, z: 0 }));
    g.stroke();
  }

  function drawUnderlay(): void {
    if (!img || !placement) return;
    const w = (img as { width?: number; naturalWidth?: number }).naturalWidth || (img as { width?: number }).width || 1000;
    const h = (img as { height?: number; naturalHeight?: number }).naturalHeight || (img as { height?: number }).height || 1000;
    if (!w || !h) return;
    const tl = toScreen({ x: -placement.originPx.x / placement.pxPerM, z: -placement.originPx.y / placement.pxPerM });
    const k = scale / placement.pxPerM;
    g.save();
    g.globalAlpha = placement.opacity ?? 1;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, tl.x, tl.y, w * k, h * k);
    g.restore();
  }

  function drawPoly(pts: Vec2[]): void {
    g.beginPath();
    pts.forEach((p, i) => {
      const s = toScreen(p);
      if (i === 0) g.moveTo(s.x, s.y); else g.lineTo(s.x, s.y);
    });
    g.closePath();
  }

  function draw(): void {
    raf = 0;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    g.fillStyle = '#fbfbfc';
    g.fillRect(0, 0, cssW, cssH);
    const draft = getDraft();
    const lay = draft.layout;
    const sel = getSelection();

    drawUnderlay();
    if (!img) drawGrid();

    const hasImg = !!img && !!placement;
    // room fills
    for (const room of lay.rooms) {
      if (room.polygon.length < 3) continue;
      drawPoly(room.polygon);
      g.fillStyle = ROOM_FILL[room.roomType] + (hasImg ? '88' : 'cc');
      g.fill();
    }

    // wall thickness, from the same pieces the shell and the grid use
    try {
      const frames = computeEdgeFrames(lay);
      const frameOf = new Map(frames.map((f) => [`${f.roomId}:${f.edge}`, f] as const));
      for (const piece of computeWallPieces(lay)) {
        if (piece.y0 > 0.2) continue;
        const f = frameOf.get(`${piece.roomId}:${piece.edge}`);
        if (!f) continue;
        drawPoly(pieceRect(f, piece));
        g.fillStyle = piece.kind === 'railing' ? '#8a8f99' : piece.y1 < lay.wallHeightM - 0.01 ? '#7ea6d4' : '#33363d';
        g.fill();
      }
    } catch {
      // an unfinished layout can fail geometry; the outlines below still draw
    }

    // edge lines by kind
    for (const room of lay.rooms) {
      const n = room.polygon.length;
      for (let i = 0; i < n && n >= 3; i++) {
        const a = toScreen(room.polygon[i]);
        const b = toScreen(room.polygon[(i + 1) % n]);
        const kind = room.edges[i] ?? 'wall';
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.setLineDash(kind === 'railing' ? [7, 4] : kind === 'none' ? [2, 5] : []);
        g.lineWidth = room.id === sel.roomId ? 2.5 : 1.25;
        g.strokeStyle = kind === 'railing' ? '#c0392b' : kind === 'none' ? '#8a8f99' : room.id === sel.roomId ? '#1d4ed8' : '#202228';
        g.stroke();
        g.setLineDash([]);
      }
    }

    // openings
    for (const o of lay.openings) {
      const room = lay.rooms.find((r) => r.id === o.roomId);
      if (!room || !(o.edge >= 0 && o.edge < room.polygon.length)) continue;
      const len = edgeLength(room, o.edge);
      const a = toScreen(edgePoint(room, o.edge, Math.max(0, o.centreM - o.widthM / 2)));
      const b = toScreen(edgePoint(room, o.edge, Math.min(len, o.centreM + o.widthM / 2)));
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.lineCap = 'round';
      g.lineWidth = o.id === sel.openingId ? 7 : 4.5;
      g.strokeStyle = o.id === sel.openingId ? '#1d4ed8' : o.type === 'door' ? '#b4691f' : o.type === 'window' ? '#3b82c4' : '#6b7280';
      g.stroke();
      g.lineCap = 'butt';
    }

    // furniture
    for (const f of draft.furniture) {
      const c = boxCorners(f.box);
      drawPoly(c.map((p) => ({ x: p.x, z: p.z })));
      g.fillStyle = f.source === 'real' ? 'rgba(160,120,70,0.35)' : 'rgba(60,140,200,0.30)';
      g.fill();
      g.lineWidth = 1.25;
      g.strokeStyle = f.source === 'real' ? '#8a6a3b' : '#2f78b3';
      g.stroke();
      // the back edge is the first side (back-left to back-right): mark it thick so orientation reads
      const bl = toScreen(c[0]);
      const br = toScreen(c[1]);
      g.beginPath();
      g.moveTo(bl.x, bl.y);
      g.lineTo(br.x, br.y);
      g.lineWidth = 3;
      g.stroke();
      const m = toScreen({ x: f.box.cx, z: f.box.cz });
      g.fillStyle = '#2b2b30';
      g.font = '11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (scale > 18) g.fillText(f.label, m.x, m.y);
    }

    // room labels
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const room of lay.rooms) {
      if (room.polygon.length < 3) continue;
      const area = Math.abs(polygonArea(room.polygon));
      const cx = room.polygon.reduce((s, p) => s + p.x, 0) / room.polygon.length;
      const cz = room.polygon.reduce((s, p) => s + p.z, 0) / room.polygon.length;
      const s = toScreen({ x: cx, z: cz });
      g.font = '600 12px system-ui, sans-serif';
      g.fillStyle = 'rgba(20,22,28,0.92)';
      g.fillText(room.label, s.x, s.y - 7);
      g.font = '11px system-ui, sans-serif';
      g.fillStyle = 'rgba(20,22,28,0.72)';
      g.fillText(formatArea(area).text, s.x, s.y + 8);
    }

    // spawn
    if (lay.rooms.length > 0) {
      const s = toScreen({ x: draft.spawn.x, z: draft.spawn.z });
      const yaw = (draft.spawn.yawDeg * Math.PI) / 180;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      g.beginPath();
      g.arc(s.x, s.y, 6, 0, Math.PI * 2);
      g.fillStyle = '#16a34a';
      g.fill();
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.lineTo(s.x + fx * 22, s.y + fz * 22);
      g.lineWidth = 2.5;
      g.strokeStyle = '#16a34a';
      g.stroke();
    }

    for (const layer of layers) {
      g.save();
      try { layer(g, api); } catch (err) { console.error('[walkthru] plan layer threw', err); }
      g.restore();
    }
    if (tool?.draw) {
      g.save();
      try { tool.draw(g, api); } catch (err) { console.error('[walkthru] plan tool draw threw', err); }
      g.restore();
    }
  }

  // ---------------------------------------------------------------- the public object

  const api: PlanCanvasImpl = {
    el,
    refresh() { api.redraw(); },
    redraw() { if (!raf) raf = requestAnimationFrame(draw); },
    screenToWorld: toWorld,
    worldToScreen: toScreen,
    setTool(t) {
      if (tool && tool !== t) tool.cancel?.();
      tool = t;
      el.style.cursor = t?.cursor ?? 'grab';
      api.redraw();
    },
    addLayer(fn) {
      layers.add(fn);
      session?.add(fn);
      api.redraw();
      return () => { layers.delete(fn); session?.delete(fn); api.redraw(); };
    },
    setUnderlayImage(i, p) {
      img = i;
      placement = i && p ? { ...p } : null;
      api.redraw();
    },
    setUnderlayPlacement(p) {
      placement = p ? { ...p } : null;
      api.redraw();
    },
    pxPerMetreOnScreen() { return scale; },
    fit() {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      const add = (x: number, z: number): void => { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); };
      const draft = getDraft();
      if (img && placement) {
        const w = (img as { naturalWidth?: number; width?: number }).naturalWidth || (img as { width?: number }).width || 1000;
        const h = (img as { naturalHeight?: number; height?: number }).naturalHeight || (img as { height?: number }).height || 1000;
        add(-placement.originPx.x / placement.pxPerM, -placement.originPx.y / placement.pxPerM);
        add((w - placement.originPx.x) / placement.pxPerM, (h - placement.originPx.y) / placement.pxPerM);
      } else {
        for (const r of draft.layout.rooms) for (const p of r.polygon) add(p.x, p.z);
      }
      if (!isFinite(x0)) { x0 = -1; z0 = -1; x1 = 11; z1 = 11; }
      const pad = 24;
      const w = Math.max(0.5, x1 - x0);
      const h = Math.max(0.5, z1 - z0);
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((cssW - 2 * pad) / w, (cssH - 2 * pad) / h)));
      ox = (cssW - w * scale) / 2 - x0 * scale;
      oz = (cssH - h * scale) / 2 - z0 * scale;
      api.redraw();
    },
    beginSession() { session = new Set(); },
    endSession() {
      if (session) for (const fn of session) layers.delete(fn);
      session = null;
      api.redraw();
    },
    view() { return { scale, ox, oz }; },
    destroy() {
      ro?.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      el.remove();
    },
  };

  // ---------------------------------------------------------------- pointers: pan, zoom, tool events

  const pointers = new Map<number, { x: number; y: number }>();
  type Gesture = { kind: 'pan'; id: number; x: number; y: number } | { kind: 'pinch'; dist: number; cx: number; cy: number } | { kind: 'tool'; id: number } | null;
  let gesture: Gesture = null;
  let spaceDown = false;

  const zoomAt = (cx: number, cy: number, k: number): void => {
    const r = el.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * k));
    const kk = next / scale;
    ox = px - (px - ox) * kk;
    oz = py - (py - oz) * kk;
    scale = next;
    api.redraw();
  };

  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  el.addEventListener('pointerdown', (e) => {
    el.focus({ preventScroll: true });
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events have no active pointer */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      if (gesture?.kind === 'tool') tool?.cancel?.();
      const [p, q] = [...pointers.values()];
      gesture = { kind: 'pinch', dist: Math.hypot(p.x - q.x, p.y - q.y) || 1, cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2 };
      return;
    }
    if (pointers.size > 2) return;
    const panning = e.button === 1 || e.button === 2 || spaceDown || (e.button === 0 && !tool);
    if (panning) {
      gesture = { kind: 'pan', id: e.pointerId, x: e.clientX, y: e.clientY };
      el.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 0 && tool) {
      gesture = { kind: 'tool', id: e.pointerId };
      tool.onDown?.(toWorld(e.clientX, e.clientY), e);
      api.redraw();
    }
  });

  el.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (prev) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture?.kind === 'pinch' && pointers.size >= 2) {
      const [p, q] = [...pointers.values()];
      const dist = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const cx = (p.x + q.x) / 2;
      const cy = (p.y + q.y) / 2;
      ox += cx - gesture.cx;
      oz += cy - gesture.cy;
      zoomAt(cx, cy, dist / gesture.dist);
      gesture = { kind: 'pinch', dist, cx, cy };
      return;
    }
    if (gesture?.kind === 'pan' && gesture.id === e.pointerId) {
      ox += e.clientX - gesture.x;
      oz += e.clientY - gesture.y;
      gesture = { kind: 'pan', id: e.pointerId, x: e.clientX, y: e.clientY };
      api.redraw();
      return;
    }
    if (tool?.onMove && (!gesture || gesture.kind === 'tool')) {
      tool.onMove(toWorld(e.clientX, e.clientY), e);
      api.redraw();
    }
  });

  const end = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (gesture?.kind === 'tool' && gesture.id === e.pointerId) {
      gesture = null;
      tool?.onUp?.(toWorld(e.clientX, e.clientY), e);
      api.redraw();
    } else if (gesture?.kind === 'pan' && gesture.id === e.pointerId) {
      gesture = null;
      el.style.cursor = tool?.cursor ?? 'grab';
    } else if (gesture?.kind === 'pinch') {
      gesture = pointers.size === 1 ? { kind: 'pan', id: [...pointers.keys()][0], x: [...pointers.values()][0].x, y: [...pointers.values()][0].y } : null;
    }
    try { el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  const typing = (t: EventTarget | null): boolean => {
    const n = t as HTMLElement | null;
    return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
  };
  function onKeyDown(e: KeyboardEvent): void {
    if (typing(e.target)) return;
    if (e.code === 'Space') { spaceDown = true; if (e.target === el) e.preventDefault(); return; }
    tool?.onKey?.(e);
    api.redraw();
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') spaceDown = false;
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  resize();
  return api;
}
