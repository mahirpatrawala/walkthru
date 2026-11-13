// A floor on what plain local OCR gets from a picture of a plan: whole-image Tesseract, then count how many printed room sizes and
// room names of a label truth show up in its text. Digits are compared without quote marks, spacing or separators because OCR
// garbles those most. This is not the reader; it is the cheapest possible baseline for the raster path.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LabelTruth } from './label-score';

export interface OcrFloor { engine: string; lines: number; sizesFound: number; sizesTruth: number; namesFound: number; namesTruth: number; seconds: number; note?: string }
const run = (cmd: string, args: string[], t = 120000): Promise<{ ok: boolean; out: string }> => new Promise((res) => execFile(cmd, args, { timeout: t, maxBuffer: 8 * 1024 * 1024 }, (e, so) => res({ ok: !e, out: String(so ?? '') })));
const digits = (s: string): string => s.replace(/[^0-9]/g, '');
const letters = (s: string): string => s.toUpperCase().replace(/[^A-Z]/g, '');

export async function ocrFloor(image: string, truth: LabelTruth, binary = '/opt/homebrew/bin/tesseract'): Promise<OcrFloor> {
  const t0 = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-ocrfloor-'));
  try {
    // tesseract reads about 30 px text best: enlarge small pictures to 2400 px on the long side with macOS sips
    const up = path.join(tmp, 'up.png');
    const probe = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', image], 20000);
    const w = Number(/pixelWidth: (\d+)/.exec(probe.out)?.[1] ?? 0), h = Number(/pixelHeight: (\d+)/.exec(probe.out)?.[1] ?? 0);
    const target = Math.max(w, h) < 2400 ? 2400 : Math.max(w, h);
    await run('sips', ['-s', 'format', 'png', '--resampleHeightWidthMax', String(target), image, '--out', up], 60000);
    const src = fs.existsSync(up) ? up : image;
    const lines: string[] = [];
    for (const psm of ['11', '6']) { const r = await run(binary, [src, 'stdout', '--psm', psm]); if (r.ok) lines.push(...r.out.split('\n').map((l) => l.trim()).filter(Boolean)); }
    const digitLines = lines.map(digits), letterText = lines.map(letters).join(' ');
    const sized = truth.rooms.filter((r) => r.printed.length);
    // a printed size counts as found when the digits of any one of its printed strings appear inside the digits of one OCR line
    const sizesFound = sized.filter((r) => r.printed.some((p) => digits(p).length >= 3 && digitLines.some((d) => d.includes(digits(p))))).length;
    const names = [...new Set(truth.rooms.map((r) => letters(r.name)))].filter((n) => n.length >= 3);
    const namesFound = names.filter((n) => letterText.includes(n)).length;
    return { engine: 'tesseract', lines: lines.length, sizesFound, sizesTruth: sized.length, namesFound, namesTruth: names.length, seconds: (Date.now() - t0) / 1000 };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
