// C12b. SPEC 17.5 item 3: local OCR as a third reader, behind an interface. Node only: this is one of the few files allowed to
// spawn a process (SPEC 17.3). Nothing here is installed by the project: when no engine is present `availableEngine()` says so,
// says why, and `readCrops` returns an empty list, so the pipeline carries on with PDF text and glyphs alone.
//
// Engines, in order of preference (SPEC 17.5): Tesseract 5 (`brew install tesseract`), then RapidOCR through the helper
// tools/understand/ocr.py in the C10 Python venv. Two engines agreeing raise confidence; they never verify each other and
// neither can make a value `verified` (only verify.ts does, from geometry).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ReadMethod, TextRead } from './reads';

/** One crop to read: an upright image of one text region, with where it came from. */
export interface OcrCrop { id: string; png: Uint8Array; hint?: 'dimension' | 'label' | 'note' }
export interface OcrAnswer { id: string; text: string; confidence: number }
export interface OcrEngine {
  readonly name: string;
  /** the characters allowed in a dimension string (single-line mode, whitelist) */
  read(crops: OcrCrop[]): Promise<OcrAnswer[]>;
}
export type OcrStatus = { available: true; engine: OcrEngine } | { available: false; reason: string };

/** The whitelist used for dimension strings: digits, feet and inch marks, dash, dot, slash, fraction glyphs, x, m, space. */
export const DIMENSION_WHITELIST = "0123456789'\"-./½¼¾xXmM ";

const run = (cmd: string, args: string[], timeoutMs = 20000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? '') }));
  });

/** Tesseract through its command line: one crop at a time, single line mode (psm 7), digits-and-marks whitelist for dimensions. */
export function tesseractCli(binary = 'tesseract'): OcrEngine {
  return {
    name: 'tesseract',
    async read(crops) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-ocr-'));
      const out: OcrAnswer[] = [];
      try {
        for (const c of crops) {
          const f = path.join(dir, `${c.id.replace(/[^a-z0-9_-]/gi, '_')}.png`);
          fs.writeFileSync(f, c.png);
          const args = [f, 'stdout', '--psm', '7'];
          if (c.hint === 'dimension') args.push('-c', `tessedit_char_whitelist=${DIMENSION_WHITELIST}`);
          const r = await run(binary, args);
          out.push({ id: c.id, text: r.ok ? r.out.replace(/\s+$/g, '').trim() : '', confidence: r.ok ? 0.4 : 0 });
        }
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
      return out;
    },
  };
}

/** RapidOCR through tools/understand/ocr.py (reads PNG paths from argv, prints one JSON line per crop). Needs the Python package. */
export function rapidOcrPy(python = 'python3', script = path.resolve(process.cwd(), 'tools/understand/ocr.py')): OcrEngine {
  return {
    name: 'rapidocr',
    async read(crops) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-ocr-'));
      try {
        const files = crops.map((c) => { const f = path.join(dir, `${c.id.replace(/[^a-z0-9_-]/gi, '_')}.png`); fs.writeFileSync(f, c.png); return f; });
        const r = await run(python, ['-I', script, ...files], 120000);
        if (!r.ok) return crops.map((c) => ({ id: c.id, text: '', confidence: 0 }));
        const lines = r.out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as { text: string; confidence: number }; } catch { return { text: '', confidence: 0 }; } });
        return crops.map((c, i) => ({ id: c.id, text: lines[i]?.text ?? '', confidence: lines[i]?.confidence ?? 0 }));
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    },
  };
}

/** Is an OCR engine installed? Never installs anything. */
export async function availableEngine(): Promise<OcrStatus> {
  const t = await run('tesseract', ['--version'], 5000);
  if (t.ok) return { available: true, engine: tesseractCli() };
  const script = path.resolve(process.cwd(), 'tools/understand/ocr.py');
  if (fs.existsSync(script)) {
    const p = await run('python3', ['-I', '-c', 'import rapidocr_onnxruntime'], 8000);
    if (p.ok) return { available: true, engine: rapidOcrPy('python3', script) };
  }
  return { available: false, reason: 'No local OCR engine is installed (tesseract and RapidOCR were not found). PDF text and the stroke-glyph reader still run; strings neither could read stay unread.' };
}

/**
 * Read crops with the engine when there is one. Each answer becomes a TextRead with `method: 'ocr'`; with no engine the list is
 * empty and `reason` says why. `place` gives each crop's position (page units) so the read can be attached to a dimension.
 */
export async function readCrops(
  status: OcrStatus, crops: OcrCrop[], place: (id: string) => { bbox: TextRead['bbox']; angle: number; size: number; origin: [number, number]; length: number },
): Promise<{ reads: TextRead[]; reason?: string }> {
  if (!status.available) return { reads: [], reason: status.reason };
  const answers = await status.engine.read(crops);
  const method: ReadMethod = 'ocr';
  const reads: TextRead[] = [];
  for (const a of answers) {
    if (!a.text) continue;
    const p = place(a.id);
    reads.push({ id: `o-${a.id}`, method, str: a.text, bbox: p.bbox, angle: p.angle, size: p.size, origin: p.origin, length: p.length, confidence: a.confidence });
  }
  return { reads };
}

/**
 * A PNG of one region of one PDF page, cut with poppler's pdftocairo (already a dependency of S1). `box` is in raw page units, y down,
 * as `normalisedBoxToRaw` returns it. The crop is not turned upright: a reader that wants upright text rotates it itself.
 */
export async function renderPdfCrop(pdfPath: string, pageIndex: number, box: [number, number, number, number], dpi = 400): Promise<Uint8Array> {
  const k = dpi / 72;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-crop-'));
  try {
    const x = Math.max(0, Math.floor(box[0] * k)), y = Math.max(0, Math.floor(box[1] * k));
    const w = Math.max(8, Math.ceil((box[2] - box[0]) * k)), h = Math.max(8, Math.ceil((box[3] - box[1]) * k));
    const out = path.join(dir, 'crop');
    const r = await run('pdftocairo', ['-png', '-singlefile', '-r', String(dpi), '-f', String(pageIndex + 1), '-l', String(pageIndex + 1), '-x', String(x), '-y', String(y), '-W', String(w), '-H', String(h), pdfPath, out], 30000);
    if (!r.ok) throw new Error('pdftocairo failed');
    return new Uint8Array(fs.readFileSync(`${out}.png`));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
