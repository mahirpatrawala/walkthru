// C12e. SPEC 17.3 and 17.9: one upload job. A drawing set (PDFs and pictures, any number) goes in; `.cache/understand/<scene>/` gets the
// page renders, understanding.json, review.json and the machine outputs, and public/scenes/<scene>/ gets proposal.json,
// proposal-extras.json and designs.json with every unverified value flagged.
//
//   read        open the PDFs (pdf.js) and decode the pictures
//   render      one PNG per PDF page (poppler, 200 dpi) and one per picture, into .cache only
//   understand  the vector path (C8 importer + C12b text and dimensions) when the set has vector pages with a plan; otherwise the
//               raster path (C12d), which needs the vision model: only when a key exists AND the broker ticked the notice
//   write       the three outputs
//
// Privacy: outputs carry no file names and no title-block text (sourceFile is "drawing set"; the file names live only in the
// upload's own cache path, not in any output or status). Node only; the heavy modules are imported when a job runs so the dev server starts fast.
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ImportErrorCode, VectorPage } from '../../import/types';
import type { PageMeta, PagesFile } from '../page-geometry';
import { progressOf, buildRows } from '../review-model';
import type { UnderstandingDoc } from '../review-model';
import { NOTICE_TEXT_OFF } from './notice-text';
import type { UnderstandHooks, UnderstandJob, UnderstandSummary, JobRunner } from './jobs';
import { JobCancelled, JobFailure } from './jobs';
import { saveStored, sceneCache, writeJsonAtomic, writeOutputs } from './store';
import type { Gray } from '../pixels/image';
import type { VisionProvider } from '../vision/provider';
import type { BaseOutputs } from '../review-apply';

const run = promisify(execFile);
export const RENDER_DPI = 200;

export interface RunConfig {
  /** the vision model, or null when none can be used. Called only when the broker asked for vision AND ticked the notice. */
  provider?: () => Promise<VisionProvider | null>;
  /** is a model available at all (a key exists)? Shown in the step; never reveals the key. */
  visionAvailable?: () => Promise<boolean> | boolean;
  dpi?: number;
}

/** The default vision model: Gemini on Mahir's own key (SPEC 17.8). Nothing else is ever used. */
export async function defaultProvider(): Promise<VisionProvider | null> {
  const { resolveGeminiKey } = await import('../vision/keys');
  const key = resolveGeminiKey({ allowEnv: true });
  if (!key) return null;
  const { GeminiProvider } = await import('../vision/gemini');
  return new GeminiProvider({ key: key.key });
}
export async function defaultVisionAvailable(): Promise<boolean> {
  const { resolveGeminiKey } = await import('../vision/keys');
  return !!resolveGeminiKey({ allowEnv: true });
}

const hashId = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 10);

/** PNG width and height from the header. */
export function pngSize(b: Uint8Array): { w: number; h: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

/** PNG and baseline JPEG are read in-process; anything else (WebP, HEIC, progressive JPEG) goes through macOS `sips`. */
export async function loadGray(file: string): Promise<Gray> {
  const { decodeImage } = await import('../pixels/image');
  const bytes = new Uint8Array(fs.readFileSync(file));
  try { return decodeImage(bytes); } catch (first) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-img-')), 'in.png');
    try { execFileSync('sips', ['-s', 'format', 'png', file, '--out', tmp], { stdio: 'ignore' }); return decodeImage(new Uint8Array(fs.readFileSync(tmp))); }
    catch { throw new JobFailure(`One of the pictures could not be read (${(first as Error).message}). Use a PNG or JPG.`); }
  }
}

/** poppler: each page of a PDF as 8-bit grey PNG. Returns the files in page order. */
export async function renderPdf(pdf: string, outDir: string, dpi: number): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const prefix = path.join(outDir, 'pg');
  try { await run('pdftocairo', ['-png', '-gray', '-r', String(dpi), pdf, prefix], { timeout: 180_000 }); }
  catch (e) { throw new JobFailure(`The pages could not be drawn (${(e as Error).message.split('\n')[0]}). Is poppler installed? (brew install poppler)`); }
  return fs.readdirSync(outDir).filter((f) => /^pg-\d+\.png$/.test(f)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0])).map((f) => path.join(outDir, f));
}
async function pdfRotations(pdf: string): Promise<number[]> {
  try {
    const { stdout } = await run('pdfinfo', ['-f', '1', '-l', '9999', pdf], { timeout: 30_000 });
    return [...stdout.matchAll(/^Page\s+(\d+)\s+rot:\s+(\d+)/gm)].map((m) => Number(m[2]));
  } catch { return []; }
}

export function makeRunner(cfg: RunConfig = {}): JobRunner {
  const dpi = cfg.dpi ?? RENDER_DPI;
  return async (job: UnderstandJob, hooks: UnderstandHooks): Promise<UnderstandSummary> => {
    const { sceneId, inputs, options, paths, signal } = job;
    const check = (): void => { if (signal.aborted) throw new JobCancelled(); };
    const cache = sceneCache(paths, sceneId);
    const work = path.join(cache, 'work');
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });

    // ---------------------------------------------------------------- read
    hooks.stageStart('read', 'Opening the files');
    const { loadVectorPages } = await import('../../import/pdfjs-adapter');
    const sha = createHash('sha256');
    interface PdfIn { file: string; pages: VectorPage[]; rot: number[] }
    const pdfs: PdfIn[] = [];
    const imageFiles: string[] = [];
    for (const [i, inp] of inputs.entries()) {
      check();
      const bytes = new Uint8Array(fs.readFileSync(inp.path));
      sha.update(bytes);
      if (inp.kind === 'pdf') {
        let pages: VectorPage[];
        try { pages = await loadVectorPages(bytes); } catch (e) { throw new JobFailure(`File ${i + 1} is not a PDF this tool can open (${(e as Error).message.split('\n')[0]}).`); }
        pdfs.push({ file: inp.path, pages, rot: await pdfRotations(inp.path) });
      } else imageFiles.push(inp.path);
      hooks.progress('read', (i + 1) / inputs.length, `File ${i + 1} of ${inputs.length}`);
    }
    const sha256 = sha.digest('hex');
    const vectorPages: VectorPage[] = [];
    for (const p of pdfs) for (const pg of p.pages) vectorPages.push({ ...pg, index: vectorPages.length });
    const isRasterPage = (p: VectorPage): boolean => p.imageCoverage > 0.5 && p.strokes.length + p.fills.length < 200;
    hooks.stageEnd('read', 'done', `${pdfs.length} PDF${pdfs.length === 1 ? '' : 's'}, ${imageFiles.length} picture${imageFiles.length === 1 ? '' : 's'}, ${vectorPages.length} PDF page${vectorPages.length === 1 ? '' : 's'}`);

    // ---------------------------------------------------------------- render
    hooks.stageStart('render', 'Drawing the pages');
    interface Pic { png: string; w: number; h: number; vec?: { page: VectorPage; rot: number } }
    const pdfPics: Pic[] = [];
    for (const [k, p] of pdfs.entries()) {
      check();
      const files = await renderPdf(p.file, path.join(work, `pdf-${k}`), dpi);
      if (files.length !== p.pages.length) throw new JobFailure('The page pictures do not match the PDF pages.');
      for (const [j, f] of files.entries()) {
        const sz = pngSize(new Uint8Array(fs.readFileSync(f).subarray(0, 32)));
        pdfPics.push({ png: f, w: sz.w, h: sz.h, vec: { page: vectorPages[pdfPics.length], rot: p.rot[j] ?? 0 } });
      }
      hooks.progress('render', (k + 1) / Math.max(1, pdfs.length + imageFiles.length), `PDF ${k + 1}`);
    }
    const grays = new Map<string, Gray>();
    const imagePics: Pic[] = [];
    const { encodePng } = await import('../pixels/image');
    for (const [k, f] of imageFiles.entries()) {
      check();
      const g = await loadGray(f);
      const png = path.join(work, `img-${k}.png`);
      fs.writeFileSync(png, encodePng(g));
      grays.set(png, g);
      imagePics.push({ png, w: g.width, h: g.height });
      hooks.progress('render', (pdfs.length + k + 1) / Math.max(1, pdfs.length + imageFiles.length), `Picture ${k + 1}`);
    }
    hooks.stageEnd('render', 'done', `${pdfPics.length + imagePics.length} page picture${pdfPics.length + imagePics.length === 1 ? '' : 's'}`);

    // ---------------------------------------------------------------- understand
    hooks.stageStart('understand', 'Reading the drawing');
    check();
    const pagesDir = path.join(cache, 'pages');
    fs.rmSync(pagesDir, { recursive: true, force: true });
    fs.mkdirSync(pagesDir, { recursive: true });
    let doc: UnderstandingDoc | null = null;
    let base: BaseOutputs | null = null;
    const meta: PageMeta[] = [];
    let route: 'vector' | 'picture' = 'vector';
    const vision = { used: false, calls: 0, usd: 0 };
    let vectorFailure: string | null = null;

    if (vectorPages.some((p) => !isRasterPage(p))) {
      const { understandVector } = await import('../vector-adapter');
      const { ImportError } = await import('../../import/types');
      try {
        const v = understandVector(vectorPages, { sceneId, sha256 });
        doc = v.doc; base = v.base;
        v.pages.forEach((p, i) => {
          const pic = pdfPics[i];
          fs.copyFileSync(pic.png, path.join(pagesDir, `p${i + 1}.png`));
          meta.push({ n: i + 1, kind: 'vector', file: `pages/p${i + 1}.png`, w: pic.w, h: pic.h, pxPerPt: dpi / 72, raw: { width: p.width, height: p.height, phi: p.phi }, ...(pic.vec!.rot ? { pdfRotate: pic.vec!.rot } : {}) });
        });
        if (imageFiles.length) hooks.warning('The pictures in this set were not used because the PDF has a vector plan, which is read exactly.');
        if (options.vision) hooks.warning('Vision is only used for pictures of plans. This set has a vector plan, so nothing was sent anywhere.');
      } catch (e) {
        if (e instanceof ImportError && (e.code as ImportErrorCode) !== 'pdfjs-shape') vectorFailure = e.message; else throw e;
      }
    }

    if (!doc || !base) {
      // the raster path: pictures, and scanned PDF pages
      const rasterPics = [...pdfPics.filter((p) => isRasterPage(p.vec!.page)), ...imagePics];
      if (!rasterPics.length) throw new JobFailure(vectorFailure ?? 'No plan was found in this set.');
      route = 'picture';
      const provider = options.vision ? await (cfg.provider ?? defaultProvider)() : null;
      if (options.vision && !provider) hooks.warning('Vision was asked for but no model key was found. Nothing was sent.');
      const { readRasterPages } = await import('../raster');
      const pages: { id: string; image: Gray }[] = [];
      for (const [i, p] of rasterPics.entries()) {
        const g = grays.get(p.png) ?? await loadGray(p.png);
        pages.push({ id: `p${i + 1}`, image: g });
        fs.copyFileSync(p.png, path.join(pagesDir, `p${i + 1}.png`));
        meta.push({ n: i + 1, kind: 'raster', file: `pages/p${i + 1}.png`, w: g.width, h: g.height });
      }
      let sends = 0;
      const rr = await readRasterPages(pages, { provider, onSend: () => { sends++; hooks.progress('understand', Math.min(0.9, 0.1 + 0.08 * sends), `Sent ${sends} piece${sends === 1 ? '' : 's'} to the model`); } });
      check();
      if (rr.status !== 'ok' || !rr.result) throw new JobFailure(rr.reason ?? NOTICE_TEXT_OFF);
      rr.understanding.views.forEach((v, i) => { if (meta[i] && v.turnedCw) meta[i].turnCw = v.turnedCw; });
      vision.used = !!provider; vision.calls = rr.cost.visionCalls; vision.usd = rr.cost.usd;
      const u = rr.understanding as unknown as UnderstandingDoc;
      u.ceiling = { id: hashId('ceiling|picture'), value: rr.result.proposal.wallHeightM ?? 2.75, unit: 'm', method: 'derived', status: 'unverified', confidence: 0.1, source: { page: 1, view: 'p1', sheet: '', bbox: [0, 0, 0, 0] }, checks: [], derivedFrom: { ids: [], how: 'a picture of a plan has no ceiling height, so 2.75 m is assumed' } };
      doc = u;
      base = { proposal: rr.result.proposal, extras: { ...rr.result.extras, sourceFile: 'drawing set' }, designs: rr.designs };
      writeJsonAtomic(path.join(cache, 'sent.json'), { notice: rr.notice, sent: rr.sent, cost: rr.cost });
      for (const w of rr.understanding.warnings.slice(0, 5)) hooks.warning(w);
    }
    hooks.stageEnd('understand', 'done');

    // ---------------------------------------------------------------- write
    hooks.stageStart('write', 'Saving');
    check();
    const pages: PagesFile = { version: 1, pages: meta };
    const stored = { doc, base, pages, review: { version: 1 as const, decisions: {} } };
    saveStored(paths, sceneId, stored);
    writeOutputs(paths, sceneId, stored);
    fs.rmSync(work, { recursive: true, force: true });
    hooks.stageEnd('write', 'done');
    const rows = buildRows(doc);
    const pr = progressOf(rows);
    return {
      path: route, pages: meta.length, rooms: doc.rooms.length, openings: doc.openings.length, items: doc.items.length, dimensions: doc.dimensions.length,
      verified: pr.verified, needLook: pr.total, conflicts: rows.filter((r) => r.baseStatus === 'conflict').length, vision,
    };
  };
}
