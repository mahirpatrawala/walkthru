// C8 small pieces: label grouping and parsing, scale voting, the vision stub. Always runs.
import { describe, expect, it } from 'vitest';
import { groupTextBlocks, parseBlock, parseLabels, roomTypeOf, titleCase } from '../src/import/labels';
import { voteScale } from '../src/import/scale';
import { VisionNotConfigured } from '../src/import/vision';
import { ImportError } from '../src/import/types';
import type { VText } from '../src/import/types';

const T = (str: string, x: number, y: number, size: number, angle = 0, width?: number): VText =>
  ({ str, x, y, size, angle, width: width ?? str.length * size * 0.55 });

describe('label grouping', () => {
  it('keeps a room name, its size and its area together, and BED apart from them', () => {
    const texts = [
      T('SON ROOM', 487, 259, 18.3), T("11'0\"X12'6\"", 504, 276, 14.6), T('150 SQFT', 506, 291.6, 14.6),
      T('BED', 526, 319, 7.3), T("5'0\"X6'0\"", 526, 328, 7.3),
    ];
    const { rooms, furniture } = parseLabels(texts);
    expect(rooms.length).toBe(1);
    expect(rooms[0].name).toBe('Son Room');
    expect(rooms[0].roomType).toBe('bedroom');
    expect(rooms[0].dims!.w).toBeCloseTo(3.3528, 3);
    expect(rooms[0].dims!.l).toBeCloseTo(3.81, 3);
    expect(rooms[0].areaM2).toBeCloseTo(150 * 0.09290304, 4);
    expect(furniture.length).toBe(1);
    expect(furniture[0].key).toBe('bed');
    expect(furniture[0].dims!.w).toBeCloseTo(1.524, 3);
  });
  it('a size line closes the label: the words under it are not part of it', () => {
    const texts = [T('SIDE TABLE', 249, 332, 7.3), T("1'6\"X1'9\"", 248, 341, 7.3), T('DRESSING', 266, 347.3, 7.3), T('STORAGE', 266, 356, 7.3)];
    const blocks = groupTextBlocks(texts);
    expect(blocks.length).toBe(2);
    const p = parseBlock(blocks.find((b) => b.lines[0].text === 'SIDE TABLE')!)!;
    expect(p.kind).toBe('furniture');
  });
  it('reads rotated text in its own frame', () => {
    const texts = [T('BED', 100, 100, 7, 90), T("5'0\"X6'0\"", 91, 100, 7, 90)];
    // reading downward: the second line is to the left of the first
    const f = parseLabels(texts).furniture;
    expect(f.length).toBe(1);
    expect(f[0].dims).toBeDefined();
  });
});

describe('label parsing', () => {
  const one = (s: string): ReturnType<typeof parseBlock> => parseBlock(groupTextBlocks([T(s, 0, 0, 7)])[0]);
  it('WARDROBE=9\'0"RFT is a running length only', () => {
    const p = one('WARDROBE=9\'0"RFT');
    expect(p!.kind).toBe('furniture');
    if (p!.kind === 'furniture') { expect(p!.key).toBe('wardrobe'); expect(p!.runningLengthM).toBeCloseTo(2.7432, 3); expect(p!.dims).toBeUndefined(); }
  });
  it('BED is furniture, BED ROOM and BEDROOM 1 are rooms, DINING TABLE is furniture and DINING a room', () => {
    expect(one('BED')!.kind).toBe('furniture');
    expect(one('BED ROOM')!.kind).toBe('room');
    expect(one('BEDROOM 1')!.kind).toBe('room');
    expect(one('DINING TABLE')!.kind).toBe('furniture');
    expect(one('DINING')!.kind).toBe('room');
    expect(one('STUDY')!.kind).toBe('furniture');
    expect(one('STUDY ROOM')!.kind).toBe('room');
    const d = one('DRESSING STORAGE');
    expect(d!.kind).toBe('furniture');
    if (d!.kind === 'furniture') { expect(d!.key).toBe('dressing'); expect(d!.name).toBe('Dressing / storage'); }
    expect(one('NOTES')).toBeNull();
  });
  it('room types follow the spec mapping', () => {
    expect(roomTypeOf('MASTER ROOM')).toBe('bedroom');
    expect(roomTypeOf('LIVING ROOM')).toBe('living');
    expect(roomTypeOf('KITCHEN')).toBe('kitchen');
    expect(roomTypeOf('WASH AREA')).toBe('bathroom');
    expect(roomTypeOf('TERRACE')).toBe('balcony');
    expect(roomTypeOf('PASSAGE')).toBe('other');
    expect(titleCase('BEDROOM 1')).toBe('Bedroom 1');
  });
  it('reads metric sizes and square metres', () => {
    const texts = [T('KITCHEN', 0, 0, 8), T('3.2 x 2.4 m', 0, 9, 6), T('7.7 SQ M', 0, 17, 6)];
    const r = parseLabels(texts).rooms[0];
    expect(r.dims!.w).toBeCloseTo(3.2, 3);
    expect(r.areaM2).toBeCloseTo(7.7, 3);
  });
});

describe('scale voting', () => {
  const v = (source: string, ptPerM: number) => ({ source, ptPerM });
  it('takes the largest set within 3% of its own median and reports the full spread', () => {
    const r = voteScale([v('furniture a', 100), v('furniture b', 101), v('room c', 102), v('room d', 90), v('room e', 112)])!;
    expect(r.agreeing).toBe(3);
    expect(r.ptPerM).toBe(101);
    expect(r.disagreementPct).toBeCloseTo(((112 - 90) / 101) * 100, 6);
  });
  it('a tie goes to the set with more furniture votes', () => {
    const r = voteScale([v('room a', 100), v('room b', 101), v('furniture c', 130), v('furniture d', 131)])!;
    expect(r.ptPerM).toBeCloseTo(130.5, 6);
  });
  it('no votes is null, one vote is one agreeing', () => {
    expect(voteScale([])).toBeNull();
    expect(voteScale([v('room a', 50)])!.agreeing).toBe(1);
  });
});

describe('vision stub (13.9)', () => {
  it('says it is not configured and does nothing else', async () => {
    const p = new VisionNotConfigured();
    await expect(p.propose({ image: new Uint8Array(1), mime: 'image/png' })).rejects.toBeInstanceOf(ImportError);
    await expect(p.propose({ image: new Uint8Array(1), mime: 'image/png' })).rejects.toMatchObject({ code: 'vision-not-configured' });
  });
});
