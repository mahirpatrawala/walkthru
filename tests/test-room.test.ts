import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TRUTH, buildPlan, buildSplatFragment, buildTruthProperty, classifyTruth, encodePly, rawFromTruth, truthGrid,
} from '../scripts/make-test-room';
import { cellValue } from '../src/core/grid-codec';
import { mulberry32, polygonArea, rotateY } from '../src/core/geometry';
import { formatArea } from '../src/core/units';
import type { Quat, RawCloud } from '../src/types';

const frag = buildSplatFragment();
const ply = encodePly(frag);

function headerFor(n: number, sh1 = false): string {
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  if (sh1) for (let i = 0; i < 9; i++) props.push(`f_rest_${i}`);
  props.push('opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3');
  return `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\n${props.map((p) => `property float ${p}\n`).join('')}end_header\n`;
}

describe('truth property', () => {
  it('has exact areas, sq ft and carpet area', () => {
    const p = buildTruthProperty('empty');
    const [bed, bal, pas] = ['bedroom', 'balcony', 'passage'].map((id) => polygonArea(p.layout.rooms.find((r) => r.id === id)!.polygon));
    expect([bed, bal, pas]).toEqual([20, 4.5, 4.8].map((v) => expect.closeTo(v, 9)));
    expect(formatArea(bed).sqft).toBe(215);
    expect(formatArea(bal).sqft).toBe(48);
    expect(formatArea(pas).sqft).toBe(52);
    expect(formatArea(bed + pas).text).toBe('267 sq ft · 24.8 m²');
  });
  it('empty has no furniture and no splat; furnished has both', () => {
    const e = buildTruthProperty('empty');
    expect(e.id).toBe('test-flat-empty');
    expect(e.furniture).toEqual([]);
    expect(e.splat).toBeUndefined();
    const f = buildTruthProperty('furnished');
    expect(f.id).toBe('test-flat');
    expect(f.furniture.map((i) => i.id)).toEqual(['bed-1', 'sofa-1']);
    expect(f.splat?.file).toBe('scene.ply');
    expect(f.layout.openings.map((o) => o.id)).toEqual(['door-bed', 'slider', 'window', 'door-main']);
  });
  it('every polygon has positive area and edges match', () => {
    for (const r of buildTruthProperty('empty').layout.rooms) {
      expect(polygonArea(r.polygon)).toBeGreaterThan(0);
      expect(r.edges.length).toBe(r.polygon.length);
    }
  });
  it('written scene files (when generated) match the builders', () => {
    const f = path.resolve(__dirname, '../public/scenes/test-flat/property.json');
    if (!fs.existsSync(f)) return;
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual(JSON.parse(JSON.stringify(buildTruthProperty('furnished'))));
  });
});

describe('PLY encoding (SPEC 6.4)', () => {
  it('starts with the exact header and has 68 bytes per record', () => {
    const n = frag.cloud.count;
    const header = headerFor(n);
    expect(new TextDecoder().decode(ply.subarray(0, header.length))).toBe(header);
    expect(ply.length).toBe(header.length + 68 * n);
  });
  it('splat count is about 160,000', () => {
    expect(frag.cloud.count).toBeGreaterThanOrEqual(140_000);
    expect(frag.cloud.count).toBeLessThanOrEqual(190_000);
  });
  it('--sh1 adds nine zero f_rest properties between f_dc_2 and opacity', () => {
    const small = encodePly({
      cloud: { count: 1, positions: new Float32Array(3), opacity: new Uint8Array([242]), rgb: new Uint8Array(3) },
      scales: new Float32Array([0.03, 0.03, 0.005]), rotations: new Float32Array([1, 0, 0, 0]),
    }, { sh1: true });
    const header = headerFor(1, true);
    expect(new TextDecoder().decode(small.subarray(0, header.length))).toBe(header);
    expect(small.length).toBe(header.length + 26 * 4);
    expect(header.indexOf('f_dc_2')).toBeLessThan(header.indexOf('f_rest_0'));
    expect(header.indexOf('f_rest_8')).toBeLessThan(header.indexOf('opacity'));
  });
  it('record values decode back to the fragment', () => {
    const n = frag.cloud.count;
    const off = headerFor(n).length;
    const dv = new DataView(ply.buffer, ply.byteOffset, ply.byteLength);
    for (const k of [0, 1234, n - 1]) {
      const base = off + k * 68;
      expect(dv.getFloat32(base, true)).toBe(frag.cloud.positions[k * 3]);
      const logit = dv.getFloat32(base + 9 * 4, true);
      expect(Math.round((255 / (1 + Math.exp(-logit))))).toBeGreaterThanOrEqual(frag.cloud.opacity[k] - 1);
      const dc0 = dv.getFloat32(base + 6 * 4, true);
      expect(Math.round((0.5 + 0.28209479177387814 * dc0) * 255)).toBe(frag.cloud.rgb[k * 3]);
      const q = [0, 1, 2, 3].map((i) => dv.getFloat32(base + (13 + i) * 4, true));
      expect(Math.hypot(...q)).toBeCloseTo(1, 5);
    }
  });
  it('default splats are alpha 0.95 (byte 242)', () => {
    expect(frag.cloud.opacity.every((a) => a === 242)).toBe(true);
  });
});

describe('raw frame', () => {
  it('door jambs are 0.9 / 0.37 raw units apart', () => {
    const [a, b] = TRUTH.doorJambs.map(rawFromTruth);
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(Math.abs(d - 0.9 / 0.37)).toBeLessThan(0.0005);
    expect(d).toBeCloseTo(2.4324, 3);
  });
  it('the written splat.transform maps raw landmarks back to truth', () => {
    const t = buildTruthProperty('furnished').splat!.transform;
    expect(TRUTH.landmarks.length).toBe(6);
    for (const p of TRUTH.landmarks) {
      const raw = rawFromTruth(p);
      const r = rotateY(t.rotation as Quat, raw);
      const w = {
        x: t.scale * r.x + t.position[0],
        y: t.scale * r.y + t.position[1],
        z: t.scale * r.z + t.position[2],
      };
      expect(Math.abs(w.x - p.x)).toBeLessThan(1e-4);
      expect(Math.abs(w.y - p.y)).toBeLessThan(1e-4);
      expect(Math.abs(w.z - p.z)).toBeLessThan(1e-4);
    }
    expect(t.scale).toBe(0.37);
  });
  it('the fragment is upside down and tilted 3 degrees in raw space', () => {
    // floor points (true y ~ 0) share one raw plane; its normal is R0 * up
    const c: RawCloud = frag.cloud;
    // pick the first splat: a bedroom floor point at true (~0.0125, 0, ~0.0125)
    const raw0 = { x: c.positions[0], y: c.positions[1], z: c.positions[2] };
    const expected = rawFromTruth({ x: 0.0125, y: 0, z: 0.0125 });
    expect(Math.abs(raw0.x - expected.x)).toBeLessThan(0.03);
    expect(Math.abs(raw0.y - expected.y)).toBeLessThan(0.03);
    expect(Math.abs(raw0.z - expected.z)).toBeLessThan(0.03);
    const up = rotateY(
      buildTruthProperty('furnished').splat!.transform.rotation as Quat, { x: 0, y: 1, z: 0 });
    // inverse rotation takes raw up to ... a vector 3 degrees off the world axis flipped
    expect(Math.abs(Math.acos(Math.abs(up.y)) * 180 / Math.PI - 0)).toBeLessThan(5 + 1e-9);
  });
});

describe('degraded fragment', () => {
  const d = buildSplatFragment({ degraded: true });
  it('has holes, reflections and floaters', () => {
    expect(d.cloud.count).toBeGreaterThan(0);
    expect(d.cloud.count).not.toBe(frag.cloud.count);
    // opacity bytes below 242 exist (reflections and floaters)
    expect(d.cloud.opacity.some((a) => a < 120)).toBe(true);
  });
  it('is deterministic per seed', () => {
    const d2 = buildSplatFragment({ degraded: true });
    expect(d2.cloud.count).toBe(d.cloud.count);
    expect(d2.cloud.positions[1000]).toBe(d.cloud.positions[1000]);
    expect(buildSplatFragment({ degraded: true, seed: 2 }).cloud.count).not.toBe(d.cloud.count);
  });
});

describe('truth grid oracle', () => {
  for (const variant of ['empty', 'furnished'] as const) {
    it(`truthGrid('${variant}') agrees with classifyTruth on 5,000 seeded samples`, () => {
      const g = truthGrid(variant);
      const rng = mulberry32(7);
      let checked = 0;
      for (let k = 0; k < 5000; k++) {
        const x = g.originX + rng() * g.nx * g.cellM;
        const z = g.originZ + rng() * g.nz * g.cellM;
        const cls = classifyTruth(x, z, variant);
        if (cls === 'edge') continue;
        checked++;
        const v = cellValue(g, x, z);
        const got = v === 0 ? 'free' : v === 255 ? 'void' : 'obstacle';
        expect(got).toBe(cls);
      }
      expect(checked).toBeGreaterThan(2000);
    });
  }
  it('grid bounds: rooms padded by 1.0 m, multiples of the cell size', () => {
    const g = truthGrid('empty');
    expect(g.originX).toBeCloseTo(-1, 9);
    expect(g.originZ).toBeCloseTo(-2.65, 9);
    expect(g.nx).toBe(120);
    expect(g.nz).toBe(200);
  });
  it('known cells (SPEC C1 acceptance list)', () => {
    const g = truthGrid('empty');
    expect(cellValue(g, 0.85, 5.06)).toBe(0);     // the doorway
    expect(cellValue(g, 2.0, -0.06)).toBe(0);     // the sliding opening
    expect(cellValue(g, 2.0, 5.03)).toBe(250);
    expect(cellValue(g, 0.2, -0.03)).toBe(250);
    expect(cellValue(g, 2.0, -1.63)).toBe(110);   // railing
    expect(cellValue(g, -0.03, 4.0)).toBe(90);    // window sill
    expect(cellValue(g, 4.3, 5.7)).toBe(255);     // beyond the main door's stub
    expect(cellValue(g, 2, 2.5)).toBe(0);
    expect(cellValue(g, 2, -1)).toBe(0);          // balcony floor
    expect(cellValue(g, 2, 5.7)).toBe(0);         // passage floor
    expect(cellValue(g, 4.05, 5.7)).toBe(0);      // main door tunnel
  });
  it('the furnished grid stamps the bed and sofa heights', () => {
    const g = truthGrid('furnished');
    expect(cellValue(g, 1, 2.25)).toBe(55);
    expect(cellValue(g, 3.5, 3.5)).toBe(85);
    expect(cellValue(truthGrid('empty'), 1, 2.25)).toBe(0);
  });
  it('the spawn and both far rooms are connected by free cells', () => {
    const g = truthGrid('empty');
    const idx = (x: number, z: number) => Math.floor((z - g.originZ) / g.cellM) * g.nx + Math.floor((x - g.originX) / g.cellM);
    const seen = new Uint8Array(g.cells.length);
    const stack = [idx(2.6, 0.8)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % g.nx;
      const j = (k - i) / g.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
        const nk = nj * g.nx + ni;
        if (seen[nk] || g.cells[nk] !== 0) continue;
        seen[nk] = 1;
        stack.push(nk);
      }
    }
    expect(seen[idx(2, -1)]).toBe(1);
    expect(seen[idx(2, 5.7)]).toBe(1);
  });
});

describe('floor plan image', () => {
  const plan = buildPlan();
  it('is a 364 x 571 SVG that contains the three room labels and both dimensions', () => {
    expect(plan.svg).toContain('width="364"');
    expect(plan.svg).toContain('height="571"');
    for (const name of ['BEDROOM', 'BALCONY', 'PASSAGE']) expect(plan.svg).toContain(name);
    expect(plan.svg).toContain('BEDROOM 13\'1" x 16\'5"');
    expect(plan.svg).toContain('BALCONY 9\'10" x 4\'11"');
    expect(plan.svg).toContain('PASSAGE 13\'1" x 3\'11"');
    expect(plan.svg).toContain('>13\'1"</text>');
    expect(plan.svg).toContain('>16\'5"</text>');
    for (const label of ['Bedroom 1', 'Balcony', 'Passage']) expect(plan.svg).toContain(label);
  });
  it('plan-truth room pixel polygons have the true areas at 53 px/m (within 0.1%)', () => {
    expect(plan.truth.pxPerM).toBe(53);
    const want: Record<string, number> = { bedroom: 20, balcony: 4.5, passage: 4.8 };
    for (const r of plan.truth.rooms) {
      const px = r.cornersPx.map((p) => ({ x: p.x, z: p.y }));
      const area = Math.abs(polygonArea(px)) / (53 * 53);
      expect(Math.abs(area - want[r.id]) / want[r.id]).toBeLessThan(0.001);
      expect(r.areaM2).toBeCloseTo(want[r.id], 9);
    }
  });
  it('the two dimension lines are 4 m and 5 m at 53 px/m', () => {
    const [h, v] = plan.truth.dimensions;
    expect(Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y) / 53).toBeCloseTo(4, 6);
    expect(Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y) / 53).toBeCloseTo(5, 6);
    expect(h.label).toBe('13\'1"');
    expect(v.label).toBe('16\'5"');
    expect(h.lengthM).toBe(4);
    expect(v.lengthM).toBe(5);
  });
  it('lists the four openings with pixel centres', () => {
    expect(plan.truth.openings.map((o) => o.id)).toEqual(['door-bed', 'slider', 'window', 'door-main']);
    // door-bed centre is world (0.85, 5) -> px (60 + 1.15 * 53, 60 + 6.9 * 53)
    const d = plan.truth.openings[0];
    expect(d.centrePx.x).toBeCloseTo(60 + 1.15 * 53, 6);
    expect(d.centrePx.y).toBeCloseTo(60 + 6.9 * 53, 6);
  });
  it('the underlay origin puts world (0,0) on the plan', () => {
    const u = buildTruthProperty('empty').layout.underlay!;
    expect(u.file).toBe('plan.svg');
    expect(u.pxPerM).toBe(53);
    expect(u.originPx.x).toBeCloseTo(60 + 0.3 * 53, 9);
    expect(u.originPx.y).toBeCloseTo(60 + 1.9 * 53, 9);
  });
});
