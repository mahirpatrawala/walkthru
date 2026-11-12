import { describe, expect, it } from 'vitest';
import { formatArea, formatFtIn, formatHeight, formatLength, parseLength, parseSize } from '../src/core/units';

describe('parseLength', () => {
  it('feet and inches', () => {
    expect(parseLength('13\'1"')).toBeCloseTo(3.9878, 3);
    expect(Math.abs(parseLength('13\'1"')! - 3.9878)).toBeLessThan(0.0005);
    expect(parseLength("13' 1\"")).toBeCloseTo(3.9878, 3);
    expect(parseLength('13 ft 1 in')).toBe(parseLength('13\'1"'));
    expect(parseLength('13ft')).toBeCloseTo(3.9624, 4);
    expect(parseLength("13'")).toBeCloseTo(3.9624, 4);
    expect(parseLength('157"')).toBeCloseTo(3.9878, 4);
    expect(parseLength('157 in')).toBeCloseTo(3.9878, 4);
  });
  it('curly quotes are normalised', () => {
    expect(parseLength('13’1”')).toBeCloseTo(3.9878, 3);
    expect(parseLength('13′1″')).toBeCloseTo(3.9878, 3);
  });
  it('metric', () => {
    expect(parseLength('4 m')).toBe(4);
    expect(parseLength('400cm')).toBe(4);
    expect(parseLength('4000 mm')).toBe(4);
    expect(parseLength('4')).toBe(4);
    expect(parseLength('4.0')).toBe(4);
    expect(parseLength('  4.5  ')).toBe(4.5);
  });
  it('rejects junk', () => {
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('')).toBeNull();
    expect(parseLength('4 x 5')).toBeNull();
    expect(parseLength('-3')).toBeNull();
    expect(parseLength('0')).toBeNull();
  });
});

describe('parseSize', () => {
  it('splits on x, × or by', () => {
    expect(parseSize('4.0 x 5.0')).toEqual({ w: 4, l: 5 });
    expect(parseSize('4 × 5')).toEqual({ w: 4, l: 5 });
    expect(parseSize('4 by 5')).toEqual({ w: 4, l: 5 });
    const s = parseSize('13\'1" x 16\'5"')!;
    expect(s.w).toBeCloseTo(3.9878, 3);
    expect(s.l).toBeCloseTo(5.0038, 3);
  });
  it('null when a part is bad or the count is wrong', () => {
    expect(parseSize('4')).toBeNull();
    expect(parseSize('4 x abc')).toBeNull();
    expect(parseSize('4 x 5 x 6')).toBeNull();
  });
});

describe('formatting', () => {
  it('formatFtIn', () => {
    expect(formatFtIn(4)).toBe('13\'1"');
    expect(formatFtIn(5)).toBe('16\'5"');
    expect(formatFtIn(0.3048 * 2 - 0.001)).toBe('2\'0"'); // 11.96 in rounds to 12 and carries
    expect(formatFtIn(3)).toBe('9\'10"');
  });
  it('formatLength', () => {
    expect(formatLength(0.62).startsWith('62 cm')).toBe(true);
    expect(formatLength(0.62)).toBe('62 cm · 2 ft 0 in');
    expect(formatLength(2.43)).toBe('2.43 m · 8 ft 0 in');
    expect(formatLength(1)).toBe('1.00 m · 3 ft 3 in');
  });
  it('formatArea', () => {
    expect(formatArea(20).text).toBe('215 sq ft · 20.0 m²');
    expect(formatArea(4.5).sqft).toBe(48);
    expect(formatArea(4.8).sqft).toBe(52);
    expect(formatArea(24.8).text).toBe('267 sq ft · 24.8 m²');
    expect(formatArea(20).m2).toBe('20.0');
  });
  it('formatHeight', () => {
    expect(formatHeight(175)).toBe('175 cm · 5 ft 9 in');
    expect(formatHeight(160)).toBe('160 cm · 5 ft 3 in');
    expect(formatHeight(190)).toBe('190 cm · 6 ft 3 in');
  });
});
