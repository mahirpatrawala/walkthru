// C12e: the review queue and the writer, with no browser and no server (SPEC 17.9, 17.12 items 7 and 12). The fixture is a small
// understanding file written by hand; every expectation below is arithmetic on its invented numbers.
import { describe, expect, it } from 'vitest';
import { polygonArea } from '../src/core/geometry';
import { unverifiedRoomsFromExtras } from '../src/core/room-trust';
import { parseDesigns } from '../src/look/designs';
import { applyReview, designForItem } from '../src/understand/review-apply';
import { buildRows, parseCorrection, progressOf, progressText, reviewDone, validateReview, emptyReview, fmtFtIn } from '../src/understand/review-model';
import type { Decision, ReviewFile } from '../src/understand/review-model';
import { isFact } from '../src/understand/types';
import { specFromDesign } from '../src/buyer/wardrobe-swing';
import { IN, makeFixture } from './helpers/review-fixture';

const at = '2026-11-13T00:00:00.000Z';
const confirm = (): Decision => ({ action: 'confirm', at });
const correct = (value: unknown): Decision => ({ action: 'correct', value, at });
const review = (d: Record<string, Decision>): ReviewFile => ({ version: 1, decisions: d });

describe('the queue (SPEC 17.9)', () => {
  const { doc } = makeFixture();
  const rows = buildRows(doc);

  it('conflicts first, then room sizes, doors and windows, built-ins, heights, printed numbers', () => {
    const ranks = rows.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(rows.filter((r) => r.rank === 0).map((r) => r.title)).toEqual(expect.arrayContaining(['Lounge · size']));
    const firstNonConflict = rows.findIndex((r) => r.rank > 0);
    expect(rows.slice(0, firstNonConflict).every((r) => r.baseStatus === 'conflict')).toBe(true);
    const order = (re: RegExp): number => rows.findIndex((r) => re.test(r.title));
    expect(order(/^Bedroom A · size/)).toBeLessThan(order(/^Door/));
    expect(order(/^Door/)).toBeLessThan(order(/^Wardrobe · size/));
    expect(order(/^Wardrobe · size/)).toBeLessThan(order(/^Ceiling height/));
    expect(order(/^Ceiling height/)).toBeLessThan(order(/^Printed dimension · 3'11"/));
  });

  it('within a rank, the least sure value comes first', () => {
    const rooms = rows.filter((r) => r.rank === 1);
    expect(rooms.map((r) => r.confidence)).toEqual([...rooms.map((r) => r.confidence)].sort((a, b) => a - b));
  });

  it('verified values are not in the queue; the counter counts only what needs a look', () => {
    const p = progressOf(rows);
    expect(rows.find((r) => r.title === 'Kitchen · size')!.baseStatus).toBe('verified');
    expect(p.verified).toBe(2); // the kitchen, and the one dimension that matches the scale
    expect(p.total).toBe(rows.length - 2);
    expect(p.checked).toBe(0);
    expect(progressText(p)).toBe(`0 of ${p.total} checked`);
    expect(p.conflicts).toBe(2);
  });

  it('the step is done when no conflict remains; unverified values may stay', () => {
    expect(reviewDone(rows)).toBe(false);
    const d: Record<string, Decision> = {};
    for (const r of rows.filter((x) => x.baseStatus === 'conflict')) d[r.id] = confirm();
    const after = buildRows(doc, review(d));
    expect(reviewDone(after)).toBe(true);
    expect(progressOf(after).open).toBeGreaterThan(0);
  });

  it('every row says how it was read, in a sentence a broker can act on', () => {
    expect(rows.find((r) => r.title === 'Bedroom A · size')!.how).toBe('measured from the drawing, no dimension printed');
    expect(rows.find((r) => /^Printed dimension · 3'11"/.test(r.title))!.how).toBe("read from the drawing's lettering, not checked");
    expect(rows.find((r) => r.title === 'Kitchen · size')!.how).toBe('read from the drawing and matches its scale');
    expect(rows.find((r) => r.title === 'Lounge · size')!.how).toMatch(/disagree/);
  });

  it('a conflict shows both sides: the walls and the label', () => {
    const lounge = rows.find((r) => r.title === 'Lounge · size')!;
    expect(lounge.alternatives).toHaveLength(1);
    expect(lounge.alternatives[0].display).toMatch(/^2\.74 × 3\.66 m/);
    expect(lounge.conflict).toMatch(/label says/);
  });

  it('feet and inches print to the half inch', () => {
    expect(fmtFtIn(0.7)).toBe('2\'-3½"');
    expect(fmtFtIn(2.4384)).toBe('8\'-0"');
    expect(fmtFtIn(31 * IN)).toBe('2\'-7"');
  });
});

describe('typed corrections (feet and inches or metric, C12a parsers)', () => {
  const rows = buildRows(makeFixture().doc);
  const room = rows.find((r) => r.title === 'Bedroom A · size')!;
  const bay = rows.find((r) => /bay 1 width/.test(r.title))!;
  it('sizes: both sides, either unit', () => {
    const sz = (t: string): number[] => (parseCorrection(room, t) as { value: number[] }).value;
    expect(sz('12\'0" x 10\'6"')[0]).toBeCloseTo(3.6576, 6);
    expect(sz('12\'0" x 10\'6"')[1]).toBeCloseTo(3.2004, 6);
    expect(sz('3.6 x 3.2 m')).toEqual([3.6, 3.2]);
    expect(sz('3600 x 3200')).toEqual([3.6, 3.2]);
    expect(parseCorrection(room, '12')).toMatchObject({ ok: false });
    expect(parseCorrection(room, '')).toMatchObject({ ok: false });
  });
  it('lengths: feet and inches, fractions, metres, millimetres; a number outside the plausible range is refused with the reason', () => {
    const v = (t: string): number => (parseCorrection(bay, t) as { value: number }).value;
    expect(v('2\'-7"')).toBeCloseTo(31 * IN, 6);
    expect(v('2\'-7½"')).toBeCloseTo(31.5 * IN, 6);
    expect(v('0.79 m')).toBeCloseTo(0.79, 6);
    expect(v('790')).toBeCloseTo(0.79, 6);
    expect(parseCorrection(bay, 'banana')).toMatchObject({ ok: false });
    expect(parseCorrection(bay, '500 m')).toMatchObject({ ok: false });
    const ceiling = rows.find((r) => r.title === 'Ceiling height')!;
    expect(parseCorrection(ceiling, '12 m')).toMatchObject({ ok: false });
    expect(parseCorrection(ceiling, '9\'6"')).toMatchObject({ ok: true });
  });
  it('an opening takes a width, optionally with its type', () => {
    const door = rows.find((r) => r.title.startsWith('Door'))!;
    expect(parseCorrection(door, '0.8 m')).toMatchObject({ ok: true, value: { widthM: 0.8 } });
    expect(parseCorrection(door, 'window 1.5 m')).toMatchObject({ ok: true, value: { type: 'window', widthM: 1.5 } });
    expect(parseCorrection(door, 'archway 2 m')).toMatchObject({ ok: true, value: { type: 'opening', widthM: 2 } });
  });
  it('counts and hinge sides', () => {
    const bays = rows.find((r) => /number of bays/.test(r.title))!;
    const hinge = rows.find((r) => /bay 1 hinge/.test(r.title))!;
    expect(parseCorrection(bays, '4')).toMatchObject({ ok: true, value: 4 });
    expect(parseCorrection(bays, '2.5')).toMatchObject({ ok: false });
    expect(parseCorrection(hinge, 'Outer edges')).toMatchObject({ ok: true, value: 'outer-edges' });
    expect(parseCorrection(hinge, 'up')).toMatchObject({ ok: false });
  });
});

describe('a review file from outside is trusted for nothing', () => {
  const { doc } = makeFixture();
  const rows = buildRows(doc);
  const room = rows.find((r) => r.title === 'Bedroom A · size')!;
  it('accepts a decision on a row and refuses everything else', () => {
    expect(validateReview(doc, review({ [room.id]: confirm() })).ok).toBe(true);
    expect(validateReview(doc, review({ nope: confirm() })).ok).toBe(false);
    expect(validateReview(doc, review({ [room.id]: { action: 'delete', at } as unknown as Decision })).ok).toBe(false);
    expect(validateReview(doc, review({ [room.id]: correct('big') })).ok).toBe(false);
    expect(validateReview(doc, review({ [room.id]: correct([3, 500]) })).ok).toBe(false);
    expect(validateReview(doc, { version: 2, decisions: {} }).ok).toBe(false);
    expect(validateReview(doc, null).ok).toBe(false);
  });
  it('keeps only the fields it knows', () => {
    const r = validateReview(doc, review({ [room.id]: { ...confirm(), extra: 'x' } as Decision }));
    expect(r.ok && Object.keys(r.review.decisions[room.id])).toEqual(['action', 'at']);
  });
});

describe('the writer (SPEC 17.6, 17.12 item 12)', () => {
  it('with no decisions, every value that is not a fact is flagged for the buyer and nothing unverified reaches designs.json', () => {
    const { doc, base } = makeFixture();
    const a = applyReview(base, doc, emptyReview());
    const flagged = unverifiedRoomsFromExtras(a.extras);
    expect(Object.keys(flagged).sort()).toEqual(['bedroom-a', 'lounge']);
    expect(flagged['bedroom-a']).toBe('size not confirmed yet');
    expect(flagged.lounge).toBe('drawing and label disagree');
    expect(a.extras.rooms.find((r) => r.id === 'kitchen')!.verified).toBe(true);
    expect(a.designs.items).toEqual({});
    expect(a.extras.review).toBeUndefined();
  });

  it('confirm one, correct one, reject one: exactly those three change, the corrected value is the broker\'s', () => {
    const { doc, base, ids } = makeFixture();
    const rows = buildRows(doc);
    const rowOf = (re: RegExp) => rows.find((r) => re.test(r.title))!;
    const bedroom = rowOf(/^Bedroom A · size/), door = rowOf(/^Door/), window = rowOf(/^Window/);
    const a0 = applyReview(base, doc, emptyReview());
    const a = applyReview(base, doc, review({ [bedroom.id]: confirm(), [door.id]: correct({ widthM: 0.8 }), [window.id]: { action: 'reject', at } }));
    // confirmed: the buyer stops seeing "not measured", provenance says who
    expect(unverifiedRoomsFromExtras(a.extras)['bedroom-a']).toBeUndefined();
    expect(a.extras.rooms.find((r) => r.id === 'bedroom-a')!.provenance).toBe('confirmed by broker');
    expect(a.doc.rooms.find((r) => r.id === 'bedroom-a')!.width.status).toBe('confirmed');
    expect(a.doc.rooms.find((r) => r.id === 'bedroom-a')!.width.method).toBe('vector');
    // corrected: the value, the method and the status
    const dw = a.doc.openings.find((o) => o.id === 'door-1')!.width;
    expect(dw.value).toBe(0.8);
    expect(dw.method).toBe('broker');
    expect(dw.status).toBe('corrected');
    expect(dw.alternatives!.some((x) => x.value === 0.9)).toBe(true);
    expect(a.proposal.openings.find((o) => o.id === 'door-1')!.widthM).toBe(0.8);
    // the opening's type was looked at and accepted, not retyped
    expect(a.doc.openings.find((o) => o.id === 'door-1')!.type.status).toBe('confirmed');
    // rejected: gone from the flat
    expect(a.proposal.openings.map((o) => o.id)).toEqual(['door-1']);
    expect(a.changed.removedOpenings).toEqual(['window-1']);
    // nothing else moved
    expect(a.proposal.rooms).toEqual(a0.proposal.rooms);
    expect(a.extras.furniture).toEqual(a0.extras.furniture);
    expect(a.extras.rooms.filter((r) => r.id !== 'bedroom-a')).toEqual(a0.extras.rooms.filter((r) => r.id !== 'bedroom-a'));
    expect(a.extras.review).toMatchObject({ by: 'broker', confirmed: 1, corrected: 1, rejected: 1 });
    expect(ids.bedroom).toBeTruthy();
  });

  it('a corrected room size resizes the room about its first corner and refits its openings', () => {
    const { doc, base } = makeFixture();
    const row = buildRows(doc).find((r) => /^Bedroom A · size/.test(r.title))!;
    const a = applyReview(base, doc, review({ [row.id]: correct([3.6, 2.4]) }));
    const room = a.proposal.rooms.find((r) => r.id === 'bedroom-a')!;
    const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3.6, 3); // the room was wider than deep, and so is the typed size
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2.4, 3);
    expect(polygonArea(room.polygon)).toBeCloseTo(8.64, 2);
    expect(a.extras.rooms.find((r) => r.id === 'bedroom-a')!.areaM2).toBeCloseTo(8.64, 2);
    expect(a.extras.rooms.find((r) => r.id === 'bedroom-a')!.provenance).toBe('corrected by broker');
    expect(a.changed.rooms).toEqual(['bedroom-a']);
    const d = a.doc.rooms.find((r) => r.id === 'bedroom-a')!;
    expect([d.width.value, d.length.value]).toEqual([2.4, 3.6]);
    expect(d.width.method).toBe('broker');
    // every opening still sits on its edge
    for (const o of a.proposal.openings) {
      const p = room.polygon[o.edge], q = room.polygon[(o.edge + 1) % 4];
      expect(o.centreM + o.widthM / 2).toBeLessThanOrEqual(Math.hypot(q.x - p.x, q.z - p.z) + 1e-9);
    }
  });

  it('a nearly square room follows the order typed (first number along x), a long one follows its long side', () => {
    const { doc, base } = makeFixture();
    const rows = buildRows(doc);
    const sq = structuredClone(base); sq.proposal.rooms[0].polygon = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3.01 }, { x: 0, z: 3.01 }];
    const a = applyReview(sq, doc, review({ [rows.find((r) => /^Bedroom A · size/.test(r.title))!.id]: correct([4, 3]) }));
    const xs = a.proposal.rooms[0].polygon.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 6);
  });

  it('a confirmed ceiling is a fact and its "confirm it" warnings go; a corrected one sets the wall height', () => {
    const { doc, base } = makeFixture();
    const row = buildRows(doc).find((r) => r.title === 'Ceiling height')!;
    const a = applyReview(base, doc, review({ [row.id]: correct(2.9) }));
    expect(a.proposal.wallHeightM).toBe(2.9);
    expect(a.extras.ceiling.heightM).toBe(2.9);
    expect(a.extras.ceiling.provenance).toBe('corrected by broker');
    expect(a.extras.warnings.some((w) => /^Ceiling/.test(w))).toBe(false);
    expect(a.extras.warnings).toEqual(['Scale rests on one label. Check a door width.']);
    expect(a.changed.wallHeight).toBe(true);
  });

  it('a corrected furniture size moves the box in the extras, and a rejected item leaves the flat and designs.json', () => {
    const { doc, base } = makeFixture();
    const row = buildRows(doc).find((r) => /^Wardrobe · size/.test(r.title))!;
    const a = applyReview(base, doc, review({ [row.id]: correct([2.7, 0.55]) }));
    expect(a.extras.furniture[0].box).toMatchObject({ w: 2.7, d: 0.55, cx: 0.3 });
    const b = applyReview(base, doc, review({ [row.id]: { action: 'reject', at } }));
    expect(b.extras.furniture).toEqual([]);
    expect(b.changed.removedItems).toEqual(['wardrobe-1']);
  });

  it('the review never changes the machine file it was given', () => {
    const { doc, base } = makeFixture();
    const before = JSON.stringify([doc, base]);
    applyReview(base, doc, review({ [buildRows(doc)[3].id]: confirm() }));
    expect(JSON.stringify([doc, base])).toBe(before);
  });
});

describe('designs.json is written only from verified, confirmed and corrected values (SPEC 17.1, item 7)', () => {
  const idsOf = (rows: ReturnType<typeof buildRows>, re: RegExp) => rows.filter((r) => re.test(r.title)).map((r) => r.id);

  it('an unchecked wardrobe leaves designs.json empty: no unverified number can reach the buyer', () => {
    const { doc, base } = makeFixture();
    const a = applyReview(base, doc, emptyReview());
    expect(a.designs.items).toEqual({});
    expect(JSON.stringify(a.designs)).not.toMatch(/openable|bayPitch/);
  });

  it('one confirmed bay width is not enough: the unit needs every part before it is written', () => {
    const { doc, base } = makeFixture();
    const rows = buildRows(doc);
    const a = applyReview(base, doc, review({ [idsOf(rows, /bay 1 width/)[0]]: confirm() }));
    expect(a.designs.items['wardrobe-1']?.openable).toBeUndefined();
  });

  it('confirmed bays, shutters and hinges give the openable wardrobe, and its shutters use the confirmed width', () => {
    const { doc, base } = makeFixture();
    const rows = buildRows(doc);
    const d: Record<string, Decision> = {};
    for (const r of rows.filter((x) => x.kind === 'unit')) d[r.id] = confirm();
    d[rows.find((r) => /^Wardrobe · height/.test(r.title))!.id] = confirm();
    const a = applyReview(base, doc, review(d));
    const parsed = parseDesigns(JSON.parse(JSON.stringify(a.designs)));
    expect(parsed).not.toBeNull();
    const item = parsed!.items['wardrobe-1'];
    expect(item.heightM).toBe(2.13);
    expect(item.wardrobe).toMatchObject({ bays: 3, shuttersPerBay: 2 });
    expect(item.openable!.bayPitchM).toBeCloseTo(31 * IN, 3);
    expect(item.openable!.shutterWidthM).toBeCloseTo(15.5 * IN, 3);
    expect(item.openable!.bayCentresFromLeftM).toHaveLength(3);
    // bay centres sit inside the 2.4 m box, symmetric about its middle
    const c = item.openable!.bayCentresFromLeftM;
    expect(c[0] + c[2]).toBeCloseTo(2.4, 2);
    expect(c[1]).toBeCloseTo(1.2, 2);
    // the existing openable-wardrobe code takes it and the shutter it opens is that wide
    const spec = specFromDesign({ id: 'wardrobe-1', source: 'real', kind: 'wardrobe', label: 'Wardrobe', heightM: 2.13, surfaceHeightM: 2.13, box: { cx: 0.3, cz: 1.5, w: 2.4, d: 0.6, yawDeg: 90 } }, item.openable!);
    expect(spec.bays).toBe(3);
    expect(spec.shutters).toHaveLength(6);
    for (const s of spec.shutters) expect(s.widthM).toBeCloseTo(15.5 * IN, 3);
    // what the drawing did not give is said so
    expect(item.openable!.notInDrawing).toEqual(expect.arrayContaining(['shutter thickness', 'handle height and length']));
  });

  it('a corrected bay width reaches the shutter, with the broker named in the doc', () => {
    const { doc, base } = makeFixture();
    const rows = buildRows(doc);
    const d: Record<string, Decision> = {};
    for (const r of rows.filter((x) => x.kind === 'unit')) d[r.id] = confirm();
    const bay0 = rows.find((r) => /bay 1 width/.test(r.title))!;
    d[bay0.id] = correct(0.8);
    const a = applyReview(base, doc, review(d));
    const open = a.designs.items['wardrobe-1'].openable!;
    expect(open.shutterWidthM).toBeCloseTo(0.4, 3); // the widest bay sets the clearance
    expect(open.conflicts.join(' ')).toMatch(/not all the same width/);
    expect(a.doc.items[0].unit!.bayWidths[0].method).toBe('broker');
  });

  it('a hinge side that is not a fact keeps the wardrobe shut (it still gets its look)', () => {
    const { doc, base } = makeFixture();
    const rows = buildRows(doc);
    const d: Record<string, Decision> = {};
    for (const r of rows.filter((x) => x.kind === 'unit' && !/hinge/.test(x.title))) d[r.id] = confirm();
    const a = applyReview(base, doc, review(d));
    expect(a.designs.items['wardrobe-1'].wardrobe).toBeDefined();
    expect(a.designs.items['wardrobe-1'].openable).toBeUndefined();
  });

  it('sources carry page and text but no sheet name that is not a plain caption', () => {
    const { doc } = makeFixture();
    const it = structuredClone(doc.items[0]);
    it.height!.status = 'confirmed'; it.height!.source = { page: 2, view: 'p2', sheet: 'ACME STUDIOS DRAWN BY', bbox: [1, 1, 2, 2], text: "7'0\"" };
    const des = designForItem(it, [])!;
    expect(des.sources!.heightM).toEqual({ page: 2, sheet: '', text: "7'0\"" });
    it.height!.source.sheet = 'ELEVATION 3';
    expect((designForItem(it, [])!.sources!.heightM as { sheet: string }).sheet).toBe('ELEVATION 3');
  });

  it('verified, confirmed and corrected are the three statuses a buyer may see', () => {
    expect(['verified', 'confirmed', 'corrected', 'unverified', 'conflict'].filter((s) => isFact(s as 'verified'))).toEqual(['verified', 'confirmed', 'corrected']);
  });
});
