// The honest clearances of the second catalogue table: a swing's arc (from the length of its chains), a hung swing's ceiling rule and hook note,
// the door of a fridge or a washing machine, a recliner's footrest, a sofa-bed opened, an ironing board's standing room, a WC's front and side
// space, the room a fitting belongs in, a wall fixture's wall, and a ceiling-height unit. Each has a fits, a tight and a blocked case.
import { describe, expect, it } from 'vitest';
import { catalogItem, fullHeightM, itemFromCatalog, setCatalogCeiling } from '../src/core/catalog';
import { createGrid } from '../src/core/grid-codec';
import { stampFurniture } from '../src/core/layout-raster';
import { checkPlacement } from '../src/core/placement';
import { chainLengthM, pieceRule, swingReachM, swingZone } from '../src/core/pieces';
import { swingChainM, zoneNeedM } from '../src/core/clearance';
import { GRID_CELL_M } from '../src/types';
import type { Box, FurnitureItem, Grid, RoomType } from '../src/types';

/** a 8 x 8 m room, walls (250) all round, free inside from 0.5 to 7.5 m, optionally one low obstacle (cells hold cm) */
function room(): Grid {
  const n = Math.round(8 / GRID_CELL_M);
  const g = createGrid(0, 0, n, n, 250);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * GRID_CELL_M, z = (j + 0.5) * GRID_CELL_M;
    if (x > 0.5 && x < 7.5 && z > 0.5 && z < 7.5) g.cells[j * n + i] = 0;
  }
  return g;
}
const Z_END = 7.5;
const Z_START = 0.5;

/** a piece with its back to the far wall of nothing: `front` metres clear in front (toward +z), centred sideways, yaw 0 */
function withFront(id: string, front: number, extra: Partial<Box> = {}): Box {
  const s = catalogItem(id);
  return { cx: 4, cz: Z_END - front - s.footprint.d / 2, w: s.footprint.w, d: s.footprint.d, yawDeg: 0, ...extra };
}
/** a piece with `back` metres clear behind it (toward -z) and plenty in front */
function withBack(id: string, back: number): Box {
  const s = catalogItem(id);
  return { cx: 4, cz: Z_START + back + s.footprint.d / 2, w: s.footprint.w, d: s.footprint.d, yawDeg: 0 };
}
const check = (id: string, box: Box, ceiling = 2.7, known = true, roomType: RoomType | null = null, grid = room()) => checkPlacement(grid, catalogItem(id), box, ceiling, known, roomType);

describe('the swing', () => {
  it('its reach follows the length of its chains: 20 degrees on a 2.7 m ceiling is about 68 cm from the seat edge', () => {
    const z = swingZone('swing-2')!;
    expect(chainLengthM(z, 2.7)).toBeCloseTo(2.7 - 0.62, 6);
    expect(swingReachM(2.08, 20)).toBeCloseTo(0.7114, 3);
    const need = zoneNeedM(z, catalogItem('swing-2'), 'front', 2.7);
    expect(need).toBeGreaterThan(0.6);
    expect(need).toBeLessThan(0.76);
    // a lower ceiling means shorter chains and a smaller swing
    expect(zoneNeedM(z, catalogItem('swing-2'), 'front', 2.4)).toBeLessThan(need);
    expect(swingChainM(pieceRule('swing-2'), 2.6)).toBeCloseTo(1.98, 6);
    expect(swingChainM(pieceRule('sofa-bed'), 2.6)).toBeNull();
  });

  it('fits with room front and behind: names the need and the assumed angle, and the hook note', () => {
    const r = check('swing-2', { cx: 4, cz: 4, w: 1.3, d: 0.58, yawDeg: 0 });
    expect(r.verdict).toBe('fits');
    expect(r.zones?.map((z) => z.side).sort()).toEqual(['back', 'front']);
    expect(r.message).toContain('Swing needs 68 cm clear in front and behind (a 20° swing each way)');
    expect(r.message).toContain('Hanging needs a structural hook: check with your builder.');
    expect(r.message).not.toContain('will hit');
  });

  it('is tight when a full swing would brush the wall behind (75 to 100 % of the arc)', () => {
    const r = check('swing-2', withBack('swing-2', 0.56));
    expect(r.verdict).toBe('tight');
    expect(r.reason).toBe('swing');
    expect(r.message).toContain('56 cm behind, a full swing will brush the wall');
  });

  it('is blocked when it would hit the wall: "Swing needs 68 cm clear in front and behind: 42 cm behind, it will hit the wall."', () => {
    const r = check('swing-2', withBack('swing-2', 0.42));
    expect(r.verdict).toBe('blocked');
    expect(r.reason).toBe('swing');
    expect(r.tone).toBe('bad');
    expect(r.message).toContain('42 cm behind, it will hit the wall');
    expect(r.message.startsWith('Swing needs 68 cm clear in front and behind')).toBe(true);
    // the swept areas come back for the overlay: one a side, the short one marked blocked
    const back = r.zones!.find((z) => z.side === 'back')!;
    expect(back.status).toBe('blocked');
    expect(back.haveM).toBeCloseTo(0.42, 1);
    expect(back.box.d).toBeCloseTo(back.needM, 6);
  });

  it('says furniture, not wall, when a piece is what is in the way', () => {
    const g = room();
    // a 90 cm high block 40 cm in front of the swing
    const box = { cx: 4, cz: 4, w: 1.3, d: 0.58, yawDeg: 0 };
    for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
      const x = (i + 0.5) * GRID_CELL_M, z = (j + 0.5) * GRID_CELL_M;
      if (x > 3 && x < 5 && z > 4.65 && z < 5.2) g.cells[j * g.nx + i] = 90;
    }
    const r = checkPlacement(g, catalogItem('swing-2'), box, 2.7);
    expect(r.verdict).toBe('blocked');
    expect(r.message).toContain('it will hit the furniture');
  });

  it('a hung swing needs a ceiling of 2.3 m: below it the chains are too short (blocked), and an unconfirmed ceiling is not printed as a number', () => {
    const low = check('swing-2', { cx: 4, cz: 4, w: 1.3, d: 0.58, yawDeg: 0 }, 2.2);
    expect(low.verdict).toBe('blocked');
    expect(low.message).toContain('needs a ceiling of 2.3 m or more');
    expect(low.message).toContain('the chains would be only 158 cm');
    const unknown = check('swing-2', { cx: 4, cz: 4, w: 1.3, d: 0.58, yawDeg: 0 }, 2.7, false);
    expect(unknown.message).toContain('not confirmed');
    const unknownLow = check('swing-2', { cx: 4, cz: 4, w: 1.3, d: 0.58, yawDeg: 0 }, 2.2, false);
    expect(unknownLow.message).not.toContain('2.2');
  });

  it('a free-standing frame has no ceiling rule and no hook note, and keeps 30 cm each side for getting on and off', () => {
    const box = { cx: 4, cz: 4, w: 1.55, d: 1.25, yawDeg: 0 };
    const low = check('swing-2-frame', box, 2.2);
    expect(low.verdict).toBe('fits');
    expect(low.message).not.toContain('structural hook');
    const tight = check('swing-2-frame', { ...box, cz: Z_START + 0.25 + 0.625 });
    expect(tight.verdict).toBe('tight');
    const blocked = check('swing-2-frame', { ...box, cz: Z_START + 0.12 + 0.625 });
    expect(blocked.verdict).toBe('blocked');
  });

  it('a hanging chair swings all round: each of its four sides is read', () => {
    const r = check('hang-chair', { cx: 4, cz: 4, w: 0.95, d: 0.85, yawDeg: 0 });
    expect(r.zones!.map((z) => z.side).sort()).toEqual(['back', 'front', 'left', 'right']);
    expect(r.message).toContain('clear all round');
    expect(r.message).toContain('Hanging needs a structural hook');
  });

  it('is solid at rest: its footprint blocks a walker like any piece', () => {
    const it: FurnitureItem = itemFromCatalog('swing-2', { cx: 4, cz: 4, w: 1.3, d: 0.58, yawDeg: 0 }, 'virtual');
    const g = stampFurniture(room(), [it]);
    const i = Math.floor(4 / GRID_CELL_M), j = Math.floor(4 / GRID_CELL_M);
    expect(g.cells[j * g.nx + i]).toBe(Math.round(it.heightM * 100));
  });
});

describe('appliance and furniture clearances: fits, tight, blocked', () => {
  const cases: { id: string; need: number; tightFrac: number; word: string }[] = [
    { id: 'fridge-1', need: 0.6, tightFrac: 0.75, word: 'the door will not open' },
    { id: 'fridge-sbs', need: 0.48, tightFrac: 0.75, word: 'the doors will not open' },
    { id: 'washer-front', need: 0.6, tightFrac: 0.75, word: 'the door will not open' },
    { id: 'recliner', need: 0.6, tightFrac: 0.75, word: 'the footrest cannot come out' },
    { id: 'sofa-bed', need: 1.0, tightFrac: 0.85, word: 'it cannot fold out' },
    { id: 'ironing-board', need: 0.6, tightFrac: 0.75, word: 'there is no room to stand at it' },
    { id: 'treadmill', need: 1.0, tightFrac: 0.7, word: 'there is no safe room to step off' },
    { id: 'steel-almirah', need: 0.46, tightFrac: 0.75, word: 'the doors cannot open' },
  ];
  for (const c of cases) {
    it(`${c.id}: needs ${Math.round(c.need * 100)} cm in front`, () => {
      const room_: RoomType | null = null;
      const ok = check(c.id, withFront(c.id, c.need + 0.3), 2.7, true, room_);
      expect(ok.verdict, ok.message).toBe('fits');
      expect(ok.zones?.length).toBeGreaterThan(0);
      expect(ok.message).toContain(`needs ${Math.round(c.need * 100)} cm clear in front`);
      const tight = check(c.id, withFront(c.id, c.need * (c.tightFrac + 1) / 2));
      expect(tight.verdict, tight.message).toBe('tight');
      const bad = check(c.id, withFront(c.id, c.need * c.tightFrac * 0.8));
      expect(bad.verdict, bad.message).toBe('blocked');
      expect(bad.message).toContain(c.word);
      // the assumed dimension is in the sentence
      expect(bad.message).toMatch(/\(.+\)/);
    });
  }

  it('the sofa-bed states its opened size, and the walker may still sit on it closed', () => {
    const r = check('sofa-bed', withFront('sofa-bed', 1.4));
    expect(r.message).toContain('opened bed 190 × 190 cm');
    expect(pieceRule('sofa-bed')!.pose).toBe('sit');
  });

  it('the recliner is a wall-hugger: nothing is asked of the wall behind it', () => {
    const r = check('recliner', { ...withFront('recliner', 1.5), cz: Z_START + 0.02 + 0.475 });
    expect(r.verdict).toBe('fits');
  });

  it('a fridge or washer footprint includes the gap it needs behind, and the label says so', () => {
    expect(catalogItem('fridge-1').sizeLabel).toContain('plus 5 cm behind for air');
    expect(catalogItem('washer-front').sizeLabel).toContain('plus 10 cm behind for hoses');
    expect(catalogItem('fridge-1').footprint.d).toBeCloseTo(0.62 + 0.05, 6);
  });
});

describe('bathroom fixtures', () => {
  /** a WC against the back wall at x = 4, with walls `left` and `right` of its sides and one `front` metres in front of it */
  const wc = (front: number, left: number, right: number): Grid => {
    const g = room();
    const w = 0.4;
    for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
      const x = (i + 0.5) * GRID_CELL_M, z = (j + 0.5) * GRID_CELL_M;
      if (x < 4 - w / 2 - left || x > 4 + w / 2 + right || z > Z_START + 0.02 + 0.72 + front) g.cells[j * g.nx + i] = 250;
    }
    return g;
  };
  const box = (): Box => ({ cx: 4, cz: Z_START + 0.02 + 0.36, w: 0.4, d: 0.72, yawDeg: 0 });
  it('a WC needs about 60 cm in front and 20 cm each side (stated): fits, tight, blocked', () => {
    const ok = check('wc-western', box(), 2.7, true, 'bathroom', wc(0.8, 0.3, 0.3));
    expect(ok.verdict, ok.message).toBe('fits');
    expect(ok.message).toContain('60 cm clear in front and 20 cm on each side');
    expect(ok.message).toContain('assumed 60 cm in front and 20 cm each side');
    const tightSide = check('wc-western', box(), 2.7, true, 'bathroom', wc(0.8, 0.14, 0.3));
    expect(tightSide.verdict, tightSide.message).toBe('tight');
    expect(tightSide.message).toMatch(/1[45] cm on the left/);
    const blockedFront = check('wc-western', box(), 2.7, true, 'bathroom', wc(0.3, 0.3, 0.3));
    expect(blockedFront.verdict).toBe('blocked');
    expect(blockedFront.message).toContain('there is not room to use it');
  });
  it('a basin needs standing room in front; a shower 80 × 80 cm', () => {
    expect(check('basin-wall', { ...withFront('basin-wall', 0.9), cz: Z_END - 0.9 - 0.225 }, 2.7, true, 'bathroom').verdict).toBe('tight'); // the wall is 0.9 behind? no: not against a wall
    const shower = check('shower-over', { ...withFront('shower-over', 0.9), cz: Z_START + 0.02 + 0.175 }, 2.7, true, 'bathroom');
    expect(shower.verdict, shower.message).toBe('fits');
    expect(shower.message).toContain('shower area 80 × 80 cm');
    expect(shower.zones![0].box.w).toBeCloseTo(0.8, 6);
    const cramped = check('shower-over', { ...withFront('shower-over', 0.5), cz: Z_START + 0.02 + 0.175, cx: 4 }, 2.7, true, 'bathroom', (() => { const g = room(); for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) { const z = (j + 0.5) * GRID_CELL_M; if (z > Z_START + 0.02 + 0.35 + 0.5) g.cells[j * g.nx + i] = 250; } return g; })());
    expect(cramped.verdict, cramped.message).toBe('blocked');
  });
  it('allowed outside a bathroom with a clear message, not a hard block', () => {
    const r = check('wc-western', { ...withFront('wc-western', 1.5), cz: Z_START + 0.02 + 0.36 }, 2.7, true, 'bedroom');
    expect(r.verdict).toBe('tight');
    expect(r.reason).toBe('room');
    expect(r.message).toContain('is for a bathroom');
    expect(r.message).toContain('not a bathroom on the drawing');
    const inBath = check('wc-western', { ...withFront('wc-western', 1.5), cz: Z_START + 0.02 + 0.36 }, 2.7, true, 'bathroom');
    expect(inBath.verdict).toBe('fits');
    // an unknown room (outside every room) says nothing about rooms
    expect(check('wc-western', { ...withFront('wc-western', 1.5), cz: Z_START + 0.02 + 0.36 }, 2.7, true, null).verdict).toBe('fits');
    // a fridge in a bedroom is also only a note
    expect(check('fridge-1', withFront('fridge-1', 1.2), 2.7, true, 'bedroom').message).toContain('usually in the kitchen');
  });
  it('wall fixtures are fixed to a wall: against one they fit, in the open they say so', () => {
    const against = check('basin-wall', { cx: 4, cz: Z_START + 0.02 + 0.225, w: 0.55, d: 0.45, yawDeg: 0 }, 2.7, true, 'bathroom');
    expect(against.verdict, against.message).toBe('fits');
    const open = check('basin-wall', { cx: 4, cz: 4, w: 0.55, d: 0.45, yawDeg: 0 }, 2.7, true, 'bathroom');
    expect(open.verdict).toBe('tight');
    expect(open.message).toContain('is fixed to a wall');
  });
  it('a wall piece clears what stands lower than its underside: a geyser (base at 190 cm) over a WC, a basin over a low unit', () => {
    const g = room();
    // a WC 80 cm high where the geyser will hang
    const wcBox: Box = { cx: 4, cz: Z_START + 0.02 + 0.36, w: 0.4, d: 0.72, yawDeg: 0 };
    const wcItem = itemFromCatalog('wc-western', wcBox, 'virtual');
    const stamped = stampFurniture(g, [wcItem]);
    const geyser = checkPlacement(stamped, catalogItem('geyser-15'), { cx: 4, cz: Z_START + 0.02 + 0.16, w: 0.31, d: 0.32, yawDeg: 0 }, 2.7, true, 'bathroom');
    expect(geyser.verdict, geyser.message).toBe('fits');
    // a floor piece in the same place collides
    const clash = checkPlacement(stamped, catalogItem('wc-wallhung'), { ...wcBox, w: 0.36, d: 0.56 }, 2.7, true, 'bathroom');
    expect(clash.reason).toBe('collides');
    // too tall under a low ceiling: the geyser's top is at 2.37 m
    expect(checkPlacement(g, catalogItem('geyser-15'), { cx: 4, cz: 1, w: 0.31, d: 0.32, yawDeg: 0 }, 2.3, true, 'bathroom').reason).toBe('too-tall');
  });
  it('flat and overhead fixtures do not block a walker: a mat, a floor drain, a squat pan, a geyser', () => {
    const items = ['yoga-mat', 'floor-drain', 'wc-indian', 'geyser-15', 'shower-over'].map((id, k) => itemFromCatalog(id, { cx: 1 + k, cz: 2, w: catalogItem(id).footprint.w, d: catalogItem(id).footprint.d, yawDeg: 0 }, 'virtual'));
    const g = stampFurniture(room(), items);
    const at = (x: number): number => g.cells[Math.floor(2 / GRID_CELL_M) * g.nx + Math.floor(x / GRID_CELL_M)];
    expect([at(1), at(2), at(3), at(4)]).toEqual([0, 0, 0, 0]);
    expect(at(5)).toBeGreaterThan(0); // a shower mixer at 100 cm is in the way of a head
    const wcOnly = stampFurniture(room(), [itemFromCatalog('wc-western', { cx: 1, cz: 2, w: 0.4, d: 0.72, yawDeg: 0 }, 'virtual')]);
    expect(wcOnly.cells[Math.floor(2 / GRID_CELL_M) * wcOnly.nx + Math.floor(1 / GRID_CELL_M)]).toBe(80);
  });
});

describe('a ceiling-height loft unit', () => {
  it('is made to the ceiling of the home, 4 cm short, and is never "too tall" for it', () => {
    setCatalogCeiling(2.5);
    const it = itemFromCatalog('loft-unit', { cx: 4, cz: 4, w: 1.2, d: 0.55, yawDeg: 0 }, 'virtual');
    expect(it.heightM).toBeCloseTo(2.46, 6);
    expect(it.surfaceHeightM).toBeCloseTo(2.46, 6);
    expect(fullHeightM(2.75)).toBeCloseTo(2.71, 6);
    expect(check('loft-unit', { cx: 4, cz: 4, w: 1.2, d: 0.55, yawDeg: 0 }, 2.35).reason).not.toBe('too-tall');
    setCatalogCeiling(2.7);
  });
});
