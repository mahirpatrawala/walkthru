// Owned by C5. E3 Rooms (SPEC 2.2): rectangle and polygon tools with snapping, live size label, type and label, typed
// size, tile helper, edge kinds, room list, and "Load proposal" (the Phase 2 plug and the C8 drawing import).
import type { EdgeKind, Layout, RoomTag, RoomType, Vec2 } from '../../types';
import { polygonArea, polygonSelfIntersects, pointInPolygon } from '../../core/geometry';
import { defaultEdges } from '../../core/layout-geom';
import { parseSize } from '../../core/units';
import type { EditorContext, EditorHost, EditorStep, PlanCanvas, PlanTool } from '../context';
import { asHost } from '../context';
import { clear, h } from '../dom';
import {
  ROOM_TYPE_NAMES, areaText, clampOpeningsOn, cycleEdgeKind, makeRoom, nearestEdge, rectInfo, rectPolygon, resizeRect,
  retypeRoom, sizeText, snapPoint, tileText, SNAP_PX,
} from '../plan-helpers';
import { applyProposal, fetchSceneJson, proposalToPatch } from '../save';

const MIN_SIDE_M = 0.3;
const ROOM_TYPES: RoomType[] = ['bedroom', 'living', 'kitchen', 'bathroom', 'balcony', 'other'];
const TILE_MM = [600, 800, 1200];

type ToolId = 'rect' | 'poly' | 'select';

// ------------------------------------------------------------------ pure actions (also used by the headless trace)

/** Adds a drawn polygon as a room: positive area, default edges, unique id and label. Returns it. */
export function addRoomToDraft(layout: Layout, polygon: Vec2[], type: RoomType, label?: string): RoomTag {
  const room = makeRoom(layout, polygon, type, label);
  layout.rooms.push(room);
  return room;
}

/** Removes a room and the openings on it. */
export function removeRoomFromDraft(layout: Layout, roomId: string): void {
  layout.rooms = layout.rooms.filter((r) => r.id !== roomId);
  layout.openings = layout.openings.filter((o) => o.roomId !== roomId);
}

/** Resizes a rectangle about its first corner and keeps its openings on their edges. Null when the room is not a rectangle. */
export function resizeRoomInDraft(layout: Layout, roomId: string, w: number, l: number): RoomTag | null {
  const i = layout.rooms.findIndex((r) => r.id === roomId);
  if (i < 0) return null;
  const next = resizeRect(layout.rooms[i], w, l);
  if (!next) return null;
  layout.rooms[i] = next;
  clampOpeningsOn(layout, roomId);
  return next;
}

// ------------------------------------------------------------------ step

export const step: EditorStep = {
  id: 'rooms',
  title: 'Rooms',
  mount(panel, ctx) {
    const host = asHost(ctx);
    panel.className = 'panel-body step-rooms';
    mountRooms(panel, ctx, host);
  },
  unmount() {},
  isDone(ctx) {
    return ctx.draft.layout.rooms.length > 0;
  },
};

function mountRooms(panel: HTMLElement, ctx: EditorContext, host: EditorHost): void {
  const draft = ctx.draft;
  const plan: PlanCanvas = ctx.plan;
  let toolId: ToolId = 'rect';
  let lastType: RoomType = 'bedroom';
  let hasProposal = false;
  const tileState = { mm: 600, a: 6.5, b: 4 };

  const hasUnderlay = (): boolean => !!draft.layout.underlay;
  const snap = (p: Vec2, e: PointerEvent | null, extra?: Vec2[]): Vec2 =>
    e?.altKey ? p : snapPoint(p, { rooms: draft.layout.rooms, pxPerMetre: plan.pxPerMetreOnScreen(), hasUnderlay: hasUnderlay(), extraPoints: extra }).point;

  const addRoom = (polygon: Vec2[]): void => {
    if (polygonSelfIntersects(polygon)) { host.toast('That outline crosses itself. Try again.', 'warn'); return; }
    if (Math.abs(polygonArea(polygon)) < MIN_SIDE_M * MIN_SIDE_M) { host.toast('That room is too small to keep.', 'warn'); return; }
    const room = addRoomToDraft(draft.layout, polygon, lastType);
    host.select({ roomId: room.id, openingId: null });
    ctx.commit();
    render();
  };

  // ---------------------------------------------------------------- tools
  const rectTool = (): PlanTool => {
    let p1: Vec2 | null = null;
    let cur: Vec2 | null = null;
    let downAt: { x: number; y: number } | null = null;
    let finishedOnDown = false;
    return {
      cursor: 'crosshair',
      onDown(w, e) {
        const s = snap(w, e);
        finishedOnDown = false;
        if (p1) {
          finishRect(p1, s);
          p1 = null; cur = null; finishedOnDown = true;
          return;
        }
        p1 = s; cur = s; downAt = { x: e.clientX, y: e.clientY };
      },
      onMove(w, e) { cur = snap(w, e); },
      onUp(w, e) {
        if (finishedOnDown || !p1 || !downAt) return;
        const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
        if (moved >= 6) {
          const s = snap(w, e);
          const a = p1;
          p1 = null; cur = null;
          finishRect(a, s);
        } // else click-click mode: wait for the second click
      },
      onKey(e) { if (e.key === 'Escape') { p1 = null; cur = null; } },
      cancel() { p1 = null; cur = null; },
      draw(g, c) {
        if (!p1 || !cur) return;
        const poly = rectPolygon(p1, cur);
        drawOutline(g, c, poly, '#1d4ed8');
        const w = Math.abs(cur.x - p1.x);
        const l = Math.abs(cur.z - p1.z);
        drawTag(g, c.worldToScreen(cur), `${sizeText(w, l)}  ·  ${areaText(w * l)}`);
      },
    };
  };
  const finishRect = (a: Vec2, b: Vec2): void => {
    if (Math.abs(b.x - a.x) < MIN_SIDE_M || Math.abs(b.z - a.z) < MIN_SIDE_M) { host.toast('Drag corner to corner. That one is too small.', 'warn'); return; }
    addRoom(rectPolygon(a, b));
  };

  const polyTool = (): PlanTool => {
    let pts: Vec2[] = [];
    let cur: Vec2 | null = null;
    let lastClick = 0;
    const close = (): void => {
      if (pts.length >= 3) { const done = pts; pts = []; cur = null; addRoom(done); } else { pts = []; cur = null; }
    };
    return {
      cursor: 'crosshair',
      onDown(w, e) {
        const s = snap(w, e, pts);
        const now = performance.now();
        const first = pts[0];
        const nearFirst = first && pts.length >= 3 && Math.hypot(s.x - first.x, s.z - first.z) * plan.pxPerMetreOnScreen() <= SNAP_PX;
        const dbl = pts.length >= 3 && now - lastClick < 350 && Math.hypot(s.x - pts[pts.length - 1].x, s.z - pts[pts.length - 1].z) * plan.pxPerMetreOnScreen() < 6;
        lastClick = now;
        if (nearFirst || dbl) { close(); return; }
        pts.push(s);
      },
      onMove(w, e) { cur = snap(w, e, pts); },
      onKey(e) {
        if (e.key === 'Enter') close();
        else if (e.key === 'Escape') { pts = []; cur = null; }
        else if (e.key === 'Backspace') pts.pop();
      },
      cancel() { pts = []; cur = null; },
      draw(g, c) {
        if (pts.length === 0) return;
        const path = cur ? [...pts, cur] : pts;
        g.beginPath();
        path.forEach((p, i) => { const s = c.worldToScreen(p); if (i === 0) g.moveTo(s.x, s.y); else g.lineTo(s.x, s.y); });
        g.lineWidth = 2; g.strokeStyle = '#1d4ed8'; g.stroke();
        for (const p of pts) { const s = c.worldToScreen(p); g.beginPath(); g.arc(s.x, s.y, 4, 0, Math.PI * 2); g.fillStyle = '#1d4ed8'; g.fill(); }
        if (pts.length >= 3) {
          const s = c.worldToScreen(pts[0]);
          g.beginPath(); g.arc(s.x, s.y, SNAP_PX, 0, Math.PI * 2); g.strokeStyle = 'rgba(29,78,216,0.5)'; g.stroke();
          const a = Math.abs(polygonArea(pts));
          drawTag(g, c.worldToScreen(cur ?? pts[pts.length - 1]), `${areaText(a)}  ·  Enter or click the first corner to close`);
        } else if (cur) {
          const last = pts[pts.length - 1];
          drawTag(g, c.worldToScreen(cur), `${Math.hypot(cur.x - last.x, cur.z - last.z).toFixed(2)} m`);
        }
      },
    };
  };

  const selectTool = (): PlanTool => ({
    cursor: 'pointer',
    onDown(w) {
      const r = SNAP_PX / plan.pxPerMetreOnScreen();
      const edge = nearestEdge(draft.layout, w, r, { preferRoomId: host.selection.roomId });
      if (edge) {
        const room = draft.layout.rooms.find((q) => q.id === edge.roomId)!;
        room.edges[edge.edge] = cycleEdgeKind(room.edges[edge.edge]);
        host.select({ roomId: room.id, openingId: null });
        ctx.commit();
        render();
        return;
      }
      const inside = draft.layout.rooms.find((q) => pointInPolygon(w, q.polygon));
      host.select({ roomId: inside?.id ?? null, openingId: null });
      ctx.commit();
      render();
    },
  });

  const setTool = (id: ToolId): void => {
    toolId = id;
    plan.setTool(id === 'rect' ? rectTool() : id === 'poly' ? polyTool() : selectTool());
    render();
  };

  // ---------------------------------------------------------------- panel
  const body = h('div');
  const selected = (): RoomTag | null => draft.layout.rooms.find((r) => r.id === host.selection.roomId) ?? null;

  function render(): void {
    clear(body);
    const toolRow = h('div', { class: 'segmented' },
      ...(['rect', 'poly', 'select'] as ToolId[]).map((id) =>
        h('button', { class: `btn${toolId === id ? ' on' : ''}`, text: id === 'rect' ? 'Rectangle' : id === 'poly' ? 'Polygon' : 'Select and edges', onclick: () => setTool(id) })),
    );
    const typeSel = h('select', {}, ...ROOM_TYPES.map((t) => h('option', { value: t, text: ROOM_TYPE_NAMES[t], selected: t === lastType })));
    typeSel.addEventListener('change', () => { lastType = typeSel.value as RoomType; });

    body.append(
      toolRow,
      h('p', { class: 'muted small', text: toolId === 'rect'
        ? 'Drag from one corner to the opposite one (or click, then click). Alt turns snapping off.'
        : toolId === 'poly'
          ? 'Click the corners. Close with Enter, a double-click, or a click on the first corner. Backspace removes the last corner.'
          : 'Click a room to select it. Click one of its edges to cycle wall, railing, none.' }),
      h('label', { class: 'field inline' }, h('span', { text: 'New rooms are' }), typeSel),
      h('div', { class: 'hint', text: 'Trace along the inside faces of the walls. Leave the wall thickness as a gap between neighbouring rooms, as the plan shows it (zoom in, or hold Alt, so snapping does not close that gap). Corridors are rooms too (type Other, label "Passage").' }),
    );

    // room list
    body.append(h('h3', { text: `Rooms (${draft.layout.rooms.length})` }));
    const list = h('ul', { class: 'roomlist' });
    for (const room of draft.layout.rooms) {
      const area = Math.abs(polygonArea(room.polygon));
      const li = h('li', { class: room.id === host.selection.roomId ? 'on' : '' },
        h('span', { class: 'dot', style: `background:${typeColour(room.roomType)}` }),
        h('span', { class: 'grow' }, h('strong', { text: room.label || room.id }), h('br'), h('span', { class: 'muted small', text: `${ROOM_TYPE_NAMES[room.roomType]} · ${areaText(area)}` })),
        h('button', { class: 'btn small', text: 'Delete', onclick: (e: Event) => {
          e.stopPropagation();
          removeRoomFromDraft(draft.layout, room.id);
          if (host.selection.roomId === room.id) host.select({ roomId: null, openingId: null });
          ctx.commit();
          render();
        } }),
      );
      li.addEventListener('click', () => { host.select({ roomId: room.id, openingId: null }); ctx.commit(); render(); });
      list.append(li);
    }
    if (draft.layout.rooms.length === 0) list.append(h('li', { class: 'muted', text: 'No rooms yet. Draw one on the plan.' }));
    body.append(list);

    const room = selected();
    if (room) body.append(roomEditor(room));
    body.append(tileHelper(room));
    body.append(proposalBlock());
  }

  function roomEditor(room: RoomTag): HTMLElement {
    const label = h('input', { type: 'text', value: room.label, autocomplete: 'off' });
    label.addEventListener('input', () => { room.label = label.value; ctx.commit(); });
    const typeSel = h('select', {}, ...ROOM_TYPES.map((t) => h('option', { value: t, text: ROOM_TYPE_NAMES[t], selected: t === room.roomType })));
    typeSel.addEventListener('change', () => {
      const i = draft.layout.rooms.findIndex((r) => r.id === room.id);
      if (i >= 0) draft.layout.rooms[i] = retypeRoom(draft.layout, draft.layout.rooms[i], typeSel.value as RoomType);
      lastType = typeSel.value as RoomType;
      ctx.commit();
      render();
    });
    const info = rectInfo(room);
    const sizeErr = h('p', { class: 'err small' });
    const size = h('input', { type: 'text', value: info ? `${+info.w.toFixed(2)} x ${+info.l.toFixed(2)}` : '', placeholder: `4.0 x 5.0   or   13'1" x 16'5"`, disabled: !info, autocomplete: 'off' });
    const applySize = (): void => {
      sizeErr.textContent = '';
      const s = parseSize(size.value);
      if (!s) { sizeErr.textContent = `Could not read that size. Try 4.0 x 5.0 or 13'1" x 16'5".`; return; }
      if (s.w < MIN_SIDE_M || s.l < MIN_SIDE_M) { sizeErr.textContent = 'That is too small.'; return; }
      if (!resizeRoomInDraft(draft.layout, room.id, s.w, s.l)) { sizeErr.textContent = 'Only rectangles can be resized. Delete the room and redraw it.'; return; }
      ctx.commit();
      render();
    };
    size.addEventListener('keydown', (e) => { if (e.key === 'Enter') applySize(); });
    size.addEventListener('change', applySize);
    const area = Math.abs(polygonArea(room.polygon));
    const kinds = room.edges.reduce<Record<EdgeKind, number>>((m, k) => { m[k]++; return m; }, { wall: 0, railing: 0, none: 0 });
    return h('div', { class: 'card' },
      h('h3', { text: 'Selected room' }),
      h('label', { class: 'field' }, h('span', { text: 'Label' }), label),
      h('label', { class: 'field' }, h('span', { text: 'Type' }), typeSel),
      h('label', { class: 'field' }, h('span', { text: info ? 'Size (resizes about the first corner)' : 'Size (rectangles only)' }), size),
      sizeErr,
      h('p', { class: 'small', text: info ? `${sizeText(info.w, info.l)} · ${areaText(area)}` : areaText(area) }),
      h('p', { class: 'muted small', text: `Edges: ${kinds.wall} wall, ${kinds.railing} railing, ${kinds.none} open. Use "Select and edges", then click an edge to change it.` }),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', text: 'Reset edges to defaults', onclick: () => {
          const i = draft.layout.rooms.findIndex((r) => r.id === room.id);
          if (i >= 0) draft.layout.rooms[i].edges = defaultEdges(draft.layout.rooms[i], draft.layout.rooms.filter((r) => r.id !== room.id));
          ctx.commit(); render();
        } }),
      ),
    );
  }

  function tileHelper(room: RoomTag | null): HTMLElement {
    const sel = h('select', {}, ...TILE_MM.map((mm) => h('option', { value: String(mm), text: `${mm} mm tile`, selected: mm === tileState.mm })));
    const rows = h('div');
    const draw = (): void => {
      clear(rows);
      (['a', 'b'] as const).forEach((key) => {
        const count = h('input', { type: 'number', step: '0.5', min: '0', value: String(tileState[key]) });
        const text = h('span', { class: 'small', text: tileText(tileState[key], tileState.mm) });
        count.addEventListener('input', () => { tileState[key] = parseFloat(count.value) || 0; text.textContent = tileText(tileState[key], tileState.mm); });
        const use = (axis: 'w' | 'l'): void => {
          const span = tileState[key] * tileState.mm / 1000;
          const r = selected();
          const info = r ? rectInfo(r) : null;
          if (!r || !info) { host.toast('Select a rectangular room first.', 'warn'); return; }
          if (!(span >= MIN_SIDE_M)) { host.toast('That is too small.', 'warn'); return; }
          resizeRoomInDraft(draft.layout, r.id, axis === 'w' ? span : info.w, axis === 'l' ? span : info.l);
          ctx.commit(); render();
        };
        rows.append(h('div', { class: 'tilerow' }, count, text,
          h('button', { class: 'btn small', text: 'Use as width', disabled: !room, onclick: () => use('w') }),
          h('button', { class: 'btn small', text: 'Use as length', disabled: !room, onclick: () => use('l') })));
      });
    };
    sel.addEventListener('change', () => { tileState.mm = parseInt(sel.value, 10); draw(); });
    draw();
    return h('div', { class: 'card' }, h('h3', { text: 'Tile helper' }),
      h('p', { class: 'muted small', text: 'Count the floor tiles along a wall. Half tiles are fine.' }), sel, rows);
  }

  function proposalBlock(): HTMLElement {
    const box = h('div', { class: 'card' });
    if (!hasProposal) return box;
    box.append(
      h('h3', { text: 'Proposal' }),
      h('p', { class: 'muted small', text: 'This scene has a proposal.json from an automatic pipeline or a drawing import. Load it, then correct it here.' }),
      h('button', { class: 'btn', text: 'Load proposal', onclick: () => void loadProposal() }),
    );
    return box;
  }

  async function loadProposal(): Promise<void> {
    const raw = await fetchSceneJson(ctx.sceneId, 'proposal.json');
    if (!raw) { host.toast('proposal.json could not be read.', 'error'); return; }
    const extras = await fetchSceneJson(ctx.sceneId, 'proposal-extras.json');
    let patch;
    try {
      patch = proposalToPatch(raw, extras);
    } catch (err) {
      host.toast(err instanceof Error ? err.message : String(err), 'error');
      return;
    }
    if (draft.layout.rooms.length > 0 && !window.confirm(`Replace the ${draft.layout.rooms.length} room${draft.layout.rooms.length === 1 ? '' : 's'} already drawn with the proposal?`)) return;
    applyProposal(draft, patch);
    const meta = raw as { source?: unknown; confidence?: unknown };
    const lead = typeof meta.source === 'string' && typeof meta.confidence === 'number'
      ? [`Automatic proposal from ${meta.source}, confidence ${Math.round(meta.confidence * 100)}%. Check every room and opening.`] : [];
    host.setImportNotes([...lead, ...patch.notes]);
    host.select({ roomId: null, openingId: null });
    host.fitPlan();
    ctx.commit();
    render();
    host.toast(`Loaded ${patch.rooms.length} rooms and ${patch.openings.length} openings from proposal.json.`, 'info');
  }

  // ---------------------------------------------------------------- go
  clear(panel);
  panel.append(body);
  render();
  plan.setTool(rectTool());
  void ctx.api.exists('proposal.json').then((yes) => { hasProposal = yes; render(); });
}

function typeColour(t: RoomType): string {
  return ({ bedroom: '#9ec5f0', living: '#f2c38b', kitchen: '#f0a8a8', bathroom: '#8fd9c0', balcony: '#b7e08a', other: '#cfcfd8' } as const)[t];
}

function drawOutline(g: CanvasRenderingContext2D, c: PlanCanvas, poly: Vec2[], colour: string): void {
  g.beginPath();
  poly.forEach((p, i) => { const s = c.worldToScreen(p); if (i === 0) g.moveTo(s.x, s.y); else g.lineTo(s.x, s.y); });
  g.closePath();
  g.fillStyle = 'rgba(29,78,216,0.12)';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = colour;
  g.stroke();
}

function drawTag(g: CanvasRenderingContext2D, at: { x: number; y: number }, text: string): void {
  g.font = '12px system-ui, sans-serif';
  const w = g.measureText(text).width + 12;
  const x = at.x + 14;
  const y = at.y + 14;
  g.fillStyle = 'rgba(20,24,36,0.88)';
  g.fillRect(x, y, w, 22);
  g.fillStyle = '#fff';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, x + 6, y + 11);
}

