// Owned by C6. E6 Furniture (SPEC 2.2, optional): tag fixed items with three clicks, stage catalogue pieces, and review what
// the drawing import found (placed items are in the list, `unmapped` ones are shown "not placed" with a one-click place).
// The pure part is exported for the headless tests; the panel and the plan tool only wire pointer events to it.
import { ceilingIsKnown } from '../../core/room-trust';
import type { Box, FurnitureItem, FurnitureKind, Grid, Layout, PlacementResult, Tone, Vec2 } from '../../types';
import { CATALOG, REAL_ITEM_DEFAULTS, itemFromCatalog, specFor } from '../../core/catalog';
import { boxCorners, boxFromBackEdge, pointInBox, sideEdge } from '../../core/geometry';
import { clearance } from '../../core/grid-query';
import { rasterizeLayout, stampFurniture } from '../../core/layout-raster';
import { checkPlacement, snapToWalls } from '../../core/placement';
import type { EditorContext, EditorStep, PlanTool } from '../context';
import { asHost } from '../context';
import { clear, h } from '../dom';
import { nextId, snapPoint } from '../plan-helpers';
import { fetchSceneJson } from '../save';

// ---------------------------------------------------------------- pure: real items (three clicks)

/** The four kinds a broker can tag (2.2 E6). Other kinds can still arrive from the drawing import and are listed and edited. */
export const REAL_KINDS: { kind: FurnitureKind; name: string }[] = [
  { kind: 'wardrobe', name: 'Wardrobe' },
  { kind: 'counter', name: 'Counter' },
  { kind: 'bed', name: 'Bed' },
  { kind: 'sofa', name: 'Sofa' },
];
export const KIND_NAMES: Record<FurnitureKind, string> = { bed: 'Bed', sofa: 'Sofa', dining: 'Dining table', wardrobe: 'Wardrobe', counter: 'Counter' };
export const MIN_SIDE_M = 0.2;

function r3(n: number): number { return Math.round(n * 1000) / 1000; }
function roundBox(b: Box): Box { return { cx: r3(b.cx), cz: r3(b.cz), w: r3(b.w), d: r3(b.d), yawDeg: Math.round(b.yawDeg * 10) / 10 }; }

function labelFor(base: string, existing: FurnitureItem[]): string {
  const same = existing.filter((f) => f.label === base || f.label.startsWith(`${base} `)).length;
  return same === 0 ? base : `${base} ${same + 1}`;
}

/**
 * The three-click tag (4.4 defaults, `boxFromBackEdge` of 7.1): p1 and p2 are the two ends of the back edge, `front` is any
 * point on the front side. Saved with source 'real'. Null when the box would be under 0.2 m on a side.
 */
export function tagRealItem(kind: FurnitureKind, p1: Vec2, p2: Vec2, front: Vec2, existing: FurnitureItem[]): FurnitureItem | null {
  const box = boxFromBackEdge(p1, p2, front);
  if (box.w < MIN_SIDE_M || box.d < MIN_SIDE_M) return null;
  const d = REAL_ITEM_DEFAULTS[kind];
  return {
    id: nextId(`real-${kind}`, existing.map((f) => f.id)),
    source: 'real',
    kind,
    label: labelFor(KIND_NAMES[kind], existing),
    box: roundBox(box),
    heightM: d.heightM,
    surfaceHeightM: d.surfaceHeightM,
  };
}

// ---------------------------------------------------------------- pure: grids, verdicts, dropping and moving

/** The grid of the empty flat. Furniture is stamped on top with `gridWithout`. */
export function baseGrid(layout: Layout): Grid { return rasterizeLayout(layout); }

/** The flat with every piece of furniture stamped except `excludeId` (4.5: "grid excludes the item being placed"). */
export function gridWithout(base: Grid, furniture: FurnitureItem[], excludeId: string | null): Grid {
  return stampFurniture(base, furniture.filter((f) => f.id !== excludeId));
}

/** The verdict the buyer would see for this item where it is now. */
export function verdictFor(base: Grid, layout: Layout, furniture: FurnitureItem[], item: FurnitureItem): PlacementResult {
  return checkPlacement(gridWithout(base, furniture, item.id), specFor(item), item.box, layout.wallHeightM, ceilingIsKnown());
}

/** A virtual catalogue piece centred on `at`, squared up to a wall behind it (4.5 `snapToWalls`, as the buyer's furnish mode does). */
export function dropVirtual(base: Grid, furniture: FurnitureItem[], catalogId: string, at: Vec2, yawDeg: number): FurnitureItem {
  const spec = CATALOG.find((c) => c.id === catalogId);
  if (!spec) throw new Error(`Unknown catalogue item: ${catalogId}`);
  const box: Box = { cx: at.x, cz: at.z, w: spec.footprint.w, d: spec.footprint.d, yawDeg: ((yawDeg % 360) + 360) % 360 };
  const item = itemFromCatalog(catalogId, box, 'virtual');
  item.box = roundBox(snapToWalls(gridWithout(base, furniture, null), item.box));
  return item;
}

/** Rotates about the centre by a multiple of 90 degrees, yaw kept in [0, 360). */
export function rotateItem<T extends { box: Box }>(item: T, deg: number): T {
  return { ...item, box: { ...item.box, yawDeg: (((item.box.yawDeg + deg) % 360) + 360) % 360 } };
}

/** The topmost item (last in the list) under a point. */
export function itemAt(furniture: FurnitureItem[], pt: Vec2): FurnitureItem | null {
  for (let i = furniture.length - 1; i >= 0; i--) if (pointInBox(pt, furniture[i].box)) return furniture[i];
  return null;
}

/** Applies a height edit: both stay positive and the surface never goes above the top. */
export function setHeights(item: FurnitureItem, heightM?: number, surfaceHeightM?: number): void {
  if (heightM !== undefined && heightM > 0) {
    item.heightM = r3(heightM);
    if (item.surfaceHeightM > item.heightM) item.surfaceHeightM = item.heightM;
  }
  if (surfaceHeightM !== undefined && surfaceHeightM > 0) item.surfaceHeightM = r3(Math.min(surfaceHeightM, item.heightM));
}

// ---------------------------------------------------------------- pure: the import's `unmapped` list

export interface UnmappedEntry { label: string; sizeM?: { w: number; l: number }; at: Vec2; reason: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The `unmapped` list of a proposal-extras.json, defensively: entries without a label and a position are dropped. */
export function parseUnmapped(extras: unknown): UnmappedEntry[] {
  if (!isObj(extras) || !Array.isArray(extras.unmapped)) return [];
  const out: UnmappedEntry[] = [];
  for (const u of extras.unmapped) {
    if (!isObj(u) || typeof u.label !== 'string' || !isObj(u.at)) continue;
    const x = num(u.at.x);
    const z = num(u.at.z);
    if (x === null || z === null) continue;
    const entry: UnmappedEntry = { label: u.label, at: { x, z }, reason: typeof u.reason === 'string' ? u.reason : '' };
    if (isObj(u.sizeM)) {
      const w = num(u.sizeM.w);
      const l = num(u.sizeM.l);
      if (w !== null && l !== null) entry.sizeM = { w, l };
    }
    out.push(entry);
  }
  return out;
}

export function unmappedKey(u: UnmappedEntry): string { return `${u.label}|${u.at.x.toFixed(2)}|${u.at.z.toFixed(2)}`; }

export interface PlaceOption { text: string; kind: FurnitureKind; label: string; w: number; d: number; heightM: number; surfaceHeightM: number }

/**
 * What an unmapped label can become. The catalogue kinds (bed, sofa, dining, wardrobe, counter) have no slot for a side table or
 * a TV unit, so those are offered as a low `counter`. Anything else gets no button: tag it by hand with "Fixed item".
 * // SPEC-GAP: 13.4 says unmapped items have no kind to map to; "place as side table" uses `counter` at 0.5 m, our choice.
 */
export function placeOptions(u: UnmappedEntry): PlaceOption[] {
  const name = u.label.toLowerCase();
  const long = u.sizeM ? Math.max(u.sizeM.w, u.sizeM.l) : 0;
  const short = u.sizeM ? Math.min(u.sizeM.w, u.sizeM.l) : 0;
  if (/wardrobe/.test(name)) {
    const w = long >= 0.3 ? long : 1.2;
    const d = short >= 0.3 ? Math.min(short, 0.9) : 0.6;
    return [{ text: 'Place as wardrobe', kind: 'wardrobe', label: 'Wardrobe', w, d, ...REAL_ITEM_DEFAULTS.wardrobe }];
  }
  if (/side\s*table|bedside|night\s*stand/.test(name)) {
    const both = short >= 0.2;
    return [{ text: 'Place as side table', kind: 'counter', label: 'Side table', w: both ? long : 0.45, d: both ? short : 0.45, heightM: 0.5, surfaceHeightM: 0.5 }];
  }
  if (/tv\s*unit|tv\s*cabinet|tv\s*console/.test(name)) {
    const both = short >= 0.2;
    return [{ text: 'Place as TV unit', kind: 'counter', label: 'TV unit', w: both ? long : 1.2, d: both ? short : 0.4, heightM: 0.5, surfaceHeightM: 0.5 }];
  }
  return [];
}

/** Of the four directions, the yaw whose back faces the nearest wall (nothing near: yaw 0). */
export function yawTowardWall(grid: Grid, box: Box): number {
  let best = 0;
  let bestD = Infinity;
  for (const yaw of [0, 90, 180, 270]) {
    const e = sideEdge({ ...box, yawDeg: yaw }, 'back');
    const origin = { x: e.mid.x + e.normal.x * 0.03, z: e.mid.z + e.normal.z * 0.03 };
    const d = clearance(grid, origin, e.normal, 1.0);
    if (d < bestD - 1e-9) { bestD = d; best = yaw; }
  }
  return best;
}

/** Turns an unmapped entry into a real item at the drawn position, its back to the nearest wall and squared up. */
export function placeUnmapped(base: Grid, furniture: FurnitureItem[], u: UnmappedEntry, opt: PlaceOption): FurnitureItem {
  const grid = gridWithout(base, furniture, null);
  let box: Box = { cx: u.at.x, cz: u.at.z, w: opt.w, d: opt.d, yawDeg: 0 };
  box = { ...box, yawDeg: yawTowardWall(grid, box) };
  box = roundBox(snapToWalls(grid, box));
  return {
    id: nextId(`real-${opt.kind}`, furniture.map((f) => f.id)),
    source: 'real',
    kind: opt.kind,
    label: labelFor(opt.label, furniture),
    box,
    heightM: opt.heightM,
    surfaceHeightM: opt.surfaceHeightM,
  };
}

// ---------------------------------------------------------------- the panel and the plan tool

const TONE_STROKE: Record<Tone, string> = { good: '#1E9E5A', warn: '#E0A100', bad: '#D64545' };
const TONE_CLASS: Record<Tone, string> = { good: 'ok', warn: 'warn', bad: 'err' };

// Which unmapped entries were already placed, per scene, so they leave the "not placed" list when the panel is reopened.
const placedKeys = new Map<string, Set<string>>();

type Mode =
  | { kind: 'select' }
  | { kind: 'real'; furnitureKind: FurnitureKind }
  | { kind: 'virtual'; catalogId: string };

export const step: EditorStep = {
  id: 'furniture',
  title: 'Furniture',
  optional: true,
  mount(panel, ctx) {
    const host = asHost(ctx);
    const draft = ctx.draft;
    const plan = ctx.plan;
    panel.className = 'panel-body step-furniture';

    let disposed = false;
    let mode: Mode = { kind: 'select' };
    let pts: Vec2[] = [];
    let cursor: Vec2 | null = null;
    let armedYaw = 0;
    let selectedId: string | null = null;
    let drag: { id: string; dx: number; dz: number; moved: boolean } | null = null;
    let unmapped: UnmappedEntry[] = [];
    let base: Grid | null = null;
    const baseOf = (): Grid => (base ??= baseGrid(draft.layout));
    const placed = placedKeys.get(ctx.sceneId) ?? new Set<string>();
    placedKeys.set(ctx.sceneId, placed);

    const body = h('div');
    const verdictEl = h('p', { class: 'small' });

    const selected = (): FurnitureItem | null => draft.furniture.find((f) => f.id === selectedId) ?? null;
    const snap = (w: Vec2, e: PointerEvent): Vec2 =>
      e.altKey ? w : snapPoint(w, { rooms: draft.layout.rooms, pxPerMetre: plan.pxPerMetreOnScreen(), hasUnderlay: !!draft.layout.underlay }).point;

    function updateVerdict(): void {
      const it = selected();
      if (!it) { verdictEl.textContent = ''; verdictEl.className = 'small'; return; }
      const v = verdictFor(baseOf(), draft.layout, draft.furniture, it);
      verdictEl.textContent = v.message;
      verdictEl.className = `small ${TONE_CLASS[v.tone]}`;
    }

    const select = (id: string | null): void => { selectedId = id; render(); };

    function instruction(): string {
      if (mode.kind === 'real') {
        if (pts.length === 0) return 'Click 1 of 3: one end of the back edge (the wall side).';
        if (pts.length === 1) return 'Click 2 of 3: the other end of the back edge.';
        return 'Click 3 of 3: anywhere on the front side. That sets the depth.';
      }
      if (mode.kind === 'virtual') return 'Click the plan to drop it. R rotates it 90°. Drag it to move it, Delete removes it.';
      return 'Click a piece to select it, drag to move it, R to rotate it 90°, Delete to remove it.';
    }

    function arm(m: Mode): void {
      mode = m;
      pts = [];
      cursor = null;
      armedYaw = 0;
      plan.setTool(tool);
      render();
    }

    function addItem(item: FurnitureItem): void {
      draft.furniture.push(item);
      selectedId = item.id;
      mode = { kind: 'select' };
      pts = [];
      ctx.commit();
      render();
    }

    function deleteSelected(): void {
      const it = selected();
      if (!it) return;
      draft.furniture = draft.furniture.filter((f) => f.id !== it.id);
      selectedId = null;
      ctx.commit();
      render();
    }

    function rotateSelected(): void {
      const it = selected();
      if (mode.kind === 'virtual') { armedYaw = (armedYaw + 90) % 360; return; }
      if (!it) return;
      const i = draft.furniture.findIndex((f) => f.id === it.id);
      draft.furniture[i] = rotateItem(it, 90);
      ctx.commit();
      render();
    }

    // ------------------------------------------------------------ the tool
    const tool: PlanTool = {
      get cursor() { return mode.kind === 'select' ? 'pointer' : 'crosshair'; },
      onDown(w, e) {
        if (mode.kind === 'select') {
          const it = itemAt(draft.furniture, w);
          drag = it ? { id: it.id, dx: it.box.cx - w.x, dz: it.box.cz - w.z, moved: false } : null;
          select(it?.id ?? null);
          return;
        }
        if (mode.kind === 'real') {
          pts.push(snap(w, e));
          if (pts.length < 3) { render(); return; }
          const item = tagRealItem(mode.furnitureKind, pts[0], pts[1], pts[2], draft.furniture);
          if (!item) {
            host.toast('That is too small. Click the two ends of the back edge, then a point on the front side, at least 20 cm away.', 'warn');
            pts = [];
            render();
            return;
          }
          addItem(item);
          return;
        }
        // virtual: drop it
        const item = dropVirtual(baseOf(), draft.furniture, mode.catalogId, w, armedYaw);
        addItem(item);
      },
      onMove(w, e) {
        cursor = mode.kind === 'real' ? snap(w, e) : w;
        if (drag && (e.buttons & 1)) {
          const i = draft.furniture.findIndex((f) => f.id === drag!.id);
          if (i >= 0) {
            const it = draft.furniture[i];
            draft.furniture[i] = { ...it, box: { ...it.box, cx: r3(w.x + drag.dx), cz: r3(w.z + drag.dz) } };
            drag.moved = true;
            updateVerdict();
          }
        }
      },
      onUp() {
        if (!drag) return;
        const moved = drag.moved;
        const id = drag.id;
        drag = null;
        if (!moved) return;
        const i = draft.furniture.findIndex((f) => f.id === id);
        if (i >= 0 && draft.furniture[i].source === 'virtual') {
          // wall snap on drag release (4.5)
          const it = draft.furniture[i];
          draft.furniture[i] = { ...it, box: roundBox(snapToWalls(gridWithout(baseOf(), draft.furniture, it.id), it.box)) };
        }
        ctx.commit();
        render();
      },
      onKey(e) {
        if (e.key === 'r' || e.key === 'R') { e.preventDefault?.(); rotateSelected(); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
        if (e.key === 'Escape') { mode = { kind: 'select' }; pts = []; render(); }
      },
      cancel() { cursor = null; pts = []; drag = null; },
      draw(g, c) {
        const path = (b: Box): void => {
          const cs = boxCorners(b).map((p) => c.worldToScreen(p));
          g.beginPath();
          g.moveTo(cs[0].x, cs[0].y);
          for (let i = 1; i < 4; i++) g.lineTo(cs[i].x, cs[i].y);
          g.closePath();
        };
        const it = selected();
        if (it) {
          const v = verdictFor(baseOf(), draft.layout, draft.furniture, it);
          path(it.box);
          g.setLineDash([6, 4]);
          g.lineWidth = 3;
          g.strokeStyle = it.source === 'virtual' ? TONE_STROKE[v.tone] : '#1d4ed8';
          g.stroke();
          g.setLineDash([]);
        }
        if (mode.kind === 'virtual' && cursor) {
          const ghost = dropVirtual(baseOf(), draft.furniture, mode.catalogId, cursor, armedYaw);
          const v = verdictFor(baseOf(), draft.layout, [...draft.furniture, ghost], ghost);
          path(ghost.box);
          g.fillStyle = `${TONE_STROKE[v.tone]}55`;
          g.fill();
          g.lineWidth = 2;
          g.strokeStyle = TONE_STROKE[v.tone];
          g.stroke();
        }
        if (mode.kind === 'real' && pts.length > 0) {
          const s = pts.map((p) => c.worldToScreen(p));
          g.lineWidth = 3;
          g.strokeStyle = '#1d4ed8';
          g.fillStyle = '#1d4ed8';
          for (const p of s) { g.beginPath(); g.arc(p.x, p.y, 4, 0, Math.PI * 2); g.fill(); }
          if (pts.length === 1 && cursor) {
            const q = c.worldToScreen(cursor);
            g.beginPath(); g.moveTo(s[0].x, s[0].y); g.lineTo(q.x, q.y); g.stroke();
          } else if (pts.length === 2 && cursor) {
            const b = boxFromBackEdge(pts[0], pts[1], cursor);
            if (b.w > 0.01 && b.d > 0.01) { path(b); g.fillStyle = 'rgba(29,78,216,0.18)'; g.fill(); g.stroke(); }
          }
        }
      },
    };

    // ------------------------------------------------------------ the panel
    function numberField(label: string, value: number, apply: (v: number) => void): HTMLElement {
      const input = h('input', { type: 'number', step: '0.05', min: '0.05', value: String(+value.toFixed(3)) });
      input.addEventListener('change', () => {
        const v = parseFloat((input as HTMLInputElement).value);
        if (Number.isFinite(v) && v > 0) { apply(v); ctx.commit(); render(); }
      });
      return h('label', { class: 'field' }, h('span', { text: label }), input);
    }

    function sizeText(b: Box): string {
      return `${Math.round(b.w * 100)} × ${Math.round(b.d * 100)} cm`;
    }

    function render(): void {
      clear(body);
      body.append(h('p', { class: 'muted small', text: instruction() }));

      // fixed items
      body.append(h('h3', { text: 'Fixed item (already in the flat)' }));
      body.append(h('div', { class: 'segmented' }, ...REAL_KINDS.map((k) =>
        h('button', { class: `btn${mode.kind === 'real' && mode.furnitureKind === k.kind ? ' on' : ''}`, text: k.name, onclick: () => arm({ kind: 'real', furnitureKind: k.kind }) }))));

      // virtual items
      body.append(h('h3', { text: 'Stage virtual furniture' }));
      body.append(h('div', { class: 'presets' }, ...CATALOG.map((c) =>
        h('button', { class: `btn${mode.kind === 'virtual' && mode.catalogId === c.id ? ' on' : ''}`, onclick: () => arm({ kind: 'virtual', catalogId: c.id }) },
          h('strong', { text: c.name }), h('span', { class: 'muted small', text: ` ${c.sizeLabel}` })))));
      body.append(h('button', { class: `btn${mode.kind === 'select' ? ' on' : ''}`, text: 'Select, drag or edit', onclick: () => arm({ kind: 'select' }) }));

      // the selected piece
      const sel = selected();
      if (sel) {
        const i = draft.furniture.findIndex((f) => f.id === sel.id);
        const label = h('input', { type: 'text', value: sel.label }) as HTMLInputElement;
        label.addEventListener('change', () => { draft.furniture[i] = { ...draft.furniture[i], label: label.value.trim() || KIND_NAMES[sel.kind] }; ctx.commit(); render(); });
        body.append(h('div', { class: 'card' },
          h('h3', { text: `${sel.label} (${sel.source === 'real' ? 'fixed' : 'virtual'})` }),
          h('p', { class: 'muted small', text: `${KIND_NAMES[sel.kind]}, ${sizeText(sel.box)}` }),
          h('label', { class: 'field' }, h('span', { text: 'Name' }), label),
          numberField('Height (m)', sel.heightM, (v) => setHeights(draft.furniture[i], v)),
          numberField('Surface height (m): mattress top, seat, table top', sel.surfaceHeightM, (v) => setHeights(draft.furniture[i], undefined, v)),
          sel.heightM > draft.layout.wallHeightM - 0.02 ? h('p', { class: 'err small', text: 'Taller than the ceiling.' }) : null,
          h('div', { class: 'row' },
            h('button', { class: 'btn small', text: 'Rotate 90° (R)', onclick: () => rotateSelected() }),
            h('button', { class: 'btn small', text: 'Delete', onclick: () => deleteSelected() })),
          verdictEl,
        ));
        updateVerdict();
      }

      // the list
      body.append(h('h3', { text: `Furniture (${draft.furniture.length})` }));
      const list = h('ul', { class: 'roomlist' });
      for (const f of draft.furniture) {
        const li = h('li', { class: f.id === selectedId ? 'on' : '' },
          h('span', { class: 'grow' }, h('strong', { text: f.label }), h('br'),
            h('span', { class: 'muted small', text: `${KIND_NAMES[f.kind]}, ${f.source === 'real' ? 'fixed' : 'virtual'}, ${sizeText(f.box)}` })));
        li.addEventListener('click', () => { mode = { kind: 'select' }; plan.setTool(tool); select(f.id); });
        list.append(li);
      }
      if (draft.furniture.length === 0) list.append(h('li', { class: 'muted', text: 'No furniture yet.' }));
      body.append(list);

      // not placed (read-only, from the drawing import)
      const open = unmapped.filter((u) => !placed.has(unmappedKey(u)));
      if (open.length > 0) {
        body.append(h('h3', { text: `Not placed (${open.length})` }));
        body.append(h('p', { class: 'muted small', text: 'The drawing import found these but could not turn them into a box.' }));
        const ul = h('ul', { class: 'roomlist' });
        for (const u of open) {
          const opts = placeOptions(u);
          const size = u.sizeM ? ` ${u.sizeM.w > 0 ? `${u.sizeM.w.toFixed(2)} × ` : ''}${u.sizeM.l.toFixed(2)} m` : '';
          ul.append(h('li', { style: 'cursor:default;flex-wrap:wrap' },
            h('span', { class: 'grow' }, h('strong', { text: `${u.label}${size}` }), h('br'), h('span', { class: 'muted small', text: u.reason || 'Not placed.' })),
            ...opts.map((o) => h('button', { class: 'btn small', text: o.text, onclick: () => {
              const item = placeUnmapped(baseOf(), draft.furniture, u, o);
              placed.add(unmappedKey(u));
              addItem(item);
            } }))));
        }
        body.append(ul);
      }
    }

    clear(panel);
    panel.append(body);
    plan.setTool(tool);
    render();
    void fetchSceneJson(ctx.sceneId, 'proposal-extras.json').then((extras) => {
      if (disposed) return;
      unmapped = parseUnmapped(extras);
      if (unmapped.length > 0) render();
    }).catch(() => { /* no extras: nothing to list */ });
    disposeHook = () => { disposed = true; };
  },
  unmount() {
    disposeHook?.();
    disposeHook = null;
  },
  isDone(ctx) {
    return ctx.draft.furniture.length > 0;
  },
};

let disposeHook: (() => void) | null = null;
