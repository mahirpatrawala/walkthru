// C6 headless tests: medianColor (4.9), the E5 / E6 / E8 pure helpers, and the three step panels mounted on a stub DOM and driven
// with the same pointer calls the plan canvas makes. Not a browser: real canvas sampling, pointer events and layout are not covered.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installDomStub, StubEl } from './dom-stub';
import { buildTruthProperty, truthGrid } from '../scripts/make-test-room';
import { medianColor } from '../src/core/color';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { circleFree } from '../src/core/grid-query';
import { CHARACTER_RADIUS_M, DEFAULT_FINISHES } from '../src/types';
import type { FurnitureItem, PropertyFile } from '../src/types';
import type { EditorHost, FrameStore, PlanCanvas, PlanTool, Selection } from '../src/editor/context';

installDomStub();
const asEl = (p: StubEl): HTMLElement => p as unknown as HTMLElement;
const fin = await import('../src/editor/steps/finishes');
const fur = await import('../src/editor/steps/furniture');
const spw = await import('../src/editor/steps/spawn');

// ---------------------------------------------------------------- rig

interface Rig { host: EditorHost; draft: PropertyFile; plan: PlanCanvas & { tool: PlanTool | null }; commits: number; toasts: string[]; panel: StubEl }

let sceneCounter = 0;
function rig(mutate?: (d: PropertyFile) => void): Rig {
  const draft = buildTruthProperty('empty');
  mutate?.(draft);
  const selection: Selection = { roomId: null, openingId: null };
  const toasts: string[] = [];
  const plan = {
    tool: null as PlanTool | null,
    refresh() {}, redraw() {},
    screenToWorld: (x: number, y: number) => ({ x, z: y }), worldToScreen: (v: { x: number; z: number }) => ({ x: v.x * 80, y: v.z * 80 }),
    setTool(t: PlanTool | null) { if (this.tool && this.tool !== t) this.tool.cancel?.(); this.tool = t; },
    addLayer: () => () => {}, setUnderlayImage() {}, pxPerMetreOnScreen: () => 80,
  };
  const frames: FrameStore = { frames: [], onChange: () => () => {}, async addVideo() {}, async addImages() {} };
  const r = { draft, plan, commits: 0, toasts, panel: new StubEl('DIV') } as unknown as Rig;
  const sceneId = `c6-${++sceneCounter}`;
  r.host = {
    sceneId, draft, selection, plan, frames,
    commit() { r.commits++; },
    grid: () => stampFurniture(rasterizeLayout(draft.layout), draft.furniture),
    get viewer(): never { throw new Error('unused'); },
    api: { saveProperty: async () => {}, saveFile: async () => {}, exists: async () => false },
    select(s: Partial<Selection>) { if (s.roomId !== undefined) selection.roomId = s.roomId; if (s.openingId !== undefined) selection.openingId = s.openingId; },
    toast: (t: string) => { toasts.push(t); },
    setImportNotes: vi.fn(), fitPlan: vi.fn(), applyUnderlay: vi.fn(), goto: vi.fn(), loadScene: async () => ({ found: false }),
    underlayImage: null, validation: () => ({ errors: [], warnings: [], importNotes: [] }), showPreview() {}, previewVisible: () => false, setSceneId() {},
  } as unknown as EditorHost;
  return r;
}
const ptr = (buttons = 1, extra: Record<string, unknown> = {}): PointerEvent => ({ clientX: 0, clientY: 0, altKey: false, buttons, ...extra }) as unknown as PointerEvent;
const selectsOf = (p: StubEl): StubEl[] => p.all().filter((e) => e.tagName === 'SELECT');
const optionTexts = (s: StubEl): string[] => s.all().filter((e) => e.tagName === 'OPTION').map((e) => e.textContent);

afterEach(() => { delete (globalThis as { fetch?: unknown }).fetch; });

// ---------------------------------------------------------------- color.ts

function solid(hex: string, n: number): Uint8ClampedArray {
  const v = parseInt(hex.slice(1), 16);
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { a[i * 4] = (v >> 16) & 255; a[i * 4 + 1] = (v >> 8) & 255; a[i * 4 + 2] = v & 255; a[i * 4 + 3] = 255; }
  return a;
}
const chan = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('medianColor (4.9, acceptance)', () => {
  it('1000 px of #E8E4DA plus 150 white and 100 near-black outliers returns #E8E4DA within 2 per channel', () => {
    const patches = [solid('#E8E4DA', 1000), solid('#FFFFFF', 150), solid('#050505', 100)];
    const out = medianColor(patches)!;
    console.log('medianColor with outliers ->', out);
    const [r, g, b] = chan(out);
    expect(Math.abs(r - 0xe8)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - 0xe4)).toBeLessThanOrEqual(2);
    expect(Math.abs(b - 0xda)).toBeLessThanOrEqual(2);
    expect(out).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('the same pixels spread over several patches give the same answer (all patches are pooled)', () => {
    const all = [solid('#E8E4DA', 1000), solid('#FFFFFF', 150), solid('#050505', 100)];
    const split = [all[0].slice(0, 400), all[0].slice(400), all[1], all[2]];
    expect(medianColor(split)).toBe(medianColor(all));
  });
  it('empty input, empty patches and fully transparent patches return null', () => {
    expect(medianColor([])).toBeNull();
    expect(medianColor([new Uint8ClampedArray(0)])).toBeNull();
    expect(medianColor([new Uint8ClampedArray(16)])).toBeNull();
  });
  it('a single pixel returns that pixel; a noisy wall lands on its true colour', () => {
    expect(medianColor([new Uint8ClampedArray([10, 20, 30, 255])])).toBe('#0A141E');
    const noisy = new Uint8ClampedArray(2000 * 4);
    let seed = 7;
    const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let i = 0; i < 2000; i++) {
      const j = Math.round((rnd() - 0.5) * 10);
      noisy.set([200 + j, 190 + j, 170 + j, 255], i * 4);
    }
    const [r, g, b] = chan(medianColor([noisy])!);
    expect(Math.abs(r - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - 190)).toBeLessThanOrEqual(2);
    expect(Math.abs(b - 170)).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------- E5

describe('E5 finishes: pure helpers', () => {
  it('patchRect is 15 x 15 around the click and slides inside the image at an edge', () => {
    expect(fin.patchRect(100, 80, 50, 40)).toEqual({ x0: 43, y0: 33, w: 15, h: 15 });
    expect(fin.patchRect(100, 80, 1, 2)).toEqual({ x0: 0, y0: 0, w: 15, h: 15 });
    expect(fin.patchRect(100, 80, 99, 79)).toEqual({ x0: 85, y0: 65, w: 15, h: 15 });
    expect(fin.patchRect(10, 10, 5, 5)).toEqual({ x0: 0, y0: 0, w: 10, h: 10 });
  });
  it('cropPatch copies exactly the pixels of the patch', () => {
    const W = 40, H = 30;
    const img = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.set([x, y, 0, 255], (y * W + x) * 4);
    const { rect, pixels } = fin.cropPatch(img, W, H, 20, 15);
    expect(pixels.length).toBe(15 * 15 * 4);
    expect([pixels[0], pixels[1]]).toEqual([rect.x0, rect.y0]);
    const last = pixels.length - 4;
    expect([pixels[last], pixels[last + 1]]).toEqual([rect.x0 + 14, rect.y0 + 14]);
  });
  it('the sample bank counts "5 patches from 3 frames" and the colour is the robust median of them', () => {
    const bank = new fin.SampleBank();
    const k = fin.targetKey('walls', null);
    const frames = [0, 0, 1, 2, 2];
    frames.forEach((f, i) => bank.add(k, { frame: f, x: i, y: 0, w: 15, h: 15, pixels: solid('#E8E4DA', 225) }));
    expect(bank.counter(k).text).toBe('5 patches from 3 frames');
    bank.add(k, { frame: 3, x: 0, y: 0, w: 15, h: 15, pixels: solid('#FFFFFF', 225) }); // a blown-out patch
    expect(bank.counter(k).text).toBe('6 patches from 4 frames');
    expect(chan(bank.colour(k)!).map((c, i) => Math.abs(c - chan('#E8E4DA')[i])).every((d) => d <= 2)).toBe(true);
    expect(new fin.SampleBank().counter(k).text).toBe('0 patches from 0 frames');
    expect(bank.counter(fin.targetKey('floor', null)).patches).toBe(0);
  });
  it('a sampled colour goes to the global finish, or to the room when a room is chosen, and marks source "sampled"', () => {
    const d = buildTruthProperty('empty');
    d.layout.finishes = { ...DEFAULT_FINISHES };
    fin.setColour(d.layout, 'walls', null, '#AABBCC', true);
    expect(d.layout.finishes.wallColor).toBe('#AABBCC');
    expect(d.layout.finishes.source).toBe('sampled');
    const room = d.layout.rooms[0];
    fin.setColour(d.layout, 'floor', room.id, '#112233', true);
    expect(room.floorColor).toBe('#112233');
    expect(d.layout.finishes.floorColor).toBe(DEFAULT_FINISHES.floorColor);
    expect(fin.currentColour(d.layout, 'floor', room.id)).toBe('#112233');
    expect(fin.currentColour(d.layout, 'floor', d.layout.rooms[1].id)).toBe(DEFAULT_FINISHES.floorColor);
    fin.setColour(d.layout, 'frames', room.id, '#445566', true); // door frames are never per room
    expect(d.layout.finishes.frameColor).toBe('#445566');
    expect(room.wallColor).toBeUndefined();
  });
  it('a hand-picked colour leaves source alone; reset returns to the defaults and to source "default"', () => {
    const d = buildTruthProperty('empty');
    d.layout.finishes = { ...DEFAULT_FINISHES };
    fin.setColour(d.layout, 'walls', null, '#AABBCC', false);
    expect(d.layout.finishes.source).toBe('default');
    fin.setColour(d.layout, 'walls', null, '#AABBCC', true);
    fin.setColour(d.layout, 'floor', d.layout.rooms[0].id, '#112233', true);
    fin.resetColour(d.layout, 'walls', null);
    expect(d.layout.finishes.wallColor).toBe(DEFAULT_FINISHES.wallColor);
    expect(d.layout.finishes.source).toBe('sampled'); // the room floor is still sampled
    fin.resetColour(d.layout, 'floor', d.layout.rooms[0].id);
    expect(d.layout.rooms[0].floorColor).toBeUndefined();
    expect(d.layout.finishes.source).toBe('default');
  });
  it('tile options: None, 600 x 600, 800 x 800, 600 x 1200', () => {
    expect(fin.TILE_OPTIONS.map((o) => o.label)).toEqual(['None', '600 × 600 mm', '800 × 800 mm', '600 × 1200 mm']);
    const d = buildTruthProperty('empty');
    fin.setTile(d.layout, '600x1200');
    expect(d.layout.finishes.tile).toEqual({ wM: 0.6, lM: 1.2 });
    expect(fin.tileOptionId(d.layout.finishes.tile)).toBe('600x1200');
    fin.setTile(d.layout, 'none');
    expect(d.layout.finishes.tile).toBeNull();
    expect(fin.tileOptionId({ wM: 0.45, lM: 0.45 })).toBe('custom');
  });
  it('wall height accepts metres, cm and feet and refuses nonsense', () => {
    expect(fin.parseWallHeight('2.75')).toBe(2.75);
    expect(fin.parseWallHeight('3 m')).toBe(3);
    expect(fin.parseWallHeight('285 cm')).toBe(2.85);
    expect(fin.parseWallHeight('10 ft')).toBeCloseTo(3.048, 3);
    expect(fin.parseWallHeight('27.5')).toBeNull();
    expect(fin.parseWallHeight('abc')).toBeNull();
    expect(fin.parseWallHeight('1')).toBeNull();
  });
});

describe('E5 finishes: panel', () => {
  it('shows the wall-height hint, the colour note, and a tile dropdown that writes the draft and commits', () => {
    const r = rig();
    fin.step.mount(asEl(r.panel), r.host);
    const text = r.panel.textContent;
    expect(text).toContain('Usually 2.75 to 3.0 m. Door frames are 2.1 m.');
    expect(text).toContain('Colours are approximate. Phone video shifts white balance.');
    expect(text).toContain('No frames yet');
    const tile = selectsOf(r.panel).find((s) => optionTexts(s).includes('600 × 1200 mm'))!;
    const before = r.commits;
    tile.value = '800x800';
    tile.dispatch('change');
    expect(r.draft.layout.finishes.tile).toEqual({ wM: 0.8, lM: 0.8 });
    expect(r.commits).toBeGreaterThan(before);
    fin.step.unmount();
  });
  it('wall height field: valid value updates the draft, bad value shows an error and changes nothing', () => {
    const r = rig();
    fin.step.mount(asEl(r.panel), r.host);
    const input = (): StubEl => r.panel.all().find((e) => e.tagName === 'INPUT' && e.attrs.title?.includes('Metres'))!;
    input().value = '2.9 m';
    input().dispatch('change');
    expect(r.draft.layout.wallHeightM).toBe(2.9);
    input().value = 'tall';
    input().dispatch('change');
    expect(r.draft.layout.wallHeightM).toBe(2.9);
    expect(r.panel.textContent).toContain('Type a height between');
    fin.step.unmount();
  });
  it('the target scope lists the rooms; a room target writes the room override only', () => {
    const r = rig();
    fin.step.mount(asEl(r.panel), r.host);
    const scope = selectsOf(r.panel).find((s) => optionTexts(s).includes('Whole flat'))!;
    expect(optionTexts(scope)).toEqual(['Whole flat', ...r.draft.layout.rooms.map((x) => x.label)]);
    scope.value = r.draft.layout.rooms[0].id;
    scope.dispatch('change');
    const picker2 = r.panel.all().find((e) => e.attrs.type === 'color')!;
    expect(picker2).toBeDefined();
    picker2.value = '#336699';
    picker2.dispatch('change');
    expect(r.draft.layout.rooms[0].wallColor).toBe('#336699');
    expect(r.draft.layout.finishes.wallColor).toBe(buildTruthProperty('empty').layout.finishes.wallColor);
    fin.step.unmount();
  });
  it('is done once the flat has rooms and readable finishes (defaults apply without frames)', () => {
    const r = rig();
    expect(fin.step.isDone(r.host)).toBe(true);
    const empty = rig((d) => { d.layout.rooms = []; d.layout.openings = []; });
    expect(fin.step.isDone(empty.host)).toBe(false);
  });
});

// ---------------------------------------------------------------- E6

describe('E6 furniture: pure helpers', () => {
  it('tagRealItem uses boxFromBackEdge: the truth bed from its back edge, with the real-bed defaults', () => {
    const it = fur.tagRealItem('bed', { x: 0, z: 1.5 }, { x: 0, z: 3.0 }, { x: 1.2, z: 2 }, [])!;
    expect(it.source).toBe('real');
    expect(it.kind).toBe('bed');
    expect(it.box.w).toBeCloseTo(1.5, 9);
    expect(it.box.d).toBeCloseTo(1.2, 9);
    expect(it.box.yawDeg % 360).toBeCloseTo(90, 6);
    expect(it.box.cx).toBeCloseTo(0.6, 9);
    expect(it.box.cz).toBeCloseTo(2.25, 9);
    expect([it.heightM, it.surfaceHeightM]).toEqual([0.55, 0.5]);
    const sofa = fur.tagRealItem('sofa', { x: 4, z: 2.5 }, { x: 4, z: 4.5 }, { x: 3.1, z: 3 }, [it])!;
    expect([sofa.heightM, sofa.surfaceHeightM]).toEqual([0.85, 0.43]);
    expect(sofa.id).not.toBe(it.id);
    const bed2 = fur.tagRealItem('bed', { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 2 }, [it])!;
    expect(bed2.label).toBe('Bed 2');
    expect(fur.tagRealItem('counter', { x: 0, z: 0 }, { x: 0.1, z: 0 }, { x: 0, z: 1 }, [])).toBeNull();
    expect(fur.tagRealItem('counter', { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 0.05 }, [])).toBeNull();
    const c = fur.tagRealItem('counter', { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 0.6 }, [])!;
    expect([c.heightM, c.surfaceHeightM]).toEqual([0.85, 0.85]);
  });
  it('dropVirtual gives the verdict the buyer sees: a king bed head on the west wall fits', () => {
    const d = buildTruthProperty('empty');
    const base = fur.baseGrid(d.layout);
    const item = fur.dropVirtual(base, [], 'bed-king', { x: 1.2, z: 3.3 }, 90);
    expect(item.source).toBe('virtual');
    expect(item.catalogId).toBe('bed-king');
    const v = fur.verdictFor(base, d.layout, [item], item);
    console.log('king bed drop ->', JSON.stringify(item.box), v.message);
    expect(v.verdict).toBe('fits');
    expect(item.box.cx - item.box.d / 2).toBeLessThan(0.05); // snapped back to the wall
  });
  it('verdictFor excludes the item itself, flags a tall wardrobe, and sees other furniture as obstacles', () => {
    const d = buildTruthProperty('empty');
    const base = fur.baseGrid(d.layout);
    const w = fur.dropVirtual(base, [], 'wardrobe-2', { x: 2, z: 2 }, 0);
    d.layout.wallHeightM = 2.0;
    expect(fur.verdictFor(base, d.layout, [w], w).reason).toBe('too-tall');
    d.layout.wallHeightM = 2.6;
    expect(fur.verdictFor(base, d.layout, [w], w).verdict).not.toBe('blocked');
    const twin: FurnitureItem = { ...w, id: 'twin', source: 'real' };
    expect(fur.verdictFor(base, d.layout, [w, twin], w).reason).toBe('collides');
  });
  it('rotateItem steps 90 and wraps; itemAt returns the topmost; setHeights keeps the surface under the top', () => {
    const d = buildTruthProperty('furnished');
    const bed = d.furniture[0];
    expect(fur.rotateItem(bed, 90).box.yawDeg).toBe(180);
    expect(fur.rotateItem({ box: { ...bed.box, yawDeg: 270 } }, 90).box.yawDeg).toBe(0);
    expect(fur.itemAt(d.furniture, { x: bed.box.cx, z: bed.box.cz })?.id).toBe(bed.id);
    expect(fur.itemAt(d.furniture, { x: 2.5, z: 0.5 })).toBeNull();
    const it = { ...bed };
    fur.setHeights(it, 0.4);
    expect([it.heightM, it.surfaceHeightM]).toEqual([0.4, 0.4]);
    fur.setHeights(it, undefined, 5);
    expect(it.surfaceHeightM).toBe(0.4);
  });
});

describe('E6 furniture: the unmapped list from the drawing import', () => {
  it('parseUnmapped keeps valid entries and drops junk', () => {
    const out = fur.parseUnmapped({ unmapped: [
      { label: 'WARDROBE', sizeM: { w: 0, l: 1.8 }, at: { x: 3.5, z: 4 }, reason: 'Run only' },
      { label: 'SIDE TABLE', at: { x: 1, z: 1 }, reason: 'x' },
      { label: 'bad' }, { at: { x: 1, z: 1 } }, 'nope', { label: 'nan', at: { x: NaN, z: 1 } },
    ] });
    expect(out.map((u) => u.label)).toEqual(['WARDROBE', 'SIDE TABLE']);
    expect(out[0].sizeM).toEqual({ w: 0, l: 1.8 });
    expect(fur.parseUnmapped(null)).toEqual([]);
    expect(fur.parseUnmapped({ unmapped: 'x' })).toEqual([]);
  });
  it('offers wardrobe, side table and TV unit; nothing for a label with no kind', () => {
    const u = (label: string, sizeM?: { w: number; l: number }): ReturnType<typeof fur.parseUnmapped>[number] => ({ label, sizeM, at: { x: 0, z: 0 }, reason: '' });
    expect(fur.placeOptions(u('WARDROBE', { w: 0, l: 1.8 })).map((o) => [o.text, o.kind, o.w, o.d])).toEqual([['Place as wardrobe', 'wardrobe', 1.8, 0.6]]);
    expect(fur.placeOptions(u('SIDE TABLE')).map((o) => [o.text, o.kind, o.heightM])).toEqual([['Place as side table', 'counter', 0.5]]);
    expect(fur.placeOptions(u('TV UNIT'))[0].text).toBe('Place as TV unit');
    expect(fur.placeOptions(u('DINING BENCH'))).toEqual([]);
  });
  it('placeUnmapped puts a wardrobe run with its back to the nearest wall and squared up', () => {
    const d = buildTruthProperty('empty');
    const base = fur.baseGrid(d.layout);
    const entry = { label: 'WARDROBE', sizeM: { w: 0, l: 1.8 }, at: { x: 3.55, z: 4.0 }, reason: '' };
    const item = fur.placeUnmapped(base, [], entry, fur.placeOptions(entry)[0]);
    console.log('unmapped wardrobe placed ->', JSON.stringify(item.box));
    expect(item.source).toBe('real');
    expect(item.kind).toBe('wardrobe');
    expect([item.heightM, item.surfaceHeightM]).toEqual([2.1, 2.1]);
    expect(item.box.w).toBe(1.8);
    expect(item.box.d).toBe(0.6);
    expect(item.box.yawDeg).toBe(270); // back (-a) points at +x, the east wall at x = 4
    expect(Math.abs(item.box.cx - (4 - 0.3))).toBeLessThan(0.06);
    expect(fur.verdictFor(base, d.layout, [item], item).verdict).not.toBe('blocked');
  });
});

describe('E6 furniture: panel and tool', () => {
  it('three clicks tag a real bed: back edge ends, then the front side (Bed button arms it)', () => {
    const r = rig();
    fur.step.mount(asEl(r.panel), r.host);
    r.panel.byText('button', 'Bed').click();
    const t = r.plan.tool!;
    t.onDown!({ x: 0, z: 1.5 }, ptr());
    expect(r.draft.furniture).toHaveLength(0);
    expect(r.panel.textContent).toContain('Click 2 of 3');
    t.onDown!({ x: 0, z: 3.0 }, ptr());
    expect(r.panel.textContent).toContain('Click 3 of 3');
    t.onDown!({ x: 1.2, z: 2 }, ptr());
    expect(r.draft.furniture).toHaveLength(1);
    const it = r.draft.furniture[0];
    expect(it.source).toBe('real');
    expect(it.box.w).toBeCloseTo(1.5, 6);
    expect(it.box.d).toBeCloseTo(1.2, 6);
    expect(r.commits).toBeGreaterThan(0);
    expect(r.panel.textContent).toContain('Bed (fixed)');
    fur.step.unmount();
  });
  it('a too-small tag is refused with a message and nothing is saved', () => {
    const r = rig();
    fur.step.mount(asEl(r.panel), r.host);
    r.panel.byText('button', 'Counter').click();
    const t = r.plan.tool!;
    for (const p of [{ x: 1, z: 1 }, { x: 1.05, z: 1 }, { x: 1, z: 1.5 }]) t.onDown!(p, ptr());
    expect(r.draft.furniture).toHaveLength(0);
    expect(r.toasts.join(' ')).toMatch(/too small/);
    fur.step.unmount();
  });
  it('stage virtual: catalogue button, click to drop, R rotates, Delete removes', () => {
    const r = rig();
    fur.step.mount(asEl(r.panel), r.host);
    r.panel.byText('button', /King bed/).click();
    r.plan.tool!.onDown!({ x: 1.2, z: 3.3 }, ptr());
    expect(r.draft.furniture).toHaveLength(1);
    const it = r.draft.furniture[0];
    expect(it.source).toBe('virtual');
    expect(it.catalogId).toBe('bed-king');
    const yaw = it.box.yawDeg;
    r.plan.tool!.onKey!({ key: 'r', preventDefault() {} } as unknown as KeyboardEvent);
    expect(r.draft.furniture[0].box.yawDeg).toBe((yaw + 90) % 360);
    r.plan.tool!.onKey!({ key: 'Delete' } as KeyboardEvent);
    expect(r.draft.furniture).toHaveLength(0);
    fur.step.unmount();
  });
  it('drag moves a virtual item and snaps it to the wall on release; clicking empty floor deselects', () => {
    const r = rig();
    fur.step.mount(asEl(r.panel), r.host);
    r.panel.byText('button', /3-seat sofa/).click();
    r.plan.tool!.onDown!({ x: 2, z: 2.5 }, ptr());
    const id = r.draft.furniture[0].id;
    const t = r.plan.tool!; // back in select mode, same tool object
    t.onDown!({ x: 2, z: 2.5 }, ptr());
    t.onMove!({ x: 2.5, z: 2.5 }, ptr(1));
    expect(r.draft.furniture[0].box.cx).toBeCloseTo(2.5, 2);
    t.onMove!({ x: 2.9, z: 2.5 }, ptr(1));
    expect(r.draft.furniture[0].box.cx).toBeCloseTo(2.9, 2);
    t.onUp!({ x: 2.9, z: 2.5 }, ptr(0));
    expect(r.draft.furniture[0].id).toBe(id);
    // the sofa's right side is then 5 cm off the east wall (x = 4): the release snap pulls it to 2 cm
    expect(r.draft.furniture[0].box.cx).toBeCloseTo(2.93, 2);
    expect(r.panel.textContent).toContain('Rotate 90°'); // still selected after the drag
    t.onDown!({ x: 0.3, z: 0.3 }, ptr());
    expect(r.panel.textContent).not.toContain('Rotate 90°');
    fur.step.unmount();
  });
  it('items from the drawing import are listed and editable: bed, sofa, dining, wardrobe, counter', () => {
    const items: FurnitureItem[] = (['bed', 'sofa', 'dining', 'wardrobe', 'counter'] as const).map((kind, i) => ({
      id: `imp-${kind}`, source: 'real', kind, label: kind.toUpperCase(), box: { cx: 1 + 0.01 * i, cz: 1 + 0.9 * i, w: 0.8, d: 0.5, yawDeg: 0 }, heightM: 0.8, surfaceHeightM: 0.5,
    }));
    const r = rig((d) => { d.furniture = items; });
    fur.step.mount(asEl(r.panel), r.host);
    const txt = r.panel.textContent;
    for (const n of ['Furniture (5)', 'Bed, fixed', 'Sofa, fixed', 'Dining table, fixed', 'Wardrobe, fixed', 'Counter, fixed']) expect(txt).toContain(n);
    r.plan.tool!.onDown!({ x: 1.01, z: 1.9 }, ptr()); // select the sofa
    expect(r.panel.textContent).toContain('SOFA (fixed)');
    const h = r.panel.all().find((e) => e.tagName === 'INPUT' && e.attrs.type === 'number')!;
    h.value = '0.7';
    h.dispatch('change');
    expect(r.draft.furniture.find((f) => f.id === 'imp-sofa')!.heightM).toBe(0.7);
    fur.step.unmount();
  });
  it('lists the import\'s unmapped items as "not placed", and one click places the wardrobe', async () => {
    const extras = { unmapped: [
      { label: 'WARDROBE', sizeM: { w: 0, l: 1.8 }, at: { x: 3.55, z: 4 }, reason: 'Wardrobe run only, no closed outline beside the label.' },
      { label: 'SIDE TABLE', at: { x: 0.4, z: 0.4 }, reason: 'No furniture kind for a side table.' },
      { label: 'BAR UNIT', at: { x: 2, z: 2 }, reason: 'No furniture kind for a bar unit.' },
    ] };
    (globalThis as { fetch?: unknown }).fetch = async () => ({ ok: true, text: async () => JSON.stringify(extras) });
    const r = rig();
    fur.step.mount(asEl(r.panel), r.host);
    await new Promise((res) => setTimeout(res, 5));
    expect(r.panel.textContent).toContain('Not placed (3)');
    expect(r.panel.textContent).toContain('Wardrobe run only');
    expect(r.draft.furniture).toHaveLength(0);
    // read-only: BAR UNIT has no button, the other two do
    expect(r.panel.all().filter((e) => e.tagName === 'BUTTON' && /^Place as/.test(e.textContent)).map((e) => e.textContent)).toEqual(['Place as wardrobe', 'Place as side table']);
    r.panel.byText('button', 'Place as wardrobe').click();
    expect(r.draft.furniture).toHaveLength(1);
    expect(r.draft.furniture[0].kind).toBe('wardrobe');
    expect(r.draft.furniture[0].source).toBe('real');
    expect(r.panel.textContent).toContain('Not placed (2)');
    fur.step.unmount();
  });
  it('a missing proposal-extras.json (no fetch, or HTML back) shows no "not placed" section', async () => {
    (globalThis as { fetch?: unknown }).fetch = async () => ({ ok: true, text: async () => '<!doctype html>' });
    const r = rig();
    fur.step.mount(asEl(r.panel), r.host);
    await new Promise((res) => setTimeout(res, 5));
    expect(r.panel.textContent).not.toContain('Not placed');
    fur.step.unmount();
  });
  it('is optional and done once something is in the flat', () => {
    expect(fur.step.optional).toBe(true);
    expect(fur.step.isDone(rig().host)).toBe(false);
    expect(fur.step.isDone(rig((d) => { d.furniture = buildTruthProperty('furnished').furniture; }).host)).toBe(true);
  });
});

// ---------------------------------------------------------------- E8

describe('E8 spawn: pure helpers', () => {
  it('yawFromDrag: +z is 0, +x is 90, -z is 180, -x is 270; a tiny drag changes nothing', () => {
    const o = { x: 2, z: 2 };
    expect(spw.yawFromDrag(o, { x: 2, z: 3 })).toBe(0);
    expect(spw.yawFromDrag(o, { x: 3, z: 2 })).toBe(90);
    expect(spw.yawFromDrag(o, { x: 2, z: 1 })).toBe(180);
    expect(spw.yawFromDrag(o, { x: 1, z: 2 })).toBe(270);
    expect(spw.yawFromDrag(o, { x: 2.05, z: 2.05 })).toBeNull();
  });
  it('spawn must be on a free cell with circleFree(..., CHARACTER_RADIUS_M), else the exact message', () => {
    const g = truthGrid('empty');
    expect(spw.spawnProblem(g, { x: 2.6, z: 0.8 })).toBeNull();
    expect(spw.spawnProblem(g, { x: 0.1, z: 2 })).toBe('Pick a spot on the floor, away from walls.');
    expect(spw.spawnProblem(g, { x: 0, z: 0 })).toBe('Pick a spot on the floor, away from walls.');
    expect(spw.spawnProblem(g, { x: -5, z: -5 })).toBe('Pick a spot on the floor, away from walls.');
    expect(spw.spawnIsFree(g, { x: 0.3, z: 2 })).toBe(circleFree(g, 0.3, 2, CHARACTER_RADIUS_M));
    // 0.22 m is the line: 0.15 m from the west wall is too close, 0.3 m is fine
    expect(spw.spawnIsFree(g, { x: 0.15, z: 2 })).toBe(false);
    expect(spw.spawnIsFree(g, { x: 0.3, z: 2 })).toBe(true);
  });
  it('the empty draft\'s (0, 0) counts as "not set"', () => {
    expect(spw.spawnIsSet({ x: 0, z: 0, yawDeg: 0 })).toBe(false);
    expect(spw.spawnIsSet({ x: 2.6, z: 0.8, yawDeg: 0 })).toBe(true);
  });
  it('nearestSpawn finds a free spot near a bad click', () => {
    const g = truthGrid('empty');
    const q = spw.nearestSpawn(g, { x: 0.05, z: 2 })!;
    expect(spw.spawnIsFree(g, q)).toBe(true);
    expect(q.x).toBeLessThan(0.6);
  });
});

describe('E8 spawn: panel and tool', () => {
  it('click sets the point, drag sets the facing; the step is done on a free spot', () => {
    const r = rig((d) => { d.spawn = { x: 0, z: 0, yawDeg: 0 }; });
    expect(spw.step.isDone(r.host)).toBe(false);
    spw.step.mount(asEl(r.panel), r.host);
    expect(r.panel.textContent).toContain('Not set yet.');
    const t = r.plan.tool!;
    t.onDown!({ x: 2, z: 2.5 }, ptr());
    t.onMove!({ x: 3.2, z: 2.5 }, ptr(1));
    t.onUp!({ x: 3.2, z: 2.5 }, ptr(0));
    expect(r.draft.spawn).toEqual({ x: 2, z: 2.5, yawDeg: 90 });
    expect(r.commits).toBeGreaterThan(0);
    expect(spw.step.isDone(r.host)).toBe(true);
    expect(r.panel.textContent).toContain('On a free spot.');
    expect(r.panel.textContent).toContain('facing 90°');
    spw.step.unmount();
  });
  it('a click too close to a wall leaves the step not done and says the message, with a one-click fix', () => {
    const r = rig();
    spw.step.mount(asEl(r.panel), r.host);
    const t = r.plan.tool!;
    t.onDown!({ x: 0.05, z: 2.5 }, ptr());
    t.onUp!({ x: 0.05, z: 2.5 }, ptr(0));
    expect(spw.step.isDone(r.host)).toBe(false);
    expect(r.panel.textContent).toContain('Pick a spot on the floor, away from walls.');
    r.panel.byText('button', 'Move to the nearest free spot').click();
    expect(spw.step.isDone(r.host)).toBe(true);
    expect(circleFree(r.host.grid(), r.draft.spawn.x, r.draft.spawn.z, CHARACTER_RADIUS_M)).toBe(true);
    spw.step.unmount();
  });
  it('a spawn inside furniture is not free', () => {
    const r = rig((d) => { d.furniture = buildTruthProperty('furnished').furniture; d.spawn = { x: 1, z: 2.25, yawDeg: 0 }; });
    expect(spw.step.isDone(r.host)).toBe(false);
  });
  it('title and subtitle go to the draft; an empty subtitle is removed', () => {
    const r = rig();
    spw.step.mount(asEl(r.panel), r.host);
    const inputs = (): StubEl[] => r.panel.all().filter((e) => e.tagName === 'INPUT');
    inputs()[0].value = '  2 BHK in Powai ';
    inputs()[0].dispatch('change');
    expect(r.draft.title).toBe('2 BHK in Powai');
    inputs()[1].value = 'Hiranandani Gardens';
    inputs()[1].dispatch('change');
    expect(r.draft.subtitle).toBe('Hiranandani Gardens');
    inputs()[1].value = '';
    inputs()[1].dispatch('change');
    expect('subtitle' in r.draft).toBe(false);
    spw.step.unmount();
  });
  it('the before-you-save checklist reflects rooms, layout errors and the spawn', () => {
    const r = rig((d) => { d.spawn = { x: 0, z: 0, yawDeg: 0 }; });
    spw.step.mount(asEl(r.panel), r.host);
    expect(r.panel.textContent).toContain('✓ 3 rooms drawn');
    expect(r.panel.textContent).toContain('✗ Pick a spot on the floor, away from walls.');
    spw.step.unmount();
  });
});

beforeAll(() => { /* the stub DOM is installed at import time */ });
