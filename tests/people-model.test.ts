// People a buyer adds (src/buyer/people): the rules, with no page. Caps per tier, body widths, where a person may stand, how a second person
// sits and lies, the same poses as the walker's at any height, the pass-width card from real widths, and how people travel in "My layout".
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { stampFurniture, rasterizeLayout } from '../src/core/layout-raster';
import { circleFree, moveCircle } from '../src/core/grid-query';
import { cellValue } from '../src/core/grid-codec';
import { liePose, seatPose } from '../src/core/poses';
import { boxAxes } from '../src/core/geometry';
import { CHARACTER_RADIUS_M, GRID_FREE } from '../src/types';
import type { Box, FurnitureItem } from '../src/types';
import { createFurnitureStore } from '../src/buyer/store';
import type { StorageLike } from '../src/buyer/store';
import { decodeLayout, emptyLayout, encodeLayout, isEmptyLayout, mineKey, parseMine, serializeMine } from '../src/buyer/my-layout';
import { emptyFittings } from '../src/look/fittings';
import { PEOPLE_MAX, peopleFromWire, peopleToWire, sanitizeRec, sanitizeRecs } from '../src/buyer/people/rec';
import type { PersonRec } from '../src/buyer/people/rec';
import {
  PASS_COMFORT_M, TIER_CAP, capForTier, carryApproach, fitLine, freeApproach, hostAt, hostPose, hostSignature, nearestHost, nudgeAside, obstaclesOf, passCard,
  passVerdict, passageWidth, placeStanding, shoulderWidthM, shownCount, spotLateral, standBox,
} from '../src/buyer/people/model';
import { peopleNote } from '../src/buyer/people/ui';
import { freeAngleRad } from '../src/buyer/wardrobe-swing';
import type { Shutter } from '../src/buyer/wardrobe-swing';
import { setExtraObstacles, withExtraObstacles } from '../src/buyer/wardrobe-hooks';
import { SIT_HIP_BACK_RATIO } from '../src/types';

const furnished = buildTruthProperty('furnished');
const empty = buildTruthProperty('empty');
const bed = furnished.furniture.find((f) => f.kind === 'bed')!;
const sofa = furnished.furniture.find((f) => f.kind === 'sofa')!;
const baseGrid = rasterizeLayout(empty.layout);
const withFurniture = stampFurniture(baseGrid, furnished.furniture);

const rec = (over: Partial<PersonRec> = {}): PersonRec => ({ id: 'pe-1', body: 'woman', tone: 2, heightCm: 160, x: 2.6, z: 1.2, yawDeg: 0, pose: 'stand', ...over });
function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k) => (data.has(k) ? data.get(k)! : null), setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

describe('how many people a device holds', () => {
  it('is fewer on a small device, and never above the layout maximum', () => {
    expect(TIER_CAP).toEqual({ low: 2, medium: 3, high: 5 });
    expect(PEOPLE_MAX).toBe(5);
    expect(capForTier('low')).toBeLessThan(capForTier('medium'));
    expect(capForTier('medium')).toBeLessThan(capForTier('high'));
  });
  it('draws the first people and keeps the rest', () => {
    expect(shownCount(5, 'low')).toBe(2);
    expect(shownCount(5, 'medium')).toBe(3);
    expect(shownCount(5, 'high')).toBe(5);
    expect(shownCount(1, 'low')).toBe(1);
  });
  it('the rooms sheet says how many were added, and how many this device does not show', () => {
    expect(peopleNote(0, 0)).toBeNull();
    expect(peopleNote(1, 1)).toBe('1 person added by you. Not part of the home.');
    expect(peopleNote(4, 4)).toBe('4 people added by you. Not part of the home.');
    expect(peopleNote(5, 2)).toBe('5 people added by you. Not part of the home. 3 not shown on this device.');
  });
});

describe('body widths come from real proportions', () => {
  it('a person is as wide across the shoulders as their height says', () => {
    expect(shoulderWidthM('man', 175)).toBeCloseTo(0.429, 2);
    expect(shoulderWidthM('woman', 160)).toBeCloseTo(0.36, 2);
    expect(shoulderWidthM('child', 120)).toBeCloseTo(0.258, 2);
    expect(shoulderWidthM('man', 200)).toBeGreaterThan(shoulderWidthM('man', 150));
  });
  it('a standing person is a box of shoulder width, turned as they stand', () => {
    const b = standBox(rec({ body: 'man', heightCm: 175, x: 1, z: 2, yawDeg: 30 }));
    expect(b.w).toBeCloseTo(0.429, 2);
    expect(b.d).toBeGreaterThan(0.2);
    expect(b.d).toBeLessThan(b.w);
    expect(b.yawDeg).toBe(30);
    expect([b.cx, b.cz]).toEqual([1, 2]);
  });
  it('only standing people add obstacles: someone sitting or lying is on a piece that already blocks', () => {
    const o = obstaclesOf([rec(), rec({ id: 'pe-2', pose: 'sit', host: 'sofa-1' }), rec({ id: 'pe-3', pose: 'lie', host: 'bed-1' })]);
    expect(o).toHaveLength(1);
    expect(o[0].heightM).toBeCloseTo(1.6, 6);
  });
});

describe('where a person may stand', () => {
  const ctx = { grid: withFurniture, others: [] as PersonRec[] };
  it('free floor: the tapped spot', () => {
    const r = placeStanding(ctx, { body: 'woman', heightCm: 160 }, { x: 2.6, z: 1.2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.at).toEqual({ x: 2.6, z: 1.2 });
  });
  it('not inside a wall, and not on furniture', () => {
    expect(placeStanding(ctx, { body: 'woman', heightCm: 160 }, { x: -0.5, z: 1.2 }).ok).toBe(false);
    const onBed = placeStanding(ctx, { body: 'woman', heightCm: 160 }, { x: 1.0, z: 2.25 });
    expect(onBed.ok).toBe(false);
    if (!onBed.ok) expect(onBed.reason).toBe('blocked');
  });
  it('a spot just beside a wall is nudged out of it, within 30 cm, and no further', () => {
    const r = placeStanding(ctx, { body: 'man', heightCm: 175 }, { x: 0.05, z: 1.0 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.at.x).toBeGreaterThanOrEqual(0.2); expect(Math.hypot(r.at.x - 0.05, r.at.z - 1.0)).toBeLessThanOrEqual(0.3 + 1e-9); }
    expect(placeStanding(ctx, { body: 'man', heightCm: 175 }, { x: -0.4, z: 1.0 }).ok).toBe(false);
  });
  it('not on another person, and not on the walker', () => {
    const other = rec({ x: 2.6, z: 1.2 });
    const p = placeStanding({ ...ctx, others: [other] }, { body: 'man', heightCm: 175 }, { x: 2.7, z: 1.2 });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toBe('person');
    const apart = placeStanding({ ...ctx, others: [other] }, { body: 'man', heightCm: 175 }, { x: 3.4, z: 1.2 });
    expect(apart.ok).toBe(true);
    const w = placeStanding({ ...ctx, walker: { x: 2.7, z: 1.2 } }, { body: 'man', heightCm: 175 }, { x: 2.6, z: 1.2 });
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.reason).toBe('walker');
  });
  it('not inside a door or a wardrobe swing, and the reason is the swing sentence', () => {
    const swing = (b: Box): string | null => (b.cz > 4.4 ? 'Blocks the Bedroom door from opening.' : null);
    const r = placeStanding({ ...ctx, swingNote: swing }, { body: 'woman', heightCm: 160 }, { x: 1.0, z: 4.6 });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('swing'); expect(r.message).toContain('Blocks the Bedroom door from opening.'); }
  });
  it('a person caught under a new piece is moved to the nearest free floor, or none', () => {
    const under = rec({ x: 1.0, z: 2.25 });
    const free = nudgeAside(withFurniture, under);
    expect(free).not.toBeNull();
    expect(circleFree(withFurniture, free!.x, free!.z, shoulderWidthM('woman', 160) / 2)).toBe(true);
    expect(nudgeAside(withFurniture, rec({ x: -2, z: 2 }), 0.4)).toBeNull();
  });
});

describe('a person is a body in the walk path, and the home as drawn is not touched', () => {
  const people = [rec({ x: 2.6, z: 1.2, body: 'man', heightCm: 175 })];
  const stamped = stampFurniture(withFurniture, obstaclesOf(people).map((o, i) => ({ id: `p${i}`, source: 'virtual' as const, kind: 'wardrobe' as const, label: 'p', box: o.box, heightM: o.heightM, surfaceHeightM: o.heightM })));
  it('the walker cannot pass through a standing person', () => {
    const from = { x: 1.8, z: 1.2 };
    const free = moveCircle(withFurniture, from, { x: 1.6, z: 0 }, CHARACTER_RADIUS_M);
    expect(free.x).toBeCloseTo(3.4, 1);
    const blocked = moveCircle(stamped, from, { x: 1.6, z: 0 }, CHARACTER_RADIUS_M);
    expect(blocked.x).toBeLessThan(2.6 - 0.2);
    expect(blocked.x).toBeGreaterThan(2.0);
  });
  it('the layout grid keeps its own cells: stamping people copies, it does not write into it', () => {
    expect(cellValue(withFurniture, 2.6, 1.2)).toBe(GRID_FREE);
    expect(cellValue(stamped, 2.6, 1.2)).toBeGreaterThan(0);
    expect(cellValue(baseGrid, 2.6, 1.2)).toBe(GRID_FREE);
  });
  it('through the store: a person is a temporary obstacle, absent from the grid of the home as drawn', () => {
    const store = createFurnitureStore({ sceneId: 't', baseGrid, initial: furnished.furniture, parent: new THREE.Group(), storage: fakeStorage(), saveDelayMs: 0 });
    const drawnBefore = store.drawnGrid().cells.slice();
    store.setTemporary('people', obstaclesOf(people));
    expect(cellValue(store.grid(), 2.6, 1.2)).toBeGreaterThan(0);
    expect(store.all().map((i) => i.id).sort()).toEqual(['bed-1', 'sofa-1']);
    expect(Array.from(store.drawnGrid().cells)).toEqual(Array.from(drawnBefore));
    expect(cellValue(store.gridExcludingTemporary(['people']), 2.6, 1.2)).toBe(GRID_FREE);
    store.setTemporary('people', []);
    expect(cellValue(store.grid(), 2.6, 1.2)).toBe(GRID_FREE);
  });
});

describe('sitting and lying: the walker\'s own poses, at the person\'s own size', () => {
  const bedItem: FurnitureItem = { ...bed };
  it('the same pose function gives each height its own place on the same piece', () => {
    const grandma = hostPose(sofa, 'sit', 150, { x: 3.5, z: 3.5 });
    const tall = hostPose(sofa, 'sit', 190, { x: 3.5, z: 3.5 });
    const H = [1.5, 1.9];
    // hips sit SIT_HIP_BACK_RATIO * height ahead of the seat-back line: a taller person's root is further out
    expect(grandma.sit).toEqual(seatPose(sofa, H[0], { x: 3.5, z: 3.5 }));
    expect(tall.sit).toEqual(seatPose(sofa, H[1], { x: 3.5, z: 3.5 }));
    const { a } = boxAxes(sofa.box);
    const out = (p: { root: { x: number; z: number } }): number => (p.root.x - sofa.box.cx) * a.x + (p.root.z - sofa.box.cz) * a.z;
    expect(out(tall.sit!) - out(grandma.sit!)).toBeCloseTo(SIT_HIP_BACK_RATIO * (H[1] - H[0]), 6);
    expect(tall.sit!.rootY).toBeLessThan(grandma.sit!.rootY); // longer legs, hips lower over the same seat
  });
  it('lying: head at the head end, the feet one height away', () => {
    for (const cm of [120, 150, 175, 190]) {
      const p = hostPose(bedItem, 'lie', cm, { x: 1.0, z: 2.25 }).lie!;
      expect(p).toEqual(liePose(bedItem, cm / 100, { x: 1.0, z: 2.25 }));
    }
    const short = hostPose(bedItem, 'lie', 120, { x: 1, z: 2.25 }).lie!;
    const long = hostPose(bedItem, 'lie', 175, { x: 1, z: 2.25 }).lie!;
    expect(Math.hypot(long.feet.x - short.feet.x, long.feet.z - short.feet.z)).toBeCloseTo(0.55, 6);
    // someone nearly as long as the mattress lies a little higher up it, so their feet end at its foot and not past it
    const tall = hostPose(bedItem, 'lie', 190, { x: 1, z: 2.25 }).lie!;
    expect(Math.hypot(tall.feet.x - short.feet.x, tall.feet.z - short.feet.z)).toBeCloseTo(0.675, 6);
  });
  it('the card line says how they fit the piece, in the third person', () => {
    expect(fitLine(bedItem, 'lie', 150)).toBe('Bed · 200 cm long. 50 cm to spare.');
    expect(fitLine(bedItem, 'lie', 199)).toContain('Tight');
    expect(fitLine(bedItem, 'lie', 210)).toContain('Feet hang 10 cm over the end');
    expect(fitLine(sofa, 'sit', 150)).not.toMatch(/\b(your|you)\b/i);
  });
  it('a piece with no label is named by what it is', () => {
    expect(fitLine({ ...bed, label: '' }, 'lie', 150)).toMatch(/^Bed · /);
  });
});

describe('a second person on the same piece', () => {
  const double: FurnitureItem = { ...bed, box: { ...bed.box, w: 1.5 }, inner: undefined };
  const single: FurnitureItem = { ...bed, id: 'bed-s', box: { ...bed.box, w: 0.9 } };
  it('takes the other half of a double bed, and a third finds it full', () => {
    const first = freeApproach(double, 'lie', { x: 1.0, z: 2.0 }, [])!;
    const lat1 = spotLateral(double, 'lie', first);
    expect(Math.abs(lat1)).toBeCloseTo(double.box.w / 4, 6);
    const second = freeApproach(double, 'lie', { x: 1.0, z: 2.0 }, [lat1])!;
    expect(second).not.toBeNull();
    expect(spotLateral(double, 'lie', second)).toBeCloseTo(-lat1, 6);
    expect(freeApproach(double, 'lie', { x: 1.0, z: 2.0 }, [lat1, -lat1])).toBeNull();
  });
  it('a single bed takes one', () => {
    const first = freeApproach(single, 'lie', { x: 1.0, z: 2.25 }, [])!;
    expect(first).not.toBeNull();
    expect(freeApproach(single, 'lie', { x: 1.0, z: 2.25 }, [spotLateral(single, 'lie', first)])).toBeNull();
  });
  it('a sofa seats as many as its width says, at least half a metre apart', () => {
    const taken: number[] = [];
    let seated = 0;
    for (let i = 0; i < 6; i++) {
      const a = freeApproach(sofa, 'sit', { x: sofa.box.cx, z: sofa.box.cz }, taken);
      if (!a) break;
      taken.push(spotLateral(sofa, 'sit', a));
      seated++;
    }
    expect(seated).toBeGreaterThanOrEqual(2);
    expect(seated).toBeLessThanOrEqual(Math.floor(sofa.box.w / 0.6));
    for (let i = 0; i < taken.length; i++) for (let j = i + 1; j < taken.length; j++) expect(Math.abs(taken[i] - taken[j])).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });
  it('a chair seats one', () => {
    const chair: FurnitureItem = { ...sofa, id: 'seat:c', box: { ...sofa.box, w: 0.5, d: 0.5 } };
    const a = freeApproach(chair, 'sit', { x: chair.box.cx, z: chair.box.cz }, [], true)!;
    expect(a).not.toBeNull();
    expect(freeApproach(chair, 'sit', { x: chair.box.cx, z: chair.box.cz }, [spotLateral(chair, 'sit', a, true)], true)).toBeNull();
  });
});

describe('finding the piece a tap or a person is at', () => {
  const items = [bed, sofa, { ...bed, id: 'wardrobe-1', kind: 'wardrobe' as const, box: { cx: 3, cz: 0.5, w: 1.8, d: 0.6, yawDeg: 0 } }];
  it('a tap on the bed or the sofa finds it; a wardrobe or the floor finds nothing', () => {
    expect(hostAt({ x: 1.0, z: 2.25 }, items)?.id).toBe('bed-1');
    expect(hostAt({ x: 3.55, z: 3.5 }, items)?.id).toBe('sofa-1');
    expect(hostAt({ x: 3.0, z: 0.5 }, items)).toBeNull();
    expect(hostAt({ x: 2.2, z: 0.4 }, items)).toBeNull();
  });
  it('the nearest sofa or bed within reach, but not through a wall', () => {
    expect(nearestHost({ x: 2.6, z: 3.0 }, 'sit', items, withFurniture, 2)?.id).toBe('sofa-1');
    expect(nearestHost({ x: 2.6, z: 3.0 }, 'lie', items, withFurniture, 2)?.id).toBe('bed-1');
    expect(nearestHost({ x: 2.6, z: 0.4 }, 'sit', items, withFurniture, 1)).toBeNull();
    expect(nearestHost({ x: 2.0, z: 6.0 }, 'lie', items, withFurniture, 4)).toBeNull(); // the passage: a wall between
  });
  it('a pose follows its piece when the piece moves or turns', () => {
    const from: Box = { cx: 1, cz: 2, w: 1.5, d: 2, yawDeg: 0 };
    const p = { x: 1.3, z: 2.6 };
    const same = carryApproach(p, from, from);
    expect(same.x).toBeCloseTo(p.x, 9); expect(same.z).toBeCloseTo(p.z, 9);
    const moved = carryApproach(p, from, { ...from, cx: 3, cz: 1 });
    expect(moved).toEqual({ x: 3.3, z: 1.6 });
    const turned = carryApproach(p, from, { ...from, yawDeg: 90 });
    expect(turned.x).toBeCloseTo(1 + 0.6, 6);
    expect(turned.z).toBeCloseTo(2 - 0.3, 6);
    expect(hostSignature(bed)).not.toBe(hostSignature({ ...bed, box: { ...bed.box, cx: bed.box.cx + 0.1 } }));
    expect(hostSignature(bed)).toBe(hostSignature({ ...bed }));
  });
});

describe('two people in a narrow place', () => {
  it('the verdict comes from the two shoulder widths and the passage', () => {
    const a = 0.43, b = 0.36;
    expect(passVerdict(a + b + PASS_COMFORT_M, a, b).verdict).toBe('can');
    expect(passVerdict(a + b + PASS_COMFORT_M - 0.01, a, b).verdict).toBe('tight');
    expect(passVerdict(a + b, a, b).verdict).toBe('tight');
    expect(passVerdict(a + b - 0.01, a, b).verdict).toBe('cannot');
    // the same passage suits a man and a child where it does not suit two men
    const w = 0.8;
    expect(passVerdict(w, shoulderWidthM('man', 175), shoulderWidthM('child', 110)).verdict).toBe('can');
    expect(passVerdict(w, shoulderWidthM('man', 175), shoulderWidthM('man', 190)).verdict).toBe('cannot');
  });
  it('the card names the numbers and the verdict', () => {
    const can = passCard('You', 'Woman', 0.95, 0.43, 0.36);
    expect(can.tone).toBe('good');
    expect(can.headline).toBe('Two people can pass here.');
    expect(can.lines[0]).toBe('Passage 95 cm wide.');
    expect(can.lines[1]).toBe('You 43 cm + Woman 36 cm = 79 cm of shoulders.');
    const tight = passCard('You', 'Woman', 0.84, 0.43, 0.36);
    expect(tight.tone).toBe('warn');
    expect(tight.headline).toMatch(/^Tight/);
    const no = passCard('You', 'Man', 0.7, 0.43, 0.43);
    expect(no.tone).toBe('bad');
    expect(no.headline).toBe('Two people cannot pass here.');
    expect(no.lines.join(' ')).toContain('16 cm short');
    expect(no.footer).toMatch(/typical/);
  });
  it('says so when the walking controls need more floor than two real bodies do', () => {
    const c = passCard('You', 'Child', 0.695, 0.43, 0.26);
    expect(c.lines.join(' ')).toMatch(/44 cm of clear floor/);
  });
  it('the passage is measured across the way they face, on the plan with nobody in it', () => {
    // the bedroom's passage strip is 1.2 m wide (z 5.12 to 6.32): a person in it, walker coming along x
    const w = passageWidth(baseGrid, { x: 2.0, z: 5.72 }, { x: 1, z: 0 });
    expect(w).not.toBeNull();
    expect(w!).toBeGreaterThan(1.1);
    expect(w!).toBeLessThan(1.3);
    // in the middle of a big room it is open floor, not a passage
    expect(passageWidth(baseGrid, { x: 2.0, z: 2.5 }, { x: 1, z: 0 })).toBeNull();
  });
});

describe('people travel in My layout', () => {
  const people: PersonRec[] = [
    rec({ id: 'pe-1', body: 'man', tone: 3, heightCm: 182, x: 2.6, z: 1.2, yawDeg: 123.4 }),
    rec({ id: 'pe-2', body: 'elder', tone: 1, heightCm: 150, x: 3.55, z: 3.2, yawDeg: 270, pose: 'sit', host: 'sofa-1' }),
    rec({ id: 'pe-3', body: 'child', tone: 0, heightCm: 120, x: 0.5, z: 2.0, pose: 'lie', host: 'bed-1' }),
  ];
  const originals = new Map(furnished.furniture.map((i) => [i.id, i]));
  it('a layout with only people is a layout (the chip says edited, the link carries it)', () => {
    expect(isEmptyLayout({ ...emptyLayout(), people })).toBe(false);
    expect(isEmptyLayout({ ...emptyLayout(), people: [] })).toBe(true);
    expect(isEmptyLayout(emptyLayout())).toBe(true);
  });
  it('round trip: who they are, how tall, where and how they are posed', () => {
    const code = encodeLayout({ ...emptyLayout(), people })!;
    const back = decodeLayout(code, originals)!.people!;
    expect(back).toHaveLength(3);
    expect(back[0]).toMatchObject({ body: 'man', tone: 3, heightCm: 182, pose: 'stand' });
    expect(back[0].x).toBeCloseTo(2.6, 2); expect(back[0].yawDeg).toBeCloseTo(123.4, 1);
    expect(back[1]).toMatchObject({ body: 'elder', heightCm: 150, pose: 'sit', host: 'sofa-1' });
    expect(back[2]).toMatchObject({ body: 'child', heightCm: 120, pose: 'lie', host: 'bed-1' });
  });
  it('a person on a piece the viewer added is carried by its place in the link, and follows it to its new id', () => {
    const added: FurnitureItem[] = [{ ...sofa, id: 'mine-7', source: 'virtual', catalogId: 'sofa-3' }];
    const code = encodeLayout({ ...emptyLayout(), added, people: [rec({ pose: 'sit', host: 'mine-7' })] })!;
    const back = decodeLayout(code, originals)!;
    expect(back.added).toHaveLength(1);
    expect(back.people![0].host).toBe(back.added[0].id);
  });
  it('a person on a piece that cannot be shared stands instead', () => {
    const noCatalogue: FurnitureItem[] = [{ ...sofa, id: 'mine-7', source: 'virtual' }];
    const code = encodeLayout({ ...emptyLayout(), added: noCatalogue, people: [rec({ pose: 'sit', host: 'mine-7' })] })!;
    expect(decodeLayout(code, originals)!.people![0].pose).toBe('stand');
  });
  it('a link made before people existed still opens, with none', () => {
    const old = `1.${btoa(JSON.stringify({ r: [] })).replace(/=+$/, '')}`;
    expect(decodeLayout(old, originals)).toBeNull();
    const oldRemoved = encodeLayout({ ...emptyLayout(), removed: ['bed-1'] })!;
    const l = decodeLayout(oldRemoved, originals)!;
    expect(l.removed).toEqual(['bed-1']);
    expect(l.people).toBeUndefined();
  });
  it('version 2 carries everything together: removed, moved, fittings, added pieces, looks and people; Reset clears all', () => {
    const added: FurnitureItem[] = [{ ...sofa, id: 'mine-1', source: 'virtual', catalogId: 'sofa-3' }];
    const whole = {
      ...emptyLayout(), removed: [], finishes: { 'sofa-1': { fabric: 'fab-grey' } }, added,
      moved: { 'bed-1': { cx: 1.1, cz: 2.3, yawDeg: 90, w: 1.5, d: 2.0, heightM: 0.55, surfaceHeightM: 0.55 } },
      fittings: { removed: ['fan-1'], moved: { 'chair:c1': { m: 'f' as const, x: 2, z: 3, yawDeg: 10 } }, sized: {} },
      people: [rec({ pose: 'sit', host: 'mine-1', x: 3.5, z: 3.5 }), rec({ id: 'pe-2', body: 'man', heightCm: 180 })],
    };
    const code = encodeLayout(whole)!;
    expect(code.startsWith('2.')).toBe(true);
    const back = decodeLayout(code, originals)!;
    expect(back.finishes).toEqual({ 'sofa-1': { fabric: 'fab-grey' } });
    expect(Object.keys(back.moved)).toEqual(['bed-1']);
    expect(back.fittings.removed).toEqual(['fan-1']);
    expect(Object.keys(back.fittings.moved)).toEqual(['chair:c1']);
    expect(back.added).toHaveLength(1);
    expect(back.people).toHaveLength(2);
    expect(back.people![0].host).toBe(back.added[0].id);
    // each part is its own field: the people are `h`, the moved originals still `p`
    const wire = JSON.parse(atob(code.slice(2).replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (code.slice(2).length % 4)) % 4)));
    expect(Object.keys(wire).sort()).toEqual(['a', 'f', 'h', 'p', 'x']);
    expect(wire.p[0][0]).toBe('bed-1');
    expect(wire.h).toHaveLength(2);
  });
  it('a version 2 link without people, and a version 1 link, still open', () => {
    const v2 = encodeLayout({ ...emptyLayout(), fittings: { removed: ['fan-1'], moved: {}, sized: {} } })!;
    expect(v2.startsWith('2.')).toBe(true);
    expect(decodeLayout(v2, originals)!.people).toBeUndefined();
    expect(decodeLayout(encodeLayout({ ...emptyLayout(), removed: ['bed-1'] })!, originals)!.removed).toEqual(['bed-1']);
  });
  it('junk in a link is dropped, not trusted', () => {
    const wire = { h: [[9, 2, 170, 100, 100, 0, 0], [0, 2, 170, 'x', 100, 0, 0], [0, 2, 170, 100, 100, 0, 1, 'no-such-piece'], [1, 99, 9999, 120, 130, 0, 0], 'junk', null] };
    const code = `2.${btoa(JSON.stringify(wire)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    const back = decodeLayout(code, originals)!.people!;
    expect(back).toHaveLength(2);
    expect(back[0].pose).toBe('stand'); // the one that sat on a piece this home does not have
    expect(back[1]).toMatchObject({ body: 'woman', tone: 4, heightCm: 230, pose: 'stand' });
  });
  it('no more than the maximum, whatever the link says', () => {
    const many = Array.from({ length: 9 }, (_, i) => rec({ id: `x${i}`, x: 1 + i * 0.1 }));
    const code = encodeLayout({ ...emptyLayout(), people: many })!;
    expect(decodeLayout(code, originals)!.people).toHaveLength(PEOPLE_MAX);
    expect(sanitizeRecs(many)).toHaveLength(PEOPLE_MAX);
  });
  it('the wire form is compact', () => {
    const rows = peopleToWire(people, (id) => id);
    expect(JSON.stringify(rows).length).toBeLessThan(160);
    expect(peopleFromWire(rows, (r) => r).map((r) => r.pose)).toEqual(['stand', 'sit', 'lie']);
  });
  it('a record needs a body, a pose and a place; a sitting one needs its piece', () => {
    expect(sanitizeRec({ body: 'man', pose: 'stand', x: 1, z: 2 }, 'a')).toMatchObject({ body: 'man', heightCm: 170, tone: 2 });
    expect(sanitizeRec({ body: 'robot', pose: 'stand', x: 1, z: 2 }, 'a')).toBeNull();
    expect(sanitizeRec({ body: 'man', pose: 'sit', x: 1, z: 2 }, 'a')).toBeNull();
    expect(sanitizeRec({ body: 'man', pose: 'stand', x: NaN, z: 2 }, 'a')).toBeNull();
  });
});

describe('the store carries people in My layout without keeping any', () => {
  function mk(storage: StorageLike, shareCode: string | null = null) {
    return createFurnitureStore({ sceneId: 't', baseGrid, initial: furnished.furniture, parent: new THREE.Group(), storage, saveDelayMs: 0, shareCode });
  }
  const list = [rec({ pose: 'sit', host: 'sofa-1', x: 3.55, z: 3.2 })];
  it('the layout lists them, the chip counts them, and Reset clears them', () => {
    const store = mk(fakeStorage());
    expect(store.isEdited()).toBe(false);
    let cleared = 0;
    let current = list;
    const notify = store.attachPeople({ list: () => current, clear: () => { cleared++; current = []; } });
    expect(store.isEdited()).toBe(true);
    expect(store.layout().people).toEqual(list);
    let heard = 0;
    store.onChange(() => { heard++; });
    notify();
    expect(heard).toBe(1);
    store.reset();
    expect(cleared).toBe(1);
    expect(store.isEdited()).toBe(false);
    expect(store.layout().people).toBeUndefined();
  });
  it('a store with nobody attached has no people and is not edited by them', () => {
    const store = mk(fakeStorage());
    expect(store.layout().people).toBeUndefined();
    store.attachPeople(null);
    expect(store.isEdited()).toBe(false);
  });
  it('the people of this browser are stored in the same value as moves and fittings, and none leaves nothing behind', () => {
    const originals = new Map(furnished.furniture.map((i) => [i.id, i]));
    const two = [rec(), rec({ id: 'pe-2', body: 'child', heightCm: 110 })];
    const raw = serializeMine([], {}, {}, emptyFittings(), two)!;
    expect(JSON.parse(raw).version).toBe(2);
    expect(parseMine(raw, originals).people!.map((p) => p.body)).toEqual(['woman', 'child']);
    expect(serializeMine([], {}, {}, emptyFittings(), [])).toBeNull();
    expect(parseMine('{not json', originals).people).toBeUndefined();
    expect(parseMine(JSON.stringify({ version: 2, people: [{ body: 'man', pose: 'stand', x: 0, z: 0 }, 5] }), originals).people).toHaveLength(1);
    // a stored layout from before people existed has none
    expect(parseMine(JSON.stringify({ version: 1, removed: ['bed-1'], finishes: {} }), originals).people).toBeUndefined();
  });
  it('the store saves the people with the rest and reads them back on the next visit', () => {
    const st = fakeStorage();
    const a = mk(st);
    let cur = list;
    const notify = a.attachPeople({ list: () => cur, clear: () => { cur = []; } });
    notify();
    a.flush();
    expect(JSON.parse(st.data.get(mineKey('t'))!).people).toHaveLength(1);
    const b = mk(st);
    expect(b.initialPeople()).toHaveLength(1);
    expect(b.initialPeople()[0]).toMatchObject({ pose: 'sit', host: 'sofa-1' });
    a.reset();
    expect(st.data.has(mineKey('t'))).toBe(false);
    expect(mk(st).initialPeople()).toEqual([]);
  });
});

describe('a person in the way of a wardrobe', () => {
  // a wardrobe 1.8 m wide, front toward +z, with a 60 cm shutter hinged at its left end
  const box: Box = { cx: 2, cz: 1.0, w: 1.8, d: 0.6, yawDeg: 0 };
  const shutter: Shutter = { id: 's', bay: 0, side: 'left', hingeU: -0.9, dir: 1, widthM: 0.6 };
  it('the shutter opens square to the front on an empty floor, and stops short of a person standing in its swing', () => {
    expect(freeAngleRad(baseGrid, box, shutter, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 5);
    // hinge at x = 1.1, z = 1.3: the free edge sweeps through (1.1, 1.9) at 90 degrees
    const stander = rec({ body: 'man', heightCm: 175, x: 1.1, z: 1.75 });
    setExtraObstacles(() => obstaclesOf([stander]));
    try {
      const withPerson = freeAngleRad(withExtraObstacles(baseGrid), box, shutter, Math.PI / 2);
      expect(withPerson).toBeLessThan(Math.PI / 2 - 0.2);
    } finally { setExtraObstacles(null); }
    expect(withExtraObstacles(baseGrid)).toBe(baseGrid); // nobody registered: the same grid, untouched
  });
});
