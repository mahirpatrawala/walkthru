// Mounts the C5 step panels against a stub DOM and a fake plan canvas, and drives their tools with the same pointer calls the
// canvas makes. Not a browser: it proves the logic wiring (tools -> draft -> commit), not rendering or real pointer events.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomStub, StubEl } from './dom-stub';
import type { EditorContext, EditorHost, PlanCanvas, PlanTool, Selection } from '../src/editor/context';
import type { FrameStore } from '../src/editor/context';
import { createEmptyProperty } from '../src/core/layout-validate';
import { polygonArea } from '../src/core/geometry';
import { pxToWorld } from '../src/core/plan-scale';
import type { PropertyFile } from '../src/types';

installDomStub();
const asEl = (p: StubEl): HTMLElement => p as unknown as HTMLElement;
const { step: rooms } = await import('../src/editor/steps/rooms');
const { step: openings } = await import('../src/editor/steps/openings');
const { step: scale } = await import('../src/editor/steps/scale');
const { step: media, onMediaDropped } = await import('../src/editor/steps/media');

interface Rig { host: EditorHost; draft: PropertyFile; plan: PlanCanvas & { tool: PlanTool | null }; commits: number; toasts: string[]; panel: StubEl; frames: FrameStore & { videos: File[]; images: File[][] } }

function rig(opts?: { underlay?: boolean; exists?: string[] }): Rig {
  const draft = createEmptyProperty('rig');
  if (opts?.underlay) draft.layout.underlay = { file: 'plan.png', pxPerM: 50, originPx: { x: 100, y: 100 }, dimensions: [], disagreementPct: 0 };
  const selection: Selection = { roomId: null, openingId: null };
  const toasts: string[] = [];
  const plan = {
    tool: null as PlanTool | null,
    refresh() {}, redraw() {},
    screenToWorld: (x: number, y: number) => ({ x, z: y }), worldToScreen: (v: { x: number; z: number }) => ({ x: v.x * 80, y: v.z * 80 }),
    setTool(t: PlanTool | null) { if (this.tool && this.tool !== t) this.tool.cancel?.(); this.tool = t; },
    addLayer: () => () => {}, setUnderlayImage() {}, pxPerMetreOnScreen: () => 80,
  };
  const frames = { frames: [] as ImageBitmap[], videos: [] as File[], images: [] as File[][], onChange: () => () => {}, async addVideo(f: File) { this.videos.push(f); }, async addImages(f: File[]) { this.images.push(f); } };
  const r: Rig = { draft, plan, commits: 0, toasts, panel: new StubEl('DIV'), frames } as unknown as Rig;
  const host = {
    sceneId: 'rig', draft, selection, plan, frames,
    commit() { r.commits++; },
    grid: () => { throw new Error('unused'); },
    get viewer(): never { throw new Error('unused'); },
    api: { saveProperty: async () => {}, saveFile: async () => {}, exists: async (n: string) => (opts?.exists ?? []).includes(n) },
    select(s: Partial<Selection>) { if (s.roomId !== undefined) selection.roomId = s.roomId; if (s.openingId !== undefined) selection.openingId = s.openingId; },
    toast: (t: string) => { toasts.push(t); },
    setImportNotes: vi.fn(), fitPlan: vi.fn(), applyUnderlay: vi.fn(), goto: vi.fn(), loadScene: async () => ({ found: false }),
    underlayImage: null, validation: () => ({ errors: [], warnings: [], importNotes: [] }), showPreview() {}, previewVisible: () => false, setSceneId() {},
  } as unknown as EditorHost;
  r.host = host;
  return r;
}
const ptr = (x = 0, y = 0, extra: Record<string, unknown> = {}): PointerEvent => ({ clientX: x, clientY: y, altKey: false, buttons: 1, ...extra }) as unknown as PointerEvent;

describe('registry', () => {
  it('registers eight steps, E1 to E8, in order', async () => {
    // main.ts boots the page on import and needs a real document, so the order is asserted from the source
    const src = (await import('node:fs')).readFileSync(new URL('../src/editor/main.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/STEPS: EditorStep\[\] = \[media, scale, rooms, openings, finishes, furniture, scan, spawn\]/);
  });
});

describe('E3 rooms step', () => {
  let r: Rig;
  beforeEach(() => { r = rig(); rooms.mount(asEl(r.panel), r.host); });

  it('the rectangle tool: drag corner to corner, snapped to the 5 cm grid on a blank canvas', () => {
    const t = r.plan.tool!;
    t.onDown!({ x: 0.012, z: 0.02 }, ptr(100, 100));
    t.onMove!({ x: 2, z: 2 }, ptr(200, 200));
    t.onUp!({ x: 4.01, z: 5.02 }, ptr(400, 500));
    expect(r.draft.layout.rooms).toHaveLength(1);
    const room = r.draft.layout.rooms[0];
    expect(room.polygon[0]).toEqual({ x: 0, z: 0 });
    expect(polygonArea(room.polygon)).toBeCloseTo(20, 9);
    expect(room.label).toBe('Bedroom 1');
    expect(r.commits).toBeGreaterThan(0);
    expect(r.host.selection.roomId).toBe(room.id);
  });
  it('click, then click again also draws a rectangle; a tiny one is refused', () => {
    const t = r.plan.tool!;
    t.onDown!({ x: 1, z: 1 }, ptr(80, 80)); t.onUp!({ x: 1, z: 1 }, ptr(80, 80));
    expect(r.draft.layout.rooms).toHaveLength(0);
    t.onDown!({ x: 3, z: 4 }, ptr(240, 320)); t.onUp!({ x: 3, z: 4 }, ptr(240, 320));
    expect(r.draft.layout.rooms).toHaveLength(1);
    expect(polygonArea(r.draft.layout.rooms[0].polygon)).toBeCloseTo(6, 9);
    t.onDown!({ x: 8, z: 8 }, ptr()); t.onUp!({ x: 8, z: 8 }, ptr());
    t.onDown!({ x: 8.1, z: 8.1 }, ptr());
    expect(r.draft.layout.rooms).toHaveLength(1);
    expect(r.toasts.join(' ')).toMatch(/too small/);
  });
  it('the polygon tool closes with Enter and with a click on the first corner', () => {
    r.panel.byText('button', 'Polygon').click();
    let t = r.plan.tool!;
    for (const p of [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }]) t.onDown!(p, ptr());
    t.onKey!({ key: 'Enter' } as KeyboardEvent);
    expect(r.draft.layout.rooms).toHaveLength(1);
    expect(polygonArea(r.draft.layout.rooms[0].polygon)).toBeCloseTo(12, 9); // an L shape
    t = r.plan.tool!;
    for (const p of [{ x: 10, z: 0 }, { x: 13, z: 0 }, { x: 13, z: 3 }]) t.onDown!(p, ptr());
    t.onDown!({ x: 10.02, z: 0.02 }, ptr()); // within 8 px of the first corner at 80 px/m
    expect(r.draft.layout.rooms).toHaveLength(2);
  });
  it('a self-crossing outline is refused', () => {
    r.panel.byText('button', 'Polygon').click();
    const t = r.plan.tool!;
    for (const p of [{ x: 0, z: 0 }, { x: 4, z: 4 }, { x: 4, z: 0 }, { x: 0, z: 4 }]) t.onDown!(p, ptr());
    t.onKey!({ key: 'Enter' } as KeyboardEvent);
    expect(r.draft.layout.rooms).toHaveLength(0);
    expect(r.toasts.join(' ')).toMatch(/crosses itself/);
  });
  it('select tool: clicking an edge cycles wall, railing, none; clicking inside selects', () => {
    const t = r.plan.tool!;
    t.onDown!({ x: 0, z: 0 }, ptr()); t.onUp!({ x: 4, z: 5 }, ptr(400, 400));
    r.panel.byText('button', 'Select and edges').click();
    const sel = r.plan.tool!;
    sel.onDown!({ x: 2, z: 0.02 }, ptr());
    expect(r.draft.layout.rooms[0].edges[0]).toBe('railing');
    sel.onDown!({ x: 2, z: 0.02 }, ptr());
    expect(r.draft.layout.rooms[0].edges[0]).toBe('none');
    sel.onDown!({ x: 2, z: 0.02 }, ptr());
    expect(r.draft.layout.rooms[0].edges[0]).toBe('wall');
    sel.onDown!({ x: 2, z: 2.5 }, ptr());
    expect(r.host.selection.roomId).toBe(r.draft.layout.rooms[0].id);
    sel.onDown!({ x: 9, z: 9 }, ptr());
    expect(r.host.selection.roomId).toBeNull();
  });
  it('the typed size field resizes the selected rectangle about its first corner', () => {
    const t = r.plan.tool!;
    t.onDown!({ x: 1, z: 1 }, ptr()); t.onUp!({ x: 5, z: 6 }, ptr(400, 400));
    const size = r.panel.all().find((e) => e.tagName === 'INPUT' && e.attrs.placeholder?.startsWith('4.0 x 5.0'))!;
    size.value = `13'1" x 16'5"`;
    size.dispatch('keydown', { key: 'Enter' });
    const room = r.draft.layout.rooms[0];
    expect(room.polygon[0]).toEqual({ x: 1, z: 1 });
    expect(polygonArea(room.polygon)).toBeCloseTo(3.988 * 5.004, 2);
    const again = r.panel.all().find((e) => e.tagName === 'INPUT' && e.attrs.placeholder?.startsWith('4.0 x 5.0'))!; // the panel was rebuilt
    again.value = 'banana';
    again.dispatch('keydown', { key: 'Enter' });
    expect(r.panel.textContent).toMatch(/Could not read that size/);
  });
  it('the tile helper sets the width from a tile count', () => {
    const t = r.plan.tool!;
    t.onDown!({ x: 0, z: 0 }, ptr()); t.onUp!({ x: 4, z: 5 }, ptr(400, 400));
    r.panel.all().filter((e) => e.tagName === 'BUTTON' && e.textContent === 'Use as width')[0].click(); // 6.5 x 600 mm = 3.90 m
    const info = r.draft.layout.rooms[0].polygon;
    expect(Math.max(...info.map((p) => p.x))).toBeCloseTo(3.9, 9);
  });
  it('delete removes the room', () => {
    const t = r.plan.tool!;
    t.onDown!({ x: 0, z: 0 }, ptr()); t.onUp!({ x: 4, z: 5 }, ptr(400, 400));
    r.panel.byText('button', 'Delete').click();
    expect(r.draft.layout.rooms).toHaveLength(0);
  });
});

describe('E3 Load proposal', () => {
  it('shows the button only when proposal.json exists, loads it, and shows the extras warnings', async () => {
    const proposal = { version: 1, source: 'drawing-import', confidence: 0.8, wallHeightM: 2.7,
      rooms: [{ id: 'r1', roomType: 'bedroom', label: 'Son room', polygon: [{ x: 0, z: 0 }, { x: 3.4, z: 0 }, { x: 3.4, z: 4.5 }, { x: 0, z: 4.5 }], edges: ['wall', 'wall', 'wall', 'wall'] }],
      openings: [] };
    const extras = { version: 1, warnings: ['Window heights are assumed.'] };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      const body = u.includes('proposal-extras.json') ? extras : u.includes('proposal.json') ? proposal : null;
      return body ? { ok: true, text: async () => JSON.stringify(body) } : { ok: false, text: async () => '' };
    }) as unknown as typeof fetch;
    try {
      const none = rig();
      rooms.mount(asEl(none.panel), none.host);
      await new Promise((r) => setTimeout(r, 0));
      expect(none.panel.all().some((e) => e.textContent === 'Load proposal')).toBe(false);

      const r = rig({ exists: ['proposal.json'] });
      rooms.mount(asEl(r.panel), r.host);
      await new Promise((r2) => setTimeout(r2, 0));
      r.panel.byText('button', 'Load proposal').click();
      await new Promise((r2) => setTimeout(r2, 5));
      expect(r.draft.layout.rooms.map((x) => x.label)).toEqual(['Son room']);
      expect(r.draft.layout.wallHeightM).toBe(2.7);
      const notes = (r.host.setImportNotes as unknown as { mock: { calls: string[][][] } }).mock.calls[0][0];
      expect(notes.join(' ')).toMatch(/Window heights are assumed/);
      expect(notes.join(' ')).toMatch(/80%/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('E4 openings step', () => {
  it('place a preset on a wall, edit it, drag it, delete it', () => {
    const r = rig();
    rooms.mount(asEl(r.panel), r.host);
    r.plan.tool!.onDown!({ x: 0, z: 0 }, ptr()); r.plan.tool!.onUp!({ x: 4, z: 5 }, ptr(400, 400));
    const p2 = new StubEl('DIV');
    openings.mount(asEl(p2), r.host);
    p2.byText('button', /Main door/).click();
    r.plan.tool!.onMove!({ x: 1.3, z: 4.97 }, ptr());
    r.plan.tool!.onDown!({ x: 1.3, z: 4.97 }, ptr());
    expect(r.draft.layout.openings).toHaveLength(1);
    const o = r.draft.layout.openings[0];
    expect(o).toMatchObject({ edge: 2, type: 'door', widthM: 0.9 });
    expect(o.centreM).toBeCloseTo(2.7, 9);
    expect(r.host.selection.openingId).toBe(o.id);
    // select mode: drag it
    r.plan.tool!.onDown!({ x: 1.3, z: 4.99 }, ptr());
    r.plan.tool!.onMove!({ x: 2.5, z: 4.99 }, ptr(0, 0, { buttons: 1 }));
    r.plan.tool!.onUp!({ x: 2.5, z: 4.99 }, ptr());
    expect(r.draft.layout.openings[0].centreM).toBeCloseTo(1.5, 9);
    // edit the width
    const width = p2.all().find((e) => e.tagName === 'INPUT' && e.attrs.step === '0.05')!;
    width.value = '1.0';
    width.dispatch('change');
    expect(r.draft.layout.openings[0].widthM).toBe(1);
    p2.byText('button', 'Delete').click();
    expect(r.draft.layout.openings).toHaveLength(0);
    expect(r.plan.tool).not.toBeNull();
  });
  it('a click away from every wall places nothing and says so', () => {
    const r = rig();
    rooms.mount(asEl(r.panel), r.host);
    r.plan.tool!.onDown!({ x: 0, z: 0 }, ptr()); r.plan.tool!.onUp!({ x: 4, z: 5 }, ptr(400, 400));
    const p2 = new StubEl('DIV');
    openings.mount(asEl(p2), r.host);
    r.plan.tool!.onDown!({ x: 2, z: 2.5 }, ptr());
    expect(r.draft.layout.openings).toHaveLength(0);
    expect(r.toasts.join(' ')).toMatch(/Click on a wall/);
  });
});

describe('E2 scale step', () => {
  it('without a plan it says the grid is metric and is done', () => {
    const r = rig();
    const p = new StubEl('DIV');
    scale.mount(asEl(p), r.host);
    expect(p.textContent).toMatch(/metric grid/);
    expect(p.textContent).toMatch(/Indian standards/);
    expect(scale.isDone(r.host)).toBe(true);
  });
  it('with a plan: two clicks, a typed length, then the second dimension, and the message', () => {
    const r = rig({ underlay: true });
    const p = new StubEl('DIV');
    scale.mount(asEl(p), r.host);
    expect(scale.isDone(r.host)).toBe(false);
    const t = r.plan.tool!;
    const world = (px: { x: number; y: number }) => pxToWorld(px, r.draft.layout.underlay!); // the canvas converts a click on the image with the CURRENT scale
    const add = (a: { x: number; y: number }, b: { x: number; y: number }, text: string): void => {
      t.onDown!(world(a), ptr()); t.onDown!(world(b), ptr());
      const input = p.all().find((e) => e.tagName === 'INPUT')!;
      input.value = text;
      input.dispatch('keydown', { key: 'Enter' });
    };
    add({ x: 100, y: 100 }, { x: 312, y: 100 }, `13'1"`);      // 212 px over 3.988 m = 53.16 px/m
    expect(r.draft.layout.underlay!.dimensions).toHaveLength(1);
    expect(p.textContent).toMatch(/Add a second dimension/);
    add({ x: 100, y: 100 }, { x: 100, y: 365 }, `16'5"`);       // 265 px over 5.004 m = 52.96 px/m
    const u = r.draft.layout.underlay!;
    expect(u.dimensions).toHaveLength(2);
    expect(u.pxPerM).toBeCloseTo(53.06, 1);
    expect(p.textContent).toMatch(/53\.1 px per metre\. The two dimensions agree within 0\.4%\./);
    expect(scale.isDone(r.host)).toBe(true);
    // a bad length is refused
    t.onDown!({ x: 0, z: 0 }, ptr()); t.onDown!({ x: 1, z: 0 }, ptr());
    const input = p.all().find((e) => e.tagName === 'INPUT')!;
    input.value = 'lots';
    input.dispatch('keydown', { key: 'Enter' });
    expect(p.textContent).toMatch(/Could not read that length/);
    expect(u.dimensions).toHaveLength(2);
  });
  it('dimensions that disagree by more than 3% get the warning', () => {
    const r = rig({ underlay: true });
    const p = new StubEl('DIV');
    scale.mount(asEl(p), r.host);
    const t = r.plan.tool!;
    for (const [b, text] of [[{ x: 4, z: 0 }, '4 m'], [{ x: 0, z: 4 }, '3.7 m']] as const) {
      t.onDown!({ x: 0, z: 0 }, ptr()); t.onDown!(b, ptr());
      const input = p.all().find((e) => e.tagName === 'INPUT')!;
      input.value = text;
      input.dispatch('keydown', { key: 'Enter' });
    }
    expect(p.textContent).toMatch(/These two disagree by 7\.8%\. Check what you typed, or the plan image may be stretched\./);
  });
});

describe('E1 media step', () => {
  it('onMediaDropped (the C9 hook) feeds the in-browser FrameStore: videos to addVideo, photos to addImages', async () => {
    const r = rig();
    const p = new StubEl('DIV');
    media.mount(asEl(p), r.host);
    const v = new File([new Uint8Array(4)], 'walk.mp4', { type: 'video/mp4' });
    const i1 = new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' });
    const i2 = new File([new Uint8Array(4)], 'b.png', { type: 'image/png' });
    await onMediaDropped([v, i1, i2]);
    expect(r.frames.videos).toEqual([v]);
    expect(r.frames.images).toEqual([[i1, i2]]);
    expect(p.textContent).toMatch(/Floor plan image/);
    expect(p.textContent).toMatch(/3D scan \(optional\)/);
    media.unmount();
    await expect(onMediaDropped([v])).rejects.toThrow(/not ready/);
  });
  it('is done once the scene id is valid and there is a plan, frames or rooms', () => {
    const r = rig();
    expect(media.isDone(r.host)).toBe(false);
    r.draft.layout.rooms.push({ id: 'a', roomType: 'other', label: 'a', polygon: [], edges: [] });
    expect(media.isDone(r.host)).toBe(true);
  });
});
