import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import {
  carpetAreaM2, computeEdgeFrames, computeTunnels, computeWallPieces, defaultEdges, pieceRect, roomAt, tunnelRect,
} from '../src/core/layout-geom';
import type { Layout } from '../src/types';

const truth = buildTruthProperty('empty').layout;
const frame = (layout: Layout, roomId: string, edge: number) =>
  computeEdgeFrames(layout).find((f) => f.roomId === roomId && f.edge === edge)!;

describe('edge frames (SPEC 4.1)', () => {
  it('bedroom edge 0 and balcony edge 2 are partners, gap 0.12, thickness 0.06 each', () => {
    for (const [r, e] of [['bedroom', 0], ['balcony', 2]] as const) {
      const f = frame(truth, r, e);
      expect(f.partnerGap).toBeCloseTo(0.12, 9);
      expect(f.thickness).toBeCloseTo(0.06, 9);
    }
  });
  it('bedroom edge 1 has no partner and thickness 0.12', () => {
    const f = frame(truth, 'bedroom', 1);
    expect(f.partnerGap).toBeNull();
    expect(f.thickness).toBeCloseTo(0.12, 9);
  });
  it('railings are 0.05, and normals point outward', () => {
    expect(frame(truth, 'balcony', 0).thickness).toBe(0.05);
    expect(frame(truth, 'bedroom', 0).out).toEqual({ x: 0, z: -1 }); // north
    expect(frame(truth, 'bedroom', 2).out.z).toBeCloseTo(1, 9);
  });
});

describe('tunnels', () => {
  const tunnels = computeTunnels(truth);
  const byId = (id: string) => tunnels.find((t) => t.openingId === id)!;
  it('door-bed and door-main have depth 0.12', () => {
    expect(byId('door-bed').depth).toBeCloseTo(0.12, 9);
    expect(byId('door-main').depth).toBeCloseTo(0.12, 9);
  });
  it('slider is 0.12 deep through both walls; the window is not passable', () => {
    expect(byId('slider').depth).toBeCloseTo(0.12, 9);
    expect(byId('window').passable).toBe(false);
    expect(byId('door-bed').passable).toBe(true);
  });
  it('door-bed spans u 2.7..3.6 on the edge from (4,5) to (0,5), i.e. x 1.3..0.4', () => {
    const t = byId('door-bed');
    expect(t.u0).toBeCloseTo(2.7, 9);
    expect(t.u1).toBeCloseTo(3.6, 9);
    const r = tunnelRect(frame(truth, 'bedroom', 2), t);
    expect(r[0].x).toBeCloseTo(1.3, 9);
    expect(r[1].x).toBeCloseTo(0.4, 9);
    expect(r[2].z).toBeCloseTo(5.12, 9);
  });
  it("'none' edges give a whole-edge passable tunnel with the partner gap as depth", () => {
    const l: Layout = JSON.parse(JSON.stringify(truth));
    l.rooms[1].edges[2] = 'none';
    const t = computeTunnels(l).find((x) => x.openingId === null)!;
    expect(t).toMatchObject({ roomId: 'balcony', edge: 2, u0: 0, passable: true, sillM: 0, headM: 2.6, type: 'opening' });
    expect(t.u1).toBeCloseTo(3, 9);
    expect(t.depth).toBeCloseTo(0.12, 9);
    // the bedroom's wall facing it is cut over the balcony's width, so no full-height piece stands there
    const cutPieces = computeWallPieces(l).filter((p) => p.roomId === 'bedroom' && p.edge === 0 && p.y0 === 0 && p.y1 === 2.6);
    expect(cutPieces.length).toBeGreaterThan(0);
    for (const p of cutPieces) expect(p.u1 <= 0.5 + 1e-6 || p.u0 >= 3.5 - 1e-6).toBe(true);
  });
});

describe('wall pieces', () => {
  const pieces = computeWallPieces(truth);
  it('bedroom north wall: corners closed by 0.06, slider hole, lintel from 2.2', () => {
    const p = pieces.filter((q) => q.roomId === 'bedroom' && q.edge === 0).sort((a, b) => a.u0 - b.u0 || a.y0 - b.y0);
    expect(p[0].u0).toBeCloseTo(-0.06, 9);
    expect(p[p.length - 1].u1).toBeCloseTo(4.06, 9);
    const lintel = p.find((q) => q.y0 > 0)!;
    expect(lintel.y0).toBeCloseTo(2.2, 9);
    expect(lintel.u0).toBeCloseTo(1.2, 9);
    expect(lintel.u1).toBeCloseTo(2.8, 9);
    // x 1.2..2.8 is open at floor level: no piece with y0 = 0 covers u = 2
    expect(p.some((q) => q.y0 === 0 && q.u0 < 2 && q.u1 > 2)).toBe(false);
  });
  it('window gives a 0.9 sill and a lintel from 2.1', () => {
    const p = pieces.filter((q) => q.roomId === 'bedroom' && q.edge === 3);
    expect(p.find((q) => q.y0 === 0 && Math.abs(q.y1 - 0.9) < 1e-9)).toBeTruthy();
    expect(p.find((q) => Math.abs(q.y0 - 2.1) < 1e-9)).toBeTruthy();
  });
  it('the passage wall is cut by the bedroom door through the partner', () => {
    const p = pieces.filter((q) => q.roomId === 'passage' && q.edge === 0 && q.y0 === 0 && q.y1 === 2.6);
    expect(p.some((q) => q.u0 < 0.8 && q.u1 > 0.8)).toBe(false);
  });
  it('pieceRect is thickness deep outward', () => {
    const p = pieces.find((q) => q.roomId === 'bedroom' && q.edge === 0 && q.y0 === 0)!;
    const r = pieceRect(frame(truth, 'bedroom', 0), p);
    expect(Math.abs(r[2].z - r[1].z)).toBeCloseTo(0.06, 9);
  });
});

describe('room queries', () => {
  it('carpet area excludes the balcony', () => expect(carpetAreaM2(truth)).toBeCloseTo(24.8, 9));
  it('roomAt', () => {
    expect(roomAt(truth, { x: 2, z: -1 })?.id).toBe('balcony');
    expect(roomAt(truth, { x: 2, z: 2 })?.id).toBe('bedroom');
    expect(roomAt(truth, { x: 0.85, z: 5.06 })).toBeNull();
  });
  it('defaultEdges: balcony edges facing no room are railings', () => {
    const [bed, bal, pas] = truth.rooms;
    expect(defaultEdges({ ...bal, edges: [] }, [bed, pas])).toEqual(['railing', 'railing', 'wall', 'railing']);
    expect(defaultEdges(bed, [bal, pas])).toEqual(['wall', 'wall', 'wall', 'wall']);
  });
  it('a stepped facade (same-facing edges) is not a partner', () => {
    const l: Layout = JSON.parse(JSON.stringify(truth));
    // move the passage 0.2 m east, then its east wall (x=4.2) faces the same way as the bedroom's (x=4)
    l.rooms[2].polygon = l.rooms[2].polygon.map((p) => ({ x: p.x + 0.2, z: p.z + 0 }));
    expect(computeEdgeFrames(l).find((f) => f.roomId === 'bedroom' && f.edge === 1)!.partnerGap).toBeNull();
  });
});
