import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unverifiedRoomsFromExtras } from '../src/core/room-trust';
import { doorLooksFor, lookOf, portalPrompt } from '../src/building/portal-looks';
import { levelPlan, spaceArea } from '../src/building/level-plan';
import type { SceneInfo } from '../src/building/load';
import { readBuilding, readScene } from './helpers/sample-building';

const b = readBuilding('sample-tower');
const space = (id: string) => b.levels.flatMap((l) => l.spaces).find((s) => s.id === id)!;

describe('portal doors', () => {
  it('a flat door from the corridor carries a number plate on the corridor side, from inside the flat on the other', () => {
    const cor = doorLooksFor(space('f2-corridor'));
    expect(cor.get('door-ne')).toEqual({ kind: 'main', text: '201', plateSide: 1 });
    const flat = doorLooksFor(space('f2-201'));
    expect(flat.get(space('f2-201').portals[0].opening)).toEqual({ kind: 'main', text: '201', plateSide: -1 });
  });
  it('lifts are steel, the stairs are marked, the street door is glass', () => {
    const cor = doorLooksFor(space('f2-corridor'));
    expect(cor.get('lift-a')).toEqual({ kind: 'lift' });
    expect(cor.get('door-stairs')).toEqual({ kind: 'stairs', text: 'STAIRS', plateSide: 1 });
    expect(doorLooksFor(space('lobby')).get('door-street')).toEqual({ kind: 'glass' });
    expect(lookOf({ id: 'x', kind: 'door', opening: 'o', to: { space: 's', portal: 'p' }, label: 'L' })).toBe('plain');
  });
  it('the prompts say where each goes', () => {
    const prompts = (id: string) => space(id).portals.map((p) => portalPrompt(p));
    expect(prompts('f2-corridor')).toEqual(['Call lift', 'Call lift', 'Stairs (not walkable yet)', 'Enter Flat 201', 'Enter Flat 202', 'Enter Flat 203', 'Enter Flat 204']);
    expect(prompts('f3-302')).toEqual(['To the corridor']);
    expect(prompts('lobby')).toContain('To the clubhouse');
  });
  it('every flat opens onto the corridor of its own level, and the plates carry the level', () => {
    for (const lv of ['2', '3']) for (const n of ['01', '02', '03', '04']) {
      const s = space(`f${lv}-${lv}${n}`);
      expect(s.name.startsWith(`Flat ${lv}${n} `)).toBe(true);
      expect(s.portals[0]).toMatchObject({ kind: 'door', to: { space: `f${lv}-corridor` }, plate: `${lv}${n}` });
    }
  });
});

describe('the building map', () => {
  const scenes = (ids: string[]): Map<string, SceneInfo> => new Map(ids.map((id) => [id, { property: readScene(id)!, unverified: (id === 'test-tower-flat-2bhk-a-m' ? { passage: 'drawing and label disagree' } : {}) as Record<string, string> }]));

  it('draws every space of a level, outlined and named, with no per-room labels', () => {
    const lv = b.levels.find((l) => l.id === 'l1')!;
    const plan = levelPlan(b, lv, scenes([...new Set(lv.spaces.map((s) => s.sceneId))]), { idPrefix: 't' });
    expect(plan.boxes.map((x) => x.spaceId)).toEqual(lv.spaces.map((s) => s.id));
    expect((plan.svg.match(/class="bm-space/g) ?? []).length).toBe(lv.spaces.length);
    expect(plan.svg).not.toMatch(/class="plan-label/);
    for (const name of ['Community hall', 'Gym', 'Clubhouse foyer']) expect(plan.svg).toContain(name);
    // a placeholder for a later stage is still labelled as one (no space of the sample is one any more: the pool and the garden are finished)
    expect(plan.svg).not.toMatch(/Coming in the next stage/);
    const lv2 = structuredClone(lv);
    lv2.spaces.find((s) => s.id === 'gym')!.comingNext = true;
    expect(levelPlan(b, lv2, scenes([...new Set(lv2.spaces.map((s) => s.sceneId))]), { idPrefix: 't' }).svg).toMatch(/Coming in the next stage/);
  });
  it('a flat states its carpet area from its own rooms: every flat of the tower has one, and one with a room not measured has none', () => {
    const extras = (id: string): Record<string, string> => {
      const f = path.resolve(import.meta.dirname, '..', 'public/scenes', id, 'proposal-extras.json');
      return fs.existsSync(f) ? unverifiedRoomsFromExtras(JSON.parse(fs.readFileSync(f, 'utf8'))) : {};
    };
    for (const id of ['f2-201', 'f2-202', 'f2-203', 'f2-204']) {
      const s = space(id);
      const a = spaceArea(s, { property: readScene(s.sceneId)!, unverified: extras(s.sceneId) });
      expect(a.measured, id).toBe(true);
      expect(a.text, id).toMatch(/^[\d,]+ sq ft carpet$/);
    }
    const s = space('f2-203');
    const p = readScene(s.sceneId)!;
    const kitchen = p.layout.rooms.find((r) => r.roomType === 'kitchen')!;
    const not = spaceArea(s, { property: p, unverified: { [kitchen.id]: 'label size only' } });
    expect(not.measured).toBe(false);
    expect(not.text).toBe('area not confirmed');
    // a balcony the drawing does not confirm never takes the number away
    const balcony = p.layout.rooms.find((r) => r.roomType === 'balcony')!;
    expect(spaceArea(s, { property: p, unverified: { [balcony.id]: 'size not confirmed yet' } }).measured).toBe(true);
    const soon = spaceArea({ ...space('pool'), comingNext: true }, { property: readScene('test-tower-club-pool')!, unverified: {} });
    expect(soon.measured).toBe(false);
    expect(soon.text).toMatch(/placeholder/);
  });
  it('puts the walker on the plan where they stand', () => {
    const lv = b.levels.find((l) => l.id === 'l1')!;
    const plan = levelPlan(b, lv, scenes([...new Set(lv.spaces.map((s) => s.sceneId))]), { idPrefix: 't', here: { spaceId: 'gym', point: { x: 6, z: -2 } } });
    expect(plan.svg).toContain('bm-you-dot');
    expect(plan.svg).toMatch(/class="bm-space is-here/);
  });
  it('escapes names', () => {
    const lv = structuredClone(b.levels.find((l) => l.id === 'l1')!);
    lv.spaces[1].name = 'Hall <img src=x onerror=alert(1)>';
    const plan = levelPlan(b, lv, scenes([...new Set(lv.spaces.map((s) => s.sceneId))]), { idPrefix: 't' });
    expect(plan.svg).not.toContain('<img');
  });
});

import { signText as _signText } from '../src/building/portal-looks';
import { signWidthM } from '../src/building/signs';
describe('signboards over portal doors', () => {
  const sp = (kind: string) => ({ kind } as never);
  const door = (label: string, plate?: string) => ({ id: 'd', kind: 'door', opening: 'o', to: { space: 's', portal: 'p' }, label, ...(plate ? { plate } : {}) } as never);
  it('names where the door leads, without the article', () => {
    expect(_signText(door('The clubhouse foyer'), sp('gym'))).toBe('Clubhouse foyer');
    expect(_signText(door('Pool area'), sp('corridor'))).toBe('Pool area');
  });
  it('lifts and the way out are named; a numbered flat door, the stairs and a home get none', () => {
    expect(_signText({ id: 'l', kind: 'lift', opening: 'o', lift: 'a' } as never, sp('lobby'))).toBe('Lift');
    expect(_signText({ id: 's', kind: 'outside', opening: 'o', label: 'The street' } as never, sp('lobby'))).toBe('Exit');
    expect(_signText(door('Flat 201', '201'), sp('corridor'))).toBeNull();
    expect(_signText({ id: 's', kind: 'stairs', opening: 'o', label: 'Stairs' } as never, sp('corridor'))).toBeNull();
    expect(_signText(door('The corridor'), sp('home'))).toBeNull();
  });
  it('a flat door names the flat and its type from the building file', () => {
    const b = { flatTypes: { t: { name: '2 BHK' } }, levels: [{ spaces: [{ id: 's', type: 't' }] }] } as never;
    expect(_signText(door('Flat 204', '204'), sp('corridor'), b)).toBe('Flat 204 · 2 BHK');
    expect(_signText(door('Flat 204', '204'), sp('home'), b)).toBeNull();
  });
  it('the board is sized by its words, within limits', () => {
    expect(signWidthM('Gym')).toBe(0.5);
    expect(signWidthM('Community hall')).toBeCloseTo(1.25);
    expect(signWidthM('x'.repeat(40))).toBe(1.8);
  });
});
