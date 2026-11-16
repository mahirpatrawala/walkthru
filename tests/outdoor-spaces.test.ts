// Outdoor spaces (SPEC 19): the data format and its checks, the sample pool area and garden (finished and bare), the pool's numbers (depth profile, steps,
// what stops the walker), the person-against-the-water card, the walkway verdict, the planting, the plan the map draws, and that an open-air shell has no
// ceiling or indoor kit. No GPU: the pictures are checked in a browser (SPEC 19.10).
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { catalogItem } from '../src/core/catalog';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { checkPlacement } from '../src/core/placement';
import { buildShell } from '../src/engine/shell';
import { kitPlan } from '../src/look/kit/rules';
import { PEOPLE_PRESETS, depthCardModel, sectionSvg } from '../src/outdoor/depth-card';
import { ownedEdges } from '../src/outdoor/load';
import { hedgeBlockTriangles, mountFoliage, speciesTriangles } from '../src/outdoor/foliage';
import { outdoorPlanArt } from '../src/outdoor/plan-art';
import { ADULT, CHILD, TODDLER, depthAt, depthSentence, floorY, levelAgainst, markerStations, profileDepth, stepRects, waterAt, waterLevelY, waterObstacles } from '../src/outdoor/pool';
import { allHedges, allPlants, plantBudget, plantRow, plantsForTier, scatterBed } from '../src/outdoor/plants';
import { parseOutdoor } from '../src/outdoor/types';
import type { OutdoorFile, PoolBasin } from '../src/outdoor/types';
import { validateOutdoor } from '../src/outdoor/validate';
import { deckObstacles, nearestWater } from '../src/outdoor/pool-ui';
import { walkwayReport, walkwaySides } from '../src/outdoor/walkway';
import { clubhouseScenes } from '../scripts/building/spaces';
import { gardenFurniture, poolFurniture } from '../scripts/building/outdoor-spaces';
import { clone, readScene } from './helpers/sample-building';
import type { FurnitureItem } from '../src/types';

const ROOT = path.resolve(import.meta.dirname, '..');
const outdoorOf = (sceneId: string): OutdoorFile => parseOutdoor(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', sceneId, 'outdoor.json'), 'utf8')));
const POOL = 'test-tower-club-pool', GARDEN = 'test-tower-club-garden', POOL_BARE = 'test-tower-empty-club-pool', GARDEN_BARE = 'test-tower-empty-club-garden';
const IDS = { foyer: 'test-tower-club-foyer', hall: 'test-tower-club-hall', gym: 'test-tower-club-gym', pool: POOL, garden: GARDEN, poolBare: POOL_BARE, gardenBare: GARDEN_BARE };

describe('outdoor.json: the data format', () => {
  const good = (): Record<string, unknown> => clone(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', POOL, 'outdoor.json'), 'utf8')));
  it('the committed files parse, and parsing them again gives the same thing', () => {
    for (const id of [POOL, GARDEN, POOL_BARE, GARDEN_BARE]) { const f = outdoorOf(id); expect(parseOutdoor(JSON.parse(JSON.stringify(f)))).toEqual(f); }
  });
  it('rejects what is wrong, naming the place', () => {
    const bad = (edit: (o: Record<string, any>) => void, message: RegExp): void => { const o = good(); edit(o); expect(() => parseOutdoor(o)).toThrow(message); };
    bad((o) => { o.version = 2; }, /version/);
    bad((o) => { o.areas[0].finish = 'marble'; }, /areas\[0\]\.finish/);
    bad((o) => { o.areas[0].polygon = [{ x: 0, z: 0 }]; }, /areas\[0\]\.polygon/);
    bad((o) => { o.pools[0].profile = [[0.1, 1.2], [1, 1.7]]; }, /start at 0/);
    bad((o) => { o.pools[0].profile = [[0, 1.2], [0.5, 1.2], [0.4, 1.7], [1, 1.7]]; }, /positions must increase/);
    bad((o) => { o.pools[0].profile[1][1] = 9; }, /profile\[1\]\[1\]/);
    bad((o) => { o.pools[0].rect = { x0: 5, z0: 0, x1: 2, z1: 3 }; }, /x1 > x0/);
    bad((o) => { o.pools[0].shallowEnd = 'Q'; }, /shallowEnd/);
    bad((o) => { o.boundary[0].kind = 'moat'; }, /boundary\[0\]\.kind/);
    bad((o) => { o.trees = [{ species: 'oak', x: 0, z: 0 }]; }, /trees\[0\]\.species/);
    bad((o) => { o.pools[1].id = 'main'; }, /used twice/);
    bad((o) => { o.areas[0].edgingM = 3; }, /edgingM/);
  });
  it('a missing file is simply an indoor scene (the reader returns null for nothing)', () => { expect(() => parseOutdoor(null)).toThrow(/not an object/); });
});

describe('the sample spaces', () => {
  it('both pool areas and both gardens validate clean against their scenes', () => {
    for (const id of [POOL, GARDEN, POOL_BARE, GARDEN_BARE]) {
      const rep = validateOutdoor(outdoorOf(id), readScene(id)!.layout);
      expect(rep.errors, id).toEqual([]);
      expect(rep.warnings, id).toEqual([]);
    }
  });
  it('are kinds pool and garden, labelled as samples, with no ceiling checks to make (a tall facade), and no longer a placeholder', () => {
    for (const id of [POOL, GARDEN, POOL_BARE, GARDEN_BARE]) {
      const p = readScene(id)!;
      expect(p.spaceKind).toBe(id.includes('pool') ? 'pool' : 'garden');
      expect(p.subtitle).toMatch(/Sample building/);
      expect(p.layout.wallHeightM).toBeGreaterThan(8);
      expect(p.title).not.toMatch(/placeholder/i);
    }
  });
  it('the generator is deterministic and the committed outdoor.json and scenes are what it writes', () => {
    const club = clubhouseScenes(IDS);
    const compare = (id: string, scene: unknown, outdoor: unknown): void => {
      expect(JSON.parse(JSON.stringify(scene)), id).toEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', id, 'property.json'), 'utf8')));
      expect(JSON.parse(JSON.stringify(outdoor)), id).toEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', id, 'outdoor.json'), 'utf8')));
    };
    compare(POOL, club.pool, club.outdoor.pool); compare(GARDEN, club.garden, club.outdoor.garden);
    compare(POOL_BARE, club.poolBare, club.outdoor.poolBare); compare(GARDEN_BARE, club.gardenBare, club.outdoor.gardenBare);
    const again = clubhouseScenes(IDS);
    expect(JSON.stringify(again.outdoor)).toBe(JSON.stringify(club.outdoor));
  });
  it('the bare ones have the deck, the basins and the lawn and nothing placed or planted', () => {
    for (const id of [POOL_BARE, GARDEN_BARE]) {
      const f = outdoorOf(id);
      expect(readScene(id)!.furniture).toEqual([]);
      expect(f.trees.length + f.beds.length + f.rows.length + f.roofs.length).toBe(0);
    }
    expect(outdoorOf(POOL_BARE).pools.length).toBe(2);
    expect(outdoorOf(GARDEN_BARE).areas.some((a) => a.finish === 'lawn')).toBe(true);
    expect(outdoorOf(POOL).pools.map((p) => p.kids === true)).toEqual([false, true]);
  });
  it('every piece of the finished spaces fits where it stands: no collision, no blocked fall zone or arc, none outside', () => {
    for (const id of [POOL, GARDEN]) {
      const p = readScene(id)!;
      const grid = rasterizeLayout(p.layout);
      const pools = outdoorOf(id).pools;
      const water = waterObstacles(pools).map((o, i) => ({ id: `water-${i}`, source: 'virtual', kind: 'wardrobe', label: 'water', box: o.box, heightM: o.heightM, surfaceHeightM: 0 }) as FurnitureItem);
      const problems: string[] = [];
      for (const it of p.furniture) {
        const others = [...p.furniture.filter((x) => x.id !== it.id), ...water];
        const g = stampFurniture(grid, others);
        const r = checkPlacement(g, catalogItem(it.catalogId!), it.box, p.layout.wallHeightM, true, 'other');
        if (r.verdict !== 'fits') problems.push(`${id}: ${it.id} at (${it.box.cx}, ${it.box.cz}) is ${r.verdict}: ${r.message}`);
      }
      expect(problems).toEqual([]);
    }
  });
  it('the pool area is a pool piece set and the garden a garden piece set (and the lamps and planters shared)', () => {
    for (const i of poolFurniture()) expect(catalogItem(i.catalogId!).places, i.catalogId).toContain('pool');
    for (const i of gardenFurniture()) expect(catalogItem(i.catalogId!).places, i.catalogId).toContain('garden');
  });
});

describe('the pool: depth profile, steps, what stops the walker', () => {
  const main = outdoorOf(POOL).pools[0], kids = outdoorOf(POOL).pools[1];
  it('the shallow end is 1.2 m and the deep end 1.7 m, the floor slopes between', () => {
    expect(profileDepth(main, 0)).toBeCloseTo(1.2, 5);
    expect(profileDepth(main, 1)).toBeCloseTo(1.7, 5);
    expect(profileDepth(main, 0.2)).toBeCloseTo(1.2, 5);
    expect(profileDepth(main, 0.575)).toBeCloseTo(1.45, 2);
    let last = 0;
    for (let u = 0; u <= 1; u += 0.05) { const d = profileDepth(main, u); expect(d).toBeGreaterThanOrEqual(last - 1e-9); last = d; }
    expect(profileDepth(kids, 0)).toBeCloseTo(0.45); expect(profileDepth(kids, 1)).toBeCloseTo(0.6);
  });
  it('depth at a point: the profile, shallower on a step, none outside', () => {
    const R = main.rect;
    expect(depthAt(main, R.x0 + 4.5, R.z0 + 2)).toBeCloseTo(1.2 + (1.7 - 1.2) * ((4.5 / 11 - 0.4) / 0.35), 2);
    expect(depthAt(main, R.x1 - 0.1, R.z0 + 2)).toBeCloseTo(1.7, 5);
    expect(depthAt(main, R.x0 - 0.5, R.z0 + 2)).toBeNull();
    expect(depthAt(main, R.x0 + 0.1, R.z0 - 0.5)).toBeNull();
    // the three steps in the west end, 0.3 m deep each: 0.3, 0.52, 0.74 below the water
    const steps = stepRects(main).filter((s) => s.flight === 0);
    expect(steps.map((s) => +s.depthM.toFixed(2))).toEqual([0.3, 0.52, 0.74]);
    for (const s of steps) expect(depthAt(main, (s.rect.x0 + s.rect.x1) / 2, (s.rect.z0 + s.rect.z1) / 2)).toBeCloseTo(s.depthM, 5);
    // beside the steps it is the floor
    expect(depthAt(main, R.x0 + 0.3, R.z0 + 0.2)).toBeCloseTo(1.2, 5);
    // a step is never above the floor that holds it up
    for (const s of stepRects(main)) expect(s.depthM).toBeLessThanOrEqual(profileDepth(main, 0) + 1e-9);
  });
  it('the water sits 12 cm under the deck, the floor is below it', () => {
    expect(waterLevelY(main)).toBeCloseTo(-0.12);
    expect(floorY(main, main.rect.x1 - 0.2, main.rect.z0 + 2)).toBeCloseTo(-0.12 - 1.7, 5);
    expect(floorY(main, 0, 0)).toBeNull();
  });
  it('waterAt finds the basin under a point, the deck is dry', () => {
    expect(waterAt([main, kids], 22, -2.5)?.basin.id).toBe('main');
    expect(waterAt([main, kids], 30.4, -3.6)?.basin.id).toBe('kids');
    expect(waterAt([main, kids], 22, 2)).toBeNull();
  });
  it('a walker cannot walk on water: each basin is an obstacle over its whole rectangle, and the deck round it is free', () => {
    const p = readScene(POOL)!;
    const grid = rasterizeLayout(p.layout);
    const water = waterObstacles([main, kids]).map((o, i) => ({ id: `w${i}`, source: 'virtual', kind: 'wardrobe', label: 'water', box: o.box, heightM: o.heightM, surfaceHeightM: 0 }) as FurnitureItem);
    const g = stampFurniture(grid, water);
    const cellAt = (x: number, z: number): number => g.cells[Math.floor((z - g.originZ) / g.cellM) * g.nx + Math.floor((x - g.originX) / g.cellM)];
    expect(cellAt(22, -2.5)).toBeGreaterThan(0);
    expect(cellAt(30.4, -3.6)).toBeGreaterThan(0);
    expect(cellAt(22, 0.3)).toBe(0);
    expect(cellAt(16.5, -2.5)).toBe(0);
    expect(waterObstacles([main]).length).toBe(1);
    expect(waterObstacles([main])[0].box.w).toBeCloseTo(main.rect.x1 - main.rect.x0);
  });
  it('depth markers print the depths rounded to 0.1 m: three on a pool, one on a children\'s pool', () => {
    expect(markerStations(main).map((m) => m.label)).toEqual(['1.2 m', '1.3 m', '1.7 m']);
    expect(markerStations(kids).map((m) => m.label)).toEqual(['0.5 m']);
  });
  it('the nearest water and its depth at the coping', () => {
    const near = nearestWater([main, kids], { x: 22, z: 0.3 })!;
    expect(near.basin.id).toBe('main');
    expect(near.distM).toBeCloseTo(0.8, 5);
    expect(near.depthM).toBeGreaterThan(1.2);
  });
});

describe('the depth card: the water against a person', () => {
  it('1.3 m is chest-deep for a 175 cm adult and over a 120 cm child\'s head (the product\'s sentence)', () => {
    expect(depthSentence(1.3)).toBe('Water reaches 1.3 m: chest-deep for a 175 cm adult; over a 120 cm child\'s head.');
  });
  it('the level against a body by height', () => {
    const w = (d: number, h: number): string => levelAgainst(d, h).word;
    expect(w(0.05, 175)).toBe('ankle');
    expect(w(0.5, 175)).toBe('knee');
    expect(w(0.9, 175)).toBe('hip');
    expect(w(1.05, 175)).toBe('waist');
    expect(w(1.2, 175)).toBe('chest');
    expect(w(1.4, 175)).toBe('shoulder');
    expect(w(1.55, 175)).toBe('chin');
    expect(w(1.65, 175)).toBe('eyes');
    expect(w(1.7, 175)).toBe('head');
    expect(levelAgainst(1.8, 175).overHead).toBe(true);
    expect(levelAgainst(1.3, 120).overHead).toBe(true);
    expect(levelAgainst(1.2, 120).phrase).toBe('up to the top of the head');
    expect(levelAgainst(0.6, 90).word).toBe('chest');
    expect(levelAgainst(0.6, 160).word).toBe('thigh');
    // the same water is higher on a shorter body, always
    for (const d of [0.4, 0.8, 1.2, 1.6]) expect(levelAgainst(d, 120).fraction).toBeGreaterThan(levelAgainst(d, 175).fraction);
  });
  it('the card for the sample pool: shallow and deep end, three figures, the guidance labelled as such', () => {
    const main = outdoorOf(POOL).pools[0];
    const m = depthCardModel(main, ADULT, CHILD, null);
    expect(m.rows.map((r) => r.label)).toEqual(['Shallow end', 'Deep end']);
    expect(m.rows[0].text).toMatch(/1\.2 m: chest-deep for a 175 cm adult; up to the top of a 120 cm child's head/);
    expect(m.rows[1].text).toMatch(/1\.7 m: .*over a 120 cm child's head/);
    expect((m.svg.match(/<circle/g) ?? []).length).toBe(3);
    expect(m.svg).toContain('1.7 m');
    for (const n of m.notes) expect(n).toMatch(/Typical guidance|Check your local/);
    expect(m.notes.join(' ')).toMatch(/not code/);
  });
  it('a toddler, a child and a tall person on the same pool read differently, and "you" is your own height', () => {
    const kids = outdoorOf(POOL).pools[1];
    expect(depthCardModel(kids, TODDLER, null, 0.6).headline).toBe('Water reaches 0.6 m: chest-deep for a 90 cm toddler.');
    expect(depthCardModel(kids, CHILD, null, 0.6).headline).toMatch(/hip-deep for a 120 cm child/);
    expect(depthSentence(1.1, [{ id: 'me', label: 'You', heightCm: 188 }])).toBe('Water reaches 1.1 m: waist-deep for you (188 cm).');
    expect(depthSentence(2.0, [{ id: 'me', label: 'You', heightCm: 188 }])).toContain('over your head');
    expect(PEOPLE_PRESETS.map((p) => p.heightCm)).toEqual([175, 120, 90]);
  });
  it('the section drawing scales the figures with their height', () => {
    const main = outdoorOf(POOL).pools[0];
    const tall = sectionSvg(main, ADULT), small = sectionSvg(main, TODDLER);
    const r = (svg: string): number => +(/<circle[^>]*r="([\d.]+)"/.exec(svg)![1]);
    expect(r(tall)).toBeGreaterThan(r(small) * 1.8);
  });
});

describe('the walkway round a pool', () => {
  const p = readScene(POOL)!;
  const pools = outdoorOf(POOL).pools;
  const roofs = outdoorOf(POOL).roofs;
  const room = p.layout.rooms[0].polygon;
  it('the sample deck is clear all round, 1.2 m or more on every side, and says the width is an assumption', () => {
    const rep = walkwayReport(pools, room, deckObstacles(p.furniture, roofs));
    expect(rep.verdict).toBe('clear');
    expect(rep.message).toMatch(/assumed/);
    expect(rep.sides.length).toBe(4);
    for (const s of rep.sides) expect(s.clearM).toBeGreaterThanOrEqual(1.2);
  });
  it('a lounger set 0.6 m from the water makes it blocked on that side, and the sentence names the side and the lounger', () => {
    const lounger = poolFurniture().find((i) => i.catalogId === 'pool-lounger')!;
    const near = { ...lounger, id: 'x', box: { ...lounger.box, cx: 22, cz: -0.5 + 0.6 + 1.0 } };
    const rep = walkwayReport(pools, room, deckObstacles([...p.furniture, near], roofs));
    expect(rep.verdict).toBe('blocked');
    expect(rep.message).toMatch(/Walkway blocked on the south side: the pool lounger leaves 60 cm/);
    expect(rep.short).toBe('Walkway blocked on the south side');
  });
  it('0.9 to 1.2 m is tight, and a wall closer than 0.9 m blocks it', () => {
    const lounger = poolFurniture().find((i) => i.catalogId === 'pool-lounger')!;
    const tight = { ...lounger, id: 'y', box: { ...lounger.box, cx: 22, cz: -0.5 + 1.0 + 1.0 } };
    expect(walkwayReport(pools, room, deckObstacles([tight], [])).verdict).toBe('tight');
    // a pool pushed against the north wall
    const moved: PoolBasin = { ...pools[0], rect: { x0: 17, z0: -7.5, x1: 28, z1: -3 } };
    const rep = walkwayReport([moved], room, []);
    expect(rep.verdict).toBe('blocked');
    expect(rep.message).toMatch(/north side: a wall leaves 5\d cm/);
  });
  it('a piece under 25 cm (a mat) does not block, and the children\'s pool needs no walkway of its own', () => {
    const mat = { id: 'm', source: 'virtual', kind: 'counter', label: 'Rubber mat', box: { cx: 22, cz: 0.2, w: 2, d: 2, yawDeg: 0 }, heightM: 0.02, surfaceHeightM: 0.02 } as FurnitureItem;
    expect(walkwayReport(pools, room, deckObstacles([mat], [])).verdict).toBe('clear');
    expect(walkwayReport(pools, room, []).sides.every((s) => s.basin === 'main')).toBe(true);
    expect(walkwaySides({ basin: pools[0], others: pools, room, obstacles: [] }).find((s) => s.side === 'E')!.by).toMatch(/children's pool/);
  });
  it('the roof columns count', () => {
    const cols = roofs[0].columns.map((c) => c.x);
    expect(Math.max(...cols)).toBeLessThan(pools[0].rect.x0 - 1.2);
    const moved = roofs.map((r) => ({ ...r, columns: r.columns.map((c) => ({ x: pools[0].rect.x0 - 0.7, z: c.z })) }));
    expect(walkwayReport(pools, room, deckObstacles([], moved)).verdict).not.toBe('clear');
  });
});

describe('the planting', () => {
  const garden = outdoorOf(GARDEN);
  it('a bed grows the same plants every time, all inside its polygon, in the species it names', () => {
    const bed = garden.beds[0];
    const a = scatterBed(bed), b = scatterBed(bed);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
    for (const s of a) expect(bed.species.map((x) => x.id)).toContain(s.species);
    const xs = bed.polygon.map((q) => q.x), zs = bed.polygon.map((q) => q.z);
    for (const s of a) { expect(s.x).toBeGreaterThanOrEqual(Math.min(...xs)); expect(s.x).toBeLessThanOrEqual(Math.max(...xs)); expect(s.z).toBeGreaterThanOrEqual(Math.min(...zs)); expect(s.z).toBeLessThanOrEqual(Math.max(...zs)); }
    expect(scatterBed({ ...bed, seed: bed.seed + 1 })).not.toEqual(a);
  });
  it('a row plants one every spacing along the line, both ends included; a hedge is blocks about a metre long', () => {
    const row = garden.rows.find((r) => r.style === 'row')!;
    const spots = plantRow(row);
    expect(spots[0].x).toBeCloseTo(row.from.x); expect(spots[spots.length - 1].x).toBeCloseTo(row.to.x);
    expect(spots.length).toBeGreaterThan(5);
    const hedges = allHedges(garden);
    expect(hedges.length).toBeGreaterThan(3);
    for (const h of hedges) expect(h.lenM).toBeGreaterThan(0.9);
  });
  it('a tier draws all the trees and a share of the shrubs: low <= medium <= high, and instances are one mesh a species (plus its trunks)', () => {
    const low = plantBudget(garden, 'low'), med = plantBudget(garden, 'medium'), high = plantBudget(garden, 'high');
    expect(low.plants).toBeLessThan(med.plants);
    expect(med.plants).toBe(high.plants);
    expect(low.triangles).toBeLessThan(med.triangles); expect(med.triangles).toBeLessThan(high.triangles);
    const species = Object.keys(med.perSpecies).length;
    expect(med.drawCalls).toBe(species * 2);
    expect(plantsForTier(garden, 'low').filter((s) => ['royal-palm', 'neem', 'gulmohar', 'frangipani'].includes(s.species)).length).toBe(allPlants(garden).filter((s) => ['royal-palm', 'neem', 'gulmohar', 'frangipani'].includes(s.species)).length);
  });
  it('the instanced meshes really are one per species, with the right counts, and the budget is the geometry own triangle count', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const spots = plantsForTier(garden, tier);
      const h = mountFoliage(spots, allHedges(garden), tier, garden.seed);
      const inst: THREE.InstancedMesh[] = [];
      h.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) inst.push(o as THREE.InstancedMesh); });
      const leafCounts = inst.filter((m) => m.name.endsWith(':leaves')).reduce((s, m) => s + m.count, 0);
      expect(leafCounts).toBe(spots.length);
      expect(inst.length).toBe(h.counts.instanced);
      let tris = 0;
      for (const m of inst) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * m.count;
      const est = plantBudget(garden, tier, speciesTriangles, hedgeBlockTriangles).triangles;
      expect(Math.abs(tris - est) / est).toBeLessThan(0.02);
      // wind only where the tier has it
      let windy = 0;
      h.group.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && (m as THREE.MeshStandardMaterial).onBeforeCompile && m.customProgramCacheKey?.() === 'ow-wind') windy++; });
      expect(windy > 0).toBe(tier !== 'low');
      h.dispose();
    }
  });
});

describe('an open-air shell and the plan the map draws', () => {
  it('has no ceiling, no floor mesh, no wall on the edges the module draws itself, and keeps the facade with its door', () => {
    const p = readScene(POOL)!, f = outdoorOf(POOL);
    const shell = buildShell(p.layout, { outdoor: { skipEdges: ownedEdges(f) } });
    const names = shell.children.map((c) => c.name);
    expect(names.some((n) => n.startsWith('ceiling:'))).toBe(false);
    expect(names.some((n) => n.startsWith('floor:'))).toBe(false);
    expect(names).toContain('walls:pool');
    const walls = shell.getObjectByName('walls:pool') as THREE.Mesh;
    const bb = new THREE.Box3().setFromObject(walls);
    // only the facade (west edge, x = 12.3) is built: the walls are one wall deep, not a ring
    expect(bb.max.x - bb.min.x).toBeLessThan(0.7);
    expect(bb.max.y).toBeCloseTo(p.layout.wallHeightM, 3);
    expect([...ownedEdges(f)].sort()).toEqual(['pool:0', 'pool:1', 'pool:2']);
    // an indoor shell of the same layout has them all
    const indoor = buildShell(p.layout);
    expect(indoor.children.some((c) => c.name.startsWith('ceiling:'))).toBe(true);
  });
  it('the indoor kit plans nothing for an open-air space: no fan, no tube, no switchboard, no skirting, no grill, no tiles', () => {
    const p = readScene(POOL)!;
    const plan = kitPlan(p.layout, [], true);
    expect(Object.values(plan).every((v) => (v as unknown[]).length === 0)).toBe(true);
    const indoor = kitPlan(p.layout, []);
    expect(Object.values(indoor).some((v) => (v as unknown[]).length > 0)).toBe(true);
  });
  it('the map plan draws water as water (a gradient from shallow to deep), lawn as lawn, the beds, the track and the trees', () => {
    const pool = outdoorPlanArt(outdoorOf(POOL), 't');
    expect(pool).toContain('class="bm-water"');
    expect(pool).toMatch(/linearGradient id="t-w-main"/);
    expect(pool).toContain('#8FD3E6');
    expect(pool).toContain('class="bm-step"');
    expect(pool).toContain('class="bm-roof"');
    expect(pool).toContain('bm-bed');
    const g = outdoorPlanArt(outdoorOf(GARDEN), 't');
    expect(g).toContain('bm-lawn'); expect(g).toContain('bm-track'); expect(g).toContain('bm-path'); expect(g).toContain('bm-plant');
    expect(g).not.toContain('bm-water');
    expect(outdoorPlanArt(outdoorOf(POOL_BARE), 't')).not.toContain('bm-plant');
    // the plan text is ids and numbers only: nothing a name could break
    expect(g).not.toMatch(/<script|undefined|NaN/);
    expect(pool).not.toMatch(/NaN|undefined/);
  });
});
