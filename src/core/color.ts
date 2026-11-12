// Robust colour (SPEC 4.9). Owned by C6. Pure: no DOM.

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
}

/**
 * The colour of a surface from patches of video frames. Pools every RGBA pixel of every patch, sorts by luma
 * `0.2126 R + 0.7152 G + 0.0722 B`, drops the darkest 10% and the brightest 10% (shadows, reflections, blown
 * highlights), takes the per-channel median of the rest and returns `#RRGGBB`. Null when there are no pixels.
 * Pixels with alpha 0 are not drawn pixels (a canvas that was never painted) and are ignored.
 */
export function medianColor(patches: Uint8ClampedArray[]): string | null {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (const p of patches) {
    const n = Math.floor(p.length / 4);
    for (let i = 0; i < n; i++) {
      if (p[i * 4 + 3] === 0) continue;
      r.push(p[i * 4]);
      g.push(p[i * 4 + 1]);
      b.push(p[i * 4 + 2]);
    }
  }
  const n = r.length;
  if (n === 0) return null;

  const luma = new Float64Array(n);
  for (let i = 0; i < n; i++) luma[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => luma[x] - luma[y] || x - y);
  const cut = Math.floor(n * 0.1);
  const kept = order.slice(cut, n - cut);

  const median = (channel: number[]): number => {
    const v = kept.map((i) => channel[i]).sort((x, y) => x - y);
    const m = v.length >> 1;
    return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  return `#${hex2(median(r))}${hex2(median(g))}${hex2(median(b))}`;
}
