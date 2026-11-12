// C12a: the lexicons and the label parsing built on them (SPEC 17.2 rows 1 to 3, 17.4, 17.12 item 2). Always runs.
import { describe, expect, it } from 'vitest';
import { groupTextBlocks, parseBlock } from '../src/import/labels';
import { fixtureClassOf, furnitureOf, isBuiltInKey, isNotToScale, isRoomLabel, pageKindWords, roomTypeOf, tokens, unitNotesOf } from '../src/understand/lexicon';
import type { VText } from '../src/import/types';

const T = (str: string, x: number, y: number, size: number, angle = 0): VText => ({ str, x, y, size, angle, width: str.length * size * 0.55 });
const one = (s: string): ReturnType<typeof parseBlock> => parseBlock(groupTextBlocks([T(s, 0, 0, 7)])[0]);

describe('room lexicon (17.2 row 1, 17.12 item 2)', () => {
  it('family and numbered bedroom labels type as bedroom through the lexicon', () => {
    for (const s of ['SON ROOM', 'KIDS BEDROOM', 'BED-2', 'M.BED', 'GUEST ROOM', 'GRANDPARENTS ROOM', 'MASTER BED ROOM', 'MBR', 'BEDROOM-3', 'DAUGHTER ROOM', 'PARENTS BEDROOM']) {
      expect(roomTypeOf(s), s).toBe('bedroom');
    }
  });
  it('an unknown "<word> ROOM" is a bedroom, a known non-bedroom word is not', () => {
    expect(roomTypeOf('SPARE ROOM')).toBe('bedroom');
    for (const s of ['STORE ROOM', 'POOJA ROOM', 'STUDY ROOM', 'MEDIA ROOM', 'DINING ROOM', 'LIVING ROOM', 'TV ROOM', 'LAUNDRY ROOM']) expect(roomTypeOf(s), s).not.toBe('bedroom');
    expect(roomTypeOf('ROOM 1')).toBe('other');
  });
  it('builder-brochure vocabulary', () => {
    const want: Record<string, string> = {
      'BED ROOM': 'bedroom', 'M.BED ROOM': 'bedroom', TOILET: 'bathroom', 'W.C.': 'bathroom', WC: 'bathroom', 'C.TOILET': 'bathroom', 'ATT. TOILET': 'bathroom', WASHROOM: 'bathroom',
      KITCHEN: 'kitchen', KIT: 'kitchen', PANTRY: 'kitchen', 'DRY BALCONY': 'balcony', UTILITY: 'balcony', 'WASH AREA': 'balcony', 'SIT-OUT': 'balcony', TERRACE: 'balcony',
      POOJA: 'other', PUJA: 'other', MANDIR: 'other', 'LIVING/DINING': 'living', 'L/D': 'living', 'DRAWING ROOM': 'living', FOYER: 'other', PASSAGE: 'other', LOBBY: 'other', STORE: 'other',
    };
    for (const [s, t] of Object.entries(want)) expect(roomTypeOf(s), s).toBe(t);
  });
  it('the last typed word decides: a master toilet is a bathroom, a balcony off a bedroom is a balcony', () => {
    expect(roomTypeOf('MASTER TOILET')).toBe('bathroom');
    expect(roomTypeOf('M.TOILET')).toBe('bathroom');
    expect(roomTypeOf('BEDROOM 2 BALCONY')).toBe('balcony');
  });
  it('words that are not rooms are not rooms', () => {
    for (const s of ['NOTES', 'DUCT', 'LIFT', 'SHAFT', 'STAIR', 'TOILET DUCT', 'PLAN', '9\'0"', 'SIDE TABLE']) expect(isRoomLabel(s), s).toBe(false);
    for (const s of ['BED ROOM', 'LIVING/DINING', 'W.C.', 'SERVANT ROOM', 'FOYER']) expect(isRoomLabel(s), s).toBe(true);
  });
  it('tokenising ignores punctuation and splits digits', () => {
    expect(tokens('M.BED-2')).toEqual(['mbed', '2']);
    expect(tokens('BEDROOM1')).toEqual(['bedroom', '1']);
    expect(tokens("L/D")).toEqual(['l', 'd']);
  });
});

describe('furniture lexicon (17.2 row 3)', () => {
  it('maps words to catalogue kinds, longest entry first', () => {
    expect(furnitureOf('SETTEE')!.entry.kind).toBe('sofa');
    expect(furnitureOf('COT')!.entry.kind).toBe('bed');
    expect(furnitureOf('ALMIRAH')!.entry.kind).toBe('wardrobe');
    expect(furnitureOf('W/R')!.entry.kind).toBe('wardrobe');
    expect(furnitureOf('WARD.')!.entry.kind).toBe('wardrobe');
    expect(furnitureOf('CUPBOARD')!.entry.kind).toBe('wardrobe');
    expect(furnitureOf('BED SIDE TABLE')!.entry.key).toBe('side table');
    expect(furnitureOf('DRESSING TABLE')!.entry.key).toBe('dresser');
    expect(furnitureOf('DINING TABLE')!.entry.kind).toBe('dining');
    expect(furnitureOf('SWIVEL CHAIR')!.entry.key).toBe('chair');
    expect(furnitureOf('TV UNIT')!.entry.kind).toBeNull();
    expect(furnitureOf('LOFT')!.entry.key).toBe('loft');
  });
  it('a furniture word followed by ROOM or AREA is a room; BED 2 without a size is a bedroom number', () => {
    for (const s of ['BED ROOM', 'STUDY ROOM', 'DRESSING AREA', 'DRESSING ROOM']) expect(furnitureOf(s), s).toBeNull();
    expect(furnitureOf('BED-2')).toBeNull();
    expect(furnitureOf('BED 2', true)!.entry.key).toBe('bed');
    expect(furnitureOf('BED')!.entry.key).toBe('bed');
  });
  it('built-ins', () => {
    expect(isBuiltInKey('wardrobe')).toBe(true);
    expect(isBuiltInKey('sofa')).toBe(false);
  });
});

describe('running length in any of its written forms (17.2 row 3)', () => {
  const run = (s: string): number | undefined => { const p = one(s); return p && p.kind === 'furniture' ? p.runningLengthM : undefined; };
  it('WARDROBE=9\'0"RFT, with a space, W/R, WARD., R.FT, RUNNING FT, bare feet, metres', () => {
    const nine = 9 * 0.3048;
    expect(run('WARDROBE=9\'0"RFT')).toBeCloseTo(nine, 4);
    expect(run('WARDROBE 9\'0" RFT')).toBeCloseTo(nine, 4);
    expect(run('W/R 9\'0" RFT')).toBeCloseTo(nine, 4);
    expect(run('WARD. 9\' R.FT')).toBeCloseTo(nine, 4);
    expect(run('ALMIRAH 9 RUNNING FT')).toBeCloseTo(nine, 4);
    expect(run('WARDROBE 9 RFT')).toBeCloseTo(nine, 4);
    expect(run('WARDROBE 2.7 M RMT')).toBeCloseTo(2.7, 4);
    expect(run('WARDROBE')).toBeUndefined();
  });
  it('each of those is furniture of kind wardrobe with no sides', () => {
    for (const s of ['WARDROBE=9\'0"RFT', 'W/R 9\'0" RFT', 'WARD. 9\' R.FT', 'ALMIRAH 9 RFT']) {
      const p = one(s)!;
      expect(p.kind).toBe('furniture');
      if (p.kind === 'furniture') { expect(p.key).toBe('wardrobe'); expect(p.dims).toBeUndefined(); }
    }
  });
});

describe('brochure labels through parseBlock (17.4)', () => {
  it('a name with its size on the same line', () => {
    const p = one('BED ROOM 11\'0"X12\'0"')!;
    expect(p.kind).toBe('room');
    if (p.kind === 'room') { expect(p.roomType).toBe('bedroom'); expect(p.dims!.w).toBeCloseTo(11 * 0.3048, 4); expect(p.dims!.l).toBeCloseTo(12 * 0.3048, 4); }
    const q = one('LIVING/DINING 10\'0"X18\'6"')!;
    expect(q.kind === 'room' && q.roomType).toBe('living');
    const t = one('TOILET 5\'0"X8\'0"')!;
    expect(t.kind === 'room' && t.roomType).toBe('bathroom');
  });
  it('millimetre and metre sizes on a label', () => {
    const p = one('KITCHEN 2440 X 3050')!;
    expect(p.kind === 'room' && p.dims!.w).toBeCloseTo(2.44, 4);
    const q = one('KITCHEN 2.44 x 3.05 M')!;
    expect(q.kind === 'room' && q.dims!.l).toBeCloseTo(3.05, 4);
  });
  it('BED-2 is a room, BED alone is a bed, LOFT is not a room', () => {
    expect(one('BED-2')!.kind).toBe('room');
    expect(one('BED')!.kind).toBe('furniture');
    const l = one('LOFT')!;
    expect(l.kind).toBe('furniture');
  });
  it('areas in sq ft and sq m, in several spellings', () => {
    const texts = (area: string): VText[] => [T('BEDROOM', 0, 0, 8), T('11\'0"X12\'0"', 0, 9, 6), T(area, 0, 17, 6)];
    const get = (a: string): number | undefined => { const p = parseBlock(groupTextBlocks(texts(a))[0]); return p && p.kind === 'room' ? p.areaM2 : undefined; };
    expect(get('150 SQFT')).toBeCloseTo(150 * 0.09290304, 4);
    expect(get('150 SQ.FT.')).toBeCloseTo(150 * 0.09290304, 4);
    expect(get('150 SQ FT')).toBeCloseTo(150 * 0.09290304, 4);
    expect(get('14 SQ M')).toBeCloseTo(14, 4);
    expect(get('14.5 SQ.M.')).toBeCloseTo(14.5, 4);
  });
});

describe('fixtures, page kinds and unit notes', () => {
  it('fixture words', () => {
    expect(fixtureClassOf('W.C.')).toBe('wc');
    expect(fixtureClassOf('HOB')).toBe('hob');
    expect(fixtureClassOf('WB')).toBe('basin');
    expect(fixtureClassOf('SINK')).toBe('sink');
    expect(fixtureClassOf('GEYSER')).toBe('geyser');
    expect(fixtureClassOf('BED')).toBeNull();
  });
  it('title-block and caption words: strong ones only by default', () => {
    expect(pageKindWords('ELEVATION-3')).toEqual(['elevation']);
    expect(pageKindWords('GROUND FLOOR PLAN')).toEqual(['plan']);
    expect(pageKindWords('SEA VIEW')).toEqual([]);
    expect(pageKindWords('SEA VIEW', false)).toEqual(['elevation']);
    expect(pageKindWords('SECTION A-A')).toEqual(['section']);
  });
  it('notes on a built-in unit, and "not to scale"', () => {
    expect(unitNotesOf('2 SHUTTER OPENABLE')).toContain('openable');
    expect(unitNotesOf('FOOTWEAR DRAWER')).toContain('drawer');
    expect(unitNotesOf('LOFT')).toContain('loft');
    expect(unitNotesOf('6" MATTRESS')).toContain('mattress');
    expect(isNotToScale('DRAWINGS NOT TO BE SCALED')).toBe(true);
    expect(isNotToScale('NOT TO SCALE')).toBe(true);
    expect(isNotToScale('DO NOT SCALE')).toBe(true);
  });
});
