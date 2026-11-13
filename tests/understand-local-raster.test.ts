// The local raster path (no vision key): geometry, scale fit and honesty on synthetic brochure pictures. No OCR engine, no real file:
// labels are handed in, as the reader would find them. SPEC 17.1 and 17.5 govern: nothing becomes verified without the geometry check.
import { describe, expect, it } from 'vitest';
import { drawBrochure, twoBhk } from '../scripts/drawing-sets/brochure';
import type { BrochureRoom } from '../scripts/drawing-sets/brochure';
import { keepRoomWords, labelFromRead, readRasterLocal } from '../src/understand/raster-local';
import type { LocalLabel } from '../src/understand/raster-local';
import { ocrSizeCandidates } from '../src/understand/local/sizes';
import { roomSpans, wallLayer } from '../src/understand/local/ink';

const run = async (rooms: BrochureRoom[], edit?: (l: LocalLabel[]) => LocalLabel[]) => {
  const b = drawBrochure(rooms);
  const labels = edit ? edit(b.labels) : b.labels;
  return { b, run: await readRasterLocal([{ id: 'p1', image: b.image }], { labels }) };
};
const statusOf = (r: Awaited<ReturnType<typeof run>>['run'], i: number): string => r.understanding.rooms[i].width.status;

describe('walls and spans on a drawn brochure', () => {
  it('the wall layer finds the thick structure and the spans from a room centre are the room', () => {
    const b = drawBrochure(twoBhk());
    const { mask } = wallLayer(b.image);
    const l = b.labels[0];
    const sp = roomSpans(mask, b.image.width, b.image.height, [(l.rect[0] + l.rect[2]) / 2, (l.rect[1] + l.rect[3]) / 2], 5, 400);
    expect(sp.left).not.toBeNull(); expect(sp.right).not.toBeNull(); expect(sp.up).not.toBeNull(); expect(sp.down).not.toBeNull();
    expect((sp.right! - sp.left!) / b.pxPerM).toBeCloseTo(5.0, 1);
    expect((sp.down! - sp.up!) / b.pxPerM).toBeCloseTo(3.4, 1);
  });
});

describe('the local path reads a picture with no vision', () => {
  it('fits one scale from the rooms and verifies the rooms that agree with it, none of them wrong', async () => {
    const { b, run: r } = await run(twoBhk());
    expect(r.status).toBe('ok');
    expect(r.cost.visionCalls).toBe(0); expect(r.sent).toEqual([]);
    expect(r.understanding.rooms.length).toBe(6);
    const scale = r.understanding.views[0].scale!.value;
    expect(Math.abs(scale / b.pxPerM - 1)).toBeLessThan(0.03);
    const verified = r.understanding.rooms.filter((x) => x.width.status === 'verified');
    expect(verified.length).toBeGreaterThanOrEqual(4);
    // every verified room is the size the picture was drawn at
    for (const x of verified) {
      const truth = b.rooms.find((t) => t.name === x.label.value && Math.abs(Math.min(t.w, t.l) - x.width.value) < 0.1)!;
      expect(truth, x.label.value).toBeTruthy();
      expect(Math.abs(x.width.value / Math.min(truth.w, truth.l) - 1)).toBeLessThan(0.02);
      expect(Math.abs(x.length.value / Math.max(truth.w, truth.l) - 1)).toBeLessThan(0.02);
    }
    // everything a reader said starts unverified: the method is never a fact on its own
    expect(r.understanding.rooms.every((x) => x.label.status === 'unverified' && x.roomType.status === 'unverified')).toBe(true);
  }, 60000);

  it('a printed size the walls contradict is a conflict, never verified, and both numbers are kept', async () => {
    const rooms = twoBhk(); rooms[1] = { ...rooms[1], printed: { w: 4.4, l: 3.4 } }; // the bedroom says 4.4 m, is drawn 3.6 m
    const { run: r } = await run(rooms);
    expect(statusOf(r, 1)).toBe('conflict');
    expect(r.understanding.conflicts.some((c) => c.field.includes('size'))).toBe(true);
    const others = [0, 2, 3, 4, 5].map((i) => statusOf(r, i));
    expect(others.filter((s) => s === 'verified').length).toBeGreaterThanOrEqual(3);
    expect(others).not.toContain('conflict');
  }, 60000);

  it('fewer than four measurable rooms: nothing is verified, and the page says why', async () => {
    const { run: r } = await run(twoBhk().slice(0, 3));
    expect(r.understanding.rooms.every((x) => x.width.status !== 'verified')).toBe(true);
    expect(r.understanding.warnings.join(' ')).toMatch(/0 rooms agree|agree on a scale|guess/);
  }, 60000);

  it('a reading chosen because the walls agree with it is never verified', async () => {
    const { run: r } = await run(twoBhk(), (ls) => ls.map((l, i) => (i === 4 ? { ...l, cands: [{ w: 3.9, l: 3.0, rank: 0, text: '' }, { w: 3.4, l: 3.0, rank: 2, text: '' }] } : l)));
    expect(statusOf(r, 4)).toBe('unverified');
    expect(r.understanding.rooms[4].width.value).toBeCloseTo(3.0, 1);
    expect(r.understanding.warnings.join(' ')).toMatch(/one of several readings/);
  }, 60000);

  it('feet read as metres for the whole plan fails the room-kind check: nothing is verified', async () => {
    const { run: r } = await run(twoBhk().map((x) => ({ ...x, printed: { w: x.w * 3.28, l: x.l * 3.28 } })));
    expect(r.understanding.rooms.every((x) => x.width.status !== 'verified')).toBe(true);
    expect(r.understanding.warnings.join(' ')).toMatch(/ordinary|unit/);
  }, 60000);

  it('a room whose size is only in a table of room sizes takes it from the row of the same name', async () => {
    const { b, run: r } = await run(twoBhk(), (ls) => {
      const rows = ls.filter((l) => l.name === 'Toilet').map((l) => ({ ...l, id: 'row-1', rect: [b0().width - 70, 10, b0().width - 6, 28] as [number, number, number, number] }));
      return [...ls.map((l) => (l.name === 'Toilet' ? { ...l, cands: [], text: l.name } : l)), ...rows];
    });
    const toilet = r.understanding.rooms.find((x) => x.label.value === 'Toilet')!;
    expect(toilet.width.value).toBeCloseTo(1.6, 1);
    expect(b.rooms.length).toBe(6);
    expect(r.understanding.rooms.length).toBe(6);
    function b0() { return drawBrochure(twoBhk()).image; }
  }, 60000);
});

describe('reading labels out of OCR text', () => {
  const block = (text: string, digits: string[] = []) => ({ rect: [10, 10, 100, 40] as [number, number, number, number], lineH: 10, text, more: [] as string[], lines: digits.map((d) => ({ rect: [10, 10, 100, 20] as [number, number, number, number], digits: [d] })) });
  it('a name and its size become a label; the size never rides in the name', () => {
    const l = labelFromRead(block("BEDROOM\n12'-0\" X 10'-0\""), 'a')!;
    expect(l.name).toBe('Bedroom');
    expect(l.cands[0].w).toBeCloseTo(3.658, 2); expect(l.cands[0].l).toBeCloseTo(3.048, 2);
  });
  it('millimetres split over lines join up', () => {
    const l = labelFromRead(block('M.BEDROOM\n3800\nx4125'), 'a')!;
    expect(l.cands[0].w).toBeCloseTo(3.8, 3); expect(l.cands[0].l).toBeCloseTo(4.125, 3);
    expect(l.name).not.toMatch(/\d/);
  });
  it('notes, titles and areas are not rooms', () => {
    for (const t of ['SUPER BUILT-UP AREA\n102.08 Sq.m.', '2 BED ROOM + 2 TOILET', 'SOLAR PANEL', 'ELECTRICAL TRANSFORMER ROOM', 'TYPICAL UNIT PLAN', 'LIFT 1']) expect(labelFromRead(block(t), 'a'), t).toBeNull();
  });
  it('words OCR made up after a name go, and a lost foot mark is repaired but ranked below a plain read', () => {
    expect(keepRoomWords('TOILET BP KT-T od')).toBe('TOILET');
    expect(keepRoomWords('BED ROOM Ww- E F')).toBe('BED ROOM');
    const c = ocrSizeCandidates('12-0" X 100"');
    expect(c[0].w).toBeCloseTo(3.658, 2); expect(c[0].l).toBeCloseTo(3.048, 2); expect(c[0].rank).toBeGreaterThan(0);
    expect(ocrSizeCandidates('3,66x3,35')[0]).toMatchObject({ rank: 0 });
  });
});
