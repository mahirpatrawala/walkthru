// The local raster path (no model, no network): a brochure plan or a phone photo of one, read with Tesseract and pixels alone.
//
//   page -> clean (perspective, lighting, tilt) -> text blocks (thin dark marks grouped into lines and blocks) -> Tesseract on each
//   block -> room labels (a room word and a printed size, repaired for what OCR garbles) -> walls (thick dark structures) ->
//   from each label, the walls around it -> a scale fitted from label size against measured room size across the rooms
//   -> checks -> statuses -> the same outputs as the vision path (pixels/write.ts)
//
// Honesty (SPEC 17.1, 17.5): every number here was read by OCR, so everything starts `unverified`. A room becomes `verified` only when
// its printed size agrees (2%) with the walls measured around its label, on a scale fitted WITHOUT that room from at least three other
// rooms that agree with each other. A printed size that disagrees by more than 5% is a `conflict` and both numbers are kept. A read that
// geometry had to choose among alternatives for stays `unverified`. With no scale the rooms still appear, as rectangles of their printed
// sizes, and say so. Pure TypeScript apart from the Tesseract call in local/ocr.ts.
import { createHash } from 'node:crypto';
import type { ImportResult } from '../import/types';
import type { Gray, Mat3, Rect } from './pixels/image';
import { applyMat, matInv } from './pixels/image';
import { preprocess } from './pixels/preprocess';
import { agrees, clearlyWrong, fitScale, labelFit, looFit, scaleFor } from './pixels/fit';
import type { Evidence, LabelPair, ScaleFit } from './pixels/fit';
import { buildOutputs } from './pixels/write';
import type { RoomWork, Frame } from './pixels/work';
import type { RasterRun, RasterUnderstanding, StageTime } from './pixels/types';
import { isTitleBlockText } from './pixels/privacy';
import { isRoomLabel, roomTypeOf, tokens } from './lexicon';
import { findArea } from './units';
import { roomSpans, textBlocks, textLayer, wallLayer } from './local/ink';
import type { Spans } from './local/ink';
import { ocrAvailable, readBlocks } from './local/ocr';
import type { BlockRead } from './local/ocr';
import { ocrArea, ocrNormalise, ocrSizeCandidates } from './local/sizes';
import type { SizeCand } from './local/sizes';

export interface LocalPage { id: string; image: Gray }
export const LOCAL_NOTICE = 'Vision is off. Nothing leaves this computer. The picture is read here with local text recognition: the layout is a draft to correct, and nothing from it is confirmed until the geometry or a broker agrees.';
const NO_OCR = 'Vision is off, and no local text reader (Tesseract) is installed, so this picture of a plan cannot be read. Install Tesseract, turn vision on, or trace the plan in the editor.';

/** Printed-size band the geometry check allows (the fraction of a printed length), and the band where a disagreement is called wrong. */
const VERIFY_REL = 0.02, FIT_REL = 0.03, CONFLICT_REL = 0.05;

export interface LocalLabel {
  id: string; name: string; text: string; cands: SizeCand[]; areaM2?: number; rect: Rect; lineH: number;
  /** two independent reads (the block read as text, the line read for digits) gave the same size */ twoReads: boolean;
  spans?: Spans;
  /** the size came from an area-statement row matched to this room by geometry, so geometry cannot also vouch for it */
  byGeometry?: boolean;
  /** this label is a row of a size table (no walls around it): its size goes to the drawn room of the same name and the row itself is dropped */
  tableRow?: boolean;
}

const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 10);
const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s\-(/])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());

function emptyUnderstanding(pages: LocalPage[]): RasterUnderstanding {
  const h = createHash('sha256'); for (const p of pages) h.update(p.image.data);
  return { version: 1, input: { kind: 'image', pages: pages.length, sha256: h.digest('hex') }, views: [], dimensions: [], rooms: [], openings: [], items: [], symbols: [], conflicts: [], warnings: [] };
}
function refusedLocal(u: RasterUnderstanding, reasonIn: string, stages: StageTime[], t0: number): RasterRun {
  const reason = reasonIn.startsWith('Vision is off') ? reasonIn : `Vision is off, and the local reader could not read this picture. ${reasonIn} Turn vision on, or trace the plan in the editor.`;
  u.warnings.push(reason);
  const cost = { visionCalls: 0, inputTokens: 0, outputTokens: 0, usd: 0, seconds: 0, wallSeconds: (Date.now() - t0) / 1000 };
  return { status: 'refused', reason, understanding: u, designs: { version: 1, source: `Imported drawing set, ${u.input.pages} page${u.input.pages === 1 ? '' : 's'}`, items: {} }, sent: [], stages, cost, notice: LOCAL_NOTICE };
}
function frameOf(toImage: Mat3): Frame {
  const inv = matInv(toImage);
  const toPage = (p: [number, number]): [number, number] => applyMat(inv, p);
  return { toPage, rectToPage: (r) => { const q = [toPage([r[0], r[1]]), toPage([r[2], r[1]]), toPage([r[2], r[3]]), toPage([r[0], r[3]])]; return [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))]; } };
}

const SIZEY = /\d/;
const r2c = (r: { cands: SizeCand[] }): SizeCand[] => r.cands;
/** Words OCR made up after a room name ("TOILET BP KT-T od") go: keep the name up to its last word the room lexicon knows. */
export function keepRoomWords(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  let last = -1;
  words.forEach((w, i) => { if (tokens(w).some((t) => isRoomLabel(t))) last = i; });
  return last >= 0 ? words.slice(0, last + 1).join(' ') : name;
}
/** One OCR block into a room label, or null when it is not one (a title, a note, a dimension with no room word). Exported for the tests. */
export function labelFromRead(br: BlockRead, id: string): LocalLabel | null {
  const lines = br.text.split('\n').map(ocrNormalise).filter(Boolean);
  if (!lines.length) return null;
  const joined = lines.join(' ');
  if (lines.length > 6 || joined.length > 80 || isTitleBlockText(joined)) return null;
  // sizes: the block as text (a size split over lines joins up), and each line read with the digit whitelist
  const reads: SizeCand[][] = [ocrSizeCandidates(joined)];
  for (const l of br.lines) for (const d of l.digits) if (SIZEY.test(d)) reads.push(ocrSizeCandidates(d));
  // a size split over two lines ("3800" then "x4125") reads as one when the lines are joined, in each reading
  const nRead = Math.max(0, ...br.lines.map((l) => l.digits.length));
  for (let k = 0; k < nRead; k++) { const j = br.lines.map((l) => l.digits[k] ?? '').filter((d) => SIZEY.test(d)).join(' '); if (j) reads.push(ocrSizeCandidates(j)); }
  const cands: SizeCand[] = []; let twoReads = false;
  for (const r of reads) for (const c of r) {
    const hit = cands.find((o) => Math.abs(o.w - c.w) < 0.004 && Math.abs(o.l - c.l) < 0.004);
    if (hit) { if (hit.rank > c.rank) hit.rank = c.rank; hit.text = hit.text || c.text; (hit as SizeCand & { n?: number }).n = ((hit as SizeCand & { n?: number }).n ?? 1) + 1; twoReads ||= true; } else cands.push({ ...c });
  }
  cands.sort((a, b) => ((b as SizeCand & { n?: number }).n ?? 1) - ((a as SizeCand & { n?: number }).n ?? 1) || a.rank - b.rank);
  // a printed area ("102.08 Sq.m.") is not a room
  const areaOnly = findArea(joined);
  // the name: the letters of the block, with every size, number and mark taken out
  let name = joined.replace(/\d[\d.,'"\-\s xX×%*°/]*\d?["']?/g, ' ').replace(/[^A-Za-z&/.\-\s]/g, ' ').split(/\s+/).filter((w) => w && !/^[xXkK.\-/]+$/.test(w)).join(' ').trim();
  name = keepRoomWords(name);
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3 || /\+/.test(joined) || !isRoomLabel(name)) return null;
  if (areaOnly && !cands.length && /\bsq/i.test(joined)) return null;
  return { id, name: titleCase(name), text: joined, cands: cands.filter((c) => Math.min(c.w, c.l) >= 0.5 && Math.max(c.w, c.l) <= 20), areaM2: ocrArea(joined) ?? undefined, rect: br.rect, lineH: br.lineH, twoReads: twoReads && !!cands.length };
}

/** Everything the page says: its room labels, found and read locally. */
export async function readLabels(img: Gray, opts: { jobs?: number } = {}): Promise<LocalLabel[]> {
  const t = textLayer(img, { thr: 150 });
  const blocks = textBlocks(t.glyphs, img.width, img.height)
    // a long stack of lines is a table of sizes (or a paragraph): read it line by line, each line a block of its own
    .flatMap((b) => (b.lines.length > 6 && b.rect[2] - b.rect[0] < 0.5 * img.width ? b.lines.map((r) => ({ rect: r, lines: [r], glyphs: 3, lineH: r[3] - r[1] })) : [b]))
    .filter((b) => b.glyphs >= 3 && b.lines.length <= 6 && b.rect[2] - b.rect[0] < 0.5 * img.width)
    // a block of one tiny line is the page's fine print, not a label
    .filter((b) => b.lineH >= 6 || b.lines.length > 1);
  const reads = await readBlocks(img, blocks, { jobs: opts.jobs, second: (txt) => SIZEY.test(txt) && txt.length < 80 });
  const out: LocalLabel[] = [];
  for (const br of reads) { const l = labelFromRead(br, `lbl-${out.length + 1}`); if (l) out.push(l); }
  return out;
}

interface Meas { w: number; h: number; box: [number, number, number, number] }
const measure = (s: Spans): Meas | null => (s.left !== null && s.right !== null && s.up !== null && s.down !== null && s.right > s.left && s.down > s.up ? { w: s.right - s.left, h: s.down - s.up, box: [s.left, s.up, s.right, s.down] } : null);

/** The whole local run over one or more pages. */
export async function readRasterLocal(pages: LocalPage[], opts: { jobs?: number; labels?: LocalLabel[] } = {}): Promise<RasterRun> {
  const t0 = Date.now(); const stages: StageTime[] = [];
  const u = emptyUnderstanding(pages);
  const stage = async <T,>(name: string, f: () => Promise<T> | T): Promise<T> => { const s = Date.now(); try { return await f(); } finally { stages.push({ stage: name, ms: Date.now() - s }); } };
  if (!pages.length) return refusedLocal(u, 'No page was given.', stages, t0);
  if (!opts.labels && !(await ocrAvailable())) return refusedLocal(u, NO_OCR, stages, t0);

  // ---- 1. clean each page, read its labels, keep the page with the most
  const works: { page: LocalPage; pre: ReturnType<typeof preprocess>; labels: LocalLabel[] }[] = [];
  await stage('read-text', async () => {
    for (const p of pages) {
      const pre = preprocess(p.image);
      const labels = opts.labels ?? await readLabels(pre.image, { jobs: opts.jobs });
      works.push({ page: p, pre, labels });
      u.views.push({ id: p.id, page: works.length, kind: 'unknown', kindConfidence: 0, raster: true, steps: pre.steps, turnedCw: 0 });
    }
  });
  const best = works.reduce((a, b) => (b.labels.length > a.labels.length ? b : a));
  if (!best.labels.length) return refusedLocal(u, 'No room names or sizes could be read on the picture. Is it a floor plan, and is it sharp enough to read?', stages, t0);
  const view = u.views.find((v) => v.id === best.page.id)!; view.kind = 'plan'; view.kindConfidence = 0.4;
  if (works.length > 1) u.warnings.push(`${works.length} pages were given. Only page ${works.indexOf(best) + 1}, which has the most readable rooms, was read.`);
  const img = best.pre.image; const labels = best.labels;

  // ---- 2. the walls around each label
  const { mask, k: wallK, thr: wallThr } = await stage('walls', () => wallLayer(img));
  const cap = Math.round(0.5 * Math.max(img.width, img.height));
  for (const l of labels) {
    const cx = (l.rect[0] + l.rect[2]) / 2, cy = (l.rect[1] + l.rect[3]) / 2;
    l.spans = roomSpans(mask, img.width, img.height, [cx, cy], Math.max(1.5, 0.45 * l.lineH), cap);
  }
  void wallK; void wallThr;

  // ---- 2b. an area-statement table lists room names with sizes, away from the walls; the plan names its rooms without sizes.
  // A row goes to the drawn room of the same name when that is unambiguous.
  const keyOf = (l: LocalLabel): string => tokens(l.name).join('');
  const enclosed = (l: LocalLabel): boolean => measure(l.spans!) !== null;
  const rows = labels.filter((l) => l.cands.length && !enclosed(l) && [l.spans!.left, l.spans!.right, l.spans!.up, l.spans!.down].filter((x) => x !== null).length < 3);
  const bare = labels.filter((l) => !l.cands.length && enclosed(l));
  const claimed = new Set<LocalLabel>();
  for (const r of rows) {
    const same = bare.filter((b) => !b.cands.length && keyOf(b) === keyOf(r)), rowsSame = rows.filter((x) => keyOf(x) === keyOf(r));
    if (same.length === 1 && rowsSame.length === 1) { same[0].cands = r.cands; same[0].text = `${same[0].text} ${r.text}`; same[0].areaM2 = r.areaM2; same[0].twoReads = r.twoReads; claimed.add(r); }
  }
  // a table row nothing matched by name waits for the scale (below)
  const waiting = rows.filter((r) => !claimed.has(r));
  for (const r of claimed) labels.splice(labels.indexOf(r), 1);
  if (claimed.size) u.warnings.push(`${claimed.size} size${claimed.size === 1 ? '' : 's'} read from a table of room sizes and matched to the room of the same name on the plan.`);

  // ---- 3. a name with no walls around it and no size is a caption or a title, not a room
  let rooms0 = labels.filter((l) => {
    const m = measure(l.spans!); const sides = [l.spans!.left, l.spans!.right, l.spans!.up, l.spans!.down].filter((x) => x !== null).length;
    return l.cands.length > 0 || m !== null || sides >= 3;
  });
  if (rooms0.length < labels.length) u.warnings.push(`${labels.length - rooms0.length} piece${labels.length - rooms0.length === 1 ? '' : 's'} of text that read like room names had no size and no walls around them and were left out.`);
  if (!rooms0.length) return refusedLocal(u, 'No rooms with a printed size or walls around them were found.', stages, t0);

  // ---- 4. scale: printed sizes against the walls measured around their labels
  const ev: Evidence = { dims: [], labels: [] };
  const meas = new Map<string, Meas>();
  for (const l of rooms0) {
    const m = measure(l.spans!); if (!m) continue; meas.set(l.id, m);
    const c = l.cands[0]; if (!c) continue;
    const lp: LabelPair = { id: l.id, owner: l.id, wPx: m.w, hPx: m.h, a: c.w, b: c.l };
    ev.labels.push(lp);
  }
  const fit = fitScale(ev, FIT_REL);
  let scale: ScaleFit | null = fit && fit.ok && fit.inliers >= 0.4 * fit.total ? fit : null;
  let fallback = false;
  if (!scale) {
    // no agreement to stand on: the median of what each room says, good enough to place a room, never to call it a fact
    const ratios = ev.labels.flatMap((l) => { const o = labelFit(l, 1, 1).best; return [l.wPx / (o === 0 ? l.a : l.b), l.hPx / (o === 0 ? l.b : l.a)]; });
    let s = med(ratios);
    const SHORT_SIDE: Record<string, number> = { bedroom: 3.3, living: 3.4, kitchen: 2.4, bathroom: 1.6, balcony: 1.5 };
    const priors = rooms0.map((l) => { const m = meas.get(l.id); const t = roomTypeOf(l.name); return m && SHORT_SIDE[t] ? Math.min(m.w, m.h) / SHORT_SIDE[t] : null; }).filter((x): x is number => x !== null);
    if (!ratios.length && priors.length >= 2) {
      // no printed size at all (a plan with the sizes left off): an ordinary flat's rooms, short side by room type, give a rough scale
      s = med(priors);
      u.warnings.push('No printed room size could be matched to the walls, so the scale is a guess from ordinary room sizes (a bedroom is about 3.3 m across). Nothing is measured.');
    } else if (!ratios.length) {
      // not one room could be measured: size the page from the printed areas. The labels cover about 80% of the plan's box
      const sized = rooms0.filter((l) => l.cands[0]);
      if (sized.length < 2) return refusedLocal(u, 'No scale could be found: fewer than two rooms have a printed size, and none had walls around it that could be measured.', stages, t0);
      const x0 = Math.min(...rooms0.map((l) => l.rect[0])), y0 = Math.min(...rooms0.map((l) => l.rect[1])), x1 = Math.max(...rooms0.map((l) => l.rect[2])), y1 = Math.max(...rooms0.map((l) => l.rect[3]));
      const pad = 0.06 * Math.max(img.width, img.height);
      const boxPx = (x1 - x0 + 2 * pad) * (y1 - y0 + 2 * pad);
      const m2 = sized.reduce((a, l) => a + l.cands[0].w * l.cands[0].l, 0) * (rooms0.length / sized.length);
      s = Math.sqrt((0.8 * boxPx) / m2);
      u.warnings.push('No room could be measured against its printed size, so the scale is a guess from the printed areas and the page. Nothing is measured.');
    }
    scale = { sx: s, sy: s, mode: 'iso', inliers: 0, total: ev.labels.length, dimInliers: 0, spread: 1, ok: false, notToScale: false, aniso: false };
    fallback = true;
    u.warnings.push('Fewer than three rooms agree on a scale between their printed sizes and the walls around them, so the scale is a guess from the median. Nothing is measured.');
  }
  // plausibility: the printed sizes of the rooms, on their own, are an ordinary flat's (the one outside reference a self-consistent misread cannot fake)
  const longs = rooms0.filter((l) => l.cands[0]).map((l) => Math.max(l.cands[0].w, l.cands[0].l));
  const medLong = med(longs);
  let gated = fallback;
  if (!fallback && longs.length >= 3 && (medLong < 1.8 || medLong > 8.5)) { gated = true; u.warnings.push(`The printed room sizes read as a median longest side of ${medLong.toFixed(1)} m, which is not an ordinary flat. Nothing is marked as checked.`); }
  // the rows of the size table that no name matched: a row goes to the drawn room of the same kind whose walls its size fits best
  // (within 8%) and fits better than every other candidate. The geometry chose it, so geometry cannot also vouch for it.
  if (waiting.length) {
    const sx0 = scaleFor(scale, 'x'), sy0 = scaleFor(scale, 'y');
    const free = new Set(waiting);
    const errOf = (b: LocalLabel, r: LocalLabel): { err: number; cand: SizeCand } | null => {
      const m = meas.get(b.id); if (!m || !r.cands.length) return null;
      let best: { err: number; cand: SizeCand } | null = null;
      for (const c of r.cands) for (const [mx, my] of [[c.w, c.l], [c.l, c.w]]) { const e = Math.max(Math.abs(m.w / sx0 / mx - 1), Math.abs(m.h / sy0 / my - 1)); if (!best || e < best.err) best = { err: e, cand: c }; }
      return best;
    };
    for (const b of bare.filter((x) => !x.cands.length)) {
      const t = roomTypeOf(b.name);
      const opts2 = [...free].filter((r) => roomTypeOf(r.name) === t).map((r) => ({ r, e: errOf(b, r) })).filter((x) => x.e && x.e.err <= 0.08).sort((p, q) => p.e!.err - q.e!.err);
      if (!opts2.length || (opts2.length > 1 && opts2[1].e!.err < 1.5 * opts2[0].e!.err + 0.01)) continue;
      const pick = opts2[0]; b.cands = r2c(pick.r); b.text = `${b.text} ${pick.r.text}`; b.areaM2 = pick.r.areaM2; b.byGeometry = true; free.delete(pick.r);
    }
    if (free.size < waiting.length) u.warnings.push(`${waiting.length - free.size} size${waiting.length - free.size === 1 ? '' : 's'} from the table of room sizes were matched to a room by how well they fit its walls, not by name. Check them.`);
  }
  rooms0 = rooms0.filter((l) => !waiting.includes(l));
  // a room measured wrongly (a wall that leaks, a text misread) is one outlier, not a sign the plan is off scale: what counts is that
  // at least three rooms and 40% of those measured agree on one scale
  const geoOk = !gated && !!fit && fit.ok && fit.spread < 0.08 && fit.inliers >= 0.4 * fit.total;

  // ---- 5. each room: pick its size, check it, give it a rectangle
  const works2: RoomWork[] = []; const methodOf: ('walls' | 'label-rect')[] = []; const picked = new Set<string>();
  const sx = scaleFor(scale, 'x'), sy = scaleFor(scale, 'y');
  let conflicts = 0, verifiedN = 0;
  for (const l of rooms0) {
    const m = meas.get(l.id);
    let cand = l.cands[0]; let status: RoomWork['status'] = 'unverified'; let note: string | undefined;
    const checks: RoomWork['checks'] = [];
    if (m && cand && geoOk && !l.byGeometry) {
      const loo = looFit(ev, l.id, FIT_REL);
      if (loo?.ok && loo.spread < 0.08) {
        const test = (c: SizeCand, rel: number): { ok: boolean; mx: number; my: number } => { const o = labelFit({ id: l.id, owner: l.id, wPx: m.w, hPx: m.h, a: c.w, b: c.l }, loo.sx, loo.sy).best; const [mx, my] = o === 0 ? [c.w, c.l] : [c.l, c.w]; return { ok: agrees(m.w, mx, loo, 'x', rel) && agrees(m.h, my, loo, 'y', rel), mx, my }; };
        const first = test(cand, VERIFY_REL);
        if (first.ok) {
          status = 'verified';
          checks.push({ kind: 'geometry', expected: m.w / loo.sx, got: first.mx, ok: true }, { kind: 'geometry', expected: m.h / loo.sy, got: first.my, ok: true });
        } else {
          // another reading of the same text that the walls do agree with: the geometry chose, so it is never called verified
          const alt = l.cands.slice(1).find((c) => test(c, VERIFY_REL).ok);
          if (alt) { cand = alt; picked.add(l.id); note = 'one of several readings of the printed size, chosen because the walls agree with it'; }
          else if (clearlyWrong(m.w, first.mx, loo, 'x', CONFLICT_REL) || clearlyWrong(m.h, first.my, loo, 'y', CONFLICT_REL)) {
            status = 'conflict'; conflicts++;
            note = `printed ${cand.text.match(/\d[^A-Za-z]*$/)?.[0]?.trim() ?? 'size'}, the walls around the label measure about ${(m.w / loo.sx).toFixed(2)} x ${(m.h / loo.sy).toFixed(2)} m`;
          }
          const o = labelFit({ id: l.id, owner: l.id, wPx: m.w, hPx: m.h, a: cand.w, b: cand.l }, loo.sx, loo.sy);
          checks.push({ kind: 'geometry', expected: m.w / loo.sx, got: o.best === 0 ? cand.w : cand.l, ok: false }, { kind: 'geometry', expected: m.h / loo.sy, got: o.best === 0 ? cand.l : cand.w, ok: false });
        }
      }
    }
    if (status === 'verified') verifiedN++;
    // the rectangle: a conflict shows what the walls measure; anything else takes the printed size, set on the measured room when there is one
    let rect: Rect; let method: 'walls' | 'label-rect' = m ? 'walls' : 'label-rect';
    const sp = l.spans!;
    const cxl = (l.rect[0] + l.rect[2]) / 2, cyl = (l.rect[1] + l.rect[3]) / 2;
    if (m && (status === 'conflict' || !cand)) rect = m.box;
    else if (cand) {
      const o = m ? labelFit({ id: l.id, owner: l.id, wPx: m.w, hPx: m.h, a: cand.w, b: cand.l }, sx, sy).best : (sp.left !== null && sp.right !== null ? ((sp.right - sp.left) >= (sp.down ?? Infinity) - (sp.up ?? 0) ? 0 : 1) : 0);
      const [mx, my] = o === 0 ? [cand.w, cand.l] : [cand.l, cand.w];
      const W = mx * sx, H = my * sy;
      const cx = m ? (m.box[0] + m.box[2]) / 2 : sp.left !== null ? sp.left + W / 2 : sp.right !== null ? sp.right - W / 2 : cxl;
      const cy = m ? (m.box[1] + m.box[3]) / 2 : sp.up !== null ? sp.up + H / 2 : sp.down !== null ? sp.down - H / 2 : cyl;
      rect = [cx - W / 2, cy - H / 2, cx + W / 2, cy + H / 2];
    } else if (sp.left !== null && sp.right !== null && sp.up === null && sp.down === null) continue;
    else continue;
    const poly: [number, number][] = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]];
    works2.push({
      id: `room-${works2.length + 1}`, name: l.name, nameVia: 'view', sizeText: cand ? l.text.replace(/^[^\d]*/, '').trim() || undefined : undefined,
      areaM2: l.areaM2, size: cand ? { w: cand.w, l: cand.l } : undefined, poly, bboxPx: rect, agreeTwo: l.twoReads, labelBox: l.rect,
      status, checks, backed: status === 'verified', ...(status === 'conflict' ? { conflictNote: note } : {}),
    });
    methodOf.push(method);
    if (note && status !== 'conflict') u.warnings.push(`${l.name}: ${note}.`);
  }
  if (!works2.length) return refusedLocal(u, 'None of the rooms could be placed.', stages, t0);
  const open = methodOf.filter((x) => x === 'label-rect').length;
  if (open) u.warnings.push(`${open} room${open === 1 ? '' : 's'} had no walls to measure and ${open === 1 ? 'is' : 'are'} drawn as a rectangle of the printed size. Check ${open === 1 ? 'it' : 'them'}.`);
  if (conflicts) u.warnings.push(`${conflicts} room${conflicts === 1 ? '' : 's'}: the printed size and the walls around the label disagree by more than 5%. Both are shown.`);
  u.warnings.push(`Read locally (no vision): ${labels.length} labels read, ${verifiedN} room${verifiedN === 1 ? '' : 's'} agree with the walls drawn around them.`);

  // ---- 6. outputs
  const frame = frameOf(best.pre.toImage);
  const out = await stage('write', () => buildOutputs({
    u, plane: { pageId: best.page.id, frame, imgToSentScale: 1 }, scale, fit: fit ?? null, gated, fallback,
    rooms: works2, dims: [], read: { rooms: [], dimensions: [], openings: [], symbols: [] }, rectToImg: (b) => b as Rect, hints: { conf: { one: 0.2, two: 0.4, verified: 0.9, geometry: 0.3 } }, origin: [0, 0],
  }));
  // the importer sidecar says how each room's outline was found
  (out.result as ImportResult).extras.rooms.forEach((f, i) => { if (methodOf[i]) f.method = methodOf[i]; });
  void hash;
  const cost = { visionCalls: 0, inputTokens: 0, outputTokens: 0, usd: 0, seconds: (Date.now() - t0) / 1000, wallSeconds: (Date.now() - t0) / 1000 };
  u.cost = cost;
  return { status: 'ok', understanding: u, result: out.result, designs: out.designs, sent: [], stages, cost, notice: LOCAL_NOTICE };
}
