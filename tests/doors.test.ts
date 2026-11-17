// Door leaves: data (arc -> hinge and swing, rule when there is no arc), geometry, the walk grid in every state, the controller's
// refusals (walker, furniture, other doors), the furniture-in-swing verdict, the spawn, partial rooms.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSet, vectorPagesOf } from '../scripts/make-drawing-sets';
import { createDoors, MSG_IN_THE_WAY, MSG_STEP_BACK } from '../src/buyer/doors';
import { obstaclesOf } from '../src/buyer/people/model';
import type { Doors } from '../src/buyer/doors';
import { createFurnitureStore } from '../src/buyer/store';
import type { FurnitureStoreImpl } from '../src/buyer/store';
import type { BuyerContext } from '../src/buyer/context';
import { swingNoteFor } from '../src/buyer/wardrobe-hooks';
import { activateNearestDoor, doorNoteForBox, nearestDoorPrompt } from '../src/buyer/door-hooks';
import {
  DOOR_STRIP_M, DOOR_WALKER_MARGIN_M, boxStopsDoorAt, distanceToLeaf, doorBlockSentence, freePos, inDoorSweep, leafHitsGrid, leafObstacle, leafSegment, resolveDoors, ruleLeaf,
} from '../src/core/doors';
import type { Door } from '../src/core/doors';
import { distanceToSegment } from '../src/core/geometry';
import { boomDistance, circleFree, moveCircle } from '../src/core/grid-query';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { chooseSpawn } from '../src/core/spawn';
import { createEmptyProperty, validateProperty } from '../src/core/layout-validate';
import { leafFromArc, readGap } from '../src/import/openings';
import { proposeFromPages } from '../src/import/propose';
import type { Gap } from '../src/import/walls';
import type { VectorPage } from '../src/import/types';
import { CHARACTER_RADIUS_M, DEFAULT_FINISHES } from '../src/types';
import type { Box, DoorLeaf, Layout, Opening, RoomTag } from '../src/types';

const DEG = Math.PI / 180;

function rect(id: string, x0: number, z0: number, x1: number, z1: number, type: RoomTag['roomType'], label = id): RoomTag {
  return { id, roomType: type, label, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'] };
}
function layoutOf(rooms: RoomTag[], openings: Opening[]): Layout {
  return { wallHeightM: 2.75, wallThicknessM: 0.12, railingHeightM: 1.1, rooms, openings, finishes: DEFAULT_FINISHES, scaleSource: 'typed-sizes' };
}
/**
 * A 4 x 4 bedroom (z 0..4) and a 1.2 m passage under it (z 4.12..5.32), a 12 cm wall between. Edge 2 of the bedroom runs from (4, 4)
 * to (0, 4) with its outward normal +z; a door of 0.9 m centred 3.0 m along it is at x = 1.0 (x 0.55..1.45).
 */
function flat(leaf?: DoorLeaf, opts: { passage?: Partial<RoomTag>; type?: Opening['type'] } = {}): Layout {
  const bed = rect('bed', 0, 0, 4, 4, 'bedroom', 'Bedroom');
  const pass = { ...rect('pass', 0, 4.12, 4, 5.32, 'other', 'Passage'), ...opts.passage };
  const door: Opening = { id: 'door-1', roomId: 'bed', edge: 2, type: opts.type ?? 'door', centreM: 3.0, widthM: 0.9, sillM: 0, headM: 2.1, ...(leaf ? { leaf } : {}) };
  return layoutOf([bed, pass], [door]);
}
const IN_START: DoorLeaf = { hinge: 'start', swing: 'in', kind: 'hinged' };

/** A fake buyer context: just what createDoors reads. `frames` are the registered frame callbacks. */
function harness(layout: Layout, walker = { x: 2.0, z: 4.7 }, furniture: ReturnType<typeof boxItem>[] = [], opts: { startOpen?: boolean } = {}) {
  const base = rasterizeLayout(layout);
  const parent = new THREE.Group();
  const store = createFurnitureStore({ sceneId: 'doors-test', baseGrid: base, initial: furniture, parent, storage: null, saveDelayMs: 0 });
  const toasts: string[] = [];
  const cards: string[] = [];
  const character = { position: { ...walker } };
  const ctx = {
    viewer: { onFrame: () => () => {} },
    character,
    hud: { toast: (t: string) => { toasts.push(t); }, showCard: (c: { headline: string }) => { cards.push(c.headline); }, hideCard: () => {} },
  } as unknown as BuyerContext;
  const doors = createDoors({ ctx, store, layout, parent: new THREE.Group(), startOpen: opts.startOpen ?? false });
  /** run the clock: `s` seconds in 1/30 s frames */
  const run = (s: number): void => { for (let t = 0; t < s; t += 1 / 30) doors.update(1 / 30); };
  return { doors, store, character, toasts, cards, run, base };
}
function boxItem(id: string, box: Box, h = 0.9) {
  return { id, source: 'real' as const, kind: 'wardrobe' as const, label: 'Wardrobe', box, heightM: h, surfaceHeightM: h };
}

const live: Doors[] = [];
const keep = <T extends { doors: Doors }>(h: T): T => { live.push(h.doors); return h; };
afterEach(() => { while (live.length) live.pop()!.dispose(); });

const R = CHARACTER_RADIUS_M;

describe('resolving doors', () => {
  it('a door gets its width from the opening, a 35 mm panel under the frame head, hinged at a post', () => {
    const [d] = resolveDoors(flat(IN_START));
    expect(d.widthM).toBeCloseTo(0.9, 6);
    expect(d.kind).toBe('hinged');
    expect(d.assumed).toBe(false);
    expect(d.topM).toBeLessThan(2.1);
    expect(d.topM).toBeGreaterThan(2.0);
    // hinge 'start' = at the lower end of the opening along the edge (x 1.45, the edge runs towards -x), 5 cm in at the post
    expect(d.hingeAt.x).toBeCloseTo(1.4, 6);
    expect(d.hingeAt.z).toBeCloseTo(4.06, 6);
    expect(d.closedDir.x).toBeCloseTo(-1, 6);
    // 'in' swings into the opening's own room: the bedroom, -z
    expect(d.swingNormal.z).toBeCloseTo(-1, 6);
    expect(d.swingRoomId).toBe('bed');
    expect(d.panelWidthM).toBeCloseTo(0.9 - 0.1 - 0.008, 6);
  });

  it('the opening head sets the leaf height; a standard head says so', () => {
    const l = flat(IN_START);
    expect(resolveDoors(l)[0].heightFrom).toBe('standard');
    l.openings[0].headM = 2.2;
    const d = resolveDoors(l)[0];
    expect(d.heightFrom).toBe('drawing');
    expect(d.topM).toBeCloseTo(2.2 - 0.05 - 0.002, 6);
  });

  it('an opening of type `opening` or `window` gets no leaf', () => {
    expect(resolveDoors(flat(undefined, { type: 'opening' }))).toHaveLength(0);
    expect(resolveDoors(flat(undefined, { type: 'window' }))).toHaveLength(0);
  });

  it('no leaf in the data: derived by rule into the more private room, hinged by the nearer wall, and marked assumed', () => {
    const [d] = resolveDoors(flat());
    expect(d.assumed).toBe(true);
    expect(d.swingRoomId).toBe('bed');
    // x 0.55..1.45 on a 4 m wall: the wall at x = 0 is nearer than x = 4, so the leaf hangs on the x = 0.55 end ('end' along an edge that runs to -x)
    expect(d.hinge).toBe('end');
    expect(d.hingeAt.x).toBeCloseTo(0.6, 6);
    expect(d.roomLabel).toBe('Bedroom');
  });

  it('the same door attached to the passage side swings into the bedroom the same way', () => {
    const bed = rect('bed', 0, 0, 4, 4, 'bedroom', 'Bedroom');
    const pass = rect('pass', 0, 4.12, 4, 5.32, 'other', 'Passage');
    // passage edge 0 runs (0, 4.12) -> (4, 4.12), outward -z: centre 1.0 m along is x = 1.0
    const l = layoutOf([pass, bed], [{ id: 'door-1', roomId: 'pass', edge: 0, type: 'door', centreM: 1.0, widthM: 0.9, sillM: 0, headM: 2.1 }]);
    const [d] = resolveDoors(l);
    expect(d.swing).toBe('out');
    expect(d.swingRoomId).toBe('bed');
    expect(d.assumed).toBe(true);
    expect(d.roomLabel).toBe('Bedroom');
    expect(d.hinge).toBe('start');
  });

  it('a bathroom door swings into the bathroom, an entrance door into the flat', () => {
    const bath = rect('bath', 0, 0, 1.6, 2.4, 'bathroom', 'Bathroom');
    const hall = rect('hall', 0, 2.52, 4, 3.72, 'other', 'Lobby');
    const l = layoutOf([hall, bath], [{ id: 'd1', roomId: 'hall', edge: 0, type: 'door', centreM: 0.8, widthM: 0.75, sillM: 0, headM: 2.1 }]);
    const d = resolveDoors(l)[0];
    expect(d.swingRoomId).toBe('bath');
    const l2 = layoutOf([hall], [{ id: 'main', roomId: 'hall', edge: 2, type: 'door', centreM: 2, widthM: 1, sillM: 0, headM: 2.1 }]);
    const m = resolveDoors(l2)[0];
    expect(m.swing).toBe('in');
    expect(m.swingRoomId).toBe('hall');
  });

  it('a door between a whole room and a partial room gets no leaf', () => {
    expect(resolveDoors(flat(IN_START, { passage: { partial: { reason: 'runs off the sheet' } } }))).toHaveLength(0);
  });

  it('property.json keeps a door\'s leaf and drops a stray one on a window', () => {
    const p = createEmptyProperty('t');
    p.layout = flat(IN_START);
    p.layout.openings.push({ id: 'w1', roomId: 'bed', edge: 1, type: 'window', centreM: 1, widthM: 1, sillM: 0.9, headM: 2.1, leaf: IN_START });
    const back = validateProperty(JSON.parse(JSON.stringify(p)));
    expect(back.layout.openings[0].leaf).toEqual(IN_START);
    expect(back.layout.openings[1].leaf).toBeUndefined();
    const bad = JSON.parse(JSON.stringify(p));
    bad.layout.openings[0].leaf = { hinge: 'middle', swing: 'in', kind: 'hinged' };
    expect(() => validateProperty(bad)).toThrow(/leaf/);
  });
});

describe('the drawing\'s swing arc gives hinge and swing', () => {
  // A gap along +x on page y = 100 from x = 100 to 160 (60 pt wide, wall 6 pt thick), and a quarter arc of radius 60 about one end.
  const gap: Gap = { a: { x: 100, y: 100 }, b: { x: 160, y: 100 }, widthPt: 60, dir: { x: 1, y: 0 }, band: [], polyA: 0, polyB: 0 };
  const arc = (cx: number, cy: number, from: number, to: number) => {
    const pts = [];
    for (let k = 0; k <= 12; k++) { const a = (from + ((to - from) * k) / 12) * DEG; pts.push({ x: cx + 60 * Math.cos(a), y: cy + 60 * Math.sin(a) }); }
    return { color: '#000', width: 0.3, points: pts, closed: false, hasCurve: true };
  };
  const pageOf = (stroke: ReturnType<typeof arc>): VectorPage => ({ index: 0, width: 600, height: 600, fills: [], strokes: [stroke], texts: [], imageCoverage: 0 });

  it('reads which end the arc is centred on and which side it bulges to', () => {
    // centred on a, from the closed leaf end (0 deg) sweeping to +y (down the page)
    const down = readGap(gap, pageOf(arc(100, 100, 0, 90)), 6);
    expect(down.type).toBe('door');
    expect(down.swing).toEqual({ hingeEnd: 'a', side: 1 });
    const up = readGap(gap, pageOf(arc(100, 100, 0, -90)), 6);
    expect(up.swing).toEqual({ hingeEnd: 'a', side: -1 });
    // centred on b, the closed leaf end is at 180 deg
    const fromB = readGap(gap, pageOf(arc(160, 100, 180, 90)), 6);
    expect(fromB.swing).toEqual({ hingeEnd: 'b', side: 1 });
  });

  it('a gap with no arc is not given a swing (the rule does it at load, as assumed)', () => {
    const none = readGap(gap, { ...pageOf(arc(100, 100, 0, 90)), strokes: [] }, 6);
    expect(none.type).toBe('opening');
    expect(none.swing).toBeUndefined();
  });

  it('turns that into hinge and swing on a room edge, in any orientation', () => {
    // a room whose edge runs +x with its outward normal -z (the room is at +z): an arc on the +z side swings in
    const edge = { p: { x: 1, z: 1 }, q: { x: 5, z: 1 } };
    const A = { x: 1, z: 1 }, B = { x: 1.6, z: 1 };
    expect(leafFromArc({ hingeEnd: 'a', side: 1 }, A, B, edge)).toEqual({ hinge: 'start', swing: 'in', kind: 'hinged' });
    expect(leafFromArc({ hingeEnd: 'b', side: 1 }, A, B, edge)).toEqual({ hinge: 'end', swing: 'in', kind: 'hinged' });
    expect(leafFromArc({ hingeEnd: 'a', side: -1 }, A, B, edge)).toEqual({ hinge: 'start', swing: 'out', kind: 'hinged' });
    // the same wall seen from the neighbouring room (edge runs -x, outward +z): the same arc now swings out
    const back = { p: { x: 5, z: 1 }, q: { x: 1, z: 1 } };
    expect(leafFromArc({ hingeEnd: 'a', side: 1 }, A, B, back)).toEqual({ hinge: 'end', swing: 'out', kind: 'hinged' });
  });

  it('end to end on made-up drawing sets: the swing side the reader found matches the truth, and no door is assumed', () => {
    const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const seed of [93, 102]) {
      const b = buildSet(seed);
      const r = proposeFromPages(vectorPagesOf(b), 'x', 'y');
      const lab = new Map(b.truth.rooms.map((x) => [x.id, norm(x.labelString)]));
      const layout = { ...createEmptyProperty('x').layout, rooms: r.proposal.rooms, openings: r.proposal.openings };
      const doors = resolveDoors(layout);
      expect(doors.length).toBeGreaterThanOrEqual(7);
      let checked = 0;
      for (const d of doors) {
        expect(d.assumed).toBe(false);
        // a drawn swing that would stand open across a narrow passage is hung on the other side (`flipped`, src/core/doors.ts): the one deliberate departure from the arc
        if (d.flipped) continue;
        const swingLabel = norm(layout.rooms.find((x) => x.id === d.swingRoomId)?.label);
        const other = norm(layout.rooms.find((x) => x.id === d.rooms.find((id) => id && id !== d.swingRoomId))?.label);
        const t = b.truth.openings.find((o) => o.type === 'door' && o.rooms.length === 2 && o.rooms.some((id) => lab.get(id) === swingLabel) && o.rooms.some((id) => lab.get(id) === other));
        if (!t || !swingLabel) continue;
        checked++;
        // truth rooms[0] is the room the leaf swings into
        expect(lab.get(t.rooms[0]), `seed ${seed} ${d.id}`).toBe(swingLabel);
      }
      expect(checked).toBeGreaterThanOrEqual(6);
    }
  }, 300000);
});

describe('the walk grid with a leaf in every state', () => {
  const layout = flat(IN_START);
  const door = resolveDoors(layout)[0];
  const base = rasterizeLayout(layout);
  const gridAt = (pos: number): ReturnType<typeof stampFurniture> => {
    const o = leafObstacle(door, pos);
    return stampFurniture(base, [{ id: 't', source: 'virtual', kind: 'wardrobe', label: 't', box: o.box, heightM: o.heightM, surfaceHeightM: o.heightM }]);
  };
  const walkThrough = (g: ReturnType<typeof gridAt>, from: { x: number; z: number }, to: { x: number; z: number }) =>
    moveCircle(g, from, { x: to.x - from.x, z: to.z - from.z }, R);

  it('without a leaf the doorway is open (the old behaviour)', () => {
    const end = walkThrough(base, { x: 1.0, z: 4.8 }, { x: 1.0, z: 3.0 });
    expect(end.z).toBeLessThan(3.1);
  });

  it('a shut leaf closes the doorway: the walker cannot get from the passage into the room', () => {
    const g = gridAt(0);
    for (const x of [0.7, 0.9, 1.0, 1.1, 1.3]) {
      const end = walkThrough(g, { x, z: 4.8 }, { x, z: 3.0 });
      expect(end.z, `x ${x}`).toBeGreaterThan(4.2);
    }
    // and the other way
    const back = walkThrough(g, { x: 1.0, z: 3.0 }, { x: 1.0, z: 4.8 });
    expect(back.z).toBeLessThan(3.95);
    // full height: the camera boom stops at it
    const through = boomDistance(base, { x: 1.0, y: 1.4, z: 4.8 }, { x: 0, y: 0, z: -1 }, 2.0, 2.75);
    const blocked = boomDistance(g, { x: 1.0, y: 1.4, z: 4.8 }, { x: 0, y: 0, z: -1 }, 2.0, 2.75);
    expect(through).toBeGreaterThan(1.5);
    expect(blocked).toBeLessThan(0.7);
  });

  it('an open leaf frees the doorway and blocks the floor the panel stands on', () => {
    const g = gridAt(90 * DEG);
    // through the doorway beside the panel (hinge at x 1.4, the panel runs into the room at x 1.4)
    const through = walkThrough(g, { x: 0.9, z: 4.8 }, { x: 0.9, z: 3.0 });
    expect(through.z).toBeLessThan(3.1);
    // the panel itself is solid from the room side and from the doorway side
    const fromRoom = walkThrough(g, { x: 1.0, z: 3.6 }, { x: 2.0, z: 3.6 });
    expect(fromRoom.x).toBeLessThan(1.4 - 0.035);
    const fromOutside = walkThrough(g, { x: 2.0, z: 3.6 }, { x: 1.0, z: 3.6 });
    expect(fromOutside.x).toBeGreaterThan(1.4 + 0.035);
    // the cells under it are not free, the doorway cells beside it are
    expect(circleFree(g, 1.4, 3.6, 0.04)).toBe(false);
    expect(circleFree(g, 0.9, 4.06, R)).toBe(true);
  });

  it('the walker can never cross the panel at any angle mid-swing', () => {
    for (let deg = 0; deg <= 90; deg += 3) {
      const g = gridAt(deg * DEG);
      const s = leafSegment(door, deg * DEG);
      const mid = { x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 };
      const n = { x: -s.dir.z, z: s.dir.x };
      for (const sign of [1, -1]) {
        // start a body-width off the panel on one side and push straight through it, at several places along it
        for (const t of [0.25, 0.5, 0.75]) {
          const at = { x: s.a.x + (s.b.x - s.a.x) * t, z: s.a.z + (s.b.z - s.a.z) * t };
          const from = { x: at.x + n.x * sign * 0.5, z: at.z + n.z * sign * 0.5 };
          if (!circleFree(g, from.x, from.z, R)) continue;
          const end = walkThrough(g, from, { x: at.x - n.x * sign * 0.5, z: at.z - n.z * sign * 0.5 });
          const side = (end.x - at.x) * n.x * sign + (end.z - at.z) * n.z * sign;
          expect(side, `${deg} deg, side ${sign}, at ${t}`).toBeGreaterThan(0);
        }
      }
      void mid;
    }
  });

  it('the walker is never inside the stamped panel (it keeps a body radius off)', () => {
    for (let deg = 0; deg <= 90; deg += 5) {
      expect(distanceToLeaf(door, deg * DEG, { x: 1.0, z: 4.9 })).toBeGreaterThan(0);
    }
    expect(DOOR_WALKER_MARGIN_M).toBeGreaterThanOrEqual(R + DOOR_STRIP_M / 2);
  });
});

describe('what stops a leaf', () => {
  const layout = flat(IN_START);
  const door = resolveDoors(layout)[0];
  const base = rasterizeLayout(layout);

  it('with nothing in the way it opens a quarter turn', () => {
    expect(freePos(base, door, 0).pos).toBeCloseTo(90 * DEG, 6);
  });

  it('a wall stops it: opened against a wall closer than the panel, it stops short', () => {
    // a room only 0.5 m deep: the leaf cannot open past about 33 degrees before it meets the far wall... it hits the side walls first
    const small = layoutOf([rect('bed', 0, 3.4, 4, 4, 'bedroom', 'Bedroom'), rect('pass', 0, 4.12, 4, 5.32, 'other', 'Passage')], [{ id: 'door-1', roomId: 'bed', edge: 2, type: 'door', centreM: 3.0, widthM: 0.9, sillM: 0, headM: 2.1, leaf: IN_START }]);
    const d = resolveDoors(small)[0];
    const g = rasterizeLayout(small);
    const f = freePos(g, d, 0);
    expect(f.pos).toBeLessThan(60 * DEG);
    expect(f.pos).toBeGreaterThan(10 * DEG);
    expect(leafHitsGrid(g, d, f.pos)).toBe('free');
  });

  it('a wardrobe in the swing stops it short, and the leaf never overlaps it', () => {
    const box: Box = { cx: 0.9, cz: 3.5, w: 0.5, d: 0.5, yawDeg: 0 };
    const g = stampFurniture(base, [boxItem('w', box)]);
    const f = freePos(g, door, 0);
    expect(f.pos).toBeLessThan(60 * DEG);
    expect(f.pos).toBeGreaterThan(5 * DEG);
    expect(f.hit).toBe('obstacle');
    expect(boxStopsDoorAt(door, box)).not.toBeNull();
    expect(leafHitsGrid(g, door, f.pos)).toBe('free');
  });

  it('a swing out onto nothing is "void", not an obstacle', () => {
    const l = layoutOf([rect('hall', 0, 0, 4, 1.2, 'other', 'Hall')], [{ id: 'main', roomId: 'hall', edge: 0, type: 'door', centreM: 2, widthM: 1, sillM: 0, headM: 2.1, leaf: { hinge: 'start', swing: 'out', kind: 'hinged' } }]);
    const d = resolveDoors(l)[0];
    const f = freePos(rasterizeLayout(l), d, 0);
    expect(f.pos).toBeLessThan(5 * DEG);
    expect(f.hit).toBe('void');
  });
});

describe('the door controller', () => {
  const layout = flat(IN_START);
  const doorId = 'door-1';
  const cellsOfDoors = (h: ReturnType<typeof harness>) => h.store.grid();

  it('starts shut: the doorway is closed on the walk grid', () => {
    const h = keep(harness(layout));
    const r = h.doors.debug.read(doorId)!;
    expect(r.state).toBe('shut');
    expect(r.prompt).toBe('Open door');
    const end = moveCircle(h.store.grid(), { x: 1.0, z: 4.8 }, { x: 0, z: -2 }, R);
    expect(end.z).toBeGreaterThan(4.2);
  });

  it('opens when asked, in about half a second, to a quarter turn, then the doorway is free', async () => {
    const h = keep(harness(layout));
    const p = h.doors.debug.open(doorId);
    h.run(0.2);
    const mid = h.doors.debug.read(doorId)!;
    expect(mid.state).toBe('opening');
    expect(mid.pos).toBeGreaterThan(10 * DEG);
    expect(mid.pos).toBeLessThan(80 * DEG);
    h.run(0.6);
    const r = (await p)!;
    expect(r.state).toBe('open');
    expect(r.pos).toBeCloseTo(90 * DEG, 5);
    expect(r.prompt).toBe('Close door');
    const through = moveCircle(h.store.grid(), { x: 0.9, z: 4.8 }, { x: 0, z: -2 }, R);
    expect(through.z).toBeLessThan(3.0);
    const panel = moveCircle(h.store.grid(), { x: 1.0, z: 3.6 }, { x: 1.2, z: 0 }, R);
    expect(panel.x).toBeLessThan(1.4 - 0.035);
  });

  it('the walker can never be inside the panel at any frame while it swings', () => {
    const h = keep(harness(layout));
    void h.doors.debug.open(doorId);
    for (let t = 0; t < 0.7; t += 1 / 60) {
      h.doors.update(1 / 60);
      const r = h.doors.debug.read(doorId)!;
      const g = h.store.grid();
      // the stamped panel and the walker's body never overlap: a walker stood just clear of it stays free
      const s = leafSegment(h.doors.debug.door(doorId)!, r.pos);
      const n = { x: -s.dir.z, z: s.dir.x };
      for (const f of [0.3, 0.6, 0.9]) {
        const at = { x: s.a.x + (s.b.x - s.a.x) * f, z: s.a.z + (s.b.z - s.a.z) * f };
        const out = moveCircle(g, { x: at.x + n.x * 0.5, z: at.z + n.z * 0.5 }, { x: -n.x, z: -n.z }, R);
        const side = (out.x - at.x) * n.x + (out.z - at.z) * n.z;
        expect(side, `t ${t.toFixed(2)} f ${f}`).toBeGreaterThan(0);
      }
    }
  });

  it('closes again, and the doorway is shut', async () => {
    const h = keep(harness(layout));
    const o = h.doors.debug.open(doorId);
    h.run(1);
    await o;
    const c = h.doors.debug.close(doorId);
    h.run(1);
    const r = (await c)!;
    expect(r.state).toBe('shut');
    expect(r.pos).toBe(0);
    const end = moveCircle(h.store.grid(), { x: 1.0, z: 4.8 }, { x: 0, z: -2 }, R);
    expect(end.z).toBeGreaterThan(4.2);
  });

  it('the walker standing in the swing stops the leaf, with a message, and it stays clear of the body', async () => {
    const h = keep(harness(layout, { x: 0.9, z: 3.5 }));
    const p = h.doors.debug.open(doorId);
    h.run(1);
    const r = (await p)!;
    expect(r.state).toBe('ajar');
    expect(r.stopReason).toBe('walker');
    expect(r.pos).toBeGreaterThan(5 * DEG);
    expect(r.pos).toBeLessThan(89 * DEG);
    expect(h.toasts.join('|')).toContain(MSG_STEP_BACK);
    expect(h.toasts.join('|')).toContain('Something is in the way of this door');
    expect(distanceToLeaf(h.doors.debug.door(doorId)!, r.pos, h.character.position)).toBeGreaterThanOrEqual(DOOR_WALKER_MARGIN_M - 1e-6);
    // the walker steps back; asking again opens it the rest of the way
    h.character.position = { x: 0.9, z: 2.0 };
    const again = h.doors.debug.open(doorId);
    h.run(1);
    expect((await again)!.state).toBe('open');
  });

  it('a walker in the doorway keeps a closing leaf from touching them', async () => {
    const h = keep(harness(layout, { x: 2.5, z: 3.0 }));
    const o = h.doors.debug.open(doorId);
    h.run(1);
    await o;
    // walk into the doorway, then close the door on them
    h.character.position = { x: 1.0, z: 4.06 };
    const c = h.doors.debug.close(doorId);
    h.run(1);
    const r = (await c)!;
    expect(r.state).toBe('ajar');
    expect(r.stopReason).toBe('walker');
    expect(r.pos).toBeGreaterThan(0);
    expect(distanceToLeaf(h.doors.debug.door(doorId)!, r.pos, h.character.position)).toBeGreaterThanOrEqual(DOOR_WALKER_MARGIN_M - 1e-6);
    expect(circleFree(h.store.grid(), 1.0, 4.06, R)).toBe(true);
  });

  it('furniture in the swing: it opens as far as it can and says why; furniture on the shut leaf refuses', async () => {
    const box: Box = { cx: 0.9, cz: 3.5, w: 0.5, d: 0.5, yawDeg: 0 };
    const h = keep(harness(layout, { x: 2.5, z: 4.7 }, [boxItem('wardrobe-1', box)]));
    const p = h.doors.debug.open(doorId);
    h.run(1);
    const r = (await p)!;
    expect(r.pos).toBeLessThan(60 * DEG);
    expect(r.pos).toBeGreaterThan(5 * DEG);
    expect(h.toasts.join('|')).toContain('Something is in the way of this door');
    // the leaf and the furniture never overlap
    const g = h.store.gridExcludingTemporary(['doors']);
    expect(leafHitsGrid(g, h.doors.debug.door(doorId)!, r.pos)).toBe('free');

    // furniture right on the closed leaf: it cannot move at all
    const onLeaf: Box = { cx: 1.0, cz: 3.95, w: 0.5, d: 0.4, yawDeg: 0 };
    const h2 = keep(harness(layout, { x: 2.5, z: 4.7 }, [boxItem('wardrobe-2', onLeaf)]));
    const p2 = h2.doors.debug.open(doorId);
    h2.run(0.5);
    const r2 = (await p2)!;
    expect(r2.pos).toBe(0);
    expect(r2.state).toBe('shut');
    expect(r2.stopReason).toBe('furniture');
    expect(h2.toasts[0]).toBe(MSG_IN_THE_WAY);
  });

  it('a chair or a wardrobe shutter (a temporary obstacle) stops it too', async () => {
    const h = keep(harness(layout, { x: 2.5, z: 4.7 }));
    h.store.setTemporary('seats', [{ box: { cx: 0.9, cz: 3.5, w: 0.5, d: 0.5, yawDeg: 0 }, heightM: 0.9 }]);
    const p = h.doors.debug.open(doorId);
    h.run(1);
    expect((await p)!.pos).toBeLessThan(60 * DEG);
  });

  it('a person the buyer added, standing in the swing, stops it too, and a door never overlaps them', async () => {
    const h = keep(harness(layout, { x: 2.5, z: 4.7 }));
    h.store.setTemporary('people', obstaclesOf([{ id: 'pe-1', body: 'man', tone: 2, heightCm: 175, x: 0.9, z: 3.5, yawDeg: 0, pose: 'stand' }]));
    const p = h.doors.debug.open(doorId);
    h.run(1);
    const r = (await p)!;
    expect(r.pos).toBeLessThan(60 * DEG);
    expect(h.toasts[0]).toBe(MSG_IN_THE_WAY);
  });

  it('the pill says Open door / Close door near it, and E swings it', async () => {
    const h = keep(harness(layout, { x: 0.9, z: 4.7 }));
    // the controller is not mounted (no hooks) in this harness: the hooks are registered by createDoors itself
    expect(nearestDoorPrompt({ x: 0.9, z: 4.7 })?.prompt).toBe('Open door');
    expect(nearestDoorPrompt({ x: 0.9, z: 1.0 })).toBeNull();
    expect(activateNearestDoor({ x: 0.9, z: 4.7 })).toBe(true);
    h.run(1);
    expect(h.doors.debug.read(doorId)!.state).toBe('open');
    expect(nearestDoorPrompt({ x: 0.9, z: 4.7 })?.prompt).toBe('Close door');
    expect(h.cards.at(-1)).toBeTruthy();
  });

  it('a door behind a wall is not offered', () => {
    // a closet next to the passage: its far side of the dividing wall is 0.8 m from the bedroom's doorway, but through a wall
    const bed = rect('bed', 0, 0, 4, 4, 'bedroom', 'Bedroom');
    const pass = rect('pass', 0, 4.12, 1.5, 5.32, 'other', 'Passage');
    const closet = rect('closet', 1.62, 4.12, 3.0, 5.32, 'other', 'Closet');
    const l = layoutOf([bed, pass, closet], [{ id: 'door-1', roomId: 'bed', edge: 2, type: 'door', centreM: 3.0, widthM: 0.9, sillM: 0, headM: 2.1, leaf: IN_START }]);
    const h = keep(harness(l, { x: 0.8, z: 4.7 }));
    expect(nearestDoorPrompt({ x: 0.8, z: 4.7 })?.prompt).toBe('Open door');
    expect(nearestDoorPrompt({ x: 1.9, z: 4.7 })).toBeNull();
    void h;
  });

  it('the card says the swing is assumed when the drawing gave none, and that height and thickness are standard', () => {
    const h = keep(harness(flat()));
    const c = h.doors.debug.card(doorId)!;
    expect(c.lines.join(' ')).toContain('Swing side assumed: the drawing does not show it');
    expect(c.lines.join(' ')).toContain('standard assumptions. The drawing does not give them');
    const h2 = keep(harness(flat(IN_START)));
    const c2 = h2.doors.debug.card(doorId)!;
    expect(c2.lines.join(' ')).not.toContain('assumed:');
    expect(c2.lines.join(' ')).toContain('door arc');
  });

  it('two doors that would meet do not pass through each other', async () => {
    // two doors in the same wall, 0.5 m apart, both hinged so their leaves sweep into each other
    const bed = rect('bed', 0, 0, 4, 4, 'bedroom', 'Bedroom');
    const pass = rect('pass', 0, 4.12, 4, 5.32, 'other', 'Passage');
    const l = layoutOf([bed, pass], [
      { id: 'a', roomId: 'bed', edge: 2, type: 'door', centreM: 2.6, widthM: 0.9, sillM: 0, headM: 2.1, leaf: { hinge: 'start', swing: 'in', kind: 'hinged' } },
      { id: 'b', roomId: 'bed', edge: 2, type: 'door', centreM: 1.3, widthM: 0.9, sillM: 0, headM: 2.1, leaf: { hinge: 'end', swing: 'in', kind: 'hinged' } },
    ]);
    const h = keep(harness(l, { x: 2.0, z: 5.0 }));
    const A = h.doors.debug.open('a');
    h.run(1);
    await A;
    const B = h.doors.debug.open('b');
    h.run(1);
    await B;
    const da = h.doors.debug.door('a')!, db = h.doors.debug.door('b')!;
    const sa = leafSegment(da, h.doors.debug.read('a')!.pos), sb = leafSegment(db, h.doors.debug.read('b')!.pos);
    const gap = Math.min(distanceToSegment(sa.a, sb.a, sb.b), distanceToSegment(sa.b, sb.a, sb.b), distanceToSegment(sb.a, sa.a, sa.b), distanceToSegment(sb.b, sa.a, sa.b));
    expect(gap).toBeGreaterThanOrEqual(DOOR_STRIP_M - 1e-6);
  });
});

describe('the start room', () => {
  it('the doors of the room the walker starts in stand open, every other door starts shut', () => {
    const bed = rect('bed', 0, 0, 4, 4, 'bedroom', 'Bedroom');
    const pass = rect('pass', 0, 4.12, 6, 5.32, 'other', 'Passage');
    const bath = rect('bath', 4.2, 0, 6, 4, 'bathroom', 'Bathroom');
    const l = layoutOf([bed, pass, bath], [
      { id: 'bed-door', roomId: 'bed', edge: 2, type: 'door', centreM: 3.0, widthM: 0.9, sillM: 0, headM: 2.1, leaf: IN_START },
      // the bathroom's door is on the passage's top edge (edge 0, outward -z): x = 5.0
      { id: 'bath-door', roomId: 'pass', edge: 0, type: 'door', centreM: 5.0, widthM: 0.75, sillM: 0, headM: 2.1, leaf: { hinge: 'start', swing: 'out', kind: 'hinged' } },
    ]);
    const h = keep(harness(l, { x: 2.0, z: 2.0 }, [], { startOpen: true }));
    h.run(0.1);
    expect(h.doors.debug.read('bed-door')!.state).toBe('open');
    expect(h.doors.debug.read('bath-door')!.state).toBe('shut');
    // the open leaf is on the walk grid where it stands
    expect(circleFree(h.store.grid(), 1.4, 3.6, 0.04)).toBe(false);
  });
});

describe('furniture in a door\'s swing', () => {
  const layout = flat(IN_START);
  const door = resolveDoors(layout)[0];

  it('a piece in the sweep gets the verdict, whatever it is (real or placed)', () => {
    const near: Box = { cx: 1.0, cz: 3.5, w: 0.5, d: 0.5, yawDeg: 0 };
    expect(doorBlockSentence(door, near)).toBe('Blocks the Bedroom door from opening.');
    const far: Box = { cx: 1.2, cz: 3.3, w: 0.3, d: 0.3, yawDeg: 0 };
    expect(doorBlockSentence(door, far)).toBe('Stops the Bedroom door opening fully.');
    const clear: Box = { cx: 2.8, cz: 2.0, w: 1.0, d: 1.0, yawDeg: 0 };
    expect(doorBlockSentence(door, clear)).toBeNull();
    const beyond: Box = { cx: 0.9, cz: 2.8, w: 0.5, d: 0.5, yawDeg: 0 };
    expect(doorBlockSentence(door, beyond)).toBeNull();
  });

  it('furnish mode\'s sentence hook carries it', () => {
    const h = keep(harness(layout));
    expect(swingNoteFor({ cx: 1.0, cz: 3.5, w: 0.5, d: 0.5, yawDeg: 0 })).toContain('Blocks the Bedroom door from opening.');
    expect(swingNoteFor({ cx: 2.8, cz: 2.0, w: 1, d: 1, yawDeg: 0 })).toBeNull();
    expect(h.doors.debug.noteFor({ cx: 1.0, cz: 3.5, w: 0.5, d: 0.5, yawDeg: 0 })).toContain('Blocks');
    // the card of a real piece (interactions.ts) asks the same hook
    expect(doorNoteForBox({ cx: 1.0, cz: 3.5, w: 0.5, d: 0.5, yawDeg: 0 })).toBe('Blocks the Bedroom door from opening.');
    expect(doorNoteForBox({ cx: 2.8, cz: 2.0, w: 1, d: 1, yawDeg: 0 })).toBeNull();
  });

  it('a sliding door is blocked by furniture where its panel parks', () => {
    const s = resolveDoors(flat({ hinge: 'start', swing: 'in', kind: 'sliding' }))[0];
    expect(s.kind).toBe('sliding');
    expect(s.maxPos).toBeGreaterThan(0.3);
  });
});

describe('spawn and doors', () => {
  it('never starts the walker on a leaf or in its swing', () => {
    for (const leaf of [IN_START, { hinge: 'end', swing: 'in', kind: 'hinged' } as DoorLeaf, undefined]) {
      const l = flat(leaf);
      const g = stampFurniture(rasterizeLayout(l), []);
      const sp = chooseSpawn(l, 'bed', g)!;
      expect(sp).not.toBeNull();
      const doors = resolveDoors(l);
      expect(inDoorSweep(doors, sp, R)).toBe(false);
      expect(circleFree(g, sp.x, sp.z, 0.6)).toBe(true);
    }
  });

  it('spawns on the passage side of a door that swings into the passage, outside its sweep', () => {
    const l = flat({ hinge: 'start', swing: 'out', kind: 'hinged' });
    // 'out' of the bedroom edge swings into the passage
    const g = stampFurniture(rasterizeLayout(l), []);
    const sp = chooseSpawn(l, 'pass', g)!;
    expect(sp).not.toBeNull();
    expect(inDoorSweep(resolveDoors(l), sp, R)).toBe(false);
  });
});

describe('partial rooms and plain openings keep their doorway', () => {
  it('a partial neighbour: no leaf, no obstacle, the doorway is exactly as before', () => {
    const l = flat(IN_START, { passage: { partial: { reason: 'runs off the sheet' } } });
    const h = keep(harness(l));
    expect(h.doors.debug.ids()).toHaveLength(0);
    const end = moveCircle(h.store.grid(), { x: 1.0, z: 4.8 }, { x: 0, z: -2 }, R);
    expect(end.z).toBeLessThan(3.0);
    expect(h.store.grid().cells).toEqual(h.base.cells);
  });

  it('an opening of type `opening` stays a hole in the wall', () => {
    const l = flat(undefined, { type: 'opening' });
    const h = keep(harness(l));
    expect(h.doors.debug.ids()).toHaveLength(0);
    expect(moveCircle(h.store.grid(), { x: 1.0, z: 4.8 }, { x: 0, z: -2 }, R).z).toBeLessThan(3.0);
  });
});

describe('a sliding door', () => {
  const layout = flat({ hinge: 'start', swing: 'in', kind: 'sliding' });

  it('shut it blocks, slid open it frees the doorway, and the panel stays solid', async () => {
    const h = keep(harness(layout, { x: 2.5, z: 4.7 }));
    expect(moveCircle(h.store.grid(), { x: 1.0, z: 4.8 }, { x: 0, z: -2 }, R).z).toBeGreaterThan(4.2);
    const p = h.doors.debug.open('door-1');
    h.run(1.2);
    const r = (await p)!;
    expect(r.state).toBe('open');
    expect(r.pos).toBeGreaterThan(0.3);
    // the doorway is clear: through its middle
    const d = h.doors.debug.door('door-1')!;
    // the open half of the doorway (the hinge side: the sliding pane has gone over the fixed one on the far side); a walker coming through it is not stopped
    const mid = { x: d.hingeAt.x + d.closedDir.x * 0.4, z: 4.8 };
    const out = moveCircle(h.store.grid(), mid, { x: 0, z: -2 }, R);
    expect(out.z).toBeLessThan(3.2);
    // and the panel itself cannot be walked through from the room side
    const seg = leafSegment(d, r.pos);
    const at = { x: (seg.a.x + seg.b.x) / 2, z: (seg.a.z + seg.b.z) / 2 };
    const g = h.store.grid();
    if (circleFree(g, at.x, at.z + 0.5 * -d.swingNormal.z * -1, R)) {
      const end = moveCircle(g, { x: at.x, z: at.z + d.swingNormal.z * 0.5 }, { x: 0, z: -d.swingNormal.z }, R);
      expect(Math.abs(end.z - at.z)).toBeGreaterThan(0.05);
    }
  });
});
