// The glass over the 3D view (SPEC 2.7): which variant a panel wears for the scene behind it, and that its text holds WCAG AA in both.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKOFF_MAX_MS, GLASS, GLASS_FLAT, SHEET, TONE_SWITCH, chooseTone, contrast, greyOf, luminance, sampleRect, sheetContrast, toneContrast, toneFromHour, toneRange } from '../src/buyer/glass-tone';
import type { GlassTone } from '../src/buyer/glass-tone';

const tokens = fs.readFileSync(path.join(__dirname, '..', 'src/brand/tokens.css'), 'utf8');

describe('the arithmetic', () => {
  it('luminance and contrast are WCAG', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 5);
    expect(luminance(0, 0, 0)).toBe(0);
    expect(contrast(1, 0)).toBeCloseTo(21, 5);
    expect(luminance(greyOf(0.3), greyOf(0.3), greyOf(0.3))).toBeCloseTo(0.3, 3);
  });
});

describe('light glass over a bright scene, dark glass over a dark one', () => {
  it('a white room is light glass with dark text, a night scene is dark glass with light text', () => {
    expect(chooseTone(0.85, null)).toBe('light');
    expect(chooseTone(0.02, null)).toBe('dark');
    expect(chooseTone(0.85, 'dark')).toBe('light');
    expect(chooseTone(0.02, 'light')).toBe('dark');
  });
  it('does not flicker between the two near the switch', () => {
    const mid = (TONE_SWITCH.toDark + TONE_SWITCH.toLight) / 2;
    expect(chooseTone(mid, 'light')).toBe('light');
    expect(chooseTone(mid, 'dark')).toBe('dark');
    expect(chooseTone(TONE_SWITCH.toDark - 0.01, 'light')).toBe('dark');
    expect(chooseTone(TONE_SWITCH.toLight + 0.01, 'dark')).toBe('light');
    expect(chooseTone(NaN, 'light')).toBe('light');
  });
  it('falls back to the hour when the canvas cannot be read', () => {
    expect(toneFromHour(12)).toBe('light');
    expect(toneFromHour(21)).toBe('dark');
    expect(toneFromHour(3)).toBe('dark');
  });
  it('reads the part of the tiny copy that is behind a panel', () => {
    const gw = 4, gh = 2, d = new Uint8ClampedArray(gw * gh * 4);
    for (let i = 0; i < gw * gh; i++) { const v = i % gw < 2 ? 255 : 0; d.set([v, v, v, 255], i * 4); }
    expect(sampleRect(d, gw, gh, { x0: 0, y0: 0, x1: 0.5, y1: 1 })).toBeCloseTo(1, 5);
    expect(sampleRect(d, gw, gh, { x0: 0.5, y0: 0, x1: 1, y1: 1 })).toBe(0);
    expect(sampleRect(d, gw, gh, { x0: 0, y0: 0, x1: 1, y1: 1 })).toBeCloseTo(0.5, 5);
    expect(sampleRect(new Uint8ClampedArray(gw * gh * 4), gw, gh, { x0: 0, y0: 0, x1: 1, y1: 1 })).toBeNull();
  });
});

describe('AA contrast holds in both variants', () => {
  const cases: [string, typeof GLASS][] = [['blurred glass', GLASS], ['flat fill (low tier, no backdrop-filter)', GLASS_FLAT]];
  for (const [name, set] of cases) for (const tone of ['light', 'dark'] as GlassTone[]) {
    it(`${name}, ${tone}: text, dim text and the selected capsule are at least 4.5:1 over every backdrop the variant can stand on`, () => {
      const [lo, hi] = toneRange(tone);
      // the named scenes of the brief (a white room for light glass, a night scene for dark glass) and the worst backdrop the switch allows
      for (const l of [lo, hi, tone === 'light' ? 0.9 : 0.01, (lo + hi) / 2]) {
        const c = toneContrast(set[tone], l);
        expect(c.text, `text at ${l}`).toBeGreaterThanOrEqual(4.5);
        expect(c.dim, `dim at ${l}`).toBeGreaterThanOrEqual(4.5);
        expect(c.selected, `selected at ${l}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it('sheet glass: ink and muted text hold AA over a white room, a night scene and the backdrops in between', () => {
    for (const scene of ['light', 'dark'] as GlassTone[]) {
      const [lo, hi] = toneRange(scene);
      for (const l of [lo, hi, scene === 'light' ? 0.9 : 0, (lo + hi) / 2]) {
        const c = sheetContrast(scene, l);
        expect(c.ink, `ink ${scene} ${l}`).toBeGreaterThanOrEqual(4.5);
        expect(c.muted, `muted ${scene} ${l}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(tokens).toContain(`--wt-sheet-fill: rgba(${SHEET.fill.join(', ')}, ${SHEET.alpha.light})`);
    expect(tokens).toContain(`--wt-sheet-fill: rgba(${SHEET.fill.join(', ')}, ${SHEET.alpha.dark})`);
  });
  it('prints the numbers the SPEC quotes', () => {
    const r = (n: number): number => Math.round(n * 100) / 100;
    const rows = (['light', 'dark'] as GlassTone[]).map((t) => {
      const named = toneContrast(GLASS[t], t === 'light' ? 0.9 : 0.01);
      const worst = toneContrast(GLASS[t], t === 'light' ? TONE_SWITCH.toDark : TONE_SWITCH.toLight);
      return `${t}: named scene text ${r(named.text)} dim ${r(named.dim)} selected ${r(named.selected)}; worst text ${r(worst.text)} dim ${r(worst.dim)} selected ${r(worst.selected)}`;
    });
    console.log(rows.join('\n'));
    expect(rows.length).toBe(2);
  });
});

describe('the tokens are the variants the arithmetic checked', () => {
  const rgba = (v: readonly number[]): string => `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${v[3]})`;
  it('tokens.css paints the same fills and text', () => {
    expect(tokens).toContain(`--wt-glass-fill: ${rgba(GLASS.dark.fill)}`);
    expect(tokens).toContain(`--wt-glass-fill: ${rgba(GLASS.light.fill)}`);
    expect(tokens).toContain(`--wt-glass-fill: ${rgba(GLASS_FLAT.dark.fill)}`);
    expect(tokens).toContain(`--wt-glass-fill: ${rgba(GLASS_FLAT.light.fill)}`);
    expect(tokens).toContain(`--wt-glass-on: ${rgba(GLASS.dark.onFill)}`);
    expect(tokens).toContain(`--wt-glass-on: ${rgba(GLASS.light.onFill)}`);
    expect(tokens).toContain(`--wt-glass-dim: rgba(255, 255, 255, ${GLASS.dark.dimAlpha})`);
    expect(tokens).toContain(`--wt-glass-dim: rgba(${GLASS.light.text.join(', ')}, ${GLASS.light.dimAlpha})`);
    expect(tokens).toContain(`--wt-glass-text: rgb(${GLASS.light.text.join(', ')})`);
  });
});

describe('a variant is never a stale one (the landscape phone, 17 Nov 2026)', () => {
  it('the default dark variant fails AA over a bright wall, so the first read must not wait: its backoff is capped and an empty first read is retried', () => {
    // white on dark glass over a white ceiling or wall (luminance 0.9): under 4.5, the washed-out identity pill of the capture, read from the default variant
    expect(toneContrast(GLASS.dark, 0.9).text).toBeLessThan(4.5);
    // light glass over a dark door is as bad the other way
    expect(toneContrast(GLASS.light, 0.02).text).toBeLessThan(4.5);
    // so a panel's variant is never older than a few seconds on a device where the read is slow (it was 25 reads' worth: half a minute on software GL)
    expect(BACKOFF_MAX_MS).toBeLessThanOrEqual(3000);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/buyer/glass-tone.ts'), 'utf8');
    expect(src).toContain('if (whole === null && samples === 0) lastAt = 0');
    expect(fs.readFileSync(path.join(__dirname, '..', 'src/buyer/main.ts'), 'utf8')).toContain('glassKick?.()');
  });
  it('inside the range each variant is chosen for, every control meets 4.5 (text, dim text, selected capsule)', () => {
    for (const t of ['light', 'dark'] as GlassTone[]) {
      const [lo, hi] = toneRange(t);
      for (let l = lo; l <= hi + 1e-9; l += 0.05) {
        const c = toneContrast(GLASS[t], Math.min(hi, l));
        expect(c.text, `${t} ${l.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        expect(c.dim, `${t} ${l.toFixed(2)} dim`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
