// Stage 2 in the Sample Tower (SPEC 16.17, 18.8, 20): the full tower's gym, games area, banquet rooms, changing rooms and lobby are furnished from the shared-space
// catalogue, the lobby's pieces stand on the building's marked positions, nothing is blocked, the walkway is open, the empty twin stays bare.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProperty } from '../src/core/layout-validate';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { checkPlacement } from '../src/core/placement';
import { catalogItem } from '../src/core/catalog';
import { spaceSummary } from '../src/core/space-rules';
import { boxCorners, pointInBox } from '../src/core/geometry';
import { parseBuilding } from '../src/building/parse';
import type { PropertyFile } from '../src/types';

const ROOT = path.resolve(__dirname, '..');
const scene = (id: string): PropertyFile => validateProperty(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', id, 'property.json'), 'utf8')));
const building = (id: string) => parseBuilding(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/buildings', id, 'building.json'), 'utf8')));

describe('the full Sample Tower is furnished where the catalogue has pieces', () => {
  const full = building('sample-tower');
  const space = (id: string) => full.levels.flatMap((l) => l.spaces).find((s) => s.id === id)!;
  it('the gym, games area, banquet rooms, changing rooms and lobby open scenes with pieces, of the right kind', () => {
    for (const [id, kind, min] of [['gym', 'gym', 20], ['games', 'games', 8], ['hall-1', 'hall', 6], ['hall-2', 'hall', 5], ['lounge', 'hall', 4], ['changing-1', 'gym', 3], ['changing-2', 'gym', 4], ['lobby', 'lobby', 8]] as const) {
      const p = scene(space(id).sceneId);
      expect(p.spaceKind, id).toBe(kind);
      expect(p.furniture.length, id).toBeGreaterThanOrEqual(min);
      for (const it of p.furniture) expect(it.source).toBe('virtual');
    }
  });
  it('every piece fits or is tight: none is blocked, none stands in a doorway, and the walkway is open', () => {
    for (const id of ['gym', 'games', 'hall-1', 'hall-2', 'lounge', 'changing-1', 'changing-2', 'lobby']) {
      const p = scene(space(id).sceneId);
      const base = rasterizeLayout(p.layout);
      for (const it of p.furniture) {
        const grid = stampFurniture(base, p.furniture.filter((o) => o.id !== it.id));
        const r = checkPlacement(grid, catalogItem(it.catalogId!), it.box, p.layout.wallHeightM, true, 'other');
        expect(r.verdict, `${id}: ${it.catalogId}: ${r.message.slice(0, 140)}`).not.toBe('blocked');
      }
      const s = spaceSummary(p.layout, p.furniture, undefined, p.spaceKind);
      expect(s.walkway.clear, `${id}: ${s.walkway.message}`).toBe(true);
    }
  });
  it('the gym is a gym: 15 stations along the walls as the plan draws them; the first banquet hall has 24 seats, the second 20, the lounge 8', () => {
    const g = scene(space('gym').sceneId);
    const s = spaceSummary(g.layout, g.furniture, undefined, 'gym');
    expect(s.stations.total).toBeGreaterThanOrEqual(15);
    expect(g.furniture.filter((i) => i.catalogId === 'gym-treadmill')).toHaveLength(6);
    for (const [id, seats] of [['hall-1', 24], ['hall-2', 20], ['lounge', 8]] as const) {
      const h = scene(space(id).sceneId);
      expect(spaceSummary(h.layout, h.furniture, undefined, 'hall').seats, id).toBe(seats);
    }
  });
  it('the lobby\'s reception, security, seating and letterboxes stand on their anchors', () => {
    const lobby = space('lobby');
    const p = scene(lobby.sceneId);
    expect(lobby.lobbyAnchors!.map((a) => a.role).sort()).toEqual(['letterboxes', 'reception', 'seating', 'security']);
    const onto: Record<string, string> = { reception: 'lobby-desk', security: 'lobby-security-desk', seating: 'lobby-visitor-set', letterboxes: 'lobby-letterboxes' };
    for (const a of lobby.lobbyAnchors!) {
      const box = { cx: a.at.x, cz: a.at.z, w: a.footprint.w, d: a.footprint.d, yawDeg: a.yawDeg };
      const mine = p.furniture.filter((i) => i.catalogId === onto[a.role]);
      expect(mine.length, a.role).toBeGreaterThanOrEqual(1);
      for (const it of mine) for (const c of boxCorners(it.box)) expect(pointInBox(c, box, -0.08), `${a.role} piece inside its anchor (to 8 cm): ${JSON.stringify(c)}`).toBe(true);
      // turned as the anchor says
      for (const it of mine) expect(Math.abs((((it.box.yawDeg - a.yawDeg) % 360) + 360) % 360)).toBeLessThan(1e-6);
    }
    expect(p.furniture.some((i) => i.catalogId === 'sofa-3' || i.catalogId === 'sofa-2')).toBe(false); // the stand-in sofas are gone
    expect(p.furniture.filter((i) => i.catalogId === 'lobby-letterboxes')).toHaveLength(2);
  });
});

describe('the empty twin stays bare', () => {
  const empty = building('sample-tower-empty');
  it('its gym, games area, banquet rooms, changing rooms, open-air spaces and lobby are unfurnished, under their own scene ids, and still say what kind of space they are', () => {
    const spaces = empty.levels.flatMap((l) => l.spaces);
    for (const [id, kind] of [['gym', 'gym'], ['games', 'games'], ['hall-1', 'hall'], ['hall-2', 'hall'], ['lounge', 'hall'], ['changing-1', 'gym'], ['changing-2', 'gym'], ['deck', 'garden'], ['aqua', 'pool'], ['pool', 'pool'], ['lobby', 'lobby']] as const) {
      const s = spaces.find((x) => x.id === id)!;
      const p = scene(s.sceneId);
      expect(p.furniture, id).toEqual([]);
      expect(p.spaceKind).toBe(kind);
      expect(s.sceneId).toMatch(/empty/);
    }
    expect(empty.bare).toBe(true);
  });
  it('the full tower\'s gym scene is not the twin\'s', () => {
    const full = building('sample-tower');
    const a = full.levels.flatMap((l) => l.spaces).find((x) => x.id === 'gym')!.sceneId;
    const b = empty.levels.flatMap((l) => l.spaces).find((x) => x.id === 'gym')!.sceneId;
    expect(a).not.toBe(b);
  });
});
