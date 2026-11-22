// SPEC 16.27 "Photographic light" (22 Nov 2026): the pure parts. A white room used to read as one even grey-white wash: the even fill of a baked room was
// three times the light that falls off from its windows, and the day exposure put every white wall in the tone curve's shoulder, where twice the light
// read 4 % brighter. These hold the new balance, the tone curve's spread, the AO floor that keeps a bake's shut texels from printing black, and the sky.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESET_HOURS, gradeAt } from '../src/look/grade';
import { AO_FLOOR, AO_SHADE, FILL_FRACTION, ambientFill, componentWeights, luma } from '../src/look/baked/weights';
import { OBJECT_AO_STRENGTH, SKY_BOOST } from '../src/look/baked/runtime';
import { CONTRAST_PIVOT, CONTRAST_SHOULDER } from '../src/look/post';
import { TIER_CONTRAST, TIER_PIVOT, TIER_SHOULDER } from '../src/look/tonemap';
import { WINDOW_STRENGTH } from '../src/look/daylight';
import { skyPixels } from '../src/look/sky';

const ROOT = path.resolve(import.meta.dirname, '..');

/** three's ACES filmic for a grey input (its input and output matrices keep a grey grey), then the grade's luminance curve, then sRGB 0..255 */
function aces(x: number, exposure: number): number {
  const v = (x * exposure) / 0.6;
  return Math.min(1, Math.max(0, (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081)));
}
/** the grade's curve as it was (`normalised` false: the shoulder was never reached) and as it is (the tone mapper's white lands on the shoulder) */
function curve(l: number, contrast: number, pivot: number, shoulder: number, normalised = true): number {
  const k = contrast / (shoulder - pivot);
  const n = normalised ? 1 - Math.exp(-k * (1 - pivot)) : 1;
  return l > pivot ? pivot + ((shoulder - pivot) * (1 - Math.exp(-k * (l - pivot)))) / n : pivot * Math.pow(l / pivot, contrast);
}
const srgb = (v: number): number => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const shown = (x: number, exposure: number, contrast: number, pivot: number, shoulder: number, normalised = true): number => srgb(curve(aces(x, exposure), contrast, pivot, shoulder, normalised));

describe('the baked mix: light that falls off from the windows, not an even wash (16.27)', () => {
  const g = gradeAt(PRESET_HOURS.afternoon);
  it('by day the sky component (which falls off away from each window) outweighs the even fill', () => {
    const w = componentWeights({ grade: g, skyScale: 1, sunScale: 1, sunHours: [8.5, 15, 17.8], skyBoost: SKY_BOOST });
    const fill = ambientFill(g);
    expect(luma(w.sky) / luma(fill)).toBeGreaterThanOrEqual(1); // 0.34 before
    expect(SKY_BOOST / FILL_FRACTION).toBeGreaterThanOrEqual(1);
  });
  it('the even fill is the smaller share, and the AO (the noisiest picture) never takes more than 0.8 of it', () => {
    expect(FILL_FRACTION).toBeLessThan(1);
    expect(FILL_FRACTION).toBeGreaterThanOrEqual(0.5);
    expect(AO_SHADE).toBeGreaterThanOrEqual(0.6);
    expect(AO_SHADE).toBeLessThanOrEqual(0.8);
  });
  it('a texel the bake shut (AO 0) is never darker than it was before 16.27 (1 - 0.6)', () => {
    expect(1 - AO_SHADE * (1 - AO_FLOOR)).toBeGreaterThanOrEqual(0.4);
    const src = fs.readFileSync(path.join(ROOT, 'src/look/baked/composite.ts'), 'utf8');
    expect(src).toMatch(/max\( dec\( t\$\{AO_INDEX\}/);
    expect(src).toMatch(/uniform float uAoShade/);
  });
  it('movable pieces take more of their own AO (the contact under a sofa or a bed)', () => {
    expect(OBJECT_AO_STRENGTH).toBeGreaterThan(0.65);
    expect(OBJECT_AO_STRENGTH).toBeLessThanOrEqual(0.8);
  });
});

describe('the day tone curve spreads the whites (16.27)', () => {
  const g = gradeAt(PRESET_HOURS.afternoon);
  const now = (x: number): number => shown(x, g.exposure, g.post.contrast, CONTRAST_PIVOT, CONTRAST_SHOULDER);
  const before = (x: number): number => shown(x, 1.24, 1.55, 0.42, 0.9, false);
  it('white tops out at white: the old curve stopped every white at about sRGB 235, a window and a sun patch included', () => {
    expect(before(6)).toBeLessThan(236);
    expect(now(6)).toBeGreaterThan(248);
  });
  it('the whites spread: a white wall, one with twice the light and a sun patch are three steps, not one', () => {
    // a wall in the bright half of a room (0.6), the wall by the window (1.2), a sun patch or the sky in a window (3)
    expect(before(1.2) - before(0.6)).toBeLessThan(12);
    expect(now(1.2) - now(0.6)).toBeGreaterThanOrEqual(14);
    expect(before(3) - before(1.2)).toBeLessThan(6);
    expect(now(3) - now(1.2)).toBeGreaterThanOrEqual(7);
  });
  it('without crushing: the mid and dark tones are where they were (within 15 levels), never black', () => {
    for (const x of [0.1, 0.2, 0.3, 0.45]) expect(Math.abs(now(x) - before(x))).toBeLessThan(15);
    expect(now(0.1)).toBeGreaterThan(50);
  });
  it('the phone tiers (no grade pass) turn about the same pivot with the same shoulder', () => {
    expect(TIER_PIVOT).toBe(CONTRAST_PIVOT);
    expect(TIER_SHOULDER).toBe(CONTRAST_SHOULDER);
    expect(TIER_CONTRAST).toBeGreaterThan(1.2);
    expect(TIER_CONTRAST).toBeLessThan(g.post.contrast);
  });
  it('Evening and Night keep their own exposure', () => {
    expect(gradeAt(PRESET_HOURS.evening).exposure).toBeCloseTo(1.15, 6);
    expect(gradeAt(PRESET_HOURS.night).exposure).toBeCloseTo(1.05, 6);
  });
});

describe('the window sky (16.27)', () => {
  const w = 64, h = 128;
  const px = skyPixels(gradeAt(PRESET_HOURS.afternoon).sky, 40, w, h);
  const at = (deg: number): number[] => { const j = Math.min(h - 1, Math.floor((((deg * Math.PI) / 180 + Math.PI / 2) / Math.PI) * h)); const o = (j * w + 40) * 4; return [px[o], px[o + 1], px[o + 2]]; };
  const lum = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  it('the blue arrives in the first degrees above the horizon, where a window looks', () => {
    const g = gradeAt(PRESET_HOURS.afternoon).sky;
    const c = at(7);
    // past half way from the horizon colour to the mid sky by 7 degrees
    expect((g.horizon[2] - c[2]) / (g.horizon[2] - g.mid[2])).toBeGreaterThan(0.5);
    expect(c[2]).toBeGreaterThan(c[0] + 0.15);
  });
  it('below the horizon a cool distance haze a step darker than the horizon band, with no hard line', () => {
    const down = at(-15), band = at(1);
    expect(down[2]).toBeGreaterThan(down[0]);
    expect(lum(down)).toBeLessThan(lum(band));
    for (let j = 0; j + 1 < h; j++) expect(Math.abs(px[(j * w + 3) * 4 + 1] - px[((j + 1) * w + 3) * 4 + 1])).toBeLessThan(0.2);
  });
});

describe('the live (unbaked) look', () => {
  it('a window lets in more of the sky than the even ambient, so a room has a direction of light', () => {
    expect(WINDOW_STRENGTH).toBeGreaterThan(1);
  });
});
