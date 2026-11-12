// Owned by C9. SPEC 14.11: synthetic test videos and photos. Needs ffmpeg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSplatFragment, rawFromTruth } from './make-test-room';
import { findTool, run } from '../src/media/server/tools';
import type { Vec3 } from '../src/types';

function ffmpeg(): string {
  const p = findTool('ffmpeg');
  if (!p) throw new Error('ffmpeg is not installed');
  return p;
}

async function must(args: string[]): Promise<void> {
  const lines: string[] = [];
  const r = await run(ffmpeg(), ['-v', 'error', '-y', ...args], { timeoutMs: 120_000, onLine: (l) => lines.push(l) });
  if (r.code !== 0) throw new Error(`ffmpeg failed: ${lines.slice(-3).join(' | ')}`);
}

/** testsrc2 video, no parallax: exercises probing, frames, hashing and the soft-fail path (COLMAP cannot map it). */
export async function buildLavfiVideo(outPath: string, opts: { seconds?: number; size?: string; fps?: number } = {}): Promise<void> {
  const { seconds = 4, size = '360x640', fps = 30 } = opts;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await must(['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${fps}`, '-t', String(seconds), '-pix_fmt', 'yuv420p', outPath]);
}

// ---------------------------------------------------------------- room render

const FOV_DEG = 70;
const START: Vec3 = { x: 3.2, y: 1.4, z: 0.8 };
const END: Vec3 = { x: 2.2, y: 1.4, z: 4.0 };
const TARGET: Vec3 = { x: 0.8, y: 0.9, z: 2.4 };

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Software render of the synthetic splat fragment: pinhole camera (70 degrees), every point a square of side
 * max(1, round(0.03 * f / depth)) pixels with a z-buffer, colour times 0.55 + 0.45 * noise (noise = hash of the point
 * quantised to 4 cm) so every surface carries a stable speckle for SIFT. Returns one RGB buffer per frame.
 * The camera path is in the truth frame; it is carried into the splat's raw frame with `rawFromTruth`.
 */
export function renderRoomFrames(opts: { frames?: number; size?: [number, number] } = {}): { frames: Uint8Array[]; width: number; height: number } {
  const n = opts.frames ?? 48;
  const [W, H] = opts.size ?? [480, 640];
  const { cloud } = buildSplatFragment();
  const SCALE = 0.37; // truth metres per raw unit (TRUTH.scale)
  const fpx = (W / 2) / Math.tan((FOV_DEG * Math.PI) / 360);
  const origin = rawFromTruth({ x: 0, y: 0, z: 0 });
  const linear = (v: Vec3): Vec3 => { const r = rawFromTruth(v); return { x: r.x - origin.x, y: r.y - origin.y, z: r.z - origin.z }; };
  const q = 0.04 / SCALE;
  // speckle brightness per point, fixed across frames
  const speckle = new Float32Array(cloud.count);
  for (let i = 0; i < cloud.count; i++) {
    speckle[i] = 0.55 + 0.45 * hash3(Math.floor(cloud.positions[i * 3] / q), Math.floor(cloud.positions[i * 3 + 1] / q), Math.floor(cloud.positions[i * 3 + 2] / q));
  }
  const out: Uint8Array[] = [];
  const depth = new Float32Array(W * H);
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0 : k / (n - 1);
    const pos: Vec3 = { x: START.x + (END.x - START.x) * t, y: START.y + (END.y - START.y) * t, z: START.z + (END.z - START.z) * t };
    const f = norm(sub(TARGET, pos));
    const right = norm(cross(f, { x: 0, y: 1, z: 0 }));
    const up = cross(right, f);
    const fr = norm(linear(f)), rr = norm(linear(right)), ur = norm(linear(up));
    const cam = rawFromTruth(pos);
    const img = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) { img[i * 3] = 20; img[i * 3 + 1] = 20; img[i * 3 + 2] = 24; }
    depth.fill(Infinity);
    for (let i = 0; i < cloud.count; i++) {
      const dx = cloud.positions[i * 3] - cam.x, dy = cloud.positions[i * 3 + 1] - cam.y, dz = cloud.positions[i * 3 + 2] - cam.z;
      const z = dx * fr.x + dy * fr.y + dz * fr.z;
      if (z < 0.05) continue;
      const px = W / 2 + (fpx * (dx * rr.x + dy * rr.y + dz * rr.z)) / z;
      const py = H / 2 - (fpx * (dx * ur.x + dy * ur.y + dz * ur.z)) / z;
      const side = Math.max(1, Math.round(((0.03 / SCALE) * fpx) / z));
      const x0 = Math.round(px - side / 2), y0 = Math.round(py - side / 2);
      const s = speckle[i];
      const r = cloud.rgb[i * 3] * s, g = cloud.rgb[i * 3 + 1] * s, b = cloud.rgb[i * 3 + 2] * s;
      for (let y = Math.max(0, y0); y < Math.min(H, y0 + side); y++) {
        for (let x = Math.max(0, x0); x < Math.min(W, x0 + side); x++) {
          const di = y * W + x;
          if (z < depth[di]) { depth[di] = z; img[di * 3] = r; img[di * 3 + 1] = g; img[di * 3 + 2] = b; }
        }
      }
    }
    out.push(img);
  }
  return { frames: out, width: W, height: H };
}

/** Raw RGB frames to a file: an H.264 video (12 fps) or numbered JPEGs. */
async function withRawFile<T>(frames: Uint8Array[], fn: (rawPath: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-raw-'));
  const raw = path.join(dir, 'frames.rgb');
  try {
    const fd = fs.openSync(raw, 'w');
    for (const f of frames) fs.writeSync(fd, f);
    fs.closeSync(fd);
    return await fn(raw);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A walk through the synthetic room with real parallax, 12 fps H.264. */
export async function buildRoomVideo(outPath: string, opts: { frames?: number; size?: [number, number] } = {}): Promise<void> {
  const { frames, width, height } = renderRoomFrames(opts);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await withRawFile(frames, (raw) => must(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-framerate', '12', '-i', raw,
    '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', outPath]));
}

/** Writes one raw RGB frame as a JPEG, optionally scaled (factor) and at a given quality (ffmpeg -q:v). */
export async function writeFrameJpeg(rgb: Uint8Array, width: number, height: number, outPath: string,
  opts: { q?: number; scale?: number } = {}): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await withRawFile([rgb], (raw) => must(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-i', raw, '-frames:v', '1',
    ...(opts.scale && opts.scale !== 1 ? ['-vf', `scale=iw*${opts.scale}:ih*${opts.scale}`] : []),
    '-q:v', String(opts.q ?? 2), '-update', '1', outPath]));
}

/** `n` frames of the room render, spread along the walk, saved as photo-001.jpg ...: stand-ins for WhatsApp photos. */
export async function buildTestPhotos(dir: string, n: number): Promise<string[]> {
  const { frames, width, height } = renderRoomFrames({ frames: Math.max(2, n) });
  const files: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = path.join(dir, `photo-${String(i + 1).padStart(3, '0')}.jpg`);
    await writeFrameJpeg(frames[i], width, height, f, { q: 2 });
    files.push(f);
  }
  return files;
}

const isMain = process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const outDir = process.argv[2] ?? path.resolve(os.tmpdir(), 'walkthru-test-video');
  await buildLavfiVideo(path.join(outDir, 'lavfi.mp4'));
  await buildRoomVideo(path.join(outDir, 'room.mp4'));
  console.log(`wrote ${outDir}/lavfi.mp4 and room.mp4`);
}
