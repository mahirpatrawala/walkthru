import { describe, expect, it } from 'vitest';
import { checkLinks, findSpace, liftDoorAt, parseBuilding, startSpaceOf } from '../src/building/parse';
import { buildingIndexEntry } from '../src/building/index-entry';
import { clone, rawBuilding, readBuilding } from './helpers/sample-building';

type Raw = { levels: { id: string; spaces: { id: string; kind?: string; type?: string; sceneId?: string; placement?: { rotDeg: number }; portals: { id: string; kind: string; opening?: string; to?: { space: string; portal: string }; lift?: string }[] }[] }[]; lifts: { id: string; serves: string[]; car?: unknown }[]; flatTypes: Record<string, { sceneId: string; mirrorSceneId?: string }>; [k: string]: unknown };
const raw = (): Raw => clone(rawBuilding('sample-tower')) as Raw;
const bad = (mut: (r: Raw) => void): string => {
  const r = raw();
  mut(r);
  try { parseBuilding(r); } catch (e) { return (e as Error).message; }
  return '';
};

describe('building.json', () => {
  it('both committed buildings parse', () => {
    for (const id of ['sample-tower', 'sample-tower-empty']) {
      const b = readBuilding(id);
      expect(b.levels.map((l) => l.id)).toEqual(['g', 'l1', 'l2', 'l3']);
      expect(b.sample).toBe(true);
      expect(b.note).toMatch(/Sample layout for demonstration/);
    }
    expect(readBuilding('sample-tower-empty').bare).toBe(true);
    expect(readBuilding('sample-tower').bare).toBeUndefined();
  });

  it('the tower has the spaces the brief asks for', () => {
    const b = readBuilding('sample-tower');
    const kinds = b.levels.flatMap((l) => l.spaces.map((s) => s.kind));
    for (const k of ['home', 'lobby', 'corridor', 'gym', 'hall', 'pool', 'garden']) expect(kinds).toContain(k);
    expect(b.levels.find((l) => l.id === 'l2')!.spaces.filter((s) => s.kind === 'home')).toHaveLength(4);
    // four different configurations on a floor, one design placed on both floors
    const types = b.levels.find((l) => l.id === 'l2')!.spaces.filter((s) => s.kind === 'home').map((s) => s.type);
    expect(new Set(types).size).toBe(4);
    const l3 = b.levels.find((l) => l.id === 'l3')!.spaces.filter((s) => s.kind === 'home');
    expect(l3.map((s) => s.sceneId).sort()).toEqual(b.levels.find((l) => l.id === 'l2')!.spaces.filter((s) => s.kind === 'home').map((s) => s.sceneId).sort());
    expect(b.levels.flatMap((l) => l.spaces).filter((s) => s.kind === 'pool' || s.kind === 'garden').every((s) => s.outdoor === true && !s.comingNext)).toBe(true);
  });

  it('rejects things that are not a building, with a message that says where', () => {
    expect(() => parseBuilding(null)).toThrow(/must be a JSON object/);
    expect(() => parseBuilding({ version: 2 })).toThrow(/version must be 1/);
    expect(bad((r) => { delete (r as Record<string, unknown>).id; })).toMatch(/id must be a non-empty text/);
    expect(bad((r) => { r.id = 'Not Valid!'; })).toMatch(/id "Not Valid!" is not a valid id/);
    expect(bad((r) => { r.floorToFloorM = 40; })).toMatch(/floorToFloorM must be between 2.4 and 8/);
    expect(bad((r) => { r.levels = []; })).toMatch(/levels needs at least 1 entry/);
    expect(bad((r) => { r.levels[0].spaces[0].kind = 'spa'; })).toMatch(/levels\[0\]\.spaces\[0\]\.kind must be one of home, lobby, corridor/);
    expect(bad((r) => { r.levels[0].spaces[0].placement = { rotDeg: 45 }; })).toMatch(/rotDeg must be 0, 90, 180 or 270 \(got 45\)/);
    expect(bad((r) => { r.levels[0].spaces[0].portals[0].kind = 'teleporter'; })).toMatch(/portals\[0\]\.kind must be door, lift, stairs or outside/);
    expect(bad((r) => { r.levels[0].spaces[0].sceneId = 'Bad Scene'; })).toMatch(/sceneId "Bad Scene" is not a valid scene id/);
  });

  it('rejects links that do not hold together', () => {
    expect(bad((r) => { r.levels[1].spaces[0].id = r.levels[0].spaces[0].id; })).toMatch(/the id "lobby" is used twice/);
    // a door whose far side is gone
    expect(bad((r) => { r.levels[2].spaces[0].portals.find((p) => p.kind === 'door')!.to!.space = 'f9-nowhere'; })).toMatch(/leads to space "f9-nowhere", which does not exist/);
    // a door that does not lead back
    expect(bad((r) => { r.levels[2].spaces[1].portals[0].to!.portal = 'flat-203'; })).toMatch(/the far side does not lead back/);
    // a flat of a type nobody defined
    expect(bad((r) => { const f = r.levels[2].spaces.find((s) => s.kind === 'home')!; f.type = 'penthouse'; })).toMatch(/type "penthouse", which is not in flatTypes/);
    // a flat in a scene that is not its type's
    expect(bad((r) => { const f = r.levels[2].spaces.find((s) => s.kind === 'home')!; f.sceneId = 'test-tower-lobby'; })).toMatch(/uses scene "test-tower-lobby" but its/);
    // a lift that skips a level it claims to serve
    expect(bad((r) => { r.lifts[0].serves.push('l9'); })).toMatch(/serves level "l9", which does not exist/);
    expect(bad((r) => { r.levels[3].spaces[0].portals = r.levels[3].spaces[0].portals.filter((p) => p.id !== 'lift-a'); })).toMatch(/lift "lift-a" must have exactly one lift door there \(found 0\)/);
    expect(bad((r) => { r.levels[3].spaces[0].portals.find((p) => p.id === 'lift-a')!.lift = 'lift-z'; })).toMatch(/lift "lift-z" is not defined/);
    expect(bad((r) => { (r.levels[0].spaces[0] as Record<string, unknown>).lobbyAnchors = [{ id: 'x', role: 'bar', at: { x: 1, z: 1 }, yawDeg: 0, footprint: { w: 1, d: 1 } }]; })).toMatch(/lobbyAnchors\[0\]\.role must be reception, security, seating or letterboxes/);
    expect(bad((r) => { (r.levels[1].spaces[0] as Record<string, unknown>).lobbyAnchors = []; })).toMatch(/is not a lobby, so it takes no lobbyAnchors/);
    expect(bad((r) => { r.startSpace = 'nope'; })).toMatch(/startSpace "nope" is not a space/);
    expect(bad((r) => { const p = r.levels[2].spaces[0].portals; p.push({ ...p[0], id: 'dup' }); })).toMatch(/the opening "[^"]+" has two portals/);
  });

  it('checkLinks lists every problem, not just the first', () => {
    const b = readBuilding('sample-tower');
    b.lifts[0].serves.push('l9');
    b.startSpace = 'nope';
    expect(checkLinks(b).length).toBeGreaterThanOrEqual(2);
  });

  it('finds spaces, the start space and a lift door', () => {
    const b = readBuilding('sample-tower');
    expect(findSpace(b, 'f3-302')!.level.id).toBe('l3');
    expect(findSpace(b, 'nope')).toBeNull();
    expect(startSpaceOf(b).space.kind).toBe('lobby');
    expect(liftDoorAt(b, 'lift-a', 'l2')!.space.id).toBe('f2-corridor');
    expect(liftDoorAt(b, 'lift-a', 'l9')).toBeNull();
  });

  it('the list entry counts what is there', () => {
    const e = buildingIndexEntry(readBuilding('sample-tower'));
    expect(e.levels).toBe(4);
    expect(e.flats).toBe(8);
    expect(e.flatTypes.reduce((n, t) => n + t.count, 0)).toBe(8);
    expect(e.amenities).toEqual(['Indoor games area', 'Gymnasium', 'Changing room 1', 'Changing room 2', 'Banquet hall 1', 'Banquet lounge', 'Banquet hall 2', 'Banquet deck', 'Aqua play', 'Pool area']);
  });
});
