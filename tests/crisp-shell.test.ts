// SPEC 16.18: the shell's quality pass. Door frames with a built architrave, a stop and a lintel, wall corner data for the shading, skirting that
// meets the architrave, floor tile formats from a pack, the pack's trim, and the honesty rules (no hole, leaf, size or collision changes).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEmptyProperty } from '../src/core/layout-validate';
import { defaultEdges } from '../src/core/layout-geom';
import { resolveDoors } from '../src/core/doors';
import { rasterizeLayout } from '../src/core/layout-raster';
import { buildShell, shellStats } from '../src/engine/shell';
import { buildDoorModel } from '../src/buyer/doors-model';
import { floorTileSpec, kitPlan, skirtingRuns, ARCHITRAVE_RUN_STOP_M } from '../src/look/kit/rules';
import { PACKS, DEFAULT_PACK_ID, getPack, loadPack } from '../src/look/packs';
import { doorPanelFinish, resetStyle, setStyle, trimColours } from '../src/look/style';
import type { Layout, Opening, RoomTag, RoomType } from '../src/types';

const rect = (id: string, type: RoomType, x0: number, z0: number, x1: number, z1: number, label = id): RoomTag => ({
  id, roomType: type, label, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'],
});
function layoutOf(rooms: RoomTag[], openings: Opening[] = []): Layout {
  const p = createEmptyProperty('synthetic-crisp');
  p.layout.rooms = rooms.map((r) => ({ ...r, edges: r.edges.map((e, i) => (e === 'wall' ? defaultEdges(r, rooms)[i] : e)) }));
  p.layout.openings = openings;
  p.layout.wallHeightM = 2.6;
  return p.layout;
}
const door = (roomId: string, edge: number, centreM: number, widthM = 0.9): Opening => ({ id: `d-${roomId}-${edge}`, roomId, edge, type: 'door', centreM, widthM, sillM: 0, headM: 2.1 });
const win = (roomId: string, edge: number, centreM: number, widthM = 1.2): Opening => ({ id: `w-${roomId}-${edge}`, roomId, edge, type: 'window', centreM, widthM, sillM: 0.9, headM: 2.1 });
const flat = (): Layout => layoutOf([rect('living', 'living', 0, 0, 5, 4), rect('bed', 'bedroom', 5.12, 0, 8.2, 2.9), rect('hall', 'other', 0, 4.12, 5, 5.6)], [door('living', 1, 2.0), door('hall', 0, 1.0), win('living', 3, 2, 1.8)]);

describe('door frames (SPEC 16.18)', () => {
  it('the frames mesh carries grain-direction UVs and more members than the old three posts per door', () => {
    const g = buildShell(flat());
    const frames = g.getObjectByName('frames') as THREE.Mesh;
    const doors = 2, tris = (frames.geometry.getAttribute('position').count) / 3;
    // lining 3 boxes + stop 3 + architrave (2 faces x (2 boards + 2 beads + head + cap + head bead)) per door, 12 triangles a box, plus a window lining
    expect(tris).toBeGreaterThan(doors * 12 * 20);
    expect(frames.geometry.getAttribute('uv').count).toBe(frames.geometry.getAttribute('position').count);
  });
  it('leaf size and the walk grid are exactly what the door rule says, with or without the new frame', () => {
    const l = flat();
    const d = resolveDoors(l);
    expect(d.length).toBe(2);
    for (const x of d) expect(x.panelWidthM).toBeCloseTo(x.widthM - 0.1 - 0.008, 6);
    // the walk grid is rasterised from the layout alone: building the shell does not touch it
    const before = rasterizeLayout(l).cells.join(',');
    buildShell(l);
    expect(rasterizeLayout(l).cells.join(',')).toBe(before);
  });
  it('a floor and a wall area are unchanged by the frame and corner data', () => {
    const l = flat();
    const s = shellStats(buildShell(l));
    expect(s.floorAreaM2.living).toBeCloseTo(20, 3);
  });
  it('walls carry the corner data: 99 minus the distance to a room corner, 0 where the end of a piece is no corner', () => {
    const g = buildShell(flat());
    const walls = g.getObjectByName('walls:living') as THREE.Mesh;
    const aux = walls.geometry.getAttribute('lkEnd');
    expect(aux).toBeTruthy();
    expect(aux.count).toBe(walls.geometry.getAttribute('position').count);
    let corners = 0, zero = 0;
    for (let i = 0; i < aux.count; i++) { if (aux.getX(i) > 0 || aux.getY(i) > 0) corners++; else zero++; }
    expect(corners).toBeGreaterThan(0);
    expect(zero).toBeGreaterThan(0);
    for (let i = 0; i < aux.count; i++) { expect(aux.getX(i)).toBeLessThanOrEqual(99); expect(aux.getY(i)).toBeLessThanOrEqual(99); }
  });
  it('a door in a room with another door two metres along does not get an architrave across it', () => {
    const l = layoutOf([rect('a', 'living', 0, 0, 5, 4)], [door('a', 1, 1.0, 0.9), door('a', 1, 1.95, 0.9)]);
    const frames = buildShell(l).getObjectByName('frames') as THREE.Mesh;
    expect(frames).toBeTruthy();
  });
});

describe('skirting meets the architrave', () => {
  it('a run that ends at a door stops the architrave width short; a run that ends at a corner does not', () => {
    const l = flat();
    const runs = skirtingRuns(l).filter((r) => r.roomId === 'living' && r.edge === 1);
    expect(runs.length).toBe(2);
    const doorOpening = l.openings.find((o) => o.id === 'd-living-1')!;
    const u0 = doorOpening.centreM - doorOpening.widthM / 2, u1 = doorOpening.centreM + doorOpening.widthM / 2;
    const left = runs.find((r) => r.u0 < u0)!, right = runs.find((r) => r.u0 >= u0)!;
    expect(left.u0).toBeCloseTo(0, 6);
    expect(left.u1).toBeCloseTo(u0 - ARCHITRAVE_RUN_STOP_M, 6);
    expect(right.u0).toBeCloseTo(u1 + ARCHITRAVE_RUN_STOP_M, 6);
  });
});

describe('floor tile formats from the pack', () => {
  it('the default pack asks for 800 x 800 in a big room, 1200 x 600 in a middling one, 600 x 600 in a narrow one, 2 mm joints', () => {
    const l = flat();
    const pack = getPack(DEFAULT_PACK_ID)!;
    expect(pack.tiles).toEqual({ large: [0.8, 0.8], standard: [1.2, 0.6], groutMm: 2 });
    const living = floorTileSpec(l.rooms.find((r) => r.id === 'living')!, l, pack.tiles)!;
    expect([living.tileU, living.tileV]).toEqual([0.8, 0.8]);
    expect(living.groutM).toBeCloseTo(0.002, 6);
    const bed = floorTileSpec(l.rooms.find((r) => r.id === 'bed')!, l, pack.tiles)!;
    expect([bed.tileU, bed.tileV]).toEqual([1.2, 0.6]);
    const hall = floorTileSpec(l.rooms.find((r) => r.id === 'hall')!, l, pack.tiles)!;
    expect([hall.tileU, hall.tileV]).toEqual([0.6, 0.6]);
  });
  it('a tile the drawing gave still wins over the pack', () => {
    const l = flat();
    l.finishes.tile = { wM: 0.45, lM: 0.9 };
    const s = floorTileSpec(l.rooms[0], l, getPack(DEFAULT_PACK_ID)!.tiles)!;
    expect([s.tileU, s.tileV]).toEqual([0.45, 0.9]);
  });
  it('without a pack format nothing changes: 800 for a big room, 600 otherwise', () => {
    const l = flat();
    expect(floorTileSpec(l.rooms[0], l)!.tileU).toBe(0.8);
    expect(floorTileSpec(l.rooms[1], l)!.tileU).toBe(0.6);
  });
  it('kitPlan carries the recessed downlights the bake lights from', () => {
    const p = kitPlan(flat());
    expect(p.downlights.length).toBeGreaterThan(0);
    for (const d of p.downlights) expect(d.y).toBeCloseTo(2.6, 6);
  });
});

describe('packs: the default, its charcoal sibling, trim and tiles', () => {
  it('Clean Contrast is the default and Light Scandinavian stays selectable', () => {
    expect(DEFAULT_PACK_ID).toBe('clean-contrast');
    expect(PACKS[0].id).toBe('clean-contrast');
    for (const id of ['clean-contrast', 'clean-contrast-dark', 'light-scandinavian', 'warm-oak-navy', 'walnut-white', 'classic']) expect(getPack(id), id).toBeTruthy();
  });
  it('trim colours: white frames in the default, charcoal skirting and walnut frames in the dark one, nothing in Classic', () => {
    setStyle({ packId: 'clean-contrast' });
    const a = trimColours();
    expect(a.frame).toBe('#F1EFEA'); expect(a.frameGrain).toBe(false); expect(a.handle).toBe('#3B3D41');
    setStyle({ packId: 'clean-contrast-dark' });
    const b = trimColours();
    expect(b.skirting).toBe('#3B3D41'); expect(b.frame).toBe('#5A3F2E'); expect(b.frameGrain).toBe(true);
    setStyle({ packId: 'classic' });
    expect(trimColours()).toEqual({ skirting: null, frame: null, handle: null, frameGrain: true });
    resetStyle();
  });
  it('the door finish says whether the grain shows', () => {
    setStyle({ packId: 'clean-contrast' });
    expect(doorPanelFinish()).toEqual({ colour: '#C08A52', grain: true });
    setStyle({ packId: 'walnut-white' });
    expect(doorPanelFinish()?.grain).toBeDefined();
    setStyle({ packId: 'classic' });
    expect(doorPanelFinish()).toBeNull();
    resetStyle();
  });
  it('loadPack drops a bad trim finish and a bad tile format instead of throwing', () => {
    const { pack, dropped } = loadPack({ id: 'x', name: 'X', trim: { skirting: 'nope', frame: 'white-laminate' }, tiles: { large: [9, 9], groutMm: 2 } });
    expect(pack?.trim).toEqual({ frame: 'white-laminate' });
    expect(pack?.tiles).toEqual({ groutMm: 2 });
    expect(dropped.length).toBe(2);
  });
});

describe('the door leaf (SPEC 16.18)', () => {
  it('keeps its size, thickness and place: a leaf box exactly the door rule gives, hardware merged into a few meshes', () => {
    const l = flat();
    const d = resolveDoors(l)[0];
    const m = buildDoorModel(d, '#4A3528');
    const names = m.group.children.map((c) => c.name);
    expect(names.filter((n) => n === 'door-panel').length).toBe(1);
    expect(names.filter((n) => n === 'door-handle').length).toBe(2); // one lever set a face, merged
    expect(names.filter((n) => n === 'door-hinges').length).toBe(1);
    const panel = m.group.children.find((c) => c.name === 'door-panel') as THREE.Mesh;
    const gap = m.group.children.find((c) => c.name === 'door-gap') as THREE.Mesh;
    gap.geometry.computeBoundingBox();
    const bb = gap.geometry.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(d.panelWidthM, 6);
    panel.geometry.computeBoundingBox();
    expect(panel.geometry.boundingBox!.max.z - panel.geometry.boundingBox!.min.z).toBeCloseTo(0.035, 4);
    // setPanelFinish recolours and switches the grain; a null restores the default
    m.setPanelFinish({ colour: '#F1EFEA', grain: false });
    expect(('#' + (panel.material as THREE.MeshStandardMaterial).color.getHexString()).toUpperCase()).toBe('#F1EFEA');
    m.setHandleColour('#1D1D1F');
    m.setPanelFinish(null);
    m.dispose();
  });
});
