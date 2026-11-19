// SPEC 16.14 baked lighting: everything that can be tested without Blender and without a GPU. Manifest parsing, the hash no-op, lightmap
// assignment by name, fallbacks (missing, corrupt, other format), probe interpolation, parity, and the honesty invariants.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rasterizeLayout } from '../src/core/layout-raster';
import { carpetAreaM2 } from '../src/core/layout-geom';
import { validateProperty } from '../src/core/layout-validate';
import { buildShell, shellStats } from '../src/engine/shell';
import { buildAoField } from '../src/look/floor-ao';
import { LABEL_LIGHTING } from '../src/look/types';
import { PRESET_HOURS, gradeAt } from '../src/look/grade';
import type { Look } from '../src/look/look';
import { applyUv, assignByName, geometryChecksum, parseGeometryBuffer } from '../src/look/baked/assign';
import { positionChecksum } from '../src/look/baked/checksum';
import type { CompositorLike } from '../src/look/baked/composite';
import { fromHalf, halfArray, floatArray, toHalf } from '../src/look/baked/half';
import { meshPathKey } from '../src/look/baked/keys';
import { outdoorPortals, planDownlights, probeGridFor, sunKeys } from '../src/look/baked/lights';
import { parseManifest } from '../src/look/baked/manifest';
import { packRects, packSmallest } from '../src/look/baked/pack';
import { checkParity, expectedShellBoxes } from '../src/look/baked/parity';
import { ProbeVolume, SH_FLOATS, fillInvalidProbes, shIrradiance } from '../src/look/baked/probes';
import { fetchManifest, mountBaked } from '../src/look/baked/runtime';
import { BAKE_FORMAT_VERSION } from '../src/look/baked/types';
import type { BakedManifest, MeshEntry } from '../src/look/baked/types';
import { buildCharts, unwrapAtlas } from '../src/look/baked/unwrap';
import type { UnwrapMesh } from '../src/look/baked/unwrap';
import { AO_SHADE, BOUNCE_SATURATION, FILL_FRACTION, SUN_BOUNCE_TINT, ambientFill, bounceWeights, componentWeights, desaturate, luma, sunBlend } from '../src/look/baked/weights';
import { decideBake, inputsHashOf } from '../scripts/bake/hash';

const ROOT = path.resolve(__dirname, '..');
const sample = (id: string) => validateProperty(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'scenes', id, 'property.json'), 'utf8')));

// ---------------------------------------------------------------- helpers: a tiny, valid manifest

function manifestObject(over: Record<string, unknown> = {}): Record<string, unknown> {
  const comp = (file: string) => ({ file, bytes: 10, gain: 2 });
  const tier = () => ({ static: { size: 256, components: { sky: comp('sky.webp'), sun1: comp('sun1.webp') } }, dyn: { size: 128, ao: comp('ao.webp') } });
  return {
    version: BAKE_FORMAT_VERSION, sceneId: 'test-x', inputsHash: 'abc123',
    pipeline: { version: 1, blender: '5.3.0', quality: 'draft', samples: 48, denoised: true, texelsPerM: 16, presets: ['afternoon'], seconds: 12, createdAt: '2026-11-14T00:00:00Z' },
    sun: [{ id: 'sun1', hour: 15, toSun: [0.3, 0.8, 0.5] }],
    atlases: { medium: tier(), low: tier() },
    geometry: { file: 'geometry.bin', bytes: 100, uvElements: 8 },
    meshes: { 'shell/floor:a': { verts: 6, checksum: 1234, atlas: 'static', uvOffset: 0, uvCount: 6 } },
    probes: { origin: [0, 0, 0], spacing: [1, 1, 1], dims: [2, 2, 2], coeffs: 9, components: ['sky'], file: 'probes.bin', bytes: 8 * 27 * 2, validCount: 8 },
    fixtures: [{ kind: 'downlight', position: [1, 2.5, 1], radiusM: 0.045, roomId: 'a' }],
    calibration: { lampMeanIrradiance: 1.4, coveMeanIrradiance: 0.9 },
    totals: { bytes: 1000, meshes: 1, staticMeshes: 1, dynMeshes: 0 },
    ...over,
  };
}

describe('manifest parsing (16.14)', () => {
  it('reads a complete manifest', () => {
    const m = parseManifest(manifestObject());
    expect(m).not.toBeNull();
    expect(m!.sceneId).toBe('test-x');
    expect(m!.atlases.medium.static.components.sky!.gain).toBe(2);
    expect(m!.atlases.low.dyn!.ao.file).toBe('ao.webp');
    expect(m!.probes!.dims).toEqual([2, 2, 2]);
    expect(m!.meshes['shell/floor:a'].atlas).toBe('static');
  });
  it('gives null, never a throw, for anything unusable', () => {
    const bad: unknown[] = [
      null, 42, 'x', [], {}, manifestObject({ version: 99 }), manifestObject({ sceneId: '' }), manifestObject({ inputsHash: undefined }),
      manifestObject({ atlases: {} }), manifestObject({ geometry: { file: '../etc/passwd', bytes: 1, uvElements: 1 } }),
      manifestObject({ geometry: { file: 'a/b.bin', bytes: 1, uvElements: 1 } }),
      manifestObject({ meshes: { k: { verts: 'six', checksum: 1, atlas: 'static', uvOffset: 0, uvCount: 6 } } }),
      manifestObject({ meshes: { k: { verts: 6, checksum: 1, atlas: 'sideways', uvOffset: 0, uvCount: 6 } } }),
      manifestObject({ meshes: { k: { verts: 6, checksum: 1, atlas: 'static', uvOffset: 0, uvCount: 3 } } }),
      manifestObject({ sun: [{ id: 'sun9', hour: 1, toSun: [0, 1, 0] }] }),
      manifestObject({ probes: { origin: [0, 0, 0] } }),
      manifestObject({ atlases: { medium: { static: { size: 256, components: {} } }, low: { static: { size: 256, components: {} } } } }),
    ];
    for (const b of bad) expect(() => parseManifest(b)).not.toThrow();
    for (const b of bad) expect(parseManifest(b)).toBeNull();
  });
  it('a stored manifest that was cut short does not parse', () => {
    const text = JSON.stringify(manifestObject());
    let parsed: unknown = null;
    try { parsed = JSON.parse(text.slice(0, text.length - 20)); } catch { parsed = null; }
    expect(parseManifest(parsed)).toBeNull();
  });
});

// ---------------------------------------------------------------- the hash no-op

describe('inputs hash and the skip decision (16.14)', () => {
  const inputs = { meshes: [{ key: 'a', bbox: [0, 0, 0, 1, 1, 1] }], bin: new Uint8Array([1, 2, 3, 4]), settings: { quality: 'draft', v: 1 }, sources: ['x:1'] };
  it('is stable for the same inputs and changes with any one of them', () => {
    const h = inputsHashOf(inputs);
    expect(inputsHashOf({ ...inputs })).toBe(h);
    expect(inputsHashOf({ ...inputs, bin: new Uint8Array([1, 2, 3, 5]) })).not.toBe(h);
    expect(inputsHashOf({ ...inputs, settings: { quality: 'final', v: 1 } })).not.toBe(h);
    expect(inputsHashOf({ ...inputs, sources: ['x:2'] })).not.toBe(h);
    expect(inputsHashOf({ ...inputs, meshes: [{ key: 'a', bbox: [0, 0, 0, 1, 1, 1.001] }] })).not.toBe(h);
  });
  it('skips only when the hash matches and every named file is there; --force always bakes', () => {
    const m = parseManifest(manifestObject({ inputsHash: 'h1' }))!;
    const all = (_: string) => true;
    expect(decideBake(m, 'h1', false, all).action).toBe('skip');
    expect(decideBake(m, 'h2', false, all).action).toBe('bake');
    expect(decideBake(m, 'h1', true, all).action).toBe('bake');
    expect(decideBake(null, 'h1', false, all).action).toBe('bake');
    expect(decideBake(m, 'h1', false, (f) => f !== 'probes.bin').action).toBe('bake');
    expect(decideBake(m, 'h1', false, (f) => f !== 'ao.webp').action).toBe('bake');
  });
});

// ---------------------------------------------------------------- numbers

describe('half floats', () => {
  it('round-trip within half precision', () => {
    for (const v of [0, 1, -1, 0.5, 3.14159, 100.25, 0.001, -0.3333, 1024]) expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThanOrEqual(Math.abs(v) * 0.001 + 1e-6);
    const a = new Float32Array([0.1, 2, -3, 0]);
    const b = floatArray(halfArray(a));
    a.forEach((v, i) => expect(Math.abs(b[i] - v)).toBeLessThan(0.01));
  });
});

describe('light probes (16.14)', () => {
  const grid = { origin: [0, 0, 0] as [number, number, number], spacing: [1, 1, 1] as [number, number, number], dims: [3, 2, 3] as [number, number, number], coeffs: 9 as const, components: ['sky' as const, 'lamps' as const], file: 'p.bin', bytes: 0, validCount: 18 };
  const n = 3 * 2 * 3;
  /** radiance SH whose constant term is `c0` (rgb) at every probe */
  const field = (f: (i: number) => number): Float32Array => {
    const a = new Float32Array(n * 2 * SH_FLOATS);
    for (let p = 0; p < n; p++) { const o = (p * 2 + 0) * SH_FLOATS; const v = f(p); a[o] = v; a[o + 1] = v; a[o + 2] = v; }
    return a;
  };
  it('a uniform sky gives the irradiance pi * radiance on any normal', () => {
    const vol = new ProbeVolume(grid, field(() => 1));
    vol.setWeights({ sky: [1, 1, 1] });
    const sh = vol.sample(1, 0.5, 1);
    const E = shIrradiance(sh, 0, 1, 0);
    expect(E[0]).toBeCloseTo(Math.PI * 0.282095 * 1 * 1, 3); // A0 * Y00 * c0
    const side = shIrradiance(sh, 1, 0, 0);
    expect(side[0]).toBeCloseTo(E[0], 6);
  });
  it('interpolates trilinearly and clamps outside the grid', () => {
    const vol = new ProbeVolume(grid, field((p) => (p % 3))); // x index 0, 1, 2
    vol.setWeights({ sky: [1, 1, 1] });
    expect(vol.sample(0.5, 0, 0)[0]).toBeCloseTo(0.5, 6);
    expect(vol.sample(1.25, 0.3, 1.1)[0]).toBeCloseTo(1.25, 6);
    expect(vol.sample(-5, -5, -5)[0]).toBeCloseTo(0, 6);
    expect(vol.sample(50, 50, 50)[0]).toBeCloseTo(2, 6);
  });
  it('component weights mix, and a zero weight removes a component', () => {
    const a = new Float32Array(n * 2 * SH_FLOATS);
    for (let p = 0; p < n; p++) { a[(p * 2) * SH_FLOATS] = 1; a[(p * 2 + 1) * SH_FLOATS] = 10; }
    const vol = new ProbeVolume(grid, a);
    vol.setWeights({ sky: [1, 1, 1], lamps: [0, 0, 0] });
    expect(vol.sample(1, 0.5, 1)[0]).toBeCloseTo(1, 6);
    vol.setWeights({ sky: [1, 1, 1], lamps: [0.5, 0.5, 0.5] });
    expect(vol.sample(1, 0.5, 1)[0]).toBeCloseTo(6, 6);
    vol.setWeights({ sky: [0, 0, 0], lamps: [0, 0, 0] }, [1, 1, 1]);
    expect(shIrradiance(vol.sample(1, 0.5, 1), 0, 1, 0)[0]).toBeCloseTo(1, 4); // an ambient fill of E = 1 reads back as irradiance 1
  });
  it('rejects data that does not match the grid', () => {
    expect(() => new ProbeVolume(grid, new Float32Array(10))).toThrow();
  });
  it('probes in walls take their valid neighbours', () => {
    const dims: [number, number, number] = [4, 1, 1];
    const data = new Float32Array([1, 0, 0, 0, 0, 0, 5, 7]);
    const valid = new Uint8Array([1, 0, 0, 1]);
    fillInvalidProbes(data, valid, dims, 2);
    expect(Array.from(data)).toEqual([1, 0, 1, 0, 5, 7, 5, 7]);
  });
});

describe('weights (16.14)', () => {
  it('suns cross-fade by hour and always sum to 1', () => {
    for (const h of [6, 8.5, 10, 12, 15, 16, 17.8, 19, 21]) { const b = sunBlend(h); expect(b[0] + b[1] + b[2]).toBeCloseTo(1, 9); }
    expect(sunBlend(PRESET_HOURS.afternoon)).toEqual([0, 1, 0]);
  });
  it('night has no sun, lamps follow the interior level, the sun only where a sun was baked', () => {
    const night = componentWeights({ grade: gradeAt(PRESET_HOURS.night), skyScale: 1, sunScale: 1, sunHours: [8.5, 15, 17.8], skyBoost: 1 });
    expect(night.sun0).toEqual([0, 0, 0]); expect(night.sun1).toEqual([0, 0, 0]); expect(night.sun2).toEqual([0, 0, 0]);
    expect(night.lamps[0]).toBeGreaterThan(0.5);
    const day = componentWeights({ grade: gradeAt(PRESET_HOURS.afternoon), skyScale: 1, sunScale: 1, sunHours: [null, 15, null], skyBoost: 1 });
    expect(day.sun1[0]).toBeGreaterThan(1);
    expect(day.sun0).toEqual([0, 0, 0]);
    // by day the lamps component carries only the small share of the glowing downlights (SPEC 16.26), never the lights' full level
    expect(day.lamps[0]).toBeGreaterThan(0);
    expect(day.lamps[0]).toBeLessThan(0.2);
    expect(ambientFill(gradeAt(PRESET_HOURS.afternoon)).every((v) => v > 0)).toBe(true);
    // Morning and Evening baked, Afternoon not: the afternoon still has a sun (the nearest one)
    const gap = componentWeights({ grade: gradeAt(PRESET_HOURS.afternoon), skyScale: 1, sunScale: 1, sunHours: [8.5, null, 17.8], skyBoost: 1 });
    expect(gap.sun0[0] + gap.sun2[0]).toBeGreaterThan(1);
    expect(gap.sun1).toEqual([0, 0, 0]);
  });
});

describe('white balance of the baked light (16.14, round 5)', () => {
  const day = componentWeights({ grade: gradeAt(PRESET_HOURS.afternoon), skyScale: 1, sunScale: 1, sunHours: [8.5, 15, 17.8], skyBoost: 1 });
  it('the sky component has the colour the live look gives a wall: the two halves of the hemisphere, not a warm tint', () => {
    const g = gradeAt(PRESET_HOURS.afternoon);
    const mid = [0, 1, 2].map((k) => 0.5 * (g.hemiSky[k] + g.hemiGround[k]));
    for (let k = 0; k < 3; k++) expect(day.sky[k] / g.hemiIntensity).toBeCloseTo(mid[k], 2);
    expect(day.sky[0] / day.sky[2]).toBeLessThan(1.08); // it was 1.33
    const fill = ambientFill(g);
    expect(fill[0] / fill[2]).toBeLessThan(1.08);
  });
  it('bounced sunlight keeps a tenth of the sun tint at the same luminance; the sun patch and the lamps keep their colour', () => {
    const b = bounceWeights(day);
    expect(luma(b.sun1)).toBeCloseTo(luma(day.sun1), 6);
    const sat = (c: [number, number, number]): number => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
    expect(sat(b.sun1)).toBeLessThan(sat(day.sun1) * (SUN_BOUNCE_TINT + 0.05));
    expect(b.sky).toEqual(day.sky); expect(b.lamps).toEqual(day.lamps); expect(b.cove).toEqual(day.cove);
    expect(desaturate([1, 0.5, 0.2], 1)).toEqual([1, 0.5, 0.2]);
    const grey = desaturate([1, 0.5, 0.2], 0);
    expect(grey[0]).toBeCloseTo(grey[1], 9); expect(grey[1]).toBeCloseTo(grey[2], 9);
  });
  it('a probe keeps only the given share of the colour its light picked up from the room', () => {
    const grid = { origin: [0, 0, 0] as [number, number, number], spacing: [1, 1, 1] as [number, number, number], dims: [2, 2, 2] as [number, number, number], coeffs: 9 as const, components: ['sky' as const], file: 'p.bin', bytes: 0, validCount: 8 };
    const a = new Float32Array(8 * SH_FLOATS);
    for (let p = 0; p < 8; p++) { a[p * SH_FLOATS] = 1.0; a[p * SH_FLOATS + 1] = 0.6; a[p * SH_FLOATS + 2] = 0.2; } // an orange bounce
    const vol = new ProbeVolume(grid, a);
    vol.setWeights({ sky: [1, 1, 1] });
    const full = Array.from(vol.sample(0.5, 0.5, 0.5).subarray(0, 3));
    expect(full[0]).toBeCloseTo(1, 6); expect(full[2]).toBeCloseTo(0.2, 6);
    vol.setWeights({ sky: [1, 1, 1] }, [0, 0, 0], BOUNCE_SATURATION);
    const wb = Array.from(vol.sample(0.5, 0.5, 0.5).subarray(0, 3)) as [number, number, number];
    expect(luma(wb)).toBeCloseTo(luma(full as [number, number, number]), 5);
    expect(wb[0] / wb[2]).toBeLessThan(1.4); // from 5
    expect(wb[0]).toBeGreaterThan(wb[2]); // a hint of the floor stays
  });
  it('the ambient level carries a baked room by day, softly shaded by the AO', () => {
    expect(FILL_FRACTION).toBeGreaterThan(1); expect(AO_SHADE).toBeGreaterThan(0.4); expect(AO_SHADE).toBeLessThan(1);
    expect(fs.readFileSync(path.join(ROOT, 'src/look/baked/composite.ts'), 'utf8')).toMatch(/uSat/);
  });
});

// ---------------------------------------------------------------- unwrap and packing

describe('atlas packing (16.14)', () => {
  it('places every rectangle inside the square without overlap', () => {
    const rects = Array.from({ length: 40 }, (_, i) => ({ id: i, w: 8 + ((i * 37) % 60), h: 8 + ((i * 53) % 50) }));
    const placed = packRects(rects, 512)!;
    expect(placed).not.toBeNull();
    for (const a of placed) {
      expect(a.x).toBeGreaterThanOrEqual(0); expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(512); expect(a.y + a.h).toBeLessThanOrEqual(512);
      for (const b of placed) if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
  });
  it('picks the smallest power of two and gives up when nothing fits', () => {
    expect(packSmallest([{ id: 0, w: 100, h: 100 }], 64, 1024)!.size).toBe(128);
    expect(packSmallest([{ id: 0, w: 2000, h: 10 }], 64, 1024)).toBeNull();
  });
});

function boxMesh(w: number, h: number, d: number, key = 'box'): UnwrapMesh {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  return { key, positions: g.getAttribute('position').array as Float32Array, normals: g.getAttribute('normal').array as Float32Array, texelsPerM: 20, maxLeanDeg: 25 };
}

describe('lightmap unwrap (16.14)', () => {
  it('a box is six charts, every uv is inside the atlas, and charts do not overlap', () => {
    const m = boxMesh(1, 2, 3);
    expect(buildCharts(m).length).toBe(6);
    const r = unwrapAtlas([m], { pad: 2, minSize: 64, maxSize: 512 });
    expect(r.results[0].uvCount).toBe(36);
    for (const v of r.results[0].uv) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(1); }
    const rects = r.results[0].rects;
    for (const a of rects) for (const b of rects) if (a !== b) expect(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]).toBe(true);
  });
  it('texel density follows the request (about 20 texels per metre)', () => {
    const r = unwrapAtlas([boxMesh(2, 2, 2)], { pad: 2, minSize: 64, maxSize: 1024 });
    const uv = r.results[0].uv;
    // first face: 4 corners of a 2 m square, find the extent in texels
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 6; i++) { min = Math.min(min, uv[i * 2] * r.size); max = Math.max(max, uv[i * 2] * r.size); }
    expect(max - min).toBeGreaterThan(30); expect(max - min).toBeLessThan(50);
  });
  it('a vertex shared by two charts is split, and the triangles keep their positions', () => {
    // an indexed 'L': two triangles at 90 degrees sharing an edge
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const index = new Uint32Array([0, 1, 2, 0, 3, 1]);
    const m: UnwrapMesh = { key: 'l', positions, normals: new Float32Array(12), index, texelsPerM: 20, maxLeanDeg: 25 };
    const r = unwrapAtlas([m], { pad: 2, minSize: 64, maxSize: 256 }).results[0];
    expect(r.remap).toBeDefined();
    expect(r.uvCount).toBeGreaterThan(4);
    // every output vertex copies a source vertex: positions of the new index equal the old triangles' positions
    const src = (i: number): number => (i < 4 ? i : r.remap![i - 4]);
    for (let t = 0; t < 6; t++) expect(src(r.index![t])).toBe(index[t]);
  });
  it('surfaces that nobody sees get a sliver of the density', () => {
    const m = { ...boxMesh(2, 2, 2), densityOf: ({ normal }: { normal: [number, number, number] }) => (normal[1] > 0.5 ? 0.1 : 1) };
    const r = unwrapAtlas([m], { pad: 2, minSize: 64, maxSize: 1024 });
    const rects = r.results[0].rects.map((x) => x[2] * x[3]).sort((a, b) => a - b);
    expect(rects[0]).toBeLessThan(rects[rects.length - 1] / 20);
  });
});

// ---------------------------------------------------------------- the lights set-up and the scene data

describe('lights, portals, probe grid (16.14)', () => {
  const p = sample('test-sample-3');
  it('three baked suns, unit vectors that point up, from the same sun.ts the look uses', () => {
    const keys = sunKeys(p.layout, null);
    expect(keys.map((k) => k.id)).toEqual(['sun0', 'sun1', 'sun2']);
    for (const k of keys) { expect(Math.hypot(...k.toSun)).toBeCloseTo(1, 6); expect(k.toSun[1]).toBeGreaterThan(0); }
    expect(keys[1].hour).toBe(PRESET_HOURS.afternoon);
  });
  it('downlights sit under the ceiling inside furnished rooms only, deterministically', () => {
    const a = planDownlights(p.layout), b = planDownlights(p.layout);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(8);
    for (const d of a) {
      expect(d.position[1]).toBeLessThan(p.layout.wallHeightM);
      const room = p.layout.rooms.find((r) => r.id === d.roomId)!;
      expect(room.roomType).not.toBe('balcony');
      const xs = room.polygon.map((q) => q.x), zs = room.polygon.map((q) => q.z);
      expect(d.position[0]).toBeGreaterThan(Math.min(...xs)); expect(d.position[0]).toBeLessThan(Math.max(...xs));
      expect(d.position[2]).toBeGreaterThan(Math.min(...zs)); expect(d.position[2]).toBeLessThan(Math.max(...zs));
    }
  });
  it('portals face into the room and the probe grid has baked probes inside rooms', () => {
    const portals = outdoorPortals(p.layout);
    expect(portals.length).toBeGreaterThan(0);
    for (const q of portals) { expect(Math.hypot(...q.normal)).toBeCloseTo(1, 6); expect(q.w).toBeGreaterThan(0.2); }
    const g = probeGridFor(p.layout, 0.75);
    expect(g.positions.length).toBe(g.valid.length * 3);
    const valid = g.valid.reduce((s, v) => s + v, 0);
    expect(valid).toBeGreaterThan(100); expect(valid).toBeLessThan(g.valid.length);
    expect(g.dims[0] * g.dims[1] * g.dims[2]).toBe(g.valid.length);
  });
});

// ---------------------------------------------------------------- parity

function dumpOfShell(layout: ReturnType<typeof sample>['layout']): { key: string; bbox: [number, number, number, number, number, number] }[] {
  const shell = buildShell(layout);
  shell.updateMatrixWorld(true);
  const out: { key: string; bbox: [number, number, number, number, number, number] }[] = [];
  for (const c of shell.children) {
    const b = new THREE.Box3().setFromObject(c);
    out.push({ key: `shell/${c.name}`, bbox: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z] });
  }
  return out;
}

describe('geometry parity (16.14)', () => {
  const p = sample('test-sample-3');
  it('the shell the app builds matches the layout to the millimetre', () => {
    const rep = checkParity(dumpOfShell(p.layout), p.layout, p.furniture);
    expect(rep.ok).toBe(true);
    expect(rep.checked).toBeGreaterThan(20);
    expect(rep.maxDeltaMm).toBeLessThan(0.01);
    expect(expectedShellBoxes(p.layout).size).toBeGreaterThan(20);
  });
  it('fails when one mesh is 2 mm off, passes at 0.5 mm', () => {
    const d = dumpOfShell(p.layout);
    const i = d.findIndex((m) => m.key.startsWith('shell/floor:'));
    const off = d.map((m, k) => (k === i ? { ...m, bbox: [m.bbox[0] + 0.002, m.bbox[1], m.bbox[2], m.bbox[3], m.bbox[4], m.bbox[5]] as typeof m.bbox } : m));
    const rep = checkParity(off, p.layout, []);
    expect(rep.ok).toBe(false);
    expect(rep.failures[0].key).toBe(d[i].key);
    const near = d.map((m, k) => (k === i ? { ...m, bbox: [m.bbox[0] + 0.0005, m.bbox[1], m.bbox[2], m.bbox[3], m.bbox[4], m.bbox[5]] as typeof m.bbox } : m));
    expect(checkParity(near, p.layout, []).ok).toBe(true);
  });
  it('a piece of furniture may be smaller than its box but not stick out of it', () => {
    const it0 = p.furniture[0];
    const b = it0.box;
    const inside = [{ key: `furniture/furniture:${it0.id}/frame`, bbox: [b.cx - 0.1, 0, b.cz - 0.1, b.cx + 0.1, 0.4, b.cz + 0.1] as [number, number, number, number, number, number] }];
    expect(checkParity(inside, p.layout, [it0]).ok).toBe(true);
    const out = [{ key: `furniture/furniture:${it0.id}/frame`, bbox: [b.cx - 0.1, 0, b.cz - 0.1, b.cx + 0.1, it0.heightM + 0.05, b.cz + 0.1] as [number, number, number, number, number, number] }];
    expect(checkParity(out, p.layout, [it0]).ok).toBe(false);
  });
});

// ---------------------------------------------------------------- lightmap assignment by name

/** a scene shaped like the app's: shell > floor:a, kit > kit:thing, furniture > furniture:bed-1 > frame */
function miniScene(): { scene: THREE.Scene; floor: THREE.Mesh; bed: THREE.Mesh; thing: THREE.Mesh; extra: THREE.Mesh } {
  const scene = new THREE.Scene();
  const shell = new THREE.Group(); shell.name = 'shell';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).toNonIndexed(), new THREE.MeshStandardMaterial()); floor.name = 'floor:a'; floor.rotation.x = -Math.PI / 2; floor.updateMatrixWorld();
  shell.add(floor);
  const kit = new THREE.Group(); kit.name = 'kit';
  const thing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial()); thing.name = 'kit:thing'; kit.add(thing);
  const furniture = new THREE.Group(); furniture.name = 'furniture';
  const item = new THREE.Group(); item.name = 'furniture:bed-1';
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 2), new THREE.MeshStandardMaterial()); bed.name = 'frame'; item.add(bed);
  const extra = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial()); extra.name = 'cushion';
  const added = new THREE.Group(); added.name = 'furniture:catalogue-9'; added.add(extra);
  furniture.add(item, added);
  scene.add(shell, kit, furniture);
  return { scene, floor, bed, thing, extra };
}
function entryFor(mesh: THREE.Mesh, atlas: 'static' | 'dyn', uvOffset: number): MeshEntry {
  const cs = geometryChecksum(mesh.geometry);
  return { verts: cs.count, checksum: cs.checksum, atlas, uvOffset, uvCount: cs.count };
}
function manifestFor(entries: Record<string, MeshEntry>): BakedManifest {
  const m = parseManifest(manifestObject({ meshes: entries }));
  if (!m) throw new Error('test manifest invalid');
  return m;
}

describe('lightmap assignment by name (16.14)', () => {
  it('finds meshes by their path key, gives them uv1, and treats unknown furniture as probe-lit', () => {
    const { scene, floor, bed, thing, extra } = miniScene();
    const keys = { floor: meshPathKey([scene, scene.children[0], floor]), bed: meshPathKey([scene, scene.children[2], scene.children[2].children[0], bed]) };
    expect(keys.floor).toBe('shell/floor:a');
    expect(keys.bed).toBe('furniture/furniture:bed-1/frame');
    const total = floor.geometry.getAttribute('position').count + bed.geometry.getAttribute('position').count + thing.geometry.getAttribute('position').count;
    const g = { u16: new Uint16Array(total * 2).fill(1000), u32: new Uint32Array(0) };
    let off = 0;
    const entries: Record<string, MeshEntry> = {};
    entries[keys.floor] = entryFor(floor, 'static', off); off += 2 * floor.geometry.getAttribute('position').count;
    entries['kit/kit:thing'] = entryFor(thing, 'static', off); off += 2 * thing.geometry.getAttribute('position').count;
    entries[keys.bed] = entryFor(bed, 'dyn', off);
    const r = assignByName(scene, manifestFor(entries), g);
    const kind = (m: THREE.Mesh): string | undefined => r.assigned.find((a) => a.mesh === m)?.kind;
    expect(kind(floor)).toBe('static');
    expect(kind(thing)).toBe('static');
    expect(kind(bed)).toBe('dyn');
    expect(kind(extra)).toBe('probe'); // added by the buyer: no bake, still lit by the probes
    expect(floor.geometry.getAttribute('uv1')).toBeDefined();
    expect(bed.geometry.getAttribute('uv1').count).toBe(bed.geometry.getAttribute('position').count);
    expect(extra.geometry.getAttribute('uv1')).toBeUndefined();
    expect(r.rejected).toEqual([]);
  });
  it('rejects a mesh that has the right name but another shape (the furniture changed since the bake)', () => {
    const { scene, bed } = miniScene();
    const e = entryFor(bed, 'dyn', 0);
    const g = { u16: new Uint16Array(500), u32: new Uint32Array(0) };
    bed.geometry = new THREE.BoxGeometry(1, 0.5, 2.5); // same vertex count, different positions
    const r = assignByName(scene, manifestFor({ 'furniture/furniture:bed-1/frame': e }), g);
    expect(r.rejected).toEqual(['furniture/furniture:bed-1/frame']);
    expect(bed.geometry.getAttribute('uv1')).toBeUndefined();
    expect(r.assigned.find((a) => a.mesh === bed)?.kind).toBe('probe');
    bed.geometry = new THREE.BoxGeometry(1, 0.5, 2).translate(0, 1, 0); // moved vertices
    expect(assignByName(scene, manifestFor({ 'furniture/furniture:bed-1/frame': e }), g).rejected.length).toBe(1);
  });
  it('a removed piece leaves nothing behind: its entry simply finds no mesh', () => {
    const { scene, bed } = miniScene();
    const e = entryFor(bed, 'dyn', 0);
    const g = { u16: new Uint16Array(500), u32: new Uint32Array(0) };
    const mf = manifestFor({ 'furniture/furniture:bed-1/frame': e });
    scene.children[2].remove(scene.children[2].children[0]);
    const r = assignByName(scene, mf, g);
    expect(r.assigned.some((a) => a.key.includes('bed-1'))).toBe(false);
    expect(r.rejected).toEqual([]);
  });
  it('splits shared vertices when the bake did, keeping every source vertex and every triangle position', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), 3));
    geo.setIndex([0, 1, 2, 0, 3, 1]);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    const cs = geometryChecksum(geo);
    const before = Array.from(geo.getAttribute('position').array);
    // 2 extra vertices copy sources 0 and 1; the second triangle uses them
    const u32 = new Uint32Array([0, 1, /* index at 2 */ 0, 1, 2, 4, 3, 5]);
    const e: MeshEntry = { verts: 4, checksum: cs.checksum, atlas: 'static', uvOffset: 0, uvCount: 6, remapOffset: 0, remapCount: 2, indexOffset: 2, indexCount: 6 };
    expect(applyUv(mesh, e, { u16: new Uint16Array(12).fill(5), u32 })).toBe(true);
    expect(mesh.geometry.getAttribute('position').count).toBe(6);
    expect(Array.from(mesh.geometry.getAttribute('position').array).slice(0, 12)).toEqual(before);
    const p = mesh.geometry.getAttribute('position');
    expect([p.getX(4), p.getY(4), p.getZ(4)]).toEqual([0, 0, 0]);
    expect([p.getX(5), p.getY(5), p.getZ(5)]).toEqual([1, 0, 0]);
    expect(mesh.geometry.getIndex()!.count).toBe(6);
    expect(mesh.geometry.getAttribute('normal').count).toBe(6);
  });
  it('geometry.bin is parsed as the manifest says and refuses a short file', () => {
    const buf = new ArrayBuffer(8 + 8);
    new Uint16Array(buf, 0, 4).set([1, 2, 3, 4]);
    new Uint32Array(buf, 8, 2).set([7, 9]);
    const g = parseGeometryBuffer(buf, 4);
    expect(Array.from(g.u16)).toEqual([1, 2, 3, 4]);
    expect(Array.from(g.u32)).toEqual([7, 9]);
    expect(() => parseGeometryBuffer(new ArrayBuffer(4), 4)).toThrow();
    expect(positionChecksum(new Float32Array([0, 0, 0]))).toBe(positionChecksum(new Float32Array([0.0004, 0, 0])));
    expect(positionChecksum(new Float32Array([0, 0, 0]))).not.toBe(positionChecksum(new Float32Array([0.002, 0, 0])));
  });
});

// ---------------------------------------------------------------- fallbacks: the runtime with missing and corrupt files

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
function fakeFetch(files: Record<string, Uint8Array | string | undefined>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const name = url.split('/').pop()!;
    const f = files[name];
    if (f === undefined) return new Response('not found', { status: 404 });
    return new Response(f as BodyInit, { status: 200 });
  }) as typeof fetch;
}
const fakeLook = (): Look & { bakedSet: unknown[] } => {
  const calls: unknown[] = [];
  return { ready: Promise.resolve(), tier: 'medium', setBaked: (h: unknown) => { calls.push(h); }, onChange: () => () => {}, bakedSet: calls } as unknown as Look & { bakedSet: unknown[] };
};
const fakeCompositor = (): CompositorLike => ({ target: { texture: new THREE.Texture() }, compose() {}, dispose() {} });

describe('the runtime falls back to the normal lighting (16.14)', () => {
  it('fetchManifest: missing, HTML, broken JSON, another scene, another format all give null', async () => {
    expect(await fetchManifest('test-x', '/b', fakeFetch({}))).toBeNull();
    expect(await fetchManifest('test-x', '/b', fakeFetch({ 'manifest.json': '<!doctype html><html></html>' }))).toBeNull();
    expect(await fetchManifest('test-x', '/b', fakeFetch({ 'manifest.json': '{"version":' }))).toBeNull();
    expect(await fetchManifest('test-x', '/b', fakeFetch({ 'manifest.json': JSON.stringify(manifestObject({ sceneId: 'other' })) }))).toBeNull();
    expect(await fetchManifest('test-x', '/b', fakeFetch({ 'manifest.json': JSON.stringify(manifestObject({ version: 2 })) }))).toBeNull();
    expect(await fetchManifest('Bad Id!', '/b', fakeFetch({ 'manifest.json': JSON.stringify(manifestObject()) }))).toBeNull();
    expect((await fetchManifest('test-x', '/b', fakeFetch({ 'manifest.json': JSON.stringify(manifestObject()) })))?.sceneId).toBe('test-x');
  });
  it('no bake: state absent, nothing touched, setBaked never called', async () => {
    const { scene, floor } = miniScene();
    const look = fakeLook();
    const h = mountBaked({ look, scene, renderer: {} as THREE.WebGLRenderer, sceneId: 'test-x', layout: sample('test-sample-3').layout, fetchImpl: fakeFetch({}) });
    expect(await h.ready).toBe('absent');
    expect(h.active).toBe(false);
    expect(look.bakedSet.length).toBe(0);
    expect(floor.geometry.getAttribute('uv1')).toBeUndefined();
    expect((floor.material as THREE.MeshStandardMaterial).lightMap).toBeNull();
  });
  it('a corrupt or truncated file: state failed, meshes untouched, setBaked never called', async () => {
    const { scene, floor } = miniScene();
    const look = fakeLook();
    const m = manifestObject({ geometry: { file: 'geometry.bin', bytes: 100, uvElements: 8 } });
    const files = { 'manifest.json': JSON.stringify(m), 'geometry.bin': new Uint8Array(37) }; // the manifest says 100 bytes
    const h = mountBaked({ look, scene, renderer: {} as THREE.WebGLRenderer, sceneId: 'test-x', layout: sample('test-sample-3').layout, fetchImpl: fakeFetch(files), deps: { makeCompositor: fakeCompositor, loadTexture: async () => new THREE.Texture() } });
    expect(await h.ready).toBe('failed');
    expect(look.bakedSet.length).toBe(0);
    expect(floor.geometry.getAttribute('uv1')).toBeUndefined();
    expect((floor.material as THREE.MeshStandardMaterial).lightMap).toBeNull();
  });
  it('a picture that does not decode: state failed', async () => {
    const { scene, floor } = miniScene();
    const entries = { 'shell/floor:a': entryFor(floor, 'static', 0) };
    const n = floor.geometry.getAttribute('position').count;
    const geo = new Uint8Array(n * 4);
    const m = manifestObject({ meshes: entries, geometry: { file: 'geometry.bin', bytes: geo.length, uvElements: n * 2 }, probes: undefined });
    const files = { 'manifest.json': JSON.stringify(m), 'geometry.bin': geo, 'sky.webp': new Uint8Array(10), 'sun1.webp': new Uint8Array(10), 'ao.webp': new Uint8Array(10) };
    const look = fakeLook();
    const h = mountBaked({
      look, scene, renderer: {} as THREE.WebGLRenderer, sceneId: 'test-x', layout: sample('test-sample-3').layout, fetchImpl: fakeFetch(files),
      deps: { makeCompositor: fakeCompositor, loadTexture: async () => { throw new Error('broken picture'); } },
    });
    expect(await h.ready).toBe('failed');
    expect(look.bakedSet.length).toBe(0);
  });
  it('everything present: state ready, lightmap on the floor material by name, setBaked called', async () => {
    const { scene, floor } = miniScene();
    const n = floor.geometry.getAttribute('position').count;
    const geo = new Uint8Array(n * 4);
    const m = manifestObject({ meshes: { 'shell/floor:a': entryFor(floor, 'static', 0) }, geometry: { file: 'geometry.bin', bytes: geo.length, uvElements: n * 2 }, probes: undefined });
    const files = { 'manifest.json': JSON.stringify(m), 'geometry.bin': geo, 'sky.webp': new Uint8Array(10), 'sun1.webp': new Uint8Array(10), 'ao.webp': new Uint8Array(10) };
    const look = fakeLook();
    const comp = fakeCompositor();
    const h = mountBaked({ look, scene, renderer: {} as THREE.WebGLRenderer, sceneId: 'test-x', layout: sample('test-sample-3').layout, fetchImpl: fakeFetch(files), deps: { makeCompositor: () => comp, loadTexture: async () => new THREE.Texture() } });
    expect(await h.ready).toBe('ready');
    expect(look.bakedSet).toEqual([h]);
    expect((floor.material as THREE.MeshStandardMaterial).lightMap).toBe(comp.target.texture);
    expect(floor.geometry.getAttribute('uv1').count).toBe(n);
    expect(h.stats().staticMeshes).toBe(1);
    // True colours: the bake steps back (lightmap intensity 0) and the surfaces are lit as before
    h.update({ grade: gradeAt(15), hour: 15, cfg: {} as never, off: true });
    expect((floor.material as THREE.MeshStandardMaterial).lightMapIntensity).toBe(0);
    expect(h.active).toBe(false);
    h.update({ grade: gradeAt(15), hour: 15, cfg: {} as never, off: false });
    expect((floor.material as THREE.MeshStandardMaterial).lightMapIntensity).toBe(1);
    expect(h.active).toBe(true);
    h.dispose();
    expect((floor.material as THREE.MeshStandardMaterial).lightMapIntensity).toBe(0);
  });
});

// ---------------------------------------------------------------- honesty: baking changes only light (SPEC 16.2)

describe('honesty: layouts, the collision grid and measurements are identical with and without baked data', () => {
  const p = sample('test-sample-3');
  it('mounting a bake changes no layout, no grid, no area, no shell geometry', async () => {
    const layoutBefore = JSON.stringify(p.layout);
    const gridBefore = rasterizeLayout(p.layout);
    const cellsBefore = Array.from(gridBefore.cells);
    const areaBefore = carpetAreaM2(p.layout);
    const shell = buildShell(p.layout);
    const statsBefore = JSON.stringify(shellStats(shell));
    const posBefore = shell.children.map((c) => Array.from((c as THREE.Mesh).geometry.getAttribute('position').array));
    // a bake whose entries are the real shell's meshes
    const scene = new THREE.Scene();
    scene.add(shell);
    const entries: Record<string, MeshEntry> = {};
    let off = 0;
    for (const c of shell.children) {
      const mesh = c as THREE.Mesh;
      const n = mesh.geometry.getAttribute('position').count;
      entries[`shell/${c.name}`] = entryFor(mesh, 'static', off);
      off += n * 2;
    }
    const files = {
      'manifest.json': JSON.stringify(manifestObject({ meshes: entries, geometry: { file: 'geometry.bin', bytes: off * 2, uvElements: off }, probes: undefined })),
      'geometry.bin': new Uint8Array(off * 2), 'sky.webp': new Uint8Array(10), 'sun1.webp': new Uint8Array(10), 'ao.webp': new Uint8Array(10),
    };
    const h = mountBaked({ look: fakeLook(), scene, renderer: {} as THREE.WebGLRenderer, sceneId: 'test-x', layout: p.layout, fetchImpl: fakeFetch(files), deps: { makeCompositor: fakeCompositor, loadTexture: async () => new THREE.Texture() } });
    expect(await h.ready).toBe('ready');
    expect(h.stats().staticMeshes).toBe(shell.children.length);
    // the contact-shadow field is a separate texture built from a copy of nothing: the grid is read, never written
    buildAoField(gridBefore, { furnitureOnly: true });
    h.contactField(gridBefore);
    expect(JSON.stringify(p.layout)).toBe(layoutBefore);
    expect(Array.from(gridBefore.cells)).toEqual(cellsBefore);
    expect(Array.from(rasterizeLayout(p.layout).cells)).toEqual(cellsBefore);
    expect(carpetAreaM2(p.layout)).toBe(areaBefore);
    expect(JSON.stringify(shellStats(shell))).toBe(statsBefore);
    shell.children.forEach((c, i) => expect(Array.from((c as THREE.Mesh).geometry.getAttribute('position').array)).toEqual(posBefore[i]));
    h.dispose();
  });
  it('nothing that measures or checks fits imports the baked lighting', () => {
    const read = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.ts')).map((e) => path.join(e.parentPath, e.name));
    const guarded = [...read('src/core'), path.join(ROOT, 'src/buyer/measure.ts'), path.join(ROOT, 'src/buyer/store.ts'), path.join(ROOT, 'src/buyer/rooms.ts')];
    expect(guarded.length).toBeGreaterThan(15);
    for (const f of guarded) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/look\/baked|from '\.\.\/look\/baked|baked\//);
  });
  it('the look says the lighting is simulated', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/look/look-panel.ts'), 'utf8');
    expect(src).toMatch(/LABEL_LIGHTING/);
    expect(LABEL_LIGHTING).toMatch(/^Lighting is simulated/);
  });
});
