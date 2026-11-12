// C12a: the unit and format parsers of SPEC 17.4 and 17.12 item 3. Always runs; each value within 0.5 mm.
import { describe, expect, it } from 'vitest';
import { findArea, findSize, isSizeOnly, parseLengthLoose, parseRunningLength, parseSizeLoose } from '../src/understand/units';

const mm = (v: number | undefined | null, want: number): void => { expect(v).toBeDefined(); expect(Math.abs((v as number) - want)).toBeLessThan(0.0005); };

describe('17.12 item 3', () => {
  it('feet and inches, with and without the dash, a space, a fraction glyph or a written fraction', () => {
    mm(parseLengthLoose('2\'-11"')?.m, 0.889);
    mm(parseLengthLoose('2\'11"')?.m, 0.889);
    mm(parseLengthLoose('2\' 11"')?.m, 0.889);
    mm(parseLengthLoose('8\'-6"')?.m, 2.591);
    mm(parseLengthLoose('1\'-5½"')?.m, 0.4445);
    mm(parseLengthLoose('1\'-5 1/2"')?.m, 0.4445);
    mm(parseLengthLoose('9"')?.m, 0.2286);
    mm(parseLengthLoose('4½"')?.m, 0.1143);
    mm(parseLengthLoose("12'")?.m, 3.6576);
    mm(parseLengthLoose('12 ft 3 in')?.m, 3.7338);
  });
  it('sizes: 12\'0"X9\'0" and 11\'0" x 12\'6", millimetres, metres', () => {
    const a = parseSizeLoose('12\'0"X9\'0"')!;
    mm(a.w, 3.658); mm(a.l, 2.743);
    const b = parseSizeLoose('11\'0" x 12\'6"')!;
    mm(b.w, 3.3528); mm(b.l, 3.81);
    const c = parseSizeLoose('3350 X 3660')!;
    mm(c.w, 3.35); mm(c.l, 3.66);
    const d = parseSizeLoose('3.35 x 3.66 M')!;
    mm(d.w, 3.35); mm(d.l, 3.66);
    expect(parseSizeLoose('11\'0"')).toBeNull();
  });
  it('a bare integer of 3 to 5 digits on a dimension line is millimetres; a decimal or an m marker is metres', () => {
    mm(parseLengthLoose('2440')?.m, 2.44);
    mm(parseLengthLoose('900 MM')?.m, 0.9);
    mm(parseLengthLoose('3.05')?.m, 3.05);
    mm(parseLengthLoose('3.05 M')?.m, 3.05);
    mm(parseLengthLoose('305 cm')?.m, 3.05);
    expect(parseLengthLoose('2440')?.kind).toBe('bare-mm');
    expect(parseLengthLoose('3.05')?.kind).toBe('bare-m');
    mm(parseLengthLoose('9', 'ft')?.m, 2.7432);
  });
  it('areas', () => {
    mm(findArea('150 SQFT')?.m2, 13.9355);
    mm(findArea('150 SQ.FT.')?.m2, 13.9355);
    mm(findArea('14 SQ M')?.m2, 14);
    mm(findArea('14 SQ.M.')?.m2, 14);
    mm(findArea('14 m2')?.m2, 14);
    expect(findArea('14 SQ MM')).toBeNull();
  });
  it('a label line that is only a size or an area', () => {
    expect(isSizeOnly('11\'0"X12\'6"')).toBe(true);
    expect(isSizeOnly('150 SQFT')).toBe(true);
    expect(isSizeOnly('3350 X 3660')).toBe(true);
    expect(isSizeOnly('BED 5\'0"X6\'0"')).toBe(false);
    expect(isSizeOnly('KITCHEN')).toBe(false);
  });
  it('a size inside a longer string is found with its place', () => {
    const f = findSize('BED ROOM 11\'0"X12\'0" TYPE A')!;
    mm(f.w, 3.3528);
    expect('BED ROOM 11\'0"X12\'0" TYPE A'.slice(f.index, f.index + f.length)).toBe('11\'0"X12\'0"');
  });
  it('running lengths', () => {
    mm(parseRunningLength('9\'0"RFT')?.m, 2.7432);
    mm(parseRunningLength('WARDROBE = 9\' R.FT')?.m, 2.7432);
    mm(parseRunningLength('RFT 9\'6"')?.m, 2.8956);
    expect(parseRunningLength('9\'0"')).toBeNull();
  });
  it('junk is rejected', () => {
    for (const s of ['', 'abc', '-3', '0', '5 x', "x'"]) expect(parseLengthLoose(s), s).toBeNull();
  });
});
