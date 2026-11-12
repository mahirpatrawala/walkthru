// Owned by C7. E7 Scan overlay (SPEC 2.2): up axis, automatic floor levelling, two pins against the layout, overlay or replace,
// and the reverse path "Trace from the scan instead". The maths lives in core/splat/*; this file is the panel, the pin tools
// on the plan canvas and the three-point floor pick in the 3D view.
import * as THREE from 'three';
import type { LevelResult, PropertyFile, RawCloud, SceneTransform, UpPreset, Vec2 } from '../../types';
import type { SplatHandle } from '../../engine/viewer';
import { parsePly, parseSplat } from '../../core/splat/files';
import { levelFromThreePoints, levelFromTransform, levelSplat } from '../../core/splat/floor';
import type { Placement2D } from '../../core/splat/align';
import { alignSplatByDistance, placeSplat, placementFromPairs, placementFromTransform, scanToWorld, worldToScan } from '../../core/splat/align';
import { pickSurfacePoint, rawToWorld, worldRayToRaw } from '../../core/splat/pick';
import { planBounds, renderPlanImage, suggestPxPerUnit } from '../../core/splat/plan-image';
import type { PlanBounds } from '../../core/splat/plan-image';
import { parseLength } from '../../core/units';
import type { EditorContext, EditorStep, PlanTool } from '../context';
import { asHost } from '../context';
import { clear, h } from '../dom';

export const SCAN_FILES = ['scene.ply', 'scene.spz', 'scene.splat'] as const;
export const UP_CHOICES: { preset: UpPreset; label: string; hint: string }[] = [
  { preset: 'as-is', label: 'Looks right', hint: 'The scan already has the floor at the bottom.' },
  { preset: 'flip-x', label: 'Upside down', hint: 'Usual for raw 3D scans and COLMAP output.' },
  { preset: 'z-up', label: 'On its side', hint: 'The scan was saved with Z as up.' },
];
export const DOOR_PRESETS: { label: string; m: number }[] = [
  { label: 'Main door, 0.90 m', m: 0.9 },
  { label: 'Bedroom door, 0.80 m', m: 0.8 },
  { label: 'Bathroom door, 0.75 m', m: 0.75 },
  { label: 'Window, 1.20 m', m: 1.2 },
  { label: 'Sliding door or archway, 1.80 m', m: 1.8 },
];
const TILT_GUARD_DEG = 15;
const ORANGE = '#ea580c';
const BLUE = '#2563eb';

// ---------------------------------------------------------------- pure helpers (tested without a browser)

/** The sentence shown after the floor is detected. Wording for the good case is fixed by SPEC 2.2 E7. */
export function levelMessage(level: LevelResult): { text: string; ok: boolean } {
  if (!level.lowConfidence) return { text: `Floor found. Tilt corrected ${level.tiltDeg.toFixed(1)}°.`, ok: true };
  if (level.tiltDeg > TILT_GUARD_DEG) {
    return {
      text: `A floor was found but it is tilted ${level.tiltDeg.toFixed(1)}°, which is more than usual. Use it if it looks right, or tap three spots on the floor in the 3D view.`,
      ok: false,
    };
  }
  return { text: 'Not sure about the floor. Tap three spots on the floor in the 3D view.', ok: false };
}

/**
 * Where to show the scan before it is pinned: its centre on the layout's centre, at a scale that makes the ceiling the layout's wall
 * height (else the scan as wide as the layout, else one raw unit per metre). Turned by 0. The pins fix the rest.
 * // SPEC-GAP: 2.2 E7 says the image "appears over the layout" but not where or how big before pin 1; this is our choice.
 */
export function provisionalPlacement(level: LevelResult, b: PlanBounds, draft: PropertyFile): Placement2D {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of draft.layout.rooms) for (const p of r.polygon) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const haveLayout = Number.isFinite(x0);
  const scanW = Math.max(b.x1 - b.x0, 1e-6), scanH = Math.max(b.z1 - b.z0, 1e-6);
  let s = 1;
  if (level.ceilingRaw && level.ceilingRaw > 0) s = draft.layout.wallHeightM / level.ceilingRaw;
  else if (haveLayout) s = Math.min((x1 - x0) / scanW, (z1 - z0) / scanH);
  const wc = haveLayout ? { x: (x0 + x1) / 2, z: (z0 + z1) / 2 } : { x: 0, z: 0 };
  const sc = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
  return { s, theta: 0, tx: wc.x - s * sc.x, tz: wc.z - s * sc.z };
}

function formatOf(file: string): 'ply' | 'spz' | 'splat' {
  const e = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  return e === 'spz' ? 'spz' : e === 'splat' ? 'splat' : 'ply';
}

// ---------------------------------------------------------------- the step

let idleWork: Promise<void> = Promise.resolve();
let teardown: (() => void) | null = null;

/** For tests and automation: resolves when the panel has finished whatever async work it started. */
export function whenScanIdle(): Promise<void> {
  return idleWork;
}

interface Pin { scan: Vec2; world: Vec2 }
type Armed =
  | { kind: 'pin'; index: 0 | 1; phase: 'scan' | 'world' }
  | { kind: 'trace' }
  | null;

export const step: EditorStep = {
  id: 'scan',
  title: 'Scan overlay',
  optional: true,
  mount(panel, ctx) {
    teardown?.();
    asHost(ctx); // fail early, with a clear message, when mounted outside the editor page
    panel.className = 'panel-body step-scan';
    const run = new ScanPanel(panel, ctx);
    teardown = () => { run.dispose(); teardown = null; };
    idleWork = run.start();
  },
  unmount() {
    teardown?.();
  },
  isDone(ctx) {
    return !!ctx.draft.splat;
  },
};

/** One mounted panel. A class only to keep the state and the handlers together. */
class ScanPanel {
  private alive = true;
  private file: string | null = null;
  private cloud: RawCloud | null = null;
  private level: LevelResult | null = null;
  private upPreset: UpPreset | 'manual' | null = null;
  private pl: Placement2D | null = null;
  private bounds: PlanBounds | null = null;
  private plan: ReturnType<typeof renderPlanImage> | null = null;
  private imgCanvas: CanvasImageSource | null = null;
  private showScan = true;
  private handle: SplatHandle | null = null;
  private pins: Pin[] = [];
  private pending: Vec2 | null = null;
  private armed: Armed = null;
  private tracePts: Vec2[] = [];
  private floorPicks: { raw: { x: number; y: number; z: number }; marker: THREE.Object3D | null }[] = [];
  private floorMode = false;
  private removeLayer: (() => void) | null = null;
  private unbindCanvas: (() => void) | null = null;
  private turnedPreviewOn = false;
  private radios: HTMLInputElement[] = [];

  private readonly el = {
    info: h('p', { class: 'muted small' }),
    upBox: h('div', { class: 'presets' }),
    levelMsg: h('p', { class: 'small' }),
    floorBox: h('div', { class: 'row', style: 'flex-wrap:wrap' }),
    pinMsg: h('p', { class: 'small' }),
    pinBox: h('div', { class: 'row' }),
    modeBox: h('div', {}),
    traceBox: h('div', {}),
    removeBox: h('div', {}),
    err: h('p', { class: 'err small' }),
  };

  constructor(private readonly panel: HTMLElement, private readonly ctx: EditorContext) {}

  private get host() { return asHost(this.ctx); }

  dispose(): void {
    this.alive = false;
    this.removeLayer?.();
    this.removeLayer = null;
    this.unbindCanvas?.();
    this.unbindCanvas = null;
    this.clearMarkers();
    try { this.ctx.plan.setTool(null); } catch { /* plan canvas gone */ }
    try { this.handle?.dispose(); } catch { /* already disposed */ }
    this.handle = null;
    if (this.turnedPreviewOn) { try { this.host.showPreview(false); } catch { /* ignore */ } }
  }

  // ------------------------------------------------------------ loading

  async start(): Promise<void> {
    clear(this.panel);
    this.panel.append(
      h('h3', { text: 'Scan' }), this.el.info, this.el.upBox, this.el.levelMsg, this.el.floorBox,
      this.el.pinMsg, this.el.pinBox, this.el.modeBox, this.el.traceBox, this.el.removeBox, this.el.err,
    );
    this.el.info.textContent = 'Looking for a scan...';
    let found: string | null = null;
    const wanted = this.ctx.draft.splat?.file;
    const order = wanted ? [wanted, ...SCAN_FILES.filter((f) => f !== wanted)] : [...SCAN_FILES];
    for (const f of order) {
      try { if (await this.ctx.api.exists(f)) { found = f; break; } } catch { /* try the next */ }
    }
    if (!this.alive) return;
    if (!found) {
      this.el.info.textContent = `No scan found. To add one, put ${SCAN_FILES.join(', ')} in public/scenes/${this.ctx.sceneId}/. This step is optional.`;
      return;
    }
    this.file = found;
    this.el.info.textContent = `Reading ${found}...`;
    try {
      this.cloud = await this.readCloud(found);
    } catch (err) {
      if (!this.alive) return;
      this.el.info.textContent = '';
      this.el.err.textContent = `The scan ${found} could not be read. ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    if (!this.alive) return;
    const n = this.cloud.count;
    this.el.info.textContent = `${found}: ${n.toLocaleString('en-US')} splats.`;
    this.buildUpControls();
    this.buildModeControls();
    this.buildTraceControls();
    this.buildRemove();
    this.removeLayer = this.ctx.plan.addLayer((g, c) => this.drawLayer(g, c));
    const saved = this.ctx.draft.splat;
    if (saved && saved.file === found) {
      this.level = levelFromTransform(saved.transform);
      this.upPreset = saved.upPreset;
      this.pl = placementFromTransform(saved.transform);
      this.bounds = planBounds(this.cloud, this.level);
      this.rebuildImage();
      await this.ensureHandle(saved.transform);
      this.setUpChecked(saved.upPreset);
      this.el.levelMsg.textContent = 'Using the saved alignment. Pin again to redo it, or pick the up axis again to start over.';
      this.el.levelMsg.className = 'small';
    } else {
      this.el.levelMsg.textContent = 'Say which way up the scan is, and the floor is found and levelled for you.';
    }
    this.buildPinControls();
  }

  /** .ply and .splat are parsed here; .spz, or a file that fails to parse, goes through Spark's own reader. */
  private async readCloud(file: string): Promise<RawCloud> {
    const url = `/scenes/${this.ctx.sceneId}/${file}`;
    const fmt = formatOf(file);
    if (fmt !== 'spz') {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        return fmt === 'ply' ? parsePly(bytes) : parseSplat(bytes);
      } catch (err) {
        console.warn('[walkthru] scan parse failed, falling back to the renderer', err);
      }
    }
    const handle = await this.ctx.viewer.loadSplat(url, { rotation: [0, 0, 0, 1], scale: 1, position: [0, 0, 0] });
    this.handle = handle;
    return handle.readCloud();
  }

  private async ensureHandle(t: SceneTransform): Promise<void> {
    if (this.handle) { this.handle.setTransform(t); return; }
    if (!this.file) return;
    try {
      const handle = await this.ctx.viewer.loadSplat(`/scenes/${this.ctx.sceneId}/${this.file}`, t);
      if (!this.alive) { handle.dispose(); return; }
      this.handle = handle;
    } catch (err) {
      this.el.err.textContent = `The 3D view could not show the scan. ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ------------------------------------------------------------ up axis and levelling

  private buildUpControls(): void {
    clear(this.el.upBox);
    this.radios = [];
    this.el.upBox.append(h('h3', { text: 'Which way up?' }));
    for (const c of UP_CHOICES) {
      const input = h('input', { type: 'radio', name: 'scan-up', value: c.preset });
      this.radios.push(input);
      input.addEventListener('change', () => { void this.choosePreset(c.preset); });
      this.el.upBox.append(h('label', { class: 'field inline' }, input, h('span', { text: `${c.label}. ${c.hint}` })));
    }
  }

  private setUpChecked(p: UpPreset | 'manual'): void {
    for (const input of this.radios) input.checked = input.value === p;
  }

  private async choosePreset(preset: UpPreset, maxTiltDeg?: number): Promise<void> {
    if (!this.cloud) return;
    this.el.err.textContent = '';
    this.setFloorMode(false);
    this.disarm();
    this.el.levelMsg.textContent = 'Finding the floor...';
    this.el.levelMsg.className = 'small muted';
    await new Promise((r) => setTimeout(r, 20));
    if (!this.alive || !this.cloud) return;
    const level = levelSplat(this.cloud, preset, maxTiltDeg ? { maxTiltDeg } : undefined);
    this.upPreset = preset;
    await this.setLevel(level, maxTiltDeg !== undefined);
  }

  private async setLevel(level: LevelResult, forced = false): Promise<void> {
    if (!this.cloud) return;
    this.level = level;
    this.bounds = planBounds(this.cloud, level);
    this.pl = provisionalPlacement(level, this.bounds, this.ctx.draft);
    this.pins = [];
    this.pending = null;
    this.rebuildImage();
    const msg = levelMessage(level);
    this.el.levelMsg.textContent = msg.text;
    this.el.levelMsg.className = msg.ok ? 'small ok' : 'small err';
    this.buildFloorControls(!msg.ok && !forced && level.tiltDeg > TILT_GUARD_DEG);
    this.buildPinControls();
    this.refreshPlan();
    await this.ensureHandle(placeSplat(level, this.pl));
    if (!msg.ok && !forced && this.upPreset !== 'manual' && level.tiltDeg <= TILT_GUARD_DEG) this.setFloorMode(true);
  }

  private buildFloorControls(offerDetected: boolean): void {
    clear(this.el.floorBox);
    if (!this.level) return;
    if (offerDetected && this.upPreset && this.upPreset !== 'manual') {
      const preset = this.upPreset;
      this.el.floorBox.append(h('button', { class: 'btn', text: 'Use the detected floor', onclick: () => { void this.choosePreset(preset, 45); } }));
    }
    this.el.floorBox.append(h('button', { class: 'btn', text: this.floorMode ? 'Stop picking' : 'Tap three spots on the floor', onclick: () => this.setFloorMode(!this.floorMode) }));
  }

  // ------------------------------------------------------------ three-point floor pick (3D view)

  private setFloorMode(on: boolean): void {
    if (on === this.floorMode) return;
    this.floorMode = on;
    this.unbindCanvas?.();
    this.unbindCanvas = null;
    this.clearMarkers();
    this.floorPicks = [];
    if (on) {
      this.disarm();
      let viewer;
      try { viewer = this.ctx.viewer; } catch (err) { this.el.err.textContent = `The 3D view is not available. ${err instanceof Error ? err.message : String(err)}`; this.floorMode = false; return; }
      if (!this.host.previewVisible()) { this.host.showPreview(true); this.turnedPreviewOn = true; }
      this.el.levelMsg.textContent = 'Click three spots on the floor in the 3D view, well apart and not in a line. Drag to look around.';
      this.el.levelMsg.className = 'small';
      const canvas = viewer.canvas;
      let down: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent): void => { down = { x: e.clientX, y: e.clientY }; };
      const onUp = (e: PointerEvent): void => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
        down = null;
        this.pickFloorAt(e.clientX, e.clientY);
      };
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      this.unbindCanvas = () => { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); };
    } else if (this.turnedPreviewOn) {
      this.host.showPreview(false);
      this.turnedPreviewOn = false;
    }
    this.buildFloorControls(false);
  }

  private currentTransform(): SceneTransform | null {
    return this.level && this.pl ? placeSplat(this.level, this.pl) : null;
  }

  private pickFloorAt(clientX: number, clientY: number): void {
    const t = this.currentTransform();
    if (!t || !this.cloud) return;
    const viewer = this.ctx.viewer;
    const rect = viewer.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, viewer.camera);
    const ray = worldRayToRaw(t, { x: rc.ray.origin.x, y: rc.ray.origin.y, z: rc.ray.origin.z }, { x: rc.ray.direction.x, y: rc.ray.direction.y, z: rc.ray.direction.z });
    const hit = pickSurfacePoint(this.cloud.positions, this.cloud.opacity, ray.origin, ray.dir);
    if (!hit) { this.el.err.textContent = 'No part of the scan was under that click. Try a spot where the floor is clearly there.'; return; }
    this.el.err.textContent = '';
    let marker: THREE.Object3D | null = null;
    try {
      const w = rawToWorld(t, hit);
      marker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: ORANGE, depthTest: false }));
      marker.renderOrder = 10;
      marker.position.set(w.x, w.y, w.z);
      viewer.scene.add(marker);
    } catch { marker = null; }
    this.floorPicks.push({ raw: hit, marker });
    if (this.floorPicks.length < 3) {
      this.el.levelMsg.textContent = `${this.floorPicks.length} of 3 floor spots picked.`;
      return;
    }
    const [a, b, c] = this.floorPicks.map((p) => p.raw);
    const camRaw = worldRayToRaw(t, { x: viewer.camera.position.x, y: viewer.camera.position.y, z: viewer.camera.position.z }, { x: 0, y: 0, z: 1 }).origin;
    let level: LevelResult;
    try { level = levelFromThreePoints(a, b, c, camRaw); } catch (err) {
      this.el.err.textContent = err instanceof Error ? err.message : String(err);
      this.clearMarkers();
      this.floorPicks = [];
      return;
    }
    this.upPreset = 'manual';
    this.setUpChecked('manual');
    this.setFloorMode(false);
    void this.setLevel(level, true).then(() => {
      this.el.levelMsg.textContent = `Floor set from your three spots. Tilt corrected ${level.tiltDeg.toFixed(1)}°.`;
      this.el.levelMsg.className = 'small ok';
    });
  }

  private clearMarkers(): void {
    for (const p of this.floorPicks) {
      if (!p.marker) continue;
      p.marker.parent?.remove(p.marker);
      const m = p.marker as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    this.floorPicks = [];
  }

  // ------------------------------------------------------------ the scan image on the plan

  private rebuildImage(): void {
    this.plan = null;
    this.imgCanvas = null;
    if (!this.cloud || !this.level) return;
    let opaque = 0;
    for (let i = 0; i < this.cloud.count; i++) if (this.cloud.opacity[i] >= 77) opaque++;
    // a scan whose splats are mostly faint (Brush output) would come out empty at the default 0.3
    const minOpacity = opaque < this.cloud.count * 0.25 ? 0.05 : 0.3;
    this.plan = renderPlanImage(this.cloud, this.level, suggestPxPerUnit(this.cloud, this.level, 1200), { footprint: 1, minOpacity });
    try {
      const cv = document.createElement('canvas');
      cv.width = this.plan.width;
      cv.height = this.plan.height;
      const g = cv.getContext('2d');
      if (g) {
        g.putImageData(new ImageData(new Uint8ClampedArray(this.plan.rgba), this.plan.width, this.plan.height), 0, 0);
        this.imgCanvas = cv;
      }
    } catch { this.imgCanvas = null; }
  }

  private refreshPlan(): void {
    try { this.ctx.plan.refresh(); } catch { /* no canvas */ }
  }

  private drawLayer(g: CanvasRenderingContext2D, c: { worldToScreen(v: Vec2): { x: number; y: number } }): void {
    if (this.showScan && this.plan && this.pl && this.imgCanvas) {
      const { originX, originZ, unitsPerPx: u } = this.plan;
      const at = (i: number, j: number) => c.worldToScreen(scanToWorld(this.pl!, { x: originX + i * u, z: originZ + j * u }));
      const s0 = at(0, 0), sx = at(1, 0), sz = at(0, 1);
      g.save();
      g.globalAlpha = 0.5;
      g.imageSmoothingEnabled = false;
      g.transform(sx.x - s0.x, sx.y - s0.y, sz.x - s0.x, sz.y - s0.y, s0.x, s0.y);
      g.drawImage(this.imgCanvas, 0, 0);
      g.restore();
    }
    if (!this.pl) return;
    g.lineWidth = 2;
    g.font = '600 11px system-ui, sans-serif';
    g.textAlign = 'left';
    const mark = (p: Vec2, colour: string, label: string, ring: boolean): void => {
      const s = c.worldToScreen(p);
      g.strokeStyle = colour;
      g.fillStyle = colour;
      g.beginPath();
      if (ring) g.arc(s.x, s.y, 7, 0, Math.PI * 2);
      else { g.moveTo(s.x - 7, s.y); g.lineTo(s.x + 7, s.y); g.moveTo(s.x, s.y - 7); g.lineTo(s.x, s.y + 7); }
      g.stroke();
      g.fillText(label, s.x + 9, s.y - 6);
    };
    this.pins.forEach((p, i) => { mark(scanToWorld(this.pl!, p.scan), ORANGE, `scan ${i + 1}`, true); mark(p.world, BLUE, `plan ${i + 1}`, false); });
    if (this.pending) mark(scanToWorld(this.pl, this.pending), ORANGE, 'scan', true);
    this.tracePts.forEach((p, i) => mark(scanToWorld(this.pl!, p), ORANGE, `${i + 1}`, true));
  }

  // ------------------------------------------------------------ pins

  private buildPinControls(): void {
    clear(this.el.pinBox);
    clear(this.el.pinMsg);
    if (!this.level || !this.cloud) return;
    const draft = this.ctx.draft;
    const hintText = draft.layout.rooms.length === 0
      ? 'There are no rooms drawn yet. Pins need a layout to pin against. Draw the rooms first, or use "Trace from the scan instead" below.'
      : 'The scan shows over the layout at half strength. Pin 1: click a recognisable point on the scan (a door jamb, a corner), then the same point on the layout. Then Pin 2 the same way, far from Pin 1. The layout is the ruler, so this also sets the scan\'s scale.';
    this.el.pinMsg.textContent = this.pinStatus() || hintText;
    this.el.pinMsg.className = 'small';
    const p1 = h('button', { class: 'btn', text: 'Pin 1', onclick: () => this.arm(0) });
    const p2 = h('button', { class: 'btn', text: 'Pin 2', onclick: () => this.arm(1) });
    p2.disabled = this.pins.length < 1;
    this.el.pinBox.append(p1, p2);
  }

  private pinStatus(): string {
    if (this.armed?.kind === 'pin') {
      const n = this.armed.index + 1;
      return this.armed.phase === 'scan' ? `Pin ${n}: click a recognisable point on the scan image.` : `Pin ${n}: now click the same point on the layout.`;
    }
    if (this.pins.length === 1) return 'Pin 1 is set and the scan moved to match it. Now do Pin 2, far from Pin 1.';
    if (this.pins.length === 2 && this.ctx.draft.splat) return 'Scan pinned. The scan now sits where the layout says. Pin again to redo it.';
    return '';
  }

  private arm(index: 0 | 1): void {
    this.setFloorMode(false);
    this.el.err.textContent = '';
    if (index === 0) { this.pins = []; this.pending = null; }
    this.armed = { kind: 'pin', index, phase: 'scan' };
    this.installTool();
    this.el.pinMsg.textContent = this.pinStatus();
    this.refreshPlan();
  }

  private disarm(): void {
    this.armed = null;
    this.pending = null;
    try { this.ctx.plan.setTool(null); } catch { /* ignore */ }
  }

  private installTool(): void {
    const tool: PlanTool = {
      cursor: 'crosshair',
      onDown: (w) => this.onClick(w),
      onKey: (e) => { if (e.key === 'Escape') { this.disarm(); this.el.pinMsg.textContent = this.pinStatus(); this.refreshPlan(); } },
      cancel: () => { /* switching tools keeps the pins already set */ },
    };
    this.ctx.plan.setTool(tool);
  }

  private onClick(w: Vec2): void {
    const a = this.armed;
    if (!a || !this.pl || !this.level) return;
    this.el.err.textContent = '';
    if (a.kind === 'trace') {
      this.tracePts.push(worldToScan(this.pl, w));
      if (this.tracePts.length >= 2) { this.disarm(); this.showTraceForm(); }
      this.refreshPlan();
      return;
    }
    if (a.phase === 'scan') {
      this.pending = worldToScan(this.pl, w);
      this.armed = { ...a, phase: 'world' };
      this.el.pinMsg.textContent = this.pinStatus();
      this.refreshPlan();
      return;
    }
    const scan = this.pending!;
    this.pending = null;
    this.pins[a.index] = { scan, world: w };
    this.pins.length = a.index + 1;
    if (a.index === 0) {
      // slide the scan so Pin 1 lands exactly; it keeps its size and heading until Pin 2
      const moved = scanToWorld({ ...this.pl, tx: 0, tz: 0 }, scan);
      this.pl = { ...this.pl, tx: w.x - moved.x, tz: w.z - moved.z };
      this.disarm();
      this.pushPlacement();
      this.buildPinControls();
      return;
    }
    try {
      const pl = placementFromPairs([this.pins[0], this.pins[1]]);
      const transform = placeSplat(this.level, pl);
      this.pl = pl;
      this.disarm();
      this.pushPlacement();
      this.writeDraft(transform);
      this.buildPinControls();
    } catch (err) {
      this.pins.length = 1;
      this.disarm();
      this.el.err.textContent = err instanceof Error ? err.message : String(err);
      this.buildPinControls();
    }
  }

  private pushPlacement(): void {
    if (this.level && this.pl) this.handle?.setTransform(placeSplat(this.level, this.pl));
    this.refreshPlan();
  }

  private writeDraft(transform: SceneTransform, mode?: 'overlay' | 'replace'): void {
    if (!this.file) return;
    const prev = this.ctx.draft.splat;
    this.ctx.draft.splat = {
      file: this.file,
      format: formatOf(this.file),
      upPreset: this.upPreset ?? 'manual',
      transform,
      mode: mode ?? prev?.mode ?? 'overlay',
    };
    this.ctx.commit();
    this.buildModeControls();
    this.buildRemove();
  }

  // ------------------------------------------------------------ mode, remove

  private buildModeControls(): void {
    clear(this.el.modeBox);
    const splat = this.ctx.draft.splat;
    if (!splat) return;
    this.el.modeBox.append(h('h3', { text: 'How the scan is used' }));
    const choices: ['overlay' | 'replace', string][] = [
      ['overlay', 'Overlay on the clean walls (default)'],
      ['replace', 'Replace the clean walls (for a complete, good scan)'],
    ];
    for (const [mode, label] of choices) {
      const input = h('input', { type: 'radio', name: 'scan-mode', value: mode });
      input.checked = splat.mode === mode;
      input.addEventListener('change', () => {
        if (this.ctx.draft.splat) { this.ctx.draft.splat.mode = mode; this.ctx.commit(); }
      });
      this.el.modeBox.append(h('label', { class: 'field inline' }, input, h('span', { text: label })));
    }
  }

  private buildRemove(): void {
    clear(this.el.removeBox);
    if (!this.ctx.draft.splat) return;
    this.el.removeBox.append(h('button', {
      class: 'btn', text: 'Remove the scan overlay from this scene',
      onclick: () => { this.ctx.draft.splat = undefined; this.ctx.commit(); this.pins = []; this.buildModeControls(); this.buildRemove(); this.buildPinControls(); },
    }));
  }

  // ------------------------------------------------------------ reverse path: trace from the scan

  private buildTraceControls(): void {
    clear(this.el.traceBox);
    this.el.traceBox.append(h('h3', { text: 'No floor plan?' }));
    const noRooms = this.ctx.draft.layout.rooms.length === 0;
    const btn = h('button', { class: 'btn', text: 'Trace from the scan instead', onclick: () => this.startTrace() });
    btn.disabled = !noRooms;
    this.el.traceBox.append(
      h('p', { class: 'small muted', text: noRooms ? 'Pick two points on the scan, type the distance between them, and the scan image becomes the tracing underlay for Rooms.' : 'Only available while no rooms are drawn, because it replaces the plan underlay.' }),
      btn,
    );
  }

  private startTrace(): void {
    if (!this.level) { this.el.err.textContent = 'Choose the up axis first so the scan can be levelled.'; return; }
    this.setFloorMode(false);
    this.tracePts = [];
    this.pins = [];
    this.armed = { kind: 'trace' };
    this.installTool();
    this.el.pinMsg.textContent = 'Click two points on the scan image whose real distance you know, for example the two sides of a door.';
    this.refreshPlan();
  }

  private showTraceForm(): void {
    const select = h('select', {}, h('option', { value: '', text: 'Pick a standard size' }), ...DOOR_PRESETS.map((d) => h('option', { value: String(d.m), text: d.label })));
    const input = h('input', { type: 'text', placeholder: `0.90   13'1"   900 mm`, autocomplete: 'off', spellcheck: false });
    select.addEventListener('change', () => { if (select.value) input.value = select.value; });
    const go = (): void => { void this.finishTrace(input.value); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    clear(this.el.traceBox);
    this.el.traceBox.append(
      h('h3', { text: 'Trace from the scan' }),
      h('p', { class: 'small', text: 'Type the real distance between the two points.' }),
      h('label', { class: 'field' }, h('span', { text: 'Standard sizes' }), select),
      h('label', { class: 'field' }, h('span', { text: 'Distance' }), input),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Use the scan as the plan', onclick: go }), h('button', { class: 'btn', text: 'Start over', onclick: () => { this.tracePts = []; this.buildTraceControls(); this.refreshPlan(); } })),
    );
  }

  private async finishTrace(text: string): Promise<void> {
    const realM = parseLength(text);
    if (realM === null) { this.el.err.textContent = 'Could not read that distance. Try 0.9, 90 cm or 900 mm.'; return; }
    if (!this.level || !this.cloud || !this.plan || this.tracePts.length < 2) return;
    const plan = this.plan;
    const upp = plan.unitsPerPx;
    const [a, b] = this.tracePts;
    const centre = { x: plan.originX + (plan.width * upp) / 2, z: plan.originZ + (plan.height * upp) / 2 };
    let transform: SceneTransform;
    try { transform = alignSplatByDistance(this.level, a, b, realM, centre); } catch (err) { this.el.err.textContent = err instanceof Error ? err.message : String(err); return; }
    const toPx = (p: Vec2) => ({ x: (p.x - plan.originX) / upp, y: (p.z - plan.originZ) / upp });
    const pxPerM = 1 / (upp * transform.scale);
    // the image goes into the scene folder as plan.png, like a dropped floor plan
    let image: HTMLImageElement | null = null;
    try {
      const cv = document.createElement('canvas');
      cv.width = plan.width; cv.height = plan.height;
      const g = cv.getContext('2d')!;
      g.putImageData(new ImageData(new Uint8ClampedArray(plan.rgba), plan.width, plan.height), 0, 0);
      const blob: Blob = await new Promise((res, rej) => cv.toBlob((bl) => (bl ? res(bl) : rej(new Error('Could not make the PNG'))), 'image/png'));
      try { await this.ctx.api.saveFile('plan.png', blob); } catch (err) { this.host.toast(`${err instanceof Error ? err.message : String(err)} The plan is shown here, but it is not saved with the scene.`, 'warn'); }
      const url = URL.createObjectURL(blob);
      image = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not load the scan image')); im.src = url; });
    } catch (err) {
      this.el.err.textContent = `The scan image could not be turned into a plan. ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    if (!this.alive) return;
    this.ctx.draft.layout.underlay = { file: 'plan.png', pxPerM, originPx: { x: plan.width / 2, y: plan.height / 2 }, dimensions: [{ a: toPx(a), b: toPx(b), lengthM: realM }], disagreementPct: 0 };
    this.ctx.draft.layout.scaleSource = 'scan';
    this.host.underlayImage = image;
    this.showScan = false;
    this.tracePts = [];
    this.pl = { s: transform.scale, theta: 0, tx: transform.position[0], tz: transform.position[2] };
    this.pushPlacement();
    this.host.applyUnderlay();
    this.host.fitPlan();
    this.writeDraft(transform, 'overlay');
    this.host.toast('The scan image is now the tracing underlay. Draw the rooms along its walls.', 'info');
    this.host.goto('rooms');
  }
}
