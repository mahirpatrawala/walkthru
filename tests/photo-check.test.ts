// C12f acceptance (SPEC 17.14): the size sanity check with a stubbed image model. No network: fetch throws.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkFaithful, CHECK, lumaOf } from '../src/photo/edges';
import type { Gray } from '../src/photo/edges';
import { cropToAspect, occluded, buildPhotoGeometry, sampleView } from '../src/photo/geometry';
import { makeCamera, makeView, rng, loadScene } from './photo-helpers';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('no network in tests'); }); });
afterEach(() => { vi.unstubAllGlobals(); });

function shifted(rgba: Uint8ClampedArray, w: number, h: number, dx: number): Gray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(w - 1, Math.max(0, x - dx));
    const i = (y * w + x) * 4, j = (y * w + sx) * 4;
    out[i] = rgba[j]; out[i + 1] = rgba[j + 1]; out[i + 2] = rgba[j + 2]; out[i + 3] = 255;
  }
  return lumaOf(out, w, h);
}
function noisy(rgba: Uint8ClampedArray, w: number, h: number, sigma: number, seed = 7): Gray {
  const r = rng(seed);
  const out = new Uint8ClampedArray(rgba);
  const g = (): number => { let s = 0; for (let k = 0; k < 6; k++) s += r(); return (s - 3) * Math.SQRT2 * 1; };
  for (let i = 0; i < out.length; i += 4) { const n = g() * sigma; out[i] += n; out[i + 1] += n; out[i + 2] += n; }
  return lumaOf(out, w, h);
}

describe('geometry the check stands on', () => {
  const v = makeView();
  it('samples wall corners and every item, none hidden behind another solid', () => {
    const groups = new Set(v.sampled.points.map((p) => p.group));
    expect(groups.has('wall')).toBe(true);
    expect(groups.has('item:bed-1')).toBe(true);
    expect(groups.has('item:sofa-1')).toBe(true);
    for (const p of v.sampled.points) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(v.w); }
  });
  it('an item behind a wall has no visible samples', () => {
    const prop = loadScene();
    const geom = buildPhotoGeometry(prop.layout, prop.furniture);
    // from the passage, facing north into the bedroom: the wall between them (door far to the left) hides the bed
    const cam = makeCamera([3.5, 1.5, 5.7], [1, 0.5, 2.25], 1.5);
    const s = sampleView(geom, cam, cropToAspect(1024, 683, 1.5), 1024, 683);
    expect(s.points.filter((p) => p.group === 'item:bed-1').length).toBe(0);
  });
  it('occluded() sees a box between eye and point', () => {
    const prop = loadScene();
    const geom = buildPhotoGeometry(prop.layout, prop.furniture);
    const bed = prop.furniture[0];
    expect(occluded(geom, [bed.box.cx - 3, 0.3, bed.box.cz], [bed.box.cx + 3, 0.3, bed.box.cz])).toBe(true);
    expect(occluded(geom, [2, 1.6, 0.6], [2, 1.6, 1.5])).toBe(false);
  });
});

describe('size sanity check (17.14)', () => {
  const v = makeView();
  const sofaGone = makeView({ drop: ['sofa-1'] });
  const bedGone = makeView({ drop: ['bed-1'] });

  it('passes the frame itself', () => {
    const r = checkFaithful(v.gray, v.gray, v.sampled.points);
    expect(r.reason).toBe('ok');
    expect(r.ok).toBe(true);
  });
  it('passes the input plus noise', () => {
    for (const sigma of [4, 10]) {
      const r = checkFaithful(v.gray, noisy(v.rgba, v.w, v.h, sigma), v.sampled.points);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
  });
  it('passes a darker, softer, lower-contrast version (a "photo" look that keeps the geometry)', () => {
    const out = new Uint8ClampedArray(v.rgba);
    for (let i = 0; i < out.length; i += 4) for (let c = 0; c < 3; c++) out[i + c] = out[i + c] * 0.8 + 18;
    expect(checkFaithful(v.gray, lumaOf(out, v.w, v.h), v.sampled.points).ok).toBe(true);
  });
  it('rejects an output shifted by 5% of the width', () => {
    const r = checkFaithful(v.gray, shifted(v.rgba, v.w, v.h, Math.round(v.w * 0.05)), v.sampled.points);
    expect(r.ok).toBe(false);
    expect(['item', 'overall', 'edge-maps']).toContain(r.reason);
  });
  it('rejects a shift of 5% to the left as well', () => {
    expect(checkFaithful(v.gray, shifted(v.rgba, v.w, v.h, -Math.round(v.w * 0.05)), v.sampled.points).ok).toBe(false);
  });
  it('rejects an output with the sofa erased, naming the sofa', () => {
    const r = checkFaithful(v.gray, sofaGone.gray, v.sampled.points);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('item');
    expect(r.failedGroup).toBe('item:sofa-1');
  });
  it('rejects an output with the bed erased, naming the bed', () => {
    const r = checkFaithful(v.gray, bedGone.gray, v.sampled.points);
    expect(r.ok).toBe(false);
    expect(r.failedGroup).toBe('item:bed-1');
  });
  it('rejects a blank picture and a picture of something else', () => {
    const blank: Gray = { w: v.w, h: v.h, data: new Float32Array(v.w * v.h).fill(128) };
    expect(checkFaithful(v.gray, blank, v.sampled.points).ok).toBe(false);
    const other = makeView({ pos: [0.8, 1.6, 4.4], look: [3.2, 0.9, 1.0] });
    expect(checkFaithful(v.gray, other.gray, v.sampled.points).ok).toBe(false);
  });
  it('rejects a picture with a different aspect ratio (the model moved the framing)', () => {
    const out: Gray = { w: 683, h: 683, data: new Float32Array(683 * 683) };
    expect(checkFaithful(v.gray, out, v.sampled.points).reason).toBe('aspect');
  });
  it('cannot judge a view with too few checkable points', () => {
    expect(checkFaithful(v.gray, v.gray, v.sampled.points.slice(0, CHECK.minPoints - 1)).reason).toBe('few-points');
  });
});
