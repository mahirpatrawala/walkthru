// Owned by C6. E5 Finishes (SPEC 2.2): wall height, colour sampled from video frames, tile size.
// The pure part (patches, sample bank, colour get/set, tile options, wall-height parsing) is exported for the headless tests;
// the panel below only wires clicks on frames to it.
import { DEFAULT_FINISHES } from '../../types';
import type { Finishes, Layout, PropertyFile } from '../../types';
import { medianColor } from '../../core/color';
import { parseLength } from '../../core/units';
import type { EditorContext, EditorHost, EditorStep } from '../context';
import { asHost } from '../context';
import { clear, h } from '../dom';

// ---------------------------------------------------------------- pure: patches

/** Each click samples a 15 x 15 px patch (2.2 E5). */
export const PATCH_PX = 15;

export interface PatchRect { x0: number; y0: number; w: number; h: number }

/** The patch centred on (x, y), moved inside the image when the click is near an edge. Smaller only if the image is. */
export function patchRect(imgW: number, imgH: number, x: number, y: number, size: number = PATCH_PX): PatchRect {
  const w = Math.min(size, Math.max(1, Math.floor(imgW)));
  const hh = Math.min(size, Math.max(1, Math.floor(imgH)));
  const x0 = Math.max(0, Math.min(Math.floor(imgW) - w, Math.round(x - w / 2)));
  const y0 = Math.max(0, Math.min(Math.floor(imgH) - hh, Math.round(y - hh / 2)));
  return { x0, y0, w, h: hh };
}

/** Copies the patch around (x, y) out of an RGBA image (row-major, 4 bytes per pixel). */
export function cropPatch(rgba: Uint8ClampedArray, imgW: number, imgH: number, x: number, y: number, size: number = PATCH_PX): { rect: PatchRect; pixels: Uint8ClampedArray } {
  const rect = patchRect(imgW, imgH, x, y, size);
  const pixels = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let j = 0; j < rect.h; j++) {
    const src = ((rect.y0 + j) * imgW + rect.x0) * 4;
    pixels.set(rgba.subarray(src, src + rect.w * 4), j * rect.w * 4);
  }
  return { rect, pixels };
}

// ---------------------------------------------------------------- pure: targets and the sample bank

export type FinishTarget = 'walls' | 'floor' | 'frames';
export const TARGET_NAMES: Record<FinishTarget, string> = { walls: 'Walls', floor: 'Floor', frames: 'Door frames' };

/** `roomId` null means the whole flat. Door frames are only ever global. */
export function targetKey(target: FinishTarget, roomId: string | null): string {
  return `${roomId ?? '*'}|${target}`;
}

export interface PatchRecord { frame: number; x: number; y: number; w: number; h: number; pixels: Uint8ClampedArray }

export class SampleBank {
  private map = new Map<string, PatchRecord[]>();
  add(key: string, rec: PatchRecord): void {
    const list = this.map.get(key) ?? [];
    list.push(rec);
    this.map.set(key, list);
  }
  records(key: string): PatchRecord[] { return this.map.get(key) ?? []; }
  clear(key: string): void { this.map.delete(key); }
  /** "5 patches from 3 frames" */
  counter(key: string): { patches: number; frames: number; text: string } {
    const list = this.records(key);
    const frames = new Set(list.map((r) => r.frame)).size;
    const text = `${list.length} patch${list.length === 1 ? '' : 'es'} from ${frames} frame${frames === 1 ? '' : 's'}`;
    return { patches: list.length, frames, text };
  }
  /** the robust median (4.9) of everything sampled for this target, or null */
  colour(key: string): string | null { return medianColor(this.records(key).map((r) => r.pixels)); }
  anyPatches(): boolean { return this.map.size > 0; }
}

const FINISH_FIELD: Record<FinishTarget, 'wallColor' | 'floorColor' | 'frameColor'> = { walls: 'wallColor', floor: 'floorColor', frames: 'frameColor' };

/** The colour a target currently has: the room's own override if there is one, else the flat's. */
export function currentColour(layout: Layout, target: FinishTarget, roomId: string | null): string {
  const field = FINISH_FIELD[target];
  if (roomId && target !== 'frames') {
    const room = layout.rooms.find((r) => r.id === roomId);
    const own = room ? (target === 'walls' ? room.wallColor : room.floorColor) : undefined;
    if (own) return own;
  }
  return layout.finishes[field];
}

/** True when the target has its own colour (a room override), false when it follows the flat. Always true for global. */
export function hasOwnColour(layout: Layout, target: FinishTarget, roomId: string | null): boolean {
  if (!roomId || target === 'frames') return true;
  const room = layout.rooms.find((r) => r.id === roomId);
  return !!room && !!(target === 'walls' ? room.wallColor : room.floorColor);
}

/**
 * Writes a colour. `fromFrames` marks `finishes.source = 'sampled'` ("sampled when any colour came from video frames", 3.2);
 * a colour typed into the picker leaves `source` alone.
 */
export function setColour(layout: Layout, target: FinishTarget, roomId: string | null, hex: string, fromFrames: boolean): void {
  if (roomId && target !== 'frames') {
    const room = layout.rooms.find((r) => r.id === roomId);
    if (!room) return;
    if (target === 'walls') room.wallColor = hex; else room.floorColor = hex;
  } else {
    layout.finishes[FINISH_FIELD[target]] = hex;
  }
  if (fromFrames) layout.finishes.source = 'sampled';
}

/** Back to the default: the global value returns to DEFAULT_FINISHES, a room override is removed. */
export function resetColour(layout: Layout, target: FinishTarget, roomId: string | null): void {
  if (roomId && target !== 'frames') {
    const room = layout.rooms.find((r) => r.id === roomId);
    if (!room) return;
    if (target === 'walls') delete room.wallColor; else delete room.floorColor;
  } else {
    layout.finishes[FINISH_FIELD[target]] = DEFAULT_FINISHES[FINISH_FIELD[target]];
  }
  const f = layout.finishes;
  const allDefault = f.wallColor === DEFAULT_FINISHES.wallColor && f.floorColor === DEFAULT_FINISHES.floorColor && f.frameColor === DEFAULT_FINISHES.frameColor;
  if (allDefault && layout.rooms.every((r) => !r.wallColor && !r.floorColor)) f.source = 'default';
}

// ---------------------------------------------------------------- pure: tile and wall height

export interface TileOption { id: string; label: string; tile: Finishes['tile'] }
export const TILE_OPTIONS: TileOption[] = [
  { id: 'none', label: 'None', tile: null },
  { id: '600x600', label: '600 × 600 mm', tile: { wM: 0.6, lM: 0.6 } },
  { id: '800x800', label: '800 × 800 mm', tile: { wM: 0.8, lM: 0.8 } },
  { id: '600x1200', label: '600 × 1200 mm', tile: { wM: 0.6, lM: 1.2 } },
];

/** The option id for a stored tile, or 'custom' when it matches none (a hand-edited property.json). */
export function tileOptionId(tile: Finishes['tile']): string {
  if (!tile) return 'none';
  const hit = TILE_OPTIONS.find((o) => o.tile && Math.abs(o.tile.wM - tile.wM) < 1e-6 && Math.abs(o.tile.lM - tile.lM) < 1e-6);
  return hit ? hit.id : 'custom';
}

export function setTile(layout: Layout, optionId: string): void {
  const opt = TILE_OPTIONS.find((o) => o.id === optionId);
  if (!opt) return;
  layout.finishes.tile = opt.tile ? { ...opt.tile } : null;
}

export const WALL_HEIGHT_HINT = 'Usually 2.75 to 3.0 m. Door frames are 2.1 m.';
export const WALL_HEIGHT_MIN_M = 1.8;
export const WALL_HEIGHT_MAX_M = 6;

/** A wall height typed as `2.75`, `2.75 m`, `275 cm` or `9 ft`. Null when unreadable or outside 1.8 to 6 m. */
export function parseWallHeight(text: string): number | null {
  const m = parseLength(text);
  if (m === null || !Number.isFinite(m) || m < WALL_HEIGHT_MIN_M || m > WALL_HEIGHT_MAX_M) return null;
  return Math.round(m * 1000) / 1000;
}

export const COLOUR_NOTE = 'Colours are approximate. Phone video shifts white balance.';

// ---------------------------------------------------------------- the panel

// Patches stay with the draft's scene while the broker moves between steps; a different scene starts empty.
const banks = new Map<string, SampleBank>();
function bankFor(sceneId: string): SampleBank {
  let b = banks.get(sceneId);
  if (!b) { b = new SampleBank(); banks.set(sceneId, b); }
  return b;
}

function maybeHost(ctx: EditorContext): EditorHost | null {
  try { return asHost(ctx); } catch { return null; }
}

function drawFrame(canvas: HTMLCanvasElement, bmp: ImageBitmap, marks: PatchRecord[]): void {
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  g.drawImage(bmp, 0, 0);
  g.lineWidth = 2;
  for (const r of marks) {
    g.strokeStyle = '#ffffff';
    g.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    g.strokeStyle = '#1d4ed8';
    g.strokeRect(r.x - 2.5, r.y - 2.5, r.w + 5, r.h + 5);
  }
}

export const step: EditorStep = {
  id: 'finishes',
  title: 'Finishes',
  mount(panel, ctx) {
    const draft: PropertyFile = ctx.draft;
    const host = maybeHost(ctx);
    const bank = bankFor(ctx.sceneId);
    panel.className = 'panel-body step-finishes';

    let target: FinishTarget = 'walls';
    let roomId: string | null = host?.selection.roomId ?? null;
    if (roomId && !draft.layout.rooms.some((r) => r.id === roomId)) roomId = null;
    let frameIdx = 0;
    let heightError = '';

    const controls = h('div');
    const frameBox = h('div', { class: 'frame-picker' });
    const thumbs = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:4px;margin:6px 0' });
    const bigWrap = h('div');
    frameBox.append(thumbs, bigWrap);
    let big: HTMLCanvasElement | null = null;
    const thumbCanvases = new WeakSet<ImageBitmap>();

    const key = (): string => targetKey(target, target === 'frames' ? null : roomId);

    function redrawBig(): void {
      const bmp = ctx.frames.frames[frameIdx];
      if (!big || !bmp) return;
      drawFrame(big, bmp, bank.records(key()).filter((r) => r.frame === frameIdx));
    }

    function buildFrames(): void {
      const frames = ctx.frames.frames;
      if (frameIdx >= frames.length) frameIdx = Math.max(0, frames.length - 1);
      if (frames.length === 0) {
        clear(thumbs);
        clear(bigWrap);
        big = null;
        bigWrap.append(h('p', { class: 'muted small', text: 'No frames yet. Drop a video or photos in step 1 to sample colours from them. With no frames, the default colours apply, and you can still pick a colour by hand.' }));
        return;
      }
      if (!big) {
        clear(bigWrap);
        big = h('canvas', { style: 'width:100%;height:auto;border-radius:6px;border:1px solid var(--line);cursor:crosshair;display:block' }) as HTMLCanvasElement;
        big.addEventListener('click', (e: MouseEvent) => sampleAt(e));
        bigWrap.append(big, h('p', { class: 'muted small', text: 'Click a patch of clean wall, floor or door frame. Each click samples a 15 × 15 px patch.' }));
      }
      frames.forEach((bmp, i) => {
        if (thumbCanvases.has(bmp)) return;
        thumbCanvases.add(bmp);
        const c = h('canvas', { title: `Frame ${i + 1}`, style: 'height:44px;width:auto;border-radius:4px;border:1px solid var(--line);cursor:pointer' }) as HTMLCanvasElement;
        const k = 44 / Math.max(1, bmp.height);
        c.width = Math.max(1, Math.round(bmp.width * k));
        c.height = 44;
        c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
        c.addEventListener('click', () => { frameIdx = i; redrawBig(); });
        thumbs.append(c);
      });
      redrawBig();
    }

    function sampleAt(e: MouseEvent): void {
      const bmp = ctx.frames.frames[frameIdx];
      if (!big || !bmp) return;
      const box = big.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const x = ((e.clientX - box.left) / box.width) * bmp.width;
      const y = ((e.clientY - box.top) / box.height) * bmp.height;
      const g = big.getContext('2d', { willReadFrequently: true });
      if (!g) return;
      // the canvas shows the frame without marks while we read it: draw clean, read, then draw marks again
      g.drawImage(bmp, 0, 0);
      const rect = patchRect(bmp.width, bmp.height, x, y);
      const data = g.getImageData(rect.x0, rect.y0, rect.w, rect.h).data;
      bank.add(key(), { frame: frameIdx, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, pixels: new Uint8ClampedArray(data) });
      const colour = bank.colour(key());
      if (colour) {
        setColour(draft.layout, target, target === 'frames' ? null : roomId, colour, true);
        ctx.commit();
      }
      redrawBig();
      render();
    }

    function colourRow(): HTMLElement {
      const rid = target === 'frames' ? null : roomId;
      const colour = currentColour(draft.layout, target, rid);
      const picker = h('input', { type: 'color', value: colour.toLowerCase(), title: 'Pick a colour by hand' });
      picker.addEventListener('change', () => {
        setColour(draft.layout, target, rid, (picker as HTMLInputElement).value.toUpperCase(), false);
        ctx.commit();
        render();
      });
      const count = bank.counter(key());
      return h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('span', { class: 'dot', style: `background:${colour};width:28px;height:28px;border-radius:6px` }),
          h('strong', { text: colour.toUpperCase() }), picker,
          h('span', { class: 'grow' }),
          h('button', { class: 'btn small', text: 'Default', title: 'Back to the default colour', onclick: () => {
            resetColour(draft.layout, target, rid);
            bank.clear(key());
            ctx.commit(); redrawBig(); render();
          } })),
        h('p', { class: 'small', text: count.patches > 0 ? count.text : (hasOwnColour(draft.layout, target, rid) ? 'No patches sampled for this yet.' : 'Follows the colour of the whole flat.') }),
        count.patches > 0 ? h('button', { class: 'btn small', text: 'Clear patches', onclick: () => { bank.clear(key()); redrawBig(); render(); } }) : null);
    }

    function render(): void {
      clear(controls);
      const rooms = draft.layout.rooms;

      // wall height
      const heightInput = h('input', { type: 'text', value: `${+draft.layout.wallHeightM.toFixed(3)} m`, title: 'Metres, or 2.75 m, 275 cm, 9 ft' }) as HTMLInputElement;
      heightInput.addEventListener('change', () => {
        const v = parseWallHeight(heightInput.value);
        if (v === null) { heightError = `Type a height between ${WALL_HEIGHT_MIN_M} and ${WALL_HEIGHT_MAX_M} m, for example 2.75.`; }
        else { heightError = ''; draft.layout.wallHeightM = v; ctx.commit(); }
        render();
      });
      controls.append(
        h('label', { class: 'field' }, h('span', { text: 'Wall height' }), heightInput),
        h('p', { class: heightError ? 'err small' : 'muted small', text: heightError || WALL_HEIGHT_HINT }),
      );

      // target
      controls.append(h('h3', { text: 'Sample a colour for' }));
      controls.append(h('div', { class: 'segmented' },
        ...(Object.keys(TARGET_NAMES) as FinishTarget[]).map((t) =>
          h('button', { class: `btn${t === target ? ' on' : ''}`, text: TARGET_NAMES[t], disabled: t === 'frames' && roomId !== null, onclick: () => { target = t; redrawBig(); render(); } }))));
      const scope = h('select') as HTMLSelectElement;
      scope.append(h('option', { value: '', text: 'Whole flat' }), ...rooms.map((r) => h('option', { value: r.id, text: r.label })));
      scope.value = roomId ?? '';
      scope.addEventListener('change', () => {
        roomId = scope.value || null;
        if (roomId && target === 'frames') target = 'walls';
        host?.select({ roomId });
        redrawBig();
        render();
      });
      controls.append(h('label', { class: 'field' }, h('span', { text: target === 'frames' ? 'Door frames apply to the whole flat' : 'Applies to' }), scope));
      controls.append(colourRow());
      controls.append(h('p', { class: 'muted small', text: COLOUR_NOTE }));

      // tile
      const tileId = tileOptionId(draft.layout.finishes.tile);
      const tileSel = h('select') as HTMLSelectElement;
      tileSel.append(...TILE_OPTIONS.map((o) => h('option', { value: o.id, text: o.label })));
      if (tileId === 'custom') {
        const t = draft.layout.finishes.tile!;
        tileSel.append(h('option', { value: 'custom', text: `${Math.round(t.wM * 1000)} × ${Math.round(t.lM * 1000)} mm` }));
      }
      tileSel.value = tileId;
      tileSel.addEventListener('change', () => { setTile(draft.layout, tileSel.value); ctx.commit(); render(); });
      controls.append(h('label', { class: 'field' }, h('span', { text: 'Floor tile size' }), tileSel));

      if (host) {
        controls.append(h('button', { class: `btn${host.previewVisible() ? ' on' : ''}`, text: host.previewVisible() ? 'Hide 3D preview' : 'Show 3D preview', onclick: () => { host.showPreview(!host.previewVisible()); render(); } }));
      }
      if (draft.layout.finishes.source === 'sampled') controls.append(h('p', { class: 'muted small', text: 'Some colours come from your frames.' }));
    }

    clear(panel);
    panel.append(controls, frameBox);
    const off = ctx.frames.onChange(() => { buildFrames(); });
    cleanup = () => { off(); };
    render();
    buildFrames();
    if (host && draft.layout.rooms.length > 0) { host.showPreview(true); render(); }
  },
  unmount() {
    cleanup?.();
    cleanup = null;
  },
  isDone(ctx) {
    // With no frames the defaults apply, so a flat with rooms and readable finishes is done.
    const f = ctx.draft.layout.finishes;
    const hex = /^#[0-9a-fA-F]{6}$/;
    return ctx.draft.layout.rooms.length > 0 && hex.test(f.wallColor) && hex.test(f.floorColor) && hex.test(f.frameColor);
  },
};

let cleanup: (() => void) | null = null;
