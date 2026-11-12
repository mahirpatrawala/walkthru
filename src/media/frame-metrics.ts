// Owned by C9. SPEC 14.6 "Editor frames" and "Photos". Pure: no node:*, no DOM.

export interface GrayImage { data: Uint8Array | Uint8ClampedArray; width: number; height: number }
export interface FrameMetric { index: number; timeSec: number; sharpness: number; /** 16 hex characters */ hash: string }
/** 64-bit difference hash plus a 12 x 12 RGB grid (432 bytes). Used to match photos to frames. */
export interface ImageDescriptor { hash: string; rgb: Uint8Array }

export const DESCRIPTOR_GRID = 12;
export const HASH_COLS = 9;
export const HASH_ROWS = 8;
/** A photo to frame score above this is "no match" (SPEC 14.6). */
export const NO_MATCH_SCORE = 0.22;

/** Variance of the 3 x 3 Laplacian (4c - n - s - e - w) over interior pixels. */
export function laplacianVariance(data: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const l = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - width] - data[i + width];
      sum += l;
      sumSq += l * l;
      n++;
    }
  }
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

/** Box-average resize of one channel, `stride` interleaved channels apart, to tw x th. */
export function boxResize(data: ArrayLike<number>, width: number, height: number, tw: number, th: number,
  channels = 1, channel = 0): Float64Array {
  const out = new Float64Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * height) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * width) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / tw));
      let s = 0;
      let c = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          s += data[(y * width + x) * channels + channel];
          c++;
        }
      }
      out[ty * tw + tx] = c ? s / c : 0;
    }
  }
  return out;
}

/** 64-bit difference hash: resize to 9 x 8, one bit per horizontal neighbour comparison (left > right). */
export function dHash(data: ArrayLike<number>, width: number, height: number): string {
  const small = boxResize(data, width, height, HASH_COLS, HASH_ROWS);
  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let y = 0; y < HASH_ROWS; y++) {
    for (let x = 0; x < HASH_COLS - 1; x++) {
      const b = small[y * HASH_COLS + x] > small[y * HASH_COLS + x + 1] ? 1 : 0;
      if (bit < 32) hi = (hi * 2 + b) >>> 0;
      else lo = (lo * 2 + b) >>> 0;
      bit++;
    }
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

function popcount4(n: number): number {
  return (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);
}

/** Hamming distance between two 16-hex-character hashes. */
export function hamming(a: string, b: string): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += popcount4(parseInt(a[i], 16) ^ parseInt(b[i], 16));
  return d;
}

/** 12 x 12 RGB grid from interleaved 8-bit RGB. */
export function rgbGrid(rgb: ArrayLike<number>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(DESCRIPTOR_GRID * DESCRIPTOR_GRID * 3);
  for (let c = 0; c < 3; c++) {
    const plane = boxResize(rgb, width, height, DESCRIPTOR_GRID, DESCRIPTOR_GRID, 3, c);
    for (let i = 0; i < plane.length; i++) out[i * 3 + c] = Math.round(plane[i]);
  }
  return out;
}

/** Descriptor from an interleaved RGB image. The hash uses the luma of the same pixels. */
export function describeRgb(rgb: ArrayLike<number>, width: number, height: number): ImageDescriptor {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]);
  }
  return { hash: dHash(gray, width, height), rgb: rgbGrid(rgb, width, height) };
}

export function meanAbsRgbDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 255;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}

/** SPEC 14.6: 0.5 * hamming / 64 + 0.5 * meanAbsRgbDiff / 255. Smaller is closer. */
export function descriptorScore(a: ImageDescriptor, b: ImageDescriptor): number {
  return 0.5 * (hamming(a.hash, b.hash) / 64) + 0.5 * (meanAbsRgbDiff(a.rgb, b.rgb) / 255);
}

/** Metrics for every frame in a raw 8-bit grey stream (frames of `width * height` bytes back to back). */
export function metricsFromGrayStream(buf: Uint8Array, width: number, height: number, fps: number): FrameMetric[] {
  const size = width * height;
  const n = Math.floor(buf.length / size);
  const out: FrameMetric[] = [];
  for (let i = 0; i < n; i++) {
    const frame = buf.subarray(i * size, (i + 1) * size);
    out.push({ index: i, timeSec: i / fps, sharpness: laplacianVariance(frame, width, height), hash: dHash(frame, width, height) });
  }
  return out;
}

export interface SelectOptions { maxFrames: number; windowSec: number; minHamming: number }
export const DEFAULT_SELECT: SelectOptions = { maxFrames: 60, windowSec: 1, minHamming: 7 };

/**
 * The sharpest frame in each window, in time order, dropping any whose hash is closer than `minHamming` to the
 * previously kept frame; if more than `maxFrames` remain, the `maxFrames` sharpest, back in time order.
 */
export function selectEditorFrames(metrics: FrameMetric[], opts?: Partial<SelectOptions>): FrameMetric[] {
  const o = { ...DEFAULT_SELECT, ...opts };
  const best = new Map<number, FrameMetric>();
  for (const m of metrics) {
    const w = Math.floor(m.timeSec / o.windowSec + 1e-9);
    const cur = best.get(w);
    if (!cur || m.sharpness > cur.sharpness) best.set(w, m);
  }
  const perWindow = [...best.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const kept: FrameMetric[] = [];
  for (const m of perWindow) {
    const prev = kept[kept.length - 1];
    if (prev && hamming(prev.hash, m.hash) < o.minHamming) continue;
    kept.push(m);
  }
  if (kept.length <= o.maxFrames) return kept;
  return [...kept].sort((a, b) => b.sharpness - a.sharpness).slice(0, o.maxFrames).sort((a, b) => a.timeSec - b.timeSec);
}
