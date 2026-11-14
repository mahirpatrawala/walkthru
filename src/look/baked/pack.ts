// A small rectangle packer (MaxRects, best short side fit) for the lightmap atlas (SPEC 16.14). Pure and deterministic.

export interface PackRect { id: number; w: number; h: number }
export interface Placed { id: number; x: number; y: number; w: number; h: number }

interface Free { x: number; y: number; w: number; h: number }

/** Packs the rectangles into a size x size square. Returns null when they do not fit. Larger rectangles first, ties by id. */
export function packRects(rects: PackRect[], size: number): Placed[] | null {
  const order = [...rects].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h || a.id - b.id);
  let free: Free[] = [{ x: 0, y: 0, w: size, h: size }];
  const out: Placed[] = [];
  for (const r of order) {
    if (r.w > size || r.h > size) return null;
    let best: Free | null = null;
    let bestShort = Infinity, bestLong = Infinity;
    for (const f of free) {
      if (f.w < r.w || f.h < r.h) continue;
      const short = Math.min(f.w - r.w, f.h - r.h);
      const long = Math.max(f.w - r.w, f.h - r.h);
      if (short < bestShort || (short === bestShort && long < bestLong)) { best = f; bestShort = short; bestLong = long; }
    }
    if (!best) return null;
    const placed: Placed = { id: r.id, x: best.x, y: best.y, w: r.w, h: r.h };
    out.push(placed);
    const next: Free[] = [];
    for (const f of free) {
      if (placed.x >= f.x + f.w || placed.x + placed.w <= f.x || placed.y >= f.y + f.h || placed.y + placed.h <= f.y) { next.push(f); continue; }
      if (placed.x > f.x) next.push({ x: f.x, y: f.y, w: placed.x - f.x, h: f.h });
      if (placed.x + placed.w < f.x + f.w) next.push({ x: placed.x + placed.w, y: f.y, w: f.x + f.w - placed.x - placed.w, h: f.h });
      if (placed.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: placed.y - f.y });
      if (placed.y + placed.h < f.y + f.h) next.push({ x: f.x, y: placed.y + placed.h, w: f.w, h: f.y + f.h - placed.y - placed.h });
    }
    // drop free rectangles contained in another
    free = next.filter((a, i) => !next.some((b, j) => i !== j && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (i > j || a.w * a.h < b.w * b.h || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h)));
  }
  return out;
}

/** The smallest power-of-two square from `min` to `max` that holds every rectangle, with its placements; null when even `max` is too small. */
export function packSmallest(rects: PackRect[], min: number, max: number): { size: number; placed: Placed[] } | null {
  const area = rects.reduce((s, r) => s + r.w * r.h, 0);
  for (let size = min; size <= max; size *= 2) {
    if (size * size < area) continue;
    const placed = packRects(rects, size);
    if (placed) return { size, placed };
  }
  return null;
}
