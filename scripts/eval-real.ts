// Run the reader, with no vision, over real sets kept outside the repo and score it against label truth (SPEC 17.11).
//   tsx scripts/eval-real.ts --all [--dir ~/walkthru-tools/eval/real] [--jobs 2] [--timeout 240] [--out <results dir>] [--ocr-floor]
//   tsx scripts/eval-real.ts --one <set-id> --out <file.json>      (what --all runs for each set, in its own process)
//   tsx scripts/eval-real.ts --report <results dir> [--dir ...]    (table per split from the saved per-set results)
// Set folder: <dir>/<set>/{drawing.pdf | drawing.jpg | drawing.png}, truth.json {schema:'label-v1',...}, meta.json {split, firm, format, ...}.
// PDFs take the vector path (understandPages). Pictures take the raster path with no model, which refuses them by design; with
// --ocr-floor a local Tesseract pass over the picture is also scored, as a floor on what text alone could give (it is not the reader).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addLabel, blankLabel, scoreLabelSet, summariseLabel } from './eval/label-score';
import type { LabelPrediction, LabelScore, LabelTruth } from './eval/label-score';
import { ocrFloor } from './eval/ocr-floor';
import type { OcrFloor } from './eval/ocr-floor';

export interface RealSet { id: string; dir: string; split: 'dev' | 'held-out'; firm: string; file: string; kind: 'pdf' | 'image'; truth: LabelTruth; meta: Record<string, unknown> }
export interface RealResult {
  id: string; split: string; firm: string; kind: string; format: string; path: 'vector' | 'raster'; seconds: number;
  outcome: string; error?: string; score: LabelScore; ocr?: OcrFloor;
  read?: { rooms: { label: string; type: string; sides: [number, number]; status: string; labelDims?: { w: number; l: number }; method?: string }[]; warnings: string[]; unmapped: string[]; scaleAgreeing?: number; scaleVotes?: number; dims: number };
}

export function loadRealSets(root: string): RealSet[] {
  const out: RealSet[] = [];
  if (!fs.existsSync(root)) return out;
  for (const name of fs.readdirSync(root).sort()) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory() || name.startsWith('_')) continue;
    const tp = path.join(dir, 'truth.json');
    if (!fs.existsSync(tp)) continue;
    const truth = JSON.parse(fs.readFileSync(tp, 'utf8')) as LabelTruth;
    if (truth.schema !== 'label-v1') continue;
    const meta = fs.existsSync(path.join(dir, 'meta.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) : {};
    const file = ['drawing.pdf', 'drawing.png', 'drawing.jpg', 'drawing.jpeg'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    if (!file) continue;
    out.push({ id: name, dir, split: meta.split === 'held-out' ? 'held-out' : 'dev', firm: String(meta.firm ?? name), file, kind: file.endsWith('.pdf') ? 'pdf' : 'image', truth, meta });
  }
  return out;
}

const polyArea = (p: [number, number][]): number => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };

export async function runSet(s: RealSet, opts: { ocr?: boolean } = {}): Promise<RealResult> {
  const t0 = Date.now();
  const base = { id: s.id, split: s.split, firm: s.firm, kind: s.kind, format: String(s.meta.format ?? s.kind) };
  if (s.kind === 'pdf') {
    // a PDF whose plan is a picture (meta.format 'raster-image-inside-pdf') is still run down the vector path, as the app does, but is grouped with the raster sets
    const pdfPath: 'vector' | 'raster' = String(s.meta.format ?? 'vector-pdf').startsWith('raster') ? 'raster' : 'vector';
    const { loadVectorPages } = await import('../src/import/pdfjs-adapter');
    const { understandPages } = await import('../src/understand/pipeline');
    const { ImportError } = await import('../src/import/types');
    try {
      const pages = await loadVectorPages(new Uint8Array(fs.readFileSync(s.file)));
      const u = understandPages(pages, 'input', 'eval');
      const r = u.result; const an = u.analysis;
      const unnamed = (l: string): boolean => /^room( \d+)?$/i.test(l.trim());
      const rooms = r.proposal.rooms.map((x) => {
        const poly = x.polygon.map((p): [number, number] => [p.x, p.z]);
        const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
        const w = Math.max(...xs) - Math.min(...xs), l = Math.max(...zs) - Math.min(...zs);
        const ex = r.extras.rooms.find((e) => e.id === x.id);
        const type = (unnamed(x.label ?? '') && x.roomType === 'other' ? u.plan.roomTypes.get(x.id) : undefined) ?? x.roomType;
        return { label: x.label ?? '', roomType: type, sides: [Math.min(w, l), Math.max(w, l)] as [number, number], areaM2: polyArea(poly), status: an.roomStatus.get(x.id) ?? ('unverified' as const), labelDims: ex?.labelDims, method: ex?.method };
      });
      const pred: LabelPrediction = { attempted: true, rooms };
      return { ...base, path: pdfPath, seconds: (Date.now() - t0) / 1000, outcome: `ok, ${rooms.length} rooms`, score: scoreLabelSet(pred, s.truth),
        read: { rooms: rooms.map((x) => ({ label: x.label, type: x.roomType, sides: x.sides, status: x.status, labelDims: x.labelDims, method: x.method })), warnings: r.extras.warnings, unmapped: r.extras.unmapped.map((m) => `${m.label}: ${m.reason}`), scaleAgreeing: r.extras.scale.agreeing, scaleVotes: r.extras.scale.votes.length, dims: an.dims.length } };
    } catch (e) {
      const code = e instanceof ImportError ? e.code : 'crash';
      const pred: LabelPrediction = { attempted: false, error: `${code}: ${(e as Error).message}`, rooms: [] };
      return { ...base, path: pdfPath, seconds: (Date.now() - t0) / 1000, outcome: `refused (${code})`, error: pred.error, score: scoreLabelSet(pred, s.truth) };
    }
  }
  // picture: raster path with no model
  const { decodeImage } = await import('../src/understand/pixels/image');
  const { readRasterPages } = await import('../src/understand/raster');
  let outcome = '', error: string | undefined;
  try {
    let image;
    const bytes = new Uint8Array(fs.readFileSync(s.file));
    try { image = decodeImage(bytes); } catch {
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-img-')), 'in.png');
      execFileSync('sips', ['-s', 'format', 'png', s.file, '--out', tmp], { stdio: 'ignore' });
      image = decodeImage(new Uint8Array(fs.readFileSync(tmp)));
    }
    const run = await readRasterPages([{ id: 'p1', image }], { provider: null });
    outcome = `${run.status}${run.reason ? `: ${run.reason}` : ''}`; if (run.status !== 'ok') error = run.reason;
  } catch (e) { outcome = `crash: ${(e as Error).message}`; error = outcome; }
  const pred: LabelPrediction = { attempted: false, error: error ?? outcome, rooms: [] };
  const res: RealResult = { ...base, path: 'raster', seconds: (Date.now() - t0) / 1000, outcome, error, score: scoreLabelSet(pred, s.truth) };
  if (opts.ocr) res.ocr = await ocrFloor(s.file, s.truth);
  return res;
}

const runChild = (id: string, outFile: string, root: string, timeoutS: number, ocr: boolean): Promise<void> => new Promise((resolve) => {
  const tsx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'tsx');
  const args = [fileURLToPath(import.meta.url), '--one', id, '--out', outFile, '--dir', root, ...(ocr ? ['--ocr-floor'] : [])];
  execFile(tsx, args, { timeout: timeoutS * 1000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=3072' } }, (err, _so, se) => {
    if (err && !fs.existsSync(outFile)) fs.writeFileSync(outFile + '.fail', `${(err as { killed?: boolean }).killed ? `timeout after ${timeoutS} s` : String(err.message).slice(0, 300)}\n${String(se).slice(0, 500)}`);
    resolve();
  });
});

export function formatReal(results: RealResult[], sets: RealSet[]): string {
  const out: string[] = [];
  const groups: [string, (r: RealResult) => boolean][] = [['real development', (r) => r.split === 'dev'], ['real held-out', (r) => r.split === 'held-out']];
  for (const [title, f] of groups) for (const path of ['vector', 'raster'] as const) {
    const rs = results.filter((r) => f(r) && r.path === path); if (!rs.length) continue;
    const tot = blankLabel(); for (const r of rs) addLabel(tot, r.score);
    const refused = rs.filter((r) => !r.score.attempted).length;
    out.push(`${title.toUpperCase()}, ${path} path: ${rs.length} sets (${sets.filter((s) => rs.some((r) => r.id === s.id)).map((s) => s.firm).filter((v, i, a) => a.indexOf(v) === i).length} builders), ${refused} refused, ${rs.length - refused} read`);
    for (const row of summariseLabel(tot)) out.push(`  ${row.label.padEnd(60)} ${row.value.padStart(6)}   bar ${row.bar}   [${row.detail}]`);
    out.push('');
  }
  return out.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const val = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const root = val('--dir') ?? path.join(os.homedir(), 'walkthru-tools', 'eval', 'real');
  const sets = loadRealSets(root);
  if (val('--one')) {
    const s = sets.find((x) => x.id === val('--one')); if (!s) { console.error('no such set'); process.exit(2); }
    const res = await runSet(s, { ocr: args.includes('--ocr-floor') });
    fs.writeFileSync(val('--out')!, JSON.stringify(res)); return;
  }
  const outDir = val('--out') ?? path.join(root, '_results');
  if (args.includes('--all')) {
    fs.mkdirSync(outDir, { recursive: true });
    const jobs = Number(val('--jobs') ?? 2); const timeoutS = Number(val('--timeout') ?? 240); const queue = [...sets];
    const worker = async (): Promise<void> => { for (let s = queue.shift(); s; s = queue.shift()) { const f = path.join(outDir, `${s.id}.json`); fs.rmSync(f, { force: true }); fs.rmSync(f + '.fail', { force: true }); const t = Date.now(); await runChild(s.id, f, root, timeoutS, args.includes('--ocr-floor')); console.log(`${s.id} ${fs.existsSync(f) ? 'done' : 'FAILED'} in ${((Date.now() - t) / 1000).toFixed(0)} s`); } };
    await Promise.all(Array.from({ length: jobs }, worker));
  }
  const results: RealResult[] = [];
  for (const s of sets) {
    const f = path.join(outDir, `${s.id}.json`);
    if (fs.existsSync(f)) results.push(JSON.parse(fs.readFileSync(f, 'utf8')));
    else if (fs.existsSync(f + '.fail')) console.log(`${s.id}: no result (${fs.readFileSync(f + '.fail', 'utf8').split('\n')[0]})`);
  }
  console.log(formatReal(results, sets));
  console.log(perSetTable(results));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) void main();

export function perSetTable(results: RealResult[]): string {
  const out = [`${'set'.padEnd(5)}${'split'.padEnd(10)}${'format'.padEnd(26)}${'truth'.padStart(6)}${'found'.padStart(6)}${'paired'.padStart(7)}${'typed'.padStart(6)}${'size ok'.padStart(8)}${'walls'.padStart(6)}${'verif'.padStart(6)}  outcome / ocr floor (sizes, names)`];
  for (const r of results) { const x = r.score; out.push(`${r.id.padEnd(5)}${r.split.padEnd(10)}${r.format.slice(0, 24).padEnd(26)}${String(x.truthRooms).padStart(6)}${String(x.predRooms).padStart(6)}${String(x.matched).padStart(7)}${String(x.typed).padStart(6)}${String(x.sizeRight).padStart(8)}${String(x.wallMatched).padStart(6)}${String(x.verifiedStrict.n).padStart(6)}  ${r.outcome.slice(0, 50)}${r.ocr ? `  | ocr ${r.ocr.sizesFound}/${r.ocr.sizesTruth}, ${r.ocr.namesFound}/${r.ocr.namesTruth}` : ''}`); }
  return out.join('\n');
}
