import { describe, expect, it } from 'vitest';
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
    expect(flat.get('door-main')).toEqual({ kind: 'main', text: '201', plateSide: -1 });
  });
  it('lifts are steel, the stairs are marked, the street door is glass', () => {
    const cor = doorLooksFor(space('f2-corridor'));
    expect(cor.get('lift-a')).toEqual({ kind: 'lift' });
    expect(cor.get('door-stairs')).toEqual({ kind: 'stairs', text: 'STAIRS', plateSide: 1 });
    expect(doorLooksFor(space('st-lobby')).get('door-street')).toEqual({ kind: 'glass' });
    expect(lookOf({ id: 'x', kind: 'door', opening: 'o', to: { space: 's', portal: 'p' }, label: 'L' })).toBe('plain');
  });
  it('the prompts say where each goes', () => {
    const prompts = (id: string) => space(id).portals.map((p) => portalPrompt(p));
    expect(prompts('f2-corridor')).toEqual(['Call lift', 'Call lift', 'Stairs (not walkable yet)', 'Enter Flat 201', 'Enter Flat 202', 'Enter Flat 203', 'Enter Flat 204']);
    expect(prompts('f3-302')).toEqual(['To the corridor']);
    expect(prompts('st-lobby')).toContain('To the clubhouse');
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
  const scenes = (ids: string[]): Map<string, SceneInfo> => new Map(ids.map((id) => [id, { property: readScene(id)!, unverified: (id === 'st-flat-2bhk-a-m' ? { passage: 'drawing and label disagree' } : {}) as Record<string, string> }]));

  it('draws every space of a level, outlined and named, with no per-room labels', () => {
    const lv = b.levels.find((l) => l.id === 'l1')!;
    const plan = levelPlan(b, lv, scenes([...new Set(lv.spaces.map((s) => s.sceneId))]), { idPrefix: 't' });
    expect(plan.boxes.map((x) => x.spaceId)).toEqual(lv.spaces.map((s) => s.id));
    expect((plan.svg.match(/class="bm-space/g) ?? []).length).toBe(lv.spaces.length);
    expect(plan.svg).not.toMatch(/class="plan-label/);
    for (const name of ['Community hall', 'Gym', 'Clubhouse foyer']) expect(plan.svg).toContain(name);
    expect(plan.svg).toMatch(/Coming in the next stage/);
  });
  it('a flat states its carpet area from its own rooms, and not when a room was not measured', () => {
    const measured = spaceArea(space('f2-202'), { property: readScene('st-flat-1bhk')!, unverified: {} });
    expect(measured.measured).toBe(true);
    expect(measured.text).toMatch(/^[\d,]+ sq ft carpet$/);
    const not = spaceArea(space('f2-203'), scenes(['st-flat-2bhk-a-m']).get('st-flat-2bhk-a-m')!);
    expect(not.measured).toBe(false);
    expect(not.text).toBe('area not confirmed');
    const soon = spaceArea(space('st-1-pool'), { property: readScene('st-1-pool')!, unverified: {} });
    expect(soon.measured).toBe(false);
    expect(soon.text).toMatch(/placeholder/);
  });
  it('puts the walker on the plan where they stand', () => {
    const lv = b.levels.find((l) => l.id === 'l1')!;
    const plan = levelPlan(b, lv, scenes([...new Set(lv.spaces.map((s) => s.sceneId))]), { idPrefix: 't', here: { spaceId: 'st-1-gym', point: { x: 6, z: -2 } } });
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
