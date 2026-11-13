// Reader fixes found by the synthetic sweep (scripts/eval/sweep-reader.ts): stray lines inside a room label, glyph fragments of a
// size, label rectangles that must not overlap, outlines in the walls' own colour, unnamed rooms typed from their symbols.
import { describe, expect, it } from 'vitest';
import { Bitmap, WALL } from '../src/import/bitmap';
import { fitLabelRect } from '../src/import/rect-fit';
import { groupTextBlocks, parseBlock, splitStray } from '../src/import/labels';
import { unitFragments } from '../src/understand/text-pdf';
import { typeUnlabelledRooms } from '../src/understand/pipeline';
import type { VText } from '../src/import/types';
import type { TextRead } from '../src/understand/reads';

const run = (str: string, x: number, y: number, width = 40): VText => ({ str, x, y, width, size: 8, angle: 0 });

describe('label blocks', () => {
  it('a furniture note between the name and the size leaves the room label', () => {
    const blocks = groupTextBlocks([run('BEDROOM', 100, 100), run("WARDROBE 6'0\" RFT", 100, 110), run("11'6\"X12'0\"", 100, 120), run('12.8 SQ M', 100, 130)]).flatMap(splitStray);
    const parsed = blocks.map(parseBlock);
    const room = parsed.find((p) => p?.kind === 'room');
    expect(room && room.kind === 'room' && room.name).toBe('Bedroom');
    expect(room && room.kind === 'room' && room.dims).toBeTruthy();
    expect(parsed.some((p) => p?.kind === 'furniture')).toBe(true);
  });
  it('a lone key letter above the name is dropped, and a two-line BED / ROOM name is left alone', () => {
    const b = groupTextBlocks([run('B', 100, 90, 6), run('BED ROOM', 100, 100), run('3.60 X 3.80 M', 100, 110)]).flatMap(splitStray);
    const p = b.map(parseBlock).find((x) => x?.kind === 'room');
    expect(p && p.kind === 'room' && p.name).toBe('Bed Room');
    const two = groupTextBlocks([run('BED', 100, 100, 20), run('ROOM', 100, 110, 24), run('3.60 X 3.80 M', 100, 120)]).flatMap(splitStray);
    expect(two.length).toBe(1);
  });
});

describe('glyph fragments', () => {
  const read = (str: string, x0: number, x1: number): TextRead => ({ id: str + x0, method: 'glyph', str, bbox: [x0, 0, x1, 6], angle: 0, size: 8, origin: [x0, 6], length: x1 - x0, confidence: 0.9 });
  it('x and m beside a kept number are taken, a far one is not', () => {
    const n1 = read('3.65', 0, 20), x = read('X', 24, 30), n2 = read('4.30', 34, 54), m = read('M', 58, 66), far = read('M', 300, 308);
    const got = unitFragments([n1, x, n2, m, far], [n1, n2]);
    expect(got).toEqual(expect.arrayContaining([x, m]));
    expect(got).not.toContain(far);
  });
});

describe('rectangle of a room that walls do not close', () => {
  it('lands flush against the walls and clear of a room already taken', () => {
    const bm = new Bitmap(200, 100, 1);
    const wall = (x0: number, y0: number, x1: number, y1: number): void => bm.fillRing([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], WALL);
    wall(0, 0, 200, 4); wall(0, 96, 200, 100); wall(0, 0, 4, 100); wall(196, 0, 200, 100); wall(96, 0, 100, 100);
    const taken = new Uint8Array(bm.nx * bm.ny);
    for (let j = 0; j < bm.ny; j++) for (let i = 4; i < 96; i++) taken[j * bm.nx + i] = 1;
    // a label near the middle wall, a room of 96 x 92 asked for: only the right-hand cell holds it
    const fit = fitLabelRect(bm, taken, { x: 140, y: 50 }, 96, 92, 4);
    expect(fit).not.toBeNull();
    const xs = fit!.polygon.map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(99);
    expect(Math.max(...xs)).toBeLessThanOrEqual(197);
    expect(fit!.contact).toBeGreaterThan(0.8);
  });
});

describe('unnamed rooms', () => {
  it('are typed from their symbols and keep their "Room N" name', () => {
    const room = (id: string, label: string) => ({ id, label, roomType: 'other' as const, polygon: [], edges: [] });
    const result = { proposal: { rooms: [room('room-1', 'Room 1'), room('store', 'Store')] }, extras: { rooms: [{ id: 'room-1', roomType: 'other' }, { id: 'store', roomType: 'other' }] } } as never;
    typeUnlabelledRooms(result, { roomTypes: new Map([['room-1', 'bedroom'], ['store', 'bedroom']]) } as never);
    const rooms = (result as { proposal: { rooms: { label: string; roomType: string }[] } }).proposal.rooms;
    expect(rooms[0]).toMatchObject({ label: 'Room 1', roomType: 'bedroom' });
    expect(rooms[1].roomType).toBe('other');
  });
});
