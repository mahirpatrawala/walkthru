// Owned by C1. Stub from C0: signatures only (SPEC 7.1, spec in section 5). Must run under Node.
import type * as THREE from 'three';
import type { Layout } from '../types';

export function buildShell(layout: Layout): THREE.Group {
  throw new Error('not implemented: C1 buildShell');
}
export function disposeShell(group: THREE.Group): void {
  throw new Error('not implemented: C1 disposeShell');
}
export function shellStats(group: THREE.Group): { floorAreaM2: Record<string, number>; wallFaceAreaM2: number } {
  throw new Error('not implemented: C1 shellStats');
}
