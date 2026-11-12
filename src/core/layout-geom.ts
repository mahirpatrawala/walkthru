// Owned by C1. Stub from C0: signatures only (SPEC 7.1, algorithms in 4.1).
import type { EdgeFrame, EdgeKind, Layout, RoomTag, Tunnel, Vec2, WallPiece } from '../types';

export function computeEdgeFrames(layout: Layout): EdgeFrame[] {
  throw new Error('not implemented: C1 computeEdgeFrames');
}
export function computeTunnels(layout: Layout): Tunnel[] {
  throw new Error('not implemented: C1 computeTunnels');
}
export function computeWallPieces(layout: Layout): WallPiece[] {
  throw new Error('not implemented: C1 computeWallPieces');
}
export function pieceRect(frame: EdgeFrame, piece: WallPiece): [Vec2, Vec2, Vec2, Vec2] {
  throw new Error('not implemented: C1 pieceRect');
}
export function tunnelRect(frame: EdgeFrame, t: Tunnel, pad?: number): [Vec2, Vec2, Vec2, Vec2] {
  throw new Error('not implemented: C1 tunnelRect');
}
export function roomAt(layout: Layout, pt: Vec2): RoomTag | null {
  throw new Error('not implemented: C1 roomAt');
}
/** rooms except balconies */
export function carpetAreaM2(layout: Layout): number {
  throw new Error('not implemented: C1 carpetAreaM2');
}
/** the balcony rule in 2.2 E3 */
export function defaultEdges(room: RoomTag, others: RoomTag[]): EdgeKind[] {
  throw new Error('not implemented: C1 defaultEdges');
}
