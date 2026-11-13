// Rooms that are only partly on the drawing: the importer tags them, the loader keeps the tag, the shell draws them as "beyond your
// drawing", the room list and the view badge say so. Synthetic layouts only.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { offSheetReason, sheetArea } from '../src/import/partial';
import { chooseSpawn } from '../src/import/propose';
import { createEmptyProperty, validateProperty } from '../src/core/layout-validate';
import { defaultEdges } from '../src/core/layout-geom';
import { rasterizeLayout } from '../src/core/layout-raster';
import { buildShell } from '../src/engine/shell';
import { roomsSummary } from '../src/buyer/rooms';
import { PARTIAL_NOTE, roomChipText, unmeasuredRoomsNear } from '../src/buyer/store';
import { partialRoomInView } from '../src/buyer/partial-badge';
import type { Layout, RoomTag } from '../src/types';

const rect = (id: string, x0: number, z0: number, x1: number, z1: number, partial = false): RoomTag => {
  const r: RoomTag = { id, roomType: 'bedroom', label: id, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'] };
  return partial ? { ...r, partial: { reason: 'Only part of it is drawn.' } } : r;
};
/** a whole room on the left, a partial room to its right (a 0.12 m wall between), joined by an open doorway on the whole room's right edge */
function layout(): Layout {
  const p = createEmptyProperty('synthetic-partial');
  const a = rect('whole', 0, 0, 4, 3), b = rect('guess', 4.12, 0, 7, 3, true);
  p.layout.rooms = [a, b].map((r) => ({ ...r, edges: defaultEdges(r, [a, b]) }));
  p.layout.openings = [{ id: 'opening-1', roomId: 'whole', edge: 1, type: 'opening', centreM: 1.5, widthM: 0.9, sillM: 0, headM: 2.1 }];
  return p.layout;
}

describe('importer: off-sheet rooms', () => {
  const sheet = sheetArea({ width: 800, height: 600, strokes: [] });
  it('the sheet is the page when no border is drawn, the border when there is one', () => {
    expect(sheet).toEqual([0, 0, 800, 600]);
    const border = { closed: true, color: '#000', width: 1, hasCurve: false, points: [{ x: 20, y: 20 }, { x: 780, y: 20 }, { x: 780, y: 580 }, { x: 20, y: 580 }, { x: 20, y: 20 }] };
    expect(sheetArea({ width: 800, height: 600, strokes: [border] })).toEqual([20, 20, 780, 580]);
  });
  it('a rectangle inside the sheet is whole', () => {
    expect(offSheetReason([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 250 }, { x: 100, y: 250 }], sheet, 8, 50)).toBeNull();
  });
  it('a rectangle sticking out of the sheet names the side that is on the drawing', () => {
    const why = offSheetReason([{ x: -150, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 250 }, { x: -150, y: 250 }], sheet, 8, 50);
    expect(why).toContain('is on your drawing');
    expect(why).toContain('far wall is off the sheet');
    expect(why).toContain(`9'10"`); // the 3 m side is the one that stays on the sheet
    expect(why).not.toMatch(/[:;—]/);
  });
  it('a rectangle that only touches the edge within the tolerance is whole', () => {
    expect(offSheetReason([{ x: -5, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 250 }, { x: -5, y: 250 }], sheet, 8, 50)).toBeNull();
  });
});

describe('the partial tag survives loading', () => {
  it('validateProperty keeps room.partial', () => {
    const p = createEmptyProperty('synthetic-partial');
    p.layout = layout();
    const back = validateProperty(JSON.parse(JSON.stringify(p)));
    expect(back.layout.rooms.find((r) => r.id === 'guess')?.partial?.reason).toBe('Only part of it is drawn.');
    expect(back.layout.rooms.find((r) => r.id === 'whole')?.partial).toBeUndefined();
  });
});

describe('3D shell', () => {
  const l = layout();
  const shell = buildShell(l);
  const names = shell.children.map((c) => c.name);
  it('a partial room has no ceiling, a hatched floor, a low footing and a ghost panel; a whole room is unchanged', () => {
    expect(names).toContain('ceiling:whole');
    expect(names).not.toContain('ceiling:guess');
    expect(names).toContain('floor:guess');
    expect(names).toContain('ghost:guess');
    expect(names).not.toContain('ghost:whole');
    const foot = new THREE.Box3().setFromObject(shell.getObjectByName('walls:guess')!);
    expect(foot.max.y).toBeLessThanOrEqual(0.3 + 1e-6);
    const ghost = shell.getObjectByName('ghost:guess') as THREE.Mesh;
    expect((ghost.material as THREE.Material).transparent).toBe(true);
    const whole = new THREE.Box3().setFromObject(shell.getObjectByName('walls:whole')!);
    expect(whole.max.y).toBeCloseTo(l.wallHeightM, 5);
  });
  it('a partial room gets no finish colour from the global finishes', () => {
    const m = (shell.getObjectByName('floor:guess') as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(m.userData.partialLook).toBe(true);
  });
  it('the added doorway between a whole and a partial room is a drawing-edge panel, with no door frame', () => {
    expect(names).toContain('drawing-edge');
    expect(names).not.toContain('frames');
  });
  it('a layout with no partial room builds exactly as before', () => {
    const plain = layout();
    plain.rooms = plain.rooms.map(({ partial: _p, ...r }) => r);
    const n = buildShell(plain).children.map((c) => c.name);
    expect(n.some((x) => x.startsWith('ghost:') || x === 'drawing-edge')).toBe(false);
  });
});

describe('room list, chip, badge', () => {
  const l = layout();
  it('the rooms sheet marks the partial room and does not confirm the carpet area', () => {
    const s = roomsSummary(l);
    expect(s.rows.find((r) => r.id === 'guess')).toMatchObject({ text: PARTIAL_NOTE, partial: true, reason: 'Only part of it is drawn.' });
    expect(s.rows.find((r) => r.id === 'whole')?.partial).toBe(false);
    expect(s.carpetLine).toContain("can't be confirmed");
    expect(s.carpetLine).toContain('guess');
  });
  it('the chip says the shape is guessed', () => {
    expect(roomChipText(l, { x: 5, z: 1 })).toBe('guess · shape guessed');
    expect(roomChipText(l, { x: 2, z: 1 })).toContain('sq ft');
  });
  it('a distance that touches a partial room says not measured', () => {
    expect(unmeasuredRoomsNear(l, {}, [{ x: 5, z: 1 }])).toEqual(['guess']);
    expect(unmeasuredRoomsNear(l, {}, [{ x: 1, z: 1 }])).toEqual([]);
  });
  it('the badge shows when in a partial room or looking into one through the doorway, not when facing away or at a wall', () => {
    const g = rasterizeLayout(l);
    expect(partialRoomInView(l, g, { x: 5, z: 1.5 }, 0)?.id).toBe('guess');
    expect(partialRoomInView(l, g, { x: 1, z: 1.5 }, 90)?.id).toBe('guess'); // east, through the doorway at z 1.5
    expect(partialRoomInView(l, g, { x: 1, z: 1.5 }, 270)).toBeNull();
    expect(partialRoomInView(l, g, { x: 3.6, z: 0.4 }, 90)).toBeNull(); // the wall beside the doorway
  });
});

describe('start point', () => {
  it('is never in a partial room, even when it is the largest', () => {
    const l = layout();
    l.rooms = l.rooms.map((r) => (r.id === 'guess' ? { ...rect('guess', 4.12, 0, 14, 6, true), edges: r.edges } : r));
    const sp = chooseSpawn(l, []);
    expect(sp).not.toBeNull();
    expect(sp!.x).toBeLessThan(4);
  });
});
