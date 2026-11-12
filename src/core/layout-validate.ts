// Owned by C1. Stub from C0: signatures only (SPEC 7.1, rules in 5.5).
import type { Layout, PropertyFile, RoomTag } from '../types';

export function validateLayout(layout: Layout): { errors: string[]; warnings: string[] } {
  throw new Error('not implemented: C1 validateLayout');
}
export function normalizeRoom(room: RoomTag): RoomTag {
  throw new Error('not implemented: C1 normalizeRoom');
}
export function createEmptyProperty(id: string): PropertyFile {
  throw new Error('not implemented: C1 createEmptyProperty');
}
export function validateProperty(json: unknown): PropertyFile {
  throw new Error('not implemented: C1 validateProperty');
}
