// A cheap, order-sensitive checksum of a vertex position array (16.14). Same function in the page that exports the scene and in the
// runtime that applies a bake: a mesh whose checksum differs is not the mesh that was baked, and is left alone.

/** positions in metres (x, y, z per vertex), quantised to the millimetre */
export function positionChecksum(pos: ArrayLike<number>): number {
  let h = 2166136261 >>> 0;
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    const q = Math.round(pos[i] * 1000) | 0;
    h = Math.imul(h ^ (q & 0xffff), 16777619) >>> 0;
    h = Math.imul(h ^ ((q >> 16) & 0xffff), 16777619) >>> 0;
  }
  return h >>> 0;
}

/** The stable key of a mesh: the names from the scene root down, siblings with the same name numbered (`#1`, `#2`). */
export function meshKeyOf(path: { name: string; sibling: number }[]): string {
  return path.map((p) => (p.sibling > 0 ? `${p.name || '_'}#${p.sibling}` : p.name || '_')).join('/');
}
