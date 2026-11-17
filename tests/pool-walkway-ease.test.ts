// A sales-room pool deck does not open with a red alarm (owner, 17 Nov 2026): the sample's loungers are slid back from the water where the deck is wide
// enough, and where the deck itself is tight the pill is a quiet note with the honest number.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deckObstacles } from '../src/outdoor/pool-ui';
import { easeWalkway, walkwayNote, walkwayReport } from '../src/outdoor/walkway';
import type { OutdoorFile } from '../src/outdoor/types';
import { readScene } from './helpers/sample-building';

const ROOT = path.resolve(import.meta.dirname, '..');
const outdoorOf = (id: string): OutdoorFile => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', id, 'outdoor.json'), 'utf8')) as OutdoorFile;

describe('the sample pool decks leave the walkway', () => {
  for (const id of ['test-tower-club-pool', 'test-tower-empty-club-pool']) {
    it(`${id}: no side is blocked, and where one is short a wall (not a lounger) is why`, () => {
      const s = readScene(id)!, o = outdoorOf(id);
      const rep = walkwayReport(o.pools, s.layout.rooms[0].polygon, deckObstacles(s.furniture, o.roofs));
      expect(rep.verdict).not.toBe('blocked');
      for (const side of rep.sides.filter((x) => x.verdict !== 'clear')) expect(side.by).toBe('a wall');
    });
  }
  it('sliding the loungers back is deterministic, moves only loungers and chairs, and leaves a clear deck alone', () => {
    const s = readScene('test-tower-club-pool')!, o = outdoorOf('test-tower-club-pool');
    const room = s.layout.rooms[0].polygon;
    expect(easeWalkway(o.pools, room, s.furniture)).toEqual(s.furniture);
    // the brochure's own layout had the west row 0.75 m from the water: put it back and the pass gives 1.2 m
    const tight = s.furniture.map((f) => (f.id.startsWith('wing-pool-lounger-') && f.box.yawDeg === 90 ? { ...f, box: { ...f.box, cx: 1.79 } } : f));
    const before = walkwayReport(o.pools, room, deckObstacles(tight, o.roofs));
    expect(before.verdict).toBe('blocked');
    const eased = easeWalkway(o.pools, room, tight);
    const after = walkwayReport(o.pools, room, deckObstacles(eased, o.roofs));
    expect(after.sides.filter((x) => x.verdict !== 'clear').every((x) => x.by === 'a wall')).toBe(true);
    for (let i = 0; i < eased.length; i++) if (!/^pool-(lounger|chair)$/.test(tight[i].catalogId ?? '')) expect(eased[i]).toEqual(tight[i]);
    expect(easeWalkway(o.pools, room, tight)).toEqual(eased);
  });
  it('a short walkway reads as a note with the number, not as an alarm', () => {
    const s = readScene('test-tower-club-pool')!, o = outdoorOf('test-tower-club-pool');
    const rep = walkwayReport(o.pools, s.layout.rooms[0].polygon, deckObstacles(s.furniture, o.roofs));
    expect(walkwayNote(rep)).toBe('Walkway 1.15 m on the east side (typical 1.2 m)');
    expect(walkwayNote({ ...rep, sides: [{ ...rep.sides[0], verdict: 'blocked', clearM: 0.75, side: 'W' }], requiredM: 1.2 })).toBe('Walkway 0.75 m on the west side (typical 1.2 m)');
  });
});
