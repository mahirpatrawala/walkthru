// The Sample Tower's clubhouse level after a published builder brochure's amenity plan (SPEC 20): the rooms are the plan's, the doors pair,
// the empty twin has the same shapes, and the earlier made-up garden is no longer part of the tower.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlapAreaM2 } from '../src/core/layout-validate';
import { validateBuilding } from '../src/building/validate';
import type { PropertyFile } from '../src/types';
import type { Rect } from '../src/outdoor/types';
import { EMPTY_IDS, FULL_IDS, buildPodium } from '../scripts/building/podium-level';
import { readBuilding, readScene } from './helpers/sample-building';

const ROOT = path.resolve(import.meta.dirname, '..');
const full = readBuilding('sample-tower'), empty = readBuilding('sample-tower-empty');
const level = (b: typeof full) => b.levels.find((l) => l.id === 'l1')!;
const rectOfRoom = (p: PropertyFile): Rect => {
  const xs = p.layout.rooms.flatMap((r) => r.polygon.map((q) => q.x)), zs = p.layout.rooms.flatMap((r) => r.polygon.map((q) => q.z));
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
};

describe('the built sizes come from the one printed dimension', () => {
  it('the built lap pool is 25 m long and about 5 m wide', () => {
    const o = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', FULL_IDS.wing, 'outdoor.json'), 'utf8'));
    const lap = o.pools.find((p: { id: string }) => p.id === 'lap');
    expect(lap.rect.z1 - lap.rect.z0).toBeCloseTo(25, 1);
    expect(lap.rect.x1 - lap.rect.x0).toBeGreaterThan(4.5);
    expect(lap.rect.x1 - lap.rect.x0).toBeLessThan(5.5);
  });
  it('the gym is about 16 x 9.5 m and a banquet hall about 8.5 m square, scaled and not measured', () => {
    const g = rectOfRoom(readScene(FULL_IDS.gym)!);
    expect(g.x1 - g.x0).toBeCloseTo(15.93, 1);
    expect(g.z1 - g.z0).toBeCloseTo(9.46, 1);
    const h = rectOfRoom(readScene(FULL_IDS.hall1)!);
    expect(h.x1 - h.x0).toBeGreaterThan(7.5); expect(h.x1 - h.x0).toBeLessThan(9);
    expect(h.z1 - h.z0).toBeGreaterThan(7.5); expect(h.z1 - h.z0).toBeLessThan(9);
  });
});

describe('the level', () => {
  const expected = ['clubhouse', 'games', 'link', 'gym', 'changing-1', 'changing-2', 'hall-1', 'lounge', 'hall-2', 'deck', 'aqua', 'pool'];
  it('is the plan\'s rooms and nothing else: the foyer, the games area, the gym with changing rooms, the banquet halls with their deck, aqua play and the pools; no garden', () => {
    for (const b of [full, empty]) {
      expect(level(b).spaces.map((s) => s.id)).toEqual(expected);
      expect(b.levels.flatMap((l) => l.spaces).some((s) => /garden/i.test(s.name))).toBe(false);
      expect(JSON.stringify(b)).not.toMatch(/club-garden/);
      expect(level(b).spaces.find((s) => s.id === 'pool')!.kind).toBe('pool');
    }
    expect(fs.existsSync(path.join(ROOT, 'public/scenes/test-tower-club-garden'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'public/scenes/test-tower-empty-club-garden'))).toBe(false);
  });
  it('names the plan\'s items (1 lap pool, 2 shallow pool, 3 banquet halls with deck, 4 aqua play, 5 lawn, 6 gymnasium, 7 games area)', () => {
    const names = level(full).spaces.map((s) => s.name).join(' | ');
    for (const w of ['Indoor games area', 'Gymnasium', 'Changing room 1', 'Banquet hall 1', 'Banquet hall 2', 'Banquet deck', 'Aqua play', 'Pool area']) expect(names).toContain(w);
    const pool = level(full).spaces.find((s) => s.id === 'pool')!;
    expect(pool.notes!.join(' ')).toMatch(/25 m lap pool/);
    expect(pool.notes!.join(' ')).toMatch(/shallow pool/);
    expect(pool.notes!.join(' ')).toMatch(/lawn/);
  });
  it('every space says its numbers are scaled from the plan\'s one printed dimension and not measured', () => {
    for (const s of level(full).spaces) expect(s.notes!.join(' '), s.id).toMatch(/Scaled from the one printed dimension/);
    for (const s of level(full).spaces) expect(readScene(s.sceneId)!.subtitle, s.id).toMatch(/not measured/);
    expect(full.note).toMatch(/scaled from its one printed dimension/);
    expect(full.note).toMatch(/not measured/);
  });
  it('validates clean: every portal pairs with its other side (same width, same place, facing each other, same hinge), every landing is clear and reachable', () => {
    for (const b of [full, empty]) {
      const rep = validateBuilding(b, (id) => readScene(id));
      expect(rep.errors).toEqual([]);
      expect(rep.warnings).toEqual([]);
    }
  });
  it('portals pair both ways, within the level, by name', () => {
    for (const b of [full, empty]) {
      const spaces = level(b).spaces;
      for (const s of spaces) for (const p of s.portals) {
        if (p.kind !== 'door' || p.to.space === 'lobby') continue;
        const far = spaces.find((q) => q.id === p.to.space);
        expect(far, `${s.id}/${p.id}`).toBeDefined();
        const back = far!.portals.find((q) => q.id === p.to.portal);
        expect(back, `${s.id}/${p.id} back`).toBeDefined();
        expect(back!.kind === 'door' && back!.to.space === s.id && back!.to.portal === p.id, `${s.id}/${p.id}`).toBe(true);
      }
    }
  });
  it('the two lifts of the tower are the two on this level, and the way to the ground floor is kept', () => {
    const foyer = level(full).spaces[0];
    expect(foyer.portals.filter((p) => p.kind === 'lift').map((p) => p.id)).toEqual(['lift-a', 'lift-b']);
    expect(foyer.portals.find((p) => p.id === 'walkway')).toMatchObject({ to: { space: 'lobby', portal: 'clubhouse' } });
    expect(foyer.portals.some((p) => p.kind === 'stairs')).toBe(true);
    for (const l of full.lifts) expect(l.serves).toContain('l1');
  });
  it('the doors follow the plan: the foyer opens to the gym, the changing rooms, the games area, the deck and the bridge; the halls open onto the deck; the lounge sits between the two halls', () => {
    const to = (id: string) => level(full).spaces.find((s) => s.id === id)!.portals.filter((p) => p.kind === 'door').map((p) => (p as { to: { space: string } }).to.space).sort();
    expect(to('clubhouse')).toEqual(['aqua', 'changing-1', 'changing-2', 'games', 'gym', 'lobby', 'pool']);
    expect(to('hall-1')).toEqual(['deck', 'lounge']);
    expect(to('hall-2')).toEqual(['deck', 'lounge']);
    expect(to('lounge')).toEqual(['deck', 'hall-1', 'hall-2', 'link']);
    expect(to('deck')).toEqual(['hall-1', 'hall-2', 'lounge']);
    expect(to('games')).toEqual(['clubhouse', 'link']);
  });
  it('no two spaces overlap on the plan (the shared walls only touch)', () => {
    const rooms = level(full).spaces.map((s) => ({ s, rooms: readScene(s.sceneId)!.layout.rooms }));
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) for (const a of rooms[i].rooms) for (const c of rooms[j].rooms) expect(overlapAreaM2(a.polygon, c.polygon), `${rooms[i].s.id} / ${rooms[j].s.id}`).toBeLessThan(0.05);
  });
  it('the empty twin has the same rooms in the same shapes, unfurnished', () => {
    for (const [a, b] of level(full).spaces.map((s, i) => [s, level(empty).spaces[i]] as const)) {
      const pa = readScene(a.sceneId)!, pb = readScene(b.sceneId)!;
      expect(pb.layout.rooms, a.id).toEqual(pa.layout.rooms);
      expect(pb.layout.openings, a.id).toEqual(pa.layout.openings);
      expect(pb.furniture, a.id).toEqual([]);
      expect(pb.spaceKind).toBe(pa.spaceKind);
    }
  });
  it('is the same on every run and is what is committed', () => {
    const a = buildPodium(false), b = buildPodium(false);
    expect(JSON.stringify([...a.scenes])).toBe(JSON.stringify([...b.scenes]));
    for (const [id, sc] of a.scenes) expect(JSON.parse(JSON.stringify(sc.property)), id).toEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', id, 'property.json'), 'utf8')));
    for (const [id, sc] of buildPodium(true).scenes) expect(JSON.parse(JSON.stringify(sc.property)), id).toEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', id, 'property.json'), 'utf8')));
    expect(EMPTY_IDS.foyer).toBe(FULL_IDS.foyer);
  });
});
