// Local raster path, reading text blocks with Tesseract (Node only; one of the files allowed to start a process, SPEC 17.3). Each text
// block is cut from the grey page, enlarged until a line is about 48 px tall, and read twice: the whole block as text (names and
// sizes), then every line again in single-line mode with a digits-and-marks whitelist (sizes). Nothing is installed by the project:
// with no Tesseract `ocrAvailable()` says so and the local path declines to run.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Gray, Rect } from '../pixels/image';
import { cropGray, encodePng, resizeGray } from '../pixels/image';
import type { TextBlock } from './ink';

const CANDIDATES = ['/opt/homebrew/bin/tesseract', '/usr/local/bin/tesseract', '/usr/bin/tesseract', 'tesseract'];
const run = (cmd: string, args: string[], timeoutMs = 20000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => { execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, so) => resolve({ ok: !err, out: String(so ?? '') })); });

let found: string | null | undefined;
export async function ocrBinary(): Promise<string | null> {
  if (found !== undefined) return found;
  for (const c of CANDIDATES) if ((await run(c, ['--version'], 5000)).ok) { found = c; return c; }
  found = null; return null;
}
export const ocrAvailable = async (): Promise<boolean> => (await ocrBinary()) !== null;

export const SIZE_WHITELIST = `0123456789.,xX'"-/ `;
export interface BlockRead { rect: Rect; lineH: number; /** the block as text, lines joined with \n */ text: string; /** each line read alone with the size whitelist (empty when the block did not earn a second read) */ lines: { rect: Rect; digits: string[] }[] }

async function readPng(bin: string, png: Uint8Array, dir: string, name: string, psm: string, whitelist?: string): Promise<string> {
  const f = path.join(dir, `${name}.png`);
  fs.writeFileSync(f, png);
  const args = [f, 'stdout', '--psm', psm];
  if (whitelist) args.push('-c', `tessedit_char_whitelist=${whitelist}`);
  const r = await run(bin, args);
  if (process.env.WT_DEBUG) console.log("ocr", name, r.ok, JSON.stringify(r.out), args.join(" ").slice(-60));
  return r.ok ? r.out.replace(/\s+$/g, '').trim() : '';
}

function enlarged(g: Gray, rect: Rect, lineH: number, padFrac = 0.5, target = 48): Uint8Array {
  const pad = Math.max(3, Math.round(padFrac * lineH));
  // a single line is cut tight above and below so the lines around it stay out of the crop
  const padY = lineH === rect[3] - rect[1] ? Math.max(2, Math.round(0.2 * lineH)) : pad;
  const padX = lineH === rect[3] - rect[1] ? Math.round(1.1 * lineH) : pad; // a glyph joined to a furniture line is missing from the box: leave room for it
  const crop = cropGray(g, [rect[0] - padX, rect[1] - padY, rect[2] + padX, rect[3] + padY], 255);
  const f = Math.max(1, Math.min(8, target / Math.max(5, lineH)));
  const up = f > 1.05 ? resizeGray(crop, Math.round(crop.width * f), Math.round(crop.height * f)).image : crop;
  return encodePng(up);
}

/** Read every block. At most `jobs` Tesseract processes run at once. */
export async function readBlocks(g: Gray, blocks: TextBlock[], opts: { jobs?: number; /** does this block's first read earn a second, line by line? */ second?: (text: string) => boolean } = {}): Promise<BlockRead[]> {
  const jobs = opts.jobs ?? 4;
  const bin = await ocrBinary();
  if (!bin) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-local-ocr-'));
  const out: BlockRead[] = new Array(blocks.length);
  let next = 0;
  const work = async (): Promise<void> => {
    for (let i = next++; i < blocks.length; i = next++) {
      const b = blocks[i];
      const text = await readPng(bin, enlarged(g, b.rect, b.lineH), dir, `b${i}`, b.lines.length > 1 ? '6' : '7');
      const lines: BlockRead['lines'] = [];
      if (!opts.second || opts.second(text)) {
        for (let k = 0; k < b.lines.length; k++) {
          const r = b.lines[k];
          // the line again at two sizes with the digits-and-marks whitelist, and once with no whitelist: a mark or a digit that one
          // reading loses another keeps, and the caller takes every reading as a candidate
          const h = r[3] - r[1];
          const d = [
            await readPng(bin, enlarged(g, r, h, 0.6, 48), dir, `b${i}d${k}a`, '7', SIZE_WHITELIST),
            await readPng(bin, enlarged(g, r, h, 0.6, 80), dir, `b${i}d${k}b`, '7', SIZE_WHITELIST),
            await readPng(bin, enlarged(g, r, h, 0.6, 64), dir, `b${i}d${k}c`, '7'),
          ].filter(Boolean);
          lines.push({ rect: r, digits: d });
        }
      }
      out[i] = { rect: b.rect, lineH: b.lineH, text, lines };
    }
  };
  try { await Promise.all(Array.from({ length: Math.max(1, jobs) }, work)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return out;
}
