// The clubhouse level's L-shaped water (three touching basins that share their water, SPEC 19.3 and 20) and the pieces its games area, banquet halls and aqua play add.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowedIn, categoriesFor, trayWords } from '../src/core/places';
import { catalogItem } from '../src/core/catalog';
import { pieceRule } from '../src/core/pieces';
import { levelPlan, labelPoint } from '../src/building/level-plan';
import { copingRects, depthAt, exposureOf, waterObstacles } from '../src/outdoor/pool';
import { unionOutline } from '../src/outdoor/outline';
import { validateOutdoor } from '../src/outdoor/validate';
import { walkwayReport } from '../src/outdoor/walkway';
import { parseOutdoor } from '../src/outdoor/types';
import type { OutdoorFile, PoolBasin } from '../src/outdoor/types';
import { EMPTY_IDS, FULL_IDS } from '../scripts/building/podium-level';
import { readBuilding, readScene } from './helpers/sample-building';

const ROOT = path.resolve(import.meta.dirname, '..');
const outdoorOf = (sceneId: string): OutdoorFile => parseOutdoor(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', sceneId, 'outdoor.json'), 'utf8')));
const full = readBuilding('sample-tower');

describe('the L-shaped water: three basins that touch and share their water', () => {
  const wing = outdoorOf(FULL_IDS.wing);
  const [shallow, lap, ledge] = ['shallow', 'lap', 'ledge'].map((id) => wing.pools.find((p) => p.id === id)!) as [PoolBasin, PoolBasin, PoolBasin];
  it('the three rectangles make one outline of ten corners, the L the plan draws', () => {
    const loops = unionOutline(wing.pools.map((p) => p.rect));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(10);
    const area = (p: { x: number; z: number }[]): number => Math.abs(p.reduce((s, q, k) => { const n = p[(k + 1) % p.length]; return s + (q.x * n.z - n.x * q.z); }, 0) / 2);
    expect(area(loops[0])).toBeCloseTo(wing.pools.reduce((s, p) => s + (p.rect.x1 - p.rect.x0) * (p.rect.z1 - p.rect.z0), 0), 6);
  });
  it('the deck has one hole of that shape, the water and its coping, not three holes', () => {
    const holes = wing.areas.find((a) => a.id === 'ground')!.holes!;
    expect(holes).toHaveLength(1);
    expect(holes[0]).toHaveLength(10);
    const grown = unionOutline(wing.pools.map((p) => ({ x0: p.rect.x0 - p.copingM, z0: p.rect.z0 - p.copingM, x1: p.rect.x1 + p.copingM, z1: p.rect.z1 + p.copingM })))[0];
    expect(holes[0]).toEqual(grown);
  });
  it('touching basins have seams, and no coping runs over another basin\'s water', () => {
    const ex = exposureOf(shallow, wing.pools);
    expect(ex.seams.map((s) => s.side)).toEqual(['E']);
    expect(ex.exposed.E.length).toBe(1);
    const exLap = exposureOf(lap, wing.pools);
    expect(exLap.seams.map((s) => `${s.side}:${s.other.id}`).sort()).toEqual(['W:ledge', 'W:shallow']);
    for (const b of wing.pools) for (const c of copingRects(b, exposureOf(b, wing.pools))) for (const o of wing.pools) {
      if (o === b) continue;
      const eps = 1e-6;
      const overlaps = c.x0 < o.rect.x1 - eps && c.x1 > o.rect.x0 + eps && c.z0 < o.rect.z1 - eps && c.z1 > o.rect.z0 + eps;
      expect(overlaps, `coping of ${b.id} lies over the water of ${o.id}`).toBe(false);
    }
  });
  it('the floor is continuous across the shallow pool and the lap pool (1.2 m at the seam), the ledge is shallow, and the lap depths are the typical profile', () => {
    const z = (shallow.rect.z0 + shallow.rect.z1) / 2 + 3;
    expect(depthAt(shallow, shallow.rect.x1 - 0.01, z)).toBeCloseTo(1.2, 2);
    expect(depthAt(lap, lap.rect.x0 + 0.01, z)).toBeCloseTo(1.2, 2);
    expect(depthAt(ledge, ledge.rect.x0 + 0.2, ledge.rect.z0 + 2)).toBeCloseTo(0.45, 2);
    expect(lap.profile).toEqual([[0, 1.2], [0.4, 1.2], [0.75, 1.7], [1, 1.7]]);
  });
  it('validates clean (basins that touch are one body of water; apart they must not overlap), and the walker is stopped at every basin', () => {
    const p = readScene(FULL_IDS.wing)!;
    expect(validateOutdoor(wing, p.layout)).toEqual({ errors: [], warnings: [] });
    const bad = JSON.parse(JSON.stringify(wing)) as OutdoorFile;
    bad.pools[1].rect.x0 -= 1; // the lap pool pushed into the shallow pool
    expect(validateOutdoor(bad, p.layout).errors.join(' ')).toMatch(/overlap/);
    expect(waterObstacles(wing.pools)).toHaveLength(3);
  });
  it('the walkway round the water reads only the edge that meets the deck: the bare deck is tight only on the east, by the planting strip, where the plan leaves about 1.1 m', () => {
    const bare = outdoorOf(EMPTY_IDS.wing);
    const p = readScene(EMPTY_IDS.wing)!;
    const rep = walkwayReport(bare.pools, p.layout.rooms[0].polygon, []);
    expect(rep.sides.map((s) => `${s.basin}${s.side}`).sort()).toEqual(['ledgeN', 'ledgeS', 'ledgeW', 'lapE', 'lapN', 'lapS', 'lapW', 'shallowE', 'shallowN', 'shallowS', 'shallowW'].sort());
    for (const s of rep.sides) expect(s.by, `${s.basin}${s.side}`).not.toMatch(/pool/);
    expect(rep.sides.filter((s) => s.verdict !== 'clear').map((s) => `${s.basin}${s.side}`)).toEqual(['lapE']);
    const east = rep.sides.find((s) => s.basin === 'lap' && s.side === 'E')!;
    expect(east.clearM).toBeGreaterThan(1.0);
    expect(east.clearM).toBeLessThan(1.2);
  });
  it('the furnished wing\'s loungers are slid back from the water so the shallow pool\'s west deck keeps its 1.2 m, and only the east wall is short (a note, not an alarm)', () => {
    const p = readScene(FULL_IDS.wing)!;
    const obs = p.furniture.map((f) => ({ box: f.box, heightM: f.heightM, label: f.label }));
    const rep = walkwayReport(wing.pools, p.layout.rooms[0].polygon, obs);
    expect(rep.verdict).toBe('tight');
    expect(rep.sides.find((s) => s.basin === 'shallow' && s.side === 'W')!.verdict).toBe('clear');
    expect(rep.sides.filter((s) => s.verdict !== 'clear').map((s) => s.by)).toEqual(['a wall']);
    expect(p.furniture.filter((f) => f.catalogId === 'pool-lounger')).toHaveLength(15);
    // the plan draws the west row with its feet at the water: that layout is blocked, as the card would say if a visitor put it back
    const drawn = obs.map((o, i) => (p.furniture[i].catalogId === 'pool-lounger' && p.furniture[i].box.yawDeg === 90 ? { ...o, box: { ...o.box, cx: 1.79 } } : o));
    expect(walkwayReport(wing.pools, p.layout.rooms[0].polygon, drawn).sides.find((s) => s.basin === 'shallow' && s.side === 'W')!.by).toBe('Pool lounger');
  });
  it('the map draws the wing as its own outline, not a box, with every basin\'s water over the coping', () => {
    const lv = full.levels.find((l) => l.id === 'l1')!;
    const ids = [...new Set(lv.spaces.map((s) => s.sceneId))];
    const scenes = new Map(ids.map((id) => [id, { property: readScene(id)!, unverified: {}, outdoor: ['pool', 'garden'].includes(readScene(id)!.spaceKind!) ? outdoorOf(id) : null }]));
    const plan = levelPlan(full, lv, scenes, { idPrefix: 't' });
    expect(plan.svg).toMatch(/<polygon class="bm-outline" points="[^"]+"/);
    expect(plan.svg.indexOf('class="bm-coping"')).toBeLessThan(plan.svg.indexOf('class="bm-water"'));
    const box = plan.boxes.find((b) => b.spaceId === 'pool')!;
    expect(box.rects[0].poly!.length).toBe(10);
    const lp = labelPoint(box.rects[0].poly!);
    expect(lp.x).toBeGreaterThan(box.x0); expect(lp.x).toBeLessThan(box.x1);
  });
});

describe('the pieces the games area, banquet halls and aqua play add', () => {
  it('a games room offers the games pieces and not the stage; a hall offers the banquet sets and not the foosball; the pool kind offers the aqua features', () => {
    for (const id of ['games-foosball', 'games-chess-set', 'games-card-set', 'games-carrom-set']) { expect(allowedIn(id, 'games'), id).toBe(true); expect(allowedIn(id, 'hall'), id).toBe(false); expect(allowedIn(id, 'home'), id).toBe(false); }
    for (const id of ['hall-table-tennis', 'hall-pool-table', 'hall-carrom', 'hall-chair']) { expect(allowedIn(id, 'games'), id).toBe(true); expect(allowedIn(id, 'hall'), id).toBe(true); }
    expect(allowedIn('hall-stage-40', 'games')).toBe(false);
    for (const id of ['hall-banquet-set-4', 'hall-cafe-set-2']) { expect(allowedIn(id, 'hall'), id).toBe(true); expect(allowedIn(id, 'games'), id).toBe(false); }
    for (const id of ['aqua-tower', 'aqua-sun', 'aqua-mushroom', 'aqua-jets']) { expect(allowedIn(id, 'pool'), id).toBe(true); expect(allowedIn(id, 'hall'), id).toBe(false); expect(allowedIn(id, 'garden'), id).toBe(false); }
    expect(allowedIn('garden-bench', 'pool')).toBe(true);
    expect(categoriesFor('games').map((c) => c.id)).toContain('games');
    expect(trayWords('games').title).toBe('Add to the games room');
  });
  it('the table tennis table, the pool table and the others are at their real typical sizes, with the clearances stated as typical guidance', () => {
    const tt = catalogItem('hall-table-tennis');
    expect(tt.footprint).toEqual({ w: 2.74, d: 1.525 });
    expect(tt.surfaceHeightM).toBeCloseTo(0.76, 3);
    const pool = catalogItem('hall-pool-table');
    expect(pool.footprint).toEqual({ w: 2.54, d: 1.42 });
    const cue = pieceRule('hall-pool-table')!.zones![0];
    expect(cue.needM).toBe(1.5);
    expect(String(cue.assumption)).toMatch(/typical guidance/);
    expect(catalogItem('games-foosball').footprint).toEqual({ w: 1.4, d: 1.2 });
    expect(catalogItem('games-chess-set').footprint).toEqual({ w: 0.6, d: 1.44 });
    expect(catalogItem('games-card-set').footprint).toEqual({ w: 1.7, d: 1.7 });
    expect(catalogItem('games-carrom-set').footprint).toEqual({ w: 1.6, d: 1.6 });
    expect(catalogItem('hall-banquet-set-4').footprint).toEqual({ w: 1.7, d: 1.7 });
    expect(catalogItem('aqua-jets').footprint.w).toBe(12);
  });
  it('the games area is furnished with every game the legend names', () => {
    const p = readScene(FULL_IDS.games)!;
    const ids = p.furniture.map((f) => f.catalogId);
    for (const id of ['hall-pool-table', 'hall-table-tennis', 'games-foosball', 'games-carrom-set', 'games-chess-set', 'games-card-set', 'sofa-3']) expect(ids, id).toContain(id);
    expect(p.spaceKind).toBe('games');
  });
});
