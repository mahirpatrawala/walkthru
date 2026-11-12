// C11c (SPEC 16.8 check 5 and the pure parts of 16.7): palettes keep the sampled colour as the middle mix, the light and shadow mixes
// move the way the spec says, the caption is the fixed line, and the vendored painter files are the upstream ones, byte for byte.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PaletteSet, SHADOW_CHROMA, SHADOW_DL, LIGHT_DL, hexToRgb, oklchToRgb, paintMix, rgbToHex, rgbToOklch } from '../src/look/painterly/palettes';
import { captionFor, slug } from '../src/look/painterly/caption';
import { splitTriangle } from '../src/look/painterly/adapter';

const SAMPLES = ['#F2EFE9', '#D9CFC1', '#4A3528', '#8E9AA6', '#1F1F21', '#E8823A', '#808080', '#FFFFFF', '#000000', '#B8B8B8', '#C9B8A3', '#2E4A8C'];

describe('palettes (16.8 check 5)', () => {
  it('the middle mix equals the sampled colour within 1/255 per channel', () => {
    for (const hex of SAMPLES) {
      const mix = paintMix(hex);
      const src = hexToRgb(hex);
      for (let k = 0; k < 3; k++) expect(Math.abs(mix.m[k] - src[k])).toBeLessThanOrEqual(1 / 255);
      expect(rgbToHex(mix.m)).toBe(hex.toLowerCase());
    }
  });
  it('OKLCH round trip is stable', () => {
    for (const hex of SAMPLES) {
      const c = hexToRgb(hex);
      const { L, C, h } = rgbToOklch(c);
      const back = oklchToRgb(L, C, h);
      for (let k = 0; k < 3; k++) expect(Math.abs(back[k] - c[k])).toBeLessThan(2 / 255);
    }
  });
  it('light is +0.08 lightness, shadow is -0.14 lightness with 1.1 x chroma', () => {
    for (const hex of ['#8E9AA6', '#A87C56', '#4A3528', '#2E4A8C']) {
      const mix = paintMix(hex);
      const base = rgbToOklch(hexToRgb(hex));
      const l = rgbToOklch(mix.l);
      const s = rgbToOklch(mix.s);
      expect(l.L - base.L).toBeCloseTo(LIGHT_DL, 1);
      expect(s.L - base.L).toBeCloseTo(SHADOW_DL, 1);
      // chroma may be clipped by the sRGB gamut, never exceeded
      expect(s.C).toBeLessThanOrEqual(base.C * SHADOW_CHROMA + 0.01);
      expect(l.L).toBeGreaterThan(base.L);
      expect(s.L).toBeLessThan(base.L);
    }
  });
  it('every mix is a valid colour in 0..1', () => {
    for (const hex of SAMPLES) for (const k of ['l', 'm', 's', 'own'] as const) for (const v of paintMix(hex)[k]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it('a palette set shares one palette per colour, whatever the case', () => {
    const set = new PaletteSet();
    const a = set.name('#F2EFE9');
    expect(set.name('#f2efe9')).toBe(a);
    expect(set.name('#D9CFC1')).not.toBe(a);
    set.glow('sky', '#99C7F2');
    expect(set.size).toBe(3);
    expect(set.palettes().sky.glow).toBe(2);
    expect(set.palettes()[a].m).toEqual(hexToRgb('#F2EFE9'));
  });
});

describe('caption', () => {
  it('is the fixed line of SPEC 16.7', () => {
    expect(captionFor('Guest Bedroom')).toBe('A painting of Guest Bedroom. Illustrative.');
    expect(captionFor('Test flat, 1 bedroom.  ')).toBe('A painting of Test flat, 1 bedroom. Illustrative.');
    expect(captionFor('   ')).toBe('A painting of this home. Illustrative.');
  });
  it('makes a safe file name', () => {
    expect(slug('Test flat, 1 bedroom (empty)')).toBe('test-flat-1-bedroom-empty');
    expect(slug('///')).toBe('home');
  });
});

describe('splitTriangle', () => {
  it('cuts a large triangle into similar pieces that add up to its area, all on its plane', () => {
    const a = new THREE.Vector3(0, 0, 0), b = new THREE.Vector3(4, 0, 0), c = new THREE.Vector3(0, 0, 5);
    const area = (t: THREE.Vector3[]): number => new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).length() / 2;
    const pieces = splitTriangle(a, b, c, 0.8);
    expect(pieces.length).toBeGreaterThan(8);
    expect(pieces.reduce((s, t) => s + area(t), 0)).toBeCloseTo(10, 6);
    for (const t of pieces) { expect(area(t)).toBeLessThanOrEqual(0.8 + 1e-9); for (const p of t) expect(p.y).toBe(0); }
    expect(splitTriangle(a, b, c, 100)).toHaveLength(1);
  });
});

describe('vendored painter (SPEC 16.7: unmodified)', () => {
  const root = path.resolve(import.meta.dirname, '../vendor/oilpaint');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'vendor.lock.json'), 'utf8')) as { commit: string; files: Record<string, string> };
  it('names the pinned commit', () => {
    expect(lock.commit).toBe('804c65fa3a6c6fcdc732ed1bde450fd140cfb4e9');
    expect(fs.readFileSync(path.join(root, 'VENDOR.md'), 'utf8')).toContain(lock.commit);
  });
  it('every vendored file matches the SHA-256 recorded when it was copied', () => {
    for (const [file, sha] of Object.entries(lock.files)) {
      const got = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
      expect(got, file).toBe(sha);
    }
    expect(Object.keys(lock.files)).toContain('LICENSE');
    expect(Object.keys(lock.files)).toContain('src/night/kit.js');
  });
  it('is MIT licensed', () => {
    expect(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')).toMatch(/^MIT License/);
  });
});
