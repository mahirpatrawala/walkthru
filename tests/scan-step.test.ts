// C7 E7 panel against a stub DOM and a fake plan canvas: the logic wiring (preset -> level -> pins -> draft.splat), not rendering.
// Not a browser: the 3D view, the scan image drawing, real pointer events and the trace-from-scan PNG path are NOT covered.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDomStub, StubEl } from './dom-stub';
import { TRUTH, buildSplatFragment, buildTruthProperty, encodePly, rawFromTruth } from '../scripts/make-test-room';
import { createEmptyProperty } from '../src/core/layout-validate';
import { levelSplat } from '../src/core/splat/floor';
import { planBounds } from '../src/core/splat/plan-image';
import { scanToWorld } from '../src/core/splat/align';
import { rotateY } from '../src/core/geometry';
import type { EditorContext, EditorHost, PlanCanvas, PlanTool } from '../src/editor/context';
import type { LevelResult, PropertyFile, SceneTransform, Vec3 } from '../src/types';

installDomStub();
const { step, levelMessage, provisionalPlacement, whenScanIdle } = await import('../src/editor/steps/scan');

const frag = buildSplatFragment();
const plyBytes = encodePly(frag);

interface Rig { host: EditorHost; draft: PropertyFile; plan: PlanCanvas & { tool: PlanTool | null }; commits: number; panel: StubEl; toasts: string[] }

function rig(files: string[]): Rig {
  const draft = createEmptyProperty('rig');
  const truth = buildTruthProperty('empty');
  draft.layout.rooms = truth.layout.rooms;
  draft.layout.openings = truth.layout.openings;
  draft.layout.wallHeightM = 2.6;
  const toasts: string[] = [];
  const plan = {
    tool: null as PlanTool | null,
    refresh() {}, redraw() {},
    screenToWorld: (x: number, y: number) => ({ x, z: y }), worldToScreen: (v: { x: number; z: number }) => ({ x: v.x * 80, y: v.z * 80 }),
    setTool(t: PlanTool | null) { if (this.tool && this.tool !== t) this.tool.cancel?.(); this.tool = t; },
    addLayer: () => () => {}, setUnderlayImage() {}, pxPerMetreOnScreen: () => 80,
  };
  const r = { draft, plan, commits: 0, panel: new StubEl('DIV'), toasts } as unknown as Rig;
  r.host = {
    sceneId: 'rig', draft, plan,
    commit() { r.commits++; },
    grid: () => { throw new Error('unused'); },
    get viewer(): never { throw new Error('no WebGL in this test'); },
    api: { saveProperty: async () => {}, saveFile: async () => {}, exists: async (n: string) => files.includes(n) },
    toast: (t: string) => { toasts.push(t); }, applyUnderlay() {}, fitPlan() {}, loadScene: async () => ({ found: false }), goto() {}, showPreview() {}, previewVisible: () => false,
    underlayImage: null,
  } as unknown as EditorHost;
  return r;
}
const asEl = (p: StubEl): HTMLElement => p as unknown as HTMLElement;
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const apply = (t: SceneTransform, p: Vec3): Vec3 => {
  const r = rotateY(t.rotation, p);
  return { x: t.scale * r.x + t.position[0], y: t.scale * r.y + t.position[1], z: t.scale * r.z + t.position[2] };
};
const radio = (panel: StubEl, value: string): StubEl => {
  const hit = panel.all().find((e) => e.tagName === 'INPUT' && e.value === value);
  if (!hit) throw new Error(`no radio ${value}`);
  return hit;
};

afterEach(() => { step.unmount(); vi.unstubAllGlobals(); });

describe('E7 pure helpers', () => {
  const lv = (over: Partial<LevelResult>): LevelResult => ({ rotation: [0, 0, 0, 1], floorOffsetRaw: 0, ceilingRaw: null, tiltDeg: 3, confidence: 20, lowConfidence: false, ...over });
  it('levelMessage uses the SPEC wording and the tap-three-spots fallback', () => {
    expect(levelMessage(lv({ tiltDeg: 3.04 })).text).toBe('Floor found. Tilt corrected 3.0°.');
    expect(levelMessage(lv({ confidence: 1.5, lowConfidence: true })).text).toBe('Not sure about the floor. Tap three spots on the floor in the 3D view.');
    const big = levelMessage(lv({ tiltDeg: 21.4, lowConfidence: true }));
    expect(big.ok).toBe(false);
    expect(big.text).toMatch(/21\.4°/);
    expect(big.text).toMatch(/three spots/);
  });
  it('provisionalPlacement puts the scan centre on the layout centre, ceiling = wall height', () => {
    const draft = createEmptyProperty('x');
    draft.layout.rooms = buildTruthProperty('empty').layout.rooms;
    draft.layout.wallHeightM = 2.6;
    const pl = provisionalPlacement(lv({ ceilingRaw: 7 }), { x0: 0, x1: 10, z0: 0, z1: 14, top: 7 }, draft);
    expect(pl.s).toBeCloseTo(2.6 / 7, 9);
    const c = scanToWorld(pl, { x: 5, z: 7 });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of draft.layout.rooms) for (const p of r.polygon) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    expect(c.x).toBeCloseTo((x0 + x1) / 2, 9);
    expect(c.z).toBeCloseTo((z0 + z1) / 2, 9);
    // no ceiling found, no layout: one raw unit per metre at the origin
    const bare = provisionalPlacement(lv({}), { x0: -1, x1: 1, z0: -1, z1: 1, top: 1 }, createEmptyProperty('y'));
    expect(bare).toEqual({ s: 1, theta: 0, tx: 0, tz: 0 });
  });
});

describe('E7 panel', { timeout: 120_000 }, () => {
  it('with no scan file it says so and is not done', async () => {
    const r = rig([]);
    step.mount(asEl(r.panel), r.host);
    await whenScanIdle();
    expect(r.panel.textContent).toMatch(/No scan found/);
    expect(step.isDone(r.host)).toBe(false);
    expect(step.optional).toBe(true);
  });

  it('flip-x levels the fragment, two pins on the door jambs write draft.splat (scale 0.37, landmarks within 3 cm), mode toggles', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => plyBytes.buffer.slice(plyBytes.byteOffset, plyBytes.byteOffset + plyBytes.byteLength) }));
    const r = rig(['scene.ply']);
    step.mount(asEl(r.panel), r.host);
    await whenScanIdle();
    expect(r.panel.textContent).toMatch(/scene\.ply: 14\d,\d{3} splats/);
    expect(r.panel.textContent).toMatch(/Looks right/);
    expect(r.panel.textContent).toMatch(/Upside down/);
    expect(r.panel.textContent).toMatch(/On its side/);
    expect((r.draft.splat)).toBeUndefined();

    radio(r.panel, 'flip-x').dispatch('change');
    await new Promise((res) => setTimeout(res, 3000));
    for (let i = 0; i < 100 && !/Floor found/.test(r.panel.textContent); i++) await new Promise((res) => setTimeout(res, 200));
    expect(r.panel.textContent).toMatch(/Floor found\. Tilt corrected 3\.0°\./);

    // what the panel computed, recomputed here (same pure functions) so the test knows where the scan is drawn
    const level = levelSplat(frag.cloud, 'flip-x');
    const bounds = planBounds(frag.cloud, level);
    let pl = provisionalPlacement(level, bounds, r.draft);
    const lev = (p: Vec3) => { const q = rotateY(level.rotation, p); return { x: q.x, z: q.z }; };
    const [j1, j2] = TRUTH.doorJambs;

    const pin2 = r.panel.byText('button', 'Pin 2');
    expect(pin2.disabled).toBe(true);
    r.panel.byText('button', 'Pin 1').click();
    expect(r.plan.tool).not.toBeNull();
    const s1 = lev(rawFromTruth(j1));
    r.plan.tool!.onDown!(scanToWorld(pl, s1), {} as PointerEvent);     // the point on the scan image as drawn
    r.plan.tool!.onDown!({ x: j1.x, z: j1.z }, {} as PointerEvent);    // the same point on the layout
    expect(r.draft.splat).toBeUndefined();                              // one pin is not an alignment
    // the panel slid the scan to match pin 1
    const moved = scanToWorld({ ...pl, tx: 0, tz: 0 }, s1);
    pl = { ...pl, tx: j1.x - moved.x, tz: j1.z - moved.z };
    expect(r.panel.byText('button', 'Pin 2').disabled).toBe(false);

    r.panel.byText('button', 'Pin 2').click();
    const s2 = lev(rawFromTruth(j2));
    r.plan.tool!.onDown!(scanToWorld(pl, s2), {} as PointerEvent);
    r.plan.tool!.onDown!({ x: j2.x, z: j2.z }, {} as PointerEvent);

    const sp = r.draft.splat!;
    expect(sp).toBeDefined();
    expect(sp.file).toBe('scene.ply');
    expect(sp.format).toBe('ply');
    expect(sp.upPreset).toBe('flip-x');
    expect(sp.mode).toBe('overlay');
    expect(Math.abs(sp.transform.scale / 0.37 - 1)).toBeLessThanOrEqual(0.005);
    let worst = 0;
    for (const lm of TRUTH.landmarks) worst = Math.max(worst, dist(apply(sp.transform, rawFromTruth(lm)), lm));
    console.log(`[C7] E7 panel: scale ${sp.transform.scale.toFixed(5)}, worst landmark error ${(worst * 100).toFixed(2)} cm, commits ${r.commits}`);
    expect(worst).toBeLessThanOrEqual(0.03);
    expect(step.isDone(r.host)).toBe(true);
    expect(r.commits).toBeGreaterThan(0);

    // mode switch
    radio(r.panel, 'replace').dispatch('change');
    expect(r.draft.splat!.mode).toBe('replace');

    // coming back to the step: the saved alignment is loaded, not recomputed
    step.unmount();
    const r2 = { ...r, panel: new StubEl('DIV') } as Rig;
    step.mount(asEl(r2.panel), r2.host);
    await whenScanIdle();
    expect(r2.panel.textContent).toMatch(/Using the saved alignment/);
    expect(r2.draft.splat!.mode).toBe('replace');

    // remove
    r2.panel.byText('button', /Remove the scan overlay/).click();
    expect(r2.draft.splat).toBeUndefined();
    expect(step.isDone(r2.host)).toBe(false);
  });

  it('two pins on top of each other are refused with a message and no draft change', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => plyBytes.buffer.slice(plyBytes.byteOffset, plyBytes.byteOffset + plyBytes.byteLength) }));
    const r = rig(['scene.ply']);
    step.mount(asEl(r.panel), r.host);
    await whenScanIdle();
    radio(r.panel, 'flip-x').dispatch('change');
    for (let i = 0; i < 150 && !/Floor found/.test(r.panel.textContent); i++) await new Promise((res) => setTimeout(res, 200));
    const level = levelSplat(frag.cloud, 'flip-x');
    let pl = provisionalPlacement(level, planBounds(frag.cloud, level), r.draft);
    const s = { x: 1, z: 1 };
    r.panel.byText('button', 'Pin 1').click();
    r.plan.tool!.onDown!(scanToWorld(pl, s), {} as PointerEvent);
    r.plan.tool!.onDown!({ x: 2, z: 2 }, {} as PointerEvent);
    const moved = scanToWorld({ ...pl, tx: 0, tz: 0 }, s);
    pl = { ...pl, tx: 2 - moved.x, tz: 2 - moved.z };
    r.panel.byText('button', 'Pin 2').click();
    r.plan.tool!.onDown!(scanToWorld(pl, s), {} as PointerEvent);   // same scan spot again
    r.plan.tool!.onDown!({ x: 3, z: 3 }, {} as PointerEvent);
    expect(r.draft.splat).toBeUndefined();
    expect(r.panel.textContent).toMatch(/same spot/);
  });
});
