// C12f acceptance (SPEC 17.14): the label is in the pixels.
import { describe, expect, it } from 'vitest';
import { labelPresent, stampLabel } from '../src/photo/label';
import { PHOTO_LABEL } from '../src/photo/config';
import { makeView } from './photo-helpers';

function blur3(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += rgba[(yy * w + xx) * 4 + c]; n++; } }
    out[(y * w + x) * 4 + c] = s / n;
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

describe('label in the pixels', () => {
  it('the text is the spec text', () => {
    expect(PHOTO_LABEL).toBe('AI photo · illustrative, sizes not guaranteed');
  });
  const v = makeView();
  for (const [w, h] of [[1024, 683], [768, 1365], [1376, 768], [512, 512]] as const) {
    it(`stamped at ${w}x${h} is found; the same picture unstamped is not`, () => {
      const plain = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < plain.length; i += 4) { const g = 90 + ((i / 4) % 97); plain[i] = g; plain[i + 1] = g; plain[i + 2] = g; plain[i + 3] = 255; }
      expect(labelPresent(plain, w, h)).toBe(false);
      const stamped = stampLabel(new Uint8ClampedArray(plain), w, h);
      expect(labelPresent(stamped, w, h)).toBe(true);
    });
  }
  it('survives a light blur (a re-compress) but not a different picture over the band', () => {
    const stamped = stampLabel(new Uint8ClampedArray(v.rgba), v.w, v.h);
    expect(labelPresent(blur3(stamped, v.w, v.h), v.w, v.h)).toBe(true);
    const wiped = new Uint8ClampedArray(stamped);
    for (let y = v.h - 40; y < v.h; y++) for (let x = 0; x < v.w; x++) { const i = (y * v.w + x) * 4; wiped[i] = 200; wiped[i + 1] = 190; wiped[i + 2] = 180; }
    expect(labelPresent(wiped, v.w, v.h)).toBe(false);
  });
  it('only the bottom band changes', () => {
    const stamped = stampLabel(new Uint8ClampedArray(v.rgba), v.w, v.h);
    const bandTop = v.h - Math.max(22, Math.round(v.h * 0.052));
    for (let y = 0; y < bandTop; y++) for (let x = 0; x < v.w; x += 17) { const i = (y * v.w + x) * 4; expect(stamped[i]).toBe(v.rgba[i]); }
  });
});
