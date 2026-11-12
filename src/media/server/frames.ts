// Owned by C9. SPEC 14.6: ffprobe, ffmpeg extraction, photo normalisation. Node only.
import fs from 'node:fs';
import path from 'node:path';
import { describeRgb, metricsFromGrayStream } from '../frame-metrics';
import type { FrameMetric, ImageDescriptor } from '../frame-metrics';
import { findTool, run } from './tools';

export interface ToolCtx { signal?: AbortSignal; onLine?: (line: string) => void }

export interface MediaProbe {
  ok: boolean;
  error?: string;
  width: number;
  height: number;
  /** seconds; 0 for a still image */
  durationSec: number;
}

function need(name: 'ffmpeg' | 'ffprobe'): string {
  const p = findTool(name);
  if (!p) throw new Error(`${name} is not installed`);
  return p;
}

/** Size as displayed (a 90 degree rotation tag swaps width and height) and duration of a video or an image. */
export async function probeMedia(file: string, timeoutMs = 20_000, ctx: ToolCtx = {}): Promise<MediaProbe> {
  const fail = (error: string): MediaProbe => ({ ok: false, error, width: 0, height: 0, durationSec: 0 });
  let ffprobe: string;
  try { ffprobe = need('ffprobe'); } catch (e) { return fail((e as Error).message); }
  const r = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { timeoutMs, signal: ctx.signal, captureStdout: 4_000_000 });
  if (r.timedOut) return fail('ffprobe took too long');
  if (r.code !== 0) return fail('not a readable video or photo');
  try {
    const j = JSON.parse(r.stdout.toString('utf8')) as {
      streams?: { codec_type?: string; width?: number; height?: number; duration?: string; tags?: { rotate?: string };
        side_data_list?: { rotation?: number }[] }[];
      format?: { duration?: string };
    };
    const v = (j.streams ?? []).find((s) => s.codec_type === 'video' && (s.width ?? 0) > 0);
    if (!v || !v.width || !v.height) return fail('no picture found in the file');
    let rot = 0;
    for (const sd of v.side_data_list ?? []) if (typeof sd.rotation === 'number') rot = sd.rotation;
    if (v.tags?.rotate) rot = Number(v.tags.rotate) || rot;
    const swap = Math.abs(Math.round(rot / 90)) % 2 === 1;
    const dur = Number(j.format?.duration ?? v.duration ?? 0);
    return { ok: true, width: swap ? v.height : v.width, height: swap ? v.width : v.height, durationSec: Number.isFinite(dur) ? dur : 0 };
  } catch {
    return fail('ffprobe output could not be read');
  }
}

/** SPEC 14.6: fps = min(10, 600 / duration); tiny: min(6, 24 / duration). */
export function reconFps(durationSec: number, mode: 'full' | 'tiny'): number {
  const d = Math.max(0.1, durationSec);
  return mode === 'tiny' ? Math.min(6, 24 / d) : Math.min(10, 600 / d);
}
export function maxReconFrames(mode: 'full' | 'tiny'): number { return mode === 'tiny' ? 24 : 600; }

/** frame-%06d.jpg at fps, native resolution (tiny: 480 wide). Returns the number of frames written. */
export async function extractReconFrames(video: string, imagesDir: string, fps: number, mode: 'full' | 'tiny',
  timeoutMs: number, ctx: ToolCtx = {}): Promise<number> {
  fs.rmSync(imagesDir, { recursive: true, force: true });
  fs.mkdirSync(imagesDir, { recursive: true });
  const vf = mode === 'tiny' ? `fps=${fps},scale=480:-2` : `fps=${fps}`;
  const r = await run(need('ffmpeg'), ['-v', 'error', '-y', '-i', video, '-vf', vf, '-frames:v', String(maxReconFrames(mode)),
    '-q:v', '2', path.join(imagesDir, 'frame-%06d.jpg')], { timeoutMs, signal: ctx.signal, onLine: ctx.onLine });
  if (r.timedOut) throw new Error('Reading the video took too long.');
  if (r.aborted) throw new Error('aborted');
  return fs.readdirSync(imagesDir).filter((f) => /^frame-\d+\.jpg$/.test(f)).length;
}

/** Grey 160-pixel-wide frames piped from ffmpeg and measured (sharpness and hash). */
export async function grayMetrics(video: string, displayW: number, displayH: number, fps: number,
  timeoutMs: number, ctx: ToolCtx = {}): Promise<FrameMetric[]> {
  const w = 160;
  const h = Math.max(2, 2 * Math.round((w * displayH) / displayW / 2));
  const r = await run(need('ffmpeg'), ['-v', 'error', '-i', video, '-vf', `fps=${fps},scale=${w}:${h},format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { timeoutMs, signal: ctx.signal, captureStdout: 200_000_000 });
  if (r.timedOut) throw new Error('Measuring frames took too long.');
  if (r.aborted) throw new Error('aborted');
  return metricsFromGrayStream(new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length), w, h, fps);
}

/** Re-encode one picture: longest side at most `maxSide`, quality `q`, no metadata (EXIF and GPS are dropped). */
export async function encodeJpeg(input: string, output: string, opts: { maxSide: number; q: number; seekSec?: number },
  timeoutMs: number, ctx: ToolCtx = {}): Promise<boolean> {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const args = ['-v', 'error', '-y'];
  if (opts.seekSec !== undefined) args.push('-ss', opts.seekSec.toFixed(3));
  args.push('-i', input, '-frames:v', '1',
    '-vf', `scale='min(${opts.maxSide},iw)':'min(${opts.maxSide},ih)':force_original_aspect_ratio=decrease`,
    '-q:v', String(opts.q), '-map_metadata', '-1', '-update', '1', output);
  const r = await run(need('ffmpeg'), args, { timeoutMs, signal: ctx.signal, onLine: ctx.onLine });
  if (r.aborted) throw new Error('aborted');
  return r.code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0;
}

/** 96 x 96 RGB decode of any picture, turned into the 64-bit hash plus 12 x 12 colour grid. Null when it cannot be read. */
export async function describeImageFile(file: string, ctx: ToolCtx = {}): Promise<ImageDescriptor | null> {
  const S = 96;
  const r = await run(need('ffmpeg'), ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${S}:${S}:flags=area,format=rgb24`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeoutMs: 30_000, signal: ctx.signal, captureStdout: S * S * 3 });
  if (r.code !== 0 || r.stdout.length < S * S * 3) return null;
  return describeRgb(new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, S * S * 3), S, S);
}

/** Size of a picture file, via ffprobe. */
export async function imageSize(file: string): Promise<{ width: number; height: number } | null> {
  const p = await probeMedia(file);
  return p.ok ? { width: p.width, height: p.height } : null;
}

/** First bytes of a JPEG show whether an Exif (APP1) block is present. */
export function hasExif(file: string): boolean {
  const b = fs.readFileSync(file);
  return b.includes(Buffer.from('Exif\0\0', 'latin1'));
}
