// C12d. SPEC 17.8 "Raster input": a phone photo of a plan or a brochure JPG has no geometry of its own, so the structure comes from
// a vision model and the pixels check it.
//
//   page image -> clean (perspective, lighting, tilt) -> find views, blank out text blocks -> classify views on thumbnails
//   -> ONE crop of the plan to the model (rooms, labels, dimension strings, openings, symbols, all boxed)
//   -> snap room boxes to the wall faces in the pixels, snap dimension lines to their end marks
//   -> re-read each dimension and label from a tight crop (a second look, cheaper model)
//   -> fit pixels-per-metre from the printed values -> checks -> statuses -> proposal.json, proposal-extras.json, designs.json
//
// Honesty: everything a model said starts `unverified` (confidence 0.2, 0.4 when two reads agree). A value becomes `verified`
// only when its pixel length agrees with a scale fitted WITHOUT it AND a chain of dimensions or a printed area backs it up.
// No model answer is believed on its own, so a model that lies cannot make a wrong number verified (tested with a lying mock).
// Pure TypeScript apart from the provider it is handed; the provider is the only thing that touches a network.
import { createHash } from 'node:crypto';
import type { ImportResult } from '../import/types';
import { ImportError } from '../import/types';
import type { PlanVisionInput } from '../import/vision';
import type { Extracted, Method, SourceRef, Status } from './types';
import { findArea, findSize, parseLengthLoose, parseSizeLoose, stripSize } from './units';
import { roomTypeOf } from './lexicon';
import { decodeImage, cropGray, encodePng, matInv, matMul, resizeGray, applyMat, scaleMat, translateMat } from './pixels/image';
import type { Gray, Mat3, Rect } from './pixels/image';
import { preprocess } from './pixels/preprocess';
import { findViews, redactTextBlocks } from './pixels/views';
import type { View } from './pixels/views';
import { InkMap, snapDimensionLine, snapPolygon } from './pixels/snap';
import { findChains, fitScale, labelFit, looFit, agrees, clearlyWrong, scaleFor } from './pixels/fit';
import type { Evidence, LineDim, ScaleFit } from './pixels/fit';
import { isTitleBlockText } from './pixels/privacy';
import { tagImage } from './pixels/lineage';
import { buildOutputs } from './pixels/write';
import { readRasterLocal } from './raster-local';
import { LAYOUT_SCHEMA, PLAN_SCHEMA, VIEW_CHOICES } from './vision/prompts';
import type { LayoutRead, PlanRead, VisionProvider } from './vision/provider';
import { visionNotice } from './notice';
import type { Pt, RasterRun, RasterUnderstanding, RunCost, SentRecord, StageTime } from './pixels/types';
import type { DimWork, Frame, RoomWork } from './pixels/work';

export type { RasterRun, RasterUnderstanding } from './pixels/types';

export interface RasterOptions {
  /** ask the model, on a thumbnail too small to read, where the title block and notes are (default true) */
  layout?: boolean;
  /** null = vision off: nothing is sent anywhere and a picture cannot be read */
  provider: VisionProvider | null;
  /** longest side of the plan crop sent to the model, pixels */
  maxViewSide?: number;
  /** re-read each dimension and label from its own crop (default true) */
  reread?: boolean;
  /** called for every picture just before it is sent, for an audit log */
  onSend?: (r: SentRecord) => void;
}
export interface RasterPage { id: string; image: Gray }

const NOTE_REFUSE_OFF = 'Vision is off, so this picture of a plan cannot be read. Turn vision on, or trace the plan in the editor.';
const THUMB_SIDE = 384;
const TIGHT_CONF = { one: 0.2, two: 0.4, verified: 0.9, geometry: 0.3 };
const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 10);
const norm = (s: string): string => s.toUpperCase().replace(/\s+/g, '').replace(/[″”]/g, '"').replace(/[′’]/g, "'");
const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const boxRect = (b: [number, number, number, number]): Rect => [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
const emptyCost = (): RunCost => ({ visionCalls: 0, inputTokens: 0, outputTokens: 0, usd: 0, seconds: 0, wallSeconds: 0 });
const bboxOf = (pts: Pt[]): Rect => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];

function emptyUnderstanding(pages: RasterPage[]): RasterUnderstanding {
  const h = createHash('sha256'); for (const p of pages) h.update(p.image.data);
  return { version: 1, input: { kind: 'image', pages: pages.length, sha256: h.digest('hex') }, views: [], dimensions: [], rooms: [], openings: [], items: [], symbols: [], conflicts: [], warnings: [] };
}
function refused(u: RasterUnderstanding, reason: string, sent: SentRecord[], stages: StageTime[], cost: RunCost, vision: boolean): RasterRun {
  u.warnings.push(reason);
  return { status: 'refused', reason, understanding: u, designs: { version: 1, source: `Imported drawing set, ${u.input.pages} page${u.input.pages === 1 ? '' : 's'}`, items: {} }, sent, stages, cost, notice: visionNotice(vision) };
}

function frameOf(toImage: Mat3): Frame {
  const inv = matInv(toImage);
  const toPage = (p: Pt): Pt => applyMat(inv, p);
  return { toPage, rectToPage: (r) => bboxOf([toPage([r[0], r[1]]), toPage([r[2], r[1]]), toPage([r[2], r[3]]), toPage([r[0], r[3]])]) };
}

/** Read one or more raster pages. The workhorse; `proposeFromRaster` and the eval harness call this. */
export async function readRasterPages(pages: RasterPage[], opts: RasterOptions): Promise<RasterRun> {
  const wall0 = Date.now();
  const stages: StageTime[] = []; const sent: SentRecord[] = [];
  const u = emptyUnderstanding(pages);
  const prov = opts.provider;
  const base = prov?.usage() ?? { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  const costNow = (): RunCost => {
    const n = prov?.usage() ?? base;
    return { visionCalls: n.calls - base.calls, inputTokens: n.inputTokens - base.inputTokens, outputTokens: n.outputTokens - base.outputTokens, usd: n.usd - base.usd, seconds: 0, wallSeconds: (Date.now() - wall0) / 1000 };
  };
  const stage = async <T>(name: string, f: () => Promise<T> | T): Promise<T> => { const t0 = Date.now(); try { return await f(); } finally { stages.push({ stage: name, ms: Date.now() - t0 }); } };
  const send = (r: SentRecord): void => { sent.push(r); opts.onSend?.(r); };
  // vision off: the local path reads the picture with Tesseract and pixels alone (everything it says starts unverified)
  if (!prov) return readRasterLocal(pages, {});
  if (!pages.length) return refused(u, 'No page was given.', sent, stages, emptyCost(), true);

  // ---- 1. clean every page and find its views (local, free)
  interface PageWork { page: RasterPage; index: number; pre: ReturnType<typeof preprocess>; frame: Frame; views: View[]; redacted: Gray; blockPx: number; turn: number }
  const works: PageWork[] = [];
  await stage('clean', async () => {
    for (const [i, p] of pages.entries()) {
      const pre = preprocess(p.image);
      const frame = frameOf(pre.toImage);
      // where the title block and notes are, asked of a thumbnail too small to read (the writing is a smear, the layout is not)
      let hints: Rect[] = [];
      if (opts.layout !== false) {
        const f = Math.min(1, 512 / Math.max(pre.image.width, pre.image.height));
        const t = f < 1 ? resizeGray(pre.image, Math.round(pre.image.width * f), Math.round(pre.image.height * f)) : { image: pre.image, map: scaleMat(1, 1) };
        const png = encodePng(t.image);
        const pageRect = frame.rectToPage([0, 0, pre.image.width, pre.image.height]);
        tagImage(png, { pageId: p.id, kind: 'thumb', fromOriginal: matMul(t.map, pre.toImage), rectOriginal: pageRect, size: { w: t.image.width, h: t.image.height } });
        send({ kind: 'thumb', page: p.id, rect: pageRect, w: t.image.width, h: t.image.height, bytes: png.length, purpose: 'find the title block and notes by layout (too small to read)' });
        const lay = (await prov.readView(png, 'plan', LAYOUT_SCHEMA)) as LayoutRead | null;
        hints = (lay?.boxes ?? []).map((b): Rect => { const r = boxRect(b.box); return [r[0] / f, r[1] / f, r[2] / f, r[3] / f]; });
      }
      const { views, blockPx } = findViews(pre.image, { textHints: hints });
      const redacted = redactTextBlocks(pre.image, views);
      works.push({ page: p, index: i, pre, frame, views, redacted, blockPx, turn: 0 });
      u.views.push({ id: `${p.id}`, page: i + 1, kind: 'unknown', kindConfidence: 0, raster: true, steps: pre.steps, turnedCw: 0 });
      const nText = views.filter((v) => v.kind === 'text').length;
      if (nText) u.warnings.push(`Page ${i + 1}: ${nText} title-block or notes area${nText === 1 ? '' : 's'} blanked out before sending.`);
    }
  });

  // ---- 2. which drawing is the plan? thumbnails only, text blocks already blanked
  type Cand = { w: PageWork; v: View; id: string };
  const cands: Cand[] = [];
  for (const w of works) w.views.filter((v) => v.kind === 'drawing').forEach((v) => cands.push({ w, v, id: `${w.page.id}:${v.id}` }));
  if (!cands.length) return refused(u, 'No drawing was found on the page. Is it a floor plan?', sent, stages, costNow(), true);
  const choice = new Map<string, { choice: string; confidence: number }>();
  await stage('classify', async () => {
    const crops = cands.map((c) => {
      const crop = cropGray(c.w.redacted, c.v.rect);
      const f = THUMB_SIDE / Math.max(crop.width, crop.height);
      const t = f < 1 ? resizeGray(crop, Math.max(8, Math.round(crop.width * f)), Math.max(8, Math.round(crop.height * f))) : { image: crop, map: scaleMat(1, 1) };
      const png = encodePng(t.image);
      const toThumb = matMul(t.map, matMul(translateMat(-c.v.rect[0], -c.v.rect[1]), c.w.pre.toImage));
      const rectPage = c.w.frame.rectToPage(c.v.rect);
      tagImage(png, { pageId: c.w.page.id, kind: 'thumb', fromOriginal: toThumb, rectOriginal: rectPage, size: { w: t.image.width, h: t.image.height } });
      send({ kind: 'thumb', page: c.w.page.id, rect: rectPage, w: t.image.width, h: t.image.height, bytes: png.length, purpose: 'which kind of drawing is this' });
      return { id: c.id, png };
    });
    for (const r of await prov.classify(crops, [...VIEW_CHOICES])) choice.set(r.id, r);
  });
  const plans = cands.filter((c) => choice.get(c.id)?.choice === 'plan').sort((a, b) => b.v.areaFrac - a.v.areaFrac);
  for (const c of cands) { const uv = u.views.find((x) => x.id === c.w.page.id); const r = choice.get(c.id); if (uv && r && (c === plans[0])) { uv.kind = 'plan'; uv.kindConfidence = r.confidence; } else if (uv && uv.kind === 'unknown' && r) { uv.kind = r.choice; uv.kindConfidence = r.confidence; } }
  if (!plans.length) return refused(u, 'No floor plan was found among the drawings. Pictures of elevations and details are not read yet.', sent, stages, costNow(), true);
  if (plans.length > 1) u.warnings.push(`${plans.length} plans were found. Only the largest was read.`);
  if (cands.length - plans.length > 0) u.warnings.push(`${cands.length - plans.length} other drawing${cands.length - plans.length === 1 ? '' : 's'} (elevations or details) were not read: pictures of those are not supported yet.`);
  const P = plans[0]; const W = P.w;
  const img = W.pre.image;

  // ---- 3. the plan crop, the one big read
  const maxSide = opts.maxViewSide ?? 2000;
  const pad = 0.015 * Math.max(P.v.rect[2] - P.v.rect[0], P.v.rect[3] - P.v.rect[1]);
  const cropRect: Rect = [Math.max(0, P.v.rect[0] - pad), Math.max(0, P.v.rect[1] - pad), Math.min(img.width, P.v.rect[2] + pad), Math.min(img.height, P.v.rect[3] + pad)];
  const planCrop = cropGray(W.redacted, cropRect);
  const f = Math.min(1, maxSide / Math.max(planCrop.width, planCrop.height));
  const sentPlan = f < 1 ? resizeGray(planCrop, Math.round(planCrop.width * f), Math.round(planCrop.height * f)) : { image: planCrop, map: scaleMat(1, 1) };
  const viewPng = encodePng(sentPlan.image);
  const cropOrigin: Pt = [Math.round(cropRect[0]), Math.round(cropRect[1])];
  const imgToSent = matMul(sentPlan.map, translateMat(-cropOrigin[0], -cropOrigin[1]));
  tagImage(viewPng, { pageId: W.page.id, kind: 'view', fromOriginal: matMul(imgToSent, W.pre.toImage), rectOriginal: W.frame.rectToPage(cropRect), size: { w: sentPlan.image.width, h: sentPlan.image.height } });
  send({ kind: 'view', page: W.page.id, rect: W.frame.rectToPage(cropRect), w: sentPlan.image.width, h: sentPlan.image.height, bytes: viewPng.length, purpose: 'read the plan: rooms, labels, dimensions, openings, symbols' });
  const sentToImg = (p: Pt): Pt => [p[0] / f + cropOrigin[0], p[1] / f + cropOrigin[1]];
  const rectToImg = (b: [number, number, number, number]): Rect => { const r = boxRect(b); const a = sentToImg([r[0], r[1]]), c = sentToImg([r[2], r[3]]); return [a[0], a[1], c[0], c[1]]; };

  const raw = await stage('read-plan', () => prov.readView(viewPng, 'plan', PLAN_SCHEMA));
  const read = asPlanRead(raw);
  if (!read) return refused(u, 'The vision model did not return a readable answer for the plan.', sent, stages, costNow(), true);
  // words that mark title-block or contact text are dropped from the answer, and counted
  let dropped = 0;
  const keepText = (t: string): boolean => { if (isTitleBlockText(t)) { dropped++; return false; } return true; };
  const rooms0 = read.rooms.filter((r) => keepText(`${r.label} ${r.sizeText ?? ''}`));
  const dims0 = read.dimensions.filter((d) => keepText(d.text));
  if (dropped) u.warnings.push(`${dropped} string${dropped === 1 ? '' : 's'} that looked like title-block or contact text ${dropped === 1 ? 'was' : 'were'} dropped from the model's answer.`);
  if (!rooms0.length) return refused(u, 'The model found no rooms on the plan.', sent, stages, costNow(), true);

  // ---- 4. pixels check the boxes
  const ink = await stage('snap', () => new InkMap(img));
  const longSide = Math.max(planCrop.width, planCrop.height);
  const r0 = Math.max(8, med(rooms0.map((r) => { const b = rectToImg(r.box); return Math.min(b[2] - b[0], b[3] - b[1]); })) / 3.2);
  const winWall = clamp(0.18 * r0, 5, 0.02 * longSide);
  let hallucinated = 0, duplicates = 0;
  const roomsW: RoomWork[] = [];
  await stage('snap-rooms', () => {
    rooms0.forEach((r, i) => {
      const b = rectToImg(r.box);
      let poly: Pt[] = r.polygon && r.polygon.length >= 4 ? r.polygon.map((p) => sentToImg(p)) : [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
      const sn = snapPolygon(ink, poly, winWall);
      if (sn.edges === 0 || sn.edgesFound / Math.max(1, sn.edges) < 0.75) { hallucinated++; return; }
      poly = sn.polygon;
      const bb = bboxOf(poly);
      if (bb[2] - bb[0] < 6 || bb[3] - bb[1] < 6) { hallucinated++; return; }
      const area = (bb[2] - bb[0]) * (bb[3] - bb[1]);
      if (roomsW.some((q) => { const o = Math.max(0, Math.min(q.bboxPx[2], bb[2]) - Math.max(q.bboxPx[0], bb[0])) * Math.max(0, Math.min(q.bboxPx[3], bb[3]) - Math.max(q.bboxPx[1], bb[1])); return o > 0.6 * Math.min(area, (q.bboxPx[2] - q.bboxPx[0]) * (q.bboxPx[3] - q.bboxPx[1])); })) { duplicates++; return; }
      const size = r.sizeText ? parseSizeLoose(r.sizeText) : null;
      const sz = size ?? (findSize(r.label) ?? undefined);
      roomsW.push({
        id: `room-${roomsW.length + 1}`, name: stripSize(r.label).replace(/\s+/g, ' ').trim(), nameVia: r.label ? 'view' : 'none',
        sizeText: r.sizeText, areaText: r.areaText, size: sz ? { w: sz.w, l: sz.l } : undefined, areaM2: r.areaText ? findArea(r.areaText)?.m2 : undefined,
        poly, bboxPx: bb, agreeTwo: false, labelBox: r.labelBox ? rectToImg(r.labelBox) : undefined, status: 'unverified', checks: [], backed: false,
      });
      void i;
    });
  });
  if (hallucinated) u.warnings.push(`${hallucinated} room${hallucinated === 1 ? '' : 's'} the model reported had no walls under them and ${hallucinated === 1 ? 'was' : 'were'} dropped.`);
  if (duplicates) u.warnings.push(`${duplicates} duplicate room${duplicates === 1 ? '' : 's'} dropped.`);
  if (!roomsW.length) return refused(u, 'None of the rooms the model reported matched walls on the plan.', sent, stages, costNow(), true);

  // dimensions: snap each line to its end marks. A line that is not there is a dimension the model made up.
  const winEnd = clamp(0.15 * r0, 6, 16), halfEnd = clamp(0.12 * r0, 5, 12);
  const dimsW: DimWork[] = [];
  let ghostDims = 0;
  await stage('snap-dimensions', () => {
    dims0.forEach((d) => {
      const box = rectToImg(d.box);
      const w: DimWork = { id: `dim-${dimsW.length + 1}`, box, cands: [{ text: d.text, via: 'view' }], endsOk: false, agreeTwo: false, status: 'unverified', checks: [] };
      if (d.line) {
        const a = sentToImg([d.line[0], d.line[1]]), b = sentToImg([d.line[2], d.line[3]]);
        const s = snapDimensionLine(ink, a, b, winEnd, halfEnd);
        if (s.ok) { w.line = [s.a, s.b]; w.endsOk = true; const horiz = Math.abs(s.b[0] - s.a[0]) >= Math.abs(s.b[1] - s.a[1]); w.axis = horiz ? 'x' : 'y'; w.px = Math.abs(horiz ? s.b[0] - s.a[0] : s.b[1] - s.a[1]); }
        else ghostDims++;
      }
      dimsW.push(w);
    });
  });
  if (ghostDims) u.warnings.push(`${ghostDims} dimension line${ghostDims === 1 ? '' : 's'} could not be matched to end marks in the drawing, so ${ghostDims === 1 ? 'its' : 'their'} length is not used.`);

  // ---- 5. a second look: each dimension and each label from its own tight crop
  if (opts.reread !== false) await stage('reread', async () => {
    const crops: { id: string; png: Uint8Array; hint: 'dimension' | 'label' }[] = [];
    const add = (id: string, r: Rect, hint: 'dimension' | 'label', purpose: string): void => {
      const w = r[2] - r[0], h = r[3] - r[1];
      const padX = Math.max(0.35 * w, 8), padY = Math.max(0.5 * h, 6);
      const cr: Rect = [Math.max(0, r[0] - padX), Math.max(0, r[1] - padY), Math.min(img.width, r[2] + padX), Math.min(img.height, r[3] + padY)];
      if (cr[2] - cr[0] < 4 || cr[3] - cr[1] < 4) return;
      const g = cropGray(W.redacted, cr);
      const png = encodePng(g);
      const o: Pt = [Math.round(cr[0]), Math.round(cr[1])];
      const rectPage = W.frame.rectToPage(cr);
      tagImage(png, { pageId: W.page.id, kind: 'crop', fromOriginal: matMul(translateMat(-o[0], -o[1]), W.pre.toImage), rectOriginal: rectPage, size: { w: g.width, h: g.height } });
      send({ kind: 'crop', page: W.page.id, rect: rectPage, w: g.width, h: g.height, bytes: png.length, purpose });
      crops.push({ id, png, hint });
    };
    for (const d of dimsW) add(d.id, d.box, 'dimension', 'read one dimension string');
    for (const r of roomsW) if (r.labelBox) add(r.id, r.labelBox, 'label', 'read one room label');
    if (!crops.length) return;
    // an answer without a box is dropped here too, whatever provider gave it (SPEC 17.8)
    const got = new Map((await prov.readStrings(crops)).filter((x) => x.box).map((x) => [x.id, x.text]));
    for (const d of dimsW) {
      const t = got.get(d.id);
      if (!t || isTitleBlockText(t)) continue;
      const first = d.cands[0].text;
      d.agreeTwo = norm(t) === norm(first);
      if (!d.agreeTwo) d.cands.unshift({ text: t, via: 'crop' });
    }
    for (const r of roomsW) {
      const t = got.get(r.id);
      if (!t || isTitleBlockText(t)) continue;
      const flat = t.replace(/\s*\n\s*/g, ' ');
      const sz = findSize(flat), ar = findArea(flat);
      const name = stripSize(flat).replace(/\d+(?:\.\d+)?\s*(?:sq[\s.]*(?:ft|m)|sqft|sqm)\.?/i, '').replace(/\s+/g, ' ').trim();
      const prevName = r.name, prevSize = r.size;
      const sameName = norm(name) === norm(prevName), sameSize = !!sz && !!prevSize && Math.abs(sz.w - prevSize.w) < 0.006 && Math.abs(sz.l - prevSize.l) < 0.006;
      r.agreeTwo = sameName && (sameSize || !prevSize);
      if (name) { r.name = name; r.nameVia = 'crop'; }
      if (sz) { r.size = { w: sz.w, l: sz.l }; r.sizeText = flat.slice(sz.index, sz.index + sz.length); }
      if (ar) r.areaM2 = ar.m2;
    }
  });

  // ---- 6. scale: every printed value against the pixels, then the checks
  const result = await stage('fit-and-check', () => {
    const ev: Evidence = { dims: [], labels: [] };
    for (const d of dimsW) {
      for (const c of d.cands) { const p = parseLengthLoose(c.text); if (p && p.m > 0) { d.m ??= p.m; } }
      if (d.endsOk && d.m && d.px && d.axis) ev.dims.push({ id: d.id, owner: d.id, px: d.px, m: d.m, axis: d.axis, src: 'dim' });
    }
    for (const r of roomsW) if (r.size) ev.labels.push({ id: r.id, owner: r.id, wPx: r.bboxPx[2] - r.bboxPx[0], hPx: r.bboxPx[3] - r.bboxPx[1], a: r.size.w, b: r.size.l });
    const nEvidence = ev.dims.length + ev.labels.length;
    const fit = fitScale(ev);
    const warnings = u.warnings;
    let scale: ScaleFit | null = fit && fit.ok ? fit : null;
    let fallback = false;
    // a scale nobody printed: a typical door is about 0.9 m. Good enough to place a room, never to call it a fact.
    if (!scale) {
      const doorPx = read.openings.filter((o) => o.kind === 'door').map((o) => Math.max(o.box[2] - o.box[0], o.box[3] - o.box[1]) / f);
      if (doorPx.length >= 1) {
        const s = med(doorPx) / 0.9;
        scale = { sx: s, sy: s, mode: 'iso', inliers: 0, total: nEvidence, dimInliers: 0, spread: 1, ok: false, notToScale: false, aniso: false };
        fallback = true;
        warnings.push('No printed size on the plan agrees with its drawing, so the scale was guessed from the doors (about 0.9 m each). Nothing is measured.');
      }
    }
    if (!scale) return null;
    if (fit?.aniso) warnings.push(`The picture is stretched ${Math.round(Math.abs(fit.sy / fit.sx - 1) * 1000) / 10}% more in one direction (a photo at an angle, or a drawing stretched on one axis). Each direction is fitted on its own.`);
    if (fit?.notToScale) warnings.push('Most printed sizes disagree with the drawing, even with one scale per direction: it may not be drawn to scale. Sizes are not checked against it.');

    // plausibility: doors on the fitted scale should be door sized (0.62 to 1.10 m for the median). Printed sizes are only ever checked
    // against each other and the pixels, so a model that scales every number the same way agrees with itself: this is the one outside
    // reference. It catches a lie of about a fifth or more; a smaller one cannot be told from an honest drawing.
    let gated = fallback;
    if (!fallback) {
      const g = plausibility(read, scale, f);
      if (g.bad) { gated = true; warnings.push(`${g.why} Nothing is marked as checked.`); }
    }

    const geoOk = !gated && !scale.notToScale;
    // ---- dimensions
    const line: LineDim[] = [];
    for (const d of dimsW) {
      if (!d.endsOk || !d.line || !d.axis) continue;
      const lo = d.axis === 'x' ? Math.min(d.line[0][0], d.line[1][0]) : Math.min(d.line[0][1], d.line[1][1]);
      line.push({ id: d.id, axis: d.axis, lo, hi: lo + (d.px ?? 0), perp: d.axis === 'x' ? d.line[0][1] : d.line[0][0], m: null });
    }
    // choose, per dimension, the read that agrees with the pixels (scale fitted without it); else the first read
    for (const d of dimsW) {
      const loo = d.endsOk && d.px && d.axis ? looFit(ev, d.id) : null;
      const options = d.cands.map((c) => ({ c, p: parseLengthLoose(c.text) })).filter((o) => o.p && o.p.m > 0);
      if (!options.length) continue;
      let pick = options[0];
      if (loo?.ok) for (const o of options) if (agrees(d.px!, o.p!.m, loo, d.axis!)) { pick = o; break; }
      d.chosen = pick.c.text; d.m = pick.p!.m;
      const ld = line.find((l) => l.id === d.id); if (ld) ld.m = d.m;
      if (loo?.ok && geoOk) {
        const ok = agrees(d.px!, d.m, loo, d.axis!);
        d.checks.push({ kind: 'geometry', expected: d.px! / scaleFor(loo, d.axis!), got: d.m, ok });
        d.geoErrM = Math.abs(d.px! / scaleFor(loo, d.axis!) - d.m); d.slackM = 4 / scaleFor(loo, d.axis!);
        // out by more than the pixels can resolve: a conflict. Out by a little: nothing can be said, the value stays unchecked.
        if (!ok && clearlyWrong(d.px!, d.m, loo, d.axis!)) { d.status = 'conflict'; d.conflictNote = `drawing says ${d.chosen}, measures ${(d.px! / scaleFor(loo, d.axis!)).toFixed(3)} m`; }
      }
    }
    const chains = findChains(line, clamp(0.02 * longSide, 3, 8));
    for (const ch of chains) {
      const ids = [ch.overall, ...ch.members];
      for (const id of ids) {
        const d = dimsW.find((x) => x.id === id)!;
        d.chain = ch.overall;
        d.checks.push({ kind: 'chain', expected: ch.overallM, got: ch.sumM, ok: ch.ok });
        // a chain that does not add up: the member the drawing itself contradicts the most (3 inches or more) is the one at fault
        if (!ch.ok && d.status !== 'conflict' && geoOk && d.geoErrM !== undefined && d.geoErrM > Math.max(0.075, d.slackM ?? 0)) {
          d.status = 'conflict'; d.conflictNote = `the chain does not add up (${ch.sumM.toFixed(3)} m against ${ch.overallM.toFixed(3)} m) and this value is ${d.geoErrM.toFixed(3)} m off the drawing`;
        }
      }
    }
    for (const d of dimsW) {
      if (d.status === 'conflict' || !d.m) continue;
      const geo = d.checks.find((c) => c.kind === 'geometry'), chain = d.checks.find((c) => c.kind === 'chain');
      if (geo?.ok && chain?.ok && geoOk) d.status = 'verified';
      // SPEC 17.5 would let a chain alone verify a value on a drawing that is not to scale. Not here: on a picture every member of the
      // chain is one model's read, so a chain that adds up proves the reads agree with each other, not with the drawing.
    }
    // ---- rooms: the printed size against the polygon on a scale fitted without this label, backed by an area or a dimension line
    for (const r of roomsW) {
      const w = r.bboxPx[2] - r.bboxPx[0], h = r.bboxPx[3] - r.bboxPx[1];
      if (!r.size || !geoOk) continue;
      const loo = looFit(ev, r.id);
      if (!loo?.ok || loo.dimInliers < 2) continue;
      const lab = { id: r.id, owner: r.id, wPx: w, hPx: h, a: r.size.w, b: r.size.l };
      const orient = labelFit(lab, loo.sx, loo.sy).best;
      const [mx, my] = orient === 0 ? [r.size.w, r.size.l] : [r.size.l, r.size.w];
      const okA = agrees(w, mx, loo, 'x', 0.012), okB = agrees(h, my, loo, 'y', 0.012);
      r.checks.push({ kind: 'geometry', expected: w / loo.sx, got: mx, ok: okA }, { kind: 'geometry', expected: h / loo.sy, got: my, ok: okB });
      let backed = false;
      if (r.areaM2) {
        const area = (w / loo.sx) * (h / loo.sy);
        const ok = Math.abs(area - r.areaM2) <= 0.03 * r.areaM2;
        r.checks.push({ kind: 'label-area', expected: area, got: r.areaM2, ok }); backed ||= ok;
      }
      // a verified dimension line that spans a side of this room and says the same length
      for (const side of [{ px: w, m: mx, axis: 'x' as const }, { px: h, m: my, axis: 'y' as const }]) {
        const hit = dimsW.find((d) => d.status === 'verified' && d.axis === side.axis && d.px && Math.abs(d.px - side.px) <= Math.max(0.02 * side.px, 3) && d.m && Math.abs(d.m - side.m) <= 0.0254);
        if (hit) { r.checks.push({ kind: 'chain', expected: hit.m!, got: side.m, ok: true }); backed = true; }
      }
      r.backed = backed;
      const wrongA = clearlyWrong(w, mx, loo, 'x', 0.012), wrongB = clearlyWrong(h, my, loo, 'y', 0.012);
      if (wrongA || wrongB) { r.status = 'conflict'; r.conflictNote = `label says ${r.sizeText ?? ''}, the drawing measures about ${(w / loo.sx).toFixed(2)} x ${(h / loo.sy).toFixed(2)} m`; }
      else if (okA && okB && backed) r.status = 'verified';
    }
    return { scale, fit, gated, fallback, chains };
  });
  if (!result) return refused(u, 'No scale could be found: no printed size agrees with the drawing and no doors were found to guess from.', sent, stages, costNow(), true);

  // ---- 7. outputs
  const out = await stage('write', () => buildOutputs({
    u, plane: { pageId: W.page.id, frame: W.frame, imgToSentScale: f }, scale: result.scale, fit: result.fit, gated: result.gated, fallback: result.fallback,
    rooms: roomsW, dims: dimsW, read, rectToImg, hints: { conf: TIGHT_CONF }, origin: cropOrigin,
  }));
  const cost = costNow();
  // virtual seconds: what the calls would take on the wire. A simulated provider has no wall time worth reporting.
  const log = (prov as unknown as { meter?: { log: { ms: number }[] } }).meter?.log;
  cost.seconds = log ? log.reduce((a, c) => a + c.ms, 0) / 1000 : cost.wallSeconds;
  u.cost = cost;
  return { status: 'ok', understanding: u, result: out.result, designs: out.designs, sent, stages, cost, notice: visionNotice(true) };
}

// Ordinary domestic sizes in metres: [low, high] for the median of what the plan shows. The one outside reference there is: printed
// sizes are only ever checked against each other and the pixels, so a model that scales every number the same way agrees with itself.
const PLAUSIBLE: { what: string; pick: (c: string, w: number, d: number) => number | null; lo: number; hi: number }[] = [
  { what: 'doors', pick: (c, w, d) => (c === 'door' ? Math.max(w, d) : null), lo: 0.62, hi: 1.1 },
  { what: 'beds (length)', pick: (c, w, d) => (c === 'bed' ? Math.max(w, d) : null), lo: 1.6, hi: 2.2 },
  { what: 'wardrobes (depth)', pick: (c, w, d) => (c === 'wardrobe' ? Math.min(w, d) : null), lo: 0.4, hi: 0.75 },
  { what: 'sofas (depth)', pick: (c, w, d) => (c === 'sofa' ? Math.min(w, d) : null), lo: 0.7, hi: 1.1 },
  { what: 'kitchen counters (depth)', pick: (c, w, d) => (c === 'counter' ? Math.min(w, d) : null), lo: 0.45, hi: 0.8 },
];
/** Two or more of these references out of range the same way, and the scale is not believed. A lie of about a fifth or more is caught;
 *  a smaller one cannot be told from an honest drawing, and the report says so. */
export function plausibility(read: PlanRead, scale: ScaleFit, f: number): { bad: boolean; why: string } {
  const sx = scaleFor(scale, 'x'), sy = scaleFor(scale, 'y');
  const out: { what: string; med: number; dir: 1 | -1 }[] = []; let seen = 0;
  for (const rule of PLAUSIBLE) {
    const vals: number[] = [];
    for (const o of read.openings) { const v = rule.pick(o.kind, Math.abs(o.box[2] - o.box[0]) / f / sx, Math.abs(o.box[3] - o.box[1]) / f / sy); if (v !== null) vals.push(v); }
    for (const o of read.symbols) { const v = rule.pick(o.cls, Math.abs(o.box[2] - o.box[0]) / f / sx, Math.abs(o.box[3] - o.box[1]) / f / sy); if (v !== null) vals.push(v); }
    if (!vals.length) continue;
    seen++;
    const m = med(vals);
    if (m < rule.lo) out.push({ what: rule.what, med: m, dir: -1 }); else if (m > rule.hi) out.push({ what: rule.what, med: m, dir: 1 });
  }
  const up = out.filter((o) => o.dir === 1), down = out.filter((o) => o.dir === -1);
  const worst = up.length >= down.length ? up : down;
  if (worst.length >= 2 || (seen === 1 && worst.length === 1 && out[0].what === 'doors' && (out[0].med < 0.55 || out[0].med > 1.2))) {
    return { bad: true, why: `On the fitted scale ${worst.map((o) => `${o.what} measure ${o.med.toFixed(2)} m`).join(' and ')}, which is not plausible for a flat.` };
  }
  return { bad: false, why: '' };
}

/** A provider returning anything else is turned away. */
function asPlanRead(raw: unknown): PlanRead | null {
  const r = raw as Partial<PlanRead> | null;
  if (!r || !Array.isArray(r.rooms) || !Array.isArray(r.dimensions) || !Array.isArray(r.openings) || !Array.isArray(r.symbols)) return null;
  return r as PlanRead;
}

/** C8's interface: one image (PNG or JPEG bytes) in, an ImportResult out. */
export async function proposeFromRaster(provider: VisionProvider | null, input: PlanVisionInput): Promise<ImportResult> {
  let image: Gray;
  try { image = decodeImage(input.image); } catch (e) { throw new ImportError('image-unreadable', (e as Error).message); }
  const run = await readRasterPages([{ id: 'p1', image }], { provider });
  if (run.status !== 'ok' || !run.result) throw new ImportError(provider ? 'vision-failed' : 'vision-not-configured', run.reason);
  return run.result;
}
export type { Extracted, Method, SourceRef };
