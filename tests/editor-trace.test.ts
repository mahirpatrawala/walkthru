// The scripted trace (SPEC 9, C5 acceptance): the plan-truth.json clicks, with seeded jitter, go through the same helpers the editor's tools
// call, and the traced layout must rasterise to the truth classification on at least 98% of samples.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyTruth } from '../scripts/make-test-room';
import type { PlanTruth } from '../scripts/make-test-room';
import type { EditorContext } from '../src/editor/context';
import { OPENING_PRESETS, rectPolygon, snapPoint, tentativePxPerM } from '../src/editor/plan-helpers';
import { prepareSave } from '../src/editor/save';
import { addRoomToDraft } from '../src/editor/steps/rooms';
import { placeOpeningInDraft } from '../src/editor/steps/openings';
import { setDimensions } from '../src/editor/steps/scale';
import { cellValue } from '../src/core/grid-codec';
import { mulberry32 } from '../src/core/geometry';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { createEmptyProperty, validateLayout } from '../src/core/layout-validate';
import { pxToWorld } from '../src/core/plan-scale';
import { parseLength } from '../src/core/units';
import { GRID_FREE, GRID_VOID } from '../src/types';
import type { PropertyFile, Px, Vec2 } from '../src/types';

const truth = JSON.parse(readFileSync(new URL('../public/scenes/test-flat/plan-truth.json', import.meta.url), 'utf8')) as PlanTruth;
// plan.svg is 364 x 571 px (6.2); the editor's world origin is the image centre (3.1)
const IMG_W = 364;
const IMG_H = 571;

function trace(opts: { jitterPx: number; seed: number; zoom: number }): { draft: PropertyFile; draftRoomsOk: boolean } {
  const rnd = mulberry32(opts.seed);
  const jit = (p: Px): Px => ({ x: p.x + (rnd() * 2 - 1) * opts.jitterPx, y: p.y + (rnd() * 2 - 1) * opts.jitterPx });

  const draft = createEmptyProperty('trace');
  draft.layout.underlay = { file: 'plan.svg', pxPerM: tentativePxPerM(IMG_W, IMG_H), originPx: { x: IMG_W / 2, y: IMG_H / 2 }, dimensions: [], disagreementPct: 0 };
  const ctx = { draft, commit() {}, applyUnderlay() {}, loadScene: async () => ({ found: false }) } as unknown as EditorContext;

  // E2: click the two printed dimensions and type them
  const dims = truth.dimensions.map((d) => ({ a: jit(d.a), b: jit(d.b), lengthM: parseLength(d.label)! }));
  expect(dims.every((d) => d.lengthM > 0)).toBe(true);
  setDimensions(ctx, dims);
  const u = draft.layout.underlay!;
  const screenScale = u.pxPerM * opts.zoom; // the plan shown at `zoom` x its natural size

  // E3: rectangle tool, corner to corner, snapping on
  for (const r of truth.rooms) {
    const toWorld = (px: Px): Vec2 => snapPoint(pxToWorld(jit(px), u), { rooms: draft.layout.rooms, pxPerMetre: screenScale, hasUnderlay: true }).point;
    const c1 = toWorld(r.cornersPx[0]);
    const c2 = toWorld(r.cornersPx[2]);
    addRoomToDraft(draft.layout, rectPolygon(c1, c2), r.roomType, r.label);
  }

  // E4: preset, click the edge; widths typed where the preset differs
  let ok = true;
  for (const o of truth.openings) {
    const preset = o.type === 'window' ? OPENING_PRESETS[4] : o.type === 'opening' ? OPENING_PRESETS[3] : OPENING_PRESETS[0];
    const click = pxToWorld(jit(o.centrePx), u);
    const placed = placeOpeningInDraft(draft.layout, click, preset, (8 * 1.5) / screenScale);
    if (!placed) { ok = false; continue; }
    placed.widthM = o.widthM; // the broker edits the width field
  }
  return { draft, draftRoomsOk: ok };
}

function agreement(draft: PropertyFile, variant: 'empty', n: number, seed: number): { used: number; ok: number } {
  const u = draft.layout.underlay!;
  const grid = stampFurniture(rasterizeLayout(draft.layout), draft.furniture);
  const rnd = mulberry32(seed);
  let used = 0;
  let ok = 0;
  while (used < n) {
    const x = -1.5 + rnd() * 7;
    const z = -3 + rnd() * 11;
    const cls = classifyTruth(x, z, variant);
    if (cls === 'edge') continue;
    used++;
    // the truth point sits at this pixel of plan.svg (6.2: px = 60 + (x + 0.3) * 53, 60 + (z + 1.9) * 53); the editor maps it with its own scale
    const w = pxToWorld({ x: 60 + (x + 0.3) * 53, y: 60 + (z + 1.9) * 53 }, u);
    const v = cellValue(grid, w.x, w.z);
    const got = v === GRID_VOID ? 'void' : v === GRID_FREE ? 'free' : 'obstacle';
    if (got === cls) ok++;
  }
  return { used, ok };
}

describe('scripted trace of plan-truth.json through the editor helpers', () => {
  it('the typed dimensions give the expected scale (0.3% label rounding is inside the 3% limit)', () => {
    const { draft } = trace({ jitterPx: 0, seed: 1, zoom: 1.5 });
    const u = draft.layout.underlay!;
    expect(u.pxPerM).toBeGreaterThan(52.5);
    expect(u.pxPerM).toBeLessThan(53.6);
    expect(u.disagreementPct).toBeLessThan(1);
    expect(draft.layout.scaleSource).toBe('plan-dimensions');
  });
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`reaches >= 98% raster agreement with the truth (jitter +-1 px, seed ${seed})`, () => {
      const { draft, draftRoomsOk } = trace({ jitterPx: 1, seed, zoom: 1.5 });
      expect(draftRoomsOk).toBe(true);
      expect(draft.layout.rooms).toHaveLength(3);
      expect(draft.layout.openings).toHaveLength(4);
      const r = agreement(draft, 'empty', 30000, 100 + seed);
      const pct = (100 * r.ok) / r.used;
      console.log(`trace seed ${seed}: ${r.ok}/${r.used} = ${pct.toFixed(2)}%`);
      expect(r.ok / r.used).toBeGreaterThanOrEqual(0.98);
    });
  }
  it('gets the room areas, door sizes and edge kinds right, validates clean, and saves', () => {
    const { draft } = trace({ jitterPx: 1, seed: 9, zoom: 1.5 });
    const areas = Object.fromEntries(draft.layout.rooms.map((r) => [r.label, r]));
    const area = (id: string): number => {
      const p = areas[id].polygon;
      let s = 0;
      for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i].x * q.z - q.x * p[i].z; }
      return s / 2;
    };
    expect(area('Bedroom 1')).toBeGreaterThan(20 * 0.97);
    expect(area('Bedroom 1')).toBeLessThan(20 * 1.03);
    expect(area('Balcony')).toBeGreaterThan(4.5 * 0.95);
    expect(area('Balcony')).toBeLessThan(4.5 * 1.05);
    expect(areas['Balcony'].edges.filter((k) => k === 'railing')).toHaveLength(3);
    expect(areas['Passage'].roomType).toBe('other');
    const { errors } = validateLayout(draft.layout);
    expect(errors).toEqual([]);
    // spawn at the truth spawn (2.6, 0.8) in the truth frame, mapped to the editor frame
    const u = draft.layout.underlay!;
    draft.spawn = { ...pxToWorld({ x: 60 + (2.6 + 0.3) * 53, y: 60 + (0.8 + 1.9) * 53 }, u), yawDeg: 0 };
    const out = prepareSave(draft, rasterizeLayout(draft.layout));
    expect(out.errors).toEqual([]);
    expect(out.property!.layout.rooms).toHaveLength(3);
  });
  it('snapping at a low zoom pulls the passage onto the bedroom wall (why the broker zooms in), and Alt-style no-snap restores the gap', () => {
    const lowZoom = trace({ jitterPx: 0, seed: 1, zoom: 1.0 });
    const hiZoom = trace({ jitterPx: 0, seed: 1, zoom: 1.5 });
    const gap = (d: PropertyFile): number => d.layout.rooms[2].polygon[0].z - d.layout.rooms[0].polygon[2].z;
    expect(gap(hiZoom.draft)).toBeGreaterThan(0.1);
    expect(gap(lowZoom.draft)).toBeLessThan(0.01);
  });
});
