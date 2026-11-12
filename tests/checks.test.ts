import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { bedFit, checkFor, counterCheck, dimensionsCard, sofaCheck } from '../src/core/checks';
import { itemFromCatalog } from '../src/core/catalog';

const FOOT = 'Measured from the floor plan, accurate to about 5 cm.';

describe('bedFit (acceptance)', () => {
  it('2.00 x 1.50 bed: 160 fits +40, 175 fits +25, 190 tight +10', () => {
    const r = [1.6, 1.75, 1.9].map((h) => bedFit(2.0, 1.5, h, 'Bed', FOOT));
    console.log('bedFit spare', r.map((x) => `${x.verdict} ${x.spareCm}`).join(' | '));
    expect(r.map((x) => [x.verdict, x.spareCm])).toEqual([['fits', 40], ['fits', 25], ['tight', 10]]);
  });
  it('single bed 1.83 x 0.91 and 1.90 m: too-short -7, sleeps one', () => {
    const r = bedFit(1.83, 0.91, 1.9, 'Single bed', 'Standard Single bed size.');
    expect(r.verdict).toBe('too-short');
    expect(r.spareCm).toBe(-7);
    expect(r.sleeps).toBe(1);
  });
  it('king mattress 1.98 x 1.83 and 1.90 m: tight +8, sleeps two', () => {
    const r = bedFit(1.98, 1.83, 1.9, 'King bed', 'Standard King bed size.');
    expect(r.verdict).toBe('tight');
    expect(r.spareCm).toBe(8);
    expect(r.sleeps).toBe(2);
  });
  it('boundaries: spare 15 fits, 14 tight, 0 tight, -1 too-short', () => {
    expect(bedFit(1.9, 1, 1.75, 'B', '').verdict).toBe('fits');       // 15
    expect(bedFit(1.89, 1, 1.75, 'B', '').verdict).toBe('tight');     // 14
    expect(bedFit(1.75, 1, 1.75, 'B', '').verdict).toBe('tight');     // 0
    expect(bedFit(1.75, 1, 1.75, 'B', '').spareCm).toBe(0);
    expect(Object.is(bedFit(1.75, 1, 1.75, 'B', '').spareCm, 0)).toBe(true);
    expect(bedFit(1.74, 1, 1.75, 'B', '').verdict).toBe('too-short'); // -1
    expect(bedFit(1.74, 1, 1.75, 'B', '').spareCm).toBe(-1);
  });
  it('sweeps every height 140..200 against 4 lengths without a tier mismatch', () => {
    for (const len of [1.83, 1.9, 1.98, 2.0]) {
      for (let cm = 140; cm <= 200; cm++) {
        const r = bedFit(len, 1, cm / 100, 'B', '');
        const spare = Math.round(len * 100) - cm;
        expect(r.spareCm).toBe(spare);
        expect(r.verdict).toBe(spare >= 15 ? 'fits' : spare >= 0 ? 'tight' : 'too-short');
      }
    }
  });
  it('card copy matches 2.1 character for character', () => {
    expect(bedFit(2.0, 1.5, 1.75, 'Bed', FOOT).card).toEqual({
      title: 'Bed · 150 × 200 cm', tone: 'good', headline: 'You fit.',
      lines: ['25 cm to spare at 175 cm tall.', '150 cm wide, sleeps two.'], footer: FOOT,
    });
    expect(bedFit(2.0, 1.5, 1.9, 'Bed', FOOT).card).toEqual({
      title: 'Bed · 150 × 200 cm', tone: 'warn', headline: 'Tight fit.',
      lines: ['Only 10 cm to spare. Your feet reach the end.', '150 cm wide, sleeps two.'], footer: FOOT,
    });
    expect(bedFit(1.83, 0.91, 1.9, 'Single bed', 'Standard Single bed size.').card).toEqual({
      title: 'Single bed · 91 × 183 cm', tone: 'bad', headline: 'Too short for you.',
      lines: ['Your feet hang 7 cm over the end.', '91 cm wide, sleeps one.'], footer: 'Standard Single bed size.',
    });
  });
  it('width lines at their boundaries', () => {
    const w = (m: number) => bedFit(2, m, 1.75, 'B', '').card.lines[1];
    expect(w(1.35)).toBe('135 cm wide, sleeps two.');
    expect(w(1.34)).toBe('134 cm wide, sleeps one.');
    expect(w(0.9)).toBe('90 cm wide, sleeps one.');
    expect(w(0.89)).toBe('89 cm wide, a narrow single.');
    expect(w(0.75)).toBe('75 cm wide, a narrow single.');
    expect(w(0.74)).toBe('74 cm wide, too narrow to sleep on.');
    expect(bedFit(2, 0.74, 1.75, 'B', '').sleeps).toBe(0);
    expect(bedFit(2, 0.89, 1.75, 'B', '').sleeps).toBe(1);
  });
});

describe('sofaCheck / counterCheck (acceptance)', () => {
  it('sofa 2.0 m wide, seat 0.42: 160 and 175 good, 190 warn (low); seats 3', () => {
    const r = [1.6, 1.75, 1.9].map((h) => sofaCheck(2.0, 0.42, h, 'Sofa'));
    expect(r.map((c) => c.tone)).toEqual(['good', 'good', 'warn']);
    expect(r[0].headline).toBe('Seats 3.');
    expect(r[0].title).toBe('Sofa · 200 cm wide');
    expect(r[0].lines).toEqual(['Seat height 42 cm suits you.']);
    expect(r[2].lines).toEqual(['Seat height 42 cm is low. Your knees sit above your hips.']);
  });
  it('sofa high case and seat count', () => {
    expect(sofaCheck(2.0, 0.5, 1.6, 'S').lines).toEqual(['Seat height 50 cm is high. Your feet may not rest flat.']);
    expect(sofaCheck(2.0, 0.5, 1.6, 'S').tone).toBe('warn');
    expect(sofaCheck(0.5, 0.42, 1.75, 'S').headline).toBe('Seats 1.');
    expect(sofaCheck(1.8, 0.42, 1.75, 'S').headline).toBe('Seats 3.');
    expect(sofaCheck(2.4, 0.42, 1.75, 'S').headline).toBe('Seats 4.');
    expect(sofaCheck(2.1, 0.43, 1.75, 'S').headline).toBe('Seats 3.');
  });
  it('counter 0.90: 160 and 175 good, 190 warn (low)', () => {
    const r = [1.6, 1.75, 1.9].map((h) => counterCheck(0.9, h, 'Counter'));
    expect(r.map((c) => c.tone)).toEqual(['good', 'good', 'warn']);
    expect(r[0].headline).toBe('Comfortable working height for you.');
    expect(r[2].headline).toBe('Low for you. Expect to stoop.');
    expect(r[0].title).toBe('Counter · 90 cm high');
    expect(counterCheck(1.1, 1.6, 'C').headline).toBe('High for you.');
  });
});

describe('dimensionsCard and checkFor', () => {
  const furnished = buildTruthProperty('furnished').furniture;
  const queen = itemFromCatalog('bed-queen', { cx: 1, cz: 2, w: 1.62, d: 2.08, yawDeg: 90 }, 'virtual');
  const wardrobe = itemFromCatalog('wardrobe-2', { cx: 1, cz: 2, w: 1.2, d: 0.6, yawDeg: 0 }, 'virtual');

  it('wardrobe size card', () => {
    expect(dimensionsCard(wardrobe)).toEqual({ title: '2-door wardrobe', tone: 'good', headline: '120 × 60 × 210 cm', lines: [] });
  });
  it('dispatches on kind: real bed gets the plan footer, virtual the standard-size footer', () => {
    const real = checkFor(furnished.find((i) => i.kind === 'bed')!, 1.9);
    expect(real.title).toBe('Bed · 150 × 200 cm');
    expect(real.headline).toBe('Tight fit.');
    expect(real.lines[0]).toBe('Only 10 cm to spare. Your feet reach the end.');
    expect(real.footer).toBe(FOOT);
    const virt = checkFor(queen, 1.9);
    expect(virt.title).toBe('Queen bed · 152 × 198 cm');
    expect(virt.footer).toBe('Standard Queen bed size.');
    expect(virt.lines[0]).toBe('Only 8 cm to spare. Your feet reach the end.');
  });
  it('real sofa uses its box width and seat height', () => {
    const c = checkFor(furnished.find((i) => i.kind === 'sofa')!, 1.75);
    expect(c.title).toBe('Sofa · 200 cm wide');
    expect(c.headline).toBe('Seats 3.');
    expect(c.tone).toBe('good');
  });
  it('wardrobe and dining give a dimensions card', () => {
    expect(checkFor(wardrobe, 1.75).headline).toBe('120 × 60 × 210 cm');
    const dining = itemFromCatalog('dining-6', { cx: 1, cz: 2, w: 1.8, d: 1.7, yawDeg: 0 }, 'virtual');
    expect(checkFor(dining, 1.75).headline).toBe('180 × 170 × 95 cm');
  });
  it('counter dispatches to counterCheck on its surface height', () => {
    const counter = { ...wardrobe, kind: 'counter' as const, label: 'Counter', heightM: 0.85, surfaceHeightM: 0.85 };
    expect(checkFor(counter, 1.75).title).toBe('Counter · 85 cm high');
  });
});
