// The building map's in-room labels (SPEC 18.7): a label is fitted to its room's inner span by one rule, in a polygon at the roomiest point, and a room it does not
// fit has no label (the side list still names it). The start-page card caps its amenity list.
import { describe, expect, it } from 'vitest';
import { amenityLine } from '../src/building/index-entry';
import { fitLabel, levelPlan, placeLabel, rectInPolygon, wrapName, LABEL_FILL } from '../src/building/level-plan';
import { roomsOnLevel } from '../src/building/geom';
import { readBuilding, readScene } from './helpers/sample-building';

describe('fitLabel: shrink to the room, wrap, drop the area before the name, then show nothing', () => {
  const MAX = 2, MIN = 0.8;
  it('a roomy room gets the name and the area at the full size', () => {
    const f = fitLabel('Gymnasium', ['1,621 sq ft'], 16, 9.5, MAX, MIN)!;
    expect(f.lines).toEqual(['Gymnasium', '1,621 sq ft']);
    expect(f.sizeM).toBe(MAX);
  });
  it('a narrower room gets a smaller type on the same lines, never below the floor', () => {
    const wide = fitLabel('Banquet hall 1', ['766 sq ft'], 12, 8, MAX, MIN)!;
    const narrow = fitLabel('Banquet hall 1', ['766 sq ft'], 8.6, 8.3, MAX, MIN)!;
    expect(narrow.sizeM).toBeLessThan(wide.sizeM);
    expect(narrow.sizeM).toBeGreaterThanOrEqual(MIN);
    expect(narrow.lines).toEqual(['Banquet hall 1', '766 sq ft']);
  });
  it('wraps the name over two lines where that is what lets it fit, keeping the area', () => {
    const f = fitLabel('Changing room 1', ['195 sq ft'], 6.6, 3.6, MAX, MIN)!;
    expect(f.nameLines).toBe(2);
    expect(f.lines).toEqual(['Changing', 'room 1', '195 sq ft']);
  });
  it('drops the area before it drops the name', () => {
    const f = fitLabel('Changing room 1', ['195 sq ft'], 6.6, 2.8, MAX, MIN)!;
    expect(f.lines).toEqual(['Changing', 'room 1']);
    const g = fitLabel('Gymnasium', ['1,621 sq ft'], 8, 1.6, MAX, MIN)!;
    expect(g.lines).toEqual(['Gymnasium']);
  });
  it('a flat\'s type goes with the area: both go before the name', () => {
    expect(fitLabel('Flat 203', ['2 BHK (A)', '728 sq ft carpet'], 30, 20, MAX, MIN)!.lines).toEqual(['Flat 203', '2 BHK (A)', '728 sq ft carpet']);
    expect(fitLabel('Flat 203', ['2 BHK (A)', '728 sq ft carpet'], 30, 2.0, MAX, MIN)!.lines).toEqual(['Flat 203']);
  });
  it('when even the bare name does not fit at the floor there is no label', () => {
    expect(fitLabel('Clubhouse foyer', ['1,370 sq ft'], 2.0, 4, MAX, MIN)).toBeNull();
    expect(fitLabel('Banquet deck', ['933 sq ft'], 3.4, 25, MAX, MIN)).toBeNull();
  });
  it('whatever it returns fits inside 90 % of the room\'s span and is never bigger than the cap', () => {
    for (const [w, h] of [[2, 2], [3.4, 25], [6.6, 2.8], [8, 8], [15, 9], [40, 30]] as const) for (const name of ['Pool area', 'Link passage', 'Banquet hall 2', 'Clubhouse foyer']) {
      const f = fitLabel(name, ['701 sq ft'], w, h, MAX, MIN);
      if (!f) continue;
      expect(f.widthM, `${name} ${w}x${h}`).toBeLessThanOrEqual(w * LABEL_FILL + 1e-9);
      expect(f.heightM, `${name} ${w}x${h}`).toBeLessThanOrEqual(h * LABEL_FILL + 1e-9);
      expect(f.sizeM).toBeLessThanOrEqual(MAX);
    }
  });
  it('wraps a name at the space nearest its middle, and a one-word name does not wrap', () => {
    expect(wrapName('Banquet hall 1')).toEqual(['Banquet', 'hall 1']);
    expect(wrapName('Gymnasium')).toBeNull();
  });
});

describe('placeLabel: the label\'s own box must lie inside the room\'s outline, at the roomiest point that holds it', () => {
  const L = [{ x: 0, z: 0 }, { x: 14, z: 0 }, { x: 14, z: 3 }, { x: 5, z: 3 }, { x: 5, z: 20 }, { x: 0, z: 20 }];
  it('a rectangle is labelled in its middle', () => {
    const R = [{ x: 0, z: 0 }, { x: 16, z: 0 }, { x: 16, z: 10 }, { x: 0, z: 10 }];
    const p = placeLabel(R, 'Gymnasium', ['1,621 sq ft'], 2, 0.8)!;
    expect(p.x).toBeCloseTo(8, 0);
    expect(p.z).toBeCloseTo(5, 0);
  });
  it('an L-shaped room is labelled in an arm that holds the box, and the box lies wholly inside the outline', () => {
    const p = placeLabel(L, 'Pool area', ['7,208 sq ft'], 2, 0.8)!;
    expect(p).not.toBeNull();
    expect(rectInPolygon(L, p.x, p.z, p.widthM / LABEL_FILL, p.heightM / LABEL_FILL)).toBe(true);
    // a box as wide as the room's bounding box does not lie inside the L
    expect(rectInPolygon(L, 7, 10, 12, 2)).toBe(false);
    expect(rectInPolygon(L, 2.5, 10, 3, 2)).toBe(true);
  });
  it('a room that is only a narrow passage has no label', () => {
    expect(placeLabel([{ x: 0, z: 0 }, { x: 25, z: 0 }, { x: 25, z: 0.9 }, { x: 0, z: 0.9 }], 'Link passage', ['701 sq ft'], 2, 0.8)).toBeNull();
  });
});

describe('the Level 1 plan of the sample tower', () => {
  const b = readBuilding('sample-tower');
  const lv = b.levels.find((l) => l.id === 'l1')!;
  const scenes = new Map([...new Set(lv.spaces.map((s) => s.sceneId))].map((id) => [id, { property: readScene(id)!, unverified: {} as Record<string, string> }]));
  const plan = levelPlan(b, lv, scenes, { idPrefix: 't' });
  it('every label that is drawn lies inside its room\'s outline, and the rooms it does not fit have none (they are in the side list)', () => {
    expect(plan.labels.length).toBeGreaterThan(5);
    for (const l of plan.labels) {
      const sp = lv.spaces.find((x) => x.id === l.spaceId)!;
      const rooms = roomsOnLevel(scenes.get(sp.sceneId)!.property.layout, sp.placement);
      expect(rooms.some((r) => rectInPolygon(r.polygon, l.x, l.z, l.widthM / LABEL_FILL, l.heightM / LABEL_FILL)), `${l.spaceId}: ${l.lines.join(' / ')}`).toBe(true);
      expect(l.sizeM).toBeGreaterThan(0.5);
    }
    const drawn = new Set(plan.labels.map((l) => l.spaceId));
    expect(drawn.size).toBeLessThan(lv.spaces.length);
    expect(drawn.has('gym') && drawn.has('games') && drawn.has('hall-1') && drawn.has('pool') && drawn.has('aqua')).toBe(true);
    // the narrow strip of the deck and the foyer's passages carry no label
    expect(drawn.has('deck')).toBe(false);
    expect(plan.svg.match(/class="bm-label"/g)!.length).toBe(plan.labels.length);
  });
  it('the label of a room whose wrapped name is two lines is drawn as two name lines', () => {
    const c = plan.labels.find((l) => l.spaceId === 'changing-1');
    if (c) expect(c.lines.slice(0, 2).join(' ')).toBe('Changing room 1');
  });
});

describe('the start-page card\'s amenity list', () => {
  it('names the first few and says how many more', () => {
    expect(amenityLine(['A', 'B', 'C'])).toBe('A, B, C');
    expect(amenityLine(['A', 'B', 'C', 'D'])).toBe('A, B, C, D');
    expect(amenityLine(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B, C, D and 2 more');
    expect(amenityLine(['A', 'B', 'C', 'D', 'E', 'F'], 2)).toBe('A, B and 4 more');
  });
});
