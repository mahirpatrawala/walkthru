// SPEC 16.21: the realistic-materials table, the level rules, the file paths, and the governor taking back a step.
import { describe, expect, it } from 'vitest';
import { REALISTIC_SETS, defaultRealism, effectiveRealism, parseRealism, realismFromQuery, realisticPaths } from '../src/look/realistic';
import { ResolutionGovernor } from '../src/look/resolution';

describe('realistic materials levels', () => {
  it('parses off, 1k and 2k (any case) and nothing else', () => {
    expect(parseRealism('OFF')).toBe('off');
    expect(parseRealism('1K')).toBe('1k');
    expect(parseRealism('2k')).toBe('2k');
    expect(parseRealism('4k')).toBeNull();
    expect(parseRealism(null)).toBeNull();
    expect(realismFromQuery('?materials=2k&quality=high')).toBe('2k');
    expect(realismFromQuery('?materials=huge')).toBeNull();
  });
  it('defaults to off on a phone and the low tier, 1K on a desktop, never 2K by itself', () => {
    expect(defaultRealism({ touch: true, tier: 'medium' })).toBe('off');
    expect(defaultRealism({ touch: false, tier: 'low' })).toBe('off');
    expect(defaultRealism({ touch: false, tier: 'medium' })).toBe('1k');
    expect(defaultRealism({ touch: false, tier: 'high' })).toBe('1k');
  });
  it('the governor may drop 2K to 1K, nothing else changes', () => {
    expect(effectiveRealism('2k', true)).toBe('1k');
    expect(effectiveRealism('2k', false)).toBe('2k');
    expect(effectiveRealism('1k', true)).toBe('1k');
    expect(effectiveRealism('off', true)).toBe('off');
  });
});

describe('the material-set table', () => {
  it('each family names one CC0 set and the files at both levels; the roughness map is always the 1K one', () => {
    for (const [fam, set] of Object.entries(REALISTIC_SETS)) {
      expect(set.slug, fam).toMatch(/^[a-z0-9_]+$/);
      expect(set.tileM).toBeGreaterThan(0.2);
      expect(set.normalScale).toBeLessThanOrEqual(0.4); // nothing bumpy
      expect(set.rough[0]).toBeLessThan(set.rough[1]);
      const p2 = realisticPaths(set.slug, '2k');
      expect(p2.diff).toBe(`tex/realistic/2k/${set.slug}/${set.slug}_diff_2k.jpg`);
      expect(p2.nor).toBe(`tex/realistic/2k/${set.slug}/${set.slug}_nor_gl_2k.jpg`);
      expect(p2.rough).toBe(`tex/realistic/1k/${set.slug}/${set.slug}_rough_1k.jpg`);
    }
    expect(Object.keys(REALISTIC_SETS).sort()).toEqual(['plank', 'tile', 'veneer', 'wall']);
  });
});

describe('the resolution governor and 2K', () => {
  it('undoStep takes back the last step down and restarts the window', () => {
    const g = new ResolutionGovernor(2, { target: 50 });
    for (let i = 0; i < 200 && g.ratio === 2; i++) g.frame(1 / 30);
    expect(g.ratio).toBe(1.75);
    expect(g.undoStep()).toBe(2);
    expect(g.ratio).toBe(2);
    expect(g.undoStep()).toBe(2); // already at the top
  });
});
