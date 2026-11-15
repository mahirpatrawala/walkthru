// Local raster path, reading a page with a PP-OCR style engine (detection + recognition, local/ocr-backend.ts). Pure TypeScript on grey
// pixels: nothing here knows Python, a file, or a drawing, so the same code runs over any backend that answers `page` and `lines`.
//
//   page, scaled so a line of text is about 24 px or more -> engine finds every text line and reads it (upright, any angle it finds)
//   -> lines grouped into blocks (a name over its size is one block) -> each line of a block re-read from the unscaled page at
//   other sizes and paddings (recognition only), the second and third opinions the size repairs choose among
//   -> ink blocks the detector missed (thin text beside a furniture line) read the same way from their crops.
//
// A BlockRead is exactly what the Tesseract reader returned, so everything after this is unchanged: the engine only supplies better text.
import type { Gray, Rect } from '../pixels/image';
import { cropGray, resizeGray, rotateQuarter } from '../pixels/image';
import { linesToBlocks } from './ink';
import type { TextBlock } from './ink';
import type { OcrBackend, OcrLine } from './ocr-backend';
import type { BlockRead } from './ocr';

const MIN_CONF = 0.3;
const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const hasDigit = (s: string): boolean => /\d/.test(s);

interface PageLine { rect: Rect; text: string; conf: number; vertical: boolean; h: number }

/**
 * The scale the page is read at. PP-OCR reads text from about 10 px tall, so enlarging is for the very small (a line of 14 px is the
 * aim) and for the detector's minimum input; a big page is brought down so the detector's cost stays in seconds (it grows with area).
 */
export function readScale(g: Gray, lineHs: number[]): number {
  const long = Math.max(g.width, g.height);
  const medH = lineHs.length ? med(lineHs) : 14;
  let k = Math.max(0.4, Math.min(3, 14 / Math.max(5, medH)));
  k = Math.max(k, 1100 / long);
  k = Math.min(k, 2000 / long);
  return k;
}

const rectOf = (box: [number, number][], k: number): Rect => {
  const xs = box.map((p) => p[0] / k), ys = box.map((p) => p[1] / k);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const inside = (r: Rect, x: number, y: number, pad = 0): boolean => x >= r[0] - pad && x <= r[2] + pad && y >= r[1] - pad && y <= r[3] + pad;
const centre = (r: Rect): [number, number] => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];

/** A tight crop of one line, a little air around it, enlarged (or kept) so the line is `target` px tall: a recognition-ready image. */
export function lineCrop(g: Gray, r: Rect, target: number, padFrac: number): Gray {
  const h = Math.max(4, r[3] - r[1]);
  const padY = Math.max(2, Math.round(padFrac * h * 0.6)), padX = Math.max(3, Math.round(padFrac * h * 1.4));
  const crop = cropGray(g, [Math.floor(r[0] - padX), Math.floor(r[1] - padY), Math.ceil(r[2] + padX), Math.ceil(r[3] + padY)], 255);
  const f = Math.max(0.5, Math.min(8, target / h));
  return Math.abs(f - 1) < 0.05 ? crop : resizeGray(crop, Math.max(8, Math.round(crop.width * f)), Math.max(8, Math.round(crop.height * f))).image;
}

/** What the detector found, as lines on the page (unscaled coordinates), junk dropped. */
export function pageLines(lines: OcrLine[], k: number): PageLine[] {
  const out: PageLine[] = [];
  for (const l of lines) {
    const text = (l.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text || l.conf < MIN_CONF || !l.box || l.box.length < 4) continue;
    const rect = rectOf(l.box, k);
    const w = rect[2] - rect[0], h = rect[3] - rect[1];
    if (w < 2 || h < 2) continue;
    // a box clearly taller than wide is text running up or down the page (the engine has already turned it upright to read it)
    const vertical = h > 1.6 * w && text.length > 2;
    out.push({ rect, text, conf: l.conf, vertical, h: vertical ? w : h });
  }
  return out;
}

/**
 * A row of an area table is read as two lines (the name, then ": 7'-0 1/2" X 13'-1"" past a wide gap), because the detector splits text
 * at big gaps. Put them back: a name-like line and a size-like line on one baseline, not far apart, are one line. Two names or two
 * sizes side by side stay two lines.
 */
export function mergeRows(lines: PageLine[]): PageLine[] {
  const sizeLike = (t: string): boolean => /\d/.test(t) && !/[A-Za-z]{3,}/.test(t.replace(/\b(sq|ft|sft|m|mm|x)\b/gi, ''));
  const nameLike = (t: string): boolean => /[A-Za-z]{3,}/.test(t) && !/\d{2,}/.test(t);
  const used = new Set<number>();
  const out: PageLine[] = [];
  const order = lines.map((_, i) => i).sort((a, b) => lines[a].rect[0] - lines[b].rect[0]);
  for (const i of order) {
    if (used.has(i)) continue;
    const a = lines[i];
    if (a.vertical || !nameLike(a.text)) continue;
    let best = -1, bestGap = Infinity;
    for (let j = 0; j < lines.length; j++) {
      if (j === i || used.has(j)) continue;
      const b = lines[j];
      if (b.vertical || !sizeLike(b.text)) continue;
      const gap = b.rect[0] - a.rect[2];
      const ov = Math.min(a.rect[3], b.rect[3]) - Math.max(a.rect[1], b.rect[1]);
      const h = Math.min(a.rect[3] - a.rect[1], b.rect[3] - b.rect[1]);
      if (gap < -0.2 * h || gap > 6 * h || ov < 0.6 * h) continue;
      if (gap < bestGap) { best = j; bestGap = gap; }
    }
    // only when the size line is the row's value: it starts past a gap (a colon, or room to breathe), not glued to the name
    if (best < 0) continue;
    const b = lines[best];
    used.add(i); used.add(best);
    out.push({ rect: [a.rect[0], Math.min(a.rect[1], b.rect[1]), b.rect[2], Math.max(a.rect[3], b.rect[3])], text: `${a.text} ${b.text}`, conf: Math.min(a.conf, b.conf), vertical: false, h: Math.max(a.h, b.h) });
  }
  return [...lines.filter((_, i) => !used.has(i)), ...out];
}

/** One reading pass over a page: lines found by the engine plus whatever ink the detector left unread, as blocks with second opinions. */
export async function readBlocksRapid(g: Gray, ink: TextBlock[], be: OcrBackend, opts: { second?: (text: string) => boolean; maxCrops?: number } = {}): Promise<BlockRead[]> {
  const second = opts.second ?? ((t: string) => hasDigit(t) && t.length < 80);
  const maxCrops = opts.maxCrops ?? 900;
  const k = readScale(g, ink.map((b) => b.lineH));
  const scaled = Math.abs(k - 1) < 0.03 ? g : resizeGray(g, Math.round(g.width * k), Math.round(g.height * k)).image;
  const t0 = Date.now();
  const found = mergeRows(pageLines(await be.page(scaled), Math.abs(k - 1) < 0.03 ? 1 : k));
  const tPage = Date.now() - t0;

  // the ink lines' heights are the truer measure of a line of text (a detection box carries padding): give each found line the
  // median height of the ink lines it holds, else its own box less the padding
  const inkLines = ink.flatMap((b) => b.lines.map((r) => ({ r, h: r[3] - r[1] })));
  const heightOf = (p: PageLine): number => {
    if (p.vertical) return Math.max(5, p.h / 1.3);
    const hs = inkLines.filter((l) => { const [cx, cy] = centre(l.r); return inside(p.rect, cx, cy); }).map((l) => l.h);
    return hs.length ? med(hs) : Math.max(5, p.h / 1.3);
  };
  if (process.env.WT_DEBUG) for (const p of found) console.log('line', p.rect.map((x) => Math.round(x)).join(','), p.conf.toFixed(2), p.vertical ? 'V' : '', JSON.stringify(p.text));
  // a line that already holds a name and a size (a table row, "BEDROOM 3.66x3.35") is a label on its own: stacking it with the rows
  // above and below would run their names and sizes together
  const whole = (p: PageLine): boolean => /[A-Za-z]{3,}/.test(p.text) && /\d.*[xX×*%K].*\d|\d[.,']\d/.test(p.text);
  const horizontal = found.filter((p) => !p.vertical);
  const alone = horizontal.filter(whole), stackable = horizontal.filter((p) => !whole(p));
  const blocks = [...alone.map((p) => ({ rect: p.rect, lines: [p.rect], glyphs: Math.max(3, p.text.length), lineH: p.h })), ...linesToBlocks(stackable.map((p) => ({ rect: p.rect, n: Math.max(3, p.text.length), h: p.h })))]
    // a long stack of lines is a table of sizes or a paragraph: each line is a block of its own
    .flatMap((b) => (b.lines.length > 6 ? b.lines.map((r) => ({ rect: r, lines: [r], glyphs: 3, lineH: r[3] - r[1] })) : [b]));
  const works: Work[] = blocks.map((b) => {
    const ls = horizontal.filter((p) => b.lines.some((r) => r === p.rect)).sort((a, c) => a.rect[1] - c.rect[1]);
    return { rect: b.rect, lines: ls, lineH: ls.reduce((a, p) => a + heightOf(p), 0) / Math.max(1, ls.length), vertical: false };
  });
  for (const p of found.filter((x) => x.vertical)) works.push({ rect: p.rect, lines: [p], lineH: heightOf(p), vertical: true });

  // ink blocks the detector missed: no found line holds the block's centre
  const covered = (r: Rect): boolean => { const [cx, cy] = centre(r); return found.some((p) => inside(p.rect, cx, cy, 0.15 * (p.rect[3] - p.rect[1]))); };
  const missed = ink.filter((b) => !covered(b.rect));

  // second and third readings, recognition only, from the unscaled page
  const variants: [number, number][] = [[48, 0.3], [72, 0.55], [32, 0.4]];
  const jobs: { img: Gray; into: (t: string, conf: number) => void }[] = [];
  const reads = new Map<string, { text: string; conf: number }[]>(); // `${work}:${line}` -> readings
  const key = (w: number, l: number): string => `${w}:${l}`;
  let budget = maxCrops;
  const add = (w: number, l: number, r: Rect, vertical: boolean): void => {
    const arr: { text: string; conf: number }[] = [];
    reads.set(key(w, l), arr);
    for (const [target, pad] of variants) {
      if (budget <= 0) return;
      if (!vertical) { budget--; jobs.push({ img: lineCrop(g, r, target, pad), into: (t, c) => { if (t) arr.push({ text: t, conf: c }); } }); continue; }
      // vertical text: the crop turned both ways, the engine's confidence picks the one that reads
      for (const turn of [90, 270] as const) { budget--; jobs.push({ img: rotateQuarter(lineCrop(g, r, target, pad), turn).image, into: (t, c) => { if (t && c >= 0.5) arr.push({ text: t, conf: c }); } }); }
    }
  };
  works.forEach((w, wi) => w.lines.forEach((p, li) => { if (second(p.text) || p.conf < 0.85) add(wi, li, p.rect, w.vertical); }));
  // missed ink blocks become works with no primary text: their crops are read like any other line
  for (const b of missed) {
    const ls: PageLine[] = b.lines.map((r) => ({ rect: r, text: '', conf: 0, vertical: false, h: r[3] - r[1] }));
    works.push({ rect: b.rect, lines: ls, lineH: b.lineH, vertical: false });
    const wi = works.length - 1;
    ls.forEach((p, li) => add(wi, li, p.rect, false));
  }
  const tRec = Date.now();
  // recognise in batches (one round trip each)
  const BATCH = 48;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const part = jobs.slice(i, i + BATCH);
    const rs = await be.lines(part.map((j) => j.img));
    part.forEach((j, n) => j.into((rs[n]?.text ?? '').replace(/\s+/g, ' ').trim(), rs[n]?.conf ?? 0));
  }

  if (process.env.WT_DEBUG) console.log('timing', JSON.stringify({ k: +k.toFixed(2), scaled: `${scaled.width}x${scaled.height}`, pageMs: tPage, lines: found.length, missedInk: missed.length, crops: jobs.length, recMs: Date.now() - tRec }));
  const out: BlockRead[] = [];
  works.forEach((w, wi) => {
    // the primary text: what the page pass read; for a missed block, its best crop reading
    const lineTexts = w.lines.map((p, li) => {
      // a second opinion counts only when the engine is about as sure of it as of the page-level read: a tight crop that has caught a
      // furniture line reads it as a letter, and says so in a lower confidence
      const rs = (reads.get(key(wi, li)) ?? []).filter((r) => !p.text || r.conf >= p.conf - 0.06).sort((a, b) => b.conf - a.conf);
      return { primary: p.text || rs[0]?.text || '', conf: p.text ? p.conf : rs[0]?.conf ?? 0, rs };
    });
    if (!lineTexts.some((l) => l.primary)) return;
    const text = lineTexts.map((l) => l.primary).filter(Boolean).join('\n');
    const nVar = Math.max(0, ...lineTexts.map((l) => l.rs.length));
    const more: string[] = [];
    for (let v = 0; v < nVar; v++) more.push(lineTexts.map((l) => l.rs[v]?.text ?? l.primary).filter(Boolean).join('\n'));
    const lines = w.lines.map((p, li) => ({ rect: p.rect, digits: [...new Set(lineTexts[li].rs.map((r) => r.text))].filter(Boolean) }));
    const conf = lineTexts.reduce((a, l) => a + l.conf, 0) / lineTexts.length;
    if (process.env.WT_DEBUG) console.log('block', w.rect.map((x) => Math.round(x)).join(','), conf.toFixed(2), JSON.stringify({ text, more, digits: lines.map((l) => l.digits) }));
    out.push({ rect: w.rect, lineH: w.lineH, text, more, lines, conf });
  });
  return out;
}
