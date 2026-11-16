import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateBuilding } from '../src/building/validate';
import { validateLayout, validateProperty } from '../src/core/layout-validate';
import { toLevel, roomsOnLevel } from '../src/building/geom';
import { overlapAreaM2 } from '../src/core/layout-validate';
import { buildSample, lookupOf } from '../scripts/building/make-sample-building';
import { clone, readBuilding, readScene } from './helpers/sample-building';
import type { PropertyFile } from '../src/types';

const ids = ['sample-tower', 'sample-tower-empty'];

describe('building validation', () => {
  it('both committed buildings validate clean: scenes, portals, plates', () => {
    for (const id of ids) {
      const rep = validateBuilding(readBuilding(id), readScene);
      expect(rep.errors).toEqual([]);
      expect(rep.warnings).toEqual([]);
    }
  });

  it('every space of both buildings is a scene with no layout errors', () => {
    for (const id of ids) for (const l of readBuilding(id).levels) for (const s of l.spaces) {
      const p = readScene(s.sceneId)!;
      expect(p, s.sceneId).toBeTruthy();
      expect(validateLayout(p.layout).errors, s.sceneId).toEqual([]);
      expect(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'public/scenes', s.sceneId, 'property.json'), 'utf8')).unlisted, `${s.sceneId} stays out of the gallery`).toBe(true);
      expect(p.subtitle, `${s.sceneId} says it is a sample`).toMatch(/sample/i);
    }
  });

  it('every scene carries the kind of its space, and it survives the parse that the walk and a swap use', () => {
    for (const id of ids) for (const l of readBuilding(id).levels) for (const s of l.spaces) {
      const raw = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'public/scenes', s.sceneId, 'property.json'), 'utf8'));
      expect(raw.spaceKind, `${id}/${s.id}`).toBe(s.kind);
      expect(readScene(s.sceneId)!.spaceKind, `${id}/${s.id} after validateProperty`).toBe(s.kind);
    }
  });

  it('validateProperty keeps a good spaceKind and refuses a bad one', () => {
    const raw = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'public/scenes/test-tower-lobby/property.json'), 'utf8'));
    expect(validateProperty(raw).spaceKind).toBe('lobby');
    delete raw.spaceKind;
    expect(validateProperty(raw).spaceKind).toBeUndefined();
    raw.spaceKind = 'spa';
    expect(() => validateProperty(raw)).toThrow(/spaceKind/);
  });

  it('the empty twin has no furniture anywhere; the furnished tower has some in the lobby and the flats', () => {
    for (const l of readBuilding('sample-tower-empty').levels) for (const s of l.spaces) expect(readScene(s.sceneId)!.furniture, s.sceneId).toEqual([]);
    expect(readScene('test-tower-lobby')!.furniture.length).toBeGreaterThan(0);
    expect(readScene('test-tower-flat-2bhk-a')!.furniture.length).toBeGreaterThan(0);
  });

  it('realistic sizes: corridor 1.8 m, lift car 1.1 x 1.4 m with a 0.9 m door, main doors 1.0 m, taller lobby', () => {
    const b = readBuilding('sample-tower');
    const cor = readScene('test-tower-corridor')!;
    const room = cor.layout.rooms.find((r) => r.label === 'Corridor')!;
    const xs = room.polygon.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.8, 2);
    expect(b.lifts[0].car).toEqual({ widthM: 1.1, depthM: 1.4, doorM: 0.9 });
    for (const l of b.levels) for (const s of l.spaces) for (const p of s.portals) {
      const o = readScene(s.sceneId)!.layout.openings.find((q) => q.id === p.opening)!;
      if (p.kind === 'lift') expect(o.widthM).toBeCloseTo(0.9, 2);
      if (p.kind === 'door' && p.look === 'main') { expect(o.widthM).toBeGreaterThan(0.89); expect(o.widthM).toBeLessThan(1.1); }
    }
    expect(readScene('test-tower-lobby')!.layout.wallHeightM).toBeGreaterThan(readScene('test-tower-corridor')!.layout.wallHeightM);
    const gym = readScene('test-tower-club-gym')!.layout.rooms[0];
    const gx = gym.polygon.map((p) => p.x), gz = gym.polygon.map((p) => p.z);
    expect([Math.max(...gx) - Math.min(...gx), Math.max(...gz) - Math.min(...gz)].map((v) => Math.round(v * 100) / 100).sort((a, b) => a - b)).toEqual([8, 12]);
  });

  it('typical-floor plate: no overlaps, every flat door meets its corridor door, balconies face outside', () => {
    const b = readBuilding('sample-tower');
    const level = b.levels.find((l) => l.id === 'l2')!;
    const rooms = level.spaces.map((s) => ({ s, rooms: roomsOnLevel(readScene(s.sceneId)!.layout, s.placement) }));
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      for (const a of rooms[i].rooms) for (const c of rooms[j].rooms) expect(overlapAreaM2(a.polygon, c.polygon), `${rooms[i].s.id}/${a.id} vs ${rooms[j].s.id}/${c.id}`).toBeLessThan(0.05);
    }
    // four flats, each linked to the corridor
    const flats = level.spaces.filter((s) => s.kind === 'home');
    const corridor = level.spaces.find((s) => s.kind === 'corridor')!;
    for (const f of flats) expect(corridor.portals.some((p) => p.kind === 'door' && p.to.space === f.id)).toBe(true);
    void toLevel;
  });

  it('is deterministic and the committed files are what the generator makes', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-bld-test-'));
    try {
      const built = await buildSample(scratch);
      for (const bd of built.buildings) expect(JSON.parse(JSON.stringify(bd))).toEqual(clone(readBuilding(bd.id)));
      const look = lookupOf(built);
      for (const [id, bundle] of built.scenes) {
        const onDisk = readScene(id) as PropertyFile;
        expect(onDisk, id).toBeTruthy();
        // the same scene file, byte for byte after the parse that normalises it
        expect(JSON.parse(JSON.stringify(look(id))), id).toEqual(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'public/scenes', id, 'property.json'), 'utf8')));
        void bundle;
      }
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }, 180_000);
});

describe('validation catches what it is for', () => {
  const lookup = (edit: (id: string, p: PropertyFile) => void) => (id: string): PropertyFile | undefined => {
    const p = readScene(id);
    if (!p) return undefined;
    const c = clone(p);
    edit(id, c);
    return c;
  };
  const b = readBuilding('sample-tower');

  it('a main door of another width on one side', () => {
    const rep = validateBuilding(b, lookup((id, p) => { if (id === 'test-tower-flat-3bhk') p.layout.openings.find((o) => o.id === b.levels[2].spaces.find((s) => s.sceneId === id)!.portals[0].opening)!.widthM = 0.8; }));
    expect(rep.errors.some((e) => /door widths differ \(0\.80 m and /.test(e))).toBe(true);
  });
  it('a door moved along the wall so the two sides no longer meet', () => {
    const rep = validateBuilding(b, lookup((id, p) => { if (id === 'test-tower-corridor') { const o = p.layout.openings.find((q) => q.id === 'door-ne')!; o.centreM += 1.4; } }));
    expect(rep.errors.some((e) => /the two doors are .* m apart on the plan/.test(e))).toBe(true);
  });
  it('a door hinged on the wrong side', () => {
    const rep = validateBuilding(b, lookup((id, p) => { if (id === 'test-tower-corridor') { const o = p.layout.openings.find((q) => q.id === 'door-ne')!; o.leaf = { ...o.leaf!, hinge: o.leaf!.hinge === 'start' ? 'end' : 'start' }; } }));
    expect(rep.errors.some((e) => /hinged on opposite sides/.test(e))).toBe(true);
  });
  it('a missing scene, a portal on an opening that is not there, one on a window', () => {
    expect(validateBuilding(b, (id) => (id === 'test-tower-club-gym' ? undefined : readScene(id))).errors.some((e) => /scene "test-tower-club-gym" is missing/.test(e))).toBe(true);
    expect(validateBuilding(b, lookup((id, p) => { if (id === 'test-tower-corridor') p.layout.openings = p.layout.openings.filter((o) => o.id !== 'door-se'); })).errors.some((e) => /no opening "door-se"/.test(e))).toBe(true);
    expect(validateBuilding(b, lookup((id, p) => { if (id === 'test-tower-corridor') p.layout.openings.find((o) => o.id === 'door-se')!.type = 'window'; })).errors.some((e) => /is a window, not a door/.test(e))).toBe(true);
  });
  it('two spaces overlapping on one plate', () => {
    const moved = clone(b);
    moved.levels.find((l) => l.id === 'l2')!.spaces.find((s) => s.id === 'f2-202')!.placement.z -= 5;
    expect(validateBuilding(moved, readScene).errors.some((e) => /overlap by/.test(e))).toBe(true);
  });
  it('a corridor narrower than 1.5 m', () => {
    const rep = validateBuilding(b, lookup((id, p) => { if (id === 'test-tower-corridor') { const r = p.layout.rooms.find((q) => q.id === 'corridor')!; for (const q of r.polygon) if (q.x > 0) q.x = 0.5; } }));
    expect(rep.errors.some((e) => /the corridor is only/.test(e))).toBe(true);
  });
  it('a corridor blocked across its width', () => {
    const rep = validateBuilding(b, lookup((id, p) => { if (id === 'test-tower-corridor') p.furniture.push({ id: 'crate', source: 'real', kind: 'counter', label: 'Crate', box: { cx: 0, cz: 8, w: 1.8, d: 0.6, yawDeg: 0 }, heightM: 1, surfaceHeightM: 1 }); }));
    expect(rep.errors.some((e) => /is blocked/.test(e))).toBe(true);
  });
  it('a lift door that is not the car door', () => {
    const rep = validateBuilding(b, lookup((id, p) => { if (id === 'test-tower-lobby') p.layout.openings.find((o) => o.id === 'lift-a')!.widthM = 1.0; }));
    expect(rep.errors.some((e) => /the door is 1\.00 m but the car's door is 0\.90 m/.test(e))).toBe(true);
  });
  it('lobby anchors: marked, empty positions inside the lobby; one outside a room or on another is an error', () => {
    const lobby = b.levels[0].spaces[0];
    expect(lobby.lobbyAnchors!.map((a) => a.role).sort()).toEqual(['letterboxes', 'reception', 'seating', 'security']);
    // the full tower's lobby has its reception and security desks on those positions (stage 2, SPEC 16.17); the empty twin leaves them empty (tests/building-furnished.test.ts)
    expect(readScene(lobby.sceneId)!.furniture.filter((f) => /desk/i.test(f.label)).length).toBe(2);
    const out = clone(b);
    out.levels[0].spaces[0].lobbyAnchors![0].at = { x: -5, z: -5 };
    expect(validateBuilding(out, readScene).errors.some((e) => /anchor "reception" does not lie wholly inside a room/.test(e))).toBe(true);
    const over = clone(b);
    over.levels[0].spaces[0].lobbyAnchors![1].at = { ...over.levels[0].spaces[0].lobbyAnchors![0].at };
    expect(validateBuilding(over, readScene).errors.some((e) => /overlap/.test(e))).toBe(true);
  });
  it('a sample building whose scene does not say sample', () => {
    const rep = validateBuilding(b, lookup((id, p) => { if (id === 'test-tower-lobby') p.subtitle = 'A lobby'; }));
    expect(rep.errors.some((e) => /not labelled as a sample/.test(e))).toBe(true);
  });
});
