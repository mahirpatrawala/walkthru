// The Vastu checklist (SPEC 22.2): each rule's match, mismatch and not-checked cases, the count, the turned north, and the real sample flats.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DEFAULT_FINISHES } from '../src/types';
import type { FurnitureItem, Layout, Opening, RoomTag } from '../src/types';
import { RULES, VASTU_NOTE, bedHeadDir, summaryLine, vastuKind, vastuReport } from '../src/core/vastu';
import type { RuleId } from '../src/core/vastu';
import type { NorthRef } from '../src/core/north';
import { northInScene } from '../src/core/north';
import { validateProperty } from '../src/core/layout-validate';
import { readFacing } from '../src/core/facing';

const N = (deg: number): NorthRef => ({ deg, source: 'builder' });

type Spec = [label: string, type: RoomTag['roomType']];
/** nine 3 x 3 m rooms, north up the page: the keys are where each stands (NW N NE / W C E / SW S SE) */
const GRID: Record<string, [number, number]> = { NW: [0, 0], N: [1, 0], NE: [2, 0], W: [0, 1], C: [1, 1], E: [2, 1], SW: [0, 2], S: [1, 2], SE: [2, 2] };
const GOOD: Record<string, Spec> = {
  NW: ['Toilet 1', 'bathroom'], N: ['Living', 'living'], NE: ['Pooja room', 'other'],
  W: ['Dining', 'living'], C: ['Passage', 'other'], E: ['Study', 'other'],
  SW: ['Master bedroom', 'bedroom'], S: ['Bedroom 2', 'bedroom'], SE: ['Kitchen', 'kitchen'],
};
const door = (id: string, roomId: string, edge: number): Opening => ({ id, roomId, edge, type: 'door', centreM: 1.5, widthM: 1, sillM: 0, headM: 2.1, leaf: { hinge: 'start', swing: 'in', kind: 'hinged' } });
const bed = (id: string, yawDeg: number, label = 'Queen bed'): FurnitureItem => ({ id, source: 'real', kind: 'bed', label, box: { cx: 1.5, cz: 7.5, w: 1.6, d: 2.1, yawDeg }, heightM: 0.9, surfaceHeightM: 0.5 });

interface Build { rooms?: Record<string, Spec | null>; balcony?: boolean; doorOn?: { zone: string; edge: number } | null }
function flat(b: Build = {}): Layout {
  const spec = { ...GOOD, ...(b.rooms ?? {}) };
  const rooms: RoomTag[] = [];
  const ids: Record<string, string> = {};
  for (const [zone, [c, r]] of Object.entries(GRID)) {
    const s = spec[zone];
    const id = s ? s[0].toLowerCase().replace(/\W+/g, '-') + '-' + zone : 'filler-' + zone;
    ids[zone] = id;
    rooms.push({ id, roomType: s ? s[1] : 'other', label: s ? s[0] : 'Room', polygon: [{ x: c * 3, z: r * 3 }, { x: c * 3 + 3, z: r * 3 }, { x: c * 3 + 3, z: r * 3 + 3 }, { x: c * 3, z: r * 3 + 3 }], edges: ['wall', 'wall', 'wall', 'wall'] });
  }
  if (b.balcony !== false) rooms.push({ id: 'balcony', roomType: 'balcony', label: 'Balcony', polygon: [{ x: 9, z: 3 }, { x: 11, z: 3 }, { x: 11, z: 6 }, { x: 9, z: 6 }], edges: ['wall', 'railing', 'wall', 'wall'] });
  const on = b.doorOn === undefined ? { zone: 'N', edge: 0 } : b.doorOn;
  return { wallHeightM: 2.75, wallThicknessM: 0.12, railingHeightM: 1.1, rooms, openings: on ? [door('front', ids[on.zone], on.edge)] : [], finishes: DEFAULT_FINISHES, scaleSource: 'typed-sizes' };
}
const verdicts = (l: Layout, f: FurnitureItem[], n: NorthRef): Record<RuleId, string> => Object.fromEntries(vastuReport(l, f, n)!.results.map((r) => [r.id, r.verdict])) as Record<RuleId, string>;
const HEAD_SOUTH = 180; // a bed faces the way its foot looks: yaw 180 looks up the page (-z), so its head is to the page's bottom, south when north is up

describe('what a room is', () => {
  it('reads the drawing\'s own word first, then the type, and leaves the rest alone', () => {
    expect(vastuKind({ label: 'Master bedroom', roomType: 'bedroom' })).toBe('master-bedroom');
    expect(vastuKind({ label: 'Bedroom 1', roomType: 'bedroom' })).toBe('bedroom');
    expect(vastuKind({ label: 'Servant room', roomType: 'bedroom' })).toBe('other');
    expect(vastuKind({ label: 'Powder toilet', roomType: 'bathroom' })).toBe('toilet');
    expect(vastuKind({ label: 'WC', roomType: 'other' })).toBe('toilet');
    expect(vastuKind({ label: 'Pooja room', roomType: 'other' })).toBe('pooja');
    expect(vastuKind({ label: 'Puja', roomType: 'bedroom' })).toBe('pooja');
    expect(vastuKind({ label: 'Deck', roomType: 'balcony' })).toBe('balcony');
    expect(vastuKind({ label: 'Dining', roomType: 'living' })).toBe('dining');
    expect(vastuKind({ label: 'Living with foyer', roomType: 'living' })).toBe('living');
    expect(vastuKind({ label: 'Room 3', roomType: 'other' })).toBe('other');
  });
});

describe('the checklist', () => {
  it('has the eight starter rules', () => {
    expect(RULES.map((r) => r.id)).toEqual(['main-door', 'kitchen', 'master-bedroom', 'pooja', 'toilets', 'bed-head', 'living', 'balcony']);
  });
  it('a flat that follows every rule matches 8 of 8', () => {
    const r = vastuReport(flat(), [bed('b1', HEAD_SOUTH)], N(0))!;
    expect(r.results.map((x) => `${x.id}:${x.verdict}`)).toEqual(RULES.map((x) => `${x.id}:match`));
    expect(r.matches).toBe(8); expect(r.total).toBe(8); expect(r.mismatches).toEqual([]); expect(r.notChecked).toEqual([]);
    expect(summaryLine(r)).toBe('8 of 8 match');
  });

  describe('main door', () => {
    const sides: [string, number, string][] = [['N', 0, 'match'], ['E', 1, 'match'], ['S', 2, 'mismatch'], ['W', 3, 'mismatch']];
    for (const [name, edge, want] of sides) {
      it(`on the ${name} wall (north up) is a ${want}`, () => {
        const zone = name === 'N' ? 'N' : name === 'E' ? 'E' : name === 'S' ? 'S' : 'W';
        expect(verdicts(flat({ doorOn: { zone, edge }, balcony: false }), [], N(0))['main-door']).toBe(want); // (a door onto a balcony is not the entrance, so none here)
      });
    }
    it('NE is preferred too, W and SW are not', () => {
      // a door on the page's top wall faces north at 0, north-east when north is 45 degrees clockwise of up turned the other way (315), and so on
      expect(verdicts(flat(), [], N(315))['main-door']).toBe('match');   // up the page is then north-east
      expect(verdicts(flat(), [], N(0))['main-door']).toBe('match');
      expect(verdicts(flat(), [], N(180))['main-door']).toBe('mismatch'); // up the page is south
      expect(verdicts(flat(), [], N(90))['main-door']).toBe('mismatch');  // up the page is west
      expect(verdicts(flat(), [], N(225))['main-door']).toBe('mismatch'); // up the page is south-west
    });
    it('is not checked when no door opens to the outside', () => {
      expect(verdicts(flat({ doorOn: null }), [], N(0))['main-door']).toBe('not-checked');
    });
    it('says what it found and what it prefers when it does not match', () => {
      const r = vastuReport(flat({ doorOn: { zone: 'S', edge: 2 } }), [], N(0))!.mismatches.find((x) => x.id === 'main-door')!;
      expect(r.detail).toMatch(/faces south/); expect(r.detail).toMatch(/north, north-east or east/);
    });
  });

  describe('kitchen in the south-east', () => {
    it('matches in the SE', () => expect(verdicts(flat(), [], N(0)).kitchen).toBe('match'));
    it('does not match in the NW', () => {
      expect(verdicts(flat({ rooms: { SE: ['Study', 'other'], NW: ['Kitchen', 'kitchen'] } }), [], N(0)).kitchen).toBe('mismatch');
    });
    it('follows a turned north', () => {
      // north to the page right (90): SE = south + east = page left + page bottom = bottom-left of the page = the room we call SW
      expect(verdicts(flat({ rooms: { SW: ['Kitchen', 'kitchen'], SE: ['Study', 'other'] } }), [], N(90)).kitchen).toBe('match');
    });
    it('is not checked when the flat has no kitchen', () => {
      expect(verdicts(flat({ rooms: { SE: ['Study', 'other'] } }), [], N(0)).kitchen).toBe('not-checked');
    });
  });

  describe('master bedroom in the south-west', () => {
    it('matches in the SW', () => expect(verdicts(flat(), [], N(0))['master-bedroom']).toBe('match'));
    it('does not match elsewhere', () => {
      expect(verdicts(flat({ rooms: { SW: ['Bedroom 2', 'bedroom'], NW: ['Master bedroom', 'bedroom'] } }), [], N(0))['master-bedroom']).toBe('mismatch');
    });
    it('is not checked when no room is named master, even with bedrooms (the kind is not known)', () => {
      expect(verdicts(flat({ rooms: { SW: ['Bedroom 1', 'bedroom'] } }), [], N(0))['master-bedroom']).toBe('not-checked');
    });
  });

  describe('pooja room in the north-east', () => {
    it('matches in the NE', () => expect(verdicts(flat(), [], N(0)).pooja).toBe('match'));
    it('does not match in the SW', () => {
      expect(verdicts(flat({ rooms: { NE: ['Study', 'other'], C: ['Pooja room', 'other'] } }), [], N(0)).pooja).toBe('mismatch');
    });
    it('is not checked when there is no pooja room, which is the usual case', () => {
      expect(verdicts(flat({ rooms: { NE: ['Study', 'other'] } }), [], N(0)).pooja).toBe('not-checked');
    });
  });

  describe('no toilet in the north-east or the centre', () => {
    it('matches with toilets elsewhere', () => expect(verdicts(flat(), [], N(0)).toilets).toBe('match'));
    it('does not match with one in the NE', () => {
      const r = vastuReport(flat({ rooms: { NE: ['Toilet 2', 'bathroom'], N: ['Living', 'living'] } }), [], N(0))!;
      expect(r.results.find((x) => x.id === 'toilets')!.verdict).toBe('mismatch');
      expect(r.results.find((x) => x.id === 'toilets')!.detail).toMatch(/Toilet 2 is in the north-east/);
    });
    it('does not match with one in the centre', () => {
      expect(verdicts(flat({ rooms: { C: ['Toilet 3', 'bathroom'] } }), [], N(0)).toilets).toBe('mismatch');
    });
    it('is not checked when the flat has no toilet', () => {
      expect(verdicts(flat({ rooms: { NW: ['Study 2', 'other'] } }), [], N(0)).toilets).toBe('not-checked');
    });
    it('one bad toilet among good ones is a mismatch that names it', () => {
      const r = vastuReport(flat({ rooms: { C: ['Toilet 3', 'bathroom'] } }), [], N(0))!;
      expect(r.mismatches.find((x) => x.id === 'toilets')!.detail).toMatch(/Toilet 3 is in the centre/);
    });
  });

  describe('bed head to the south or the east', () => {
    it('matches for a head to the south or the east', () => {
      expect(verdicts(flat(), [bed('b', 180)], N(0))['bed-head']).toBe('match'); // head S
      expect(verdicts(flat(), [bed('b', 270)], N(0))['bed-head']).toBe('match'); // front looks west (-x), head east
    });
    it('does not match for a head to the north or the west', () => {
      expect(verdicts(flat(), [bed('b', 0)], N(0))['bed-head']).toBe('mismatch');   // front looks +z (south), head north
      expect(verdicts(flat(), [bed('b', 90)], N(0))['bed-head']).toBe('mismatch');  // front +x (east), head west
    });
    it('one bed against the rule is a mismatch even when another is fine', () => {
      const r = vastuReport(flat(), [bed('a', 180, 'Queen bed'), bed('b', 0, 'Single bed')], N(0))!.results.find((x) => x.id === 'bed-head')!;
      expect(r.verdict).toBe('mismatch'); expect(r.detail).toMatch(/Single bed in Master bedroom: head to the north/);
    });
    it('is not checked when no bed is placed', () => {
      const r = vastuReport(flat(), [], N(0))!;
      expect(r.results.find((x) => x.id === 'bed-head')!.verdict).toBe('not-checked');
      expect(r.matches).toBe(7); // never a miss
      expect(r.mismatches).toEqual([]);
    });
    it('the head follows a turned north', () => {
      expect(bedHeadDir(N(0), bed('b', 180))).toBe('S');
      expect(bedHeadDir(N(90), bed('b', 180))).toBe('E'); // the page's bottom is east when north is the page's right
      expect(bedHeadDir(N(270), bed('b', 180))).toBe('W');
      expect(bedHeadDir(N(0), bed('b', 225))).toBe('SE');
    });
    it('only beds count: other furniture is ignored', () => {
      const sofa: FurnitureItem = { ...bed('s', 0), kind: 'sofa', label: 'Sofa' };
      expect(verdicts(flat(), [sofa], N(0))['bed-head']).toBe('not-checked');
    });
  });

  describe('living room to the north or the east', () => {
    it('matches in the N and in the E', () => {
      expect(verdicts(flat(), [], N(0)).living).toBe('match');
      expect(verdicts(flat({ rooms: { N: ['Study', 'other'], E: ['Living', 'living'] } }), [], N(0)).living).toBe('match');
    });
    it('does not match in the SW', () => {
      expect(verdicts(flat({ rooms: { N: ['Study', 'other'], SW: ['Living', 'living'], W: ['Dining', 'living'] } }), [], N(0)).living).toBe('mismatch');
    });
    it('a dining room is not a living room', () => {
      expect(verdicts(flat({ rooms: { N: ['Dining', 'living'] } }), [], N(0)).living).toBe('not-checked');
    });
    it('is not checked when no room is a living room', () => {
      expect(verdicts(flat({ rooms: { N: ['Study', 'other'] } }), [], N(0)).living).toBe('not-checked');
    });
  });

  describe('balcony to the north or the east', () => {
    it('matches on the east side', () => expect(verdicts(flat(), [], N(0)).balcony).toBe('match'));
    it('does not match when north turns it to the south side', () => {
      expect(verdicts(flat(), [], N(180)).balcony).toBe('mismatch'); // east of the page is then west
    });
    it('is not checked in a flat with no balcony', () => {
      expect(verdicts(flat({ balcony: false }), [], N(0)).balcony).toBe('not-checked');
    });
  });

  it('a not-checked rule is never counted as a miss: the count and the lists agree', () => {
    const bare = flat({ rooms: { NE: ['Study', 'other'], SW: ['Bedroom 1', 'bedroom'], SE: ['Study 2', 'other'] }, balcony: false, doorOn: null });
    const r = vastuReport(bare, [], N(0))!;
    expect(r.notChecked.map((x) => x.id).sort()).toEqual(['balcony', 'bed-head', 'kitchen', 'main-door', 'master-bedroom', 'pooja']);
    expect(r.matches + r.mismatches.length + r.notChecked.length).toBe(r.total);
    expect(r.mismatches.every((x) => x.verdict === 'mismatch')).toBe(true);
    expect(r.matches).toBe(2); // toilet and living room
  });

  it('a turned north changes the answers (the same flat, read four ways)', () => {
    const l = flat();
    const out = [0, 90, 180, 270].map((d) => vastuReport(l, [], N(d))!.matches);
    expect(new Set(out).size).toBeGreaterThan(1);
  });

  it('is null for a layout with no rooms and carries a plain note, never a score of luck', () => {
    expect(vastuReport({ ...flat(), rooms: [], openings: [] }, [], N(0))).toBeNull();
    expect(VASTU_NOTE).toMatch(/traditional/i);
    expect(VASTU_NOTE).toMatch(/not advice about luck/i);
  });
});

describe('the sample tower\'s flats, read as the building puts them (north up the plate)', () => {
  const scene = (id: string): Layout => validateProperty(JSON.parse(fs.readFileSync(`public/scenes/test-tower-flat-${id}/property.json`, 'utf8'))).layout;
  // the placement on the typical floor (public/buildings/sample-tower/building.json) and what the building's own text says the flat's balcony side faces
  const FLATS: [string, number, string, string][] = [['2bhk-b4', 270, 'E', 'east'], ['2bhk-b2', 270, 'E', 'east'], ['3bhk-b', 90, 'W', 'west'], ['3bhk-a', 180, 'N', 'north']];
  for (const [id, rot, face, word] of FLATS) {
    it(`${id} on a plate with north up: the balcony faces ${word}, as the building file says`, () => {
      const n = northInScene(N(0), rot);
      const reading = readFacing(scene(id), n)!;
      const balc = reading.rooms.find((r) => r.roomType === 'balcony')!;
      expect(balc.facing).toBe(face);
      expect(reading.mainDoor).not.toBeNull();
    });
  }
  it('every flat gets a full report with no rule left unexplained', () => {
    for (const [id, rot] of FLATS) {
      const l = scene(id);
      const fur = validateProperty(JSON.parse(fs.readFileSync(`public/scenes/test-tower-flat-${id}/property.json`, 'utf8'))).furniture;
      const r = vastuReport(l, fur, northInScene(N(0), rot))!;
      expect(r.total).toBe(8);
      expect(r.matches + r.mismatches.length + r.notChecked.length).toBe(8);
      for (const x of r.results) expect(x.detail.length).toBeGreaterThan(5);
    }
  });
});
