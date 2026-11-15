// Local raster path, the text-recognition engine behind one small interface (SPEC 17.17). Node only: the one place besides ocr.ts that
// starts a process. The interface knows nothing of Python: a backend answers two calls, "find and read every text line of this image"
// and "read these single-line crops", on grey pixels. Today the answer comes from RapidOCR (PP-OCR detection and recognition models,
// ONNX Runtime, Apache-2.0) in a Python worker (tools/understand/rapid-worker.py); the same ONNX files can be run later by
// `onnxruntime-node` in a serverless function or `onnxruntime-web` in the browser by a backend that returns the same shapes.
//
// Nothing is installed or downloaded here. `tools/understand/setup-ocr.sh` makes the venv and puts the models in `<home>/models`; with
// no engine installed `ocrEngine()` says so and the caller falls back to Tesseract (local/ocr.ts).
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Gray } from '../pixels/image';
import { encodePng } from '../pixels/image';

/** One line of text the engine found: its four corners in the image it was given (clockwise from top left) and what it read. */
export interface OcrLine { box: [number, number][]; text: string; conf: number }
export interface OcrRead { text: string; conf: number }
export interface OcrBackend {
  readonly name: string;
  /** model files in use and their sizes in bytes, for the notes */
  readonly info: string;
  /** detect and read every text line of a grey image (any angle the detector finds; upside-down lines are turned) */
  page(img: Gray): Promise<OcrLine[]>;
  /** read single-line crops with no detection */
  lines(imgs: Gray[]): Promise<OcrRead[]>;
  close(): void;
  /** CPU seconds and peak memory the engine has used so far (for the per-plan cost line of an evaluation) */
  stats(): { cpuSeconds: number; peakRssMb: number; calls: number };
}
export type OcrEngineStatus = { engine: OcrBackend } | { engine: null; reason: string };

/** Where the venv and the models live: $WALKTHRU_OCR_HOME, else ~/walkthru-tools/ocr (what tools/understand/setup-ocr.sh makes). */
export const ocrHome = (): string => process.env.WALKTHRU_OCR_HOME || path.join(os.homedir(), 'walkthru-tools', 'ocr');
const workerScript = (): string => fileURLToPath(new URL('../../../tools/understand/rapid-worker.py', import.meta.url));

interface Pending { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }

/** The RapidOCR worker: a long-lived Python process speaking one JSON line per request. Starts on first use. */
export function rapidPythonBackend(home = ocrHome()): Promise<OcrEngineStatus> {
  const python = path.join(home, 'venv', 'bin', 'python3');
  const models = path.join(home, 'models');
  const script = workerScript();
  if (!fs.existsSync(python)) return Promise.resolve({ engine: null, reason: `no Python environment at ${home}/venv` });
  if (!fs.existsSync(models)) return Promise.resolve({ engine: null, reason: `no model folder at ${models}` });
  if (!fs.existsSync(script)) return Promise.resolve({ engine: null, reason: `the worker script is missing (${script})` });
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-rapid-'));
    const args = ['-I', script, '--models', models, '--threads', process.env.WALKTHRU_OCR_THREADS || '2'];
    if (process.env.WALKTHRU_OCR_DET) args.push('--det', process.env.WALKTHRU_OCR_DET);
    if (process.env.WALKTHRU_OCR_REC) args.push('--rec', process.env.WALKTHRU_OCR_REC);
    const child: ChildProcessWithoutNullStreams = spawn(python, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map<number, Pending>();
    // a worker that is alive must not keep the host process open, but a request in flight must (the timer is the keep-alive)
    let keep: ReturnType<typeof setInterval> | null = null;
    let starting = true;
    keep = setInterval(() => undefined, 1 << 30); // alive while the worker starts
    const settle = (): void => { if (!pending.size && !starting && keep) { clearInterval(keep); keep = null; } };
    const used = { cpuSeconds: 0, peakRssMb: 0, calls: 0 };
    let nextId = 1, buf = '', readyDone = false, dead: string | null = null, info = '';
    const fail = (why: string): void => {
      dead = dead ?? why;
      for (const p of pending.values()) p.reject(new Error(dead));
      pending.clear(); settle();
      starting = false; settle();
      if (!readyDone) { readyDone = true; resolve({ engine: null, reason: dead }); }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      buf += d;
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        if ('ready' in msg) {
          if (readyDone) continue;
          readyDone = true; starting = false; settle();
          if (msg.ready) {
            const bytes = (msg.bytes ?? {}) as Record<string, number>;
            info = `${Object.entries((msg.models ?? {}) as Record<string, string>).map(([k, v]) => `${k} ${v} (${((bytes[k] ?? 0) / 1e6).toFixed(1)} MB)`).join(', ')}`;
            resolve({ engine: backend });
          } else { dead = String(msg.error ?? 'the worker did not start'); resolve({ engine: null, reason: dead }); }
          continue;
        }
        const p = pending.get(msg.id as number);
        if (!p) continue;
        pending.delete(msg.id as number); settle();
        if (typeof msg.cpu === 'number') { used.cpuSeconds = msg.cpu; used.peakRssMb = Math.max(used.peakRssMb, Number(msg.rssMb) || 0); used.calls++; }
        if (msg.error) p.reject(new Error(String(msg.error))); else p.resolve(msg);
      }
    });
    let errTail = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => { errTail = (errTail + d).slice(-400); });
    child.on('error', (e) => fail(`could not start Python: ${e.message}`));
    child.on('exit', (code) => fail(`the OCR worker stopped (exit ${code})${errTail ? `: ${errTail.trim().split('\n').pop()}` : ''}`));
    child.unref(); (child.stdout as unknown as { unref?: () => void }).unref?.(); (child.stderr as unknown as { unref?: () => void }).unref?.(); (child.stdin as unknown as { unref?: () => void }).unref?.();

    const call = (req: Record<string, unknown>): Promise<Record<string, unknown>> => new Promise((res, rej) => {
      if (dead) return rej(new Error(dead));
      const id = nextId++;
      pending.set(id, { resolve: res, reject: rej });
      keep ??= setInterval(() => undefined, 1 << 30);
      child.stdin.write(`${JSON.stringify({ id, ...req })}\n`);
    });
    let seq = 0;
    const png = (g: Gray): string => { const f = path.join(dir, `i${seq++}.png`); fs.writeFileSync(f, encodePng(g)); return f; };
    const backend: OcrBackend = {
      name: 'rapidocr',
      get info() { return info; },
      stats: () => ({ ...used }),
      async page(img) {
        const f = png(img);
        try { return ((await call({ op: 'page', path: f })).lines ?? []) as OcrLine[]; } finally { fs.rmSync(f, { force: true }); }
      },
      async lines(imgs) {
        if (!imgs.length) return [];
        const fs2 = imgs.map(png);
        try { return ((await call({ op: 'rec', paths: fs2 })).reads ?? []) as OcrRead[]; } finally { for (const f of fs2) fs.rmSync(f, { force: true }); }
      },
      close() {
        if (!dead) { try { child.stdin.write('{"op":"quit"}\n'); child.stdin.end(); } catch { /* already gone */ } }
        dead = dead ?? 'closed';
        fs.rmSync(dir, { recursive: true, force: true });
        cached = undefined;
      },
    };
  });
}

let cached: Promise<OcrEngineStatus> | undefined;
/** The PP-OCR engine when it is installed (started once and kept), else why not. Never installs or downloads anything. */
export function ocrEngine(): Promise<OcrEngineStatus> {
  if (process.env.WALKTHRU_OCR === 'tesseract') return Promise.resolve({ engine: null, reason: 'WALKTHRU_OCR=tesseract' });
  cached ??= rapidPythonBackend();
  return cached;
}
/** Stop the worker (a host process that stays up should call this when it is done reading pictures). */
export async function closeOcrEngine(): Promise<void> {
  if (!cached) return;
  const s = await cached;
  if (s.engine) s.engine.close();
  cached = undefined;
}
/** What the running engine has used so far (null when none is running). */
export async function ocrEngineStats(): Promise<{ name: string; info: string; cpuSeconds: number; peakRssMb: number; calls: number } | null> {
  if (!cached) return null;
  const s = await cached;
  return s.engine ? { name: s.engine.name, info: s.engine.info, ...s.engine.stats() } : null;
}
export const NO_ENGINE_NOTE = (reason: string): string => `The stronger local text reader (PP-OCR) is not installed (${reason}), so Tesseract was used. Expect far fewer rooms and sizes read. Run tools/understand/setup-ocr.sh to install it.`;
